import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildOptions, BuildResult, Evaluation, Evaluator, Task } from './contracts.ts';
import type { CallRecord } from './providers.ts';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function sourceSnapshot() {
  const files: Record<string, string> = {};
  for (const name of [
    'package.json',
    'pnpm-lock.yaml',
    '.oxlintrc.json',
    '.oxfmtrc.json',
    '.nvmrc',
    'tsconfig.json',
  ]) {
    files[name] = await readFile(join(projectRoot, name), 'utf8');
  }
  for (const name of (await readdir(join(projectRoot, 'src')))
    .filter((name) => name.endsWith('.ts'))
    .sort()) {
    files[`src/${name}`] = await readFile(join(projectRoot, 'src', name), 'utf8');
  }
  let git: { commit: string; dirty: boolean } | null = null;
  try {
    git = {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim(),
      dirty: !!execFileSync('git', ['status', '--porcelain'], {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim(),
    };
  } catch {
    /* Source snapshot identifies versions before Git initialization too. */
  }
  return { hash: hash(files), files, git };
}

export type RunRecord = {
  runId: string;
  createdAt: string;
  task: Task;
  inputHash: string;
  candidateHash: string | null;
  source: Awaited<ReturnType<typeof sourceSnapshot>>;
  nodeVersion: string;
  provider: string;
  model: string | null;
  decisionsModel: string | null;
  maxCalls: number;
  options: BuildOptions;
  elapsedMs: number;
  build: BuildResult;
  calls: CallRecord[];
  evaluation: Evaluation;
};

export async function evaluate(
  evaluator: Evaluator | undefined,
  task: Task,
  artifact: unknown,
  timeoutMs: number,
): Promise<Evaluation> {
  if (!evaluator) {
    return {
      score: null,
      source: 'not-evaluated',
      details:
        'No official evaluation adapter configured. Structural validity is not task success.',
    };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  try {
    const result = await Promise.race([
      evaluator.evaluate(task, artifact, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Evaluation deadline exceeded.'));
        }, timeoutMs);
      }),
    ]);
    if (result.score !== null && !Number.isFinite(result.score)) {
      throw new Error('Evaluator returned a non-finite score.');
    }
    return result;
  } finally {
    clearTimeout(timer!);
  }
}

export async function saveRun(
  directory: string,
  data: Omit<RunRecord, 'runId' | 'createdAt'>,
): Promise<string> {
  const runId = randomUUID();
  const record: RunRecord = { runId, createdAt: new Date().toISOString(), ...data };
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${runId}.json`);
  await writeFile(path, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return path;
}

export async function report(directory: string) {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const groups = new Map<
    string,
    {
      variant: string;
      runs: number;
      built: number;
      fallback: number;
      failed: number;
      evaluated: number;
      scores: number[];
      milliseconds: number;
    }
  >();
  for (const name of names.filter((name) => name.endsWith('.json')).sort()) {
    const record: RunRecord = JSON.parse(await readFile(join(directory, name), 'utf8'));
    // Separate source versions, budgets, inputs and evaluator sources to prevent misleading averages.
    const variant = JSON.stringify({
      source: record.source.hash,
      provider: record.provider,
      model: record.model,
      decisionsModel: record.decisionsModel,
      options: record.options,
      maxCalls: record.maxCalls,
      task: record.task.id,
      input: record.inputHash,
      evaluator: record.evaluation.source,
    });
    const group = groups.get(variant) ?? {
      variant,
      runs: 0,
      built: 0,
      fallback: 0,
      failed: 0,
      evaluated: 0,
      scores: [],
      milliseconds: 0,
    };
    group.runs++;
    group[record.build.status]++;
    group.milliseconds += record.elapsedMs;
    if (record.evaluation.score !== null) {
      group.evaluated++;
      group.scores.push(record.evaluation.score);
    }
    groups.set(variant, group);
  }
  return [...groups.values()].map(({ scores, milliseconds, ...group }) => ({
    ...group,
    meanElapsedMs: Math.round(milliseconds / group.runs),
    meanScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
  }));
}
