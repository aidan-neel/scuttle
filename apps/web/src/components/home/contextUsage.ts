import type { TurnUsage } from "@scuttle/contracts";

export type ContextSegmentKey = "system" | "tools" | "conversation";

export interface ContextSegment {
  readonly key: ContextSegmentKey;
  readonly label: string;
  readonly tokens: number;
}

export interface ComposerContextUsage {
  readonly usedTokens: number;
  readonly windowTokens: number;
  readonly compactAtTokens: number;
  readonly segments: ReadonlyArray<ContextSegment>;
}

interface ContextTurn {
  readonly sessionEpoch?: number;
  readonly userMessage: string;
  readonly assistantMessage: string;
  readonly thinkingText: string;
  readonly activities: ReadonlyArray<{ readonly label: string; readonly detail?: string }>;
  readonly approvals: ReadonlyArray<{
    readonly title: string;
    readonly description?: string;
    readonly command?: string;
  }>;
}

interface EstimateContextUsageInput {
  readonly turns: ReadonlyArray<ContextTurn>;
  readonly systemChars?: number;
  readonly model: string;
  readonly lastUsage?: TurnUsage;
  readonly sessionEpoch?: number;
  readonly activeSummary?: string;
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_SYSTEM_CHARS = 48_000;
const DEFAULT_WINDOW_TOKENS = 200_000;
export const COMPACT_BUDGET_RATIO = 0.8;

const CONTEXT_WINDOWS: ReadonlyArray<{ readonly pattern: RegExp; readonly tokens: number }> = [
  { pattern: /\[1m\]|[-_]1m\b|1m-context/i, tokens: 1_000_000 },
  { pattern: /gemini|gpt-4\.1/i, tokens: 1_000_000 },
  { pattern: /gpt-[56]|codex|\bo[34]\b|\bo[34]-/i, tokens: 400_000 },
  { pattern: /claude|opus|sonnet|haiku/i, tokens: 200_000 },
];

export function contextWindowFor(model: string): number {
  return (
    CONTEXT_WINDOWS.find(({ pattern }) => pattern.test(model))?.tokens ?? DEFAULT_WINDOW_TOKENS
  );
}

const toTokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

function toolChars(turn: ContextTurn): number {
  const activities = turn.activities.reduce(
    (sum, activity) => sum + activity.label.length + (activity.detail?.length ?? 0),
    0,
  );
  const approvals = turn.approvals.reduce(
    (sum, approval) =>
      sum +
      approval.title.length +
      (approval.description?.length ?? 0) +
      (approval.command?.length ?? 0),
    0,
  );
  return activities + approvals;
}

function conversationChars(turn: ContextTurn): number {
  return turn.userMessage.length + turn.assistantMessage.length + turn.thinkingText.length;
}

export function estimateContextUsage({
  turns,
  systemChars = DEFAULT_SYSTEM_CHARS,
  model,
  lastUsage,
  sessionEpoch,
  activeSummary,
}: EstimateContextUsageInput): ComposerContextUsage {
  const windowTokens =
    lastUsage?.contextWindowTokens && lastUsage.contextWindowTokens > 0
      ? lastUsage.contextWindowTokens
      : contextWindowFor(model);
  const activeTurns =
    sessionEpoch === undefined
      ? turns
      : turns.filter((turn) => (turn.sessionEpoch ?? 0) === sessionEpoch);
  const summaryChars = activeSummary?.trim().length ?? 0;

  const estSystem = toTokens(systemChars);
  const estTools = toTokens(activeTurns.reduce((sum, turn) => sum + toolChars(turn), 0));
  const estConversation = toTokens(
    summaryChars + activeTurns.reduce((sum, turn) => sum + conversationChars(turn), 0),
  );

  if (lastUsage) {
    const usedTokens =
      lastUsage.inputTokens +
      (lastUsage.cacheReadTokens ?? 0) +
      (lastUsage.cacheCreationTokens ?? 0) +
      lastUsage.outputTokens;
    const estTotal = estSystem + estTools + estConversation;
    const systemTokens =
      usedTokens === 0 || estTotal <= 0
        ? 0
        : Math.min(usedTokens, Math.round((usedTokens * estSystem) / estTotal));
    const toolsTokens =
      usedTokens === 0 || estTotal <= 0
        ? 0
        : Math.min(usedTokens - systemTokens, Math.round((usedTokens * estTools) / estTotal));
    const conversationTokens = Math.max(0, usedTokens - systemTokens - toolsTokens);
    return {
      usedTokens,
      windowTokens,
      compactAtTokens: Math.round(windowTokens * COMPACT_BUDGET_RATIO),
      segments: [
        { key: "system", label: "System prompt", tokens: systemTokens },
        { key: "tools", label: "Tools & activities", tokens: toolsTokens },
        { key: "conversation", label: "Conversation", tokens: conversationTokens },
      ],
    };
  }

  const segments: ReadonlyArray<ContextSegment> = [
    { key: "system", label: "System prompt", tokens: estSystem },
    { key: "tools", label: "Tools & activities", tokens: estTools },
    { key: "conversation", label: "Conversation", tokens: estConversation },
  ];
  return {
    usedTokens: segments.reduce((sum, segment) => sum + segment.tokens, 0),
    windowTokens,
    compactAtTokens: Math.round(windowTokens * COMPACT_BUDGET_RATIO),
    segments,
  };
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${trimDecimal(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${trimDecimal(tokens / 1_000)}K`;
  return String(tokens);
}

export function compactAtBounds(windowTokens: number): {
  readonly min: number;
  readonly max: number;
  readonly step: number;
} {
  const step = windowTokens >= 1_000_000 ? 25_000 : windowTokens >= 400_000 ? 20_000 : 10_000;
  const min = Math.min(
    windowTokens,
    Math.max(step, Math.round((windowTokens * 0.1) / step) * step),
  );
  return { min, max: windowTokens, step };
}

export function clampCompactAt(tokens: number, windowTokens: number): number {
  const { min, max } = compactAtBounds(windowTokens);
  return Math.min(max, Math.max(min, Math.round(tokens)));
}

export function parseCompactAtInput(raw: string, windowTokens: number): number | null {
  const cleaned = raw.trim().replace(/,/g, "");
  if (cleaned.length === 0) return null;
  const match = /^(\d+(?:\.\d+)?)\s*(k|m|%)?$/i.exec(cleaned);
  if (match === null) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const suffix = match[2]?.toLowerCase();
  const rawTokens =
    suffix === "%"
      ? (windowTokens * numeric) / 100
      : suffix === "m"
        ? numeric * 1_000_000
        : suffix === "k"
          ? numeric * 1_000
          : numeric;
  return clampCompactAt(rawTokens, windowTokens);
}

const trimDecimal = (value: number) => value.toFixed(1).replace(/\.0$/, "");
