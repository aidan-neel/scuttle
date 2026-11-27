import { useId } from "react";
import { cn } from "@/lib/utils";

const WORDMARK_PATH =
  "M26.06 40.11A11.5 8.6 0 1 0 17 54A12.5 8.6 0 1 1 7.15 67.89M75.48 42.49A17.2 17.2 0 1 0 75.48 65.51M93.4 38V56A14 14 0 0 0 121.4 56V38M121.4 56V70M147.9 24V62A8 8 0 0 0 155.9 70M177.9 24V62A8 8 0 0 0 185.9 70M205.4 16V70M226.9 52.5H261.3A17.2 17.2 0 1 0 257.28 65.06M139.9 38H185.9";

export function ScuttleMark({ className }: { className?: string }) {
  // Raw useId output contains characters that break url(#id) references.
  const id = `scuttle-mark-${useId().replace(/[^\w-]/g, "")}`;
  const cutoutId = `${id}-cutout`;
  const shadowId = `${id}-shadow`;
  const gradientId = `${id}-fill`;

  return (
    <svg viewBox="18 20 88 88" fill="none" aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <mask id={cutoutId} maskUnits="userSpaceOnUse" x="18" y="20" width="88" height="88">
          <rect x="18" y="20" width="88" height="88" fill="#fff" />
          <path d="M-10 56H44M-10 76H34" stroke="#000" strokeWidth="9" strokeLinecap="round" />
        </mask>
        <mask id={shadowId} maskUnits="userSpaceOnUse" x="18" y="20" width="88" height="88">
          <circle cx="62" cy="64" r="44" fill="#fff" />
          <circle cx="57" cy="56" r="44" fill="#000" />
        </mask>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="20"
          x2="0"
          y2="108"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--color-primary-top)" />
          <stop offset="1" stopColor="var(--color-primary)" />
        </linearGradient>
      </defs>
      <g mask={`url(#${cutoutId})`}>
        <circle cx="62" cy="64" r="44" fill={`url(#${gradientId})`} />
        <rect
          x="18"
          y="20"
          width="88"
          height="88"
          opacity="0.45"
          mask={`url(#${shadowId})`}
          style={{ fill: "color-mix(in oklab, var(--color-primary) 72%, #000)" }}
        />
        <path
          d="M32.56 47A34 34 0 0 1 46.04 33.98"
          stroke="#ffffff"
          strokeWidth="6.5"
          strokeLinecap="round"
          opacity="0.4"
        />
        <circle cx="54.93" cy="30.74" r="3.3" fill="#ffffff" opacity="0.4" />
      </g>
      <ellipse cx="79" cy="58" rx="6.5" ry="7.8" fill="#09090a" />
      <ellipse cx="95" cy="58" rx="6.5" ry="7.8" fill="#09090a" />
      <circle cx="81" cy="54.8" r="2.4" fill="#ffffff" />
      <circle cx="97" cy="54.8" r="2.4" fill="#ffffff" />
    </svg>
  );
}

export function ScuttleWordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 11 266 65"
      fill="none"
      strokeWidth="9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <path d={WORDMARK_PATH} stroke="currentColor" />
    </svg>
  );
}

export function ScuttleLogo({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="Scuttle" className={cn("flex items-center gap-2", className)}>
      <ScuttleMark className="size-5 translate-y-0.5" />
      <ScuttleWordmark className="h-[0.9375rem] w-auto" />
    </span>
  );
}
