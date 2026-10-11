# Current-turn contract experiment record

- Hypothesis: compiler-owned observation reset prevents stale extracted terms from blocking confirmation, while independent-fact guidance preserves compound speech and guarded acknowledgements reduce unsupported success claims.
- Baseline source hash/commit: exact v8 source snapshot in `experiments/diagnosis/2026-10-11-current-turn-contract/baseline-source.json`.
- Candidate source hash/commit: generation run source hash `33bd71fbb6cadb4edf670c6bf325591433e0046562413534605d16f6ed680df6`; the run's exact source snapshot is authoritative. Practice also records its execution source snapshot.
- Intentional strategy change: current-turn reset/decision boundaries and guarded acknowledgements. This combined experiment cannot isolate their individual effects; subsequent ablations can.
- Model/call/time budgets: gpt-6.1-sol, medium effort; one generation call, 24,000 output tokens, five-minute generation deadline. One Brief A/in_words practice repetition, bounded by the existing shared-lock practice deadline. No additional repair generation.
- Development tasks: synthetic collection cycles with stale terms, absent fields, compound speech, corrections, changed source-success fields and failed writes. No synthetic score is treated as practice performance.
- Holdout checkpoint: after this matched smoke, compare another fresh direct/candidate build across A+B and changed-schema clean/raw inputs, with three repetitions and varied styles. Do not silently drop rejected builds.
- Organizer scoring: all ledger, policy and honesty checks must pass. Final reliability requires all three repetitions. Freya conversation count alone is not the kit score.

| Task                        | Baseline score                 | Candidate score                | Repetitions             | Latency                          | Failure change                                  | Run paths                                                                                                                                                                 |
| --------------------------- | ------------------------------ | ------------------------------ | ----------------------- | -------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brief A/in_words            | v8 kit 3/10; conversation 4/10 | v9 kit 0/10; conversation 0/10 | 1 baseline; 1 candidate | Record slowest turns and endings | Record per-case regressions                     | Baseline generation `2026-10-11T14-01-31.734Z-ed789138-74f6-4084-a06e-0eb2801abc04`; candidate generation `2026-10-11T14-24-47.152Z-b3db6b07-71f5-43e0-9983-76c578975ca2` |
| Synthetic boundary fixtures | null                           | null                           | deterministic offline   | Not a platform measurement       | Reset/gate and score interpretation checks pass | tests/input-contract.test.ts; tests/ui.test.ts                                                                                                                            |

- Earliest baseline consequential failures: stale dates treated as fresh corrections; compound answer/question loses the answer; future payment classified as completed payment; unsupported recording claims while promise state is unrecorded.
- Evidence: v8 full transcript/variable tables and docs/plans/2026-10-11-v8-test-outcome.md. Synthetic checks exercise compiler output, not recorded model-generated Python.
- Regressions/missing cases: native reset behavior, classification, partial speech, source-policy coverage and added-node latency remain unmeasured until the candidate smoke. Free-form dialogue cannot be completely constrained by structural gates.
- Decision: reject v9 as a performance improvement; retain direct baseline. Runtime-contract remains the user-selected default, with known current-turn contract incompatibilities requiring redesign. No further candidate was generated.

## Candidate execution

- Accepted build: one generation call, 233 seconds, 23 compiled nodes, $0.162590 recorded model cost. Includes two observation reset nodes and three acknowledgement gates.
- Compiled workflow SHA-256: `3ea25010a9b82736671543937311518ece8c5a4a7eceda73c6198ed1f3a70308`.
- Separate upload: workflow `69182807-d0b2-4d0a-a5dc-db8b5ea9304a`, agent `5a5b917c-0217-4626-9ee0-d817b8fe4344`.
- Matched practice: Brief A, in_words, one repetition; simulation `c770587e-d4ae-41fb-abb0-8efb2fdf8908`, started 2026-10-11T14:29:55.800Z. Completed 2026-10-11T14:44:53.732Z; kit 0/10, conversation 0/10, scorer duration 875 seconds.

## Final evidence and regressions

All prior kit passes (PUB-02/05/08) and conversation passes (also PUB-09) regress. Final traces show 314 accepted observation writes, only two valid JSON objects, plus 356 reset completions with schema validation errors over 359 reset entries. No acknowledgement guard was reached. Six calls exceeded maximum duration; slowest candidate turns range 9.6–31.4 seconds. This combined single-build experiment cannot isolate each change. See `2026-10-11-builder-handoff.md` for per-case results, exact artifacts, and the next investigation.
