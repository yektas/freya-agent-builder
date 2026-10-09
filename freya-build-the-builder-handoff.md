# Freya “Build the Builder” Hackathon — Agent Handoff Brief

**Status:** Pre-hackathon; no participant platform access yet  
**Prepared:** Friday, October 9, 2026, approximately 17:14 **Europe/Istanbul (UTC+3)**  
**Participant:** Solo developer; intends to use **OpenAI Codex** as the primary coding assistant  
**Reported start:** Saturday, October 10, 2026, **03:00 Istanbul time** (participant-reported; confirm against organizer instructions)  
**Hackathon dates:** October 10–11, 2026  
**Primary site:** https://www.freyavoice.ai/  
**Public documentation:** https://docs.freyavoice.ai/

> **Instruction to the next agent:** Treat this as a state-of-play brief, not as evidence that implementation has started. Distinguish the organizer's confirmed rules, the public Freya API documentation, our proposed strategy, and unknown hackathon-specific details. Do not assume any API key, practice benchmark, hackathon SDK, or participant credentials are available.

---

## 1. Mission in one sentence

**Build an automated agent builder:** given an **unseen task description** and its **available tools**, the submitted builder creates a working Freya agent capable of completing that task _without human editing during the final evaluation_.

This is **not** a competition to produce one excellent manually crafted agent. It tests how well the _generator_ generalizes to tasks not known at development time.

### Organizer's challenge (authoritative information supplied by participant)

- Build a builder during the weekend using **Freya's platform**.
- The builder takes a **new task** and **available tools** and creates a task-solving agent.
- At the deadline, organizers provide **previously unseen tasks**.
- Submitted builder automatically creates the agents for those tasks.
- Organizers execute the generated agents in **benchmark simulations**.
- **Final rankings are determined by agent performance across unseen benchmark tasks/test cases**, not by slide decks, demos, pitch quality, or a hand-built agent.
- Everyone receives the same final evaluation conditions.
- Participant may decide how the builder creates, tests, and improves agents _before evaluation_, subject to rules/resource constraints announced later.
- Final submission: **the builder, exact code version, dependencies, and reproducible run instructions**.
- Practice benchmark can be used to improve the builder; final unseen benchmark decides placements.

### Schedule

| Date       | Announced activity                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| October 10 | Rules, development tasks, platform setup; build and test against practice tasks                                              |
| October 11 | Finish testing, submit reproducible builder; organizers run unseen final benchmark; leaderboard published after verification |

**Important:** The overview says exact times will be sent to accepted participants. The user separately reports a **Saturday 03:00 Istanbul start**. Use this as planning context until confirmed.

### Participation and prizes

- Fully online.
- Solo encouraged; teams limited to two. **This participant is solo.**
- 1st place: **YC interview**.
- 2nd place: **AirPods**.
- Top three: **final interview with Freya**.
- **$3,000 in Freya credits** in the prize pool.

---

## 2. The key conceptual correction

Earlier brainstorming overemphasized finding the best _per-task_ prompt with repeated simulation runs. That might be valuable, but **the guaranteed objective is to improve the general-purpose builder**, not manually fine-tune each generated agent.

There are **two separate optimization loops**:

### Loop A — development-time optimization of the builder (definitely relevant)

```text
Practice tasks + tool definitions
             ↓
       CURRENT BUILDER
             ↓
       Generated agents
             ↓
   Practice benchmark runs
             ↓
    Failures / performance
             ↓
    Improve BUILDER logic
             ↺
```

Changes during development can include task-analysis logic, generated prompt structure, tool-use policies, schema validation, templates, architecture selection, and more.

### Loop B — test/improve an individual generated agent (conditional)

```text
Previously unseen task + available tools
             ↓
           BUILDER
             ↓
       Candidate agent
             ↓
    Optional testing (?)
             ↓
    Optional improvement (?)
             ↓
       Submitted agent
             ↓
    Organizer's final benchmark
```

**Do not assume Loop B is allowed.** It depends on undisclosed final evaluation rules: whether the submitted builder can run test simulations, receive useful feedback, create several candidates, and spend extra resources at inference time.

**Hard requirement:** The builder must still generate a good agent **in one pass, with no feedback**.

---

## 3. What is confirmed, observed, proposed, or unknown?

| Item                                                  | Status                               | Notes                                                               |
| ----------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| Unseen tasks are used for final ranking               | **Confirmed: organizer description** | Core objective                                                      |
| Builder receives task description and available tools | **Confirmed: organizer description** | Input contract format unknown                                       |
| No manual agent edits during evaluation               | **Confirmed: organizer description** | Builder must be fully automated                                     |
| Practice benchmark exists                             | **Confirmed: organizer description** | Exact test interface unknown                                        |
| Freya is a voice-agent/workflow platform              | **Verified: public docs**            | Do **not** conclude final tasks are necessarily voice-only          |
| Public Freya agent creation API exists                | **Verified: public docs**            | Hackathon may use a different/limited interface                     |
| Public APIs for simulations and unit tests exist      | **Verified: public docs**            | Access, costs, execution semantics, and hackathon allowance unknown |
| TypeScript/Node.js and Codex                          | **Selected working preference**      | Not a competition requirement                                       |
| Strong tool-aware task-analysis pipeline              | **Proposed architecture**            | Needs testing against practice tasks                                |
| Automatic evaluation/optimization per unseen task     | **Optional hypothesis**              | Implement only if rules justify it                                  |
| Final task domains, scoring, time/cost limits         | **Unknown**                          | First priority after rules drop                                     |
| Participant credentials / practice tasks              | **Not yet available**                | Do not pretend to have tested live platform                         |

### Public Freya documentation checked (October 9)

- Freya is described as a platform for AI-powered **voice agents and phone-call workflows**: https://docs.freyavoice.ai/
- API reference lists:
  - **Create agent:** https://docs.freyavoice.ai/api-reference/agents/create-agent
  - **Get default agent config:** https://docs.freyavoice.ai/api-reference/agents/get-default-agent-config
  - **Update agent:** see Agents section in API docs.
  - **List simulations:** https://docs.freyavoice.ai/api-reference/simulations/list-simulations
  - **Create simulation:** https://docs.freyavoice.ai/api-reference/simulations/create-simulation
  - **Rerun simulation:** https://docs.freyavoice.ai/api-reference/simulations/rerun-simulation
  - The API navigation also includes simulation checks, persona runs, iterations, unit-test creation/runs, versions, and chat.
- Public **Create agent** example uses `POST https://app.freyavoice.ai/api/v2/agents` with bearer authentication and an object containing `workspaceId`, `name`, and `config`. Example configuration has `llmConfig` (including `systemPrompt`, `firstMessage`, model/provider and temperature), plus `ttsConfig`, `sttConfig`, and `complianceConfig`. **This is an illustrative public payload, not a verified hackathon payload.**

**Caution:** The public website and docs demonstrate general platform features. They do **not** establish what the hackathon runners permit, what the unseen task envelope looks like, or whether practice/final simulations can be called programmatically.

---

## 4. Recommended technical goal

Create a **small, deterministic, tool-aware pipeline** that translates a task + tool catalog into a valid agent specification and then creates an agent on Freya:

```text
┌───────────────────────────────┐
│ Task description + tool specs │
└───────────────┬───────────────┘
                ▼
     ┌─────────────────────┐
     │ 1. Task analyzer    │
     │ goal / constraints  │
     │ required info       │
     │ success conditions  │
     └──────────┬──────────┘
                ▼
     ┌─────────────────────┐
     │ 2. Tool analyzer    │
     │ parameters / timing │
     │ preconditions       │
     │ dependencies/errors │
     └──────────┬──────────┘
                ▼
     ┌─────────────────────┐
     │ 3. Agent generator  │
     │ instructions        │
     │ tool-use policies   │
     │ task-completion     │
     └──────────┬──────────┘
                ▼
     ┌─────────────────────┐
     │ 4. Validation       │
     │ schema / references │
     │ consistency checks  │
     └──────────┬──────────┘
                ▼
     ┌─────────────────────┐
     │ 5. Freya adapter    │
     │ create / configure  │
     └──────────┬──────────┘
                ▼
         GENERATED AGENT
                │
     (Optional, if allowed)
                ▼
    Evaluate → diagnose → revise
```

### Capability A: Task understanding

Convert free-text task into a **structured intermediate representation**, with fields such as:

- `objective`
- `role` and `audience`
- `successCriteria`
- `requiredInputs`
- `allowedActions`
- `forbiddenActions` / safety and policy boundaries
- `conversationFlow` / likely states
- `edgeCases`
- `terminationConditions`
- `uncertainties` (do not silently invent task rules)

The structure above is a **design proposal**, not the Freya schema.

### Capability B: Tool understanding (**especially important**)

The task description specifically mentions **available tools**. Generated agents need more than a nice role prompt.

For each tool:

- Read name, description, argument schema, mandatory fields, and return shape when available.
- Explain precisely _when_ it should be called and _what evidence_ is needed first.
- Identify tool dependencies and order (e.g. lookup before mutation).
- Specify validation, failure behavior, missing details, retries, and fallbacks.
- Distinguish read-only operations from consequential writes.
- Never hallucinate unavailable tools or required arguments.
- Encode which outcomes require confirmation and what counts as completion.

**Hypothetical example** (not a known benchmark task):

```text
Task: Help a customer cancel an airline booking.
Available tools:
  get_booking(id)
  check_refund_eligibility(bookingId)
  issue_refund(bookingId)
  search_alternative_flights(origin, destination, date)
  rebook_flight(bookingId, flightId)

Generated strategy:
  verify booking → check eligibility → ask preference
     ├─ refund requested → authorized refund → confirm result
     └─ rebook requested → search options → confirm choice
                          → perform rebooking → confirm result
```

The tool/flow reasoning should be **generated from the new task and tools**, not hardcoded for airlines.

### Capability C: Agent generation

Build the platform-compatible configuration containing whatever the actual API requires (possibly):

- Clear system instructions defining role, boundaries, objective.
- Dynamic, step-by-step tool policy.
- Necessary conversational and information-gathering guidance.
- Error handling and recovery paths.
- Success/completion condition and graceful termination.
- Model/voice/runtime configuration only to the extent supported and relevant.

**Important:** The optimal generated output may be a simple agent prompt, a multi-step workflow, or a more constrained policy. Do not assume all tasks need the same complex architecture. Initially prefer a robust single-agent baseline.

### Capability D: Validation before submission

Cheap checks can improve reliability even with zero simulation budget:

- Config conforms to verified schema.
- Every named tool actually exists and arguments match exposed schema.
- Requirements and termination conditions are covered.
- No contradictory instructions.
- High-risk side effects are not executed without prerequisites.
- Final output uses the exact required handoff contract.

---

## 5. Experimentation strategy

**Primary metric:** Score on _different tasks_, not performance on just one rehearsed example.

**Minimum experiment record:**

```json
{
  "taskId": "practice-001",
  "builderVersion": "git-sha",
  "agentSpecHash": "sha256...",
  "benchmarkResult": { "score": null, "passed": null, "total": null },
  "failureCategory": null,
  "hypothesis": null,
  "nextChange": null
}
```

This JSON is an **example for our local logs**, not a claimed Freya response.

Recommended development cycle:

1. Build a plain task+tools → agent baseline.
2. Run every available _practice_ task.
3. Save generated specs, scores, transcripts/feedback **if actually available**.
4. Categorize failures, e.g. wrong tool, missing required parameter, ordering error, unsupported assumption, prompt ambiguity, incorrect task completion, poor conversational recovery.
5. Fix **generalizable builder behavior**, not task-specific prompt wording.
6. Re-run the complete practice suite when feasible; look for regressions across tasks.
7. Track the exact version and configuration used for each experiment.

**Avoid benchmark overfitting:** Don't encode practice task answers into the builder if doing so hurts unseen-task adaptability.

**If final-time test runs are allowed:** Add bounded candidate generation and revision using real feedback; preserve a fallback to the best _valid_ candidate if budget is exhausted or a simulation fails.

**If final-time test runs are forbidden/unaffordable:** Use single-pass generation plus structural and semantic validation; no dependency on benchmark access.

---

## 6. Practical project shape (proposal, not existing code)

```text
freya-agent-builder/
├── AGENTS.md                  # Rules for Codex working in this repo
├── README.md                  # Exact install/run/reproduction instructions
├── package.json
├── src/
│   ├── index.ts               # CLI entry point / evaluator contract
│   ├── builder.ts             # Orchestrate all stages
│   ├── task-analyzer.ts       # Task → intermediate requirements
│   ├── tool-analyzer.ts       # Available tools → call policies/dependencies
│   ├── generator.ts           # Requirements → candidate agent spec
│   ├── validator.ts           # Schema + static checks
│   ├── evaluator.ts           # Optional practice evaluation interface
│   ├── optimizer.ts           # Optional feedback-based iteration
│   └── freya/
│       ├── client.ts          # Platform-specific API calls
│       └── types.ts           # Verified request/response structures
├── tests/
└── experiments/
```

**Preferred stack:** TypeScript + Node.js. Favor minimal dependencies and an LLM SDK only if needed. This matches participant's experience and Codex workflow; adapt to official rules if they specify another environment.

**Architecture rule:** Keep Freya-specific request/response details isolated behind a narrow adapter. The internal task specification should not depend on guessed Freya API fields.

**Do not add** a dashboard, database, microservice stack, complex multi-agent orchestration, vector memory, large workflow engine, or RL loop unless practice evidence and scoring limits justify them.

---

## 7. Work priorities and constraints

### Right now: before access and rules

**Do:**

- Read the public docs for agent creation, agent configuration, tool/function wiring, and simulation entry points.
- Design the platform-independent **task + tools → structured plan → agent spec** transformation.
- If coding, scaffold a small TypeScript project with mocks and no assumptions about the final API shape.
- Prepare a short `AGENTS.md` for Codex emphasizing correctness, validation, unit tests, documentation, and reproducibility.
- Ensure everything can be rerun with a single command once the actual submission format is known.

**Do not:**

- Pretend to have live Freya access, an API key, or benchmark results.
- Spend hours prompt-tuning against hypothetical tasks.
- Hardcode that the unseen problems are all airline/support/sales calls.
- Build a sophisticated per-task optimizer before confirming it can be used.
- Assume the public API equals the hackathon API.
- Treat model choice or agent count as the primary winning advantage.

### Immediately when the hackathon opens

1. **Read official rules and challenge package first.**
2. Establish the exact builder **input and output contracts** and submission mechanism.
3. Confirm hard limits: allowed APIs, model providers, API budgets, generation time, max candidates, simulation privileges, number of calls, total runtime, internet/network restrictions, persistence across tasks, tie-breakers.
4. Inspect **practice task diversity** and tool schema.
5. Implement the smallest **end-to-end runnable builder** producing one accepted Freya agent.
6. Run the baseline against the practice benchmark.
7. Categorize mistakes; add improvements with demonstrable across-task value.
8. Reserve time for reproducibility, exact dependency pinning, secret handling, and clean-run verification.

### Suggested implementation order after rules are known

| Priority | Deliverable                           | Definition of done                                                           |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| P0       | Running submission path               | A fresh task reliably produces an evaluable Freya agent                      |
| P0       | Task/tool grounding                   | Generated agent refers only to actual available tools and required arguments |
| P0       | Schema checks                         | Invalid generated configs rejected/fixed before submission                   |
| P1       | Practice harness                      | Persist task, agent config, result and errors reproducibly                   |
| P1       | Targeted generalizable improvements   | Reduces repeated failure modes on multiple tasks                             |
| P2       | Bounded candidate search/optimization | Only if official rules/latency budgets permit                                |
| P2       | Advanced workflows/templates          | Only if benchmark evidence supports complexity                               |

---

## 8. Biggest outstanding questions (do not guess)

1. **Actual task format:** plain text, JSON, tools as JSON Schema/OpenAPI/Freya functions, or another contract?
2. **Agent creation contract:** public REST API, special hackathon SDK, command-line evaluation harness, or hosted playground?
3. **Allowed output:** agent ID, full config object, workflow, executable code, or something else?
4. **Task domains:** voice call/conversational only, or broader software agent tasks?
5. **Tool execution:** how do task-specific tools get attached, authorized, invoked, and tested?
6. **Practice feedback:** scores, step-level check results, transcripts, tool traces, errors, and timing?
7. **Final-run optimization:** can builder test agents on unseen tasks before submitting them? Can it call simulations? Can it create several candidates?
8. **Limits:** runtime, number of API calls, tokens, simulation count, costs/credits, deterministic settings, retry limits?
9. **Security:** network access, secrets injection, external model calls, persistent storage, reproducibility rules?
10. **Scoring:** per-task weighting, completion vs compliance, penalties for latency/cost/errors, tie-breakers?
11. **Submission:** exact CLI/function interface, packaging, dependencies, credential handling, version freeze?
12. **Model/config constraints:** permitted LLM providers, voice settings, default agent config, function-call structure?

---

## 9. Decisions and non-decisions from the discussion

### Working decisions

- Participant is **solo** and expects to use **Codex** for coding.
- Focus on **generalization across unseen tasks**.
- Build **the builder**, not one agent for a fixed task.
- Prioritize **understanding tool semantics and prerequisites**.
- Separate **builder development optimization** from **optional final-time candidate optimization**.
- A useful baseline must function **without per-task simulations**.
- Use **TypeScript + Node.js** provisionally.
- Favor **small modules**, **verified contracts**, and **no needless infrastructure**.
- Use practice failures to improve **the general algorithm**, not just one practice prompt.

### Not yet decided

- Exact Freya integration, auth, tool wiring, SDK, package layout.
- Model provider and model(s) for the builder.
- Whether agents should generally be prompts or workflows.
- Whether final-time testing and optimization are allowed.
- How many candidate agents to generate.
- Scoring-oriented strategies until practice benchmarks are available.
- Whether to start implementing any Freya API client before event-specific instructions arrive.

---

## 10. Instructions to a successor coding/research agent

> You are helping a solo experienced TypeScript engineer prepare for the **Freya Build the Builder hackathon** on October 10–11, 2026. They are using **Codex**.
>
> **Objective:** Build an automated pipeline that receives an unknown task and the available tools, creates a valid Freya task-solving agent, and can run without manual changes in the final unseen benchmark.
>
> **Before taking action:**
>
> 1. Read this brief.
> 2. Verify all **public API details** against current Freya docs.
> 3. Do **not** invent official challenge interfaces or claim access to unreleased benchmark materials.
> 4. Treat documented Freya functionality as **platform capability**, not as proof of hackathon permission.
>
> **First deliverable to propose:** a lean task-analysis + tool-analysis + generated-agent schema pipeline, with mocked platform integration until official access arrives.
>
> **On receiving official rules:** discard any conflicting assumptions, map the exact input/output contract, and get a full end-to-end baseline running **before** investing in advanced optimization.
>
> **Quality bar:** valid agents, correct tool grounding, clear task completion conditions, reliable error handling, fast reproducible execution, and evidence-driven changes that help across tasks.
>
> **Communication style:** concise and technical; separate facts from hypotheses. Challenge unjustified assumptions. Prefer concrete schemas, failure modes, and test plans over vague architectural enthusiasm.

---

## 11. Final takeaway

**Winning hypothesis:** A compact, reliable, tool-aware agent generator that generalizes across task categories is likely to be a stronger starting point than an elaborate system optimized for one scenario.

This is a **hypothesis**, not a demonstrated leaderboard advantage. Test it as soon as practice tasks and scoring are released.

**Current state:** Strategy defined; platform docs publicly available; **no participant access, official hackathon input/output schema, practice benchmark scores, or verified implementation yet**.
