import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Generator, Task } from './contracts.ts';
import { OpenAIGenerator, parseReasoningEffort } from './providers.ts';
import type { CallRecord, GenerationDefinition } from './providers.ts';
import { recipe } from './recipe.ts';
import { candidateSchema, object } from './validation.ts';
import { normalizeUsage } from './usage.ts';

export type LiveProvider = 'openai' | 'codex';
export function liveProvider(value: string): LiveProvider {
  if (value !== 'openai' && value !== 'codex') {
    throw new Error('provider must be openai or codex (build also supports mock).');
  }
  return value;
}

export function createLiveGenerator(
  provider: LiveProvider,
  model: string,
  definition?: GenerationDefinition,
  transport: typeof fetch = fetch,
) {
  if (!model.trim()) {
    throw new Error('Live runs require --model or BUILDER_MODEL.');
  }
  if (provider === 'codex') {
    return new CodexGenerator(model, definition);
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('Live runs require OPENAI_API_KEY and --model or BUILDER_MODEL.');
  }
  return new OpenAIGenerator(
    process.env.OPENAI_API_KEY,
    model,
    transport,
    definition,
    process.env.OPENAI_BASE_URL?.trim() || undefined,
  );
}

export type CodexInvocation = {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  input: string;
  signal: AbortSignal;
  onLine?: (line: string) => void;
  onDiagnostic?: (reason: string) => void;
};
export type CodexTransport = (invocation: CodexInvocation) => Promise<string>;

class CodexFailure extends Error {}

// Fixed messages only: CLI diagnostics can contain credentials or private text.
function diagnostic(text: string): string | undefined {
  if (
    /model.*(?:not supported|not found|does not exist|not available|unsupported)|unsupported.*model/i.test(
      text,
    )
  ) {
    return 'Codex cannot access the selected model with this login.';
  }
  if (/unauthorized|authentication|not logged in|401\b/i.test(text)) {
    return 'Codex authentication failed; check codex login status.';
  }
  if (/usage limit|rate limit|quota|429\b/i.test(text)) {
    return 'Codex reported a usage or rate limit.';
  }
  if (/invalid.*schema|schema.*invalid/i.test(text)) {
    return 'Codex rejected the output schema.';
  }
  if (
    /reconnecting|retrying|stream disconnected|connection.*(?:failed|closed)|error sending request/i.test(
      text,
    )
  ) {
    return 'Codex connection interrupted; the CLI may be retrying.';
  }
}

// No shell interpolation, inherited API credentials, or raw CLI diagnostics in artifacts.
export const runCodex: CodexTransport = (invocation) =>
  new Promise((resolve, reject) => {
    const child = spawn('codex', invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: invocation.signal,
      killSignal: 'SIGKILL',
    });
    let output = '';
    let pending = '';
    let streamError: unknown;
    let stderr = '';
    let lastDiagnostic: string | undefined;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16384);
      const reason = diagnostic(stderr);
      if (reason && reason !== lastDiagnostic) {
        lastDiagnostic = reason;
        invocation.onDiagnostic?.(reason);
      }
    });
    let exceeded = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > 2 * 1024 * 1024) {
        exceeded = true;
        child.kill('SIGKILL');
        return;
      }
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop()!;
      try {
        for (const line of lines) {
          if (line.trim()) {
            invocation.onLine?.(line);
          }
        }
      } catch (error) {
        streamError = error;
        child.kill('SIGKILL');
      }
    });
    child.stdin.on('error', () => {});
    child.on('error', () =>
      reject(new Error('Codex could not run; install the CLI and run codex login with ChatGPT.')),
    );
    child.on('close', (code) => {
      if (invocation.signal.aborted) {
        reject(new Error('Codex generation cancelled or deadline exceeded.'));
      } else if (streamError) {
        reject(streamError);
      } else if (exceeded || code !== 0) {
        reject(
          new CodexFailure(
            exceeded
              ? 'Codex output limit exceeded.'
              : (lastDiagnostic ??
                  'Codex execution failed; check codex login status and model access.'),
          ),
        );
      } else {
        try {
          if (pending.trim()) {
            invocation.onLine?.(pending);
          }
          resolve(output);
        } catch (error) {
          reject(error);
        }
      }
    });
    child.stdin.end(invocation.input);
  });

export class CodexGenerator implements Generator {
  calls: CallRecord[] = [];
  model: string;
  definition: GenerationDefinition;
  transport: CodexTransport;
  constructor(
    model: string,
    definition: GenerationDefinition = {
      instructions: recipe.instructions,
      schema: candidateSchema,
      maxOutputTokens: recipe.limits.maxOutputTokens,
      maxCalls: recipe.limits.maxCalls,
    },
    transport: CodexTransport = runCodex,
  ) {
    if (!model.trim()) {
      throw new Error('BUILDER_MODEL must be explicitly configured.');
    }
    parseReasoningEffort(definition.reasoningEffort);
    if (definition.reasoningSummary) {
      throw new Error('--reasoning-summary requires provider openai.');
    }
    this.model = model;
    this.definition = definition;
    this.transport = transport;
  }
  async generate(task: Task, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (this.calls.length >= this.definition.maxCalls) {
      throw new Error('Model call budget exhausted.');
    }
    const call: CallRecord = {
      endpoint: 'codex-exec',
      request: {
        model: this.model,
        instructions: this.definition.instructions,
        input: JSON.stringify({ task }),
        schema: this.definition.schema,
        reasoningEffort: this.definition.reasoningEffort ?? null,
        budget: 'one CLI invocation; CLI manages inference token limits',
      },
      elapsedMs: 0,
    };
    this.calls.push(call);
    const started = performance.now();
    let directory: string | undefined;
    try {
      this.definition.onCall?.(call);
      directory = await mkdtemp(join(tmpdir(), 'builder-codex-'));
      const schema = join(directory, 'schema.json');
      await writeFile(schema, JSON.stringify(this.definition.schema), { mode: 0o600 });
      // Keep the saved ChatGPT login, but exclude all API/platform secrets from the child.
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !/API_KEY|TOKEN|SECRET|PASSWORD|FREYA_|OPENAI_|CODEX_API_KEY/.test(name),
        ),
      );
      let text: string | undefined;
      let completed = false;
      let usage: unknown;
      let streamed = false;
      const consume = (line: string) => {
        streamed = true;
        const event: unknown = JSON.parse(line);
        if (!object(event)) {
          throw new Error('Invalid Codex event.');
        }
        if (event.type === 'error' || event.type === 'turn.failed') {
          const detail =
            typeof event.message === 'string'
              ? event.message
              : object(event.error) && typeof event.error.message === 'string'
                ? event.error.message
                : '';
          const reason = diagnostic(detail);
          if (event.type === 'error' && /reconnecting|retrying/i.test(detail)) {
            this.definition.onEvent?.({
              kind: 'status',
              reason: reason ?? 'Codex is retrying its connection.',
            });
            return;
          }
          throw new CodexFailure(reason ?? 'Codex turn failed; no candidate accepted.');
        }
        if (event.type === 'turn.started') {
          this.definition.onEvent?.({ kind: 'accepted' });
        }
        if (
          (event.type === 'item.started' || event.type === 'item.completed') &&
          object(event.item) &&
          event.item.type === 'reasoning'
        ) {
          this.definition.onEvent?.({ kind: 'reasoning' });
        }
        if (event.type === 'item.completed' && object(event.item)) {
          if (event.item.type === 'agent_message' && typeof event.item.text === 'string') {
            text = event.item.text;
            this.definition.onEvent?.({ kind: 'draft', text });
          } else if (event.item.type !== 'reasoning') {
            throw new Error('Codex used an unexpected tool; no candidate accepted.');
          }
        }
        if (event.type === 'turn.completed') {
          completed = true;
          usage = event.usage;
          this.definition.onEvent?.({ kind: 'completed', usage });
        }
      };
      const output = await this.transport({
        cwd: directory,
        env,
        signal,
        onLine: consume,
        onDiagnostic: (reason) => this.definition.onEvent?.({ kind: 'status', reason }),
        args: [
          'exec',
          '--ignore-rules',
          '--ephemeral',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--json',
          '--color',
          'never',
          '--model',
          this.model,
          // Load the user's provider and login configuration (including custom
          // providers), while disabling configured tools in this generation.
          '--config',
          'mcp_servers={}',
          '--config',
          'approval_policy="never"',
          '--config',
          'features.shell_tool=false',
          '--config',
          'web_search="disabled"',
          '--config',
          'project_doc_max_bytes=0',
          ...(this.definition.reasoningEffort
            ? [
                '--config',
                `model_reasoning_effort=${JSON.stringify(this.definition.reasoningEffort)}`,
              ]
            : []),
          '--output-schema',
          schema,
          '-',
        ],
        input: `${this.definition.instructions}\n\nGenerate only the requested JSON from the supplied input. Do not use tools, read files, or execute commands.\n\n${JSON.stringify({ task })}`,
      });
      signal.throwIfAborted();
      if (!streamed) {
        for (const line of output.split('\n').filter((line) => line.trim())) {
          consume(line);
        }
      }
      // Record usage before validation so a rejected turn still reports its cost.
      const tokens = normalizeUsage(usage);
      if (tokens) {
        call.usage = tokens;
      }
      if (!completed || !text) {
        throw new Error('Codex did not complete; no candidate accepted.');
      }
      const candidate: unknown = JSON.parse(text);
      call.response = { status: 'completed', candidate, usage };
      return candidate;
    } catch (error) {
      call.error = signal.aborted
        ? 'Codex generation cancelled or deadline exceeded.'
        : `${error instanceof CodexFailure ? error.message : 'Codex generation failed; verify CLI installation, ChatGPT login, model access, and completed JSON output.'} No API fallback was attempted.`;
      throw new Error(call.error);
    } finally {
      call.elapsedMs = Math.round(performance.now() - started);
      this.definition.onCall?.(call);
      if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}
