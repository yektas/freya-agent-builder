// Token accounting and cost estimation. Normalize the API usage shape here and
// keep the pricing table in one place.
import { object } from './validation.ts';

export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  // Reported separately from input_tokens by the newest models. A write is
  // billed at its own rate, usually above the standard input rate.
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
});

export type CostEstimate = {
  usd: number | null;
  source: 'env' | 'table' | 'unknown';
  inputPerMTok: number | null;
  cachedInputPerMTok: number | null;
  cacheWritePerMTok: number | null;
  outputPerMTok: number | null;
};

type Rate = { input: number; cachedInput: number; output: number; cacheWrite?: number };
type ModelPrice = Rate & { long?: Rate };

// USD per 1M tokens, transcribed from the OpenAI API pricing page on 2026-10-10.
// This is a snapshot for estimating spend, not a live source of truth. Rows
// whose published cached-input rate was not listed bill cached tokens at the
// standard input rate, which over-estimates rather than under-estimates.
// `long` applies above LONG_CONTEXT_INPUT_TOKENS. `cacheWrite` is published only
// for the newest models; where it is absent, cache writes bill at the standard
// input rate, which also over-estimates.
const PRICES: Record<string, ModelPrice> = {
  'gpt-6-astra': {
    input: 10,
    cachedInput: 1,
    cacheWrite: 12.5,
    output: 50,
    long: { input: 20, cachedInput: 2, cacheWrite: 25, output: 75 },
  },
  'gpt-6.1-sol': {
    input: 2,
    cachedInput: 0.1,
    cacheWrite: 2.5,
    output: 10,
    long: { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 15 },
  },
  'gpt-6-sol': {
    input: 2,
    cachedInput: 0.2,
    cacheWrite: 2.5,
    output: 10,
    long: { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 15 },
  },
  'gpt-6-luna': {
    input: 0.1,
    cachedInput: 0.01,
    cacheWrite: 0.125,
    output: 0.5,
    long: { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 0.75 },
  },
  'gpt-5.6-sol': {
    input: 4,
    cachedInput: 0.4,
    cacheWrite: 5,
    output: 20,
    long: { input: 8, cachedInput: 0.8, cacheWrite: 10, output: 30 },
  },
  'gpt-5.6-terra': {
    input: 2,
    cachedInput: 0.2,
    cacheWrite: 2.5,
    output: 12,
    long: { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 18 },
  },
  'gpt-5.6-luna': {
    input: 0.2,
    cachedInput: 0.02,
    cacheWrite: 0.25,
    output: 1.2,
    long: { input: 0.4, cachedInput: 0.04, cacheWrite: 0.5, output: 1.8 },
  },
  'gpt-5.5': {
    input: 5,
    cachedInput: 0.5,
    output: 30,
    long: { input: 10, cachedInput: 1, output: 45 },
  },
  'gpt-5.5-pro': {
    input: 30,
    cachedInput: 30,
    output: 180,
    long: { input: 60, cachedInput: 60, output: 270 },
  },
  'gpt-5.4': {
    input: 2.5,
    cachedInput: 0.25,
    output: 15,
    long: { input: 5, cachedInput: 0.5, output: 22.5 },
  },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cachedInput: 0.02, output: 1.25 },
  'gpt-5.4-pro': {
    input: 30,
    cachedInput: 30,
    output: 180,
    long: { input: 60, cachedInput: 60, output: 270 },
  },
  'gpt-5.3-codex': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.2-pro': { input: 21, cachedInput: 21, output: 168 },
  'gpt-5.1': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-pro': { input: 15, cachedInput: 15, output: 120 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'gpt-4.1': { input: 2, cachedInput: 0.5, output: 8 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, cachedInput: 0.025, output: 0.4 },
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  o1: { input: 15, cachedInput: 7.5, output: 60 },
  'o1-pro': { input: 150, cachedInput: 150, output: 600 },
  o3: { input: 2, cachedInput: 0.5, output: 8 },
  'o3-pro': { input: 20, cachedInput: 20, output: 80 },
  'o3-mini': { input: 1.1, cachedInput: 0.55, output: 4.4 },
  'o4-mini': { input: 1.1, cachedInput: 0.275, output: 4.4 },
};

// Published boundary between the standard and long context rate cards.
export const LONG_CONTEXT_INPUT_TOKENS = 272_000;

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

// The first value present, so API payloads and the camelCase shape this module
// writes into run records both read back unchanged.
function pick(raw: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = count(raw[key]);
    if (value) {
      return value;
    }
  }
  return 0;
}

// OpenAI Responses reports input_tokens inclusive of cached tokens and nests the
// breakdown under *_tokens_details. Never invent a count when usage is absent.
export function normalizeUsage(raw: unknown): TokenUsage | null {
  if (!object(raw)) {
    return null;
  }
  const input = pick(raw, 'input_tokens', 'inputTokens');
  const output = pick(raw, 'output_tokens', 'outputTokens');
  const inputDetails = object(raw.input_tokens_details) ? raw.input_tokens_details : {};
  const outputDetails = object(raw.output_tokens_details) ? raw.output_tokens_details : {};
  const cached = Math.min(
    input,
    Math.max(pick(inputDetails, 'cached_tokens'), pick(raw, 'cachedInputTokens')),
  );
  const written = Math.min(
    Math.max(input - cached, 0),
    Math.max(
      pick(inputDetails, 'cache_write_tokens'),
      pick(raw, 'cache_write_tokens', 'cacheWriteTokens'),
    ),
  );
  if (!input && !output) {
    return null;
  }
  return {
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteTokens: written,
    outputTokens: output,
    reasoningTokens: pick(outputDetails, 'reasoning_tokens', 'reasoningTokens'),
    totalTokens: Math.max(pick(raw, 'total_tokens', 'totalTokens'), input + output),
  };
}

export function sumUsage(values: (TokenUsage | null | undefined)[]): TokenUsage {
  return values.reduce<TokenUsage>((total, value) => {
    if (!value) {
      return total;
    }
    total.inputTokens += value.inputTokens;
    total.cachedInputTokens += value.cachedInputTokens;
    total.cacheWriteTokens += value.cacheWriteTokens;
    total.outputTokens += value.outputTokens;
    total.reasoningTokens += value.reasoningTokens;
    total.totalTokens += value.totalTokens;
    return total;
  }, emptyUsage());
}

export const hasUsage = (usage: TokenUsage | null | undefined): usage is TokenUsage =>
  !!usage && usage.totalTokens > 0;

// Longest published prefix wins, so dated snapshots such as gpt-6-luna-2026-01-01
// price as their base model.
export function priceFor(model: string | null | undefined): ModelPrice | null {
  const name = model?.trim().toLowerCase();
  if (!name) {
    return null;
  }
  if (PRICES[name]) {
    return PRICES[name];
  }
  let best: ModelPrice | null = null;
  let bestLength = 0;
  for (const [key, price] of Object.entries(PRICES)) {
    if (name.startsWith(key) && key.length > bestLength) {
      best = price;
      bestLength = key.length;
    }
  }
  return best;
}

function envRate(value: string | undefined): number | null {
  if (value === undefined || !value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const PRICE_VARS = {
  input: 'BUILDER_INPUT_PRICE_PER_MTOK',
  cachedInput: 'BUILDER_CACHED_INPUT_PRICE_PER_MTOK',
  cacheWrite: 'BUILDER_CACHE_WRITE_PRICE_PER_MTOK',
  output: 'BUILDER_OUTPUT_PRICE_PER_MTOK',
} as const;

// An env rate wins over the table so a model this snapshot has never heard of
// can still be costed. Any override marks the estimate as env-sourced, since a
// reviewer must be able to tell a hand-set rate from a published one.
export function estimateCost(
  usage: TokenUsage | null | undefined,
  model: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): CostEstimate {
  const unknown: CostEstimate = {
    usd: null,
    source: 'unknown',
    inputPerMTok: null,
    cachedInputPerMTok: null,
    cacheWritePerMTok: null,
    outputPerMTok: null,
  };
  if (!hasUsage(usage)) {
    return unknown;
  }
  const price = priceFor(model);
  const tier =
    price?.long && usage.inputTokens > LONG_CONTEXT_INPUT_TOKENS ? price.long : (price ?? null);
  const overrides = Object.values(PRICE_VARS).some((name) => envRate(env[name]) !== null);
  const rate = (key: keyof typeof PRICE_VARS): number | null =>
    envRate(env[PRICE_VARS[key]]) ?? tier?.[key] ?? null;
  const input = rate('input');
  const output = rate('output');
  // An unpublished cached or cache-write rate bills those tokens at the full
  // input rate, which over-estimates. This also keeps a partial env override
  // usable on a model the table has never heard of, rather than refusing to
  // price it at all.
  const cachedInput = rate('cachedInput') ?? input;
  const cacheWrite = rate('cacheWrite') ?? input;
  if (input === null || cachedInput === null || cacheWrite === null || output === null) {
    return unknown;
  }
  // input_tokens already includes cached tokens; charge each share at its own rate.
  const written = Math.min(
    usage.cacheWriteTokens,
    Math.max(usage.inputTokens - cachedCount(usage), 0),
  );
  const standard = Math.max(usage.inputTokens - cachedCount(usage) - written, 0);
  return {
    usd:
      (standard * input +
        cachedCount(usage) * cachedInput +
        written * cacheWrite +
        usage.outputTokens * output) /
      1_000_000,
    source: overrides ? 'env' : 'table',
    inputPerMTok: input,
    cachedInputPerMTok: cachedInput,
    cacheWritePerMTok: cacheWrite,
    outputPerMTok: output,
  };
}

const cachedCount = (usage: TokenUsage) => Math.min(usage.cachedInputTokens, usage.inputTokens);
