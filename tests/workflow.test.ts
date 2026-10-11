import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import {
  toolsFromOpenAPI,
  compileWorkflow,
  loadFreyaTask,
  relaxInvalidEscapes,
} from '../src/workflow.ts';
import { freyaRecipe } from '../src/recipe.ts';
import { routingComplexity, routingSafetyIssues } from '../src/routing-safety.ts';
import type { Task } from '../src/contracts.ts';

const openapi = JSON.parse(
  await readFile(new URL('../build-the-builder/tools/openapi.json', import.meta.url), 'utf8'),
);
const task: Task = {
  id: 'synthetic-workflow-test',
  description: 'Synthetic compiler fixture, not a benchmark.',
  tools: toolsFromOpenAPI(openapi),
};
const blueprint = () => ({
  initial_node: 'talk',
  system_prompt: 'Synthetic test only.',
  nodes: {
    talk: {
      name: 'talk',
      node_type: 'conversation',
      tools: ['verify_identity'],
      transitions: [
        { target_node: 'done', condition: { operator: 'always' }, description: 'Finish' },
      ],
    },
    done: { name: 'done', node_type: 'end_call', farewell: 'Goodbye.', transitions: [] },
  },
});
const candidate = (value: unknown) => ({ workflowJson: JSON.stringify(value), uncertainties: [] });

test('an invalid escape does not cost a paid generation, and valid JSON is untouched', () => {
  // Recorded 2026-10-11 16:05 run: the model wrote \' inside a JSON string, which JSON
  // does not define, and the whole generation was discarded after $0.11 of tokens.
  const authored = { ...blueprint(), system_prompt: "say exactly: 'I am Freya Bank's assistant.'" };
  const broken = JSON.stringify(authored).replace(/Freya Bank's/, "Freya Bank\\'s");
  assert.throws(() => JSON.parse(broken));
  const compiled = compileWorkflow(task, { workflowJson: broken, uncertainties: [] }) as any;
  assert.equal(compiled.system_prompt, authored.system_prompt);

  // Defined escapes must survive byte for byte.
  const rich = JSON.stringify({ s: 'a\nb\tc\\d"eé/f' });
  assert.equal(relaxInvalidEscapes(rich), rich);
  assert.equal(JSON.parse(relaxInvalidEscapes(rich)).s, 'a\nb\tc\\d"eé/f');
  assert.equal(JSON.parse(relaxInvalidEscapes(String.raw`{"s":"\d"}`)).s, String.raw`\d`);
  // A truncated \u escape is relaxed too, and a trailing backslash is left alone.
  assert.equal(relaxInvalidEscapes('"\\u12"'), '"u12"');
  assert.equal(relaxInvalidEscapes('"abc\\'), '"abc\\');
  // Genuinely broken JSON still fails rather than being silently invented.
  assert.throws(() => compileWorkflow(task, { workflowJson: '{oops', uncertainties: [] }));
});

test('compiler preserves regex escapes in generated Python date code', () => {
  const authored: any = blueprint();
  authored.nodes.talk.node_type = 'code';
  delete authored.nodes.talk.tools;
  authored.nodes.talk.pre_actions = [
    {
      code: String.raw`import re
vars['date_match'] = bool(re.search(r'\b\d{4}-\d{2}-\d{2}\b', '2026-10-14'))`,
    },
  ];
  const broken = JSON.stringify(authored)
    .replaceAll(String.raw`\\b`, String.raw`\b`)
    .replaceAll(String.raw`\\d`, String.raw`\d`);
  assert.throws(() => JSON.parse(broken));
  const compiled = compileWorkflow(task, { workflowJson: broken, uncertainties: [] }) as any;
  const code = compiled.nodes.talk.pre_actions[0].function.parameters.properties.code.default;
  assert.equal(code, authored.nodes.talk.pre_actions[0].code);
});

test('compiler recovers unescaped inner quotes in a generated string without changing its content', () => {
  // A recorded final-case draft placed return "'" inside a JSON-encoded Python
  // string without escaping either double quote. The outer response was valid,
  // but the inner workflow was discarded before structural validation.
  const authored = {
    ...blueprint(),
    system_prompt: `Use the literal Python expression return "'"+suffix here.`,
  };
  const broken = JSON.stringify(authored).replaceAll('\\"\'\\"', '"\'"');
  assert.throws(() => JSON.parse(broken));
  const compiled = compileWorkflow(task, { workflowJson: broken, uncertainties: [] }) as any;
  assert.equal(compiled.system_prompt, authored.system_prompt);
  assert.throws(() =>
    compileWorkflow(task, {
      workflowJson: '{"initial_node":"talk" "nodes":{}}',
      uncertainties: [],
    }),
  );
});

test('compiler recovers many quoted literals including a quote followed by whitespace', () => {
  const authored = {
    ...blueprint(),
    system_prompt: Array.from({ length: 10 }, () => `return "'dir." for item`).join(' '),
  };
  const broken = JSON.stringify(authored).replaceAll('\\"', '"');
  assert.throws(() => JSON.parse(broken));
  const compiled = compileWorkflow(task, { workflowJson: broken, uncertainties: [] }) as any;
  assert.equal(compiled.system_prompt, authored.system_prompt);
});

test('compiler accepts the documented code_exec wrapper as a code action', () => {
  const authored: any = blueprint();
  authored.nodes.talk.node_type = 'code';
  delete authored.nodes.talk.tools;
  authored.nodes.talk.pre_actions = [
    {
      type: 'function',
      function: {
        name: 'code_exec',
        handler: '__function__:code_exec',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', default: "vars['status'] = 'ready'" },
            timeout_ms: { type: 'number', default: 10000 },
          },
        },
      },
    },
  ];
  const compiled = compileWorkflow(task, candidate(authored)) as any;
  assert.equal(
    compiled.nodes.talk.pre_actions[0].function.parameters.properties.code.default,
    "vars['status'] = 'ready'",
  );
  authored.nodes.talk.pre_actions[0].function.name = 'other';
  assert.throws(() => compileWorkflow(task, candidate(authored)), /Code actions/);
});

test('API pre-actions expose current tool-named results to downstream state and routing', () => {
  const synthetic: Task = {
    id: 'synthetic-response-scope',
    description: 'Synthetic platform-boundary regression, not a benchmark.',
    tools: [
      {
        name: 'lookup_items',
        description: 'Look up items.',
        parameters: {
          type: 'object',
          properties: { customer_id: { type: 'string' } },
        },
        url: 'https://example.invalid/items',
        method: 'POST',
      },
    ],
  };
  const input = {
    initial_node: 'fetch',
    nodes: {
      fetch: {
        name: 'fetch',
        node_type: 'api_request',
        passthrough: true,
        pre_actions: [
          { name: 'lookup_items', post_process_code: "result['data']['hook_ran'] = True" },
        ],
        response_mapping: [{ path: 'data.ok', variable: 'lookup_ok' }],
        transitions: [{ target_node: 'done', condition: { operator: 'always' } }],
      },
      done: { name: 'done', node_type: 'end_call', transitions: [] },
    },
  };
  const before = structuredClone(input);
  const workflow = compileWorkflow(synthetic, candidate(input)) as any;
  assert.deepEqual(input, before);
  assert.deepEqual(workflow.nodes.fetch.response_mapping, input.nodes.fetch.response_mapping);
  const hook = workflow.nodes.fetch.pre_actions[0].post_process_code;
  // Reproduce the recorded boundary: pre-actions populate node-named leaves,
  // while downstream generated code consumes tool-named leaves. Execute only
  // our compiler hook and this authored synthetic hook, never recorded model code.
  const output = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        `
import json, sys
request = json.load(sys.stdin)
vars = {'fetch_response.data.ok': 'true', 'fetch_response.data.items.0.item_id': 'synthetic-item', 'unrelated': 'keep'}
result = {'status': 'success', 'data': {'ok': True, 'items': [{'item_id': 'synthetic-item', 'quantity': 9}]}, 'status_code': 200}
exec(request['hook'], {'vars': vars, 'result': result})
first = dict(vars)
# A later failed lookup must not retain items from the earlier success.
result = {'status': 'error', 'data': {'ok': False, 'error': 'synthetic failure'}, 'status_code': 503}
exec(request['hook'], {'vars': vars, 'result': result})
print(json.dumps({'first': first, 'second': vars}))
`,
      ],
      { input: JSON.stringify({ hook: hook ?? '' }), encoding: 'utf8', timeout: 2000 },
    ),
  );
  assert.equal(output.first['lookup_items_response.data.items.0.item_id'], 'synthetic-item');
  assert.equal(output.first['lookup_items_response.data.items.0.quantity'], 9);
  assert.equal(output.first['lookup_items_response.data.ok'], 'true');
  assert.equal(output.first['lookup_items_response.data.hook_ran'], 'true');
  assert.equal(output.second['lookup_items_response.data.ok'], 'false');
  assert.equal(output.second['lookup_items_response.status_code'], 503);
  assert.equal('lookup_items_response.data.items.0.item_id' in output.second, false);
  assert.equal(output.second['fetch_response.data.items.0.item_id'], 'synthetic-item');
  assert.equal(output.second.unrelated, 'keep');
});

test('compiler binds original OpenAPI schemas without changing sources or accepting generated schemas', () => {
  const before = structuredClone(task);
  const workflow = compileWorkflow(task, candidate(blueprint())) as any;
  const binding = workflow.nodes.talk.tools[0];
  assert.equal(binding.function.handler, '__function__:api_call');
  assert.equal(
    binding.function.parameters.properties.url.default,
    'https://freya-bank-mock.freyavoice.workers.dev/v1/verify_identity',
  );
  assert.deepEqual(
    binding.function.parameters.properties.body.properties.field.enum,
    openapi.paths['/verify_identity'].post.requestBody.content['application/json'].schema.properties
      .field.enum,
  );
  assert.equal(
    binding.function.parameters.properties.body.properties.customer_id.default,
    '{{customer_id}}',
  );
  assert.equal(binding.config.maxRetries, 0);
  assert.equal(workflow.nodes.done.terminal.function.handler, '__function__:end_call');
  assert.deepEqual(task, before);
  const invalid: any = blueprint();
  invalid.nodes.talk.tools = [{ name: 'verify_identity', parameters: {} }];
  assert.throws(() => compileWorkflow(task, candidate(invalid)), /schemas/);
  invalid.nodes.talk.tools = ['invented_tool'];
  assert.throws(() => compileWorkflow(task, candidate(invalid)), /Unknown bank tool/);
});

test('an omitted optional bank-tool field has no generated body default', () => {
  const authored: any = blueprint();
  authored.nodes.talk.node_type = 'api_request';
  delete authored.nodes.talk.tools;
  authored.nodes.talk.pre_actions = [{ name: 'close_call', bodyDefaults: { outcome: 'promise' } }];
  const compiled = compileWorkflow(task, candidate(authored)) as any;
  const body = compiled.nodes.talk.pre_actions[0].function.parameters.properties.body;
  assert.equal(body.properties.outcome.default, 'promise');
  assert.equal(body.properties.customer_id.default, '{{customer_id}}');
  assert.equal('default' in body.properties.reason, false);
  assert.equal(body.required.includes('reason'), false);

  authored.nodes.talk.pre_actions[0].bodyDefaults.reason = 'callback';
  const withReason = compileWorkflow(task, candidate(authored)) as any;
  assert.equal(
    withReason.nodes.talk.pre_actions[0].function.parameters.properties.body.properties.reason
      .default,
    'callback',
  );
});

test('final mock URL is applied only at the compiler boundary', () => {
  const before = structuredClone(task);
  const workflow = compileWorkflow(task, candidate(blueprint()), {
    mockUrl: 'https://synthetic-bank.workers.dev',
  }) as any;
  assert.equal(
    workflow.nodes.talk.tools[0].function.parameters.properties.url.default,
    'https://synthetic-bank.workers.dev/v1/verify_identity',
  );
  assert.deepEqual(task, before);
  assert.throws(
    () => compileWorkflow(task, candidate(blueprint()), { mockUrl: 'http://unsafe.invalid' }),
    /Mock URL must be an HTTPS/,
  );
});

test('mock binding preserves the source server path before the operation path', () => {
  const bank = structuredClone(task);
  bank.tools[0]!.url = 'https://source-bank.invalid/voice/v1/verify_identity';
  const workflow = compileWorkflow(bank, candidate(blueprint()), {
    mockUrl: 'https://synthetic-bank.workers.dev',
  }) as any;
  assert.equal(
    workflow.nodes.talk.tools[0].function.parameters.properties.url.default,
    'https://synthetic-bank.workers.dev/voice/v1/verify_identity',
  );
  assert.equal(bank.tools[0]!.url, 'https://source-bank.invalid/voice/v1/verify_identity');
});

test('nested request envelopes are reconstructed at the verified API boundary', () => {
  const bank: Task = {
    id: 'synthetic-envelope',
    description: 'Synthetic API envelope; no bank customer data.',
    tools: [
      {
        name: 'list_cards',
        description: 'List cards.',
        path: '/voice/v1/cards.list',
        method: 'POST',
        url: 'https://example.invalid/voice/v1/cards.list',
        parameters: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                customerNo: { type: 'string', default: '{{customerNumber}}' },
                aiFlow: { type: 'string', default: 'CardOps' },
              },
              required: ['customerNo', 'aiFlow'],
            },
            call: {
              type: 'object',
              properties: {
                ani: { type: 'string', default: '' },
                lang: { type: 'string', default: 'tr' },
              },
              required: ['ani', 'lang'],
            },
          },
          required: ['data', 'call'],
        },
      },
    ],
  };
  const input: any = blueprint();
  input.nodes.talk.tools = ['list_cards'];
  const before = structuredClone(bank);
  const workflow = compileWorkflow(bank, candidate(input), {
    mockUrl: 'https://synthetic-bank.workers.dev',
  }) as any;
  const binding = workflow.nodes.talk.tools[0];
  const body = binding.function.parameters.properties.body;
  assert.deepEqual(Object.keys(body.properties), ['customerNo', 'aiFlow']);
  assert.equal(body.properties.customerNo.default, '{{customerNumber}}');
  assert.equal(body.properties.aiFlow.default, 'CardOps');
  assert.equal(
    binding.function.parameters.properties.url.default,
    'https://synthetic-bank.workers.dev/voice/v1/cards.list',
  );
  const wrapped = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        "import json,sys; req=json.load(sys.stdin); config={'body':{'customerNo':'12345678','aiFlow':'CardOps'}}; exec(req['hook'],{'config':config}); print(json.dumps(config['body']))",
      ],
      {
        input: JSON.stringify({ hook: binding.pre_process_code }),
        encoding: 'utf8',
        timeout: 2000,
      },
    ),
  );
  assert.deepEqual(wrapped, {
    data: { customerNo: '12345678', aiFlow: 'CardOps' },
    call: { ani: '', lang: 'tr' },
  });
  assert.deepEqual(bank, before);
});

test('compiler takes changed tool fields and allowed values from supplied OpenAPI', () => {
  const changed = structuredClone(openapi);
  changed.paths['/verify_identity'].post.requestBody.content[
    'application/json'
  ].schema.properties.field.enum = ['new_identity_field'];
  const workflow = compileWorkflow(
    { ...task, tools: toolsFromOpenAPI(changed) },
    candidate(blueprint()),
  ) as any;
  assert.deepEqual(
    workflow.nodes.talk.tools[0].function.parameters.properties.body.properties.field.enum,
    ['new_identity_field'],
  );
});

test('compiler rejects dangling routes, nulls and silently discarded action placement', () => {
  const wrong: any = blueprint();
  wrong.nodes.talk.transitions[0].target_node = 'missing';
  assert.throws(() => compileWorkflow(task, candidate(wrong)), /transition target/);
  wrong.nodes.talk.transitions[0].target_node = 'done';
  wrong.nodes.talk.pre_actions = ['get_account'];
  assert.throws(() => compileWorkflow(task, candidate(wrong)), /pre_actions/);
  delete wrong.nodes.talk.pre_actions;
  wrong.nodes.talk.role_message = null;
  assert.throws(() => compileWorkflow(task, candidate(wrong)), /null/);
});

test('precise-routing asks for narrow exits but does not impose a length ceiling', () => {
  const input: any = blueprint();
  input.nodes.talk.transitions = [
    {
      target_node: 'done',
      description: 'End contact or verification',
      condition: {
        operator: 'matches_intent',
        description:
          'From conversation history: wrong number; customer deceased; still unclear who is speaking after the second ask; third party declines or cannot arrange callback; second invalid callback offer; confirmed customer declines security a second time, asks what the call is about instead of answering a second time, or says twice they do not want to talk; or verification infrastructure failed and cannot be completed.',
      },
    },
    { target_node: 'talk', condition: { operator: 'always' } },
  ];
  const before = structuredClone(input);
  assert.doesNotThrow(() => compileWorkflow(task, candidate(input)));
  assert.doesNotThrow(() => compileWorkflow(task, candidate(input), { preciseRouting: true }));
  assert.deepEqual(input, before);

  input.nodes.talk.transitions = [
    {
      target_node: 'done',
      condition: { operator: 'matches_intent', description: 'The caller reports a wrong number.' },
    },
    {
      target_node: 'done',
      condition: { operator: 'matches_intent', description: 'The customer is deceased.' },
    },
    { target_node: 'talk', condition: { operator: 'always' } },
  ];
  assert.doesNotThrow(() => compileWorkflow(task, candidate(input), { preciseRouting: true }));
  input.nodes.talk.transitions[0].condition.description = '';
  assert.throws(
    () => compileWorkflow(task, candidate(input), { preciseRouting: true }),
    /matches_intent needs a nonempty description/,
  );
});

test('routing complexity reports the recorded graph shape without rejecting it', () => {
  // Synthetic shapes based on recorded counts; neither fixture is a benchmark score.
  const large: any = { nodes: {} };
  for (let i = 0; i < 59; i += 1) {
    large.nodes[`stage_${i}`] = {
      transitions:
        i === 58
          ? []
          : [{ condition: { operator: 'always' } }, { condition: { operator: 'always' } }],
    };
  }
  large.nodes.stage_0.transitions.push(
    ...Array.from({ length: 13 }, () => ({
      condition: { operator: 'matches_intent', description: 'A distinct customer signal.' },
    })),
  );
  large.nodes.stage_1.transitions.push(
    ...Array.from({ length: 13 }, () => ({ condition: { operator: 'always' } })),
  );
  assert.deepEqual(routingComplexity(large), {
    nodes: 59,
    transitions: 142,
    maxIntentRoutesPerNode: 13,
    customRoutingPrompts: 0,
  });
  assert.deepEqual(routingSafetyIssues(large), []);

  const compact: any = { nodes: {} };
  for (let i = 0; i < 12; i += 1) {
    compact.nodes[`stage_${i}`] = {
      transitions: i === 11 ? [] : [{ condition: { operator: 'always' } }],
    };
  }
  for (let i = 0; i < 8; i += 1) {
    compact.nodes[`stage_${i}`].transitions.push({
      condition: { operator: 'matches_intent', description: 'A specific customer signal.' },
    });
  }
  assert.deepEqual(routingSafetyIssues(compact), []);
  assert.deepEqual(routingComplexity(compact), {
    nodes: 12,
    transitions: 19,
    maxIntentRoutesPerNode: 1,
    customRoutingPrompts: 0,
  });
});

test('event input preserves original brief and OpenAPI text, with no practice answers', async () => {
  const task = await loadFreyaTask(
    ['build-the-builder/briefs/brief-a.md'],
    'build-the-builder/tools/openapi.json',
    'build-the-builder',
  );
  assert.deepEqual((task.openapi as any).document, openapi);
  assert.equal(
    (task.briefs as any)[0].text,
    await readFile('build-the-builder/briefs/brief-a.md', 'utf8'),
  );
  assert.equal('cases' in task, false);
  assert.equal('expected' in task, false);
});

test('recipe exports selected workflow before practice; failed practice does not register again', async () => {
  const calls: string[] = [];
  await assert.rejects(
    freyaRecipe.run(task, {
      async generate() {
        calls.push('generate');
        return candidate(blueprint());
      },
      async compile() {
        calls.push('compile');
        return {};
      },
      async validate() {
        calls.push('validate');
      },
      async register() {
        calls.push('register');
        return { workflow_id: 'w', agent_id: 'a' };
      },
      async export() {
        calls.push('export');
        return 'saved';
      },
      async evaluate() {
        calls.push('practice');
        throw new Error('synthetic practice failure');
      },
    }),
    /synthetic practice failure/,
  );
  assert.deepEqual(calls, ['generate', 'compile', 'validate', 'register', 'export', 'practice']);
});
