import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, defaultOptions } from './builder.ts';
import { LocalAdapter } from './adapter.ts';
import { candidateSchema, parseTask } from './validation.ts';
import { createOpenAIGenerator, MockGenerator, parseReasoningEffort } from './providers.ts';
import { hash, saveRun, sourceSnapshot } from './experiments.ts';
import { recipe } from './recipe.ts';
import { freyaRecipe } from './recipe.ts';
import { generateFreyaJson, runFreya } from './event.ts';
import { estimateCost, hasUsage, sumUsage } from './usage.ts';
import { startUi } from './ui/server.ts';
import { prepareSubmission, finalizeSubmission } from './submission.ts';
import { compareRuns } from './comparison.ts';

const help = `Freya builder

pnpm run generate            print Brief A workflow JSON and save a local trace; no Freya calls
pnpm run generate --brief-file FILE   use another brief (repeat for additive briefs)

pnpm run ui                  browse, archive/restore runs, start a generation, or upload

node src/cli.ts build --task fixtures/reschedule.json
node --env-file=.env --env-file=build-the-builder/env.sh src/cli.ts freya \\
  --brief-file build-the-builder/briefs/brief-a.md --practice-brief A --slot brief-a

Freya options (live generation, registration, official practice, export):
  --final                     register and export; no public practice (requires --openapi)
  --repetitions 1|3           practice repetitions; default 1
  --json-only                 print locally compiled workflow JSON and stop
  --quiet                     hide generation progress (JSON-only mode)
  --show-draft                stream unvalidated model JSON to stderr (JSON-only mode)
  --reasoning-summary         request model-provided summaries if supported (JSON-only mode)
  --brief-file FILE           repeat for additive briefs (A + B)
  --openapi FILE              default: build-the-builder/tools/openapi.json
  --kit DIRECTORY             default: build-the-builder
  --slot NAME                 stable slot; later runs update and publish it
  --practice-brief A|B         filter official cases; omitted runs all cases
  --only CASE_ID,...           optional practice subset
  --style STYLE               pieces|corrects|talkative|asks_back|in_words
  --timeout-ms 1800000         total Freya run deadline (30 minutes maximum)

Offline commands:
  submission --run-file FILE --run-file FILE --out submission --team NAME --repo URL --commit SHA
  submission --finalize --out submission --commit SHA
  compare --run-file FILE [--run-file FILE ...]

Options:
  --provider mock|openai or BUILDER_PROVIDER; build only, defaults to mock
  --model MODEL               or BUILDER_MODEL; required for live generation
  --reasoning-effort LEVEL     or BUILDER_REASONING_EFFORT; unset uses the API default
  --timeout-ms ${recipe.limits.timeoutMs}         total build deadline, up to 1800000 ms
  --out experiments           append-only run records with source snapshots

Inspector options (ui command):
  --out experiments           directory of run records to browse
  --port 4317                 HTTP port on the loopback interface
  --host 127.0.0.1            bind address; loopback only by default
  --kit DIRECTORY             event package used by the upload action
  --allow-delete              allow the inspector to permanently delete recorded runs
  --allow-archive             allow the inspector to archive runs; restoring is included

Upload from the inspector (ui command):
  A completed generation's compiled.workflow.json can be registered on Freya
  without another model call: platform dry run, then create-or-update, then
  export. FREYA_API_KEY and the event package are read from this process; the
  browser never receives a credential. Each generation owns one stable slot, so
  a repeated click returns the recorded registration instead of creating a second
  remote agent. Upload only; practice testing remains a separate action.

Load credentials with node --env-file=.env src/cli.ts ...
Mock runs and tests make no API calls.
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean' },
      task: { type: 'string' },
      out: { type: 'string', default: 'experiments' },
      provider: { type: 'string' },
      model: { type: 'string' },
      'reasoning-effort': { type: 'string' },
      'timeout-ms': { type: 'string', default: String(defaultOptions.timeoutMs) },
      'brief-file': { type: 'string', multiple: true },
      openapi: { type: 'string' },
      kit: { type: 'string', default: 'build-the-builder' },
      slot: { type: 'string' },
      'practice-brief': { type: 'string' },
      only: { type: 'string' },
      style: { type: 'string' },
      'json-only': { type: 'boolean' },
      final: { type: 'boolean' },
      finalize: { type: 'boolean' },
      repetitions: { type: 'string' },
      'run-file': { type: 'string', multiple: true },
      team: { type: 'string' },
      repo: { type: 'string' },
      commit: { type: 'string' },
      quiet: { type: 'boolean' },
      'show-draft': { type: 'boolean' },
      'reasoning-summary': { type: 'boolean' },
      'allow-delete': { type: 'boolean' },
      'allow-archive': { type: 'boolean' },
      port: { type: 'string', default: '4317' },
      host: { type: 'string', default: '127.0.0.1' },
    },
  });
  if (values.help || !positionals.length) {
    console.log(help);
    return;
  }
  if (
    positionals.length !== 1 ||
    !['build', 'freya', 'ui', 'submission', 'compare'].includes(positionals[0])
  ) {
    throw new Error('Supply build, freya, ui, submission, or compare. Use --help.');
  }
  if (positionals[0] === 'submission') {
    if (values.finalize) {
      console.log(
        JSON.stringify(
          await finalizeSubmission(
            values.out === 'experiments' ? 'submission' : values.out!,
            values.commit ?? '',
          ),
          null,
          2,
        ),
      );
      return;
    }
    console.log(
      JSON.stringify(
        await prepareSubmission({
          runs: values['run-file'] ?? [],
          out: values.out === 'experiments' ? 'submission' : values.out!,
          team: values.team ?? '',
          repo: values.repo ?? '',
          commit: values.commit ?? '',
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (positionals[0] === 'compare') {
    console.log(JSON.stringify(await compareRuns(values['run-file'] ?? []), null, 2));
    return;
  }
  if (positionals[0] === 'ui') {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('ui port must be an integer from 1 to 65535.');
    }
    // The inspector only reads recorded files, except for the authorized
    // actions. Upload registers an already compiled workflow on Freya and
    // generation starts one new local run; both ask for discovered ids or
    // plain choices, never for a path or a key, and credentials stay here.
    // Deleting a recorded run is granted explicitly because it is
    // irreversible: the flag exists so no accidental click can remove a
    // benchmark artifact.
    startUi({
      root: resolve(values.out!),
      port,
      host: values.host!,
      allowDelete: values['allow-delete'] === true,
      allowArchive: values['allow-archive'] === true,
      upload: { root: resolve(values.out!), kit: resolve(values.kit!) },
      practice: { root: resolve(values.out!), kit: resolve(values.kit!) },
      generation: {
        root: resolve(values.out!),
        kit: resolve(values.kit!),
        openapi: resolve(values.openapi || resolve(values.kit!, 'tools/openapi.json')),
      },
    });
    return;
  }
  const reasoningEffort = parseReasoningEffort(
    values['reasoning-effort'] ?? process.env.BUILDER_REASONING_EFFORT,
  );
  if (positionals[0] === 'freya') {
    if (values.provider && values.provider !== 'openai') {
      throw new Error('The freya command uses the OpenAI Responses API; provider must be openai.');
    }
    if (
      values.final &&
      (!values.openapi ||
        values['json-only'] ||
        values['practice-brief'] ||
        values.only ||
        values.style ||
        values.repetitions)
    ) {
      throw new Error(
        '--final requires --openapi and does not accept JSON-only or practice settings.',
      );
    }
    if (values['json-only']) {
      const workflow = await generateFreyaJson({
        briefs: values['brief-file'] || [resolve(values.kit!, 'briefs/brief-a.md')],
        openapi: values.openapi || resolve(values.kit!, 'tools/openapi.json'),
        kit: values.kit!,
        reasoningEffort,
        model: values.model || process.env.BUILDER_MODEL || '',
        timeoutMs: Number(
          process.argv.includes('--timeout-ms') ||
            process.argv.some((arg) => arg.startsWith('--timeout-ms='))
            ? values['timeout-ms']
            : freyaRecipe.limits.generationTimeoutMs,
        ),
        quiet: values.quiet,
        showDraft: values['show-draft'],
        reasoningSummary: values['reasoning-summary'],
        out: values.out,
      });
      console.log(JSON.stringify(workflow, null, 2));
      return;
    }
    const briefs = values['brief-file'] || [];
    if (!briefs.length || !values.slot) {
      throw new Error('freya requires --brief-file FILE and --slot NAME.');
    }
    const result = await runFreya({
      briefs,
      openapi: values.openapi || resolve(values.kit!, 'tools/openapi.json'),
      kit: values.kit!,
      slot: values.slot,
      out: values.out!,
      brief: values['practice-brief'],
      only: values.only,
      style: values.style,
      final: values.final,
      repetitions: values.repetitions === undefined ? undefined : Number(values.repetitions),
      timeoutMs: Number(
        process.argv.includes('--timeout-ms') ||
          process.argv.some((arg) => arg.startsWith('--timeout-ms='))
          ? values['timeout-ms']
          : freyaRecipe.limits.timeoutMs,
      ),
      reasoningEffort,
      model: values.model || process.env.BUILDER_MODEL || '',
    });
    console.log(JSON.stringify(result));
    if (result.status === 'failed') {
      process.exitCode = 1;
    }
    return;
  }
  if (values['json-only']) {
    throw new Error('--json-only is supported only by the freya command.');
  }
  if (!values.task) {
    throw new Error('build requires --task FILE.');
  }
  const provider = values.provider || process.env.BUILDER_PROVIDER || 'mock';
  const model = values.model || process.env.BUILDER_MODEL || '';
  if (provider !== 'mock' && provider !== 'openai') {
    throw new Error('build provider must be mock or openai.');
  }
  const generator =
    provider === 'mock'
      ? new MockGenerator()
      : createOpenAIGenerator(model, {
          instructions: recipe.instructions,
          schema: candidateSchema,
          ...recipe.limits,
          reasoningEffort,
        });
  const timeoutMs = Number(values['timeout-ms']);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000) {
    throw new Error('timeout-ms must be an integer from 1 to 1800000.');
  }
  const options = { timeoutMs };
  const task = parseTask(JSON.parse(await readFile(resolve(values.task), 'utf8')));
  const source = await sourceSnapshot();
  const started = performance.now();
  const result = await build(task, generator, new LocalAdapter(), options);
  const calls = 'calls' in generator ? generator.calls : [];
  const runModel = 'model' in generator ? generator.model : null;
  const tokens = sumUsage(calls.map((call) => call.usage));
  const usage = hasUsage(tokens) ? { tokens, cost: estimateCost(tokens, runModel) } : null;
  const path = await saveRun(resolve(values.out!), {
    task,
    inputHash: hash(task),
    candidateHash: result.candidate ? hash(result.candidate) : null,
    source,
    nodeVersion: process.version,
    provider,
    model: runModel,
    reasoningEffort: reasoningEffort ?? null,
    maxCalls: recipe.limits.maxCalls,
    options,
    elapsedMs: Math.round(performance.now() - started),
    build: result,
    calls,
    usage,
    evaluation: {
      score: null,
      source: 'not-evaluated',
      details: 'Local structural validation only; no official benchmark has run.',
    },
  });
  console.log(
    JSON.stringify({ taskId: task.id, status: result.status, path, error: result.error, usage }),
  );
  if (result.status === 'failed') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Unknown failure');
  process.exitCode = 1;
});
