import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";
import {
  applyTheme,
  DEFAULT_THEME_ID,
  getTheme,
  type ThemeDefinition,
  ThemeId,
} from "@/lib/themes.ts";

const STORAGE_KEY = "scuttle.preferences.v1";
const CHANGE_EVENT = "scuttle:preferences-changed";

export const EnterBehavior = Schema.Literals(["enter", "mod-enter"]);
export type EnterBehavior = typeof EnterBehavior.Type;

export const ActiveTurnDispatch = Schema.Literals(["steer", "queue"]);
export type ActiveTurnDispatch = typeof ActiveTurnDispatch.Type;

const StoredPreferences = Schema.Struct({
  enterBehavior: Schema.optionalKey(EnterBehavior),
  activeTurnDispatch: Schema.optionalKey(ActiveTurnDispatch),
  ditherBackground: Schema.optionalKey(Schema.Boolean),
  theme: Schema.optionalKey(ThemeId),
  compactAtByWindow: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
});

export interface Preferences {
  readonly enterBehavior: EnterBehavior;
  readonly activeTurnDispatch: ActiveTurnDispatch;
  readonly ditherBackground: boolean;
  readonly theme: ThemeId;
  readonly compactAtByWindow: Readonly<Record<string, number>>;
}

const DEFAULTS: Preferences = {
  enterBehavior: "enter",
  activeTurnDispatch: "steer",
  ditherBackground: true,
  theme: DEFAULT_THEME_ID,
  compactAtByWindow: {},
};

const decodeStored = Schema.decodeUnknownOption(StoredPreferences);

const parsePreferences = (raw: string | null): Preferences => {
  if (raw === null) return DEFAULTS;
  try {
    const stored = decodeStored(JSON.parse(raw));
    return Option.isSome(stored) ? { ...DEFAULTS, ...stored.value } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
};

let cache: { readonly raw: string | null; readonly value: Preferences } = {
  raw: null,
  value: DEFAULTS,
};

const readRaw = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export const readPreferences = (): Preferences => {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, value: parsePreferences(raw) };
  return cache.value;
};

export const writePreference = <Key extends keyof Preferences>(
  key: Key,
  value: Preferences[Key],
): void => {
  const next = { ...readPreferences(), [key]: value };
  if (key === "theme") {
    applyTheme(next.theme);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const initTheme = (): void => {
  applyTheme(readPreferences().theme);
};

const subscribe = (onChange: () => void) => {
  const handleStorage = () => {
    applyTheme(readPreferences().theme);
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
};

export const usePreferences = (): Preferences =>
  useSyncExternalStore(subscribe, readPreferences, () => DEFAULTS);

export const useDitherBackground = (): boolean => usePreferences().ditherBackground;

export const useTheme = (): ThemeDefinition => getTheme(usePreferences().theme);

export const useCompactAtOverride = (windowTokens: number): number | null => {
  const value = usePreferences().compactAtByWindow[String(windowTokens)];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
};

export const writeCompactAtOverride = (windowTokens: number, tokens: number | null): void => {
  const current = { ...readPreferences().compactAtByWindow };
  const key = String(windowTokens);
  if (tokens === null) {
    delete current[key];
  } else {
    current[key] = Math.round(tokens);
  }
  writePreference("compactAtByWindow", current);
};

export interface SubmitKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

export const isSubmitKey = (behavior: EnterBehavior, event: SubmitKeyEvent): boolean => {
  if (event.key !== "Enter" || event.shiftKey) return false;
  return behavior === "enter" || event.metaKey || event.ctrlKey;
};
