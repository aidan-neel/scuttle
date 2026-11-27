import type { Tone, VizComparisonBlock, VizComparisonItem } from "@scuttle/contracts";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { applyVizFilter, statusTone, TONE_BADGE, TONE_DOT, type VizFilter } from "./vizModel.ts";

export interface StatusCount {
  readonly status: string;
  readonly count: number;
  readonly tone: Tone;
}

const CHIP =
  "flex h-6 cursor-pointer items-center gap-1.5 rounded-chip px-2 text-meta outline-none transition-colors duration-(--dur-hover) focus-visible:shadow-focus";

export const comparisonTag = (item: VizComparisonItem, key: string): string | undefined => {
  if (key === "status") return item.status;
  if (key === "group") return item.group;
  if (key === "id") return item.id;
  return undefined;
};

export const statusCounts = (
  items: ReadonlyArray<VizComparisonItem>,
): ReadonlyArray<StatusCount> => {
  const counts = new Map<string, StatusCount>();
  for (const item of items) {
    const seen = counts.get(item.status);
    counts.set(item.status, {
      status: item.status,
      count: (seen?.count ?? 0) + 1,
      tone: seen?.tone ?? statusTone(item.status, item.tone),
    });
  }
  return [...counts.values()];
};

export const comparisonView = (
  items: ReadonlyArray<VizComparisonItem>,
  status: string | null,
  filter: VizFilter | null,
) => {
  const crossed = applyVizFilter(items, filter, comparisonTag).items;
  const visible = status === null ? crossed : crossed.filter((i) => i.status === status);
  const groups = new Map<string, VizComparisonItem[]>();
  for (const item of visible) {
    const key = item.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return { base: crossed, visible, groups: [...groups] };
};

function StatusBadge({ item }: { readonly item: VizComparisonItem }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-chip px-1.5 text-meta font-medium whitespace-nowrap",
        TONE_BADGE[statusTone(item.status, item.tone)],
      )}
    >
      {item.status}
    </span>
  );
}

function ItemCard({
  item,
  open,
  onToggle,
}: {
  readonly item: VizComparisonItem;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={item.detail === undefined ? undefined : open}
      onClick={onToggle}
      className={cn(
        "flex min-w-0 cursor-default flex-col items-stretch gap-2 rounded-row bg-raised p-3.5 text-left shadow-raised outline-none transition-[box-shadow,background-color] duration-(--dur-hover) focus-visible:shadow-[var(--shadow-focus),var(--shadow-raised)]",
        item.detail !== undefined && "cursor-pointer hover:bg-hover",
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="line-clamp-2 text-label font-medium text-fg">{item.title}</span>
          {item.subtitle !== undefined && (
            <span className="truncate text-meta text-fg-muted">{item.subtitle}</span>
          )}
        </span>
        <StatusBadge item={item} />
      </span>
      {item.metric !== undefined && (
        <span className="text-[1.0625rem] leading-6 font-semibold tracking-[-0.01em] text-fg tabular-nums">
          {item.metric}
        </span>
      )}
      {item.detail !== undefined && (
        <span className={cn("text-meta text-fg-muted", !open && "line-clamp-2")}>
          {item.detail}
        </span>
      )}
    </button>
  );
}

function ItemList({
  items,
  columns,
  open,
  onToggle,
}: {
  readonly items: ReadonlyArray<VizComparisonItem>;
  readonly columns: ReadonlyArray<string>;
  readonly open: string | null;
  readonly onToggle: (id: string) => void;
}) {
  const grid = "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(4rem,auto)] gap-4 px-3";
  return (
    <div className="flex flex-col overflow-hidden rounded-row shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div className={cn(grid, "h-8 items-center text-meta font-medium text-fg-muted")}>
        {[0, 1, 2].map((i) => (
          <span key={i} className={cn("truncate", i === 2 && "text-right")}>
            {columns[i] ?? ""}
          </span>
        ))}
      </div>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-expanded={item.detail === undefined ? undefined : open === item.id}
          onClick={() => onToggle(item.id)}
          className="flex cursor-default flex-col border-t border-line py-2 text-left outline-none transition-colors duration-(--dur-hover) hover:bg-(--wash) focus-visible:bg-(--wash-strong)"
        >
          <span className={cn(grid, "items-center")}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-label text-fg">{item.title}</span>
              {item.subtitle !== undefined && (
                <span className="truncate text-meta text-fg-muted">{item.subtitle}</span>
              )}
            </span>
            <span>
              <StatusBadge item={item} />
            </span>
            <span className="text-right text-label font-medium text-fg tabular-nums">
              {item.metric ?? "—"}
            </span>
          </span>
          {open === item.id && item.detail !== undefined && (
            <span className="px-3 pt-1.5 text-meta text-fg-muted">{item.detail}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function VizComparison({
  block,
  filter,
}: {
  readonly block: VizComparisonBlock;
  readonly filter: VizFilter | null;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const view = comparisonView(block.items, status, filter);
  const counts = statusCounts(view.base);
  const toggle = (id: string) => setOpen((current) => (current === id ? null : id));
  const chips = [
    { key: null, label: "All", count: view.base.length, tone: null },
    ...counts.map((c) => ({ key: c.status, label: c.status, count: c.count, tone: c.tone })),
  ];

  return (
    <section className="flex flex-col gap-3">
      {(block.title !== undefined || counts.length > 1) && (
        <header className="flex flex-wrap items-center justify-between gap-2">
          {block.title !== undefined && (
            <h4 className="text-label font-medium text-fg">{block.title}</h4>
          )}
          {counts.length > 1 && (
            <div className="flex flex-wrap items-center gap-1">
              {chips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  aria-pressed={status === chip.key}
                  onClick={() => setStatus(status === chip.key ? null : chip.key)}
                  className={cn(
                    CHIP,
                    status === chip.key
                      ? "bg-selected text-fg"
                      : "text-fg-muted hover:bg-(--wash) hover:text-fg",
                  )}
                >
                  {chip.tone !== null && (
                    <span className={cn("size-1.5 rounded-full", TONE_DOT[chip.tone])} />
                  )}
                  {chip.label}
                  <span className="text-fg-faint tabular-nums">{chip.count}</span>
                </button>
              ))}
            </div>
          )}
        </header>
      )}
      {view.visible.length === 0 && (
        <p className="py-6 text-center text-meta text-fg-faint">Nothing matches</p>
      )}
      {view.groups.map(([group, items]) => (
        <div key={group} className="flex flex-col gap-2">
          {group !== "" && <h5 className="text-meta font-medium text-fg-muted">{group}</h5>}
          {block.columns !== undefined ? (
            <ItemList items={items} columns={block.columns} open={open} onToggle={toggle} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2.5">
              {items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  open={open === item.id}
                  onToggle={() => toggle(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
