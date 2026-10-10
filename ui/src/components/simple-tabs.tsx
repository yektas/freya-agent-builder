import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Section } from '@/lib/hooks';
import { defaultFile, when } from '@/lib/data';
import type { RunDetail } from '@/lib/data';
import { cn } from '@/lib/utils';

export function CandidateTab({ detail }: { detail: RunDetail }) {
  const c = detail.candidate;
  return (
    <div>
      {c?.systemPrompt && (
        <Section title="System prompt">
          <pre className="overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[11.5px] whitespace-pre-wrap">
            {c.systemPrompt}
          </pre>
        </Section>
      )}
      {c && c.toolNames.length > 0 && (
        <Section title="Declared tools">
          <pre className="overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[11.5px]">
            {c.toolNames.join('\n')}
          </pre>
        </Section>
      )}
      {c && c.completionConditions.length > 0 && (
        <Section title="Completion conditions">
          <pre className="overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[11.5px] whitespace-pre-wrap">
            {c.completionConditions.join('\n')}
          </pre>
        </Section>
      )}
      {c && c.uncertainties.length > 0 && (
        <Section title="Uncertainties">
          <pre className="overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[11.5px] whitespace-pre-wrap">
            {c.uncertainties.join('\n')}
          </pre>
        </Section>
      )}
      {detail.workflowCandidate && detail.workflowCandidate.uncertainties.length > 0 && (
        <Section title="Model-reported uncertainties">
          <ul className="space-y-1 pl-4 text-xs text-muted-foreground">
            {detail.workflowCandidate.uncertainties.map((u, i) => (
              <li key={i} className="list-disc">
                {u}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {detail.issues.length > 0 && (
        <Section title="Validation issues">
          <ul className="space-y-1 pl-4 text-xs text-destructive">
            {detail.issues.map((issue, i) => (
              <li key={i} className="list-disc">
                {issue}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export function TraceTab({ detail }: { detail: RunDetail }) {
  return (
    <Section title={`Generation trace · ${detail.trace.length} entries`}>
      <p className="mb-3 text-xs text-muted-foreground">
        Streamed drafts and summaries are grouped. Every original event remains in trace.jsonl under
        Files.
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            {['Elapsed', 'Event', 'Detail'].map((h) => (
              <th
                key={h}
                className="py-1.5 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.trace.map((entry, i) => (
            <tr key={i} className="border-b border-border/50 align-top">
              <td className="py-1.5 pr-3 font-mono whitespace-nowrap text-muted-foreground">
                {entry.elapsedMs === null ? '—' : `+${(entry.elapsedMs / 1000).toFixed(1)}s`}
              </td>
              <td className="py-1.5 pr-3 font-mono whitespace-nowrap">
                {entry.streamKind || entry.kind}
              </td>
              <td className="py-1.5 whitespace-pre-wrap">
                {entry.streamKind ? (
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">
                      {entry.streamKind === 'draft' ? 'Unvalidated draft' : 'Model summary'} ·{' '}
                      {entry.fragments} fragments
                      {entry.endedElapsedMs != null &&
                        ` · through +${(entry.endedElapsedMs / 1000).toFixed(1)}s`}
                    </summary>
                    <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[11.5px] whitespace-pre-wrap break-all">
                      {entry.summary.slice(entry.streamKind.length + 2)}
                    </pre>
                  </details>
                ) : (
                  entry.summary || '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

export function FilesTab({
  detail,
  file,
  onFile,
}: {
  detail: RunDetail;
  file: string | null;
  onFile: (name: string) => void;
}) {
  const [body, setBody] = React.useState<string>('');
  const active = file ?? defaultFile(detail.summary.files);

  React.useEffect(() => {
    if (!active) return;
    let alive = true;
    setBody('Loading…');
    void fetch(
      `/api/runs/${encodeURIComponent(detail.summary.id)}/files/${encodeURIComponent(active)}`,
    )
      .then((r) => r.text())
      .then((text) => {
        if (!alive) return;
        let pretty = text;
        try {
          pretty = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          // Not JSON; show as-is.
        }
        setBody(pretty.length > 400000 ? `${pretty.slice(0, 400000)}\n… truncated` : pretty);
      })
      .catch((e: Error) => alive && setBody(`Failed to load: ${e.message}`));
    return () => {
      alive = false;
    };
  }, [active, detail.summary.id]);

  return (
    <div>
      <Section title="Artifacts">
        <table className="w-full text-xs">
          <tbody>
            {detail.summary.files.map((f) => (
              <tr
                key={f.name}
                className={cn('border-b border-border/50', f.name === active && 'bg-muted/50')}
              >
                <td className="w-64 py-1.5 pr-3 font-mono">{f.name}</td>
                <td className="py-1.5 font-mono text-muted-foreground">
                  {(f.bytes / 1024).toFixed(1)} KB
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Raw file">
        <div className="mb-2 flex flex-wrap gap-1">
          {detail.summary.files.map((f) => (
            <Button
              key={f.name}
              size="xs"
              variant={f.name === active ? 'secondary' : 'ghost'}
              onClick={() => onFile(f.name)}
              className={cn(
                'font-mono',
                f.name === active && 'text-primary ring-1 ring-primary/30',
              )}
            >
              {f.name}
            </Button>
          ))}
        </div>
        <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[11.5px]">
          {body}
        </pre>
      </Section>
    </div>
  );
}
