import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { CodexGenerator, createLiveGenerator, liveProvider } from '../src/codex.ts';
import { recipe } from '../src/recipe.ts';
import { candidateSchema } from '../src/validation.ts';
import { MockGenerator, OpenAIGenerator, parseReasoningEffort } from '../src/providers.ts';
import type { Task } from '../src/contracts.ts';

const task: Task = {
  id: 'synthetic',
  description: 'Synthetic provider fixture',
  tools: [],
  extraOriginalField: { kept: true },
};
const definition = {
  instructions: recipe.instructions,
  schema: candidateSchema,
  maxCalls: 1,
  maxOutputTokens: 1000,
};
const events = (candidate: unknown) =>
  [
    { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'reasoning', text: 'PRIVATE_SYNTHETIC_REASONING' } },
    { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(candidate) } },
    { type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 30 } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');

test('Codex uses isolated schema generation with original inputs, sanitized env and completion-only records', async () => {
  const candidate = await new MockGenerator().generate(task);
  let directory = '';
  const observed: unknown[] = [];
  const generator = new CodexGenerator(
    'synthetic-model',
    { ...definition, onEvent: (event) => observed.push(event) },
    async (invocation) => {
      directory = invocation.cwd;
      assert.match(invocation.input, /extraOriginalField/);
      assert.match(invocation.input, /Synthetic provider fixture/);
      assert.equal(invocation.args.includes('--ignore-user-config'), false);
      assert.equal(invocation.args.includes('--ignore-rules'), true);
      assert.equal(invocation.args.includes('mcp_servers={}'), true);
      assert.equal(
        invocation.args.some((arg) => arg.startsWith('model_reasoning_effort=')),
        false,
      );
      assert.equal(
        invocation.args.some((arg) => arg.startsWith('forced_login_method=')),
        false,
      );
      assert.equal(
        invocation.args.some((arg) => arg.startsWith('model_provider=')),
        false,
      );
      assert.equal(invocation.args.includes('read-only'), true);
      assert.equal(invocation.args.includes('features.shell_tool=false'), true);
      assert.equal(
        Object.keys(invocation.env).some((key) => /API_KEY|TOKEN|SECRET|FREYA_|OPENAI_/.test(key)),
        false,
      );
      const schemaPath = invocation.args[invocation.args.indexOf('--output-schema') + 1];
      assert.deepEqual(JSON.parse(await readFile(schemaPath, 'utf8')), candidateSchema);
      return events(candidate);
    },
  );
  assert.deepEqual(await generator.generate(task, AbortSignal.timeout(1000)), candidate);
  assert.equal(generator.calls.length, 1);
  assert.equal(generator.calls[0].endpoint, 'codex-exec');
  assert.equal(JSON.stringify(generator.calls).includes('PRIVATE_SYNTHETIC_REASONING'), false);
  assert.equal(JSON.stringify(observed).includes('PRIVATE_SYNTHETIC_REASONING'), false);
  await assert.rejects(access(directory));
  await assert.rejects(generator.generate(task, AbortSignal.timeout(1000)), /budget exhausted/);
});

for (const [name, output] of [
  [
    'partial JSON',
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{}' } }),
  ],
  ['failed turn', events({}) + '\n' + JSON.stringify({ type: 'turn.failed' })],
  [
    'tool use',
    events({}) +
      '\n' +
      JSON.stringify({ type: 'item.completed', item: { type: 'command_execution' } }),
  ],
  ['malformed event', 'not JSON'],
]) {
  test(`Codex rejects ${name} without retry or API fallback`, async () => {
    let calls = 0;
    const generator = new CodexGenerator('synthetic', definition, async () => {
      calls++;
      return output;
    });
    await assert.rejects(generator.generate(task, AbortSignal.timeout(1000)), /No API fallback/);
    assert.equal(calls, 1);
    assert.equal(generator.calls[0].response, undefined);
  });
}

test('Codex refuses cancelled calls before transport and rejects late completion', async () => {
  let calls = 0;
  const controller = new AbortController();
  const generator = new CodexGenerator('synthetic', definition, async () => {
    calls++;
    controller.abort();
    return events({});
  });
  await assert.rejects(generator.generate(task, controller.signal), /deadline exceeded/);
  assert.equal(calls, 1);
  const cancelled = new CodexGenerator('synthetic', definition, async () => {
    calls++;
    return events({});
  });
  await assert.rejects(cancelled.generate(task, controller.signal));
  assert.equal(calls, 1);
});

test('provider selection preserves API transport and rejects unsupported configuration', () => {
  const previous = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = 'synthetic';
    assert.ok(createLiveGenerator('openai', 'synthetic') instanceof OpenAIGenerator);
    delete process.env.OPENAI_API_KEY;
    assert.ok(createLiveGenerator('codex', 'synthetic') instanceof CodexGenerator);
    assert.throws(() => createLiveGenerator('openai', 'synthetic'), /OPENAI_API_KEY/);
    assert.throws(() => liveProvider('typo'), /provider must/);
    assert.throws(
      () => new CodexGenerator('synthetic', { ...definition, reasoningSummary: true }),
      /requires provider openai/,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previous;
    }
  }
});

test('Codex forwards configured effort and records it', async () => {
  const candidate = await new MockGenerator().generate(task);
  const generator = new CodexGenerator(
    'synthetic',
    { ...definition, reasoningEffort: 'high' },
    async (invocation) => {
      assert.ok(invocation.args.includes('model_reasoning_effort="high"'));
      return events(candidate);
    },
  );
  await generator.generate(task, AbortSignal.timeout(1000));
  assert.equal((generator.calls[0].request as Record<string, unknown>).reasoningEffort, 'high');
});

test('Codex reports events before the transport exits and hides private reasoning', async () => {
  const candidate = await new MockGenerator().generate(task);
  const observed: string[] = [];
  const generator = new CodexGenerator(
    'synthetic',
    { ...definition, onEvent: (event) => observed.push(event.kind) },
    async (invocation) => {
      const lines = events(candidate).split('\n');
      for (const line of lines) {
        invocation.onLine?.(line);
      }
      assert.deepEqual(observed, ['accepted', 'reasoning', 'draft', 'completed']);
      return lines.join('\n');
    },
  );
  assert.deepEqual(await generator.generate(task, AbortSignal.timeout(1000)), candidate);
  assert.deepEqual(observed, ['accepted', 'reasoning', 'draft', 'completed']);
});

test('Codex reports a safe provider error without exposing raw diagnostics', async () => {
  const generator = new CodexGenerator('synthetic', definition, async () =>
    JSON.stringify({
      type: 'turn.failed',
      error: { message: 'Model not supported. Authorization: PRIVATE_SYNTHETIC_TOKEN' },
    }),
  );
  await assert.rejects(
    generator.generate(task, AbortSignal.timeout(1000)),
    /cannot access the selected model/,
  );
  assert.equal(JSON.stringify(generator.calls).includes('PRIVATE_SYNTHETIC_TOKEN'), false);
});

test('Codex connection retry events remain visible and permit a completed turn', async () => {
  const observed: unknown[] = [];
  const candidate = await new MockGenerator().generate(task);
  const generator = new CodexGenerator(
    'synthetic',
    { ...definition, onEvent: (event) => observed.push(event) },
    async () =>
      JSON.stringify({ type: 'error', message: 'Reconnecting 1/5. PRIVATE_SYNTHETIC_TOKEN' }) +
      '\n' +
      events(candidate),
  );
  assert.deepEqual(await generator.generate(task, AbortSignal.timeout(1000)), candidate);
  assert.deepEqual(observed[0], {
    kind: 'status',
    reason: 'Codex connection interrupted; the CLI may be retrying.',
  });
  assert.equal(JSON.stringify(observed).includes('PRIVATE_SYNTHETIC_TOKEN'), false);
});

test('reasoning effort validation rejects typos and API-only incompatibilities', () => {
  assert.equal(parseReasoningEffort(undefined), undefined);
  assert.equal(parseReasoningEffort(''), undefined);
  assert.equal(parseReasoningEffort('none'), 'none');
  assert.equal(parseReasoningEffort('ultra'), 'ultra');
  assert.throws(() => parseReasoningEffort('hgh'), /reasoning-effort must/);
  assert.throws(
    () =>
      new OpenAIGenerator('synthetic', 'synthetic', fetch, {
        ...definition,
        reasoningEffort: 'ultra',
      }),
    /only by the codex provider/,
  );
});
