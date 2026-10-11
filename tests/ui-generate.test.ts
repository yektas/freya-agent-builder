// Offline tests for the New run action. The generation is injected, so no model,
// platform, or network call is made; the fixtures are synthetic and none of them
// is a benchmark result.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { listRuns } from '../src/ui/records.ts';
import { createUiServer } from '../src/ui/server.ts';
import { generationAvailability, startGeneration } from '../src/ui/generate.ts';
import type { GenerateRunner, GenerationOptions } from '../src/ui/generate.ts';

const kit = resolve('build-the-builder');
const SECRET = 'synthetic-openai-key';

const roots: string[] = [];
const servers: Server[] = [];
after(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true });
  }
  for (const server of servers) {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

type Started = {
  runId: string;
  out: string;
  kit: string;
  openapi: string;
  briefs: string[];
  model: string;
  reasoningEffort?: string;
  timeoutMs: number;
};

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'freya-generate-'));
  roots.push(root);
  return root;
}

/**
 * A stand-in for the real generation. It records the choices it was given and,
 * unless told otherwise, leaves a run behind shaped like a real one: a `run.json`
 * the inspector discovers and a compiled workflow it can show and upload.
 */
function fakeGenerate(
  calls: Started[],
  options: { fail?: boolean; delay?: Promise<void> } = {},
): GenerateRunner {
  return async (input) => {
    calls.push(input as unknown as Started);
    await options.delay;
    const directory = join(input.out, 'generation', input.runId);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'run.json'),
      JSON.stringify({
        kind: 'generation-only',
        runId: input.runId,
        status: options.fail ? 'failed' : 'completed',
        startedAt: new Date().toISOString(),
        config: { model: input.model, provider: 'openai', briefs: input.briefs },
        task: { id: 'brief-a', tools: [] },
        calls: [],
        evaluation: { score: null, source: 'not-evaluated' },
      }),
    );
    await writeFile(
      join(directory, 'compiled.workflow.json'),
      JSON.stringify({
        initial_node: 'only',
        nodes: { only: { node_type: 'end_call', transitions: [] } },
      }),
    );
    if (options.fail) {
      throw new Error('synthetic generation failure');
    }
    return {};
  };
}

type Harness = { root: string; base: string; calls: Started[]; options: GenerationOptions };

async function harness(
  overrides: {
    env?: NodeJS.ProcessEnv;
    kit?: string;
    generate?: GenerateRunner;
    delay?: Promise<void>;
  } = {},
): Promise<Harness> {
  const root = await fixture();
  const calls: Started[] = [];
  const options: GenerationOptions = {
    root,
    kit: overrides.kit ?? kit,
    openapi: join(overrides.kit ?? kit, 'tools', 'openapi.json'),
    env: overrides.env ?? ({ ...process.env, OPENAI_API_KEY: SECRET } as NodeJS.ProcessEnv),
    generate: overrides.generate ?? fakeGenerate(calls, { delay: overrides.delay }),
  };
  const server = createUiServer({
    root,
    port: 0,
    host: '127.0.0.1',
    generation: options,
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { root, base: `http://127.0.0.1:${address.port}`, calls, options };
}

type Body = { error?: string; run?: { runId: string; model: string } };

/** Mirrors the shape `GET /api/generate` answers with. */
type Availability = {
  available: boolean;
  problem: string | null;
  models: string[];
  reasoningEfforts: string[];
  timeoutMs: number;
  running: { runId: string; model: string } | null;
};

async function availability(base: string): Promise<Availability> {
  const response = await fetch(`${base}/api/generate`);
  assert.equal(response.status, 200);
  return (await response.json()) as Availability;
}

// `headers` are extra request headers, as the browser would send them; `raw`
// replaces the JSON body entirely, for the oversized and malformed cases.
async function start(
  base: string,
  body: unknown,
  init: { method?: string; headers?: Record<string, string>; raw?: string } = {},
) {
  const response = await fetch(`${base}/api/generate`, {
    method: init.method ?? 'POST',
    headers: {
      ...(init.raw ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
    ...(init.raw === undefined ? { body: JSON.stringify(body) } : { body: init.raw }),
  });
  return { status: response.status, body: (await response.json()) as Body };
}

test('offers model and reasoning choices and reports API readiness', async () => {
  const h = await harness();
  const offered = await availability(h.base);
  assert.equal(offered.available, true);
  assert.equal(offered.problem, null);
  assert.deepEqual(offered.models, ['gpt-6.1-sol', 'gpt-6-luna']);
  // The deadline comes from the recipe and cannot be raised from the browser.
  assert.equal(offered.timeoutMs, 300000);
  assert.equal(offered.running, null);
  // No credential reaches the browser.
  assert.equal(JSON.stringify(offered).includes(SECRET), false);
});

test('an unconfigured API key disables generation with a clear reason', async () => {
  const h = await harness({ env: { ...process.env, OPENAI_API_KEY: '' } });
  const offered = await generationAvailability(h.options);
  assert.equal(offered.available, false);
  assert.match(offered.problem ?? '', /OPENAI_API_KEY/);

  const refused = await start(h.base, { model: 'gpt-6-luna' });
  assert.equal(refused.status, 503);
  assert.match(refused.body.error ?? '', /OPENAI_API_KEY/);
  assert.deepEqual(h.calls, []);
});

test('normal inspector configuration reads API readiness from the server environment', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = SECRET;
  try {
    const offered = await generationAvailability({ root: await fixture(), kit });
    assert.equal(offered.available, true);
    assert.equal(JSON.stringify(offered).includes(SECRET), false);
    const explicit = await generationAvailability({ root: await fixture(), kit, env: {} });
    assert.equal(explicit.available, false);
  } finally {
    if (previous === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previous;
    }
  }
});

test('a missing event package stops the action before any model call', async () => {
  const missing = join(await fixture(), 'not-a-kit');
  const offered = await generationAvailability({
    root: await fixture(),
    kit: missing,
    env: { ...process.env, OPENAI_API_KEY: SECRET },
  });
  assert.equal(offered.available, false);
  assert.match(offered.problem ?? '', /event package/);
});

test('starts a generation with the chosen model and effort', async () => {
  const h = await harness();
  const response = await start(h.base, {
    model: 'gpt-6.1-sol',
    reasoningEffort: 'high',
  });
  assert.equal(response.status, 202);
  assert.equal(response.body.run?.model, 'gpt-6.1-sol');
  // The run id is addressable before the model call returns.
  assert.ok(response.body.run?.runId);

  // The generation runs in this process under the recipe deadline.
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].model, 'gpt-6.1-sol');
  assert.equal(h.calls[0].reasoningEffort, 'high');
  assert.equal(h.calls[0].timeoutMs, 300000);
  // Briefs come from the kit, never from the browser.
  assert.deepEqual(h.calls[0].briefs, [join(kit, 'briefs', 'brief-a.md')]);
  assert.equal(h.calls[0].out, resolve(h.root));

  // The run lands where the inspector scans, as a generation-only run.
  const runs = await listRuns(h.root);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].kind, 'generation-only');
  assert.equal(runs[0].id, `generation~${response.body.run!.runId}`);
  assert.equal(runs[0].model, 'gpt-6.1-sol');
});

test('omitting the effort uses the API default', async () => {
  const h = await harness();
  const response = await start(h.base, { model: 'gpt-6-luna' });
  assert.equal(response.status, 202);
  await new Promise((done) => setTimeout(done, 50));
  // No effort is sent at all, exactly as the CLI does when none is given.
  assert.equal(h.calls[0].reasoningEffort, undefined);
});

test('refuses invalid models and efforts without calling a model', async () => {
  const h = await harness();
  const model = await start(h.base, { model: '   ' });
  assert.equal(model.status, 422);
  assert.match(model.body.error ?? '', /Choose a model/);

  const long = await start(h.base, { model: 'x'.repeat(200) });
  assert.equal(long.status, 422);

  const effort = await start(h.base, {
    model: 'gpt-6-luna',
    reasoningEffort: 'extreme',
  });
  assert.equal(effort.status, 422);
  assert.match(effort.body.error ?? '', /reasoning-effort must be one of/);

  // A custom model outside the offered list is still accepted; the API decides
  // which models are available.
  const custom = await start(h.base, { model: 'gpt-6-luna-2026-01-01' });
  assert.equal(custom.status, 202);
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].model, 'gpt-6-luna-2026-01-01');
});

test('one generation at a time: a second request names the run already running', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const h = await harness({ delay: gate });
  const first = await start(h.base, { model: 'gpt-6-luna' });
  assert.equal(first.status, 202);

  const second = await start(h.base, { model: 'gpt-6.1-sol' });
  assert.equal(second.status, 409);
  assert.match(second.body.error ?? '', /still running/);
  assert.match(second.body.error ?? '', /gpt-6-luna/);

  release();
  await new Promise((done) => setTimeout(done, 50));
  // Only the first request reached the generator.
  assert.equal(h.calls.length, 1);

  // Once it finishes, the next one is accepted.
  const third = await start(h.base, { model: 'gpt-6-luna' });
  assert.equal(third.status, 202);
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(h.calls.length, 2);
});

test('a failed generation is recorded on its own run, not as a route error', async () => {
  const h = await harness({ generate: fakeGenerate([], { fail: true }) });
  const response = await start(h.base, { model: 'gpt-6-luna' });
  // The run started, so the browser navigates to it and reads the failure there.
  assert.equal(response.status, 202);
  await new Promise((done) => setTimeout(done, 50));

  const runs = await listRuns(h.root);
  assert.equal(runs[0].status, 'failed');
});

test('an oversized or malformed body is refused before any model call', async () => {
  const h = await harness();
  const huge = await start(h.base, null, { raw: JSON.stringify({ model: 'x'.repeat(20000) }) });
  assert.equal(huge.status, 413);
  const malformed = await start(h.base, null, { raw: '{not json' });
  assert.equal(malformed.status, 413);
  // An array is not an object of choices.
  const array = await start(h.base, null, { raw: '["openai"]' });
  assert.equal(array.status, 413);
  assert.deepEqual(h.calls, []);
});

test('a cross-origin or cross-site request is refused before any model call', async () => {
  const h = await harness();
  const cross = await start(
    h.base,
    { model: 'gpt-6-luna' },
    { headers: { origin: 'https://attacker.example' } },
  );
  assert.equal(cross.status, 403);
  const fetched = await start(
    h.base,
    { model: 'gpt-6-luna' },
    { headers: { 'sec-fetch-site': 'cross-site' } },
  );
  assert.equal(fetched.status, 403);
  assert.deepEqual(h.calls, []);

  // The same-origin click that follows still works.
  const accepted = await start(h.base, { model: 'gpt-6-luna' }, { headers: { origin: h.base } });
  assert.equal(accepted.status, 202);
});

test('an inspector started without generation configuration refuses to start a run', async () => {
  const root = await fixture();
  const server = createUiServer({ root, port: 0, host: '127.0.0.1' });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  const offered = await availability(base);
  assert.equal(offered.available, false);
  assert.match(offered.problem ?? '', /without generation configuration/);

  const response = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-6-luna' }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await listRuns(root), []);
});

test('recorded runs stay read-only: generation is the only new write', async () => {
  const h = await harness();
  const deleted = await fetch(`${h.base}/api/runs`, { method: 'DELETE' });
  assert.equal(deleted.status, 405);
  const run = await fetch(`${h.base}/api/runs/generation~whatever`, { method: 'POST' });
  assert.equal(run.status, 405);
  // The route accepts only POST; a GET is the availability answer.
  assert.equal((await fetch(`${h.base}/api/generate`)).status, 200);
});

test('the started run carries no credential in its record', async () => {
  const h = await harness();
  const response = await start(h.base, { model: 'gpt-6-luna' });
  assert.equal(response.status, 202);
  await new Promise((done) => setTimeout(done, 50));
  const record = await readFile(
    join(h.root, 'generation', response.body.run!.runId, 'run.json'),
    'utf8',
  );
  assert.equal(record.includes(SECRET), false);
});

// startGeneration is the service behind the route; these cases pin its contract
// directly so a future caller cannot bypass the route's checks.
test('startGeneration validates before reserving the single run slot', async () => {
  const root = await fixture();
  const calls: Started[] = [];
  const options: GenerationOptions = {
    root,
    kit,
    openapi: join(kit, 'tools', 'openapi.json'),
    env: { ...process.env, OPENAI_API_KEY: SECRET },
    generate: fakeGenerate(calls),
  };
  await assert.rejects(() => startGeneration(options, { model: '   ' }), /Choose a model/);
  // A refused request leaves no run and no trace behind.
  assert.deepEqual(await listRuns(root), []);
  const started = await startGeneration(options, { model: 'gpt-6-luna' });
  assert.ok(started.runId);
});
