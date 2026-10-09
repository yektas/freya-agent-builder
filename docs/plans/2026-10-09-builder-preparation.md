# Pre-event implementation decisions

The user authorized pre-event coding and asked to prepare as much as possible. The agreed design separates generation, deterministic validation, optional semantic audit, and platform adaptation.

## Implemented choice

Use TypeScript with Node's native type stripping, no runtime packages, and pinned development type checks. Keep direct generation as the baseline. Planned generation and Decisions audit are explicit experiment flags. Keep the original task/tool catalog available to every generation or repair call.

Use bounded repairs, total request limits, a wall-clock deadline, and a materialized valid fallback. Compile artifacts locally; perform eventual platform registration only after selecting the candidate.

Persist complete experiment inputs, options, candidate history, model calls and source snapshots. Use synthetic fixtures only for offline plumbing verification. Official scores remain absent until a real evaluator is connected.

## Alternatives retained

- Multi-candidate search: defer until evaluation feedback and budgets justify it.
- Runtime System One controller: defer until Freya runtime customization is verified.
- Jev audit provider: defer until account access and exact interface are confirmed.
- Full workflow/state-machine generation: defer until benchmark failures show a need.

## Remaining integration work

Public Freya defaults/create/chat APIs have narrow prepared clients, but the event input/output contract and exact task-tool binding schema remain unknown. Public platform capability is not proof of competition permission. Event docs supersede our internal envelope and public API assumptions.
