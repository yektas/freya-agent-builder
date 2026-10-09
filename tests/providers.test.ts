import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DecisionsAuditor,
  MockGenerator,
  OpenAIClient,
  OpenAIGenerator,
  responseJSON,
} from '../src/providers.ts';
import { AUDIT_QUESTIONS } from '../src/prompts.ts';
import { parseTask } from '../src/validation.ts';

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

test('planned generation keeps original input; source tool schemas are never regenerated', async () => {
  const bodies: Record<string, any>[] = [];
  const client = new OpenAIClient(
    'test-key',
    3,
    transport((body) => {
      bodies.push(body);
      return completed(
        bodies.length === 1
          ? { requirements: [], prerequisites: [], uncertainties: [] }
          : candidate,
      );
    }),
  );
  await new OpenAIGenerator(client, 'configured-model').generate(task, 'planned', signal());
  assert.equal(bodies.length, 2);
  assert.deepEqual(JSON.parse(bodies[1].input).task, task);
  assert.equal(bodies[1].text.format.strict, true);
  assert.equal(bodies[1].store, false);
  assert.equal(JSON.stringify(client.calls).includes('test-key'), false);
});

test('call budget counts failed requests and never transparently retries', async () => {
  let calls = 0;
  const client = new OpenAIClient('test-key', 1, async () => {
    calls++;
    return new Response('secret test-key', { status: 429 });
  });
  await assert.rejects(client.post('responses', {}, signal()), /HTTP 429/);
  await assert.rejects(client.post('responses', {}, signal()), /budget exhausted/);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(client.calls).includes('test-key'), false);
});

test('Decisions answers map by unique name, not response order', async () => {
  const answers = AUDIT_QUESTIONS.map((q) => ({
    name: q.name,
    type: 'predicate',
    probability: 0.25,
  })).reverse();
  const client = new OpenAIClient(
    'test-key',
    1,
    transport(() => ({ answers })),
  );
  const findings = await new DecisionsAuditor(client).audit(task, candidate, signal());
  assert.deepEqual(
    findings.map((f) => f.name),
    AUDIT_QUESTIONS.map((q) => q.name),
  );
});

test('missing, duplicated, or out-of-range Decisions answers are not treated as passed audits', async () => {
  for (const answers of [
    [],
    AUDIT_QUESTIONS.map(() => ({
      name: AUDIT_QUESTIONS[0].name,
      type: 'predicate',
      probability: 0,
    })),
    AUDIT_QUESTIONS.map((q) => ({ name: q.name, type: 'predicate', probability: 1.5 })),
  ]) {
    const client = new OpenAIClient(
      'test-key',
      1,
      transport(() => ({ answers })),
    );
    await assert.rejects(new DecisionsAuditor(client).audit(task, candidate, signal()), /audit/);
  }
});
