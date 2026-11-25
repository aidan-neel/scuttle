import type { EffortLevel } from "@scuttle/contracts";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { ditherMaskStyle } from "@/lib/dither";
import { EFFORT_LABELS } from "@/lib/format.ts";
import { easeOut, spring } from "@/lib/motion.ts";

interface ReasoningSliderProps {
  readonly efforts: ReadonlyArray<EffortLevel>;
  readonly value: EffortLevel;
  readonly onChange: (effort: EffortLevel) => void;
}

const SHORT_LABELS: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

const DITHER_OVERLAY = ditherMaskStyle(0.72, { matrix: "bayer4", cell: 2 });

export function ReasoningSlider({ efforts, value, onChange }: ReasoningSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const count = efforts.length;
  const activeIndex = Math.max(0, efforts.indexOf(value));
  const fillPct = count <= 1 ? 100 : ((activeIndex + 1) / count) * 100;

  const indexFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || count <= 1) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(count - 1, Math.floor(ratio * count));
  };

  const commitAtClientX = (clientX: number) => {
    const idx = indexFromClientX(clientX);
    const next = efforts[idx];
    if (next && next !== value) {
      onChange(next);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    commitAtClientX(event.clientX);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    commitAtClientX(event.clientX);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count <= 1) return;
    let nextIdx = activeIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextIdx = Math.min(count - 1, activeIndex + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextIdx = Math.max(0, activeIndex - 1);
    } else if (event.key === "Home") {
      nextIdx = 0;
    } else if (event.key === "End") {
      nextIdx = count - 1;
    } else {
      return;
    }
    event.preventDefault();
    const next = efforts[nextIdx];
    if (next && next !== value) onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-meta font-medium text-fg-muted">Reasoning</span>
        <span className="relative h-4 overflow-hidden text-right text-meta font-medium text-fg">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={value}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12, ease: easeOut }}
              className="inline-block"
            >
              {EFFORT_LABELS[value]}
            </motion.span>
          </AnimatePresence>
        </span>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Reasoning effort"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, count - 1)}
        aria-valuenow={activeIndex}
        aria-valuetext={EFFORT_LABELS[value]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="group/slider relative h-7 w-full cursor-pointer touch-none overflow-visible outline-none select-none"
      >
        <div className="pointer-events-none absolute inset-x-0 top-1 h-5 overflow-hidden rounded-[7px] bg-[#0d0d10] shadow-[inset_0_0_0_1px_rgb(255_255_255/10%),inset_0_1px_2px_rgb(0_0_0/55%)] group-focus-visible/slider:shadow-focus">
          <div aria-hidden className="absolute inset-0 flex items-center justify-evenly px-2">
            {efforts.map((effort, idx) => (
              <span
                key={effort}
                className={`h-1.5 w-px rounded-full transition-opacity duration-150 ${
                  idx <= activeIndex ? "bg-white/25" : "bg-white/10"
                }`}
              />
            ))}
          </div>

          <div aria-hidden className="absolute inset-[2px]">
            <motion.div
              initial={false}
              animate={{ width: `${fillPct}%` }}
              transition={spring.snappy}
              className="absolute inset-y-0 left-0 overflow-hidden rounded-[5px]"
            >
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(90deg, rgb(42 84 196 / 26%) 0%, rgb(68 124 255 / 54%) 100%)",
                }}
              />
              <div
                className="absolute inset-0"
                style={{
                  ...DITHER_OVERLAY,
                  background:
                    "linear-gradient(90deg, rgb(84 138 255 / 55%) 0%, rgb(156 196 255 / 95%) 100%)",
                }}
              />
            </motion.div>
          </div>
        </div>

        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-[3px] left-px">
          <motion.div
            initial={false}
            animate={{ left: `${fillPct}%`, scale: dragging ? 1.08 : 1 }}
            transition={spring.snappy}
            className="absolute inset-y-0 -ml-2.5 flex h-7 w-2.5 items-center justify-center gap-px rounded-[4px] bg-[linear-gradient(180deg,#ffffff_0%,#e4e7ee_100%)] shadow-[0_0_0_0.5px_rgb(0_0_0/55%),0_1px_2px_rgb(0_0_0/70%),0_3px_8px_rgb(0_0_0/45%),0_0_10px_rgb(126_166_255/35%),inset_0_1px_0_rgb(255_255_255),inset_0_-1px_0_rgb(0_0_0/12%)] transition-shadow duration-150 group-hover/slider:shadow-[0_0_0_0.5px_rgb(0_0_0/55%),0_1px_2px_rgb(0_0_0/70%),0_3px_8px_rgb(0_0_0/45%),0_0_14px_rgb(126_166_255/55%),inset_0_1px_0_rgb(255_255_255),inset_0_-1px_0_rgb(0_0_0/12%)]"
          >
            <span className="h-3 w-px rounded-full bg-black/20" />
            <span className="h-3 w-px rounded-full bg-black/20" />
          </motion.div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-1">
        {efforts.map((effort, idx) => {
          const active = idx === activeIndex;
          return (
            <button
              key={effort}
              type="button"
              onClick={() => onChange(effort)}
              className={`flex-1 cursor-pointer rounded-[4px] py-0.5 text-center text-[10.5px] leading-none transition-colors duration-100 outline-none ${
                active ? "font-medium text-fg" : "text-fg-faint hover:text-fg-muted"
              }`}
            >
              {SHORT_LABELS[effort]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
