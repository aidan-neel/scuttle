import { cn } from "@/lib/utils";

export type DotSpinnerVariant = "working" | "thinking" | "loading";

const DELAYS: Record<DotSpinnerVariant, ReadonlyArray<number>> = {
  working: [0, 1, 2, 7, -1, 3, 6, 5, 4],
  thinking: [0, 1, 2, 1, 2, 3, 2, 3, 4],
  loading: [2, 1, 2, 1, 0, 1, 2, 1, 2],
};

const STEP: Record<DotSpinnerVariant, number> = { working: 110, thinking: 120, loading: 160 };

interface DotSpinnerProps {
  variant: DotSpinnerVariant;
  label: string;
  className?: string;
}

export function DotSpinner({ variant, label, className }: DotSpinnerProps) {
  const step = STEP[variant];
  const cycle = variant === "working" ? step * 8 : step * 6;

  return (
    <span
      role="img"
      aria-label={label}
      className={cn("grid size-[13px] shrink-0 grid-cols-3 place-items-center", className)}
    >
      {DELAYS[variant].map((slot, index) => (
        <span
          key={index}
          className={cn(
            "size-[3px] rounded-[0.75px] bg-current",
            slot < 0
              ? "opacity-25"
              : "animate-dot motion-reduce:animate-none motion-reduce:opacity-60",
          )}
          style={
            slot < 0
              ? undefined
              : { animationDelay: `${slot * step - cycle}ms`, animationDuration: `${cycle}ms` }
          }
        />
      ))}
    </span>
  );
}
