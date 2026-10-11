import * as React from 'react';
import {
  CloudUpload,
  ExternalLink,
  LoaderCircle,
  TriangleAlert,
  Upload as UploadIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ms, when } from '@/lib/data';
import type { RunDetail, Upload } from '@/lib/data';

type Availability = {
  available: boolean;
  problem: string | null;
  /** Dashboard origin, or the configured per-workflow URL template. */
  consoleUrl?: string | null;
  /** True when consoleUrl is a per-workflow template, not just the origin. */
  exact?: boolean;
};
type UploadResponse = { upload?: Upload; error?: string };

/**
 * Link for one uploaded run's workflow. With FREYA_WORKFLOW_URL set, the
 * console answer is a per-workflow template and the ids substitute in; without
 * it, only the dashboard origin is known, deep-link routes being undocumented,
 * and the link points there honestly labeled.
 */
function workflowLink(availability: Availability | null, upload: Upload) {
  if (!upload.workflowId) {
    return null;
  }
  const consoleUrl = availability?.consoleUrl;
  if (!consoleUrl) {
    return null;
  }
  if (availability?.exact) {
    return {
      href: consoleUrl
        .replaceAll('{workflowId}', upload.workflowId)
        .replaceAll('{agentId}', upload.agentId ?? '')
        .replaceAll('{workspaceId}', upload.workspaceId ?? ''),
      label: 'Open in Freya',
    };
  }
  return { href: consoleUrl, label: 'Open Freya dashboard' };
}

/**
 * Only a completed generation has a compiled workflow that was never sent to
 * Freya, so it is the only page where the action applies.
 */
export function canUpload(detail: RunDetail): boolean {
  return (
    detail.summary.kind === 'generation-only' &&
    detail.summary.status === 'completed' &&
    detail.workflow !== null
  );
}

function Item({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-[11.5px]">{value}</span>
    </div>
  );
}

/**
 * Upload registers the recorded compiled workflow on Freya: platform dry run,
 * create-or-update, then export. No model call, and practice testing stays a
 * separate action. Credentials live in the server process; this only sends the
 * run id and reads back ids.
 */
export function UploadAction({ detail }: { detail: RunDetail }) {
  const [availability, setAvailability] = React.useState<Availability | null>(null);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<Upload | null>(detail.upload);
  const [error, setError] = React.useState<string | null>(null);
  const eligible = canUpload(detail);

  // Whether the action can run is server state: it knows the credentials and the
  // event package, and it answers with a reason rather than a secret.
  React.useEffect(() => {
    if (!eligible) return;
    let alive = true;
    void fetch('/api/upload')
      .then((response) => response.json())
      .then((data: Availability) => {
        if (alive) setAvailability(data);
      })
      .catch(() => {
        if (alive) setAvailability({ available: false, problem: 'Inspector unreachable.' });
      });
    return () => {
      alive = false;
    };
  }, [eligible]);

  const upload = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(detail.summary.id)}/upload`, {
        method: 'POST',
      });
      const body = (await response.json().catch(() => ({}))) as UploadResponse;
      if (body.upload) setResult(body.upload);
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload request failed.');
    } finally {
      setPending(false);
    }
  };

  if (!eligible) {
    return null;
  }

  const blocked = availability !== null && !availability.available;
  const registered = result?.status === 'registered';

  return (
    <div className="mt-3 mb-1">
      <Button
        variant="outline"
        size="sm"
        disabled={
          pending || blocked || detail.summary.archived || detail.practiceJob?.status === 'running'
        }
        onClick={upload}
        className="mr-2 align-middle"
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : registered ? (
          <UploadIcon className="size-3.5 text-success" />
        ) : (
          <CloudUpload className="size-3.5" />
        )}
        {pending
          ? 'Uploading to Freya…'
          : registered
            ? 'Uploaded — upload again'
            : 'Upload to Freya'}
      </Button>
      {pending && (
        <span className="text-[11px] text-muted-foreground">
          Verifying workspace, platform dry run, registration, export.
        </span>
      )}

      {blocked && (
        <p className="mt-2 border-l-2 border-warning py-0.5 pl-3 text-[11px] leading-relaxed text-muted-foreground">
          {availability?.problem}
        </p>
      )}

      {result &&
        registered &&
        (() => {
          const link = workflowLink(availability, result);
          return (
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-success/25 bg-success/5 px-3 py-2">
              <span className="text-[11px] font-medium text-success">
                {result.reused ? 'Already registered' : 'Registered on Freya'}
              </span>
              <Item label="slot" value={result.slot} />
              <Item label="workflow" value={result.workflowId} />
              <Item label="agent" value={result.agentId} />
              <Item
                label="version"
                value={result.version === null ? null : String(result.version)}
              />
              <Item label="when" value={when(result.endedAt ?? result.startedAt)} />
              <Item label="took" value={ms(result.elapsedMs)} />
              {link && (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  title={`Opens ${link.href}`}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                >
                  <ExternalLink className="size-3" />
                  {link.label}
                  {!availability?.exact && ' (workflow id on the record)'}
                </a>
              )}
            </div>
          );
        })()}

      {error && (
        <div className="mt-2 overflow-hidden rounded-lg border border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive">
            <TriangleAlert className="size-3.5" />
            {result?.status === 'uncertain'
              ? 'Uncertain create — reconcile before retrying'
              : 'Upload failed'}
          </div>
          <p className="px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-destructive/90">
            {error}
          </p>
          {result && (
            <p className="px-3 pb-2 text-[11px] text-muted-foreground">
              Stopped at <span className="font-mono">{result.stage}</span>
              {result.exportedPath && (
                <>
                  {' '}
                  · exported to <span className="font-mono">{result.exportedPath}</span>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
