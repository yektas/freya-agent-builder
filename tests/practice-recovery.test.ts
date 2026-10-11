// Synthetic recovery tests. All transports are injected; these are not benchmark scores.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hash } from '../src/experiments.ts';
import { recoverPractice } from '../src/practice-recovery.ts';
import { loadRun } from '../src/ui/records.ts';
import { startPractice } from '../src/ui/practice.ts';
import type { BridgeFactory } from '../src/ui/upload.ts';

const kit = resolve('build-the-builder');
const id = 'generation~synthetic-recovery';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'practice-recovery-'));
  const directory = join(root, 'generation', 'synthetic-recovery');
  const state = join(root, 'freya-state', 'synthetic-workspace');
  await mkdir(directory, { recursive: true });
  await mkdir(state, { recursive: true });
  const workflow = { initial_node: 'done', nodes: { done: { node_type: 'end_call' } } };
  const runFile = join(directory, 'run.json');
  const run = JSON.stringify({
    kind: 'generation-only',
    status: 'completed',
    task: {
      briefs: [{ text: await readFile(join(kit, 'briefs/brief-a.md'), 'utf8') }],
      openapi: { text: await readFile(join(kit, 'tools/openapi.json'), 'utf8') },
    },
  });
  const upload = JSON.stringify({
    status: 'registered',
    workflowHash: hash(workflow),
    agentId: 'synthetic-agent',
    workflowId: 'synthetic-workflow',
    workspaceId: 'synthetic-workspace',
  });
  const files: Record<string, string> = {};
  for (const name of [
    'VERSION',
    'freya.py',
    'tools/run_cases.py',
    'tools/score.py',
    'public-test-set.json',
  ]) {
    files[name] = await readFile(join(kit, name), 'utf8');
  }
  const job = {
    id: 'synthetic-job',
    status: 'failed',
    stage: 'simulation and scoring',
    brief: 'A',
    style: null,
    repetitions: 1,
    agentId: 'synthetic-agent',
    workflowId: 'synthetic-workflow',
    workspaceId: 'synthetic-workspace',
    workflowHash: hash(workflow),
    startedAt: '2026-10-11T10:00:00Z',
    endedAt: '2026-10-11T10:25:00Z',
    elapsedMs: 1500000,
    error: 'Practice deadline exceeded.',
    passed: null,
    total: null,
    kit: { files },
    source: { hash: 'synthetic-original-source' },
    modelCalls: [],
  };
  await writeFile(runFile, run);
  await writeFile(join(directory, 'upload.json'), upload);
  await writeFile(join(directory, 'compiled.workflow.json'), JSON.stringify(workflow));
  await writeFile(join(directory, 'platform.jsonl'), '{}\n');
  await writeFile(join(directory, 'practice-job.json'), JSON.stringify(job));
  await writeFile(
    join(directory, 'practice-history.json'),
    JSON.stringify([{ ...job, result: null }]),
  );
  const lock = join(state, 'workspace.lock');
  await writeFile(lock, JSON.stringify({ pid: 999999, run: runFile, action: 'practice' }));
  const env = { FREYA_API_KEY: 'synthetic-key', FREYA_BANK_TEAM_KEY: 'synthetic-bank-team-key' };
  return { root, directory, run, upload, lock, job, config: { root, kit, env } };
}
const result = {
  recovered: true,
  passed: 1,
  total: 2,
  runs: 1,
  simulation_id: 'synthetic-simulation',
  iteration_id: 'synthetic-iteration',
  simulations: ['synthetic-simulation'],
  rows: [
    { id: 'SYN-1', pass: true },
    { id: 'SYN-2', pass: false },
  ],
  final: [
    { id: 'SYN-1', pass: true },
    { id: 'SYN-2', pass: false },
  ],
};

test('late results recover without a rerun, preserve timeout history and inputs, and release only the original lock', async () => {
  const h = await fixture();
  const actions: string[] = [];
  const bridge: BridgeFactory = ({ env }) => ({
    env,
    async call(action, data, _signal, timeoutMs) {
      actions.push(action);
      assert.ok(timeoutMs <= 180000);
      if (action === 'probe') {
        return { workspaceId: 'synthetic-workspace' };
      }
      assert.equal(action, 'recover-practice');
      assert.equal(data.startedAt, h.job.startedAt);
      assert.equal(data.endedAt, h.job.endedAt);
      assert.equal(data.repetitions, 1);
      assert.ok(await readFile(h.lock, 'utf8'));
      await assert.rejects(() => startPractice(h.config, id, {}), /already being tested/);
      return result;
    },
  });
  try {
    const job = await recoverPractice({ ...h.config, bridge }, id);
    assert.equal(job.status, 'completed');
    assert.deepEqual(actions, ['probe', 'recover-practice']);
    assert.equal(await readFile(join(h.directory, 'run.json'), 'utf8'), h.run);
    assert.equal(await readFile(join(h.directory, 'upload.json'), 'utf8'), h.upload);
    const history = JSON.parse(await readFile(join(h.directory, 'practice-history.json'), 'utf8'));
    assert.equal(history.length, 2);
    assert.equal(history[0].status, 'failed');
    assert.equal(history[1].status, 'completed');
    assert.equal(history[1].source.hash, 'synthetic-original-source');
    assert.deepEqual(history[1].recovery.modelCalls, []);
    assert.equal(history[1].recovery.previousError, h.job.error);
    assert.equal((await loadRun(h.root, id))?.summary.evaluation.score, 0.5);
    await assert.rejects(() => readFile(h.lock));
    await assert.rejects(() => recoverPractice({ ...h.config, bridge }, id), /timed-out practice/);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('incomplete remote recovery retains the original lock, failure record, and previous score artifacts', async () => {
  const h = await fixture();
  const job = await readFile(join(h.directory, 'practice-job.json'), 'utf8');
  const old = JSON.stringify({ passed: 2, total: 2 });
  await writeFile(join(h.directory, 'practice.json'), old);
  const bridge: BridgeFactory = ({ env }) => ({
    env,
    async call(action) {
      if (action === 'probe') {
        return { workspaceId: 'synthetic-workspace' };
      }
      throw new Error('Recorded simulation is not completed');
    },
  });
  try {
    await assert.rejects(() => recoverPractice({ ...h.config, bridge }, id), /not completed/);
    assert.ok(await readFile(h.lock, 'utf8'));
    await assert.rejects(() => readFile(`${h.lock}.recovery`));
    assert.equal(await readFile(join(h.directory, 'practice-job.json'), 'utf8'), job);
    assert.equal(await readFile(join(h.directory, 'practice.json'), 'utf8'), old);
    assert.equal((await loadRun(h.root, id))?.summary.evaluation.score, null);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('another operation lock or stale registration is refused before remote recovery', async () => {
  const h = await fixture();
  const actions: string[] = [];
  const bridge: BridgeFactory = ({ env }) => ({
    env,
    async call(action) {
      actions.push(action);
      return {};
    },
  });
  try {
    await writeFile(h.lock, JSON.stringify({ run: '/another/run.json', action: 'practice' }));
    await assert.rejects(() => recoverPractice({ ...h.config, bridge }, id), /another operation/);
    const upload = JSON.parse(h.upload);
    upload.agentId = 'changed-agent';
    await writeFile(join(h.directory, 'upload.json'), JSON.stringify(upload));
    await assert.rejects(
      () => recoverPractice({ ...h.config, bridge }, id),
      /Registration changed/,
    );
    assert.deepEqual(actions, []);
    assert.ok(await readFile(h.lock, 'utf8'));
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
