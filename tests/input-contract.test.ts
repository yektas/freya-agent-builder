import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { compileWorkflow } from '../src/workflow.ts';
import type { Task } from '../src/contracts.ts';

const task: Task = {
  id: 'synthetic-current-turn-contract',
  description: 'Synthetic mechanics test, not a benchmark.',
  tools: [
    {
      name: 'reserve_item',
      description: 'Reserve an item.',
      parameters: { type: 'object', properties: { customer_id: { type: 'string' } } },
      url: 'https://example.invalid/reserve',
      method: 'POST',
    },
  ],
};
function blueprint(): any {
  return {
    initial_node: 'collect',
    nodes: {
      collect: {
        name: 'collect',
        node_type: 'conversation',
        collection_contract: {
          scope: 'Synthetic current question only',
          max_visits: 4,
          exhausted_node: 'done',
        },
        extraction_schema: [
          { name: 'observed_date', type: 'date', min_confidence: 0.6 },
          { name: 'observed_amount', type: 'string', min_confidence: 0.6 },
          { name: 'observed_answer', type: 'string', min_confidence: 0.6 },
          { name: 'observed_question', type: 'string', min_confidence: 0.6 },
          { name: 'observed_confirmation', type: 'string', min_confidence: 0.6 },
        ],
        transitions: [{ target_node: 'decide', condition: { operator: 'always' } }],
      },
      decide: {
        name: 'decide',
        node_type: 'code',
        pre_actions: [{ code: 'pass' }],
        transitions: [
          {
            target_node: 'done',
            condition: { operator: 'equals', variable: 'state', operand: 'done' },
          },
          { target_node: 'collect', condition: { operator: 'always' } },
        ],
      },
      done: { name: 'done', node_type: 'end_call', transitions: [] },
    },
  };
}
function compile(input: any, runtimeContract = true): any {
  return compileWorkflow(
    task,
    { workflowJson: JSON.stringify(input), uncertainties: [] },
    { runtimeContract },
  );
}
function code(node: any): string {
  return node.pre_actions[0].function.parameters.properties.code.default;
}
function python(source: string, input: unknown): any {
  return JSON.parse(
    execFileSync('python3', ['-c', source], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      timeout: 2000,
    }),
  );
}

test('each collection entry resets only observations, even when empty writes are discarded', () => {
  const input = blueprint();
  const original = structuredClone(input);
  const w = compile(input);
  assert.equal(w.initial_node, '__builder_reset_collect');
  assert.equal(w.nodes.decide.transitions[1].target_node, '__builder_reset_collect');
  assert.equal(w.nodes.__builder_reset_collect.transitions[0].target_node, 'collect');
  assert.deepEqual(input, original);
  const direct = structuredClone(input);
  delete direct.nodes.collect.collection_contract;
  assert.equal(compile(direct, false).initial_node, 'collect');
  const observations = python(
    `
import json, sys, datetime, re
request = json.load(sys.stdin)
reset = request['reset']
schemas = {field['name']: field for field in request['fields']}
rejected = []
class StickyVariables(dict):
    def __setitem__(self, key, value):
        schema = schemas.get(key, {})
        try:
            if schema.get('type') == 'date': datetime.date.fromisoformat(value)
            if schema.get('validation_pattern') and not re.search(schema['validation_pattern'], value): raise ValueError()
        except Exception:
            rejected.append(key)
            return
        if value != '':
            super().__setitem__(key, value)
vars = StickyVariables({'observed_date': '2031-04-19', 'observed_amount': '21.25', 'proposed_date': '2031-04-19', 'recorded_state': 'unrecorded'})
turns = []
for extracted in [
    {'observed_confirmation': 'yes'},
    {'observed_answer': 'blue', 'observed_question': 'why do you need this'},
    {'observed_date': '2031-04-22', 'observed_confirmation': 'yes'},
    {}
]:
    exec(reset, {'vars': vars})
    for key, value in extracted.items():
        i = request['names'].index(key)
        vars[request['fields'][i]['name']] = value
    exec(request['consume'], {'vars': vars})
    # Synthetic decision boundary: confirmation is valid only without a fresh correction.
    turns.append({'vars': dict(vars), 'confirmed_without_correction': vars['observed_confirmation'] == 'yes' and vars['observed_date'] == '__builder_missing__'})
assert not rejected, 'schema rejected reset writes: ' + str(rejected)
print(json.dumps(turns))
`,
    {
      reset: code(w.nodes.__builder_reset_collect),
      fields: w.nodes.collect.extraction_schema,
      names: original.nodes.collect.extraction_schema.map((f: any) => f.name),
      consume: code(w.nodes.__builder_consume_collect),
    },
  );
  assert.equal(observations[0].confirmed_without_correction, true);
  assert.equal(observations[0].vars.proposed_date, '2031-04-19');
  assert.equal(observations[1].vars.observed_answer, 'blue');
  assert.equal(observations[1].vars.observed_question, 'why do you need this');
  assert.equal(observations[1].vars.observed_date, '__builder_missing__');
  assert.equal(observations[2].confirmed_without_correction, false);
  assert.equal(observations[3].vars.observed_confirmation, '__builder_missing__');
  assert.equal(observations[3].vars.recorded_state, 'unrecorded');
});

test('acknowledgement guard requires actual source success, not confirmation, transport alone or stale state', () => {
  const input: any = blueprint();
  input.nodes.ack = {
    name: 'ack',
    node_type: 'conversation',
    task_message: 'The item was reserved.',
    success_guard: {
      tool: 'reserve_item',
      path: ['data', 'reservation', 'accepted'],
      equals: true,
      fallback_node: 'collect',
    },
    transitions: [{ target_node: 'done', condition: { operator: 'always' } }],
  };
  input.initial_node = 'ack';
  const w = compile(input);
  assert.equal(w.initial_node, '__builder_guard_ack');
  assert.equal('success_guard' in w.nodes.ack, false);
  assert.equal(w.nodes.__builder_guard_ack.transitions[1].target_node, '__builder_reset_collect');
  const states = python(
    `
import json, sys
request = json.load(sys.stdin)
states = []
for snapshot in request['snapshots']:
    vars = {'confirmed': 'yes', 'recorded_state': 'recorded', '__builder_guard_ack_state': 'ready', 'builder_result_reserve_item': snapshot}
    exec(request['guard'], {'vars': vars})
    states.append(vars['__builder_guard_ack_state'])
print(json.dumps(states))
`,
    {
      guard: code(w.nodes.__builder_guard_ack),
      snapshots: [
        '{}',
        'malformed JSON',
        JSON.stringify({
          status: 'success',
          status_code: 200,
          data: { reservation: { accepted: false } },
        }),
        JSON.stringify({
          status: 'error',
          status_code: 503,
          data: { reservation: { accepted: true } },
        }),
        JSON.stringify({
          status: 'success',
          status_code: 408,
          data: { reservation: { accepted: true } },
        }),
        JSON.stringify({
          status: 'success',
          status_code: 200,
          data: { reservation: { accepted: 'true' } },
        }),
        JSON.stringify({
          status: 'success',
          status_code: 201,
          data: { reservation: { accepted: true } },
        }),
      ],
    },
  );
  assert.deepEqual(states, [
    'blocked',
    'blocked',
    'blocked',
    'blocked',
    'blocked',
    'blocked',
    'ready',
  ]);
  assert.throws(() => compile(input, false), /requires the runtime-contract/);
});

test('guard values and response paths are source-independent and string literals are safely encoded', () => {
  const input: any = blueprint();
  input.nodes.ack = {
    name: 'ack',
    node_type: 'conversation',
    success_guard: {
      tool: 'reserve_item',
      path: ['data', 'result_code'],
      equals: 'accepted "item"',
      fallback_node: 'collect',
    },
    transitions: [{ target_node: 'done', condition: { operator: 'always' } }],
  };
  const w = compile(input);
  const state = python(
    `
import json, sys
request = json.load(sys.stdin)
vars = {'builder_result_reserve_item': json.dumps({'status': 'success', 'status_code': 200, 'data': {'result_code': 'accepted "item"'}})}
exec(request['guard'], {'vars': vars})
print(json.dumps(vars['__builder_guard_ack_state']))
`,
    { guard: code(w.nodes.__builder_guard_ack) },
  );
  assert.equal(state, 'ready');
});

test('rejects collection cycles without decision boundaries and guards that can bypass reset', () => {
  const input: any = blueprint();
  input.nodes.collect.transitions[0].target_node = 'collect';
  assert.throws(() => compile(input), /decision code node/);
  input.nodes.collect.transitions[0].target_node = 'decide';
  input.nodes.collect.extraction_schema[0].extraction_prompt = '{{extractor.speech}}';
  assert.throws(() => compile(input), /input placeholders/);
  delete input.nodes.collect.extraction_schema[0].extraction_prompt;
  delete input.nodes.collect.extraction_schema[0].min_confidence;
  assert.throws(() => compile(input), /min_confidence/);
  input.nodes.collect.extraction_schema[0].min_confidence = 0.6;
  input.nodes.collect.success_guard = {
    tool: 'reserve_item',
    path: ['data', 'accepted'],
    equals: true,
    fallback_node: 'done',
  };
  assert.throws(() => compile(input), /separate success acknowledgement/);
  delete input.nodes.collect.success_guard;
  input.nodes.decide.transitions[1].target_node = '__previous__';
  assert.throws(() => compile(input), /explicit targets/);
});

test('synthetic typed observations reject malformed values and terminate repeated collection', () => {
  const input = blueprint();
  const cases = [
    { type: 'date', good: '2031-04-19', bad: '2031-02-30' },
    { type: 'datetime', good: '2031-04-19T11:00:00Z', bad: 'time: 11:00' },
    { type: 'integer', good: '42', bad: 'answer: 42' },
    { type: 'float', good: '21.25', bad: '1e999' },
    { type: 'boolean', good: 'false', bad: 'yes' },
    { type: 'name', good: 'Alex Smith', bad: '' },
    { type: 'phone_number', good: '+1 (555) 123-4567', bad: 'call me' },
    { type: 'string', good: 'yes', bad: 'maybe', enum_values: ['yes', 'no'] },
    { type: 'string', good: '1234', bad: 'answer: 1234', validation_pattern: '^[0-9]{4}$' },
  ];
  input.nodes.collect.extraction_schema = cases.map((field, i) => ({
    ...Object.fromEntries(Object.entries(field).filter(([key]) => !['good', 'bad'].includes(key))),
    name: `value_${i}`,
    min_confidence: 0.7,
  }));
  const w = compile(input);
  const output = python(
    `
import json, sys, re, datetime
r = json.load(sys.stdin)
schemas = {f['name']: f for f in r['schema']}
rejected = []
class PlatformVariables(dict):
    def __setitem__(self, key, value):
        f = schemas.get(key, {})
        try:
            if f.get('type') == 'date': datetime.date.fromisoformat(value)
            if f.get('validation_pattern') and not re.search(f['validation_pattern'], value): raise ValueError()
            if 'enum_values' in f and value not in f['enum_values']: raise ValueError()
            if f.get('type') == 'string' and not isinstance(value, str): raise ValueError()
        except Exception:
            rejected.append(key)
            return
        if value != '': super().__setitem__(key, value)
vars = PlatformVariables({'persistent': 'keep'})
turns = []
for turn in range(5):
    exec(r['reset'], {'vars': vars})
    allowed = vars[r['ready']] == 'ready'
    if allowed:
        for i, case in enumerate(r['cases']):
            if turn < 2: vars[r['schema'][i]['name']] = case['good' if turn == 0 else 'bad']
        exec(r['consume'], {'vars': vars})
    turns.append({'allowed': allowed, 'values': [vars.get('value_' + str(i)) for i in range(len(r['cases']))]})
print(json.dumps({'turns': turns, 'rejected': rejected, 'persistent': vars['persistent']}))
`,
    {
      reset: code(w.nodes.__builder_reset_collect),
      consume: code(w.nodes.__builder_consume_collect),
      ready: w.nodes.__builder_reset_collect.transitions[0].condition.variable,
      schema: w.nodes.collect.extraction_schema,
      cases,
    },
  );
  assert.deepEqual(
    output.turns[0].values,
    cases.map((c) => c.good),
  );
  for (const turn of output.turns.slice(1)) {
    assert.deepEqual(
      turn.values,
      cases.map(() => '__builder_missing__'),
    );
  }
  assert.deepEqual(
    output.turns.map((t: any) => t.allowed),
    [true, true, true, true, false],
  );
  assert.deepEqual(output.rejected, []);
  assert.equal(output.persistent, 'keep');
  assert.equal(w.nodes.__builder_reset_collect.transitions[1].target_node, 'done');
});

test('staged fields omit custom extraction prompts by default so the built-in template runs', () => {
  const w = compile(blueprint());
  const schema = w.nodes.collect.extraction_schema;
  assert.equal(schema.length, 5);
  for (const field of schema) {
    assert.equal(field.type, 'string');
    // A custom extraction_prompt REPLACES the platform's whole built-in template.
    // Boilerplate on every field produced nodes the platform never extracted from.
    assert.equal(field.extraction_prompt, undefined);
    assert.ok(field.description.length < 300, 'description stays short: ' + field.description);
  }
});

test('rejects an extraction schema the platform cannot answer in one call per turn', () => {
  // Recorded 2026-10-11 run: 71 staged fields across nine nodes reached the node and
  // then produced no extraction, routing or dialogue event. The customer hung up.
  const wide: any = blueprint();
  wide.nodes.collect.extraction_schema = Array.from({ length: 24 }, (_, i) => ({
    name: `observed_field_${i}`,
    type: 'string',
    min_confidence: 0.6,
  }));
  assert.throws(() => compile(wide), /at most 12/);

  const verbose: any = blueprint();
  verbose.nodes.collect.extraction_schema = verbose.nodes.collect.extraction_schema.map(
    (field: any) => ({ ...field, description: 'x'.repeat(900) }),
  );
  assert.throws(() => compile(verbose), /at most 5000/);

  // An author-supplied prompt is still allowed when it is genuinely needed.
  const prompted: any = blueprint();
  prompted.nodes.collect.extraction_schema[0].extraction_prompt =
    'Use {{extractor.speech}} and {{extractor.conversation.last-10}} and {{extractor.type_preamble}} and {{extractor.variables_list}}. today is {{date.today}}.';
  const compiled = compile(prompted);
  assert.equal(
    compiled.nodes.collect.extraction_schema[0].extraction_prompt.includes('{{date.today}}'),
    true,
  );
  assert.equal(compiled.nodes.collect.extraction_schema[1].extraction_prompt, undefined);
});

test('rejects serialized observations, unknown constraints, and unbounded collection', () => {
  const input = blueprint();
  input.nodes.collect.extraction_schema[0].description = 'Return a JSON object';
  assert.throws(() => compile(input), /independent scalar/);
  delete input.nodes.collect.extraction_schema[0].description;
  input.nodes.collect.extraction_schema[0].minimum = 2;
  assert.throws(() => compile(input), /Unsupported extraction/);
  delete input.nodes.collect.extraction_schema[0].minimum;
  input.nodes.collect.collection_contract.max_visits = 13;
  assert.throws(() => compile(input), /max_visits/);
  input.nodes.collect.collection_contract.max_visits = 4;
  input.nodes.collect.collection_contract.exhausted_node = 'decide';
  assert.throws(() => compile(input), /end_call/);
});
