import { isSoftwareRenderer } from "@/lib/renderMode";
import { cn } from "@/lib/utils";

export type DotSpinnerVariant = "working" | "thinking" | "loading";

const DURATION_MS: Record<DotSpinnerVariant, number> = {
  working: 750,
  thinking: 950,
  loading: 850,
};

interface DotSpinnerProps {
  variant: DotSpinnerVariant;
  label: string;
  className?: string;
}

export function DotSpinner({ variant, label, className }: DotSpinnerProps) {
  const software = isSoftwareRenderer();

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 16 16"
      fill="none"
      className={cn(
        "size-3.5 shrink-0",
        software ? undefined : "animate-spinner motion-reduce:animate-none",
        className,
      )}
      style={software ? undefined : { animationDuration: `${DURATION_MS[variant]}ms` }}
    >
      <circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r="5.75"
        pathLength={100}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="30 70"
      />
    </svg>
  );
}
