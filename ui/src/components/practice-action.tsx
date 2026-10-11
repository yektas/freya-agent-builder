import * as React from 'react';
import { FlaskConical, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ms } from '@/lib/data';
import type { PracticeJob, RunDetail } from '@/lib/data';

export function PracticeAction({ detail }: { detail: RunDetail }) {
  const [availability, setAvailability] = React.useState<{
    available: boolean;
    problem: string | null;
  } | null>(null);
  const [brief, setBrief] = React.useState<string>(detail.practiceJob?.brief ?? 'A');
  const [style, setStyle] = React.useState(detail.practiceJob?.style ?? '');
  const [repetitions, setRepetitions] = React.useState(detail.practiceJob?.repetitions ?? 1);
  const [pending, setPending] = React.useState(false);
  const [started, setStarted] = React.useState<PracticeJob | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const eligible =
    detail.summary.kind === 'generation-only' && detail.summary.status === 'completed';
  React.useEffect(() => {
    if (!eligible) return;
    let alive = true;
    void fetch('/api/practice')
      .then((response) => response.json())
      .then((data) => {
        if (alive) setAvailability(data);
      })
      .catch(() => {
        if (alive) setAvailability({ available: false, problem: 'Inspector unreachable.' });
      });
    return () => {
      alive = false;
    };
  }, [eligible]);
  if (!eligible || detail.summary.archived) return null;
  // The POST response covers the interval before polling discovers the job.
  const job =
    started &&
    (!detail.practiceJob ||
      Date.parse(started.startedAt) > Date.parse(detail.practiceJob.startedAt))
      ? started
      : detail.practiceJob;
  const running = pending || job?.status === 'running';
  const uploaded = detail.upload?.status === 'registered';
  const start = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(detail.summary.id)}/practice`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief, style: style || null, repetitions }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setStarted(data.practiceJob);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Testing could not be started.');
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="my-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Choice
          label="Cases"
          value={brief}
          onChange={setBrief}
          disabled={running}
          items={[
            ['A', 'Brief A'],
            ['B', 'Brief B'],
            ['all', 'A + B'],
          ]}
        />
        <Choice
          label="Speech"
          value={style}
          onChange={setStyle}
          disabled={running}
          items={[
            ['', 'Normal'],
            ...['pieces', 'corrects', 'talkative', 'asks_back', 'in_words'].map(
              (item): [string, string] => [item, item.replaceAll('_', ' ')],
            ),
          ]}
        />
        <Choice
          label="Repetitions"
          value={String(repetitions)}
          onChange={(value) => setRepetitions(Number(value))}
          disabled={running}
          items={[
            ['1', '1'],
            ['3', '3 (all must pass)'],
          ]}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={start}
          disabled={running || !uploaded || !availability?.available}
        >
          {running ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <FlaskConical className="size-3.5" />
          )}
          {running ? 'Testing & scoring…' : 'Test & score'}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {!uploaded ? 'Upload this generation first. ' : ''}
        Remote simulations · about 3–11 min per repetition · 25-minute deadline · no new builder
        model call.
      </p>
      {availability?.problem && <p className="text-xs text-warning">{availability.problem}</p>}
      {job && (
        <p className="text-xs text-muted-foreground" role="status">
          {job.status === 'running'
            ? `Running: ${job.stage}. Results update automatically.`
            : job.status === 'completed'
              ? detail.summary.evaluation.score === null
                ? 'Previous test results no longer apply to this upload. Test it again.'
                : `${job.passed}/${job.total} passed · ${ms(job.elapsedMs)} · ${job.brief === 'all' ? 'A+B' : job.brief} public practice (${job.repetitions} repetition${job.repetitions === 1 ? '' : 's'}, ${job.style ?? 'normal'} speech). See the Practice tab.`
              : `Test failed: ${job.error}`}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Choice({
  label,
  value,
  onChange,
  disabled,
  items,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  items: [string, string][];
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span>{label}</span>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
        disabled={disabled}
        items={items.map(([value, label]) => ({ value, label }))}
      >
        <SelectTrigger size="sm" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
