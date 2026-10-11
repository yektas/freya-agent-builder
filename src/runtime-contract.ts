// Compiler-owned mechanics only. No brief rules or bank response field names.
import type { JsonObject } from './contracts.ts';
import { object } from './validation.ts';
import { inputContractInstructions } from './input-contract.ts';

export const runtimeContractInstructions = `
Runtime contract v1 (compiler-owned, overrides assumptions about response variable storage):
After each bank tool completes, vars['builder_result_<exact tool name>'] holds JSON TEXT of the current result envelope with status, data, message, and status_code only. Read it with json.loads(vars.get('builder_result_<exact tool name>', '{}')). Objects and arrays inside data retain their full structure, including empty containers and null. Inspect source response schemas for fields; the contract supplies no business policy. A missing or invalid snapshot is blocked, never success. Snapshots are replaced on every result, including failures; they are latest results, not a ledger of completed actions.
Every container in data is also published as JSON TEXT under its own response path, so vars.get('<tool>_response.data.products') returns a JSON string and json.loads gives the whole array. Scalars keep the platform's flattened leaf form. Either representation is valid; never write a list or object straight into vars.
Do not write builder_result_* variables yourself or put credential/header/request data into result. Post-hooks receive the current result dict directly; use result['data'] with type checks there.
Derive critical prerequisites, retry limits, exceptions, and terminal outcomes from the supplied brief. Implement them as explicit string state and result-driven routing, not only instructions to the dialogue model. For sequential prerequisites, keep later actions unavailable until the previous authoritative result allows them. A failed answer stays at the current question; corrections invalidate only the affected state as the source requires. Add a source-derived what_to_do_next instruction in tool result data when the dialogue must interpret a negative or ambiguous result. Do not invent retry rules.
Store successful business actions separately from latest tool responses so a later error cannot erase a recorded action or permit a duplicate write. Guard writes using current source-required validation and confirmation state. On exceptions set blocked state and follow the source-defined recovery or safe outcome. Each automatic node needs an always fallback; every normal node must have a graph path to an end_call node. Static acceptance checks do not prove business correctness. Keep the workflow compact and keep the one-call generation budget.
${inputContractInstructions}`;

export function snapshotToolResult(binding: JsonObject): JsonObject {
  const name = (binding.function as JsonObject).name as string;
  const original = binding.post_process_code;
  if (original !== undefined && typeof original !== 'string') {
    throw new Error(`post_process_code must be Python text: ${name}`);
  }
  // Initialize before authored code: an exception must not retain old success.
  // Never serialize headers or request arguments into the contract snapshot.
  binding.post_process_code = [
    `vars[${JSON.stringify(`builder_result_${name}`)}] = '{}'`,
    original,
    `try:
    import json
    if isinstance(result, dict):
        _builder_envelope = {key: result[key] for key in ['status', 'data', 'message', 'status_code'] if key in result}
        vars[${JSON.stringify(`builder_result_${name}`)}] = json.dumps(_builder_envelope)
except Exception:
    vars[${JSON.stringify(`builder_result_${name}`)}] = '{}'
`,
    // Separate try: a publish failure must never destroy the snapshot above.
    `try:
    import json
    _builder_prefix = ${JSON.stringify(`${name}_response.data.`)}
    def _builder_publish(path, value, depth):
        if depth > 4:
            return
        if isinstance(value, (list, dict)):
            vars[_builder_prefix + path] = json.dumps(value)
        if isinstance(value, dict):
            for _builder_child in value:
                _builder_publish(path + '.' + str(_builder_child), value[_builder_child], depth + 1)
    _builder_data = result.get('data') if isinstance(result, dict) else None
    if isinstance(_builder_data, dict):
        for _builder_key in _builder_data:
            _builder_publish(str(_builder_key), _builder_data[_builder_key], 1)
    elif isinstance(_builder_data, list):
        _builder_publish('data', _builder_data, 1)
except Exception:
    pass
`,
  ]
    .filter(Boolean)
    .join('\n');
  return binding;
}

// Deliberately bounded static checks, not a Python evaluator or a policy judge.
export function runtimeContractIssues(blueprint: JsonObject): string[] {
  const issues: string[] = [];
  const nodes = object(blueprint.nodes) ? blueprint.nodes : {};
  const globals = object(blueprint.global_nodes) ? blueprint.global_nodes : {};
  const all = { ...nodes, ...globals };
  for (const [key, raw] of Object.entries(all)) {
    if (!object(raw)) {
      continue;
    }
    if (['code', 'api_request'].includes(String(raw.node_type))) {
      const transitions = Array.isArray(raw.transitions) ? raw.transitions : [];
      if (
        !transitions.some(
          (edge) => object(edge) && object(edge.condition) && edge.condition.operator === 'always',
        )
      ) {
        issues.push(`${key}: automatic node needs an always fallback.`);
      }
    }
    // Literal response reads are no longer checked: the compiler publishes every
    // container under its documented path, so `...data.products` and the snapshot both
    // resolve. Whether a given read is followed by json.loads is not statically decidable,
    // and a wrong guess would reject the compiler's own generated guard code.
  }
  const canEnd = new Set(
    Object.entries(all)
      .filter(([, raw]) => object(raw) && raw.node_type === 'end_call')
      .map(([key]) => key),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, raw] of Object.entries(all)) {
      if (!object(raw) || canEnd.has(key)) {
        continue;
      }
      const targets = [
        raw.passthrough_default_transition,
        raw.max_turn_transition,
        ...(Array.isArray(raw.transitions)
          ? raw.transitions.filter(object).map((edge) => edge.target_node)
          : []),
      ];
      if (targets.some((target) => typeof target === 'string' && canEnd.has(target))) {
        canEnd.add(key);
        changed = true;
      }
    }
  }
  for (const key of Object.keys(nodes)) {
    if (!canEnd.has(key)) {
      issues.push(`${key}: no explicit graph path to an end_call node.`);
    }
  }
  return issues;
}
