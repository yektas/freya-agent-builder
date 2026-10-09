import { parseArgs } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build, defaultOptions } from './builder.ts';
import { LocalAdapter } from './adapter.ts';
import { parseTask } from './validation.ts';
import { DecisionsAuditor, MockGenerator, OpenAIClient, OpenAIGenerator } from './providers.ts';
import { evaluate, hash, report, saveRun, sourceSnapshot } from './experiments.ts';
import type { BuildOptions } from './contracts.ts';

const help = `Freya builder preparation kit (internal contracts; local artifact only)

node src/cli.ts doctor
node src/cli.ts build --task fixtures/reschedule.json
node src/cli.ts suite --tasks fixtures --repeat 2
node src/cli.ts report --out experiments

Options:
  --provider mock|openai       mock by default; openai makes billable requests
  --model MODEL               or BUILDER_MODEL; required for openai
  --strategy direct|planned   direct by default
  --audit off|report|repair    off by default; Decisions requires openai
  --decisions-model MODEL     or DECISIONS_MODEL (default gpt-6-luna)
  --threshold 0.8             experimental, uncalibrated audit threshold
  --repairs 1                 maximum repair calls, 0–3
  --max-calls 6               total model requests per task, including audits
  --timeout-ms 120000         total build deadline per task
  --repeat 1                  repetitions per fixture, 1–100
  --out experiments           append-only run records with source snapshots

Load credentials with node --env-file=.env src/cli.ts ...
No API calls are made by doctor, mock runs, tests, or report.
`;

function integer(value: string, name: string, min: number, max: number) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean' },
      task: { type: 'string' },
      tasks: { type: 'string' },
      out: { type: 'string', default: 'experiments' },
      provider: { type: 'string', default: 'mock' },
      model: { type: 'string' },
      strategy: { type: 'string', default: 'direct' },
      audit: { type: 'string', default: 'off' },
      'decisions-model': { type: 'string' },
      threshold: { type: 'string', default: '0.8' },
      repairs: { type: 'string', default: '1' },
      'max-calls': { type: 'string', default: '6' },
      'timeout-ms': { type: 'string', default: '120000' },
      repeat: { type: 'string', default: '1' },
    },
  });
  if (values.help || !positionals.length) {
    console.log(help);
    return;
  }
  if (positionals.length !== 1) {
    throw new Error('Supply exactly one command.');
  }
  const command = positionals[0];
  if (command === 'doctor') {
    console.log(
      JSON.stringify(
        {
          node: process.version,
          requiredNode: '>=22.18.0',
          openaiKeyPresent: !!process.env.OPENAI_API_KEY?.trim(),
          builderModel: process.env.BUILDER_MODEL || null,
          freyaAdapter: 'not configured',
          officialBenchmark: 'not connected',
          networkChecked: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'report') {
    console.log(JSON.stringify(await report(resolve(values.out!)), null, 2));
    return;
  }
  if (command !== 'build' && command !== 'suite') {
    throw new Error('Unknown command. Use --help.');
  }
  if (!['mock', 'openai'].includes(values.provider!)) {
    throw new Error('provider must be mock or openai.');
  }
  if (!['direct', 'planned'].includes(values.strategy!)) {
    throw new Error('strategy must be direct or planned.');
  }
  if (!['off', 'report', 'repair'].includes(values.audit!)) {
    throw new Error('audit must be off, report, or repair.');
  }
  if (values.provider === 'mock' && values.audit !== 'off') {
    throw new Error('Decisions audit requires --provider openai.');
  }
  const model = values.model || process.env.BUILDER_MODEL;
  if (values.provider === 'openai' && (!model?.trim() || !process.env.OPENAI_API_KEY?.trim())) {
    throw new Error('Live runs require OPENAI_API_KEY and --model or BUILDER_MODEL.');
  }
  const maxCalls = integer(values['max-calls']!, 'max-calls', 1, 100);
  const repeat = integer(values.repeat!, 'repeat', 1, 100);
  const threshold = Number(values.threshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('threshold must be from 0 to 1.');
  }
  const options: BuildOptions = {
    ...defaultOptions,
    strategy: values.strategy as BuildOptions['strategy'],
    auditMode: values.audit as BuildOptions['auditMode'],
    maxRepairs: integer(values.repairs!, 'repairs', 0, 3),
    timeoutMs: integer(values['timeout-ms']!, 'timeout-ms', 1, 3600000),
    auditThreshold: threshold,
  };
  if (command === 'build' && !values.task) {
    throw new Error('build requires --task FILE.');
  }
  if (command === 'suite' && !values.tasks) {
    throw new Error('suite requires --tasks DIRECTORY.');
  }
  const files =
    command === 'build'
      ? [resolve(values.task!)]
      : (await readdir(values.tasks!))
          .filter((name) => name.endsWith('.json'))
          .sort()
          .map((name) => resolve(join(values.tasks!, name)));
  if (!files.length) {
    throw new Error('No task JSON files found.');
  }
  // Parse the complete suite before making any model calls.
  const tasks = await Promise.all(
    files.map(async (file) => parseTask(JSON.parse(await readFile(file, 'utf8')))),
  );
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
    throw new Error('Suite contains duplicate task IDs.');
  }
  const source = await sourceSnapshot();
  const decisionsModel = values['decisions-model'] || process.env.DECISIONS_MODEL || 'gpt-6-luna';
  for (let repetition = 0; repetition < repeat; repetition++) {
    for (const task of tasks) {
      const client =
        values.provider === 'openai'
          ? new OpenAIClient(process.env.OPENAI_API_KEY!, maxCalls)
          : undefined;
      const generator = client ? new OpenAIGenerator(client, model!) : new MockGenerator();
      const auditor =
        client && options.auditMode !== 'off'
          ? new DecisionsAuditor(client, decisionsModel)
          : undefined;
      const started = performance.now();
      const result = await build(task, generator, new LocalAdapter(), options, auditor);
      const evaluation = await evaluate(undefined, task, result.artifact, options.timeoutMs);
      const path = await saveRun(resolve(values.out!), {
        task,
        inputHash: hash(task),
        candidateHash: result.candidate ? hash(result.candidate) : null,
        source,
        nodeVersion: process.version,
        provider: values.provider!,
        model: client ? model! : null,
        decisionsModel: auditor ? decisionsModel : null,
        maxCalls,
        options,
        elapsedMs: Math.round(performance.now() - started),
        build: result,
        calls: client?.calls ?? [],
        evaluation,
      });
      console.log(
        JSON.stringify({
          taskId: task.id,
          repetition: repetition + 1,
          status: result.status,
          score: evaluation.score,
          path,
          error: result.error,
        }),
      );
      if (result.status === 'failed') {
        process.exitCode = 1;
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Unknown failure');
  process.exitCode = 1;
});
