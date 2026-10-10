# Experiment record

- Hypothesis: Forcing the OpenAI provider bypasses the user's `codex-lb` configuration, while buffering JSONL until process exit hides useful CLI activity.
- Baseline source hash / commit: Existing working tree; generation records retain the exact source snapshot.
- Candidate source hash / commit: Working tree with provider configuration preserved and live JSONL callbacks.
- Single intentional change: Honor the configured Codex transport and expose its activity without altering generation instructions, original task/tool fields, schema, or compilation.
- Model / call / time budgets: One CLI invocation per generation, existing 300-second deadline. Two small diagnostic-only calls used `gpt-6.1-sol`, low effort, and a 45-second deadline each; both returned the requested boolean. These are not workflow evaluations.
- Development tasks and repetitions: Offline synthetic provider and Brief A CLI fixtures; live diagnostic boolean only. Streaming before transport completion, private-text exclusion, safe provider errors, and recovered retry events covered.
- Holdout tasks: No organizer evaluation performed.
- Organizer score definition and weighting: Unchanged; no benchmark scores available.

| Task                                        | Baseline score | Candidate score | Repetitions   | Latency         | Failure change                                                          | Run paths                                                                              |
| ------------------------------------------- | -------------- | --------------- | ------------- | --------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Original Brief A run                        | null           | null            | 1 baseline    | 215s            | Baseline failed without a useful diagnostic                             | `experiments/generation/2026-10-10T16-21-08.117Z-37d2088e-3bf7-4d72-a6c1-c4e00b057d6e` |
| Synthetic transport and CLI fixtures        | null           | null            | offline tests | not benchmarked | Activity visible before exit; terminal failures still reject candidates | temporary fixtures                                                                     |
| Diagnostic boolean with configured provider | null           | null            | 1 candidate   | under 45s       | Configured provider path completed                                      | terminal-only diagnostic                                                               |

- Earliest consequential failure in the trace: Baseline bypasses user provider configuration before invoking Codex; activity is buffered until exit.
- Evidence supporting the proposed mechanism: CLI arguments explicitly ignored user config and forced OpenAI. User config selects `codex-lb`. Updated invocation completed the diagnostic call and reported acceptance before completion.
- Regressions or missing cases: No cross-task workflow quality comparison. External credential environment variables remain filtered; this configured provider uses Codex's saved authentication. CLI tools remain restricted, including MCP server overrides, read-only execution, and disabled shell/web search.
- Uncertainty / suspected noise: The baseline's discarded diagnostics prevent attribution of its particular terminal failure. Successful boolean diagnostics do not establish workflow reliability.
- Decision: Promote provider configuration and progress correction only; no generated-agent performance claim.
- Reason: Restores the selected transport and accurate progress while retaining deadlines and completion validation.
