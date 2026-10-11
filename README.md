# Freya agent builder

A direct-generation builder for the Build the Builder hackathon. The Freya path reads original brief files and OpenAPI, generates a workflow blueprint, binds the original tools locally, registers the selected workflow, exports it, and runs the official practice cases.

## Generate JSON only

Set `OPENAI_API_KEY` and `BUILDER_MODEL` in `.env`. The model can also be supplied for a single run:

```sh
pnpm run generate --model YOUR_API_MODEL
```

Set reasoning effort with `BUILDER_REASONING_EFFORT=high` in `.env`, or override it per run with `pnpm run generate --reasoning-effort high`. Leave it blank to use the API default. Accepted values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; model support varies. Effort is sent as [`reasoning.effort`](https://developers.openai.com/api/docs/guides/reasoning). Unsupported settings fail without retries. This is separate from `--reasoning-summary` and is recorded in the run configuration and model request.

For a Responses-compatible endpoint, set its URL in `OPENAI_BASE_URL` and its key in `OPENAI_API_KEY`. Leave the URL blank to use OpenAI directly. Credentials stay server-side, and runs record the base URL without authorization headers. `build` defaults to the offline mock; use `--provider openai` there for a live API call.

Set `OPENAI_API_KEY` and `BUILDER_MODEL` in `.env`, then run:

```sh
pnpm run generate
```

This generates a phone-agent **workflow JSON** from Brief A, compiles the tool bindings locally, prints the JSON to the terminal, and saves a local diagnostic trace. It makes one billable OpenAI request. It does not contact Freya, require Freya credentials or Python, or run practice tests. It is locally checked, but has not passed Freya's platform validation or evaluation.

To use another brief, pass `--brief-file`. For B, supply both original briefs:

```sh
pnpm run generate \
  --brief-file build-the-builder/briefs/brief-a.md \
  --brief-file build-the-builder/briefs/brief-b.md
```

To save the printed JSON yourself:

```sh
pnpm --silent run generate > workflow.json
```

The script runs `freya --json-only`. This parameter stops after generation and local compilation; omitting it uses the separately configured full Freya flow below.

### See generation progress

`pnpm run generate` now logs each step to stderr: loaded briefs/docs/tools, the configured model and limits, request acceptance, model activity, elapsed time, token usage when returned, local compilation, model-reported uncertainties, and the resulting nodes/tools/routes. While waiting, it reports elapsed time and received draft characters every ten seconds. These are observed execution steps; the builder still uses one model call.

For more detail:

```sh
pnpm run generate --reasoning-summary --show-draft
```

`--reasoning-summary` explicitly requests OpenAI's model-provided reasoning summaries (`reasoning.summary: auto`). Availability depends on the configured model/account. These are summaries, not private internal reasoning. If no summary is returned, the log says so; an unsupported request fails without an automatic retry. See the [official OpenAI reasoning documentation](https://developers.openai.com/api/docs/guides/reasoning).

`--show-draft` streams the raw model JSON as it arrives, clearly labeled unvalidated. Only the completed response is accepted and compiled; an interrupted, refused, or failed stream cannot become the final workflow. The stream follows the [official Responses streaming format](https://developers.openai.com/api/docs/guides/streaming-responses).

Final workflow JSON stays on stdout, so redirecting it to a file still leaves progress visible in the terminal. Use `--quiet` to hide progress:

```sh
pnpm --silent run generate --reasoning-summary > workflow.json
pnpm --silent run generate --quiet > workflow.json
```

### Inspect a saved trace

Every generation creates a unique directory under `experiments/generation/` and prints its absolute path to stderr. It contains:

- `generation.log`: concise progress, usage, compilation results, and errors; heartbeats every 30 seconds.
- `trace.jsonl`: timestamped milestones, compact call metadata, and stream counts; full payloads stay in `run.json`.
- `model-draft.txt` / `model-summary.txt`: redacted streamed text, saved incrementally when returned, including partial output on failure.
- `run.json`: original inputs, configuration, source snapshot, model request/response, timings, token usage when returned, raw candidate, compiled workflow, and failure details.

Drafts are saved even without `--show-draft`; `--quiet` only suppresses terminal progress. To request model summaries and choose a different log root:

```sh
pnpm run generate --reasoning-summary --out experiments/debug
```

Credentials, auth headers, encrypted reasoning, and raw private reasoning are excluded. Logs are Git-ignored by default under `experiments/`; keep custom output directories out of Git too. An abruptly terminated run can retain `status: running` in `run.json`; inspect its last events in `trace.jsonl`. These generation records carry no evaluation score.

## Control the builder

Start with **[src/recipe.ts](src/recipe.ts)**. `freyaRecipe` controls the actual event builder:

- `instructions`: what the builder model reads, follows, and produces.
- `limits`: one model call, 24,000 output tokens (including reasoning), a ten-minute generation deadline, and a 30-minute total deadline including practice tests. JSON-only generation defaults to the recipe's generation deadline; `--timeout-ms` can shorten it.
- `generate`: generate → compile locally. Used by the JSON-only command.
- `run`: use `generate`, then platform dry run → register → export → practice.

Choose the builder model through `BUILDER_MODEL` or `--model`. The generated phone agent uses the event model from the original `freya.py`; this integration does not change it. Export happens before practice so a failed or timed-out test preserves the selected workflow.

`--strategy direct` is the default for CLI and inspector generations. It is the
measured best of the three: recorded practice scored direct 6, 1 and 4 of 10 against
runtime-contract 3, 0 and 0. Both contract variants remain selectable for comparison.
The experimental `validated-dates` strategy in `src/strategies.ts` adds instructions to
validate a proposed payment date in code before agreement, confirmation, and a
promise write. Calendar rules still come from the original brief. Corrections must
repeat validation and confirmation. This candidate uses the same one-call budget:

```sh
node --env-file-if-exists=.env src/cli.ts freya --json-only --strategy validated-dates
```

This command makes a paid model call when credentials are configured. The inspector's
New Generation action uses the default strategy; upload and practice are separate
actions. Run records and comparison reports show the strategy and instructions hash.
Submission preparation requires matching strategies and hashes and pins the strategy
in the reproduction command. Legacy direct records retain a null instructions hash.
The candidate has passed offline wiring checks only; it is not promoted until matched
practice evaluation, repetitions, styles, and a second fresh build support it. See
`docs/plans/2026-10-11-validated-dates-experiment.md` for the evaluation criteria.

The experimental `--strategy precise-routing` keeps direct generation as the baseline
while asking for separate contact, verification, and final stages with short,
specific intent routes. Generation logs node, transition, per-node intent, and custom
routing-prompt counts for review without imposing a fixed graph-size ceiling. Its first live candidate
reached verification but scored 0/10 after expanding to 59 nodes and 142 transitions.
A second candidate scored 2/10 with 38 nodes and 98 transitions; its account router
missed explicit paid and restructuring exits. A third scored 6/10 with 49 nodes and
149 transitions, matching the best recorded direct score in one repetition. The
current guidance separates answer collection, authoritative tool calls, and result
routing; it remains untested. Generation does not register or practice-test a workflow
on its own. See `docs/plans/2026-10-11-precise-routing-experiment.md`.

The experimental `--strategy runtime-contract` gives every bank tool a compiler-owned
`builder_result_<tool>` JSON snapshot, preserving nested arrays and objects. It adds
instructions for source-derived result state and prerequisite gates, and rejects
literal Python reads of flattened/mapped responses, automatic nodes without an
always fallback, and normal nodes without an explicit path to termination. These
are static mechanics checks, not a policy proof or benchmark score. It keeps the
one-call budget and is not the default, because the recorded practice above measured
worse than direct. See `docs/plans/2026-10-11-runtime-contract-experiment.md` for
limits and evaluation.

Collection nodes reset extracted observations before each entry and route through an
explicit decision node. Success acknowledgements declare a source-derived
`success_guard`; the compiler checks transport and application success before entry.
These mechanics aim to prevent retained observations and unchecked acknowledgement
paths. The v9 live test exposed rejected resets for constrained fields and malformed
serialized observations. A follow-up run then deadlocked on every case: the compiler
had attached a long custom `extraction_prompt` to each of 71 staged fields, and the
platform runs one extraction call per turn for a node's whole schema, so the node was
reached and then produced no extraction, routing or dialogue event at all. The
compiler no longer injects those prompts, and it now rejects an extraction schema
wider than 12 fields or 5000 bytes at compile time. Both contract strategies remain
opt-in until a matched evaluation beats direct. See
`docs/plans/2026-10-11-current-turn-contract-experiment.md` for the matched evaluation.

The model produces graph structure, prompts, transitions, optional Python code, and tool **references**. It never generates tool schemas. The compiler translates those references at the verified event boundary using the supplied OpenAPI. Business rules come from the input briefs, not compiler constants. No automatic repair is included yet.

### Token usage and cost

Every run records what it spent. Each provider reports usage in its own shape, so **[src/usage.ts](src/usage.ts)** normalizes both into one record: input, cached input, cache writes, output, and reasoning tokens. Usage is captured before validation runs, so a rejected or truncated response still reports its tokens.

Cost is an **estimate from published per-model rates, not a billed figure**. The rate table is a snapshot transcribed from OpenAI's pricing page on 2026-10-10 and will drift. Points worth knowing:

- Cached reads and cache writes bill at their own rates, which is usually why two runs with the same total tokens cost very different amounts. The newest models report `cache_write_tokens` separately, and for them a first run is mostly a cache _write_.
- A model with no published rate for a component falls back to the standard input rate, which over-estimates rather than under-estimates.
- An unknown model reports tokens with no cost, and says so, rather than inventing a figure.
- Set `BUILDER_INPUT_PRICE_PER_MTOK`, `BUILDER_CACHED_INPUT_PRICE_PER_MTOK`, `BUILDER_CACHE_WRITE_PRICE_PER_MTOK`, or `BUILDER_OUTPUT_PRICE_PER_MTOK` to override individual rates, which also lets you price a model the snapshot has no row for. Any override marks the estimate as `env`-sourced everywhere it appears.

Usage appears in `run.json` as `usage: { tokens, cost }`, in generation progress on stderr, and in the inspector as Tokens and Cost columns plus per-call detail. Runs recorded before this feature still show their tokens — recovered from the provider payload already in each call response — with the cost recomputed and labeled `estimated`.

## Run the full Freya flow

Requires Node 22.18.0+, pnpm, and Python 3.10+. The event client and scorer use Python's standard library; no Claude SDK is needed for our builder.

```sh
pnpm install --frozen-lockfile
pnpm run check
```

Set `OPENAI_API_KEY` and `BUILDER_MODEL` in `.env` using `.env.example`. Set `FREYA_API_KEY` and one stable `FREYA_BANK_TEAM_KEY` of at least 16 characters in `build-the-builder/env.sh` using the kit's `env.example`. Both credential files are Git-ignored. Set `FREYA_WORKSPACE_ID` if the API key sees multiple workspaces; otherwise the one accessible workspace is verified automatically.

Brief A (all ten A practice cases):

```sh
node --env-file=.env --env-file=build-the-builder/env.sh src/cli.ts freya \
  --brief-file build-the-builder/briefs/brief-a.md \
  --practice-brief A --slot brief-a
```

Brief B builds on A, so pass both files (all three B practice cases):

```sh
node --env-file=.env --env-file=build-the-builder/env.sh src/cli.ts freya \
  --brief-file build-the-builder/briefs/brief-a.md \
  --brief-file build-the-builder/briefs/brief-b.md \
  --practice-brief B --slot brief-b
```

These are live operations. Generation is billable. Original brief/tool/platform-documentation inputs are sent to OpenAI. Freya receives the compiled workflow; the official runner creates synthetic bank practice sessions and runs customer/judge simulations on staging. No final competition submission is made.

For a smaller smoke test, add `--only PUB-01` to the A command. For different customer speech, add `--style pieces`, `corrects`, `talkative`, `asks_back`, or `in_words`. `--openapi FILE` selects another original tool API file; `--kit DIRECTORY` selects the event package. `--timeout-ms` can lower the total deadline, but cannot exceed 1,800,000 ms. See `node src/cli.ts --help`.

A stable `--slot` updates and **publishes** the same workflow on subsequent runs. Slot IDs and the persona cache live under `experiments/freya-state/<workspace>/`. Keep that state and use the same `--out` directory to reuse workflows. One workspace lock prevents concurrent builder runs from racing registration or practice. If a process crashes, inspect the lock's PID/run record before removing a stale lock. An uncertain workflow creation leaves a pending marker: reconcile the remote workflow and local slot before retrying, rather than creating another remote agent.

## Inspect runs in a browser

```sh
pnpm run ui
```

Builds the inspector and opens http://127.0.0.1:4317. `--out DIRECTORY` selects a different record root, `--port` changes the port, and `--kit DIRECTORY` selects the event package used by generation and upload. The script loads `.env` and `build-the-builder/env.sh` when they exist, so the upload action finds `FREYA_API_KEY`. Use `pnpm run ui:dev` for Vite hot reload while working on the UI.

The inspector binds to loopback and serves only artifact names found by its own directory scan. Recorded runs remain read-only. Generation, upload, practice testing, deletion, and archive/restore are the authorized writes; artifact routes stay GET-only. Remote actions reject cross-origin and non-loopback requests, bound their deadlines, and keep credentials server-side.

**New run** uses the configured Responses API endpoint and lets you choose a listed or custom model and reasoning effort (or the API default). It generates Brief A from the selected event package with one model call under the recipe deadline, compiles locally, and opens the recorded run. UI generation needs `OPENAI_API_KEY`; `OPENAI_BASE_URL` selects OpenAI or another compatible endpoint. Only one UI generation can run at a time. Registration and practice testing stay separate actions.

It discovers all three record shapes together and labels each one:

| Record                                 | Command    | Tabs                                                                                                  |
| -------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `experiments/<uuid>/run.json`          | `freya`    | Overview, Stages, Workflow, Practice, Files                                                           |
| `experiments/generation/<id>/run.json` | `generate` | Overview, Trace, Candidate, Files + **Upload to Freya**, **Test & score**, and Practice after testing |
| `experiments/<uuid>.json`              | `build`    | Overview, Candidate, Files                                                                            |

**All runs** is the default view: every run in one sortable table with its score, status, kind, model, and elapsed time, plus the mean across scored runs. This is the view for comparing runs across tasks before promoting a builder change.

Opening a run gives:

- **Overview** — the score at hero size with a per-case pass/fail strip, then failing cases first with the scorer's own reasons, then run configuration, git provenance, and model calls.
- **Stages** — the `candidate → workflow → validation → registration → export → practice` timeline, with a proportional bar and each stage's share of total time.
- **Workflow** — the compiled node graph laid out by distance from the initial node, colored by node type, with per-node prompts, tools, and transitions. Unreachable nodes, stranded exits, and transitions pointing at unknown nodes are flagged.
- **Practice** — failing cases first with reasons, then every case with the tools it called.
- **Trace** — the generation timeline: progress messages and model events with elapsed offsets.
- **Files** — every artifact with its size, and a raw viewer for any of them.

The page polls, so a run that is still in flight updates on its own. While any run reports `running` it refreshes every second and settles to every five seconds once everything finishes; a pulsing `running` badge marks live runs and elapsed time ticks from the start timestamp, since the record only stores a duration at the end.

### Upload a generation to Freya

A completed generation's page carries one action, **Upload to Freya**. It registers that run's `compiled.workflow.json` exactly as compiled, with **no further model call**: workspace verification → platform dry run → create-or-update → export, through the same unchanged organizer bridge a CLI run uses. The event model, tool bindings, and workflow document are untouched. It uploads only; use **Test & score** separately after upload.

Repeats cannot create a second remote agent:

| Guard                       | Effect                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Stable slot per generation  | The same generation always maps to the same remote workflow, so a repeat updates it |
| Workspace-scoped slot state | `experiments/freya-state/<workspace>/slots.json` is shared with `pnpm run freya`    |
| The existing workspace lock | An upload and a CLI run cannot register in the same workspace at once               |
| Pending-create marker       | An uncertain create is refused until it is reconciled, not retried blindly          |
| Recorded result             | An unchanged repeat returns the recorded registration with no platform call at all  |

The result is written to `upload.json` beside the run, with the workflow and agent IDs, so it survives a refresh and appears under **Files**. A failure records which step stopped it. A changed `compiled.workflow.json` is registered into the same slot and published, rather than creating another agent.

The endpoint is `POST /api/runs/<run-id>/upload`. It is an authorized non-GET route, and it stays inside the inspector's boundaries:

- **Credentials stay server-side.** `FREYA_API_KEY` and the event package are read from the server process; the browser sends a run id and receives ids. Nothing served contains a key, and platform traces and exports stay redacted.
- **Only discovered run ids.** The id must resolve through the inspector's own scan, and the workflow is read through that scan's artifact allowlist. A path or traversal is refused.
- **Loopback and same-origin only.** A non-loopback peer, a cross-site `Sec-Fetch-Site`, or an `Origin` that does not match the `Host` header is refused before any platform call.
- **A bounded deadline.** One operation budget covers verification, dry run, registration, and export; the lock is always released.
- **Read-only artifacts.** Artifact routes stay GET-only and serve discovered names only.

### Test and score an uploaded agent

After **Upload to Freya**, use **Test & score** on the same generation. Choose Brief A, Brief B, or A+B; normal speech or an organizer speaking style; and one or three repetitions. This runs the unchanged kit's `tools/run_cases.py` against the recorded agent id, with no new builder model call and no workflow registration. It creates synthetic practice sessions and Freya simulations, so it uses the platform's simulation resources. Testing needs `FREYA_API_KEY` and a stable `FREYA_BANK_TEAM_KEY` of at least 16 characters in the server environment; restart the inspector after setting them.

The action returns immediately and the inspector polls the recorded status. When testing finishes, the run table and Overview show its public practice score, and Practice shows case verdicts, called tools, call ids, and failure reasons. Three repetitions count a customer only when every repetition passes. These are public practice results, not scores on the hidden final benchmark.

The inspector records `practice-job.json` (status, choices, agent/workflow ids and hash, exact scorer inputs/source versions, start/end, and errors), `practice.json` (latest successful runner results), and `practice-history.json` (all completed attempts and their results). Starting or failing a rerun clears the displayed score; earlier results remain in history. A changed compiled workflow must be uploaded again before testing, and previous scores no longer apply to that workflow.

`POST /api/runs/:id/practice` accepts only brief, style, and repetitions. Credentials and paths stay server-side; ids must be discovered completed, unarchived generations with a matching successful upload. The action rejects cross-origin/non-loopback requests and shares the workspace lock with CLI runs and uploads. Archiving and deleting an active practice run are refused. The default deadline is 25 minutes, including queue time; three slow repetitions may exceed it. A timed-out simulation may still be running remotely: its failure message names the retained workspace lock. Confirm the simulation has stopped before removing that lock and retrying.

### UI stack

The inspector is a React 19 app built with Vite and Tailwind v4, using components generated by the shadcn CLI in the `base-nova` style on **Base UI** primitives. `ui/components.json` pins that configuration.

```sh
pnpm run ui:build   # production bundle into ui/dist
pnpm run ui:dev     # dev server with hot reload, API included
cd ui && npx shadcn@latest add <component>   # add another component
```

`pnpm run ui:dev` starts the read-only API in-process and proxies `/api` to it, so it is a single command.

Two things the generated `Sidebar` requires, both learned the hard way:

- **Never put a width class on `<Sidebar>`.** The sidebar panel and the gap it reserves for the content are both sized from `--sidebar-width`. Setting `w-72` on `<Sidebar>` sizes only the panel, so the content starts 32px early and sits _behind_ the sidebar. Set the width on the provider instead:
  ```tsx
  <SidebarProvider style={{ '--sidebar-width': '18rem' } as React.CSSProperties}>
  ```
- Collapsed-mode content must hide itself with `group-data-[collapsible=icon]:hidden`, or it overflows the icon rail. Run items collapse to a status dot rather than a bare score, and the header collapses to a single live/idle glyph so the rail keeps no dead space. The sidebar collapses to a rail from the header trigger or `SidebarRail`, which is worth using when reading a wide workflow graph.

`ui/dist` is build output and is Git-ignored. `src/ui/server.ts` serves whatever is in it and never imports the bundle, so the Node process keeps running TypeScript directly with no build step. Two tokens were added to the generated theme because the neutral base palette has no semantic success or warning colour:

- `--success` / `--warning` in `ui/src/index.css`, exposed as `text-success`, `bg-success`, `text-warning`, and `bg-warning`.
- `success` and `warning` variants on `Badge`, for run states that pass, warn, or fail.

Add new run-outcome colours through those tokens rather than raw values, so light and dark stay consistent.

Synthetic fixtures, the internal build baseline, and single-repetition practice runs are labeled in the UI. Structural checks and mock results are not benchmark scores, and the UI says so where they appear. Runs are deep-linkable: `#<run-id>` reopens one directly.

## Inspect a run

Each run creates a Git-ignored `experiments/<run-id>/` directory:

| File                     | What to inspect                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `run.json`               | Exact input/config/source versions, one model request/result, stage times, selected IDs, failures, and practice summary |
| `compiled.workflow.json` | Locally compiled workflow before registration                                                                           |
| `exported.workflow.json` | Platform-stored workflow in the organizer's export wrapper                                                              |
| `practice.json`          | Case-level failures, tool names, call IDs, and practice totals                                                          |
| `platform.jsonl`         | Platform/bank request and result trace, including retrieved call details                                                |
| `upload.json`            | Recorded inspector upload: slot, workflow/agent IDs, the step it stopped at, and why                                    |

Credentials remain in environment variables. Auth headers and credentials are excluded from platform traces and exports. Completed practice runs combine the original ledger scorer and conversation judge. A failed integration leaves a failed run record and a null score. A phone agent failing a case is still a completed evaluation; its failures are retained.

One practice repetition is a development baseline, not the final three-repetition benchmark. Compare both A and B with the [experiment template](docs/experiment-template.md) before promoting any builder optimization.

## Supporting code

| File                                    | Responsibility                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `src/recipe.ts`                         | Builder instructions, budgets, and sequence                                   |
| `src/ui/records.ts`, `src/ui/server.ts` | Read-only run discovery, normalization, and the loopback server               |
| `src/ui/upload.ts`                      | The authorized upload: discovered artifact, stable slot, lock, and deadline   |
| `ui/`                                   | React inspector: Vite, Tailwind, Base UI components from the shadcn CLI       |
| `src/workflow.ts`                       | Read original inputs and compile tool references into event workflows         |
| `src/providers.ts`                      | OpenAI Responses transport and request budget                                 |
| `src/event.ts`                          | CLI orchestration, deadlines, state, and run records                          |
| `src/freya.ts`, `src/freya_bridge.py`   | Bounded bridge to the unchanged organizer client and scorer                   |
| `build-the-builder/`                    | Authoritative event package, documentation, briefs, tools, and practice cases |

The compiler currently supports the event's POST JSON body operations, local OpenAPI references, conversation/API/code/end nodes, and end-of-call lifecycle tools. Unsupported schemas fail explicitly. Platform dry-run validation checks schema compatibility; structural validation cannot prove policy correctness.

## Keep the original local baseline

`recipe` in `src/recipe.ts` remains the original internal task → candidate → local specification baseline. Its `build` command does not create a Freya workflow:

```sh
pnpm run demo
# Optional live internal generation:
node --env-file=.env src/cli.ts build \
  --task fixtures/reschedule.json --provider openai
```

The demo uses an explicitly synthetic appointment-rescheduling fixture and fake model output. Tests use injected transports and make no network calls. Mock runs and structural checks are not benchmark scores.

For the event contract, start with the [research index](docs/hackathon-research-index.md) and [official kit v3 findings](docs/starter-kit-v3-2026-10-10.md). Verify current organizer updates and the actual package at event start and submission freeze.

## Final runs and submission

The [current Submit tab](https://www.freyavoice.ai/hackathon#submit) describes **one**
final case. At 17:00 UTC (20:00 Istanbul) on October 11, download its zip and read
`BRIEF.md` and `README.md`. It includes the service contract and six example
conversations. Build a mock of those services on Cloudflare Workers and keep it
reachable until results are announced. Run the builder on the case folder and the
mock URL. The phone agent's tools must point only to that mock. The final agent
speaks Turkish; the practice cases remain English and use the organizer-hosted bank.

The released package is staged locally at
`/Users/sercanyektas/Downloads/build-the-builder/final-case`. Recheck the Drive
folder and organizer mail before the final run because further source files may
arrive. `scripts/run-final-case.sh {case_folder} {mock_url}` derives a tool catalog
from the supplied service contract, ingests the case folder, binds tool URLs to the
mock, registers the workflow, and exports it. The deployed mock is
`https://freyabank-statement-mock.yektas.workers.dev`. Commit builder changes before
the selected run so its source snapshot is clean. Never put final-case rules into
builder code or edit the generated workflow by hand. A selected run must finish
within 30 minutes; final mode does not start a practice simulation.

For development practice, use `--repetitions 3` with the full Freya CLI. The inspector
also supports three repetitions. Both paths now require matching original brief and
OpenAPI contents. A-only builds cannot run B/all cases. A+B builds can run A, B, or all.
Changed or hidden inputs cannot be scored against the public practice set.

If CLI practice times out, it retains the workspace lock and reports its path. Verify
that the remote simulation has stopped before removing the lock. An ordinary completed
practice releases the lock. Do not start another simulation while its state is uncertain.

For a timed-out inspector test, retrieve the existing result without starting another
simulation:

```sh
node --env-file-if-exists=.env --env-file-if-exists=build-the-builder/env.sh \
  src/cli.ts recover-practice --run-id 'generation~RUN-ID'
```

Recovery uses GET requests and the original scorer. It verifies the recorded inputs,
package, registration, simulation identities, and lock owner. It preserves the timeout
in practice history and releases the retained lock only after valid results are saved.
It refuses incomplete repetitions and missing or inconclusive judge verdicts. The
default retrieval deadline is three minutes; it does not change the original test budget.
Practice execution also refuses a score when a completed simulation summary has
incomplete detailed verdicts. A dashboard pass count alone is not a bank-and-policy score.

After choosing one completed final run, prepare its exact export and trace:

```sh
node src/cli.ts submission \
  --run-file experiments/RUN/run.json \
  --team TEAM --repo https://github.com/OWNER/REPO --commit BUILDER_COMMIT \
  --member-json '{"name":"NAME","email":"EMAIL"}' \
  --mock-url https://YOUR-MOCK.workers.dev \
  --run-command 'YOUR_VERIFIED_COMMAND {case_folder} {mock_url}' \
  --out submission
```

Repeat `--member-json` for a teammate. The command validates the clean run source
against the builder commit, export hash, registration IDs, and trace fields. It
refuses existing output and credential material. The form initially has `commit: null`.

Commit `submission/final.workflow.json` and `submission/final.trace.json`. Leave
experiment directories and credentials
out of Git. Then finalize against the commit that contains those files:

```sh
node src/cli.ts submission --finalize --out submission --commit SUBMISSION_COMMIT
```

Finalization verifies that both artifacts and all recorded builder source files match
that commit. It fills `submission/submission.json` with the verified commit and run
command. Send this form through the organizer's submission channel yourself. The
command does not submit externally or create a Git commit.

## Compare recorded evidence

```sh
node src/cli.ts compare --run-file experiments/RUN-1/run.json \
  --run-file experiments/RUN-2/run.json
```

This offline report keeps failed and untested runs visible. It groups by input, case
set, style, and repetition settings. Strict scores require complete three-repetition
results; one-run checks retain a null strict score. Promised amounts come from recorded
ledgers on passing cases, shown per repetition and summed across passing runs. Missing
ledgers leave the amount null. Build time is available only for full runs; local
JSON-only generation time is listed separately. No hidden-final score or ranking is
inferred from public practice.

Synthetic clean/raw input fixtures and a behavioral checkpoint list live in
`fixtures/holdouts/`. Offline tests verify original input and changed schema preservation.
They do not prove model extraction, date math, or phone-agent behavior. Those require
separate budgeted evaluation before strategy promotion.
