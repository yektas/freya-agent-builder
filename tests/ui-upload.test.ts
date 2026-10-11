// Offline tests for the upload action. The platform transport is injected through
// Python's startup hook: no socket is opened and no credential is real. The cases
// cover a successful registration, a repeated click, a rejected dry run, an
// uncertain create, credential redaction, unknown runs, and cross-origin
// requests.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { loadRun } from '../src/ui/records.ts';
import { createUiServer } from '../src/ui/server.ts';
import { uploadSlot } from '../src/ui/upload.ts';
import type { UploadView } from '../src/ui/upload.ts';

const kit = resolve('build-the-builder');
const SECRET = 'synthetic-freya-key';

const roots: string[] = [];
const servers: Server[] = [];
after(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true });
  }
  for (const server of servers) {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

// The organizer client decides what happens per workflow, so the fixture selects
// the scenario from the compiled document's initial node. Every answer here is
// synthetic; none of it is a platform or benchmark result.
const TRANSPORT = `
import io, json, os, pathlib, time, urllib.error, urllib.request
root = pathlib.Path(os.environ['SYNTHETIC_TRANSPORT_ROOT'])
requests = root / 'requests.jsonl'
remote = root / 'remote.json'
sleep = time.sleep
time.sleep = lambda seconds: None


def reply(result):
    return io.BytesIO(json.dumps({'success': True, 'data': {'result': result}}).encode())


def urlopen(request, **kwargs):
    parsed = urllib.parse.urlparse(request.full_url)
    body = json.loads(request.data) if request.data else None
    node = (body or {}).get('workflow', {}).get('initial_node')
    with requests.open('a') as out:
        out.write(json.dumps({'method': request.get_method(), 'path': parsed.path,
                              'query': parsed.query, 'initial_node': node}) + '\\n')
    if node == 'slow':
        # Ignores the abort signal, exactly like a call the platform never
        # answers; the caller has to stop waiting on its own deadline.
        sleep(5)
    if parsed.path == '/api/v2/workspaces':
        return reply({'workspaces': [{'id': 'synthetic-workspace', 'name': 'Offline fixture'}]})
    if parsed.path == '/api/v2/workflow' and request.get_method() == 'POST':
        if 'dryRun' in parsed.query:
            if node == 'reject':
                # A rejected dry run, echoing the request headers the way a real
                # error body can.
                raise urllib.error.HTTPError(request.full_url, 400, 'Bad Request', {},
                                             io.BytesIO(json.dumps({'error': 'node_schema invalid',
                                                                    'headers': dict(request.headers)}).encode()))
            return reply({'workflow': {'id': 'synthetic-workflow', 'agentId': 'synthetic-agent'}})
        if node == 'lost':
            # Freya stored the workflow; the response is lost before the id arrives.
            remote.write_text(json.dumps({'workflow': body['workflow'], 'creates': 1}))
            raise TimeoutError('synthetic timeout after remote create')
        creates = (json.loads(remote.read_text())['creates'] + 1) if remote.exists() else 1
        remote.write_text(json.dumps({'workflow': body['workflow'], 'creates': creates}))
        return reply({'workflow': {'id': 'synthetic-workflow', 'agentId': 'synthetic-agent'}})
    if parsed.path == '/api/v2/workflow/synthetic-workflow':
        if request.get_method() == 'PUT':
            remote.write_text(json.dumps({'workflow': body['workflow'], 'creates': 0}))
        stored = json.loads(remote.read_text())['workflow'] if remote.exists() else {}
        return reply({'workflow': {'id': 'synthetic-workflow', 'agentId': 'synthetic-agent',
                                   'workflow': {**stored, 'agent_config': {'llmConfig': {
                                       'provider': 'experimental-5', 'model': 'experimental-5'}}}}})
    if parsed.path == '/api/v2/versions/workflow/synthetic-workflow':
        return reply({'versions': [{'id': 'synthetic-version', 'versionNumber': 2, 'isPublished': False}]})
    if parsed.path.endswith('/publish'):
        return reply({})
    raise RuntimeError('Unexpected synthetic transport request: ' + parsed.path)


urllib.request.urlopen = urlopen
`;

type Request = {
  method: string;
  path: string;
  query: string;
  initial_node: string | null;
};

type Harness = {
  root: string;
  transport: string;
  base: string;
  requests: () => Promise<Request[]>;
  /** Remote creations only: a dry run shares the create route. */
  creates: () => Promise<number>;
};

async function harness(
  options: {
    uploadEnv?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {},
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'freya-upload-'));
  roots.push(root);
  // The transport lives in its own directory so its request log is never
  // mistaken for a run record by the inspector's own scan.
  const transport = join(root, 'transport');
  await mkdir(transport, { recursive: true });
  await writeFile(join(transport, 'sitecustomize.py'), TRANSPORT);
  for (const node of ['accept', 'reject', 'lost', 'empty', 'slow']) {
    const dir = join(root, 'generation', `gen-${node}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'run.json'),
      JSON.stringify({
        kind: 'generation-only',
        runId: `gen-${node}`,
        status: 'completed',
        startedAt: '2026-10-10T12:00:00.000Z',
        config: { briefs: ['build-the-builder/briefs/brief-a.md'] },
        evaluation: { score: null, source: 'not-evaluated' },
      }),
    );
    if (node !== 'empty') {
      await writeFile(join(dir, 'compiled.workflow.json'), compiled(node));
    }
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: transport,
    SYNTHETIC_TRANSPORT_ROOT: transport,
    FREYA_API_KEY: SECRET,
    FREYA_WORKSPACE_ID: 'synthetic-workspace',
    ...options.uploadEnv,
  } as NodeJS.ProcessEnv;
  const server = createUiServer({
    root,
    port: 0,
    host: '127.0.0.1',
    upload: { root, kit, env, timeoutMs: options.timeoutMs ?? 30000 },
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const value: Harness = {
    root,
    transport,
    base: `http://127.0.0.1:${address.port}`,
    requests: async () => {
      try {
        return (await readFile(join(transport, 'requests.jsonl'), 'utf8'))
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Request);
      } catch {
        return [];
      }
    },
    creates: async () =>
      (await value.requests()).filter(
        (item) =>
          item.method === 'POST' &&
          item.path === '/api/v2/workflow' &&
          !item.query.includes('dryRun'),
      ).length,
  };
  return value;
}

function compiled(initialNode: string, prompt = 'You are a bank agent.'): string {
  return JSON.stringify(
    {
      initial_node: initialNode,
      system_prompt: prompt,
      nodes: {
        [initialNode]: { node_type: 'end_call', task_message: 'Close the call.', transitions: [] },
      },
    },
    null,
    2,
  );
}

type Body = { error?: string; upload?: UploadView | null };

async function post(
  base: string,
  id: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Body }> {
  const response = await fetch(`${base}/api/runs/${encodeURIComponent(id)}/upload`, {
    method: 'POST',
    headers,
  });
  return { status: response.status, body: (await response.json()) as Body };
}

test('registers a compiled workflow, records it, and survives a refresh', async () => {
  const h = await harness();
  const availability = await (await fetch(`${h.base}/api/upload`)).json();
  assert.equal(availability.available, true);
  assert.equal(availability.problem, null);

  const first = await post(h.base, 'generation~gen-accept');
  assert.equal(first.status, 200);
  const upload = first.body.upload!;
  assert.equal(upload.status, 'registered');
  assert.equal(upload.stage, 'done');
  assert.equal(upload.workflowId, 'synthetic-workflow');
  assert.equal(upload.agentId, 'synthetic-agent');
  assert.equal(upload.reused, false);
  assert.equal(upload.slot, uploadSlot('generation~gen-accept'));
  assert.equal(upload.workspaceId, 'synthetic-workspace');
  assert.ok(upload.exportedPath?.endsWith('exported.workflow.json'));
  // No credential reaches the browser.
  assert.equal(JSON.stringify(first.body).includes(SECRET), false);

  // Workspace verification, platform dry run, registration, then export. The
  // export runs in its own bridge process, which resolves the workspace itself.
  assert.deepEqual(
    (await h.requests()).map((item) => `${item.method} ${item.path}`),
    [
      'GET /api/v2/workspaces',
      'POST /api/v2/workflow',
      'POST /api/v2/workflow',
      'GET /api/v2/workspaces',
      'GET /api/v2/workflow/synthetic-workflow',
    ],
  );
  // The dry run stored nothing; exactly one workflow was created.
  assert.equal(await h.creates(), 1);

  // The stored document is the compiled one, unchanged.
  const stored = JSON.parse(await readFile(upload.exportedPath!, 'utf8')) as Record<string, any>;
  assert.equal(stored.workflow.initial_node, 'accept');
  assert.equal(stored.agent_id, 'synthetic-agent');

  // The result is recorded beside the run, so a refresh shows it without asking
  // the platform again.
  const detail = await loadRun(h.root, 'generation~gen-accept');
  assert.equal(detail?.upload?.status, 'registered');
  assert.equal(detail?.upload?.workflowId, 'synthetic-workflow');
  assert.equal(detail?.upload?.agentId, 'synthetic-agent');
  assert.equal(
    detail?.summary.files.some((file) => file.name === 'upload.json'),
    true,
  );
  const served = await fetch(
    `${h.base}/api/runs/${encodeURIComponent('generation~gen-accept')}/files/upload.json`,
  );
  assert.equal(served.status, 200);
  assert.equal(((await served.json()) as UploadView).agentId, 'synthetic-agent');
});

test('a repeated click returns the recorded registration instead of creating again', async () => {
  const h = await harness();
  const first = await post(h.base, 'generation~gen-accept');
  assert.equal(first.status, 200);
  const creates = await h.creates();

  // A sequential click and two concurrent clicks all share one answer.
  const second = await post(h.base, 'generation~gen-accept');
  const [third, fourth] = await Promise.all([
    post(h.base, 'generation~gen-accept'),
    post(h.base, 'generation~gen-accept'),
  ]);
  for (const repeat of [second, third, fourth]) {
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.upload?.status, 'registered');
    assert.equal(repeat.body.upload?.reused, true);
    assert.equal(repeat.body.upload?.workflowId, first.body.upload?.workflowId);
    assert.equal(repeat.body.upload?.agentId, first.body.upload?.agentId);
  }
  assert.equal(await h.creates(), creates);

  // The slot state is workspace-scoped and the run directory keeps no lock.
  const state = JSON.parse(
    await readFile(join(h.root, 'freya-state', 'synthetic-workspace', 'slots.json'), 'utf8'),
  ) as Record<string, { workflow_id: string; agent_id: string }>;
  assert.deepEqual(Object.keys(state), [uploadSlot('generation~gen-accept')]);
  assert.equal(state[uploadSlot('generation~gen-accept')].workflow_id, 'synthetic-workflow');
  await assert.rejects(() =>
    readFile(join(h.root, 'freya-state', 'synthetic-workspace', 'workspace.lock'), 'utf8'),
  );

  // A changed document is registered into the same workflow and published; the
  // repeated click is not what makes it safe, the stable slot is.
  await writeFile(
    join(h.root, 'generation', 'gen-accept', 'compiled.workflow.json'),
    compiled('accept', 'You are a bank agent. Always confirm the transfer amount.'),
  );
  const changed = await post(h.base, 'generation~gen-accept');
  assert.equal(changed.status, 200);
  assert.equal(changed.body.upload?.status, 'registered');
  assert.equal(changed.body.upload?.reused, false);
  assert.equal(changed.body.upload?.workflowId, 'synthetic-workflow');
  assert.equal(changed.body.upload?.version, 2);
  assert.equal(await h.creates(), creates);
  const paths = (await h.requests()).map((item) => `${item.method} ${item.path}`);
  assert.equal(paths.includes('PUT /api/v2/workflow/synthetic-workflow'), true);
  assert.equal(paths.includes('POST /api/v2/versions/workflow/synthetic-workflow/publish'), true);
});

test('a rejected dry run stops before any creation and says what failed', async () => {
  const h = await harness();
  const response = await post(h.base, 'generation~gen-reject');
  assert.equal(response.status, 422);
  assert.match(response.body.error ?? '', /node_schema invalid/);
  const upload = response.body.upload!;
  assert.equal(upload.status, 'failed');
  assert.equal(upload.stage, 'validate');
  assert.equal(upload.workflowId, null);

  // Only the dry run was sent; nothing was stored remotely.
  assert.equal((await h.requests()).filter((item) => item.method === 'POST').length, 1);
  assert.equal(await h.creates(), 0);

  // The failure is recorded, the lock is released, and a retry is possible.
  const recorded = JSON.parse(
    await readFile(join(h.root, 'generation', 'gen-reject', 'upload.json'), 'utf8'),
  ) as UploadView;
  assert.equal(recorded.status, 'failed');
  assert.equal(recorded.stage, 'validate');
  assert.equal(recorded.error?.includes(SECRET), false);
  assert.equal((await loadRun(h.root, 'generation~gen-reject'))?.upload?.status, 'failed');
  await assert.rejects(() =>
    readFile(join(h.root, 'freya-state', 'synthetic-workspace', 'workspace.lock'), 'utf8'),
  );
});

test('an uncertain create refuses another attempt until it is reconciled', async () => {
  const h = await harness();
  const response = await post(h.base, 'generation~gen-lost');
  assert.equal(response.status, 409);
  assert.equal(response.body.upload?.status, 'uncertain');
  assert.equal(response.body.upload?.stage, 'register');
  const creates = await h.creates();

  const retry = await post(h.base, 'generation~gen-lost');
  assert.equal(retry.status, 409);
  assert.match(retry.body.error ?? '', /reconcile/i);
  // The platform was not asked again, so no second remote agent can appear.
  assert.equal(await h.creates(), creates);

  const pending = join(
    h.root,
    'freya-state',
    'synthetic-workspace',
    `slots.json.${uploadSlot('generation~gen-lost')}.pending`,
  );
  assert.ok((await readFile(pending, 'utf8')).length > 0);
  // The answer names the marker, so the next step is actionable.
  assert.ok((retry.body.error ?? '').includes(pending));
  assert.equal((await loadRun(h.root, 'generation~gen-lost'))?.upload?.status, 'uncertain');
});

test('credentials never reach the response, the record, or the platform trace', async () => {
  const h = await harness();
  // The rejection path is the one that echoes request headers back, including
  // the Authorization header that carries the key.
  const response = await post(h.base, 'generation~gen-reject');
  assert.equal(response.status, 422);
  assert.equal(JSON.stringify(response.body).includes(SECRET), false);
  const recorded = await readFile(join(h.root, 'generation', 'gen-reject', 'upload.json'), 'utf8');
  const trace = await readFile(join(h.root, 'generation', 'gen-reject', 'platform.jsonl'), 'utf8');
  for (const [name, text] of [
    ['response', JSON.stringify(response.body)],
    ['record', recorded],
    ['trace', trace],
  ]) {
    assert.equal(text.includes(SECRET), false, `${name} leaked the key`);
    // No auth material survives, whatever key carried it.
    assert.equal(/bearer\s+(?!\[REDACTED\])\S+/i.test(text), false, `${name} leaked a token`);
  }
  // The platform error is preserved, so the failure stays diagnosable.
  assert.match(recorded, /node_schema invalid/);
  assert.match(trace, /\[REDACTED\]/);
});

test('unknown runs, runs without a compiled workflow, and missing credentials are refused', async () => {
  const h = await harness();
  const unknown = await post(h.base, 'generation~gen-absent');
  assert.equal(unknown.status, 404);
  // A traversal is not a discovered run id; after decoding it no longer names
  // the upload route at all, so it is refused as a write to a read-only path.
  const escaped = await fetch(`${h.base}/api/runs/..%2F..%2Fetc/upload`, { method: 'POST' });
  assert.equal(escaped.status, 405);
  const empty = await post(h.base, 'generation~gen-empty');
  assert.equal(empty.status, 404);
  assert.match(empty.body.error ?? '', /compiled\.workflow\.json/);
  // Nothing reached the platform for any refused request.
  assert.deepEqual(await h.requests(), []);

  const withoutKey = await harness({ uploadEnv: { ...process.env, FREYA_API_KEY: '' } });
  const availability = await (await fetch(`${withoutKey.base}/api/upload`)).json();
  assert.equal(availability.available, false);
  assert.match(availability.problem, /FREYA_API_KEY/);
  const refused = await post(withoutKey.base, 'generation~gen-accept');
  assert.equal(refused.status, 503);
  assert.match(refused.body.error ?? '', /FREYA_API_KEY/);
  assert.deepEqual(await withoutKey.requests(), []);
});

test('a cross-origin or cross-site upload is refused before any platform call', async () => {
  const h = await harness();
  const cross = await post(h.base, 'generation~gen-accept', {
    origin: 'https://attacker.example',
  });
  assert.equal(cross.status, 403);
  const fetched = await post(h.base, 'generation~gen-accept', { 'sec-fetch-site': 'cross-site' });
  assert.equal(fetched.status, 403);
  const malformed = await post(h.base, 'generation~gen-accept', { origin: 'not a url' });
  assert.equal(malformed.status, 403);
  assert.deepEqual(await h.requests(), []);

  // The same-origin click that follows still works.
  const accepted = await post(h.base, 'generation~gen-accept', { origin: h.base });
  assert.equal(accepted.status, 200);
});

test('a workspace lock held by another run refuses the upload', async () => {
  const h = await harness();
  const stateRoot = join(h.root, 'freya-state', 'synthetic-workspace');
  await mkdir(stateRoot, { recursive: true });
  await writeFile(join(stateRoot, 'workspace.lock'), JSON.stringify({ pid: 1, run: 'other' }));

  const response = await post(h.base, 'generation~gen-accept');
  assert.equal(response.status, 409);
  assert.match(response.body.error ?? '', /locked by another run/i);
  assert.match(response.body.error ?? '', /workspace\.lock/);
  // Verification happened; nothing was registered.
  assert.equal(await h.creates(), 0);
  // The lock is left exactly as it was found.
  assert.equal(
    await readFile(join(stateRoot, 'workspace.lock'), 'utf8'),
    JSON.stringify({ pid: 1, run: 'other' }),
  );
});

test('a platform that never answers is stopped by the operation deadline', async () => {
  const h = await harness({ timeoutMs: 1000 });
  const started = Date.now();
  const response = await post(h.base, 'generation~gen-slow');
  // A gateway timeout, not a rejected document: the caller stopped waiting.
  assert.equal(response.status, 504);
  assert.match(response.body.error ?? '', /deadline/i);
  // The upload stopped on its own budget rather than waiting for the platform.
  assert.ok(Date.now() - started < 10000, `waited ${Date.now() - started} ms`);
  assert.equal(response.body.upload?.status, 'failed');
  assert.equal(await h.creates(), 0);
  // The workspace lock was released, so the next run is not blocked by this one.
  await assert.rejects(() =>
    readFile(join(h.root, 'freya-state', 'synthetic-workspace', 'workspace.lock'), 'utf8'),
  );
});

test('the console link answers the api origin, or a configured workflow template', async () => {
  // No FREYA_API_URL in the injected env: no link can exist, rather than one
  // pointing at the default production host.
  const bare = await harness({
    uploadEnv: {
      ...process.env,
      FREYA_API_KEY: SECRET,
      FREYA_WORKSPACE_ID: 'synthetic-workspace',
      FREYA_API_URL: '',
      FREYA_WORKFLOW_URL: '',
    },
  });
  const empty = await (await fetch(`${bare.base}/api/upload`)).json();
  assert.deepEqual(empty.consoleUrl, null);
  assert.equal(empty.exact, false);

  // The dashboard origin is the honest fallback when no deep route is known.
  const origin = await harness({
    uploadEnv: {
      ...process.env,
      FREYA_API_KEY: SECRET,
      FREYA_WORKSPACE_ID: 'synthetic-workspace',
      FREYA_API_URL: 'https://staging-app.freyavoice.ai',
      FREYA_WORKFLOW_URL: '',
    },
  });
  const fallback = await (await fetch(`${origin.base}/api/upload`)).json();
  assert.equal(fallback.consoleUrl, 'https://staging-app.freyavoice.ai');
  assert.equal(fallback.exact, false);

  // A configured template is marked exact, so the UI substitutes run ids into
  // it client-side. The template itself carries no ids and no secret.
  const templated = await harness({
    uploadEnv: {
      ...process.env,
      FREYA_API_KEY: SECRET,
      FREYA_WORKSPACE_ID: 'synthetic-workspace',
      FREYA_API_URL: 'https://staging-app.freyavoice.ai',
      FREYA_WORKFLOW_URL: 'https://staging-app.freyavoice.ai/workflows/{workflowId}',
    },
  });
  const exact = await (await fetch(`${templated.base}/api/upload`)).json();
  assert.equal(exact.consoleUrl, 'https://staging-app.freyavoice.ai/workflows/{workflowId}');
  assert.equal(exact.exact, true);
  // Registering still works with a template configured.
  const uploaded = await post(templated.base, 'generation~gen-accept');
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.upload?.workflowId, 'synthetic-workflow');
});

test('recorded runs stay read-only: only the upload route accepts a write', async () => {
  const h = await harness();
  const deleted = await fetch(`${h.base}/api/runs`, { method: 'DELETE' });
  assert.equal(deleted.status, 405);
  const run = await fetch(`${h.base}/api/runs/generation~gen-accept`, { method: 'POST' });
  assert.equal(run.status, 405);
  // The artifact route is GET-only and still serves discovered names only.
  const artifact = await fetch(
    `${h.base}/api/runs/generation~gen-accept/files/compiled.workflow.json`,
  );
  assert.equal(artifact.status, 200);
  const refused = await fetch(`${h.base}/api/runs/generation~gen-accept/files/..%2F..%2F.env`, {
    method: 'POST',
  });
  assert.equal(refused.status, 405);
  // A run that was never uploaded reports no registration.
  assert.equal((await loadRun(h.root, 'generation~gen-reject'))?.upload, null);
});
