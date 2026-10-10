// Starting a generation is the inspector's second authorized write. It runs the
// same `generateFreyaJson` a CLI `generate` runs, with the provider, model, and
// reasoning effort chosen in the browser. Everything the browser sends is a
// choice, not a capability: it may not name a path, a key, or a package outside
// the event kit, and every credential stays in this process.
//
// The run it starts writes into the same `experiments/generation/<runId>`
// directory the CLI writes, so it appears in the inspector immediately, is
// recorded with the same source snapshot and usage totals, and can be uploaded
// through the existing action once it completes.
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { newGenerationRunId } from '../generation-trace.ts';
import { liveProvider } from '../codex.ts';
import type { LiveProvider } from '../codex.ts';
import { generateFreyaJson } from '../event.ts';
import { reasoningEfforts, parseReasoningEffort } from '../providers.ts';
import type { ReasoningEffort } from '../providers.ts';
import { freyaRecipe } from '../recipe.ts';

/**
 * Only generations are started here: one direct-generation call that compiles a
 * workflow locally and stops. Registration stays the separate upload action and
 * practice testing stays out of the inspector entirely.
 */
export type GenerationRequest = {
  provider?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
};

/** What the browser is told it may choose, and what it may not. */
export type GenerationOptions = {
  /** Record root, where `generation/<runId>` is written. */
  root: string;
  /** The unchanged event package directory. */
  kit: string;
  openapi?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Model ids offered per provider. A model outside these lists is still
   * accepted; these are shortcuts to the ones this repository documents.
   */
  models?: Partial<Record<LiveProvider, string[]>>;
  /** Runs the generation. Tests inject a transport so no model is called. */
  generate?: GenerateRunner;
};

export type GenerateRunner = (options: {
  runId: string;
  out: string;
  kit: string;
  openapi: string;
  briefs: string[];
  provider: LiveProvider;
  model: string;
  reasoningEffort?: ReasoningEffort;
  timeoutMs: number;
}) => Promise<unknown>;

/** A refused request, with the status the route should answer. */
export class GenerateError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GenerateError';
    this.status = status;
  }
}

export type GenerationAvailability = {
  available: boolean;
  problem: string | null;
  /** Per-provider readiness, so one unusable path does not disable the other. */
  providers: { id: LiveProvider; available: boolean; problem: string | null }[];
  models: Record<LiveProvider, string[]>;
  reasoningEfforts: ReasoningEffort[];
  /** Bounded by the recipe; the browser cannot raise it. */
  timeoutMs: number;
  /** The run already in flight, if any. One generation at a time. */
  running: { runId: string; provider: LiveProvider; model: string } | null;
};

// Models this repository documents for each path. Not an allowlist: a custom id
// is still accepted, because the provider is the authority on what it can run.
const API_MODELS = ['gpt-6.1-sol', 'gpt-6-luna'];
const CODEX_MODELS = ['gpt-6.1-sol', 'gpt-6-luna'];

export const defaultModels: Record<LiveProvider, string[]> = {
  openai: API_MODELS,
  codex: CODEX_MODELS,
};

// One generation at a time: a second click would double the spend and interleave
// two runs in one inspector. The running run is reported instead of refused.
let running: { runId: string; provider: LiveProvider; model: string } | null = null;

const runGeneration: GenerateRunner = (options) =>
  generateFreyaJson({
    briefs: options.briefs,
    openapi: options.openapi,
    kit: options.kit,
    out: options.out,
    runId: options.runId,
    provider: options.provider,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    timeoutMs: options.timeoutMs,
    // The browser watches the recorded trace, so the terminal copy would only
    // duplicate it. Failures still name their trace directory.
    quiet: true,
  });

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

// The kit supplies the briefs and the OpenAPI document. The browser chooses
// which brief files by name within the kit; it never sends a path.
function briefPath(kit: string, name: string): string {
  if (!/^[\w.+-]+$/.test(name)) {
    throw new GenerateError(422, `Brief name "${name}" is not a simple file name.`);
  }
  return join(resolve(kit, 'briefs'), `${name}.md`);
}

export async function defaultBrief(kit: string): Promise<string> {
  return briefPath(kit, 'brief-a');
}

export async function generationAvailability(
  options: GenerationOptions,
): Promise<GenerationAvailability> {
  const kit = resolve(options.kit);
  const env = options.env ?? process.env;
  const providers: GenerationAvailability['providers'] = [];
  for (const id of ['openai', 'codex'] as LiveProvider[]) {
    if (id === 'openai') {
      // The key is read here and never sent; only its presence is reported.
      providers.push({
        id,
        available: !!env.OPENAI_API_KEY?.trim(),
        problem: env.OPENAI_API_KEY?.trim()
          ? null
          : 'Set OPENAI_API_KEY before generating through the API provider.',
      });
      continue;
    }
    providers.push({
      id,
      // The Codex CLI keeps its own ChatGPT login; nothing in this process says
      // whether it is usable, so the run reports the real answer.
      available: true,
      problem: null,
    });
  }
  const models: Record<LiveProvider, string[]> = {
    openai: options.models?.openai ?? defaultModels.openai,
    codex: options.models?.codex ?? defaultModels.codex,
  };
  const missing: string[] = [];
  if (!(await exists(join(kit, 'freya.py')))) {
    missing.push(`No event package at ${kit}. Pass --kit DIRECTORY.`);
  }
  if (!(await exists(join(kit, 'briefs', 'brief-a.md')))) {
    missing.push(`No briefs in ${join(kit, 'briefs')}. Pass --kit DIRECTORY.`);
  }
  const openapi = options.openapi ?? join(kit, 'tools', 'openapi.json');
  if (!(await exists(openapi))) {
    missing.push(`No original OpenAPI at ${openapi}. Pass --openapi FILE.`);
  }
  return {
    available: missing.length === 0,
    problem: missing.length ? missing.join(' ') : null,
    providers,
    models,
    reasoningEfforts: [...reasoningEfforts],
    timeoutMs: freyaRecipe.limits.generationTimeoutMs,
    running: running && { ...running },
  };
}

/**
 * Validates the browser's three choices and starts one generation. Returns as
 * soon as the run is recorded and addressable, so the inspector can navigate to
 * it and watch the trace stream in; the model call continues in this process.
 */
export async function startGeneration(
  options: GenerationOptions,
  request: GenerationRequest,
): Promise<{
  runId: string;
  provider: LiveProvider;
  model: string;
  reasoningEffort?: ReasoningEffort;
}> {
  const kit = resolve(options.kit);
  const openapi = options.openapi ?? join(kit, 'tools', 'openapi.json');
  const availability = await generationAvailability(options);
  if (!availability.available) {
    throw new GenerateError(503, availability.problem!);
  }
  if (running) {
    throw new GenerateError(
      409,
      `Generation ${running.runId} is still running (${running.provider} / ${running.model}). Wait for it to finish before starting another.`,
    );
  }

  let provider: LiveProvider;
  try {
    provider = liveProvider(String(request.provider ?? 'openai'));
  } catch (error) {
    throw new GenerateError(422, message(error));
  }
  const readiness = availability.providers.find((item) => item.id === provider)!;
  if (!readiness.available) {
    throw new GenerateError(503, readiness.problem!);
  }

  const model = String(request.model ?? '').trim();
  if (!model) {
    throw new GenerateError(422, 'Choose a model; the provider is asked for one explicitly.');
  }
  if (model.length > 120 || /[\r\n]/.test(model)) {
    throw new GenerateError(422, 'Model name is too long or contains a line break.');
  }

  let reasoningEffort: ReasoningEffort | undefined;
  try {
    reasoningEffort = parseReasoningEffort(
      request.reasoningEffort === undefined || request.reasoningEffort === null
        ? undefined
        : String(request.reasoningEffort),
    );
  } catch (error) {
    throw new GenerateError(422, message(error));
  }
  if (provider === 'openai' && reasoningEffort === 'ultra') {
    throw new GenerateError(422, 'reasoning-effort ultra is supported only by the codex provider.');
  }

  const runId = newGenerationRunId();
  const started = { runId, provider, model };
  running = started;
  const briefs = [await defaultBrief(kit)];
  // The run's own trace records the failure if generation throws, so the browser
  // follows the run rather than this promise. Nothing here is left unhandled.
  void Promise.resolve()
    .then(() =>
      (options.generate ?? runGeneration)({
        runId,
        out: resolve(options.root),
        kit,
        openapi,
        briefs,
        provider,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        timeoutMs: freyaRecipe.limits.generationTimeoutMs,
      }),
    )
    .catch(() => {
      /* Recorded in the run's own trace; see generateFreyaJson's error path. */
    })
    .finally(() => {
      running = null;
    });
  return { ...started, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

/** Test and shutdown helper: forgets the in-flight run. */
export function resetRunningGeneration() {
  running = null;
}
