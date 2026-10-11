# Final contract check — October 11, 2026

- Hypothesis: the old two-brief submission path would produce an invalid final form, and leaving the practice OpenAPI server untouched would send final tool calls to the organizer's practice mock.
- Baseline source hash / commit: `c0d86de` (working tree already had unrelated edits).
- Candidate source hash / commit: working tree; no candidate commit yet.
- Single intentional change: submission contract updated to one workflow/trace with members and mock URL; final tool URLs bind original operation paths to a supplied HTTPS mock base while retaining the original OpenAPI in the task record.
- Model / call / time budgets: unchanged; no model or platform calls in this check.
- Development tasks and repetitions: synthetic offline submission and final-run tests, one repetition each.
- Holdout tasks: final case package, unavailable until 17:00 UTC; evaluate after release.
- Organizer score definition and weighting: hidden final criteria and weights are not published. Trace checks provenance, not score.

| Task                            | Baseline score | Candidate score | Repetitions | Latency | Failure change             | Run paths                                         |
| ------------------------------- | -------------- | --------------- | ----------- | ------- | -------------------------- | ------------------------------------------------- |
| Synthetic final export and form | null           | null            | 1           | null    | Structural acceptance only | `tests/event.test.ts`, `tests/submission.test.ts` |

- Earliest consequential failure in the trace: the old form required two runs and omitted `members`, `workflow`, `trace`, and `mock_url`; the old tool catalog retained the practice server URL.
- Evidence supporting the proposed mechanism: current [Submit tab](https://www.freyavoice.ai/hackathon#submit), [Evaluation tab](https://www.freyavoice.ai/hackathon#evaluation), and offline tests. Current site says one Turkish final case and a participant-hosted Cloudflare Workers mock.
- Regressions or missing cases: final service contract and six examples have not been released; the existing CLI still requires explicit brief/OpenAPI paths rather than a case folder. Mock behavior and phone-agent quality remain unmeasured.
- Uncertainty / suspected noise: the final package may use a service format other than OpenAPI; adapt only after reading it.
- Decision: retain this contract guardrail; do not claim final readiness or a benchmark score.
- Reason: it prevents the known wrong submission shape and practice-host binding without incorporating final-case content into the builder.
