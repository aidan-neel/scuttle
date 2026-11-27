import { Popover } from "@base-ui/react/popover";
import { type KeyboardEvent, useRef, useState } from "react";
import { useCompactAtOverride, writeCompactAtOverride } from "@/components/settings/preferences.ts";
import { cn } from "@/lib/utils";
import {
  clampCompactAt,
  compactAtBounds,
  type ComposerContextUsage,
  type ContextSegmentKey,
  formatTokens,
  parseCompactAtInput,
} from "./contextUsage.ts";

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
  const customCompactAt = useCompactAtOverride(usage.windowTokens);
  const compactAtTokens =
    customCompactAt !== null
      ? clampCompactAt(customCompactAt, usage.windowTokens)
      : usage.compactAtTokens;
  const isCustomized = customCompactAt !== null && compactAtTokens !== usage.compactAtTokens;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const bounds = compactAtBounds(usage.windowTokens);
  const percent = percentOf(usage.usedTokens, compactAtTokens);
  const pastBudget = usage.usedTokens >= compactAtTokens;
  const summary = `${formatTokens(usage.usedTokens)} / ${formatTokens(compactAtTokens)} used (${Math.round(percent)}%)`;

  const openEditor = () => {
    setDraft(formatTokens(compactAtTokens));
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const commitDraft = () => {
    const parsed = parseCompactAtInput(draft, usage.windowTokens);
    if (parsed !== null) {
      writeCompactAtOverride(usage.windowTokens, parsed === usage.compactAtTokens ? null : parsed);
      setDraft(formatTokens(parsed));
    } else {
      setDraft(formatTokens(compactAtTokens));
    }
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
      setEditing(false);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setEditing(false);
    }
  };

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (!open) setEditing(false);
      }}
    >
      <Popover.Trigger
        openOnHover
        delay={120}
        aria-label={`Context window: ${summary}`}
        className="flex size-5 cursor-default items-center justify-center rounded-chip outline-none transition-colors duration-(--dur-hover) hover:bg-(--wash) focus-visible:shadow-focus data-popup-open:bg-(--wash)"
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
            className="w-[min(19rem,calc(100vw-24px))] origin-(--transform-origin) rounded-card bg-menu p-3 shadow-menu outline-none transition-[opacity,scale,translate] duration-180 ease-out-quint data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-110 data-starting-style:translate-y-1 data-starting-style:scale-97 data-starting-style:opacity-0"
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
                  style={{ width: `${percentOf(segment.tokens, compactAtTokens)}%` }}
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
            <div className="mt-2.5 rounded-control shadow-[inset_0_0_0_1px_var(--color-edge)]">
              {editing ? (
                <div className="space-y-2 p-2.5">
                  <div className="flex items-center justify-between gap-2 text-label">
                    <label htmlFor="compact-at-input" className="text-fg-secondary">
                      Compact at
                    </label>
                    <div className="flex items-center gap-1 tabular-nums">
                      <input
                        ref={inputRef}
                        id="compact-at-input"
                        type="text"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commitDraft}
                        onKeyDown={onInputKeyDown}
                        aria-label="Compact at tokens"
                        className="w-16 rounded-[5px] bg-white/[0.07] px-1.5 py-0.5 text-right text-label font-medium text-fg outline-none shadow-[inset_0_0_0_1px_var(--color-edge)] focus:shadow-focus"
                      />
                      <span className="text-fg-muted">/ {formatTokens(usage.windowTokens)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      aria-label="Compact at threshold"
                      min={bounds.min}
                      max={bounds.max}
                      step={bounds.step}
                      value={compactAtTokens}
                      onChange={(event) => {
                        const next = clampCompactAt(Number(event.target.value), usage.windowTokens);
                        writeCompactAtOverride(
                          usage.windowTokens,
                          next === usage.compactAtTokens ? null : next,
                        );
                        setDraft(formatTokens(next));
                      }}
                      className="h-1 flex-1 cursor-pointer accent-primary"
                    />
                    {isCustomized && (
                      <button
                        type="button"
                        onClick={() => {
                          writeCompactAtOverride(usage.windowTokens, null);
                          setDraft(formatTokens(usage.compactAtTokens));
                        }}
                        className="cursor-pointer rounded-[4px] px-1.5 py-0.5 text-meta text-fg-muted transition-colors hover:bg-(--wash) hover:text-fg"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={openEditor}
                  aria-label={`Compact at ${formatTokens(compactAtTokens)} of ${formatTokens(usage.windowTokens)}`}
                  className="flex h-8 w-full cursor-pointer items-center justify-between rounded-control px-2.5 text-label outline-none transition-colors duration-(--dur-hover) hover:bg-(--wash) focus-visible:shadow-focus"
                >
                  <span className="text-fg-secondary">Compact at</span>
                  <span className="tabular-nums">
                    <span className="font-medium text-fg">{formatTokens(compactAtTokens)}</span>
                    <span className="text-fg-muted"> / {formatTokens(usage.windowTokens)}</span>
                  </span>
                </button>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
