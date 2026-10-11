// Transport only. The organizer client owns the verified staging API contract.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { JsonObject } from './contracts.ts';
import { object } from './validation.ts';

export type Registration = { workflow_id: string; agent_id: string; version?: number };
export type PracticeResult = {
  passed: number;
  total: number;
  rows: unknown[];
  simulation_id: string;
  iteration_id: string;
  [key: string]: unknown;
};
export type FreyaResult = {
  candidate: unknown;
  workflow: JsonObject;
  registration: Registration;
  evaluation: PracticeResult | null;
  export: unknown;
};

export class FreyaBridge {
  kit: string;
  trace: string;
  env: NodeJS.ProcessEnv;
  constructor(kit: string, trace: string, env: NodeJS.ProcessEnv = process.env) {
    this.kit = kit;
    this.trace = trace;
    this.env = env;
  }
  async call(
    action: string,
    data: JsonObject,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<any> {
    signal.throwIfAborted();
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
      throw new Error('Freya deadline exceeded.');
    }
    const request = { ...data, action, kit: this.kit, trace: this.trace, timeoutMs };
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.env.PYTHON || 'python3',
        [fileURLToPath(new URL('./freya_bridge.py', import.meta.url))],
        {
          env: this.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          signal,
        },
      );
      let output = '';
      const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        process.stderr.write(this.redact(String(chunk)));
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        // An aborted spawn is the deadline or a caller signal reaching us, not a
        // bridge failure; say so instead of reporting the runtime's own wording.
        reject(new Error(signal.aborted ? 'Freya deadline exceeded.' : this.redact(error.message)));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          const response: unknown = JSON.parse(output);
          if (!object(response) || response.ok !== true || code !== 0) {
            throw new Error(
              object(response) && typeof response.error === 'string'
                ? this.redact(response.error)
                : 'Freya operation failed.',
            );
          }
          resolve(response.result);
        } catch (error) {
          reject(
            new Error(
              signal.aborted
                ? 'Freya deadline exceeded.'
                : this.redact(error instanceof Error ? error.message : 'Freya operation failed.'),
            ),
          );
        }
      });
      child.stdin.on('error', () => {
        /* A failed process may close stdin before reading it. */
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
  redact(value: string): string {
    for (const key of ['FREYA_API_KEY', 'FREYA_BANK_TEAM_KEY', 'OPENAI_API_KEY']) {
      if (this.env[key]) {
        value = value.replaceAll(this.env[key]!, '[REDACTED]');
      }
    }
    return value;
  }
}
