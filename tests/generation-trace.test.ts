// Synthetic offline streams: diagnostic checks, not agent benchmark scores.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGenerationTrace } from '../src/generation-trace.ts';
import type { CallRecord } from '../src/providers.ts';
import { loadRun, readRunFile } from '../src/ui/records.ts';

test('keeps long streams out of logs and preserves redacted partial output on failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'compact-trace-'));
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-trace-secret';
  try {
    const trace = await createGenerationTrace(root, { model: 'synthetic-model' }, 'synthetic');
    const call: CallRecord = {
      endpoint: 'responses',
      baseUrl: 'https://example.invalid',
      elapsedMs: 0,
    };
    trace.call(call);
    call.request = { prompt: 'original input', key: process.env.OPENAI_API_KEY };
    trace.call(call);
    for (let i = 0; i < 5000; i++) {
      trace.model({ kind: 'draft', text: 'word ' });
    }
    trace.model({ kind: 'draft', text: 'synthetic-trace-' });
    trace.model({ kind: 'draft', text: 'secret' });
    // A running artifact is readable before finalization.
    assert.ok(
      (await readFile(join(trace.directory, 'model-draft.txt'), 'utf8')).startsWith('word '),
    );
    call.error = 'synthetic interrupted transport';
    call.elapsedMs = 1200;
    trace.call(call);
    trace.finish(new Error(call.error));
    const events = (await readFile(join(trace.directory, 'trace.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(events.filter((entry) => entry.kind === 'model-call-started').length, 1);
    assert.ok(events.length < 10);
    assert.ok(JSON.stringify(events).length < 4000);
    assert.equal(JSON.stringify(events).includes('original input'), false);
    const draft = await readRunFile(root, 'generation~synthetic', 'model-draft.txt');
    assert.equal(draft, 'word '.repeat(5000) + '[REDACTED]');
    const log = await readFile(join(trace.directory, 'generation.log'), 'utf8');
    assert.match(log, /interrupted transport/);
    assert.equal(log.includes('word '), false);
    const run = JSON.parse(await readFile(join(trace.directory, 'run.json'), 'utf8'));
    assert.equal(run.calls[0].request.prompt, 'original input');
    assert.equal(run.calls[0].request.key, '[REDACTED]');
    const detail = await loadRun(root, 'generation~synthetic');
    assert.ok(detail?.trace.some((entry) => entry.summary.includes('25022 characters received')));
    assert.ok(detail?.trace.some((entry) => entry.summary.includes('interrupted transport')));
  } finally {
    if (previous === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previous;
    }
    await rm(root, { recursive: true, force: true });
  }
});
