import * as React from 'react';
import { ArrowDown, ArrowUp, Archive as ArchiveIcon } from 'lucide-react';
import {
  createColumnHelper,
  useTable,
  type ColumnDef,
  type RowData,
  type SortingState,
  FlexRender,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { NewRunAction } from '@/components/new-run-action';
import { RowAction } from '@/components/delete-run';
import { features, type DataTableFeatures } from './run-table-features';
import { ago, isRunning, kindLabel, ms, scoreTone, tokens, TONE_BG, usd } from '@/lib/data';
import type { RunSummary, StartedRun } from '@/lib/data';
import { cn } from '@/lib/utils';
import { StatusDot } from '@/lib/hooks';

// Module augmentation, per the v9 docs for per-table metadata: every table in
// this app shares the run-table callbacks.
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TFeatures, TData> {
    onArchived: (id: string, archivedId: string) => void;
    onRestored: (id: string) => void;
  }
}

type RowDataLike = RunSummary & RowData;

const columnHelper = createColumnHelper<DataTableFeatures, RowDataLike>();

/**
 * A comparable sort key for each accessor, preserving the hand-rolled
 * semantics: runs with no score/token usage sort last rather than first, and
 * dateless runs sort as oldest when ascending.
 */
function sortValue(run: RowDataLike, key: string): string | number {
  switch (key) {
    case 'score':
      return run.evaluation.score ?? -1;
    case 'started':
      return Date.parse(run.startedAt ?? '') || 0;
    case 'elapsed':
      return run.elapsedMs ?? 0;
    // Runs with no priced call sort last rather than first.
    case 'tokens':
      return run.usage?.totalTokens ?? -1;
    case 'cost':
      return run.usage?.usd ?? -1;
    default:
      return String((run as unknown as Record<string, unknown>)[key] ?? '');
  }
}

/** Score bar with the pass count or percentage beside it. */
function ScoreBar({ run }: { run: RowDataLike }) {
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

/** Total tokens with the input/output split underneath, when there is a call. */
function TokenCell({ run }: { run: RowDataLike }) {
  const usage = run.usage;
  if (!usage || usage.totalTokens === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="font-mono leading-tight">
      <div className="tabular-nums">{tokens(usage.totalTokens)}</div>
      <div className="text-[10px] tabular-nums text-muted-foreground">
        {tokens(usage.inputTokens)} in · {tokens(usage.outputTokens)} out
      </div>
    </div>
  );
}

// Structural type: SortButton only touches the sorting API on the column, so
// it stays valid for any TValue across the def union.
type SortColumn = {
  getIsSorted: () => false | 'asc' | 'desc';
  getToggleSortingHandler: () => undefined | ((event: unknown) => void);
};

/** Sortable header cell carrying the sort direction indicator. */
function SortButton({ column, children }: { column: SortColumn; children: React.ReactNode }) {
  const sorted = column.getIsSorted();
  return (
    <Button
      variant="ghost"
      size="xs"
      className="-mx-1.5 gap-0.5 px-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground hover:text-foreground"
      onClick={column.getToggleSortingHandler()}
    >
      <span className="uppercase">{children}</span>
      {sorted === 'asc' && <ArrowUp className="size-3 text-primary" />}
      {sorted === 'desc' && <ArrowDown className="size-3 text-primary" />}
    </Button>
  );
}

const columns = columnHelper.columns([
  columnHelper.accessor((run) => sortValue(run, 'score'), {
    id: 'score',
    header: ({ column }) => <SortButton column={column}>Score</SortButton>,
    cell: ({ row }) => <ScoreBar run={row.original} />,
  }),
  columnHelper.accessor((run) => run.status, {
    id: 'status',
    header: ({ column }) => <SortButton column={column}>Status</SortButton>,
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <StatusDot status={row.original.status} />
        {row.original.status}
      </span>
    ),
  }),
  columnHelper.accessor((run) => run.title, {
    id: 'title',
    header: ({ column }) => <SortButton column={column}>Run</SortButton>,
    cell: ({ row }) => {
      const run = row.original;
      return (
        <div className="whitespace-nowrap">
          <span className="font-medium">{run.title}</span>
          {run.archived && (
            <Badge className="ml-1.5 border-muted text-muted-foreground">archived</Badge>
          )}
          {run.synthetic && (
            <Badge variant="warning" className="ml-1.5 border-warning/40 text-warning">
              synthetic
            </Badge>
          )}
          {run.error && (
            <Badge variant="destructive" className="ml-1.5 border-destructive/40 text-destructive">
              error
            </Badge>
          )}
        </div>
      );
    },
  }),
  columnHelper.accessor((run) => kindLabel(run.kind), {
    id: 'kind',
    header: ({ column }) => <SortButton column={column}>Kind</SortButton>,
    cell: ({ row }) => (
      <span className="text-muted-foreground">{kindLabel(row.original.kind)}</span>
    ),
  }),
  columnHelper.accessor((run) => run.model ?? '', {
    id: 'model',
    header: ({ column }) => <SortButton column={column}>Model</SortButton>,
    cell: ({ row }) => (
      <span className="font-mono text-muted-foreground">{row.original.model ?? '—'}</span>
    ),
  }),
  columnHelper.accessor((run) => sortValue(run, 'tokens'), {
    id: 'tokens',
    header: ({ column }) => <SortButton column={column}>Tokens</SortButton>,
    cell: ({ row }) => <TokenCell run={row.original} />,
  }),
  columnHelper.accessor((run) => sortValue(run, 'cost'), {
    id: 'cost',
    header: ({ column }) => <SortButton column={column}>Cost</SortButton>,
    cell: ({ row }) => (
      <span className="font-mono text-muted-foreground">
        {row.original.usage ? usd(row.original.usage.usd) : '—'}
      </span>
    ),
  }),
  columnHelper.accessor((run) => sortValue(run, 'elapsed'), {
    id: 'elapsed',
    header: ({ column }) => <SortButton column={column}>Elapsed</SortButton>,
    cell: ({ row }) => (
      <span className="font-mono text-muted-foreground">{ms(row.original.elapsedMs)}</span>
    ),
  }),
  columnHelper.accessor((run) => sortValue(run, 'started'), {
    id: 'started',
    header: ({ column }) => <SortButton column={column}>Started</SortButton>,
    cell: ({ row }) => (
      <span className="font-mono text-muted-foreground">{ago(row.original.startedAt)}</span>
    ),
  }),
  // Display column per the guide: the row action, with no accessor.
  columnHelper.display({
    id: 'actions',
    header: () => null,
    cell: ({ table, row }) => (
      <RowAction
        id={row.original.id}
        archived={row.original.archived}
        disabled={isRunning(row.original)}
        onArchived={table.options.meta?.onArchived ?? (() => {})}
        onRestored={table.options.meta?.onRestored ?? (() => {})}
      />
    ),
  }),
]);

/**
 * Every run in one sortable table: the fastest way to compare across tasks.
 * Built on the shadcn Base UI data-table pattern (TanStack Table v9); the
 * features object in run-table-features.ts opts into sorting only, so the rest
 * of the dependency tree-shakes away.
 */
export function RunTable({
  runs,
  selected,
  archivedView,
  onToggleArchived,
  onSelect,
  onStarted,
  onArchived,
  onRestored,
}: {
  runs: RunSummary[];
  selected: string | null;
  archivedView: boolean;
  onToggleArchived: (show: boolean) => void;
  onSelect: (id: string) => void;
  onStarted: (run: StartedRun) => void;
  onArchived: (id: string, archivedId: string) => void;
  onRestored: (id: string) => void;
}) {
  const memoRuns = React.useMemo(() => runs as RowDataLike[], [runs]);

  // Newest first by default; the table owns the sorting state, so the
  // indicators and the click handlers come from the same source.
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'started', desc: true }]);
  const table = useTable({
    features,
    data: memoRuns,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row: RowDataLike) => row.id,
    // The old table sorted a fresh column descending first; keep that habit.
    sortDescFirst: true,
    enableSortingRemoval: false,
    meta: { onArchived, onRestored },
  });

  const scored = runs.filter(
    (r) => r.evaluation.score !== null && r.evaluation.score !== undefined,
  );
  const mean = scored.length
    ? scored.reduce((a, r) => a + (r.evaluation.score ?? 0), 0) / scored.length
    : null;
  const failed = runs.filter((r) => r.status === 'failed').length;
  const live = runs.filter(isRunning).length;

  const rows = table.getRowModel().rows;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <SidebarTrigger className="-ml-1" />
        <h2 className="text-sm font-semibold">{archivedView ? 'Archive' : 'All runs'}</h2>
        <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
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
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={archivedView}
          onClick={() => onToggleArchived(!archivedView)}
          title={archivedView ? 'Show the live run list' : 'Show archived runs (restorable)'}
        >
          <ArchiveIcon className="size-3.5" />
          {archivedView ? 'Back to runs' : 'Archive'}
        </Button>
        <NewRunAction onStarted={onStarted} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : <FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => onSelect(row.original.id)}
                  aria-current={row.original.id === selected}
                  className={cn('cursor-pointer', row.original.id === selected && 'bg-muted')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length}
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
