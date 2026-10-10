# Builder simplification — 10 October 2026

The user requested removing unnecessary code and starting with a simple baseline after reviewing the official event contract. This is a scope reduction, not a promotion of an experimentally superior agent.

## Decision

Keep the existing repository and its minimal direct-generation path: preserve input, make one generation request, validate the candidate, compile locally, and record the run. Retain mock/offline testing, model transport, bounded budgets/deadlines, and source/configuration traces. Keep one explicitly synthetic task to exercise that plumbing.

Remove the visual workbench, planned generation, collections-specific prompt profile, Decisions audits and repairs, and public agent-API integration that predates the official staging workflow contract. Remove their scripts, fixture breadth, and configuration knobs. Keep just the `build` CLI command; remove batch execution, repetitions, aggregated reports, and the doctor command. Combine the single Responses transport and generator rather than maintaining a generic client and request stage. Restore the missing synthetic reschedule fixture so the demo and offline tests work. Retain official event research as reference material; remove superseded preparation plans and proposals for removed features.

The generated internal specification is still not an official workflow. Do not interpret this cleanup as completed platform integration or a benchmark improvement. The original starter kit and bank schemas remain authoritative and must be preserved.

## Validation and measurement

`pnpm run check` passes formatting, lint, native TypeScript checking, and all nine offline tests. The mock demo saves a source-versioned run with the original synthetic task and no model calls. Removed commands and options are rejected. Current structural checks are plumbing checks, not semantic evaluation.

Comparison record (using the fields in `docs/experiment-template.md`):

- Hypothesis: removing unused paths reduces maintenance without changing the direct-generation prompt or request.
- Baseline: pre-cleanup working tree; the check failed because the synthetic demo fixture was missing.
- Candidate: single-command direct generation; exact source hash is saved in each run record.
- Model / call / time budgets: mock smoke run; live path allows one Responses request, 6000 output tokens, and a 120-second default build deadline.
- Development tasks: synthetic reschedule smoke task, plus offline empty-catalog and invalid-output tests.
- Holdout tasks: official A+B and hidden tasks have not been evaluated.
- Organizer score: null; structural validation is not a benchmark.
- Regressions: batch/report/doctor commands and the separate client API are deliberately removed; generated prompt and request fields are unchanged.
- Decision: retain as starting scaffold, with no claim of improved agent performance.

There are no official before/after scores or measured task regressions from this cleanup. Removing optional planning, profiles, audits, and repairs deliberately removes their behavior. Keep direct generation as the baseline and use `docs/experiment-template.md` to compare across public A+B tasks before promoting future behavior.

## Next increment

Implement a single event workflow compiler using the actual brief and OpenAPI files, with registration separate from local compilation. Connect the official practice runner with a bounded deadline, then export the selected workflow. Only add extra generation stages when repeated practice results justify them.
