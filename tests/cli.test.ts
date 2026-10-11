import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectRoot } from '../src/experiments.ts';
import { recipe } from '../src/recipe.ts';

test('CLI build creates reproducible records with null benchmark scores', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'freya-test-'));
  try {
    const output = execFileSync(
      process.execPath,
      ['src/cli.ts', 'build', '--task', 'fixtures/reschedule.json', '--out', directory],
      { cwd: projectRoot, encoding: 'utf8' },
    );
    assert.equal(JSON.parse(output).status, 'built');
    const record = JSON.parse(
      await readFile(join(directory, (await readdir(directory))[0]), 'utf8'),
    );
    assert.ok(record.source.files['src/builder.ts']);
    assert.ok(record.source.files['src/recipe.ts']);
    assert.equal(record.maxCalls, recipe.limits.maxCalls);
    assert.equal(record.calls.length, 0);
    assert.equal(record.evaluation.source, 'not-evaluated');
    assert.equal(record.evaluation.score, null);
    assert.equal(record.task.synthetic, true);
    // A mock run makes no model call, so it has no usage and no cost to report.
    assert.equal(record.usage, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI rejects live configuration before any requests or output records', () => {
  const run = spawnSync(
    process.execPath,
    ['src/cli.ts', 'build', '--task', 'fixtures/reschedule.json', '--provider', 'openai'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, OPENAI_API_KEY: '', BUILDER_MODEL: '' },
    },
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Live runs require/);
});

test('JSON-only command prints a compiled workflow and saves a redacted trace without Freya calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'freya-json-test-'));
  const preload = join(directory, 'injected-fetch.mjs');
  try {
    await writeFile(
      preload,
      `
      import assert from 'node:assert/strict';
      globalThis.fetch = async (url, init) => {
        assert.equal(url, 'https://api.openai.com/v1/responses');
        const request = JSON.parse(init.body);
        assert.equal(request.stream, true);
        const prompt = request.input.flatMap(message => message.content).find(part => part.type === 'input_text').text;
        const task = JSON.parse(prompt).task;
        assert.equal(task.id, 'brief-a');
        assert.equal('cases' in task, false);
        const blueprint = {
          initial_node: 'talk',
          nodes: {
            talk: { name: 'talk', node_type: 'conversation', tools: ['verify_identity'], transitions: [{ target_node: 'done', description: 'Synthetic test', condition: { operator: 'always' } }] },
            done: { name: 'done', node_type: 'end_call', transitions: [] },
          },
        };
        const text = JSON.stringify({ workflowJson: JSON.stringify(blueprint), uncertainties: [] });
        const events = [
          {type:'response.created',response:{id:'resp_test',created_at:1,model:'synthetic-model'}},
          {type:'response.output_item.added',output_index:0,item:{type:'reasoning',id:'reasoning_1'}},
          {type:'response.output_item.added',output_index:1,item:{type:'message',id:'message_1',phase:'final_answer'}},
          {type:'response.reasoning_text.delta',delta:'DO_NOT_DISPLAY_PRIVATE_REASONING'},
          ...(request.reasoning ? [{type:'response.reasoning_summary_text.delta',item_id:'reasoning_1',output_index:0,summary_index:0,delta:'Synthetic public summary.'}] : []),
          {type:'response.output_text.delta',item_id:'message_1',output_index:1,delta:text},
          {type:'response.completed',response:{id:'resp_test',created_at:1,model:'synthetic-model',status:'completed',usage:{input_tokens:123,output_tokens:456},output:[{type:'message',id:'message_1',role:'assistant',content:[{type:'output_text',text,annotations:[]}]}]}},
        ];
        return new Response(events.map(event => 'data: '+JSON.stringify(event)+'\\n\\n').join(''), {headers:{'Content-Type':'text/event-stream'}});
      };
    `,
    );
    const run = spawnSync(
      process.execPath,
      ['--import', preload, 'src/cli.ts', 'freya', '--json-only', '--out', directory],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          OPENAI_API_KEY: 'synthetic-model-key',
          BUILDER_MODEL: 'synthetic-model',
          FREYA_API_KEY: '',
          FREYA_BANK_TEAM_KEY: '',
          PYTHON: '/nonexistent-python',
        },
      },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, /Reading briefs/);
    assert.match(run.stderr, /one direct-generation call/);
    assert.match(run.stderr, /Input tokens: 123; output tokens: 456/);
    // A model absent from the price table still reports tokens, and says so
    // rather than quoting a fabricated cost.
    assert.match(run.stderr, /Total usage: 123 input tokens, 456 output tokens/);
    assert.match(run.stderr, /cost unavailable: no published price for this model/);
    assert.match(run.stderr, /Node talk: conversation; tools: verify_identity; routes: done/);
    assert.equal(run.stderr.includes('DO_NOT_DISPLAY_PRIVATE_REASONING'), false);
    const workflow = JSON.parse(run.stdout);
    assert.equal(workflow.initial_node, 'talk');
    assert.equal(workflow.nodes.talk.tools[0].function.handler, '__function__:api_call');
    assert.equal(workflow.nodes.done.terminal.function.handler, '__function__:end_call');
    assert.equal('workflow_id' in workflow, false);
    const runsRoot = join(directory, 'generation');
    const traceDirectory = join(runsRoot, (await readdir(runsRoot))[0]);
    const record = JSON.parse(await readFile(join(traceDirectory, 'run.json'), 'utf8'));
    assert.equal(record.status, 'completed');
    assert.deepEqual(record.workflow, workflow);
    assert.equal(record.calls.length, 1);
    assert.equal(record.task.id, 'brief-a');
    assert.ok(record.source.files['src/recipe.ts']);
    assert.equal(record.evaluation.score, null);
    assert.equal(record.calls[0].request.model, 'synthetic-model');
    assert.equal(record.calls[0].request.max_output_tokens, 24000);
    assert.equal(record.config.timeoutMs, 300000);
    assert.equal('headers' in record.calls[0], false);
    assert.deepEqual(record.usage.tokens, {
      inputTokens: 123,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 456,
      reasoningTokens: 0,
      totalTokens: 579,
    });
    assert.equal(record.usage.cost.usd, null);
    assert.equal(record.usage.cost.source, 'unknown');
    assert.deepEqual(record.calls[0].usage, record.usage.tokens);
    const events = await readFile(join(traceDirectory, 'trace.jsonl'), 'utf8');
    assert.match(events, /model-call-started/);
    assert.match(events, /model-call-completed/);
    assert.match(events, /"kind":"draft"/);
    assert.equal(events.includes('synthetic-model-key'), false);
    assert.equal(events.includes('DO_NOT_DISPLAY_PRIVATE_REASONING'), false);
    const log = await readFile(join(traceDirectory, 'generation.log'), 'utf8');
    assert.match(log, /Node talk/);
    assert.match(log, /model draft/);
    assert.match(run.stderr, /Trace directory:/);
    const quiet = spawnSync(
      process.execPath,
      ['--import', preload, 'src/cli.ts', 'freya', '--json-only', '--quiet', '--out', directory],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          OPENAI_API_KEY: 'synthetic-model-key',
          BUILDER_MODEL: 'synthetic-model',
        },
      },
    );
    assert.equal(quiet.status, 0, quiet.stderr);
    assert.equal(quiet.stderr, '');
    assert.deepEqual(JSON.parse(quiet.stdout), workflow);
    const detailed = spawnSync(
      process.execPath,
      [
        '--import',
        preload,
        'src/cli.ts',
        'freya',
        '--json-only',
        '--show-draft',
        '--reasoning-summary',
        '--out',
        directory,
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          OPENAI_API_KEY: 'synthetic-model-key',
          BUILDER_MODEL: 'synthetic-model',
        },
      },
    );
    assert.equal(detailed.status, 0, detailed.stderr);
    assert.match(detailed.stderr, /\[model summary\] Synthetic public summary/);
    assert.match(detailed.stderr, /model draft.*not yet validated/);
    assert.equal(detailed.stderr.includes('DO_NOT_DISPLAY_PRIVATE_REASONING'), false);
    assert.deepEqual(JSON.parse(detailed.stdout), workflow);
    assert.equal((await readdir(runsRoot)).length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a priced model records a cost alongside its tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'freya-cost-test-'));
  const preload = join(directory, 'injected-fetch.mjs');
  try {
    await writeFile(
      preload,
      `
      globalThis.fetch = async () => {
        const blueprint = {
          initial_node: 'talk',
          nodes: {
            talk: { name: 'talk', node_type: 'conversation', tools: ['verify_identity'], transitions: [{ target_node: 'done', description: 'Synthetic test', condition: { operator: 'always' } }] },
            done: { name: 'done', node_type: 'end_call', transitions: [] },
          },
        };
        const text = JSON.stringify({ workflowJson: JSON.stringify(blueprint), uncertainties: [] });
        const usage = {input_tokens:1000000, input_tokens_details:{cached_tokens:500000, cache_write_tokens:200000}, output_tokens:1000000, output_tokens_details:{reasoning_tokens:250000}, total_tokens:2000000};
        const events = [
          {type:'response.created',response:{id:'resp_test',created_at:1,model:'gpt-5'}},
          {type:'response.output_item.added',output_index:0,item:{type:'message',id:'message_1',phase:'final_answer'}},
          {type:'response.output_text.delta',item_id:'message_1',output_index:0,delta:text},
          {type:'response.completed',response:{id:'resp_test',created_at:1,model:'gpt-5',status:'completed',usage,output:[{type:'message',id:'message_1',role:'assistant',content:[{type:'output_text',text,annotations:[]}]}]}},
        ];
        return new Response(events.map(event => 'data: '+JSON.stringify(event)+'\\n\\n').join(''), {headers:{'Content-Type':'text/event-stream'}});
      };
    `,
    );
    const run = spawnSync(
      process.execPath,
      ['--import', preload, 'src/cli.ts', 'freya', '--json-only', '--out', directory],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          OPENAI_API_KEY: 'synthetic-model-key',
          BUILDER_MODEL: 'gpt-5',
        },
      },
    );
    assert.equal(run.status, 0, run.stderr);
    // gpt-5: $1.25/M input, $0.125/M cached, $10/M output. It publishes no
    // cache-write rate, so writes bill at the standard input rate.
    // 0.5M uncached (0.3M standard + 0.2M written) + 0.5M cached + 1M output.
    assert.match(run.stderr, /estimated cost:? \$10\.687500 \(table price\)/i);
    assert.match(run.stderr, /estimated cost \$10\.687500 at table prices/);
    assert.match(run.stderr, /Total usage: 1,000,000 input tokens, 1,000,000 output tokens/);
    assert.match(run.stderr, /250,000 reasoning/);
    const runsRoot = join(directory, 'generation');
    const record = JSON.parse(
      await readFile(join(runsRoot, (await readdir(runsRoot))[0], 'run.json'), 'utf8'),
    );
    assert.equal(record.usage.cost.usd, 10.6875);
    assert.equal(record.usage.cost.source, 'table');
    assert.equal(record.usage.tokens.reasoningTokens, 250000);
    assert.equal(record.usage.tokens.cachedInputTokens, 500000);
    // The written share is split out of the input total, not added to it.
    assert.equal(record.usage.tokens.cacheWriteTokens, 200000);

    // An env override replaces the table rate and marks the estimate as env-sourced.
    const overridden = spawnSync(
      process.execPath,
      ['--import', preload, 'src/cli.ts', 'freya', '--json-only', '--out', directory],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          OPENAI_API_KEY: 'synthetic-model-key',
          BUILDER_MODEL: 'gpt-5',
          BUILDER_INPUT_PRICE_PER_MTOK: '2',
          BUILDER_OUTPUT_PRICE_PER_MTOK: '20',
        },
      },
    );
    assert.equal(overridden.status, 0, overridden.stderr);
    // An override replaces only the rates it names: 0.5M uncached at $2/M
    // (writes included) + 0.5M cached still at the table's $0.125/M + 1M at $20/M.
    assert.match(overridden.stderr, /estimated cost \$21\.062500 at env prices/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed generation retains its request and partial draft in the trace with no stdout JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'freya-failed-trace-test-'));
  const preload = join(directory, 'injected-fetch.mjs');
  try {
    await writeFile(
      preload,
      `
      globalThis.fetch = async () => {
        const events = [
          {type:'response.created',response:{id:'resp_test',created_at:1,model:'synthetic-model'}},
          {type:'response.output_item.added',output_index:0,item:{type:'message',id:'message_1',phase:'final_answer'}},
          {type:'response.output_text.delta',item_id:'message_1',output_index:0,delta:'synthetic partial draft'},
        ];
        return new Response(events.map(event => 'data: '+JSON.stringify(event)+'\\n\\n').join(''), {headers:{'Content-Type':'text/event-stream'}});
      };
    `,
    );
    const run = spawnSync(
      process.execPath,
      ['--import', preload, 'src/cli.ts', 'freya', '--json-only', '--quiet', '--out', directory],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          OPENAI_API_KEY: 'synthetic-model-key',
          BUILDER_MODEL: 'synthetic-model',
        },
      },
    );
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /Trace directory:/);
    const traceDirectory = join(
      directory,
      'generation',
      (await readdir(join(directory, 'generation')))[0],
    );
    const record = JSON.parse(await readFile(join(traceDirectory, 'run.json'), 'utf8'));
    assert.equal(record.status, 'failed');
    assert.match(record.error.message, /ended before/);
    assert.equal('workflow' in record, false);
    assert.equal(record.calls.length, 1);
    assert.match(record.calls[0].error, /ended before/);
    const events = await readFile(join(traceDirectory, 'trace.jsonl'), 'utf8');
    assert.match(events, /synthetic partial draft/);
    assert.match(events, /model-call-started/);
    assert.match(events, /model-call-failed/);
    assert.match(
      await readFile(join(traceDirectory, 'generation.log'), 'utf8'),
      /synthetic partial draft/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
