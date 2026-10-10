# Generation visibility

The user requested details during JSON-only generation, including thinking and steps. Show actual input loading, strategy/budgets, model lifecycle events, elapsed-time heartbeats, draft character counts, usage, compilation, uncertainties, and graph summaries. Keep progress on stderr and the final compiled workflow alone on stdout. Keep the one-call direct-generation strategy and all Freya calls disabled in JSON-only mode.

Use documented Responses streaming events. Display only model-provided reasoning-summary events, never raw reasoning events. Request summaries only with `--reasoning-summary`, since support depends on the model. `--show-draft` displays unvalidated output deltas; `--quiet` suppresses logs. Require a completed response before parsing/compiling. Preserve request budgets, cancellation, failure reporting, and credential redaction. Default model instructions, output schema, and reasoning effort are unchanged.

## Experiment record

- Hypothesis: observability makes the existing generation process understandable without adding generation stages.
- Baseline source hash / commit: preceding JSON-only path; no official score. Source versions are captured by the existing full-run recorder.
- Candidate source hash / commit: current source; JSON-only mode continues to write no files as requested.
- Single intentional change: generation transport streams observable events, with stderr progress. Summaries are an explicit optional request setting.
- Model / call / time budgets: configured model, one call, 12,000 output tokens, existing 120-second generation cap.
- Development tasks and repetitions: original A input with injected CLI responses; synthetic transport/error/cancellation fixtures; compiler coverage includes changed tool fields/enums.
- Holdout tasks: untouched. No live A/B evaluation or hidden-brief use.
- Organizer score definition and weighting: unchanged; local logs/tests are not scores.

| Task                  | Baseline score | Candidate score | Repetitions | Latency | Failure change | Run paths |
| --------------------- | -------------- | --------------- | ----------- | ------- | -------------- | --------- |
| A/B official practice | null           | null            | 0 live      | null    | Not evaluated  | none      |

- Earliest consequential failure in the trace: injected truncated/failed/refused streams are rejected and never retried; idle streams cancel at the deadline.
- Evidence supporting the proposed mechanism: 19 offline tests pass, including fragmented UTF-8/CRLF streams, summary-only visibility, cancellation, stdout JSON equality across normal/quiet/detailed modes, no Freya credentials/Python requirement, and no output file writes.
- Regressions or missing cases: live API streaming and model-specific summary support have not been tested. Optional summaries can affect token use/latency and must be compared before promotion as a benchmark configuration.
- Uncertainty / suspected noise: no official benchmark evidence.
- Decision: retain as observability; do not promote an optimized generation strategy.
- Reason: the change exposes actual execution while preserving the baseline and explicit model-call limits.
