# Freya end-to-end integration — 10 October 2026

The user requested integration and an end-to-end practice run before optimizing the builder. This introduces the smallest event-specific direct-generation path while preserving the original internal baseline.

## Design

`freyaRecipe` in `src/recipe.ts` owns the generation instructions, budgets, and sequence. Read original briefs and original OpenAPI, make one generation request, compile tool references locally, validate on staging without saving, register the selected workflow, export the stored workflow, then use the official practice runner. No audit or repair stage is added.

Use the original `freya.py`, `tools/run_cases.py`, and `tools/score.py` through a JSON subprocess bridge instead of implementing competing platform and scoring contracts. Bound each subprocess by the remaining overall deadline. Keep credentials in the subprocess environment; strip auth headers and credentials from recorded responses and embedded transcript JSON. Cache slots and personas per verified workspace, publish updates, and prevent registration races. Preserve a pending marker after an uncertain create so a later run cannot silently duplicate the remote workflow.

The model receives unchanged source brief text, original OpenAPI text/document, derived tool catalog, and workflow/tool documentation. It receives no practice case scripts or expected ledgers. It emits a workflow JSON blueprint without tool schemas. Local compilation binds exact source request fields/enums and endpoints; it creates terminal/code handler schemas at the verified platform boundary. Compiler business policy is not hard-coded to the public briefs.

## Experiment record

- Hypothesis: the event boundary and original runner let us measure the direct-generation builder end to end before optimizing it.
- Baseline source hash / commit: original internal direct generation; exact working-tree source is captured in each run. No official workflow or practice score exists for this baseline.
- Candidate source hash / commit: each integration run captures every runtime source file, original kit files, inputs, hashes, and configuration.
- Single intentional change: connect direct generation to event workflow compilation, registration, export, and official practice evaluation.
- Model / call / time budgets: explicit configured builder model; one call; 12,000 output tokens; 120 seconds for generation; 1,800 seconds total including tests.
- Development tasks and repetitions: offline compiler/client/scorer fixtures; planned live A (ten cases) and A+B/B (three cases), one repetition each.
- Holdout tasks: unseen final briefs not used.
- Organizer score definition and weighting: original ledger scorer plus conversation judge; a case must satisfy both. Final repeated scoring remains distinct.

| Task          | Baseline score | Candidate score | Repetitions | Latency | Failure change                    | Run paths |
| ------------- | -------------- | --------------- | ----------- | ------- | --------------------------------- | --------- |
| A             | null           | null            | 0 live      | null    | Live run blocked before execution | none      |
| A+B / B cases | null           | null            | 0 live      | null    | Not yet run                       | none      |

- Earliest consequential failure in the trace: no live generation or registration started. The staging workspace probe succeeded; automatic approval review rejected the live pipeline before execution.
- Evidence supporting the proposed mechanism: offline tests exercise the original organizer client and scorer with an injected urllib transport, workflow-slot reuse and publication, schema preservation, changed source enums, invalid routes/action placement, secret/header redaction, and export-before-practice failure behavior.
- Regressions or missing cases: the original internal baseline remains available. Event compiler intentionally rejects unsupported operations/schemas and generated tool definitions. Live platform compatibility and practice behavior remain unverified.
- Uncertainty / suspected noise: synthetic offline fixture verdicts are not official scores; one future live repetition would be a baseline, not robust final benchmark evidence.
- Decision: retain the integration for live verification; no behavioral optimization promoted.
- Reason: live execution requires explicit approval after automatic review rejected external disclosure to OpenAI and workflow/practice mutations on Freya, despite the user's substantive request for end-to-end integration/testing.
