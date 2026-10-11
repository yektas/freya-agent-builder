# Practice result recovery

- Hypothesis: a simulation can finish after local polling expires. Fetching its recorded
  simulation, original sessions, judge results, and bank ledgers can recover evidence
  without another generation or simulation. A completed summary alone is insufficient.
- Baseline source: commit `c0d86de`, with unrelated workflow-name and UI changes present.
  The original practice job records its exact source snapshot. Those changes are preserved.
- Candidate source: the new recovery command, Python recovery adapter, and detailed-verdict
  validation. The repeated practice job records the exact current source files and hash.
- Intentional change: validate and retrieve practice evidence. Generation strategy and the
  uploaded workflow are unchanged.
- Budgets: zero builder model calls. Recovery defaults to three minutes, capped at five.
  The user requested one repeat of A / normal speech / one repetition, bounded at 30 minutes.
- Offline checks: injected GET-only recovery with the actual kit scorer; incomplete judge
  verdict refusal; history preservation; workspace lock ownership; unchanged generation and
  registration; stale registration refusal; recovery failure preserves prior artifacts.
- Holdouts: none. These checks do not evaluate generated-agent generalization.
- Organizer score: bank records AND transcript policy/honesty. Three successful repetitions
  are required for strict reliability; a one-repetition development check is not that score.

| Evidence                             | Score                    | Interpretation                                                        |
| ------------------------------------ | ------------------------ | --------------------------------------------------------------------- |
| Original local practice job          | null                     | Timed out at 25 minutes while the platform reported running           |
| First remote summary read            | 7/10 conversation passes | Platform summary, without bank scoring                                |
| Detailed remote runs during recovery | null                     | All ten outcomes were inconclusive despite completed status           |
| Recovered bank records               | 9/10 ledger matches      | Diagnostic evidence only; missing judge verdicts prevent a full score |
| Requested repeat                     | null, running at launch  | Same uploaded agent, A, normal speech, one repetition                 |

- Earliest failure: the runner waits for the remote simulation; its 25-minute local deadline
  expired before completion. The platform later reported completion at about 33 minutes.
- Additional evidence problem: the list and detail endpoints disagreed. The original kit
  scorer turns missing verdicts into failures. The initial recovered 0/10 raw output is
  retained in history but explicitly classified as invalid evidence; the visible score is
  null. Missing evidence has not been converted into success.
- Bank mismatch: PUB-07 recorded 2 November instead of the expected 27 October. This remains
  evidence to review even if other failures came from platform instability.
- Regressions: no new generated workflow or source-specific policy logic. Recovery accepts
  only completed original simulations with complete pass/fail verdicts and exact recorded
  case/persona mappings. Partial three-repetition jobs are not assigned strict scores.
- Decision: retain result-validity checks after offline verification. No builder-strategy
  promotion. Preserve both live attempts and assess the repeat before attributing failures.
- Artifacts: original generation `2026-10-11T10-51-52.562Z-ee15d27f-8047-4ee5-9871-2658bc61c62c`,
  original simulation `2fc82dd9-9111-44d5-aa67-22ba0591ae6e`, repeated simulation
  `55b0e37b-cb4c-4f6e-a108-3afbc1f2d2b2`. Practice history and platform traces remain under
  ignored `experiments/`; read-only diagnostic snapshots are in
  `experiments/diagnosis/2026-10-11-practice-recovery/`.
- Verification: the full offline suite passed 102 tests, formatting, lint, and backend/UI
  TypeScript checks. No live result is claimed from those checks.
