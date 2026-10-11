// Verified event boundary: original OpenAPI -> Freya tool functions.
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { JsonObject, Task, Tool } from './contracts.ts';
import { object, parseTask } from './validation.ts';
import { runtimeContractIssues, snapshotToolResult } from './runtime-contract.ts';
import { applyInputContract } from './input-contract.ts';
import { routingSafetyIssues } from './routing-safety.ts';
import { readCaseDocuments } from './case-documents.ts';

export type WorkflowCandidate = { workflowJson: string; uncertainties: string[] };
export type Workflow = JsonObject;

function resolveSchema(value: unknown, document: JsonObject, seen: string[] = []): any {
  if (Array.isArray(value)) {
    return value.map((item) => resolveSchema(item, document, seen));
  }
  if (!object(value)) {
    return value;
  }
  if (typeof value.$ref === 'string') {
    const ref = value.$ref;
    if (!ref.startsWith('#/') || seen.includes(ref)) {
      throw new Error(`Unsupported external or recursive OpenAPI reference: ${ref}`);
    }
    let target: any = document;
    for (const part of ref.slice(2).split('/')) {
      target = target?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
    }
    if (!target) {
      throw new Error(`Missing OpenAPI reference: ${ref}`);
    }
    const { $ref: _, ...rest } = value;
    return resolveSchema({ ...target, ...rest }, document, [...seen, ref]);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, resolveSchema(item, document, seen)]),
  );
}

export function toolsFromOpenAPI(document: JsonObject): Tool[] {
  if (
    !object(document.paths) ||
    !Array.isArray(document.servers) ||
    !object(document.servers[0]) ||
    typeof document.servers[0].url !== 'string'
  ) {
    throw new Error('OpenAPI needs paths and a server URL.');
  }
  const tools: Tool[] = [];
  for (const [path, methods] of Object.entries(document.paths)) {
    if (!object(methods)) {
      throw new Error(`Invalid OpenAPI path: ${path}`);
    }
    for (const [method, source] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) {
        continue;
      }
      if (method !== 'post' || !object(source)) {
        throw new Error(`Event compiler supports POST JSON operations only: ${path}`);
      }
      const operation = resolveSchema(source, document);
      if (
        operation.parameters?.length ||
        operation.security?.length ||
        (Array.isArray(document.security) && document.security.length)
      ) {
        throw new Error(`Unsupported authenticated or parameterized operation: ${path}`);
      }
      const schema = operation.requestBody?.content?.['application/json']?.schema;
      if (!object(schema) || schema.type !== 'object' || !object(schema.properties)) {
        throw new Error(`Missing object request schema: ${path}`);
      }
      const name = operation.operationId || path.split('/').filter(Boolean).at(-1);
      if (typeof name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(`Invalid tool name: ${path}`);
      }
      tools.push({
        name,
        description: operation.description || operation.summary || name,
        parameters: schema,
        path,
        method: 'POST',
        url: document.servers[0].url.replace(/\/$/, '') + path,
        originalOperation: structuredClone(source),
      });
    }
  }
  if (!tools.length) {
    throw new Error('OpenAPI contains no supported tools.');
  }
  return tools;
}

export async function loadFreyaTask(
  briefPaths: string[],
  openapiPath: string,
  kit: string,
  caseFolder?: string,
): Promise<Task> {
  const briefs = caseFolder
    ? (await readCaseDocuments(caseFolder)).map((document) => ({
        path: resolve(caseFolder, document.path),
        text: document.text,
      }))
    : await Promise.all(
        briefPaths.map(async (path) => ({
          path: resolve(path),
          text: await readFile(path, 'utf8'),
        })),
      );
  const openapiText = await readFile(openapiPath, 'utf8');
  const openapi: unknown = JSON.parse(openapiText);
  if (!object(openapi)) {
    throw new Error('OpenAPI must be an object.');
  }
  const documents = await Promise.all(
    ['workflow-format.md', 'tools-and-code.md'].map(async (name) => ({
      name,
      text: await readFile(join(kit, 'docs', name), 'utf8'),
    })),
  );
  return parseTask({
    id: caseFolder
      ? basename(resolve(caseFolder))
      : briefPaths.map((path) => basename(path, '.md')).join('+'),
    description: briefs.map((brief) => `# Source: ${brief.path}\n\n${brief.text}`).join('\n\n'),
    tools: toolsFromOpenAPI(openapi),
    briefs,
    ...(caseFolder ? { caseFolder: resolve(caseFolder) } : {}),
    openapi: { path: resolve(openapiPath), text: openapiText, document: openapi },
    platformDocuments: documents,
  });
}

export const workflowCandidateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    workflowJson: { type: 'string' },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
  required: ['workflowJson', 'uncertainties'],
};

export function parseWorkflowCandidate(value: unknown): WorkflowCandidate {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !['workflowJson', 'uncertainties'].includes(key)) ||
    typeof value.workflowJson !== 'string' ||
    !Array.isArray(value.uncertainties) ||
    !value.uncertainties.every((item) => typeof item === 'string')
  ) {
    throw new Error('Expected workflowJson and uncertainties only.');
  }
  return structuredClone(value) as WorkflowCandidate;
}

function bindTool(
  value: unknown,
  catalog: Tool[],
  mockBase?: string,
  lifecycle = false,
): JsonObject {
  const ref = typeof value === 'string' ? { name: value } : value;
  if (!object(ref) || typeof ref.name !== 'string') {
    throw new Error('Tools must be names or named references.');
  }
  const allowed = [
    'name',
    'response_mapping',
    'pre_process_code',
    'post_process_code',
    'bodyDefaults',
  ];
  if (Object.keys(ref).some((key) => !allowed.includes(key))) {
    throw new Error('Generated tool schemas and handler configuration are not allowed.');
  }
  const tool = catalog.find((item) => item.name === ref.name);
  if (!tool) {
    throw new Error(`Unknown bank tool: ${ref.name}`);
  }
  const originalBody = structuredClone(tool.parameters);
  const originalProperties = originalBody.properties as Record<string, JsonObject>;
  const enveloped =
    object(originalProperties.data) &&
    originalProperties.data.type === 'object' &&
    object(originalProperties.data.properties) &&
    object(originalProperties.call) &&
    originalProperties.call.type === 'object' &&
    object(originalProperties.call.properties);
  // The verified api_call body model accepts leaf fields under body.properties.
  // For an external {data, call} envelope, expose the original data leaves to
  // the model and reconstruct the source envelope immediately before HTTP.
  const body = enveloped ? structuredClone(originalProperties.data) : originalBody;
  const properties = body.properties as Record<string, JsonObject>;
  const defaults = ref.bodyDefaults ?? {};
  if (!object(defaults) || Object.keys(defaults).some((name) => !(name in properties))) {
    throw new Error(`Unknown body default for ${tool.name}`);
  }
  for (const [name, schema] of Object.entries(properties)) {
    schema.default =
      defaults[name] ??
      schema.default ??
      (name === 'customer_id' ? '{{customer_id}}' : `{{arg_${tool.name}_${name}}}`);
  }
  const result: JsonObject = {
    type: 'function',
    config: {
      timeoutMs: 12000,
      maxRetries: 0,
      ...(lifecycle ? { alwaysRunsAt: ['end_of_call'] } : {}),
    },
    function: {
      name: tool.name,
      description: tool.description,
      handler: '__function__:api_call',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', default: mockBase ? mockBase + tool.path : tool.url },
          method: { type: 'string', default: tool.method },
          headers: {
            type: 'object',
            properties: { 'Content-Type': { type: 'string', default: 'application/json' } },
          },
          connect_retries: { type: 'number', default: 0 },
          body,
        },
      },
    },
  };
  for (const key of ['response_mapping', 'pre_process_code', 'post_process_code']) {
    if (key in ref) {
      result[key] = structuredClone(ref[key]);
    }
  }
  if (enveloped) {
    const callProperties = originalProperties.call.properties as Record<string, JsonObject>;
    const callDefaults = Object.fromEntries(
      Object.entries(callProperties).map(([name, schema]) => [name, schema.default ?? '']),
    );
    const authored = result.pre_process_code;
    if (authored !== undefined && typeof authored !== 'string') {
      throw new Error(`pre_process_code must be Python text: ${tool.name}`);
    }
    result.pre_process_code = [
      authored,
      `try:\n    import json\n    _builder_data = config.get('body', {})\n    if isinstance(_builder_data, dict):\n        config['body'] = {'data': _builder_data, 'call': json.loads(${JSON.stringify(JSON.stringify(callDefaults))})}\nexcept Exception:\n    pass\n`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return result;
}

function exposePreActionResponse(binding: JsonObject): JsonObject {
  const name = (binding.function as JsonObject).name as string;
  const original = binding.post_process_code;
  if (original !== undefined && typeof original !== 'string') {
    throw new Error(`post_process_code must be Python text: ${name}`);
  }
  // Freya flattens pre-action responses under the NODE name, whereas
  // conversation tools use the TOOL name. Keep the builder's tool-named
  // contract at this boundary, including array leaves that response_mapping
  // cannot copy. Preserve the native node result and any authored post-hook.
  binding.post_process_code = [
    original,
    `try:
    _builder_response_prefix = ${JSON.stringify(`${name}_response.`)}
    for _builder_response_key in list(vars):
        if str(_builder_response_key).startswith(_builder_response_prefix):
            del vars[_builder_response_key]
    def _builder_response_leaf(path, value):
        if isinstance(value, dict):
            for key, item in value.items():
                _builder_response_leaf(path + '.' + str(key), item)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                _builder_response_leaf(path + '.' + str(index), item)
        else:
            vars[path] = ('true' if value else 'false') if isinstance(value, bool) else ('null' if value is None else value)
    if isinstance(result, dict):
        for _builder_response_field in ['status', 'data', 'message', 'status_code']:
            if _builder_response_field in result:
                _builder_response_leaf(_builder_response_prefix + _builder_response_field, result[_builder_response_field])
except Exception:
    pass
`,
  ]
    .filter(Boolean)
    .join('\n');
  return binding;
}

/**
 * Drop backslashes that begin an escape JSON does not define.
 *
 * A model asked to embed JSON inside a JSON string sometimes writes `\'` because it is
 * reasoning about a nested quoted literal. That single character makes the whole
 * document unparseable and loses an entire paid generation. Every defined escape is left
 * byte-for-byte alone, so a document that already parses is returned unchanged.
 */
export function relaxInvalidEscapes(source: string): string {
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== '\\') {
      out += source[i];
      continue;
    }
    const next = source[i + 1];
    if (next === undefined) {
      out += '\\';
      break;
    }
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(source.slice(i + 2, i + 6))) {
      out += source.slice(i, i + 6);
      i += 5;
      continue;
    }
    if ('"\\/bfnrt'.includes(next)) {
      out += '\\' + next;
      i += 1;
      continue;
    }
    out += next;
    i += 1;
  }
  return out;
}

function parseBlueprint(source: string): unknown {
  // A model can produce a valid outer response but omit the backslashes around
  // a quoted literal inside workflowJson (observed in a generated Python code
  // string). Repair only a quote that JSON.parse has just treated as the end of
  // a value and that is followed by non-JSON content, allowing whitespace. Do not infer
  // missing fields or delimiters. The normal compiler checks still run after it.
  let candidate = relaxInvalidEscapes(source);
  for (let repairs = 0; repairs <= 64; repairs += 1) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      if (!(error instanceof SyntaxError) || repairs === 64) {
        throw error;
      }
      const position = /after (?:property value|array element) in JSON at position (\d+)/.exec(
        error.message,
      )?.[1];
      const at = position === undefined ? -1 : Number(position);
      // JSON.parse reports the next non-whitespace character, which can be a
      // Python keyword following the unescaped quote (for example, `" for`).
      let quoteEnd = at;
      while (quoteEnd > 0 && /\s/.test(candidate[quoteEnd - 1]!)) {
        quoteEnd -= 1;
      }
      if (
        at < 1 ||
        candidate[quoteEnd - 1] !== '"' ||
        !candidate[at] ||
        /[\s,}\]:"]/.test(candidate[at])
      ) {
        throw error;
      }
      candidate = `${candidate.slice(0, quoteEnd - 1)}\\${candidate.slice(quoteEnd - 1)}`;
    }
  }
  throw new Error('Unreachable blueprint parser state.');
}

function codeSource(action: unknown): string | null {
  if (!object(action)) {
    return null;
  }
  if (typeof action.code === 'string' && Object.keys(action).length === 1) {
    return action.code;
  }
  if (
    Object.keys(action).some((field) => !['type', 'function'].includes(field)) ||
    action.type !== 'function' ||
    !object(action.function) ||
    Object.keys(action.function).some(
      (field) => !['name', 'handler', 'parameters'].includes(field),
    ) ||
    action.function.name !== 'code_exec' ||
    action.function.handler !== '__function__:code_exec' ||
    !object(action.function.parameters) ||
    action.function.parameters.type !== 'object' ||
    !object(action.function.parameters.properties) ||
    Object.keys(action.function.parameters.properties).some(
      (field) => !['code', 'timeout_ms'].includes(field),
    ) ||
    !object(action.function.parameters.properties.code) ||
    action.function.parameters.properties.code.type !== 'string' ||
    typeof action.function.parameters.properties.code.default !== 'string'
  ) {
    return null;
  }
  const timeout = action.function.parameters.properties.timeout_ms;
  if (
    timeout !== undefined &&
    (!object(timeout) || timeout.type !== 'number' || timeout.default !== 10000)
  ) {
    return null;
  }
  return action.function.parameters.properties.code.default;
}

export function compileWorkflow(
  task: Task,
  candidate: WorkflowCandidate,
  options: { runtimeContract?: boolean; preciseRouting?: boolean; mockUrl?: string } = {},
): Workflow {
  let mockBase: string | undefined;
  if (options.mockUrl) {
    const target = new URL(options.mockUrl);
    if (
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    ) {
      throw new Error(
        'Mock URL must be an HTTPS base URL without credentials, query, or fragment.',
      );
    }
    mockBase = target.toString().replace(/\/$/, '');
  }
  const parsed: unknown = parseBlueprint(candidate.workflowJson);
  if (
    !object(parsed) ||
    typeof parsed.initial_node !== 'string' ||
    !object(parsed.nodes) ||
    !Object.keys(parsed.nodes).length
  ) {
    throw new Error('Workflow needs an initial_node and nonempty nodes.');
  }
  const workflow = structuredClone(parsed);
  if (options.preciseRouting) {
    const issues = routingSafetyIssues(workflow);
    if (issues.length) {
      throw new Error(`Routing-precision checks failed:\n${issues.join('\n')}`);
    }
  }
  if (options.runtimeContract) {
    applyInputContract(
      workflow,
      task.tools.map((tool) => tool.name),
    );
    const issues = runtimeContractIssues(workflow);
    if (issues.length) {
      throw new Error(`Runtime contract checks failed:\n${issues.join('\n')}`);
    }
  }
  // Every api_call gets a compiler-owned JSON snapshot of its result envelope. This is
  // purely additive: the platform's own flattened <tool>_response.* leaves are untouched.
  // Recorded 2026-10-11 runs showed the leaves are the ONLY representation of a
  // container: `get_account_response.data.products` never exists, only
  // `...products.0.past_due`. Code that reads the whole array therefore always failed and
  // closed the call as a service error, in 8 of 10 cases. The snapshot keeps the
  // structure, so generated code no longer depends on guessing a flattened fallback.
  const snapshot = (binding: JsonObject) => snapshotToolResult(binding);
  const allowed = [
    'initial_node',
    'system_prompt',
    'nodes',
    'global_nodes',
    'context_variables',
    'tools',
  ];
  if (Object.keys(workflow).some((key) => !allowed.includes(key))) {
    throw new Error('Unsupported workflow field (omit agent_config and test_variables).');
  }
  if (workflow.global_nodes !== undefined && !object(workflow.global_nodes)) {
    throw new Error('global_nodes must be an object.');
  }
  const nodes = {
    ...(workflow.nodes as JsonObject),
    ...(workflow.global_nodes as JsonObject),
  };
  if (!((workflow.initial_node as string) in (workflow.nodes as JsonObject))) {
    throw new Error('initial_node is missing from nodes.');
  }
  function target(value: unknown) {
    if (typeof value !== 'string' || (!(value in nodes) && value !== '__previous__')) {
      throw new Error(`Unknown transition target: ${String(value)}`);
    }
  }
  for (const [key, raw] of Object.entries(nodes)) {
    if (
      !object(raw) ||
      !['conversation', 'api_request', 'code', 'end_call'].includes(String(raw.node_type))
    ) {
      throw new Error(`Unsupported node: ${key}`);
    }
    if (raw.name !== key) {
      throw new Error(`Node name must match its key: ${key}`);
    }
    if (raw.collection_contract !== undefined) {
      throw new Error('collection_contract requires the runtime-contract strategy.');
    }
    if (raw.success_guard !== undefined) {
      throw new Error('success_guard requires the runtime-contract strategy.');
    }
    if (!Array.isArray(raw.transitions)) {
      throw new Error(`Node needs transitions array: ${key}`);
    }
    for (const transition of raw.transitions) {
      if (!object(transition)) {
        throw new Error(`Invalid transition: ${key}`);
      }
      target(transition.target_node);
    }
    for (const field of ['max_turn_transition', 'passthrough_default_transition']) {
      if (raw[field] !== undefined) {
        target(raw[field]);
      }
    }
    if (raw.tools !== undefined) {
      if (raw.node_type !== 'conversation' || !Array.isArray(raw.tools)) {
        throw new Error(`Tools belong only on conversation nodes: ${key}`);
      }
      raw.tools = raw.tools.map((tool) => snapshot(bindTool(tool, task.tools, mockBase)));
    }
    if (raw.pre_actions !== undefined) {
      if (
        !['code', 'api_request'].includes(String(raw.node_type)) ||
        !Array.isArray(raw.pre_actions)
      ) {
        throw new Error(`Invalid pre_actions: ${key}`);
      }
      raw.pre_actions = raw.pre_actions.map((action) => {
        if (raw.node_type === 'api_request') {
          return snapshot(exposePreActionResponse(bindTool(action, task.tools, mockBase)));
        }
        const code = codeSource(action);
        if (code === null) {
          throw new Error('Code actions must contain only Python source in code.');
        }
        return {
          type: 'function',
          function: {
            name: 'code_exec',
            handler: '__function__:code_exec',
            parameters: {
              type: 'object',
              properties: {
                code: { type: 'string', default: code },
                timeout_ms: { type: 'number', default: 10000 },
              },
            },
          },
        };
      });
    }
    if (raw.node_type === 'end_call') {
      if (raw.transitions.length || raw.terminal !== undefined) {
        throw new Error('End nodes use farewell, not generated terminal schemas or transitions.');
      }
      if (raw.farewell !== undefined && typeof raw.farewell !== 'string') {
        throw new Error('farewell must be text.');
      }
      raw.terminal = {
        type: 'function',
        function: {
          name: key,
          handler: '__function__:end_call',
          parameters: {
            type: 'object',
            properties: {
              message_mode: { type: 'string', default: raw.farewell ? 'custom' : 'none' },
              ...(raw.farewell
                ? { spoken_message: { type: 'string', default: raw.farewell } }
                : {}),
            },
          },
        },
      };
      delete raw.farewell;
      raw.on_enter = { type: 'silent' };
      raw.disable_inactivity_monitor = true;
    } else if (raw.terminal !== undefined || raw.farewell !== undefined) {
      throw new Error('terminal and farewell belong only to end nodes.');
    }
  }
  if (workflow.tools !== undefined) {
    if (!Array.isArray(workflow.tools)) {
      throw new Error('Lifecycle tools must be an array.');
    }
    workflow.tools = workflow.tools.map((tool) =>
      snapshot(bindTool(tool, task.tools, mockBase, true)),
    );
  }
  // Null is not accepted by the event schema; report it rather than silently rewriting model output.
  function rejectNull(value: unknown): void {
    if (value === null) {
      throw new Error('Workflow contains null; omit optional fields instead.');
    }
    if (Array.isArray(value)) {
      value.forEach(rejectNull);
    } else if (object(value)) {
      Object.values(value).forEach(rejectNull);
    }
  }
  rejectNull(workflow);
  return workflow;
}
