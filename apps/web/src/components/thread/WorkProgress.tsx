import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import type { ActivityItem, ThreadTurn } from "@scuttle/contracts";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Icon } from "@/components/ui/Icon.tsx";
import { SwapText } from "@/components/ui/SwapText.tsx";
import { easeOut } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";
import { RollingTime, SmoothWidth } from "./RollingTime.tsx";

type TracePhase =
  | { readonly kind: "thinking" }
  | { readonly kind: "working"; readonly activeLabel: string }
  | { readonly kind: "done"; readonly steps: number }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed" };

const PHASE_LEAD: Record<TracePhase["kind"], { readonly bare: string; readonly timed: string }> = {
  thinking: { bare: "Thinking", timed: "Thinking for" },
  working: { bare: "Working", timed: "Working for" },
  done: { bare: "Thought", timed: "Thought for" },
  stopped: { bare: "Stopped", timed: "Stopped after" },
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

const tracePhase = (
  status: ThreadTurn["status"],
  steps: ReadonlyArray<ActivityItem>,
): TracePhase => {
  switch (status) {
    case "running": {
      const active = steps.findLast((step) => step.status === "running");
      return active === undefined
        ? { kind: "thinking" }
        : { kind: "working", activeLabel: active.activeLabel };
    }
    case "completed":
      return { kind: "done", steps: steps.length };
    case "interrupted":
      return { kind: "stopped" };
    case "failed":
      return { kind: "failed" };
  }
};

const phaseWhisper = (phase: TracePhase): string | undefined => {
  if (phase.kind === "working") return phase.activeLabel;
  if (phase.kind === "done" && phase.steps > 0) {
    return phase.steps === 1 ? "1 step" : `${phase.steps} steps`;
  }
  return undefined;
};

function useLiveNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
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

function TraceStep({
  step,
  live,
  nowMs,
}: {
  readonly step: ActivityItem;
  readonly live: boolean;
  readonly nowMs: number;
}) {
  const [open, setOpen] = useState(false);
  const detail = step.detail?.trim() ?? "";
  const canExpand = detail.length > 0;
  const ms = elapsedMs(step, live, nowMs);
  const failed = step.status === "failed" || step.kind === "error";

  return (
    <li>
      <button
        type="button"
        disabled={!canExpand}
        aria-expanded={canExpand ? open : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className="group/step inline-flex max-w-full items-baseline gap-2 py-0.5 text-left text-[12.5px] leading-[1.5] enabled:cursor-pointer"
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
          {live ? step.activeLabel : step.label}
        </span>
        {ms >= 1000 && <RollingTime ms={ms} className="shrink-0 text-meta text-fg-faint" />}
      </button>
      <AnimatePresence initial={false}>
        {open && canExpand && (
          <Reveal>
            <pre className="mt-1 mb-1.5 max-h-48 overflow-auto rounded-control bg-chrome/80 px-3 py-2 font-mono text-[11.5px] leading-[1.5] whitespace-pre-wrap break-words text-fg-muted">
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
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const steps = turn.activities.filter((activity) => activity.kind !== "thinking");
  const thinking = turn.thinkingText.trim();
  const expandable = thinking.length > 0 || steps.length > 0;

  const phase = tracePhase(turn.status, steps);
  const ms = elapsedMs(turn, running, nowMs);
  const timed = ms >= 1000;
  const lead = timed ? PHASE_LEAD[phase.kind].timed : PHASE_LEAD[phase.kind].bare;
  const whisper = phaseWhisper(phase);

  return (
    <div className="text-left">
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? panelId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "group/trace inline-flex max-w-full items-center gap-1.5 py-0.5 text-[13px] leading-[1.5] transition-colors",
          phase.kind === "failed" ? "text-danger/80" : "text-fg-muted",
          "enabled:cursor-pointer enabled:hover:text-fg-secondary",
        )}
      >
        <SmoothWidth>
          <SwapText swapKey={lead}>
            <span className={running ? "capy-shimmer" : undefined}>{lead}</span>
          </SwapText>
          {timed && <RollingTime ms={ms} className="ml-[0.3em]" />}
          {whisper !== undefined && (
            <SwapText swapKey={whisper} className="ml-[0.45em] text-fg-faint">
              <span className="max-w-[18rem] truncate">· {whisper}</span>
            </SwapText>
          )}
        </SmoothWidth>
        {expandable && (
          <Icon
            icon={ArrowRight01Icon}
            className={cn(
              "size-3 shrink-0 text-fg-faint transition-transform duration-200 ease-out-quint",
              open && "rotate-90",
            )}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && expandable && (
          <Reveal id={panelId}>
            <div className="mt-1.5 mb-1 ml-[5px] flex flex-col gap-2.5 border-l border-line/80 pl-3.5">
              {thinking.length > 0 && (
                <p className="text-[13px] leading-[1.6] whitespace-pre-wrap break-words text-fg-muted">
                  {thinking}
                </p>
              )}
              {steps.length > 0 && (
                <ol className="flex flex-col gap-0.5">
                  {steps.map((step) => (
                    <TraceStep
                      key={step.id}
                      step={step}
                      live={running && step.status === "running"}
                      nowMs={nowMs}
                    />
                  ))}
                </ol>
              )}
            </div>
          </Reveal>
        )}
      </AnimatePresence>
    </div>
  );
}
