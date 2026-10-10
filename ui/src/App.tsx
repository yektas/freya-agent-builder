import * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider } from '@/components/ui/sidebar';
import { RunList } from '@/components/run-list';
import { RunTable } from '@/components/run-table';
import { OverviewTab } from '@/components/overview-tab';
import { PracticeTab } from '@/components/practice-tab';
import { StagesTab, WorkflowTab } from '@/components/tabs';
import { CandidateTab, FilesTab, TraceTab } from '@/components/simple-tabs';
import { UploadAction } from '@/components/upload-action';
import { isRunning, kindLabel, when } from '@/lib/data';
import type { RunDetail, RunSummary, StartedRun } from '@/lib/data';
import { usePoller } from '@/lib/hooks';

const fetchRuns = async (): Promise<{ runs: RunSummary[] }> => {
  const response = await fetch('/api/runs');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

const fetchDetail = async (id: string): Promise<RunDetail> => {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

function Detail({ detail, onBack }: { detail: RunDetail; onBack: () => void }) {
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
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border px-5 pt-3.5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-semibold tracking-tight">{s.title}</h2>
            <p className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground">
              {when(s.startedAt)} · {kindLabel(s.kind)}
              {s.model ? ` · ${s.model}` : ''}
              {isRunning(s) && <span className="text-warning"> · updating live</span>}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="size-3.5" />
            All runs
          </Button>
        </div>
        {/* Remount per run so a pending request or result never leaks across runs. */}
        <UploadAction key={detail.summary.id} detail={detail} />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mt-3 h-auto gap-0.5 bg-transparent p-0">
            {tabs.map(([value, label]) => (
              <TabsTrigger
                key={value}
                value={value}
                className="rounded-t-md border-b-2 border-transparent bg-transparent px-2.5 py-1.5 text-xs text-muted-foreground data-[selected]:border-primary data-[selected]:text-foreground"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
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
  const [id, setId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<RunDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const live = runs.some(isRunning);
  // Poll faster while a run is in flight so a generation streams into view.
  const listInterval = live ? 1000 : 5000;

  usePoller({
    interval: listInterval,
    fetcher: fetchRuns,
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
  // A started run is addressed by the same id the list uses, so it opens
  // immediately and keeps streaming into view while the model is still writing.
  const started = React.useCallback((run: StartedRun) => {
    back();
    select(`generation~${run.runId}`);
  }, []);

  const visible = filter === 'all' ? runs : runs.filter((r) => r.kind === filter);

  return (
    <TooltipProvider>
      {/* Width must come from the documented CSS variable: the sidebar and the
          gap it reserves are both sized from it, so a width class on <Sidebar>
          silently pushes content underneath. */}
      <SidebarProvider
        className="h-full"
        style={{ '--sidebar-width': '18rem' } as React.CSSProperties}
      >
        <RunList
          runs={visible}
          selected={id}
          filter={filter}
          onFilter={setFilter}
          onSelect={select}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {error && <p className="p-4 text-xs text-destructive">{error}</p>}
          {!id && !error && (
            <RunTable runs={visible} selected={id} onSelect={select} onStarted={started} />
          )}
          {id && !detail && (
            <p className="p-10 text-center text-xs text-muted-foreground">Loading run…</p>
          )}
          {id && detail && <Detail detail={detail} onBack={back} />}
        </main>
      </SidebarProvider>
    </TooltipProvider>
  );
}
