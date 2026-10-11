// Prepare a submission from one completed final run. No model or platform calls.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { hash, projectRoot } from './experiments.ts';
import { object } from './validation.ts';
import { parseFreyaStrategy } from './strategies.ts';

type Member = { name: string; email: string };

function redactAuthExamples(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\b(Bearer|Basic)\s+(?!\[REDACTED\])\S+/gi, '$1 [REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map(redactAuthExamples);
  }
  if (object(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactAuthExamples(item)]),
    );
  }
  return value;
}

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

function boundToolUrls(workflow: unknown): string[] {
  const urls: string[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (object(value)) {
      if (object(value.function) && value.function.handler === '__function__:api_call') {
        const parameters = value.function.parameters;
        const url =
          object(parameters) && object(parameters.properties) && parameters.properties.url;
        if (!object(url) || typeof url.default !== 'string') {
          throw new Error('Export has a bank tool without a bound URL.');
        }
        urls.push(url.default);
      }
      Object.values(value).forEach(visit);
    }
  }
  visit(workflow);
  return urls;
}

export async function prepareSubmission(
  options: {
    runs: string[];
    out: string;
    team: string;
    members: Member[];
    repo: string;
    commit: string;
    mockUrl: string;
    runCommand: string;
  },
  repository = projectRoot,
) {
  const mock = new URL(options.mockUrl);
  if (
    options.runs.length !== 1 ||
    !options.team.trim() ||
    !options.repo.startsWith('https://') ||
    options.members.length < 1 ||
    options.members.length > 2 ||
    options.members.some((member) => !member.name.trim() || !/^\S+@\S+\.\S+$/.test(member.email)) ||
    mock.protocol !== 'https:' ||
    !!mock.username ||
    !!mock.password ||
    !!mock.search ||
    !!mock.hash ||
    !options.runCommand.includes('{case_folder}') ||
    !options.runCommand.includes('{mock_url}')
  ) {
    throw new Error(
      'Submission needs one final run, one or two members, a team name, HTTPS repository and mock URLs, and a run command with {case_folder} and {mock_url}.',
    );
  }
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: repository,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
    });
  if (!/^[a-f0-9]{7,40}$/i.test(options.commit)) {
    throw new Error('Use a Git commit SHA.');
  }
  const commit = git('rev-parse', `${options.commit}^{commit}`).trim();
  const mockBase = mock.toString().replace(/\/$/, '');
  const prepared = [];
  for (const file of options.runs) {
    const run = JSON.parse(await readFile(resolve(file), 'utf8'));
    if (
      run.kind !== 'freya-live-run' ||
      run.status !== 'completed' ||
      run.config?.final !== true ||
      run.source?.git?.dirty !== false ||
      !run.source?.git?.commit ||
      !object(run.source?.files) ||
      run.source.hash !== hash(run.source.files) ||
      run.config?.mockUrl?.replace(/\/$/, '') !== mockBase ||
      !Array.isArray(run.task?.tools)
    ) {
      throw new Error(
        'Select a completed final run built from the clean submitted commit and bound to this mock URL.',
      );
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
    const urls = boundToolUrls(exported.workflow);
    if (!urls.length || urls.some((url) => !url.startsWith(`${mockBase}/`))) {
      throw new Error('Exported bank tools must all call the selected mock URL.');
    }
    rejectSecrets(exported);
    const strategy = parseFreyaStrategy(run.config.strategy ?? 'direct');
    const instructionsHash = run.config.instructionsHash ?? null;
    if (
      (instructionsHash !== null && !/^[a-f0-9]{64}$/.test(instructionsHash)) ||
      (strategy !== 'direct' && instructionsHash === null)
    ) {
      throw new Error('Final run is missing a valid builder instructions hash.');
    }
    const trace = {
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      elapsedMs: run.elapsedMs,
      inputHash: run.inputHash,
      sourceHash: run.source.hash,
      commit,
      inputs: redactAuthExamples(run.task),
      modelCalls: run.calls.map((call: unknown) => ({
        model: run.config.model,
        purpose: run.modelCallPurpose,
        call: redactAuthExamples(call),
      })),
      registration: run.registration,
      nodes:
        Object.keys(run.workflow.nodes).length +
        Object.keys(run.workflow.global_nodes ?? {}).length,
      toolNames: usedBankTools(run.workflow, run.task.tools),
      model: run.config.model,
      reasoningEffort: run.config.reasoningEffort ?? null,
      strategy,
      instructionsHash,
      sourceFiles: run.source.files,
      exportHash: run.exportHash,
      stages: run.stages,
      evaluation: run.evaluation,
      tests: run.practice ?? null,
    };
    rejectSecrets(trace);
    prepared.push({ exportText, trace });
  }
  if (
    isAbsolute(options.out) ||
    options.out.split(/[\\/]/).some((part) => part === '..') ||
    options.out.startsWith('experiments')
  ) {
    throw new Error('Use a repository-relative submission directory outside experiments.');
  }
  const item = prepared[0];
  const workflow = `${options.out}/final.workflow.json`;
  const trace = `${options.out}/final.trace.json`;
  const form = {
    team: options.team,
    members: options.members,
    repo: options.repo,
    commit: null,
    run_command: options.runCommand,
    workflow,
    trace,
    mock_url: mockBase,
  };
  rejectSecrets(form);
  const directory = resolve(repository, options.out);
  // Refuse existing output. This keeps earlier selected artifacts intact.
  await mkdir(directory, { recursive: false });
  await writeFile(join(directory, 'final.workflow.json'), item.exportText, {
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(join(directory, 'final.trace.json'), JSON.stringify(item.trace, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
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
      maxBuffer: 16 * 1024 * 1024,
    });
  const commit = git('rev-parse', `${commitRef}^{commit}`).trim();
  const path = resolve(repository, out, 'submission.json');
  const form = JSON.parse(await readFile(path, 'utf8'));
  rejectSecrets(form);
  for (const file of [form.workflow, form.trace]) {
    if (typeof file !== 'string' || isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
      throw new Error('Submission paths must be inside the repository.');
    }
    if (git('show', `${commit}:${file}`) !== (await readFile(resolve(repository, file), 'utf8'))) {
      throw new Error(`Submission file differs from commit: ${file}`);
    }
  }
  const trace = JSON.parse(await readFile(resolve(repository, form.trace), 'utf8'));
  if (hash(trace.sourceFiles) !== trace.sourceHash) {
    throw new Error('Trace source hash changed.');
  }
  for (const [name, text] of Object.entries(trace.sourceFiles)) {
    if (git('show', `${commit}:${name}`) !== text) {
      throw new Error(`Submitted builder differs from run: ${name}`);
    }
  }
  const exported = JSON.parse(await readFile(resolve(repository, form.workflow), 'utf8'));
  if (
    hash(exported) !== trace.exportHash ||
    exported.workflow_id !== trace.registration.workflow_id ||
    exported.agent_id !== trace.registration.agent_id
  ) {
    throw new Error('Submitted export does not match its trace.');
  }
  rejectSecrets(trace);
  rejectSecrets(exported);
  form.commit = commit;
  await writeFile(path, JSON.stringify(form, null, 2) + '\n', { mode: 0o600 });
  return form;
}
