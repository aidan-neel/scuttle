import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "scuttle.preferences.v1";
const CHANGE_EVENT = "scuttle:preferences-changed";

export const EnterBehavior = Schema.Literals(["enter", "mod-enter"]);
export type EnterBehavior = typeof EnterBehavior.Type;

const StoredPreferences = Schema.Struct({
  enterBehavior: Schema.optionalKey(EnterBehavior),
  ditherBackground: Schema.optionalKey(Schema.Boolean),
});

export interface Preferences {
  readonly enterBehavior: EnterBehavior;
  readonly ditherBackground: boolean;
}

const DEFAULTS: Preferences = { enterBehavior: "enter", ditherBackground: true };

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

const subscribe = (onChange: () => void) => {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
};

export const usePreferences = (): Preferences =>
  useSyncExternalStore(subscribe, readPreferences, () => DEFAULTS);

export const useDitherBackground = (): boolean => usePreferences().ditherBackground;

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
