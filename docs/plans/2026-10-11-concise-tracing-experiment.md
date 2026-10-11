# Concise generation diagnostics

- Hypothesis: removing per-fragment event envelopes and repeated model payloads makes generation diagnostics smaller and readable without losing failure output or provenance.
- Baseline source commit: `c0d86de` plus existing workspace changes.
- Candidate source: changes to `generation-trace.ts`, `progress.ts`, `event.ts`, `ui/records.ts`, and the trace tab; exact sources are captured on future generation runs.
- Single intentional change: separate output artifacts from the diagnostic timeline. Preserve full model requests/responses in `run.json`, record compact call/stream metadata, emit 30-second heartbeats, and omit per-node progress. Legacy UI traces count all fragments per stream and show one output row at its last timestamp, with duplicate lifecycle messages and frequent heartbeats omitted.
- Alternatives: UI-only filtering leaves bloated disk artifacts; deleting drafts loses interrupted-run diagnostics. Separate artifacts address both concerns.
- Model / call / time budgets: unchanged; replay uses zero model or platform calls.
- Development tasks and repetitions: synthetic offline long-stream and interrupted-stream tests; one diagnostic replay per recorded Brief A run below. Replay reduces heartbeat frequency and omits node logs, then feeds original model events and call records through the new writer in a temporary directory.
- Holdout tasks: none; this changes diagnostics, not generated-agent behavior.
- Organizer score definition and weighting: not evaluated. Byte and event counts are diagnostic measurements, not benchmark scores.

| Run suffix / outcome   | Baseline trace bytes | Candidate trace bytes | Baseline events | Candidate events | Baseline log bytes | Candidate log bytes | Baseline / candidate score |
| ---------------------- | -------------------: | --------------------: | --------------: | ---------------: | -----------------: | ------------------: | -------------------------- |
| `ee15d27f` / completed |               971865 |                  8583 |            5817 |               37 |             125332 |                3474 | null / null                |
| `5a8ee333` / failed    |              1615359 |                  6117 |           11761 |               33 |             245506 |                2091 | null / null                |
| `552e4fd6` / completed |               850796 |                  8186 |            4802 |               35 |             103059 |                3000 | null / null                |

- Run paths: original recordings under `experiments/generation/2026-10-11T10-51-52.562Z-*`, `2026-10-11T13-15-18.639Z-*`, and `2026-10-11T13-25-38.262Z-*`; replay artifacts were temporary and removed. Original records were never rewritten.
- Earliest consequential failure: the failed recorded transport ends before completion; its partial draft survives in the separate artifact.
- Evidence: trace size falls by more than 99% across the three diagnostic replays; logs shrink by more than 97%. A synthetic 5002-fragment stream creates fewer than ten trace entries, with exact text preserved apart from credential redaction.
- Regressions / missing cases: existing raw traces remain verbose on disk. Consumers expecting draft text in `trace.jsonl` must use `model-draft.txt` for new runs. A hard process kill can omit stream-end metadata and retain a short credential-redaction tail in memory; previously written artifact text remains available.
- Uncertainty: replay timestamps reflect replay speed, so these measurements say nothing about generation latency. Calls replayed from parsed objects do not exercise identity-based call-start deduplication; the dedicated synthetic test does.
- Decision: promote diagnostic changes after offline checks and visual verification. No agent-performance promotion or benchmark claim.
