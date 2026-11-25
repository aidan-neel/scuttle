import type { EffortLevel, InteractionMode, RuntimeMode } from "@scuttle/contracts";

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export const RUNTIME_MODE_LABELS: Record<RuntimeMode, string> = {
  auto: "Auto",
  "approval-required": "Ask",
  "full-access": "Full Access",
};

export const INTERACTION_MODE_LABELS: Record<InteractionMode, string> = {
  default: "Build",
  plan: "Plan",
};

export const formatRelativeAge = (iso: string | undefined, nowMs = Date.now()): string => {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 60) return "now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
};

export const formatElapsedSeconds = (ms: number): string => {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem === 0 ? `${mins}m` : `${mins}m ${rem}s`;
};
