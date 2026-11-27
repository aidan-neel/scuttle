/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  clampCompactAt,
  compactAtBounds,
  contextWindowFor,
  estimateContextUsage,
  formatTokens,
  parseCompactAtInput,
} from "../../../src/components/home/contextUsage.ts";

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

  test("prefers real lastUsage tokens and contextWindowTokens when present", () => {
    const usage = estimateContextUsage({
      turns: [turn("a".repeat(400), "b".repeat(400), "c".repeat(396))],
      systemChars: 4_000,
      model: "claude-sonnet-4-5",
      lastUsage: {
        inputTokens: 10_000,
        outputTokens: 2_000,
        cacheReadTokens: 35_000,
        cacheCreationTokens: 3_000,
        contextWindowTokens: 1_000_000,
      },
    });
    expect(usage.usedTokens).toBe(50_000);
    expect(usage.windowTokens).toBe(1_000_000);
    expect(usage.compactAtTokens).toBe(800_000);
    expect(usage.segments.reduce((sum, s) => sum + s.tokens, 0)).toBe(50_000);
  });

  test("scopes fallback char estimation to active sessionEpoch plus activeSummary", () => {
    const oldTurn = { ...turn("old ".repeat(200), "old ".repeat(200), ""), sessionEpoch: 0 };
    const newTurn = {
      ...turn("a".repeat(400), "b".repeat(400), ""),
      activities: [],
      sessionEpoch: 1,
    };
    const usage = estimateContextUsage({
      turns: [oldTurn, newTurn],
      systemChars: 4_000,
      model: "claude-sonnet-4-5",
      sessionEpoch: 1,
      activeSummary: "s".repeat(400),
    });
    expect(usage.segments.find((s) => s.key === "system")?.tokens).toBe(1_000);
    expect(usage.segments.find((s) => s.key === "conversation")?.tokens).toBe(300);
    expect(usage.usedTokens).toBe(1_300);
  });
});

describe("contextWindowFor", () => {
  test("matches model families by substring, including upstream-prefixed slugs and gpt-6", () => {
    expect(contextWindowFor("claude-opus-4-5[1m]")).toBe(1_000_000);
    expect(contextWindowFor("openai/gpt-5-codex")).toBe(400_000);
    expect(contextWindowFor("openai/gpt-6-codex")).toBe(400_000);
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

describe("parseCompactAtInput", () => {
  test("parses K, M, raw integers, and percentages clamped to window bounds", () => {
    expect(parseCompactAtInput("120K", 200_000)).toBe(120_000);
    expect(parseCompactAtInput("400k", 1_000_000)).toBe(400_000);
    expect(parseCompactAtInput("0.5M", 1_000_000)).toBe(500_000);
    expect(parseCompactAtInput("150,000", 200_000)).toBe(150_000);
    expect(parseCompactAtInput("60%", 200_000)).toBe(120_000);
    expect(parseCompactAtInput("999M", 200_000)).toBe(200_000);
    expect(parseCompactAtInput("1k", 200_000)).toBe(compactAtBounds(200_000).min);
    expect(clampCompactAt(500_000, 200_000)).toBe(200_000);
    expect(parseCompactAtInput("nope", 200_000)).toBeNull();
    expect(parseCompactAtInput("", 200_000)).toBeNull();
  });
});
