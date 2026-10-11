// Reservations cover setup as well as execution, before a job artifact exists.
import { resolve } from 'node:path';
const practice = new Set<string>();
export const practiceKey = (root: string, id: string) => `${resolve(root)}\u0000${id}`;
export const practiceActive = (root: string, id: string) => practice.has(practiceKey(root, id));
export function reservePractice(root: string, id: string): boolean {
  const key = practiceKey(root, id);
  if (practice.has(key)) {
    return false;
  }
  practice.add(key);
  return true;
}
export function releasePractice(root: string, id: string) {
  practice.delete(practiceKey(root, id));
}
