import type { ThreadTurn } from "@scuttle/contracts";
import { AnimatePresence, motion } from "motion/react";
import { type RefObject, useEffect, useState } from "react";
import { easeOut } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";

interface ScrollRulerProps {
  readonly turns: ReadonlyArray<ThreadTurn>;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
}

const previewText = (text: string) => {
  const firstLine = text.trim().split(/\r?\n/)[0] ?? "";
  return firstLine.length > 52 ? `${firstLine.slice(0, 51)}…` : firstLine;
};

export function ScrollRuler({ turns, scrollRef }: ScrollRulerProps) {
  const [activeId, setActiveId] = useState<string | null>(turns[0]?.id ?? null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || turns.length === 0) return;

    const updateActive = () => {
      const containerTop = container.getBoundingClientRect().top;
      let current = turns[0]?.id ?? null;
      for (const turn of turns) {
        const el = container.querySelector<HTMLElement>(`[data-turn-id="${turn.id}"]`);
        if (!el) continue;
        const offset = el.getBoundingClientRect().top - containerTop;
        if (offset <= 96) current = turn.id;
      }
      setActiveId(current);
    };

    updateActive();
    container.addEventListener("scroll", updateActive, { passive: true });
    window.addEventListener("resize", updateActive, { passive: true });
    return () => {
      container.removeEventListener("scroll", updateActive);
      window.removeEventListener("resize", updateActive);
    };
  }, [scrollRef, turns]);

  const jumpTo = (turnId: string) => {
    const container = scrollRef.current;
    const el = container?.querySelector<HTMLElement>(`[data-turn-id="${turnId}"]`);
    if (!el) return;
    setActiveId(turnId);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (turns.length === 0) return null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="absolute top-1/2 left-2 z-20 hidden -translate-y-1/2 sm:flex sm:items-center"
    >
      <nav aria-label="Conversation outline" className="flex flex-col gap-2 py-2 pr-2 pl-1">
        {turns.map((turn, idx) => {
          const active = turn.id === activeId;
          const steps = turn.activities.filter((a) => a.kind !== "thinking");
          return (
            <div key={turn.id} className="flex flex-col gap-1.5">
              <button
                type="button"
                aria-label={`Jump to message ${idx + 1}: ${previewText(turn.userMessage)}`}
                aria-current={active ? "location" : undefined}
                onClick={() => jumpTo(turn.id)}
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
                    onClick={() => jumpTo(turn.id)}
                    className={cn(
                      "flex h-7 w-full cursor-pointer items-center gap-2 rounded-chip px-2 text-left text-label transition-colors duration-100",
                      active
                        ? "bg-white/8 text-fg"
                        : "text-fg-muted hover:bg-(--wash) hover:text-fg",
                    )}
                  >
                    <span className="shrink-0 font-mono text-[10px] text-fg-faint tabular-nums">
                      {idx + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{previewText(turn.userMessage)}</span>
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
