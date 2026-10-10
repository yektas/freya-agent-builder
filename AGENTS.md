# Working on this builder

Optimize generated-agent performance on unseen tasks. Keep direct generation as a measurable baseline.

- Before platform integration, read `docs/freya-api-research.md` and the actual event package. Public APIs and our internal contracts are distinct from the competition interface.
- Preserve original task/tool fields. Keep tool schemas out of generated output; translate them only at the verified platform boundary.
- `PlatformAdapter.create` compiles locally. Register the selected agent separately so repair attempts do not create remote duplicates.
- Label mock runs and synthetic fixtures explicitly. Structural validity and audit probabilities are not benchmark scores.
- Keep model-call budgets and deadlines bounded. Preserve a valid fallback when optional audit or repair fails.
- For behavioral changes, use `docs/experiment-template.md`; compare across tasks and record regressions before promotion.
- Run `pnpm run check` after implementation changes. Tests use injected transports and must remain offline by default.
- The run inspector (`pnpm run ui`) keeps recorded runs read-only: loopback only, GET only except for the two authorized actions below, and it serves only artifact names found by its own scan. Keep credentials out of anything it reads or serves.
- The upload exception to that policy is explicitly authorized: `POST /api/runs/:id/upload` on a completed generation registers the recorded `compiled.workflow.json` on Freya, so a reviewer can upload existing JSON with no further model call. It is one of the two authorized writes. Keep credentials server-side, accept only ids the scan discovered, refuse cross-origin and non-loopback requests, bound the deadline, and leave every route other than upload and generation GET-only. It uploads only; practice testing stays a separate action.
- Starting a new generation is also explicitly authorized: `POST /api/generate` accepts provider, model, and reasoning effort only, uses the configured event package, and records one bounded local generation. Keep credentials server-side, refuse cross-origin and non-loopback requests, and permit only one UI generation at a time. Registration and practice testing stay separate.
- The inspector UI in `ui/` is built with Vite and Base UI components from the shadcn CLI. The Node process must never import that bundle; `src/ui/server.ts` only serves built files. Runtime code under `src/` stays build-free.
- Runtime TypeScript must work under Node's native stripping; keep erasable syntax and explicit `.ts` imports.
- Keep credentials in environment variables and experiment artifacts out of Git. Log exact input/config/source versions without auth headers.
- At event start and submission freeze, verify requirements against the actual event package and current organizer updates.
