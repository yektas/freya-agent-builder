# Competition-focused builder feedback plan

Status: first milestone implemented. See [the failure report](2026-10-11-builder-failure-report.md) and [the response-scope experiment](2026-10-11-response-scope-experiment.md). A fresh candidate compiled successfully; live upload and practice are blocked by Freya workspace-probe HTTP 504 responses. Broader comparisons and strategy freeze remain pending.

## Objective and approach

Improve the reliability of generated agents on unfamiliar competition briefs within the organizer's 30-minute limit per builder run. Prioritize fixes supported by observed failures. Keep the direct-generation Freya strategy as the measurable baseline, separate from the internal mock baseline.

Three approaches considered:

| Approach                                              | Benefit                                                        | Tradeoff                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Diagnose current failures, then test targeted changes | Fastest path to evidence-backed competition gains; recommended | Requires disciplined manual development-time diagnosis                          |
| Add automatic test-and-repair immediately             | Can recover from some mistakes within a run                    | Consumes scarce simulation time and can compound an undiagnosed integration bug |
| Build a general evaluation platform first             | Strong foundation for long-term optimization                   | Delays the first useful builder improvement                                     |

Use the first approach. Reuse recorded artifacts, the CLI, the official scorer, and the existing inspector. Defer dashboards, experiment databases, broad configuration frameworks, and automatic self-modification.

## 1. Establish a trustworthy baseline and failure diagnosis

Inspect the existing failed Brief A run before spending on another generation. Trace at least happy-path payment, identity failure, transfer, and finalization from source requirement through raw blueprint, compiled workflow, exported workflow, and actual tool results/transcript. Group failures by their earliest shared cause, not by the number of downstream scorer complaints. Inspect all repetitions, not only the final repetition's rows.

Verify the recorded brief files, OpenAPI, workflow hash/version, scorer version, and test settings. A Brief A-only agent evaluated against B is an input mismatch, not evidence that the builder ignored B. Suspected judge mistakes remain recorded as official failures; document discrepancies separately rather than editing scores.

Deliverable: a short failure table with source requirement, observed evidence, earliest error, suspected layer, and proposed general fix. Distinguish confirmed causes from hypotheses and unavailable traces.

Preserve the exact baseline source snapshot, including dirty working-tree contents, model, reasoning effort, and limits. Existing unrelated local edits must remain intact. Reuse old results only when provenance and evaluation conditions match; otherwise label them historical and schedule a matched baseline.

Exit criterion: identify the highest-impact confirmed failure mechanism, or explicitly identify the smallest diagnostic run needed to resolve it.

## 2. Fix execution defects before changing generation strategy

If diagnosis identifies compiler, variable binding, response interpretation, routing, or end-of-call defects, fix those first. Add a focused offline regression using injected transports or synthetic fixtures. Never embed observed customer data or brief-specific business constants in the builder or compiler.

Likely investigation areas, not established diagnoses: response variable paths, tool availability at the relevant node, state overwritten by defaults, success/failure routing, and required final records before termination.

Run `pnpm run check`. Generate a fresh agent through the builder when needed; do not manually repair generated agents. Use the relevant official case as a one-repetition smoke test, then evaluate the broader suite. Keep infrastructure fixes separate from prompt experiments so their effect is interpretable.

Exit criterion: the targeted mechanism works in offline checks and the live smoke result is recorded, including any remaining failure.

## 3. Test one builder improvement at a time

Choose the first experiment based on diagnosis. The default first hypothesis is that explicit state and completion instructions reduce omitted actions: distinguish proposed versus successfully recorded values, track progress per product, preserve corrections, and derive final outcomes from authoritative tool results. These instructions must apply to arbitrary supplied briefs and schemas.

If policy omissions remain, test source-linked requirement extraction as a separate candidate. Retain original inputs alongside the extracted map. Each requirement records source evidence, condition, action, exception, required state, and completion evidence; workflow nodes reference requirement IDs in diagnostic metadata kept separate from platform JSON. Extraction does not replace or override the original brief.

Compare direct generation against extraction plus generation before adding audit. Add deterministic generated calculations only for failure classes where evidence supports them, and test their actual sandbox compatibility. Rules and constants still come from each input brief. Do not execute arbitrary generated code with unrestricted local access.

For each candidate, use `docs/experiment-template.md`, one intentional change, exact source hashes, fixed model settings, and a predefined test matrix. Hold model choice constant initially.

## 4. Use staged evaluation to spend simulation time well

| Stage                | Inputs and checks                                                                                | Purpose                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Offline              | Compiler/provider regressions and synthetic state checks                                         | Reject implementation defects without network calls             |
| Smoke                | Relevant official case, one repetition                                                           | Reject obvious failures quickly; not a promotion score          |
| Breadth              | A input on A cases; A+B input on both A and B cases, normal speech                               | Find regressions across shared and multi-product rules          |
| Reliability          | Baseline and strongest challenger, three repetitions; matched correction/pieces style checkpoint | Compare strict all-three-pass results under the same conditions |
| Generation stability | One additional independent generation of the strongest strategy, evaluated on the agreed matrix  | Check whether the gain depends on one lucky generation          |

Use the organizer's per-customer all-repetitions rule. Report each brief separately, raw counts, build/evaluation coverage, costs, latency, and regressions. Missing evaluations remain null. Failed builds and infrastructure failures remain visible and cannot improve an average by disappearing. Do not compare scores across different case sets or repetition settings as if they were equivalent.

One simulation runs per workspace. Schedule sequentially through the existing lock. Stop launching new live jobs when the remaining time cannot cover the configured deadline. Development experiments may span multiple runs; each individual builder run remains bounded by the event limit.

A small unseen synthetic brief with changed values and document structure can check extraction/generalization if time remains. It is not an official score: the official bank simulator cannot be assumed to implement arbitrary synthetic policies. Use independently specified expected results for local checks, and reserve the fixture until the planned checkpoint.

## 5. Add bounded audit/repair only if warranted

Optional follow-on, not a prerequisite for the first improvement. Compare it against the strongest simpler strategy.

At most four calls for an extraction/generation/audit/repair variant: extract, generate, audit, and one repair. Start with a proposed shared eight-minute model-stage ceiling inside the existing 30-minute total ceiling; measure whether that leaves enough time for registration/export and any optional practice. Do not automatically retry a failed model request.

Audit findings must cite source evidence and the affected workflow location. Mechanical checks and model judgments are labeled separately. Compile locally before registration. Preserve the last structurally valid candidate if optional audit or repair fails, times out, or produces an invalid candidate. Structural validity does not establish behavioral superiority; log the selection reason and evaluate the selection policy itself.

Register/export only the selected candidate. Remote testing and repair inside the final builder are deferred unless measured timing and the current event contract support them. Keep the phone-agent model fixed to the organizer's setting.

## Promotion and stopping rules

Promote a strategy only when matched evaluation improves strict customer success without a known policy/honesty regression, and the additional generation supports the improvement. Treat small or inconsistent differences as inconclusive; retain the established strategy or run a predeclared repeat if budget permits. Review per-case results, not just aggregate percentages.

For tied success, follow the organizer's promised-amount tie-break before build time. Do not sacrifice correctness to increase promised amounts. Public success does not establish hidden-test optimality.

Before final execution, verify current organizer updates and the actual package. Once final briefs arrive, do not encode their rules, values, or names into builder code or prompts; only permitted general bug fixes may be made. Generate and export through the builder without manual workflow edits and retain the complete trace.

## Implementation order and review points

1. Failure report and matched baseline manifest — inspect existing artifacts first.
2. Smallest confirmed general fix — supporting runtime/compiler module plus focused offline tests, if needed.
3. One recipe experiment — `src/recipe.ts`; provider/schema changes only if extraction is selected.
4. Matched practice comparison and experiment record — reuse existing CLI and inspector.
5. Freeze the strongest evidenced strategy; consider optional audit only if time remains.

Every implementation change runs `pnpm run check`. New diagnostic files require explicit artifact allowlisting before the inspector can serve them; credentials remain server-side. No UI expansion is required for this plan.

The first implementation deliverable is diagnosis plus one testable fix, not the entire optional pipeline. Live execution requires an agreed run/cost cap; this planning document does not initiate paid generations or simulations.
