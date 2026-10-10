# Official starter kit v3 review — 10 October 2026

Read-only review of the actual event package. No bundled code was executed, no credentials were read, and no platform or bank API was called. These are package findings, not independently measured benchmark results.

## Provenance and inventory

- Source: https://www.freyavoice.ai/hackathon/build-the-builder-v3.zip
- Downloaded 10 October 2026; archive size 59,892 bytes.
- Archive SHA256: `655cbe581b0b0a7fba1f62ebd7d8c806edcfcc43f4d4fd47a27dca1e2534413a`.
- `README.md` identifies kit version 3, dated 10 October; `VERSION` is the version marker. Bank OpenAPI is 3.0.3, API version `0.3-draft`.
- Archive paths were checked for absolute paths and `..` before extraction to `/tmp/freya-v3-review`. README was read first, as requested by kickoff instructions.

All paths below refer to `build-the-builder/` inside that archive. Preserve these source files and their original schemas; this note is not a substitute schema.

| Files                                                              | Purpose                                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `README.md`, `VERSION`, `env.example`                              | Rules, setup, version, credential variable names                                  |
| `briefs/brief-a.md`, `briefs/brief-b.md`                           | 47-rule single-product brief; additive multi-product brief                        |
| `tools/openapi.json`                                               | Authoritative original bank request/response schemas                              |
| `public-test-set.json`                                             | 13 synthetic practice customers, scripts, checks, expected ledgers                |
| `freya.py`                                                         | Standard-library staging client; registration, publication, export, simulation    |
| `tools/run_cases.py`, `tools/score.py`                             | Persona generation, practice sessions, simulations, ledger and transcript scoring |
| `docs/api.md`, `docs/workflow-format.md`, `docs/tools-and-code.md` | Event workflow API and execution contracts                                        |
| `examples/base-agent.json`, `examples/agent_builder.py`            | Example agent and Claude SDK builder                                              |
| `.claude/skills/build-phone-agent/SKILL.md`                        | Builder's workflow-building/testing instructions                                  |

## Ten-minute start (documented, not performed)

Python 3.10+; copy `env.example` to `env.sh`, set variables, source it. Register `examples/base-agent.json` with `freya.save_workflow('base', ...)`, then `python3 tools/run_cases.py <agent_id> --brief A`. A ten-customer simulation takes 3–11 minutes. Install `claude-agent-sdk` and run `python3 examples/agent_builder.py briefs/brief-a.md`; pass both A and B for B because B depends on A. Example builder additionally requires Claude login or `ANTHROPIC_API_KEY`.

Kickoff email adds: workspace already contains **Freya Bank Collections Base**; use `FREYA_API_KEY` from the staging app in `env.sh`. Do not create a duplicate merely to inspect that base. `FREYA_BANK_TEAM_KEY` is a team-chosen secret of at least 16 characters, kept consistent across runs.

## Actual competition contract

The builder reads brief file(s), plus the corresponding tool API file, and autonomously creates a **phone-agent workflow**. Final briefs each have their own OpenAPI file; seven tool names remain, but fields and allowed values can change. A final brief may be clean specification or raw bank material combining email, policy, amendment memo, and codes. Final customers may have three products and use speech-like dates, corrections, interrupted numbers, questions, and irrelevant details.

The output ultimately scored is the exported, platform-stored workflow, not our internal generated `AgentSpec`. Export via `freya.export_workflow(workflow_id, '<brief>.workflow.json')`: wrapper contains workflow/agent ids, update timestamp, and `workflow`. Submit exported files, builder code, and one builder trace per final brief. Export loading into organisers' workspace is the scoring boundary.

Event platform is `https://staging-app.freyavoice.ai`, bearer workspace API key and browser-like User-Agent. It uses singular `/api/v2/workflow` and `/api/v2/call/{callId}`. Creation `POST /api/v2/workflow` takes `{name, workflow}` and creates the associated agent, returning `result.workflow.id` and `.agentId`. Dry run adds `?dryRun=true`. Updates replace the entire workflow and **must be published** via version endpoints; `save_workflow`/`update_workflow` do this. Slot state `.freya-agents.json` reuses one workflow. `workspace_id()` uses `FREYA_WORKSPACE_ID` if set, otherwise first workspace; our implementation should select the explicit intended workspace.

Public API research describes `app.freyavoice.ai`, `/agents`, and `/calls`; it did not establish this workflow contract or tool wiring. Do not reuse those public routes as the event adapter. Our local compiler and separate selected-agent registration remain useful architecture, but require an explicit workflow compiler/export boundary rather than treating generic internal fields as Freya JSON.

## Scoring and hard constraints

A customer passes only if exact bank ledger outcomes/promises/notes/callbacks/transfers match, conversation follows policy, and statements are honest. Ledger scoring compares product ids, amounts rounded to two decimals, dates and note reasons; judge model checks transcript criteria. No partial credit. Bank records, not the agent's claims, determine outcomes. Final customers run three times across several calendar days; **all three must pass**. Tie order: total promised amount on passing customers, shorter build time, earlier submission.

- No manual step in builder execution; no hand-editing produced phone agents.
- Phone agent must use `AGENT_LLM` in `freya.py`: default provider/model `experimental-5`. Environment overrides are described for organisers, not permission for teams to change it. Builder may use any model or coding agent.
- Phone agent calls only bank tool API; workflow code steps and hooks are permitted and expected.
- Workspace cap 200 workflows; update existing slots rather than creating on every repair/run.
- One simulation at a time **per workspace**. Calls inside a simulation can be concurrent (client default five); these are distinct limits.
- Builder max 30 minutes per brief, including its own tests. Multiple builder runs are permitted; submit one selected run and its trace.
- After unseen briefs open, builder crash/format bug fixes allowed; no final rule, value or name may be manually written into code or prompts. Brief-derived generated workflow content is the builder's job.
- All data synthetic; real customer data prohibited.

Kickoff email schedule (not present in archive): hidden briefs Sunday **11 October 2026 17:00 UTC / 20:00 Istanbul**; submissions **20:00 UTC / 23:00 Istanbul**.

Trace must include start/end, every builder model call (model and one-line purpose), created Freya artifacts, and tests. Example logs SDK messages to `traces/<timestamp>.jsonl`; our own trace needs these explicit fields and exact input/config/source hashes. Avoid auth headers and secrets in trace or tool-event dumps: `function_call_start` can include full HTTP headers/body.

## Bank authentication and schema boundary

Original schemas: `tools/openapi.json#/paths`, seven POST paths: `verify_identity`, `get_account`, `create_promise`, `add_note`, `schedule_callback`, `transfer_to_agent`, `close_call`. Base URL `https://freya-bank-mock.freyavoice.workers.dev/v1`.

**In-call tools require no API/team key.** Their `customer_id` is the secret for one call, supplied through call variables and sent on each tool request. No need to bake workspace bearer key or team key into workflows. Practice creation `POST /v1/practice/sessions` and ledger `GET /v1/practice/ledger/{customer_id}` use `x-team-key: FREYA_BANK_TEAM_KEY` in `score.py`; they are evaluation infrastructure, not extra agent tools.

Service intentionally does not enforce the brief: it accepts holiday/late promises. The generated agent must enforce policy. HTTP 200 may contain `ok: false`; HTTP transport success/counters do not prove business success. Schema's HTTP 500 says nothing recorded, repeat permitted. Avoid automatic retries that duplicate writes; encode brief-specific retry rules explicitly. Product ids must come from `get_account`, never invented.

Brief A uses supplied `now`, not wall clock; ordered identity questions, strict pre-verification privacy, business-day arithmetic, amount floors, persuasion budgets, confirmation-before-write, one promise/product, and exactly one final `close_call`. B changes per-product deadlines, collective confirmation, partial success/notes and transfer precedence. Transfers forbid notes entirely, even before transfer: defer notes until transfer is excluded. Do not hardcode practice holidays, identity fields, queue/outcome names, values, or order into the reusable builder.

## Workflow and tool execution implications

See original `docs/workflow-format.md` and `docs/tools-and-code.md` for complete schemas and examples.

- Graph requires `initial_node` and `nodes`. Separate extraction, routing, dialogue model calls have separate contexts; dialogue prompt routing instructions alone have no effect.
- Four relevant node types: conversation (`tools`), api_request/code (`pre_actions`), end_call (`terminal`). Wrong-type fields are silently stripped; read stored workflow back, not just dry-run success.
- Docs say omit `agent_config` and null values. `context_variables` was silently dropped in an October 10 test; render state using prompt substitutions instead.
- Bind fixed URL/method/header/body values with `default`, not `const`. Body leaves belong in `body.properties`. Variables are baked on node entry; unset defaults can become model-filled schema parameters. Fresh node entry or hooks are needed for changed state.
- API result body is under runtime envelope `data`; response mapping paths begin `data.`. Mapping is tool-level for dialogue tools, node-level for pre_actions. Inspect actual variable values in call events.
- Booleans can become strings `true`/`True`; prefer deliberate string routing states. First matching transition wins; globals are checked after local transitions. Each passthrough needs an `always` fallback.
- Code reads/writes `vars`; dates, arithmetic and counters belong there. `json`, `re`, `datetime` verified; full sandbox/network/memory contract unknown. No template braces in snippets; catch failures and populate fallback state. Code default timeout 30 seconds.
- Post-hook instruction text in result can address silence after tools and ignored negative results. Explicitly gate success claims on business result and follow every tool result with speech or next action.
- Lifecycle `end_of_call` runs after analysis, before judging; unresolved inputs may trigger model filling. `each_turn` accepted but unimplemented. Avoid leaving outcome decisions implicit.
- Published model/version matters; calls and simulations can otherwise exercise stale workflows. GET call messages contain tool starts/completions and route variable snapshots. Chat can skip an initial code node (reported, not guaranteed); chat is a smoke test, not simulation equivalence.

## Examples and practice coverage

Base agent has identity and collection conversation nodes, three in-call bank tools plus lifecycle close (four of seven). It is a format example, not compliant solution: recording disclosure missing in opening; collection asks when payment possible rather than brief's prescribed offer; outcome set excludes paid/transferred; no callback/transfer/note tools. README reports **2/13 in one practice run**. Some optional base fields are null despite docs' no-null instruction: do not blindly copy every field.

Example builder uses Claude SDK, default `claude-opus-5-5`, one project skill, Read/Write/Edit/Glob/Grep/Bash, max 150 turns. v3 command timeouts are 15-minute default/20-minute maximum, background disabled so tests finish before builder exits. Skill says test/fix at most three times; three 11-minute tests plus generation can exceed overall 30-minute event limit. `freya.run_simulation` queue wait and polling are unbounded. Our outer deadline must include queue time and preserve a valid selected artifact; do not copy these budget gaps. README reports v3 builder **10/10 Brief A in one run**, not hidden-task or repeat reliability.

| Practice cases | Coverage                                 |
| -------------- | ---------------------------------------- |
| PUB-01         | Identity and full payment today          |
| PUB-02         | Third-party callback                     |
| PUB-03         | Three wrong identity answers             |
| PUB-04         | Proposed date after deadline             |
| PUB-05         | Job-loss hardship, support declined      |
| PUB-06         | Full amount unaffordable, floor accepted |
| PUB-07         | Vague date then holiday adjustment       |
| PUB-08         | Already paid                             |
| PUB-09         | Restructuring transfer                   |
| PUB-10         | Promise service fails once then succeeds |
| PUB-11         | Three products, common date              |
| PUB-12         | One promised, two refused with notes     |
| PUB-13         | Common date, different deadlines         |

Ten A cases and three B cases. `--brief B` selects only those three B cases; run A too for regressions. CLI offers `--only`, `--cases`, `--out`, `--reps`, styles `pieces/corrects/talkative/asks_back/in_words`. Style modifies delivery, not ground-truth facts. Important unrepresented paths include deceased/wrong number, unclear identity, refusals, swapped DOB, dispute, persistent tool failure, accepted hardship support, general-human transfer, transfer after promise/notes, all-paid B, mixed B service failures, multiple calendar days. Additional fixtures must be explicitly synthetic and evaluated alongside originals.

## Immediate integration priorities and conflicts

1. Implement an explicit event workflow compiler preserving raw brief/OpenAPI inputs and their hashes. Resolve schemas from original final files at boundary; keep tool schemas out of generated internal output.
2. Separate local generation/validation from chosen workflow registration; update/publish/export selected slot and verify stored graph/version. Keep direct-generation baseline measurable.
3. Record budgeted builder trace, cap model calls/test queue/runtime under 30 minutes, and preserve last valid workflow when optional testing/repair fails.
4. Evaluate across A+B, styles, calendar dates and repeated runs; record regressions before promotion using repository experiment template. Structural validity or internal audit probabilities are not event scores.

Unresolved source conflicts: README/docs advise omitting `agent_config`, while reference update client inserts default config with event model for chat compatibility; base JSON has null optional fields while docs prohibit null; docs mark GET workflow result unconfirmed while reference export/update code depends on a specific nested wrapper. Treat these as targeted authorised integration checks, not reasons to invent schemas. No live checks were made in this review.
