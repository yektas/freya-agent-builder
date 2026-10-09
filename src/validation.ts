import type { Candidate, Task } from './contracts.ts';

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(nonempty);

export function parseTask(value: unknown): Task {
  if (
    !object(value) ||
    !nonempty(value.id) ||
    !nonempty(value.description) ||
    !Array.isArray(value.tools)
  ) {
    throw new Error('Task must contain nonempty id, description, and a tools array.');
  }
  const seen = new Set<string>();
  for (const tool of value.tools) {
    if (
      !object(tool) ||
      !nonempty(tool.name) ||
      !nonempty(tool.description) ||
      !object(tool.parameters)
    ) {
      throw new Error('Every tool needs name, description, and parameters object.');
    }
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    seen.add(tool.name);
  }
  // Preserve every source field. Tool JSON Schemas remain opaque until the platform adapter.
  return structuredClone(value) as Task;
}

export function candidateIssues(value: unknown, task: Task): string[] {
  if (!object(value)) {
    return ['Candidate must be an object.'];
  }
  const issues: string[] = [];
  const fields = ['systemPrompt', 'toolNames', 'completionConditions', 'uncertainties'];
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) {
      issues.push(`Unexpected field: ${field}`);
    }
  }
  if (!nonempty(value.systemPrompt)) {
    issues.push('systemPrompt must be nonempty.');
  }
  for (const field of fields.slice(1)) {
    if (!strings(value[field])) {
      issues.push(`${field} must be an array of nonempty strings.`);
    }
  }
  if (Array.isArray(value.completionConditions) && value.completionConditions.length === 0) {
    issues.push('At least one completion condition is required.');
  }
  if (strings(value.toolNames)) {
    const allowed = new Set(task.tools.map((tool) => tool.name));
    for (const name of value.toolNames) {
      if (!allowed.has(name)) {
        issues.push(`Unknown declared tool: ${name}`);
      }
    }
    if (new Set(value.toolNames).size !== value.toolNames.length) {
      issues.push('Duplicate declared tool names.');
    }
  }
  return issues;
}

export function parseCandidate(value: unknown, task: Task): Candidate {
  const issues = candidateIssues(value, task);
  if (issues.length) {
    throw new Error(issues.join(' '));
  }
  return structuredClone(value) as Candidate;
}

export const candidateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    systemPrompt: { type: 'string' },
    toolNames: { type: 'array', items: { type: 'string' } },
    completionConditions: { type: 'array', items: { type: 'string' } },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
  required: ['systemPrompt', 'toolNames', 'completionConditions', 'uncertainties'],
};
