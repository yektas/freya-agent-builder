import type {
  Auditor,
  BuildOptions,
  BuildResult,
  Candidate,
  Feedback,
  Generator,
  PlatformAdapter,
  Task,
} from './contracts.ts';
import { candidateIssues, parseCandidate } from './validation.ts';

export const defaultOptions: BuildOptions = {
  strategy: 'direct',
  timeoutMs: 120000,
  maxRepairs: 1,
  auditMode: 'off',
  auditThreshold: 0.8,
};

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
  auditor?: Auditor,
): Promise<BuildResult> {
  if (!Number.isInteger(options.maxRepairs) || options.maxRepairs < 0 || options.maxRepairs > 3) {
    throw new Error('maxRepairs must be 0–3.');
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error('timeoutMs must be a positive integer.');
  }
  if (
    !Number.isFinite(options.auditThreshold) ||
    options.auditThreshold < 0 ||
    options.auditThreshold > 1
  ) {
    throw new Error('auditThreshold must be 0–1.');
  }
  if (!['direct', 'planned'].includes(options.strategy)) {
    throw new Error('Unknown strategy.');
  }
  if (!['off', 'report', 'repair'].includes(options.auditMode)) {
    throw new Error('Unknown audit mode.');
  }
  if (options.auditMode !== 'off' && !auditor) {
    throw new Error('Selected audit mode requires an auditor.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const signal = controller.signal;
  const result: BuildResult = {
    status: 'failed',
    candidate: null,
    artifact: null,
    attempts: [],
    warnings: [],
  };
  let best: { candidate: Candidate; artifact: unknown; risk: number; attempt: number } | undefined;
  let feedback: Feedback | undefined;
  try {
    for (let index = 0; index <= options.maxRepairs; index++) {
      const raw = await bounded(
        () => generator.generate(task, options.strategy, signal, feedback),
        signal,
      );
      const issues = candidateIssues(raw, task);
      const attempt = { candidate: raw, issues, audit: null } as BuildResult['attempts'][number];
      result.attempts.push(attempt);
      if (issues.length) {
        feedback = { previous: raw, issues };
        continue;
      }
      const candidate = parseCandidate(raw, task);
      // Materialize a valid fallback before spending remaining time on optional audit/repair.
      const artifact = await bounded(() => adapter.create(task, candidate, signal), signal);
      let risk = Infinity;
      if (!best) {
        best = { candidate, artifact, risk, attempt: index };
      }
      if (options.auditMode !== 'off') {
        try {
          attempt.audit = await bounded(() => auditor!.audit(task, candidate, signal), signal);
          risk = Math.max(0, ...attempt.audit.map((finding) => finding.probability));
        } catch (error) {
          attempt.auditError = error instanceof Error ? error.message : 'Audit failed';
          result.warnings.push(`Audit unavailable: ${attempt.auditError}`);
          break;
        }
      } else {
        risk = 0;
      }
      if (risk < best.risk) {
        best = { candidate, artifact, risk, attempt: index };
      }
      const flagged =
        attempt.audit?.filter((finding) => finding.probability >= options.auditThreshold) ?? [];
      if (flagged.length) {
        result.warnings.push(
          `Attempt ${index + 1}: audit flags ${flagged.map((f) => f.name).join(', ')}. Heuristic only.`,
        );
      }
      if (options.auditMode !== 'repair' || !flagged.length) {
        break;
      }
      feedback = {
        previous: raw,
        issues: flagged.map(
          (f) =>
            `${f.name}: ${f.question} Estimated probability ${f.probability}; verify against source before changing.`,
        ),
      };
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Build failed';
  } finally {
    clearTimeout(timer);
  }
  if (best) {
    result.candidate = best.candidate;
    result.artifact = best.artifact;
    result.status =
      result.error ||
      best.attempt !== result.attempts.length - 1 ||
      result.attempts.at(-1)?.auditError
        ? 'fallback'
        : 'built';
  } else {
    result.error ??= 'No structurally valid candidate was produced within the repair budget.';
  }
  return result;
}
