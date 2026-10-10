# Experiment record

- Hypothesis: Explicit effort configuration enables reproducible provider comparisons without changing default generation behavior.
- Baseline source hash / commit: Repository HEAD; exact pre-change sources are captured by run records.
- Candidate source hash / commit: Working tree; every generation records its source snapshot and effort configuration.
- Single intentional change: Optional reasoning effort through environment or CLI, forwarded to both transports.
- Model / call / time budgets: Existing explicitly selected model, request/invocation budgets and deadlines remain unchanged. Unset effort leaves provider defaults intact. Higher effort may consume more of the existing output budget.
- Development tasks and repetitions: Offline synthetic candidate API tests and Brief A synthetic CLI workflow fixtures. Validate effort-only and effort-plus-summary requests, default omission, Codex config forwarding, invalid values, environment selection, and flag precedence.
- Holdout tasks: No live or holdout evaluations performed.
- Organizer score definition and weighting: Unchanged; not evaluated.

| Task                           | Baseline score | Candidate score | Repetitions                       | Latency         | Failure change                  | Run paths            |
| ------------------------------ | -------------- | --------------- | --------------------------------- | --------------- | ------------------------------- | -------------------- |
| Synthetic API candidate        | null           | null            | effort with and without summaries | not benchmarked | request mapping checked         | offline test suite   |
| Brief A synthetic CLI workflow | null           | null            | environment and flag override     | not benchmarked | trace/config forwarding checked | temporary test files |

- Earliest consequential failure in the trace: Invalid effort fails before model execution. Unsupported model-specific effort is left to the selected provider to reject.
- Evidence supporting the proposed mechanism: Injected transports inspect the exact outbound configuration; CLI fixtures verify persisted effort.
- Regressions or missing cases: No evidence for task quality improvements; live provider compatibility is not tested.
- Uncertainty / suspected noise: Available levels vary by model and client.
- Decision: Expose configuration without selecting or promoting a new default effort.
- Reason: Keeps direct generation measurable and avoids unsupported performance claims.
