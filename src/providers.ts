import { createOpenAI } from '@ai-sdk/openai';
import { generateText, jsonSchema, Output, streamText } from 'ai';
import type { Candidate, Generator, Task } from './contracts.ts';
import { object } from './validation.ts';
import { normalizeUsage } from './usage.ts';
import type { TokenUsage } from './usage.ts';

export type CallRecord = {
  endpoint: 'responses';
  baseUrl: string;
  request?: unknown;
  response?: unknown;
  error?: string;
  elapsedMs: number;
  // Normalized from the API payload so every run record totals the same way.
  usage?: TokenUsage;
};

export type ModelEvent = {
  kind: 'accepted' | 'reasoning' | 'summary' | 'draft' | 'completed' | 'incomplete' | 'failed';
  text?: string;
  usage?: unknown;
  reason?: string;
};
export const reasoningEfforts = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];
export function parseReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (!reasoningEfforts.includes(value as ReasoningEffort)) {
    throw new Error(`reasoning-effort must be one of: ${reasoningEfforts.join(', ')}.`);
  }
  return value as ReasoningEffort;
}

export type GenerationDefinition = {
  instructions: string;
  schema: unknown;
  maxOutputTokens: number;
  maxCalls: number;
  onEvent?: (event: ModelEvent) => void;
  onCall?: (call: CallRecord) => void;
  reasoningSummary?: boolean;
  reasoningEffort?: ReasoningEffort;
};

export function createOpenAIGenerator(
  model: string,
  definition: GenerationDefinition,
  transport: typeof fetch = fetch,
) {
  if (!model.trim()) {
    throw new Error('Live runs require --model or BUILDER_MODEL.');
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('Live runs require OPENAI_API_KEY and --model or BUILDER_MODEL.');
  }
  return new OpenAIGenerator(
    process.env.OPENAI_API_KEY,
    model,
    transport,
    definition,
    process.env.OPENAI_BASE_URL?.trim() || undefined,
  );
}

export class OpenAIGenerator implements Generator {
  calls: CallRecord[] = [];
  private readonly apiKey: string;
  readonly model: string;
  private readonly definition: GenerationDefinition;
  private readonly baseUrl: string;
  private readonly provider: ReturnType<typeof createOpenAI>;
  private activeCall: CallRecord | undefined;
  constructor(
    apiKey: string,
    model: string,
    transport: typeof fetch,
    definition: GenerationDefinition,
    baseUrl = 'https://api.openai.com/v1',
  ) {
    if (!apiKey.trim()) {
      throw new Error('OPENAI_API_KEY is required for live calls.');
    }
    if (!model.trim()) {
      throw new Error('BUILDER_MODEL must be explicitly configured.');
    }
    parseReasoningEffort(definition.reasoningEffort);
    this.apiKey = apiKey;
    this.model = model;
    this.definition = definition;
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error('OPENAI_BASE_URL must be an absolute HTTP or HTTPS URL.');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'OPENAI_BASE_URL must use HTTP or HTTPS without credentials, query parameters, or a fragment.',
      );
    }
    this.baseUrl = url.href.replace(/\/+$/, '');
    this.provider = createOpenAI({
      apiKey,
      baseURL: this.baseUrl,
      // Keep redirects closed so an authenticated request cannot be forwarded.
      fetch: async (input, init) => {
        if (this.activeCall && typeof init?.body === 'string') {
          this.activeCall.request = JSON.parse(init.body);
          this.definition.onCall?.(this.activeCall);
        }
        return transport(input, { ...init, redirect: 'error' });
      },
    });
  }
  private emit(event: ModelEvent) {
    this.definition.onEvent?.({
      ...event,
      ...(event.text ? { text: event.text.replaceAll(this.apiKey, '[REDACTED]') } : {}),
    });
  }
  async generate(task: Task, signal: AbortSignal): Promise<unknown> {
    const streamed = Boolean(this.definition.onEvent);
    const prompt = JSON.stringify({ task });
    signal.throwIfAborted();
    if (this.calls.length >= this.definition.maxCalls) {
      throw new Error('Model call budget exhausted.');
    }
    const started = performance.now();
    const call: CallRecord = {
      endpoint: 'responses',
      baseUrl: this.baseUrl,
      elapsedMs: 0,
    };
    this.calls.push(call);
    this.activeCall = call;
    let responseBody: unknown;
    try {
      this.definition.onCall?.(call);
      const model = this.provider.responses(this.model);
      const settings = {
        model,
        prompt,
        abortSignal: signal,
        maxRetries: 0,
        streamRetries: 0,
        maxOutputTokens: this.definition.maxOutputTokens,
        output: Output.object({
          name: 'builder_output',
          schema: jsonSchema(this.definition.schema as Parameters<typeof jsonSchema>[0]),
        }),
        providerOptions: {
          openai: {
            instructions: this.definition.instructions,
            store: false,
            strictJsonSchema: true,
            ...(this.definition.reasoningEffort
              ? { reasoningEffort: this.definition.reasoningEffort, forceReasoning: true }
              : {}),
            ...(this.definition.reasoningSummary && !this.definition.reasoningEffort
              ? { forceReasoning: true }
              : {}),
            ...(this.definition.reasoningSummary
              ? { reasoningSummary: 'auto' }
              : this.definition.reasoningEffort && this.definition.reasoningEffort !== 'none'
                ? { reasoningSummary: null }
                : {}),
          },
        },
      };

      let output: unknown;
      if (streamed) {
        const result = streamText({
          ...settings,
          include: { requestBody: true, rawChunks: true },
        });
        for await (const part of result.stream) {
          if (part.type === 'raw' && object(part.rawValue)) {
            const type = part.rawValue.type;
            if (type === 'response.created') {
              this.emit({ kind: 'accepted' });
            } else if (type === 'response.refusal.delta' || type === 'response.refusal.done') {
              throw new Error('Model refused generation.');
            } else if (
              (type === 'response.completed' ||
                type === 'response.incomplete' ||
                type === 'response.failed') &&
              object(part.rawValue.response)
            ) {
              responseBody = part.rawValue.response;
            }
          } else if (part.type === 'reasoning-start') {
            this.emit({ kind: 'reasoning' });
          } else if (part.type === 'reasoning-delta') {
            this.emit({ kind: 'summary', text: part.text });
          } else if (part.type === 'text-delta') {
            this.emit({ kind: 'draft', text: part.text });
          } else if (part.type === 'error') {
            throw part.error;
          }
        }
        const [requestMetadata, responseMetadata] = await Promise.all([
          result.request,
          result.response,
        ]);
        if (call.request === undefined) {
          call.request = requestMetadata.body;
        }
        responseBody ??= responseMetadata.body;
        output = result.output;
      } else {
        const result = await generateText({
          ...settings,
          include: { requestBody: true, responseBody: true },
        });
        if (call.request === undefined) {
          call.request = result.request.body;
        }
        responseBody = result.response.body;
        output = result.output;
        for (const part of await result.reasoning) {
          if (part.type === 'reasoning') {
            this.emit({ kind: 'summary', text: part.text });
          }
        }
      }

      call.response = responseBody;
      const usage = normalizeUsage(object(responseBody) ? responseBody.usage : undefined);
      if (usage) {
        call.usage = usage;
      }
      if (
        object(responseBody) &&
        (responseBody.status === 'incomplete' || responseBody.status === 'failed')
      ) {
        this.emit({
          kind: responseBody.status,
          reason: incompleteReason(responseBody),
          usage: responseBody.usage,
        });
      }
      assertCompletedResponse(responseBody);
      this.emit({ kind: 'completed', usage: responseBody.usage });
      return output;
    } catch (error) {
      if (call.request === undefined && object(error) && object(error.requestBodyValues)) {
        call.request = error.requestBodyValues;
      }
      responseBody ??= responseFromError(error);
      if (responseBody) {
        call.response = responseBody;
        const usage = normalizeUsage(object(responseBody) ? responseBody.usage : undefined);
        if (usage) {
          call.usage = usage;
        }
      }
      const status =
        object(error) && typeof error.statusCode === 'number' && error.statusCode >= 400
          ? error.statusCode
          : null;
      const message = status
        ? `Responses API HTTP ${status}`
        : error instanceof Error
          ? error.message
          : object(error) && typeof error.message === 'string'
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Unknown model provider failure';
      call.error = message.replaceAll(this.apiKey, '[REDACTED]');
      throw new Error(call.error);
    } finally {
      this.activeCall = undefined;
      call.elapsedMs = Math.round(performance.now() - started);
      this.definition.onCall?.(call);
    }
  }
}

function assertCompletedResponse(response: unknown): asserts response is Record<string, unknown> {
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
      response === undefined
        ? 'OpenAI stream ended before a completed response.'
        : `Response did not complete${reason ? ` (reason: ${reason}${tokens}${reasoning})` : ''}; no candidate accepted.${reason === 'max_output_tokens' ? ' The output budget includes reasoning; increase freyaRecipe.limits.maxOutputTokens in src/recipe.ts.' : ''}`,
    );
  }
  for (const item of response.output) {
    if (!object(item) || item.type !== 'message' || !Array.isArray(item.content)) {
      continue;
    }
    if (item.content.some((part) => object(part) && part.type === 'refusal')) {
      throw new Error('Model refused generation.');
    }
  }
}

function incompleteReason(response: Record<string, unknown>): string | undefined {
  const reason = object(response.incomplete_details)
    ? response.incomplete_details.reason
    : undefined;
  // Only report known API reasons; never echo arbitrary server error bodies.
  return reason === 'max_output_tokens' || reason === 'content_filter' ? reason : undefined;
}

function responseFromError(error: unknown): Record<string, unknown> | undefined {
  if (!object(error) || !object(error.response)) {
    return undefined;
  }
  return object(error.response.body) ? error.response.body : undefined;
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
