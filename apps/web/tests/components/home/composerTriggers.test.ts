/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  detectTrigger,
  formatMention,
  triggerInsertion,
} from "../../../src/components/home/composerTriggers.ts";

describe("detectTrigger", () => {
  test("opens the slash menu for a command word at the start or mid-sentence", () => {
    expect(detectTrigger("/pl", 3)).toEqual({ kind: "slash", query: "pl", start: 0, end: 3 });
    expect(detectTrigger("/", 1)).toEqual({ kind: "slash", query: "", start: 0, end: 1 });
    expect(detectTrigger("hey /go", 7)).toEqual({ kind: "slash", query: "go", start: 4, end: 7 });
    expect(detectTrigger("/scuttle:go", 11)).toEqual({
      kind: "slash",
      query: "scuttle:go",
      start: 0,
      end: 11,
    });
  });

  test("ignores slashes inside paths and closes once whitespace follows the command", () => {
    expect(detectTrigger("/usr/local", 10)).toBeNull();
    expect(detectTrigger("see apps/web", 12)).toBeNull();
    expect(detectTrigger("/plan now", 9)).toBeNull();
    expect(detectTrigger("/plan ", 6)).toBeNull();
  });

  test("reads only the text before the caret", () => {
    expect(detectTrigger("/sk fix the bug", 3)).toEqual({
      kind: "slash",
      query: "sk",
      start: 0,
      end: 3,
    });
    expect(detectTrigger("@ab then", 2)).toEqual({ kind: "mention", query: "a", start: 0, end: 2 });
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

  test("ignores @ inside a word and stale triggers behind the caret", () => {
    expect(detectTrigger("me@example", 10)).toBeNull();
    expect(detectTrigger("@a then more", 12)).toBeNull();
  });
});

describe("formatMention", () => {
  test("quotes names that contain whitespace", () => {
    expect(formatMention("Fix login bug")).toBe('@"Fix login bug"');
    expect(formatMention("src/app")).toBe("@src/app");
  });
});

describe("triggerInsertion", () => {
  test("adds a separating space only when the caret follows a word", () => {
    expect(triggerInsertion("", "@")).toBe("@");
    expect(triggerInsertion("hello ", "@")).toBe("@");
    expect(triggerInsertion("hello", "@")).toBe(" @");
    expect(triggerInsertion("hello", "/")).toBe(" /");
  });
});
