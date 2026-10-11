// Match source contents, not filenames. Unknown or edited briefs are not public practice inputs.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task } from './contracts.ts';
import { object } from './validation.ts';

export async function assertPracticeInputs(task: Task, kit: string, brief: string) {
  if (!object(task)) {
    throw new Error('Recorded generation inputs are missing. Generate again before testing.');
  }
  if (!['A', 'B', 'all'].includes(brief)) {
    throw new Error('Choose Brief A, B, or all.');
  }
  const [a, b, api] = await Promise.all([
    readFile(join(kit, 'briefs/brief-a.md'), 'utf8'),
    readFile(join(kit, 'briefs/brief-b.md'), 'utf8'),
    readFile(join(kit, 'tools/openapi.json'), 'utf8'),
  ]);
  const sources = Array.isArray(task.briefs) ? task.briefs : [];
  const texts = sources.map((item) => (object(item) ? item.text : undefined));
  const matches =
    texts.includes(a) &&
    texts.every((text) => text === a || text === b) &&
    (brief === 'A' || texts.includes(b)) &&
    object(task.openapi) &&
    task.openapi.text === api;
  if (!matches) {
    throw new Error(
      `Practice ${brief} requires matching original brief ${brief === 'A' ? 'A (optionally B)' : 'A+B'} and OpenAPI contents. Generate with those inputs before testing.`,
    );
  }
}
