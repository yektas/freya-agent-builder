import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FreyaClient, redactConfig } from '../src/freya-client.ts';
const signal = () => AbortSignal.timeout(1000);

test('public probe output removes nested credential fields without mutating defaults', () => {
  const config = {
    llmConfig: { apiKey: 'private', model: 'example' },
    integrations: [{ access_token: 'private', name: 'service' }],
  };
  assert.equal(JSON.stringify(redactConfig(config)).includes('private'), false);
  assert.equal(config.llmConfig.apiKey, 'private');
  assert.ok(JSON.stringify(redactConfig(config)).includes('example'));
});

test('defaults use documented query and unwrap config without rewriting tools', async () => {
  const config = {
    llmConfig: { tools: [], model: 'platform-default' },
    arbitraryField: { keep: true },
  };
  const client = new FreyaClient('test-token', async (url, init) => {
    const parsed = new URL(url.toString());
    assert.equal(parsed.pathname, '/api/v2/agents/defaults');
    assert.equal(parsed.searchParams.get('workspaceId'), 'workspace-1');
    assert.equal(init!.method, 'GET');
    return Response.json({ success: true, data: { result: { config } } });
  });
  assert.deepEqual(await client.getDefaults('workspace-1', signal()), config);
});

test('create operation preserves caller-supplied config and checks response ID', async () => {
  const input = { workspaceId: 'w', name: 'test', config: { llmConfig: { tools: [] } } };
  const client = new FreyaClient('test-token', async (_url, init) => {
    assert.deepEqual(JSON.parse(init!.body as string), input);
    return Response.json({ success: true, data: { result: { agent: { id: 'agent-1' } } } });
  });
  assert.equal((await client.createAgent(input, signal())).id, 'agent-1');
});

test('chat requires a target and mutation errors are not retried', async () => {
  let calls = 0;
  const client = new FreyaClient('test-token', async () => {
    calls++;
    return new Response('upstream detail', { status: 503 });
  });
  await assert.rejects(client.chat({ message: 'Hello' }, signal()), /requires/);
  assert.equal(calls, 0);
  await assert.rejects(client.chat({ message: 'Hello', agentId: 'agent-1' }, signal()), /HTTP 503/);
  assert.equal(calls, 1);
});
