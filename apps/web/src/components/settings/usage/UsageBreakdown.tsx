import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import type {
  ProviderKind,
  UsageGranularity,
  UsageModelSummary,
  UsageProviderSummary,
  UsageTimePoint,
} from "@scuttle/contracts";
import { motion } from "motion/react";
import { useId, useState } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { spring } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";
import { SettingsGroup } from "../primitives.tsx";
import {
  formatSessions,
  formatShare,
  formatTokens,
  formatUsd,
  PROVIDER_META,
} from "./usageFormat.ts";

export function UsageProvidersCard({
  providers,
  onSelectProvider,
}: {
  readonly providers: ReadonlyArray<UsageProviderSummary>;
  readonly onSelectProvider: (provider: ProviderKind) => void;
}) {
  if (providers.length === 0) return null;
  const maxTokens = Math.max(1, providers[0]?.processedTokens ?? 1);

  return (
    <SettingsGroup title="Providers">
      {providers.map((entry) => {
        const meta = PROVIDER_META[entry.providerKind];
        const barPct = Math.max(1, (entry.processedTokens / maxTokens) * 100);
        return (
          <button
            key={entry.providerKind}
            type="button"
            onClick={() => onSelectProvider(entry.providerKind)}
            className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors duration-(--dur-hover) hover:bg-white/[0.03] active:bg-white/[0.05] focus-visible:shadow-[inset_0_0_0_2px_rgb(235_235_236/42%)]"
          >
            <span
              aria-hidden
              skullet-block=""
              style={{ backgroundColor: meta.color }}
              className="size-2 shrink-0 rounded-full"
            />
            <span
              skullet-block=""
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px]"
            >
              <BrandLogo brand={entry.providerKind} className="size-4 shrink-0" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-body font-medium text-fg">{meta.label}</span>
                <span className="shrink-0 text-meta text-fg-muted tabular-nums">
                  {formatSessions(entry.sessions)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-meta text-fg-muted tabular-nums">
                <span>{formatShare(entry.share)}</span>
                <span aria-hidden className="text-fg-faint">
                  ·
                </span>
                <span>{formatUsd(entry.costUsd)}</span>
              </div>
              <div
                skullet-block=""
                className="mt-1.5 h-[2px] w-full overflow-hidden rounded-full bg-white/[0.05]"
              >
                <div
                  style={{ width: `${barPct}%`, backgroundColor: meta.color }}
                  className="h-full rounded-full opacity-80 transition-[width] duration-200 ease-out-quint"
                />
              </div>
            </div>
            <span className="shrink-0 text-right text-body font-semibold text-fg tabular-nums">
              {formatTokens(entry.processedTokens)}
            </span>
          </button>
        );
      })}
    </SettingsGroup>
  );
}

type BreakdownTab = "model" | "time";
type SortColumn = "name" | "cost" | "share" | "tokens";
type SortDirection = "asc" | "desc";

function SortHeaderButton({
  label,
  column,
  activeColumn,
  direction,
  align = "right",
  className,
  onToggle,
}: {
  readonly label: string;
  readonly column: SortColumn;
  readonly activeColumn: SortColumn;
  readonly direction: SortDirection;
  readonly align?: "left" | "right";
  readonly className?: string;
  readonly onToggle: (column: SortColumn) => void;
}) {
  const active = activeColumn === column;
  return (
    <button
      type="button"
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      onClick={() => onToggle(column)}
      className={cn(
        "group inline-flex cursor-pointer items-center gap-1 rounded-chip py-0.5 text-meta font-medium outline-none transition-colors duration-(--dur-hover) focus-visible:shadow-focus",
        align === "right" ? "justify-end" : "justify-start",
        active ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
        className,
      )}
    >
      {align === "right" && (
        <Icon
          icon={ArrowDown01Icon}
          className={cn(
            "size-3 shrink-0 transition-[transform,opacity] duration-150 ease-out",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-45",
            active && direction === "asc" && "rotate-180",
          )}
        />
      )}
      <span>{label}</span>
      {align === "left" && (
        <Icon
          icon={ArrowDown01Icon}
          className={cn(
            "size-3 shrink-0 transition-[transform,opacity] duration-150 ease-out",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-45",
            active && direction === "asc" && "rotate-180",
          )}
        />
      )}
    </button>
  );
}

export function UsageBreakdownCard({
  models,
  series,
  granularity,
  isSample = false,
}: {
  readonly models: ReadonlyArray<UsageModelSummary>;
  readonly series: ReadonlyArray<UsageTimePoint>;
  readonly granularity: UsageGranularity;
  readonly isSample?: boolean;
}) {
  const pillId = useId();
  const [tab, setTab] = useState<BreakdownTab>("model");
  const [expanded, setExpanded] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>("tokens");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const handleTabChange = (nextTab: BreakdownTab) => {
    setTab(nextTab);
    setExpanded(false);
    if (nextTab === "time") {
      setSortColumn("name");
      setSortDirection("desc");
    } else {
      setSortColumn("tokens");
      setSortDirection("desc");
    }
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortColumn(column);
      setSortDirection(column === "name" && tab === "model" ? "asc" : "desc");
    }
  };

  const dirMul = sortDirection === "asc" ? 1 : -1;

  const sortedModels = models.toSorted((a, b) => {
    switch (sortColumn) {
      case "name":
        return a.model.localeCompare(b.model) * dirMul;
      case "cost":
        return (a.costUsd - b.costUsd) * dirMul || b.processedTokens - a.processedTokens;
      case "share":
        return (a.share - b.share) * dirMul;
      case "tokens":
        return (a.processedTokens - b.processedTokens) * dirMul;
    }
  });
  const visibleModels = expanded ? sortedModels : sortedModels.slice(0, 8);
  const maxModelTokens = Math.max(
    1,
    models.reduce((max, item) => Math.max(max, item.processedTokens), 0),
  );

  const activeSeries = series.filter((s) => s.processedTokens > 0);
  const totalSeriesTokens = Math.max(
    1,
    activeSeries.reduce((sum, item) => sum + item.processedTokens, 0),
  );
  const maxSeriesTokens = Math.max(
    1,
    activeSeries.reduce((max, item) => Math.max(max, item.processedTokens), 0),
  );
  const sortedSeries = activeSeries.toSorted((a, b) => {
    switch (sortColumn) {
      case "name":
        return a.bucket.localeCompare(b.bucket) * dirMul;
      case "cost":
        return (a.costUsd - b.costUsd) * dirMul || b.processedTokens - a.processedTokens;
      case "share":
      case "tokens":
        return (a.processedTokens - b.processedTokens) * dirMul;
    }
  });
  const visibleSeries = expanded ? sortedSeries : sortedSeries.slice(0, 10);

  const timeLabel = granularity === "hour" ? "Hour" : "Day";

  return (
    <SettingsGroup
      title="Breakdown"
      action={
        <div
          role="tablist"
          aria-label="Breakdown view"
          className="inline-flex rounded-control bg-canvas p-0.5 shadow-[inset_0_0_0_1px_var(--color-line)]"
        >
          {(
            [
              { id: "model", label: "Model" },
              { id: "time", label: timeLabel },
            ] as const
          ).map((item) => {
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => handleTabChange(item.id)}
                className={cn(
                  "relative h-6 cursor-pointer rounded-[5px] px-2.5 text-meta font-medium outline-none transition-colors duration-(--dur-hover) active:scale-[0.98] focus-visible:shadow-focus",
                  selected ? "text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {selected &&
                  (isSample ? (
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-[5px] bg-selected shadow-raised"
                    />
                  ) : (
                    <motion.span
                      layoutId={`${pillId}-breakdown-tab`}
                      transition={spring.snappy}
                      aria-hidden
                      className="absolute inset-0 rounded-[5px] bg-selected shadow-raised"
                    />
                  ))}
                <span className="relative z-10">{item.label}</span>
              </button>
            );
          })}
        </div>
      }
    >
      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_3.5rem_4.5rem] items-center gap-2 bg-white/[0.02] px-4 py-2 sm:grid-cols-[1.25rem_minmax(0,1fr)_4.75rem_3.5rem_4.5rem]">
        <span className="text-meta font-medium text-fg-faint">#</span>
        <SortHeaderButton
          label={tab === "model" ? "Model" : timeLabel}
          column="name"
          activeColumn={sortColumn}
          direction={sortDirection}
          align="left"
          onToggle={handleSort}
        />
        <SortHeaderButton
          label="Cost"
          column="cost"
          activeColumn={sortColumn}
          direction={sortDirection}
          className="hidden sm:inline-flex"
          onToggle={handleSort}
        />
        <SortHeaderButton
          label="Share"
          column="share"
          activeColumn={sortColumn}
          direction={sortDirection}
          onToggle={handleSort}
        />
        <SortHeaderButton
          label="Tokens"
          column="tokens"
          activeColumn={sortColumn}
          direction={sortDirection}
          onToggle={handleSort}
        />
      </div>

      {tab === "model" ? (
        visibleModels.length === 0 ? (
          <div className="px-4 py-6 text-center text-label text-fg-muted">
            No model activity in this period.
          </div>
        ) : (
          <>
            {visibleModels.map((entry, idx) => {
              const meta = PROVIDER_META[entry.providerKind];
              const barPct = Math.max(1, (entry.processedTokens / maxModelTokens) * 100);
              return (
                <div
                  key={`${entry.providerKind}:${entry.model}`}
                  className="grid grid-cols-[1.25rem_minmax(0,1fr)_3.5rem_4.5rem] items-center gap-2 px-4 py-2.5 transition-colors duration-(--dur-hover) hover:bg-white/[0.02] sm:grid-cols-[1.25rem_minmax(0,1fr)_4.75rem_3.5rem_4.5rem]"
                >
                  <span className="text-meta text-fg-faint tabular-nums">{idx + 1}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        skullet-block=""
                        className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px]"
                      >
                        <BrandLogo brand={entry.providerKind} className="size-3.5 shrink-0" />
                      </span>
                      <span title={entry.model} className="truncate font-mono text-label text-fg">
                        {entry.model}
                      </span>
                    </div>
                    <div
                      skullet-block=""
                      className="mt-1.5 h-[2px] w-full max-w-[13.75rem] overflow-hidden rounded-full bg-white/[0.05]"
                    >
                      <div
                        style={{ width: `${barPct}%`, backgroundColor: meta.color }}
                        className="h-full rounded-full opacity-80 transition-[width] duration-200 ease-out-quint"
                      />
                    </div>
                  </div>
                  <span className="hidden text-right text-label text-fg-secondary tabular-nums sm:block">
                    {formatUsd(entry.costUsd)}
                  </span>
                  <span className="text-right text-meta text-fg-muted tabular-nums">
                    {formatShare(entry.share)}
                  </span>
                  <span className="text-right text-label font-medium text-fg tabular-nums">
                    {formatTokens(entry.processedTokens)}
                  </span>
                </div>
              );
            })}
            {sortedModels.length > 8 && (
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="w-full cursor-pointer px-4 py-2 text-center text-meta font-medium text-fg-muted transition-colors hover:bg-white/[0.025] hover:text-fg"
              >
                {expanded ? "Show fewer models" : `Show all ${sortedModels.length} models`}
              </button>
            )}
          </>
        )
      ) : visibleSeries.length === 0 ? (
        <div className="px-4 py-6 text-center text-label text-fg-muted">
          No activity in this period.
        </div>
      ) : (
        <>
          {visibleSeries.map((point, idx) => {
            const share = point.processedTokens / totalSeriesTokens;
            const barPct = Math.max(1, (point.processedTokens / maxSeriesTokens) * 100);
            const leadProvider = point.byProvider[0]?.providerKind;
            const barColor = leadProvider ? PROVIDER_META[leadProvider].color : "#d97757";
            return (
              <div
                key={point.bucket}
                className="grid grid-cols-[1.25rem_minmax(0,1fr)_3.5rem_4.5rem] items-center gap-2 px-4 py-2.5 transition-colors duration-(--dur-hover) hover:bg-white/[0.02] sm:grid-cols-[1.25rem_minmax(0,1fr)_4.75rem_3.5rem_4.5rem]"
              >
                <span className="text-meta text-fg-faint tabular-nums">{idx + 1}</span>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-label font-medium text-fg tabular-nums">
                      {point.label}
                    </span>
                    <span className="text-meta text-fg-faint tabular-nums">
                      {formatSessions(point.sessions)}
                    </span>
                  </div>
                  <div
                    skullet-block=""
                    className="mt-1.5 h-[2px] w-full max-w-[13.75rem] overflow-hidden rounded-full bg-white/[0.05]"
                  >
                    <div
                      style={{ width: `${barPct}%`, backgroundColor: barColor }}
                      className="h-full rounded-full opacity-80 transition-[width] duration-200 ease-out-quint"
                    />
                  </div>
                </div>
                <span className="hidden text-right text-label text-fg-secondary tabular-nums sm:block">
                  {formatUsd(point.costUsd)}
                </span>
                <span className="text-right text-meta text-fg-muted tabular-nums">
                  {formatShare(share)}
                </span>
                <span className="text-right text-label font-medium text-fg tabular-nums">
                  {formatTokens(point.processedTokens)}
                </span>
              </div>
            );
          })}
          {sortedSeries.length > 10 && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="w-full cursor-pointer px-4 py-2 text-center text-meta font-medium text-fg-muted transition-colors hover:bg-white/[0.025] hover:text-fg"
            >
              {expanded ? "Show fewer rows" : `Show all ${sortedSeries.length} rows`}
            </button>
          )}
        </>
      )}
    </SettingsGroup>
  );
}
