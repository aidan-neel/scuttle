export const SIDEBAR = { min: 220, max: 420, initial: 280 } as const;

const STORAGE_KEY = "scuttle.sidebar-width.v1";

export const clampSidebarWidth = (width: number) =>
  Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, width)));

export const readSidebarWidth = (): number => {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampSidebarWidth(stored) : SIDEBAR.initial;
  } catch {
    return SIDEBAR.initial;
  }
};

export const writeSidebarWidth = (width: number) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    return;
  }
};
