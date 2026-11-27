import * as Schema from "effect/Schema";
import type { DitherPalette } from "@/lib/dither";

export const ThemeId = Schema.Literals([
  "obsidian",
  "midnight",
  "nord",
  "espresso",
  "daylight",
  "paper",
]);
export type ThemeId = typeof ThemeId.Type;

export type ThemeAppearance = "dark" | "light";

export interface ThemeSwatch {
  readonly chrome: string;
  readonly sidebar: string;
  readonly canvas: string;
  readonly panel: string;
  readonly fg: string;
  readonly fgMuted: string;
  readonly primary: string;
  readonly line: string;
}

export interface ThemeDefinition {
  readonly id: ThemeId;
  readonly name: string;
  readonly description: string;
  readonly appearance: ThemeAppearance;
  readonly swatch: ThemeSwatch;
  readonly ditherPalette?: DitherPalette;
}

export const DEFAULT_THEME_ID: ThemeId = "obsidian";

export const THEMES: ReadonlyArray<ThemeDefinition> = [
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Neutral carbon dark",
    appearance: "dark",
    swatch: {
      chrome: "#09090a",
      sidebar: "#0f0f10",
      canvas: "#121213",
      panel: "#161617",
      fg: "#ebebec",
      fgMuted: "#99999a",
      primary: "#2f6bf0",
      line: "#1f1f20",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Deep cool slate",
    appearance: "dark",
    swatch: {
      chrome: "#070a10",
      sidebar: "#0c111b",
      canvas: "#101622",
      panel: "#151d2c",
      fg: "#e8edf5",
      fgMuted: "#8d9bb2",
      primary: "#4c8bf5",
      line: "#1d2739",
    },
    ditherPalette: ["#101622", "#162238", "#22395e", "#3a5e96"],
  },
  {
    id: "nord",
    name: "Nord",
    description: "Arctic polar frost",
    appearance: "dark",
    swatch: {
      chrome: "#21252e",
      sidebar: "#272c36",
      canvas: "#2e3440",
      panel: "#353c4a",
      fg: "#eceff4",
      fgMuted: "#9aa5b8",
      primary: "#88c0d0",
      line: "#3e4656",
    },
    ditherPalette: ["#2e3440", "#354254", "#445c73", "#6489a3"],
  },
  {
    id: "espresso",
    name: "Espresso",
    description: "Warm charcoal & amber",
    appearance: "dark",
    swatch: {
      chrome: "#0d0b0a",
      sidebar: "#14110f",
      canvas: "#181512",
      panel: "#1f1b17",
      fg: "#eee9e2",
      fgMuted: "#9d9489",
      primary: "#d97757",
      line: "#2a241f",
    },
    ditherPalette: ["#181512", "#261e18", "#423023", "#704d35"],
  },
  {
    id: "daylight",
    name: "Daylight",
    description: "Crisp neutral light",
    appearance: "light",
    swatch: {
      chrome: "#ececef",
      sidebar: "#f3f3f6",
      canvas: "#ffffff",
      panel: "#f7f7f9",
      fg: "#141416",
      fgMuted: "#65656d",
      primary: "#2563eb",
      line: "#e5e5ea",
    },
    ditherPalette: ["#ffffff", "#f1f4fa", "#dce6f7", "#b8ccf0"],
  },
  {
    id: "paper",
    name: "Paper",
    description: "Warm editorial cream",
    appearance: "light",
    swatch: {
      chrome: "#e8e3da",
      sidebar: "#f0ece3",
      canvas: "#f8f5ef",
      panel: "#fdfbf7",
      fg: "#1f1b16",
      fgMuted: "#6f665b",
      primary: "#c25934",
      line: "#e4ddd2",
    },
    ditherPalette: ["#f8f5ef", "#f1e9dd", "#e4d4be", "#cfa982"],
  },
];

export const getTheme = (id: ThemeId): ThemeDefinition =>
  THEMES.find((theme) => theme.id === id) ?? THEMES[0]!;

export const applyTheme = (id: ThemeId): void => {
  if (typeof document === "undefined") return;
  const theme = getTheme(id);
  const root = document.documentElement;
  root.dataset["theme"] = theme.id;
  root.dataset["appearance"] = theme.appearance;
};
