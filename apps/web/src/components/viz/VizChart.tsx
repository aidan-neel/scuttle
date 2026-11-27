import type { VizChartBlock } from "@scuttle/contracts";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  type ChartEntry as Entry,
  chartCategories,
  chartEntries,
  donutArc,
  filterMatches,
  formatShare,
  formatVizNumber,
  cartesianLayout,
  CHART_PAD as PAD,
  CHART_W as W,
  sum,
  toggleHidden,
  type VizFilter,
} from "./vizModel.ts";

const AXIS = "text-[11px] tabular-nums";
const TICK = `${AXIS} fill-fg-faint`;
const GRID = "stroke-line [shape-rendering:crispEdges]";
const LINE = "fill-none stroke-2 [stroke-linecap:round] [stroke-linejoin:round]";
const ROW =
  "grid h-7 items-center gap-2.5 rounded-chip px-1.5 text-left text-meta outline-none transition-[background-color,opacity] duration-(--dur-hover) focus-visible:shadow-focus";

interface VariantProps {
  readonly block: VizChartBlock;
  readonly entries: ReadonlyArray<Entry>;
  readonly categories: ReadonlyArray<string>;
  readonly hidden: ReadonlyArray<string>;
  readonly hover: number | null;
  readonly setHover: (i: number | null) => void;
  readonly emphasis: (i: number) => boolean;
  readonly onPick: (i: number) => void;
  readonly onToggle: (id: string) => void;
}

const at = (e: Entry, i: number) => e.values[i] ?? 0;

function Swatch({ color, off = false }: { readonly color: string; readonly off?: boolean }) {
  return (
    <span
      className="size-2 shrink-0 rounded-[2px]"
      style={{ background: off ? "var(--color-fg-faint)" : color }}
    />
  );
}

type LegendProps = Pick<VariantProps, "entries" | "hidden" | "onToggle">;

function Legend({ entries, hidden, onToggle }: LegendProps) {
  if (entries.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {entries.map((entry) => {
        const off = hidden.includes(entry.id);
        return (
          <button
            key={entry.id}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(entry.id)}
            className={cn(
              "flex h-6 cursor-pointer items-center gap-1.5 rounded-chip px-2 text-meta outline-none transition-[color,background-color,opacity] duration-(--dur-hover) hover:bg-(--wash) focus-visible:shadow-focus",
              off ? "text-fg-faint line-through opacity-70" : "text-fg-secondary",
            )}
          >
            <Swatch color={entry.color} off={off} />
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}

function Cartesian(p: VariantProps) {
  const { block, entries, categories, hover, setHover, emphasis } = p;
  const L = cartesianLayout(block, entries, categories);
  const pick = (event: ReactMouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / (rect.width || 1)) * L.plotW;
    const index = L.linear ? Math.round((px / L.plotW) * (L.n - 1)) : Math.floor(px / L.band);
    return Math.min(L.n - 1, Math.max(0, index));
  };
  const tipLeft = hover === null ? 0 : L.x(hover) / W;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${L.H}`}
        className="block h-auto w-full overflow-visible"
        role="img"
        aria-label={block.title ?? "Chart"}
      >
        {L.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={L.y(t)} y2={L.y(t)} className={GRID} />
            <text x={PAD.left - 8} y={L.y(t)} dy="0.32em" textAnchor="end" className={TICK}>
              {formatVizNumber(t, block.unit)}
            </text>
          </g>
        ))}
        {hover !== null && (
          <rect
            x={L.linear ? L.x(hover) - 0.5 : PAD.left + L.band * hover}
            width={L.linear ? 1 : L.band}
            y={PAD.top}
            height={L.plotH}
            fill={L.linear ? "var(--color-edge-strong)" : "var(--wash)"}
          />
        )}
        {!L.linear &&
          categories.map((_, i) => {
            let base = 0;
            return entries.map((entry, s) => {
              const v = at(entry, i);
              const from = L.stacked ? base : 0;
              if (L.stacked) base += v;
              return (
                <rect
                  key={`${i}-${entry.id}`}
                  x={L.stacked ? L.x(i) - L.barW / 2 : L.x(i) - L.groupW / 2 + s * (L.barW + 2) + 1}
                  y={L.y(Math.max(from, from + v))}
                  width={L.barW}
                  height={Math.max(v === 0 ? 0 : 1, Math.abs(L.y(from) - L.y(from + v)))}
                  rx={2}
                  fill={entry.color}
                  opacity={emphasis(i) ? 1 : 0.32}
                  className="transition-opacity duration-(--dur-hover)"
                />
              );
            });
          })}
        {L.linear &&
          entries.map((entry) => {
            const pts = categories.map(
              (_, i) => `${L.x(i).toFixed(2)},${L.y(at(entry, i)).toFixed(2)}`,
            );
            return (
              <g key={entry.id}>
                {block.chartType === "area" && L.n > 1 && (
                  <path
                    d={`M${L.x(0)},${L.baseline} L${pts.join(" L")} L${L.x(L.n - 1)},${L.baseline} Z`}
                    fill={entry.color}
                    opacity={0.14}
                  />
                )}
                <polyline points={pts.join(" ")} className={LINE} style={{ stroke: entry.color }} />
                {hover !== null && (
                  <circle
                    cx={L.x(hover)}
                    cy={L.y(at(entry, hover))}
                    r={3.5}
                    className="fill-panel stroke-2"
                    style={{ stroke: entry.color }}
                  />
                )}
              </g>
            );
          })}
        {categories.map((c, i) =>
          i % L.labelEvery === 0 ? (
            <text
              key={`l-${c}-${i}`}
              x={L.x(i)}
              y={L.H - 8}
              textAnchor="middle"
              className={cn(AXIS, hover === i ? "fill-fg" : "fill-fg-muted")}
            >
              {c.length > 14 ? `${c.slice(0, 13)}…` : c}
            </text>
          ) : null,
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={L.plotW}
          height={L.plotH}
          fill="transparent"
          className={cn(block.filterKey !== undefined && "cursor-pointer")}
          onPointerMove={(e) => setHover(pick(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => p.onPick(pick(e))}
        />
      </svg>
      {hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-row bg-menu px-2.5 py-2 text-meta shadow-menu"
          style={
            tipLeft > 0.66
              ? { right: `${(1 - tipLeft) * 100 + 1.5}%` }
              : { left: `${tipLeft * 100 + 1.5}%` }
          }
        >
          <div className="mb-1 flex justify-between gap-3 font-medium text-fg">
            <span className="truncate">{categories[hover]}</span>
            {L.stacked && entries.length > 1 && (
              <span className="tabular-nums">
                {formatVizNumber(L.totals[hover] ?? 0, block.unit)}
              </span>
            )}
          </div>
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 text-fg-secondary">
              <Swatch color={entry.color} />
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              <span className="font-medium text-fg tabular-nums">
                {formatVizNumber(at(entry, hover), block.unit)}
              </span>
              {entries.length > 1 && (
                <span className="w-11 text-right text-fg-faint tabular-nums">
                  {formatShare(at(entry, hover), L.totals[hover] ?? 0)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Segment {
  readonly id: string;
  readonly color: string;
  readonly frac: number;
}

interface ListRow {
  readonly key: string;
  readonly label: string;
  readonly color: string | null;
  readonly segments: ReadonlyArray<Segment>;
  readonly value: string;
  readonly share: string;
  readonly off: boolean;
}

interface RowListProps extends Pick<VariantProps, "hover" | "setHover" | "emphasis"> {
  readonly rows: ReadonlyArray<ListRow>;
  readonly onClick: (i: number) => void;
  readonly pressable: boolean;
}

function RowList({ rows, hover, setHover, emphasis, onClick, pressable }: RowListProps) {
  return (
    <div className="flex min-w-48 flex-1 flex-col" onPointerLeave={() => setHover(null)}>
      {rows.map((row, i) => (
        <button
          key={row.key}
          type="button"
          aria-pressed={pressable ? !row.off : undefined}
          onPointerEnter={() => setHover(row.off ? null : i)}
          onFocus={() => setHover(row.off ? null : i)}
          onClick={() => onClick(i)}
          className={cn(
            ROW,
            "cursor-pointer",
            row.color === null
              ? "grid-cols-[minmax(5rem,9rem)_1fr_auto_2.75rem]"
              : "grid-cols-[0.5rem_1fr_auto_2.75rem]",
            hover === i && "bg-(--wash)",
            (row.off || !emphasis(i)) && "opacity-45",
          )}
        >
          {row.color !== null && <Swatch color={row.color} off={row.off} />}
          <span className={cn("truncate text-fg-secondary", row.off && "line-through")}>
            {row.label}
          </span>
          {row.color === null ? (
            <span className="flex h-2 min-w-16 overflow-hidden rounded-full bg-(--wash-strong)">
              {row.segments.map((s) => (
                <span
                  key={s.id}
                  className="h-full"
                  style={{ width: `${s.frac * 100}%`, background: s.color }}
                />
              ))}
            </span>
          ) : null}
          <span className="text-right font-medium text-fg tabular-nums">{row.value}</span>
          <span className="text-right text-fg-faint tabular-nums">{row.share}</span>
        </button>
      ))}
    </div>
  );
}

function HorizontalBars(p: VariantProps) {
  const totals = p.categories.map((_, i) => sum(p.entries.map((e) => Math.max(0, at(e, i)))));
  const max = Math.max(0, ...totals) || 1;
  const rows = p.categories.map((label, i) => ({
    key: `${label}-${i}`,
    label,
    color: null,
    segments: p.entries.map((e) => ({
      id: e.id,
      color: e.color,
      frac: Math.max(0, at(e, i)) / max,
    })),
    value: formatVizNumber(totals[i] ?? 0, p.block.unit),
    share: formatShare(totals[i] ?? 0, sum(totals)),
    off: false,
  }));
  return <RowList {...p} rows={rows} onClick={p.onPick} pressable={false} />;
}

function Donut(p: VariantProps) {
  const { block, entries, hidden, hover, setHover } = p;
  const shown = entries.map((e) => (hidden.includes(e.id) ? 0 : (e.values[0] ?? 0)));
  const total = sum(shown);
  const focused = hover === null ? null : (shown[hover] ?? 0);
  const rows = entries.map((e, i) => ({
    key: e.id,
    label: e.label,
    color: e.color,
    segments: [],
    value: formatVizNumber(e.values[0] ?? 0, block.unit),
    share: hidden.includes(e.id) ? "—" : formatShare(shown[i] ?? 0, total),
    off: hidden.includes(e.id),
  }));
  let angle = 0;
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <div className="relative size-40 shrink-0">
        <svg
          viewBox="-80 -80 160 160"
          className="size-40"
          role="img"
          aria-label={block.title ?? "Donut chart"}
        >
          <circle r={58} fill="none" stroke="var(--wash-strong)" strokeWidth={20} />
          {total > 0 &&
            entries.map((e, i) => {
              const v = shown[i] ?? 0;
              if (v <= 0) return null;
              const a0 = angle;
              angle += (v / total) * Math.PI * 2;
              const d =
                v >= total
                  ? donutArc(68, 48, 0, Math.PI * 2 - 0.0001)
                  : donutArc(hover === i ? 71 : 68, 48, a0 + 0.008, angle - 0.008);
              return (
                <path
                  key={e.id}
                  d={d}
                  fill={e.color}
                  opacity={p.emphasis(i) ? 1 : 0.32}
                  className={cn(
                    "transition-opacity duration-(--dur-hover)",
                    block.filterKey !== undefined && "cursor-pointer",
                  )}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onClick={() => p.onPick(i)}
                />
              );
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[1.0625rem] leading-6 font-semibold text-fg tabular-nums">
            {formatVizNumber(focused ?? total, block.unit)}
          </span>
          <span className="max-w-24 truncate text-meta text-fg-muted">
            {focused === null ? "Total" : formatShare(focused, total)}
          </span>
        </div>
      </div>
      <RowList
        {...p}
        rows={rows}
        emphasis={(i) => hover === null || hover === i}
        onClick={(i) => p.onToggle(entries[i]?.id ?? "")}
        pressable
      />
    </div>
  );
}

export function VizChart({
  block,
  filter,
  onFilter,
}: {
  readonly block: VizChartBlock;
  readonly filter: VizFilter | null;
  readonly onFilter: (filter: VizFilter | null) => void;
}) {
  const [hidden, setHidden] = useState<ReadonlyArray<string>>([]);
  const [hover, setHover] = useState<number | null>(null);
  const all = chartEntries(block);
  const donut = block.chartType === "donut";
  const entries = donut ? all : all.filter((e) => !hidden.includes(e.id));
  const categories = donut ? all.map((e) => e.label) : chartCategories(block);
  const own = block.filterKey !== undefined && filter?.key === block.filterKey ? filter : null;
  const emphasis = (i: number) =>
    hover !== null ? hover === i : own === null || filterMatches(own, categories[i]);
  const onPick = (i: number) => {
    const value = categories[i];
    if (block.filterKey === undefined || value === undefined) return;
    onFilter(own !== null && filterMatches(own, value) ? null : { key: block.filterKey, value });
  };
  const props: VariantProps = {
    block,
    entries,
    categories,
    hidden,
    hover,
    setHover,
    emphasis,
    onPick,
    onToggle: (id) => setHidden((h) => toggleHidden(h, id, all.length)),
  };
  const Variant = donut ? Donut : block.chartType === "horizontal-bar" ? HorizontalBars : Cartesian;
  const showLegend = !donut && all.length > 1;

  return (
    <section className="flex flex-col gap-3">
      {(block.title !== undefined || block.subtitle !== undefined || showLegend) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-col">
            {block.title !== undefined && (
              <h4 className="text-label font-medium text-fg">{block.title}</h4>
            )}
            {block.subtitle !== undefined && (
              <p className="text-meta text-fg-muted">{block.subtitle}</p>
            )}
          </div>
          {showLegend && <Legend entries={all} hidden={hidden} onToggle={props.onToggle} />}
        </header>
      )}
      {categories.length === 0 || all.length === 0 ? (
        <p className="py-6 text-center text-meta text-fg-faint">No data</p>
      ) : (
        <Variant {...props} />
      )}
    </section>
  );
}
