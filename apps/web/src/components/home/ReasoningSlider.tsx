import type { EffortLevel } from "@scuttle/contracts";
import { motion } from "motion/react";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { DitherShader } from "@/lib/dither";
import { EFFORT_LABELS } from "@/lib/format.ts";
import { spring } from "@/lib/motion.ts";
import { remToPx } from "@/lib/uiScale.ts";

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

const SLIDER_PALETTE = ["#0d0d10", "#172d62", "#3570f1", "#9ec4ff"] as const;

const SLIDER_FIELD = `
float field(vec2 uv, vec2 res, float t) {
  float x = clamp(uv.x, 0.0, 1.0);
  float curve = 0.22 + 0.72 * pow(x, 0.78);
  float sheen = 1.0 - abs(uv.y - 0.38) * 0.45;
  return clamp(curve * sheen, 0.0, 1.0);
}
`;

const THUMB_HALF_REM = 0.3125;

const stopPercent = (idx: number, count: number): number =>
  count <= 1 ? 100 : (idx / (count - 1)) * 100;

export function ReasoningSlider({ efforts, value, onChange }: ReasoningSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const count = efforts.length;
  const activeIndex = Math.max(0, efforts.indexOf(value));
  const activePct = stopPercent(activeIndex, count);

  const indexFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || count <= 1) return 0;
    const thumbHalfPx = remToPx(THUMB_HALF_REM);
    const usableWidth = Math.max(1, rect.width - thumbHalfPx * 2);
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - thumbHalfPx) / usableWidth));
    return Math.round(ratio * (count - 1));
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
        <span className="text-right text-meta font-medium text-fg">{EFFORT_LABELS[value]}</span>
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
        <div className="pointer-events-none absolute inset-x-0 top-1 h-5 overflow-hidden rounded-control bg-[#0d0d10] shadow-[inset_0_0_0_1px_rgb(255_255_255/10%),inset_0_1px_2px_rgb(0_0_0/55%)] group-focus-visible/slider:shadow-focus">
          <div aria-hidden className="absolute inset-y-0 inset-x-[0.3125rem]">
            {efforts.map((effort, idx) => (
              <span
                key={effort}
                style={{ left: `${stopPercent(idx, count)}%` }}
                className={`absolute top-1/2 h-1.5 w-px -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-150 ${
                  idx <= activeIndex ? "bg-fg/30" : "bg-fg/12"
                }`}
              />
            ))}
          </div>

          <div
            aria-hidden
            className="absolute inset-[0.125rem] overflow-hidden rounded-[0.3125rem]"
          >
            <motion.div
              initial={false}
              animate={{
                clipPath:
                  count <= 1
                    ? "inset(0 0% 0 0)"
                    : `inset(0 calc(${100 - activePct}% - ${THUMB_HALF_REM - 0.125}rem) 0 0)`,
              }}
              transition={spring.snappy}
              className="absolute inset-0"
            >
              <DitherShader
                field={SLIDER_FIELD}
                palette={SLIDER_PALETTE}
                matrix="blue-noise"
                cell={1}
                animate={false}
                stillTime={0}
                className="absolute inset-0"
                fallback={
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(90deg, rgb(42 84 196 / 35%) 0%, rgb(126 166 255 / 90%) 100%)",
                    }}
                  />
                }
              />
            </motion.div>
          </div>
        </div>

        <div aria-hidden className="pointer-events-none absolute inset-y-0 inset-x-[0.3125rem]">
          <motion.div
            initial={false}
            animate={{ left: `${activePct}%`, scale: dragging ? 1.06 : 1 }}
            transition={spring.snappy}
            className="absolute inset-y-0 flex h-7 w-2.5 -translate-x-1/2 items-center justify-center gap-px rounded-[0.25rem] bg-[linear-gradient(180deg,#ffffff_0%,#e4e7ee_100%)] shadow-[0_0_0_0.5px_rgb(0_0_0/55%),0_1px_2px_rgb(0_0_0/70%),0_3px_8px_rgb(0_0_0/45%),0_0_10px_rgb(126_166_255/35%),inset_0_1px_0_rgb(255_255_255),inset_0_-1px_0_rgb(0_0_0/12%)] transition-shadow duration-150 group-hover/slider:shadow-[0_0_0_0.5px_rgb(0_0_0/55%),0_1px_2px_rgb(0_0_0/70%),0_3px_8px_rgb(0_0_0/45%),0_0_14px_rgb(126_166_255/55%),inset_0_1px_0_rgb(255_255_255),inset_0_-1px_0_rgb(0_0_0/12%)]"
          >
            <span className="h-3 w-px rounded-full bg-black/20" />
            <span className="h-3 w-px rounded-full bg-black/20" />
          </motion.div>
        </div>
      </div>

      <div className="relative mx-[0.3125rem] h-4">
        {efforts.map((effort, idx) => {
          const active = idx === activeIndex;
          const pct = stopPercent(idx, count);
          const alignClass =
            idx === 0
              ? "left-0 text-left"
              : idx === count - 1
                ? "right-0 text-right"
                : "-translate-x-1/2 text-center";
          return (
            <button
              key={effort}
              type="button"
              style={idx === 0 || idx === count - 1 ? undefined : { left: `${pct}%` }}
              onClick={() => onChange(effort)}
              className={`absolute top-0 cursor-pointer rounded-[0.25rem] py-0.5 text-[0.71875rem] leading-none whitespace-nowrap transition-colors duration-100 outline-none ${alignClass} ${
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
