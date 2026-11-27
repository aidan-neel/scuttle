import { useEffect, useState } from "react";
import {
  DITHER_PRESETS,
  getDitherPreset,
  pickRandomDitherPreset,
  rememberDitherPreset,
} from "@/components/dithercn/dither-presets";
import type { DitherPreset, DitherPresetId } from "@/components/dithercn/dither-presets";
import { useTheme } from "@/components/settings/preferences.ts";
import { cssColor, DitherShader, usePrefersReducedMotion } from "@/lib/dither";
import type { DitherShaderProps } from "@/lib/dither";
import { isSoftwareRenderer } from "@/lib/renderMode";

export type DitherHorizonProps = Omit<DitherShaderProps, "field" | "uniforms" | "fallback"> & {
  readonly intensity?: number;
  readonly preset?: DitherPresetId;
};

const REVEAL_SECONDS = 1.6;

export function DitherHorizon({
  intensity = 0.72,
  preset,
  palette,
  matrix,
  cell,
  speed,
  fps = 30,
  animate = true,
  stillTime,
  ...props
}: DitherHorizonProps) {
  const reducedMotion = usePrefersReducedMotion();
  const theme = useTheme();
  const software = isSoftwareRenderer();
  const [randomPreset] = useState<DitherPreset | null>(() =>
    preset ? null : pickRandomDitherPreset(),
  );
  const activePreset = preset ? getDitherPreset(preset) : (randomPreset ?? DITHER_PRESETS[0]);

  useEffect(() => {
    if (!preset) {
      rememberDitherPreset(activePreset.id);
    }
  }, [activePreset.id, preset]);

  const resolvedPalette = palette ?? theme.ditherPalette ?? activePreset.palette;
  const resolvedMatrix = matrix ?? activePreset.matrix;
  const resolvedCell = cell ?? activePreset.cell;
  const resolvedSpeed = speed ?? activePreset.speed;
  const effectiveAnimate = animate && !software;
  const isStatic = reducedMotion || !effectiveAnimate;
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
      animate={effectiveAnimate}
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
