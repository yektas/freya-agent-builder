# Build the Builder

The language of the Freya collections-agent competition — the rules a phone agent must
follow, the simulated customers it faces, and the bank records that decide whether it
succeeded. Our own builder terms live here too, because several of them collide with the
competition's and the collisions are the dangerous part.

## The call

**Brief**:
A bank's written specification of the rules a phone agent must follow. Final briefs arrive
either as a clean specification or as raw bank material.
_Avoid_: spec, instructions, prompt — the brief is a document, not model input

**Phone agent**:
The runtime conversational agent created from a workflow; the thing simulated customers
actually talk to.
_Avoid_: agent (unqualified), assistant

**Workflow**:
The graph that defines a phone agent — nodes, transitions, prompts, tool bindings. The
workflow, not the phone agent, is what is exported, submitted and reloaded for scoring.
_Avoid_: phone agent, agent spec, agent config

**Node**:
One step of a conversation inside a workflow, with its own prompt and its own permitted
tools.
_Avoid_: step, stage, state

**Transition**:
An edge moving the conversation to another node, fired either by what the customer said or
by a variable's value.
_Avoid_: edge, route, branch

**Call variable**:
An input supplied when a call starts — who the customer is, and what time it is. A brief's
own notion of now is authoritative; the wall clock is not.
_Avoid_: parameters, arguments

## The evaluation

**Case**:
One practice scenario — a simulated customer plus the bank records that must result if the
call is handled correctly.
_Avoid_: task, test, customer, scenario

**Customer**:
The simulated person on the other end of the call. Their facts come from the case; how they
speak may vary without changing those facts.
_Avoid_: persona, caller

**Persona**:
The prompt that tells the customer simulator how to play one customer in one case.
_Avoid_: customer, script

**Ledger**:
The bank's authoritative record of one call — every tool call, its result, and the
promises, notes, callbacks and transfers it produced. The ledger decides outcomes; the
agent's own account of the call never does.
_Avoid_: records, history, transcript

**Transcript**:
The conversation as recorded, tool calls included. Read by a judge model, never the basis
for an outcome.
_Avoid_: ledger, call log

**Handled**:
A case in which the ledger is correct _and_ the conversation stayed inside the brief _and_
the agent told the customer the truth. All three, or nothing.
_Avoid_: pass, correct, solved

**Ledger-correct**:
The bank records match what the brief requires. One third of handled.
_Avoid_: outcome pass, scored

**Policy-honest**:
The conversation stayed inside the brief and the agent never claimed a write that had
failed. The other two thirds of handled.
_Avoid_: tone, quality

**Simulation**:
One run of a set of cases against one phone agent. The unit the practice runner executes.
_Avoid_: run record, test run

## What the bank records

**Promise**:
A recorded agreement to pay a stated amount on a stated date for one product. At most one
per product per call, and only after the customer confirms a read-back. Also the outcome
name for a call that recorded at least one.
_Avoid_: payment, commitment, offer — an offer is what the agent proposes; only a
confirmed, recorded promise is a promise

**Note**:
A recorded annotation against a product for a reason other than a promise. Brief A never
uses notes; Brief B requires them.
_Avoid_: comment, remark

**Callback**:
A scheduled future contact at a stated date and time, used when the intended customer is
not available.

**Transfer**:
Handing the call to a human queue. Brief A's transfers and Brief B's notes are mutually
exclusive on the same call.

**Outcome**:
The call's final classification when it closes.
_Avoid_: disposition, status, result

**Reason**:
The sub-classification every outcome except promise and paid must carry. The brief fixes
the vocabulary; the platform does not.
_Avoid_: sub-outcome, cause

## The brief's arithmetic

**Band**:
How late a product is, which fixes both its deadline and how many persuasion attempts the
agent gets. Brief A has two bands.
_Avoid_: tier, severity, bracket

**Deadline**:
The latest date a promise for a product may carry, counted in business days from today
against the bank's holiday calendar.

**Floor**:
The smallest amount recordable for a product. Below it nothing may be promised.

**Persuasion attempt**:
A single proposal of a date or amount made after a refusal, budgeted per product.
_Avoid_: retry, follow-up — a tool retry is a different thing entirely

## Our builder

**Task**:
The input envelope our builder consumes: an id, a description and a tool catalog. The
competition has no such object — its real inputs are briefs plus a tool API file.
_Avoid_: brief, case

**Tool**:
A schema fragment describing something the built agent may call — a name, a description and
a parameter schema. Not the callable itself, and not necessarily one of the bank's tools.
_Avoid_: function, endpoint, capability

**Candidate**:
What our generator produces, before anything is compiled or registered: a flat description
of intended policy. Not a workflow, and not the artifact that gets scored.
_Avoid_: candidate workflow, submission, deliverable

**Artifact**:
A locally compiled result of a build, kept in our own records.
_Avoid_: phone agent, workflow

**Registration**:
The separate, deliberate act of putting one selected workflow onto the platform. Never a
side effect of compiling.
_Avoid_: create, save

**Direct generation**:
The baseline strategy — one model call produces the candidate in a single step, with no
planning, audit or repair stage.
_Avoid_: one-shot, single-pass

**Run record**:
An append-only local record of one build: inputs, hashes, configuration, model calls,
result. Bookkeeping, never an official score.
_Avoid_: evaluation, score
