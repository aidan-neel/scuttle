import { useId } from "react";
import { cn } from "@/lib/utils";

const WORDMARK_PATH =
  "M26.06 40.11A11.5 8.6 0 1 0 17 54A12.5 8.6 0 1 1 7.15 67.89M75.48 42.49A17.2 17.2 0 1 0 75.48 65.51M93.4 38V56A14 14 0 0 0 121.4 56V38M121.4 56V70M147.9 24V62A8 8 0 0 0 155.9 70M177.9 24V62A8 8 0 0 0 185.9 70M205.4 16V70M226.9 52.5H261.3A17.2 17.2 0 1 0 257.28 65.06";

export function ScuttleMark({ className }: { className?: string }) {
  // Raw useId output contains characters that break url(#id) references.
  const maskId = `scuttle-mark-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={cn("shrink-0", className)}>
      <mask id={maskId}>
        <rect x="-4" y="-4" width="40" height="40" fill="#fff" />
        <path d="M-2 13H10M-2 19.5H7" stroke="#000" strokeWidth="3" strokeLinecap="round" />
      </mask>
      <circle cx="15.5" cy="16" r="14.5" mask={`url(#${maskId})`} className="fill-primary" />
      <ellipse cx="20" cy="14" rx="2" ry="2.5" className="fill-chrome" />
      <ellipse cx="26" cy="14" rx="2" ry="2.5" className="fill-chrome" />
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
      <path d="M139.9 38H185.9" className="stroke-primary" />
    </svg>
  );
}

export function ScuttleLogo({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="Scuttle" className={cn("flex items-center gap-2", className)}>
      <ScuttleMark className="size-5" />
      <ScuttleWordmark className="h-[15px] w-auto" />
    </span>
  );
}
