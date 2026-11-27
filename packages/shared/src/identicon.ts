import { md5 } from "@noble/hashes/legacy.js";

export interface Identicon {
  readonly foreground: string;
  readonly background: string;
  readonly cells: ReadonlyArray<ReadonlyArray<boolean>>;
}

export const IDENTICON_GRID = 5;

export const dicebearIdenticonUrl = (name: string): string =>
  `https://api.dicebear.com/10.x/identicon/svg?seed=${encodeURIComponent(name)}&scale=0.72`;

const hueChannel = (m1: number, m2: number, hue: number): number => {
  const h = ((hue % 1) + 1) % 1;
  if (h < 1 / 6) return m1 + (m2 - m1) * h * 6;
  if (h < 0.5) return m2;
  if (h < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - h) * 6;
  return m1;
};

const hlsToHex = (hue: number, lightness: number, saturation: number): string => {
  const m2 =
    lightness <= 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const m1 = 2 * lightness - m2;
  const channels = [hue + 1 / 3, hue, hue - 1 / 3].map((offset) =>
    Math.trunc(hueChannel(m1, m2, offset) * 255)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${channels.join("")}`;
};

export const identicon = (name: string): Identicon => {
  const digest = md5(new TextEncoder().encode(name));
  const byte = (index: number) => digest[index] ?? 0;
  const hue = ((byte(0) * 7 + byte(5)) % 256) / 255;
  const bits = (byte(1) << 16) | (byte(2) << 8) | byte(3);
  const cells = Array.from({ length: IDENTICON_GRID }, (_, row) =>
    Array.from({ length: IDENTICON_GRID }, (_, column) => {
      const mirrored = Math.min(column, IDENTICON_GRID - 1 - column);
      return ((bits >> (row * 3 + mirrored)) & 1) === 1;
    }),
  );
  return {
    foreground: hlsToHex(hue, 0.68, 0.55),
    background: hlsToHex(hue, 0.17, 0.3),
    cells,
  };
};
