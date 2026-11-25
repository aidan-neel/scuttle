import { useEffect, useState } from "react";
import {
  DITHER_PRESETS,
  getDitherPreset,
  pickRandomDitherPreset,
  rememberDitherPreset,
} from "@/components/dithercn/dither-presets";
import type { DitherPreset, DitherPresetId } from "@/components/dithercn/dither-presets";
import { cssColor, DitherShader, usePrefersReducedMotion } from "@/lib/dither";
import type { DitherShaderProps } from "@/lib/dither";

export type DitherHorizonProps = Omit<DitherShaderProps, "field" | "uniforms" | "fallback"> & {
  readonly intensity?: number;
  readonly preset?: DitherPresetId;
};

const REVEAL_SECONDS = 1.4;

export function DitherHorizon({
  intensity = 0.72,
  preset,
  palette,
  matrix,
  cell,
  speed,
  fps = 60,
  animate = true,
  stillTime,
  ...props
}: DitherHorizonProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [randomPreset] = useState<DitherPreset | null>(() =>
    preset ? null : pickRandomDitherPreset(),
  );
  const activePreset = preset ? getDitherPreset(preset) : (randomPreset ?? DITHER_PRESETS[0]);

  useEffect(() => {
    if (!preset) {
      rememberDitherPreset(activePreset.id);
    }
  }, [activePreset.id, preset]);

  const resolvedPalette = palette ?? activePreset.palette;
  const resolvedMatrix = matrix ?? activePreset.matrix;
  const resolvedCell = cell ?? activePreset.cell;
  const resolvedSpeed = speed ?? activePreset.speed;
  const isStatic = reducedMotion || !animate;
  const resolvedStillTime = stillTime ?? (isStatic ? activePreset.stillTime : 0);

  return (
    <DitherShader
      {...props}
      data-preset={activePreset.id}
      field={activePreset.field}
      palette={resolvedPalette}
      matrix={resolvedMatrix}
      cell={resolvedCell}
      speed={resolvedSpeed}
      fps={fps}
      animate={animate}
      stillTime={resolvedStillTime}
      uniforms={{
        horizonIntensity: intensity,
        revealDuration: REVEAL_SECONDS * Math.max(resolvedSpeed, 0.01),
        revealInstant: isStatic ? 1 : 0,
      }}
      fallback={
        <div
          className="absolute inset-0"
          style={{ backgroundColor: cssColor(resolvedPalette[0]) }}
        />
      }
    />
  );
}
