import * as React from 'react';
import { AlertTriangle, ChevronRight, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScoreStrip, StatusDot } from '@/lib/hooks';
import { isRunning, ms, scoreTone, TONE_TEXT, when } from '@/lib/data';
import type { PracticeCase, RunDetail } from '@/lib/data';
import { cn } from '@/lib/utils';

/** A failing case with its scorer reasons; the reason most runs are opened. */
export function FailureBlock({ item }: { item: PracticeCase }) {
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-destructive/25 bg-destructive/5">
      <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-1.5">
        <span className="font-mono text-xs font-semibold text-destructive">{item.id}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {[item.level, item.family].filter(Boolean).join(' · ')}
        </span>
        <Badge variant="destructive" className="ml-auto border-destructive/40 text-destructive">
          {item.failed.length} reason{item.failed.length > 1 ? 's' : ''}
        </Badge>
      </div>
      <ul className="space-y-1 px-3 py-2 pl-8 text-[11.5px] text-destructive/90">
        {item.failed.map((reason, i) => (
          <li key={i} className="list-disc">
            {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Elapsed is only written when a run ends, so derive it while it is running. */
function LiveElapsed({ detail }: { detail: RunDetail }) {
  const { summary } = detail;
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!isRunning(summary) || !summary.startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [summary.status, summary.startedAt]);
  if (!isRunning(summary) || !summary.startedAt) return <>{ms(summary.elapsedMs)}</>;
  const since = now - new Date(summary.startedAt).getTime();
  return <>{since > 0 ? ms(since) : '—'}</>;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[140px] flex-1 bg-card px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-xs break-words">{children}</div>
    </div>
  );
}

/** Facts share a row via flex so a short list never leaves a dead grid cell. */
function FactStrip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-[420px] flex-1 flex-wrap gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60">
      {children}
    </div>
  );
}

function Disclosure({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group mb-4 overflow-hidden rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        {title}
        {summary && <span className="ml-auto font-mono text-[10px]">{summary}</span>}
      </summary>
      <div className="border-t border-border px-3 py-2.5">{children}</div>
    </details>
  );
}

// Config keys that are constant across runs and carry no diagnostic signal.
const CONFIG_NOISE = new Set(['out']);

export function OverviewTab({ detail }: { detail: RunDetail }) {
  const s = detail.summary;
  const e = s.evaluation;
  const running = isRunning(s);
  const tone = scoreTone(e.score);
  const failed = detail.practice?.cases.filter((c) => !c.pass) ?? [];
  const scored = e.score !== null && e.score !== undefined && e.passed !== null && e.total !== null;

  // While a run is in flight the last trace line is the most useful signal there is.
  const latest = [...detail.trace].reverse().find((t) => t.summary)?.summary;

  const configRows: [string, string][] = [];
  if (detail.config) {
    for (const [key, value] of Object.entries(detail.config)) {
      if (CONFIG_NOISE.has(key) || key === 'limits' || key === 'model' || key === 'slot') continue;
      configRows.push([key, typeof value === 'object' ? JSON.stringify(value) : String(value)]);
    }
    const limits = detail.config.limits as Record<string, unknown> | undefined;
    if (limits) {
      configRows.push([
        'limits',
        Object.entries(limits)
          .map(([k, v]) => `${k} ${v}`)
          .join(' · '),
      ]);
    }
  }
  if (detail.source) {
    configRows.push([
      'git',
      `${(detail.source.commit ?? '—').slice(0, 10)}${detail.source.dirty ? ' (dirty)' : ''}`,
    ]);
  }
  if (detail.inputHash) configRows.push(['input hash', detail.inputHash]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start gap-6">
        <div className="shrink-0">
          {running ? (
            <>
              <div className="flex items-center gap-2 text-[40px] leading-none">
                <span className="size-2.5 shrink-0 animate-pulse-dot rounded-full bg-warning" />
                <span className="font-mono font-semibold tracking-tighter">
                  <LiveElapsed detail={detail} />
                </span>
              </div>
              <div className="mt-1.5 text-[11px] text-warning">elapsed</div>
            </>
          ) : scored ? (
            <>
              <div
                className={cn(
                  'font-mono text-[40px] font-semibold leading-none tracking-tighter',
                  TONE_TEXT[tone],
                )}
              >
                {e.passed}
                <span className="text-lg font-normal text-muted-foreground">/{e.total}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">{e.source}</div>
              <div className="mt-2.5">
                <ScoreStrip total={e.total!} passed={e.passed!} />
              </div>
            </>
          ) : (
            <>
              <div className="font-mono text-[28px] font-semibold leading-none tracking-tight text-muted-foreground">
                not evaluated
              </div>
            </>
          )}
          {latest && running && (
            <p className="mt-2.5 max-w-[280px] font-mono text-[11px] leading-relaxed text-muted-foreground">
              {latest.length > 120 ? `${latest.slice(0, 120)}…` : latest}
            </p>
          )}
        </div>

        <FactStrip>
          <Fact label="status">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status={s.status} />
              {s.status}
            </span>
          </Fact>
          <Fact label="started">{when(s.startedAt)}</Fact>
          <Fact label="model">{s.model ?? '—'}</Fact>
          {s.slot && <Fact label="slot">{s.slot}</Fact>}
          {/* The heading already names the brief when they are the same. */}
          {s.taskId && s.taskId !== s.title && <Fact label="brief">{s.taskId}</Fact>}
        </FactStrip>
      </div>

      {s.error && (
        <div className="mb-4 overflow-hidden rounded-lg border border-destructive/30 bg-destructive/5">
          <div className="border-b border-destructive/20 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive">
            Error
          </div>
          <p className="px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-destructive/90">
            {s.error}
          </p>
        </div>
      )}

      {failed.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {failed.length} failing case{failed.length > 1 ? 's' : ''}
          </h3>
          {failed.map((item) => (
            <FailureBlock key={item.id} item={item} />
          ))}
        </div>
      )}

      {s.synthetic && (
        <p className="mb-3 flex gap-2 border-l-2 border-warning py-1 pl-3 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          Internal build baseline on a synthetic fixture. Structural checks only — not a benchmark
          score.
        </p>
      )}
      {s.kind === 'freya-live-run' && e.passed !== null && (
        <p className="mb-1 border-l-2 border-border py-1 pl-3 text-xs text-muted-foreground">
          One practice repetition. The competition benchmark uses three.
        </p>
      )}
      {e.details && (
        <p className="mb-3 flex gap-2 border-l-2 border-border py-1 pl-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {e.details}
        </p>
      )}

      {configRows.length > 0 && (
        <Disclosure title="Run details" summary={`${configRows.length} fields`}>
          <table className="w-full text-xs">
            <tbody>
              {configRows.map(([key, value]) => (
                <tr key={key} className="border-b border-border/40 last:border-0">
                  <td className="w-32 py-1 align-top text-muted-foreground">{key}</td>
                  <td className="py-1 font-mono break-all">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Disclosure>
      )}

      {detail.calls.length > 0 && (
        <Disclosure title="Model calls" summary={`${detail.calls.length}`}>
          <table className="w-full text-xs">
            <tbody>
              {detail.calls.map((call, i) => {
                // A call with a request but no response is still in flight.
                const inFlight = call.hasRequest && !call.hasResponse;
                return (
                  <tr key={i} className="border-b border-border/40 last:border-0">
                    <td className="w-6 py-1 font-mono text-muted-foreground">{i + 1}</td>
                    <td className="py-1 font-mono">{call.endpoint}</td>
                    <td className="py-1 font-mono">
                      {inFlight ? (
                        <span className="text-warning">in flight</span>
                      ) : (
                        ms(call.elapsedMs)
                      )}
                    </td>
                    <td className="py-1 pl-3 text-muted-foreground">
                      {call.error ? (
                        <span className="text-destructive">{call.error}</span>
                      ) : inFlight ? (
                        'awaiting response'
                      ) : call.hasResponse ? (
                        'complete'
                      ) : (
                        'no response'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Disclosure>
      )}
    </div>
  );
}
