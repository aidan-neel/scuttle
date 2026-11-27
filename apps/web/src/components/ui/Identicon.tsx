import {
  DEFAULT_IDENTICON_STYLE,
  dicebearIdenticonUrl,
  IDENTICON_GRID,
  IDENTICON_STYLE_IDS,
  IDENTICON_STYLE_LABELS,
  type IdenticonStyle,
  identicon,
} from "@scuttle/shared/identicon";
import { useSyncExternalStore } from "react";
import type { PickerOption } from "@/components/ui/Picker.tsx";
import { cn } from "@/lib/utils";

const MAX_CONSECUTIVE_FAILURES = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
const failedUrls = new Map<string, number>();
const listeners = new Set<() => void>();
let consecutiveFailures = 0;
let disabledUntil = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
let failureVersion = 0;

function notifyListeners(): void {
  failureVersion += 1;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getFailureVersion(): number {
  return failureVersion;
}

function getServerFailureVersion(): number {
  return 0;
}

function clearCooldownTimer(): void {
  if (cooldownTimer !== null) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
}

function scheduleRecoveryTimer(now: number): void {
  clearCooldownTimer();
  let nextWake = disabledUntil > now ? disabledUntil : Number.POSITIVE_INFINITY;
  for (const failedAt of failedUrls.values()) {
    const expiresAt = failedAt + CIRCUIT_BREAKER_COOLDOWN_MS;
    if (expiresAt < nextWake) {
      nextWake = expiresAt;
    }
  }
  if (!Number.isFinite(nextWake)) return;
  const delayMs = Math.max(1, nextWake - now);
  cooldownTimer = setTimeout(() => {
    cooldownTimer = null;
    const tickNow = Date.now();
    let changed = false;
    if (disabledUntil > 0 && tickNow >= disabledUntil) {
      disabledUntil = 0;
      consecutiveFailures = 0;
      changed = true;
    }
    for (const [url, failedAt] of failedUrls) {
      if (tickNow - failedAt >= CIRCUIT_BREAKER_COOLDOWN_MS) {
        failedUrls.delete(url);
        changed = true;
      }
    }
    scheduleRecoveryTimer(tickNow);
    if (changed) {
      notifyListeners();
    }
  }, delayMs);
}

function isUrlFailed(url: string, now: number): boolean {
  const failedAt = failedUrls.get(url);
  return failedAt !== undefined && now - failedAt < CIRCUIT_BREAKER_COOLDOWN_MS;
}

function recordLoadSuccess(url: string): void {
  const removed = failedUrls.delete(url);
  const wasDisabled = disabledUntil > 0;
  consecutiveFailures = 0;
  disabledUntil = 0;
  scheduleRecoveryTimer(Date.now());
  if (removed || wasDisabled) {
    notifyListeners();
  }
}

function recordLoadFailure(url: string): void {
  const now = Date.now();
  if (isUrlFailed(url, now)) return;
  failedUrls.set(url, now);
  consecutiveFailures += 1;
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    disabledUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS;
  }
  scheduleRecoveryTimer(now);
  notifyListeners();
}

const SIZES = {
  sm: { box: 16, radius: 4, classes: "size-4 rounded-[0.25rem]" },
  md: { box: 24, radius: 6, classes: "size-6 rounded-chip" },
  lg: { box: 32, radius: 8, classes: "size-8 rounded-row" },
  xl: { box: 56, radius: 14, classes: "size-14 rounded-dialog" },
} as const;

interface IdenticonProps {
  name: string;
  size: keyof typeof SIZES;
  style?: IdenticonStyle | undefined;
  className?: string;
}

function FallbackIdenticon({ name, size, className }: IdenticonProps) {
  const { box, radius, classes } = SIZES[size];
  const { foreground, background, cells } = identicon(name);
  const pad = box * 0.18;
  const cell = (box - pad * 2) / IDENTICON_GRID;

  return (
    <svg
      aria-hidden
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      className={cn("shrink-0", classes, className)}
    >
      <rect width={box} height={box} rx={radius} fill={background} />
      {cells.flatMap((row, y) =>
        row.map((on, x) =>
          on ? (
            <rect
              key={`${x}-${y}`}
              x={pad + x * cell}
              y={pad + y * cell}
              width={cell}
              height={cell}
              fill={foreground}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

export function Identicon({
  name,
  size,
  style = DEFAULT_IDENTICON_STYLE,
  className,
}: IdenticonProps) {
  const { box, classes } = SIZES[size];
  const url = dicebearIdenticonUrl(name, style);
  useSyncExternalStore(subscribe, getFailureVersion, getServerFailureVersion);

  if (disabledUntil > 0 || failedUrls.has(url)) {
    return (
      <FallbackIdenticon
        name={name}
        size={size}
        {...(className !== undefined ? { className } : {})}
      />
    );
  }

  return (
    <img
      src={url}
      alt=""
      aria-hidden
      width={box}
      height={box}
      loading="lazy"
      decoding="async"
      onLoad={() => recordLoadSuccess(url)}
      onError={() => recordLoadFailure(url)}
      className={cn("shrink-0 bg-fg/[0.06] object-cover select-none", classes, className)}
    />
  );
}

export function identiconStyleOptions(seed: string): ReadonlyArray<PickerOption<IdenticonStyle>> {
  return IDENTICON_STYLE_IDS.map((styleId) => ({
    value: styleId,
    label: IDENTICON_STYLE_LABELS[styleId],
    icon: <Identicon name={seed} style={styleId} size="sm" className="size-3.5" />,
  }));
}
