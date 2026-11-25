/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  detectTrigger,
  formatMention,
  insertMentionTrigger,
  replaceMention,
} from "./composerTriggers.ts";

describe("detectTrigger", () => {
  test("opens the slash menu for a single command word", () => {
    expect(detectTrigger("/pl", 3)).toEqual({ kind: "slash", query: "pl" });
    expect(detectTrigger("/", 1)).toEqual({ kind: "slash", query: "" });
  });

  test("closes the slash menu once the text has a space or a newline", () => {
    expect(detectTrigger("/plan now", 9)).toBeNull();
    expect(detectTrigger("/plan\n", 6)).toBeNull();
  });

  test("opens the mention menu for @ at the start or after whitespace", () => {
    expect(detectTrigger("@", 1)).toEqual({ kind: "mention", query: "", start: 0, end: 1 });
    expect(detectTrigger("ask @siv", 8)).toEqual({
      kind: "mention",
      query: "siv",
      start: 4,
      end: 8,
    });
  });

  test("ignores @ inside a word and reads the trigger at the caret", () => {
    expect(detectTrigger("me@example", 10)).toBeNull();
    expect(detectTrigger("@a then more", 12)).toBeNull();
    expect(detectTrigger("@ab then", 2)).toEqual({ kind: "mention", query: "a", start: 0, end: 2 });
  });
});

describe("mention editing", () => {
  test("replaces the typed query with the mention token and a trailing space", () => {
    expect(replaceMention("ask @si please", { start: 4, end: 7 }, "@Sivir")).toEqual({
      text: "ask @Sivir please",
      caret: 11,
    });
  });

  test("quotes names that contain whitespace", () => {
    expect(formatMention("Fix login bug")).toBe('@"Fix login bug"');
    expect(formatMention("src/app")).toBe("@src/app");
  });

  test("inserts @ at the caret with a separating space mid-word", () => {
    expect(insertMentionTrigger("", 0)).toEqual({ text: "@", caret: 1 });
    expect(insertMentionTrigger("hello", 5)).toEqual({ text: "hello @", caret: 7 });
    expect(insertMentionTrigger("hello ", 6)).toEqual({ text: "hello @", caret: 7 });
  });
});
