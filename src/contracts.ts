// Internal contracts. These are NOT the organizer's or Freya's API schemas.
export type JsonObject = Record<string, unknown>;
export type Tool = {
  name: string;
  description: string;
  parameters: JsonObject;
  [key: string]: unknown;
};
export type Task = { id: string; description: string; tools: Tool[]; [key: string]: unknown };
export type Candidate = {
  systemPrompt: string;
  toolNames: string[];
  completionConditions: string[];
  uncertainties: string[];
};
export type Strategy = 'direct' | 'planned';
export type Feedback = { previous: unknown; issues: string[] };
export interface Generator {
  generate(
    task: Task,
    strategy: Strategy,
    signal: AbortSignal,
    feedback?: Feedback,
  ): Promise<unknown>;
}
export type AuditFinding = { name: string; probability: number; question: string };
export interface Auditor {
  audit(task: Task, candidate: Candidate, signal: AbortSignal): Promise<AuditFinding[]>;
}
export type AgentArtifact = {
  kind: 'local-agent-spec';
  taskId: string;
  systemPrompt: string;
  tools: Tool[];
};
export interface PlatformAdapter {
  // Pure local compilation only. Never register agents or execute tools in this method:
  // the builder may call it for multiple candidates. Publish the selected artifact separately.
  create(task: Task, candidate: Candidate, signal: AbortSignal): Promise<unknown>;
}
export type Evaluation = { score: number | null; source: string; details: unknown };
export interface Evaluator {
  evaluate(task: Task, artifact: unknown, signal: AbortSignal): Promise<Evaluation>;
}
export type BuildOptions = {
  strategy: Strategy;
  timeoutMs: number;
  maxRepairs: number;
  auditMode: 'off' | 'report' | 'repair';
  auditThreshold: number;
};
export type Attempt = {
  candidate: unknown;
  issues: string[];
  audit: AuditFinding[] | null;
  auditError?: string;
};
export type BuildResult = {
  status: 'built' | 'fallback' | 'failed';
  candidate: Candidate | null;
  artifact: unknown;
  attempts: Attempt[];
  warnings: string[];
  error?: string;
};
