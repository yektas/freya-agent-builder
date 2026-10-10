// Per-run diagnostics. Every event is appended immediately so interrupted runs retain partial output.
import { mkdir } from 'node:fs/promises';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ModelEvent, CallRecord } from './providers.ts';

export async function createGenerationTrace(root: string, config: unknown) {
  const runId = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
  const directory = resolve(root, 'generation', runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const started = performance.now();
  const record: Record<string, unknown> = {
    kind: 'generation-only',
    runId,
    status: 'running',
    startedAt: new Date().toISOString(),
    config,
    nodeVersion: process.version,
    calls: [],
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
      event('model-event', value);
      if (value.text) {
        log(`\n[model ${value.kind}] ${value.text}\n`);
      }
    },
    call(value: CallRecord) {
      // Persist before transport starts and again on completion/failure.
      record.calls = [structuredClone(value)];
      event(
        value.error
          ? 'model-call-failed'
          : value.response
            ? 'model-call-completed'
            : 'model-call-started',
        value,
      );
      save();
    },
    finish(error?: unknown) {
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
