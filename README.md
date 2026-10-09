# Freya agent builder preparation kit

A working local foundation for the October 10–11, 2026 Build the Builder hackathon. It generates internal agent specifications, validates them, optionally audits them with OpenAI Decisions, and records experiments. **It is not yet a competition submission.** The event contract, task-tool bindings, and official evaluator remain unverified.

## Start offline

Use Node 22.18.0 or newer with native TypeScript support. The tested version is pinned in `.nvmrc`. There are no runtime dependencies; the lockfile pins the TypeScript compiler and Node types used for development checks.

```sh
pnpm install --frozen-lockfile
pnpm run check # formatting, lint, typecheck, and offline tests
pnpm run lint
pnpm run format
pnpm run format:check
pnpm run doctor
pnpm run demo
pnpm run suite
pnpm run report
```

Tests and default commands make **no network requests**. `demo` and `suite` create append-only JSON files in `experiments/`. Synthetic fixtures exercise plumbing, not agent intelligence. Their benchmark scores are `null`, never a fabricated pass rate.

## What is implemented

| Component                                    | Status                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Direct task + tools → candidate generation   | Offline mock and OpenAI Responses implementations                                                    |
| Planned generation                           | Optional extra structured planning call; original input retained                                     |
| Structural validation                        | Required candidate fields, declared tool names, duplicate tools, basic input envelope                |
| Semantic audit                               | Optional OpenAI Decisions predicates; report-only or bounded repair                                  |
| Fallback                                     | Retains a materialized valid candidate when later repair, audit, budget, or timeout fails            |
| Experiment runner                            | Sequential suites, repetitions, source snapshots, exact inputs/configuration, model requests/results |
| Public Freya API                             | Defaults, workspaces, create, chat client methods; mocked tests only                                 |
| Freya task-tool binding and final submission | Pending verified contract; explicit failure rather than fake success                                 |
| Official benchmark evaluator                 | Interface prepared, not connected                                                                    |
| Jev                                          | Not integrated; optional comparison after access and exact API review                                |

## Internal input and output

The JSON files in `fixtures/` demonstrate our own input envelope:

```json
{
  "id": "a-task-id",
  "description": "The original task specification",
  "tools": [
    {
      "name": "exact_tool_name",
      "description": "Original tool description",
      "parameters": { "type": "object", "properties": {} }
    }
  ]
}
```

Extra source fields are retained. Tool parameter schemas are preserved as opaque objects, not rewritten or fully validated. Event inputs may use a different format; adapt them at the boundary.

The generated candidate contains `systemPrompt`, `toolNames`, `completionConditions`, and `uncertainties`. `systemPrompt` is the complete runtime policy; other fields help inspection and validation. All original tools remain in the local artifact, even if the generator omits a name in its declaration.

Static validation checks declared tool names, **not every natural-language reference or argument in a prompt**. It cannot prove semantic correctness or enforce runtime prerequisites. A candidate marked `built` is structurally accepted locally; this is not evidence of task success or Freya acceptance.

## Live generation

Copy `.env.example` to `.env`, then fill in your key and a model you can access. Credentials stay in environment variables. Do not put secrets into task fixtures. Model choice is explicit, and no live call has been verified in this preparation session.

```sh
node --env-file=.env src/cli.ts build \
  --task fixtures/reschedule.json \
  --provider openai

node --env-file=.env src/cli.ts build \
  --task fixtures/reschedule.json \
  --provider openai --strategy planned

node --env-file=.env src/cli.ts build \
  --task fixtures/reschedule.json \
  --provider openai --audit report

node --env-file=.env src/cli.ts build \
  --task fixtures/reschedule.json \
  --provider openai --audit repair --repairs 1 --max-calls 6
```

These commands make billable OpenAI calls and send the selected task/tool definitions to OpenAI. Generation uses Responses structured output with `store: false`. Decisions defaults to the documented `gpt-6-luna`; override with `DECISIONS_MODEL` or `--decisions-model` if the API changes.

Default build limits are a 120-second wall-clock deadline, at most one repair, and six model requests per task. Failed requests count against the call budget. There are no hidden retries. Planned generation adds one call. A complete direct generate/audit/repair/re-audit cycle uses four calls; planned uses five. Reports include raw provider usage where returned; no guessed monetary totals are calculated.

The default audit threshold of 0.8 is **an uncalibrated experimental setting**. Audit flags are model judgments, not benchmark labels. Report mode never repairs. Repair mode keeps the candidate with the lower maximum reported defect probability, preferring the earlier candidate on ties. This heuristic needs measurement against official scores before adoption.

## Freya access preparation

Public docs research is in [docs/freya-api-research.md](docs/freya-api-research.md). Once credentials are available, these probes only read platform state:

```sh
node --env-file=.env src/freya-cli.ts workspaces
node --env-file=.env src/freya-cli.ts defaults --workspace YOUR_WORKSPACE_UUID
```

`FreyaClient.createAgent` and `.chat` are explicit library operations for later integration. They are not called by the builder CLI. Creating a prompt agent before task tools are wired is not a completed integration. The docs' create-agent example includes `workspaceId`, while the Body field list omits it; verify with participant access before depending on that request shape.

The read-only probes redact credential-shaped fields in printed responses. Their output is an inspection view, not a config to upload unchanged. The library retains the original config in memory for deliberate integration.

The builder's `PlatformAdapter.create` must remain a **pure local compilation step** because it can run for multiple candidates. Register only the selected artifact with the platform, outside this loop. `FreyaAdapter` currently fails explicitly until the submission/tool-binding contract is implemented.

## Experiment records and reproduction

Each run records the original task, candidate history, artifact, options, provider/model, total call cap, input and candidate hashes, Node version, elapsed time, request/response data, and an embedded source snapshot with its hash. The snapshot includes source files, package manifest/lockfile, runtime pin, and TypeScript config. Git commit and dirty state are added when a repository exists.

`report` groups only matching source versions, inputs, model configurations, budgets, and evaluator sources. Unevaluated runs stay separate from real scores. It is a descriptive report, not statistical evidence of superiority.

To reconstruct a run, restore the snapshot's `files` into a separate directory, save the recorded `task` as JSON, install with `pnpm install --frozen-lockfile`, and use its recorded CLI options and models. Secrets must be supplied separately. Exact requests can be reproduced; sampled model outputs may differ even with identical code and configuration.

Experiment logs contain task and generated content and are ignored by Git. API auth headers are not logged. Keep these files local until sharing them is permitted.

## Event-day work

Follow [docs/event-runbook.md](docs/event-runbook.md): verify the contract, connect tool bindings and the evaluator, run the baseline, and then test one improvement at a time. Use [docs/experiment-template.md](docs/experiment-template.md) to record hypotheses and promotion decisions.

API references checked on October 9, 2026:

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions)
- [Freya documentation](https://docs.freyavoice.ai/)

## Verification limits

Offline tests cover parsing, budgets, deadlines, fallbacks, response handling, source logging, and mocked HTTP contracts. They do not establish live API access, Freya tool compatibility, semantic agent quality, or benchmark performance. No agents have been created or simulations run against Freya.
