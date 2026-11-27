import { Popover } from "@base-ui/react/popover";
import { Delete02Icon, StarIcon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { ModelPerfRun, PerfOutcome, PerfRework, RateModelRunInput } from "@scuttle/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { DialogAlert } from "@/components/ui/DialogShell.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { formatElapsedSeconds, formatRelativeAge } from "@/lib/format.ts";
import { cn } from "@/lib/utils";
import { formatUsd } from "./usage/usageFormat.ts";

export const OUTCOME_TONE: Record<PerfOutcome, string> = {
  pass: "bg-success",
  partial: "bg-warning",
  fail: "bg-danger",
};

const OUTCOME_TEXT: Record<PerfOutcome, string> = {
  pass: "text-success",
  partial: "text-warning",
  fail: "text-danger",
};

const OUTCOMES: ReadonlyArray<PerfOutcome> = ["pass", "partial", "fail"];
const REWORKS: ReadonlyArray<PerfRework> = ["none", "minor", "major"];

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<T>;
  readonly onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-control bg-fg/5 p-0.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          onClick={() => onChange(option)}
          className={cn(
            "h-6 flex-1 cursor-pointer rounded-[5px] text-meta capitalize outline-none transition-colors duration-(--dur-hover) focus-visible:shadow-focus",
            option === value
              ? "bg-selected font-medium text-fg shadow-raised"
              : "text-fg-muted hover:text-fg",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function RateForm({
  run,
  defaultCategory,
  onSubmit,
}: {
  readonly run: ModelPerfRun;
  readonly defaultCategory: string;
  readonly onSubmit: (input: RateModelRunInput) => Promise<void>;
}) {
  const [score, setScore] = useState(run.score ?? 7);
  const [outcome, setOutcome] = useState<PerfOutcome>(run.outcome ?? "pass");
  const [rework, setRework] = useState<PerfRework>(run.rework ?? "none");
  const [category, setCategory] = useState(run.category ?? defaultCategory);
  const [notes, setNotes] = useState(run.notes ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedCategory = category.trim();

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        runId: run.id,
        category: trimmedCategory,
        score,
        outcome,
        rework,
        ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
      });
    } catch (err) {
      setError(describeApiError(err, "Could not save the rating."));
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmedCategory.length > 0) void save();
      }}
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between text-meta text-fg-muted">
          Score
          <span className="font-mono text-label text-fg tabular-nums">{score.toFixed(1)}/10</span>
        </span>
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={score}
          onChange={(event) => setScore(Number(event.target.value))}
          className="accent-(--color-primary)"
        />
      </label>
      <Segmented label="Outcome" value={outcome} options={OUTCOMES} onChange={setOutcome} />
      <Segmented label="Rework" value={rework} options={REWORKS} onChange={setRework} />
      <input
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        placeholder="Category, e.g. frontend"
        aria-label="Category"
        className="h-7 rounded-control bg-fg/5 px-2 text-label text-fg outline-none placeholder:text-fg-faint focus-visible:shadow-focus"
      />
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Notes (optional)"
        aria-label="Notes"
        rows={2}
        className="resize-none rounded-control bg-fg/5 px-2 py-1.5 text-label text-fg outline-none placeholder:text-fg-faint focus-visible:shadow-focus"
      />
      {error !== null && <DialogAlert message={error} />}
      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={pending || trimmedCategory.length === 0}
      >
        Save rating
      </Button>
    </form>
  );
}

export function PerformanceRunRow({
  run,
  defaultCategory,
  onRate,
  onDelete,
}: {
  readonly run: ModelPerfRun;
  readonly defaultCategory: string;
  readonly onRate: (input: RateModelRunInput) => Promise<void>;
  readonly onDelete: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rated = run.score !== undefined && run.outcome !== undefined;
  return (
    <div className="group flex items-center gap-3 px-4 py-2.5">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          run.outcome ? OUTCOME_TONE[run.outcome] : "bg-fg-faint/60",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-label font-medium text-fg">{run.model}</span>
          {run.category && (
            <span className="shrink-0 rounded-chip bg-fg/6 px-1.5 text-meta text-fg-muted">
              {run.category}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-meta text-fg-muted tabular-nums">
          {formatElapsedSeconds(run.durationMs)} · {run.tokensPerSecond.toFixed(1)} tok/s ·{" "}
          {formatUsd(run.costUsd)} · {formatRelativeAge(run.createdAt)}
        </p>
      </div>
      {rated && run.outcome && (
        <span className="shrink-0 text-right font-mono text-meta tabular-nums">
          <span className="text-fg">{run.score?.toFixed(1)}</span>
          <span className={cn("ml-1.5 capitalize", OUTCOME_TEXT[run.outcome])}>{run.outcome}</span>
        </span>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          render={
            <Button
              type="button"
              variant={rated ? "ghost" : "outline"}
              size="sm"
              className="shrink-0 active:scale-[0.97]"
            />
          }
        >
          <Icon icon={StarIcon} />
          {rated ? "Re-rate" : "Rate run"}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
            <Popover.Popup className="w-[min(17rem,calc(100vw-1.5rem))] origin-(--transform-origin) rounded-card bg-menu p-3 shadow-menu outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-97 data-starting-style:opacity-0">
              <Popover.Title className="pb-2 text-label font-medium text-fg">
                Rate {run.model}
              </Popover.Title>
              <RateForm
                run={run}
                defaultCategory={defaultCategory}
                onSubmit={async (input) => {
                  await onRate(input);
                  setOpen(false);
                }}
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete run for ${run.model}`}
        title="Delete run"
        onClick={() => onDelete(run.id)}
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-danger [@media(hover:none)]:opacity-100"
      >
        <Icon icon={Delete02Icon} />
      </Button>
    </div>
  );
}
