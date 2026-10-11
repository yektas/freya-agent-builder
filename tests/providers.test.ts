import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockGenerator, OpenAIGenerator } from '../src/providers.ts';
import { parseTask } from '../src/validation.ts';
import { recipe } from '../src/recipe.ts';
import type { ModelEvent } from '../src/providers.ts';

const task = parseTask({ id: 'test', description: 'Use only supplied facts.', tools: [] });
const candidate = await new MockGenerator().generate(task);
const signal = () => AbortSignal.timeout(1000);
const completed = (
  value: unknown,
  usage = {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 10 },
    output_tokens: 50,
    output_tokens_details: { reasoning_tokens: 20 },
  },
) => ({
  id: 'resp_test',
  object: 'response',
  created_at: 1,
  status: 'completed',
  model: 'gpt-6-astra',
  output: [
    { type: 'reasoning', id: 'reasoning_1', summary: [] },
    {
      type: 'message',
      id: 'message_1',
      role: 'assistant',
      content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }],
    },
  ],
  usage,
});
const response = (body: unknown) => Response.json(body);
const baseDefinition = {
  instructions: recipe.instructions,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { systemPrompt: { type: 'string' } },
    required: ['systemPrompt'],
  },
  maxOutputTokens: 6000,
  maxCalls: 1,
};
const inputText = (body: Record<string, unknown>) => {
  const input = body.input;
  assert.ok(Array.isArray(input));
  const text = input.flatMap((message) => {
    if (!message || typeof message !== 'object' || !('content' in message)) {
      return [];
    }
    const content = message.content;
    return Array.isArray(content)
      ? content.flatMap((part) =>
          part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'
            ? [part.text]
            : [],
        )
      : [];
  });
  return text.join('');
};

test('AI SDK Responses generation preserves task input and captures the provider request', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const generator = new OpenAIGenerator(
    'test-key',
    'gpt-6-astra',
    async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-key');
      assert.equal(init?.redirect, 'error');
      requestBody = JSON.parse(String(init?.body));
      return response(completed(candidate));
    },
    baseDefinition,
  );

  assert.deepEqual(await generator.generate(task, signal()), candidate);
  assert.ok(requestBody);
  assert.deepEqual(JSON.parse(inputText(requestBody)), { task });
  assert.equal(requestBody.model, 'gpt-6-astra');
  assert.equal(requestBody.instructions, recipe.instructions);
  assert.equal(requestBody.max_output_tokens, 6000);
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.stream, undefined);
  assert.equal((requestBody.text as { format?: { strict?: boolean } }).format?.strict, true);
  assert.deepEqual(generator.calls[0].request, requestBody);
  assert.deepEqual(generator.calls[0].response, completed(candidate));
  assert.equal(generator.calls[0].usage?.cachedInputTokens, 10);
  assert.equal(JSON.stringify(generator.calls).includes('test-key'), false);
});

test('custom Responses base URLs are supported and credentials stay out of records', async () => {
  const generator = new OpenAIGenerator(
    'synthetic-lb-key',
    'gpt-6-astra',
    async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:2455/v1/responses');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-lb-key');
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(JSON.parse(inputText(body)), { task });
      assert.equal(init?.redirect, 'error');
      return response(completed(candidate));
    },
    baseDefinition,
    'http://127.0.0.1:2455/v1/',
  );
  assert.deepEqual(await generator.generate(task, signal()), candidate);
  assert.equal(generator.calls[0].baseUrl, 'http://127.0.0.1:2455/v1');
  assert.equal(JSON.stringify(generator.calls).includes('synthetic-lb-key'), false);
});

test('Responses base URLs refuse credentials and non-HTTP schemes', () => {
  for (const url of [
    'file:///tmp/private',
    'http://user:password@localhost/v1',
    'http://localhost/v1?key=secret',
    'not a URL',
  ]) {
    assert.throws(
      () => new OpenAIGenerator('synthetic', 'synthetic', fetch, baseDefinition, url),
      /OPENAI_BASE_URL/,
    );
  }
});

test('failed API calls count against the budget and the SDK does not retry', async () => {
  let calls = 0;
  const generator = new OpenAIGenerator(
    'test-key',
    'gpt-6-astra',
    async () => {
      calls++;
      return new Response(
        JSON.stringify({ error: { message: 'private test-key response text' } }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    },
    baseDefinition,
  );
  await assert.rejects(generator.generate(task, signal()), /Responses API HTTP 429/);
  await assert.rejects(generator.generate(task, signal()), /budget exhausted/);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(generator.calls).includes('test-key'), false);
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
const streamDefinition = (events: ModelEvent[]) => ({
  ...baseDefinition,
  reasoningSummary: true,
  onEvent: (event: ModelEvent) => events.push(event),
});
const createdEvent = {
  type: 'response.created',
  response: { id: 'resp_test', created_at: 1, model: 'gpt-6-astra' },
};
const finalText = JSON.stringify(candidate);

test('AI SDK streaming preserves public summaries and draft events without exposing private reasoning', async () => {
  const events: ModelEvent[] = [];
  const final = completed(candidate);
  const generator = new OpenAIGenerator(
    'test-key',
    'gpt-6-astra',
    async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.stream, true);
      assert.deepEqual(request.reasoning, { summary: 'auto' });
      return sseResponse(
        [
          createdEvent,
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'reasoning', id: 'reasoning_1' },
          },
          {
            type: 'response.output_item.added',
            output_index: 1,
            item: { type: 'message', id: 'message_1', phase: 'final_answer' },
          },
          {
            type: 'response.reasoning_summary_part.added',
            item_id: 'reasoning_1',
            output_index: 0,
            summary_index: 0,
            part: { type: 'summary_text', text: '' },
          },
          { type: 'response.reasoning_text.delta', delta: 'PRIVATE_DO_NOT_DISPLAY' },
          {
            type: 'response.reasoning_summary_text.delta',
            item_id: 'reasoning_1',
            output_index: 0,
            summary_index: 0,
            delta: 'Public summary ✓ test-key',
          },
          {
            type: 'response.output_text.delta',
            item_id: 'message_1',
            output_index: 1,
            delta: finalText,
          },
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
  assert.equal(
    events.find((event) => event.kind === 'summary')?.text,
    'Public summary ✓ [REDACTED]',
  );
  assert.equal(JSON.stringify(events).includes('PRIVATE_DO_NOT_DISPLAY'), false);
});

test('truncated and refused streams never accept a candidate or retry', async () => {
  for (const [stream, expected] of [
    [
      [
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', id: 'message_1', phase: 'final_answer' },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'message_1',
          output_index: 0,
          delta: finalText,
        },
      ],
      /ended before/,
    ],
    [[{ type: 'response.refusal.delta', item_id: 'message_1', delta: 'no' }], /refused/],
  ] as const) {
    const generator = new OpenAIGenerator(
      'test-key',
      'gpt-6-astra',
      async () => sseResponse([...stream]),
      streamDefinition([]),
    );
    await assert.rejects(generator.generate(task, signal()), expected);
    assert.equal(generator.calls.length, 1);
    await assert.rejects(generator.generate(task, signal()), /budget exhausted/);
  }
});

test('the AI SDK propagates an idle request deadline to the fetch transport', async () => {
  let cancelled = false;
  let fetchStarted = () => {};
  const started = new Promise<void>((resolve) => {
    fetchStarted = resolve;
  });
  const generator = new OpenAIGenerator(
    'test-key',
    'gpt-6-astra',
    async (_url, init) => {
      fetchStarted();
      const requestSignal = init?.signal;
      assert.ok(requestSignal);
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          cancelled = true;
          reject(requestSignal.reason);
        };
        requestSignal.addEventListener('abort', abort, { once: true });
        if (requestSignal.aborted) {
          abort();
        }
      });
    },
    streamDefinition([]),
  );
  const controller = new AbortController();
  const pending = generator.generate(task, controller.signal);
  await started;
  const timer = setTimeout(() => controller.abort(new Error('synthetic deadline')), 20);
  try {
    await assert.rejects(pending, /synthetic deadline/);
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(timer);
  }
});

test('incomplete streamed responses report their reason and usage without accepting partial JSON', async () => {
  const events: ModelEvent[] = [];
  const incomplete = {
    ...completed(candidate, {
      input_tokens: 32423,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 12000,
      output_tokens_details: { reasoning_tokens: 5024 },
    }),
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
  };
  const generator = new OpenAIGenerator(
    'test-key',
    'gpt-6-astra',
    async () =>
      sseResponse([
        createdEvent,
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', id: 'message_1', phase: 'final_answer' },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'message_1',
          output_index: 0,
          delta: finalText,
        },
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
});

test('reasoning effort and summary options are passed through the OpenAI Responses provider', async () => {
  for (const reasoningSummary of [false, true]) {
    const generator = new OpenAIGenerator(
      'test-key',
      'gpt-6-astra',
      async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(
          body.reasoning,
          reasoningSummary ? { effort: 'high', summary: 'auto' } : { effort: 'high' },
        );
        return response(completed(candidate));
      },
      {
        ...baseDefinition,
        reasoningEffort: 'high',
        reasoningSummary,
      },
    );
    await generator.generate(task, signal());
  }
});
