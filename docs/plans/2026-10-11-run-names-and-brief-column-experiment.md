# Inspector run names and brief column

- Hypothesis: stable `v1`, `v2`, … labels and the source brief heading in the run table make recorded generations easier to compare without changing the generated agent.
- Baseline source hash / commit: `c0d86de` plus pre-existing uncommitted workspace changes; the starting dirty tree was not fingerprinted separately.
- Candidate source hash / commit: SHA-256 `2b13423cec95063de1daecf4d2ab2eda35c9c749cb09622a11c1a23c26538e35` over the touched implementation file hashes; no commit created for this UI change.
- Single intentional change: name inspector generations sequentially and show each recorded task's brief name in the run table. Generation continues to use the configured event package and its default Brief A input.
- Model / call / time budgets: no added model calls or time; direct generation remains one call with the existing 300-second generation deadline.
- Development tasks and repetitions: offline inspector fixtures with an injected generation runner; no live model or Freya calls.
- Holdout tasks (evaluate only at the planned checkpoint): none; this metadata change does not alter agent behavior.
- Organizer score definition and weighting: not applicable to inspector metadata; no benchmark score is claimed.

| Task                                 | Baseline score | Candidate score | Repetitions                  | Latency | Failure change | Run paths                                                |
| ------------------------------------ | -------------- | --------------- | ---------------------------- | ------- | -------------- | -------------------------------------------------------- |
| Inspector labeling and brief display | null           | null            | 1 synthetic fixture sequence | null    | null           | temporary test fixtures; no retained benchmark artifacts |

- Earliest consequential failure in the trace: none observed in the offline fixture flow.
- Evidence supporting the proposed mechanism: run labels are persisted in generation config and allocated from a private sequence file; brief headings are read from the recorded task; legacy generation records receive chronological labels in the inspector view.
- Regressions or missing cases: live agent quality and official practice scores were not evaluated because generation inputs and prompt behavior are unchanged.
- Uncertainty / suspected noise: no user workflow observation yet; brief names fall back to source filenames when a recorded task lacks heading text.
- Decision: promote the inspector metadata change after the required repository check; do not treat it as an agent-performance improvement.
- Reason: the change makes run identity and task provenance visible while leaving generation and scoring behavior intact.
