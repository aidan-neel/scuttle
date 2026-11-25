import { cssColor, DitherShader } from "@/lib/dither";
import type { DitherPalette, DitherShaderProps } from "@/lib/dither";

export type DitherHorizonProps = Omit<DitherShaderProps, "field" | "uniforms" | "fallback"> & {
  readonly intensity?: number;
};

const HORIZON_PALETTE: DitherPalette = ["#121213", "#1b2230", "#293852"];

const FIELD = `
float field(vec2 uv, vec2 res, float t) {
  float aspect = res.x / max(res.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
  float ridge = 0.08 * sin(p.x * 1.35 + t * 0.14) + 0.045 * cos(p.x * 2.6 - t * 0.09);
  float grain = (fbm(vec2(p.x * 1.4, uv.y * 1.8) + vec2(t * 0.015, -t * 0.012)) - 0.5) * 0.14;
  float y = max(0.0, uv.y - (0.12 + ridge + grain));
  float vertical = exp(-y * 3.1);
  float spread = exp(-p.x * p.x * 0.75);
  return horizonIntensity * vertical * (0.45 + 0.55 * spread);
}
`;

export function DitherHorizon({
  intensity = 0.72,
  palette = HORIZON_PALETTE,
  matrix = "blue-noise",
  speed = 1.2,
  ...props
}: DitherHorizonProps) {
  return (
    <DitherShader
      {...props}
      field={FIELD}
      palette={palette}
      matrix={matrix}
      speed={speed}
      cell={2}
      uniforms={{ horizonIntensity: intensity }}
      fallback={
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: cssColor(palette[0]),
            backgroundImage:
              "radial-gradient(ellipse 80% 55% at 50% 100%, rgb(41 56 82 / 42%) 0%, transparent 72%)",
          }}
        />
      }
    />
  );
}
