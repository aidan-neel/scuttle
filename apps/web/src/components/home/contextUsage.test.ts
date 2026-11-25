/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { contextWindowFor, estimateContextUsage, formatTokens } from "./contextUsage.ts";

const turn = (userMessage: string, assistantMessage: string, detail: string) => ({
  userMessage,
  assistantMessage,
  thinkingText: "",
  activities: [{ label: "Read", detail }],
  approvals: [],
});

describe("estimateContextUsage", () => {
  test("splits tokens into system, tools, and conversation at four chars per token", () => {
    const usage = estimateContextUsage({
      turns: [turn("a".repeat(400), "b".repeat(400), "c".repeat(396))],
      systemChars: 4_000,
      model: "claude-sonnet-4-5",
    });
    expect(usage.segments.map((s) => [s.key, s.tokens])).toEqual([
      ["system", 1_000],
      ["tools", 100],
      ["conversation", 200],
    ]);
    expect(usage.usedTokens).toBe(1_300);
    expect(usage.windowTokens).toBe(200_000);
    expect(usage.compactAtTokens).toBe(160_000);
  });

  test("counts only the system prompt for a thread with no turns", () => {
    const usage = estimateContextUsage({ turns: [], systemChars: 8, model: "x" });
    expect(usage.usedTokens).toBe(2);
  });
});

describe("contextWindowFor", () => {
  test("matches model families by substring, including upstream-prefixed slugs", () => {
    expect(contextWindowFor("claude-opus-4-5[1m]")).toBe(1_000_000);
    expect(contextWindowFor("openai/gpt-5-codex")).toBe(400_000);
    expect(contextWindowFor("google/gemini-2.5-pro")).toBe(1_000_000);
    expect(contextWindowFor("anthropic/claude-sonnet-4")).toBe(200_000);
    expect(contextWindowFor("unknown-model")).toBe(200_000);
  });
});

describe("formatTokens", () => {
  test("abbreviates thousands and millions with one trimmed decimal", () => {
    expect(formatTokens(681)).toBe("681");
    expect(formatTokens(13_600)).toBe("13.6K");
    expect(formatTokens(279_700)).toBe("279.7K");
    expect(formatTokens(400_000)).toBe("400K");
    expect(formatTokens(1_000_000)).toBe("1M");
  });
});
