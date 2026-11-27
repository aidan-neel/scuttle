import type { Tone, VizCell, VizTableBlock, VizTableColumn, VizTableRow } from "@scuttle/contracts";
import { ArrowDown01Icon, ArrowUp01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";
import {
  applyVizFilter,
  formatVizNumber,
  statusTone,
  TONE_BADGE,
  type VizFilter,
} from "./vizModel.ts";

export type SortDir = "asc" | "desc";
export interface TableSort {
  readonly key: string;
  readonly dir: SortDir;
}
export interface TableControls {
  readonly query: string;
  readonly sort: TableSort | null;
  readonly pill: string | null;
}

const TONE_EDGE: Record<Tone, string> = {
  neutral: "",
  primary: "shadow-[inset_2px_0_0_var(--color-primary)]",
  success: "shadow-[inset_2px_0_0_var(--color-success)]",
  warning: "shadow-[inset_2px_0_0_var(--color-warning)]",
  danger: "shadow-[inset_2px_0_0_var(--color-danger)]",
};

const PILL =
  "flex h-6 cursor-pointer items-center gap-1.5 rounded-chip px-2 text-meta outline-none transition-colors duration-(--dur-hover) focus-visible:shadow-focus";

export const rowTag = (row: VizTableRow, key: string): VizCell | undefined =>
  row.filterTags?.[key] ?? row.cells[key];

export const nextSort = (current: TableSort | null, key: string): TableSort | null => {
  if (current?.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
};

const compareCells = (a: VizCell | undefined, b: VizCell | undefined): number => {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
};

export const sortRows = (rows: ReadonlyArray<VizTableRow>, sort: TableSort | null) => {
  if (sort === null) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows.toSorted((a, b) => sign * compareCells(a.cells[sort.key], b.cells[sort.key]));
};

export const searchRows = (rows: ReadonlyArray<VizTableRow>, query: string) => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return rows;
  return rows.filter((row) =>
    [...Object.values(row.cells), row.detail ?? ""].some((v) =>
      String(v).toLowerCase().includes(needle),
    ),
  );
};

export const pillCounts = (rows: ReadonlyArray<VizTableRow>, column: string | undefined) => {
  if (column === undefined) return [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row.cells[column];
    if (value !== undefined) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count }));
};

export const tableView = (
  block: VizTableBlock,
  controls: TableControls,
  filter: VizFilter | null,
) => {
  const crossed = applyVizFilter(block.rows, filter, rowTag);
  const column = block.filterColumn;
  const pilled =
    controls.pill === null || column === undefined
      ? crossed.items
      : crossed.items.filter((row) => String(row.cells[column]) === controls.pill);
  return {
    base: crossed.items,
    rows: sortRows(searchRows(pilled, controls.query), controls.sort),
    crossFiltered: crossed.applied,
  };
};

function Cell({
  column,
  row,
  max,
}: {
  readonly column: VizTableColumn;
  readonly row: VizTableRow;
  readonly max: number;
}) {
  const value = row.cells[column.key];
  if (value === undefined) return <span className="text-fg-faint">—</span>;
  const text = typeof value === "number" ? formatVizNumber(value) : value;
  switch (column.kind ?? (typeof value === "number" ? "number" : "text")) {
    case "badge":
      return (
        <span
          className={cn(
            "inline-flex h-5 items-center rounded-chip px-1.5 text-meta font-medium whitespace-nowrap",
            TONE_BADGE[statusTone(text, row.tone)],
          )}
        >
          {text}
        </span>
      );
    case "bar": {
      const frac = typeof value === "number" && max > 0 ? Math.max(0, value) / max : 0;
      return (
        <span className="flex items-center justify-end gap-2.5">
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-(--wash-strong)">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${frac * 100}%` }}
            />
          </span>
          <span className="w-12 text-right text-fg tabular-nums">{text}</span>
        </span>
      );
    }
    case "code":
      return (
        <code className="rounded-chip bg-(--wash) px-1 py-px font-mono text-[0.78rem] text-fg-secondary">
          {text}
        </code>
      );
    case "number":
      return <span className="text-fg tabular-nums">{text}</span>;
    case "text":
      return <span className="text-fg-secondary">{text}</span>;
  }
}

export function VizTable({
  block,
  filter,
}: {
  readonly block: VizTableBlock;
  readonly filter: VizFilter | null;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TableSort | null>(null);
  const [pill, setPill] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const view = tableView(block, { query, sort, pill }, filter);
  const pills = pillCounts(view.base, block.filterColumn);
  const searchable = block.searchable ?? block.rows.length > 8;
  const maxes = new Map(
    block.columns.map((c) => [
      c.key,
      block.rows.reduce((max, r) => {
        const v = r.cells[c.key];
        return typeof v === "number" && v > max ? v : max;
      }, 0),
    ]),
  );
  const right = (c: VizTableColumn) =>
    (c.align ?? (c.kind === "number" || c.kind === "bar" ? "right" : "left")) === "right";

  return (
    <section className="flex flex-col gap-2.5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        {block.title !== undefined && (
          <h4 className="text-label font-medium text-fg">{block.title}</h4>
        )}
        <span className="text-meta text-fg-faint tabular-nums">
          {view.rows.length === block.rows.length
            ? `${block.rows.length} rows`
            : `${view.rows.length} of ${block.rows.length}`}
        </span>
      </header>
      {(searchable || pills.length > 1) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchable && (
            <label className="flex h-7 w-52 items-center gap-1.5 rounded-control bg-(--wash) px-2 shadow-[inset_0_0_0_1px_var(--color-edge)] focus-within:shadow-[inset_0_0_0_1px_var(--color-edge-strong)]">
              <Icon icon={Search01Icon} className="size-3.5 shrink-0 text-fg-faint" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search rows"
                className="min-w-0 flex-1 bg-transparent text-label text-fg outline-none placeholder:text-fg-faint"
              />
            </label>
          )}
          {pills.length > 1 &&
            [
              { value: null, label: "All", count: view.base.length },
              ...pills.map((p) => ({ ...p, label: p.value })),
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                aria-pressed={pill === p.value}
                onClick={() => setPill(pill === p.value ? null : p.value)}
                className={cn(
                  PILL,
                  pill === p.value
                    ? "bg-selected text-fg"
                    : "text-fg-muted hover:bg-(--wash) hover:text-fg",
                )}
              >
                {p.label}
                <span className="text-fg-faint tabular-nums">{p.count}</span>
              </button>
            ))}
        </div>
      )}
      <div className="max-h-[28rem] overflow-auto rounded-row shadow-[inset_0_0_0_1px_var(--color-line)]">
        <table className="w-full border-collapse text-label">
          <thead className="sticky top-0 z-[1] bg-panel shadow-[inset_0_-1px_0_var(--color-line)]">
            <tr>
              {block.columns.map((c) => {
                const active = sort?.key === c.key ? sort.dir : null;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={
                      active === null ? "none" : active === "asc" ? "ascending" : "descending"
                    }
                    className={cn("h-8 px-3 font-normal", right(c) ? "text-right" : "text-left")}
                  >
                    <button
                      type="button"
                      onClick={() => setSort(nextSort(sort, c.key))}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1 rounded-chip text-meta font-medium outline-none hover:text-fg focus-visible:shadow-focus",
                        active === null ? "text-fg-muted" : "text-fg",
                      )}
                    >
                      {c.label}
                      <Icon
                        icon={active === "desc" ? ArrowDown01Icon : ArrowUp01Icon}
                        className={cn("size-3", active === null && "opacity-0")}
                      />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => {
              const expanded = open === row.id;
              const toggle = () => setOpen(expanded ? null : row.id);
              const expandable = row.detail !== undefined;
              return [
                <tr
                  key={row.id}
                  aria-expanded={expandable ? expanded : undefined}
                  tabIndex={expandable ? 0 : undefined}
                  onClick={expandable ? toggle : undefined}
                  onKeyDown={(e) => {
                    if (expandable && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      toggle();
                    }
                  }}
                  className={cn(
                    "border-t border-line outline-none transition-colors duration-(--dur-hover) first:border-t-0 hover:bg-(--wash) focus-visible:bg-(--wash-strong)",
                    expandable && "cursor-pointer",
                    expanded && "bg-(--wash)",
                    TONE_EDGE[row.tone ?? "neutral"],
                  )}
                >
                  {block.columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn("h-9 px-3 align-middle", right(c) && "text-right")}
                    >
                      <Cell column={c} row={row} max={maxes.get(c.key) ?? 0} />
                    </td>
                  ))}
                </tr>,
                expanded && expandable ? (
                  <tr key={`${row.id}:detail`} className="bg-(--wash)">
                    <td
                      colSpan={block.columns.length}
                      className="px-3 pt-0.5 pb-3 text-label whitespace-pre-wrap text-fg-secondary"
                    >
                      {row.detail}
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
        {view.rows.length === 0 && (
          <p className="py-6 text-center text-meta text-fg-faint">No rows match</p>
        )}
      </div>
    </section>
  );
}
