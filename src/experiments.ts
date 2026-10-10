import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildOptions, BuildResult, Task } from './contracts.ts';
import type { CallRecord, ReasoningEffort } from './providers.ts';
import type { CostEstimate, TokenUsage } from './usage.ts';

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
    .filter((name) => name.endsWith('.ts') || name.endsWith('.py'))
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
  reasoningEffort: ReasoningEffort | null;
  maxCalls: number;
  options: BuildOptions;
  elapsedMs: number;
  build: BuildResult;
  calls: CallRecord[];
  // Null for mock runs and for live runs that never reached a model call.
  usage: { tokens: TokenUsage; cost: CostEstimate } | null;
  evaluation: { score: null; source: 'not-evaluated'; details: string };
};

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
