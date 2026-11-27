import { describe, expect, test } from "bun:test";
import { marked, type Token } from "marked";
import {
  createMarkdownStreamCache,
  lexStreamingMarkdown,
  settledStreamingText,
} from "../../../src/components/thread/markdownStream.ts";

interface ComparableToken {
  readonly type: string;
  readonly raw: string;
  readonly text?: string;
  readonly depth?: number;
  readonly itemCount?: number;
  readonly rowCount?: number;
}

const normalizeTokens = (tokens: ReadonlyArray<Token>): ComparableToken[] =>
  tokens
    .filter((token) => token.type !== "space")
    .map((token) => ({
      type: token.type,
      raw: token.raw,
      ...("text" in token && typeof token.text === "string" ? { text: token.text } : {}),
      ...("depth" in token && typeof token.depth === "number" ? { depth: token.depth } : {}),
      ...("items" in token && Array.isArray(token.items) ? { itemCount: token.items.length } : {}),
      ...("rows" in token && Array.isArray(token.rows) ? { rowCount: token.rows.length } : {}),
    }));

const RICH_MARKDOWN = [
  "# Overview",
  "",
  "Intro paragraph with **bold**, *italic*, and `inlineCode()`.",
  "",
  "## Checklist",
  "",
  "- First bullet",
  "- Second bullet",
  "  - Nested detail",
  "",
  "> Blockquote line one",
  "> Blockquote line two",
  "",
  "```ts",
  "export function add(a: number, b: number): number {",
  "  return a + b;",
  "}",
  "```",
  "",
  "| Metric | Target |",
  "| --- | --- |",
  "| FPS | 60 |",
  "| p95 | 15ms |",
  "",
  "---",
  "",
  "Final wrap-up paragraph.",
].join("\n");

describe("markdownStream", () => {
  test("settledStreamingText strips trailing unsettled fence and divider lines", () => {
    expect(settledStreamingText("Hello\n```ts")).toBe("Hello\n");
    expect(settledStreamingText("Hello\n~~~")).toBe("Hello\n");
    expect(settledStreamingText("Hello\n---")).toBe("Hello\n");
    expect(settledStreamingText("Hello\n---\n")).toBe("Hello\n---\n");
    expect(settledStreamingText("Hello\nWorld")).toBe("Hello\nWorld");
  });

  test("lexStreamingMarkdown matches full marked.lexer across 50+ incremental prefixes", () => {
    const cache = createMarkdownStreamCache();
    const stepCount = 60;
    const stepSize = Math.max(1, Math.floor(RICH_MARKDOWN.length / stepCount));
    const prefixes: string[] = [];

    for (let len = stepSize; len < RICH_MARKDOWN.length; len += stepSize) {
      prefixes.push(RICH_MARKDOWN.slice(0, len));
    }
    prefixes.push(RICH_MARKDOWN);

    expect(prefixes.length).toBeGreaterThanOrEqual(50);

    for (const prefix of prefixes) {
      const { settled, tail } = lexStreamingMarkdown(prefix, cache);
      const expected = marked.lexer(settledStreamingText(prefix));
      expect(normalizeTokens([...settled, ...tail])).toEqual(normalizeTokens(expected));
    }

    expect(cache.tokens.length).toBeGreaterThan(0);
    expect(cache.prefixLength).toBeGreaterThan(0);
  });

  test("preserves settled token references across incremental appends", () => {
    const cache = createMarkdownStreamCache();
    const first = lexStreamingMarkdown("# Title\n\nPara 1.\n\nPara 2.\n\nPara 3", cache);
    expect(first.settled.length).toBeGreaterThan(0);
    const snapshot = first.settled;
    const firstTokenRef = snapshot[0];

    const second = lexStreamingMarkdown("# Title\n\nPara 1.\n\nPara 2.\n\nPara 3 growing", cache);
    expect(second.settled).toBe(snapshot);
    expect(second.settled[0]).toBe(firstTokenRef);
  });

  test("falls back to full lexing when reference link definitions appear", () => {
    const cache = createMarkdownStreamCache();
    const beforeDef = "See [example link][ref].\n\nMiddle paragraph.\n\nAnother paragraph.\n\n";
    lexStreamingMarkdown(beforeDef, cache);
    expect(cache.tokens.length).toBeGreaterThan(0);

    const withDef = `${beforeDef}[ref]: https://example.com`;
    const firstDefResult = lexStreamingMarkdown(withDef, cache);
    expect(cache.fullFallback).toBe(true);
    expect(firstDefResult.settled).toEqual([]);

    const paragraph = firstDefResult.tail.find((t) => t.type === "paragraph");
    expect(paragraph).toBeDefined();
    if (paragraph && "tokens" in paragraph && Array.isArray(paragraph.tokens)) {
      const linkToken = paragraph.tokens.find((t) => t.type === "link");
      expect(linkToken).toBeDefined();
      if (linkToken && "href" in linkToken) {
        expect(linkToken.href).toBe("https://example.com");
      }
    }

    const continuedWithDef = `${withDef}\n\nTrailing text.`;
    const secondDefResult = lexStreamingMarkdown(continuedWithDef, cache);
    expect(cache.fullFallback).toBe(true);
    expect(secondDefResult.settled).toEqual([]);
    expect(normalizeTokens(secondDefResult.tail)).toEqual(
      normalizeTokens(marked.lexer(settledStreamingText(continuedWithDef))),
    );
  });

  test("resets cache cleanly when text is replaced with non-matching content", () => {
    const cache = createMarkdownStreamCache();
    lexStreamingMarkdown("# First\n\nBody one.\n\nBody two.\n\nTail", cache);
    expect(cache.tokens.length).toBeGreaterThan(0);

    const replacement = "## Completely different\n\nFresh content.";
    const result = lexStreamingMarkdown(replacement, cache);
    expect(cache.fullFallback).toBe(false);
    expect(normalizeTokens([...result.settled, ...result.tail])).toEqual(
      normalizeTokens(marked.lexer(replacement)),
    );
  });
});
