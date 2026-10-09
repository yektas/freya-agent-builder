# Event-day runbook

## First hour: establish the contract

1. Save the organizer package and record the rules version. Confirm the actual deadline and timezone.
2. Record the exact builder entry point, input envelope, output artifact, tool binding format, and credential injection mechanism. Mark unsupported assumptions in the original handoff as superseded.
3. Confirm permitted external model APIs, generation and runtime limits, final-task simulation privileges, score weighting, and tie-breakers.
4. Inspect one practice task and one complete tool catalog. Keep original source fields intact when mapping to internal contracts.
5. Implement boundary translation and the final selected-agent registration step. Confirm that each tool is attached, not merely mentioned in a prompt.
6. Connect the practice evaluator. Verify a real trace demonstrates a tool call with correct arguments and a returned result.
7. Run a direct baseline and save the official score, trace, and exact builder version. This is the first performance milestone.

## Experiment sequence

Reserve a task-family holdout where enough practice data exists. Keep its detailed failure traces out of the tuning loop until a scheduled check. Synthetic fixtures in this repository are plumbing examples, not the holdout benchmark.

| Variant | Change                          | Question                                                              |
| ------- | ------------------------------- | --------------------------------------------------------------------- |
| A       | Direct generation, audit off    | How good is the minimum baseline?                                     |
| B       | Planned generation, audit off   | Does explicit analysis improve task success enough to justify a call? |
| C       | Direct generation, report audit | Do audit flags correlate with real failures?                          |
| D       | Direct generation, repair audit | Do repairs improve official scores without costly regressions?        |

Compare the same cases with equal limits, repeat close results, and preserve the best measured version. Run holdout checks when promoting substantial changes. Add conventional LLM critique or Jev only when the first comparisons justify further investment.

## Failure triage

For each failed case, record the earliest consequential divergence and classify it:

- Input/adapter: malformed payload, missing tool binding, bad credential or model config.
- Interpretation: missed exception, invented requirement, capability mismatch.
- Tool use: wrong tool, arguments, prerequisites, or result interpretation.
- State/recovery: stale information, repeated write, changed user request, timeout ambiguity.
- Completion: premature success, unnecessary questions, failure to stop.
- Infrastructure: latency, budget exhaustion, transport failure, invalid submission.

Separate builder failures from platform failures and runtime-agent mistakes. Propose one generalizable change with a predicted effect; test it before expanding the architecture.

## Submission freeze

Reserve the last 20% of available event time for this step.

1. Freeze source, prompts, models, config, and pinned dependencies at the best verified version.
2. Run from a clean directory with only documented files and injected credentials.
3. Verify the evaluator's entry point and output channel exactly; local CLI logs are not necessarily its contract.
4. Verify invalid inputs, unavailable optional audit, deadline, and call-limit behavior.
5. Confirm that no fixture answers, local paths, or undeclared service dependencies are required.
6. Record the exact code revision and reproduce one practice run before submission.
