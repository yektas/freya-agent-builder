# Date validation experiment

- Hypothesis: separating proposed-date validation from dialogue selection will stop
  the agent from applying the deadline rule to an excluded day inside the allowed
  interval. It must also preserve correct dates, corrections, and per-product terms.
- Baseline source hash: `c9fa466ba798ea8b4f3f784ec674a88dda471fe698442b50fe7de8f4d5bc32bf`.
  Baseline generation was built from a dirty checkout; its saved source snapshot is
  authoritative. It is the direct strategy, before explicit strategy metadata.
- Candidate source hash / commit: saved in the ignored
  `experiments/diagnosis/2026-10-11-validated-dates/candidate-source.json` snapshot.
  This matches the first authorized live generation's source. The run records its
  own exact source and instructions hash. Revision v2 has a separate snapshot.
- Single intentional change: append source-derived date-validation and confirmation
  instructions under `--strategy validated-dates`. The direct instructions, original
  inputs, compiler, tool schemas, and phone-agent model are unchanged by this candidate.
  Provenance and submission wiring make selection reproducible.
- Model / call / time budgets: match baseline builder `gpt-6.1-sol`, API default
  reasoning effort, one call, 24,000 output tokens, five-minute generation deadline.
  Full run remains capped at 30 minutes. The user subsequently authorized one fresh
  generation and one A / in_words / one-repetition test, up to $5. The generation
  consumed that one-call allowance; no simulation or second generation was started.
- Development tasks and repetitions: first compare original A inputs with A /
  in_words / one repetition, matching the latest completed baseline. Inspect PUB-07
  and every A case. Treat this as a development check, not strict reliability evidence.
- Next checkpoint: generate direct and candidate agents from identical A+B inputs;
  evaluate identical cases, styles, and repetitions. An A-only build cannot serve as
  the baseline for an A+B candidate. Use three repetitions and speaking-style
  variations (`in_words`, `corrects`, `pieces`) for the strongest candidate. Generate
  a second agent with the same candidate strategy before promotion.
- Holdout tasks: none evaluated yet. Public cases guide development. At the planned
  checkpoint include source-supported date variations: weekend/holiday inside the
  interval, after-deadline proposal, ambiguous relative date, correction after
  confirmation, products with different deadlines, and no permitted replacement.
  Label any added fixtures synthetic. Hidden briefs remain unseen.
- Organizer score: a case needs both correct bank records and transcript compliance.
  Strict reliability requires all three repetitions to pass. Compare matching groups
  by passed cases, then promised amounts on passing cases, then total build time.

| Task                   | Baseline score           | Candidate score    | Repetitions                 | Latency                      | Failure change                            | Run paths                                                                                                              |
| ---------------------- | ------------------------ | ------------------ | --------------------------- | ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A / in_words           | 6/10 development passes  | null               | 1 baseline; 0 candidate     | 419,144 ms baseline practice | null; candidate not run                   | generation `2026-10-11T10-51-52.562Z-ee15d27f-8047-4ee5-9871-2658bc61c62c`; job `c7c93599-2315-4fdf-bb7e-f2f8b50c7c9a` |
| Candidate build v1     | completed baseline build | null; failed build | 1 generation; 0 simulations | 300,056 ms generation        | generation deadline; no complete workflow | generation `2026-10-11T13-15-18.639Z-5a8ee333-ef77-45a2-ba73-06156b9cb92b`                                             |
| Matched A+B            | null                     | null               | not run                     | null                         | null                                      | null                                                                                                                   |
| Second fresh candidate | null                     | null               | not run                     | null                         | null                                      | null                                                                                                                   |

- Earliest consequential failure: PUB-07 proposes Monday 26 October. The agent
  immediately offers Monday 2 November, then records that date after agreement.
  The original A policy requires the next business day for an excluded day inside
  the deadline: 27 October in this case. These dates document evidence only; the
  reusable strategy contains no public dates, limits, or holiday constants.
- Mechanism evidence: generated calendar code and the negotiation prompt already
  contain the correct rule. The dialogue chooses the replacement without validating
  the actual proposal. No recorded model-generated Python was executed locally.
- Regressions or missing cases: PUB-03 and PUB-09 stop during identity checks with
  long turns; PUB-10 has correct ledger evidence but an official transcript failure.
  Preserve all official failures. This experiment targets the repeated date defect;
  it does not establish a cause or fix for those other failures.
- Uncertainty / suspected noise: platform recovery had inconsistent results in prior
  attempts. Long turns and judge interpretation may affect results. Report these
  separately from date mistakes, without converting official failures into passes.
  Additional code nodes could increase latency, omit a source exception, or produce
  broken routing. Offline injected outputs do not prove generated date correctness.
- Offline validation: verify unchanged direct instructions, actual CLI candidate
  request and hash, original inputs, one-call/token/deadline limits, invalid selection
  rejection, matched comparison grouping, and strategy-pinned submission commands.
  Scores remain null for synthetic and untested candidates.
- Verification result: `pnpm run check` passed all 103 offline tests, formatting,
  lint, and backend/UI type checks. The HTTP tests required loopback access outside
  the restricted sandbox. `git diff --check` passed. These checks made no live calls.
- First live result: the API accepted the request in 1,203 ms and the first draft
  arrived in 28,096 ms. The response continued until the five-minute abort. The saved
  incomplete draft has 54,411 characters and 30 node declarations; the baseline has
  12 compiled nodes and completed in 160,996 ms. These are diagnostic counts, not a
  valid candidate graph or a behavior score. Graph growth is supported by this draft;
  a single attempt does not establish which instruction or model variation caused it.
- Cost: conservative builder estimate was $0.578150 using one-token-per-UTF-8-byte
  input plus the maximum output budget. The aborted response supplied no final token
  usage, so actual billed cost is unknown, not zero. The estimate uses the saved local
  rate table and may differ from proxy billing. No Freya simulation was started.
- Offline revision v2: ask for shared date stages and validation code, shorter node
  messages, and no unrelated graph expansion. Preserve source obligations. The original
  v1 source and request are retained; v2 has a separate source snapshot and instruction
  hash under `experiments/diagnosis/2026-10-11-validated-dates/`. No live v2 call started.
- Decision: reject v1 as a usable candidate under the current generation deadline;
  retain the compactness revision as experimental. No promotion.
- Reason: date validation is supported by repeated failure evidence, but v1 did not
  complete a build. No fresh generated candidate has been evaluated. Promote only
  after matched evaluation fixes
  PUB-07 with no unexplained regressions, reliability checks pass, and a second fresh
  build repeats the improvement. Reject or revise if those criteria fail.
