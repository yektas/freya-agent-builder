import * as React from 'react';
import { cn } from '@/lib/utils';

type PollerProps = {
  /** Milliseconds between polls. */
  interval: number;
  fetcher: () => Promise<unknown>;
  onData: (data: never) => void;
  /** Skip fetching without unmounting, e.g. while another request is in flight. */
  enabled?: boolean;
};

/**
 * Polls on an interval, ignoring responses that arrive out of order and
 * ignoring results that arrive after unmount.
 */
export function usePoller<T>({
  interval,
  fetcher,
  onData,
  enabled = true,
}: {
  interval: number;
  fetcher: () => Promise<T>;
  onData: (data: T) => void;
  enabled?: boolean;
}) {
  const saved = React.useRef({ fetcher, onData });
  saved.current = { fetcher, onData };
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const data = await saved.current.fetcher();
        if (alive) saved.current.onData(data);
      } catch {
        // A failed poll is transient; the next tick retries.
      } finally {
        busy = false;
      }
    };
    void run();
    const timer = setInterval(run, interval);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [interval, enabled]);
}

/** Re-render on an interval so relative timestamps and live elapsed stay true. */
export function useTick(ms_: number, active = true) {
  const [, set] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => set((n) => n + 1), ms_);
    return () => clearInterval(timer);
  }, [ms_, active]);
}

/** Collapse that remembers which keys are open across re-renders. */
export function useOpenSet() {
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const toggle = React.useCallback((key: string) => {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  return [open, toggle] as const;
}

export function Row({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-2', className)} {...props} />;
}

/** Label/value pair used across the fact strips. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-xs break-words">{children}</div>
    </div>
  );
}

export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
        {aside}
        <span className="h-px flex-1 bg-border/60" />
      </h3>
      {children}
    </section>
  );
}

export function StatusDot({ status }: { status: string }) {
  const tone =
    status === 'completed' || status === 'built'
      ? 'bg-success'
      : status === 'failed'
        ? 'bg-destructive'
        : 'bg-warning';
  return <span className={cn('size-1.5 shrink-0 rounded-full', tone)} />;
}

/** Per-case pass/fail strip; reads faster than any number. */
export function ScoreStrip({ total, passed }: { total: number; passed: number }) {
  if (total <= 60) {
    return (
      <div className="flex gap-0.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn('size-2 rounded-[2px]', i < passed ? 'bg-success' : 'bg-destructive')}
          />
        ))}
      </div>
    );
  }
  const pct = total ? Math.round((passed / total) * 100) : 0;
  return (
    <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted">
      <div className="h-full bg-success" style={{ width: `${pct}%` }} />
    </div>
  );
}
