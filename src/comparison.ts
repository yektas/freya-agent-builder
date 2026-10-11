// Offline evidence report. Public/synthetic results never become hidden benchmark scores.
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { hash, projectRoot } from './experiments.ts';
import { assertPracticeInputs } from './practice-inputs.ts';
import { object } from './validation.ts';
import { parseFreyaStrategy } from './strategies.ts';

export function practiceEvidence(result: any, ledgers: Map<string, any>) {
  const missing = {
    score: null,
    passed: null,
    total: null,
    promisedAmountsByRepetition: null,
    promisedAmountAcrossPassingRuns: null,
  };
  if (
    !object(result) ||
    result.runs !== 3 ||
    !Array.isArray(result.all_rows) ||
    result.all_rows.length !== 3 ||
    !Array.isArray(result.final) ||
    !result.final.length
  ) {
    return missing;
  }
  const allRows = result.all_rows;
  if (!result.final.every((row: unknown) => object(row))) {
    return missing;
  }
  const ids = result.final.map((row: any) => row.id);
  if (
    new Set(ids).size !== ids.length ||
    !ids.every((id: unknown) => typeof id === 'string') ||
    !allRows.every(
      (rows: any) =>
        Array.isArray(rows) &&
        rows.length === ids.length &&
        rows.every((row: unknown) => object(row)) &&
        new Set(rows.map((row: any) => row.id)).size === ids.length &&
        rows.every((row: any) => ids.includes(row.id) && typeof row.pass === 'boolean'),
    )
  ) {
    return missing;
  }
  const passing = ids.filter((id: string) =>
    allRows.every((rows: any[]) => rows.find((row) => row.id === id).pass === true),
  );
  if (
    result.final.some((row: any) => row.pass !== passing.includes(row.id)) ||
    result.passed !== passing.length ||
    result.total !== ids.length
  ) {
    return missing;
  }
  const amounts = allRows.map((rows: any[]) => {
    let sum = 0;
    for (const row of rows.filter((row) => passing.includes(row.id))) {
      const ledger = ledgers.get(row.customer_id);
      if (!ledger || !Array.isArray(ledger.promises)) {
        return null;
      }
      for (const promise of ledger.promises) {
        if (!Number.isFinite(Number(promise.amount)) || Number(promise.amount) < 0) {
          return null;
        }
        sum += Math.round(Number(promise.amount) * 100);
      }
    }
    return sum / 100;
  });
  return {
    score: passing.length / ids.length,
    passed: passing.length,
    total: ids.length,
    promisedAmountsByRepetition: amounts,
    promisedAmountAcrossPassingRuns: amounts.every((amount: number | null) => amount !== null)
      ? Math.round(amounts.reduce((sum: number, amount: number) => sum + amount, 0) * 100) / 100
      : null,
  };
}

export async function compareRuns(files: string[]) {
  if (!files.length) {
    throw new Error('Compare needs at least one --run-file.');
  }
  const rows = [];
  for (const file of files) {
    const path = resolve(file);
    const run = JSON.parse(await readFile(path, 'utf8'));
    const root = dirname(path);
    let job: any = null;
    if (run.kind === 'generation-only') {
      try {
        job = JSON.parse(await readFile(join(root, 'practice-job.json'), 'utf8'));
      } catch {
        /* Untested generation. */
      }
    }
    let upload: any = null;
    let current = run.kind === 'freya-live-run';
    if (run.kind === 'generation-only') {
      try {
        upload = JSON.parse(await readFile(join(root, 'upload.json'), 'utf8'));
        const compiled = JSON.parse(await readFile(join(root, 'compiled.workflow.json'), 'utf8'));
        current =
          upload.status === 'registered' &&
          job?.workflowHash === upload.workflowHash &&
          job?.agentId === upload.agentId &&
          hash(compiled) === job?.workflowHash;
      } catch {
        /* Registration is missing or incomplete. */
      }
    }
    const selectedBrief =
      job?.brief ??
      run.config?.brief ??
      (run.kind === 'freya-live-run' && !run.config?.final ? 'all' : null);
    let inputError: string | null = null;
    try {
      if (selectedBrief) {
        await assertPracticeInputs(run.task, join(projectRoot, 'build-the-builder'), selectedBrief);
      }
    } catch (error) {
      inputError = error instanceof Error ? error.message : 'Practice input mismatch.';
    }
    let result: any = null;
    if (
      current &&
      !inputError &&
      (job?.status === 'completed' || (run.kind === 'freya-live-run' && run.status === 'completed'))
    ) {
      try {
        result = JSON.parse(await readFile(join(root, 'practice.json'), 'utf8'));
      } catch {
        /* Keep missing result visible. */
      }
    }
    const ledgers = new Map<string, any>();
    try {
      const lines = (await readFile(join(root, 'platform.jsonl'), 'utf8'))
        .split('\n')
        .filter(Boolean);
      for (const line of lines) {
        const entry = JSON.parse(line);
        if (
          entry.kind === 'bank-response' &&
          typeof entry.path === 'string' &&
          entry.path.startsWith('/v1/practice/ledger/')
        ) {
          ledgers.set(entry.path.slice('/v1/practice/ledger/'.length), entry.result);
        }
      }
    } catch {
      /* Missing or partial trace: amounts remain unknown. */
    }
    const evidence = practiceEvidence(result, ledgers);
    const selection = {
      inputHash: run.inputHash ?? hash(run.task),
      caseHash:
        job?.caseHash ??
        (run.kit?.files?.['public-test-set.json']
          ? hash(run.kit.files['public-test-set.json'])
          : null),
      brief: selectedBrief,
      style: job?.style ?? run.config?.style ?? null,
      only: run.config?.only ?? null,
      repetitions: job?.repetitions ?? run.evaluation?.repetitions ?? null,
    };
    rows.push({
      path,
      status: job?.status ?? (upload?.status === 'failed' ? 'failed' : run.status),
      registrationStatus: upload?.status ?? (run.registration ? 'registered' : null),
      currentWorkflow: current,
      inputCompatible: selectedBrief ? !inputError : null,
      sourceHash: run.source?.hash ?? null,
      model: run.config?.model ?? null,
      reasoningEffort: run.config?.reasoningEffort ?? null,
      strategy: parseFreyaStrategy(run.config?.strategy ?? 'direct'),
      instructionsHash: run.config?.instructionsHash ?? null,
      selection,
      comparisonGroup: selection.caseHash && selectedBrief ? hash(selection) : null,
      ...evidence,
      buildElapsedMs: run.kind === 'freya-live-run' ? (run.elapsedMs ?? null) : null,
      generationElapsedMs: run.kind === 'generation-only' ? (run.elapsedMs ?? null) : null,
      estimatedModelCost: run.usage?.cost ?? null,
      error:
        job?.error ??
        upload?.error ??
        run.error ??
        inputError ??
        (!current && job ? 'Registration changed since testing.' : null),
    });
  }
  return {
    source: 'public-practice-evidence',
    hiddenFinalScore: null,
    coverage: {
      selectedRuns: rows.length,
      runsWithStrictThreeRepetitionEvidence: rows.filter((row) => row.score !== null).length,
    },
    tieBreak:
      'Compare matching groups by passed cases, then ledger amounts on passing cases, then total build time. Amounts show each repetition and their sum; no hidden benchmark or submission-time ranking is inferred.',
    rows,
  };
}
