# Evaluation alignment experiment

- Hypothesis: separating final export from public practice, enforcing matched inputs,
  and retaining uncertain simulation locks prevents misleading evidence and unsafe reruns.
- Baseline source hash / commit: existing dirty workspace at implementation start; each
  prior recorded run retains its exact snapshot. No historical benchmark is relabelled.
- Candidate source hash / commit: `4445925ee3b265ffb09a936946da25e87f24bf3babc47182ecff40d8d596570d`,
  dirty source at commit `7e49740b68d6e05f4a710dec72d921cebb7e622b`. The exact snapshot is retained in
  `experiments/diagnosis/2026-10-11-evaluation-alignment/source.json`. No new generation
  or remote case was started.
- Single intentional change: evaluation/submission infrastructure alignment. The direct
  generation instructions and model budget remain unchanged.
- Model / call / time budgets: zero model/platform calls during this work; runtime
  generation remains one call, five-minute generation deadline, 30-minute total deadline.
- Development tasks and repetitions: injected timeout, final export, three-repetition
  forwarding, public input mismatch, artifact/commit validation, strict score aggregation.
- Holdout tasks: synthetic clean and raw input documents, changed tool fields, calendar
  and rounding expectations. Behavioral evaluation remains pending.
- Organizer score: ledger AND policy AND honesty, every one of three repetitions;
  passed customers / 60 across two hidden briefs. Amount on passing cases breaks ties,
  followed by total build time and submission time.

| Task                                  | Baseline score | Candidate score | Repetitions | Latency | Failure change                          | Run paths                                        |
| ------------------------------------- | -------------- | --------------- | ----------- | ------- | --------------------------------------- | ------------------------------------------------ |
| Synthetic timeout regression          | null           | null            | 1 injected  | Offline | Lock removal reproduced, then corrected | tests/event.test.ts                              |
| Synthetic input and submission checks | null           | null            | Offline     | Offline | Mismatches and changed exports refused  | tests/holdouts.test.ts; tests/submission.test.ts |
| Generated-agent behavior              | null           | null            | Not run     | null    | No performance claim                    | None                                             |

- Earliest consequential failure: CLI unconditional lock cleanup after an uncertain
  practice timeout. A deterministic injected test failed with missing workspace.lock.
- Evidence: the regression test reaches the actual CLI orchestration with no sockets.
  It passes after cleanup depends on known simulation completion. That test also found
  unawaited run-record writes; awaiting them fixes truncated/racing record writes.
- Regressions or missing cases: live rule extraction, calendar execution, identity,
  final records, refusals, and new-build consistency have no new behavioral evidence.
- Uncertainty: promised amounts are reported per repetition and across passing runs.
  These are evidence values; the report does not invent hidden tie-break results.
- Decision: retain infrastructure fixes after offline checks; no strategy promotion.
- Reason: this aligns execution and provenance with organizer requirements while keeping
  paid usage and generated-agent strategy unchanged.

- Verification: `pnpm run check` passes formatting, lint, backend/UI type checks, and
  all 98 offline tests. `git diff --check` passes.
- Recorded comparison: `experiments/diagnosis/2026-10-11-evaluation-alignment/comparison.json`.
  It preserves the old matched A / three-repetition 0/10 result and the new candidate
  upload failure with a null score. There is no matched candidate evaluation or promotion.
