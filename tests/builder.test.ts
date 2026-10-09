import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build, defaultOptions } from '../src/builder.ts';
import { LocalAdapter, FreyaAdapter } from '../src/adapter.ts';
import { MockGenerator } from '../src/providers.ts';
import { candidateIssues, parseTask } from '../src/validation.ts';
import type { Auditor, Candidate, Generator } from '../src/contracts.ts';

const task = parseTask(
  JSON.parse(await readFile(new URL('../fixtures/reschedule.json', import.meta.url), 'utf8')),
);
const candidate = await new MockGenerator().generate(task);
const generator = (values: unknown[]): Generator => ({
  async generate() {
    return values.shift();
  },
});
const audit = (probability: number): Auditor => ({
  async audit() {
    return [{ name: 'test', question: 'A test defect?', probability }];
  },
});

test('source tools and metadata are preserved; candidate declarations cannot remove tools', async () => {
  const before = structuredClone(task);
  const result = await build(
    task,
    generator([{ ...candidate, toolNames: [] }]),
    new LocalAdapter(),
  );
  assert.equal(result.status, 'built');
  assert.deepEqual((result.artifact as { tools: unknown }).tools, task.tools);
  assert.deepEqual(task, before);
});

test('unknown tool declarations are repaired with original task and feedback', async () => {
  let calls = 0;
  const result = await build(
    task,
    {
      async generate(received, strategy, signal, feedback) {
        assert.deepEqual(received, task);
        calls++;
        if (calls === 1) {
          return { ...candidate, toolNames: ['invented_tool'] };
        }
        assert.match(feedback!.issues[0], /Unknown declared tool/);
        return candidate;
      },
    },
    new LocalAdapter(),
  );
  assert.equal(result.status, 'built');
  assert.equal(calls, 2);
});

test('invalid candidates exhaust a bounded repair budget and never reach adapter', async () => {
  let calls = 0;
  const result = await build(
    task,
    {
      async generate() {
        calls++;
        return {};
      },
    },
    {
      async create() {
        throw new Error('should not run');
      },
    },
  );
  assert.equal(result.status, 'failed');
  assert.equal(calls, 2);
  assert.equal(result.artifact, null);
});

test('audit report mode does not trigger repair', async () => {
  const result = await build(
    task,
    generator([candidate]),
    new LocalAdapter(),
    { ...defaultOptions, auditMode: 'report' },
    audit(0.99),
  );
  assert.equal(result.status, 'built');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.warnings.length, 1);
});

test('invalid repair retains the earlier valid artifact', async () => {
  const result = await build(
    task,
    generator([candidate, {}]),
    new LocalAdapter(),
    { ...defaultOptions, auditMode: 'repair' },
    audit(0.99),
  );
  assert.equal(result.status, 'fallback');
  assert.deepEqual(result.candidate, candidate);
});

test('worse audited repair does not replace an incumbent', async () => {
  let calls = 0;
  const changed = { ...candidate, systemPrompt: 'A worse candidate.' };
  const result = await build(
    task,
    generator([candidate, changed]),
    new LocalAdapter(),
    { ...defaultOptions, auditMode: 'repair', auditThreshold: 0.5 },
    {
      async audit() {
        return [{ name: 'defect', question: 'Defect?', probability: ++calls === 1 ? 0.6 : 0.9 }];
      },
    },
  );
  assert.deepEqual(result.candidate, candidate);
});

test('audit failure preserves a valid output and records an explicit warning', async () => {
  const result = await build(
    task,
    generator([candidate]),
    new LocalAdapter(),
    { ...defaultOptions, auditMode: 'repair' },
    {
      async audit() {
        throw new Error('service unavailable');
      },
    },
  );
  assert.equal(result.status, 'fallback');
  assert.match(result.warnings[0], /service unavailable/);
});

test('deadline stops a provider that ignores cancellation', async () => {
  const result = await build(task, { generate: () => new Promise(() => {}) }, new LocalAdapter(), {
    ...defaultOptions,
    timeoutMs: 20,
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error!, /deadline/);
});

test('deadline during repair returns previously materialized valid artifact', async () => {
  let calls = 0;
  const result = await build(
    task,
    { generate: async () => (++calls === 1 ? candidate : new Promise<Candidate>(() => {})) },
    new LocalAdapter(),
    { ...defaultOptions, timeoutMs: 30, auditMode: 'repair' },
    audit(0.99),
  );
  assert.equal(result.status, 'fallback');
  assert.ok(result.artifact);
});

test('empty tool catalogs are allowed and duplicate names rejected', () => {
  assert.deepEqual(parseTask({ id: 'empty', description: 'Talk', tools: [] }).tools, []);
  assert.throws(() => parseTask({ ...task, tools: [task.tools[0], task.tools[0]] }), /Duplicate/);
  assert.ok(candidateIssues({ ...candidate, uncertainties: [null] }, task).length);
});

test('Freya placeholder fails explicitly rather than claiming a submission', async () => {
  const result = await build(task, generator([candidate]), new FreyaAdapter());
  assert.equal(result.status, 'failed');
  assert.match(result.error!, /not configured/);
});
