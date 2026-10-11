# Builder handoff: v9 regression and next investigation

## Start here

Improve the builder's performance on unseen tasks, rather than editing a recorded workflow. The latest authorized experiment is complete: **v9 scores 0/10 kit and 0/10 conversation**, versus v8's **3/10 kit and 4/10 conversation**. The implemented current-turn contract has two platform incompatibilities. Review these before making another candidate.

The user requested this handoff for another agent. No other agent was started or messaged. There is no active generation or practice job. The inspector remains running at `http://localhost:4317` (exec session 61220).

## Recommended next work

1. Read `src/input-contract.ts`, `src/runtime-contract.ts`, their tests, and the trace evidence below. Confirm the two failure mechanisms using recorded events, without executing generated Python. Completion: account for malformed observation values and rejected reset writes separately.
2. Design a general input contract using independent, simple typed fields rather than a JSON object serialized inside one extracted string. Preserve simultaneous facts such as an answer and a question. Keep policy and precedence derived from the supplied briefs.
3. Make observation freshness compatible with platform schema validation. The current marker cannot be written into date fields or strings whose patterns reject it. Decide between compiler-owned unconstrained staging variables, an explicitly accepted missing representation, or another verified mechanism. Cover every supported extraction type and validation constraint; explain how missing observations cannot retain old values.
4. Add offline regression fixtures that model platform schema validation on **code writes as well as extractor writes**. Current synthetic tests only model discarded empty writes. Add malformed/missing observations and bounded recovery. Completion: prove current-turn provenance under schema rejection and ensure repeated parse failures reach a safe end instead of an unlimited clarification loop.
5. Review conversation-node containment: v9's model asked security questions and disclosed debt information while code state remained `opening`. Investigate whether stage-specific collection nodes and narrower prompts can prevent dialogue from advancing independently of authoritative state.
6. Run `pnpm run check` after implementation changes. Use `docs/experiment-template.md` for a new behavioral experiment. Keep direct generation as a baseline and preserve rejected builds in comparisons. The single authorized v9 generation/evaluation has been consumed; an additional model generation or simulation would be a new experiment, not an automatic retry of v9.

These are recommendations, not an implemented v10 design. The result gates remain unmeasured in this live experiment because **no call entered a guard node**.

## What was implemented

- `src/runtime-contract.ts`: compiler-owned `builder_result_<tool>` JSON snapshots preserve nested API data and exclude headers; clears old snapshot before the authored hook. Static checks cover graph fallbacks and literal reads of flattened/mapped response variables.
- `src/strategies.ts`: `runtime-contract` is the user-selected default. Direct remains explicit. Historical records without a strategy still mean direct in comparison/submission code. The default was selected before matched evaluation, not promoted by score.
- `src/input-contract.ts`: reset wrappers before every authored graph entry to an extraction node, then an explicit code decision boundary; missing marker `__builder_missing__`. Success acknowledgements declare source-derived `success_guard` metadata, which the compiler consumes and replaces with transport/application-result gates.
- `src/workflow.ts` and `src/event.ts`: strategy-specific local compilation. Registration remains separate.
- UI score display: `src/ui/records.ts`, `ui/src/lib/data.ts`, `overview-tab.tsx`, and `run-table.tsx` distinguish kit score from conversation score. Separate conversation counts require complete kit rows; repetitions aggregate strictly. Existing verdicts are preserved.
- New tests: `tests/input-contract.test.ts`, `tests/runtime-contract.test.ts`; CLI and UI test extensions.

The current contract is still in the working tree and default strategy. **It is not behaviorally validated and v9 should not be promoted or submitted as an improvement.** No generated artifact was manually repaired.

## Evidence: first consequential failures

### Malformed serialized observations

V9's collection schema asks a string field named `observations` to contain a JSON object. Its decision code immediately calls `json.loads(raw)` and catches any exception by asking the customer to repeat.

Freya instead writes values such as `person: customer`, `answer: 4471`, `time: 11:00`, and `:{`. Across final recorded calls there are **314 accepted observation writes, only two of which parse as JSON objects**. This is an extraction representation mismatch, not evidence that `vars.update(...)` is unsupported. Initialization writes using `vars.update` succeeded.

Example: PUB-01 call `91220abf-264a-4540-b0bb-82b240cca689`, `variable_extracted` records `answer: 4471`. A subsequent `decide` route table retains `stage=opening`, sets `route=collect`, and contains the exception fallback instruction `I could not understand that clearly. Please repeat your answer.` The model nevertheless asks security questions. The case never reaches identity-verification tools or promise creation.

### Reset marker rejected by platform validation

The compiler writes `__builder_missing__` into all extraction fields. V9 declares `observed_date` as type `date` and constrains `observed_amount` with a numeric regex. On `__builder_reset_collect`, Freya reports code-execution success **with** `validation_errors`: `variable 'observed_amount' rejected by schema validation` and `variable 'observed_date' rejected by schema validation`.

Final traces contain **356 reset completions with validation errors over 359 reset entries**. This disproves the assumption that any nonempty sentinel can establish freshness. It does not demonstrate a stale payment-date loop here: most cases stall before payment negotiation. The risk is directly established by rejected reset writes.

### Containment and latency

PUB-03 discloses credit-card/amount information before successful identity verification. Dialogue progress cannot be inferred from authoritative code state. Six candidate calls end with `exceeded-max-duration`; four end via the assistant. Candidate slowest turns range from 9.6 to 31.4 seconds. No guard is reached, so this run establishes neither benefit nor latency cost for acknowledgements. Compare complete trace paths rather than interpreting lower turn maxima as improvement.

## Matched result

One Brief A / `in_words` repetition, gpt-6.1-sol generation with medium effort. This is one fresh build and one practice repetition, not a reliability estimate or an ablation of individual changes.

| Case   | v8 kit | v8 conversation | v9 kit | v9 conversation | v9 slowest turn (s) |
| ------ | ------ | --------------- | ------ | --------------- | ------------------- |
| PUB-01 | fail   | fail            | fail   | fail            | 10.7                |
| PUB-02 | pass   | pass            | fail   | fail            | 18.2                |
| PUB-03 | fail   | fail            | fail   | fail            | 24.7                |
| PUB-04 | fail   | fail            | fail   | fail            | 15.9                |
| PUB-05 | pass   | pass            | fail   | fail            | 31.4                |
| PUB-06 | fail   | fail            | fail   | fail            | 10.0                |
| PUB-07 | fail   | fail            | fail   | fail            | 21.4                |
| PUB-08 | pass   | pass            | fail   | fail            | 11.4                |
| PUB-09 | fail   | pass            | fail   | fail            | 9.7                 |
| PUB-10 | fail   | fail            | fail   | fail            | 9.6                 |

Regressions: all three prior kit passes (PUB-02/05/08) and all four prior conversation passes (also PUB-09). No improved case. Kit rows show only `close_call` on PUB-01/03/04/10; other cases have no ledger tools.

## Exact artifacts and reproduction context

Workspace: `/Users/sercanyektas/code/agent-builder-hackathon`.

- V8 directory: `experiments/generation/2026-10-11T14-01-31.734Z-ed789138-74f6-4084-a06e-0eb2801abc04`.
- V9 directory: `experiments/generation/2026-10-11T14-24-47.152Z-b3db6b07-71f5-43e0-9983-76c578975ca2`.
- V9 inspector: `http://localhost:4317/#generation~2026-10-11T14-24-47.152Z-b3db6b07-71f5-43e0-9983-76c578975ca2`.
- Final score evidence: v9 `practice.json`; completed job metadata: `practice-job.json`; sanitized final calls and route tables: `platform.jsonl`.
- Compact comparison and extracted sanitized calls: `experiments/diagnosis/2026-10-11-current-turn-contract/comparison.json` and `live-v9/<call_id>.json`. Experiments are Git-ignored and local; share them separately if moving machines.
- V8 generation source hash: `0f7e4c382cb77cabb2ec29448953de70bce845c529e0a54dc4b141caf7daae3c`.
- V9 generation source hash: `33bd71fbb6cadb4edf670c6bf325591433e0046562413534605d16f6ed680df6`.
- V9 practice execution source hash: `f5faaba9be085dc1508271a388eff594bc6be1cacbe4e66f9bbbdc53d19af00a`. Generation and practice snapshots are distinct; use each run's actual recorded snapshot rather than the intermediate `candidate-source.json`.
- Compiled workflow SHA-256: `3ea25010a9b82736671543937311518ece8c5a4a7eceda73c6198ed1f3a70308`.
- Uploaded workflow: `69182807-d0b2-4d0a-a5dc-db8b5ea9304a`; agent: `5a5b917c-0217-4626-9ee0-d817b8fe4344`.
- Simulation: `c770587e-d4ae-41fb-abb0-8efb2fdf8908`; iteration: `b58fd316-7edc-413e-ab66-902331cec98b`.
- Practice completed at `2026-10-11T14:44:53.732Z`; scorer records 875 seconds. No recovery needed.
- Accepted generation: one model call, 233 seconds, 23 nodes, estimated $0.162590. No repair call or duplicate registration.

Read `docs/plans/2026-10-11-v8-test-outcome.md` for baseline diagnosis and `2026-10-11-current-turn-contract-design.md` for the intended contract. The platform evidence above supersedes its unverified reset assumptions. Read `docs/freya-api-research.md` and the actual event package before platform work. `build-the-builder/docs/tools-and-code.md` documents code variable writes; local and competition contracts differ.

## Validation and workspace guardrails

Last implementation verification: `pnpm run check` passed **114/114 tests**, formatting, lint, and both TypeScript checks (`/tmp/input-contract-check.log`). UI build passed. React Doctor reported pre-existing curly style findings across unrelated modified UI files and a complexity warning (`/tmp/input-contract-react-doctor.log`). These checks did not model the platform schema rejection or extraction representation mismatch.

The workspace contains substantial pre-existing and parallel-session edits, including UI styling, upload, recovery, tracing, and environment configuration. Inspect `git status`/diff before editing and preserve unrelated changes; nothing was committed in this work. Tiny earlier check fixes touched `.impeccable/config.json` formatting and the running-state type in `src/ui/generate.ts`.

Keep recorded inspector runs read-only. Retain original briefs/tool schemas and credentials server-side. Compile locally, register selected agents separately, bound model calls/deadlines, and keep tests offline by default. Follow the repository AGENTS.md for loopback routes and experiment requirements. User requested builder improvements, not a manual repair of v9. No new generation is currently scheduled.
