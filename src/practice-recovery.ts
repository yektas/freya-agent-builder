// Retrieve and score an existing timed-out practice job; never start another simulation.
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash } from './experiments.ts';
import { FreyaBridge } from './freya.ts';
import { object } from './validation.ts';
import { assertPracticeInputs } from './practice-inputs.ts';
import { readRunArtifact } from './ui/records.ts';
import { PracticeError, practiceAvailability } from './ui/practice.ts';
import type { PracticeOptions, PracticeJob } from './ui/practice.ts';
import { releasePractice, reservePractice } from './ui/activity.ts';

async function atomic(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function recoverPractice(
  options: PracticeOptions,
  runId: string,
): Promise<PracticeJob> {
  const root = resolve(options.root);
  if (!reservePractice(root, runId)) {
    throw new PracticeError(409, 'This run is already being tested or recovered.');
  }
  let recoveryLock: string | null = null;
  try {
    const availability = await practiceAvailability(options);
    if (!availability.available) {
      throw new PracticeError(503, availability.problem!);
    }
    const found = await readRunArtifact(root, runId, 'practice-job.json');
    if (!found || found.run.kind !== 'generation-only' || runId.startsWith('archive~')) {
      throw new PracticeError(404, 'No discovered generation practice job.');
    }
    const run = found.run;
    const job = JSON.parse(found.content);
    if (
      job.status !== 'failed' ||
      !job.endedAt ||
      !/deadline|timeout|timed out/i.test(job.error ?? '')
    ) {
      throw new PracticeError(
        409,
        'Recover a timed-out practice job after local polling has stopped.',
      );
    }
    const runText = await readFile(run.runFile, 'utf8');
    const recorded = JSON.parse(runText);
    if (recorded.status !== 'completed') {
      throw new PracticeError(409, 'Generation is not complete.');
    }
    const kit = resolve(options.kit);
    await assertPracticeInputs(recorded.task, kit, job.brief);
    if (
      !object(job.kit?.files) ||
      ['VERSION', 'freya.py', 'tools/run_cases.py', 'tools/score.py', 'public-test-set.json'].some(
        (name) => typeof job.kit.files[name] !== 'string',
      )
    ) {
      throw new PracticeError(409, 'The original practice package snapshot is missing.');
    }
    for (const [name, text] of Object.entries(job.kit.files)) {
      if (
        ![
          'VERSION',
          'freya.py',
          'tools/run_cases.py',
          'tools/score.py',
          'public-test-set.json',
        ].includes(name) ||
        (await readFile(join(kit, name), 'utf8')) !== text
      ) {
        throw new PracticeError(409, 'The event package changed since this practice job.');
      }
    }
    const upload = await readRunArtifact(root, runId, 'upload.json');
    const compiled = await readRunArtifact(root, runId, 'compiled.workflow.json');
    const registration = upload ? JSON.parse(upload.content) : null;
    if (
      !registration ||
      registration.status !== 'registered' ||
      !compiled ||
      registration.workflowHash !== job.workflowHash ||
      registration.agentId !== job.agentId ||
      registration.workspaceId !== job.workspaceId ||
      registration.workflowId !== job.workflowId ||
      hash(JSON.parse(compiled.content)) !== job.workflowHash ||
      typeof job.workspaceId !== 'string' ||
      !/^[\w-]+$/.test(job.workspaceId)
    ) {
      throw new PracticeError(409, 'Registration changed since this practice job.');
    }
    const trace = await readRunArtifact(root, runId, 'platform.jsonl');
    if (!trace) {
      throw new PracticeError(409, 'The recorded simulation trace is missing.');
    }
    const lock = join(root, 'freya-state', job.workspaceId, 'workspace.lock');
    // Only the timed-out job may release its retained workspace lock.
    const lockText = await readFile(lock, 'utf8');
    const owner = JSON.parse(lockText);
    if (owner.run !== run.runFile || owner.action !== 'practice') {
      throw new PracticeError(409, 'The workspace lock belongs to another operation.');
    }
    const recoveryPath = `${lock}.recovery`;
    const handle = await open(recoveryPath, 'wx', 0o600).catch(() => {
      throw new PracticeError(409, 'This workspace is already recovering results.');
    });
    recoveryLock = recoveryPath;
    await handle.close();
    const timeoutMs = Math.min(300000, Math.max(1000, options.timeoutMs ?? 180000));
    if (!Number.isFinite(timeoutMs)) {
      throw new PracticeError(422, 'Invalid recovery deadline.');
    }
    const env = options.env ?? process.env;
    const bridge =
      options.bridge?.({ kit, trace: trace.path, env }) ?? new FreyaBridge(kit, trace.path, env);
    const signal = AbortSignal.timeout(timeoutMs);
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const remaining = () => Math.max(1, Math.round(timeoutMs - (performance.now() - started)));
    const workspace = await bridge.call('probe', {}, signal, remaining());
    if (workspace.workspaceId !== job.workspaceId) {
      throw new PracticeError(409, 'The configured key belongs to a different workspace.');
    }
    bridge.env = { ...env, FREYA_WORKSPACE_ID: job.workspaceId };
    const resultPath = join(run.runPath, `recovery-${randomUUID()}.tmp`);
    let result: unknown;
    try {
      result = await bridge.call(
        'recover-practice',
        {
          agentId: job.agentId,
          workspaceId: job.workspaceId,
          casesPath: join(kit, 'public-test-set.json'),
          path: resultPath,
          brief: job.brief,
          repetitions: job.repetitions,
          startedAt: job.startedAt,
          endedAt: job.endedAt,
        },
        signal,
        remaining(),
      );
    } finally {
      await unlink(resultPath).catch(() => {});
    }
    if (
      !object(result) ||
      result.recovered !== true ||
      result.runs !== job.repetitions ||
      !Number.isInteger(result.total) ||
      Number(result.total) < 1 ||
      !Number.isInteger(result.passed) ||
      Number(result.passed) < 0 ||
      Number(result.passed) > Number(result.total) ||
      !Array.isArray(result.rows)
    ) {
      throw new PracticeError(502, 'Recovered scoring results are invalid.');
    }
    // Refuse to overwrite if another process changed the job or registration.
    if (
      (await readFile(lock, 'utf8')) !== lockText ||
      (await readFile(run.runFile, 'utf8')) !== runText ||
      (await readFile(join(run.runPath, 'practice-job.json'), 'utf8')) !== found.content ||
      (await readFile(join(run.runPath, 'upload.json'), 'utf8')) !== upload!.content ||
      (await readFile(compiled!.path, 'utf8')) !== compiled!.content
    ) {
      throw new PracticeError(409, 'Run or registration changed during recovery.');
    }
    const recoveryFiles = {
      'src/practice-recovery.ts': await readFile(
        new URL('./practice-recovery.ts', import.meta.url),
        'utf8',
      ),
      'src/practice_recovery.py': await readFile(
        new URL('./practice_recovery.py', import.meta.url),
        'utf8',
      ),
    };
    const recovered = {
      ...job,
      status: 'completed' as const,
      stage: 'done',
      error: null,
      passed: Number(result.passed),
      total: Number(result.total),
      recovery: {
        startedAt,
        endedAt: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - started),
        previousError: job.error,
        simulationIds: result.simulations,
        sourceHash: hash(recoveryFiles),
        sourceFiles: recoveryFiles,
        modelCalls: [],
      },
    };
    const historyPath = join(run.runPath, 'practice-history.json');
    const history = JSON.parse(await readFile(historyPath, 'utf8'));
    if (!Array.isArray(history)) {
      throw new PracticeError(409, 'Practice history is invalid.');
    }
    await atomic(join(run.runPath, 'practice.json'), result);
    await atomic(historyPath, [...history, { ...recovered, result }]);
    await atomic(join(run.runPath, 'practice-job.json'), recovered);
    if ((await readFile(lock, 'utf8')) === lockText) {
      await unlink(lock);
    }
    return recovered;
  } finally {
    if (recoveryLock) {
      await unlink(recoveryLock);
    }
    releasePractice(root, runId);
  }
}
