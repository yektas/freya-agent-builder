# Experiment record

- Hypothesis: the Freya workflow exceeds the old combined reasoning/output budget; increasing that bounded budget permits completion without changing the one-call strategy.
- Baseline source hash / commit: recorded in `experiments/generation/2026-10-10T14-13-36.508Z-7f7140f1-5556-4052-8cb7-33a3bc7ffd9a/run.json`.
- Candidate source hash / commit: captured automatically on the next generation run.
- Single intentional generation change: Freya output budget increases from 12,000 to 24,000 tokens, with generation deadline increased from 120 to 300 seconds to allow the extra output. The internal direct-generation baseline is unchanged.
- Model / call / time budgets: configured model, one call, 24,000 combined reasoning/output tokens, maximum 300 seconds for generation. Explicit shorter CLI deadlines remain enforced. No automatic retries or partial-candidate acceptance.
- Development tasks and repetitions: captured Brief A failure replayed offline; synthetic completed, token-limited, failed, truncated, and cancelled responses tested. UI grouping verified against the real trace and synthetic whitespace/fragment fixtures.
- Holdout tasks: untouched; no live cross-task comparison yet.
- Organizer score definition and weighting: unchanged; no official evaluation performed.

| Task               | Baseline score | Candidate score | Repetitions                           | Latency      | Failure change                                                                | Run paths                                                                            |
| ------------------ | -------------- | --------------- | ------------------------------------- | ------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Brief A generation | null           | null            | 1 captured baseline, 0 live candidate | baseline 93s | baseline API incomplete: max_output_tokens; candidate live outcome unverified | experiments/generation/2026-10-10T14-13-36.508Z-7f7140f1-5556-4052-8cb7-33a3bc7ffd9a |
| Brief B generation | null           | null            | 0                                     | null         | Not evaluated                                                                 | none                                                                                 |

- Earliest consequential failure in the trace: API reports `status: incomplete`, `reason: max_output_tokens`, 12,000 output tokens including 5,024 reasoning tokens; workflow text ends mid-prompt. It is not a timeout or stream-parser failure.
- Evidence supporting the proposed mechanism: captured response replay reproduces the failure; regression tests verify cause/usage reporting, retained response, no retry, larger configured request budget, and recipe-derived JSON-only deadline.
- Regressions or missing cases: higher maximum spend and longer possible wait; 24,000 tokens still cannot guarantee every workflow completes. Live completion and performance across A/B remain unverified.
- Uncertainty / suspected noise: workflow length and reasoning usage vary by run/model. No benchmark evidence.
- Decision: repeat live generation and compare across tasks before benchmark promotion.
- Reason: fixes a demonstrated capacity limit while preserving one-call generation and refusing incomplete output.

Related observability fix: the inspector groups consecutive streamed draft/summary fragments into expandable blocks without trimming whitespace, truncating those blocks, or changing raw logs. Terminal failures now expose known API reasons and token usage. All 33 offline checks pass; the captured 6,967 draft fragments are displayed within 52 trace entries rather than 7,013 rows.
