# V15: premature contact-to-closing route

- Hypothesis: the direct generation's broad `matches_intent` route from contact and identity to closing fires on ordinary identity confirmation, before either security question. This explains the near-total failure independently of the products-array fix.
- Baseline source hash: `f80ae95617608b1c4b4cd4aab7854e39b75c891f4a18f106ab40fcf4e8e73537` for generation `2026-10-11T16-09-11.435Z-817f46c3-9374-4679-aac0-bf4cd4a925d0`.
- Candidate source hash: null. No builder change was made in this investigation.
- Single intentional change: none; read-only diagnosis of recorded artifacts and existing call and bank records.
- Model / call / time budgets: the recorded build used `gpt-6.1-sol`, medium effort, direct strategy, one generation call. This investigation used zero new model calls, registrations, or simulations. Freya call details and synthetic bank ledgers were retrieved with GET only.
- Development tasks and repetitions: Brief A, `in_words`, one recorded repetition.
- Holdout tasks: none.
- Organizer score: a customer passes only when the bank ledger and conversation judge both pass; the final benchmark also requires all three repetitions. The practice job has **no valid combined score** because one judge verdict is `error`.

| Case set                 | Baseline score | Candidate score | Repetitions | Latency            | Failure change                                                                                                         | Run path                                                                               |
| ------------------------ | -------------- | --------------- | ----------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Brief A / `in_words` v15 | null           | null            | 1           | 329 s practice job | Eight judge failures, one judge pass, one judge error. Only one ledger match, on a different case from the judge pass. | `experiments/generation/2026-10-11T16-09-11.435Z-817f46c3-9374-4679-aac0-bf4cd4a925d0` |

## Earliest consequential failure

The compiled `contact_and_identity` node orders its exits as `finish_state`, `wrong_answers_left`, `all_verified`, a broad `matches_intent` route to `closing`, and then an `always` self-transition. The broad route describes many unrelated endings in one condition: wrong number, death, unclear speaker after two asks, declined callback, security refusals, unwillingness to talk, and infrastructure failure. It is not backed by a state variable recording which condition occurred.

For PUB-01, the assistant asks whether it is speaking with Mr Reyes. The customer replies, “Yes, this is Daniel Reyes speaking.” The next event routes directly from `contact_and_identity` to `closing` with reason `Contact or verification must end matches intent`. No `verify_identity` call occurred. The closing node then asks whether he is willing to proceed with security questions, receives yes, invents a security-service failure, and calls `close_call` with `not_verified / failed`. The ledger expected a payment promise. PUB-04, PUB-05, PUB-06, PUB-07, PUB-08, and PUB-09 show the same premature route after an ordinary self-identification; PUB-03 also closes before a security-tool call. PUB-07 even asks invented security questions while already in `closing`.

## Evidence and limits

- Existing simulation `0a5a51cb-8e7d-48c8-a301-f802fdae44dc`, iteration `59ef415a-33b6-4fb6-84c9-3a72111caec4`, has ten detailed runs: eight `fail`, one `pass`, one `error` (PUB-10). The dashboard's 10% pass rate is the conversation judge's partial view, not a valid combined practice score.
- The original kit's ledger scorer applied to the ten existing synthetic sessions finds one ledger match, PUB-03. PUB-02 is the judge's sole pass, but its ledger has no required `schedule_callback` call. Thus none of the nine determinate verdicts passes both checks. PUB-10 has no bank tool calls and its judge verdict remains an error. These are diagnostics, **not** a recorded 0/10 practice result.
- All nine calls with messages make no `verify_identity` or `get_account` call. The generated `prepare_account` code and the products-array compiler fix are never exercised. V15 cannot support promoting or rejecting that fix.
- PUB-02 also reaches `closing` after its first third-party answer. The judge considers the conversation acceptable, but the agent says it noted the callback without calling `schedule_callback`.
- The broad route's false match is directly observed in Freya call events. Whether a narrower prompt, a split contact/identity graph, or deterministic exit state generalizes across unseen briefs remains unmeasured.

## Regressions, uncertainty, decision

The single run establishes a specific routing failure in this generated artifact. It does not establish the reliability of a prompt-only fix, the products-array change, or a new builder strategy. The judge error in PUB-10 is a separate evidence failure, and there was no retest.

**Decision: reject v15 as a promotion candidate.** Keep direct generation as a measured baseline. The next behavioral experiment should make contact and verification exit conditions narrow and grounded in explicit state or tool results, then compare fresh builds across cases and record regressions before promotion. A bounded test-and-repair loop could identify this failure automatically, but it must preserve the separately registered selected agent and a valid fallback.
