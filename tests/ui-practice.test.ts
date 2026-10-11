// Synthetic injected bridge results: offline contract tests, not benchmark scores.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { hash } from '../src/experiments.ts';
import { createUiServer } from '../src/ui/server.ts';
import { archiveRun, deleteRun, listRuns, loadRun } from '../src/ui/records.ts';
import type { BridgeFactory } from '../src/ui/upload.ts';
import { startPractice } from '../src/ui/practice.ts';

const roots: string[] = [];
const servers: Server[] = [];
after(async () => {
  for (const server of servers) {
    await new Promise<void>((done) => server.close(() => done()));
  }
  for (const root of roots) {
    await rm(root, { recursive: true, force: true });
  }
});
const kit = resolve('build-the-builder');
const SECRET = 'synthetic-practice-secret';
const TEAM = 'synthetic-bank-team-secret';
const id = 'generation~synthetic-test';
async function fixture(
  options: {
    gate?: Promise<void>;
    fail?: boolean;
    timeout?: boolean;
    workspace?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'ui-practice-'));
  roots.push(root);
  const directory = join(root, 'generation', 'synthetic-test');
  await mkdir(directory, { recursive: true });
  const workflow = {
    initial_node: 'done',
    nodes: { done: { node_type: 'end_call', transitions: [] } },
  };
  const run = JSON.stringify({
    kind: 'generation-only',
    status: 'completed',
    task: {
      synthetic: true,
      briefs: [
        { text: await readFile(join(kit, 'briefs/brief-a.md'), 'utf8') },
        { text: await readFile(join(kit, 'briefs/brief-b.md'), 'utf8') },
      ],
      openapi: { text: await readFile(join(kit, 'tools/openapi.json'), 'utf8') },
    },
    evaluation: { source: 'not-evaluated', score: null },
  });
  await writeFile(join(directory, 'run.json'), run);
  await writeFile(join(directory, 'compiled.workflow.json'), JSON.stringify(workflow));
  await writeFile(
    join(directory, 'upload.json'),
    JSON.stringify({
      status: 'registered',
      agentId: 'synthetic-agent',
      workflowId: 'synthetic-workflow',
      workspaceId: 'synthetic-workspace',
      workflowHash: hash(workflow),
      slot: 'synthetic-slot',
    }),
  );
  const calls: { action: string; data: Record<string, unknown>; timeoutMs: number }[] = [];
  const bridge: BridgeFactory = ({ env }) => ({
    env,
    async call(action, data, signal, timeoutMs) {
      calls.push({ action, data, timeoutMs });
      if (action === 'probe') {
        return { workspaceId: options.workspace ?? 'synthetic-workspace' };
      }
      assert.equal(action, 'practice'); // No registration, export, or model call.
      if (options.timeout) {
        await new Promise<void>((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('deadline')), { once: true }),
        );
      }
      await options.gate;
      if (options.fail) {
        throw new Error(`Practice rejected ${SECRET} ${TEAM}`);
      }
      const result = {
        passed: 1,
        total: 2,
        runs: data.repetitions,
        simulation_id: 'synthetic-simulation',
        iteration_id: 'synthetic-iteration',
        final: [
          { id: 'SYN-1', pass: true },
          { id: 'SYN-2', pass: false },
        ],
        rows: [
          { id: 'SYN-1', pass: true, tools: ['close_call'], failed: [] },
          { id: 'SYN-2', pass: true, tools: ['close_call'], failed: [] },
        ],
        all_rows: [
          [
            { id: 'SYN-1', pass: true, failed: [] },
            { id: 'SYN-2', pass: false, failed: ['Synthetic earlier failure'] },
          ],
        ],
      };
      await writeFile(String(data.path), JSON.stringify(result));
      return result;
    },
  });
  const config = {
    root,
    kit,
    bridge,
    timeoutMs: options.timeout ? 1000 : 30000,
    env: options.env ?? { FREYA_API_KEY: SECRET, FREYA_BANK_TEAM_KEY: TEAM },
  };
  const server = createUiServer({ root, port: 0, host: '127.0.0.1', practice: config });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const post = async (body: unknown = {}, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}/api/runs/${id}/practice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { root, directory, base, calls, config, post, run };
}
async function finished(root: string) {
  for (let i = 0; i < 200; i++) {
    const detail = await loadRun(root, id);
    // Discovery may precede practice.json while the subsequent job read sees
    // completion. Poll once more until the completed result is also discovered.
    if (
      detail?.practiceJob &&
      (detail.practiceJob.status === 'failed' ||
        (detail.practiceJob.status === 'completed' &&
          detail.summary.evaluation.source === 'official-practice'))
    ) {
      return detail;
    }
    await new Promise((done) => setTimeout(done, 15));
  }
  throw new Error('Synthetic test did not finish');
}

test('test starts asynchronously, persists scores and history, and leaves generation and registration intact', async () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const h = await fixture({ gate });
  const availability = await (await fetch(`${h.base}/api/practice`)).json();
  assert.equal(availability.available, true);
  const upload = await readFile(join(h.directory, 'upload.json'), 'utf8');
  const response = await h.post({ brief: 'all', style: 'corrects', repetitions: 3 });
  assert.equal(response.status, 202);
  assert.equal(response.body.practiceJob.status, 'running');
  assert.equal((await loadRun(h.root, id))?.summary.practiceStatus, 'running');
  assert.equal((await h.post()).status, 409);
  await assert.rejects(() => deleteRun(h.root, id), /practice is running/);
  await assert.rejects(() => archiveRun(h.root, id), /practice is running/);
  const lock = join(h.root, 'freya-state', 'synthetic-workspace', 'workspace.lock');
  assert.ok(await readFile(lock, 'utf8'));
  release();
  const detail = await finished(h.root);
  assert.equal(detail.practiceJob?.status, 'completed');
  assert.equal(detail.summary.evaluation.score, 0.5);
  assert.equal(detail.summary.evaluation.source, 'official-practice');
  assert.equal(detail.practice?.cases[1].pass, false); // final aggregates, not last repetition
  assert.deepEqual(detail.practice?.cases[1].failed, ['Synthetic earlier failure']);
  assert.equal((await listRuns(h.root))[0].evaluation.score, 0.5);
  assert.equal(await readFile(join(h.directory, 'run.json'), 'utf8'), h.run);
  assert.equal(await readFile(join(h.directory, 'upload.json'), 'utf8'), upload);
  assert.deepEqual(
    h.calls.map((call) => call.action),
    ['probe', 'practice'],
  );
  assert.equal(h.calls[1].data.brief, undefined);
  assert.equal(h.calls[1].data.repetitions, 3);
  assert.equal(h.calls[1].data.style, 'corrects');
  assert.ok(h.calls.every((call) => call.timeoutMs <= 30000));
  // Wait for history persistence/lock cleanup, after final status becomes visible.
  for (let i = 0; i < 100; i++) {
    try {
      await readFile(lock);
    } catch {
      break;
    }
    await new Promise((done) => setTimeout(done, 10));
  }
  await assert.rejects(() => readFile(lock));
  const artifact = await fetch(`${h.base}/api/runs/${id}/files/practice-history.json`);
  assert.equal(artifact.status, 200);
  const history = await artifact.json();
  assert.equal(history.length, 1);
  assert.equal(history[0].kit.files.VERSION.trim(), '3');
  assert.deepEqual(history[0].modelCalls, []);
  assert.equal(JSON.stringify(detail).includes(SECRET), false);
  assert.equal((await h.post({ brief: 'B' })).status, 202);
  await finished(h.root);
});

test('credentials, invalid choices, unknown ids, stale uploads, and cross-origin requests are refused before remote calls', async () => {
  const h = await fixture();
  for (const body of [
    { brief: 'C' },
    { style: '../env.sh' },
    { repetitions: 10 },
    { agentId: 'arbitrary' },
    { kit: '/tmp' },
  ]) {
    assert.equal((await h.post(body)).status, 422);
  }
  assert.equal((await h.post({}, { origin: 'https://other.example' })).status, 403);
  assert.equal((await h.post({}, { 'sec-fetch-site': 'cross-site' })).status, 403);
  const unknown = await fetch(`${h.base}/api/runs/missing/practice`, { method: 'POST' });
  assert.equal(unknown.status, 404);
  const traversal = await fetch(`${h.base}/api/runs/..%2Fetc/practice`, { method: 'POST' });
  assert.equal(traversal.status, 405);
  await writeFile(join(h.directory, 'compiled.workflow.json'), '{}');
  assert.equal((await h.post()).status, 409);
  assert.deepEqual(h.calls, []);
  const missing = await fixture({ env: {} });
  assert.equal((await missing.post()).status, 503);
  assert.deepEqual(missing.calls, []);
});

test('workspace lock and workspace mismatch prevent testing the wrong agent', async () => {
  const h = await fixture({ workspace: 'other-workspace' });
  await h.post();
  assert.equal((await finished(h.root)).practiceJob?.status, 'failed');
  assert.deepEqual(
    h.calls.map((call) => call.action),
    ['probe'],
  );
  const dir = join(h.root, 'freya-state', 'synthetic-workspace');
  // A lock belonging to another operation must never be removed by refusal.
  await new Promise((done) => setTimeout(done, 30));
  await writeFile(join(dir, 'workspace.lock'), 'other operation');
  assert.equal((await h.post()).status, 409);
  assert.equal(await readFile(join(dir, 'workspace.lock'), 'utf8'), 'other operation');
});

test('a failed rerun keeps previous results, hides stale scores, and redacts errors', async () => {
  const h = await fixture({ fail: true });
  const previous = JSON.stringify({ passed: 2, total: 2, rows: [] });
  await writeFile(join(h.directory, 'practice.json'), previous);
  await h.post();
  const detail = await finished(h.root);
  assert.equal(detail.practiceJob?.status, 'failed');
  assert.equal(detail.summary.evaluation.score, null);
  assert.equal(detail.practice, null);
  assert.equal(await readFile(join(h.directory, 'practice.json'), 'utf8'), previous);
  assert.equal(JSON.stringify(detail).includes(SECRET), false);
  assert.equal(JSON.stringify(detail).includes(TEAM), false);
  assert.match(detail.practiceJob?.error ?? '', /REDACTED/);
});

test('a timeout is bounded and preserves the workspace lock until the remote simulation is reconciled', async () => {
  const h = await fixture({ timeout: true });
  const started = Date.now();
  await startPractice(h.config, id, {});
  const detail = await finished(h.root);
  assert.ok(Date.now() - started < 5000);
  assert.equal(detail.practiceJob?.status, 'failed');
  assert.match(detail.practiceJob?.error ?? '', /remote simulation may still be running/i);
  const lock = join(h.root, 'freya-state', 'synthetic-workspace', 'workspace.lock');
  assert.ok(await readFile(lock, 'utf8'));
  assert.equal((await h.post()).status, 409);
});
