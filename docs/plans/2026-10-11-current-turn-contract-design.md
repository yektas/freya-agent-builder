# Current-turn input and acknowledgement contract

Live v9 evaluation failed 0/10: platform schema validation rejects missing markers in constrained fields, and serialized JSON observations are usually malformed. This document records the intended design, not a verified platform contract. See `2026-10-11-builder-handoff.md` before continuing implementation.

The user authorized improving extraction provenance, independent facts in compound speech, result-gated success claims, clearer score labels, and one matched fresh candidate evaluation. Business rules remain exclusively in supplied briefs and schemas. Direct generation remains selectable; the user-selected runtime-contract default now includes these mechanics.

## Decisions

The compiler inserts a silent reset node before every authored graph entry to a normal conversation node with extraction_schema. It sets each observation to the nonempty `__builder_missing__` marker. This avoids relying on empty writes or the extractor emitting empty values. Missing or discarded extractions stay missing. Persistent proposal and action state use different variables. Collection must have one always transition to a decision code node, no bank tools, no passthrough or alternative implicit exits. Explicit graph edges, including the initial node, pass through the reset; **previous** is refused when contracts are present. Globals cannot use these contracts because their platform entry paths cannot be rewritten reliably.

The model must check markers before parsing, use stage-relevant observations, preserve independent answer/question/proposal/request facts, and distinguish fresh corrections from retained proposals. Custom extraction templates must contain all four documented input placeholders. Every field needs an explicit confidence threshold. These are input mechanics; source policy supplies priorities, limits, calendars and final outcomes.

Success acknowledgements declare success_guard with a tool name, data path, exact scalar success value and fallback node. The compiler inserts a code gate that parses the current tool snapshot, requires transport success with a 2xx status and exact typed equality, then enters the acknowledgement or fallback. Missing, invalid or failed results block entry. Guard nodes are separate from collection. Compiler-added messages constrain collection to neutral input gathering and acknowledgements to the checked action. Tool result schemas supply the predicate; the compiler adds no bank success fields.

The inspector retains the kit score and recorded verdicts. It labels the kit's ledger-plus-conversation count and displays a separate conversation count only when complete kit rows support it. Repetitions aggregate strictly. Summary-only or incomplete evidence leaves the separate count unavailable.

## Alternatives and limits

Prompt-only missing-value instructions leave stale storage unaddressed. A blanket intent classifier loses simultaneous facts. Executing arbitrary generated Python offline would not establish Freya equivalence. Tests execute compiler-produced reset/gate code and authored synthetic boundary consumers only.

This is not a semantic verifier: it cannot detect every success claim elsewhere in free-form dialogue, ensure the extractor classifies tense correctly, validate every generated policy branch, or prove that an authored post-hook preserved the original bank result. Snapshot guards are latest-result checks, not a durable request ledger. The model must place acknowledgements immediately after their matching action and retain separate business state. Reset wrappers add code steps and may increase latency; native reset timing and extraction behavior still need live verification. Structural checks remain distinct from benchmark success.

## Validation

Offline tests model a variable store that discards empty writes, exercise confirmation without a new date, compound facts, a correction alongside yes, missing observations, nested result predicates, transport/application failure, wrong types and safe literal encoding. Baseline compilation remains unchanged. Score tests cover ledger-only failure, conversation failure, strict repetitions and incomplete evidence. `pnpm run check` passes all 114 tests, formatting, lint and both TypeScript checks. UI build passes. React Doctor reports existing curly-brace style findings across unrelated modified UI files and a score-component complexity warning; neither establishes a functional regression.

One fresh generation uses v8's model/medium effort and one-call/five-minute budget, followed only on accepted compilation by separate upload and Brief A/in_words/one-repetition testing. Record failures and all regressions, including latency. Do not edit generated output or silently retry a rejected build.
