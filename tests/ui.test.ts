// Offline tests for the inspector: fixtures are written to a temp directory and
// no model, platform, or network call is made.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { discoverRuns, listRuns, loadRun, readRunFile } from '../src/ui/records.ts';
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

test('surfaces recorded token usage and prices runs that never recorded a cost', async () => {
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
  // A run recorded before usage tracking: only the provider's own payload remains.
  const legacy = join(root, 'legacy');
  await mkdir(legacy, { recursive: true });
  await writeFile(
    join(legacy, 'run.json'),
    JSON.stringify({
      kind: 'generation-only',
      status: 'completed',
      startedAt: '2026-10-09T12:00:00.000Z',
      task: { id: 'brief-b', tools: [] },
      config: { model: 'gpt-5' },
      calls: [
        {
          endpoint: 'responses',
          request: {},
          elapsedMs: 1000,
          response: {
            status: 'completed',
            usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600 },
          },
        },
      ],
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

  // Tokens recovered from the recorded response; cost derived and labeled as such.
  const legacyRun = summaries.find((run) => run.id === 'legacy');
  assert.equal(legacyRun?.usage?.totalTokens, 600);
  assert.equal(legacyRun?.usage?.costSource, 'estimated');
  // 500 input at $1.25/M + 100 output at $10/M.
  assert.ok(Math.abs((legacyRun?.usage?.usd ?? 0) - (500 * 0.00000125 + 100 * 0.00001)) < 1e-12);

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
  assert.equal(workflow.source, 'compiled');
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
      workflow,
    }),
  );
  await writeFile(join(dir, 'compiled.workflow.json'), JSON.stringify(workflow, null, 2));

  const summary = (await listRuns(root))[0];
  // The workflow JSON is discoverable as a served artifact.
  assert.ok(summary.files.some((file) => file.name === 'compiled.workflow.json'));

  const detail = await loadRun(root, 'generation~gen-workflow');
  assert.equal(detail?.workflow?.source, 'compiled');
  // Byte-for-byte the recorded document, so it can be submitted as generated.
  assert.equal(detail?.workflowJson, JSON.stringify(workflow, null, 2));
  assert.equal(JSON.parse(detail?.workflowJson ?? '{}').initial_node, 'greeting');
});

// Runs recorded before the standalone artifact existed still expose the workflow
// embedded in run.json, so no recorded run becomes unreadable.
test('falls back to the workflow embedded in the run record', async () => {
  const root = await fixture();
  const dir = join(root, 'generation', 'gen-legacy');
  await mkdir(dir, { recursive: true });
  const workflow = {
    initial_node: 'only',
    nodes: { only: { node_type: 'end_call', transitions: [] } },
  };
  await writeFile(
    join(dir, 'run.json'),
    JSON.stringify({ kind: 'generation-only', status: 'completed', workflow }),
  );

  const detail = await loadRun(root, 'generation~gen-legacy');
  assert.equal(detail?.workflow?.source, 'recorded');
  assert.equal(detail?.workflowJson, JSON.stringify(workflow, null, 2));
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
