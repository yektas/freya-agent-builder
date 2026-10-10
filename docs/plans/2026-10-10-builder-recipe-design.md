# Editable builder recipe

The user approved one small, readable file for controlling the builder's instructions and sequence. Keep the existing direct-generation baseline and put that control in `src/recipe.ts`.

The recipe owns model instructions, call/output/time limits, and the generate → validate → compile sequence. The runtime supplies generation and local compilation operations with deadline enforcement. Supporting modules retain API transport, structural schemas, command-line input, and run records. Model selection remains explicit through the environment or CLI. Registration stays separate from compilation.

Moving only the prompt would leave the strategy elsewhere. A configurable stage framework would add another abstraction to learn. A plain TypeScript object and function expose both instructions and strategy without adding a framework.

Preserve the existing prompt text, request fields, validation behavior, input/tool preservation, and failure reporting. Mock generation remains an explicitly fake offline fixture. Source snapshots automatically include the recipe, and run records use its call budget.

This is an organizational refactor, not a new generation strategy or platform integration. No benchmark improvement is claimed. Future behavioral edits to the recipe must use `docs/experiment-template.md` and compare tasks before promotion.

Validation: run `pnpm run check` and an offline mock demo. Existing injected-transport tests verify the live request uses recipe instructions and token limits. CLI tests verify the recipe is saved in the source snapshot and its call budget is recorded. No official evaluation is performed.
