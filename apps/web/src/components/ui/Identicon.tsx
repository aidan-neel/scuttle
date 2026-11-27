import { dicebearIdenticonUrl, IDENTICON_GRID, identicon } from "@scuttle/shared/identicon";
import { useState } from "react";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: { box: 16, radius: 4, classes: "size-4 rounded-[4px]" },
  md: { box: 24, radius: 6, classes: "size-6 rounded-[6px]" },
  lg: { box: 32, radius: 8, classes: "size-8 rounded-[8px]" },
  xl: { box: 56, radius: 14, classes: "size-14 rounded-[14px]" },
} as const;

interface IdenticonProps {
  name: string;
  size: keyof typeof SIZES;
  className?: string;
}

function FallbackIdenticon({ name, size, className }: IdenticonProps) {
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

export function Identicon({ name, size, className }: IdenticonProps) {
  const { box, classes } = SIZES[size];
  const url = dicebearIdenticonUrl(name);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (failedUrl === url) {
    return (
      <FallbackIdenticon
        name={name}
        size={size}
        {...(className !== undefined ? { className } : {})}
      />
    );
  }

  return (
    <img
      src={url}
      alt=""
      aria-hidden
      width={box}
      height={box}
      decoding="async"
      onError={() => setFailedUrl(url)}
      className={cn("shrink-0 bg-white/[0.06] object-cover select-none", classes, className)}
    />
  );
}
