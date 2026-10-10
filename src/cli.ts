import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, defaultOptions } from './builder.ts';
import { LocalAdapter } from './adapter.ts';
import { parseTask } from './validation.ts';
import { MockGenerator, OpenAIGenerator } from './providers.ts';
import { hash, saveRun, sourceSnapshot } from './experiments.ts';
import { recipe } from './recipe.ts';
import { freyaRecipe } from './recipe.ts';
import { generateFreyaJson, runFreya } from './event.ts';
import { startUi } from './ui/server.ts';

const help = `Freya builder

pnpm run generate            print Brief A workflow JSON and save a local trace; no Freya calls
pnpm run generate --brief-file FILE   use another brief (repeat for additive briefs)

pnpm run ui                  browse recorded runs; read-only, plus the upload action below

node src/cli.ts build --task fixtures/reschedule.json
node --env-file=.env --env-file=build-the-builder/env.sh src/cli.ts freya \\
  --brief-file build-the-builder/briefs/brief-a.md --practice-brief A --slot brief-a

Freya options (live generation, registration, official practice, export):
  --json-only                 print locally compiled workflow JSON and stop; OpenAI only
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

Options:
  --provider mock|openai       mock by default; openai makes billable requests
  --model MODEL               or BUILDER_MODEL; required for openai
  --timeout-ms ${recipe.limits.timeoutMs}         total build deadline, up to 1800000 ms
  --out experiments           append-only run records with source snapshots

Inspector options (ui command):
  --out experiments           directory of run records to browse
  --port 4317                 HTTP port on the loopback interface
  --host 127.0.0.1            bind address; loopback only by default
  --kit DIRECTORY             event package used by the upload action

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
      provider: { type: 'string', default: 'mock' },
      model: { type: 'string' },
      'timeout-ms': { type: 'string', default: String(defaultOptions.timeoutMs) },
      'brief-file': { type: 'string', multiple: true },
      openapi: { type: 'string' },
      kit: { type: 'string', default: 'build-the-builder' },
      slot: { type: 'string' },
      'practice-brief': { type: 'string' },
      only: { type: 'string' },
      style: { type: 'string' },
      'json-only': { type: 'boolean' },
      quiet: { type: 'boolean' },
      'show-draft': { type: 'boolean' },
      'reasoning-summary': { type: 'boolean' },
      port: { type: 'string', default: '4317' },
      host: { type: 'string', default: '127.0.0.1' },
    },
  });
  if (values.help || !positionals.length) {
    console.log(help);
    return;
  }
  if (positionals.length !== 1 || !['build', 'freya', 'ui'].includes(positionals[0])) {
    throw new Error('Supply the build, freya, or ui command. Use --help.');
  }
  if (positionals[0] === 'ui') {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('ui port must be an integer from 1 to 65535.');
    }
    // The inspector only reads recorded files. Upload is the one authorized
    // write, so the credentials stay in this process and the action asks for a
    // discovered run id, never for a path or a key.
    startUi({
      root: resolve(values.out!),
      port,
      host: values.host!,
      upload: { root: resolve(values.out!), kit: resolve(values.kit!) },
    });
    return;
  }
  if (positionals[0] === 'freya') {
    if (values['json-only']) {
      const workflow = await generateFreyaJson({
        briefs: values['brief-file'] || [resolve(values.kit!, 'briefs/brief-a.md')],
        openapi: values.openapi || resolve(values.kit!, 'tools/openapi.json'),
        kit: values.kit!,
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
      timeoutMs: Number(
        process.argv.includes('--timeout-ms') ||
          process.argv.some((arg) => arg.startsWith('--timeout-ms='))
          ? values['timeout-ms']
          : freyaRecipe.limits.timeoutMs,
      ),
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
  if (!['mock', 'openai'].includes(values.provider!)) {
    throw new Error('provider must be mock or openai.');
  }
  const model = values.model || process.env.BUILDER_MODEL;
  if (values.provider === 'openai' && (!model?.trim() || !process.env.OPENAI_API_KEY?.trim())) {
    throw new Error('Live runs require OPENAI_API_KEY and --model or BUILDER_MODEL.');
  }
  const timeoutMs = Number(values['timeout-ms']);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000) {
    throw new Error('timeout-ms must be an integer from 1 to 1800000.');
  }
  const options = { timeoutMs };
  const task = parseTask(JSON.parse(await readFile(resolve(values.task), 'utf8')));
  const source = await sourceSnapshot();
  const generator =
    values.provider === 'openai'
      ? new OpenAIGenerator(process.env.OPENAI_API_KEY!, model!)
      : new MockGenerator();
  const started = performance.now();
  const result = await build(task, generator, new LocalAdapter(), options);
  const path = await saveRun(resolve(values.out!), {
    task,
    inputHash: hash(task),
    candidateHash: result.candidate ? hash(result.candidate) : null,
    source,
    nodeVersion: process.version,
    provider: values.provider!,
    model: generator instanceof OpenAIGenerator ? generator.model : null,
    maxCalls: recipe.limits.maxCalls,
    options,
    elapsedMs: Math.round(performance.now() - started),
    build: result,
    calls: generator instanceof OpenAIGenerator ? generator.calls : [],
    evaluation: {
      score: null,
      source: 'not-evaluated',
      details: 'Local structural validation only; no official benchmark has run.',
    },
  });
  console.log(
    JSON.stringify({ taskId: task.id, status: result.status, path, error: result.error }),
  );
  if (result.status === 'failed') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Unknown failure');
  process.exitCode = 1;
});
