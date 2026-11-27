import type { Tone, VizKpiBlock, VizKpiItem } from "@scuttle/contracts";
import { cn } from "@/lib/utils";
import {
  formatVizValue,
  isSameFilter,
  kpiFilter,
  TONE_TEXT,
  TONE_VAR,
  type VizFilter,
} from "./vizModel.ts";

const deltaTone = (item: VizKpiItem): Tone => {
  if (item.tone !== undefined) return item.tone;
  const delta = item.delta?.trim() ?? "";
  if (delta.startsWith("+")) return "success";
  if (delta.startsWith("-") || delta.startsWith("−")) return "danger";
  return "neutral";
};

function Sparkline({
  values,
  tone,
}: {
  readonly values: ReadonlyArray<number>;
  readonly tone: Tone;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * 100).toFixed(2)},${(22 - ((v - min) / span) * 20).toFixed(2)}`,
    )
    .join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={TONE_VAR[tone === "neutral" ? "primary" : tone]}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function KpiBody({ item }: { readonly item: VizKpiItem }) {
  const tone = deltaTone(item);
  return (
    <>
      <span className="truncate text-meta text-fg-muted">{item.label}</span>
      <span
        className={cn(
          "text-[1.375rem] leading-7 font-semibold tracking-[-0.01em] tabular-nums",
          item.tone === undefined ? "text-fg" : TONE_TEXT[item.tone],
        )}
      >
        {formatVizValue(item.value)}
      </span>
      {(item.delta !== undefined || item.note !== undefined) && (
        <span className="flex min-w-0 items-center gap-1.5 text-meta">
          {item.delta !== undefined && (
            <span className={cn("shrink-0 font-medium tabular-nums", TONE_TEXT[tone])}>
              {item.delta}
            </span>
          )}
          {item.note !== undefined && <span className="truncate text-fg-faint">{item.note}</span>}
        </span>
      )}
      {item.sparkline !== undefined && (
        <span className="mt-1 block">
          <Sparkline values={item.sparkline} tone={tone} />
        </span>
      )}
    </>
  );
}

const CELL = "flex min-w-0 flex-col items-start gap-0.5 bg-panel px-3.5 py-3 text-left";

export function VizKpiStrip({
  block,
  filter,
  onFilter,
}: {
  readonly block: VizKpiBlock;
  readonly filter: VizFilter | null;
  readonly onFilter: (filter: VizFilter | null) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-px overflow-hidden rounded-row bg-line shadow-[0_0_0_1px_var(--color-line)]">
      {block.items.map((item, index) => {
        const own = kpiFilter(item);
        const key = item.id ?? `${index}`;
        if (own === null) {
          return (
            <div key={key} className={CELL}>
              <KpiBody item={item} />
            </div>
          );
        }
        const active = isSameFilter(own, filter);
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onFilter(active ? null : own)}
            className={cn(
              CELL,
              "relative cursor-pointer outline-none transition-colors duration-(--dur-hover) ease-hover hover:bg-hover focus-visible:shadow-[inset_0_0_0_2px_var(--color-primary)]",
              active &&
                "bg-raised after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary",
            )}
          >
            <KpiBody item={item} />
          </button>
        );
      })}
    </div>
  );
}
