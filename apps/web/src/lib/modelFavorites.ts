import { useEffect, useState } from "react";

const FAVORITES_KEY = "scuttle.favoriteModels.v1";
const CHANGE_EVENT = "scuttle:favorites-changed";

export const modelFavoriteKey = (providerId: string, slug: string): string =>
  `${providerId}::${slug}`;

export const readFavoriteModels = (): ReadonlyArray<string> => {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
};

export const toggleFavoriteModel = (key: string): ReadonlyArray<string> => {
  const current = readFavoriteModels();
  const next = current.includes(key) ? current.filter((item) => item !== key) : [key, ...current];
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return next;
};

export function useFavoriteModels() {
  const [favorites, setFavorites] = useState<ReadonlyArray<string>>(readFavoriteModels);

  useEffect(() => {
    const sync = () => setFavorites(readFavoriteModels());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return {
    favorites,
    isFavorite: (key: string) => favorites.includes(key),
    toggle: (key: string) => setFavorites(toggleFavoriteModel(key)),
  };
}
