export type TriggerChar = "/" | "@";

export interface ComposerTrigger {
  readonly kind: "slash" | "mention";
  readonly query: string;
  readonly start: number;
  readonly end: number;
}

const SLASH_PATTERN = /(^|\s)\/([^\s/]*)$/;
const MENTION_PATTERN = /(^|\s)@([^\s@]*)$/;

export function detectTrigger(text: string, caret: number): ComposerTrigger | null {
  const before = text.slice(0, caret);
  const slash = SLASH_PATTERN.exec(before);
  const mention = slash ? null : MENTION_PATTERN.exec(before);
  const match = slash ?? mention;
  if (!match) return null;
  const query = match[2] ?? "";
  return {
    kind: slash ? "slash" : "mention",
    query,
    start: caret - query.length - 1,
    end: caret,
  };
}

export function formatMention(name: string): string {
  return /\s/.test(name) ? `@"${name}"` : `@${name}`;
}

export function triggerInsertion(textBeforeCaret: string, char: TriggerChar): string {
  return textBeforeCaret.length === 0 || /\s$/.test(textBeforeCaret) ? char : ` ${char}`;
}
