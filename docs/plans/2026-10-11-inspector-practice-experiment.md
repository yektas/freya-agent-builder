# Experiment record: inspector practice integration

- Hypothesis: Existing uploaded generations can be evaluated through the official scorer without regeneration or registration.
- Baseline source hash / commit: Existing generation/upload inspector; source versions preserved in each generation record.
- Candidate source hash / commit: Practice jobs capture exact runtime source, scorer/kit files, and input hashes at test start.
- Single intentional change: Add a separate asynchronous test-and-score action for recorded uploaded agents.
- Model / call / time budgets: Zero builder model calls; official simulations/judge only; 25-minute default deadline, bounded at 30 minutes server-side.
- Development tasks and repetitions: Offline synthetic bridge fixtures; original client/scorer injected-transport lifecycle; one and three repetition contracts.
- Holdout tasks (evaluate only at the planned checkpoint): None run; this changes evaluation infrastructure, not the builder policy.
- Organizer score definition and weighting: Ledger correctness plus conversation policy/honesty; all three repetitions must pass when three are selected.

| Task                   | Baseline score | Candidate score | Repetitions | Latency | Failure change                                                           | Run paths                          |
| ---------------------- | -------------- | --------------- | ----------- | ------- | ------------------------------------------------------------------------ | ---------------------------------- |
| Brief A live           | null           | null            | 0           | null    | Not evaluated live                                                       | null                               |
| Brief B live           | null           | null            | 0           | null    | Not evaluated live                                                       | null                               |
| Synthetic UI contracts | null           | null            | 1 and 3     | null    | Verified aggregate verdicts, failure preservation, and access boundaries | Temporary offline test directories |

- Earliest consequential failure in the trace: Not applicable to builder behavior; synthetic errors deliberately injected.
- Evidence supporting the proposed mechanism: Service calls only workspace probe and practice; original registration and generation records remain unchanged.
- Regressions or missing cases: Live A/B scores and hidden-task performance remain unmeasured. Long three-repetition runs may exceed the bounded deadline.
- Uncertainty / suspected noise: Practice simulations vary; one passing run is not proof of repeat reliability.
- Decision: Promote the evaluation interface after offline checks; no builder-performance promotion.
- Reason: Enables measurement without modifying the generated policy. No benchmark gain is claimed.
