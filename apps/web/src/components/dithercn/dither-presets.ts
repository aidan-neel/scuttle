import type { DitherMatrix, DitherPalette } from "@/lib/dither";

export type DitherPresetMatrix = Extract<DitherMatrix, "blue-noise" | "bayer4" | "bayer8">;

export const DITHER_PRESET_IDS = [
  "tide-horizon",
  "aurora-curtains",
  "caustic-ripples",
  "orbital-drift",
  "topo-contours",
] as const;

export type DitherPresetId = (typeof DITHER_PRESET_IDS)[number];

export interface DitherPreset {
  readonly id: DitherPresetId;
  readonly name: string;
  readonly field: string;
  readonly palette: DitherPalette;
  readonly matrix: DitherPresetMatrix;
  readonly cell: number;
  readonly speed: number;
  readonly stillTime: number;
}

const REVEAL_HELPER = `
float horizonReveal(float t, float delay) {
  float raw = max(revealInstant, clamp(t / max(revealDuration, 0.001), 0.0, 1.0));
  float inv = 1.0 - raw;
  float eased = raw * 0.45 + (1.0 - inv * inv * inv) * 0.55;
  return smoothstep(delay, delay + 0.56, eased);
}
`;

const TIDE_HORIZON: DitherPreset = {
  id: "tide-horizon",
  name: "Tide Horizon",
  matrix: "blue-noise",
  cell: 2,
  speed: 0.26,
  stillTime: 4.2,
  palette: ["#121213", "#171f2e", "#233654", "#375787"],
  field: `${REVEAL_HELPER}
float field(vec2 uv, vec2 res, float t) {
  float aspect = res.x / max(res.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);

  float flow = fbm(vec2(p.x * 1.1 + t * 0.24, uv.y * 1.8 - t * 0.12));
  float mist = snoise(vec2(p.x * 2.1 - t * 0.36, uv.y * 2.0 + t * 0.16)) * 0.032;

  float swell1 = 0.24 + 0.085 * sin(p.x * 1.65 + t * 0.88)
    + 0.045 * cos(p.x * 3.05 - t * 0.64) + (flow - 0.5) * 0.11;
  float swell2 = 0.41 + 0.092 * sin(p.x * 1.2 - t * 0.72 + 1.7)
    + 0.04 * sin(p.x * 2.55 + t * 0.94) + mist;
  float swell3 = 0.57 + 0.072 * cos(p.x * 0.95 + t * 0.56 - 0.9)
    + 0.035 * sin(p.x * 2.1 - t * 0.8) + (flow - 0.5) * 0.085;

  float body1 = smoothstep(swell1 + 0.14, swell1 - 0.22, uv.y) * 0.42;
  float crest1 = exp(-abs(uv.y - swell1) * 18.0) * 0.54;

  float body2 = smoothstep(swell2 + 0.16, swell2 - 0.24, uv.y) * 0.32;
  float crest2 = exp(-abs(uv.y - swell2) * 16.0) * 0.48;

  float body3 = smoothstep(swell3 + 0.18, swell3 - 0.24, uv.y) * 0.22;
  float crest3 = exp(-abs(uv.y - swell3) * 14.0) * 0.38;

  float shimmer = 0.74 + 0.26 * sin(p.x * 4.4 - t * 1.5 + flow * 3.8);
  float spread = 0.58 + 0.42 * exp(-p.x * p.x * 0.4);
  float waves = (body1 + body2 + body3 + (crest1 + crest2 + crest3) * shimmer) * spread;

  float delay = clamp(uv.y * 0.44, 0.0, 0.44);
  return horizonIntensity * waves * horizonReveal(t, delay);
}
`,
};

const AURORA_CURTAINS: DitherPreset = {
  id: "aurora-curtains",
  name: "Aurora Curtains",
  matrix: "blue-noise",
  cell: 2,
  speed: 0.24,
  stillTime: 4.5,
  palette: ["#121213", "#142228", "#1d404d", "#336f7d"],
  field: `${REVEAL_HELPER}
float field(vec2 uv, vec2 res, float t) {
  float aspect = res.x / max(res.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);

  float drift = fbm(vec2(p.x * 0.85 + t * 0.18, uv.y * 0.55 - t * 0.1));
  float foldA = 0.11 * sin(p.x * 1.45 + t * 0.8)
    + 0.055 * sin(p.x * 2.7 - t * 0.58 + drift * 2.4);
  float hemA = 0.4 + foldA;
  float dyA = uv.y - hemA;
  float ribbonA = smoothstep(-0.07, 0.035, dyA) * exp(-max(dyA, 0.0) * 2.75);
  float raysA = 0.62 + 0.38 * sin(p.x * 6.5 + foldA * 7.5 + t * 1.25 + drift * 3.4);

  float foldB = 0.095 * cos(p.x * 1.15 - t * 0.66 + 1.4)
    + 0.05 * sin(p.x * 2.2 + t * 0.84 - drift * 2.0);
  float hemB = 0.59 + foldB;
  float dyB = uv.y - hemB;
  float ribbonB = smoothstep(-0.06, 0.035, dyB) * exp(-max(dyB, 0.0) * 3.1);
  float raysB = 0.6 + 0.4 * sin(p.x * 5.2 - foldB * 6.5 - t * 1.05 + drift * 2.8);

  float edgeFade = 0.45 + 0.55 * exp(-p.x * p.x * 0.34);
  float curtain = (ribbonA * raysA * 0.86 + ribbonB * raysB * 0.72) * edgeFade;
  float mid = (uv.y - 0.56) * 2.3;
  float glow = exp(-mid * mid) * 0.2 * drift * edgeFade;

  float delay = clamp((uv.x * 0.65 + (1.0 - uv.y) * 0.35) * 0.44, 0.0, 0.44);
  return horizonIntensity * (curtain + glow) * horizonReveal(t, delay);
}
`,
};

const CAUSTIC_RIPPLES: DitherPreset = {
  id: "caustic-ripples",
  name: "Caustic Ripples",
  matrix: "bayer4",
  cell: 2,
  speed: 0.18,
  stillTime: 5.0,
  palette: ["#121213", "#1c1a2b", "#2f2a4c", "#4f477d"],
  field: `${REVEAL_HELPER}
float field(vec2 uv, vec2 res, float t) {
  float aspect = res.x / max(res.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  vec2 warp = vec2(
    snoise(p * 1.2 + vec2(t * 0.22, -t * 0.16)),
    snoise(p * 1.2 + vec2(-t * 0.18 + 4.1, t * 0.2))
  ) * 0.065;
  vec2 q = p + warp;

  vec2 c1 = vec2(0.42 * cos(t * 0.42), 0.24 * sin(t * 0.56));
  vec2 c2 = vec2(-0.46 * sin(t * 0.36 + 1.1), 0.26 * cos(t * 0.48));
  vec2 c3 = vec2(0.24 * sin(t * 0.52 - 0.8), -0.28 * cos(t * 0.38 + 0.6));

  float d1 = length(q - c1);
  float d2 = length(q - c2);
  float d3 = length(q - c3);

  float r1 = 0.5 + 0.5 * sin(d1 * 22.0 - t * 2.7);
  float r2 = 0.5 + 0.5 * sin(d2 * 18.0 - t * 2.25 + 1.5);
  float r3 = 0.5 + 0.5 * sin(d3 * 25.0 - t * 3.1 + 3.1);

  float w1 = r1 * r1 * exp(-d1 * 0.95);
  float w2 = r2 * r2 * exp(-d2 * 0.92);
  float w3 = r3 * r3 * exp(-d3 * 1.05);

  float rings = (w1 + w2 + w3) * 0.72;
  float cross = (w1 * w2 + w2 * w3 + w3 * w1) * 1.1;
  float caustic = rings + cross;
  float vignette = exp(-dot(p, p) * 0.48);

  float delay = clamp(length(uv - vec2(0.5, 0.5)) * 0.62, 0.0, 0.44);
  return horizonIntensity * caustic * (0.44 + 0.56 * vignette) * horizonReveal(t, delay);
}
`,
};

const ORBITAL_DRIFT: DitherPreset = {
  id: "orbital-drift",
  name: "Orbital Drift",
  matrix: "blue-noise",
  cell: 2,
  speed: 0.26,
  stillTime: 3.8,
  palette: ["#121213", "#181f2d", "#283956", "#46628c"],
  field: `${REVEAL_HELPER}
float field(vec2 uv, vec2 res, float t) {
  float aspect = res.x / max(res.y, 1.0);
  vec2 q = vec2((uv.x - 0.5) * aspect, uv.y - 0.52);
  float r = length(q);
  float angle = atan(q.y, q.x + 0.00001);

  float cs = cos(t * 0.22);
  float sn = sin(t * 0.22);
  vec2 rot = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
  float swirl = fbm(rot * 1.45 + vec2(t * 0.14, -t * 0.09));

  vec2 e1 = vec2(q.x * 0.76, q.y * 1.18);
  float r1 = length(e1) + (swirl - 0.5) * 0.065;
  float arc1 = 0.48 + 0.52 * sin(angle * 2.0 - t * 1.2 + r1 * 5.0);
  float ring1 = exp(-abs(r1 - 0.34) * 13.0) * arc1;

  vec2 e2 = vec2(q.x * 1.06, q.y * 0.84);
  float r2 = length(e2) - (swirl - 0.5) * 0.06;
  float arc2 = 0.48 + 0.52 * cos(angle * 2.0 + t * 0.96 - r2 * 4.2);
  float ring2 = exp(-abs(r2 - 0.52) * 10.5) * arc2;

  vec2 node1 = vec2(cos(t * 0.76) * 0.44, sin(t * 0.76) * 0.28);
  vec2 node2 = vec2(cos(-t * 0.62 + 2.4) * 0.48, sin(-t * 0.62 + 2.4) * 0.42);
  float orb1 = exp(-length(q - node1) * 5.8) * 0.62;
  float orb2 = exp(-length(q - node2) * 5.2) * 0.54;

  float vortex = exp(-r * 2.15) * (0.22 + 0.32 * swirl);
  float energy = ring1 * 0.88 + ring2 * 0.76 + orb1 + orb2 + vortex;

  float delay = clamp(length(uv - vec2(0.5, 0.52)) * 0.62, 0.0, 0.44);
  return horizonIntensity * energy * horizonReveal(t, delay);
}
`,
};

const TOPO_CONTOURS: DitherPreset = {
  id: "topo-contours",
  name: "Topo Contours",
  matrix: "bayer8",
  cell: 2,
  speed: 0.3,
  stillTime: 4.0,
  palette: ["#121213", "#201c19", "#3c2f23", "#6b5137"],
  field: `${REVEAL_HELPER}
float field(vec2 uv, vec2 res, float t) {
  float aspect = res.x / max(res.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  vec2 drift = vec2(t * 0.14, -t * 0.09);
  vec2 warp = vec2(
    snoise(p * 0.75 + drift),
    snoise(p * 0.75 - drift * 0.8 + vec2(3.7, 1.9))
  ) * 0.32;

  vec2 q = p * 0.95 + warp;
  float base = 0.5 + 0.5 * snoise(q + vec2(t * 0.08, t * 0.06));
  float detail = 0.5 + 0.5 * snoise(q * 2.05 - vec2(t * 0.11, -t * 0.07));
  float elev = base * 0.74 + detail * 0.26;

  float phase = elev * 6.2 - t * 0.42;
  float band = fract(phase);
  float ridge = smoothstep(0.0, 0.1, band) * (1.0 - smoothstep(0.1, 0.28, band));
  float subRidge = smoothstep(0.48, 0.54, band) * (1.0 - smoothstep(0.54, 0.64, band)) * 0.38;

  float pulse = 0.82 + 0.18 * sin(t * 1.1 + elev * 6.28318);
  float terrain = elev * 0.34 + (ridge * 0.96 + subRidge) * pulse;
  float vignette = 0.42 + 0.58 * exp(-dot(p, p) * 0.4);

  float delay = clamp((uv.x * 0.52 + uv.y * 0.48) * 0.44, 0.0, 0.44);
  return horizonIntensity * terrain * vignette * horizonReveal(t, delay);
}
`,
};

export const DITHER_PRESETS: readonly [DitherPreset, ...DitherPreset[]] = [
  TIDE_HORIZON,
  AURORA_CURTAINS,
  CAUSTIC_RIPPLES,
  ORBITAL_DRIFT,
  TOPO_CONTOURS,
];

const PRESET_BY_ID: Readonly<Record<DitherPresetId, DitherPreset>> = {
  "tide-horizon": TIDE_HORIZON,
  "aurora-curtains": AURORA_CURTAINS,
  "caustic-ripples": CAUSTIC_RIPPLES,
  "orbital-drift": ORBITAL_DRIFT,
  "topo-contours": TOPO_CONTOURS,
};

const LAST_PRESET_KEY = "scuttle:dither-horizon:last-preset";

export function isDitherPresetId(value: string): value is DitherPresetId {
  return Object.hasOwn(PRESET_BY_ID, value);
}

export function getDitherPreset(id: DitherPresetId): DitherPreset {
  return PRESET_BY_ID[id];
}

function readLastPresetId(): DitherPresetId | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(LAST_PRESET_KEY);
    return raw !== null && isDitherPresetId(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function rememberDitherPreset(id: DitherPresetId): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(LAST_PRESET_KEY, id);
  } catch {
    // Restricted browser contexts can block sessionStorage access.
  }
}

export function pickRandomDitherPreset(random: () => number = Math.random): DitherPreset {
  const lastId = readLastPresetId();
  const candidates =
    lastId === null ? DITHER_PRESETS : DITHER_PRESETS.filter((preset) => preset.id !== lastId);
  const index = Math.floor(Math.min(Math.max(random(), 0), 0.999999) * candidates.length);
  return candidates[index] ?? DITHER_PRESETS[0];
}
