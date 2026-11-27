import type { ActivityItem, ThreadTurn } from "@scuttle/contracts";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { formatElapsedSeconds } from "@/lib/format.ts";
import { easeOut } from "@/lib/motion.ts";
import { isSoftwareRenderer } from "@/lib/renderMode.ts";
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

export interface ElapsedToken {
  readonly key: string;
  readonly char: string;
  readonly isDigit: boolean;
}

export const formatElapsedTokens = (ms: number): ReadonlyArray<ElapsedToken> => {
  const secs = Math.max(0, Math.floor(ms / 1000));
  const pushDigits = (tokens: ElapsedToken[], prefix: string, value: number) => {
    const str = String(value);
    for (let i = 0; i < str.length; i += 1) {
      tokens.push({ key: `${prefix}-${str.length - 1 - i}`, char: str[i]!, isDigit: true });
    }
  };

  const tokens: ElapsedToken[] = [];
  if (secs < 60) {
    pushDigits(tokens, "s", secs);
    tokens.push({ key: "u-s", char: "s", isDigit: false });
    return tokens;
  }

  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  pushDigits(tokens, "m", mins);
  tokens.push({ key: "u-m", char: "m", isDigit: false });
  if (rem > 0) {
    tokens.push({ key: "sp", char: " ", isDigit: false });
    pushDigits(tokens, "s", rem);
    tokens.push({ key: "u-s", char: "s", isDigit: false });
  }
  return tokens;
};

export const isTurnWorking = (turn: ThreadTurn): boolean => {
  if (turn.status !== "running") return false;
  if (turn.activities.some((activity) => activity.status === "running")) return true;
  return turn.assistantMessage.trim().length === 0;
};

const latestActivityEndMs = (activities: ReadonlyArray<ActivityItem>): number | null => {
  let latest: number | null = null;
  for (const activity of activities) {
    if (!activity.completedAt) continue;
    const ts = Date.parse(activity.completedAt);
    if (Number.isFinite(ts) && (latest === null || ts > latest)) latest = ts;
  }
  return latest;
};

const elapsedMs = (item: Timed, live: boolean, nowMs: number): number => {
  if (live) return Math.max(0, nowMs - Date.parse(item.startedAt));
  if (item.durationMs !== undefined) return item.durationMs;
  if (item.completedAt === undefined) return 0;
  return Math.max(0, Date.parse(item.completedAt) - Date.parse(item.startedAt));
};

const formatPhaseText = (bare: string, timed: string, ms: number): string =>
  ms >= 1000 ? `${timed} ${formatElapsedSeconds(ms)}` : bare;

function useLiveNow(active: boolean, startedAt: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const origin = Date.parse(startedAt);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const current = Date.now();
      setNow(current);
      const elapsed = Number.isFinite(origin) ? Math.max(0, current - origin) : 0;
      const delay = 1000 - (elapsed % 1000) + 16;
      timer = setTimeout(schedule, delay);
    };
    schedule();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [active, startedAt]);
  return now;
}

const DIGIT_TICK_TRANSITION = { duration: 0.22, ease: easeOut } as const;

function TickingSummary({
  bare,
  timed,
  ms,
  live,
}: {
  readonly bare: string;
  readonly timed: string;
  readonly ms: number;
  readonly live: boolean;
}) {
  const reducedMotion = useReducedMotion() === true;
  const summaryText = formatPhaseText(bare, timed, ms);
  const shimmerClass = live ? "work-shimmer" : undefined;

  if (!live || reducedMotion || isSoftwareRenderer()) {
    return <span className={shimmerClass}>{summaryText}</span>;
  }

  const tokens = ms >= 1000 ? formatElapsedTokens(ms) : null;

  return (
    <>
      <span className="sr-only">{summaryText}</span>
      <span aria-hidden className={cn("inline-flex items-center leading-[1.2]", shimmerClass)}>
        {tokens === null ? (
          <span>{bare}</span>
        ) : (
          <>
            <span>{timed}&nbsp;</span>
            {tokens.map((token) =>
              token.isDigit ? (
                <span
                  key={token.key}
                  className="relative inline-grid overflow-hidden leading-[1.2]"
                >
                  <span className="invisible col-start-1 row-start-1">{token.char}</span>
                  <AnimatePresence initial={false}>
                    <motion.span
                      key={token.char}
                      initial={{ y: "85%", opacity: 0 }}
                      animate={{ y: "0%", opacity: 1 }}
                      exit={{ y: "-85%", opacity: 0 }}
                      transition={DIGIT_TICK_TRANSITION}
                      className="col-start-1 row-start-1"
                    >
                      {token.char}
                    </motion.span>
                  </AnimatePresence>
                </span>
              ) : (
                <span key={token.key}>{token.char === " " ? "\u00A0" : token.char}</span>
              ),
            )}
          </>
        )}
      </span>
    </>
  );
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
  const ms = elapsedMs(step, live, nowMs);
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
        className="group/step inline-flex max-w-full items-baseline py-0.5 text-left text-[0.875rem] leading-[1.5] tabular-nums enabled:cursor-pointer"
      >
        <span
          className={cn(
            "min-w-0 truncate transition-colors",
            live
              ? "work-shimmer"
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
            <pre className="mt-1 mb-1.5 max-h-48 overflow-auto rounded-control bg-chrome/80 px-3 py-2 font-mono text-[0.78125rem] leading-[1.5] whitespace-pre-wrap break-words text-fg-muted">
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
  const working = isTurnWorking(turn);
  const nowMs = useLiveNow(working, turn.startedAt);
  const [open, setOpen] = useState(false);
  const [wasWorking, setWasWorking] = useState(working);
  const [settledWorkMs, setSettledWorkMs] = useState<number | null>(null);
  const panelId = useId();

  if (working !== wasWorking) {
    setWasWorking(working);
    if (!working && running) {
      setSettledWorkMs(Math.max(0, Date.now() - Date.parse(turn.startedAt)));
    } else if (working) {
      setSettledWorkMs(null);
    }
  }

  const thinking = turn.thinkingText.trim();
  const toolActivities = turn.activities.filter((activity) => activity.kind !== "thinking");
  const hasTrace = toolActivities.length > 0 || thinking.length > 0;
  const showThinking = thinking.length > 0;

  const displayStatus: ThreadTurn["status"] = running && !working ? "completed" : turn.status;
  const ms = (() => {
    if (working) return elapsedMs(turn, true, nowMs);
    if (displayStatus === "completed" && settledWorkMs !== null) return settledWorkMs;
    if (running) {
      const endMs = latestActivityEndMs(turn.activities);
      return endMs !== null ? Math.max(0, endMs - Date.parse(turn.startedAt)) : 0;
    }
    return elapsedMs(turn, false, nowMs);
  })();
  const lead = STATUS_LEAD[displayStatus];

  return (
    <div>
      <div className="flex items-center justify-center">
        <button
          type="button"
          disabled={!hasTrace}
          aria-expanded={hasTrace ? open : undefined}
          aria-controls={hasTrace ? panelId : undefined}
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            "inline-flex items-center py-0.5 text-[0.875rem] leading-[1.5] font-medium tabular-nums transition-colors",
            displayStatus === "failed" ? "text-danger/80" : "text-fg-muted",
            "enabled:cursor-pointer enabled:hover:text-fg-secondary",
          )}
        >
          <TickingSummary bare={lead.bare} timed={lead.timed} ms={ms} live={working} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && hasTrace && (
          <Reveal id={panelId}>
            <div className="mt-3 space-y-2">
              {showThinking && (
                <p className="border-l border-line/80 pl-3 text-[0.875rem] leading-[1.6] whitespace-pre-wrap break-words text-fg-muted">
                  {thinking}
                </p>
              )}
              {toolActivities.length > 0 && (
                <ol className="flex flex-col gap-1">
                  {toolActivities.map((step) => (
                    <TraceStep
                      key={step.id}
                      step={step}
                      live={working && step.status === "running"}
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
