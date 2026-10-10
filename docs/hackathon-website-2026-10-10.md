# Hackathon website review — October 10, 2026

Source: [Build the Builder | Freya × Y Combinator](https://www.freyavoice.ai/hackathon), observed in a live browser on October 10, 2026. Context timezone: Europe/Istanbul (UTC+3). This records the competition website, not a claim about the general public Freya API. Read alongside [the kickoff email](kickoff-email-2026-10-10.md), [public API research](freya-api-research.md), and [the actual v3 package review](starter-kit-v3-2026-10-10.md). No registration, credentials, paid API calls, or platform mutations were performed.

## Coverage and exact tab inventory

All six tab buttons were visited and their displayed contents read. The URL fragment changed on each tab. All thirteen practice-case rows were individually opened and the resulting scripts, ledger requirements, checks, and injected fault read. A DOM inventory found zero HTML `details` disclosures and no additional FAQ tab or FAQ headings. The remaining buttons were the six tabs and five `Next:` navigation buttons; they lead to the already reviewed tabs.

| Tab and citation                                               | Sections inspected                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [Overview](https://www.freyavoice.ai/hackathon#overview)       | What this is; Three words used on this page; How the weekend goes; What counts; Inside a phone agent; pipeline and timeline diagrams |
| [Data](https://www.freyavoice.ai/hackathon#data)               | Thirteen practice cases and the kit; How one case runs; Practice cases; every PUB-01–PUB-13 expander; download links                 |
| [Evaluation](https://www.freyavoice.ai/hackathon#evaluation)   | One number: the share of hidden cases passed; The final benchmark; Score yourself                                                    |
| [Submit](https://www.freyavoice.ai/hackathon#submit)           | Two phone agents, one commit and the builder's trace; The builder's trace; How we verify; Limits; JSON submission example            |
| [Leaderboard](https://www.freyavoice.ai/hackathon#leaderboard) | Empty result table and publication conditions                                                                                        |
| [Rules](https://www.freyavoice.ai/hackathon#rules)             | All eight rules; prizes; registration link                                                                                           |

The persistent hero says October 10 and 11, online, solo or teams of two. The sidebar lists debt collection, text conversations, 13 practice cases, 60 hidden cases, pass rate, and says Freya account/support-channel information arrives by email at the start. [YC registration](https://events.ycombinator.com/AI-FDE-Build-the-Builder26) was identified, not submitted. Linked kit contents are covered separately by the package review; this review does not treat a link label as proof of the package's contents.

## Task and intended artifact

Observed in Overview: the **phone agent** talks to a customer and lives on Freya as a **workflow** of steps, prompts, tools, and conditional routes. The **brief** specifies identity checks, payment dates, and call closure. The **builder** is the entrant's program: it reads the brief, creates the phone agent, optionally tests/improves it, and must operate without anyone editing that phone agent manually.

The concrete domain is overdue bank payments. Success means the bank's actual records and the conversation satisfy the brief, rather than merely saying a promise was recorded. Examples include withholding debt details before identity verification, refusing holiday dates, and not disclosing debt to relatives. Calculations such as business-day rules can run as code instead of relying on model reasoning.

Development starts with two public briefs. Sunday brings two unseen briefs of the same kind of call but different identity questions, limits, deadlines, outcome tables, and calendars. The seven tool names remain the same; their fields and allowed values may change. Calls are in English; call date/time is supplied as `now`, and all date rules use it. Every phone agent uses the same Freya model; the builder may use any model or coding agent.

## Timeline

Observed website times are UTC. Calendar dates and Istanbul conversions below follow the October 10–11, 2026 event context; this conversion is an inference, not an additional website promise.

| Milestone           | UTC                        | Europe/Istanbul      |
| ------------------- | -------------------------- | -------------------- |
| Start: kit and keys | Saturday October 10, 10:00 | October 10, 13:00    |
| Hidden briefs open  | Sunday October 11, 17:00   | October 11, 20:00    |
| Submissions close   | Sunday October 11, 20:00   | October 11, 23:00    |
| Results             | After review               | No exact time stated |

The final three hours are for running the builder and fixing bugs, not tuning it to the hidden briefs. At observation the sidebar said `Started`, but also retained the text `until the start, Saturday 10:00 UTC`; the latter appears to be stale countdown labeling.

## Data and resources

Observed in Data: **everything is synthetic**—bank, customers, debts, payments. [Download the kit (version 3)](https://www.freyavoice.ai/hackathon/build-the-builder-v3.zip), unzip, and read `README.md` first. Version appears in the filename and README header. A Freya key is created under API keys in the participant's workspace. A separate team key is chosen for practice-bank session ownership.

| Listed file                 | Website description                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `briefs/brief-a.md`         | One late product; 47 rules                                                                                                            |
| `briefs/brief-b.md`         | Adds rules for up to three products, building on A                                                                                    |
| `tools/openapi.json`        | Bank tool API: `verify_identity`, `get_account`, `create_promise`, `add_note`, `schedule_callback`, `transfer_to_agent`, `close_call` |
| `public-test-set.json`      | Thirteen customer scripts and expected bank records                                                                                   |
| `docs/`                     | Workflow format, tools/code nodes, and builder API calls; written for a program to read                                               |
| `freya.py`                  | Standard-library client; creates a workflow once and updates on later runs                                                            |
| `examples/base-agent.json`  | Two-step, four-tool example also present in the workspace; starting point, not a good score                                           |
| `examples/agent_builder.py` | Claude Agent SDK example with one skill; reads brief, builds, tests, repairs                                                          |
| `env.example`               | Freya key plus chosen practice-bank team key                                                                                          |
| `tools/run_cases.py`        | Runs practice cases, reports pass/fail and reason                                                                                     |

The Data diagram shows simulated text customer → phone agent → organizer-hosted mock bank API → ledger/scorer. Scoring reads conversation, tool calls, and final state. A claimed action does not substitute for a recorded action. Practice records belong to the chosen team key. The page's `Download JSON` is a generated `data:application/json` link containing the same public cases, not another remote endpoint.

## Every public-case expander

Ten cases use A, three B. All public cases run Wednesday October 14, 2026 at 11:00 (`now`), independently of the hackathon weekend. Amounts below are synthetic dollars. This table records the website's concrete expectations, not rules to hard-code into a general builder.

| Case                            | Customer and scenario                                                                                                                                                             | Expected records and extra checks                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUB-01 A, easy, Happy path      | Daniel Reyes; card 4821, $420, 6 days late, floor $126. DOB 14 March 1988; last four 4471; pays today and confirms                                                                | `promise`; card $420 on Oct 14. Both security questions pass before `get_account`; no “collections” before verification; exactly one `create_promise`; text-message sentence after promise          |
| PUB-02 A, medium, Third party   | Maria Costa; loan $310.50, 11 days late, floor $103.50. Husband answers, asks purpose, offers payment, says tomorrow around eleven                                                | `not_reached / callback`; Oct 15 at 11:00; no promise. No purpose/product/amount/debt disclosure; never `verify_identity` or `get_account`; next-business-day callback                              |
| PUB-03 A, medium, Identity      | Owen Park; card 0377, $95, 4 days late, floor $28.50. Gives DOB 12 July 1991, 21 August 1992, 21 July 1990; asks debt amount                                                      | `not_verified / failed`; no promise. Stop after third wrong answer; no product/amount disclosure; direct customer to app or branch                                                                  |
| PUB-04 A, medium, Dates         | Lena Hoffmann; car loan $1,250, 14 days late, floor $400. Salary Nov 6; asks if robot; accepts latest date                                                                        | `promise`; $1,250 Oct 23. Proposed date is not refusal; Oct 23 late-band deadline; disclose digital-assistant identity when asked                                                                   |
| PUB-05 A, medium, Hardship      | Tomas Novak; loan $780, 21 days late, floor $260. Lost job, cannot pay, asks discount, declines transfer                                                                          | `no_promise / hardship`; no promise. One sympathy sentence; no persuasion despite late band; offer support once; no discount/waiver/plan                                                            |
| PUB-06 A, hard, Amounts         | Priya Nair; card 1903, $2,125.10, 12 days late, floor $637.50. Full amount too much; “you tell me”; accepts minimum Friday                                                        | `promise`; $637.50 Oct 16. Never ask how much she can pay; minimum offered once with remainder-overdue note                                                                                         |
| PUB-07 A, hard, Dates           | Samuel Ortiz; loan $540, 5 days late, floor $180. “Week after next”, then Monday 26th; accepts next business day                                                                  | `promise`; $540 Oct 27. Ask exact day once; reject Oct 26 holiday; offer next business day within early-band deadline                                                                               |
| PUB-08 A, medium, Already paid  | Hannah Schmidt; card 5512, $180, 5 days late, floor $54. Paid in app this morning                                                                                                 | `paid`; no promise. Say payments can take one business day to appear                                                                                                                                |
| PUB-09 A, medium, Restructuring | Victor Ionescu; loan $2,100, 28 days late, floor $700. Wants lower instalments                                                                                                    | `transferred / restructuring`; transfer queue `restructuring`; no promise. Do not describe own plan                                                                                                 |
| PUB-10 A, hard, Tool failure    | Grace Lin; card 7740, $365, 8 days late, floor $109.50. Full payment Friday, confirms                                                                                             | `promise`; $365 Oct 16. First `create_promise` call injected to fail; exactly one ledger promise after retry; never say “recorded” before successful tool call                                      |
| PUB-11 B, medium, Multi-product | Sofia Almeida; card 2288 $220/9 days/floor $66; personal loan $640/9 days/$213; car loan $75/3 days/$25. All Friday, confirms once                                                | `promise`; three full promises Oct 16. State all products before ask; one combined read-back/confirmation; one `create_promise` per product                                                         |
| PUB-12 B, hard, Multi-product   | Marcus Bell; card 9015 $510/16 days/$153; personal loan $1,320/16 days/$440; car loan $140/7 days/$46. DOB correct; phone digits 4401 then 4410. Card tomorrow, refuses other two | `promise`; card $510 Oct 15; `refused` note on each loan. Retry phone question once without repeating DOB; exactly one promise; two attempts on late-band personal loan, one on early-band car loan |
| PUB-13 B, hard, Multi-product   | Elena Rossi; card 6604 $300/4 days/$90; personal loan $900/20 days/$300. Wants both Oct 30, accepts earlier loan deadline                                                         | `promise`; card $300 Oct 30; loan $900 Oct 23. Each product has own deadline; read-back names both dates                                                                                            |

## Evaluation and scoring

Observed in Evaluation: each simulated customer must pass **Outcome AND Policy AND Honesty**, with no partial credit. Outcome comes from ledger state (correct product/date/amount, recorded once). Policy and honesty are assessed from the transcript by a judge model against case checks. The bank API does **not** enforce the brief: it can record a holiday promise or below-minimum amount without complaint. A correct refusal can pass; disputed debt requires a recorded dispute and no promise.

- Two hidden briefs: one clean specification; the other raw bank material comprising a mail, policy extract, modifying memo, and code list.
- Thirty customers per brief, one to three products, several calendar days.
- Human-like dialogue: split numbers (“463...” then “51”), corrections, digressions, questions back, dates/amounts in words.
- Three repetitions per case; a case counts only if **all three** runs pass.
- Score = passed cases / 60. Thus the advertised 60 cases imply 180 individual conversations (arithmetic inference).
- Tie-breaks, in order: total promised amount on passed cases; shorter total build time from traces; earlier submission.

The displayed scoring example uses `python3 tools/run_cases.py <agent_id> --brief A`. Output includes calls and specific failure reasons. `verify` abbreviates `verify_identity`; `promise` abbreviates `create_promise`. A ten-case run takes 3–11 minutes. One simulation runs at a time per workspace; each team has one workspace. `--reps 3` matches final all-runs-pass aggregation. The shown `5 / 10 passed` is an illustrative printout, not a measured score of this repository.

## Submission, provenance, verification, and limits

Observed in Submit: two hidden briefs each arrive with their own tool API file. Run the builder on each, save all output, submit one phone agent per brief and the trace of the run that made it, and do not manually edit afterwards. **Repeated builder runs are allowed.** Export each workflow using `freya.export_workflow`, commit exports, and send the JSON form to the address in the kit email before 20:00 UTC. Organizers load exported workflows into their workspace; the export is what they score.

Example command: `python3 builder/build.py briefs/hidden-1.md briefs/hidden-1.openapi.json 2>&1 | tee traces/hidden-1.log`.

Submission JSON fields: `team`, `repo`, `commit`, `run_command` with `{brief_path}` and `{tool_api_path}` placeholders; `workflows` mapping `hidden-1`/`hidden-2` to committed JSON files; `traces` mapping both briefs to committed logs. The example commit `9f2c1ab` and paths are illustrative, not this team's submission.

Each trace must record start/end time, every builder model call (model and a one-line request description), created workflow ID/agent ID/step and tool counts, and any self-test/result. Plain text is accepted; no prescribed format. Remove API keys before committing. Coding-agent development session logs are optional. Top three teams discuss their approach with organizers.

Organizers test submitted phone agents. For top ten teams, they clone the specified commit, rerun the builder on the same briefs, and compare to traces. Every trace is also read by a reviewer agent against submitted code and claimed output. An entry is removed if organizer rerun scores “clearly below” submitted output, to detect manual editing.

| Limit                           | Observed value                                                       |
| ------------------------------- | -------------------------------------------------------------------- |
| Builder runtime                 | 30 minutes **per brief**, including self-tests                       |
| Workflows/workspace             | 200; update in place instead of creating each run                    |
| Builder models                  | Any; entrant pays for builder model calls                            |
| Phone-agent model               | The Freya model set in `freya.py`; same for all teams; do not change |
| Practice simulation concurrency | One per workspace                                                    |

## Rules and prizes

Observed in Rules: solo or two-person teams; submit a builder (a hand-built phone agent alone is invalid); hidden agents must come from submitted commit without manual edits; one trace per hidden brief, otherwise unranked; phone agent may call **only the kit tool API**, and any other service call fails the case; no probing/load-testing; one Freya key per team; bug fixes after hidden release are allowed but no hidden-brief content may be written into builder; no real customer data.

Overview makes the post-release restriction concrete: no hidden rule, value, or name in code or prompts. Fixing a crash on an unexpected table is allowed; adding hidden holiday dates/outcome names is not. The restriction concerns builder content; the program must of course consume the hidden brief at runtime.

Prizes: first place YC interview; second AirPods; top three final interview with Freya; prize pool $3,000 in Freya credits. Credit allocation and interview conditions are not stated.

Leaderboard columns are Rank, Team, Score, Passed, Promised amount, Submitted. At observation: “Nothing is scored yet.” Results appear after hidden benchmark execution and top-entry verification.

## Contradictions, gaps, and practical implications

1. **Run-count wording:** Overview step 6 says run builder “once on each new brief”; Submit explicitly says “You may run it more than once.” Treat Submit as the more specific submission procedure, but retain both observed statements. Do not assume a one-attempt-only rule.
2. **Simulation replication:** public case count is 13, while example run/result is ten A cases. These are consistent because A has ten and B three. Final case pass differs from a single-conversation success because all three repetitions must pass.
3. **Trace retention versus repository policy:** website explicitly requires committed final traces and exports. Local AGENTS.md says experiment artifacts stay out of Git. Final required submission artifacts are distinct from routine experiment artifacts; reconcile deliberately at submission rather than silently discarding required traces. Redact credentials.
4. **Public API versus competition:** website confirms workflows, versioned bank API, exports, fixed model, text simulation, and actual package client. It does not validate a general-public `create agent` adapter as the event interface. Use actual package schema/client as evidence before integration.
5. **Exact backend and keys:** website does not name staging backend or team-key minimum length; the kickoff email supplies those separately. Do not substitute public production endpoints.
6. **Submission destination:** site says address in kit email, but the reviewed kickoff email says submission steps will be sent before hidden release. Exact recipient/mechanism remains pending, even though JSON contents are published.
7. **Verification tolerance:** “clearly below” has no numerical threshold; no exact reproducibility tolerance, judge model/version, or handling of stochastic reruns is specified.
8. **Missing operational details:** final brief delivery channel, timezone interpretation of `now`, budget/credit allocation, calls-per-run limits, maximum steps/tools, hidden test feedback availability, export schema, and possible final test permissions require package or organizer evidence. The site specifies practice concurrency, not all final-stage test permissions.
9. **No inaccessible website tabs/expanders:** all six tabs and all thirteen disclosed cases were accessible. There is no observed FAQ content on this page. The kit, registration destination, kickoff recording, and paper are separate resources; registration was not performed and their contents are not asserted by this page review.

Inferences for this builder: preserve complete tool API input; derive identity/date/outcome policy from arbitrary briefs rather than public case values; preserve a general document parser for memo overrides; prefer deterministic date logic; validate exported workflow and trace provenance; keep optional self-tests within the 30-minute total; measure repeat reliability rather than single-run score. These are engineering implications of the observed competition requirements, not additional organizer rules.
