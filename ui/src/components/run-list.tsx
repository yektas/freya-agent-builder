import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { Activity, AlertTriangle, FlaskConical } from 'lucide-react';
import { ago, isRunning, kindLabel, scoreTone, TONE_TEXT } from '@/lib/data';
import type { RunSummary, Tone } from '@/lib/data';
import { cn } from '@/lib/utils';

const FILTERS = [
  ['all', 'all'],
  ['freya-live-run', 'freya'],
  ['generation-only', 'generate'],
  ['local-build', 'build'],
] as const;

const TONE_DOT: Record<Tone, string> = {
  good: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  none: 'bg-muted-foreground/50',
};

function ScoreCell({ run }: { run: RunSummary }) {
  const e = run.evaluation;
  const tone = scoreTone(e.score);
  const scored = e.score !== null && e.score !== undefined;

  // Collapsed, a bare "—" tells you nothing, so the score is reduced to a dot
  // that still carries the outcome. Tooltips keep the label available.
  const dot =
    run.status === 'failed'
      ? 'bg-destructive'
      : isRunning(run)
        ? 'bg-warning'
        : scored
          ? TONE_DOT[tone]
          : 'bg-muted-foreground/50';

  return (
    <span className="flex min-w-[38px] items-center group-data-[collapsible=icon]:min-w-0 group-data-[collapsible=icon]:justify-center">
      <span
        className={cn(
          'hidden size-2.5 shrink-0 rounded-full',
          dot,
          'group-data-[collapsible=icon]:block',
        )}
        aria-hidden
      />
      <span
        className={cn(
          'font-mono text-[15px] font-semibold tabular-nums group-data-[collapsible=icon]:hidden',
          scored ? TONE_TEXT[tone] : 'text-muted-foreground',
        )}
      >
        {scored ? (
          <>
            {e.passed !== null && e.passed !== undefined ? e.passed : Math.round(e.score! * 100)}
            <span className="text-[11px] font-normal text-muted-foreground">
              {e.passed !== null && e.passed !== undefined ? `/${e.total ?? 0}` : '%'}
            </span>
          </>
        ) : (
          '—'
        )}
      </span>
    </span>
  );
}

/** Run state is carried by the left border so the icon slot stays free. */
function runBorder(run: RunSummary) {
  if (run.status === 'failed') return 'border-l-destructive';
  if (isRunning(run)) return 'border-l-warning';
  return 'border-l-transparent';
}

function RunItem({
  run,
  selected,
  onSelect,
}: {
  run: RunSummary;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const flags: React.ReactNode[] = [];
  if (isRunning(run)) {
    flags.push(
      <Badge key="live" variant="warning" className="border-warning/40 text-warning">
        <span className="size-1 animate-pulse-dot rounded-full bg-warning" />
        running
      </Badge>,
    );
  }
  if (run.status === 'failed' && !isRunning(run)) {
    flags.push(
      <Badge key="failed" variant="destructive" className="border-destructive/40 text-destructive">
        failed
      </Badge>,
    );
  }
  if (run.error) {
    flags.push(
      <Badge key="error" variant="destructive" className="border-destructive/40 text-destructive">
        <AlertTriangle className="size-2.5" />
        error
      </Badge>,
    );
  }
  if (run.synthetic) {
    flags.push(
      <Badge key="synthetic" variant="warning" className="border-warning/40 text-warning">
        <FlaskConical className="size-2.5" />
        synthetic
      </Badge>,
    );
  }

  const meta = [kindLabel(run.kind), run.model].filter(Boolean).join(' · ');
  const slot = run.slot && run.slot !== run.title ? ` · ${run.slot}` : '';

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={() => onSelect(run.id)}
        isActive={selected}
        tooltip={run.title}
        className={cn(
          'h-auto items-start gap-2 border-l-[3px] px-2.5 py-1.5',
          'group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0',
          runBorder(run),
        )}
      >
        <ScoreCell run={run} />
        <span className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{run.title}</span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {ago(run.startedAt)}
            </span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
            {meta}
            {slot}
          </span>
          {flags.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{flags}</span>}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * A footer only earns its space when it says something. Run kinds differ wildly
 * in duration, so mean elapsed across them is noise; mean score is the signal.
 */
function Summary({ runs }: { runs: RunSummary[] }) {
  const scored = runs.filter(
    (r) => r.evaluation.score !== null && r.evaluation.score !== undefined,
  );
  const failed = runs.filter((r) => r.status === 'failed').length;
  const live = runs.filter(isRunning).length;
  if (!scored.length && !failed && !live) return null;

  const mean = scored.length
    ? Math.round((scored.reduce((a, r) => a + (r.evaluation.score ?? 0), 0) / scored.length) * 100)
    : null;

  return (
    <SidebarFooter className="flex-row items-center gap-3 border-t border-sidebar-border px-3 py-2 font-mono text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
      {mean !== null && <span>mean {mean}%</span>}
      {failed > 0 && <span className="text-destructive">{failed} failed</span>}
      {live > 0 && <span className="text-warning">{live} running</span>}
    </SidebarFooter>
  );
}

export function RunList({
  runs,
  selected,
  filter,
  onFilter,
  onSelect,
}: {
  runs: RunSummary[];
  selected: string | null;
  filter: string;
  onFilter: (f: string) => void;
  onSelect: (id: string) => void;
}) {
  const live = runs.filter(isRunning).length;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3.5 py-3 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-2">
        {/* Collapsed, a single live/idle glyph replaces the two-line header
            rather than leaving an empty block behind. */}
        <Activity
          className={cn(
            'hidden size-4 shrink-0',
            live > 0 ? 'animate-pulse-dot text-warning' : 'text-muted-foreground',
            'group-data-[collapsible=icon]:block',
          )}
        />
        <div className="group-data-[collapsible=icon]:hidden">
          <h2 className="text-xs font-semibold tracking-wide">Freya run inspector</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {live > 0 ? (
              <>
                <Activity className="size-3 shrink-0 animate-pulse-dot text-warning" />
                {live} running
              </>
            ) : (
              // Upload is the one authorized write, from a generation's page.
              `${runs.length} run${runs.length === 1 ? '' : 's'}`
            )}
          </p>
        </div>
      </SidebarHeader>

      {/* Filters need their labels to be meaningful, so they collapse out entirely. */}
      <SidebarGroup className="border-b border-sidebar-border p-0 group-data-[collapsible=icon]:hidden">
        <SidebarMenu className="flex-row flex-wrap gap-1 p-2">
          {FILTERS.map(([value, label]) => (
            <SidebarMenuItem key={value} className="w-auto">
              <SidebarMenuButton
                size="sm"
                onClick={() => onFilter(value)}
                isActive={filter === value}
                tooltip={label}
                className={cn(
                  'w-auto rounded-md border border-transparent px-2 text-[11px]',
                  filter === value && 'border-sidebar-border text-primary',
                )}
              >
                {label}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>

      <SidebarContent>
        <SidebarMenu className="gap-0">
          {runs.map((run) => (
            <RunItem key={run.id} run={run} selected={run.id === selected} onSelect={onSelect} />
          ))}
          {!runs.length && (
            <p className="px-4 py-10 text-center text-xs text-muted-foreground">No runs match.</p>
          )}
        </SidebarMenu>
      </SidebarContent>

      <Summary runs={runs} />
      <SidebarRail />
    </Sidebar>
  );
}
