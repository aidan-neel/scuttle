import { Popover } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";
import { type ComposerContextUsage, type ContextSegmentKey, formatTokens } from "./contextUsage.ts";

const SEGMENT_COLOR: Record<ContextSegmentKey, string> = {
  system: "bg-fg-muted",
  tools: "bg-claude",
  conversation: "bg-primary",
};

const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const percentOf = (part: number, whole: number) =>
  whole <= 0 ? 0 : Math.min(100, (part / whole) * 100);

export function ComposerContextPopover({ usage }: { readonly usage: ComposerContextUsage }) {
  const percent = percentOf(usage.usedTokens, usage.windowTokens);
  const pastBudget = usage.usedTokens >= usage.compactAtTokens;
  const summary = `${formatTokens(usage.usedTokens)} / ${formatTokens(usage.windowTokens)} used (${Math.round(percent)}%)`;

  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={120}
        aria-label={`Context window: ${summary}`}
        className="flex size-6 cursor-default items-center justify-center rounded-chip outline-none transition-colors duration-(--dur-hover) hover:bg-(--wash) focus-visible:shadow-focus data-popup-open:bg-(--wash)"
      >
        <svg viewBox="0 0 20 20" className="size-4 -rotate-90" aria-hidden>
          <circle
            cx="10"
            cy="10"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="2"
            className="stroke-edge-strong"
          />
          <circle
            cx="10"
            cy="10"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - percent / 100)}
            className={cn(
              "transition-[stroke-dashoffset] duration-300 ease-out",
              pastBudget ? "stroke-warning" : "stroke-fg-muted",
            )}
          />
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={8} className="z-50 outline-none">
          <Popover.Popup
            aria-label="Context window"
            className="w-[min(18rem,calc(100vw-24px))] origin-(--transform-origin) rounded-card bg-menu p-3 shadow-menu outline-none transition-[opacity,scale,translate] duration-180 ease-out-quint data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-110 data-starting-style:translate-y-1 data-starting-style:scale-97 data-starting-style:opacity-0"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body font-medium text-fg">Context</span>
              <span className="text-label tabular-nums text-fg-muted">{summary}</span>
            </div>
            <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-white/8">
              {usage.segments.map((segment) => (
                <span
                  key={segment.key}
                  className={SEGMENT_COLOR[segment.key]}
                  style={{ width: `${percentOf(segment.tokens, usage.windowTokens)}%` }}
                />
              ))}
            </div>
            <ul className="mt-2.5 space-y-1">
              {usage.segments.map((segment) => (
                <li key={segment.key} className="flex h-6 items-center gap-2 text-label">
                  <span
                    className={cn("size-2 shrink-0 rounded-full", SEGMENT_COLOR[segment.key])}
                  />
                  <span className="min-w-0 flex-1 truncate text-fg-secondary">{segment.label}</span>
                  <span className="tabular-nums text-fg-muted">{formatTokens(segment.tokens)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2.5 flex h-8 items-center justify-between rounded-control px-2.5 text-label shadow-[inset_0_0_0_1px_var(--color-edge)]">
              <span className="text-fg-secondary">Compact at</span>
              <span className="tabular-nums">
                <span className="font-medium text-fg">{formatTokens(usage.compactAtTokens)}</span>
                <span className="text-fg-muted"> / {formatTokens(usage.windowTokens)}</span>
              </span>
            </div>
            <p className="mt-2 text-meta text-fg-faint">Estimated from thread text.</p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
