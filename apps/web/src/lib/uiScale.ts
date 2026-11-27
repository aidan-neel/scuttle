const DEFAULT_ROOT_FONT_SIZE_PX = 17.6;

export const getRootFontSizePx = (): number => {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return DEFAULT_ROOT_FONT_SIZE_PX;
  }
  const parsed = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ROOT_FONT_SIZE_PX;
};

export const remToPx = (rem: number): number => rem * getRootFontSizePx();
