// Test an already uploaded agent using the unchanged event runner. No builder
// model call or registration occurs here; results are separate run artifacts.
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, sourceSnapshot } from '../experiments.ts';
import { FreyaBridge } from '../freya.ts';
import { object } from '../validation.ts';
import { assertPracticeInputs } from '../practice-inputs.ts';
import { readRunArtifact } from './records.ts';
import type { BridgeFactory, UploadOptions } from './upload.ts';
import { reservePractice, releasePractice } from './activity.ts';

export type PracticeOptions = UploadOptions;
export type PracticeJob = {
  id: string;
  status: 'running' | 'completed' | 'failed';
  stage: string;
  brief: 'A' | 'B' | 'all';
  style: string | null;
  repetitions: number;
  agentId: string;
  workflowId: string;
  workspaceId: string;
  workflowHash: string;
  startedAt: string;
  endedAt: string | null;
  elapsedMs: number | null;
  error: string | null;
  passed: number | null;
  total: number | null;
};
export class PracticeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PracticeError';
    this.status = status;
  }
}
const styles = ['pieces', 'corrects', 'talkative', 'asks_back', 'in_words'];
const spawnBridge: BridgeFactory = ({ kit, trace, env }) => new FreyaBridge(kit, trace, env);

async function atomic(path: string, data: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function practiceAvailability(options: PracticeOptions) {
  const env = options.env ?? process.env;
  let problem: string | null = null;
  if (
    !env.FREYA_API_KEY?.trim() ||
    !env.FREYA_BANK_TEAM_KEY ||
    env.FREYA_BANK_TEAM_KEY.length < 16
  ) {
    problem =
      'Testing needs FREYA_API_KEY and a stable FREYA_BANK_TEAM_KEY of at least 16 characters. Restart the inspector after configuring them.';
  } else {
    try {
      for (const name of [
        'freya.py',
        'tools/run_cases.py',
        'tools/score.py',
        'public-test-set.json',
      ]) {
        await readFile(join(resolve(options.kit), name), 'utf8');
      }
    } catch {
      problem = 'The configured event package is missing its practice runner or cases.';
    }
  }
  return { available: problem === null, problem };
}

export async function startPractice(
  options: PracticeOptions,
  runId: string,
  request: Record<string, unknown>,
): Promise<PracticeJob> {
  if (Object.keys(request).some((key) => !['brief', 'style', 'repetitions'].includes(key))) {
    throw new PracticeError(422, 'Testing accepts brief, style, and repetitions only.');
  }
  const brief = request.brief ?? 'A';
  const style = request.style ?? null;
  const repetitions = request.repetitions ?? 1;
  if (brief !== 'A' && brief !== 'B' && brief !== 'all') {
    throw new PracticeError(422, 'Choose Brief A, B, or all.');
  }
  if (style !== null && (typeof style !== 'string' || !styles.includes(style))) {
    throw new PracticeError(422, 'Unknown speaking style.');
  }
  if (repetitions !== 1 && repetitions !== 3) {
    throw new PracticeError(422, 'Choose one or three repetitions.');
  }
  const root = resolve(options.root);
  if (!reservePractice(root, runId)) {
    throw new PracticeError(409, 'This run is already being tested.');
  }
  // Reserve before any awaits, including scanning and credential checks.
  let dispatched = false;
  let release: (() => Promise<void>) | null = null;
  try {
    const availability = await practiceAvailability(options);
    if (!availability.available) {
      throw new PracticeError(503, availability.problem!);
    }
    const found = await readRunArtifact(root, runId, 'upload.json');
    if (!found) {
      throw new PracticeError(404, 'No discovered uploaded run.');
    }
    const run = found.run;
    if (runId.startsWith('archive~') || run.kind !== 'generation-only') {
      throw new PracticeError(409, 'Restore a completed generation before testing it.');
    }
    const recorded = JSON.parse(await readFile(run.runFile, 'utf8'));
    if (recorded.status !== 'completed') {
      throw new PracticeError(409, 'Generation is not complete.');
    }
    try {
      await assertPracticeInputs(recorded.task, resolve(options.kit), brief);
    } catch (error) {
      throw new PracticeError(
        422,
        error instanceof Error ? error.message : 'Practice inputs do not match.',
      );
    }
    const upload = JSON.parse(found.content);
    if (
      upload.status !== 'registered' ||
      typeof upload.agentId !== 'string' ||
      !upload.agentId ||
      typeof upload.workflowId !== 'string' ||
      !upload.workflowId ||
      typeof upload.workspaceId !== 'string' ||
      !upload.workspaceId ||
      !/^[\w-]+$/.test(upload.workspaceId)
    ) {
      throw new PracticeError(409, 'Upload this generation successfully before testing.');
    }
    const compiled = await readRunArtifact(root, runId, 'compiled.workflow.json');
    if (!compiled || hash(JSON.parse(compiled.content)) !== upload.workflowHash) {
      throw new PracticeError(
        409,
        'The compiled workflow changed since upload. Upload it again first.',
      );
    }
    const stateRoot = join(root, 'freya-state', upload.workspaceId);
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    const lock = join(stateRoot, 'workspace.lock');
    const handle = await open(lock, 'wx', 0o600).catch(() => {
      throw new PracticeError(
        409,
        'The workspace is busy. Wait for its current upload or practice run to finish.',
      );
    });
    release = () => unlink(lock);
    try {
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, run: run.runFile, action: 'practice' }),
      );
    } finally {
      await handle.close();
    }
    // An upload might have completed between the first scan and taking the lock.
    const latest = JSON.parse(await readFile(join(run.runPath, 'upload.json'), 'utf8'));
    if (
      latest.status !== 'registered' ||
      latest.workflowHash !== upload.workflowHash ||
      latest.agentId !== upload.agentId ||
      latest.workspaceId !== upload.workspaceId
    ) {
      throw new PracticeError(409, 'Registration changed. Refresh the run before testing.');
    }
    const kit = resolve(options.kit);
    const casesPath = join(kit, 'public-test-set.json');
    const caseText = await readFile(casesPath, 'utf8');
    const cases: unknown = JSON.parse(caseText);
    if (
      !Array.isArray(cases) ||
      !cases.some((item) => object(item) && (brief === 'all' || item.brief === brief))
    ) {
      throw new PracticeError(422, 'No practice cases for the selected brief.');
    }
    const kitFiles: Record<string, string> = {};
    for (const name of [
      'VERSION',
      'freya.py',
      'tools/run_cases.py',
      'tools/score.py',
      'public-test-set.json',
    ]) {
      kitFiles[name] = await readFile(join(kit, name), 'utf8');
    }
    const timeoutMs = Math.min(1800000, Math.max(1000, options.timeoutMs ?? 1500000));
    if (!Number.isFinite(timeoutMs)) {
      throw new PracticeError(422, 'Invalid practice deadline.');
    }
    const job: PracticeJob = {
      id: randomUUID(),
      status: 'running',
      stage: 'verify workspace',
      brief,
      style,
      repetitions,
      agentId: upload.agentId,
      workflowId: upload.workflowId,
      workspaceId: upload.workspaceId,
      workflowHash: upload.workflowHash,
      startedAt: new Date().toISOString(),
      endedAt: null,
      elapsedMs: null,
      error: null,
      passed: null,
      total: null,
    };
    const source = await sourceSnapshot();
    for (const name of ['practice.ts', 'activity.ts', 'records.ts', 'server.ts']) {
      source.files[`src/ui/${name}`] = await readFile(
        new URL(`./${name}`, import.meta.url),
        'utf8',
      );
    }
    source.hash = hash(source.files);
    const provenance = {
      source,
      kit: { hash: hash(kitFiles), files: kitFiles },
      caseHash: hash(caseText),
      modelCalls: [],
    };
    const jobPath = join(run.runPath, 'practice-job.json');
    await atomic(jobPath, { ...job, ...provenance });
    const env = options.env ?? process.env;
    const bridge = (options.bridge ?? spawnBridge)({
      kit,
      trace: join(run.runPath, 'platform.jsonl'),
      env,
    });
    const signal = AbortSignal.timeout(timeoutMs);
    const started = performance.now();
    const remaining = () => Math.max(1, Math.round(timeoutMs - (performance.now() - started)));
    const unlock = release;
    const runTest = async () => {
      let result: unknown = null;
      let uncertain = false;
      const resultPath = join(run.runPath, `practice-${job.id}.tmp`);
      try {
        const workspace = await bridge.call('probe', {}, signal, remaining());
        if (workspace.workspaceId !== job.workspaceId) {
          throw new Error('The configured key belongs to a different workspace than this upload.');
        }
        bridge.env = { ...env, FREYA_WORKSPACE_ID: job.workspaceId };
        job.stage = 'simulation and scoring';
        await atomic(jobPath, { ...job, ...provenance });
        result = await bridge.call(
          'practice',
          {
            agentId: job.agentId,
            casesPath,
            cacheDir: join(stateRoot, 'practice'),
            path: resultPath,
            ...(brief === 'all' ? {} : { brief }),
            ...(style ? { style } : {}),
            repetitions,
          },
          signal,
          remaining(),
        );
        if (
          !object(result) ||
          !Number.isInteger(result.total) ||
          Number(result.total) < 1 ||
          !Number.isInteger(result.passed) ||
          Number(result.passed) < 0 ||
          Number(result.passed) > Number(result.total) ||
          result.runs !== repetitions ||
          !Array.isArray(result.rows)
        ) {
          throw new Error('The practice runner returned invalid scoring results.');
        }
        await atomic(join(run.runPath, 'practice.json'), result);
        job.status = 'completed';
        job.stage = 'done';
        job.passed = Number(result.passed);
        job.total = Number(result.total);
      } catch (error) {
        job.status = 'failed';
        let reason = error instanceof Error ? error.message : String(error);
        for (const name of ['FREYA_API_KEY', 'FREYA_BANK_TEAM_KEY', 'OPENAI_API_KEY']) {
          if (env[name]) {
            reason = reason.replaceAll(env[name]!, '[REDACTED]');
          }
        }
        uncertain =
          job.stage === 'simulation and scoring' &&
          (signal.aborted || /deadline|timed out|timeout/i.test(reason));
        job.error = uncertain
          ? `Practice deadline exceeded. The remote simulation may still be running. Verify it has stopped before removing ${lock}.`
          : reason;
      } finally {
        job.endedAt = new Date().toISOString();
        job.elapsedMs = Math.round(performance.now() - started);
        try {
          await atomic(jobPath, { ...job, ...provenance });
          let history: unknown[] = [];
          try {
            const previous: unknown = JSON.parse(
              await readFile(join(run.runPath, 'practice-history.json'), 'utf8'),
            );
            if (Array.isArray(previous)) {
              history = previous;
            }
          } catch {
            /* First test. */
          }
          await atomic(join(run.runPath, 'practice-history.json'), [
            ...history,
            { ...job, ...provenance, result },
          ]);
        } finally {
          await unlink(resultPath).catch(() => {});
          if (!uncertain) {
            await unlock();
          }
          releasePractice(root, runId);
        }
      }
    };
    // Return immediately; polling reads the persisted job even after refresh.
    void runTest().catch(() => {
      /* Recorded failure remains reviewable. */
    });
    dispatched = true;
    return { ...job };
  } finally {
    if (!dispatched) {
      if (release) {
        await release();
      }
      releasePractice(root, runId);
    }
  }
}
