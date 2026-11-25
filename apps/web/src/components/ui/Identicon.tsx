import { IDENTICON_GRID, identicon } from "@scuttle/shared/identicon";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: { box: 16, radius: 4 },
  md: { box: 24, radius: 6 },
  lg: { box: 32, radius: 8 },
} as const;

interface IdenticonProps {
  name: string;
  size: keyof typeof SIZES;
  className?: string;
}

export function Identicon({ name, size, className }: IdenticonProps) {
  const { box, radius } = SIZES[size];
  const { foreground, background, cells } = identicon(name);
  const pad = box * 0.18;
  const cell = (box - pad * 2) / IDENTICON_GRID;

  return (
    <svg
      aria-hidden
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      className={cn("shrink-0", className)}
    >
      <rect width={box} height={box} rx={radius} fill={background} />
      {cells.flatMap((row, y) =>
        row.map((on, x) =>
          on ? (
            <rect
              key={`${x}-${y}`}
              x={pad + x * cell}
              y={pad + y * cell}
              width={cell}
              height={cell}
              fill={foreground}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
