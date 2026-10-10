import type { BuildOptions, BuildResult, Generator, PlatformAdapter, Task } from './contracts.ts';
import { recipe } from './recipe.ts';

export const defaultOptions: BuildOptions = { timeoutMs: recipe.limits.timeoutMs };

// Enforce deadlines even for an injected provider that ignores AbortSignal.
async function bounded<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void;
  const timeout = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('Build deadline exceeded.'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(fn), timeout]);
  } finally {
    signal.removeEventListener('abort', abort!);
  }
}

export async function build(
  task: Task,
  generator: Generator,
  adapter: PlatformAdapter,
  options: BuildOptions = defaultOptions,
): Promise<BuildResult> {
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error('timeoutMs must be a positive integer.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const signal = controller.signal;
  const result: BuildResult = {
    status: 'failed',
    candidate: null,
    artifact: null,
    rawCandidate: null,
    issues: [],
  };
  try {
    await recipe.run(
      task,
      {
        generate: (input) => bounded(() => generator.generate(input, signal), signal),
        compile: (input, candidate) =>
          bounded(() => adapter.create(input, candidate, signal), signal),
      },
      result,
    );
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Build failed';
  } finally {
    clearTimeout(timer);
  }
  return result;
}
