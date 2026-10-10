import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build, defaultOptions } from '../src/builder.ts';
import { LocalAdapter } from '../src/adapter.ts';
import { MockGenerator } from '../src/providers.ts';
import { candidateIssues, parseTask } from '../src/validation.ts';
import type { Generator } from '../src/contracts.ts';

const task = parseTask(
  JSON.parse(await readFile(new URL('../fixtures/reschedule.json', import.meta.url), 'utf8')),
);
const candidate = await new MockGenerator().generate(task);
const generator = (values: unknown[]): Generator => ({
  async generate() {
    return values.shift();
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

test('invalid candidate fails after one call and never reaches the adapter', async () => {
  let calls = 0;
  let compiled = false;
  const invalid = { ...candidate, toolNames: ['invented_tool'] };
  const result = await build(
    task,
    {
      async generate(received) {
        assert.deepEqual(received, task);
        calls++;
        return invalid;
      },
    },
    {
      async create() {
        compiled = true;
      },
    },
  );
  assert.equal(result.status, 'failed');
  assert.equal(calls, 1);
  assert.equal(compiled, false);
  assert.equal(result.artifact, null);
  assert.deepEqual(result.rawCandidate, invalid);
  assert.match(result.issues[0], /Unknown declared tool/);
});

test('deadline stops a provider that ignores cancellation', async () => {
  const result = await build(task, { generate: () => new Promise(() => {}) }, new LocalAdapter(), {
    ...defaultOptions,
    timeoutMs: 20,
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error!, /deadline/);
});

test('empty tool catalogs are allowed and duplicate names rejected', () => {
  assert.deepEqual(parseTask({ id: 'empty', description: 'Talk', tools: [] }).tools, []);
  assert.throws(() => parseTask({ ...task, tools: [task.tools[0], task.tools[0]] }), /Duplicate/);
  assert.ok(candidateIssues({ ...candidate, uncertainties: [null] }, task).length);
});
