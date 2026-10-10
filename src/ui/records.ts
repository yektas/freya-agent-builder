// Read-only discovery and normalization of run records for the inspector UI.
// Three writers produce records under the output directory; each is mapped to one
// summary and one detail shape so the UI never branches on which command ran.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { object } from '../validation.ts';
import { projectRoot } from '../experiments.ts';

export type RunKind = 'freya-live-run' | 'generation-only' | 'local-build';

export type RunFile = { name: string; bytes: number };

export type EvaluationView = {
  score: number | null;
  passed: number | null;
  total: number | null;
  source: string;
  details: string | null;
};

export type RunSummary = {
  id: string;
  kind: RunKind;
  title: string;
  status: string;
  startedAt: string | null;
  elapsedMs: number | null;
  model: string | null;
  provider: string | null;
  slot: string | null;
  taskId: string | null;
  synthetic: boolean;
  evaluation: EvaluationView;
  error: string | null;
  counts: {
    nodes: number | null;
    tools: number | null;
    stages: number | null;
    calls: number | null;
  };
  files: RunFile[];
};

export type TransitionView = {
  target: string;
  description: string | null;
  condition: string | null;
  implicit: boolean;
};

export type NodeView = {
  key: string;
  type: string;
  taskMessage: string | null;
  tools: string[];
  preActions: string[];
  transitions: TransitionView[];
  terminal: string | null;
  global: boolean;
  reachable: boolean;
  deadEnd: boolean;
};

export type WorkflowView = {
  source: 'compiled' | 'exported' | 'recorded';
  initialNode: string | null;
  systemPrompt: string | null;
  contextVariables: string[];
  lifecycleTools: string[];
  nodes: NodeView[];
  globalNodes: NodeView[];
  unreachable: string[];
  danglingTargets: string[];
};

export type PracticeCaseView = {
  id: string;
  level: string | null;
  family: string | null;
  pass: boolean;
  failed: string[];
  tools: string[];
  callId: string | null;
};

export type PracticeView = {
  passed: number;
  total: number;
  simulationId: string | null;
  iterationId: string | null;
  cases: PracticeCaseView[];
  summaryOnly: boolean;
};

export type StageView = {
  name: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  ms: number | null;
};

export type TraceEntryView = {
  at: string | null;
  elapsedMs: number | null;
  kind: string;
  summary: string;
  streamKind?: 'draft' | 'summary';
  fragments?: number;
  endedElapsedMs?: number | null;
};

export type CallView = {
  endpoint: string;
  elapsedMs: number | null;
  error: string | null;
  hasRequest: boolean;
  hasResponse: boolean;
};

export type CandidateView = {
  systemPrompt: string | null;
  toolNames: string[];
  completionConditions: string[];
  uncertainties: string[];
};

export type UploadView = {
  status: 'registered' | 'failed' | 'uncertain';
  stage: string;
  slot: string;
  workspaceId: string | null;
  workflowId: string | null;
  agentId: string | null;
  version: number | null;
  workflowHash: string | null;
  exportedPath: string | null;
  startedAt: string;
  endedAt: string | null;
  elapsedMs: number | null;
  reused: boolean;
  error: string | null;
};

export type RunDetail = {
  summary: RunSummary;
  stages: StageView[];
  workflow: WorkflowView | null;
  // The workflow document exactly as recorded, for copying into a submission.
  workflowJson: string | null;
  practice: PracticeView | null;
  calls: CallView[];
  trace: TraceEntryView[];
  candidate: CandidateView | null;
  workflowCandidate: { uncertainties: string[] } | null;
  // Recorded upload to Freya, if this run was registered from the inspector.
  upload: UploadView | null;
  issues: string[];
  source: { hash: string | null; commit: string | null; dirty: boolean; files: string[] } | null;
  config: Record<string, unknown> | null;
  inputHash: string | null;
};

export type DiscoveredRun = {
  id: string;
  kind: RunKind;
  runPath: string;
  runFile: string;
  // Absolute path per artifact. Build records are a single file rather than a
  // directory, so the artifact path cannot be derived from a directory join.
  filePaths: Record<string, string>;
  files: RunFile[];
};

// Directories under the output root that hold state or probes, not reviewable runs.
const SKIP_DIRS = new Set(['freya-state', 'freya-probe', 'generation']);
const GENERATION_DIR = 'generation';
// '~' cannot appear in the generated ids we create, so it reverses unambiguously.
const ID_SEPARATOR = '~';

// A generation run normally stops at compiled.workflow.json. The upload action
// adds the platform trace, the organizer's export, and its own record, so those
// stay discoverable and reviewable in the same run.
const GENERATION_FILES = [
  'compiled.workflow.json',
  'run.json',
  'trace.jsonl',
  'generation.log',
  'platform.jsonl',
  'exported.workflow.json',
  'upload.json',
];

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return list(value).filter((item): item is string => typeof item === 'string');
}

function record(value: unknown): Record<string, unknown> {
  return object(value) ? value : {};
}

function compact(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function readJsonLines(path: string): Promise<unknown[]> {
  try {
    return (await readFile(path, 'utf8'))
      .split('\n')
      .filter((line) => line.trim().length)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((item) => item !== null);
  } catch {
    return [];
  }
}

async function fileSizes(directory: string, names: string[]): Promise<RunFile[]> {
  const files: RunFile[] = [];
  for (const name of names) {
    try {
      const info = await stat(join(directory, name));
      if (info.isFile()) {
        files.push({ name, bytes: info.size });
      }
    } catch {
      // A run may have stopped before writing every artifact.
    }
  }
  return files;
}

// The workflow tool entries are function objects after compilation and plain
// names in some recorded artifacts; accept both rather than dropping the node.
function toolName(tool: unknown): string {
  if (typeof tool === 'string') {
    return tool;
  }
  const entry = record(tool);
  const fn = record(entry.function);
  if (typeof fn.name === 'string') {
    return fn.name;
  }
  if (typeof entry.name === 'string') {
    return entry.name;
  }
  return 'unknown';
}

function preActionLabel(action: unknown): string {
  const entry = record(action);
  if (typeof entry.code === 'string') {
    const fn = record(entry.code_exec);
    const name = typeof fn.name === 'string' ? `${fn.name}()` : 'code';
    return `code: ${name} (${entry.code.split('\n').length} lines)`;
  }
  if (entry.code_exec !== undefined) {
    return 'code';
  }
  if (typeof entry.tool === 'string') {
    return `tool: ${entry.tool}`;
  }
  if (typeof entry.name === 'string') {
    return `api: ${entry.name}`;
  }
  return 'action';
}

function nodeView(key: string, raw: unknown, isGlobal: boolean): NodeView {
  const node = record(raw);
  const transitions: TransitionView[] = [];
  for (const item of list(node.transitions)) {
    const edge = record(item);
    if (typeof edge.target_node === 'string') {
      transitions.push({
        target: edge.target_node,
        description: text(edge.description),
        condition: compact(edge.condition),
        implicit: false,
      });
    }
  }
  // Implicit engine exits still move the conversation, so count them as edges.
  if (node.passthrough === true && typeof node.passthrough_default_transition === 'string') {
    transitions.push({
      target: node.passthrough_default_transition,
      description: 'passthrough default',
      condition: null,
      implicit: true,
    });
  }
  if (typeof node.max_turn_transition === 'string') {
    transitions.push({
      target: node.max_turn_transition,
      description: 'max node turns reached',
      condition: null,
      implicit: true,
    });
  }
  return {
    key,
    type: text(node.node_type) ?? 'unknown',
    taskMessage: text(node.task_message),
    tools: list(node.tools).map(toolName),
    preActions: list(node.pre_actions).map(preActionLabel),
    transitions,
    terminal: object(node.terminal) ? JSON.stringify(node.terminal) : null,
    global: isGlobal,
    reachable: false,
    deadEnd: false,
  };
}

function walk(raw: unknown): WorkflowView {
  const workflow = record(raw);
  const initialNode = text(workflow.initial_node);
  const view: WorkflowView = {
    source: 'recorded',
    initialNode,
    systemPrompt: text(workflow.system_prompt),
    contextVariables: Object.keys(record(workflow.context_variables)),
    lifecycleTools: strings(workflow.tools),
    nodes: Object.entries(record(workflow.nodes)).map(([key, value]) =>
      nodeView(key, value, false),
    ),
    globalNodes: Object.entries(record(workflow.global_nodes)).map(([key, value]) =>
      nodeView(key, value, true),
    ),
    unreachable: [],
    danglingTargets: [],
  };
  const byKey = new Map(view.nodes.map((node) => [node.key, node]));
  const globalKeys = new Set(view.globalNodes.map((node) => node.key));
  const seen = new Set<string>();
  if (initialNode && byKey.has(initialNode)) {
    const queue = [initialNode];
    while (queue.length) {
      const key = queue.shift()!;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      for (const edge of byKey.get(key)!.transitions) {
        // `__previous__` is resolved by the platform against call history.
        if (byKey.has(edge.target) && !seen.has(edge.target)) {
          queue.push(edge.target);
        }
      }
    }
  }
  for (const node of view.nodes) {
    node.reachable = seen.has(node.key);
    // An end_call node ends the conversation by design. Any other node with no
    // exit the engine can resolve also strands the customer. This is a structural
    // hint about the recorded graph, not a correctness or benchmark result.
    const resolvable = node.transitions.some(
      (edge) =>
        byKey.has(edge.target) || edge.target === '__previous__' || globalKeys.has(edge.target),
    );
    node.deadEnd = !resolvable && node.type !== 'end_call';
  }
  view.unreachable = view.nodes.filter((node) => !node.reachable).map((node) => node.key);
  view.danglingTargets = [
    ...new Set(
      view.nodes
        .filter((node) => !node.global)
        .flatMap((node) => node.transitions.map((edge) => edge.target))
        .filter(
          (target) => !byKey.has(target) && target !== '__previous__' && !globalKeys.has(target),
        ),
    ),
  ];
  return view;
}

function practiceView(raw: unknown): PracticeView | null {
  const result = record(raw);
  const rows = list(result.rows);
  const passed = whole(result.passed);
  const total = whole(result.total);
  if (passed === null && total === null && !rows.length) {
    return null;
  }
  const cases: PracticeCaseView[] = rows.map((item) => {
    const row = record(item);
    return {
      id: String(row.id ?? 'unknown'),
      level: text(row.level),
      family: text(row.family),
      pass: row.pass === true,
      failed: strings(row.failed),
      tools: strings(row.tools),
      callId: text(row.call_id),
    };
  });
  return {
    passed: passed ?? cases.filter((item) => item.pass).length,
    total: total ?? cases.length,
    simulationId: text(result.simulation_id),
    iterationId: text(result.iteration_id),
    cases,
    summaryOnly: !cases.length,
  };
}

function traceView(entries: unknown[]): TraceEntryView[] {
  const out: TraceEntryView[] = [];
  for (const item of entries) {
    const entry = record(item);
    const data = entry.data;
    const model = entry.kind === 'model-event' ? record(data) : {};
    const streamKind = model.kind === 'draft' || model.kind === 'summary' ? model.kind : undefined;
    if (streamKind && typeof model.text === 'string') {
      const last = out.at(-1);
      if (last?.streamKind === streamKind) {
        last.summary += model.text;
        last.fragments = (last.fragments ?? 1) + 1;
        last.endedElapsedMs = whole(entry.elapsedMs);
      } else {
        out.push({
          at: text(entry.at),
          elapsedMs: whole(entry.elapsedMs),
          endedElapsedMs: whole(entry.elapsedMs),
          kind: 'model-event',
          streamKind,
          fragments: 1,
          summary: `${streamKind}: ${model.text}`,
        });
      }
      continue;
    }
    let summary = '';
    if (typeof data === 'string') {
      summary = data;
    } else if (entry.kind === 'progress') {
      summary = text(record(data).message) ?? '';
    } else if (entry.kind === 'model-event') {
      summary = [model.kind, text(model.text), text(model.reason), compact(model.usage)]
        .filter(Boolean)
        .join(': ');
    } else if (entry.kind === 'error') {
      summary = text(record(data).message) ?? '';
    } else if (entry.kind === 'start' || entry.kind === 'end') {
      summary = '';
    } else {
      summary = compact(data) ?? '';
    }
    out.push({
      at: text(entry.at),
      elapsedMs: whole(entry.elapsedMs),
      kind: String(entry.kind ?? 'unknown'),
      summary: summary.length > 4000 ? `${summary.slice(0, 4000)}…` : summary,
    });
  }
  return out;
}

function stageView(raw: unknown): StageView[] {
  return list(raw).map((item) => {
    const stage = record(item);
    const startedAt = text(stage.startedAt);
    const endedAt = text(stage.endedAt);
    const start = startedAt ? Date.parse(startedAt) : Number.NaN;
    const end = endedAt ? Date.parse(endedAt) : Number.NaN;
    return {
      name: String(stage.name ?? 'unknown'),
      status: String(stage.status ?? 'unknown'),
      startedAt,
      endedAt,
      ms: Number.isFinite(start) && Number.isFinite(end) ? end - start : null,
    };
  });
}

function candidateView(raw: unknown): CandidateView | null {
  if (!object(raw)) {
    return null;
  }
  return {
    systemPrompt: text(raw.systemPrompt),
    toolNames: strings(raw.toolNames),
    completionConditions: strings(raw.completionConditions),
    uncertainties: strings(raw.uncertainties),
  };
}

// The upload action reads this record after a refresh, so a registration stays
// visible without asking the platform again.
function uploadView(raw: unknown): UploadView | null {
  if (!object(raw) || !text(raw.slot)) {
    return null;
  }
  const status = text(raw.status);
  return {
    status:
      status === 'registered' || status === 'uncertain' || status === 'failed' ? status : 'failed',
    stage: String(raw.stage ?? 'unknown'),
    slot: String(raw.slot),
    workspaceId: text(raw.workspaceId),
    workflowId: text(raw.workflowId),
    agentId: text(raw.agentId),
    version: whole(raw.version),
    workflowHash: text(raw.workflowHash),
    exportedPath: text(raw.exportedPath),
    startedAt: String(raw.startedAt ?? ''),
    endedAt: text(raw.endedAt),
    elapsedMs: whole(raw.elapsedMs),
    reused: raw.reused === true,
    error: text(raw.error),
  };
}

function evaluationView(raw: unknown, fallback: Partial<EvaluationView>): EvaluationView {
  const value = record(raw);
  const source = text(value.source);
  return {
    score: whole(value.score),
    passed: whole(value.passed) ?? fallback.passed ?? null,
    total: whole(value.total) ?? fallback.total ?? null,
    source: source ?? fallback.source ?? 'not-evaluated',
    details: text(value.details) ?? fallback.details ?? null,
  };
}

function summarize(
  id: string,
  kind: RunKind,
  raw: unknown,
  files: RunFile[],
): { summary: RunSummary; parsed: Record<string, unknown> } {
  const run = record(raw);
  const task = record(run.task);
  const config = record(run.config);
  const build = record(run.build);
  const evaluation =
    kind === 'local-build'
      ? evaluationView(run.evaluation, {
          source: 'not-evaluated',
          details: 'Local structural validation only; no official benchmark has run.',
        })
      : evaluationView(run.evaluation, { source: 'not-evaluated' });
  const workflowRaw = run.workflow;
  const nodeCount = object(workflowRaw)
    ? Object.keys(record(record(workflowRaw).nodes)).length || null
    : null;
  const errorValue = run.error;
  const error =
    typeof errorValue === 'string'
      ? errorValue
      : object(errorValue)
        ? text(record(errorValue).message)
        : text(build.error);
  const title =
    text(config.slot) ?? text(task.id) ?? text(record(run.runId)) ?? text(run.runId) ?? id;
  const summary: RunSummary = {
    id,
    kind,
    title,
    status: String(run.status ?? build.status ?? 'unknown'),
    startedAt: text(run.startedAt) ?? text(run.createdAt),
    elapsedMs: whole(run.elapsedMs),
    model: text(config.model) ?? text(run.model),
    provider: text(run.provider),
    slot: text(config.slot),
    taskId: text(task.id),
    synthetic: task.synthetic === true,
    evaluation,
    error,
    counts: {
      nodes: nodeCount,
      tools: Array.isArray(task.tools) ? task.tools.length : null,
      stages: Array.isArray(run.stages) ? run.stages.length : null,
      calls: Array.isArray(run.calls) ? run.calls.length : null,
    },
    files,
  };
  return { summary, parsed: run };
}

async function discoverDir(directory: string, id: string, kind: RunKind, names: string[]) {
  const runFile = join(directory, 'run.json');
  const files = await fileSizes(directory, names);
  try {
    await stat(runFile);
  } catch {
    return null;
  }
  return {
    id,
    kind,
    runPath: directory,
    runFile,
    filePaths: Object.fromEntries(files.map((file) => [file.name, join(directory, file.name)])),
    files,
  } satisfies DiscoveredRun;
}

// Walks the output directory. Live runs are directories holding run.json,
// generation traces live one level deeper, and the internal build baseline
// writes a single JSON file per run.
export async function discoverRuns(root: string): Promise<DiscoveredRun[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: DiscoveredRun[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === GENERATION_DIR) {
        let nested;
        try {
          nested = await readdir(path, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const child of nested) {
          if (!child.isDirectory() || child.name.startsWith('.')) {
            continue;
          }
          const run = await discoverDir(
            join(path, child.name),
            `${GENERATION_DIR}${ID_SEPARATOR}${child.name}`,
            'generation-only',
            GENERATION_FILES,
          );
          if (run) {
            found.push(run);
          }
        }
        continue;
      }
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const run = await discoverDir(path, entry.name, 'freya-live-run', [
        'run.json',
        'compiled.workflow.json',
        'exported.workflow.json',
        'practice.json',
        'platform.jsonl',
      ]);
      if (run) {
        found.push(run);
      }
      continue;
    }
    if (!entry.name.endsWith('.json') || entry.name === 'package.json') {
      continue;
    }
    const name = entry.name;
    found.push({
      id: name.replace(/\.json$/, ''),
      kind: 'local-build',
      runPath: root,
      runFile: path,
      filePaths: { [name]: path },
      files: [{ name, bytes: (await stat(path)).size }],
    });
  }
  return found;
}

export async function listRuns(root: string): Promise<RunSummary[]> {
  const runs = await discoverRuns(root);
  const summaries = await Promise.all(
    runs.map(
      async (run) =>
        (await summarize(run.id, run.kind, await readJson(run.runFile), run.files)).summary,
    ),
  );
  return summaries.sort(
    (a, b) => (Date.parse(b.startedAt ?? '') || 0) - (Date.parse(a.startedAt ?? '') || 0),
  );
}

// Resolves the workflow once and returns both the normalized graph and the exact
// JSON as recorded, so the inspector can show the submitted document and not only
// its own reading of it. Runs predating the standalone artifact still resolve
// through the value embedded in the run record.
async function loadWorkflow(run: DiscoveredRun, parsed: Record<string, unknown>) {
  const raw = await readJson(join(run.runPath, 'compiled.workflow.json'));
  if (object(raw)) {
    return {
      view: { ...walk(raw), source: 'compiled' as const },
      json: JSON.stringify(raw, null, 2),
    };
  }
  const exported = await readJson(join(run.runPath, 'exported.workflow.json'));
  if (object(exported)) {
    return {
      view: { ...walk(exported), source: 'exported' as const },
      json: JSON.stringify(exported, null, 2),
    };
  }
  if (object(parsed.workflow)) {
    return { view: walk(parsed.workflow), json: JSON.stringify(parsed.workflow, null, 2) };
  }
  return { view: null, json: null };
}

export async function loadRun(root: string, id: string): Promise<RunDetail | null> {
  const runs = await discoverRuns(root);
  const run = runs.find((item) => item.id === id);
  if (!run) {
    return null;
  }
  const { summary, parsed } = await summarize(
    run.id,
    run.kind,
    await readJson(run.runFile),
    run.files,
  );
  const workflow = await loadWorkflow(run, parsed);
  const practiceFile = await readJson(join(run.runPath, 'practice.json'));
  const calls = list(parsed.calls).map((item) => {
    const call = record(item);
    return {
      endpoint: String(call.endpoint ?? 'unknown'),
      elapsedMs: whole(call.elapsedMs),
      error: text(call.error),
      hasRequest: call.request !== undefined,
      hasResponse: call.response !== undefined,
    };
  });
  const rawCandidate = parsed.rawCandidate;
  const sourceRecord = record(parsed.source);
  const configRecord = object(parsed.config) ? parsed.config : null;
  const uploadFile = await readJson(join(run.runPath, 'upload.json'));
  return {
    summary,
    stages: stageView(parsed.stages),
    workflow: workflow.view,
    workflowJson: workflow.json,
    practice: practiceView(object(practiceFile) ? practiceFile : parsed.practice),
    calls,
    trace: traceView(await readJsonLines(join(run.runPath, 'trace.jsonl'))),
    candidate: candidateView(pickCandidate(parsed)),
    workflowCandidate: uncertainties(rawCandidate),
    upload: uploadView(object(uploadFile) ? uploadFile : parsed.upload),
    issues: strings(record(parsed.build).issues),
    source: object(parsed.source)
      ? {
          hash: text(sourceRecord.hash),
          commit: text(record(sourceRecord.git).commit),
          dirty: record(sourceRecord.git).dirty === true,
          files: Object.keys(record(sourceRecord.files)),
        }
      : null,
    config: configRecord ? shortenConfig(configRecord) : null,
    inputHash: text(parsed.inputHash),
  };
}

// Config records absolute local paths, which vary per machine and dominate the
// panel. Show them relative to the project root where possible.
function shortenConfig(config: Record<string, unknown>): Record<string, unknown> {
  const root = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`;
  const shorten = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.startsWith(root) ? value.slice(root.length) : value;
    }
    if (Array.isArray(value)) {
      return value.map(shorten);
    }
    return value;
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = shorten(value);
  }
  return out;
}

// The live path records the parsed candidate at the top level; the internal
// build baseline nests it under build.candidate.
function pickCandidate(parsed: Record<string, unknown>): unknown {
  return object(parsed.candidate) ? parsed.candidate : record(parsed.build).candidate;
}

// The Freya path stores the model's JSON-encoded blueprint string rather than a
// parsed candidate; surface the model's own uncertainty list when present.
function uncertainties(raw: unknown): { uncertainties: string[] } | null {
  if (typeof raw === 'string') {
    try {
      return uncertainties(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  const value = record(raw);
  const list = strings(value.uncertainties);
  return list.length ? { uncertainties: list } : null;
}

export async function readRunFile(root: string, id: string, name: string): Promise<string | null> {
  const artifact = await readRunArtifact(root, id, name);
  return artifact ? artifact.content : null;
}

// Resolves a run and one of its artifacts in a single scan. Only files
// discovered for this run are readable; the path comes from the scan, so a
// requested name never reaches the filesystem unchecked.
export async function readRunArtifact(
  root: string,
  id: string,
  name: string,
): Promise<{ run: DiscoveredRun; path: string; content: string } | null> {
  const runs = await discoverRuns(root);
  const run = runs.find((item) => item.id === id);
  const path = run?.filePaths[name];
  if (!path) {
    return null;
  }
  try {
    return { run, path, content: await readFile(path, 'utf8') };
  } catch {
    return null;
  }
}
