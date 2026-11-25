export type ComposerTrigger =
  | { readonly kind: "slash"; readonly query: string }
  | {
      readonly kind: "mention";
      readonly query: string;
      readonly start: number;
      readonly end: number;
    };

export interface TextEdit {
  readonly text: string;
  readonly caret: number;
}

const SLASH_PATTERN = /^\/(\S*)$/;
const MENTION_PATTERN = /(^|\s)@([^\s@]*)$/;

export function detectTrigger(text: string, caret: number): ComposerTrigger | null {
  const slash = SLASH_PATTERN.exec(text);
  if (slash) return { kind: "slash", query: slash[1] ?? "" };
  const match = MENTION_PATTERN.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[2] ?? "";
  return { kind: "mention", query, start: caret - query.length - 1, end: caret };
}

export function triggerKey(trigger: ComposerTrigger): string {
  return trigger.kind === "slash" ? "slash" : `mention:${trigger.start}`;
}

export function formatMention(name: string): string {
  return /\s/.test(name) ? `@"${name}"` : `@${name}`;
}

export function replaceMention(
  text: string,
  trigger: { readonly start: number; readonly end: number },
  token: string,
): TextEdit {
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end).replace(/^ /, "");
  const insertion = `${token} `;
  return { text: before + insertion + after, caret: before.length + insertion.length };
}

export function insertMentionTrigger(text: string, caret: number): TextEdit {
  const before = text.slice(0, caret);
  const prefix = before.length === 0 || /\s$/.test(before) ? "@" : " @";
  return { text: before + prefix + text.slice(caret), caret: caret + prefix.length };
}
