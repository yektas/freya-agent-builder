# v8 recorded practice outcome

Run `2026-10-11T14-01-31.734Z-ed789138-74f6-4084-a06e-0eb2801abc04`, runtime-contract strategy, Brief A, medium reasoning, one in_words repetition.

There are two different results: Freya conversation checks pass **4/10**; the kit combines conversation checks with bank ledger checks and passes **3/10**. The inspector displays the latter. PUB-09 accounts for the difference: restructuring transfer and conversation pass, but the final close action times out and the ledger has no outcome. The kit runner requires both checks, so the official recorded practice result remains 3/10. A clearer inspector label should distinguish kit score from Freya conversation score.

## Confirmed mechanisms

- PUB-01: "I can pay ... today" is extracted as action `paid`, not a future payment proposal. It closes paid without a promise. The extracted date also uses October 11 rather than supplied October 14; amount extraction contains a field label rather than just a number. Those malformed values are present, but the paid classification is the earliest decisive branch.
- PUB-04, PUB-07, PUB-10: account snapshots are usable and account_state becomes ready. Date replacement logic produces the expected deadline or holiday replacement. On clear confirmation the extracted date remains populated from earlier turns; generated code requires confirm with no date or amount, so it interprets the retained date as a proposal and never writes. Later dialogue falsely claims recording while promise_state is unrecorded. No create_promise call occurs anywhere in this practice run.
- PUB-03: a birth-date answer followed by a question becomes action `question`, so code discards the answer and asks again. It eventually submits three wrong answers and closes not_verified/failed. The judge describes failure to stop after the third wrong answer, but the full tool trace shows closure immediately after the third submitted failure. The actual earlier issue is losing the answer in a mixed-intent utterance. Preserve the judge failure without treating its description as an exact event trace.
- PUB-06: customer-ended call with slowest turn 48.1 seconds; account API succeeds, but recording ends during the following code action. No promise or final closure. Infrastructure latency and workflow sequencing remain confounded; this is not evidence of an amount-policy defect.
- PUB-09: transfer succeeds for restructuring. Code selects transferred/restructuring and reaches the final close node, but the variable table records an action timeout after 12,000 ms and close_state remains not_called. No final ledger record. Freya's conversation judge passes; kit ledger checks fail.

Passes under both checks: PUB-02 (callback), PUB-05 (hardship), PUB-08 (already paid). Compared with v7, hardship improves while identity and the combined restructuring result regress. One build and one repetition cannot establish strategy superiority.

## Builder implications

The structured tool-result boundary now works in observed account processing. The next general boundary to make explicit is extraction: current-turn presence, validity, stage relevance and provenance must be separate from persistent values. A single mutually exclusive action should not erase independent facts in compound speech. Confirmation must distinguish a fresh correction from a retained value. Dialogue success claims must be gated on authoritative recorded-action state. Final bank writes need observed completion or a recorded failure, rather than treating an always transition as evidence of execution.

No generated workflow was edited, judge verdict reclassified, model call made or practice run started during this review. Original evidence is in the run's practice.json and platform.jsonl. The competition kit's tools/run_cases.py combines score_ledger with the conversation verdict; tools/score.py requires the final close_call and expected ledger outcome.
