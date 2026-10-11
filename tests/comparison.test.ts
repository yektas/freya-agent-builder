import assert from 'node:assert/strict';
import { test } from 'node:test';
import { practiceEvidence } from '../src/comparison.ts';

test('strict comparison excludes intermittent failures and counts ledger amounts only on passing cases', () => {
  const all_rows = [0, 1, 2].map((rep) => [
    { id: 'synthetic-pass', customer_id: `p${rep}`, pass: true },
    { id: 'synthetic-flaky', customer_id: `f${rep}`, pass: rep !== 0 },
  ]);
  const ledgers = new Map(
    all_rows.flatMap((rows) =>
      rows.map(
        (row) =>
          [
            row.customer_id,
            { promises: [{ amount: row.id === 'synthetic-pass' ? 12.34 : 999 }] },
          ] as const,
      ),
    ),
  );
  const result = {
    runs: 3,
    passed: 1,
    total: 2,
    final: [
      { id: 'synthetic-pass', pass: true },
      { id: 'synthetic-flaky', pass: false },
    ],
    all_rows,
  };
  const evidence = practiceEvidence(result, ledgers);
  assert.equal(evidence.score, 0.5);
  assert.deepEqual(evidence.promisedAmountsByRepetition, [12.34, 12.34, 12.34]);
  assert.equal(practiceEvidence({ ...result, runs: 1 }, ledgers).score, null);
  assert.equal(practiceEvidence({ ...result, passed: 2 }, ledgers).score, null);
  assert.equal(
    practiceEvidence({ ...result, all_rows: [all_rows[0], all_rows[0], []] }, ledgers).score,
    null,
  );
  assert.equal(practiceEvidence(result, new Map()).promisedAmountAcrossPassingRuns, null);
});

import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from '../src/experiments.ts';
import { loadFreyaTask } from '../src/workflow.ts';
import { compareRuns } from '../src/comparison.ts';
import { freyaStrategyInstructions } from '../src/strategies.ts';

test('comparison keeps failed builds visible and refuses stale or mismatched uploaded results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'comparison-'));
  try {
    const task = await loadFreyaTask(
      ['build-the-builder/briefs/brief-a.md'],
      'build-the-builder/tools/openapi.json',
      'build-the-builder',
    );
    const path = join(root, 'run.json');
    await writeFile(
      path,
      JSON.stringify({
        kind: 'generation-only',
        status: 'completed',
        task,
        inputHash: hash(task),
        config: { model: 'synthetic' },
      }),
    );
    const workflow = { nodes: { done: {} } };
    await writeFile(join(root, 'compiled.workflow.json'), JSON.stringify(workflow));
    const upload = {
      status: 'registered',
      workflowHash: hash(workflow),
      agentId: 'synthetic-agent',
    };
    await writeFile(join(root, 'upload.json'), JSON.stringify(upload));
    const job = {
      status: 'completed',
      repetitions: 3,
      brief: 'A',
      style: 'pieces',
      workflowHash: hash(workflow),
      agentId: 'synthetic-agent',
    };
    await writeFile(join(root, 'practice-job.json'), JSON.stringify(job));
    const row = { id: 'synthetic', customer_id: 'synthetic-customer', pass: true };
    await writeFile(
      join(root, 'practice.json'),
      JSON.stringify({
        runs: 3,
        passed: 1,
        total: 1,
        final: [row],
        all_rows: [[row], [row], [row]],
      }),
    );
    assert.equal((await compareRuns([path])).rows[0].score, 1);
    const baseline = (await compareRuns([path])).rows[0];
    assert.equal(baseline.strategy, 'direct');
    assert.equal(baseline.instructionsHash, null);
    const candidate = JSON.parse(await readFile(path, 'utf8'));
    candidate.config.strategy = 'validated-dates';
    candidate.config.instructionsHash = hash(freyaStrategyInstructions('validated-dates'));
    await writeFile(path, JSON.stringify(candidate));
    const candidateRow = (await compareRuns([path])).rows[0];
    assert.equal(candidateRow.strategy, 'validated-dates');
    assert.equal(candidateRow.instructionsHash, candidate.config.instructionsHash);
    assert.equal(candidateRow.comparisonGroup, baseline.comparisonGroup);
    await writeFile(
      join(root, 'upload.json'),
      JSON.stringify({ ...upload, workflowHash: 'changed' }),
    );
    assert.equal((await compareRuns([path])).rows[0].score, null);
    await writeFile(join(root, 'upload.json'), JSON.stringify(upload));
    await writeFile(join(root, 'practice-job.json'), JSON.stringify({ ...job, brief: 'B' }));
    assert.equal((await compareRuns([path])).rows[0].inputCompatible, false);
    assert.equal((await compareRuns([path])).rows[0].score, null);
    const failed = JSON.parse(await readFile(path, 'utf8'));
    failed.status = 'failed';
    failed.kind = 'freya-live-run';
    failed.error = 'Synthetic build failure';
    await writeFile(path, JSON.stringify(failed));
    const report = await compareRuns([path]);
    assert.equal(report.coverage.selectedRuns, 1);
    assert.equal(report.rows[0].score, null);
    assert.equal(report.rows[0].error, 'Synthetic build failure');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
