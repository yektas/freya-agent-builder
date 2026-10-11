// Per-run diagnostics. Every event is appended immediately so interrupted runs retain partial output.
import { mkdir } from 'node:fs/promises';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ModelEvent, CallRecord } from './providers.ts';
import { estimateCost, hasUsage, sumUsage } from './usage.ts';

export function newGenerationRunId(): string {
  return `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
}

// The caller may supply the id so a run started from the inspector is addressable
// before its first model call returns. It is a single path segment and is
// rejected otherwise, because it becomes a directory name.
export async function createGenerationTrace(root: string, config: unknown, runId?: string) {
  const id = runId ?? newGenerationRunId();
  if (!/^[\w.+-]+$/.test(id)) {
    throw new Error('Generation run ids may contain only letters, digits, _, ., +, and -.');
  }
  const directory = resolve(root, 'generation', id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const started = performance.now();
  const record: Record<string, unknown> = {
    kind: 'generation-only',
    runId: id,
    status: 'running',
    startedAt: new Date().toISOString(),
    config,
    nodeVersion: process.version,
    calls: [],
    usage: null,
    evaluation: { score: null, source: 'not-evaluated' },
  };
  const secrets = ['OPENAI_API_KEY', 'FREYA_API_KEY', 'FREYA_BANK_TEAM_KEY']
    .map((name) => process.env[name])
    .filter((value): value is string => !!value);
  function clean(value: unknown): unknown {
    if (typeof value === 'string') {
      for (const secret of secrets) {
        value = (value as string).replaceAll(secret, '[REDACTED]');
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(clean);
    }
    if (value && typeof value === 'object') {
      const data = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(data)
          .filter(
            ([key]) =>
              !['authorization', 'x-team-key', 'apikey', 'api_key', 'encrypted_content'].includes(
                key.toLowerCase(),
              ) && !(data.type === 'reasoning' && key === 'content'),
          )
          .map(([key, item]) => [key, clean(item)]),
      );
    }
    return value;
  }
  const save = () =>
    writeFileSync(join(directory, 'run.json'), JSON.stringify(clean(record), null, 2) + '\n', {
      mode: 0o600,
    });
  // Each call announces itself before and after transport, so usage is summed
  // from the distinct call objects rather than added twice per announcement.
  const metered = new Set<CallRecord>();
  const announced = new WeakSet<CallRecord>();
  const model = () =>
    typeof (config as { model?: unknown } | null)?.model === 'string'
      ? (config as { model: string }).model
      : null;
  function usageOf(calls: Iterable<CallRecord>) {
    for (const call of calls) {
      if (call.usage) {
        metered.add(call);
      }
    }
    const tokens = sumUsage([...metered].map((call) => call.usage));
    if (!hasUsage(tokens)) {
      return null;
    }
    return { tokens, cost: estimateCost(tokens, model()) };
  }
  function event(kind: string, data: unknown) {
    appendFileSync(
      join(directory, 'trace.jsonl'),
      JSON.stringify(
        clean({
          at: new Date().toISOString(),
          elapsedMs: Math.round(performance.now() - started),
          kind,
          data,
        }),
      ) + '\n',
      { mode: 0o600 },
    );
  }
  function log(message: string) {
    appendFileSync(join(directory, 'generation.log'), String(clean(message)), { mode: 0o600 });
  }
  // A first-class artifact beside the trace, so a reviewer can read one deliverable
  // without unpacking the run record that also embeds the event kit and sources.
  function artifact(name: string, value: unknown) {
    writeFileSync(join(directory, name), JSON.stringify(clean(value), null, 2) + '\n', {
      mode: 0o600,
    });
  }
  const streams = new Map<string, { chars: number; pending: string; file: string }>();
  // Retain a short tail so credentials split across transport fragments are redacted.
  const tailLength = Math.max(0, ...secrets.map((secret) => secret.length - 1));
  function flushStream(stream: { pending: string; file: string }, final = false) {
    const sanitized = String(clean(stream.pending));
    const count = final ? sanitized.length : Math.max(0, sanitized.length - tailLength);
    if (count) {
      appendFileSync(join(directory, stream.file), sanitized.slice(0, count), { mode: 0o600 });
    }
    stream.pending = sanitized.slice(count);
  }
  event('start', config);
  save();
  return {
    directory,
    log,
    event,
    artifact,
    update(data: Record<string, unknown>) {
      Object.assign(record, data);
      save();
    },
    model(value: ModelEvent) {
      if ((value.kind === 'draft' || value.kind === 'summary') && value.text) {
        let stream = streams.get(value.kind);
        if (!stream) {
          stream = { chars: 0, pending: '', file: `model-${value.kind}.txt` };
          streams.set(value.kind, stream);
          event('model-stream-started', { kind: value.kind, artifact: stream.file });
        }
        stream.chars += value.text.length;
        stream.pending += value.text;
        flushStream(stream);
        return;
      }
      event('model-event', value);
    },
    call(value: CallRecord) {
      // Persist before transport starts and again on completion/failure.
      record.calls = [structuredClone(value)];
      record.usage = usageOf([value]);
      if (!value.error && !value.response && announced.has(value)) {
        save();
        return;
      }
      announced.add(value);
      event(
        value.error
          ? 'model-call-failed'
          : value.response
            ? 'model-call-completed'
            : 'model-call-started',
        {
          endpoint: value.endpoint,
          elapsedMs: value.elapsedMs,
          usage: value.usage,
          error: value.error,
          details: 'run.json',
        },
      );
      save();
    },
    finish(error?: unknown) {
      for (const [kind, stream] of streams) {
        flushStream(stream, true);
        event('model-stream-ended', { kind, chars: stream.chars, artifact: stream.file });
      }
      record.status = error ? 'failed' : 'completed';
      if (error) {
        const failure =
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) };
        record.error = failure;
        event('error', failure);
        log(`\n[error] ${failure.message}\n`);
      }
      record.endedAt = new Date().toISOString();
      record.elapsedMs = Math.round(performance.now() - started);
      event('end', { status: record.status });
      save();
    },
  };
}
