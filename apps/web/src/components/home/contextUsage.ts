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
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_SYSTEM_CHARS = 48_000;
const DEFAULT_WINDOW_TOKENS = 200_000;
export const COMPACT_BUDGET_RATIO = 0.8;

const CONTEXT_WINDOWS: ReadonlyArray<{ readonly pattern: RegExp; readonly tokens: number }> = [
  { pattern: /\[1m\]|[-_]1m\b|1m-context/i, tokens: 1_000_000 },
  { pattern: /gemini|gpt-4\.1/i, tokens: 1_000_000 },
  { pattern: /gpt-5|codex|\bo[34]\b|\bo[34]-/i, tokens: 400_000 },
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
}: EstimateContextUsageInput): ComposerContextUsage {
  const windowTokens = contextWindowFor(model);
  const segments: ReadonlyArray<ContextSegment> = [
    { key: "system", label: "System prompt", tokens: toTokens(systemChars) },
    {
      key: "tools",
      label: "Tools & activities",
      tokens: toTokens(turns.reduce((sum, turn) => sum + toolChars(turn), 0)),
    },
    {
      key: "conversation",
      label: "Conversation",
      tokens: toTokens(turns.reduce((sum, turn) => sum + conversationChars(turn), 0)),
    },
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

const trimDecimal = (value: number) => value.toFixed(1).replace(/\.0$/, "");
