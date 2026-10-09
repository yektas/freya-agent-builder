import type {
  Auditor,
  AuditFinding,
  Candidate,
  Feedback,
  Generator,
  Strategy,
  Task,
} from './contracts.ts';
import { candidateSchema, object } from './validation.ts';
import { GENERATE, PLAN, AUDIT_QUESTIONS } from './prompts.ts';

export type CallRecord = {
  endpoint: string;
  request: unknown;
  response?: unknown;
  error?: string;
  elapsedMs: number;
};

export class OpenAIClient {
  calls: CallRecord[] = [];
  apiKey: string;
  maxCalls: number;
  transport: typeof fetch;
  constructor(apiKey: string, maxCalls = 6, transport: typeof fetch = fetch) {
    if (!apiKey.trim()) {
      throw new Error('OPENAI_API_KEY is required for live calls.');
    }
    if (!Number.isInteger(maxCalls) || maxCalls < 1) {
      throw new Error('maxCalls must be a positive integer.');
    }
    this.apiKey = apiKey;
    this.maxCalls = maxCalls;
    this.transport = transport;
  }
  async post(
    endpoint: 'responses' | 'decisions',
    request: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (this.calls.length >= this.maxCalls) {
      throw new Error('Model call budget exhausted.');
    }
    const started = performance.now();
    const call: CallRecord = { endpoint, request, elapsedMs: 0 };
    this.calls.push(call);
    try {
      const response = await this.transport(`https://api.openai.com/v1/${endpoint}`, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      // Do not echo server error bodies: they can contain request data or credentials.
      if (!response.ok) {
        throw new Error(`OpenAI ${endpoint} HTTP ${response.status}`);
      }
      const result: unknown = await response.json();
      call.response = result;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown transport failure';
      call.error = message.replaceAll(this.apiKey, '[REDACTED]');
      throw new Error(call.error);
    } finally {
      call.elapsedMs = Math.round(performance.now() - started);
    }
  }
}

export function responseJSON(response: unknown): unknown {
  if (!object(response) || response.status !== 'completed' || !Array.isArray(response.output)) {
    throw new Error('Response did not complete; no candidate accepted.');
  }
  const parts: string[] = [];
  for (const item of response.output) {
    if (!object(item) || item.type !== 'message' || !Array.isArray(item.content)) {
      continue;
    }
    for (const part of item.content) {
      if (!object(part)) {
        continue;
      }
      if (part.type === 'refusal') {
        throw new Error('Model refused generation.');
      }
      if (part.type === 'output_text' && typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
  }
  if (!parts.length) {
    throw new Error('Response contained no output text.');
  }
  try {
    return JSON.parse(parts.join(''));
  } catch {
    throw new Error('Response text was not valid JSON.');
  }
}

export class OpenAIGenerator implements Generator {
  client: OpenAIClient;
  model: string;
  constructor(client: OpenAIClient, model: string) {
    if (!model.trim()) {
      throw new Error('BUILDER_MODEL must be explicitly configured.');
    }
    this.client = client;
    this.model = model;
  }
  async generate(
    task: Task,
    strategy: Strategy,
    signal: AbortSignal,
    feedback?: Feedback,
  ): Promise<unknown> {
    let plan: unknown;
    if (strategy === 'planned' && !feedback) {
      const fields = ['requirements', 'prerequisites', 'uncertainties'];
      plan = await this.request(
        PLAN,
        { task },
        {
          type: 'object',
          additionalProperties: false,
          required: fields,
          properties: Object.fromEntries(
            fields.map((field) => [field, { type: 'array', items: { type: 'string' } }]),
          ),
        },
        signal,
      );
    }
    return this.request(
      GENERATE,
      {
        task,
        plan,
        feedback,
        repairInstruction: feedback
          ? 'Investigate the supplied issues against the original source. Correct justified issues; preserve correct behavior. Return a complete replacement candidate.'
          : undefined,
      },
      candidateSchema,
      signal,
    );
  }
  private async request(
    instructions: string,
    input: unknown,
    schema: unknown,
    signal: AbortSignal,
  ) {
    return responseJSON(
      await this.client.post(
        'responses',
        {
          model: this.model,
          store: false,
          instructions,
          input: JSON.stringify(input),
          max_output_tokens: 6000,
          text: { format: { type: 'json_schema', name: 'builder_output', strict: true, schema } },
        },
        signal,
      ),
    );
  }
}

export class DecisionsAuditor implements Auditor {
  client: OpenAIClient;
  model: string;
  constructor(client: OpenAIClient, model = 'gpt-6-luna') {
    this.client = client;
    this.model = model;
  }
  async audit(task: Task, candidate: Candidate, signal: AbortSignal): Promise<AuditFinding[]> {
    const result = await this.client.post(
      'decisions',
      {
        model: this.model,
        input: JSON.stringify({ task, candidate }),
        questions: AUDIT_QUESTIONS.map((question) => ({ type: 'predicate', ...question })),
      },
      signal,
    );
    if (
      !object(result) ||
      !Array.isArray(result.answers) ||
      result.answers.length !== AUDIT_QUESTIONS.length
    ) {
      throw new Error('Incomplete Decisions audit response.');
    }
    const answers = result.answers;
    return AUDIT_QUESTIONS.map((question) => {
      const matches = answers.filter((answer) => object(answer) && answer.name === question.name);
      const answer = matches[0];
      if (
        matches.length !== 1 ||
        !object(answer) ||
        answer.type !== 'predicate' ||
        typeof answer.probability !== 'number' ||
        !Number.isFinite(answer.probability) ||
        answer.probability < 0 ||
        answer.probability > 1
      ) {
        throw new Error(`Invalid audit answer: ${question.name}`);
      }
      return {
        name: question.name,
        probability: answer.probability,
        question: question.instructions,
      };
    });
  }
}

// Plumbing fixture only. This does not demonstrate task-solving performance.
export class MockGenerator implements Generator {
  async generate(task: Task): Promise<Candidate> {
    return {
      systemPrompt: `OFFLINE MOCK — not benchmark tested.\nTask: ${task.description}\nUse only the supplied tools according to their original descriptions and schemas. Report completion only with supporting evidence.`,
      toolNames: task.tools.map((tool) => tool.name),
      completionConditions: [
        'The task objective is satisfied with evidence from the conversation or tool results.',
      ],
      uncertainties: ['Mock generation does not analyze task-specific dependencies.'],
    };
  }
}
