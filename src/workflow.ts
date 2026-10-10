// Verified event boundary: original OpenAPI -> Freya tool functions.
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { JsonObject, Task, Tool } from './contracts.ts';
import { object, parseTask } from './validation.ts';

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
): Promise<Task> {
  const briefs = await Promise.all(
    briefPaths.map(async (path) => ({ path: resolve(path), text: await readFile(path, 'utf8') })),
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
    id: briefPaths.map((path) => basename(path, '.md')).join('+'),
    description: briefs.map((brief) => brief.text).join('\n\n'),
    tools: toolsFromOpenAPI(openapi),
    briefs,
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

function bindTool(value: unknown, catalog: Tool[], lifecycle = false): JsonObject {
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
  const body = structuredClone(tool.parameters);
  const properties = body.properties as Record<string, JsonObject>;
  const defaults = ref.bodyDefaults ?? {};
  if (!object(defaults) || Object.keys(defaults).some((name) => !(name in properties))) {
    throw new Error(`Unknown body default for ${tool.name}`);
  }
  for (const [name, schema] of Object.entries(properties)) {
    schema.default =
      name === 'customer_id'
        ? '{{customer_id}}'
        : (defaults[name] ?? `{{arg_${tool.name}_${name}}}`);
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
          url: { type: 'string', default: tool.url },
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
  return result;
}

export function compileWorkflow(task: Task, candidate: WorkflowCandidate): Workflow {
  const parsed: unknown = JSON.parse(candidate.workflowJson);
  if (
    !object(parsed) ||
    typeof parsed.initial_node !== 'string' ||
    !object(parsed.nodes) ||
    !Object.keys(parsed.nodes).length
  ) {
    throw new Error('Workflow needs an initial_node and nonempty nodes.');
  }
  const workflow = structuredClone(parsed);
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
      raw.tools = raw.tools.map((tool) => bindTool(tool, task.tools));
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
          return bindTool(action, task.tools);
        }
        if (
          !object(action) ||
          typeof action.code !== 'string' ||
          Object.keys(action).some((field) => field !== 'code')
        ) {
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
                code: { type: 'string', default: action.code },
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
    workflow.tools = workflow.tools.map((tool) => bindTool(tool, task.tools, true));
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
