import type { ActivityItem, ThreadTurn } from "@scuttle/contracts";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { formatElapsedSeconds } from "@/lib/format.ts";
import { easeOut } from "@/lib/motion.ts";

interface WorkProgressProps {
  readonly turn: ThreadTurn;
}

function useLiveNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function ActivityStepRow({
  activity,
  thinkingText,
  nowMs,
}: {
  readonly activity: ActivityItem;
  readonly thinkingText: string;
  readonly nowMs: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const running = activity.status === "running";
  const elapsedMs =
    activity.durationMs !== undefined
      ? activity.durationMs
      : Math.max(0, nowMs - Date.parse(activity.startedAt));
  const showSeconds = elapsedMs >= 1000;
  const elapsedLabel = showSeconds ? formatElapsedSeconds(elapsedMs) : "";

  const isThinking = activity.kind === "thinking";
  const detailText = isThinking ? thinkingText.trim() : activity.detail?.trim();
  const canExpand = Boolean(detailText && detailText.length > 0);

  const primaryText = isThinking
    ? running
      ? showSeconds
        ? `Thinking for ${elapsedLabel}`
        : "Thinking"
      : showSeconds
        ? `Thought for ${elapsedLabel}`
        : "Thought"
    : running
      ? activity.activeLabel
      : activity.label;

  return (
    <div className="text-left">
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => canExpand && setExpanded((prev) => !prev)}
        className={`group/step inline-flex max-w-full items-baseline gap-2 py-0.5 text-left text-[13px] leading-[1.5] ${
          canExpand ? "cursor-pointer hover:text-fg" : "cursor-default"
        }`}
      >
        <span
          className={
            running
              ? "capy-shimmer font-normal"
              : activity.status === "failed"
                ? "text-danger/90"
                : "text-fg-muted group-hover/step:text-fg-secondary"
          }
        >
          {primaryText}
        </span>
        {!isThinking && showSeconds && (
          <span className="shrink-0 text-meta text-fg-faint tabular-nums">{elapsedLabel}</span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {expanded && detailText && (
          <motion.pre
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16, ease: easeOut }}
            className="mt-1 mb-2 max-h-48 overflow-auto rounded-control bg-chrome/80 px-3 py-2 font-mono text-[11.5px] leading-[1.5] text-fg-muted shadow-raised whitespace-pre-wrap break-words"
          >
            {detailText}
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
}

export function WorkProgress({ turn }: WorkProgressProps) {
  const isRunning = turn.status === "running";
  const nowMs = useLiveNow(isRunning);
  const [manualOpen, setManualOpen] = useState(false);

  const totalMs =
    turn.durationMs !== undefined
      ? turn.durationMs
      : Math.max(0, nowMs - Date.parse(turn.startedAt));
  const hasElapsed = totalMs >= 1000;
  const elapsedText = formatElapsedSeconds(totalMs);

  const hasSteps = turn.activities.length > 0 || turn.thinkingText.trim().length > 0;
  const showSteps = isRunning || manualOpen;

  const headerLabel = isRunning
    ? hasElapsed
      ? `Working for ${elapsedText}`
      : "Working"
    : turn.status === "interrupted"
      ? `Interrupted after ${elapsedText}`
      : turn.status === "failed"
        ? `Failed after ${elapsedText}`
        : `Worked for ${elapsedText}`;

  return (
    <div className="my-4">
      <div className="flex items-center justify-center gap-3">
        {!isRunning && <span aria-hidden className="h-px flex-1 bg-line/70" />}
        <button
          type="button"
          disabled={isRunning || !hasSteps}
          onClick={() => setManualOpen((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 text-[12.5px] tabular-nums transition-colors ${
            isRunning
              ? "capy-shimmer cursor-default"
              : hasSteps
                ? "cursor-pointer text-fg-faint hover:text-fg-muted"
                : "cursor-default text-fg-faint"
          }`}
        >
          {headerLabel}
        </button>
        {!isRunning && <span aria-hidden className="h-px flex-1 bg-line/70" />}
      </div>

      <AnimatePresence initial={false}>
        {showSteps && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: easeOut }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 flex flex-col gap-0.5 pl-0.5">
              {turn.activities.length === 0 && isRunning && (
                <div className="py-0.5 text-[13px] leading-[1.5]">
                  <span className="capy-shimmer">
                    {hasElapsed ? `Thinking for ${elapsedText}` : "Thinking"}
                  </span>
                </div>
              )}
              {turn.activities.map((activity) => (
                <ActivityStepRow
                  key={activity.id}
                  activity={activity}
                  thinkingText={turn.thinkingText}
                  nowMs={nowMs}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
