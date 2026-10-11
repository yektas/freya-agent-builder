// Local synthetic repository and exports only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from '../src/experiments.ts';
import { prepareSubmission, finalizeSubmission } from '../src/submission.ts';

test('submission preserves exports, rejects changed artifacts, and verifies code and files at the submission commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'submission-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    git('init');
    git('config', 'user.name', 'Synthetic');
    git('config', 'user.email', 'synthetic@example.invalid');
    const files = { 'builder.ts': '// Synthetic source\n' };
    await writeFile(join(root, 'builder.ts'), files['builder.ts']);
    git('add', 'builder.ts');
    git('commit', '-m', 'Synthetic source');
    const commit = git('rev-parse', 'HEAD').trim();
    const runs = [];
    for (const n of [1, 2]) {
      const dir = join(root, `run-${n}`);
      await mkdir(dir);
      const exported = {
        workflow_id: `w${n}`,
        agent_id: `a${n}`,
        workflow: { nodes: { done: { node_type: 'end_call' } } },
      };
      const run = {
        kind: 'freya-live-run',
        status: 'completed',
        config: { final: true, model: 'synthetic' },
        source: { hash: hash(files), files, git: { commit, dirty: false } },
        startedAt: '2026-10-11T17:00:00Z',
        endedAt: '2026-10-11T17:01:00Z',
        elapsedMs: 60000,
        calls: [],
        modelCallPurpose: 'Synthetic fixture',
        task: { tools: [], briefs: [{ text: `Synthetic ${n}` }] },
        inputHash: `input-${n}`,
        workflow: exported.workflow,
        registration: { workflow_id: `w${n}`, agent_id: `a${n}` },
        exportHash: hash(exported),
        evaluation: { score: null },
      };
      const path = join(dir, 'run.json');
      await writeFile(path, JSON.stringify(run));
      runs.push(path);
      await writeFile(join(dir, 'exported.workflow.json'), JSON.stringify(exported, null, 2));
    }
    const options = {
      runs,
      out: 'submission',
      team: 'synthetic',
      repo: 'https://example.invalid/repo',
      commit,
    };
    const changed = join(root, 'run-1/exported.workflow.json');
    const original = await readFile(changed, 'utf8');
    await writeFile(changed, original.replace('end_call', 'conversation'));
    await assert.rejects(() => prepareSubmission(options, root), /Export changed/);
    await writeFile(changed, original);
    const pending = await prepareSubmission(options, root);
    assert.equal(pending.commit, null);
    assert.equal(await readFile(join(root, 'submission/hidden-1.workflow.json'), 'utf8'), original);
    await assert.rejects(() => finalizeSubmission('submission', commit, root)); // artifacts not committed yet
    git(
      'add',
      'submission/hidden-1.workflow.json',
      'submission/hidden-2.workflow.json',
      'submission/hidden-1.trace.json',
      'submission/hidden-2.trace.json',
    );
    git('commit', '-m', 'Synthetic selected artifacts');
    const submissionCommit = git('rev-parse', 'HEAD').trim();
    const form = await finalizeSubmission('submission', submissionCommit, root);
    assert.equal(form.commit, submissionCommit);
    await writeFile(join(root, 'builder.ts'), '// changed source\n');
    git('add', 'builder.ts');
    git('commit', '-m', 'Changed builder');
    await assert.rejects(
      () => finalizeSubmission('submission', git('rev-parse', 'HEAD').trim(), root),
      /Submitted builder differs/,
    );
    await assert.rejects(() => prepareSubmission(options, root), /EEXIST/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
