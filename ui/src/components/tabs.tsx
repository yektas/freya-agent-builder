import * as React from 'react';
import { AlertTriangle, Check, ChevronRight, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Section, useOpenSet } from '@/lib/hooks';
import { ms, when } from '@/lib/data';
import type { GraphNode, RunDetail, Workflow } from '@/lib/data';
import { cn } from '@/lib/utils';
import { WorkflowGraph } from '@/components/workflow-graph';

const TYPE_COLOR: Record<string, string> = {
  conversation: 'bg-primary',
  api_request: 'bg-warning',
  code: 'bg-[#bb9af7]',
  end_call: 'bg-success',
};

/** The submitted document itself, with a copy affordance for pasting into a submission. */
function WorkflowJson({ json }: { json: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(json).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };
  return (
    <Section
      title="Workflow JSON"
      aside={
        <Button size="xs" variant="ghost" onClick={copy} className="normal-case tracking-normal">
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      }
    >
      <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[11.5px]">
        {json}
      </pre>
    </Section>
  );
}

function NodeDetail({ node }: { node: GraphNode }) {
  return (
    <div className="space-y-2.5 p-3">
      {node.taskMessage && (
        <pre className="overflow-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-[11.5px] whitespace-pre-wrap">
          {node.taskMessage}
        </pre>
      )}
      {node.tools.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Tools
          </div>
          <pre className="overflow-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-[11.5px]">
            {node.tools.join('\n')}
          </pre>
        </div>
      )}
      {node.preActions.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            On entry
          </div>
          <pre className="overflow-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-[11.5px]">
            {node.preActions.join('\n')}
          </pre>
        </div>
      )}
      {node.transitions.length > 0 && (
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-border">
              {['Target', 'Description', 'Condition'].map((h) => (
                <th
                  key={h}
                  className="py-1 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.transitions.map((edge, i) => (
              <tr key={i} className="border-b border-border/40">
                <td className="py-1 pr-3 font-mono">
                  {edge.target}
                  {edge.implicit && <Badge className="ml-1.5">implicit</Badge>}
                </td>
                <td className="py-1 pr-3">{edge.description ?? '—'}</td>
                <td className="py-1 font-mono text-muted-foreground">{edge.condition ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {node.terminal && (
        <pre className="overflow-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-[11.5px]">
          {node.terminal}
        </pre>
      )}
      {!node.taskMessage &&
        !node.tools.length &&
        !node.preActions.length &&
        !node.transitions.length && <p className="text-muted-foreground">—</p>}
    </div>
  );
}

function NodeRow({
  node,
  initial,
  onSelect,
}: {
  node: GraphNode;
  initial: string | null;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useOpenSet();
  const isOpen = !!open[node.key];
  return (
    <div className="mb-1.5 overflow-hidden rounded-lg border border-border bg-card">
      <button
        onClick={() => {
          setOpen(node.key);
          onSelect(node.key);
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50"
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            isOpen && 'rotate-90',
          )}
        />
        <span
          className={cn(
            'size-2 shrink-0 rounded-sm',
            TYPE_COLOR[node.type] ?? 'bg-muted-foreground',
          )}
        />
        <span className="font-mono text-xs font-medium">{node.key}</span>
        <Badge>{node.type}</Badge>
        {node.key === initial && (
          <Badge variant="outline" className="border-primary/50 text-primary">
            initial
          </Badge>
        )}
        {!node.reachable && (
          <Badge variant="warning" className="border-warning/40 text-warning">
            unreachable
          </Badge>
        )}
        {node.deadEnd && (
          <Badge variant="destructive" className="border-destructive/40 text-destructive">
            dead end
          </Badge>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {node.transitions.length} out · {node.tools.length} tools
        </span>
      </button>
      {isOpen && <NodeDetail node={node} />}
    </div>
  );
}

export function WorkflowTab({
  detail,
  selected,
  onSelect,
}: {
  detail: RunDetail;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const w = detail.workflow!;
  const dead = w.nodes.filter((n) => n.deadEnd).map((n) => n.key);
  const alerts: string[] = [];
  if (w.unreachable.length) {
    alerts.push(
      `No transition path from ${w.initialNode ?? 'initial_node'} reaches: ${w.unreachable.join(', ')}`,
    );
  }
  if (dead.length) alerts.push(`Cannot continue or end the call from: ${dead.join(', ')}`);
  if (w.danglingTargets.length) {
    alerts.push(`Transitions point at unknown nodes: ${w.danglingTargets.join(', ')}`);
  }

  return (
    <div>
      <Section title={`Graph · ${w.source} · ${w.nodes.length} nodes`}>
        <div className="mb-2.5 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
          {Object.entries(TYPE_COLOR).map(([type, cls]) => (
            <span key={type} className="flex items-center gap-1.5">
              <span className={cn('size-2.5 rounded-sm', cls)} />
              {type}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border border-primary" />
            initial
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border border-warning border-dashed" />
            unreachable
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border border-destructive" />
            dead end
          </span>
        </div>
        <WorkflowGraph workflow={w} selected={selected} onSelect={onSelect} />
      </Section>

      {alerts.length > 0 && (
        <Section title="Structural checks">
          {alerts.map((text) => (
            <p
              key={text}
              className="mb-1.5 flex gap-2 border-l-2 border-warning py-0.5 pl-3 text-xs text-muted-foreground"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span>{text}</span>
            </p>
          ))}
          <p className="mt-2 border-l-2 border-border py-0.5 pl-3 text-xs text-muted-foreground">
            Structural observations about the recorded graph, not correctness or benchmark results.
          </p>
        </Section>
      )}

      <Section title="System prompt">
        <pre className="overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[11.5px] whitespace-pre-wrap">
          {w.systemPrompt ?? '—'}
        </pre>
      </Section>

      <Section title="Nodes">
        {w.nodes.map((node) => (
          <NodeRow key={node.key} node={node} initial={w.initialNode} onSelect={onSelect} />
        ))}
      </Section>

      {w.globalNodes.length > 0 && (
        <Section title="Global nodes">
          <table className="w-full text-xs">
            <tbody>
              {w.globalNodes.map((node) => (
                <tr key={node.key} className="border-b border-border/50">
                  <td className="w-48 py-1.5 font-mono">{node.key}</td>
                  <td className="w-32 py-1.5">{node.type}</td>
                  <td className="py-1.5 font-mono text-muted-foreground">
                    {node.transitions.map((e) => e.target).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {detail.workflowJson && <WorkflowJson json={detail.workflowJson} />}

      {(w.contextVariables.length > 0 || w.lifecycleTools.length > 0) && (
        <Section title="Shared state">
          <div className="flex flex-wrap gap-2">
            {w.contextVariables.map((name) => (
              <Badge key={name} className="font-mono">
                {name}
              </Badge>
            ))}
            {w.lifecycleTools.map((name) => (
              <Badge
                key={name}
                variant="outline"
                className="border-primary/40 font-mono text-primary"
              >
                {name}
              </Badge>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export function StagesTab({ detail }: { detail: RunDetail }) {
  const total = detail.stages.reduce((a, s) => a + (s.ms ?? 0), 0);
  return (
    <Section
      title={`Stage timeline · ${ms(total)} total`}
      aside={
        <div className="flex gap-0.5">
          {detail.stages.map((s) => (
            <span
              key={s.name}
              title={`${s.name} · ${ms(s.ms)}`}
              className={cn(
                'h-2 rounded-sm',
                s.status === 'failed' ? 'bg-destructive' : 'bg-success',
              )}
              style={{ width: `${Math.max(6, ((s.ms ?? 0) / Math.max(1, total)) * 240)}px` }}
            />
          ))}
        </div>
      }
    >
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            {['Stage', 'Status', 'Started', 'Duration', 'Share'].map((h) => (
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
          {detail.stages.map((stage) => {
            const share = total ? Math.round(((stage.ms ?? 0) / total) * 100) : 0;
            return (
              <tr key={stage.name} className="border-b border-border/50">
                <td className="py-1.5 pr-3 font-mono">{stage.name}</td>
                <td className="py-1.5 pr-3">
                  <span
                    className={cn(
                      stage.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {stage.status}
                  </span>
                </td>
                <td className="py-1.5 pr-3 font-mono text-muted-foreground">
                  {when(stage.startedAt)}
                </td>
                <td className="py-1.5 pr-3 font-mono">{ms(stage.ms)}</td>
                <td className="py-1.5 font-mono text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    {share}%
                    <span className="inline-block h-1 w-16 overflow-hidden rounded-full bg-muted align-middle">
                      <span
                        className={cn(
                          'block h-full',
                          stage.status === 'failed' ? 'bg-destructive' : 'bg-success',
                        )}
                        style={{ width: `${share}%` }}
                      />
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}
