// CLI orchestration and records; builder decisions live in recipe.ts.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { freyaRecipe } from './recipe.ts';
import {
  compileWorkflow,
  loadFreyaTask,
  parseWorkflowCandidate,
  workflowCandidateSchema,
} from './workflow.ts';
import { FreyaBridge } from './freya.ts';
import type { PracticeResult, Registration } from './freya.ts';
import { hash, sourceSnapshot } from './experiments.ts';
import { object } from './validation.ts';
import { generationProgress } from './progress.ts';
import { createOpenAIGenerator } from './providers.ts';
import type { CallRecord, ModelEvent, ReasoningEffort } from './providers.ts';
import { createGenerationTrace } from './generation-trace.ts';
import { estimateCost, hasUsage, sumUsage } from './usage.ts';

// Totals a generator's recorded calls so a run reports one comparable figure.
function usageOf(calls: CallRecord[], model: string) {
  const tokens = sumUsage(calls.map((call) => call.usage));
  return hasUsage(tokens) ? { tokens, cost: estimateCost(tokens, model) } : null;
}

export type EventOptions = {
  briefs: string[];
  openapi: string;
  kit: string;
  slot: string;
  out: string;
  brief?: string;
  only?: string;
  style?: string;
  timeoutMs: number;
  model: string;
  reasoningEffort?: ReasoningEffort;
};

function workflowGenerator(
  model: string,
  transport: typeof fetch = fetch,
  observation: {
    onEvent?: (event: ModelEvent) => void;
    onCall?: (call: CallRecord) => void;
    reasoningSummary?: boolean;
    reasoningEffort?: ReasoningEffort;
  } = {},
) {
  return createOpenAIGenerator(
    model,
    {
      instructions: freyaRecipe.instructions,
      schema: workflowCandidateSchema,
      maxOutputTokens: freyaRecipe.limits.maxOutputTokens,
      maxCalls: freyaRecipe.limits.maxCalls,
      ...observation,
    },
    transport,
  );
}

// Generation-only path: no Freya credentials or practice inputs.
export async function generateFreyaJson(
  options: Pick<
    EventOptions,
    'briefs' | 'openapi' | 'kit' | 'model' | 'timeoutMs' | 'reasoningEffort'
  > & {
    quiet?: boolean;
    showDraft?: boolean;
    reasoningSummary?: boolean;
    out?: string;
    /**
     * Caller-chosen run id, so a run started from the inspector is addressable
     * before its model call returns. Omit it for a generated id.
     */
    runId?: string;
  },
) {
  const trace = await createGenerationTrace(
    options.out || 'experiments',
    {
      ...options,
      provider: 'openai',
      limits: freyaRecipe.limits,
    },
    options.runId,
  );
  const progress = generationProgress(options, (message) => {
    trace.log(message);
    trace.event('progress', { message });
  });
  let failed: unknown;
  try {
    progress.report(`Trace directory: ${trace.directory}`);
    trace.update({ source: await sourceSnapshot() });
    const provider = 'openai';
    if (
      !Number.isInteger(options.timeoutMs) ||
      options.timeoutMs < 1 ||
      options.timeoutMs > 1800000
    ) {
      throw new Error('timeout-ms must be an integer from 1 to 1800000.');
    }
    const signal = AbortSignal.timeout(
      Math.min(options.timeoutMs, freyaRecipe.limits.generationTimeoutMs),
    );
    progress.report(`Reading briefs: ${options.briefs.join(', ')}`);
    progress.report(`Reading original OpenAPI: ${options.openapi}`);
    progress.report('Reading event workflow and tool documentation.');
    const task = await loadFreyaTask(options.briefs, options.openapi, resolve(options.kit));
    trace.update({ task, inputHash: hash(task) });
    progress.report(
      `Loaded ${task.tools.length} tools: ${task.tools.map((tool) => tool.name).join(', ')}`,
    );
    progress.report(
      `Strategy: one direct-generation call to ${options.model}; no planning, audit, or repair calls.`,
    );
    progress.report(`Reasoning effort: ${options.reasoningEffort || 'API default'}.`);
    progress.report(
      `Limits: ${freyaRecipe.limits.maxOutputTokens} output tokens; ${Math.min(options.timeoutMs, freyaRecipe.limits.generationTimeoutMs) / 1000}s deadline.`,
    );
    const generator = workflowGenerator(options.model, fetch, {
      onEvent: (event) => {
        trace.model(event);
        progress.model(event);
      },
      onCall: trace.call,
      reasoningSummary: options.reasoningSummary,
      reasoningEffort: options.reasoningEffort,
    });
    const result = await freyaRecipe.generate(task, {
      generate: (input) => {
        progress.report(`Sending original inputs through ${provider}; waiting for the model.`);
        progress.waiting();
        return generator.generate(input, signal);
      },
      compile: async (input, raw) => {
        signal.throwIfAborted();
        progress.report('Checking model output and binding original tool schemas locally.');
        trace.update({ rawCandidate: raw, phase: 'compile' });
        const candidate = parseWorkflowCandidate(raw);
        const workflow = compileWorkflow(input, candidate);
        // The workflow JSON is this command's only deliverable; record it as a
        // standalone artifact rather than leaving it nested in run.json.
        trace.artifact('compiled.workflow.json', workflow);
        for (const uncertainty of candidate.uncertainties) {
          progress.report(`Model-reported uncertainty: ${uncertainty}`);
        }
        return workflow;
      },
    });
    const nodes = {
      ...(result.workflow.nodes as Record<string, any>),
      ...(result.workflow.global_nodes as Record<string, any>),
    };
    progress.report(
      `Compiled ${Object.keys(nodes).length} nodes; initial node: ${result.workflow.initial_node}.`,
    );
    for (const [name, node] of Object.entries(nodes)) {
      const tools = (node.tools || []).map((tool: any) => tool.function.name).join(', ') || 'none';
      const targets =
        (node.transitions || []).map((edge: any) => edge.target_node).join(', ') || 'none';
      progress.report(`Node ${name}: ${node.node_type}; tools: ${tools}; routes: ${targets}.`);
    }
    trace.update({ workflow: result.workflow, workflowHash: hash(result.workflow) });
    // Report the whole run's spend, not just the last call's, so a recipe that
    // grows more model calls still shows one comparable total.
    const total = usageOf(generator.calls, options.model);
    progress.report(
      total
        ? `Total usage: ${total.tokens.inputTokens.toLocaleString('en-US')} input tokens, ${total.tokens.outputTokens.toLocaleString('en-US')} output tokens` +
            (total.tokens.reasoningTokens
              ? ` (${total.tokens.reasoningTokens.toLocaleString('en-US')} reasoning)`
              : '') +
            (total.cost.usd !== null
              ? `; estimated cost $${total.cost.usd.toFixed(6)} at ${total.cost.source} prices.`
              : '; cost unavailable: no published price for this model.')
        : 'No model tokens were reported by the provider.',
    );
    progress.report('Done. Printing workflow JSON; no Freya calls or practice tests.');
    return result.workflow;
  } catch (error) {
    failed = error;
    progress.report(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    // Even quiet runs report where failure diagnostics can be found.
    if (options.quiet) {
      console.error(`Generation failed. Trace directory: ${trace.directory}`);
    }
    throw error;
  } finally {
    progress.finish();
    trace.finish(failed);
  }
}

export async function runFreya(
  options: EventOptions,
): Promise<{ status: string; path: string; error?: string }> {
  const provider = 'openai';
  if (
    !process.env.FREYA_API_KEY?.trim() ||
    !process.env.FREYA_BANK_TEAM_KEY ||
    process.env.FREYA_BANK_TEAM_KEY.length < 16
  ) {
    throw new Error(
      'Freya runs require FREYA_API_KEY and FREYA_BANK_TEAM_KEY (at least 16 characters).',
    );
  }
  if (!options.briefs.length || !/^[\w.+-]+$/.test(options.slot)) {
    throw new Error(
      'Supply brief files and a slot containing only letters, digits, _, ., +, or -.',
    );
  }
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 1800000
  ) {
    throw new Error('Freya timeout must be from 1 to 1800000 ms.');
  }
  const kit = resolve(options.kit);
  const task = await loadFreyaTask(options.briefs, options.openapi, kit);
  // Validate the case selection before any model call or remote mutation.
  const casesPath = join(kit, 'public-test-set.json');
  const cases: unknown = JSON.parse(await readFile(casesPath, 'utf8'));
  if (!Array.isArray(cases) || !cases.every(object)) {
    throw new Error('Invalid official practice case file.');
  }
  const ids = options.only?.split(',');
  const selected = cases.filter(
    (item) =>
      (!options.brief || item.brief === options.brief) && (!ids || ids.includes(String(item.id))),
  );
  if (!selected.length || (ids && ids.some((id) => !selected.some((item) => item.id === id)))) {
    throw new Error('Practice selection is empty or contains unknown cases.');
  }
  if (
    options.style &&
    !['pieces', 'corrects', 'talkative', 'asks_back', 'in_words'].includes(options.style)
  ) {
    throw new Error('Unknown practice speaking style.');
  }

  const startedAt = new Date().toISOString();
  const started = performance.now();
  const directory = resolve(options.out, randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'run.json');
  const bridge = new FreyaBridge(kit, join(directory, 'platform.jsonl'));
  const source = await sourceSnapshot();
  const kitFiles: Record<string, string> = {};
  for (const name of [
    'VERSION',
    'README.md',
    'freya.py',
    'tools/run_cases.py',
    'tools/score.py',
    'docs/api.md',
    'docs/workflow-format.md',
    'docs/tools-and-code.md',
    'public-test-set.json',
  ]) {
    kitFiles[name] = await readFile(join(kit, name), 'utf8');
  }
  const generator = workflowGenerator(options.model, fetch, {
    reasoningEffort: options.reasoningEffort,
  });
  const record: Record<string, any> = {
    kind: 'freya-live-run',
    status: 'running',
    startedAt,
    task,
    inputHash: hash(task),
    source,
    kit: { hash: hash(kitFiles), files: kitFiles },
    nodeVersion: process.version,
    config: { ...options, provider, kit, model: options.model, limits: freyaRecipe.limits },
    calls: generator.calls,
    usage: null,
    modelCallPurpose:
      'Generate one workflow blueprint directly from original brief(s), OpenAPI, and verified platform documentation.',
    stages: [],
    evaluation: { score: null, source: 'not-evaluated' },
  };
  const save = () => {
    // Recomputed on every save: the generator keeps filling its call list, and a
    // record written before the call completes must not report usage.
    record.usage = usageOf(generator.calls, options.model);
    writeFile(path, bridge.redact(JSON.stringify(record, null, 2)) + '\n', { mode: 0o600 });
  };
  const signal = AbortSignal.timeout(options.timeoutMs);
  const remaining = () => Math.max(1, options.timeoutMs - Math.round(performance.now() - started));
  const invoke = (action: string, data: Record<string, unknown>) =>
    bridge.call(action, data, signal, remaining());
  async function stage<T>(name: string, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const entry: Record<string, unknown> = {
      name,
      startedAt: new Date().toISOString(),
      status: 'running',
    };
    record.stages.push(entry);
    await save();
    console.error(`[freya] ${name}`);
    try {
      const result = await operation();
      entry.status = 'completed';
      record[name] = result;
      return result;
    } catch (error) {
      entry.status = 'failed';
      throw error;
    } finally {
      entry.endedAt = new Date().toISOString();
      await save();
    }
  }
  await save();
  try {
    const workspace = await stage('workspace', () => invoke('probe', {}));
    // Never silently choose the first workspace; the bridge verifies one explicit or unique workspace.
    bridge.env = { ...process.env, FREYA_WORKSPACE_ID: workspace.workspaceId };
    const stateRoot = resolve(options.out, 'freya-state', workspace.workspaceId);
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    // Exclusive slot lock avoids two runs racing to create duplicate workflows or update during tests.
    const lock = join(stateRoot, 'workspace.lock');
    const { open, unlink } = await import('node:fs/promises');
    const handle = await open(lock, 'wx', 0o600).catch(() => {
      throw new Error(
        `Workspace is locked by another run. Inspect ${lock} before removing a stale lock.`,
      );
    });
    await handle.writeFile(JSON.stringify({ pid: process.pid, run: path }));
    await handle.close();
    try {
      const result = await freyaRecipe.run(task, {
        generate: (input) =>
          stage('candidate', () =>
            generator.generate(
              input,
              AbortSignal.any([
                signal,
                AbortSignal.timeout(freyaRecipe.limits.generationTimeoutMs),
              ]),
            ),
          ),
        compile: async (input, candidate) =>
          stage('workflow', async () => {
            const workflow = compileWorkflow(input, parseWorkflowCandidate(candidate));
            await writeFile(
              join(directory, 'compiled.workflow.json'),
              JSON.stringify(workflow, null, 2) + '\n',
              { mode: 0o600 },
            );
            return workflow;
          }),
        validate: (workflow) =>
          stage('validation', () => invoke('validate', { slot: options.slot, workflow })),
        register: (workflow) =>
          stage<Registration>('registration', () =>
            invoke('register', {
              slot: options.slot,
              workflow,
              stateFile: join(stateRoot, 'slots.json'),
            }),
          ),
        export: (registration) =>
          stage('export', () =>
            invoke('export', {
              workflowId: registration.workflow_id,
              path: join(directory, 'exported.workflow.json'),
            }),
          ),
        evaluate: (registration) =>
          stage<PracticeResult>('practice', () =>
            invoke('practice', {
              agentId: registration.agent_id,
              casesPath,
              cacheDir: join(stateRoot, 'practice'),
              path: join(directory, 'practice.json'),
              brief: options.brief,
              only: options.only,
              style: options.style,
            }),
          ),
      });
      record.evaluation = {
        score: result.evaluation.passed / result.evaluation.total,
        source: 'official-practice',
        passed: result.evaluation.passed,
        total: result.evaluation.total,
        repetitions: 1,
        details:
          'Original event runner: bank ledger + conversation judge. One practice run, not the final three-run benchmark.',
      };
      record.status = 'completed';
    } finally {
      await unlink(lock);
    }
  } catch (error) {
    record.status = 'failed';
    record.error = bridge.redact(
      signal.aborted
        ? 'End-to-end deadline exceeded.'
        : error instanceof Error
          ? error.message
          : 'Freya run failed.',
    );
  } finally {
    record.endedAt = new Date().toISOString();
    record.elapsedMs = Math.round(performance.now() - started);
    await save();
  }
  return { status: record.status, path, ...(record.error ? { error: record.error } : {}) };
}
