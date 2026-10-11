# Products-array blocker: compiler-owned fix

- Hypothesis: the 1/10 result in run `15-48-08` was caused by generated code reading a whole tool-response array that the platform never stores, not by the birth-date path the run appeared to implicate.
- Baseline source hash / commit: generation `2026-10-11T15-48-08.474Z-dffb9bca-22f4-48ad-8897-01cfa177a8dc`, recorded score 1/10.
- Candidate source hash / commit: uncommitted. See `docs/plans/2026-10-11-extraction-deadlock-repair.md` for the surrounding work.
- Single intentional change: the compiler publishes every container in a tool result as JSON text under its own documented response path, for every `api_call`, and the snapshot is no longer opt-in. Static checks that forbade reading a response path were removed because the premise no longer holds.
- Model / call / time budgets: zero model calls, registrations or simulations. No generated Python from a recorded run was executed against Freya; the recorded code was replayed in a local Python subprocess against a recorded envelope.
- Development tasks and repetitions: none. Offline tests only.
- Holdout tasks: not evaluated. No live generation has been run with this candidate.
- Organizer score definition and weighting: kit ledger checks and conversation judge verdicts stay separate. No candidate benchmark score exists.

| Task                     | Baseline score | Candidate score | Repetitions   | Latency | Failure change                                                                | Run paths                                                                              |
| ------------------------ | -------------- | --------------- | ------------- | ------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Brief A / in_words 15:48 | 1/10           | null            | 0 candidate   | null    | Mechanism fixed offline against the recorded code; live candidate unmeasured  | `experiments/generation/2026-10-11T15-48-08.474Z-dffb9bca-22f4-48ad-8897-01cfa177a8dc` |
| Synthetic mechanics      | null           | null            | Offline tests | null    | Container publication covered for arrays, nested objects and empty containers | `tests/runtime-contract.test.ts`                                                       |

## The birth-date path is not the problem

The suspicion was reasonable, and the recorded transcripts rule it out. Every case converts a spoken date to the required ISO form correctly and passes:

| Case   | Customer said                                  | Sent to `verify_identity` | Result           |
| ------ | ---------------------------------------------- | ------------------------- | ---------------- |
| PUB-01 | "fourteen March one nine eight eight"          | `1988-03-14`              | `verified: true` |
| PUB-04 | "the thirtieth of January one nine eight four" | verified                  | `verified: true` |
| PUB-05 | "the ninth of September one nine nine zero"    | verified                  | `verified: true` |
| PUB-06 | "seventeenth of May nineteen eighty six"       | verified                  | `verified: true` |

PUB-03 is the one case where a date is rejected, and that rejection is correct: its expected birth date is `1992-07-21` and the customer answers with three wrong dates on purpose. Its failure is separate and is a policy bug, not a formatting bug. After the first wrong answer the agent advanced to the phone question instead of re-asking the date of birth, so the third-wrong-answer path never fired, `all_verified` stayed false, and both `get_account` calls returned `identity not verified`. The call then closed without the required `not_verified` / `failed` record.

## Earliest consequential failure in the trace

Eight of the ten cases run an identical sequence and then dead-end:

```
verify_identity x2 -> get_account -> customer agrees to pay -> code_exec -> close_call no_promise/service_error
```

The agent states the debt correctly, the customer answers, and then the single `prepare_account` code node raises. Its source reads:

```python
products = vars.get('account_products', vars.get('get_account_response.data.products', []))
if isinstance(products, str):
    products = json.loads(products)
if not isinstance(products, list) or len(products) != 1:
    raise ValueError('expected one product')
```

The recorded variable table for that call contains:

```
get_account_response.data.products.0.card_last4      = "4821"
get_account_response.data.products.0.days_late       = "6"
get_account_response.data.products.0.minimum_payment = "126"
get_account_response.data.products.0.past_due        = "420"
get_account_response.data.products.0.product_id      = "p1"
get_account_response.data.products.0.type            = "credit_card"
```

`account_products` is absent and `get_account_response.data.products` is absent. The blueprint declared `response_mapping: [{"path": "data.products", "variable": "account_products"}]`, which the platform silently ignores for a container. `products` therefore resolves to `[]`, the length check raises, and the except branch writes `account_state = 'error'`, which routes to a `service_error` close. `create_promise` is never called in any of the ten cases.

## Evidence supporting the proposed mechanism

This is the same mechanism recorded twice already, in `docs/plans/2026-10-11-products-array-failure-report.md` and again in the v9 traces. The fix recommended there, "preserve containers as JSON text under their response paths", had been implemented as the opt-in `builder_result_<tool>` snapshot but was still gated behind the `runtime-contract` strategy.

Two facts made the gate the problem rather than the mechanism:

1. The snapshot alone does not help. Replaying the recorded `prepare_account` with only `builder_result_get_account` present still yields `account_state = 'error'`, because that code never reads the snapshot. Fixing it would depend on the model choosing to read a new variable.
2. The platform never writes the bare container path. It is absent from the recorded variable table, so publishing it there cannot be overwritten by the engine's own flattened write.

The change therefore publishes containers under the path the generated code already reads, so it needs no model cooperation.

Replay of the unchanged recorded code, with the recorded `get_account` envelope and the recorded calendar variables:

| Representation           | `account_state` | Outcome                                     |
| ------------------------ | --------------- | ------------------------------------------- |
| Leaves only, as recorded | `error`         | closes `no_promise` / `service_error`       |
| With the compiler hook   | `ready`         | reaches the promise path with correct facts |

The facts produced are `Product: credit card ending 4821. Product ID: p1. Past-due amount: 420.00. Days late: 6. Floor: 126.00. Rest overdue if floor paid: 294.00. Band: early`, which match the PUB-01 case data.

## Regressions or missing cases

The opt-in static check that rejected Python reading `<tool>_response.*` was removed rather than narrowed. Whether a given read is followed by `json.loads` is not statically decidable, and a narrower rule produced a false positive on the compiler's own generated guard code, which reads the snapshot and parses it correctly.

The snapshot is now applied to every `api_call` including lifecycle tools and `pre_actions`. It only adds variables; no existing flattened variable is touched, so a blueprint that reads leaves is unaffected.

`pnpm run check` passes formatting, lint, both TypeScript checks and 120/120 offline tests.

## Uncertainty / suspected noise

PUB-03 is untouched by this change. It needs a separate fix: after a wrong answer, re-ask the same question, count wrong answers across both questions, and close as `not_verified` / `failed` at three.

The 1/10 baseline is one repetition of one style and is not a reliability estimate. A single fresh build can land anywhere in the observed 0-6 range.

## Decision: reject

- Reason: the mechanism is confirmed against recorded evidence and the fix is verified by replay, but no live generation has been run. Promote only after a matched repetition shows the eight `service_error` cases reaching `create_promise`.

## What a follow-up experiment must do

Generate one fresh Brief A build with this compiler and run one practice repetition. The specific prediction to check is narrow: the count of cases closing as `no_promise` / `service_error` immediately after `get_account` should fall from eight to zero. That is a mechanism check, not a score check, and it can fail while the score still moves for other reasons.

## V15 follow-up, 11 October

The fresh direct build in `experiments/generation/2026-10-11T16-09-11.435Z-817f46c3-9374-4679-aac0-bf4cd4a925d0` did not reach `get_account` in any of its nine completed calls. Its broad contact-stage `matches_intent` exit routed to closing immediately after identity-of-speaker confirmation. One additional case has an error judge verdict. The practice job has no valid score, and the products-array prediction remains untested. See `docs/plans/2026-10-11-v15-premature-closing.md` for the call and ledger diagnosis.
