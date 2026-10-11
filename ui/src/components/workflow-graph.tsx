import * as React from 'react';
import type { GraphNode, Workflow } from '@/lib/data';
import { cn } from '@/lib/utils';

const TYPE_COLOR: Record<string, string> = {
  conversation: 'var(--primary)',
  api_request: 'var(--warning)',
  code: 'var(--accent)',
  end_call: 'var(--success)',
};

type Placed = GraphNode & { x: number; y: number };

/**
 * Layered left-to-right layout by shortest distance from the initial node.
 * Nodes no path reaches are parked in their own column so they stay visible.
 */
function layout(workflow: Workflow) {
  const byKey = new Map(workflow.nodes.map((n) => [n.key, n]));
  const layer = new Map<string, number>();
  if (workflow.initialNode && byKey.has(workflow.initialNode)) {
    const queue = [workflow.initialNode];
    layer.set(workflow.initialNode, 0);
    while (queue.length) {
      const key = queue.shift()!;
      const node = byKey.get(key)!;
      for (const edge of node.transitions) {
        if (byKey.has(edge.target) && !layer.has(edge.target)) {
          layer.set(edge.target, layer.get(key)! + 1);
          queue.push(edge.target);
        }
      }
    }
  }
  for (const node of workflow.nodes) if (!layer.has(node.key)) layer.set(node.key, 0);

  const columns = new Map<number, GraphNode[]>();
  for (const node of workflow.nodes) {
    const at = layer.get(node.key)!;
    columns.set(at, [...(columns.get(at) ?? []), node]);
  }
  const keys = [...columns.keys()].sort((a, b) => a - b);

  const NW = 190;
  const NH = 58;
  const GX = 78;
  const GY = 24;
  const PAD = 20;
  const placed = new Map<string, Placed>();
  const pos = new Map<string, { x: number; y: number }>();
  keys.forEach((k) => {
    columns.get(k)!.forEach((node, i) => {
      const p = { x: PAD + k * (NW + GX), y: PAD + i * (NH + GY) };
      pos.set(node.key, p);
      placed.set(node.key, { ...node, ...p });
    });
  });

  const width = PAD * 2 + keys.length * NW + Math.max(0, keys.length - 1) * GX;
  const tallest = keys.reduce((m, k) => Math.max(m, columns.get(k)!.length), 1);
  const height = PAD * 2 + tallest * NH + (tallest - 1) * GY;
  return { pos, width, height };
}

export function WorkflowGraph({
  workflow,
  selected,
  onSelect,
}: {
  workflow: Workflow;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const { pos, width, height } = React.useMemo(() => layout(workflow), [workflow]);
  const NW = 190;
  const NH = 58;

  return (
    <div className="overflow-auto rounded-lg border border-border bg-card">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Workflow node graph"
      >
        {workflow.nodes.flatMap((node) =>
          node.transitions.map((edge) => {
            const from = pos.get(node.key);
            const to = pos.get(edge.target);
            if (!from || !to) return null;
            const x1 = from.x + NW;
            const y1 = from.y + NH / 2;
            const x2 = to.x;
            const y2 = to.y + NH / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={`${node.key}->${edge.target}${edge.implicit ? '~' : ''}`}
                d={`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`}
                fill="none"
                strokeWidth={1.2}
                className={cn(edge.implicit ? 'stroke-border' : 'stroke-muted-foreground/40')}
                strokeDasharray={edge.implicit ? '4 3' : undefined}
                markerEnd="url(#arrow)"
              />
            );
          }),
        )}
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 z" className="fill-muted-foreground/50" />
          </marker>
        </defs>
        {workflow.nodes.map((node) => {
          const p = pos.get(node.key)!;
          const active = node.key === selected;
          return (
            <g
              key={node.key}
              onClick={() => onSelect(node.key)}
              className="cursor-pointer"
              opacity={selected && !active ? 0.45 : 1}
            >
              <rect
                x={p.x}
                y={p.y}
                width={NW}
                height={NH}
                rx={7}
                className={cn(
                  'fill-muted transition-[stroke]',
                  node.key === workflow.initialNode && 'stroke-primary',
                  node.deadEnd && 'stroke-destructive',
                  !node.reachable && 'stroke-warning',
                  active && 'stroke-primary',
                  !(
                    node.key === workflow.initialNode ||
                    node.deadEnd ||
                    !node.reachable ||
                    active
                  ) && 'stroke-border',
                )}
                strokeWidth={active || node.key === workflow.initialNode ? 1.5 : 1}
                strokeDasharray={!node.reachable ? '3 3' : undefined}
              />
              <rect
                x={p.x}
                y={p.y}
                width={3}
                height={NH}
                rx={1.5}
                fill={TYPE_COLOR[node.type] ?? 'var(--muted-foreground)'}
              />
              <text x={p.x + 13} y={p.y + 24} className="fill-foreground font-mono text-[11.5px]">
                {node.key.length > 26 ? `${node.key.slice(0, 25)}…` : node.key}
              </text>
              <text
                x={p.x + 13}
                y={p.y + 42}
                className="fill-muted-foreground font-mono text-[9.5px]"
              >
                {`${node.transitions.length} out · ${node.tools.length ? `${node.tools.length} tools` : 'no tools'}`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
