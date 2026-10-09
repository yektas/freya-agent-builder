# Working on this builder

Optimize generated-agent performance on unseen tasks. Keep direct generation as a measurable baseline.

- Before platform integration, read `docs/freya-api-research.md` and the actual event package. Public APIs and our internal contracts are distinct from the competition interface.
- Preserve original task/tool fields. Keep tool schemas out of generated output; translate them only at the verified platform boundary.
- `PlatformAdapter.create` compiles locally. Register the selected agent separately so repair attempts do not create remote duplicates.
- Label mock runs and synthetic fixtures explicitly. Structural validity and audit probabilities are not benchmark scores.
- Keep model-call budgets and deadlines bounded. Preserve a valid fallback when optional audit or repair fails.
- For behavioral changes, use `docs/experiment-template.md`; compare across tasks and record regressions before promotion.
- Run `pnpm run check` after implementation changes. Tests use injected transports and must remain offline by default.
- Runtime TypeScript must work under Node's native stripping; keep erasable syntax and explicit `.ts` imports.
- Keep credentials in environment variables and experiment artifacts out of Git. Log exact input/config/source versions without auth headers.
- At event start and submission freeze, follow `docs/event-runbook.md`.
