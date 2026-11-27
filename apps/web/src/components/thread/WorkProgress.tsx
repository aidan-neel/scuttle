import type { ActivityItem, ThreadTurn } from "@scuttle/contracts";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { formatElapsedSeconds } from "@/lib/format.ts";
import { easeOut } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";

const STATUS_LEAD: Record<ThreadTurn["status"], { readonly bare: string; readonly timed: string }> =
  {
    running: { bare: "Working", timed: "Working for" },
    completed: { bare: "Worked", timed: "Worked for" },
    interrupted: { bare: "Stopped", timed: "Stopped after" },
    failed: { bare: "Failed", timed: "Failed after" },
  };

interface Timed {
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
}

const elapsedMs = (item: Timed, live: boolean, nowMs: number): number => {
  if (live) return Math.max(0, nowMs - Date.parse(item.startedAt));
  if (item.durationMs !== undefined) return item.durationMs;
  if (item.completedAt === undefined) return 0;
  return Math.max(0, Date.parse(item.completedAt) - Date.parse(item.startedAt));
};

const formatPhaseText = (bare: string, timed: string, ms: number): string =>
  ms >= 1000 ? `${timed} ${formatElapsedSeconds(ms)}` : bare;

function useLiveNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function Reveal({ id, children }: { readonly id?: string; readonly children: ReactNode }) {
  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: easeOut }}
      className="overflow-hidden"
    >
      {children}
    </motion.div>
  );
}

function ThinkingRow({
  ms,
  live,
  thinkingText,
}: {
  readonly ms: number;
  readonly live: boolean;
  readonly thinkingText: string;
}) {
  const [open, setOpen] = useState(false);
  const canExpand = thinkingText.length > 0;
  const label = live
    ? formatPhaseText("Thinking", "Thinking for", ms)
    : formatPhaseText("Thought", "Thought for", ms);

  return (
    <li>
      <button
        type="button"
        disabled={!canExpand}
        aria-expanded={canExpand ? open : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className="group/step inline-flex max-w-full items-baseline py-0.5 text-left text-[14px] leading-[1.5] tabular-nums enabled:cursor-pointer"
      >
        <span
          className={cn(
            "min-w-0 truncate transition-colors",
            live
              ? "capy-shimmer"
              : "text-fg-muted group-enabled/step:group-hover/step:text-fg-secondary",
          )}
        >
          {label}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && canExpand && (
          <Reveal>
            <p className="mt-1 mb-1.5 border-l border-line/80 pl-3 text-[14px] leading-[1.6] whitespace-pre-wrap break-words text-fg-muted">
              {thinkingText}
            </p>
          </Reveal>
        )}
      </AnimatePresence>
    </li>
  );
}

function TraceStep({
  step,
  live,
  nowMs,
  thinkingText,
}: {
  readonly step: ActivityItem;
  readonly live: boolean;
  readonly nowMs: number;
  readonly thinkingText: string;
}) {
  const [open, setOpen] = useState(false);
  const ms = elapsedMs(step, live, nowMs);

  if (step.kind === "thinking") {
    return <ThinkingRow ms={ms} live={live} thinkingText={thinkingText} />;
  }

  const detail = step.detail?.trim() ?? "";
  const canExpand = detail.length > 0;
  const failed = step.status === "failed" || step.kind === "error";
  const text = live ? step.activeLabel : step.label;
  const label = ms >= 1000 ? `${text} · ${formatElapsedSeconds(ms)}` : text;

  return (
    <li>
      <button
        type="button"
        disabled={!canExpand}
        aria-expanded={canExpand ? open : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className="group/step inline-flex max-w-full items-baseline py-0.5 text-left text-[14px] leading-[1.5] tabular-nums enabled:cursor-pointer"
      >
        <span
          className={cn(
            "min-w-0 truncate transition-colors",
            live
              ? "capy-shimmer"
              : failed
                ? "text-danger/90"
                : "text-fg-muted group-enabled/step:group-hover/step:text-fg-secondary",
          )}
        >
          {label}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && canExpand && (
          <Reveal>
            <pre className="mt-1 mb-1.5 max-h-48 overflow-auto rounded-control bg-chrome/80 px-3 py-2 font-mono text-[12.5px] leading-[1.5] whitespace-pre-wrap break-words text-fg-muted">
              {detail}
            </pre>
          </Reveal>
        )}
      </AnimatePresence>
    </li>
  );
}

export function WorkProgress({ turn }: { readonly turn: ThreadTurn }) {
  const running = turn.status === "running";
  const nowMs = useLiveNow(running);
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const panelId = useId();

  const thinking = turn.thinkingText.trim();
  const hasThinkingActivity = turn.activities.some((activity) => activity.kind === "thinking");
  const showInitialThinking = running && turn.activities.length === 0;
  const showOrphanThinking = !running && !hasThinkingActivity && thinking.length > 0;
  const hasTrace = turn.activities.length > 0 || showInitialThinking || showOrphanThinking;
  const open = userExpanded ?? running;

  const ms = elapsedMs(turn, running, nowMs);
  const lead = STATUS_LEAD[turn.status];
  const summaryText = formatPhaseText(lead.bare, lead.timed, ms);

  return (
    <div className="my-2">
      <div className="flex items-center justify-center">
        <button
          type="button"
          disabled={!hasTrace}
          aria-expanded={hasTrace ? open : undefined}
          aria-controls={hasTrace ? panelId : undefined}
          onClick={() => setUserExpanded(!open)}
          className={cn(
            "inline-flex items-center py-0.5 text-[14px] leading-[1.5] tabular-nums transition-colors",
            turn.status === "failed" ? "text-danger/80" : "text-fg-muted",
            "enabled:cursor-pointer enabled:hover:text-fg-secondary",
          )}
        >
          <span className={running ? "capy-shimmer" : undefined}>{summaryText}</span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && hasTrace && (
          <Reveal id={panelId}>
            <ol className="mt-3 flex flex-col gap-1">
              {showInitialThinking && <ThinkingRow ms={ms} live thinkingText={thinking} />}
              {showOrphanThinking && <ThinkingRow ms={0} live={false} thinkingText={thinking} />}
              {turn.activities.map((step) => (
                <TraceStep
                  key={step.id}
                  step={step}
                  live={running && step.status === "running"}
                  nowMs={nowMs}
                  thinkingText={thinking}
                />
              ))}
            </ol>
          </Reveal>
        )}
      </AnimatePresence>
    </div>
  );
}
