# Compiler-owned runtime contract experiment

Improve generation across unseen briefs and response schemas, preserving `direct` as an explicitly selectable baseline. The user subsequently selected `runtime-contract` as the default for new runs before matched behavioral evaluation. Business rules remain in the supplied brief and OpenAPI. No recorded workflow is repaired manually.

## Design

The opt-in `runtime-contract` strategy combines a precise compiler-owned response representation, generation instructions for source-derived prerequisite/action state, and bounded static acceptance checks. It uses one model call with the existing output and deadline caps. Both generation-only and full event commands select the same compiler option. Upload remains a separate action and reuses recorded compiled JSON.

Every bank tool placement receives a post-hook that writes `builder_result_<tool>` as JSON text containing only the current envelope's status, data, message and status_code. Nested containers are preserved. Existing authored post-hooks run before snapshot capture; a blocked empty snapshot is assigned before they run to avoid retaining a previous success on exceptions. Native result variables remain available for baseline compatibility. Generated consumer code must parse the snapshot instead of treating flattened response leaves or mapped variables as structured data. The contract contains no bank field names.

Instructions require the model to derive prerequisite gates, retries, corrections, next actions and final outcomes from the input. They recommend explicit state and result instructions for negative/ambiguous results. The compiler does not infer those business rules. Latest response state and completed action state must be separate.

Static checks reject literal code-node reads of native response paths or response_mapping aliases, automatic nodes without an always fallback, and normal nodes without an explicit graph path to termination. Diagnostics are included in the existing recorded compilation error. Failed acceptance stops locally before registration; no extra model calls or remote duplicates are introduced.

## Alternatives and limits

A prompt-only change cannot establish a response representation. A general Python executor or policy prover is a larger project, and cannot establish equivalence with Freya's sandbox from offline tests. This experiment executes only compiler-owned hooks and authored synthetic fixtures offline.

Literal-read scanning is intentionally partial: computed Python accesses, arbitrary hook behavior, predicate semantics, customer interaction, liveness under every condition and business correctness are not proved. A graph path to termination is possibility, not a guarantee. `__previous__` is not counted as an explicit terminal path. The instructions improve identity handling but no static check proves that sequential verification obeys the brief. Authored exceptions remain subject to the platform's undocumented hook failure behavior.

JSON text in vars uses documented post-hook writes and standard json facilities; structured snapshot survival on Freya still needs a bounded live smoke before promotion. The strategy adds no automatic repair or fallback generation. Failed compilation remains a recorded failure, preserving the raw candidate; it never silently falls back to an unchecked agent.

## Validation

Offline tests exercise API pre-actions, conversation tools and lifecycle tools with synthetic nested arrays, objects, empty containers, null, booleans, failed/missing results, stale-success removal and authored hooks. Injected CLI transport confirms one model call, unchanged original inputs, strategy/hash recording and compiler selection. Baseline compilation and instructions remain unchanged. Use the experiment record for matched behavioral evaluation and regressions before promotion.
