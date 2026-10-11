// Synthetic transports only. These results are not benchmark scores.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runFreya } from '../src/event.ts';

const kit = resolve('build-the-builder');
export function syntheticEvent(root: string, timeout: boolean | 'abort' = false) {
  const actions: string[] = [];
  const options = {
    briefs: [join(kit, 'briefs/brief-a.md')],
    openapi: join(kit, 'tools/openapi.json'),
    kit,
    slot: 'synthetic',
    out: root,
    brief: 'A',
    timeoutMs: 30000,
    model: 'synthetic',
  };
  const dependencies = {
    env: { FREYA_API_KEY: 'synthetic', FREYA_BANK_TEAM_KEY: 'synthetic-team-key' },
    generator: {
      calls: [],
      async generate() {
        return {
          workflowJson: JSON.stringify({
            initial_node: 'done',
            nodes: {
              done: { name: 'done', node_type: 'end_call', transitions: [] },
            },
          }),
          uncertainties: [],
        };
      },
    },
    bridge: () => ({
      env: {},
      redact: (value: string) => value,
      async call(action: string, data: Record<string, unknown>, signal: AbortSignal) {
        actions.push(action);
        if (action === 'probe') {
          return { workspaceId: 'synthetic-workspace' };
        }
        if (action === 'register') {
          return { workflow_id: 'synthetic-workflow', agent_id: 'synthetic-agent' };
        }
        if (action === 'export') {
          await writeFile(
            String(data.path),
            JSON.stringify({
              workflow_id: 'synthetic-workflow',
              agent_id: 'synthetic-agent',
              workflow: { nodes: { done: {} } },
            }),
          );
        }
        if (action === 'practice') {
          if (timeout === 'abort') {
            await new Promise((_, reject) => {
              const guard = setTimeout(
                () => reject(new Error('Synthetic deadline did not fire')),
                5000,
              );
              signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(guard);
                  reject(new Error('Synthetic aborted simulation'));
                },
                { once: true },
              );
            });
          }
          if (timeout) {
            throw new Error('Synthetic timeout while simulation runs remotely');
          }
          return { passed: 1, total: 1, runs: data.repetitions, rows: [] };
        }
        return {};
      },
    }),
  };
  return { options, dependencies, actions };
}

test('CLI retains workspace lock after an uncertain practice timeout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'event-lock-'));
  try {
    const h = syntheticEvent(root, true);
    const result = await runFreya(h.options, h.dependencies);
    assert.equal(result.status, 'failed');
    assert.ok(await readFile(join(root, 'freya-state/synthetic-workspace/workspace.lock')));
    assert.match(result.error ?? '', /remote simulation may still be running/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('final run exports without reading public cases or testing the new brief', async () => {
  const root = await mkdtemp(join(tmpdir(), 'event-final-'));
  try {
    const h = syntheticEvent(root);
    const hidden = join(root, 'synthetic-raw.md');
    await writeFile(hidden, 'Synthetic bank mail: use a different outcome table.');
    const result = await runFreya(
      {
        ...h.options,
        briefs: [hidden],
        final: true,
        brief: undefined,
        mockUrl: 'https://synthetic-bank.workers.dev',
      },
      h.dependencies,
    );
    assert.equal(result.status, 'completed');
    assert.deepEqual(h.actions, ['probe', 'validate', 'register', 'export']);
    const record = JSON.parse(await readFile(result.path, 'utf8'));
    assert.equal(record.evaluation.score, null);
    assert.equal('public-test-set.json' in record.kit.files, false);
    assert.ok(record.exportHash);
    assert.equal(
      record.task.tools[0].url,
      'https://freya-bank-mock.freyavoice.workers.dev/v1/verify_identity',
    );
    assert.equal(
      record.task.openapi.document.servers[0].url,
      'https://freya-bank-mock.freyavoice.workers.dev/v1',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('three repetitions reach the scorer; confirmed completion releases the CLI lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'event-reps-'));
  try {
    const h = syntheticEvent(root);
    const result = await runFreya({ ...h.options, repetitions: 3 }, h.dependencies);
    assert.equal(result.status, 'completed');
    const record = JSON.parse(await readFile(result.path, 'utf8'));
    assert.equal(record.practice.runs, 3);
    assert.equal(record.evaluation.repetitions, 3);
    await assert.rejects(() =>
      readFile(join(root, 'freya-state/synthetic-workspace/workspace.lock')),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('mismatched practice is refused before model or platform calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'event-mismatch-'));
  try {
    const h = syntheticEvent(root);
    await assert.rejects(
      () => runFreya({ ...h.options, brief: 'B' }, h.dependencies),
      /matching original brief/,
    );
    assert.deepEqual(h.actions, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('actual deadline expiry reports the retained lock instead of hiding it behind a generic error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'event-deadline-'));
  try {
    const h = syntheticEvent(root, 'abort');
    const result = await runFreya({ ...h.options, timeoutMs: 1000 }, h.dependencies);
    assert.match(result.error ?? '', /remote simulation may still be running/);
    const record = JSON.parse(await readFile(result.path, 'utf8'));
    assert.ok(await readFile(record.retainedWorkspaceLock));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
