# JSON-only generation

The user narrowed the current scope to generating a Freya-compatible JSON document and printing it to the terminal, with no Freya API calls. Add `pnpm run generate`, backed by `freya --json-only`. Default to the original public Brief A; allow explicit brief and OpenAPI paths. Keep full registration and testing as the separate existing live path.

Reuse `freyaRecipe.generate` for both paths so they use the same instructions, original inputs, one-call budget, and local compiler. JSON-only mode requires only the OpenAI credentials/model, stops after local compilation, and writes neither artifacts nor run records as explicitly requested. It does not load practice inputs or start the Python bridge.

Generation behavior and compiler policy are unchanged; this changes the execution boundary. No benchmark improvement or platform validity is claimed. The CLI test uses an injected model transport, rejects any other request URL, supplies no Freya credentials and an unavailable Python executable, parses stdout as the compiled workflow, and verifies no output files were created. Tests remain offline. Live model generation is not executed during this change.
