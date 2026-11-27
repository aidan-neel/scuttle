import { Popover } from "@base-ui/react/popover";
import type { Agent, AgentDelegation, Thread } from "@scuttle/contracts";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useId, useState } from "react";
import { isAgentThread } from "@/lib/agentState.ts";
import { spring } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace.tsx";

const PALETTE = [
  "#60a5fa",
  "#fb923c",
  "#4ade80",
  "#f59e0b",
  "#c084fc",
  "#38bdf8",
  "#2dd4bf",
  "#f472b6",
  "#a78bfa",
  "#f87171",
  "#34d399",
  "#a3e635",
] as const;

const POPUP_CLASS =
  "w-[min(23rem,calc(100vw-1.5rem))] origin-(--transform-origin) rounded-canvas bg-menu p-3 shadow-menu outline-none transition-[opacity,scale,translate] duration-180 ease-out-quint data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-110 data-starting-style:-translate-y-1 data-starting-style:scale-97 data-starting-style:opacity-0";

type CostTab = "thread" | "model";

interface CostEntry {
  readonly id: string;
  readonly label: string;
  readonly subtitle?: string;
  readonly costUsd: number;
  readonly color: string;
  readonly threadId?: Thread["id"];
}

const formatUsd = (amount: number): string => `$${amount.toFixed(2)}`;

const colorAt = (index: number): string => PALETTE[index % PALETTE.length] ?? "#60a5fa";

interface AgentCostPopoverProps {
  readonly agent: Agent;
  readonly primaryThread: Thread;
  readonly delegations: ReadonlyArray<AgentDelegation>;
}

export function AgentCostPopover({ agent, primaryThread, delegations }: AgentCostPopoverProps) {
  const { agents, threads, providers } = useWorkspace();
  const navigate = useNavigate();
  const pillId = useId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<CostTab>("thread");

  const delegatedIds = new Set(delegations.map((d) => d.childThreadId));
  const relatedThreads: ReadonlyArray<Thread> = [
    primaryThread,
    ...threads
      .filter(
        (t) =>
          t.id !== primaryThread.id &&
          !isAgentThread(agents, t.id) &&
          (delegatedIds.has(t.id) || t.projectId === agent.projectId),
      )
      .toSorted(
        (a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.updatedAt.localeCompare(a.updatedAt),
      ),
  ];

  const threadEntries: ReadonlyArray<CostEntry> = relatedThreads.map((t, index) => ({
    id: t.id,
    label: t.id === primaryThread.id ? "This thread" : t.title,
    costUsd: t.costUsd ?? 0,
    color: colorAt(index),
    ...(t.id !== primaryThread.id ? { threadId: t.id } : {}),
  }));

  const modelLabel = (slug: string): string => {
    for (const provider of providers) {
      const found = provider.models.find((m) => m.slug === slug);
      if (found !== undefined) return found.name;
    }
    return slug;
  };

  const modelBuckets = new Map<string, { label: string; subtitle: string; costUsd: number }>();
  for (const t of relatedThreads) {
    const key = `${t.modelSelection.providerKind}:${t.modelSelection.model}:${t.runtime}`;
    const existing = modelBuckets.get(key);
    const add = t.costUsd ?? 0;
    if (existing !== undefined) {
      existing.costUsd += add;
    } else {
      modelBuckets.set(key, {
        label: modelLabel(t.modelSelection.model),
        subtitle: t.runtime === "worktree" ? "Worktree" : "Local",
        costUsd: add,
      });
    }
  }
  const modelEntries: ReadonlyArray<CostEntry> = Array.from(modelBuckets.entries())
    .toSorted(([, a], [, b]) => b.costUsd - a.costUsd)
    .map(([id, item], index) => ({
      id,
      label: item.label,
      subtitle: item.subtitle,
      costUsd: item.costUsd,
      color: colorAt(index),
    }));

  const totalCostUsd = threadEntries.reduce((sum, entry) => sum + entry.costUsd, 0);
  const activeEntries = tab === "thread" ? threadEntries : modelEntries;
  const barEntries = activeEntries.filter((entry) => entry.costUsd > 0);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Agent cost ${formatUsd(totalCostUsd)}`}
        className="inline-flex h-7 cursor-default items-center rounded-chip px-2 text-label font-medium text-fg-muted tabular-nums outline-none transition-colors duration-100 hover:bg-(--wash) hover:text-fg focus-visible:shadow-focus data-popup-open:bg-(--wash) data-popup-open:text-fg"
      >
        {formatUsd(totalCostUsd)}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end" className="z-50 outline-none">
          <Popover.Popup aria-label="Agent cost breakdown" className={POPUP_CLASS}>
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <p className="text-[1.1875rem] leading-tight font-semibold text-fg tabular-nums">
                  {formatUsd(totalCostUsd)}
                </p>
                <p className="mt-0.5 text-meta text-fg-muted">Estimated spend</p>
              </div>
              <span className="text-meta text-fg-muted tabular-nums">
                {relatedThreads.length} {relatedThreads.length === 1 ? "thread" : "threads"}
              </span>
            </div>

            <div className="mt-3 flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-fg/8">
              {totalCostUsd > 0 &&
                barEntries.map((entry) => (
                  <span
                    key={entry.id}
                    style={{
                      width: `${Math.max(2, (entry.costUsd / totalCostUsd) * 100)}%`,
                      backgroundColor: entry.color,
                    }}
                    className="h-full rounded-[1px]"
                  />
                ))}
            </div>

            <div
              role="tablist"
              aria-label="Cost view"
              className="mt-3 grid grid-cols-2 rounded-control bg-canvas p-0.5 shadow-[inset_0_0_0_1px_var(--color-line)]"
            >
              {(
                [
                  { id: "thread", label: "By thread" },
                  { id: "model", label: "Models and runtimes" },
                ] as const
              ).map((item) => {
                const selected = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setTab(item.id)}
                    className={cn(
                      "relative h-7 cursor-pointer rounded-[5px] px-2 text-label font-medium outline-none transition-colors duration-100 active:scale-[0.98] focus-visible:shadow-focus",
                      selected ? "text-fg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {selected && (
                      <motion.span
                        layoutId={`${pillId}-cost-tab`}
                        transition={spring.snappy}
                        aria-hidden
                        className="absolute inset-0 rounded-[5px] bg-selected shadow-raised"
                      />
                    )}
                    <span className="relative z-10">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <ul className="mt-2.5 flex max-h-72 flex-col gap-0.5 overflow-y-auto overscroll-contain pr-0.5">
              {activeEntries.map((entry) => {
                const { threadId } = entry;
                const rowBody = (
                  <>
                    <span
                      aria-hidden
                      style={{
                        backgroundColor: entry.costUsd > 0 ? entry.color : "rgb(255 255 255 / 22%)",
                      }}
                      className="size-2 shrink-0 rounded-full"
                    />
                    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                      <span className="truncate text-label text-fg">{entry.label}</span>
                      {entry.subtitle !== undefined && (
                        <span className="shrink-0 text-meta text-fg-faint">{entry.subtitle}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-right text-label text-fg-secondary tabular-nums">
                      {formatUsd(entry.costUsd)}
                    </span>
                  </>
                );

                return (
                  <li key={entry.id}>
                    {threadId !== undefined ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          void navigate({
                            to: "/threads/$threadId",
                            params: { threadId },
                          });
                        }}
                        className="flex h-8 w-full items-center gap-2 rounded-chip px-1.5 text-left outline-none transition-colors hover:bg-(--wash) focus-visible:shadow-focus"
                      >
                        {rowBody}
                      </button>
                    ) : (
                      <div className="flex h-8 items-center gap-2 rounded-chip px-1.5">
                        {rowBody}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
