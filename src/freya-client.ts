import { object } from './validation.ts';

// Workspace/default responses may include provider credentials. Read-only probes show a safe view.
export function redactConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactConfig);
  }
  if (!object(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      /api.?key|token|secret|password|authorization|cookie/i.test(key)
        ? '[REDACTED]'
        : redactConfig(child),
    ]),
  );
}

// Public platform API, not a verified hackathon submission contract.
// Sources and inconsistencies: docs/freya-api-research.md.
export class FreyaClient {
  private token: string;
  private transport: typeof fetch;
  constructor(token: string, transport: typeof fetch = fetch) {
    if (!token.trim()) {
      throw new Error('FREYA_API_KEY is required.');
    }
    this.token = token;
    this.transport = transport;
  }

  private async request(
    path: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    const response = await this.transport(`https://app.freyavoice.ai/api/v2/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`Freya HTTP ${response.status}; request was not automatically retried.`);
    }
    const result: unknown = await response.json();
    if (
      !object(result) ||
      result.success !== true ||
      !object(result.data) ||
      !object(result.data.result)
    ) {
      throw new Error('Unexpected Freya response envelope. Verify current platform contract.');
    }
    return result.data.result;
  }

  async listWorkspaces(signal: AbortSignal) {
    return this.request('workspaces', signal);
  }

  async getDefaults(
    workspaceId: string,
    signal: AbortSignal,
    language?: string,
  ): Promise<Record<string, unknown>> {
    if (!workspaceId.trim()) {
      throw new Error('workspaceId is required.');
    }
    const query = new URLSearchParams({ workspaceId });
    if (language) {
      if (language.length > 10) {
        throw new Error('language must be at most 10 characters.');
      }
      query.set('language', language);
    }
    const result = await this.request(`agents/defaults?${query}`, signal);
    if (!object(result.config)) {
      throw new Error('Freya defaults did not contain config.');
    }
    return result.config;
  }

  // Explicit library operation only: callers must supply a verified full config, including tool bindings.
  // workspaceId appears in the official example, but is omitted from its Body field list.
  async createAgent(
    input: { workspaceId: string; name: string; config: Record<string, unknown> },
    signal: AbortSignal,
  ) {
    if (!input.workspaceId.trim() || !input.name.trim() || input.name.length > 100) {
      throw new Error('Agent requires workspaceId and a name of 1–100 characters.');
    }
    const result = await this.request('agents', signal, input);
    if (!object(result.agent) || typeof result.agent.id !== 'string') {
      throw new Error(
        'Freya create response missing agent.id. Do not blindly retry: agent creation may have succeeded.',
      );
    }
    return result.agent;
  }

  async chat(
    input: {
      message: string;
      agentId?: string;
      workflowId?: string;
      callId?: string;
      versionId?: string;
    },
    signal: AbortSignal,
  ) {
    if (!input.message.trim() || input.message.length > 10000) {
      throw new Error('Chat message must be 1–10,000 characters.');
    }
    if (!input.callId && !input.agentId && !input.workflowId) {
      throw new Error('A new chat requires agentId or workflowId.');
    }
    return this.request('chat/message', signal, input);
  }
}
