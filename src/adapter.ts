import type { AgentArtifact, Candidate, PlatformAdapter, Task } from './contracts.ts';

export class LocalAdapter implements PlatformAdapter {
  async create(task: Task, candidate: Candidate, signal: AbortSignal): Promise<AgentArtifact> {
    signal.throwIfAborted();
    // Preserve ALL tools: a model's toolNames declaration must not silently remove capabilities.
    return {
      kind: 'local-agent-spec',
      taskId: task.id,
      systemPrompt: candidate.systemPrompt,
      tools: structuredClone(task.tools),
    };
  }
}
