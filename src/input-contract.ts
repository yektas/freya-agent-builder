// Compiler-owned collection cycles and result guards; no business policy.
import type { JsonObject } from './contracts.ts';
import { object } from './validation.ts';
import { stagedObservations } from './observation-contract.ts';

export const missingInput = '__builder_missing__';

export const inputContractInstructions = `
Current-turn input contract v4:
Extract independent scalar fields, NEVER JSON serialized inside a string. Extraction variables are temporary observations, never persistent state. The compiler extracts into unconstrained string staging, resets staging and observation aliases to __builder_missing__, then validates authored types, enum_values and validation_pattern before publishing each alias as text. Missing, low-confidence or malformed values remain __builder_missing__; check before use. Supported types: string, integer, float, boolean (true/false), date (ISO YYYY-MM-DD), datetime (ISO with T and seconds), name (nonempty text), phone_number (digits with optional leading +, spaces, parentheses or hyphens). Apply additional source-specific validation in decision code. Never read or write compiler-owned builder_input_* variables. Copy validated observations into separately named persistent state only when the current stage permits them.
Extraction budget is a hard platform limit: at most 8 fields per collection node, and short descriptions with NO custom extraction_prompt unless one is genuinely required. A custom extraction_prompt replaces the platform's entire built-in template and applies to the whole node, so several long prompts make one extraction call so large that it returns nothing and the call stalls until the customer hangs up. Prefer no extraction_prompt and let the default template work; if a relative date needs the supplied call-time semantics, state that once in one field's prompt. Split a wide stage across several small collection nodes instead of widening one. Interpret relative dates against the supplied call variable in decision code rather than relying on extraction to resolve them.
Each collection node must declare collection_contract: {scope: '<one stage only>', max_visits: <integer 1..12>, exhausted_node: '<end_call node>'}. Choose a source-compatible technical collection budget, separate from business refusal/verification attempts. Visits are counted across re-entry and cannot reset after a malformed observation. Exhaustion ends safely without a success claim. Split opening, security questions, negotiation and confirmation into separate collection nodes as applicable; do not put the complete business procedure or sensitive facts for later stages in a shared collection prompt. Authoritative code and results determine entry to each stage. Collection messages must only address the declared scope, even if history suggests a later stage. These prompt constraints do not prove dialogue containment.
Every conversation node with extraction_schema must have exactly one always transition to a separate decision code node. The decision consumes the current observations before returning to collection; the compiler inserts the reset on each return. Do not use __previous__ to re-enter a collection or acknowledgement node. Use explicit node targets. Extract stage-relevant fields only. In particular a security date must never become a transaction date. Dates must use supplied call time and source semantics; custom extraction prompts must include all documented extractor placeholders. Validate normalized amounts and dates in code; labels or prose are not numeric values.
Preserve independent facts in compound speech: an answer or correction and a question can coexist. Do not let a single intent enum discard a provided answer, proposed terms, or a request. Extract independent flags or fields and apply the input brief's priority rules in decision code. Distinguish a future offer from a report of an already-completed action. Confirmation refers to the last read-back; only a newly observed correction invalidates it. Retained proposal values are not new corrections. If observation is missing or malformed, clarify safely rather than consuming a refusal attempt or guessing completion.
Success-claim contract:
Put every claim that a bank action succeeded in a dedicated conversation node with success_guard: {tool: '<exact tool name>', path: ['data','<source success field>'], equals: <source success value>, fallback_node: '<explicit recovery node>'}. The compiler checks the latest JSON result snapshot before entering that node, requiring transport success and the exact source-derived predicate. Guard paths and values come only from supplied response schemas. Guard nodes must not themselves have extraction_schema; route to a separate collection node if further input is needed. Keep generic collection messages neutral: never let them announce recording, booking, transfer or other successful writes merely from dialogue history or confirmation. A customer agreement is not tool success. Expose the authoritative recorded-action state in prompts and prohibit success claims unless the dedicated guard passed. If a later operation replaces a result snapshot, reach the acknowledgement immediately after the corresponding successful operation, not using an old claim inferred from history. No extra model calls or policy constants.`;

function codeNode(name: string, code: string, transitions: JsonObject[]): JsonObject {
  return {
    name,
    node_type: 'code',
    on_enter: { type: 'silent' },
    passthrough: true,
    passthrough_default_transition: transitions.at(-1)?.target_node,
    pre_actions: [{ code }],
    transitions,
  };
}

export function applyInputContract(workflow: JsonObject, toolNames: string[]): void {
  if (!object(workflow.nodes)) {
    return;
  }
  const nodes = workflow.nodes;
  const globals = object(workflow.global_nodes) ? workflow.global_nodes : {};
  const entries = new Map<string, string>();
  const additions: Record<string, JsonObject> = {};
  let collectionIndex = 0;
  const edge = (target: string) => ({ target_node: target, condition: { operator: 'always' } });
  for (const [key, raw] of Object.entries({ ...nodes, ...globals })) {
    if (key.startsWith('__builder_')) {
      throw new Error('Node prefix __builder_ is compiler-owned.');
    }
    if (!object(raw)) {
      continue;
    }
    const fields = raw.extraction_schema;
    const guard = raw.success_guard;
    if (fields === undefined && guard === undefined) {
      continue;
    }
    if (raw.node_type !== 'conversation' || key in globals) {
      throw new Error(`${key}: input and success contracts require normal conversation nodes.`);
    }
    if (fields !== undefined && guard !== undefined) {
      throw new Error(`${key}: separate success acknowledgement from input collection.`);
    }
    if (fields !== undefined) {
      if (
        !Array.isArray(fields) ||
        fields.length === 0 ||
        fields.some(
          (field) =>
            !object(field) ||
            typeof field.name !== 'string' ||
            !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field.name) ||
            field.name.startsWith('builder_'),
        )
      ) {
        throw new Error(`${key}: extraction fields need distinct nonreserved variable names.`);
      }
      const names = fields.map((field) => (field as JsonObject).name as string);
      for (const field of fields as JsonObject[]) {
        if (
          typeof field.min_confidence !== 'number' ||
          field.min_confidence < 0 ||
          field.min_confidence > 1
        ) {
          throw new Error(
            `${key}: every extraction field needs explicit min_confidence from 0 to 1.`,
          );
        }
        if (
          field.extraction_prompt !== undefined &&
          (typeof field.extraction_prompt !== 'string' ||
            [
              '{{extractor.speech}}',
              '{{extractor.conversation.last-10}}',
              '{{extractor.type_preamble}}',
              '{{extractor.variables_list}}',
            ].some((placeholder) => !(field.extraction_prompt as string).includes(placeholder)))
        ) {
          throw new Error(
            `${key}: custom extraction prompt needs all documented input placeholders.`,
          );
        }
      }
      if (new Set(names).size !== names.length) {
        throw new Error(`${key}: duplicate extraction variable.`);
      }
      const routes = raw.transitions;
      if (
        !Array.isArray(routes) ||
        routes.length !== 1 ||
        !object(routes[0]) ||
        !object(routes[0].condition) ||
        routes[0].condition.operator !== 'always' ||
        routes[0].is_tool_call === true ||
        typeof routes[0].target_node !== 'string' ||
        !object(nodes[routes[0].target_node]) ||
        (nodes[routes[0].target_node] as JsonObject).node_type !== 'code'
      ) {
        throw new Error(`${key}: extraction needs one always transition to a decision code node.`);
      }
      if (
        raw.passthrough === true ||
        raw.max_turn_transition !== undefined ||
        raw.passthrough_default_transition !== undefined
      ) {
        throw new Error(`${key}: collection cannot bypass current-turn decision processing.`);
      }
      if (Array.isArray(raw.tools) && raw.tools.length) {
        throw new Error(`${key}: collection must hand off before exposing bank tools.`);
      }
      const contract = raw.collection_contract;
      if (
        !object(contract) ||
        Object.keys(contract).some(
          (key) => !['scope', 'max_visits', 'exhausted_node'].includes(key),
        ) ||
        typeof contract.scope !== 'string' ||
        !contract.scope.trim() ||
        !Number.isInteger(contract.max_visits) ||
        Number(contract.max_visits) < 1 ||
        Number(contract.max_visits) > 12 ||
        typeof contract.exhausted_node !== 'string' ||
        !object(nodes[contract.exhausted_node]) ||
        (nodes[contract.exhausted_node] as JsonObject).node_type !== 'end_call'
      ) {
        throw new Error(
          `${key}: collection_contract needs a stage scope, max_visits 1..12 and an end_call exhausted_node.`,
        );
      }
      const staged = stagedObservations(fields as JsonObject[], collectionIndex++);
      raw.extraction_schema = staged.schema;
      delete raw.collection_contract;
      const consumeName = `__builder_consume_${key}`;
      additions[consumeName] = codeNode(consumeName, staged.consume, [
        edge(routes[0].target_node as string),
      ]);
      routes[0].target_node = consumeName;
      const containment = `Current collection scope: ${contract.scope}. Stay in this scope; do not advance to a later question or disclose information from a later stage based on history. No tool calls or success claims are allowed here.`;
      raw.task_message = [raw.task_message, containment].filter(Boolean).join('\n');
      if (raw.loop_prompt !== undefined) {
        raw.loop_prompt = [raw.loop_prompt, containment].join('\n');
      }
      if (object(raw.on_enter) && typeof raw.on_enter.prompt === 'string') {
        raw.on_enter.prompt += '\n' + containment;
      }
      raw.task_message = [
        raw.task_message,
        'Compiler contract: this step collects input only. Do not claim any bank action was recorded or completed here. A customer confirmation is not a successful tool result; only a dedicated guarded acknowledgement may report success.',
      ]
        .filter(Boolean)
        .join('\n');
      const name = `__builder_reset_${key}`;
      const count = `builder_collection_${collectionIndex}_visits`;
      const ready = `builder_collection_${collectionIndex}_ready`;
      additions[name] = codeNode(
        name,
        `vars[${JSON.stringify(ready)}] = 'blocked'\n${staged.reset}\ntry:\n    _builder_visits = int(vars.get(${JSON.stringify(count)}, '0')) + 1\n    vars[${JSON.stringify(count)}] = str(_builder_visits)\n    if 0 < _builder_visits <= ${contract.max_visits}:\n        vars[${JSON.stringify(ready)}] = 'ready'\nexcept Exception:\n    pass`,
        [
          {
            target_node: key,
            condition: { variable: ready, operator: 'equals', operand: 'ready' },
          },
          edge(contract.exhausted_node),
        ],
      );
      entries.set(key, name);
    }
    if (guard !== undefined) {
      if (
        !object(guard) ||
        Object.keys(guard).some(
          (field) => !['tool', 'path', 'equals', 'fallback_node'].includes(field),
        ) ||
        typeof guard.tool !== 'string' ||
        !toolNames.includes(guard.tool) ||
        !Array.isArray(guard.path) ||
        guard.path[0] !== 'data' ||
        guard.path.length < 2 ||
        guard.path.some((part) => typeof part !== 'string' || !part.length) ||
        !['string', 'boolean', 'number'].includes(typeof guard.equals) ||
        typeof guard.fallback_node !== 'string' ||
        !(guard.fallback_node in nodes) ||
        guard.fallback_node === key
      ) {
        throw new Error(
          `${key}: success_guard needs a known tool, data path, scalar equals and separate fallback_node.`,
        );
      }
      const name = `__builder_guard_${key}`;
      const state = `${name}_state`;
      // Encode literals as JSON text, then parse them in Python. Never splice Python values.
      const code = `import json
vars[${JSON.stringify(state)}] = 'blocked'
try:
    envelope = json.loads(vars.get(${JSON.stringify(`builder_result_${guard.tool}`)}, '{}'))
    expected = json.loads(${JSON.stringify(JSON.stringify(guard.equals))})
    value = envelope
    for part in json.loads(${JSON.stringify(JSON.stringify(guard.path))}):
        value = value[part]
    status_code = envelope.get('status_code')
    if envelope.get('status') == 'success' and isinstance(status_code, int) and 200 <= status_code < 300 and type(value) is type(expected) and value == expected:
        vars[${JSON.stringify(state)}] = 'ready'
except Exception:
    pass
`;
      additions[name] = codeNode(name, code, [
        { target_node: key, condition: { variable: state, operator: 'equals', operand: 'ready' } },
        edge(guard.fallback_node),
      ]);
      entries.set(key, name);
      delete raw.success_guard;
      raw.task_message = [
        raw.task_message,
        `Compiler contract: the result guard for ${guard.tool} passed before entry. Acknowledge only that checked action; do not infer success for any other action from conversation history.`,
      ]
        .filter(Boolean)
        .join('\n');
    }
  }
  // Rewrite authored entry edges, leaving wrappers' forward edge to their own node intact.
  for (const raw of Object.values({ ...nodes, ...globals })) {
    if (!object(raw)) {
      continue;
    }
    for (const transition of Array.isArray(raw.transitions) ? raw.transitions : []) {
      if (object(transition) && typeof transition.target_node === 'string') {
        if (entries.size && transition.target_node === '__previous__') {
          throw new Error(
            'Input and success contracts require explicit targets, not __previous__.',
          );
        }
        transition.target_node = entries.get(transition.target_node) ?? transition.target_node;
      }
    }
    for (const field of ['max_turn_transition', 'passthrough_default_transition']) {
      if (typeof raw[field] === 'string') {
        raw[field] = entries.get(raw[field]) ?? raw[field];
      }
    }
  }
  for (const [key, raw] of Object.entries(additions)) {
    if (key.startsWith('__builder_guard_')) {
      const fallback = (raw.transitions as JsonObject[])[1];
      fallback.target_node = entries.get(fallback.target_node as string) ?? fallback.target_node;
    }
  }
  workflow.initial_node = entries.get(workflow.initial_node as string) ?? workflow.initial_node;
  Object.assign(nodes, additions);
}
