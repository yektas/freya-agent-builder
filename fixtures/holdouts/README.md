# Synthetic input checkpoint

These fixtures are synthetic. They are not organizer cases or benchmark scores.

`clean.md` and `raw.md` express the same final rules. The raw documents include
superseded rules. `calendar-checks.json` specifies three dates and rounding
boundaries for a future behavioral check.

The offline test loads both formats, changes API fields and values, and checks
that all original text and tool fields reach compilation. It checks input handling,
not whether a model extracts or executes the rules correctly.

When a further model-run budget is authorized, generate each fixture separately
with its own tool API. Inspect requirement coverage against the original documents:

- Revision 3 replaces the old floor and deadline.
- The date comes from the call variable on every call.
- Each calendar example has the expected date and minimum.
- Negative identity results prevent account access.
- Each product has separate confirmation and write state.
- Invalid dates and amounts are refused before any promise write.
- Failed writes do not cause a success statement or a retry after a successful write.
- Disputes produce their required record without a promise.
- Required records precede exactly one final close_call.

Do not send these fixtures to the hosted public practice session endpoint. That
endpoint provides organizer cases with fixed data. A behavioral evaluation requires
a verified test transport or a compatible organizer case set. Keep results labelled
synthetic. Do not promote a strategy from the offline input test.
