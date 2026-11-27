import type { VizFlowBlock, VizFlowEdge, VizFlowNode } from "@scuttle/contracts";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";
import { TONE_BADGE, TONE_DOT } from "./vizModel.ts";

export const FLOW_NODE = { w: 150, h: 52 } as const;
const GAP = { horizontal: { rank: 44, lane: 14 }, vertical: { rank: 40, lane: 14 } } as const;
const LOOP = 40;

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface PlacedNode extends Point {
  readonly node: VizFlowNode;
  readonly depth: number;
}

export interface RoutedEdge {
  readonly edge: VizFlowEdge;
  readonly d: string;
  readonly label: Point;
  readonly back: boolean;
}

export interface FlowLayout {
  readonly nodes: ReadonlyArray<PlacedNode>;
  readonly edges: ReadonlyArray<RoutedEdge>;
  readonly width: number;
  readonly height: number;
}

export const flowDepths = (
  nodes: ReadonlyArray<VizFlowNode>,
  edges: ReadonlyArray<VizFlowEdge>,
) => {
  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const out = new Map<string, VizFlowEdge[]>();
  for (const e of valid) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const targets = new Set(valid.map((e) => e.to));
  const order = [...nodes.filter((n) => !targets.has(n.id)), ...nodes].map((n) => n.id);
  const state = new Map<string, "open" | "done">();
  const back = new Set<VizFlowEdge>();
  const post: string[] = [];
  const visit = (id: string) => {
    state.set(id, "open");
    for (const e of out.get(id) ?? []) {
      const seen = state.get(e.to);
      if (seen === "open") back.add(e);
      else if (seen === undefined) visit(e.to);
    }
    state.set(id, "done");
    post.push(id);
  };
  for (const id of order) if (!state.has(id)) visit(id);
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  for (const id of post.toReversed()) {
    for (const e of out.get(id) ?? []) {
      if (!back.has(e)) depth.set(e.to, Math.max(depth.get(e.to) ?? 0, (depth.get(id) ?? 0) + 1));
    }
  }
  return { depth, back, valid };
};

const route = (a: Point, b: Point, vertical: boolean, back: boolean) => {
  const { w, h } = FLOW_NODE;
  if (!vertical && !back) {
    const [sx, sy, tx, ty] = [a.x + w, a.y + h / 2, b.x, b.y + h / 2];
    const mx = (sx + tx) / 2;
    return {
      d: `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`,
      label: { x: mx, y: (sy + ty) / 2 },
    };
  }
  if (vertical && !back) {
    const [sx, sy, tx, ty] = [a.x + w / 2, a.y + h, b.x + w / 2, b.y];
    const my = (sy + ty) / 2;
    return {
      d: `M${sx},${sy} C${sx},${my} ${tx},${my} ${tx},${ty}`,
      label: { x: (sx + tx) / 2, y: my },
    };
  }
  if (!vertical) {
    const [sx, sy, tx, ty] = [a.x + w / 2, a.y + h, b.x + w / 2, b.y + h];
    const by = Math.max(sy, ty) + LOOP;
    return {
      d: `M${sx},${sy} C${sx},${by} ${tx},${by} ${tx},${ty}`,
      label: { x: (sx + tx) / 2, y: by - 10 },
    };
  }
  const [sx, sy, tx, ty] = [a.x + w, a.y + h / 2, b.x + w, b.y + h / 2];
  const bx = Math.max(sx, tx) + LOOP;
  return {
    d: `M${sx},${sy} C${bx},${sy} ${bx},${ty} ${tx},${ty}`,
    label: { x: bx - 10, y: (sy + ty) / 2 },
  };
};

export const layoutFlow = (block: VizFlowBlock): FlowLayout => {
  const vertical = block.direction === "vertical";
  const { depth, back, valid } = flowDepths(block.nodes, block.edges);
  const ranks: VizFlowNode[][] = [];
  for (const node of block.nodes) (ranks[depth.get(node.id) ?? 0] ??= []).push(node);
  const lanes = Math.max(1, ...ranks.map((r) => r.length));
  const gap = vertical ? GAP.vertical : GAP.horizontal;
  const rankStep = (vertical ? FLOW_NODE.h : FLOW_NODE.w) + gap.rank;
  const laneStep = (vertical ? FLOW_NODE.w : FLOW_NODE.h) + gap.lane;
  const pos = new Map<string, Point>();
  const nodes = ranks.flatMap((rank, r) =>
    (rank ?? []).map((node, k) => {
      const lane = (k + (lanes - rank.length) / 2) * laneStep;
      const p = vertical ? { x: lane, y: r * rankStep } : { x: r * rankStep, y: lane };
      pos.set(node.id, p);
      return { node, depth: r, ...p };
    }),
  );
  const edges = valid.flatMap((edge) => {
    const a = pos.get(edge.from);
    const b = pos.get(edge.to);
    return a && b ? [{ edge, back: back.has(edge), ...route(a, b, vertical, back.has(edge)) }] : [];
  });
  const rankSpan = Math.max(1, ranks.length) * rankStep - gap.rank;
  const laneSpan = lanes * laneStep - gap.lane;
  const loop = back.size > 0 ? LOOP + 4 : 0;
  return vertical
    ? { nodes, edges, width: laneSpan + loop, height: rankSpan }
    : { nodes, edges, width: rankSpan, height: laneSpan + loop };
};

export const flowNeighbors = (edges: ReadonlyArray<VizFlowEdge>, id: string) => ({
  incoming: edges.filter((e) => e.to === id).map((e) => e.from),
  outgoing: edges.filter((e) => e.from === id).map((e) => e.to),
});

export const toggleNode = (current: string | null, id: string): string | null =>
  current === id ? null : id;

function NeighborChips({
  label,
  ids,
  names,
  onSelect,
}: {
  readonly label: string;
  readonly ids: ReadonlyArray<string>;
  readonly names: ReadonlyMap<string, string>;
  readonly onSelect: (id: string) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-10 text-meta text-fg-faint">{label}</span>
      {ids.map((id) => (
        <Button key={id} type="button" variant="outline" size="sm" onClick={() => onSelect(id)}>
          {names.get(id) ?? id}
        </Button>
      ))}
    </div>
  );
}

export function VizFlow({ block }: { readonly block: VizFlowBlock }) {
  const [selected, setSelected] = useState<string | null>(null);
  const marker = `viz-arrow-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const layout = layoutFlow(block);
  const names = new Map(block.nodes.map((n) => [n.id, n.label]));
  const current = block.nodes.find((n) => n.id === selected) ?? null;
  const links =
    current === null
      ? null
      : flowNeighbors(
          layout.edges.map((e) => e.edge),
          current.id,
        );
  const lit = (id: string) =>
    links === null ||
    id === current?.id ||
    links.incoming.includes(id) ||
    links.outgoing.includes(id);
  const hot = (e: VizFlowEdge) =>
    current !== null && (e.from === current.id || e.to === current.id);

  return (
    <section className="flex flex-col gap-3">
      {block.title !== undefined && (
        <h4 className="text-label font-medium text-fg">{block.title}</h4>
      )}
      <div className="overflow-x-auto pt-2 pb-1">
        <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
          <svg
            width={layout.width}
            height={layout.height}
            className="absolute inset-0 overflow-visible"
            aria-hidden
          >
            <defs>
              {["idle", "hot"].map((kind) => (
                <marker
                  key={kind}
                  id={`${marker}-${kind}`}
                  viewBox="0 0 8 8"
                  refX={7}
                  refY={4}
                  markerWidth={7}
                  markerHeight={7}
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path
                    d="M0,0.5 L7.5,4 L0,7.5 z"
                    className={kind === "hot" ? "fill-primary" : "fill-fg-faint"}
                  />
                </marker>
              ))}
            </defs>
            {layout.edges.map(({ edge, d, label }, i) => {
              const active = hot(edge);
              return (
                <g
                  key={`${edge.from}->${edge.to}:${i}`}
                  className={cn(
                    "transition-opacity duration-(--dur-hover)",
                    current !== null && !active && "opacity-30",
                  )}
                >
                  <path
                    d={d}
                    markerEnd={`url(#${marker}-${active ? "hot" : "idle"})`}
                    strokeDasharray={edge.dashed === true ? "4 4" : undefined}
                    className={cn(
                      "fill-none stroke-[1.5]",
                      active ? "stroke-primary" : "stroke-fg-faint",
                    )}
                  />
                  {edge.label !== undefined && (
                    <text
                      x={label.x}
                      y={label.y}
                      dy="-0.55em"
                      textAnchor="middle"
                      className="fill-fg-muted stroke-panel text-[10.5px] font-medium [paint-order:stroke] [stroke-width:6px]"
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {layout.nodes.map(({ node, x, y }) => (
            <button
              key={node.id}
              type="button"
              aria-pressed={selected === node.id}
              onClick={() => setSelected(toggleNode(selected, node.id))}
              style={{ left: x, top: y, width: FLOW_NODE.w, height: FLOW_NODE.h }}
              className={cn(
                "absolute flex cursor-pointer flex-col justify-center gap-0.5 rounded-row bg-raised px-3 text-left outline-none transition-[opacity,box-shadow,background-color] duration-(--dur-hover) hover:bg-hover focus-visible:shadow-[var(--shadow-focus),var(--shadow-raised)]",
                selected === node.id
                  ? "shadow-[inset_0_0_0_1.5px_var(--color-primary),var(--shadow-raised)]"
                  : "shadow-raised",
                !lit(node.id) && "opacity-40",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {node.tone !== undefined && (
                  <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[node.tone])} />
                )}
                <span className="truncate text-label font-medium text-fg">{node.label}</span>
              </span>
              {node.sublabel !== undefined && (
                <span className="truncate text-meta text-fg-muted">{node.sublabel}</span>
              )}
              {node.badge !== undefined && (
                <span
                  className={cn(
                    "absolute -top-2.5 right-2 flex h-4 items-center rounded-chip bg-panel px-1.5 text-[0.65rem] font-medium shadow-raised",
                    node.tone === undefined ? "text-fg-secondary" : TONE_BADGE[node.tone],
                  )}
                >
                  {node.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      {current !== null && links !== null && (
        <div className="relative flex flex-col gap-2 rounded-row bg-(--wash) p-3.5 pr-10 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close details"
            onClick={() => setSelected(null)}
            className="absolute top-2.5 right-2.5"
          >
            <Icon icon={Cancel01Icon} />
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {current.tone !== undefined && (
              <span className={cn("size-2 rounded-full", TONE_DOT[current.tone])} />
            )}
            <span className="text-label font-medium text-fg">{current.label}</span>
            {current.badge !== undefined && (
              <span className="rounded-chip bg-(--wash-strong) px-1.5 text-meta text-fg-secondary">
                {current.badge}
              </span>
            )}
            {current.group !== undefined && (
              <span className="text-meta text-fg-faint">{current.group}</span>
            )}
          </div>
          {current.sublabel !== undefined && (
            <p className="text-meta text-fg-muted">{current.sublabel}</p>
          )}
          {current.detail !== undefined && (
            <p className="text-label whitespace-pre-wrap text-fg-secondary">{current.detail}</p>
          )}
          <NeighborChips label="From" ids={links.incoming} names={names} onSelect={setSelected} />
          <NeighborChips label="To" ids={links.outgoing} names={names} onSelect={setSelected} />
        </div>
      )}
    </section>
  );
}
