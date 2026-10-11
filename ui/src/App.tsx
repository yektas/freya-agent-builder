import * as React from 'react';
import { ArrowLeft, Archive as ArchiveIcon, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NewRunAction } from '@/components/new-run-action';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RunTable } from '@/components/run-table';
import { OverviewTab } from '@/components/overview-tab';
import { PracticeTab } from '@/components/practice-tab';
import { StagesTab, WorkflowTab } from '@/components/tabs';
import { CandidateTab, FilesTab, TraceTab } from '@/components/simple-tabs';
import { UploadAction } from '@/components/upload-action';
import { PracticeAction } from '@/components/practice-action';
import { RowAction } from '@/components/delete-run';
import { isRunning, kindLabel, when } from '@/lib/data';
import type { RunDetail, RunSummary, StartedRun } from '@/lib/data';
import { usePoller } from '@/lib/hooks';

const fetchRuns = async (query: string): Promise<{ runs: RunSummary[] }> => {
  const response = await fetch(`/api/runs${query}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

const fetchDetail = async (id: string): Promise<RunDetail> => {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

function Detail({
  detail,
  onBack,
  onArchived,
  onRestored,
}: {
  detail: RunDetail;
  onBack: () => void;
  onArchived: (id: string, archivedId: string) => void;
  onRestored: (id: string) => void;
}) {
  const s = detail.summary;
  const [tab, setTab] = React.useState('overview');
  const [node, setNode] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<string | null>(null);

  const failed = detail.practice?.cases.filter((c) => !c.pass).length ?? 0;
  const tabs: [string, React.ReactNode][] = [
    ['overview', 'Overview'],
    ...(detail.stages.length ? [['stages', 'Stages'] as [string, React.ReactNode]] : []),
    ...(detail.workflow ? [['workflow', 'Workflow'] as [string, React.ReactNode]] : []),
    ...(detail.practice?.cases.length
      ? [
          [
            'practice',
            <span key="p">
              Practice
              {failed > 0 && <span className="ml-1.5 font-mono text-destructive">{failed}</span>}
            </span>,
          ] as [string, React.ReactNode],
        ]
      : []),
    ...(detail.candidate || detail.workflowCandidate
      ? [['candidate', 'Candidate'] as [string, React.ReactNode]]
      : []),
    ...(detail.trace.length ? [['trace', 'Trace'] as [string, React.ReactNode]] : []),
    ['files', 'Files'],
  ];

  return (
    <div className="detail-view flex min-h-0 flex-1 flex-col">
      <header className="detail-header border-b border-border">
        <div className="detail-header-inner">
          <div className="detail-title-row">
            <Button variant="ghost" size="sm" onClick={onBack} className="detail-back">
              <ArrowLeft className="size-3.5" />
              All runs
            </Button>
            <span className="detail-title-divider" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[21px] font-semibold tracking-tight">{s.title}</h1>
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                {when(s.startedAt)} · {kindLabel(s.kind)}
                {s.model ? ` · ${s.model}` : ''}
                {isRunning(s) && <span className="text-warning"> · updating live</span>}
              </p>
            </div>
            <RowAction
              id={s.id}
              archived={s.archived}
              disabled={isRunning(s)}
              onArchived={onArchived}
              onRestored={onRestored}
            />
            {s.archived && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <ArchiveIcon className="size-3" /> archived — restorable
              </span>
            )}
          </div>
          {/* Remount per run so a pending request or result never leaks across runs. */}
          <div className="detail-actions">
            <UploadAction key={detail.summary.id} detail={detail} />
            <PracticeAction key={`practice-${detail.summary.id}`} detail={detail} />
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="detail-tabs mt-3 h-auto gap-1 bg-transparent p-0">
              {tabs.map(([value, label]) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="rounded-md border border-transparent bg-transparent px-3 py-2 text-xs text-muted-foreground data-[selected]:border-border data-[selected]:bg-card data-[selected]:font-medium data-[selected]:text-foreground"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </header>
      <div className="detail-content min-h-0 flex-1 overflow-auto">
        {tab === 'overview' && <OverviewTab detail={detail} />}
        {tab === 'stages' && <StagesTab detail={detail} />}
        {tab === 'workflow' && <WorkflowTab detail={detail} selected={node} onSelect={setNode} />}
        {tab === 'practice' && detail.practice && <PracticeTab practice={detail.practice} />}
        {tab === 'candidate' && <CandidateTab detail={detail} />}
        {tab === 'trace' && <TraceTab detail={detail} />}
        {tab === 'files' && <FilesTab detail={detail} file={file} onFile={setFile} />}
      </div>
    </div>
  );
}

export function App() {
  const [runs, setRuns] = React.useState<RunSummary[]>([]);
  const [filter, setFilter] = React.useState('all');
  const [archivedView, setArchivedView] = React.useState(false);
  const [id, setId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<RunDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const live = runs.some(isRunning);
  // Poll faster while a run is in flight so a generation streams into view.
  const listInterval = live ? 1000 : 5000;

  usePoller({
    interval: listInterval,
    // The list endpoint serves one bucket at a time; the toggle switches which.
    fetcher: () => fetchRuns(archivedView ? '?archived=1' : ''),
    onData: (data) => {
      setRuns(data.runs);
      setError(null);
    },
  });
  usePoller({
    interval: live ? 1000 : 5000,
    fetcher: () => (id ? fetchDetail(id) : Promise.resolve(null)),
    onData: (data) => data && setDetail(data),
    enabled: !!id,
  });

  // A deep link restores the run on reload.
  React.useEffect(() => {
    const fromHash = () => {
      const next = decodeURIComponent(location.hash.replace(/^#/, ''));
      if (next && runs.some((r) => r.id === next)) setId(next);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [runs]);

  const select = (next: string) => {
    setId(next);
    setDetail(null);
    location.hash = encodeURIComponent(next);
  };
  const back = () => {
    setId(null);
    setDetail(null);
    location.hash = '';
  };
  // An archived run leaves whichever list is open; if it was open in detail,
  // the detail view also closes, so no stale panel survives the move.
  const onArchived = React.useCallback(
    (removedId: string) => {
      setRuns((current) => current.filter((run) => run.id !== removedId));
      if (id === removedId) {
        back();
      }
    },
    [id],
  );
  // A restored run reappears in the main list at the next poll; closing the
  // detail view makes the switch visible immediately.
  const onRestored = React.useCallback(
    (restoredId: string) => {
      setRuns((current) => current.filter((run) => run.id !== restoredId));
      if (id === restoredId) {
        back();
      }
      // Jump to the live list so the user sees where the run went.
      setArchivedView(false);
    },
    [id],
  );
  // A started run is addressed by the same id the list uses, so it opens
  // immediately and keeps streaming into view while the model is still writing.
  const started = React.useCallback((run: StartedRun) => {
    back();
    select(`generation~${run.runId}`);
  }, []);

  const showRunView = (showArchived: boolean) => {
    setArchivedView(showArchived);
    setFilter('all');
    if (id) back();
  };

  const visible = filter === 'all' ? runs : runs.filter((r) => r.kind === filter);

  return (
    <TooltipProvider>
      <div className="app-shell">
        <header className="workspace-bar">
          <div className="workspace-identity">
            <div className="workspace-brand" aria-label="Freya agent builder">
              <span className="brand-mark" aria-hidden="true">
                <span />
              </span>
              <span className="brand-copy">
                <strong>freya</strong>
                <span>agent builder</span>
              </span>
            </div>
            <span className="workspace-divider" aria-hidden="true" />
            <span className="workspace-context">{id ? 'Run inspector' : 'Builder workspace'}</span>
          </div>
          <nav className="workspace-nav" aria-label="Workspace views">
            <button
              type="button"
              aria-current={!archivedView ? 'page' : undefined}
              onClick={() => showRunView(false)}
            >
              Runs
            </button>
            <button
              type="button"
              aria-current={archivedView ? 'page' : undefined}
              onClick={() => showRunView(true)}
            >
              Archive
            </button>
          </nav>
          <div className="workspace-actions">
            <div className="workspace-local">
              <span className="local-indicator" />
              <span>Local workspace</span>
            </div>
            <NewRunAction
              onStarted={started}
              trigger={
                <Button variant="outline" className="workspace-cta">
                  <Sparkles className="size-3.5" />
                  <span>Generate</span>
                </Button>
              }
            />
          </div>
        </header>
        <main className="app-main">
          {error && <p className="p-4 text-xs text-destructive">{error}</p>}
          {!id && !error && (
            <RunTable
              runs={visible}
              selected={id}
              filter={filter}
              onFilter={setFilter}
              archivedView={archivedView}
              onSelect={select}
              onStarted={started}
              onArchived={onArchived}
              onRestored={onRestored}
            />
          )}
          {id && !detail && (
            <div className="detail-loading">
              <div className="loading-line loading-line-short" />
              <div className="loading-line loading-line-title" />
              <div className="loading-line loading-line-tabs" />
              <div className="loading-panel" />
            </div>
          )}
          {id && detail && (
            <Detail detail={detail} onBack={back} onArchived={onArchived} onRestored={onRestored} />
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
