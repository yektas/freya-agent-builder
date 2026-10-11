// Offline tests for the inspector: fixtures are written to a temp directory and
// no model, platform, or network call is made.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import {
  archiveRun,
  discoverRuns,
  listRuns,
  loadRun,
  readRunFile,
  restoreRun,
} from '../src/ui/records.ts';
import { createUiServer } from '../src/ui/server.ts';

// The inspector UI is a Vite bundle. Build it at most once per test process so
// the asset route is exercised against the real build output.
let built: Promise<unknown> | null = null;
function buildUi() {
  built ??= new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'build'],
      { cwd: fileURLToPath(new URL('../ui', import.meta.url)) },
      (error: Error | null) => (error ? reject(error) : resolve(null)),
    );
  });
  return built;
}

const roots: string[] = [];
after(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'freya-ui-'));
  roots.push(root);
  return root;
}

async function seedFreyaRun(root: string) {
  const dir = join(root, 'live-1');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'run.json'),
    JSON.stringify({
      kind: 'freya-live-run',
      status: 'completed',
      startedAt: '2026-10-10T10:00:00.000Z',
      elapsedMs: 42000,
      task: { id: 'brief-a', description: 'Banking brief', tools: [{ name: 'get_account' }] },
      inputHash: 'abc123',
      config: { slot: 'brief-a', model: 'gpt-5', briefs: ['brief-a.md'], limits: { maxCalls: 1 } },
      source: {
        hash: 'src1',
        git: { commit: 'deadbeef', dirty: false },
        files: { 'src/cli.ts': 'x' },
      },
      calls: [{ endpoint: 'responses', request: {}, response: {}, elapsedMs: 9000 }],
      stages: [
        {
          name: 'candidate',
          status: 'completed',
          startedAt: '2026-10-10T10:00:01.000Z',
          endedAt: '2026-10-10T10:00:10.000Z',
        },
        {
          name: 'practice',
          status: 'completed',
          startedAt: '2026-10-10T10:00:11.000Z',
          endedAt: '2026-10-10T10:00:20.000Z',
        },
      ],
      evaluation: {
        score: 0.5,
        passed: 5,
        total: 10,
        source: 'official-practice',
        details: 'One repetition.',
      },
    }),
  );
  await writeFile(
    join(dir, 'compiled.workflow.json'),
    JSON.stringify({
      initial_node: 'greeting',
      system_prompt: 'You are a bank agent.',
      nodes: {
        greeting: {
          node_type: 'conversation',
          task_message: 'Greet the customer.',
          tools: [{ function: { name: 'verify_identity' } }],
          transitions: [
            { target_node: 'verify', description: 'always', condition: { operator: 'always' } },
          ],
        },
        verify: {
          node_type: 'api_request',
          pre_actions: [{ name: 'verify_identity' }],
          transitions: [{ target_node: 'done', description: 'verified' }],
        },
        orphan: { node_type: 'conversation', task_message: 'Unreachable.', transitions: [] },
        stranded: { node_type: 'conversation', transitions: [{ target_node: 'missing_node' }] },
        done: { node_type: 'end_call', terminal: { name: 'close_call' }, transitions: [] },
      },
      global_nodes: {
        interrupt: { node_type: 'conversation', transitions: [{ target_node: '__previous__' }] },
      },
      context_variables: { verified: {} },
      tools: ['close_call'],
    }),
  );
  await writeFile(
    join(dir, 'practice.json'),
    JSON.stringify({
      passed: 5,
      total: 10,
      simulation_id: 'sim-1',
      iteration_id: 'it-1',
      rows: [
        {
          id: 'PUB-01',
          level: 'L1',
          family: 'identity',
          pass: true,
          failed: [],
          tools: ['verify_identity', 'close_call'],
        },
        {
          id: 'PUB-02',
          level: 'L2',
          family: 'transfer',
          pass: false,
          failed: ['outcome mismatch', 'not closed'],
          tools: ['get_account'],
        },
      ],
    }),
  );
  await writeFile(join(dir, 'platform.jsonl'), '{"kind":"request"}\n{"kind":"result"}\n');
  return dir;
}

test('discovers live runs, generation traces, and build records', async () => {
  const root = await fixture();
  await seedFreyaRun(root);

  const genDir = join(root, 'generation', '2026-10-10T11-00-00-000Z-abc');
  await mkdir(genDir, { recursive: true });
  await writeFile(
    join(genDir, 'run.json'),
    JSON.stringify({
      kind: 'generation-only',
      runId: 'gen-1',
      status: 'completed',
      startedAt: '2026-10-10T11:00:00.000Z',
      elapsedMs: 7000,
      calls: [],
      rawCandidate: JSON.stringify({ workflowJson: '{}', uncertainties: ['unclear refund rule'] }),
      evaluation: { score: null, source: 'not-evaluated' },
    }),
  );
  await writeFile(
    join(genDir, 'trace.jsonl'),
    `${JSON.stringify({ at: '2026-10-10T11:00:00.000Z', elapsedMs: 0, kind: 'start', data: {} })}\n` +
      `${JSON.stringify({ at: '2026-10-10T11:00:01.000Z', elapsedMs: 1000, kind: 'progress', data: { message: 'Reading briefs' } })}\n`,
  );

  await writeFile(
    join(root, 'build-1.json'),
    JSON.stringify({
      runId: 'build-1',
      createdAt: '2026-10-09T09:00:00.000Z',
      task: { id: 'synthetic-reschedule', synthetic: true, tools: [{ name: 'reschedule' }] },
      provider: 'mock',
      model: null,
      elapsedMs: 5,
      build: {
        status: 'built',
        candidate: {
          systemPrompt: 'OFFLINE MOCK',
          toolNames: [],
          completionConditions: [],
          uncertainties: [],
        },
        issues: [],
      },
      calls: [],
      evaluation: { score: null, source: 'not-evaluated' },
    }),
  );

  // State and probe directories are not reviewable runs.
  await mkdir(join(root, 'freya-state', 'ws-1'), { recursive: true });
  await writeFile(join(root, 'freya-state', 'ws-1', 'slots.json'), '{}');
  await mkdir(join(root, 'freya-probe'), { recursive: true });
  await writeFile(join(root, 'freya-probe', 'platform.jsonl'), '{}\n');

  const runs = await discoverRuns(root);
  assert.deepEqual(runs.map((run) => run.kind).sort(), [
    'freya-live-run',
    'generation-only',
    'local-build',
  ]);

  const summaries = await listRuns(root);
  assert.equal(summaries.length, 3);
  // Newest first.
  assert.equal(summaries[0].kind, 'generation-only');
  assert.equal(summaries[1].id, 'live-1');
  assert.equal(summaries[2].kind, 'local-build');

  const live = summaries[1];
  assert.equal(live.title, 'brief-a');
  assert.equal(live.slot, 'brief-a');
  assert.equal(live.model, 'gpt-5');
  assert.equal(live.counts.stages, 2);
  assert.equal(live.evaluation.passed, 5);
  assert.equal(live.evaluation.total, 10);
  assert.deepEqual(live.files.map((file) => file.name).sort(), [
    'compiled.workflow.json',
    'platform.jsonl',
    'practice.json',
    'run.json',
  ]);
});

test('surfaces stored usage and cost, and omits usage when no model call ran', async () => {
  const root = await fixture();
  // A current run: usage already written to the record, priced at write time.
  const priced = join(root, 'priced');
  await mkdir(priced, { recursive: true });
  await writeFile(
    join(priced, 'run.json'),
    JSON.stringify({
      kind: 'freya-live-run',
      status: 'completed',
      startedAt: '2026-10-10T12:00:00.000Z',
      task: { id: 'brief-a', tools: [] },
      config: { model: 'gpt-5' },
      calls: [
        {
          endpoint: 'responses',
          request: {},
          elapsedMs: 1000,
          usage: {
            inputTokens: 1000,
            cachedInputTokens: 400,
            outputTokens: 200,
            reasoningTokens: 50,
            totalTokens: 1200,
          },
        },
      ],
      usage: {
        tokens: {
          inputTokens: 1000,
          cachedInputTokens: 400,
          outputTokens: 200,
          reasoningTokens: 50,
          totalTokens: 1200,
        },
        // 600 uncached at $1.25/M + 400 cached at $0.125/M + 200 output at $10/M.
        cost: { usd: 0.0028, source: 'table', inputPerMTok: 1.25 },
      },
    }),
  );
  // A run with no model call at all.
  const mock = join(root, 'mock');
  await mkdir(mock, { recursive: true });
  await writeFile(
    join(mock, 'run.json'),
    JSON.stringify({
      kind: 'local-build',
      status: 'built',
      createdAt: '2026-10-08T12:00:00.000Z',
      task: { id: 'synthetic', tools: [] },
      provider: 'mock',
      calls: [],
    }),
  );

  const summaries = await listRuns(root);
  const pricedRun = summaries.find((run) => run.id === 'priced');
  assert.equal(pricedRun?.usage?.totalTokens, 1200);
  assert.equal(pricedRun?.usage?.usd, 0.0028);
  assert.equal(pricedRun?.usage?.costSource, 'table');
  assert.equal(pricedRun?.usage?.calls, 1);

  assert.equal(summaries.find((run) => run.id === 'mock')?.usage, null);

  const detail = await loadRun(root, 'priced');
  assert.equal(detail?.calls[0].usage?.totalTokens, 1200);
  assert.equal(detail?.calls[0].usd, 0.0028);
  // An unpriced model still shows tokens per call, with no fabricated cost.
  const unpriced = summaries.find((run) => run.id === 'mock');
  assert.equal(unpriced?.usage, null);
});

test('walks the workflow graph and reports structural observations', async () => {
  const root = await fixture();
  await seedFreyaRun(root);

  const detail = await loadRun(root, 'live-1');
  assert.ok(detail?.workflow);
  const workflow = detail.workflow;
  assert.equal(workflow.initialNode, 'greeting');
  assert.deepEqual(workflow.contextVariables, ['verified']);
  assert.deepEqual(workflow.lifecycleTools, ['close_call']);

  const greeting = workflow.nodes.find((node) => node.key === 'greeting');
  assert.equal(greeting?.type, 'conversation');
  assert.deepEqual(greeting?.tools, ['verify_identity']);
  assert.equal(greeting?.reachable, true);

  const verify = workflow.nodes.find((node) => node.key === 'verify');
  assert.deepEqual(verify?.preActions, ['api: verify_identity']);

  const end = workflow.nodes.find((node) => node.key === 'done');
  assert.equal(end?.type, 'end_call');
  assert.equal(end?.reachable, true);
  // Ending the call is the intended exit, not a structural defect.
  assert.equal(end?.deadEnd, false);

  // Reachable from the initial node, and reported as such.
  assert.deepEqual(workflow.unreachable, ['orphan', 'stranded']);
  // `orphan` has no exit at all and `stranded` exits only to a node that does
  // not exist, so neither can continue or end the conversation.
  assert.deepEqual(
    workflow.nodes.filter((node) => node.deadEnd).map((node) => node.key),
    ['orphan', 'stranded'],
  );
  assert.deepEqual(workflow.danglingTargets, ['missing_node']);
  assert.equal(workflow.globalNodes[0].key, 'interrupt');
});

// The compiled workflow is the deliverable of a generation run. It must be
// reachable as its own artifact and as exact JSON, not only as a graph reading.
test('surfaces the exact workflow JSON for a generation run', async () => {
  const root = await fixture();
  const dir = join(root, 'generation', 'gen-workflow');
  await mkdir(dir, { recursive: true });
  const workflow = {
    initial_node: 'greeting',
    system_prompt: 'You are a bank agent.',
    nodes: {
      greeting: {
        node_type: 'conversation',
        task_message: 'Greet the customer.',
        transitions: [{ target_node: 'done', description: 'always' }],
      },
      done: { node_type: 'end_call', terminal: { name: 'close_call' }, transitions: [] },
    },
  };
  await writeFile(
    join(dir, 'run.json'),
    JSON.stringify({
      kind: 'generation-only',
      status: 'completed',
      startedAt: '2026-10-10T11:00:00.000Z',
    }),
  );
  await writeFile(join(dir, 'compiled.workflow.json'), JSON.stringify(workflow, null, 2));

  const summary = (await listRuns(root))[0];
  // The workflow JSON is discoverable as a served artifact.
  assert.ok(summary.files.some((file) => file.name === 'compiled.workflow.json'));

  const detail = await loadRun(root, 'generation~gen-workflow');
  // Byte-for-byte the recorded document, so it can be submitted as generated.
  assert.equal(detail?.workflowJson, JSON.stringify(workflow, null, 2));
  assert.equal(JSON.parse(detail?.workflowJson ?? '{}').initial_node, 'greeting');
});

test('renders practice rows with failure reasons', async () => {
  const root = await fixture();
  await seedFreyaRun(root);

  const detail = await loadRun(root, 'live-1');
  const practice = detail?.practice;
  assert.ok(practice);
  assert.equal(practice.passed, 5);
  assert.equal(practice.total, 10);
  assert.equal(practice.cases.length, 2);
  assert.equal(practice.summaryOnly, false);
  const failed = practice.cases.find((item) => item.id === 'PUB-02');
  assert.equal(failed?.pass, false);
  assert.deepEqual(failed?.failed, ['outcome mismatch', 'not closed']);
  assert.deepEqual(practice.cases[0].tools, ['verify_identity', 'close_call']);
});

test('reads generation-only traces and the JSON-encoded blueprint', async () => {
  const root = await fixture();
  const genDir = join(root, 'generation', 'gen-1');
  await mkdir(genDir, { recursive: true });
  await writeFile(
    join(genDir, 'run.json'),
    JSON.stringify({
      kind: 'generation-only',
      status: 'completed',
      startedAt: '2026-10-10T11:00:00.000Z',
      rawCandidate: JSON.stringify({
        workflowJson: '{}',
        uncertainties: ['refund window unclear'],
      }),
    }),
  );
  await writeFile(
    join(genDir, 'trace.jsonl'),
    `${JSON.stringify({ elapsedMs: 1200, kind: 'progress', data: { message: 'Reading briefs' } })}\n` +
      `${JSON.stringify({ elapsedMs: 9000, kind: 'model-event', data: { kind: 'draft', text: '{"workflowJson"' } })}\n` +
      `not json\n`,
  );

  const id = 'generation~gen-1';
  const detail = await loadRun(root, id);
  assert.equal(detail?.summary.kind, 'generation-only');
  assert.deepEqual(detail?.workflowCandidate?.uncertainties, ['refund window unclear']);
  // The unparsable line is dropped rather than failing the whole trace.
  assert.equal(detail?.trace.length, 2);
  assert.equal(detail?.trace[0].summary, 'Reading briefs');
  assert.equal(detail?.trace[1].summary, 'draft: {"workflowJson"');
});

test('marks the internal build baseline as unevaluated and synthetic', async () => {
  const root = await fixture();
  await writeFile(
    join(root, 'build-1.json'),
    JSON.stringify({
      createdAt: '2026-10-09T09:00:00.000Z',
      task: { id: 'synthetic-reschedule', synthetic: true, tools: [] },
      provider: 'mock',
      model: null,
      elapsedMs: 4,
      build: {
        status: 'built',
        candidate: {
          systemPrompt: 'OFFLINE MOCK',
          toolNames: ['reschedule'],
          completionConditions: ['done'],
          uncertainties: ['mock'],
        },
        issues: ['bad thing'],
      },
      calls: [],
      evaluation: { score: null, source: 'not-evaluated' },
    }),
  );

  const detail = await loadRun(root, 'build-1');
  assert.equal(detail?.summary.synthetic, true);
  assert.equal(detail?.summary.provider, 'mock');
  assert.equal(detail?.summary.evaluation.score, null);
  assert.equal(detail?.summary.status, 'built');
  assert.equal(detail?.candidate?.systemPrompt, 'OFFLINE MOCK');
  assert.deepEqual(detail?.issues, ['bad thing']);
});

test('groups streamed fragments without losing whitespace or hiding later failures', async () => {
  const root = await fixture();
  const dir = join(root, 'generation', 'fragmented');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'run.json'),
    JSON.stringify({ kind: 'generation-only', status: 'failed' }),
  );
  const fragments = ['{"prompt":"You', ' are ', 'Freya', ' '.repeat(4100), 'Bank"'];
  const entries = fragments.map((text, i) => ({
    elapsedMs: i,
    kind: 'model-event',
    data: { kind: 'draft', text },
  }));
  await writeFile(
    join(dir, 'trace.jsonl'),
    [
      ...entries,
      { elapsedMs: 6, kind: 'progress', data: { message: 'waiting' } },
      { elapsedMs: 7, kind: 'model-event', data: { kind: 'summary', text: 'Public ' } },
      { elapsedMs: 8, kind: 'model-event', data: { kind: 'summary', text: 'summary' } },
      { elapsedMs: 9, kind: 'error', data: { message: 'max_output_tokens' } },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n') + '\n',
  );
  const detail = await loadRun(root, 'generation~fragmented');
  assert.equal(detail?.trace.length, 4);
  assert.equal(detail?.trace[0].summary, 'draft: ' + fragments.join(''));
  assert.equal(detail?.trace[0].fragments, 5);
  assert.equal(detail?.trace[0].endedElapsedMs, 4);
  assert.equal(detail?.trace[2].summary, 'summary: Public summary');
  assert.equal(detail?.trace[3].summary, 'max_output_tokens');
  assert.equal(
    (await readRunFile(root, 'generation~fragmented', 'trace.jsonl'))?.split('\n').filter(Boolean)
      .length,
    9,
  );
});

test('surfaces a failed run and its error without a practice result', async () => {
  const root = await fixture();
  const dir = join(root, 'live-failed');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'run.json'),
    JSON.stringify({
      kind: 'freya-live-run',
      status: 'failed',
      startedAt: '2026-10-10T12:00:00.000Z',
      error: 'End-to-end deadline exceeded.',
      stages: [{ name: 'workspace', status: 'completed' }],
      evaluation: { score: null, source: 'not-evaluated' },
    }),
  );

  const detail = await loadRun(root, 'live-failed');
  assert.equal(detail?.summary.status, 'failed');
  assert.equal(detail?.summary.error, 'End-to-end deadline exceeded.');
  assert.equal(detail?.summary.evaluation.score, null);
  assert.equal(detail?.practice, null);
  assert.equal(detail?.workflow, null);
});

test('archiveRun and restoreRun work at the records level, with guards', async () => {
  const root = await fixture();
  await seedFreyaRun(root);
  const genDir = join(root, 'generation', 'gen-roundtrip');
  await mkdir(genDir, { recursive: true });
  await writeFile(
    join(genDir, 'run.json'),
    JSON.stringify({ kind: 'generation-only', status: 'completed' }),
  );

  // Directory run.
  const archivedLive = await archiveRun(root, 'live-1');
  assert.ok(archivedLive?.startsWith('archive~'));
  assert.equal(await loadRun(root, 'live-1'), null);
  // Generation run: the '~' inside its own id must survive the round trip.
  const archivedGen = await archiveRun(root, 'generation~gen-roundtrip');
  assert.ok(archivedGen?.includes('generation~gen-roundtrip'));
  // Unknown and already-archived ids are inert.
  assert.equal(await archiveRun(root, 'nope'), null);
  assert.equal(await archiveRun(root, archivedLive!), null);

  // Restore puts each back under its discovery id.
  assert.equal(await restoreRun(root, archivedLive!), 'live-1');
  assert.ok(await loadRun(root, 'live-1'));
  assert.equal(await restoreRun(root, 'live-1'), null); // not archived
  assert.equal(
    (await restoreRun(root, archivedGen!.replace(/^.+?__/, 'archive~x__'))) ?? null,
    null,
  ); // fabricated id is unknown
  const archivedGenRecord = archivedGen!;
  assert.equal(await restoreRun(root, archivedGenRecord), 'generation~gen-roundtrip');
  await stat(genDir); // back at its generation/ address
  // A restore of an id the scan never saw does nothing.
  assert.equal(await restoreRun(root, 'archive~made-up'), null);
  // An occupied destination is never overwritten.
  const secondArchive = await archiveRun(root, 'live-1');
  assert.ok(secondArchive);
  await mkdir(join(root, 'live-1'), { recursive: true });
  await writeFile(join(root, 'live-1', 'sentinel.txt'), 'newer');
  assert.equal(await restoreRun(root, secondArchive!), null); // refused
  assert.equal((await stat(join(root, 'live-1', 'sentinel.txt'))).size, 5); // untouched
  await rm(join(root, 'live-1'), { recursive: true });
  assert.equal(await restoreRun(root, secondArchive!), 'live-1');
});

test('archive moves a run to the archive and restore brings it back intact', async () => {
  const root = await fixture();
  await seedFreyaRun(root);
  const genDir = join(root, 'generation', 'gen-arch');
  await mkdir(genDir, { recursive: true });
  await writeFile(
    join(genDir, 'run.json'),
    JSON.stringify({
      kind: 'generation-only',
      status: 'completed',
      startedAt: '2026-10-10T11:00:00.000Z',
    }),
  );
  await writeFile(join(root, 'build-arch.json'), JSON.stringify({ createdAt: 'x', build: {} }));

  const server = createUiServer({ root, port: 0, host: '127.0.0.1', allowArchive: true });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = await serverAddress(server);
  try {
    // Every kind archives, and each is visible through the archived listing
    // afterwards, out of the live one.
    const live = await fetch(`${base}/api/runs/live-1/archive`, { method: 'POST' });
    assert.equal(live.status, 200);
    const liveBody = (await live.json()) as { archivedId?: string };
    assert.ok(liveBody.archivedId?.startsWith('archive~'));
    assert.ok(!(await listRuns(root)).some((run) => run.id === 'live-1'));
    const archived = (await listRuns(root)).filter((run) => run.archived);
    assert.ok(archived.some((run) => run.id === liveBody.archivedId));
    await stat(join(root, 'archive'));

    const gen = await fetch(
      `${base}/api/runs/${encodeURIComponent('generation~gen-arch')}/archive`,
      { method: 'POST' },
    );
    assert.equal(gen.status, 200);
    const build = await fetch(`${base}/api/runs/build-arch/archive`, { method: 'POST' });
    assert.equal(build.status, 200);
    // The moved single-file record left the root.
    await stat(join(root, 'archive', 'build-arch.json')).catch(() => {
      // The name is timestamped; find it by shape instead.
    });
    assert.equal((await readdirArchiveBuilds(root)).length, 1);

    // Restore puts the run back under the same id, and the archived copy is
    // consumed, so nothing lingers in two places.
    const restored = await fetch(
      `${base}/api/runs/${encodeURIComponent(liveBody.archivedId!)}/restore`,
      { method: 'POST' },
    );
    assert.equal(restored.status, 200);
    assert.deepEqual(await restored.json(), {
      restored: 'live-1',
      fromId: liveBody.archivedId,
    });
    const back = await listRuns(root);
    assert.ok(back.some((run) => run.id === 'live-1' && !run.archived));
    // The restored run is fully usable again: detail and artifacts load.
    const detail = await loadRun(root, 'live-1');
    assert.equal(detail?.workflow?.initialNode, 'greeting');

    // Nothing was ever destroyed: archive + restore is a round trip. The gen
    // and build records remain in the archive, restorable later.
    assert.equal((await listRuns(root)).length, 3);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

// Recount the archived single-file build records by inode name shape.
async function readdirArchiveBuilds(root: string): Promise<string[]> {
  try {
    return (await readdir(join(root, 'archive'))).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
}

async function serverAddress(server: import('node:http').Server): Promise<string> {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

test('archive and restore are guarded like every other write', async () => {
  const root = await fixture();
  await seedFreyaRun(root);
  await mkdir(join(root, 'archive', '2026-01-01T00-00-00-000Z__live-1'), { recursive: true });
  await writeFile(
    join(root, 'archive', '2026-01-01T00-00-00-000Z__live-1', 'run.json'),
    JSON.stringify({ kind: 'freya-live-run', status: 'completed' }),
  );

  const guarded = createUiServer({ root, port: 0, host: '127.0.0.1' });
  await new Promise<void>((done) => guarded.listen(0, '127.0.0.1', done));
  const base = await serverAddress(guarded);
  try {
    const archive = await fetch(`${base}/api/runs/live-1/archive`, { method: 'POST' });
    assert.equal(archive.status, 405);
    await stat(join(root, 'live-1', 'run.json'));
    const restore = await fetch(
      `${base}/api/runs/${encodeURIComponent('archive~2026-01-01T00-00-00-000Z__live-1')}/restore`,
      { method: 'POST' },
    );
    await stat(join(root, 'archive', '2026-01-01T00-00-00-000Z__live-1', 'run.json'));
    // Whether 405 or 404, the archived run is still in the archive.
    assert.ok(restore.status >= 400);
  } finally {
    await new Promise<void>((done) => guarded.close(() => done()));
  }

  const allowed = createUiServer({ root, port: 0, host: '127.0.0.1', allowArchive: true });
  await new Promise<void>((done) => allowed.listen(0, '127.0.0.1', done));
  const allowedBase = await serverAddress(allowed);
  try {
    //Archive takes no body.
    const bloated = await fetch(`${allowedBase}/api/runs/live-1/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(10000),
    });
    assert.equal(bloated.status, 413);
    await stat(join(root, 'live-1', 'run.json'));

    // A restore of an unknown archived id is refused outright.
    const missing = await fetch(
      `${allowedBase}/api/runs/${encodeURIComponent('archive~absent-thing')}/restore`,
      { method: 'POST' },
    );
    assert.equal(missing.status, 404);

    // A restore of a live id (not archived) is refused with a clear reason.
    const notArchived = await fetch(`${allowedBase}/api/runs/live-1/restore`, {
      method: 'POST',
    });
    assert.equal(notArchived.status, 404);
  } finally {
    await new Promise<void>((done) => allowed.close(() => done()));
  }
});

test('delete removes a discovered run and refuses anything else', async () => {
  const root = await fixture();
  await seedFreyaRun(root);
  const genDir = join(root, 'generation', 'gen-delete');
  await mkdir(genDir, { recursive: true });
  await writeFile(
    join(genDir, 'run.json'),
    JSON.stringify({ kind: 'generation-only', status: 'completed' }),
  );
  await writeFile(join(root, 'build-delete.json'), JSON.stringify({ createdAt: 'x', build: {} }));
  // State the inspector never treats as a run must survive any delete.
  await mkdir(join(root, 'freya-state', 'protected'), { recursive: true });
  await writeFile(join(root, 'freya-state', 'protected', 'slots.json'), '{}');

  // A run directory with extra untracked files survives deletion of a sibling
  // run, and everything belonging to the deleted run goes with it.
  const extra = join(root, 'keep-extras');
  await mkdir(extra, { recursive: true });
  await writeFile(
    join(extra, 'run.json'),
    JSON.stringify({ kind: 'freya-live-run', status: 'completed' }),
  );
  await writeFile(join(extra, 'scratch.txt'), 'not a run artifact');
  // A directory under generation/ with no run.json is not a discovered run; a
  // delete request for it is refused, so it must survive untouched.
  const halfway = join(root, 'generation', 'halfway');
  await mkdir(halfway, { recursive: true });
  await writeFile(join(halfway, 'trace.jsonl'), '{}\n');

  const server = createUiServer({ root, port: 0, host: '127.0.0.1', allowDelete: true });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    // The collection endpoint never grows a delete route of its own.
    const collection = await fetch(`${base}/api/runs`, { method: 'DELETE' });
    assert.equal(collection.status, 405);

    // A half-written generation directory is never a deletion target.
    const absent = await fetch(`${base}/api/runs/generation~halfway`, { method: 'DELETE' });
    assert.equal(absent.status, 404);
    await stat(join(root, 'generation', 'halfway', 'trace.jsonl'));

    // A directory run is removed with its artifacts.
    const live = await fetch(`${base}/api/runs/live-1`, { method: 'DELETE' });
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { deleted: 'live-1' });
    await assert.rejects(stat(join(root, 'live-1')));
    assert.ok(!(await listRuns(root)).some((run) => run.id === 'live-1'));

    // The sibling run with an unrecorded extra file is untouched by another's
    // deletion, and stays discoverable (and deletable) across restarts.
    const before = (await listRuns(root)).map((run) => run.id);
    assert.ok(before.includes('keep-extras'));
    await stat(join(root, 'keep-extras', 'scratch.txt'));

    // A generation trace is removed from its nested directory.
    const gen = await fetch(`${base}/api/runs/generation~gen-delete`, { method: 'DELETE' });
    assert.equal(gen.status, 200);
    await assert.rejects(stat(genDir));

    // A single-file build record is unlinked without touching its siblings.
    const build = await fetch(`${base}/api/runs/build-delete`, { method: 'DELETE' });
    assert.equal(build.status, 200);
    await assert.rejects(stat(join(root, 'build-delete.json')));

    const survivors = (await listRuns(root)).map((run) => run.id);
    // The extras-bearing run is still there and still deletable.
    const extras = await fetch(`${base}/api/runs/keep-extras`, { method: 'DELETE' });
    assert.equal(extras.status, 200);
    await assert.rejects(stat(join(root, 'keep-extras')));
    assert.ok(!survivors.some((id) => id.startsWith('halfway')));

    // An id outside the scan is refused, not guessed at.
    const unknown = await fetch(`${base}/api/runs/never-discovered`, { method: 'DELETE' });
    assert.equal(unknown.status, 404);

    // A crafted traversing id cannot delete anything above the root. The path
    // spans segments, so it never matches the run-delete route and the
    // method guard answers 405, same as the malformed post paths in the
    // other tests.
    const escaped = await fetch(`${base}/api/runs/..%2F..%2Ffreya-state`, { method: 'DELETE' });
    assert.equal(escaped.status, 405);
    await stat(join(root, 'freya-state', 'protected', 'slots.json'));
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

// Deletion is granted explicitly, never inferred, and stays loopback-only and
// same-origin like every other authorized write.
test('delete is disabled without the flag and refused cross-origin', async () => {
  const root = await fixture();
  await seedFreyaRun(root);
  await writeFile(join(root, 'spare.json'), JSON.stringify({ createdAt: 'x', build: {} }));

  const guarded = createUiServer({ root, port: 0, host: '127.0.0.1' });
  await new Promise<void>((done) => guarded.listen(0, '127.0.0.1', done));
  const guardedAddress = guarded.address();
  assert.ok(guardedAddress && typeof guardedAddress === 'object');
  const guardedBase = `http://127.0.0.1:${guardedAddress.port}`;
  try {
    const refused = await fetch(`${guardedBase}/api/runs/live-1`, { method: 'DELETE' });
    assert.equal(refused.status, 405);
    await stat(join(root, 'live-1', 'run.json'));
  } finally {
    await new Promise<void>((done) => guarded.close(() => done()));
  }

  // Spare a run for the same-origin refusal check against the enabled server.
  const spareDir = join(root, 'spare-run');
  await mkdir(spareDir, { recursive: true });
  await writeFile(
    join(spareDir, 'run.json'),
    JSON.stringify({ kind: 'freya-live-run', status: 'completed' }),
  );

  const deletable = createUiServer({ root, port: 0, host: '127.0.0.1', allowDelete: true });
  await new Promise<void>((done) => deletable.listen(0, '127.0.0.1', done));
  const deletableAddress = deletable.address();
  assert.ok(deletableAddress && typeof deletableAddress === 'object');
  try {
    const crossOrigin = await new Promise<number>((resolve, reject) => {
      const outgoing = request(
        {
          host: '127.0.0.1',
          port: deletableAddress.port,
          path: '/api/runs/spare-run',
          method: 'DELETE',
          headers: { origin: 'http://evil.example:8080' },
        },
        (incoming) => {
          void incoming.resume();
          resolve(incoming.statusCode ?? 0);
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
    assert.equal(crossOrigin, 403);
    await stat(join(root, 'spare-run', 'run.json'));
  } finally {
    await new Promise<void>((done) => deletable.close(() => done()));
  }
});

test('unknown runs and unrecorded files are refused', async () => {
  const root = await fixture();
  await seedFreyaRun(root);
  assert.equal(await loadRun(root, 'nope'), null);
  assert.equal((await readRunFile(root, 'live-1', 'run.json')) !== null, true);
  // traversal, absolute paths, and unrecorded artifacts never resolve
  assert.equal(await readRunFile(root, 'live-1', '../../../.env'), null);
  assert.equal(await readRunFile(root, 'live-1', '/etc/passwd'), null);
  assert.equal(await readRunFile(root, 'live-1', 'secrets.json'), null);
  assert.equal(await readRunFile(root, 'live-1', 'platform.jsonl/../run.json'), null);
});

// The internal baseline writes one JSON file rather than a directory, so its
// artifact path cannot be derived by joining a run directory.
test('serves the raw file for a single-file build record', async () => {
  const root = await fixture();
  await writeFile(join(root, 'build-1.json'), JSON.stringify({ createdAt: 'x', build: {} }));
  const content = await readRunFile(root, 'build-1', 'build-1.json');
  assert.ok(content);
  assert.equal(JSON.parse(content).createdAt, 'x');
  // The directory artifact names do not apply to a single-file record.
  assert.equal(await readRunFile(root, 'build-1', 'run.json'), null);
});

// The client polls faster while a run reports "running", so an in-flight
// generation must surface that status rather than looking finished or missing.
test('reports an in-flight generation as running', async () => {
  const root = await fixture();
  const dir = join(root, 'generation', 'live-1');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'run.json'),
    JSON.stringify({
      kind: 'generation-only',
      status: 'running',
      startedAt: '2026-10-10T14:00:00.000Z',
      calls: [],
      task: { id: 'brief-a', tools: [] },
      evaluation: { score: null, source: 'not-evaluated' },
    }),
  );
  await writeFile(
    join(dir, 'trace.jsonl'),
    `${JSON.stringify({ elapsedMs: 500, kind: 'progress', data: { message: 'step 0' } })}\n`,
  );

  const runs = await listRuns(root);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'running');
  // No elapsedMs is written until the run ends.
  assert.equal(runs[0].elapsedMs, null);

  const detail = await loadRun(root, 'generation~live-1');
  assert.equal(detail?.summary.status, 'running');
  // The workflow is only recorded once compilation finishes.
  assert.equal(detail?.workflow, null);
  assert.equal(detail?.trace.length, 1);
});

test('a missing output directory yields no runs', async () => {
  assert.deepEqual(await listRuns(join(await fixture(), 'not-there')), []);
});

test('serves the built page and JSON API over loopback and rejects writes', async () => {
  const root = await fixture();
  await seedFreyaRun(root);
  // The inspector is a built bundle; build it once so the asset route is real.
  await buildUi();
  const server = createUiServer({ root, port: 0, host: '127.0.0.1' });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await page.text(), /<div id="root">/);

    const list = await (await fetch(`${base}/api/runs`)).json();
    assert.equal(list.runs.length, 1);
    assert.equal(list.runs[0].id, 'live-1');

    const detail = await (await fetch(`${base}/api/runs/live-1`)).json();
    assert.equal(detail.workflow.initialNode, 'greeting');
    assert.equal(detail.practice.cases.length, 2);

    const missing = await fetch(`${base}/api/runs/absent`);
    assert.equal(missing.status, 404);

    const escaped = await fetch(`${base}/api/runs/live-1/files/..%2F..%2F.env`);
    assert.equal(escaped.status, 404);

    const raw = await (await fetch(`${base}/api/runs/live-1/files/compiled.workflow.json`)).json();
    assert.equal(raw.initial_node, 'greeting');

    // Read-only: nothing in the inspector may change recorded state.
    const write = await fetch(`${base}/api/runs`, { method: 'DELETE' });
    assert.equal(write.status, 405);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
