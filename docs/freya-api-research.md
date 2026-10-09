# Freya public API research

**Verified:** October 9, 2026, against Freya's public site and documentation. This note records documented platform capability; it does not establish what the Build the Builder competition permits.

## Findings

Freya's public platform API documents a viable agent lifecycle: list a workspace, fetch its default agent configuration, create an agent, drive text turns through the chat API, and configure and run simulations or unit tests. The public docs do **not** currently provide enough detail to safely construct arbitrary tool bindings: agent config exposes `llmConfig.tools`, but its element schema and execution wiring are undocumented in the pages inspected. Keep generated task/tool data independent from Freya config until the competition contract or Freya provides the missing schema.

The Freya introduction describes voice agents and workflows for phone calls and says agents can execute functions and integrations. The English public homepage focuses on speech models; its Turkish locale describes banking and insurance voice automation and links to the YC “Build the Builder” event. These are product descriptions, not evidence that final tasks are voice-only. Sources: [Introduction](https://docs.freyavoice.ai/) and [Freya homepage](https://www.freyavoice.ai/).

## Authentication and workspace selection

All platform API examples use `Authorization: Bearer <token>`. The authentication guide says the token is generated from API Keys in a workspace dashboard and is tied to that workspace. It also recommends keeping the key in a secret store or environment variable, not client code. Source: [Authentication](https://docs.freyavoice.ai/api-reference/authentication).

The documented workspace probe is `GET https://app.freyavoice.ai/api/v2/workspaces`. Its example envelope is:

```json
{
  "success": true,
  "data": {
    "message": "…",
    "result": {
      "workspaces": [{ "id": "…", "name": "…" }]
    }
  }
}
```

So `data.result` is an object and the array is `data.result.workspaces`. The list-workspaces response example also includes workspace settings, members, and integrations. Source: [List workspaces](https://docs.freyavoice.ai/api-reference/workspaces/list-workspaces).

## Default config, create, and update agent

`GET https://app.freyavoice.ai/api/v2/agents/defaults` returns the editor's platform-default agent config, optionally localized. The API page marks query parameter `workspaceId` as required UUID and `language` as optional (max 10 characters). The documented success shape places the config at `data.result.config`. The cURL example omits the required `workspaceId` query parameter, so follow the parameter table rather than copying that incomplete example. Source: [Get default agent config](https://docs.freyavoice.ai/api-reference/agents/get-default-agent-config).

The create-agent cURL example sends `POST https://app.freyavoice.ai/api/v2/agents` with bearer auth, JSON content type, and a body like:

```json
{
  "workspaceId": "<workspace-uuid>",
  "name": "Task agent",
  "config": {
    "llmConfig": {
      "provider": "openai",
      "model": "gpt-4o",
      "systemPrompt": "…",
      "firstMessage": "…",
      "firstMessageMode": "assistant-speaks-first",
      "maxTokens": 1000,
      "temperature": 0.7
    }
  }
}
```

The page's request-field table says `name` is required (1–100 characters), `language` is optional (max 10), and `config` is an object. It does **not** list `workspaceId`, even though the example includes it. The response example is `success: true` with an object at `data.result.agent` (including `id`, `workspaceId`, `name`, and `config`) and the endpoint documents HTTP 201. The model/provider values above are examples, not a complete allowlist. Source: [Create agent](https://docs.freyavoice.ai/api-reference/agents/create-agent).

The default response example shows `llmConfig` keys including `provider`, `model`, `systemPrompt`, `baseUrl`, `apiKey`, `firstMessage`, `firstMessageMode`, `maxTokens`, `maxContextWindow`, `temperature`, `tools: []`, `additionalSettings`, `retryExhaustionMessage`, and `farewellMessage`. It also includes `ttsConfig`, `sttConfig`, `complianceConfig`, call timeout, voicemail, and DTMF settings. Use the default config as the starting template and change only fields supported by the task, once an authorized workspace is available. The response example is large and includes secrets-shaped fields such as `apiKey`; do not log or expose real config values.

`PUT /api/v2/agents/{agentId}` is documented for updating an existing agent's name, config, or files. Its body field table marks both `agentId` and `workspaceId` as required and allows `name`, `config`, `commitMessage`, and `commitDescription`; the path also requires `agentId`. Source: [Update agent](https://docs.freyavoice.ai/api-reference/agents/update-agent).

## Tool and function wiring: documented gap

Agent config includes an `llmConfig.tools` array, currently empty in the default response example. The create and update endpoints accept `config` as an opaque object; the docs inspected do not specify a tool element's JSON shape, whether it is a provider-native function schema, where a tool handler URL is placed, how invocation results are returned, or whether task-provided tools can be attached at agent creation.

The [Agents guide](https://docs.freyavoice.ai/guides/fundamentals/agents#functions) says functions define purpose, parameters, and return values; they can integrate APIs, have error handling, and be chained. The [Integrations guide](https://docs.freyavoice.ai/guides/fundamentals/integrations#function-calls) calls functions the primary way agents interact with external systems and says functions can call external API endpoints. These are high-level descriptions and contain no request/response schema for a function. The public API navigation exposes integrations list/remove operations, but no documented function-registration operation.

**Adapter recommendation:** do not invent the `llmConfig.tools` structure or equate campaign webhooks with agent tools. Keep the competition's tool catalog in a platform-independent contract. Once official instructions arrive, establish whether the task tools are pre-bound by the evaluator, passed as function definitions, or expected to be configured in Freya; only then map them into `config`.

## Text chat for a quick test

`POST https://app.freyavoice.ai/api/v2/chat/message` accepts a required `message` (1–10,000 characters), with optional `callId`, `agentId`, `workflowId`, `customerVariables`, `versionId`, and `fromMessageId`. To start a text call, omit `callId` and supply `agentId` or `workflowId`; the response returns a `callId` for later turns. `fromMessageId` forks from an earlier assistant turn. The documented result is an object with `response`, `callId`, `messageId`, `warning`, and `endedByAgent`; the example envelope has `success: true`. Source: [Send a chat message](https://docs.freyavoice.ai/api-reference/chat/send-a-chat-message).

This is a documented way to exercise an agent over text. It does not prove that the competition runner uses this endpoint or permits chat calls during final evaluation.

## Simulations, results, and traces

`POST /api/v2/simulations` creates a simulation for an agent. The documented example body includes `name`, `agentId`, `selectedPersonaIds`, `description`, `tags`, `mode`, `assertions`, `customerVariablesMap`, run limits, and optional `agentVersionId`. The field table marks `name`, `agentId`, and `selectedPersonaIds` as required; `selectedPersonaIds` must have 1–1,000 entries. `mode` is `voice` or `chat` and defaults to `voice`. Documented ranges include `maxConcurrentCalls` 1–1,000, `maxCallDurationSeconds` 60–3,600, `maxRetries` 0–10, and `runsPerPersona` 1–50. The create response returns an object at `data.result.simulation`; creating it alone does not run it. Source: [Create simulation](https://docs.freyavoice.ai/api-reference/simulations/create-simulation).

`POST /api/v2/simulations/{simulationId}/rerun` starts a new iteration and returns `success`, an `iteration` object (`id`, `simulationId`, `iterationIndex`, `label`, `status`), and `runsStarted`. This is a state-changing evaluation operation; neither availability nor cost/permission in the hackathon is established by the docs. Source: [Rerun simulation](https://docs.freyavoice.ai/api-reference/simulations/rerun-simulation).

Documented read endpoints provide progressively more detail:

- [List iterations](https://docs.freyavoice.ai/api-reference/simulation-iterations/list-iterations): iteration status, `totalRuns`, `passedRuns`, `failedRuns`, `passRate`, error/inconclusive/running counts, agent version, and selected run parameters.
- [List simulation checks for a version](https://docs.freyavoice.ai/api-reference/simulations/list-simulation-checks-for-a-version): latest-iteration check rows with `simulationId`, `name`, `status`, `failedRuns`, `latestIterationId`, `latestAt`, and `score`; requires `workspaceId` and `entityVersionId` query parameters.
- [List simulation persona runs for a version](https://docs.freyavoice.ai/api-reference/simulations/list-simulation-persona-runs-for-a-version): rows with persona and simulation names/IDs, `status`, `runId`, and `latestAt`; also requires `workspaceId` and `entityVersionId`.
- [Get call details](https://docs.freyavoice.ai/api-reference/calls/get-call-details): requires `callId` path and `workspaceId` query. The documented response includes transcript, messages, summary, timing/latency, and `assertionsSummary`. The response schema calls `analysis` and `artifact` unknown. It does not document a structured tool-call trace, and it does not show whether the simulation `runId` is the `callId` for this endpoint; verify that mapping before building trace retrieval.

## Unit tests and mock tool results

The API also documents non-simulation unit-test operations. [Create unit test](https://docs.freyavoice.ai/api-reference/unit-tests/create-unit-test) accepts `workspaceId`, `entityType` (`agent` or `workflow`), `entityId`, an input snapshot with messages/customer variables, a name, optional expectation/assertions, `judgeContext`, and seed-call metadata. The example `judgeContext` has booleans `includeRoutingEvents`, `includeExtractionEvents`, `includeToolCalls`, and `includeOtherEvents`.

[Run all unit tests](https://docs.freyavoice.ai/api-reference/unit-tests/run-all-unit-tests) accepts workspace/entity identifiers, optional version/test IDs, `mockToolResults`, `judgeLlmOverride`, and `repeat` (1–20). It enqueues runs and returns run/job IDs with HTTP 202. [Get unit-test run](https://docs.freyavoice.ai/api-reference/unit-tests/get-unit-test-run) returns an outcome, agent response, latency/judge metadata, messages, and assertion results (`passed`, `detail`, `observed`). The example's `observed` is unknown-shaped; the page does not supply a complete tool-call trace schema.

The create-unit-test cURL example omits `entityType` even though its field table marks that field required. Treat the body table and versioned API contract as authoritative once participant access is available. Unit-test runs can be useful for development-time evaluation, but public documentation does not say they may be called by the final competition builder.

## Models, runtime, and webhooks

The agent example uses LLM provider `openai` and model `gpt-4o`, while the general Agents guide names GPT-4, Claude, and GPT-3.5 as model-selection examples. These sources do not define a complete supported-provider/model allowlist or competition model restrictions. The create example's `ttsConfig` uses ElevenLabs and `sttConfig` uses Deepgram; those too are example values. The separate [Model API introduction](https://docs.freyavoice.ai/model-api-reference/introduction) says standalone Freya Model APIs are STT and TTS endpoints, separate from the platform Call API; they do not supply an LLM tool schema.

The public [Integrations guide](https://docs.freyavoice.ai/guides/fundamentals/integrations) describes function calls, direct API calls, and inbound/outbound webhooks at a high level. The [end-of-call report webhook](https://docs.freyavoice.ai/api-reference/webhooks/end-of-call-report-webhook) documents lifecycle fields such as call/workspace IDs, status, timestamps, recording URL, summary, reason, and transcript. The [campaign call-outcome webhook](https://docs.freyavoice.ai/api-reference/webhooks/call-outcome-webhook) documents campaign outcome/failure/retry fields. These are call-event reporting contracts, not documentation for registering arbitrary in-call task tools.

## Recommended next steps once rules and credentials arrive

1. Confirm the official evaluation input/output contract and permitted Freya endpoints before using any simulation or unit-test operation.
2. If authorized, use the bearer token to list workspaces, select the explicit competition workspace ID, and fetch its localized default config.
3. Merge generated instructions into the fetched config, preserving platform defaults, and create the agent. Record the returned agent ID and response; do not blindly retry after an uncertain create result.
4. Use the text chat endpoint only if the challenge supports text turns. Test tools only after the official input provides an actual tool schema/handler contract.
5. If official rules allow simulations or unit tests, start with the smallest bounded test and inspect returned run IDs, version summaries, and call details. Establish cost, concurrency, and run-count limits first.

Unknown from public sources: the challenge-specific auth/credentials, official workspace, input and output schema, tool-binding format, whether tasks are voice/chat, whether simulations or unit tests are permitted during evaluation, credit/call/runtime limits, and how to obtain a full function-call trace.
