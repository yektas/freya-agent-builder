// Local HTTP server for the run inspector. Recorded files stay read-only; the
// authorized actions start a local generation or upload a compiled workflow to
// Freya. It binds to loopback and keeps credentials in the server process.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRuns, loadRun, readRunFile } from './records.ts';
import { UploadError, uploadAvailability, uploadRun } from './upload.ts';
import type { UploadOptions } from './upload.ts';
import { GenerateError, generationAvailability, startGeneration } from './generate.ts';
import type { GenerationOptions } from './generate.ts';

export type UiOptions = {
  root: string;
  port: number;
  host: string;
  /**
   * Upload configuration. Omitted means the inspector cannot register anything,
   * which is the safe default for a read-only browsing session.
   */
  upload?: UploadOptions | null;
  /**
   * Generation configuration. Omitted means the inspector cannot start a run,
   * which is the safe default for a read-only browsing session.
   */
  generation?: GenerationOptions | null;
};

// Built by `pnpm run ui:build`; absent in a fresh checkout until then.
const bundle = fileURLToPath(new URL('../../ui/dist', import.meta.url));

// The upload action takes no request body; anything sent is discarded under a
// bound so an unexpected payload is never buffered. The generate action takes a
// small JSON body of three choices, read under the same bound.
const MAX_UPLOAD_BODY = 8192;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json; charset=utf-8',
};

function send(response: ServerResponse, status: number, type: string, body: string) {
  response.writeHead(status, {
    'content-type': type,
    // Records may contain prompt text; keep them out of any shared cache.
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(value, null, 2));
}

// Serves one file from the build output. The resolved path must stay inside the
// bundle directory, so a crafted path cannot read anything else on disk.
async function sendAsset(pathname: string, response: ServerResponse) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const target = resolve(bundle, relative);
  if (target !== bundle && !target.startsWith(bundle + sep)) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) {
      throw new Error('not a file');
    }
    response.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      // Assets are content-hashed by the bundler except the entry document.
      'cache-control':
        relative === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
    createReadStream(target).pipe(response);
  } catch {
    sendJson(response, 404, {
      error: 'Not found. Run `pnpm run ui:build` to build the inspector.',
    });
  }
}

async function route(options: UiOptions, url: URL, response: ServerResponse) {
  const root = resolve(options.root);
  const path = safePath(url);
  if (path === '/api/runs') {
    sendJson(response, 200, { runs: await listRuns(root) });
    return;
  }
  if (path === '/api/upload') {
    // Whether the action can run, and why not. Never any credential.
    const availability = options.upload
      ? await uploadAvailability(options.upload)
      : {
          available: false,
          problem: 'This inspector was started without upload configuration.',
        };
    sendJson(response, 200, availability);
    return;
  }
  if (path === '/api/generate') {
    // What the dialog may choose, and whether either provider can run. Reports
    // presence of credentials, never their values.
    sendJson(
      response,
      200,
      options.generation
        ? await generationAvailability(options.generation)
        : {
            available: false,
            problem: 'This inspector was started without generation configuration.',
            providers: [],
            models: { openai: [], codex: [] },
            reasoningEfforts: [],
            timeoutMs: 0,
            running: null,
          },
    );
    return;
  }
  const run = /^\/api\/runs\/([^/]+)$/.exec(path);
  if (run) {
    const detail = await loadRun(root, run[1]);
    sendJson(response, detail ? 200 : 404, detail ?? { error: 'Unknown run.' });
    return;
  }
  const file = /^\/api\/runs\/([^/]+)\/files\/(.+)$/.exec(path);
  if (file) {
    const content = await readRunFile(root, file[1], file[2]);
    if (content === null) {
      sendJson(response, 404, { error: 'Unknown file.' });
      return;
    }
    const type = extname(file[2]) === '.json' ? 'application/json' : 'text/plain';
    send(response, 200, `${type}; charset=utf-8`, content);
    return;
  }
  await sendAsset(path, response);
}

// The bind address is already loopback; this refuses a proxied or tunneled
// connection that somehow arrived from elsewhere.
function isLoopback(address: string | undefined | null): boolean {
  if (!address) {
    return false;
  }
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
  return normalized === '::1' || normalized === '127.0.0.1' || normalized.startsWith('127.');
}

// A browser always sends Origin on a cross-site POST and never lets page script
// forge Sec-Fetch-Site. Clients that send neither are local tools; for them the
// loopback bind, the discovered-run allowlist, and the server-side credentials
// are the boundary.
function isSameOrigin(request: IncomingMessage): boolean {
  const site = request.headers['sec-fetch-site'];
  if (
    typeof site === 'string' &&
    site !== 'same-origin' &&
    site !== 'same-site' &&
    site !== 'none'
  ) {
    return false;
  }
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !origin) {
    return true;
  }
  const host = request.headers.host;
  if (!host) {
    return false;
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function discardBody(request: IncomingMessage): Promise<boolean> {
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_UPLOAD_BODY) {
      return false;
    }
  }
  return true;
}

// Reads a small JSON body under the same bound. An oversized or malformed body
// is refused rather than parsed, so a request can never dictate how much this
// process buffers or how deep it reads.
async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_UPLOAD_BODY) {
      return null;
    }
    chunks.push(chunk as Buffer);
  }
  if (!size) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Guards every authorized write. The bind address is already loopback; these
// refuse a proxied connection and a cross-site request.
function refuseWrite(request: IncomingMessage, response: ServerResponse, what: string): boolean {
  if (!isLoopback(request.socket.remoteAddress)) {
    sendJson(response, 403, { error: `${what} accepts loopback requests only.` });
    return true;
  }
  if (!isSameOrigin(request)) {
    sendJson(response, 403, { error: `Cross-origin ${what.toLowerCase()} requests are refused.` });
    return true;
  }
  return false;
}

// The one authorized write that registers remotely: register an already
// compiled workflow. Credentials stay in this process, the run id must be one
// the scan discovered, and the operation runs under a bounded deadline.
async function handleUpload(
  options: UiOptions,
  request: IncomingMessage,
  response: ServerResponse,
  runId: string,
) {
  if (refuseWrite(request, response, 'Upload')) {
    return;
  }
  const config = options.upload;
  if (!config) {
    sendJson(response, 503, { error: 'This inspector was started without upload configuration.' });
    return;
  }
  if (!(await discardBody(request))) {
    sendJson(response, 413, { error: 'Upload takes no request body.' });
    return;
  }
  try {
    sendJson(response, 200, { upload: await uploadRun(config, runId) });
  } catch (error) {
    if (error instanceof UploadError) {
      sendJson(response, error.status, { error: error.message, upload: error.view });
      return;
    }
    sendJson(response, 500, { error: 'Upload failed.' });
  }
}

// The second authorized write: start one generation with the provider, model,
// and reasoning effort chosen in the browser. It runs the same generation a CLI
// `generate` runs, under the same recipe deadline, and answers with the run id
// so the inspector can navigate to the trace it is already writing.
async function handleGenerate(
  options: UiOptions,
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (refuseWrite(request, response, 'Generation')) {
    return;
  }
  const config = options.generation;
  if (!config) {
    sendJson(response, 503, {
      error: 'This inspector was started without generation configuration.',
    });
    return;
  }
  const body = await readJsonBody(request);
  if (!body) {
    sendJson(response, 413, { error: 'Generation takes a small JSON body of choices only.' });
    return;
  }
  try {
    sendJson(response, 202, { run: await startGeneration(config, body) });
  } catch (error) {
    if (error instanceof GenerateError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    sendJson(response, 500, { error: 'Generation could not be started.' });
  }
}

// A malformed percent escape must not escape the request handler.
function safePath(url: URL): string {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}

export function createUiServer(options: UiOptions) {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = safePath(url);
    const upload = /^\/api\/runs\/([^/]+)\/upload$/.exec(path);
    if (request.method === 'POST' && upload) {
      handleUpload(options, request, response, upload[1]).catch(() => {
        if (!response.headersSent) {
          sendJson(response, 500, { error: 'Upload failed.' });
        }
      });
      return;
    }
    if (request.method === 'POST' && path === '/api/generate') {
      handleGenerate(options, request, response).catch(() => {
        if (!response.headersSent) {
          sendJson(response, 500, { error: 'Generation could not be started.' });
        }
      });
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // Recorded runs stay read-only; POST is accepted only on the two
      // authorized actions, upload and generation.
      sendJson(response, 405, {
        error: 'The inspector is read-only except for the upload and generation actions.',
      });
      return;
    }
    route(options, url, response).catch((error: unknown) => {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Inspector failure.',
      });
    });
  });
}

export function startUi(options: UiOptions) {
  const server = createUiServer(options);
  server.listen(options.port, options.host, async () => {
    try {
      await stat(join(bundle, 'index.html'));
      process.stderr.write(`[ui] run inspector on http://${options.host}:${options.port}\n`);
    } catch {
      process.stderr.write(
        `[ui] run inspector on http://${options.host}:${options.port}\n` +
          `[ui] no build found; run \`pnpm run ui:build\` first.\n`,
      );
    }
  });
  return server;
}
