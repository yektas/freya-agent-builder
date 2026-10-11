import type { PracticeJob } from './practice.ts';
import { practiceActive } from './activity.ts';
// Discovery and normalization of run records for the inspector UI. Three
// writers produce records under the output directory; each is mapped to one
// summary and one detail shape so the UI never branches on which command ran.
// Mutations are the authorized archive and restore actions, which move a run in
// and out of the archive folder rather than destroying anything; reading
// otherwise stays read-only.
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { object } from '../validation.ts';
import { hash, projectRoot } from '../experiments.ts';
import { estimateCost, hasUsage, normalizeUsage } from '../usage.ts';

export type RunKind = 'freya-live-run' | 'generation-only' | 'local-build';

export type RunFile = { name: string; bytes: number };

export type EvaluationView = {
  score: number | null;
  passed: number | null;
  total: number | null;
  source: string;
  details: string | null;
  conversationPassed?: number | null;
  conversationTotal?: number | null;
};

// Token counts plus the recorded cost estimate. `usd` is null when there was no
// model call or the model has no price in this snapshot.
export type UsageView = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  calls: number;
  usd: number | null;
  costSource: string;
};

export type TokenUsageView = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type RunSummary = {
  id: string;
  kind: RunKind;
  /** Stable inspector label such as v1; only generation runs receive one. */
  name: string | null;
  /** Human-readable source brief heading, when the recorded task includes it. */
  briefName: string | null;
  title: string;
  status: string;
  startedAt: string | null;
  elapsedMs: number | null;
  model: string | null;
  provider: string | null;
  slot: string | null;
  taskId: string | null;
  synthetic: boolean;
  archived: boolean;
  practiceStatus?: 'running' | 'completed' | 'failed' | null;
  evaluation: EvaluationView;
  usage: UsageView | null;
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
  conversationPassed: number | null;
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
  usage: TokenUsageView | null;
  usd: number | null;
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
  workflowName: string | null;
  slot: string;
  workspaceId: string | null;
  workflowId: string | null;
  agentId: string | null;
  workflowUrl: string | null;
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
  practiceJob: PracticeJob | null;
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
const SKIP_DIRS = new Set(['freya-state', 'freya-probe', 'generation', 'archive']);
const GENERATION_DIR = 'generation';
// Runs the inspector archived live here rather than being deleted; the restore
// action moves them back.
const ARCHIVE_DIR = 'archive';
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
  'model-draft.txt',
  'model-summary.txt',
  'platform.jsonl',
  'exported.workflow.json',
  'upload.json',
  'practice.json',
  'practice-job.json',
  'practice-history.json',
];

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function briefName(task: Record<string, unknown>, config: Record<string, unknown>): string | null {
  const recorded = list(task.briefs);
  const headings = recorded
    .map((value) => {
      const brief = record(value);
      const heading = text(brief.text)
        ?.split(/\r?\n/)
        .find((line) => /^#\s+/.test(line))
        ?.replace(/^#\s+/, '')
        .trim();
      if (heading) {
        return heading;
      }
      const path = text(brief.path);
      return path ? briefLabel(path) : null;
    })
    .filter((value): value is string => !!value);
  if (headings.length) {
    return headings.join(' + ');
  }

  const paths = list(config.briefs).filter((value): value is string => typeof value === 'string');
  const labels = paths.map(briefLabel).filter((value): value is string => !!value);
  return labels.length ? labels.join(' + ') : null;
}

function briefLabel(path: string): string | null {
  const filename = path.split(/[\\/]/).at(-1)?.replace(/\.md$/i, '');
  if (!filename) {
    return null;
  }
  const match = /^brief-([a-z0-9]+)$/i.exec(filename);
  return match ? `Brief ${match[1].toUpperCase()}` : filename;
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

/**
 * True when no case received a reply after the customer spoke. `slowest_turn_s` stays 0
 * only when no agent message ever followed a customer turn, so a run that is entirely
 * zeroes measured a silent agent model rather than a weak agent. Such a run is recorded
 * as unmeasured so it is never read as a 0/N builder score.
 */
export function silentPracticeRun(raw: unknown): boolean {
  const rows = list(record(raw).rows).map(record);
  const measured = rows.filter(
    (row) => row.slowest_turn_s === 0 && row.ended === 'customer-ended-call',
  );
  return measured.length >= 2 && measured.length === rows.length;
}

function practiceView(raw: unknown): PracticeView | null {
  const result = record(raw);
  const rows = list(result.rows);
  const passed = whole(result.passed);
  const total = whole(result.total);
  if (passed === null && total === null && !rows.length) {
    return null;
  }
  const finalRows = list(result.final);
  const repetitions = whole(result.runs) ?? 1;
  const attempts = list(result.all_rows);
  const cases: PracticeCaseView[] = rows.map((item) => {
    const row = record(item);
    const final = finalRows.map(record).find((entry) => entry.id === row.id);
    const attempts = list(result.all_rows)
      .flatMap((items) => list(items).map(record))
      .filter((entry) => entry.id === row.id);
    return {
      id: String(row.id ?? 'unknown'),
      level: text(row.level),
      family: text(row.family),
      pass: final ? final.pass === true : row.pass === true,
      failed: [
        ...new Set(
          attempts.length
            ? attempts.flatMap((entry) => strings(entry.failed))
            : strings(row.failed),
        ),
      ],
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
    // The kit adds a conversation failure for every non-pass judge verdict.
    // Only infer its separate count from complete kit rows, never summary-only data.
    conversationPassed:
      cases.length === total &&
      text(result.simulation_id) &&
      text(result.iteration_id) &&
      rows.every(
        (item) =>
          object(item) &&
          typeof item.pass === 'boolean' &&
          Array.isArray(item.failed) &&
          typeof item.call_id === 'string',
      ) &&
      (repetitions === 1 ||
        (attempts.length === repetitions &&
          attempts.every((items) => Array.isArray(items) && items.length === cases.length)))
        ? cases.filter((item) => !item.failed.some((reason) => reason.startsWith('conversation:')))
            .length
        : null,
  };
}

function traceView(entries: unknown[]): TraceEntryView[] {
  const out: TraceEntryView[] = [];
  const streams = new Map<string, TraceEntryView>();
  const hasProgress = entries.some((item) => record(item).kind === 'progress');
  let lastHeartbeat = 0;
  for (const item of entries) {
    const entry = record(item);
    const data = entry.data;
    const model = entry.kind === 'model-event' ? record(data) : {};
    const streamKind = model.kind === 'draft' || model.kind === 'summary' ? model.kind : undefined;
    if (streamKind && typeof model.text === 'string') {
      const last = streams.get(streamKind);
      if (last) {
        last.fragments = (last.fragments ?? 1) + 1;
        last.elapsedMs = whole(entry.elapsedMs);
        last.endedElapsedMs = whole(entry.elapsedMs);
        // Count legacy fragments without sending their escaped contents to the UI.
        const chars = Number(last.summary.split(' ')[0]) + model.text.length;
        last.summary = `${chars} characters received`;
      } else {
        streams.set(streamKind, {
          at: text(entry.at),
          elapsedMs: whole(entry.elapsedMs),
          endedElapsedMs: whole(entry.elapsedMs),
          kind: 'model-output',
          streamKind,
          fragments: 1,
          summary: `${model.text.length} characters received`,
        });
      }
      continue;
    }
    let summary = '';
    if (typeof data === 'string') {
      summary = data;
    } else if (entry.kind === 'progress') {
      summary = (text(record(data).message) ?? '').replace(/^\[generate \+[^\]]+\]\s*/, '').trim();
      if (summary.startsWith('Node ')) {
        continue;
      }
      if (summary.startsWith('Waiting for model completion')) {
        const elapsed = whole(entry.elapsedMs);
        if (elapsed !== null && elapsed - lastHeartbeat < 30000) {
          continue;
        }
        lastHeartbeat = elapsed ?? lastHeartbeat;
      }
    } else if (entry.kind === 'model-event') {
      if (hasProgress && ['accepted', 'reasoning', 'completed'].includes(String(model.kind))) {
        continue;
      }
      const usage = normalizeUsage(model.usage);
      summary = [
        model.kind,
        text(model.reason),
        hasUsage(usage)
          ? `${usage.inputTokens} input tokens · ${usage.outputTokens} output tokens`
          : null,
      ]
        .filter(Boolean)
        .join(': ');
    } else if (entry.kind === 'model-stream-started' || entry.kind === 'model-stream-ended') {
      const stream = record(data);
      summary = `${stream.kind === 'draft' ? 'Workflow draft' : 'Model summary'}: ${
        entry.kind === 'model-stream-started'
          ? 'receiving output'
          : `${whole(stream.chars) ?? 0} characters received`
      }. Saved in ${text(stream.artifact) ?? 'Files'}.`;
    } else if (String(entry.kind).startsWith('model-call-')) {
      const call = record(data);
      if (entry.kind === 'model-call-started' && out.at(-1)?.kind === entry.kind) {
        continue;
      }
      summary = [
        'Responses API',
        whole(call.elapsedMs) !== null
          ? `${((whole(call.elapsedMs) ?? 0) / 1000).toFixed(1)}s`
          : '',
        text(call.error),
        'Request and response in run.json',
      ]
        .filter(Boolean)
        .join(' · ');
    } else if (entry.kind === 'error') {
      summary = text(record(data).message) ?? '';
    } else if (entry.kind === 'start' || entry.kind === 'end') {
      summary =
        entry.kind === 'start'
          ? 'Generation started'
          : `Generation ${text(record(data).status) ?? 'ended'}`;
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
  return [...out, ...streams.values()].sort((a, b) => (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0));
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
    workflowName: text(raw.workflowName),
    slot: String(raw.slot),
    workspaceId: text(raw.workspaceId),
    workflowId: text(raw.workflowId),
    agentId: text(raw.agentId),
    workflowUrl: text(raw.workflowUrl),
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

function usageView(run: Record<string, unknown>): UsageView | null {
  const recorded = record(run.usage);
  const tokens = normalizeUsage(recorded.tokens);
  if (!hasUsage(tokens)) {
    return null;
  }
  const cost = record(recorded.cost);
  return {
    ...tokens,
    calls: list(run.calls).length,
    usd: whole(cost.usd),
    costSource: text(cost.source) ?? 'unknown',
  };
}

function summarize(
  id: string,
  kind: RunKind,
  raw: unknown,
  files: RunFile[],
  archived = false,
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
  const name = kind === 'generation-only' ? text(config.runName) : null;
  const title =
    name ?? text(config.slot) ?? text(task.id) ?? text(record(run.runId)) ?? text(run.runId) ?? id;
  const model = text(config.model) ?? text(run.model);
  const summary: RunSummary = {
    id,
    kind,
    name,
    briefName: briefName(task, config),
    title,
    status: String(run.status ?? build.status ?? 'unknown'),
    startedAt: text(run.startedAt) ?? text(run.createdAt),
    elapsedMs: whole(run.elapsedMs),
    model,
    provider: text(run.provider),
    slot: text(config.slot),
    taskId: text(task.id),
    synthetic: task.synthetic === true,
    archived,
    evaluation,
    usage: usageView(run),
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

type RunStatus = { run: DiscoveredRun; archived: boolean };

// Walks the output directory. Live runs are directories holding run.json,
// generation traces live one level deeper, the internal build baseline writes a
// single JSON file per run, and archived runs live under the archive folder in
// the same shapes they had when they were discovered.
async function scan(root: string): Promise<RunStatus[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: RunStatus[] = [];
  const push = async (run: DiscoveredRun | null, archived: boolean) => {
    if (run) {
      found.push({ run, archived });
    }
  };
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      // The archive folder holds moved runs. Each archived name is
      // <timestamp>__<originalId>[.json], so the original id (which may itself
      // carry the generation marker) is recovered after the '__'; the kind
      // follows from that id, and the file lists match live discovery so a
      // restored run reads exactly as it did before it was archived.
      if (entry.name === ARCHIVE_DIR) {
        let nested;
        try {
          nested = await readdir(path, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const child of nested) {
          if (child.name.startsWith('.')) {
            continue;
          }
          // The scan id carries the full timestamped name, matching what
          // archiveRun answered, so the id the client holds stays addressable;
          // the original id is recovered after the first '__' (the timestamp
          // has no underscores; the original id may itself contain '~').
          const originalId = child.name
            .replace(/\.json$/, '')
            .split('__')
            .slice(1)
            .join('__');
          const childPath = join(path, child.name);
          const scanId = `archive${ID_SEPARATOR}${child.name.replace(/\.json$/, '')}`;
          if (child.isDirectory()) {
            const generation = originalId.startsWith(`${GENERATION_DIR}${ID_SEPARATOR}`);
            const run = await discoverDir(
              childPath,
              scanId,
              generation ? 'generation-only' : 'freya-live-run',
              generation
                ? GENERATION_FILES
                : [
                    'run.json',
                    'compiled.workflow.json',
                    'exported.workflow.json',
                    'practice.json',
                    'platform.jsonl',
                  ],
            );
            if (run) {
              found.push({ run, archived: true });
            }
            continue;
          }
          if (!child.name.endsWith('.json')) {
            continue;
          }
          const info = await stat(childPath);
          found.push({
            run: {
              id: scanId,
              kind: 'local-build',
              runPath: path,
              runFile: childPath,
              filePaths: { [child.name]: childPath },
              files: [{ name: child.name, bytes: info.size }],
            },
            archived: true,
          });
        }
        continue;
      }
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
          await push(
            await discoverDir(
              join(path, child.name),
              `${GENERATION_DIR}${ID_SEPARATOR}${child.name}`,
              'generation-only',
              GENERATION_FILES,
            ),
            false,
          );
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
      await push(run, false);
      continue;
    }
    if (!entry.name.endsWith('.json') || entry.name === 'package.json') {
      continue;
    }
    const name = entry.name;
    found.push({
      run: {
        id: name.replace(/\.json$/, ''),
        kind: 'local-build',
        runPath: root,
        runFile: path,
        filePaths: { [name]: path },
        files: [{ name, bytes: (await stat(path)).size }],
      },
      archived: false,
    });
  }
  return found;
}

export async function discoverRuns(root: string): Promise<DiscoveredRun[]> {
  return (await scan(root)).map((item) => item.run);
}

// Removes one discovered run. The id must come from the same scan the reads
// use, so a crafted id never reaches the filesystem. A single-file build record
// is unlinked directly, because its parent directory holds unrelated runs; a
// directory run is removed with everything written beside its run.json, which
// is exactly that run's own artifacts.
export async function deleteRun(root: string, id: string): Promise<boolean> {
  const runs = await discoverRuns(root);
  const run = runs.find((item) => item.id === id);
  if (!run) {
    return false;
  }
  if (practiceActive(root, id) || (await practiceBusy(run))) {
    throw new Error('Cannot delete a run while practice is running.');
  }
  if (run.kind === 'local-build') {
    await rm(run.filePaths[run.files[0].name]);
  } else {
    await rm(run.runPath, { recursive: true, force: true });
  }
  return true;
}

// Moves one discovered run into the archive folder instead of destroying it.
// The id must come from the same scan the reads use, so a crafted id never
// reaches the filesystem, and an archived run is refused: restoring, not
// re-archiving, is the way back. A single-file build record is moved alone,
// because its parent directory holds unrelated runs. Answers with the scan id
// the archived run carries afterwards.
export async function archiveRun(root: string, id: string): Promise<string | null> {
  const runs = await discoverRuns(root);
  const run = runs.find((item) => item.id === id);
  if (!run || id.startsWith(`archive${ID_SEPARATOR}`)) {
    return null;
  }
  if (practiceActive(root, id) || (await practiceBusy(run))) {
    throw new Error('Cannot archive a run while practice is running.');
  }
  const destination = join(resolve(root), ARCHIVE_DIR);
  await mkdir(destination, { recursive: true });
  // The timestamp keeps two archives of one id from overwriting each other,
  // and the '__' marker separates the timestamp from the original id on a
  // restore.
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}__${id}`;
  if (run.kind === 'local-build') {
    await rename(run.filePaths[run.files[0].name], join(destination, `${name}.json`));
  } else {
    await rename(run.runPath, join(destination, name));
  }
  return `${ARCHIVE_DIR}${ID_SEPARATOR}${name}`;
}

// Moves one archived run back to where it lived before the archive, under its
// original id. The id is the archived scan id, so only something this scan
// discovered can be restored, and a destination already occupied by a run that
// appeared after the archive is never overwritten.
export async function restoreRun(root: string, id: string): Promise<string | null> {
  const runs = await discoverRuns(root);
  const run = runs.find((item) => item.id === id);
  if (!run || !id.startsWith(`archive${ID_SEPARATOR}`)) {
    return null;
  }
  // The archived name is <timestamp>__<originalId>[.json]; the original id may
  // itself contain the '~' separator (a generation run), so it is reassembled
  // from everything after the first '__'.
  const leaf = (run.kind === 'local-build' ? run.filePaths[run.files[0].name] : run.runPath)
    .split(sep)
    .at(-1)!
    .replace(/\.json$/, '');
  const original = leaf.split('__').slice(1).join('__');
  if (!original || original.includes('/') || original.includes(sep)) {
    return null;
  }
  // A generation run restores under generation/; anything else restores at the
  // top of the records root, where discovery first saw it.
  const generationPrefix = `${GENERATION_DIR}${ID_SEPARATOR}`;
  const destination = original.startsWith(generationPrefix)
    ? join(resolve(root), GENERATION_DIR, original.slice(generationPrefix.length))
    : join(resolve(root), original);
  if (await existsPath(destination)) {
    return null;
  }
  const source = run.kind === 'local-build' ? run.filePaths[run.files[0].name] : run.runPath;
  await rename(source, destination);
  return original;
}

async function existsPath(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function listRuns(root: string): Promise<RunSummary[]> {
  return listRunsDetailed(root).then((all) => all.map((item) => item.summary));
}

async function summarizeStatuses(
  statuses: RunStatus[],
): Promise<{ summary: RunSummary; archived: boolean }[]> {
  const summaries = await Promise.all(
    statuses.map(async (item) => {
      const { summary } = await summarize(
        item.run.id,
        item.run.kind,
        await readJson(item.run.runFile),
        item.run.files,
        item.archived,
      );
      await attachPractice(item.run, summary);
      return { summary, archived: item.archived };
    }),
  );

  // Old generation records predate version labels. Assign them once in
  // chronological order while keeping any labels already saved in run.json.
  const generations = summaries
    .map((item) => item.summary)
    .filter((summary) => summary.kind === 'generation-only');
  const used = new Set<number>();
  for (const summary of generations) {
    const version = /^v([1-9]\d*)$/.exec(summary.name ?? '');
    if (version) {
      used.add(Number(version[1]));
    }
  }
  const legacy = generations
    .filter((summary) => !summary.name)
    .sort(
      (a, b) =>
        (Date.parse(a.startedAt ?? '') || 0) - (Date.parse(b.startedAt ?? '') || 0) ||
        a.id.localeCompare(b.id),
    );
  let candidate = 1;
  for (const summary of legacy) {
    while (used.has(candidate)) {
      candidate++;
    }
    summary.name = `v${candidate}`;
    used.add(candidate++);
  }
  for (const summary of generations) {
    if (summary.name) {
      summary.title = summary.name;
    }
  }

  return summaries.sort(
    (a, b) =>
      (Date.parse(b.summary.startedAt ?? '') || 0) - (Date.parse(a.summary.startedAt ?? '') || 0),
  );
}

// Detail plus archive flag: the archive filter needs to know, and the route
// needs to split the answer.
export async function listRunsDetailed(
  root: string,
): Promise<{ summary: RunSummary; archived: boolean }[]> {
  return summarizeStatuses(await scan(root));
}

async function practiceBusy(run: DiscoveredRun): Promise<boolean> {
  if (!run.filePaths['practice-job.json']) {
    return false;
  }
  return record(await readJson(run.filePaths['practice-job.json'])).status === 'running';
}

// Practice is a separate artifact: generation timing and model usage stay intact.
async function attachPractice(
  run: DiscoveredRun,
  summary: RunSummary,
): Promise<PracticeJob | null> {
  if (!run.filePaths['practice-job.json']) {
    return null;
  }
  const job = record(await readJson(run.filePaths['practice-job.json']));
  if (!['running', 'completed', 'failed'].includes(String(job.status))) {
    return null;
  }
  summary.practiceStatus = job.status as PracticeJob['status'];
  const upload = record(await readJson(run.filePaths['upload.json']));
  const compiled = await readJson(run.filePaths['compiled.workflow.json']);
  const current =
    upload.status === 'registered' &&
    job.workflowHash === upload.workflowHash &&
    job.agentId === upload.agentId &&
    object(compiled) &&
    hash(compiled) === job.workflowHash;
  const result =
    current && job.status === 'completed'
      ? practiceView(await readJson(run.filePaths['practice.json']))
      : null;
  const silent = result && silentPracticeRun(await readJson(run.filePaths['practice.json']));
  summary.evaluation =
    result && result.total > 0 && !silent
      ? {
          score: result.passed / result.total,
          passed: result.passed,
          total: result.total,
          source: 'official-practice',
          conversationPassed: result.conversationPassed,
          conversationTotal: result.conversationPassed === null ? null : result.total,
          details: `Kit score requires bank ledger and conversation checks to pass in every repetition. ${job.brief === 'all' ? 'A+B' : job.brief} practice; ${job.repetitions} repetition(s); ${job.style ?? 'normal'} speech. Public cases, not the hidden final benchmark.`,
        }
      : {
          score: null,
          passed: null,
          total: null,
          source: 'not-evaluated',
          details: silent
            ? 'No case received a reply after the customer spoke, so this run measured the agent model rather than the agent. Not a score; repeat the test when the model responds.'
            : !current
              ? 'Registration changed since testing; test the current upload again.'
              : job.status === 'running'
                ? 'Practice testing is running.'
                : 'The latest practice attempt failed; previous results remain in practice-history.json.',
        };
  return job as unknown as PracticeJob;
}

// The compiled artifact is the workflow submitted to Freya and generation
// deliverable shown by the inspector.
async function loadWorkflow(run: DiscoveredRun) {
  const raw = await readJson(join(run.runPath, 'compiled.workflow.json'));
  if (object(raw)) {
    return {
      view: walk(raw),
      json: JSON.stringify(raw, null, 2),
    };
  }
  return { view: null, json: null };
}

export async function loadRun(root: string, id: string): Promise<RunDetail | null> {
  const statuses = await scan(root);
  const status = statuses.find((item) => item.run.id === id);
  if (!status) {
    return null;
  }
  const run = status.run;
  const summaries = await summarizeStatuses(statuses);
  const summary = summaries.find((item) => item.summary.id === id)!.summary;
  const parsed = record(await readJson(run.runFile));
  const workflow = await loadWorkflow(run);
  const practiceJob = await attachPractice(run, summary);
  const practiceFile =
    practiceJob && summary.evaluation.score === null
      ? null
      : await readJson(join(run.runPath, 'practice.json'));
  const calls = list(parsed.calls).map((item) => {
    const call = record(item);
    const tokens = normalizeUsage(call.usage);
    return {
      endpoint: String(call.endpoint ?? 'unknown'),
      elapsedMs: whole(call.elapsedMs),
      error: text(call.error),
      hasRequest: call.request !== undefined,
      hasResponse: call.response !== undefined,
      usage: tokens
        ? {
            inputTokens: tokens.inputTokens,
            outputTokens: tokens.outputTokens,
            reasoningTokens: tokens.reasoningTokens,
            totalTokens: tokens.totalTokens,
          }
        : null,
      usd: tokens ? estimateCost(tokens, summary.model).usd : null,
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
    practice: practiceView(practiceFile),
    practiceJob,
    calls,
    trace: traceView(await readJsonLines(join(run.runPath, 'trace.jsonl'))),
    candidate: candidateView(pickCandidate(parsed)),
    workflowCandidate: uncertainties(rawCandidate),
    upload: uploadView(uploadFile),
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
