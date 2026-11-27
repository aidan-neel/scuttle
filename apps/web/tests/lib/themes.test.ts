import { beforeEach, describe, expect, test } from "bun:test";
import { readPreferences, writePreference } from "../../src/components/settings/preferences.ts";
import { parseSectionId, SECTION_IDS } from "../../src/components/settings/sections.ts";
import { DEFAULT_THEME_ID, getTheme, THEMES } from "../../src/lib/themes.ts";

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe("themes and settings sections", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    });
    if (typeof globalThis.window === "undefined") {
      Object.defineProperty(globalThis, "window", {
        value: {
          dispatchEvent: () => true,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        },
        configurable: true,
        writable: true,
      });
    }
  });

  test("defaults to obsidian and persists theme preference changes", () => {
    expect(readPreferences().theme).toBe(DEFAULT_THEME_ID);
    expect(THEMES.length).toBeGreaterThanOrEqual(4);

    writePreference("theme", "paper");
    expect(readPreferences().theme).toBe("paper");
    expect(getTheme("paper").appearance).toBe("light");

    writePreference("theme", "nord");
    expect(readPreferences().theme).toBe("nord");
    expect(getTheme("nord").appearance).toBe("dark");
  });

  test("removes standalone models section from settings navigation", () => {
    expect((SECTION_IDS as ReadonlyArray<string>).includes("models")).toBe(false);
    expect(parseSectionId("models")).toBeUndefined();
    expect(parseSectionId("providers")).toBe("providers");
  });
});
