import { Copy01Icon, RefreshIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import {
  compareModelCategoryStats,
  formatModelCategoryLine,
  formatPerformanceSummaryLines,
  type ModelCategoryStats,
  type ModelPerformanceSummary,
  type ModelPerfRun,
  type RateModelRunInput,
} from "@scuttle/contracts";
import { motion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { formatElapsedSeconds } from "@/lib/format.ts";
import { spring } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";
import { useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";
import { OUTCOME_TONE, PerformanceRunRow } from "./PerformanceRunRow.tsx";
import { SettingsGroup } from "./primitives.tsx";
import { formatUsd } from "./usage/usageFormat.ts";

export const PERF_TIMEFRAMES = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "All", days: 3650 },
] as const;

type Timeframe = (typeof PERF_TIMEFRAMES)[number]["label"];
const ALL_CATEGORIES = "all";
const RECENT_PREVIEW = 5;

export interface PerformanceKpis {
  readonly measuredRuns: number;
  readonly ratedRuns: number;
  readonly topRated: ModelCategoryStats | null;
  readonly fastest: ModelCategoryStats | null;
}

export const performanceKpis = (overall: ReadonlyArray<ModelCategoryStats>): PerformanceKpis => {
  const rated = overall.filter((stat) => stat.ratedCount > 0);
  const measured = overall.filter((stat) => stat.attempts > 0);
  return {
    measuredRuns: overall.reduce((sum, stat) => sum + stat.attempts, 0),
    ratedRuns: overall.reduce((sum, stat) => sum + stat.ratedCount, 0),
    topRated: rated.toSorted(compareModelCategoryStats)[0] ?? null,
    fastest:
      measured.toSorted((a, b) => b.medianTokensPerSecond - a.medianTokensPerSecond)[0] ?? null,
  };
};

export const leaderboardFor = (
  summary: Pick<ModelPerformanceSummary, "overall" | "byCategory">,
  category: string,
): ReadonlyArray<ModelCategoryStats> =>
  (category === ALL_CATEGORIES
    ? summary.overall
    : summary.byCategory.filter((stat) => stat.category === category)
  ).toSorted(compareModelCategoryStats);

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = (key: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => setCopied(key));
  };
  return [copied, copy] as const;
}

function Pills<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly onChange: (value: T) => void;
}) {
  const pillId = useId();
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative h-7 cursor-pointer rounded-chip px-2.5 text-label capitalize outline-none transition-colors duration-(--dur-hover) focus-visible:shadow-focus active:scale-[0.98]",
              active ? "text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {active && (
              <motion.span
                layoutId={`${pillId}-pill`}
                transition={spring.snappy}
                aria-hidden
                className="absolute inset-0 rounded-chip bg-selected shadow-raised"
              />
            )}
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="text-meta text-fg-muted">{label}</div>
      <div className="mt-1 truncate text-[1.125rem] leading-6 font-semibold tracking-tight text-fg tabular-nums">
        {value}
      </div>
      {note !== undefined && <div className="truncate text-meta text-fg-faint">{note}</div>}
    </div>
  );
}

function OutcomeBar({ stat }: { readonly stat: ModelCategoryStats }) {
  const parts = [
    { key: "pass", count: stat.passCount },
    { key: "partial", count: stat.partialCount },
    { key: "fail", count: stat.failCount },
  ] as const;
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-fg/8">
        {total > 0 &&
          parts.map((part) =>
            part.count > 0 ? (
              <span
                key={part.key}
                className={cn("h-full", OUTCOME_TONE[part.key])}
                style={{ width: `${(part.count / total) * 100}%` }}
              />
            ) : null,
          )}
      </div>
      <span className="shrink-0 font-mono text-meta text-fg-muted tabular-nums">
        {stat.passCount}/{stat.partialCount}/{stat.failCount}
      </span>
    </div>
  );
}

function LeaderboardRow({
  stat,
  rank,
  copied,
  onCopy,
}: {
  readonly stat: ModelCategoryStats;
  readonly rank: number;
  readonly copied: boolean;
  readonly onCopy: () => void;
}) {
  const { none, minor, major } = stat.reworkCounts;
  return (
    <div className="group flex flex-col gap-2 px-4 py-3">
      <div className="flex items-baseline gap-2.5">
        <span className="w-4 shrink-0 font-mono text-meta text-fg-faint tabular-nums">{rank}</span>
        <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">{stat.model}</span>
        <span className="shrink-0 text-meta text-fg-muted">
          {stat.attempts} {stat.attempts === 1 ? "run" : "runs"}
        </span>
        <span className="shrink-0 font-mono text-body text-fg tabular-nums">
          {stat.ratedCount > 0 ? (
            <>
              {stat.avgScore.toFixed(1)}
              <span className="text-meta text-fg-muted">/10</span>
            </>
          ) : (
            <span className="text-meta text-fg-faint">unrated</span>
          )}
        </span>
      </div>
      <div className="pl-6.5">
        <OutcomeBar stat={stat} />
      </div>
      <div className="flex items-center gap-x-3 gap-y-1 pl-6.5 font-mono text-meta text-fg-muted tabular-nums">
        <span className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span title="Average · median output tokens per second">
            {stat.avgTokensPerSecond.toFixed(1)} · {stat.medianTokensPerSecond.toFixed(1)} tok/s
          </span>
          <span title="Average duration">{formatElapsedSeconds(stat.avgDurationMs)}</span>
          <span title="Average cost">{formatUsd(stat.avgCostUsd)}</span>
          <span title={`Rework: ${none} none, ${minor} minor, ${major} major`}>
            {minor + major === 0 ? "no rework" : `rework ${minor} minor · ${major} major`}
          </span>
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy summary line for ${stat.model}`}
          title="Copy orchestrator summary line"
          onClick={onCopy}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <Icon icon={copied ? Tick02Icon : Copy01Icon} />
        </Button>
      </div>
    </div>
  );
}

export function PerformanceSection() {
  const { getPerformanceSummary, rateModelRun, deletePerformanceRun } = useWorkspaceActions();
  const perfRevision = useWorkspaceSelector((s) => s.perfRevision);
  const [timeframe, setTimeframe] = useState<Timeframe>("30d");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [summary, setSummary] = useState<ModelPerformanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ModelPerfRun | null>(null);
  const [copied, copy] = useCopy();
  const days = PERF_TIMEFRAMES.find((t) => t.label === timeframe)?.days ?? 30;

  useEffect(() => {
    let active = true;
    setError(null);
    void getPerformanceSummary({ days, limit: 50 })
      .then((next) => {
        if (active) setSummary(next);
      })
      .catch((err: unknown) => {
        if (active) setError(describeApiError(err, "Could not load model performance."));
      });
    return () => {
      active = false;
    };
  }, [getPerformanceSummary, days, perfRevision, reloadNonce]);

  const reload = () => setReloadNonce((n) => n + 1);
  const rate = async (input: RateModelRunInput) => {
    await rateModelRun(input);
    reload();
  };

  const categories = (summary?.categories ?? []).filter((c) => c !== ALL_CATEGORIES);
  const activeCategory = categories.includes(category) ? category : ALL_CATEGORIES;
  const kpis = performanceKpis(summary?.overall ?? []);
  const leaderboard = summary === null ? [] : leaderboardFor(summary, activeCategory);
  const runs = (summary?.recentRuns ?? []).filter(
    (run) => activeCategory === ALL_CATEGORIES || run.category === activeCategory,
  );
  const visibleRuns = showAllRuns ? runs : runs.slice(0, RECENT_PREVIEW);
  const summaryText = summary
    ? (summary.summaryLines ?? formatPerformanceSummaryLines(summary)).join("\n")
    : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Pills
          label="Timeframe"
          value={timeframe}
          options={PERF_TIMEFRAMES.map((t) => ({ value: t.label, label: t.label }))}
          onChange={setTimeframe}
        />
        <Button variant="ghost" size="icon" aria-label="Refresh performance" onClick={reload}>
          <Icon icon={RefreshIcon} />
        </Button>
      </div>

      {error !== null && (
        <div className="flex items-center justify-between gap-3 rounded-card bg-danger/10 px-4 py-3 text-label text-danger">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
      )}

      <SettingsGroup className="grid grid-cols-2 divide-y-0 sm:grid-cols-4">
        <Kpi label="Measured runs" value={String(kpis.measuredRuns)} />
        <Kpi label="Rated runs" value={String(kpis.ratedRuns)} />
        <Kpi
          label="Top rated"
          value={kpis.topRated ? `${kpis.topRated.avgScore.toFixed(1)}/10` : "—"}
          {...(kpis.topRated ? { note: kpis.topRated.model } : {})}
        />
        <Kpi
          label="Fastest median"
          value={kpis.fastest ? `${kpis.fastest.medianTokensPerSecond.toFixed(1)} tok/s` : "—"}
          {...(kpis.fastest ? { note: kpis.fastest.model } : {})}
        />
      </SettingsGroup>

      {categories.length > 0 && (
        <Pills
          label="Category"
          value={activeCategory}
          options={[ALL_CATEGORIES, ...categories].map((c) => ({ value: c, label: c }))}
          onChange={setCategory}
        />
      )}

      <SettingsGroup
        title="Leaderboard"
        action={
          summaryText.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => copy("summary", summaryText)}>
              <Icon icon={copied === "summary" ? Tick02Icon : Copy01Icon} />
              {copied === "summary" ? "Copied" : "Copy summary"}
            </Button>
          )
        }
      >
        {leaderboard.length === 0 ? (
          <p className="px-4 py-6 text-label text-fg-muted">
            {summary === null
              ? "Loading model performance…"
              : "No measured runs in this window yet. Finished turns are measured automatically."}
          </p>
        ) : (
          leaderboard.map((stat, index) => {
            const key = `${stat.providerId}:${stat.model}:${stat.category}`;
            return (
              <LeaderboardRow
                key={key}
                stat={stat}
                rank={index + 1}
                copied={copied === key}
                onCopy={() => copy(key, formatModelCategoryLine(stat))}
              />
            );
          })
        )}
      </SettingsGroup>

      {runs.length > 0 && (
        <SettingsGroup
          title="Recent runs"
          action={
            runs.length > RECENT_PREVIEW && (
              <Button variant="ghost" size="sm" onClick={() => setShowAllRuns((v) => !v)}>
                {showAllRuns ? "Show fewer" : `Show all ${runs.length}`}
              </Button>
            )
          }
        >
          {visibleRuns.map((run) => (
            <PerformanceRunRow
              key={run.id}
              run={run}
              defaultCategory={activeCategory === ALL_CATEGORIES ? "" : activeCategory}
              onRate={rate}
              onDelete={() => setPendingDelete(run)}
            />
          ))}
        </SettingsGroup>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete this run?"
        description="It is removed from every leaderboard and average. This cannot be undone."
        confirmLabel="Delete run"
        onConfirm={async () => {
          if (pendingDelete === null) return;
          await deletePerformanceRun(pendingDelete.id);
          reload();
        }}
      />
    </div>
  );
}
