# Final blueprint parser recovery

- Hypothesis: the final-case builder draft is structurally usable, but two unescaped inner quotes and the documented `code_exec` action form stop local compilation before Freya validation.
- Baseline source hash / commit: `9d0cf13` with the case-folder strategy; recorded JSON-only run `2026-10-11T17-41-26.502Z-98cd46c9-9b25-4fd6-8b04-f3780bbf213d`.
- Candidate source hash / commit: `848c664`; clean final-run commit `46f61f5` contains the same compiler and tests plus a fixture-description correction.
- Single intentional change: accept narrowly located unescaped quotes in an otherwise JSON-encoded workflow string and normalize the documented platform `code_exec` pre-action to the builder's Python-source shorthand. Neither step derives task facts or changes the model-authored Python source.
- Model / call / time budgets: no extra model call for the offline replay; live final runs retain one generation call and a 30-minute total deadline. Registration remains separate from local compilation.
- Development tasks and repetitions: one replay of the recorded failed draft through the updated compiler, plus two synthetic compiler regression fixtures. No mock or fixture score is treated as a benchmark.
- Holdout tasks: the fresh clean-source final case run; hidden final conversations are unavailable.
- Organizer score definition and weighting: hidden final score is unpublished. Local parsing, syntax checking, and Freya validation are structural signals only.

| Task                             | Baseline score | Candidate score | Repetitions | Latency   | Failure change                                                                     | Run paths                                                                              |
| -------------------------------- | -------------- | --------------- | ----------- | --------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Recorded final-case draft replay | null           | null            | 1 offline   | under 1 s | JSON parse and code-action shape errors removed; 25-node workflow compiles locally | `experiments/generation/2026-10-11T17-41-26.502Z-98cd46c9-9b25-4fd6-8b04-f3780bbf213d` |
| Synthetic compiler fixtures      | null           | null            | 1 each      | under 1 s | malformed delimiters and unknown code actions still fail                           | `tests/workflow.test.ts`                                                               |
| Fresh final case                 | null           | pending         | 1           | pending   | Clean-source builder run in progress                                               | `experiments/a5b8df24-88d9-404a-aca6-50995ee76cce`                                     |

- Earliest consequential failure in the trace: `workflowJson` failed JSON parsing at an unescaped quote inside a Python source string. After that was fixed, three code nodes used the platform's full `code_exec` action shape, which the local compiler had rejected.
- Evidence supporting the proposed mechanism: the source bytes around position 12265 show the quoted literal; replay through the updated compiler produces a 25-node workflow. Python AST parsing accepts all three recovered code sources.
- Regressions or missing cases: no live final-case behavior has been measured. The recovered draft is diagnostic only and is not a selected submission run.
- Uncertainty / suspected noise: the provider may generate a different draft in the fresh run. Local compilation does not prove runtime variables, routing, service responses, or Turkish speech quality.
- Decision: retain the general compiler recovery, pending the fresh run's validation and export. Do not promote any practice routing strategy from this result.
- Reason: the recovery preserves authored content and the original task/tool boundary while preventing a known syntax and wrapper mismatch from discarding a paid build.
