import * as React from 'react';
import { Archive as ArchiveIcon, ArchiveRestore, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ActionResponse = {
  archived?: string;
  archivedId?: string;
  restored?: string;
  error?: string;
};

/**
 * Two-step row action on a run: archive a live run (reversible — it moves to
 * the archive filter, it is not destroyed), or restore an archived one. The
 * first click only arms the button; the second acts, and the armed state
 * expires so a stray later click cannot act. Any refusal surfaces in place,
 * because the common one — a server started without the action enabled —
 * would otherwise look like a dead button.
 */
export function RowAction({
  id,
  archived,
  disabled,
  onArchived,
  onRestored,
}: {
  id: string;
  archived: boolean;
  disabled: boolean;
  onArchived: (id: string, archivedId: string) => void;
  onRestored: (originalId: string) => void;
}) {
  const [state, setState] = React.useState<'idle' | 'armed' | 'pending'>('idle');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (state !== 'armed') return;
    const timer = setTimeout(() => setState('idle'), 8000);
    return () => clearTimeout(timer);
  }, [state]);

  const run = async () => {
    setState('pending');
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(id)}/${archived ? 'restore' : 'archive'}`,
        { method: 'POST' },
      );
      const body = (await response.json().catch(() => ({}))) as ActionResponse;
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`);
        setState('idle');
        return;
      }
      if (archived) {
        onRestored(body.restored ?? id.replace(/^archive~/, ''));
      } else {
        onArchived(id, body.archivedId ?? id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed.');
      setState('idle');
    }
  };

  const press = (event: React.MouseEvent) => {
    // The row around this button opens the run; an action press must not.
    event.stopPropagation();
    setError(null);
    if (state === 'armed') {
      void run();
    } else {
      setState('armed');
    }
  };

  return (
    <span className="relative inline-flex items-center">
      <Button
        variant="ghost"
        size="xs"
        disabled={state === 'pending' || disabled}
        onClick={press}
        aria-label={
          state === 'armed'
            ? archived
              ? `Confirm restoring ${id}`
              : `Confirm archiving ${id}`
            : archived
              ? `Restore run ${id}`
              : `Archive run ${id}`
        }
        title={
          state === 'armed'
            ? archived
              ? 'Click again to move this run back into the list'
              : 'Click again to move this run to the archive (restorable)'
            : archived
              ? 'Restore this archived run to the run list'
              : 'Move this run to the archive (restorable)'
        }
        className={cn(
          state === 'armed' && 'bg-destructive/10 text-destructive hover:bg-destructive/20',
        )}
      >
        {state === 'pending' ? (
          <LoaderCircle className="size-3 animate-spin" />
        ) : archived ? (
          <ArchiveRestore className="size-3" />
        ) : (
          <ArchiveIcon className="size-3" />
        )}
        {state === 'armed' && 'Confirm?'}
        {state === 'pending' && (archived ? 'Restoring…' : 'Archiving…')}
      </Button>
      {error && (
        <span
          className="absolute top-full left-0 z-10 mt-1 w-64 rounded-md border border-destructive/30 bg-background px-2 py-1 text-[11px] leading-snug text-destructive shadow-md"
          role="alert"
        >
          {error}
        </span>
      )}
    </span>
  );
}
