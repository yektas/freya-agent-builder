# Saved generation traces

The user requested a persistent trace to diagnose generation failures. Each JSON-only run now writes a unique directory under `<out>/generation/`, with `experiments` as the default root. Final workflow JSON remains on stdout; the trace path and progress use stderr. Generation still makes one bounded model call, compiles locally, and makes no Freya calls.

`generation.log` retains readable progress and public streamed draft/summary events. `trace.jsonl` immediately appends timestamped progress, model events, call lifecycle, and failures. `run.json` captures inputs and hashes, configuration, source snapshot, exact model request and completed response, raw candidate, compiled workflow, timings, and error details. The request is saved before transport starts; interrupted streams retain their partial events. Abrupt termination can leave the snapshot marked running.

Quiet mode suppresses terminal progress only. Draft logging does not require the terminal draft flag. Summary collection remains opt-in and depends on model support. Auth headers, configured credential values, encrypted reasoning, and raw private reasoning are excluded. Run directories and files use owner-only permissions. Default artifacts remain Git-ignored.

This is an observability change; generation instructions, strategy, and budgets are unchanged. No benchmark promotion or live evaluation is claimed. All 20 offline tests pass, including injected successful and truncated streams, redaction, unique run directories, quiet-mode logging, preserved stdout JSON, and absence of Freya requests.
