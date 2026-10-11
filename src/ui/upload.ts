// Upload is the one write the inspector is allowed to perform. It registers a
// workflow that was already compiled locally on Freya, so a reviewer can act on
// a recorded generation without another model call. Credentials stay in this
// process: the browser asks for an upload and receives ids, never a key.
//
// Every remote step reuses the unchanged organizer bridge, so the event model,
// tool bindings, and workflow document are exactly what a CLI run would send.
import { mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { JsonObject } from '../contracts.ts';
import { hash } from '../experiments.ts';
import { FreyaBridge } from '../freya.ts';
import { object } from '../validation.ts';
import { readRunArtifact } from './records.ts';
import { practiceActive } from './activity.ts';

// Artifacts the upload reads and writes inside an already discovered run.
const COMPILED = 'compiled.workflow.json';
const EXPORTED = 'exported.workflow.json';
const UPLOAD = 'upload.json';
const SECRET_KEYS = ['FREYA_API_KEY', 'FREYA_BANK_TEAM_KEY', 'OPENAI_API_KEY'];
// Long enough for a slow dry run plus one create/update, short enough that a
// stuck operation cannot hold the workspace lock indefinitely.
export const DEFAULT_UPLOAD_TIMEOUT_MS = 120000;

// The part of the bridge this service uses. Production always gets the real
// bridge; tests inject a transport so no socket is opened.
export type BridgeLike = {
  env: NodeJS.ProcessEnv;
  call(action: string, data: JsonObject, signal: AbortSignal, timeoutMs: number): Promise<any>;
};

export type BridgeFactory = (options: {
  kit: string;
  trace: string;
  env: NodeJS.ProcessEnv;
}) => BridgeLike;

export type UploadStatus = 'registered' | 'failed' | 'uncertain';

export type UploadView = {
  status: UploadStatus;
  /** The step reached, so a failure names the operation that stopped. */
  stage: string;
  slot: string;
  workspaceId: string | null;
  workflowId: string | null;
  agentId: string | null;
  version: number | null;
  /** Hash of the compiled document that was sent, used to detect a repeat. */
  workflowHash: string | null;
  exportedPath: string | null;
  startedAt: string;
  endedAt: string | null;
  elapsedMs: number | null;
  /** True when the recorded registration answered the request unchanged. */
  reused: boolean;
  error: string | null;
};

export type UploadOptions = {
  /** Record root the inspector discovers runs from. */
  root: string;
  /** The unchanged event package directory. */
  kit: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  bridge?: BridgeFactory;
};

/** An upload that must not be retried blindly, carrying the persisted record. */
export class UploadError extends Error {
  status: number;
  view: UploadView | null;
  constructor(status: number, message: string, view: UploadView | null = null) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
    this.view = view;
  }
}

const spawnBridge: BridgeFactory = (options) =>
  new FreyaBridge(options.kit, options.trace, options.env);

// Nothing this service records, logs, or answers may contain a credential.
function redactSecrets(value: string, env: NodeJS.ProcessEnv): string {
  let out = value;
  for (const key of SECRET_KEYS) {
    const secret = env[key];
    if (secret) {
      out = out.replaceAll(secret, '[REDACTED]');
    }
  }
  return out;
}

// The slot is derived from the run id alone, so the same generation always maps
// to the same remote workflow: a repeat updates it instead of creating a second
// agent. Only the characters the CLI accepts as a slot survive.
export function uploadSlot(runId: string): string {
  const safe = runId
    .replace(/[^\w.+-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48);
  return `gen-${safe || 'run'}-${hash(runId).slice(0, 8)}`;
}

function clampTimeout(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_UPLOAD_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.round(value), 1000), 600000);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Console link info for a registered workflow. Freya's dashboard is an SPA whose
 * deep-link routes are not documented (verified: only /api/v2 endpoints are),
 * so the per-workflow route is configuration: FREYA_WORKFLOW_URL, with
 * {workflowId}, {agentId}, and {workspaceId} placeholders, for example
 * https://app.freyavoice.ai/workflows/{workflowId}. FREYA_API_URL supplies the
 * fallback dashboard origin. The template is answered once as "consoleUrl"; ids
 * from a run's upload record are substituted client-side, never sent to the
 * server.
 */
export function workflowConsole(env: NodeJS.ProcessEnv): {
  /** Dashboard origin, or the configured per-workflow template. */
  consoleUrl: string | null;
  /** True when consoleUrl is a per-workflow template, not just the origin. */
  exact: boolean;
} {
  const template = env.FREYA_WORKFLOW_URL?.trim();
  if (template) {
    return { consoleUrl: template, exact: true };
  }
  const origin = env.FREYA_API_URL?.trim();
  return origin ? { consoleUrl: origin, exact: false } : { consoleUrl: null, exact: false };
}

// Upload needs the workspace key and the event package. Practice testing, which
// also needs the bank team key, is a separate action and is not offered here.
export async function uploadAvailability(options: UploadOptions): Promise<{
  available: boolean;
  problem: string | null;
}> {
  const env = options.env ?? process.env;
  if (!env.FREYA_API_KEY?.trim()) {
    return {
      available: false,
      problem:
        'Set FREYA_API_KEY before uploading. Start the inspector with the event credentials, for example node --env-file=.env --env-file=build-the-builder/env.sh src/cli.ts ui.',
    };
  }
  const kit = resolve(options.kit);
  if (!(await exists(join(kit, 'freya.py')))) {
    return {
      available: false,
      problem: `No event package at ${kit}. Pass --kit DIRECTORY.`,
    };
  }
  return { available: true, problem: null };
}

async function readUploadRecord(runPath: string): Promise<UploadView | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(runPath, UPLOAD), 'utf8'));
    if (
      object(parsed) &&
      typeof parsed.slot === 'string' &&
      typeof parsed.workflowHash === 'string'
    ) {
      return parsed as unknown as UploadView;
    }
  } catch {
    // No record yet, or one from a run that never produced a registration.
  }
  return null;
}

function persist(runPath: string, view: UploadView): Promise<void> {
  // Written beside the run's other artifacts, mode 0600 like the generation
  // trace, so the result survives a refresh without any server-side store.
  return writeFile(join(runPath, UPLOAD), JSON.stringify(view, null, 2) + '\n', { mode: 0o600 });
}

// A create that may or may not have reached Freya. The next attempt must stop
// and reconcile instead of risking a duplicate remote agent.
function reconcileMessage(pending: string, trace: string): string {
  return (
    'A previous create for this generation has an uncertain result, so another attempt is refused. ' +
    `Reconcile it before retrying: check ${trace} and the workflows in the workspace list for the ` +
    `slot marker ${pending}, record the outcome in the workspace slot state, then remove the marker.`
  );
}

function failureStatus(record: UploadView): number {
  if (record.status === 'uncertain') {
    return 409;
  }
  // A platform that never answered is not a document the platform rejected.
  if (record.error && /deadline|timed out|aborted/i.test(record.error)) {
    return 504;
  }
  return record.stage === 'validate' ? 422 : 502;
}

// Concurrent clicks on one run share a single remote operation: the second click
// receives the first result instead of racing it.
const inFlight = new Map<string, Promise<UploadView>>();

export function uploadRun(options: UploadOptions, runId: string): Promise<UploadView> {
  const key = `${resolve(options.root)}\u0000${runId}`;
  const running = inFlight.get(key);
  if (running) {
    return running;
  }
  const operation = register(options, runId).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, operation);
  return operation;
}

async function register(options: UploadOptions, runId: string): Promise<UploadView> {
  const root = resolve(options.root);
  if (practiceActive(root, runId)) {
    throw new UploadError(409, 'This generation is being tested. Wait for practice to finish.');
  }
  const kit = resolve(options.kit);
  const env = options.env ?? process.env;
  const timeoutMs = clampTimeout(options.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS);
  const availability = await uploadAvailability(options);
  if (!availability.available) {
    throw new UploadError(503, availability.problem!);
  }

  // The artifact is resolved through the inspector's own scan, so a name that
  // was never discovered for this run cannot reach the filesystem.
  const found = await readRunArtifact(root, runId, COMPILED);
  if (!found) {
    throw new UploadError(404, `No discovered run "${runId}" with a ${COMPILED} artifact.`);
  }
  let workflow: JsonObject;
  try {
    const parsed: unknown = JSON.parse(found.content);
    if (!object(parsed)) {
      throw new Error('not a JSON object');
    }
    workflow = parsed;
  } catch {
    throw new UploadError(422, `${COMPILED} for ${runId} is not a JSON object.`);
  }

  const slot = uploadSlot(runId);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const deadline = started + timeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  const record: UploadView = {
    status: 'failed',
    stage: 'probe',
    slot,
    workspaceId: null,
    workflowId: null,
    agentId: null,
    version: null,
    workflowHash: hash(workflow),
    exportedPath: null,
    startedAt,
    endedAt: null,
    elapsedMs: null,
    reused: false,
    error: null,
  };

  // Platform requests and responses are appended to the run's own trace file,
  // next to the compiled workflow they came from.
  const trace = join(found.run.runPath, 'platform.jsonl');
  const bridge = (options.bridge ?? spawnBridge)({ kit, trace, env });
  const left = () => Math.max(1, Math.round(deadline - performance.now()));
  const call = (action: string, data: JsonObject) => bridge.call(action, data, signal, left());
  let pending: string | null = null;

  try {
    // Verify the workspace first and pin it, so every later list route addresses
    // the same workspace this run verified.
    const workspace = await call('probe', {});
    const workspaceId = object(workspace) ? workspace.workspaceId : null;
    if (typeof workspaceId !== 'string' || !workspaceId) {
      throw new UploadError(503, 'Freya returned no workspace for this key.');
    }
    record.workspaceId = workspaceId;
    bridge.env = { ...env, FREYA_WORKSPACE_ID: workspaceId };

    const stateRoot = join(root, 'freya-state', workspaceId);
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    const stateFile = join(stateRoot, 'slots.json');
    // The same exclusive lock a CLI run takes, so an upload and a run cannot
    // race registration or publish in the same workspace.
    const lockFile = join(stateRoot, 'workspace.lock');
    const handle = await open(lockFile, 'wx', 0o600).catch(() => {
      throw new UploadError(
        409,
        `Workspace ${workspaceId} is locked by another run. Inspect ${lockFile} and remove it only if that process is gone.`,
      );
    });
    await handle.writeFile(JSON.stringify({ pid: process.pid, run: found.run.runFile }));
    await handle.close();
    pending = `${stateFile}.${slot}.pending`;

    try {
      // A repeat of an unchanged document is answered from the record, with no
      // remote call at all. A changed document falls through to the register
      // action, which updates and publishes the same workflow.
      const previous = await readUploadRecord(found.run.runPath);
      record.stage = 'slot';
      if (
        previous &&
        previous.slot === slot &&
        previous.workflowHash === record.workflowHash &&
        previous.workflowId &&
        previous.agentId &&
        previous.status === 'registered'
      ) {
        record.status = 'registered';
        record.stage = 'done';
        record.workflowId = previous.workflowId;
        record.agentId = previous.agentId;
        record.version = Number.isInteger(previous.version) ? previous.version : null;
        record.exportedPath = previous.exportedPath;
        record.reused = true;
        record.endedAt = new Date().toISOString();
        record.elapsedMs = Math.round(performance.now() - started);
        await persist(found.run.runPath, record);
        return record;
      }

      if (await exists(pending)) {
        throw new UploadError(409, reconcileMessage(pending, trace));
      }
      record.stage = 'validate';
      await call('validate', { slot, workflow });
      record.stage = 'register';
      const registration = await call('register', { slot, workflow, stateFile });
      record.stage = 'export';
      const exported = await call('export', {
        workflowId: registration?.workflow_id,
        path: join(found.run.runPath, EXPORTED),
      });
      record.status = 'registered';
      record.stage = 'done';
      record.workflowId =
        typeof registration?.workflow_id === 'string' ? registration.workflow_id : null;
      record.agentId = typeof registration?.agent_id === 'string' ? registration.agent_id : null;
      record.version = Number.isInteger(registration?.version) ? registration.version : null;
      record.exportedPath =
        object(exported) && typeof exported.path === 'string' ? exported.path : null;
      record.endedAt = new Date().toISOString();
      record.elapsedMs = Math.round(performance.now() - started);
      await persist(found.run.runPath, record);
      return record;
    } finally {
      await unlink(lockFile).catch(() => {
        /* Another process took the lock already; nothing to release. */
      });
    }
  } catch (error) {
    const failure = message(error);
    record.error = redactSecrets(failure, env);
    record.status = pending && (await exists(pending)) ? 'uncertain' : 'failed';
    record.endedAt = new Date().toISOString();
    record.elapsedMs = Math.round(performance.now() - started);
    await persist(found.run.runPath, record).catch(() => {
      // The original failure is the one worth reporting.
    });
    if (error instanceof UploadError) {
      throw new UploadError(error.status, record.error, record);
    }
    if (record.status === 'uncertain') {
      throw new UploadError(409, reconcileMessage(pending!, trace), record);
    }
    throw new UploadError(failureStatus(record), record.error, record);
  }
}
