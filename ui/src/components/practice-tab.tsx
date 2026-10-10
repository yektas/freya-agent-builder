import * as React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Fact, ScoreStrip, Section } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import type { Practice } from '@/lib/data';
import { FailureBlock } from '@/components/overview-tab';

export function PracticeTab({ practice }: { practice: Practice }) {
  if (!practice.cases.length) {
    return (
      <Section title="Practice">
        <p className="border-l-2 border-border py-1 pl-3 text-xs text-muted-foreground">
          This run recorded aggregate totals only; no per-case rows were stored.
        </p>
      </Section>
    );
  }
  const failed = practice.cases.filter((c) => !c.pass);
  const passed = practice.cases.filter((c) => c.pass);
  // Failures first: that is what the reader came for.
  const ordered = [...failed, ...passed];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start gap-6">
        <div className="shrink-0">
          <div
            className={cn(
              'font-mono text-[40px] font-semibold leading-none tracking-tighter',
              failed.length ? 'text-warning' : 'text-success',
            )}
          >
            {practice.passed}
            <span className="text-lg font-normal text-muted-foreground">/{practice.total}</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {failed.length ? `${failed.length} failing` : 'all passing'}
          </div>
          <div className="mt-2.5">
            <ScoreStrip total={practice.total} passed={practice.passed} />
          </div>
        </div>
        <div className="grid min-w-[380px] flex-1 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60">
          <Fact label="simulation">{practice.simulationId ?? '—'}</Fact>
          <Fact label="iteration">{practice.iterationId ?? '—'}</Fact>
          <Fact label="passing">
            <span className="text-success">{passed.length}</span>
          </Fact>
          <Fact label="failing">
            <span className="text-destructive">{failed.length}</span>
          </Fact>
        </div>
      </div>

      {failed.length > 0 && (
        <Section title="Failures">
          {failed.map((item) => (
            <FailureBlock key={item.id} item={item} />
          ))}
        </Section>
      )}

      <Section title="All cases">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {['Case', 'Result', 'Level', 'Family', 'Tools called'].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono">{item.id}</TableCell>
                <TableCell className={item.pass ? 'text-success' : 'text-destructive'}>
                  {item.pass ? 'pass' : 'FAIL'}
                </TableCell>
                <TableCell>{item.level ?? '—'}</TableCell>
                <TableCell>{item.family ?? '—'}</TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {item.tools.join(' → ') || '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </div>
  );
}
