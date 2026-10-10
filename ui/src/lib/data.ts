// Shared display helpers. The API shapes mirror src/ui/records.ts exactly.
export type Evaluation = {
  score: number | null;
  passed: number | null;
  total: number | null;
  source: string;
  details: string | null;
};

export type RunFile = { name: string; bytes: number };

/**
 * The artifact a reviewer most often wants: the compiled workflow JSON. Runs that
 * predate the standalone artifact still carry it inside run.json.
 */
export function defaultFile(files: RunFile[]): string | null {
  const byName = (name: string) => files.find((file) => file.name === name);
  return (
    byName('compiled.workflow.json')?.name ??
    byName('exported.workflow.json')?.name ??
    files[0]?.name ??
    null
  );
}

export type RunSummary = {
  id: string;
  kind: 'freya-live-run' | 'generation-only' | 'local-build';
  title: string;
  status: string;
  startedAt: string | null;
  elapsedMs: number | null;
  model: string | null;
  provider: string | null;
  slot: string | null;
  taskId: string | null;
  synthetic: boolean;
  evaluation: Evaluation;
  error: string | null;
  counts: {
    nodes: number | null;
    tools: number | null;
    stages: number | null;
    calls: number | null;
  };
  files: RunFile[];
};

export type Transition = {
  target: string;
  description: string | null;
  condition: string | null;
  implicit: boolean;
};

export type GraphNode = {
  key: string;
  type: string;
  taskMessage: string | null;
  tools: string[];
  preActions: string[];
  transitions: Transition[];
  terminal: string | null;
  global: boolean;
  reachable: boolean;
  deadEnd: boolean;
};

export type Workflow = {
  source: 'compiled' | 'exported' | 'recorded';
  initialNode: string | null;
  systemPrompt: string | null;
  contextVariables: string[];
  lifecycleTools: string[];
  nodes: GraphNode[];
  globalNodes: GraphNode[];
  unreachable: string[];
  danglingTargets: string[];
};

export type PracticeCase = {
  id: string;
  level: string | null;
  family: string | null;
  pass: boolean;
  failed: string[];
  tools: string[];
  callId: string | null;
};

export type Practice = {
  passed: number;
  total: number;
  simulationId: string | null;
  iterationId: string | null;
  cases: PracticeCase[];
  summaryOnly: boolean;
};

export type Stage = {
  name: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  ms: number | null;
};

export type TraceEntry = {
  at: string | null;
  elapsedMs: number | null;
  kind: string;
  summary: string;
  streamKind?: 'draft' | 'summary';
  fragments?: number;
  endedElapsedMs?: number | null;
};

export type Call = {
  endpoint: string;
  elapsedMs: number | null;
  error: string | null;
  hasRequest: boolean;
  hasResponse: boolean;
};

export type Candidate = {
  systemPrompt: string | null;
  toolNames: string[];
  completionConditions: string[];
  uncertainties: string[];
};

/** A recorded upload to Freya; the action is upload only, never practice. */
export type Upload = {
  status: 'registered' | 'failed' | 'uncertain';
  /** Step the operation reached, so a failure names what stopped. */
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
  /** True when a repeated click returned the recorded registration. */
  reused: boolean;
  error: string | null;
};

export type RunDetail = {
  summary: RunSummary;
  stages: Stage[];
  workflow: Workflow | null;
  /** The workflow document exactly as recorded, for copying into a submission. */
  workflowJson: string | null;
  practice: Practice | null;
  calls: Call[];
  trace: TraceEntry[];
  candidate: Candidate | null;
  workflowCandidate: { uncertainties: string[] } | null;
  upload: Upload | null;
  issues: string[];
  source: { hash: string | null; commit: string | null; dirty: boolean; files: string[] } | null;
  config: Record<string, unknown> | null;
  inputHash: string | null;
};

const KIND: Record<string, string> = {
  'freya-live-run': 'freya',
  'generation-only': 'generate',
  'local-build': 'build',
};

export const kindLabel = (kind: string) => KIND[kind] ?? kind;
export const isRunning = (run: { status: string }) => run.status === 'running';

export function when(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function ago(iso: string | null) {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (isNaN(s)) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function ms(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  if (value < 1000) return `${value} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.floor(value / 60000)}m ${Math.round((value % 60000) / 1000)}s`;
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export type Tone = 'good' | 'warn' | 'bad' | 'none';

/** Score tone drives every colour decision so the palette stays consistent. */
export function scoreTone(score: number | null | undefined): Tone {
  if (score === null || score === undefined) return 'none';
  return score === 1 ? 'good' : score > 0 ? 'warn' : 'bad';
}

export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-destructive',
  none: 'text-muted-foreground',
};

export const TONE_BG: Record<Tone, string> = {
  good: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  none: 'bg-muted',
};
