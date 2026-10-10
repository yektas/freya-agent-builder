import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { toolsFromOpenAPI, compileWorkflow, loadFreyaTask } from '../src/workflow.ts';
import { freyaRecipe } from '../src/recipe.ts';
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
