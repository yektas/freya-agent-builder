# Experiment record

- Hypothesis: codex-lb's documented `/v1/responses` endpoint can serve the existing API generation contract when the base URL is configurable.
- Baseline source hash / commit: Existing working tree; run artifacts retain exact source snapshots.
- Candidate source hash / commit: Working tree with `OPENAI_BASE_URL` support.
- Single intentional change: Responses API destination. Original task/tool fields, instructions, schema, call budget, and local compilation remain unchanged.
- Model / call / time budgets: Existing bounded generation budgets. One small diagnostic request used `gpt-6.1-sol`, low effort, a 45-second deadline, and the existing streaming parser.
- Development tasks and repetitions: Offline synthetic request and URL validation tests; one live diagnostic boolean request through codex-lb. The diagnostic is not an organizer task or benchmark.
- Holdout tasks (evaluate only at the planned checkpoint): No cross-task workflow evaluation performed.
- Organizer score definition and weighting: Unchanged; missing scores remain null.

| Task                                | Baseline score | Candidate score | Repetitions        | Latency         | Failure change                                                            | Run paths                |
| ----------------------------------- | -------------- | --------------- | ------------------ | --------------- | ------------------------------------------------------------------------- | ------------------------ |
| Synthetic Responses request         | null           | null            | offline test suite | not benchmarked | Custom endpoint preserves payload, auth exclusion, and redirect rejection | temporary fixtures       |
| Diagnostic boolean through codex-lb | null           | null            | 1                  | under 45s       | SSE events and completed JSON received                                    | terminal-only diagnostic |

- Earliest consequential failure in the trace: None in the diagnostic; the baseline could only call OpenAI's public URL.
- Evidence supporting the proposed mechanism: Local `/openapi.json` documents bearer authentication and `/v1/responses`, including structured text and reasoning controls. The live request returned the requested boolean with streaming events.
- Regressions or missing cases: Full workflow and organizer evaluations remain untested on this API route. Model pricing estimates may not reflect proxy billing; explicit environment pricing overrides remain available.
- Uncertainty / suspected noise: A small diagnostic establishes transport compatibility, not generated-agent quality or long-run reliability.
- Decision: Promote endpoint configurability only; retain OpenAI's URL as the default and no automatic fallback.
- Reason: Supports the user's chosen Responses-compatible transport with bounded calls and credentials kept server-side. Local `.env` remains ignored by Git; artifacts record the base URL without auth headers.
