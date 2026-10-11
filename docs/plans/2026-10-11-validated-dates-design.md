# Date validation candidate

The latest completed A / in_words / one-repetition run passed 6/10. PUB-07 again
recorded a deadline instead of the next business day after a holiday. The generated
calendar facts and dialogue instructions already contain the relevant rule. The
first consequential error is the dialogue's selection of a replacement date; no
deterministic check separates that selection from readback and the promise write.

Three options were considered: repeat the rule in the prompt, generate an explicit
date-validation state machine, or add another model audit/repair call. Use the second
as one isolated experiment. It changes how the generated workflow uses the supplied
calendar, without adding a model call or manually editing an agent.

Add a CLI-only `--strategy validated-dates` candidate alongside the unchanged `direct`
default. The candidate extends the existing builder instructions. It asks the builder
to capture proposed values separately, calculate date validity in a code node, offer
the appropriate replacement from the supplied policy, and invalidate confirmation
when the customer changes values. Route on explicit calculation state and keep the
write tool out of nodes that collect unvalidated dates. Missing or ambiguous dates
request clarification; calculation failure cannot permit a write. Multi-product rules
and confirmation scope still come from the original brief.

Record the strategy and instruction hash with the same original input, schema, call
count, token limit, and deadline. Pin the strategy in submission commands, so a final
rerun cannot silently use the baseline. The inspector's generation request remains
model/effort only and continues to use the direct baseline.

Offline injected transports verify actual CLI strategy selection, original input
preservation, instruction provenance, and bounded execution. They cannot prove that
a model generates a correct validator or that Freya executes it correctly. Promotion
requires a fresh candidate, matched A and A+B evaluation, reliability repetitions and
styles, and a second fresh build. No paid runs are started for this implementation.

The first authorized live generation reached the unchanged five-minute deadline
with an incomplete draft. Its trace contains 30 node declarations, compared with
12 nodes in the completed baseline. It produced 54,411 draft characters and never
reached compilation. Add a compactness instruction: reuse date stages and validation
code, keep node prompts short, and avoid expanding unrelated call handling. Preserve
all source obligations. This revision is offline only; the failed build remains in
the experiment record and the direct default remains unchanged.
