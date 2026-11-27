import type { ThreadTurn } from "@scuttle/contracts";
import { AnimatePresence, motion } from "motion/react";
import { type RefObject, useEffect, useState } from "react";
import { easeOut } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";

interface ScrollRulerProps {
  readonly turns: ReadonlyArray<ThreadTurn>;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly mountedStart?: number;
  readonly onEnsureTurnVisible?: (turnIndex: number) => void;
}

export function sampleRailTurnIndices(total: number, maxTicks = 36): ReadonlyArray<number> {
  if (total <= 0 || maxTicks <= 0) return [];
  if (total <= maxTicks) {
    return Array.from({ length: total }, (_, i) => i);
  }
  if (maxTicks === 1) return [0];
  const indices: number[] = [];
  for (let i = 0; i < maxTicks; i++) {
    indices.push(Math.round((i * (total - 1)) / (maxTicks - 1)));
  }
  return indices;
}

const previewText = (text: string) => {
  const firstLine = text.trim().split(/\r?\n/)[0] ?? "";
  return firstLine.length > 52 ? `${firstLine.slice(0, 51)}…` : firstLine;
};

const turnLabel = (turn: ThreadTurn) =>
  turn.origin === "system"
    ? previewText(turn.assistantMessage) || "Introduction"
    : previewText(turn.userMessage);

export function ScrollRuler({
  turns,
  scrollRef,
  mountedStart = 0,
  onEnsureTurnVisible,
}: ScrollRulerProps) {
  const [activeId, setActiveId] = useState<string | null>(turns[0]?.id ?? null);
  const [hovered, setHovered] = useState(false);

  const firstId = turns[0]?.id ?? "";
  const lastId = turns[turns.length - 1]?.id ?? "";
  const turnIdsKey = `${turns.length}:${firstId}:${lastId}:${mountedStart}`;

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || turns.length === 0) return;

    const elements = container.querySelectorAll<HTMLElement>("[data-turn-id]");
    if (elements.length === 0) return;

    const orderById = new Map<string, number>();
    elements.forEach((el, index) => {
      const id = el.getAttribute("data-turn-id");
      if (id) orderById.set(id, index);
    });

    const intersecting = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-turn-id");
          if (!id) continue;
          if (entry.isIntersecting) {
            intersecting.add(id);
          } else {
            intersecting.delete(id);
          }
        }

        let topId: string | null = null;
        let topOrder = Number.POSITIVE_INFINITY;
        for (const id of intersecting) {
          const order = orderById.get(id);
          if (order !== undefined && order < topOrder) {
            topOrder = order;
            topId = id;
          }
        }

        if (topId !== null) {
          setActiveId((prev) => (prev === topId ? prev : topId));
        }
      },
      { root: container, threshold: 0 },
    );

    for (const el of elements) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [scrollRef, turnIdsKey]);

  const jumpTo = (turnId: string, turnIndex: number) => {
    const container = scrollRef.current;
    if (!container) return;
    onEnsureTurnVisible?.(turnIndex);
    const selector = `[data-turn-id="${CSS.escape(turnId)}"]`;
    const immediate = container.querySelector<HTMLElement>(selector);
    if (immediate) {
      setActiveId(turnId);
      immediate.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    requestAnimationFrame(() => {
      const delayed = scrollRef.current?.querySelector<HTMLElement>(selector);
      if (!delayed) return;
      setActiveId(turnId);
      delayed.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  if (turns.length === 0) return null;

  const activeIndex = activeId ? turns.findIndex((t) => t.id === activeId) : -1;
  const railIndices = sampleRailTurnIndices(turns.length);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="absolute top-1/2 left-2 z-20 hidden -translate-y-1/2 sm:flex sm:items-center"
    >
      <nav aria-label="Conversation outline" className="flex flex-col gap-2 py-2 pr-2 pl-1">
        {railIndices.map((idx, pos) => {
          const turn = turns[idx];
          if (!turn) return null;
          const nextIdx = railIndices[pos + 1];
          const active =
            activeIndex >= 0
              ? activeIndex >= idx && (nextIdx === undefined || activeIndex < nextIdx)
              : turn.id === activeId;
          const steps = turn.activities.filter((a) => a.kind !== "thinking");
          return (
            <div key={turn.id} className="flex flex-col gap-1.5">
              <button
                type="button"
                aria-label={`Jump to message ${idx + 1}: ${turnLabel(turn)}`}
                aria-current={active ? "location" : undefined}
                onClick={() => jumpTo(turn.id, idx)}
                className="group/tick flex h-2.5 w-5 cursor-pointer items-center outline-none"
              >
                <span
                  className={cn(
                    "block h-[1.5px] rounded-full transition-[width,background-color] duration-150 ease-out",
                    active
                      ? "w-4 bg-fg/80"
                      : "w-2.5 bg-white/22 group-hover/tick:w-3.5 group-hover/tick:bg-white/55",
                  )}
                />
              </button>
              {steps.slice(0, 3).map((step) => (
                <span
                  key={step.id}
                  aria-hidden
                  className={cn(
                    "block h-px w-1.5 rounded-full transition-colors",
                    active ? "bg-white/24" : "bg-white/10",
                  )}
                />
              ))}
            </div>
          );
        })}
      </nav>

      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, x: -4, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: easeOut }}
            className="w-56 rounded-card bg-menu p-1 shadow-menu"
          >
            <div className="max-h-72 overflow-y-auto">
              {turns.map((turn, idx) => {
                const active = turn.id === activeId;
                return (
                  <button
                    key={turn.id}
                    type="button"
                    onClick={() => jumpTo(turn.id, idx)}
                    className={cn(
                      "flex h-7 w-full cursor-pointer items-center gap-2 rounded-chip px-2 text-left text-label transition-colors duration-100",
                      active
                        ? "bg-white/8 text-fg"
                        : "text-fg-muted hover:bg-(--wash) hover:text-fg",
                    )}
                  >
                    <span className="shrink-0 font-mono text-[11px] text-fg-faint tabular-nums">
                      {idx + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{turnLabel(turn)}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
