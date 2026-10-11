# Workflow naming and direct links

- Hypothesis: brief-derived workflow names and direct workflow URLs make a completed upload easier to identify and open without changing the generated workflow or its evaluation.
- Baseline source hash / commit: `c0d86dee558f9bc4931323adaef4912cf1b27d98`.
- Candidate source hash / commit: working-tree diff fingerprint `517d82f6b19019084ea0144edaca4d69544c0d61a5bc86d9bfc2d2abfeafad3f` (application code only; no commit yet).
- Single intentional change: name newly registered workflows from their brief filenames and generation timestamp, persist a direct Freya URL using the returned workflow and workspace IDs, and resolve that URL at read time for older registered records that predate the field.
- Model / call / time budgets: zero builder model calls and zero Freya calls; local offline check only.
- Development tasks and repetitions: synthetic one-brief and multi-brief run records; default staging route, explicit route override, credential-bearing URL fallback, and a legacy registered record without `workflowUrl`; `pnpm run check` passed (105 tests).
- Holdout tasks (evaluate only at the planned checkpoint): none; this changes upload metadata and inspector navigation only.
- Organizer score definition and weighting: not applicable; the generated workflow JSON and official score inputs are unchanged.

| Task                         | Baseline score | Candidate score | Repetitions | Latency      | Failure change                                                                       | Run paths                 |
| ---------------------------- | -------------- | --------------- | ----------- | ------------ | ------------------------------------------------------------------------------------ | ------------------------- |
| Synthetic one-brief upload   | null           | null            | 1           | offline test | Readable name and direct route asserted                                              | `tests/ui-upload.test.ts` |
| Synthetic multi-brief upload | null           | null            | 1           | offline test | Combined brief label asserted                                                        | `tests/ui-upload.test.ts` |
| Legacy registration refresh  | null           | null            | 1           | offline test | Detail response resolves the link without mutating `upload.json` or contacting Freya | `tests/ui-upload.test.ts` |

- Earliest consequential failure in the trace: none observed in the offline contract tests.
- Evidence supporting the proposed mechanism: tests assert the exact name sent to Freya and the fully resolved deep link returned and reloaded from the upload record; the legacy detail API synthesizes the same direct route without rewriting the record or making a platform request; credential-like URL parameters are not served.
- Regressions or missing cases: no agent-generation regression is expected; no live staging request was made.
- Uncertainty / suspected noise: the user supplied the staging SPA route; its availability was not probed live.
- Decision: promote for inspector use.
- Reason: the change affects workflow naming and navigation metadata only, with no model or evaluation behavior change.
