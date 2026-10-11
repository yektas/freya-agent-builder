// Synthetic input preservation checks. No generated-agent behavior or benchmark score is claimed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadFreyaTask, compileWorkflow } from '../src/workflow.ts';

test('clean and raw synthetic inputs retain calendar revisions and changed API fields at the boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'holdout-input-'));
  try {
    const api = JSON.parse(await readFile('build-the-builder/tools/openapi.json', 'utf8'));
    // Resolve the request schema from the catalog, then supply a new original API contract.
    const original = await loadFreyaTask(
      ['fixtures/holdouts/clean.md'],
      'build-the-builder/tools/openapi.json',
      'build-the-builder',
    );
    const identity = original.tools.find((tool) => tool.name === 'verify_identity')!;
    const changed = structuredClone(identity.parameters) as any;
    changed.properties.security_phrase = { type: 'string', enum: ['synthetic-phrase'] };
    changed.required = [...(changed.required ?? []), 'security_phrase'];
    for (const [name, path] of Object.entries(api.paths) as [string, any][]) {
      if (path.post?.operationId === 'verify_identity' || name === '/verify_identity') {
        path.post.requestBody.content['application/json'].schema = changed;
      }
    }
    const apiPath = join(root, 'synthetic.openapi.json');
    await writeFile(apiPath, JSON.stringify(api));
    for (const name of ['clean', 'raw']) {
      const path = resolve(`fixtures/holdouts/${name}.md`);
      const task = await loadFreyaTask([path], apiPath, 'build-the-builder');
      assert.equal((task.briefs as any)[0].text, await readFile(path, 'utf8'));
      assert.equal((task.openapi as any).text, await readFile(apiPath, 'utf8'));
      assert.equal(task.description.includes('2027-01-06'), true);
      assert.equal('cases' in task, false);
      const workflow = compileWorkflow(task, {
        workflowJson: JSON.stringify({
          initial_node: 'talk',
          nodes: {
            talk: {
              name: 'talk',
              node_type: 'conversation',
              tools: ['verify_identity'],
              transitions: [],
            },
          },
        }),
        uncertainties: [],
      }) as any;
      const body = workflow.nodes.talk.tools[0].function.parameters.properties.body;
      assert.deepEqual(body.properties.security_phrase.enum, ['synthetic-phrase']);
      assert.ok(body.required.includes('security_phrase'));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
