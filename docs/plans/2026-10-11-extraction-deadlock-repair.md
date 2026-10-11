# Extraction deadlock repair and default strategy reset

- Hypothesis: the staged-observation rewrite deadlocked calls because it attached a long custom `extraction_prompt` to every staged field, and the contract-heavy strategies were scoring below plain direct generation for reasons unrelated to that mechanism.
- Baseline source hash / commit: v10 generation `c3e960f4093b543cb05cdf2810784fa5e1ad472e784de52e2b99cf4705e9eb80`; uncommitted working tree before this change.
- Candidate source hash / commit: uncommitted. Full source snapshot `e23708b4990356bf61b04dab1121801d01b09421093b6ffab67a33e858122166`; changed-source fingerprint (ordered path + NUL + bytes + NUL for `src/observation-contract.ts`, `src/input-contract.ts`, `src/strategies.ts`, `src/recipe.ts`, `src/cli.ts`) `b70effe0ea6588ddd50a7aa1cf8eb038fb6498e3daa5282e1ac55727c7085d5f`.
- Single intentional change: stop injecting per-field `extraction_prompt` text, bound the per-node extraction schema at compile time, and reset the default strategy to `direct`. Instruction text for the base recipe is tightened on closing records, routing preference, code-side arithmetic, and compact graphs. These are not independently evaluated ablations.
- Model / call / time budgets: zero model calls, registrations, or simulations. All analysis is offline over recorded `platform.jsonl`, `practice.json` and `compiled.workflow.json` files. No generated Python was executed from a recorded run.
- Development tasks and repetitions: none. Offline unit tests only.
- Holdout tasks: not evaluated. A fresh matched generation and practice repetition is a separate experiment and has not been run.
- Organizer score definition and weighting: kit ledger checks and conversation judge verdicts stay separate. No candidate benchmark score exists.

| Task                   | Baseline score              | Candidate score | Repetitions   | Latency | Failure change                                              | Run paths                                                                              |
| ---------------------- | --------------------------- | --------------- | ------------- | ------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Brief A / in_words v10 | 0/10 kit, 0/10 conversation | null            | 0 candidate   | null    | Deadlock confirmed and localized; live candidate unmeasured | `experiments/generation/2026-10-11T15-08-21.468Z-4bbb12db-c1d5-4b68-9019-61e4b590a706` |
| Synthetic mechanics    | null                        | null            | Offline tests | null    | Wide-schema fixture now rejected at compile time            | `tests/input-contract.test.ts`                                                         |

## Earliest consequential failure in the trace

> **Corrected by the addendum below.** The schema-size reduction below is real and
> measured, but it is **not** the cause of the v10 stall. v12 stalled with no extraction
> at all. Treat this section as the extraction cleanup it is, not as a deadlock fix.

All ten v10 calls follow the same path and then stop. Call `11ad3337-9ab7-4315-9b75-eb9cd453f99e`:

1. `initialize` runs `code_exec` at 0.00s and completes at 0.13s.
2. `dispatch` runs and routes to `__builder_reset_opening` at 0.13s.
3. `__builder_reset_opening` runs and routes to `opening` at 0.27s.
4. `opening` speaks its fixed `on_enter` line at 0.38s. The customer answers "Yes, this is Daniel Reyes." at 2.51s.
5. No `variable_extracted`, no `route_evaluated`, no assistant message. The call ends `customer-ended-call` after 63 s.

Every one of the ten calls ends this way, with zero bank tool calls and `slowest_turn_s: 0`. The node was reached and the platform produced no further event, so this is a turn-level stall after the first user message, not a routing or policy error.

## Evidence supporting the proposed mechanism

`src/observation-contract.ts` built every staged field with the same ~654-1237 character `extraction_prompt`, repeating the full boilerplate once per field. The compiled workflow carried 71 staged fields and 67,385 bytes of extraction schema across nine collection nodes.

`build-the-builder/docs/workflow-format.md` states that a custom `extraction_prompt` _replaces_ the built-in template rather than extending it, that it applies to the node's schema, and that missing placeholders make the extractor "never see the user's message and return nothing on every turn, while dialogue and routing look healthy." The recorded symptom matches that failure shape exactly.

Replay of the recorded blueprint through the corrected compiler, without executing any recorded Python:

| Node      | Recorded schema | Corrected schema    |
| --------- | --------------- | ------------------- |
| opening   | 6488 B          | 2142 B              |
| dob       | 5951 B          | 1813 B              |
| phone     | 5490 B          | 1736 B              |
| callback  | 5821 B          | 1633 B              |
| negotiate | 13664 B         | rejected, 14 fields |
| confirm   | 12216 B         | rejected, 13 fields |
| help      | 4435 B          | 1331 B              |
| support   | 7480 B          | 2169 B              |
| after     | 5319 B          | 1594 B              |

Total extraction schema falls from 66,542 to 12,418 bytes, an 81% reduction. The two nodes that still exceed the bound are now rejected during compilation instead of being registered and deadlocking a live call.

The default strategy change is supported by the recorded practice results, not by preference. Direct generation scored 6, 1 and 4 of 10; runtime-contract scored 3, 0 and 0 of 10. The contract default was selected before matched evaluation, so this restores the measured best while keeping both variants selectable.

## Regressions or missing cases

None measured. Two offline failures were introduced and fixed during the change: the CLI test that asserted the old default now passes `--strategy runtime-contract` explicitly so it keeps testing the contract path, and a synthetic fixture that declared nine fields was re-checked against the field bound.

`pnpm run check` passes formatting, lint, both TypeScript checks and 118/118 offline tests.

## Uncertainty / suspected noise

The field and byte bounds are chosen from one recorded failure plus replay, not from a sweep of the platform's real limit. They sit well above the widest schema that ever produced a value, so they reject the observed failure shape rather than a working one, but the true threshold is unmeasured. The 6/1/4 versus 3/0/0 comparison is three runs per arm at one repetition and one style; it is evidence about which default to ship, not a reliability estimate, and a single fresh build can land anywhere in that range.

No new generation has been run. The instruction changes in `src/recipe.ts` are unmeasured and could regress as easily as they help.

## Decision: reject

- Reason: the deadlock mechanism is confirmed and the compile-time bound is verified against the recorded artifact, but no live generation has been run with the candidate. The contract strategies stay opt-in and `direct` remains the default until a matched practice repetition supports otherwise.

## What a follow-up experiment must do

Run one fresh Brief A generation with the new default and one practice repetition, then compare against the recorded direct runs on the same case file, style, and repetition count. Report kit and conversation separately. If the candidate beats 6/10, promote; if it matches the worst direct run, the instruction changes are noise and should be reverted rather than kept.

## Addendum: v12 measured a silent agent model, not the builder

v12 was generated with the candidate source hash above, `direct` strategy, eight nodes and **zero** extraction fields. It scored 0/10. That result is void.

Every one of the ten calls ends after the opening line and the customer's first reply. No extraction, routing or dialogue event follows, the call ends `customer-ended-call` after roughly 62 seconds, and no bank tool is called. Average cost per call is $0.052 against $0.266 for the working v6 run, and the average number of agent messages is 1 against 5.

| Run | Practice time (UTC) | Calls | Calls that got a second reply |
| --- | ------------------- | ----- | ----------------------------- |
| v9  | 14:30-14:37         | 10    | 10                            |
| v10 | 15:15-15:16         | 10    | 0                             |
| v12 | 15:37-15:38         | 10    | 0                             |

v10 and v12 are structurally opposite builds, 51 nodes with 71 extraction fields against 8 nodes with none, and they fail at the same point in the same way. The simulation overrides, agent model, workspace and case set are identical across the three runs.

Which runs are valid comparisons, by whether the agent ever replied:

| Run       | Strategy         | Score | Calls that replied | Valid       |
| --------- | ---------------- | ----- | ------------------ | ----------- |
| v6 12:22  | direct           | 6/10  | 17/20              | yes         |
| 13:35     | direct           | 1/10  | 10/10              | yes         |
| 13:52     | direct           | 4/10  | not traced         | assumed yes |
| v8 14:07  | runtime-contract | 3/10  | 10/10              | yes         |
| v9 14:30  | runtime-contract | 0/10  | 10/10              | yes         |
| v10 15:15 | runtime-contract | 0/10  | 0/10               | **void**    |
| v12 15:37 | direct           | 0/10  | 0/10               | **void**    |

So the default change to `direct` still rests on valid runs: 6, 1 and 4 against 3 and 0.

**This disproves the extraction theory of record.** v12 had no extraction schema at all and still stalled, so the injected prompts were not what stalled v10 either. The extraction change in this document remains a defensible cleanup on its own terms, 81% smaller schema and one documented hazard removed, but it is **not** the deadlock fix and must not be credited as one.

The kit's own `run_cases.py` warns about exactly this: "If the same agent is fast in another run, the model was busy and this score is too low." It offers `--rerun-if-slow` for that case. Our bridge never passed that flag, and a silent model produces `slowest_turn_s: 0` rather than a large value, so the existing slow-run check would not have caught it either.

### Guard added

`src/freya_bridge.py` now rejects a run in which no case received a reply after the customer spoke, deletes the runner's own 0/N output, and reports the infrastructure failure instead of a score. `src/ui/records.ts` applies the same test to already-recorded runs, so v10 and v12 display as unmeasured rather than 0/10. Replaying the four recorded runs through the guard rejects v10 and v12 and accepts v9 and v6.

Verification: `pnpm run check` passes formatting, lint, both TypeScript checks and 119/119 offline tests, including an injected-transport test that drives the real bridge into a silent run and asserts it refuses to record a score.

## The larger gap: the kit's reference builder has a repair loop we do not

`build-the-builder/examples/agent_builder.py` plus `.claude/skills/build-phone-agent/SKILL.md` produced the **10/10** run recorded in the workspace at 01:47. Its skill is 30 lines and its loop is short:

> 6. Test it: `python3 tools/run_cases.py <agent_id> --brief A`
> 7. Read each FAIL line and its reason. Change the workflow file, save it again, test again. Do this at most three times.

So the reference builder generates, **tests against the real scorer, reads each failure reason, and repairs**, bounded to three attempts. Our builder generates once and accepts whatever the first score is. That single structural difference is the largest remaining explanation for 6/10 against 10/10, and it is not visible in any offline check.

Two further rules from that skill are worth adopting as instruction, because both are brief-agnostic and both match recorded failures here:

- "Move to the next step on a tool result, not on what the customer says." Our best run still lost PUB-09, where `transfer_to_agent` was never called, and PUB-03, where the wrong-answer path never fired.
- "A customer that passes once can fail the next time. Prefer rules in routes and code over rules in prompts."

A bounded repair loop is a behavioral change with real cost: it multiplies model calls and simulation minutes, and the current recipe caps `maxCalls: 1`. It cannot be evaluated while the agent model is silent, so it is recorded here as the next candidate rather than implemented.
