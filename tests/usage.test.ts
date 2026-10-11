import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateCost,
  hasUsage,
  LONG_CONTEXT_INPUT_TOKENS,
  normalizeUsage,
  priceFor,
  sumUsage,
} from '../src/usage.ts';

// Prices in USD per 1M tokens, matching the table in src/usage.ts.
const gpt5 = { input: 1.25, cachedInput: 0.125, output: 10 };
const usage = (input: number, output: number, cached = 0, written = 0) => ({
  inputTokens: input,
  cachedInputTokens: cached,
  cacheWriteTokens: written,
  outputTokens: output,
  reasoningTokens: 0,
  totalTokens: input + output,
});

test('normalizes the Responses payload, including nested detail fields', () => {
  assert.deepEqual(
    normalizeUsage({
      input_tokens: 32_423,
      input_tokens_details: { cached_tokens: 30_000, cache_write_tokens: 2000 },
      output_tokens: 12_000,
      output_tokens_details: { reasoning_tokens: 5024 },
      total_tokens: 44_423,
    }),
    {
      inputTokens: 32_423,
      cachedInputTokens: 30_000,
      cacheWriteTokens: 2000,
      outputTokens: 12_000,
      reasoningTokens: 5024,
      totalTokens: 44_423,
    },
  );
});

test('a run whose whole prompt is a cache write is recorded as such', () => {
  // The shape recorded by a first run against gpt-6-luna.
  assert.deepEqual(
    normalizeUsage({
      input_tokens: 32_423,
      input_tokens_details: { cache_write_tokens: 32_420, cached_tokens: 0 },
      output_tokens: 10_533,
      output_tokens_details: { reasoning_tokens: 6178 },
      total_tokens: 42_956,
    }),
    {
      inputTokens: 32_423,
      cachedInputTokens: 0,
      cacheWriteTokens: 32_420,
      outputTokens: 10_533,
      reasoningTokens: 6178,
      totalTokens: 42_956,
    },
  );
  // Writes cannot exceed the tokens that are neither cached nor already standard.
  const over = normalizeUsage({
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 60, cache_write_tokens: 90 },
    output_tokens: 1,
  });
  assert.equal(over?.cacheWriteTokens, 40);
});

test('ignores absent or empty usage payloads', () => {
  for (const empty of [undefined, null, {}, 'usage', { input_tokens: 0, output_tokens: 0 }]) {
    assert.equal(normalizeUsage(empty), null);
  }
});

test('reads back the camelCase shape this module writes into run records', () => {
  const written = usage(100, 20, 30, 40);
  assert.deepEqual(normalizeUsage(written), written);
});

test('cached tokens never exceed the input tokens they are counted within', () => {
  const parsed = normalizeUsage({
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 140 },
  });
  assert.equal(parsed?.cachedInputTokens, 100);
});

test('sumUsage totals calls and treats a missing payload as zero', () => {
  const total = sumUsage([usage(10, 2), null, undefined, usage(5, 1, 3, 4)]);
  assert.deepEqual(total, {
    inputTokens: 15,
    cachedInputTokens: 3,
    cacheWriteTokens: 4,
    outputTokens: 3,
    reasoningTokens: 0,
    totalTokens: 18,
  });
  assert.equal(hasUsage(total), true);
  assert.equal(hasUsage(null), false);
  assert.equal(hasUsage(sumUsage([])), false);
});

test('prices a run and charges cached input at its own lower rate', () => {
  const cost = estimateCost(usage(1_000_000, 1_000_000, 500_000), 'gpt-5', {});
  assert.equal(cost.source, 'table');
  // Half the input is cached: 0.5M standard + 0.5M cached + 1M output.
  assert.equal(cost.usd, 0.5 * gpt5.input + 0.5 * gpt5.cachedInput + gpt5.output);
});

test('uses the long-context rate card above the published threshold', () => {
  const over = usage(LONG_CONTEXT_INPUT_TOKENS + 1, 0);
  const under = usage(LONG_CONTEXT_INPUT_TOKENS, 0);
  const model = 'gpt-6-luna';
  assert.equal(priceFor(model)?.long?.input, 0.2);
  // Exactly at the threshold is still the standard rate; one token past it is not.
  assert.equal(estimateCost(under, model, {}).inputPerMTok, 0.1);
  assert.equal(estimateCost(over, model, {}).inputPerMTok, 0.2);
  assert.ok((estimateCost(over, model, {}).usd ?? 0) > (estimateCost(under, model, {}).usd ?? 0));
});

test('dated snapshots price as their base model and the longest prefix wins', () => {
  assert.equal(priceFor('gpt-6-luna-2026-01-01'), priceFor('gpt-6-luna'));
  // 'gpt-5' is a prefix of 'gpt-5-nano', so the more specific row must win.
  assert.equal(priceFor('gpt-5-nano')?.input, 0.05);
  assert.equal(priceFor('gpt-5')?.input, 1.25);
  assert.equal(priceFor('model-that-does-not-exist'), null);
  assert.equal(priceFor(null), null);
});

test('an unpriced model reports tokens without inventing a cost', () => {
  const cost = estimateCost(usage(1000, 500), 'model-that-does-not-exist', {});
  assert.deepEqual(cost, {
    usd: null,
    source: 'unknown',
    inputPerMTok: null,
    cachedInputPerMTok: null,
    cacheWritePerMTok: null,
    outputPerMTok: null,
  });
  assert.deepEqual(estimateCost(null, 'gpt-5', {}), estimateCost(undefined, 'gpt-5', {}));
});

test('cache writes bill at their own rate and split the input share', () => {
  // gpt-6-luna: $0.10/M input, $0.01/M cached, $0.125/M cache write, $0.50/M output.
  const cost = estimateCost(usage(32_423, 10_533, 0, 32_420), 'gpt-6-luna', {});
  const expected = (3 * 0.1 + 32_420 * 0.125 + 10_533 * 0.5) / 1_000_000;
  assert.ok(Math.abs((cost.usd ?? 0) - expected) < 1e-12);
  assert.equal(cost.cacheWritePerMTok, 0.125);
  // Charging those writes at the plain input rate would understate this run.
  assert.ok((cost.usd ?? 0) > (32_423 * 0.1 + 10_533 * 0.5) / 1_000_000);
  // A model with no published write rate bills them at the input rate.
  assert.equal(estimateCost(usage(1000, 0, 0, 1000), 'gpt-5', {}).cacheWritePerMTok, 1.25);
});

test('env rates override the table, apply to unpriced models, and are labeled env', () => {
  const env = { BUILDER_INPUT_PRICE_PER_MTOK: '1000', BUILDER_OUTPUT_PRICE_PER_MTOK: '2000' };
  const cost = estimateCost(usage(1_000_000, 1_000_000), 'model-that-does-not-exist', env);
  assert.equal(cost.usd, 3000);
  assert.equal(cost.source, 'env');
  // No cached or write rate is published or set, so both bill at the input rate.
  assert.equal(cost.cachedInputPerMTok, 1000);
  assert.equal(cost.cacheWritePerMTok, 1000);
  // A partial override still labels the whole estimate env-sourced.
  assert.equal(estimateCost(usage(1_000_000, 0), 'gpt-5', env).source, 'env');
  // A blank or non-numeric rate is ignored rather than becoming zero.
  assert.equal(
    estimateCost(usage(1_000_000, 0), 'gpt-5', { BUILDER_INPUT_PRICE_PER_MTOK: '' }).usd,
    gpt5.input,
  );
  assert.equal(
    estimateCost(usage(1_000_000, 0), 'gpt-5', { BUILDER_INPUT_PRICE_PER_MTOK: 'free' }).source,
    'table',
  );
});

test('a run with no reported tokens never costs anything', () => {
  assert.equal(estimateCost(sumUsage([]), 'gpt-5', {}).usd, null);
});
