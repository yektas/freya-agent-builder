// Read a supplied case folder as source material. This module never derives bank rules.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const extractor = fileURLToPath(new URL('./extract_case_document.py', import.meta.url));
const textExtensions = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml']);
const binaryExtensions = new Set(['.pdf', '.docx']);
const maxFileBytes = 2_000_000;
const maxCorpusCharacters = 1_500_000;

export type CaseDocument = { path: string; text: string };

export async function readCaseDocuments(folder: string): Promise<CaseDocument[]> {
  const root = resolve(folder);
  if (!(await stat(root)).isDirectory()) {
    throw new Error('Case folder must be a directory.');
  }
  const paths: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        entry.name.startsWith('.') ||
        entry.name === '__MACOSX' ||
        (directory === root && entry.name === 'cloudflare-mock')
      ) {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        const extension = extname(entry.name).toLowerCase();
        if (textExtensions.has(extension) || binaryExtensions.has(extension)) {
          paths.push(path);
        }
      }
    }
  }
  await walk(root);
  const ordered = paths.sort((a, b) => {
    const rank = (path: string) => {
      const name = relative(root, path).toLowerCase();
      return name === 'brief.md' ? 0 : name === 'readme.md' ? 1 : 2;
    };
    const date = (path: string) => /\d{4}-\d{2}-\d{2}/.exec(relative(root, path))?.[0] ?? '';
    return (
      rank(a) - rank(b) ||
      date(a).localeCompare(date(b)) ||
      relative(root, a).localeCompare(relative(root, b))
    );
  });
  const documents: CaseDocument[] = [];
  let characters = 0;
  for (const path of ordered) {
    const name = relative(root, path);
    if (name.split(sep).some((part) => /^test-customers(?:\.|$)/i.test(part))) {
      continue;
    }
    const size = (await stat(path)).size;
    if (size > maxFileBytes) {
      throw new Error(`Case document exceeds 2 MB: ${name}`);
    }
    const extension = extname(path).toLowerCase();
    const text = binaryExtensions.has(extension)
      ? (await execFileAsync('python3', [extractor, path], { maxBuffer: 4_000_000 })).stdout
      : await readFile(path, 'utf8');
    if (!text.trim()) {
      continue;
    }
    characters += text.length;
    if (characters > maxCorpusCharacters) {
      throw new Error('Case corpus exceeds 1.5 million characters.');
    }
    documents.push({ path: name, text });
  }
  if (!documents.some((document) => document.path.toLowerCase() === 'brief.md')) {
    throw new Error('Case folder needs BRIEF.md.');
  }
  return documents;
}
