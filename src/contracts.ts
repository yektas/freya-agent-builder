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
export interface Generator {
  generate(task: Task, signal: AbortSignal): Promise<unknown>;
}
export type AgentArtifact = {
  kind: 'local-agent-spec';
  taskId: string;
  systemPrompt: string;
  tools: Tool[];
};
export interface PlatformAdapter {
  // Pure local compilation only. Never register agents or execute tools here.
  // Publish the selected artifact separately.
  create(task: Task, candidate: Candidate, signal: AbortSignal): Promise<unknown>;
}
export type BuildOptions = { timeoutMs: number };
export type BuildResult = {
  status: 'built' | 'failed';
  candidate: Candidate | null;
  artifact: unknown;
  rawCandidate: unknown;
  issues: string[];
  error?: string;
};
