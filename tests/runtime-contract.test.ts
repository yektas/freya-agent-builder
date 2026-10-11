import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { compileWorkflow } from '../src/workflow.ts';
import { runtimeContractIssues } from '../src/runtime-contract.ts';
import { freyaStrategyInstructions, parseFreyaStrategy } from '../src/strategies.ts';
import type { Task } from '../src/contracts.ts';

const task: Task = {
  id: 'synthetic-runtime-contract',
  description: 'Synthetic mechanics fixture, not a benchmark.',
  tools: [
    {
      name: 'read_inventory',
      description: 'Read synthetic inventory.',
      parameters: { type: 'object', properties: { customer_id: { type: 'string' } } },
      url: 'https://example.invalid/inventory',
      method: 'POST',
    },
  ],
};
function blueprint() {
  return {
    initial_node: 'fetch',
    nodes: {
      fetch: {
        name: 'fetch',
        node_type: 'api_request',
        pre_actions: ['read_inventory'],
        transitions: [{ target_node: 'talk', condition: { operator: 'always' } }],
      },
      talk: {
        name: 'talk',
        node_type: 'conversation',
        tools: ['read_inventory'],
        transitions: [{ target_node: 'end', condition: { operator: 'always' } }],
      },
      end: { name: 'end', node_type: 'end_call', transitions: [] },
    },
    tools: ['read_inventory'],
  };
}
const candidate = (value: unknown) => ({ workflowJson: JSON.stringify(value), uncertainties: [] });

test('opt-in contract preserves full structured responses for every tool placement and clears stale success', () => {
  const input = blueprint();
  const before = structuredClone(input);
  const compiled = compileWorkflow(task, candidate(input), { runtimeContract: true }) as any;
  const bindings = [
    compiled.nodes.fetch.pre_actions[0],
    compiled.nodes.talk.tools[0],
    compiled.tools[0],
  ];
  for (const binding of bindings) {
    const output: any = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          `
import json, sys
hook = json.load(sys.stdin)['hook']
vars = {'unrelated': 'keep'}
snapshots = []
for result in [
    {'status': 'success', 'data': {'accepted': True, 'batches': [{'entries': [{'sku': 'x', 'units': 2}], 'metadata': {}}], 'optional': None}, 'header': {'secret': 'must not copy'}, 'status_code': 200},
    {'status': 'success', 'data': {'accepted': True, 'batches': []}, 'status_code': 200},
    {'status': 'error', 'data': {'accepted': False}, 'status_code': 503},
    None
]:
    exec(hook, {'vars': vars, 'result': result})
    # Model the platform string variable boundary, then the generated consumer.
    snapshots.append(json.loads(str(vars['builder_result_read_inventory'])))
print(json.dumps({'snapshots': snapshots, 'unrelated': vars['unrelated']}))
`,
        ],
        {
          input: JSON.stringify({ hook: binding.post_process_code }),
          encoding: 'utf8',
          timeout: 2000,
        },
      ),
    );
    const [first, empty, failed, missing] = output.snapshots;
    assert.equal(first.data.batches[0].entries[0].units, 2);
    assert.deepEqual(first.data.batches[0].metadata, {});
    assert.equal(first.data.optional, null);
    assert.equal(first.data.accepted, true);
    assert.equal('header' in first, false);
    assert.deepEqual(empty.data.batches, []);
    assert.equal(failed.data.accepted, false);
    assert.equal('batches' in failed.data, false);
    assert.deepEqual(missing, {});
    assert.equal(output.unrelated, 'keep');
  }
  assert.deepEqual(input, before);
  // The snapshot is unconditional: it only adds a variable, so a blueprint that reads
  // flattened leaves keeps working and one that needs a container now can.
  const unconditional: any = compileWorkflow(task, candidate(input));
  for (const binding of [unconditional.nodes.talk.tools[0], unconditional.tools[0]]) {
    assert.match(binding.post_process_code, /builder_result_read_inventory/);
  }
});

test('snapshot includes authored post-hook changes but clears old success before an authored exception', () => {
  const input: any = blueprint();
  input.nodes.talk.tools = [
    {
      name: 'read_inventory',
      post_process_code: "result['data']['instruction'] = 'synthetic retry'",
    },
  ];
  const compiled = compileWorkflow(task, candidate(input), { runtimeContract: true }) as any;
  const hook = compiled.nodes.talk.tools[0].post_process_code;
  const output: any = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        `
import json, sys
hook = json.load(sys.stdin)['hook']
vars = {}
exec(hook, {'vars': vars, 'result': {'data': {}}})
first = json.loads(vars['builder_result_read_inventory'])
try:
    exec(hook, {'vars': vars, 'result': None})
except Exception:
    pass
print(json.dumps([first, json.loads(vars['builder_result_read_inventory'])]))
`,
      ],
      { input: JSON.stringify({ hook }), encoding: 'utf8', timeout: 2000 },
    ),
  );
  assert.equal(output[0].data.instruction, 'synthetic retry');
  assert.deepEqual(output[1], {});
});

test('every container is published as JSON text under its own response path', () => {
  // Recorded 2026-10-11 run 15:48: the platform wrote only .products.0.* leaves, so
  // generated code reading get_account_response.data.products always missed and closed
  // 8 of 10 calls as a service error. The engine never writes that bare path, so the
  // compiler owns it. Leaves the platform does write must survive untouched.
  const input = blueprint();
  const compiled = compileWorkflow(task, candidate(input), { runtimeContract: true }) as any;
  const hook = compiled.nodes.fetch.pre_actions[0].post_process_code;
  const output: any = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        `
import json, sys
request = json.load(sys.stdin)
vars = {}
exec(request['hook'], {'vars': vars, 'result': request['result']})
print(json.dumps({
    'products': vars.get('read_inventory_response.data.batches'),
    'nested': vars.get('read_inventory_response.data.summary'),
    'empty': vars.get('read_inventory_response.data.empty'),
    'header_leak': [k for k in vars if 'header' in k or 'secret' in k],
}))
`,
      ],
      {
        input: JSON.stringify({
          hook,
          result: {
            status: 'success',
            status_code: 200,
            header: { secret: 'never copied' },
            data: {
              ok: true,
              batches: [{ entries: [{ sku: 'x', units: 2 }] }],
              summary: { total: 1 },
              empty: [],
            },
          },
        }),
        encoding: 'utf8',
        timeout: 2000,
      },
    ),
  );
  // Code that reads the documented path and parses it gets the whole array back.
  assert.deepEqual(JSON.parse(output.products), [{ entries: [{ sku: 'x', units: 2 }] }]);
  assert.deepEqual(JSON.parse(output.nested), { total: 1 });
  // An empty container stays an empty container rather than becoming a missing value.
  assert.deepEqual(JSON.parse(output.empty), []);
  assert.deepEqual(output.header_leak, []);
});

test('contract checks reject missing fallbacks and trapped cycles, and allow response reads', () => {
  const input: any = blueprint();
  input.nodes.fetch.node_type = 'code';
  // A response path read is valid now that the compiler publishes containers there.
  input.nodes.fetch.pre_actions = [
    { code: "items = vars.get('read_inventory_response.data.batches', [])" },
  ];
  assert.deepEqual(runtimeContractIssues(input), []);
  const compiledDirect: any = compileWorkflow(task, candidate(input), { runtimeContract: true });
  assert.equal(compiledDirect.nodes.fetch.node_type, 'code');
  input.nodes.fetch.pre_actions = [{ code: 'pass' }];
  input.nodes.fetch.transitions[0].condition = {
    operator: 'equals',
    variable: 'state',
    operand: 'ready',
  };
  assert.match(runtimeContractIssues(input).join('\n'), /always fallback/);
  input.nodes.fetch.transitions[0].target_node = 'fetch';
  assert.match(runtimeContractIssues(input).join('\n'), /no explicit graph path/);
});

test('strategy remains opt-in and provides mechanics without synthetic or bank policy fields', () => {
  // Recorded practice: direct 6,1,4 of 10; runtime-contract 3,0,0 of 10. The contract
  // variants are selectable experiments, not the default, until they beat the baseline.
  assert.equal(parseFreyaStrategy(undefined), 'direct');
  assert.equal(parseFreyaStrategy('runtime-contract'), 'runtime-contract');
  const instructions = freyaStrategyInstructions('runtime-contract');
  assert.match(instructions, /JSON TEXT/);
  assert.match(instructions, /failed answer stays at the current question/);
  assert.doesNotMatch(instructions, /wrong_answers_left|minimum_payment|read_inventory/);
  assert.doesNotMatch(freyaStrategyInstructions('direct'), /Runtime contract v1/);
});
