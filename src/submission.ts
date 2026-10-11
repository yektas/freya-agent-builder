// Prepare a submission from two completed final runs. No model or platform calls.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { hash, projectRoot } from './experiments.ts';
import { object } from './validation.ts';

function rejectSecrets(value: unknown) {
  const secrets = ['OPENAI_API_KEY', 'FREYA_API_KEY', 'FREYA_BANK_TEAM_KEY']
    .map((name) => process.env[name])
    .filter(Boolean) as string[];
  function visit(item: unknown): void {
    if (typeof item === 'string') {
      if (
        secrets.some((secret) => item.includes(secret)) ||
        /\b(?:Bearer|Basic)\s+(?!\[REDACTED\])\S+/i.test(item)
      ) {
        throw new Error('Submission contains credential material.');
      }
    } else if (Array.isArray(item)) {
      item.forEach(visit);
    } else if (object(item)) {
      for (const [key, field] of Object.entries(item)) {
        if (
          ['authorization', 'x-team-key', 'api_key', 'apikey'].includes(key.toLowerCase()) &&
          field !== '[REDACTED]'
        ) {
          throw new Error('Submission contains an authentication field.');
        }
        visit(field);
      }
    }
  }
  visit(value);
}

function usedBankTools(workflow: unknown, catalog: { name: string }[]) {
  const allowed = new Set(catalog.map((tool) => tool.name));
  const used = new Set<string>();
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (object(value)) {
      if (
        object(value.function) &&
        typeof value.function.name === 'string' &&
        allowed.has(value.function.name)
      ) {
        used.add(value.function.name);
      }
      Object.values(value).forEach(visit);
    }
  }
  visit(workflow);
  return [...used].sort();
}

export async function prepareSubmission(
  options: {
    runs: string[];
    out: string;
    team: string;
    repo: string;
    commit: string;
  },
  repository = projectRoot,
) {
  if (options.runs.length !== 2 || !options.team.trim() || !options.repo.startsWith('https://')) {
    throw new Error(
      'Submission needs two final run files, a team name, and an HTTPS repository URL.',
    );
  }
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: repository,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  if (!/^[a-f0-9]{7,40}$/i.test(options.commit)) {
    throw new Error('Use a Git commit SHA.');
  }
  const commit = git('rev-parse', `${options.commit}^{commit}`).trim();
  const prepared = [];
  for (const [index, file] of options.runs.entries()) {
    const run = JSON.parse(await readFile(resolve(file), 'utf8'));
    if (
      run.kind !== 'freya-live-run' ||
      run.status !== 'completed' ||
      run.config?.final !== true ||
      run.source?.git?.dirty !== false ||
      !run.source?.git?.commit ||
      !object(run.source?.files) ||
      run.source.hash !== hash(run.source.files)
    ) {
      throw new Error('Select completed final runs built from the same clean submitted commit.');
    }
    for (const [name, text] of Object.entries(run.source.files)) {
      if (typeof text !== 'string' || git('show', `${commit}:${name}`) !== text) {
        throw new Error(`Run source differs from submitted commit: ${name}`);
      }
    }
    if (
      !run.startedAt ||
      !run.endedAt ||
      !Number.isFinite(run.elapsedMs) ||
      run.elapsedMs > 1800000 ||
      run.elapsedMs < 0 ||
      !Array.isArray(run.calls) ||
      !run.modelCallPurpose ||
      !run.registration?.workflow_id ||
      !run.registration?.agent_id ||
      !object(run.workflow?.nodes)
    ) {
      throw new Error('Final run is missing required trace fields or exceeded 30 minutes.');
    }
    const exportText = await readFile(
      join(dirname(resolve(file)), 'exported.workflow.json'),
      'utf8',
    );
    const exported = JSON.parse(exportText);
    if (
      run.exportHash !== hash(exported) ||
      exported.workflow_id !== run.registration.workflow_id ||
      exported.agent_id !== run.registration.agent_id ||
      !object(exported.workflow)
    ) {
      throw new Error('Export changed or does not match the recorded registration.');
    }
    rejectSecrets(exported);
    const name = `hidden-${index + 1}`;
    const trace = {
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      elapsedMs: run.elapsedMs,
      inputHash: run.inputHash,
      sourceHash: run.source.hash,
      commit,
      inputs: run.task,
      modelCalls: run.calls.map((call: unknown) => ({
        model: run.config.model,
        purpose: run.modelCallPurpose,
        call,
      })),
      registration: run.registration,
      nodes:
        Object.keys(run.workflow.nodes).length +
        Object.keys(run.workflow.global_nodes ?? {}).length,
      toolNames: usedBankTools(run.workflow, run.task.tools),
      model: run.config.model,
      reasoningEffort: run.config.reasoningEffort ?? null,
      sourceFiles: run.source.files,
      exportHash: run.exportHash,
      stages: run.stages,
      evaluation: run.evaluation,
      tests: run.practice ?? null,
    };
    rejectSecrets(trace);
    prepared.push({ name, exportText, trace });
  }
  if (
    prepared[0].trace.model !== prepared[1].trace.model ||
    prepared[0].trace.reasoningEffort !== prepared[1].trace.reasoningEffort
  ) {
    throw new Error(
      'Both final runs must use the same model and reasoning settings for the run command.',
    );
  }
  if (prepared[0].trace.inputHash === prepared[1].trace.inputHash) {
    throw new Error('Select one distinct input run for each hidden brief.');
  }
  if (
    isAbsolute(options.out) ||
    options.out.split(/[\\/]/).some((part) => part === '..') ||
    options.out.startsWith('experiments')
  ) {
    throw new Error('Use a repository-relative submission directory outside experiments.');
  }
  const directory = resolve(repository, options.out);
  // Refuse existing output. This keeps earlier selected artifacts intact.
  await mkdir(directory, { recursive: false });
  const workflows: Record<string, string> = {};
  const traces: Record<string, string> = {};
  for (const item of prepared) {
    workflows[item.name] = `${options.out}/${item.name}.workflow.json`;
    traces[item.name] = `${options.out}/${item.name}.trace.json`;
    await writeFile(join(directory, `${item.name}.workflow.json`), item.exportText, {
      flag: 'wx',
      mode: 0o600,
    });
    await writeFile(
      join(directory, `${item.name}.trace.json`),
      JSON.stringify(item.trace, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const strategy = prepared[0].trace;
  const form = {
    team: options.team,
    repo: options.repo,
    commit: null,
    builder_commit: commit,
    run_command: `node --env-file-if-exists=.env --env-file-if-exists=build-the-builder/env.sh src/cli.ts freya --final --brief-file {brief_path} --openapi {tool_api_path} --slot final --model ${quote(strategy.model)} --reasoning-effort ${quote(strategy.reasoningEffort ?? '')}`,
    workflows,
    traces,
  };
  await writeFile(join(directory, 'submission.json'), JSON.stringify(form, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  return form;
}

// Run after committing the workflows and traces. The form itself is sent externally.
export async function finalizeSubmission(out: string, commitRef: string, repository = projectRoot) {
  if (!/^[a-f0-9]{7,40}$/i.test(commitRef)) {
    throw new Error('Use a Git commit SHA.');
  }
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: repository,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  const commit = git('rev-parse', `${commitRef}^{commit}`).trim();
  const path = resolve(repository, out, 'submission.json');
  const form = JSON.parse(await readFile(path, 'utf8'));
  for (const name of ['hidden-1', 'hidden-2']) {
    for (const file of [form.workflows[name], form.traces[name]]) {
      if (typeof file !== 'string' || isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
        throw new Error('Submission paths must be inside the repository.');
      }
      if (
        git('show', `${commit}:${file}`) !== (await readFile(resolve(repository, file), 'utf8'))
      ) {
        throw new Error(`Submission file differs from commit: ${file}`);
      }
    }
    const trace = JSON.parse(await readFile(resolve(repository, form.traces[name]), 'utf8'));
    if (hash(trace.sourceFiles) !== trace.sourceHash) {
      throw new Error('Trace source hash changed.');
    }
    for (const [name, text] of Object.entries(trace.sourceFiles)) {
      if (git('show', `${commit}:${name}`) !== text) {
        throw new Error(`Submitted builder differs from run: ${name}`);
      }
    }
    const exported = JSON.parse(await readFile(resolve(repository, form.workflows[name]), 'utf8'));
    if (
      hash(exported) !== trace.exportHash ||
      exported.workflow_id !== trace.registration.workflow_id ||
      exported.agent_id !== trace.registration.agent_id
    ) {
      throw new Error('Submitted export does not match its trace.');
    }
    rejectSecrets(trace);
    rejectSecrets(exported);
  }
  form.commit = commit;
  await writeFile(path, JSON.stringify(form, null, 2) + '\n', { mode: 0o600 });
  return form;
}
