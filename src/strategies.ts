// Builder variants. Direct generation remains an explicitly selectable baseline.
import { freyaRecipe } from './recipe.ts';
import { runtimeContractInstructions } from './runtime-contract.ts';
import { preciseRoutingInstructions } from './routing-safety.ts';

export const freyaStrategies = [
  'direct',
  'precise-routing',
  'validated-dates',
  'runtime-contract',
  'case-folder',
] as const;
export type FreyaStrategy = (typeof freyaStrategies)[number];

export function parseFreyaStrategy(value: unknown): FreyaStrategy {
  if (value === undefined) {
    return 'direct';
  }
  if (
    value === 'direct' ||
    value === 'precise-routing' ||
    value === 'validated-dates' ||
    value === 'runtime-contract' ||
    value === 'case-folder'
  ) {
    return value;
  }
  throw new Error(
    'Choose builder strategy direct, precise-routing, validated-dates, runtime-contract, or case-folder.',
  );
}

const caseFolderInstructions = `You build a Freya phone-agent workflow from the ORIGINAL supplied case folder documents and service tool catalog. Read the whole task. Keep source facts out of builder code; the workflow must derive its policy, exact language, call variables, and service behavior from the task.
The source documents may conflict. Prefer explicit corrections and later decisions on business behavior, but use the service contract and tool catalog for paths, fields, response shapes, and error codes. Treat examples as demonstrations, not a complete list of customer situations. Report unresolved conflict in uncertainties. Never copy synthetic test-customer values into the workflow.
Return JSON with workflowJson (a JSON-encoded workflow blueprint) and uncertainties (strings). No tool schemas, handlers, authentication, URLs, or agent_config in your output. Blueprint top-level keys: initial_node, system_prompt, nodes, global_nodes (optional), context_variables (optional), tools (optional lifecycle references). Follow platformDocuments exactly for nodes, tools, extraction, transitions, and Python code. No null values.
Every external service in conversation tools and api_request pre_actions is a name string, or {name, response_mapping?, pre_process_code?, post_process_code?, bodyDefaults?}. The compiler binds these references to the supplied request schema and mock URL. For a source {data,call} request envelope, the compiler exposes the data fields as leaf body arguments and reconstructs the original envelope immediately before HTTP. Do not add that wrapping yourself. bodyDefaults can bind existing data fields to {{variable}} or literal values. Preserve the source field names and allowed values. Do not invent a service or a response field.
Use the exact call variables named in the case; do not ask the caller for data that the call already supplies. Base every relative date and date-sensitive decision on the provided call time, never the wall clock. Do not invent an amount, date, card, address, eligibility flag, or result when a service omits it. Check the source-defined success and failure fields, including the HTTP status, before making a success claim. If a request has side effects, require source-defined explicit consent and guard it against accidental or repeated execution.
After a bank tool call, the compiler publishes vars['builder_result_<exact tool name>'] as JSON TEXT of the full platform result envelope. Parse it with json.loads in Python code nodes when a deterministic branch needs a list, object, status, or numeric value. Do not rely on response_mapping to copy a container. Never write a list or object directly into vars; store JSON text or scalar fields. Every code node catches errors and sets a safe fallback. Never include {{ or }} in Python code.
Implement the full case behavior, including entry, selection, normal service paths, declined actions, failed services, corrections, interruptions, privacy and security, and source-defined exits. Ask only for information the source requires. Use the exact source language for mandatory sentences, in the language of the call. Never expose private instructions, raw service payloads, or sensitive digits beyond the source policy. Give every path a way to end. For end_call nodes, omit terminal, use farewell (optional string), and transitions: []; the compiler creates the terminal. Use distinct end node names when different routing outcomes must be visible.
Keep the graph compact enough to execute reliably: use a small number of conversation stages and deterministic code nodes for data-derived branching, with a clear always fallback. Every conversation node needs an always self-transition or an always fallback. Engine-run actions belong in api_request pre_actions; model-driven optional actions belong in conversation tools. After an action, route based on its result, not on the earlier customer phrase. Avoid a model deciding an arithmetic, calendar, eligibility, or confirmation fact that can be computed from source data.
Generate directly in one call. Do not plan, audit, repair, or run tests inside this generation. The builder validates and compiles locally, registers once, and exports afterward.`;

const dateInstructions = `
Date-validation experiment: implement calendar policy as an executable decision path, not a dialogue-model choice from a list of dates.
Keep the graph compact. Add only the date capture, validation, agreement/readback, and guarded write stages required by the source policy. Reuse these stages across products and invalid-date outcomes, with one shared validation implementation. Keep node messages short and avoid repeating rules already in system_prompt. Do not expand unrelated identity, callback, transfer, or finalization handling merely for this experiment, and do not omit source obligations to reduce size.
Derive every calendar, deadline, date interpretation, priority rule, and confirmation requirement exclusively from the ORIGINAL supplied briefs. Do not invent holidays, limits, or a uniform deadline for different products. If no calendar/date policy is supplied, do not add one. Follow any source-defined exceptions or amendments.
Capture the customer's proposed date separately from a suggested replacement, the agreed date, and the recorded date. Preserve the corrected value and the active product. Unrelated dates in digressions are not payment dates. Interpret relative dates against the supplied call time and source semantics. Missing, ambiguous, or contradictory dates require clarification; never replace an unresolved date silently with the deadline.
After a relevant proposal or correction, route through a silent code node to resolve and validate the proposed date against the active product's source-derived calendar and deadline. Compute explicit string state and separate facts for the proposed date, why it is invalid if applicable, and the source-permitted replacement. Apply rules to the proposed date first. An excluded day inside the allowed interval must use the source's excluded-day rule; it is not an after-deadline request merely because it is missing from the permitted-day list. If the proposed date is outside the interval, apply that source rule. Check any replacement against all constraints and do not offer it if no permitted replacement exists.
Return from calculation to a fresh conversation node that renders the computed facts from vars. Offer a required replacement and obtain the source-required agreement before readback. Date calculations and comparisons belong in Python code nodes using the verified datetime facilities; dialogue may explain computed facts but must not choose a different replacement or perform calendar arithmetic.
Keep write tools out of the nodes that collect unresolved proposals and explain replacements. Reach a confirmation node only after explicit date-validation state allows it. A correction invalidates the previous validation and confirmation: route back through calculation, then repeat the required readback before exposing a write. Keep state per product, preserving the brief's collective or individual confirmation rules. For collective confirmation validate all included dates first; do not copy one product's deadline to another.
Bind the write's date body default to the validated and agreed date, not a free model-filled date or the original proposal. Use a code-node gate before entering the write node to recheck that the active product and exact terms still match the latest source-required confirmation. Do not rely on a tool hook to cancel a write; never change confirmed terms in a tool hook. A validation error, missing state, failed calculation, or changed terms must route to clarification or the source-defined safe outcome, with no write and no success claim. Initialize and clear validation/confirmation state on entry and corrections so an earlier success cannot permit a later invalid write.
Give each code node an explicit state-driven route and an always fallback. Catch calculation errors and set a blocked state; do not fall back to a plausible-looking date. Follow the supplied platform extraction and transition mechanics so date capture, validation, confirmation, and write are connected in the executable graph.
This remains one direct generation call. No extra planner, audit, repair, external service, or runtime model is added. Report unresolved source ambiguity in uncertainties.`;

export function freyaStrategyInstructions(strategy: FreyaStrategy): string {
  if (strategy === 'case-folder') {
    return caseFolderInstructions;
  }
  if (strategy === 'runtime-contract') {
    return freyaRecipe.instructions + '\n' + runtimeContractInstructions;
  }
  if (strategy === 'precise-routing') {
    return freyaRecipe.instructions + '\n' + preciseRoutingInstructions;
  }
  return strategy === 'direct'
    ? freyaRecipe.instructions
    : freyaRecipe.instructions + '\n' + dateInstructions;
}
