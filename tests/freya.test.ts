import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { FreyaBridge } from '../src/freya.ts';

const kit = resolve('build-the-builder');

test('original client and scorer complete lifecycle against a synthetic injected transport, with slot reuse and no auth in trace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'freya-bridge-test-'));
  const caseFixture = JSON.parse(await readFile(join(kit, 'public-test-set.json'), 'utf8'))[0];
  const secondCase = JSON.parse(await readFile(join(kit, 'public-test-set.json'), 'utf8'))[1];
  const requestLog = join(directory, 'requests.jsonl');
  const workflow = {
    initial_node: 'done',
    nodes: { done: { name: 'done', node_type: 'end_call', transitions: [] } },
  };
  await writeFile(join(directory, 'fixture.json'), JSON.stringify({ case: caseFixture, workflow }));
  // Python's startup hook injects an in-memory urllib transport. No sockets or real services.
  await writeFile(
    join(directory, 'sitecustomize.py'),
    `
import io, json, os, pathlib, time, urllib.request
root = pathlib.Path(os.environ['SYNTHETIC_TRANSPORT_ROOT'])
fixture = json.loads((root / 'fixture.json').read_text())
state = root / 'transport-state.json'
time.sleep = lambda seconds: None

def urlopen(request, **kwargs):
    from urllib.parse import urlparse
    path = urlparse(request.full_url).path
    method = request.get_method()
    body = json.loads(request.data) if request.data else None
    with (root / 'requests.jsonl').open('a') as out:
        out.write(json.dumps({'method': method, 'path': path, 'body': body}) + '\\n')
    workflow = json.loads(state.read_text()) if state.exists() else fixture['workflow']
    bank = False
    if path == '/api/v2/workspaces':
        result = {'workspaces': [{'id': 'synthetic-workspace', 'name': 'Offline fixture'}]}
    elif path == '/api/v2/workflow' and method == 'POST':
        if 'dryRun' not in request.full_url:
            state.write_text(json.dumps(body['workflow']))
            if os.environ.get('SYNTHETIC_FAIL_CREATE'):
                raise RuntimeError('Synthetic timeout after remote create')
        result = {'workflow': {'id': 'synthetic-workflow', 'agentId': 'synthetic-agent'}}
    elif path == '/api/v2/workflow/synthetic-workflow':
        if method == 'PUT':
            workflow = body['workflow']
            state.write_text(json.dumps(workflow))
        result = {'workflow': {'id': 'synthetic-workflow', 'agentId': 'synthetic-agent', 'workflow': {**workflow, 'agent_config': {'llmConfig': {'provider': 'experimental-5', 'model': 'experimental-5'}}}}}
    elif path == '/api/v2/versions/workflow/synthetic-workflow':
        result = {'versions': [{'id': 'v2', 'versionNumber': 2, 'isPublished': False}]}
    elif path.endswith('/publish'):
        result = {}
    elif path == '/api/v2/personas':
        result = {'personas': [{'id': 'synthetic-persona' if i == 0 else 'synthetic-persona-%d' % i} for i in range(len(body['personas']))]}
    elif path == '/api/v2/simulations':
        assert body['assistantLlmOverride'] == {'provider': 'experimental-5', 'model': 'experimental-5'}
        state.write_text(json.dumps({'personas': body['selectedPersonaIds']}))
        result = {'simulation': {'id': 'synthetic-simulation'}}
    elif path == '/api/v2/simulations/synthetic-simulation':
        result = {'simulation': {'status': 'completed'}}
    elif path.endswith('/iterations'):
        result = {'iterations': [{'id': 'synthetic-iteration'}]}
    elif path.endswith('/iterations/synthetic-iteration'):
        personas = json.loads(state.read_text()).get('personas', ['synthetic-persona']) if state.exists() else ['synthetic-persona']
        result = {'runs': [{'personaId': p, 'outcome': 'inconclusive' if os.environ.get('SYNTHETIC_INCONCLUSIVE') else 'pass', 'callId': 'synthetic-call'} for p in personas]}
    elif path == '/api/v2/call/synthetic-call':
        if os.environ.get('SYNTHETIC_SILENT_MODEL'):
            # The agent speaks its opening line and the customer hangs up: no reply ever
            # follows a customer turn, so every slowest_turn_s stays 0.
            result = {'call': {'endedReason': 'customer-ended-call', 'messages': [
                {'role': 'assistant', 'message': 'Opening line.', 'secondsFromStart': 0.4},
                {'role': 'user', 'message': 'Yes, this is the customer.', 'secondsFromStart': 2.5},
            ]}}
        else:
            result = {'call': {'messages': [{'role': 'system', 'message': json.dumps({'headers': {'Authorization': 'Bearer synthetic-secret', 'x-team-key': 'synthetic-team-secret'}, 'event': 'synthetic'})}]}}
    elif path == '/v1/practice/sessions':
        bank = True
        result = {'variables': {**fixture['case']['variables'], 'customer_id': 'synthetic-customer'}}
    elif path == '/v1/practice/ledger/synthetic-customer':
        bank = True
        result = {**fixture['case']['expected'], 'calls': [{'tool': 'close_call', 'result': {'ok': True}}]}
    else:
        raise RuntimeError('Unexpected synthetic transport request: ' + path)
    return io.BytesIO(json.dumps(result if bank else {'success': True, 'data': {'result': result}}).encode())

urllib.request.urlopen = urlopen
`,
  );
  const host = 'https://synthetic.invalid';
  const trace = join(directory, 'trace.jsonl');
  const bridge = new FreyaBridge(kit, trace, {
    ...process.env,
    PYTHONPATH: directory,
    SYNTHETIC_TRANSPORT_ROOT: directory,
    FREYA_API_KEY: 'synthetic-secret',
    FREYA_BANK_TEAM_KEY: 'synthetic-team-secret',
    FREYA_WORKSPACE_ID: 'synthetic-workspace',
    FREYA_API_URL: host,
    FREYA_BANK_HOST: host,
  });
  const call = (action: string, data: Record<string, unknown>) =>
    bridge.call(action, data, AbortSignal.timeout(30000), 30000);
  try {
    assert.equal((await call('probe', {})).workspaceId, 'synthetic-workspace');
    await call('validate', { slot: 'fixture', workflow });
    const stateFile = join(directory, 'slots.json');
    await call('register', { slot: 'fixture', workflow, stateFile });
    await call('register', { slot: 'fixture', workflow, stateFile });
    const requests = (await readFile(requestLog, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(
      requests.filter((item) => item.method === 'POST' && item.path === '/api/v2/workflow').length,
      2,
    ); // one dry run + one creation
    assert.ok(
      requests.some((item) => item.path.endsWith('/publish') && item.body.versionId === 'v2'),
    );
    const exported = join(directory, 'exported.json');
    await call('export', { workflowId: 'synthetic-workflow', path: exported });
    assert.equal(JSON.parse(await readFile(exported, 'utf8')).workflow_id, 'synthetic-workflow');
    const practice = await call('practice', {
      agentId: 'synthetic-agent',
      casesPath: join(kit, 'public-test-set.json'),
      cacheDir: join(directory, 'practice-cache'),
      path: join(directory, 'practice.json'),
      only: caseFixture.id,
    });
    assert.equal(practice.passed, 1); // synthetic server verdict; not an official benchmark score
    assert.equal(practice.total, 1);
    const beforeRecovery = (await readFile(requestLog, 'utf8')).trim().split('\n').length;
    const recovered = await call('recover-practice', {
      agentId: 'synthetic-agent',
      workspaceId: 'synthetic-workspace',
      casesPath: join(kit, 'public-test-set.json'),
      path: join(directory, 'recovered.json'),
      only: caseFixture.id,
      repetitions: 1,
      startedAt: '2000-01-01T00:00:00Z',
      endedAt: '2100-01-01T00:00:00Z',
    });
    assert.equal(recovered.passed, 1);
    assert.equal(recovered.total, 1);
    assert.equal(recovered.recovered, true);
    assert.deepEqual(recovered.all_rows, practice.all_rows);
    const recoveryRequests = (await readFile(requestLog, 'utf8'))
      .trim()
      .split('\n')
      .slice(beforeRecovery)
      .map((line) => JSON.parse(line));
    assert.ok(recoveryRequests.length > 0);
    assert.ok(recoveryRequests.every((entry) => entry.method === 'GET'));
    const inconsistentBridge = new FreyaBridge(kit, trace, {
      ...bridge.env,
      SYNTHETIC_INCONCLUSIVE: '1',
    });
    await assert.rejects(
      inconsistentBridge.call(
        'recover-practice',
        {
          agentId: 'synthetic-agent',
          workspaceId: 'synthetic-workspace',
          casesPath: join(kit, 'public-test-set.json'),
          path: join(directory, 'inconclusive.json'),
          only: caseFixture.id,
          repetitions: 1,
          startedAt: '2000-01-01T00:00:00Z',
          endedAt: '2100-01-01T00:00:00Z',
        },
        AbortSignal.timeout(30000),
        30000,
      ),
      /incomplete judge verdicts/,
    );
    await assert.rejects(() => readFile(join(directory, 'inconclusive.json')));
    await assert.rejects(
      inconsistentBridge.call(
        'practice',
        {
          agentId: 'synthetic-agent',
          casesPath: join(kit, 'public-test-set.json'),
          cacheDir: join(directory, 'practice-cache'),
          path: join(directory, 'incomplete-practice.json'),
          only: caseFixture.id,
        },
        AbortSignal.timeout(30000),
        30000,
      ),
      /incomplete judge verdicts/,
    );
    await assert.rejects(() => readFile(join(directory, 'incomplete-practice.json')));
    // A run in which the agent model never answered measured the platform, not the agent.
    // Recorded 2026-10-11: two builds scored 0/10 for exactly this reason, which was then
    // read as a builder regression. It must fail loudly instead of becoming a score.
    const silentBridge = new FreyaBridge(kit, trace, {
      ...bridge.env,
      SYNTHETIC_SILENT_MODEL: '1',
    });
    await assert.rejects(
      silentBridge.call(
        'practice',
        {
          agentId: 'synthetic-agent',
          casesPath: join(kit, 'public-test-set.json'),
          cacheDir: join(directory, 'silent-practice-cache'),
          path: join(directory, 'silent-practice.json'),
          only: [caseFixture.id, secondCase.id].join(','),
        },
        AbortSignal.timeout(30000),
        30000,
      ),
      /measured the platform model rather than the agent/,
    );
    await assert.rejects(() => readFile(join(directory, 'silent-practice.json')));
    const repeated = await call('practice', {
      agentId: 'synthetic-agent',
      casesPath: join(kit, 'public-test-set.json'),
      cacheDir: join(directory, 'practice-cache'),
      path: join(directory, 'practice-three.json'),
      only: caseFixture.id,
      repetitions: 3,
    });
    assert.equal(repeated.runs, 3);
    assert.equal(repeated.passed, 1);
    assert.equal(repeated.final[0].passes, 3);
    assert.equal(repeated.all_rows.length, 3);
    const log = await readFile(trace, 'utf8');
    assert.equal(log.includes('synthetic-secret'), false);
    assert.equal(log.includes('synthetic-team-secret'), false);
    assert.equal(log.includes('Authorization'), false);
    assert.equal(log.includes('x-team-key'), false);

    const uncertainState = join(directory, 'uncertain-slots.json');
    const failingBridge = new FreyaBridge(kit, trace, {
      ...bridge.env,
      SYNTHETIC_FAIL_CREATE: '1',
    });
    await assert.rejects(
      failingBridge.call(
        'register',
        { slot: 'uncertain', workflow, stateFile: uncertainState },
        AbortSignal.timeout(30000),
        30000,
      ),
      /Synthetic timeout after remote create/,
    );
    const attempts = (await readFile(requestLog, 'utf8')).trim().split('\n').length;
    await assert.rejects(
      call('register', { slot: 'uncertain', workflow, stateFile: uncertainState }),
      /uncertain result/,
    );
    assert.equal((await readFile(requestLog, 'utf8')).trim().split('\n').length, attempts);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
