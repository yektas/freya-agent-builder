# Staged observations repair (offline)

- Hypothesis: unconstrained scalar staging with compiler validation avoids rejected reset writes and the serialized-observation mismatch seen in v9.
- Baseline source hash / commit: v9 generation `33bd71fbb6cadb4edf670c6bf325591433e0046562413534605d16f6ed680df6`; practice `f5faaba9be085dc1508271a388eff594bc6be1cacbe4e66f9bbbdc53d19af00a`.
- Candidate source hash / commit: uncommitted repair in `src/input-contract.ts`, `src/observation-contract.ts`, and the metadata check in `src/workflow.ts`.
- Single intentional change: replace the current-turn observation boundary. Includes bounded collection visits and stage-scoped generation instructions; these are not independently evaluated ablations.
- Model / call / time budgets: zero model calls, registrations or simulations. Offline Python test subprocesses have two-second deadlines.
- Development tasks and repetitions: synthetic current-turn fixtures across all eight supported extraction types, enum and pattern constraints, simultaneous answer/question, missing/malformed values and repeated visits.
- Holdout tasks: not evaluated; new generation and practice require a separate experiment.
- Organizer score definition and weighting: retain kit and conversation results separately; no candidate benchmark score.

| Task                  | Baseline score              | Candidate score | Repetitions   | Latency | Failure change                               | Run paths                     |
| --------------------- | --------------------------- | --------------- | ------------- | ------- | -------------------------------------------- | ----------------------------- |
| Brief A / in_words v9 | 0/10 kit, 0/10 conversation | null            | 0 candidate   | null    | Live candidate unmeasured                    | Handoff v9 artifacts retained |
| Synthetic mechanics   | null                        | null            | Offline tests | null    | Date reset regression reproduced, then fixed | tests/input-contract.test.ts  |

- Earliest consequential failure: recorded extraction `answer: 1988-03-14` in the JSON-string observations field; reset validation errors name `observed_amount` and `observed_date`. Confirmed by reading platform.jsonl, without executing generated Python.
- Evidence: the original reset failed the new schema-validating fixture; staged reset and validation pass it. Tests execute compiler-owned code and synthetic fixtures only.
- Decision: repeat evaluation before promotion. Keep direct generation selectable and retain rejected v9 in comparisons. The existing runtime-contract default is unchanged; this repair is not a measured promotion.

## Contract and tradeoffs

The compiler renames extraction transport fields to reserved unconstrained strings. It resets both those fields and the original observation aliases, then inserts a validation node before authored decision code. Original aliases have no registered extraction schema, so the missing marker does not violate date, enum or regex constraints. Type and constraints are applied independently before publication; unrelated persistent state remains intact. Low-confidence/discarded extraction leaves staging missing. Failed validation leaves the alias missing, never the previous value.

All supported scalar types have explicit lexical validation. Name means nonempty text; phone uses digits and common separators; source-specific rules still belong in authored decisions. Unknown schema constraints are rejected, rather than silently omitted. Staging does not use native date extraction rules: prompts must provide supplied call-time semantics for relative dates. ISO dates are checked as real calendar dates. Regex exceptions fail closed. Serialized-JSON descriptions are rejected; this static check cannot detect every indirect parsing assumption in arbitrary authored Python.

Each collection declares one stage scope, a total visit budget of 1–12, and an end-call target. The counter persists across re-entry, including malformed or semantically unusable observations. This is a technical safety cap, separate from source refusal/verification limits. Exhaustion takes the authored safe end-call route. Existing lifecycle finalization remains available. New generation instructions require separate stages and forbid future-stage disclosure; prompt containment is not a proven security boundary.

Unconstrained transport moves type validation out of Freya; exact parity with its undocumented validators is not claimed. Date anchoring, extraction accuracy, added validation-node latency, and stage containment need a fresh matched live experiment. Synthetic results establish mechanics only. Rejected/failed builds must remain in future coverage comparisons; do not manually repair recorded workflows.

Validation: `pnpm run check` passed formatting, lint, both TypeScript checks and 116/116 offline tests. The initial sandbox run blocked localhost binds; the approved rerun passed. Candidate changed-source SHA-256 (ordered path + NUL + bytes + NUL for the three files above): `790ba6727721314281ffaf3e782631045411bd5c63d5a92ce090264f186e0637`. This is a repair-source fingerprint, not a generation snapshot.
