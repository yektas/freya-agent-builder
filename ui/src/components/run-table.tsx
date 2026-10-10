import * as React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { ago, isRunning, kindLabel, ms, scoreTone, TONE_BG } from '@/lib/data';
import type { RunSummary } from '@/lib/data';
import { cn } from '@/lib/utils';
import { StatusDot } from '@/lib/hooks';

type Key = 'score' | 'status' | 'title' | 'kind' | 'model' | 'elapsed' | 'started';

const COLUMNS: [Key, string][] = [
  ['score', 'Score'],
  ['status', 'Status'],
  ['title', 'Run'],
  ['kind', 'Kind'],
  ['model', 'Model'],
  ['elapsed', 'Elapsed'],
  ['started', 'Started'],
];

function value(run: RunSummary, key: Key): string | number {
  switch (key) {
    case 'score':
      return run.evaluation.score ?? -1;
    case 'started':
      return Date.parse(run.startedAt ?? '') || 0;
    case 'elapsed':
      return run.elapsedMs ?? 0;
    default:
      return String((run as unknown as Record<string, unknown>)[key] ?? '');
  }
}

function ScoreBar({ run }: { run: RunSummary }) {
  const e = run.evaluation;
  const tone = scoreTone(e.score);
  const pct = e.score === null || e.score === undefined ? 0 : Math.round(e.score * 100);
  const counted = e.passed !== null && e.passed !== undefined;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full', TONE_BG[tone])} style={{ width: `${pct}%` }} />
      </div>
      <span
        className={cn(
          'min-w-9 font-mono text-xs tabular-nums',
          tone === 'good' && 'text-success',
          tone === 'warn' && 'text-warning',
          tone === 'bad' && 'text-destructive',
          tone === 'none' && 'text-muted-foreground',
        )}
      >
        {e.score === null || e.score === undefined
          ? '—'
          : `${counted ? e.passed : pct}${counted ? `/${e.total ?? 0}` : '%'}`}
      </span>
    </div>
  );
}

/** Every run in one sortable table: the fastest way to compare across tasks. */
export function RunTable({
  runs,
  selected,
  onSelect,
}: {
  runs: RunSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [sort, setSort] = React.useState<{ key: Key; dir: -1 | 1 }>({ key: 'started', dir: -1 });

  const sorted = React.useMemo(() => {
    const list = runs.slice();
    list.sort((a, b) => {
      const x = value(a, sort.key);
      const y = value(b, sort.key);
      if (x === y)
        return (Date.parse(b.startedAt ?? '') || 0) - (Date.parse(a.startedAt ?? '') || 0);
      return x < y ? -sort.dir : sort.dir;
    });
    return list;
  }, [runs, sort]);

  const scored = runs.filter(
    (r) => r.evaluation.score !== null && r.evaluation.score !== undefined,
  );
  const mean = scored.length
    ? scored.reduce((a, r) => a + (r.evaluation.score ?? 0), 0) / scored.length
    : null;
  const failed = runs.filter((r) => r.status === 'failed').length;
  const live = runs.filter(isRunning).length;

  const toggle = (key: Key) =>
    setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as -1 | 1) : -1 }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <SidebarTrigger className="-ml-1" />
        <h2 className="text-sm font-semibold">All runs</h2>
        <p className="text-[11px] text-muted-foreground">
          {runs.length} recorded · {scored.length} scored
          {mean !== null && (
            <>
              {' '}
              · mean <span className="font-mono">{Math.round(mean * 100)}%</span>
            </>
          )}
          {failed > 0 && (
            <>
              {' '}
              · <span className="text-destructive">{failed} failed</span>
            </>
          )}
          {live > 0 && (
            <>
              {' '}
              · <span className="text-warning">{live} running</span>
            </>
          )}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map(([key, label]) => (
                <TableHead
                  key={key}
                  onClick={() => toggle(key)}
                  className="cursor-pointer select-none hover:text-foreground"
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    {sort.key === key &&
                      (sort.dir === -1 ? (
                        <ArrowDown className="size-3 text-primary" />
                      ) : (
                        <ArrowUp className="size-3 text-primary" />
                      ))}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((run) => (
              <TableRow
                key={run.id}
                onClick={() => onSelect(run.id)}
                aria-current={run.id === selected}
                className={cn('cursor-pointer', run.id === selected && 'bg-muted')}
              >
                <TableCell>
                  <ScoreBar run={run} />
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <StatusDot status={run.status} />
                    {run.status}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="font-medium">{run.title}</span>
                  {run.synthetic && (
                    <Badge variant="warning" className="ml-1.5 border-warning/40 text-warning">
                      synthetic
                    </Badge>
                  )}
                  {run.error && (
                    <Badge
                      variant="destructive"
                      className="ml-1.5 border-destructive/40 text-destructive"
                    >
                      error
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{kindLabel(run.kind)}</TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {run.model ?? '—'}
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {ms(run.elapsedMs)}
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {ago(run.startedAt)}
                </TableCell>
              </TableRow>
            ))}
            {!sorted.length && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={COLUMNS.length}
                  className="py-14 text-center text-muted-foreground"
                >
                  No runs recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
