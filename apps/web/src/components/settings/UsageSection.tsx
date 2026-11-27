import { RefreshIcon } from "@hugeicons/core-free-icons";
import { createScuttleApiClient, describeApiError } from "@scuttle/client-runtime";
import type {
  ProviderKind,
  UsageProviderFilter,
  UsageRange,
  UsageReport,
} from "@scuttle/contracts";
import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { Skeleton } from "skullet/react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Picker, type PickerOption } from "@/components/ui/Picker.tsx";
import { easeOut, spring } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";
import { SettingsGroup } from "./primitives.tsx";
import { SAMPLE_USAGE_REPORT } from "./usage/sampleUsage.ts";
import { UsageBreakdownCard, UsageProvidersCard } from "./usage/UsageBreakdown.tsx";
import { UsageChart } from "./usage/UsageChart.tsx";
import {
  formatSessions,
  formatTokens,
  formatUsd,
  PROVIDER_META,
  RANGE_OPTIONS,
} from "./usage/usageFormat.ts";

const apiClient = createScuttleApiClient();
const reportCache = new Map<string, UsageReport>();
const cacheKey = (range: UsageRange, provider: UsageProviderFilter) => `${range}:${provider}`;

const PROVIDER_ORDER: ReadonlyArray<ProviderKind> = [
  "claude",
  "antigravity",
  "codex",
  "opencode",
  "copilot",
];

const PROVIDER_PICKER_OPTIONS: ReadonlyArray<PickerOption<UsageProviderFilter>> = [
  { value: "all", label: "All providers" },
  ...PROVIDER_ORDER.map((kind) => ({
    value: kind,
    label: PROVIDER_META[kind].label,
    icon: <BrandLogo brand={kind} className="size-3.5 shrink-0" />,
  })),
];

const RANGE_LABELS: Record<UsageRange, string> = {
  "24h": "Last 24h",
  "7d": "Last 7d",
  "30d": "Last 30d",
  "90d": "Last 90d",
};

const TOKEN_TYPE_SEGMENTS = [
  { key: "inputTokens", label: "Input", color: "#8a8a93" },
  { key: "cacheReadTokens", label: "Cache read", color: "#5e5e66" },
  { key: "cacheWriteTokens", label: "Cache write", color: "#b6b6be" },
  { key: "outputTokens", label: "Output", color: "#ebebec" },
] as const;

export function UsageSection() {
  const pillId = useId();
  const [range, setRange] = useState<UsageRange>("7d");
  const [provider, setProvider] = useState<UsageProviderFilter>("all");
  const [report, setReport] = useState<UsageReport | null>(
    () => reportCache.get(cacheKey("7d", "all")) ?? null,
  );
  const [fetching, setFetching] = useState(() => !reportCache.has(cacheKey("7d", "all")));
  const [refreshing, setRefreshing] = useState(false);
  const [spinCount, setSpinCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    const key = cacheKey(range, provider);
    const cached = reportCache.get(key);
    if (cached) {
      setReport(cached);
    }
    setHoveredIndex(null);
    setError(null);

    let active = true;
    const force = forceRefreshRef.current;
    forceRefreshRef.current = false;
    setFetching(true);
    if (force) setRefreshing(true);

    void apiClient
      .getUsage({ range, provider, ...(force ? { refresh: true } : {}) })
      .then((next) => {
        if (!active) return;
        reportCache.set(key, next);
        setReport(next);
        setFetching(false);
        setRefreshing(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(describeApiError(err, "Could not load token usage."));
        setFetching(false);
        setRefreshing(false);
      });

    return () => {
      active = false;
    };
  }, [range, provider, refreshNonce]);

  useEffect(() => {
    if (!report?.indexing) return;
    const timer = window.setTimeout(() => {
      setRefreshNonce((n) => n + 1);
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [report?.indexing]);

  useEffect(() => {
    if (!refreshing) return;
    const timer = window.setInterval(() => {
      setSpinCount((n) => n + 1);
    }, 500);
    return () => window.clearInterval(timer);
  }, [refreshing]);

  const handleRefresh = () => {
    if (refreshing) return;
    setSpinCount((n) => n + 1);
    forceRefreshRef.current = true;
    setRefreshNonce((n) => n + 1);
  };

  const isInitialLoading = report === null && error === null;
  const isStaleSwitch = fetching && !refreshing && report !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Time range"
          className="inline-flex rounded-control bg-panel p-0.5 shadow-raised"
        >
          {RANGE_OPTIONS.map((option) => {
            const active = range === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setRange(option.value)}
                className={cn(
                  "relative h-7 cursor-pointer rounded-[5px] px-2.5 text-label font-medium outline-none transition-colors duration-(--dur-hover) ease-hover active:scale-[0.98] focus-visible:shadow-focus",
                  active ? "text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {active && (
                  <motion.span
                    layoutId={`${pillId}-range`}
                    transition={spring.snappy}
                    aria-hidden
                    className="absolute inset-0 rounded-[5px] bg-selected shadow-raised"
                  />
                )}
                <span className="relative z-10">{option.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh usage"
            aria-busy={refreshing}
            onClick={handleRefresh}
            className="size-8 active:scale-[0.94]"
          >
            <motion.span
              animate={{ rotate: spinCount * 360 }}
              transition={{ duration: 0.55, ease: easeOut }}
              className="inline-flex items-center justify-center"
            >
              <Icon icon={RefreshIcon} />
            </motion.span>
          </Button>
          <Picker
            label="Provider"
            value={provider}
            options={PROVIDER_PICKER_OPTIONS}
            onValueChange={setProvider}
            variant="pill"
            className="h-8 pr-2 pl-2.5"
          />
        </div>
      </div>

      {error !== null && (
        <div className="flex items-center justify-between gap-3 rounded-card bg-danger/10 px-4 py-3 text-label text-danger shadow-[inset_0_0_0_1px_rgb(240_100_92/25%)]">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={handleRefresh}>
            Retry
          </Button>
        </div>
      )}

      <Skeleton
        data={report}
        sample={SAMPLE_USAGE_REPORT}
        loading={isInitialLoading}
        id="settings-usage"
        label="Loading token usage"
        error={error !== null && report === null ? <div /> : undefined}
      >
        {(activeReport) => (
          <UsageReportContent
            report={activeReport}
            isSample={isInitialLoading}
            isStaleSwitch={isStaleSwitch}
            range={range}
            provider={provider}
            hoveredIndex={hoveredIndex}
            onHoverIndex={setHoveredIndex}
            onSelectProvider={setProvider}
            onSelectRange={setRange}
          />
        )}
      </Skeleton>
    </div>
  );
}

function UsageReportContent({
  report,
  isSample,
  isStaleSwitch,
  range,
  provider,
  hoveredIndex,
  onHoverIndex,
  onSelectProvider,
  onSelectRange,
}: {
  readonly report: UsageReport;
  readonly isSample: boolean;
  readonly isStaleSwitch: boolean;
  readonly range: UsageRange;
  readonly provider: UsageProviderFilter;
  readonly hoveredIndex: number | null;
  readonly onHoverIndex: (index: number | null) => void;
  readonly onSelectProvider: (provider: UsageProviderFilter) => void;
  readonly onSelectRange: (range: UsageRange) => void;
}) {
  const [hoveredTypeKey, setHoveredTypeKey] = useState<
    (typeof TOKEN_TYPE_SEGMENTS)[number]["key"] | null
  >(null);
  const { totals } = report;
  const totalProcessed = totals.processedTokens;

  if (totalProcessed === 0) {
    return (
      <SettingsGroup>
        <div className="flex flex-col items-start gap-2 px-4 py-6">
          <p className="text-body font-medium text-fg">
            No token usage in the last {RANGE_OPTIONS.find((r) => r.value === range)?.label}
          </p>
          <p className="text-label text-fg-muted">
            {provider === "all"
              ? "Run a session or widen the time range to view older local history."
              : `No activity found for ${PROVIDER_META[provider].label} in this window.`}
          </p>
          <div className="mt-1 flex items-center gap-2">
            {provider !== "all" && (
              <Button variant="secondary" size="sm" onClick={() => onSelectProvider("all")}>
                Show all providers
              </Button>
            )}
            {range !== "90d" && (
              <Button variant="ghost" size="sm" onClick={() => onSelectRange("90d")}>
                Try 90 days
              </Button>
            )}
          </div>
        </div>
      </SettingsGroup>
    );
  }

  const chartProviders: ReadonlyArray<ProviderKind> =
    report.provider === "all" ? report.providers.map((p) => p.providerKind) : [report.provider];

  const hoveredPoint = hoveredIndex !== null ? (report.series[hoveredIndex] ?? null) : null;
  const cacheDenominator = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  const cacheHitPct = cacheDenominator > 0 ? (totals.cacheReadTokens / cacheDenominator) * 100 : 0;

  const providerTotals = new Map<ProviderKind, number>();
  for (const p of report.providers) {
    providerTotals.set(p.providerKind, p.processedTokens);
  }

  return (
    <div className={cn("space-y-6 transition-opacity duration-150", isStaleSwitch && "opacity-65")}>
      <SettingsGroup>
        <div className="px-4 pt-4 pb-1">
          <div className="flex h-8 items-baseline justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="text-[1.75rem] leading-none font-semibold tracking-tight text-fg tabular-nums">
                {formatTokens(
                  hoveredPoint !== null ? hoveredPoint.processedTokens : totalProcessed,
                )}
              </span>
              <span className="text-label text-fg-muted">tokens</span>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-chip px-2 py-0.5 text-meta font-medium tabular-nums whitespace-nowrap transition-colors duration-100",
                hoveredPoint !== null ? "bg-white/[0.07] text-fg" : "text-fg-faint",
              )}
            >
              {hoveredPoint !== null ? hoveredPoint.label : RANGE_LABELS[report.range]}
            </span>
          </div>

          <p className="mt-1 h-5 truncate text-meta text-fg-muted tabular-nums">
            {hoveredPoint !== null
              ? `${formatSessions(hoveredPoint.sessions)} · est. ${formatUsd(hoveredPoint.costUsd)}`
              : `${formatSessions(report.sessions)} · est. ${formatUsd(totals.costUsd)}`}
          </p>

          {chartProviders.length > 0 && (
            <div className="scrollbar-none mt-2 flex h-5 items-center gap-x-3.5 overflow-x-auto whitespace-nowrap">
              {chartProviders.slice(0, 5).map((kind) => {
                const meta = PROVIDER_META[kind];
                const value =
                  hoveredPoint !== null
                    ? (hoveredPoint.byProvider.find((p) => p.providerKind === kind)
                        ?.processedTokens ?? 0)
                    : (providerTotals.get(kind) ?? 0);
                const canToggle = report.providers.length > 1 || provider !== "all";
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={!canToggle}
                    onClick={() => onSelectProvider(provider === kind ? "all" : kind)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-chip text-meta tabular-nums outline-none transition-colors duration-100 focus-visible:shadow-focus",
                      canToggle && "cursor-pointer hover:text-fg",
                    )}
                  >
                    <span
                      aria-hidden
                      style={{ backgroundColor: meta.color }}
                      className="size-1.5 rounded-full"
                    />
                    <span className="text-fg-muted">{meta.label}</span>
                    <span
                      className={cn(
                        "inline-block min-w-[2.75rem] text-left font-medium transition-colors duration-100",
                        value > 0 ? "text-fg-secondary" : "text-fg-faint",
                      )}
                    >
                      {formatTokens(value)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {isSample ? (
          <div className="w-full px-3 pt-1 pb-2">
            <div skullet-block="" className="h-[10.25rem] w-full rounded-control" />
          </div>
        ) : (
          <UsageChart
            series={report.series}
            providers={chartProviders}
            hoveredIndex={hoveredIndex}
            onHoverIndex={onHoverIndex}
          />
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-4">
          <div>
            <div className="text-meta text-fg-muted">Cached input</div>
            <div className="mt-0.5 text-[0.9375rem] font-semibold text-fg tabular-nums">
              {formatTokens(totals.cacheReadTokens)}
            </div>
          </div>
          <div>
            <div className="text-meta text-fg-muted">Uncached input</div>
            <div className="mt-0.5 text-[0.9375rem] font-semibold text-fg tabular-nums">
              {formatTokens(totals.inputTokens)}
            </div>
          </div>
          <div>
            <div className="text-meta text-fg-muted">Output</div>
            <div className="mt-0.5 text-[0.9375rem] font-semibold text-fg tabular-nums">
              {formatTokens(totals.outputTokens)}
            </div>
          </div>
          <div>
            <div className="text-meta text-fg-muted">Cache savings</div>
            <div className="mt-0.5 text-[0.9375rem] font-semibold text-fg tabular-nums">
              {formatUsd(totals.cacheSavingsUsd)}
            </div>
          </div>
        </div>

        <div className="space-y-2 px-4 py-3">
          <div className="flex items-center justify-between gap-2 text-meta">
            <span className="text-fg-muted">Tokens by type</span>
            {cacheDenominator > 0 && (
              <span className="text-fg-faint tabular-nums">
                {cacheHitPct.toFixed(1)}% cache hit
              </span>
            )}
          </div>
          <div
            skullet-block=""
            onPointerLeave={() => setHoveredTypeKey(null)}
            className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-white/[0.06]"
          >
            {TOKEN_TYPE_SEGMENTS.map((seg) => {
              const value = totals[seg.key];
              if (value <= 0 || totalProcessed <= 0) return null;
              const pct = Math.max(1.2, (value / totalProcessed) * 100);
              const sharePct = ((value / totalProcessed) * 100).toFixed(1);
              const dimmed = hoveredTypeKey !== null && hoveredTypeKey !== seg.key;
              return (
                <span
                  key={seg.key}
                  title={`${seg.label}: ${formatTokens(value)} (${sharePct}%)`}
                  onPointerEnter={() => setHoveredTypeKey(seg.key)}
                  style={{ width: `${pct}%`, backgroundColor: seg.color }}
                  className={cn(
                    "h-full rounded-[1px] transition-[width,opacity] duration-150 ease-out-quint",
                    dimmed && "opacity-30",
                  )}
                />
              );
            })}
          </div>
          <div
            onPointerLeave={() => setHoveredTypeKey(null)}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta tabular-nums"
          >
            {TOKEN_TYPE_SEGMENTS.map((seg) => {
              const dimmed = hoveredTypeKey !== null && hoveredTypeKey !== seg.key;
              return (
                <span
                  key={seg.key}
                  onPointerEnter={() => setHoveredTypeKey(seg.key)}
                  className={cn(
                    "inline-flex cursor-default items-center gap-1.5 text-fg-muted transition-opacity duration-150",
                    dimmed && "opacity-40",
                  )}
                >
                  <span
                    aria-hidden
                    style={{ backgroundColor: seg.color }}
                    className="size-1.5 rounded-[2px]"
                  />
                  <span>{seg.label}</span>
                  <span className="font-medium text-fg-secondary">
                    {formatTokens(totals[seg.key])}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </SettingsGroup>

      {provider === "all" && (
        <UsageProvidersCard providers={report.providers} onSelectProvider={onSelectProvider} />
      )}

      <UsageBreakdownCard
        models={report.models}
        series={report.series}
        granularity={report.granularity}
        isSample={isSample}
      />

      <div className="flex items-center justify-between px-0.5 text-meta text-fg-faint tabular-nums">
        <span>
          {report.indexing
            ? "Indexing older local history in background…"
            : `${report.indexedFiles.toLocaleString()} local logs indexed`}
        </span>
        <span>{report.scanMs < 1 ? "<1ms" : `${report.scanMs}ms`}</span>
      </div>
    </div>
  );
}
