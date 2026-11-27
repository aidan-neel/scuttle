import type { ProviderKind, UsageTimePoint } from "@scuttle/contracts";
import { useId } from "react";
import { formatAxisTokens, formatTokens, PROVIDER_META } from "./usageFormat.ts";

interface Point {
  readonly x: number;
  readonly y: number;
}

const CHART_WIDTH = 560;
const CHART_HEIGHT = 160;
const PAD_LEFT = 42;
const PAD_RIGHT = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const PLOT_W = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

const niceMax = (rawMax: number): number => {
  if (rawMax <= 0) return 1000;
  const exp = 10 ** Math.floor(Math.log10(rawMax));
  const scaled = rawMax / exp;
  const step = scaled <= 1.2 ? 1.5 : scaled <= 2 ? 2 : scaled <= 3 ? 3 : scaled <= 5 ? 5 : 10;
  return step * exp;
};

// Monotone cubic Hermite spline (Fritsch-Carlson) so area curves never overshoot below zero.
const monotoneLinePath = (pts: ReadonlyArray<Point>): string => {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)}`;
  const n = pts.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dxi = pts[i + 1]!.x - pts[i]!.x;
    const dyi = pts[i + 1]!.y - pts[i]!.y;
    dx.push(dxi);
    dy.push(dyi);
    m.push(dxi !== 0 ? dyi / dxi : 0);
  }

  const tangents = Array.from({ length: n }, () => 0);
  tangents[0] = m[0] ?? 0;
  tangents[n - 1] = m[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i += 1) {
    const mPrev = m[i - 1]!;
    const mNext = m[i]!;
    tangents[i] = mPrev * mNext <= 0 ? 0 : (mPrev + mNext) / 2;
  }

  for (let i = 0; i < n - 1; i += 1) {
    const mi = m[i]!;
    if (Math.abs(mi) < 1e-9) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const alpha = tangents[i]! / mi;
    const beta = tangents[i + 1]! / mi;
    const sumSq = alpha * alpha + beta * beta;
    if (sumSq > 9) {
      const tau = 3 / Math.sqrt(sumSq);
      tangents[i] = tau * alpha * mi;
      tangents[i + 1] = tau * beta * mi;
    }
  }

  const baseY = PAD_TOP + PLOT_H;
  const clampY = (y: number) => Math.max(PAD_TOP, Math.min(baseY, y));

  let d = `M ${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const h = dx[i]!;
    const c1x = p0.x + h / 3;
    const c1y = clampY(p0.y + (tangents[i]! * h) / 3);
    const c2x = p1.x - h / 3;
    const c2y = clampY(p1.y - (tangents[i + 1]! * h) / 3);
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  return d;
};

const areaPath = (lineD: string, pts: ReadonlyArray<Point>): string => {
  if (pts.length === 0 || lineD.length === 0) return "";
  const baseY = (PAD_TOP + PLOT_H).toFixed(1);
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  return `${lineD} L ${last.x.toFixed(1)} ${baseY} L ${first.x.toFixed(1)} ${baseY} Z`;
};

interface UsageChartProps {
  readonly series: ReadonlyArray<UsageTimePoint>;
  readonly providers: ReadonlyArray<ProviderKind>;
  readonly hoveredIndex: number | null;
  readonly onHoverIndex: (index: number | null) => void;
}

export function UsageChart({ series, providers, hoveredIndex, onHoverIndex }: UsageChartProps) {
  const uid = useId().replace(/:/g, "");
  const count = series.length;
  if (count === 0) return null;

  const activeProviders: ReadonlyArray<ProviderKind> =
    providers.length > 0 ? providers : ["claude"];

  let peak = 0;
  for (const point of series) {
    for (const p of activeProviders) {
      const found = point.byProvider.find((entry) => entry.providerKind === p);
      if (found && found.processedTokens > peak) {
        peak = found.processedTokens;
      }
    }
    if (point.byProvider.length === 0 && point.processedTokens > peak) {
      peak = point.processedTokens;
    }
  }
  const yMax = niceMax(peak);
  const yTicks = [0, yMax / 3, (yMax * 2) / 3, yMax];

  const xAt = (idx: number): number =>
    count <= 1 ? PAD_LEFT + PLOT_W / 2 : PAD_LEFT + (idx / (count - 1)) * PLOT_W;
  const yAt = (val: number): number => PAD_TOP + PLOT_H - (Math.max(0, val) / yMax) * PLOT_H;

  const providerLines = activeProviders.map((providerKind) => {
    const pts: Point[] = series.map((point, idx) => {
      const match = point.byProvider.find((entry) => entry.providerKind === providerKind);
      return { x: xAt(idx), y: yAt(match?.processedTokens ?? 0) };
    });
    const lineD = monotoneLinePath(pts);
    return {
      providerKind,
      color: PROVIDER_META[providerKind].color,
      pts,
      lineD,
      areaD: areaPath(lineD, pts),
    };
  });

  const xLabelIndices =
    count <= 3 ? series.map((_, idx) => idx) : [0, Math.floor((count - 1) / 2), count - 1];

  const handlePointer = (clientX: number, rect: DOMRect) => {
    if (rect.width <= 0) return;
    const relX = ((clientX - rect.left) / rect.width) * CHART_WIDTH;
    const clamped = Math.max(PAD_LEFT, Math.min(PAD_LEFT + PLOT_W, relX));
    const ratio = (clamped - PAD_LEFT) / PLOT_W;
    const idx = count <= 1 ? 0 : Math.round(ratio * (count - 1));
    if (idx !== hoveredIndex) {
      onHoverIndex(Math.max(0, Math.min(count - 1, idx)));
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (count === 0) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onHoverIndex(hoveredIndex === null ? 0 : Math.min(count - 1, hoveredIndex + 1));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onHoverIndex(hoveredIndex === null ? count - 1 : Math.max(0, hoveredIndex - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      onHoverIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onHoverIndex(count - 1);
    } else if (event.key === "Escape") {
      onHoverIndex(null);
    }
  };

  const activePoint = hoveredIndex !== null ? (series[hoveredIndex] ?? null) : null;
  const activeTickX =
    hoveredIndex !== null
      ? Math.max(PAD_LEFT + 22, Math.min(PAD_LEFT + PLOT_W - 22, xAt(hoveredIndex)))
      : 0;

  return (
    <div className="w-full px-3 pt-1 pb-2">
      <svg
        role="img"
        tabIndex={0}
        aria-label={
          activePoint !== null
            ? `${activePoint.label}: ${formatTokens(activePoint.processedTokens)} tokens`
            : "Processed tokens over time. Use left and right arrow keys to inspect individual periods."
        }
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-[10.25rem] w-full cursor-crosshair touch-pan-y select-none overflow-visible rounded-chip outline-none focus-visible:shadow-focus"
        onPointerDown={(event) => {
          handlePointer(event.clientX, event.currentTarget.getBoundingClientRect());
        }}
        onPointerMove={(event) => {
          handlePointer(event.clientX, event.currentTarget.getBoundingClientRect());
        }}
        onPointerLeave={() => onHoverIndex(null)}
        onBlur={() => onHoverIndex(null)}
        onKeyDown={handleKeyDown}
      >
        <defs>
          {providerLines.map((line) => (
            <linearGradient
              key={line.providerKind}
              id={`${uid}-${line.providerKind}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={line.color} stopOpacity="0.26" />
              <stop offset="100%" stopColor={line.color} stopOpacity="0.01" />
            </linearGradient>
          ))}
        </defs>

        {yTicks.map((tick, idx) => {
          const y = yAt(tick);
          return (
            <g key={idx}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={PAD_LEFT + PLOT_W}
                y2={y}
                stroke={idx === 0 ? "rgb(255 255 255 / 11%)" : "rgb(255 255 255 / 5%)"}
                strokeWidth="1"
              />
              <text
                x={PAD_LEFT - 7}
                y={y + 3.5}
                textAnchor="end"
                fill="var(--color-fg-faint)"
                fontSize="10"
                className="font-mono tabular-nums"
              >
                {formatAxisTokens(tick)}
              </text>
            </g>
          );
        })}

        {providerLines.map((line) => (
          <g key={line.providerKind}>
            <path d={line.areaD} fill={`url(#${uid}-${line.providerKind})`} />
            <path
              d={line.lineD}
              fill="none"
              stroke={line.color}
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ))}

        {xLabelIndices.map((idx) => {
          const item = series[idx];
          if (!item) return null;
          const x = xAt(idx);
          const anchor = idx === 0 ? "start" : idx === count - 1 ? "end" : "middle";
          const overlapsActive = activePoint !== null && Math.abs(x - activeTickX) < 46;
          return (
            <text
              key={item.bucket}
              x={x}
              y={CHART_HEIGHT - 5}
              textAnchor={anchor}
              fill="var(--color-fg-faint)"
              fontSize="10"
              opacity={overlapsActive ? 0 : activePoint !== null ? 0.35 : 1}
              className="font-mono uppercase transition-opacity duration-100"
            >
              {item.label}
            </text>
          );
        })}

        {hoveredIndex !== null && activePoint !== null && (
          <g className="pointer-events-none">
            <line
              x1={xAt(hoveredIndex)}
              y1={PAD_TOP}
              x2={xAt(hoveredIndex)}
              y2={PAD_TOP + PLOT_H}
              stroke="rgb(255 255 255 / 22%)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
            {providerLines.map((line) => {
              const pt = line.pts[hoveredIndex];
              if (!pt) return null;
              return (
                <g key={line.providerKind}>
                  <circle cx={pt.x} cy={pt.y} r="6.5" fill={line.color} opacity="0.2" />
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r="3.2"
                    fill={line.color}
                    stroke="var(--color-panel)"
                    strokeWidth="1.5"
                  />
                </g>
              );
            })}
            <text
              x={activeTickX}
              y={CHART_HEIGHT - 5}
              textAnchor="middle"
              fill="var(--color-fg-secondary)"
              fontSize="10"
              className="font-mono font-medium uppercase"
            >
              {activePoint.label}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
