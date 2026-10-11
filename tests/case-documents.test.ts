import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readCaseDocuments } from '../src/case-documents.ts';

test('case documents keep source order and omit customer fixtures', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'freya-case-'));
  try {
    await mkdir(join(folder, 'sources'));
    await mkdir(join(folder, 'test-environment'));
    await writeFile(join(folder, 'BRIEF.md'), 'Scenario');
    await writeFile(join(folder, 'README.md'), 'Overview');
    await writeFile(join(folder, 'sources', 'service.json'), '{"path":"/cards"}');
    await writeFile(
      join(folder, 'test-environment', 'test-customers.json'),
      '{"secret":"fixture"}',
    );
    const documents = await readCaseDocuments(folder);
    assert.deepEqual(
      documents.map((document) => document.path),
      ['BRIEF.md', 'README.md', 'sources/service.json'],
    );
    assert.equal(JSON.stringify(documents).includes('fixture'), false);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
