import * as React from 'react';
import { Activity, ArrowDown, ArrowUp, Sparkles } from 'lucide-react';
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
    <div title={e.details ?? undefined}>
      {e.source === 'official-practice' && (
        <div className="mb-1 text-[10px] text-muted-foreground">Kit score</div>
      )}
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
      {e.conversationPassed !== null && e.conversationPassed !== undefined && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          Conversation {e.conversationPassed}/{e.conversationTotal}
        </div>
      )}
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
    <div className="usage-cell">
      <div className="font-mono tabular-nums">{tokens(usage.totalTokens)}</div>
      <div className="usage-detail font-mono tabular-nums">
        {tokens(usage.inputTokens)} in · {tokens(usage.outputTokens)} out
      </div>
      <div className="usage-cost font-mono">{usd(usage.usd)}</div>
    </div>
  );
}

function RunCell({ run }: { run: RowDataLike }) {
  const badges = [
    run.archived ? <Badge key="archived">archived</Badge> : null,
    run.synthetic ? (
      <Badge key="synthetic" variant="warning" className="border-warning/40 text-warning">
        synthetic
      </Badge>
    ) : null,
    run.error ? (
      <Badge key="error" variant="destructive" className="border-destructive/40 text-destructive">
        error
      </Badge>
    ) : null,
  ].filter(Boolean);

  return (
    <div className="run-cell">
      <div className="run-cell-title">
        <span className="min-w-0 truncate font-medium">{run.title}</span>
        {badges}
      </div>
      <div className="run-cell-meta">
        <span>{kindLabel(run.kind)}</span>
        {run.model && <span>{run.model}</span>}
        <span>{ago(run.startedAt)}</span>
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
  columnHelper.accessor((run) => sortValue(run, 'started'), {
    id: 'started',
    header: ({ column }) => <SortButton column={column}>Run</SortButton>,
    cell: ({ row }) => <RunCell run={row.original} />,
  }),
  columnHelper.accessor((run) => sortValue(run, 'briefName'), {
    id: 'briefName',
    header: ({ column }) => <SortButton column={column}>Brief</SortButton>,
    cell: ({ row }) => (
      <span
        className="run-brief-name block max-w-[280px] truncate text-xs text-muted-foreground"
        title={row.original.briefName ?? undefined}
      >
        {row.original.briefName ?? '—'}
      </span>
    ),
  }),
  columnHelper.accessor((run) => sortValue(run, 'score'), {
    id: 'score',
    header: ({ column }) => <SortButton column={column}>Evaluation</SortButton>,
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
  columnHelper.accessor((run) => sortValue(run, 'tokens'), {
    id: 'tokens',
    header: ({ column }) => <SortButton column={column}>Usage</SortButton>,
    cell: ({ row }) => <TokenCell run={row.original} />,
  }),
  columnHelper.accessor((run) => sortValue(run, 'elapsed'), {
    id: 'elapsed',
    header: ({ column }) => <SortButton column={column}>Elapsed</SortButton>,
    cell: ({ row }) => (
      <span className="font-mono text-muted-foreground">{ms(row.original.elapsedMs)}</span>
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
  filter,
  onFilter,
  archivedView,
  onSelect,
  onStarted,
  onArchived,
  onRestored,
}: {
  runs: RunSummary[];
  selected: string | null;
  filter: string;
  onFilter: (filter: string) => void;
  archivedView: boolean;
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
  const scoreRuns = runs
    .filter((run) => run.evaluation.score !== null && run.evaluation.score !== undefined)
    .slice(0, 8)
    .reverse();

  const filterOptions = [
    ['all', 'All runs'],
    ['freya-live-run', 'Freya'],
    ['generation-only', 'Generated'],
    ['local-build', 'Local builds'],
  ] as const;

  return (
    <div className="history-page">
      <div className="history-hero">
        <section className="history-heading">
          <div className="history-title-copy">
            <p className="eyebrow">
              BUILDER WORKSPACE <span>/</span> {archivedView ? 'ARCHIVE' : 'RUNS'}
            </p>
            <h1>
              {archivedView ? (
                <>
                  Archived <span className="headline-accent">runs</span>
                </>
              ) : (
                <>
                  Run <span className="headline-accent">history</span>
                </>
              )}
            </h1>
            <p className="history-subtitle">
              Review each generation, its evaluation, and the artifacts behind it.
            </p>
          </div>
        </section>

        <section className="run-metrics" aria-label="Run summary">
          <div className="run-panel-chrome" aria-hidden="true">
            <span className="run-panel-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="run-panel-path">FREYA / WORKSPACE / RUNS</span>
            <span className="run-panel-status">
              <span /> {live ? 'LIVE GENERATION' : 'MONITORING'}
            </span>
          </div>
          <div className="run-metrics-grid">
            <Metric label="Runs in view" value={String(runs.length)} />
            <Metric
              label="Mean evaluation"
              value={mean === null ? '—' : `${Math.round(mean * 100)}%`}
            />
            <Metric
              label="In progress"
              value={String(live)}
              detail={
                live ? <Activity className="size-3.5 animate-pulse-dot text-warning" /> : undefined
              }
            />
            <Metric label="Scored" value={String(scored.length)} />
          </div>
          <div className="run-score-chart">
            <div className="run-score-chart-heading">
              <span>Evaluation history</span>
              <span>{scoreRuns.length} scored runs</span>
            </div>
            {scoreRuns.length ? (
              <div
                className="run-score-chart-bars"
                role="img"
                aria-label={`Scores for the ${scoreRuns.length} most recent evaluated runs`}
              >
                {scoreRuns.map((run) => {
                  const score = run.evaluation.score ?? 0;
                  const percent = Math.round(score * 100);
                  return (
                    <span
                      key={run.id}
                      className="run-score-chart-bar"
                      style={{ height: `${Math.max(percent, 3)}%` }}
                      title={`${run.title} · ${percent}%`}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="run-score-chart-empty">Scores appear here as runs are evaluated.</p>
            )}
          </div>
        </section>
      </div>

      <section className="run-library" aria-label="Recorded runs">
        <div className="run-library-toolbar">
          <div className="filter-group" role="group" aria-label="Filter runs by type">
            {filterOptions.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => onFilter(value)}
                className={cn('filter-button', filter === value && 'filter-button-active')}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="result-count">
            <span>{runs.length}</span> {runs.length === 1 ? 'run' : 'runs'}
            {failed > 0 && <span className="result-failed"> · {failed} failed</span>}
          </p>
        </div>

        {rows.length ? (
          <div className="run-table-scroll">
            <Table className="run-table min-w-[960px]">
              <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="run-table-heading hover:bg-transparent">
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder ? null : <FlexRender header={header} />}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    tabIndex={0}
                    onClick={() => onSelect(row.original.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(row.original.id);
                      }
                    }}
                    aria-current={row.original.id === selected}
                    className={cn(
                      'run-table-row cursor-pointer',
                      row.original.id === selected && 'run-table-row-selected',
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        <FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState firstRun={filter === 'all' && !archivedView} onStarted={onStarted} />
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: React.ReactNode;
}) {
  return (
    <div className="run-metric">
      <span className="run-metric-label">{label}</span>
      <span className="run-metric-value">
        {value}
        {detail}
      </span>
    </div>
  );
}

function EmptyState({
  firstRun,
  onStarted,
}: {
  firstRun: boolean;
  onStarted: (run: StartedRun) => void;
}) {
  if (!firstRun) {
    return <p className="empty-filter-state">No runs match this filter.</p>;
  }

  return (
    <div className="empty-state">
      <div className="empty-state-copy">
        <p className="empty-kicker">YOUR NEXT RUN STARTS HERE</p>
        <h2>No generations recorded</h2>
        <p>
          Generate a workflow from the configured event package. The builder compiles it locally;
          registration remains a separate step.
        </p>
        <NewRunAction
          onStarted={onStarted}
          trigger={
            <Button size="lg" className="generate-button">
              <Sparkles className="size-4" />
              Start a generation
            </Button>
          }
        />
      </div>
      <div className="empty-flow" aria-label="Generation flow">
        <div className="empty-flow-step">
          <span className="empty-flow-index">01</span>
          <span className="empty-flow-title">Event task</span>
          <span className="empty-flow-caption">Original task + tools</span>
        </div>
        <span className="empty-flow-connector" />
        <div className="empty-flow-step empty-flow-step-active">
          <span className="empty-flow-index">02</span>
          <span className="empty-flow-title">Agent workflow</span>
          <span className="empty-flow-caption">One direct generation</span>
        </div>
        <span className="empty-flow-connector" />
        <div className="empty-flow-step">
          <span className="empty-flow-index">03</span>
          <span className="empty-flow-title">Local compile</span>
          <span className="empty-flow-caption">Inspect before upload</span>
        </div>
      </div>
    </div>
  );
}
