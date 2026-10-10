import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockGenerator, OpenAIGenerator, responseJSON } from '../src/providers.ts';
import { parseTask } from '../src/validation.ts';
import { recipe } from '../src/recipe.ts';

const task = parseTask({ id: 'test', description: 'Use only supplied facts.', tools: [] });
const candidate = await new MockGenerator().generate(task);
const signal = () => AbortSignal.timeout(1000);
const completed = (value: unknown) => ({
  status: 'completed',
  output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
  ],
});
const transport =
  (handler: (body: Record<string, any>) => unknown): typeof fetch =>
  async (_url, init) =>
    Response.json(handler(JSON.parse(init!.body as string)));

test('reads REST output arrays rather than SDK-only output_text convenience property', () => {
  assert.deepEqual(responseJSON(completed(candidate)), candidate);
  assert.throws(
    () => responseJSON({ ...completed(candidate), status: 'incomplete' }),
    /did not complete/,
  );
  assert.throws(
    () =>
      responseJSON({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal' }] }],
      }),
    /refused/,
  );
  assert.throws(() => responseJSON({ status: 'completed', output: [] }), /no output/);
});

test('direct generation keeps original input; source tool schemas are never regenerated', async () => {
  const bodies: Record<string, any>[] = [];
  const generator = new OpenAIGenerator(
    'test-key',
    'configured-model',
    transport((body) => {
      bodies.push(body);
      return completed(candidate);
    }),
  );
  await generator.generate(task, signal());
  assert.equal(bodies.length, 1);
  assert.deepEqual(JSON.parse(bodies[0].input).task, task);
  assert.equal(bodies[0].instructions, recipe.instructions);
  assert.equal(bodies[0].max_output_tokens, recipe.limits.maxOutputTokens);
  assert.equal(bodies[0].text.format.strict, true);
  assert.equal(bodies[0].store, false);
  assert.equal(JSON.stringify(generator.calls).includes('test-key'), false);
});

test('call budget counts failed requests and never transparently retries', async () => {
  let calls = 0;
  const generator = new OpenAIGenerator('test-key', 'configured-model', async () => {
    calls++;
    return new Response('secret test-key', { status: 429 });
  });
  await assert.rejects(generator.generate(task, signal()), /HTTP 429/);
  await assert.rejects(generator.generate(task, signal()), /budget exhausted/);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(generator.calls).includes('test-key'), false);
});

const streamDefinition = (events: import('../src/providers.ts').ModelEvent[]) => ({
  instructions: recipe.instructions,
  schema: {},
  maxOutputTokens: 6000,
  maxCalls: 1,
  onEvent: (event: import('../src/providers.ts').ModelEvent) => {
    events.push(event);
  },
  reasoningSummary: true,
});
const sseResponse = (events: unknown[], fragment = false) => {
  const bytes = new TextEncoder().encode(
    ': keepalive\r\n\r\n' +
      events.map((event) => 'data: ' + JSON.stringify(event) + '\r\n\r\n').join(''),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        if (fragment) {
          for (const byte of bytes) {
            controller.enqueue(Uint8Array.of(byte));
          }
        } else {
          controller.enqueue(bytes);
        }
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
};

test('fragmented streaming shows only public summaries and draft events, and retains the completed response', async () => {
  const events: import('../src/providers.ts').ModelEvent[] = [];
  const final = completed(candidate);
  const generator = new OpenAIGenerator(
    'test-key',
    'configured-model',
    async (_url, init) => {
      const request = JSON.parse(init!.body as string);
      assert.equal(request.stream, true);
      assert.deepEqual(request.reasoning, { summary: 'auto' });
      return sseResponse(
        [
          { type: 'response.created' },
          { type: 'response.output_item.added', item: { type: 'reasoning' } },
          { type: 'response.reasoning_text.delta', delta: 'PRIVATE_DO_NOT_DISPLAY' },
          { type: 'response.reasoning_summary_text.delta', delta: 'Public summary ✓ test-key' },
          { type: 'response.output_text.delta', delta: '{"draft":' },
          { type: 'response.completed', response: final },
        ],
        true,
      );
    },
    streamDefinition(events),
  );
  assert.deepEqual(await generator.generate(task, signal()), candidate);
  assert.deepEqual(generator.calls[0].response, final);
  assert.deepEqual(
    events.map((event) => event.kind),
    ['accepted', 'reasoning', 'summary', 'draft', 'completed'],
  );
  assert.equal(events[2].text, 'Public summary ✓ [REDACTED]');
  assert.equal(JSON.stringify(events).includes('PRIVATE_DO_NOT_DISPLAY'), false);
});

test('truncated, failed, and refused streams never accept a candidate or retry', async () => {
  for (const [stream, expected] of [
    [[{ type: 'response.output_text.delta', delta: JSON.stringify(candidate) }], /ended before/],
    [[{ type: 'response.failed', response: { status: 'failed', output: [] } }], /did not complete/],
    [[{ type: 'response.refusal.delta', delta: 'no' }], /refused/],
  ] as const) {
    const generator = new OpenAIGenerator(
      'test-key',
      'configured-model',
      async () => sseResponse([...stream]),
      streamDefinition([]),
    );
    await assert.rejects(generator.generate(task, signal()), expected);
    assert.equal(generator.calls.length, 1);
    await assert.rejects(generator.generate(task, signal()), /budget exhausted/);
  }
});

test('an idle injected stream is cancelled by the deadline', async () => {
  let cancelled = false;
  const generator = new OpenAIGenerator(
    'test-key',
    'configured-model',
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    streamDefinition([]),
  );
  // AbortSignal.timeout has an unreferenced timer; keep a real timer for this isolated test.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('synthetic deadline')), 20);
  try {
    await assert.rejects(generator.generate(task, controller.signal), /synthetic deadline/);
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(timer);
  }
});

test('token-limited streamed responses expose the cause and usage without accepting partial JSON or retrying', async () => {
  const events: import('../src/providers.ts').ModelEvent[] = [];
  // Synthetic reproduction of the captured Brief A failure, including its token accounting.
  const incomplete = {
    ...completed(candidate),
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    usage: {
      input_tokens: 32423,
      output_tokens: 12000,
      output_tokens_details: { reasoning_tokens: 5024 },
    },
  };
  const generator = new OpenAIGenerator(
    'test-key',
    'configured-model',
    async () =>
      sseResponse([
        { type: 'response.output_text.delta', delta: JSON.stringify(candidate) },
        { type: 'response.incomplete', response: incomplete },
      ]),
    streamDefinition(events),
  );
  await assert.rejects(generator.generate(task, signal()), /max_output_tokens.*12000.*5024/);
  assert.deepEqual(generator.calls[0].response, incomplete);
  assert.deepEqual(events.at(-1), {
    kind: 'incomplete',
    reason: 'max_output_tokens',
    usage: incomplete.usage,
  });
  await assert.rejects(generator.generate(task, signal()), /budget exhausted/);
  assert.equal(generator.calls.length, 1);
});
