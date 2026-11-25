import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "scuttle.disabledModels.v1";
const CHANGE_EVENT = "scuttle:disabled-models-changed";

const StoredDisabled = Schema.Array(Schema.String);
const decodeStored = Schema.decodeUnknownOption(StoredDisabled);

const EMPTY: ReadonlySet<string> = new Set();

let cache: { readonly raw: string | null; readonly value: ReadonlySet<string> } = {
  raw: null,
  value: EMPTY,
};

const readRaw = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const parseDisabled = (raw: string | null): ReadonlySet<string> => {
  if (raw === null) return EMPTY;
  try {
    const decoded = decodeStored(JSON.parse(raw));
    return Option.isSome(decoded) ? new Set(decoded.value) : EMPTY;
  } catch {
    return EMPTY;
  }
};

export const readDisabledModels = (): ReadonlySet<string> => {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, value: parseDisabled(raw) };
  return cache.value;
};

const writeDisabledSet = (next: ReadonlySet<string>): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const setModelDisabled = (key: string, disabled: boolean): void => {
  const next = new Set(readDisabledModels());
  if (disabled) next.add(key);
  else next.delete(key);
  writeDisabledSet(next);
};

export const setModelsDisabled = (keys: ReadonlyArray<string>, disabled: boolean): void => {
  const next = new Set(readDisabledModels());
  for (const key of keys) {
    if (disabled) next.add(key);
    else next.delete(key);
  }
  writeDisabledSet(next);
};

const subscribe = (onChange: () => void) => {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
};

export function useDisabledModels() {
  const disabled = useSyncExternalStore(subscribe, readDisabledModels, () => EMPTY);
  return {
    disabled,
    isDisabled: (key: string) => disabled.has(key),
    setDisabled: setModelDisabled,
    setManyDisabled: setModelsDisabled,
  };
}
