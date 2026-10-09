import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, projectRoot, report } from '../src/experiments.ts';
import { parseTask } from '../src/validation.ts';

test('CLI suite creates reproducible records with null benchmark scores', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'freya-test-'));
  try {
    const output = execFileSync(
      process.execPath,
      ['src/cli.ts', 'suite', '--tasks', 'fixtures', '--out', directory],
      { cwd: projectRoot, encoding: 'utf8' },
    );
    const lines = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(lines.length, 4);
    assert.ok(lines.every((line) => line.status === 'built' && line.score === null));
    const record = JSON.parse(
      await readFile(join(directory, (await readdir(directory))[0]), 'utf8'),
    );
    assert.ok(record.source.files['src/builder.ts']);
    assert.equal(record.calls.length, 0);
    assert.equal(record.evaluation.source, 'not-evaluated');
    const summary = await report(directory);
    assert.ok(summary.every((group) => group.meanScore === null && group.evaluated === 0));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI rejects live configuration before any requests or output records', () => {
  const run = spawnSync(
    process.execPath,
    ['src/cli.ts', 'build', '--task', 'fixtures/no-tools.json', '--provider', 'openai'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, OPENAI_API_KEY: '', BUILDER_MODEL: '' },
    },
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Live runs require/);
});

test('evaluator integration distinguishes absent results and enforces timeout', async () => {
  const task = parseTask({ id: 'test', description: 'Test', tools: [] });
  assert.equal((await evaluate(undefined, task, {}, 20)).score, null);
  assert.equal(
    (
      await evaluate(
        {
          async evaluate() {
            return { score: 0, source: 'test-only', details: null };
          },
        },
        task,
        {},
        20,
      )
    ).score,
    0,
  );
  await assert.rejects(
    evaluate({ evaluate: () => new Promise(() => {}) }, task, {}, 20),
    /deadline/,
  );
});
