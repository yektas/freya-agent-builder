import type { Candidate, Generator, Task } from './contracts.ts';
import { candidateSchema, object } from './validation.ts';
import { recipe } from './recipe.ts';

export type CallRecord = {
  endpoint: string;
  request: unknown;
  response?: unknown;
  error?: string;
  elapsedMs: number;
};

export type ModelEvent = {
  kind: 'accepted' | 'reasoning' | 'summary' | 'draft' | 'completed' | 'incomplete' | 'failed';
  text?: string;
  usage?: unknown;
  reason?: string;
};
type GenerationDefinition = {
  instructions: string;
  schema: unknown;
  maxOutputTokens: number;
  maxCalls: number;
  onEvent?: (event: ModelEvent) => void;
  onCall?: (call: CallRecord) => void;
  reasoningSummary?: boolean;
};

export class OpenAIGenerator implements Generator {
  calls: CallRecord[] = [];
  apiKey: string;
  model: string;
  transport: typeof fetch;
  definition: GenerationDefinition;
  constructor(
    apiKey: string,
    model: string,
    transport: typeof fetch = fetch,
    definition: GenerationDefinition = {
      instructions: recipe.instructions,
      schema: candidateSchema,
      maxOutputTokens: recipe.limits.maxOutputTokens,
      maxCalls: recipe.limits.maxCalls,
    },
  ) {
    if (!apiKey.trim()) {
      throw new Error('OPENAI_API_KEY is required for live calls.');
    }
    if (!model.trim()) {
      throw new Error('BUILDER_MODEL must be explicitly configured.');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.transport = transport;
    this.definition = definition;
  }
  async generate(task: Task, signal: AbortSignal): Promise<unknown> {
    const request = {
      model: this.model,
      store: false,
      instructions: this.definition.instructions,
      input: JSON.stringify({ task }),
      max_output_tokens: this.definition.maxOutputTokens,
      ...(this.definition.onEvent ? { stream: true } : {}),
      ...(this.definition.reasoningSummary ? { reasoning: { summary: 'auto' } } : {}),
      text: {
        format: {
          type: 'json_schema',
          name: 'builder_output',
          strict: true,
          schema: this.definition.schema,
        },
      },
    };
    signal.throwIfAborted();
    if (this.calls.length >= this.definition.maxCalls) {
      throw new Error('Model call budget exhausted.');
    }
    const started = performance.now();
    const call: CallRecord = { endpoint: 'responses', request, elapsedMs: 0 };
    this.calls.push(call);
    try {
      this.definition.onCall?.(call);
      const response = await this.transport('https://api.openai.com/v1/responses', {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      // Do not echo server error bodies: they can contain request data or credentials.
      if (!response.ok) {
        throw new Error(`OpenAI responses HTTP ${response.status}`);
      }
      const emit = (event: ModelEvent) =>
        this.definition.onEvent?.({
          ...event,
          ...(event.text ? { text: event.text.replaceAll(this.apiKey, '[REDACTED]') } : {}),
        });
      const streaming = response.headers.get('content-type')?.includes('text/event-stream');
      const result: unknown = streaming
        ? await streamedResponse(response, emit, signal)
        : await response.json();
      call.response = result;
      if (object(result) && (result.status === 'incomplete' || result.status === 'failed')) {
        emit({ kind: result.status, reason: incompleteReason(result), usage: result.usage });
      }
      const candidate = responseJSON(result);
      if (!streaming && object(result) && Array.isArray(result.output)) {
        for (const item of result.output) {
          if (object(item) && item.type === 'reasoning' && Array.isArray(item.summary)) {
            for (const part of item.summary) {
              if (object(part) && part.type === 'summary_text' && typeof part.text === 'string') {
                emit({ kind: 'summary', text: part.text });
              }
            }
          }
        }
      }
      emit({ kind: 'completed', usage: object(result) ? result.usage : undefined });
      return candidate;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown transport failure';
      call.error = message.replaceAll(this.apiKey, '[REDACTED]');
      throw new Error(call.error);
    } finally {
      call.elapsedMs = Math.round(performance.now() - started);
      this.definition.onCall?.(call);
    }
  }
}

// Parse SSE incrementally, including fragmented UTF-8, CRLF, comments, and multiline data.
async function* streamEvents(response: Response, signal: AbortSignal): AsyncGenerator<unknown> {
  if (!response.body) {
    throw new Error('OpenAI response stream has no body.');
  }
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  const parse = () => {
    const text = data.join('\n');
    data = [];
    if (!text || text === '[DONE]') {
      return undefined;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Malformed OpenAI stream event.');
    }
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      buffer += chunk.done
        ? decoder.decode() + '\n\n'
        : decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          const event = parse();
          if (event !== undefined) {
            yield event;
          }
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        }
      }
      if (chunk.done) {
        break;
      }
    }
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function streamedResponse(
  response: Response,
  emit: (event: ModelEvent) => void,
  signal: AbortSignal,
): Promise<unknown> {
  for await (const event of streamEvents(response, signal)) {
    if (!object(event)) {
      continue;
    }
    switch (event.type) {
      case 'response.created':
        emit({ kind: 'accepted' });
        break;
      case 'response.output_item.added':
        if (object(event.item) && event.item.type === 'reasoning') {
          emit({ kind: 'reasoning' });
        }
        break;
      case 'response.reasoning_summary_text.delta':
        if (typeof event.delta === 'string') {
          emit({ kind: 'summary', text: event.delta });
        }
        break;
      case 'response.output_text.delta':
        if (typeof event.delta === 'string') {
          emit({ kind: 'draft', text: event.delta });
        }
        break;
      case 'response.completed':
      case 'response.incomplete':
      case 'response.failed':
        return event.response;
      case 'response.refusal.delta':
      case 'response.refusal.done':
        throw new Error('Model refused generation.');
      case 'error':
        throw new Error('OpenAI response stream failed.');
    }
  }
  // Never promote partial JSON, even if it happens to parse, without a completion event.
  throw new Error('OpenAI stream ended before a completed response.');
}

export function responseJSON(response: unknown): unknown {
  if (!object(response) || response.status !== 'completed' || !Array.isArray(response.output)) {
    const reason = object(response) ? incompleteReason(response) : undefined;
    const usage = object(response) && object(response.usage) ? response.usage : {};
    const details = object(usage.output_tokens_details) ? usage.output_tokens_details : {};
    const tokens =
      typeof usage.output_tokens === 'number' ? `; output tokens: ${usage.output_tokens}` : '';
    const reasoning =
      typeof details.reasoning_tokens === 'number'
        ? `; reasoning tokens: ${details.reasoning_tokens}`
        : '';
    throw new Error(
      `Response did not complete${reason ? ` (reason: ${reason}${tokens}${reasoning})` : ''}; no candidate accepted.${reason === 'max_output_tokens' ? ' The output budget includes reasoning; increase freyaRecipe.limits.maxOutputTokens in src/recipe.ts.' : ''}`,
    );
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

function incompleteReason(response: Record<string, unknown>): string | undefined {
  const reason = object(response.incomplete_details)
    ? response.incomplete_details.reason
    : undefined;
  // Only report known API reasons; never echo arbitrary server error bodies.
  return reason === 'max_output_tokens' || reason === 'content_filter' ? reason : undefined;
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
