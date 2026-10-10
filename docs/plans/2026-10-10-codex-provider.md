# Experiment record

- Hypothesis: A selectable Codex CLI transport can use ChatGPT subscription allowance while preserving direct API generation for later comparisons.
- Baseline source: Current repository HEAD before this change; each run records exact source snapshots.
- Candidate source: Working tree with `src/codex.ts` and provider selection; each run records exact source snapshots.
- Single intentional change: Transport selection. Original inputs, generation instructions, output schema, and local compilation remain shared.
- Model / call / time budgets: Explicit model per provider; existing deadlines. OpenAI retains its output-token cap and one-request budget. Codex permits one CLI invocation; the CLI controls internal inference limits and retries, so this is not an equivalent one-inference/token-capped baseline.
- Development tasks and repetitions: Synthetic candidate provider fixture and Brief A workflow CLI fixture, with injected offline transports. API regression tests retained. Cancellation, missing completion, failed turns, malformed output, tool use, budget exhaustion, environment provider selection and flag override covered.
- Holdout tasks: No live tasks evaluated. Cross-task organizer evaluation is required before claiming or promoting performance gains.
- Organizer score definition and weighting: No change; no organizer evaluation performed.

| Task                                   | Baseline score | Candidate score | Repetitions                                      | Latency         | Failure change               | Run paths            |
| -------------------------------------- | -------------- | --------------- | ------------------------------------------------ | --------------- | ---------------------------- | -------------------- |
| Synthetic provider fixture             | null           | null            | offline test suite                               | not benchmarked | completion-only validation   | temporary test files |
| Brief A with synthetic workflow output | null           | null            | 2 Codex CLI fixture runs plus existing API tests | not benchmarked | provider selection validated | temporary test files |

- Earliest consequential failure: Missing or failed CLI completion prevents compilation.
- Evidence: Offline transport and CLI tests check schema/input preservation, provider provenance, credential exclusion, and rejection of incomplete output.
- Regressions or missing cases: Live ChatGPT authentication/model access and subscription exhaustion have not been exercised. Incremental API streaming/reasoning summaries are not supported by this Codex path. Codex cannot enforce the Responses output-token cap.
- Uncertainty: Provider/model changes may alter output quality and latency. Structural checks are not benchmark scores.
- Decision: Keep API as the default; expose Codex as an explicit opt-in transport, with no automatic API fallback.
- Reason: Enables cost-source selection without claiming quality improvements or consuming live allowance during tests.
