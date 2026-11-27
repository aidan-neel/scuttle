import { marked, type Token } from "marked";

const UNSETTLED_LINE = /^ {0,3}(?:`+[^`\n]*|~{3,}.*|[-=]+ *)$/;

export const settledStreamingText = (text: string): string => {
  const lineStart = text.lastIndexOf("\n") + 1;
  return UNSETTLED_LINE.test(text.slice(lineStart)) ? text.slice(0, lineStart) : text;
};

export interface MarkdownStreamCache {
  prefixLength: number;
  rawPrefix: string;
  tokens: Token[];
  fullFallback: boolean;
}

export const createMarkdownStreamCache = (): MarkdownStreamCache => ({
  prefixLength: 0,
  rawPrefix: "",
  tokens: [],
  fullFallback: false,
});

const resetCache = (cache: MarkdownStreamCache): void => {
  cache.prefixLength = 0;
  cache.rawPrefix = "";
  cache.tokens = [];
  cache.fullFallback = false;
};

export function lexStreamingMarkdown(
  text: string,
  cache: MarkdownStreamCache,
): { readonly settled: ReadonlyArray<Token>; readonly tail: ReadonlyArray<Token> } {
  const rawSettled = settledStreamingText(text);
  // marked normalizes CRLF/CR to LF before populating token.raw, so match that coordinate space.
  const settledInput = rawSettled.includes("\r") ? rawSettled.replace(/\r\n?/g, "\n") : rawSettled;

  if (cache.fullFallback || !settledInput.startsWith(cache.rawPrefix)) {
    resetCache(cache);
  }

  const tailTokens = marked.lexer(settledInput.slice(cache.prefixLength));

  if (tailTokens.some((token) => token.type === "def")) {
    const fullTokens = cache.prefixLength === 0 ? tailTokens : marked.lexer(settledInput);
    resetCache(cache);
    cache.fullFallback = true;
    return { settled: cache.tokens, tail: fullTokens };
  }

  if (tailTokens.length >= 3) {
    const promoteCount = tailTokens.length - 2;
    const promoted = tailTokens.slice(0, promoteCount);
    for (const token of promoted) {
      cache.prefixLength += token.raw.length;
    }
    cache.tokens = cache.tokens.concat(promoted);
    cache.rawPrefix = settledInput.slice(0, cache.prefixLength);
    return {
      settled: cache.tokens,
      tail: tailTokens.slice(promoteCount),
    };
  }

  return {
    settled: cache.tokens,
    tail: tailTokens,
  };
}
