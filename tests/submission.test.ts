// Local synthetic repository and export only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from '../src/experiments.ts';
import { prepareSubmission, finalizeSubmission } from '../src/submission.ts';

test('single-case submission matches the selected export, trace, and committed builder', async () => {
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
    const dir = join(root, 'run');
    await mkdir(dir);
    const exported = {
      workflow_id: 'w1',
      agent_id: 'a1',
      workflow: {
        nodes: {
          done: {
            node_type: 'end_call',
            tools: [
              {
                function: {
                  name: 'synthetic_tool',
                  handler: '__function__:api_call',
                  parameters: {
                    properties: {
                      url: { default: 'https://bank.example.workers.dev/synthetic_tool' },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    };
    const run = {
      kind: 'freya-live-run',
      status: 'completed',
      config: { final: true, model: 'synthetic', mockUrl: 'https://bank.example.workers.dev' },
      source: { hash: hash(files), files, git: { commit, dirty: false } },
      startedAt: '2026-10-11T17:00:00Z',
      endedAt: '2026-10-11T17:01:00Z',
      elapsedMs: 60000,
      calls: [
        {
          request: {
            prompt: 'Example Authorization: Bearer token',
            attachment: 'x'.repeat(1_100_000),
          },
        },
      ],
      modelCallPurpose: 'Synthetic fixture',
      task: {
        description: 'Example Authorization: Bearer token',
        tools: [{ name: 'synthetic_tool', url: 'https://original.example.invalid/synthetic_tool' }],
      },
      inputHash: 'input',
      workflow: exported.workflow,
      registration: { workflow_id: 'w1', agent_id: 'a1' },
      exportHash: hash(exported),
      evaluation: { score: null },
    };
    const runFile = join(dir, 'run.json');
    await writeFile(runFile, JSON.stringify(run));
    await writeFile(join(dir, 'exported.workflow.json'), JSON.stringify(exported, null, 2));
    const options = {
      runs: [runFile],
      out: 'submission',
      team: 'synthetic',
      members: [{ name: 'Synthetic Tester', email: 'synthetic@example.invalid' }],
      repo: 'https://example.invalid/repo',
      commit,
      mockUrl: 'https://bank.example.workers.dev',
      runCommand: 'node src/final.ts {case_folder} {mock_url}',
    };
    await assert.rejects(
      () => prepareSubmission({ ...options, mockUrl: 'http://bank.example.workers.dev' }, root),
      /Submission needs/,
    );
    await assert.rejects(
      () => prepareSubmission({ ...options, mockUrl: 'https://other.workers.dev' }, root),
      /bound to this mock URL/,
    );
    const original = await readFile(join(dir, 'exported.workflow.json'), 'utf8');
    await writeFile(
      join(dir, 'exported.workflow.json'),
      original.replace('end_call', 'conversation'),
    );
    await assert.rejects(() => prepareSubmission(options, root), /Export changed/);
    await writeFile(join(dir, 'exported.workflow.json'), original);

    const pending = await prepareSubmission(options, root);
    assert.deepEqual(Object.keys(pending), [
      'team',
      'members',
      'repo',
      'commit',
      'run_command',
      'workflow',
      'trace',
      'mock_url',
    ]);
    assert.equal(pending.workflow, 'submission/final.workflow.json');
    assert.equal(pending.trace, 'submission/final.trace.json');
    assert.equal(pending.mock_url, options.mockUrl);
    const trace = JSON.parse(await readFile(join(root, pending.trace), 'utf8'));
    assert.equal(trace.inputs.description, 'Example Authorization: Bearer [REDACTED]');
    assert.equal(
      trace.modelCalls[0].call.request.prompt,
      'Example Authorization: Bearer [REDACTED]',
    );
    assert.equal(run.task.description, 'Example Authorization: Bearer token');
    await assert.rejects(() => finalizeSubmission('submission', commit, root));
    git('add', 'submission/final.workflow.json', 'submission/final.trace.json');
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
