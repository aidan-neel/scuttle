import type { ScuttleVizSpec, Tone, VizBlock, VizChartBlock, VizKpiItem } from "@scuttle/contracts";

export interface VizFilter {
  readonly key: string;
  readonly value: string;
}

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-fg-secondary",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-fg-faint",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export const TONE_BADGE: Record<Tone, string> = {
  neutral: "bg-(--wash-strong) text-fg-secondary",
  primary: "bg-primary/12 text-primary",
  success: "bg-success/12 text-success",
  warning: "bg-warning/14 text-warning",
  danger: "bg-danger/12 text-danger",
};

export const TONE_VAR: Record<Tone, string> = {
  neutral: "var(--color-fg-muted)",
  primary: "var(--color-primary)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
};

const RAMP = [100, 72, 52, 38, 28, 20];

export const seriesColor = (
  index: number,
  tone: Tone | undefined,
  base: "primary" | "neutral" = "primary",
): string =>
  tone === undefined
    ? `color-mix(in oklab, var(${base === "primary" ? "--color-primary" : "--color-fg-muted"}) ${RAMP[index % RAMP.length] ?? 100}%, var(--color-panel))`
    : TONE_VAR[tone];

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const precise = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export const formatVizNumber = (value: number, unit?: string): string => {
  const body = Math.abs(value) >= 10_000 ? compact.format(value) : precise.format(value);
  if (unit === undefined || unit === "") return body;
  if (unit === "$") return value < 0 ? `-$${body.slice(1)}` : `$${body}`;
  if (unit === "%") return `${body}%`;
  return `${body} ${unit}`;
};

export const formatVizValue = (value: number | string, unit?: string): string =>
  typeof value === "number" ? formatVizNumber(value, unit) : value;

export const formatShare = (part: number, total: number): string =>
  total === 0 ? "0%" : `${precise.format((part / total) * 100)}%`;

const normalize = (value: string) => value.trim().toLowerCase();

export const filterMatches = (filter: VizFilter, tag: string | number | undefined): boolean =>
  tag !== undefined && normalize(String(tag)) === normalize(filter.value);

export function applyVizFilter<T>(
  items: ReadonlyArray<T>,
  filter: VizFilter | null,
  tagOf: (item: T, key: string) => string | number | undefined,
): { readonly items: ReadonlyArray<T>; readonly applied: boolean } {
  if (filter === null) return { items, applied: false };
  if (!items.some((item) => tagOf(item, filter.key) !== undefined))
    return { items, applied: false };
  return {
    items: items.filter((item) => filterMatches(filter, tagOf(item, filter.key))),
    applied: true,
  };
}

export const isSameFilter = (a: VizFilter | null, b: VizFilter | null): boolean =>
  a !== null && b !== null && a.key === b.key && filterMatches(a, b.value);

export const kpiFilter = (item: VizKpiItem): VizFilter | null =>
  item.filterKey !== undefined && item.filterValue !== undefined
    ? { key: item.filterKey, value: item.filterValue }
    : null;

export interface ChartEntry {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly values: ReadonlyArray<number>;
}

export const sum = (values: ReadonlyArray<number>) => values.reduce((a, b) => a + b, 0);

export const chartCategories = (block: VizChartBlock): ReadonlyArray<string> => {
  const lengths = block.series.map((s) => s.values.length);
  const count = Math.max(block.categories?.length ?? 0, 0, ...lengths);
  return Array.from({ length: count }, (_, i) => block.categories?.[i] ?? `${i + 1}`);
};

export const niceTicks = (min: number, max: number, count = 4): ReadonlyArray<number> => {
  const hi = max === min ? min + 1 : max;
  const raw = (hi - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let t = Math.floor(min / step) * step; t < hi + step * 0.999 && ticks.length < 12; t += step)
    ticks.push(Number(t.toPrecision(12)));
  return ticks;
};

export const chartEntries = (block: VizChartBlock): ReadonlyArray<ChartEntry> => {
  const first = block.series[0];
  if (block.chartType === "donut" && (block.categories?.length ?? 0) > 0 && first !== undefined) {
    return (block.categories ?? []).map((label, i) => ({
      id: label,
      label,
      color: seriesColor(i, undefined),
      values: [Math.max(0, first.values[i] ?? 0)],
    }));
  }
  const untoned = block.series.filter((s) => s.tone === undefined);
  const base = untoned.length < block.series.length ? "neutral" : "primary";
  return block.series.map((s) => ({
    id: s.id,
    label: s.label,
    color: seriesColor(untoned.indexOf(s), s.tone, base),
    values: block.chartType === "donut" ? [Math.max(0, sum(s.values))] : s.values,
  }));
};

export const toggleHidden = (hidden: ReadonlyArray<string>, id: string, total: number) => {
  if (hidden.includes(id)) return hidden.filter((h) => h !== id);
  return hidden.length + 1 >= total ? hidden : [...hidden, id];
};

export const donutArc = (r: number, inner: number, a0: number, a1: number): string => {
  const p = (rad: number, ang: number) =>
    `${(rad * Math.sin(ang)).toFixed(3)},${(-rad * Math.cos(ang)).toFixed(3)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r, a0)} A${r},${r} 0 ${large} 1 ${p(r, a1)} L${p(inner, a1)} A${inner},${inner} 0 ${large} 0 ${p(inner, a0)} Z`;
};

export const CHART_W = 720;
export const CHART_PAD = { top: 12, right: 12, bottom: 28, left: 52 } as const;

export const cartesianLayout = (
  block: VizChartBlock,
  entries: ReadonlyArray<ChartEntry>,
  categories: ReadonlyArray<string>,
) => {
  const H = block.height ?? 220;
  const n = categories.length;
  const stacked = block.chartType === "stacked-bar";
  const linear = block.chartType === "line" || block.chartType === "area";
  const at = (e: ChartEntry, i: number) => e.values[i] ?? 0;
  const totals = categories.map((_, i) => sum(entries.map((e) => at(e, i))));
  const flat = stacked ? totals : entries.flatMap((e) => categories.map((_, i) => at(e, i)));
  const ticks = niceTicks(Math.min(0, ...flat), Math.max(0, ...flat));
  const lo = ticks[0] ?? 0;
  const hi = ticks[ticks.length - 1] ?? 1;
  const plotW = CHART_W - CHART_PAD.left - CHART_PAD.right;
  const plotH = H - CHART_PAD.top - CHART_PAD.bottom;
  const band = plotW / Math.max(1, n);
  const groupW = Math.min(band * 0.72, 18 * Math.max(1, entries.length) + 24);
  const y = (v: number) => CHART_PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const x = (i: number) =>
    CHART_PAD.left + (linear ? (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1)) : band * (i + 0.5));
  return {
    H,
    n,
    stacked,
    linear,
    totals,
    ticks,
    plotW,
    plotH,
    band,
    groupW,
    x,
    y,
    labelEvery: Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 72)))),
    barW: stacked
      ? Math.min(band * 0.56, 44)
      : Math.max(2, groupW / Math.max(1, entries.length) - 2),
    baseline: y(lo < 0 ? 0 : lo),
  };
};

const STATUS_WORDS: ReadonlyArray<readonly [Tone, RegExp]> = [
  ["danger", /\b(fail|failed|failing|error|broken|blocked|critical|down|regress\w*)\b/i],
  ["warning", /\b(warn\w*|pending|slow|risk\w*|partial|degraded|flaky|todo)\b/i],
  ["success", /\b(pass|passed|passing|ok|done|healthy|ready|shipped|merged|green|success\w*)\b/i],
];

export const statusTone = (text: string, explicit?: Tone): Tone =>
  explicit ?? STATUS_WORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? "neutral";

const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
const mdTable = (head: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>) =>
  [head, head.map(() => "---"), ...rows].map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n");

export const blockToMarkdown = (block: VizBlock): string => {
  switch (block.kind) {
    case "kpis":
      return block.items
        .map(
          (i) =>
            `- **${i.label}:** ${formatVizValue(i.value)}${i.delta === undefined ? "" : ` (${i.delta})`}`,
        )
        .join("\n");
    case "chart": {
      const count = Math.max(
        block.categories?.length ?? 0,
        ...block.series.map((s) => s.values.length),
      );
      const rows = Array.from({ length: count }, (_, i) => [
        block.categories?.[i] ?? `${i + 1}`,
        ...block.series.map((s) => formatVizNumber(s.values[i] ?? 0, block.unit)),
      ]);
      const table = mdTable(["", ...block.series.map((s) => s.label)], rows);
      return block.title === undefined ? table : `**${block.title}**\n\n${table}`;
    }
    case "table":
      return mdTable(
        block.columns.map((c) => c.label),
        block.rows.map((r) => block.columns.map((c) => String(r.cells[c.key] ?? ""))),
      );
    case "comparison":
      return block.items
        .map(
          (i) => `- **${i.title}**: ${i.status}${i.metric === undefined ? "" : ` · ${i.metric}`}`,
        )
        .join("\n");
    case "flow": {
      const name = new Map(block.nodes.map((n) => [n.id, n.label]));
      return block.edges
        .map(
          (e) =>
            `- ${name.get(e.from) ?? e.from} → ${name.get(e.to) ?? e.to}${e.label === undefined ? "" : ` (${e.label})`}`,
        )
        .join("\n");
    }
    case "callout":
      return `> ${block.title === undefined ? "" : `**${block.title}** `}${block.body}`;
  }
};

export const vizToMarkdown = (spec: ScuttleVizSpec): string => {
  const parts = [`# ${spec.title}`];
  if (spec.subtitle !== undefined) parts.push(spec.subtitle);
  if (spec.mode === "sandbox") return [...parts, "_Interactive visualization_"].join("\n\n");
  if (spec.takeaway !== undefined) parts.push(`> ${spec.takeaway}`);
  for (const block of spec.blocks ?? []) parts.push(blockToMarkdown(block));
  for (const tab of spec.tabs ?? []) {
    parts.push(`## ${tab.label}`, ...tab.blocks.map(blockToMarkdown));
  }
  return parts.join("\n\n");
};
