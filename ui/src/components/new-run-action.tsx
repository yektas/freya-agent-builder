import * as React from 'react';
import { LoaderCircle, Play, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { GenerationAvailability, StartedRun } from '@/lib/data';
import { cn } from '@/lib/utils';

/** The escape hatch: any model id the provider accepts, listed or not. */
const CUSTOM = '__custom__';

/**
 * New run starts one generation with the choices made here. It only sends those
 * model and reasoning choices; credentials, paths, and the event package stay in the server
 * process, and the reply is a run id to navigate to rather than a workflow.
 */
export function NewRunAction({
  onStarted,
  trigger,
}: {
  onStarted: (run: StartedRun) => void;
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<GenerationAvailability | null>(null);
  const [model, setModel] = React.useState('');
  const [effort, setEffort] = React.useState<string>('provider');
  const [custom, setCustom] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Availability is server state: it knows whether a credential exists and which
  // event package is present, and it answers with a reason rather than a secret.
  const load = React.useCallback(async () => {
    try {
      const response = await fetch('/api/generate');
      const data = (await response.json()) as GenerationAvailability;
      setOptions(data);
    } catch {
      setOptions({
        available: false,
        problem: 'Inspector unreachable.',
        providers: [],
        models: { openai: [], codex: [] },
        reasoningEfforts: [],
        timeoutMs: 0,
        running: null,
      });
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [open, load]);

  const models = options?.models.openai ?? [];
  const selected = model === CUSTOM || models.includes(model) ? model : '';
  const providerState = options?.providers.find((item) => item.id === 'openai');
  const running = options?.running ?? null;
  const efforts = (options?.reasoningEfforts ?? []).filter((value) => value !== 'ultra');

  // Use the first offered model when no model has been selected.
  React.useEffect(() => {
    if (!options) return;
    if (selected === CUSTOM || options.models.openai.includes(selected)) return;
    const first = options.models.openai[0] ?? '';
    setModel(first);
    setCustom('');
  }, [options, selected]);

  const modelName = selected === CUSTOM ? custom.trim() : selected;
  const blocked =
    !options?.available || !providerState?.available || !!running || !modelName || pending;

  const start = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          model: modelName,
          // 'provider' means the provider's own default, which is what the CLI
          // does when no effort is given.
          ...(effort !== 'provider' ? { reasoningEffort: effort } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        run?: StartedRun;
        error?: string;
      };
      if (body.run) {
        setOpen(false);
        onStarted(body.run);
        return;
      }
      setError(body.error ?? `HTTP ${response.status}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Generation request failed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          trigger ?? (
            <Button variant="outline" size="sm">
              <Play className="size-3.5" />
              New run
            </Button>
          )
        }
      />
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New run</SheetTitle>
          <SheetDescription>
            One direct-generation call: the model writes a workflow blueprint, it is compiled
            locally against the original tool schemas, and the run stops there. Registering it on
            Freya stays a separate action on the finished run.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model">Model</Label>
            {selected === CUSTOM ? (
              <Input
                id="model"
                value={custom}
                autoFocus
                placeholder="gpt-6-luna"
                onChange={(event) => setCustom(event.target.value)}
              />
            ) : (
              <Select value={selected || null} onValueChange={(value) => value && setModel(value)}>
                <SelectTrigger id="model" className="w-full">
                  <SelectValue placeholder="Choose a model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {models.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectItem value={CUSTOM}>Custom model…</SelectItem>
                </SelectContent>
              </Select>
            )}
            {selected === CUSTOM && models.length > 0 && (
              <button
                type="button"
                className="self-start text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  setModel(models[0]);
                  setCustom('');
                }}
              >
                Back to the offered models
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="effort">Reasoning effort</Label>
            <Select value={effort} onValueChange={(value) => value && setEffort(value)}>
              <SelectTrigger id="effort" className="w-full">
                <SelectValue>{effort === 'provider' ? 'Provider default' : effort}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="provider">Provider default</SelectItem>
                  {efforts.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {options?.timeoutMs ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              Deadline {Math.round(options.timeoutMs / 1000)}s · one model call
            </p>
          ) : null}

          {running && (
            <p className="border-l-2 border-warning py-0.5 pl-3 text-[11px] leading-relaxed text-muted-foreground">
              <Terminal className="mr-1 inline size-3 align-[-2px]" />
              {running.runId} is still running ({running.provider} / {running.model}). Wait for it
              to finish before starting another.
            </p>
          )}
          {!options?.available && options?.problem && (
            <p className="border-l-2 border-warning py-0.5 pl-3 text-[11px] leading-relaxed text-muted-foreground">
              {options.problem}
            </p>
          )}
          {providerState && !providerState.available && (
            <p className="border-l-2 border-warning py-0.5 pl-3 text-[11px] leading-relaxed text-muted-foreground">
              {providerState.problem}
            </p>
          )}
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-destructive/90">
              {error}
            </p>
          )}
        </div>

        <SheetFooter>
          <Button className={cn('w-full')} disabled={blocked} onClick={() => void start()}>
            {pending ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Starting…
              </>
            ) : (
              <>
                <Play className="size-4" />
                Generate
              </>
            )}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            One model call, recorded like any CLI run. Credentials stay in the server process.
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
