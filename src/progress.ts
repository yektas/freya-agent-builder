// Human-readable progress goes to stderr; stdout remains the final workflow JSON.
import type { ModelEvent } from './providers.ts';
import { object } from './validation.ts';
import { estimateCost, normalizeUsage } from './usage.ts';

export function generationProgress(
  options: {
    quiet?: boolean;
    showDraft?: boolean;
    reasoningSummary?: boolean;
    model?: string;
  },
  onLog?: (message: string) => void,
) {
  const started = performance.now();
  let outputChars = 0;
  let summaryChars = 0;
  let drafting = false;
  let section: 'summary' | 'draft' | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const clean = (text: string) => {
    for (const name of ['OPENAI_API_KEY', 'FREYA_API_KEY', 'FREYA_BANK_TEAM_KEY']) {
      const secret = process.env[name];
      if (secret) {
        text = text.replaceAll(secret, '[REDACTED]');
      }
    }
    return text;
  };
  function closeSection() {
    if (section) {
      process.stderr.write('\n');
    }
    section = null;
  }
  function report(message: string) {
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const text = `[generate +${seconds}s] ${clean(message)}\n`;
    onLog?.(text);
    if (!options.quiet) {
      closeSection();
      process.stderr.write(text);
    }
  }
  function write(kind: 'summary' | 'draft', text: string) {
    if (options.quiet) {
      return;
    }
    if (section !== kind) {
      closeSection();
      process.stderr.write(
        kind === 'summary' ? '[model summary] ' : '[model draft — not yet validated] ',
      );
      section = kind;
    }
    process.stderr.write(clean(text));
  }
  return {
    report,
    waiting() {
      if (options.quiet && !onLog) {
        return;
      }
      heartbeat = setInterval(
        () =>
          report(
            `Waiting for model completion; ${outputChars.toLocaleString('en-US')} draft characters received.`,
          ),
        30000,
      );
      heartbeat.unref();
    },
    model(event: ModelEvent) {
      switch (event.kind) {
        case 'accepted':
          report('Responses API accepted the request.');
          break;
        case 'reasoning':
          report('Model is reasoning; private internal text is not exposed.');
          break;
        case 'summary':
          summaryChars += event.text?.length || 0;
          if (event.text) {
            write('summary', event.text);
          }
          break;
        case 'draft':
          outputChars += event.text?.length || 0;
          if (!drafting) {
            drafting = true;
            report('Model is writing the workflow blueprint.');
          }
          if (options.showDraft && event.text) {
            write('draft', event.text);
          }
          break;
        case 'completed':
        case 'incomplete':
        case 'failed':
          clearInterval(heartbeat);
          const usage = object(event.usage) ? event.usage : {};
          const tokens =
            typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number'
              ? ` Input tokens: ${usage.input_tokens}; output tokens: ${usage.output_tokens}.`
              : '';
          const details = object(usage.output_tokens_details) ? usage.output_tokens_details : {};
          const reasoning =
            typeof details.reasoning_tokens === 'number'
              ? ` Reasoning tokens: ${details.reasoning_tokens} (included in output tokens).`
              : '';
          const cost = estimateCost(normalizeUsage(event.usage), options.model);
          const spend =
            cost.usd !== null
              ? ` Estimated cost: $${cost.usd.toFixed(6)} (${cost.source} price).`
              : '';
          report(
            `Model response ${event.kind}.${event.reason ? ` Reason: ${event.reason}.` : ''}${tokens}${reasoning}${spend}`,
          );
          if (options.reasoningSummary && !summaryChars) {
            report('No model-provided reasoning summary was returned.');
          }
          break;
      }
    },
    finish() {
      clearInterval(heartbeat);
      if (!options.quiet) {
        closeSection();
      }
    },
  };
}
