import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { Icon } from "@/components/ui/Icon.tsx";
import { easeOut, spring } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";

interface InspectorSectionProps {
  readonly title: string;
  readonly count?: number | undefined;
  readonly actions?: ReactNode;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}

export function InspectorSection({
  title,
  count,
  actions,
  defaultOpen = true,
  children,
}: InspectorSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="flex flex-col">
      <div className="flex h-8 items-center gap-1 pr-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-chip px-2 text-left text-label font-medium text-fg-secondary outline-none transition-colors duration-100 hover:text-fg focus-visible:shadow-focus"
        >
          <span className="truncate">{title}</span>
          {count !== undefined && (
            <span className="font-mono text-meta text-fg-faint tabular-nums">{count}</span>
          )}
          <Icon
            icon={ArrowRight01Icon}
            className={cn(
              "size-3 text-fg-faint transition-transform duration-150 ease-out",
              open && "rotate-90",
            )}
          />
        </button>
        {actions}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, transition: spring.smooth }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.15, ease: easeOut } }}
            className="overflow-hidden"
          >
            <div className="p-0.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export interface ChipOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly count?: number | undefined;
}

interface ChipRowProps<Value extends string> {
  readonly label: string;
  readonly value: Value;
  readonly options: ReadonlyArray<ChipOption<Value>>;
  readonly onValueChange: (value: Value) => void;
}

export function ChipRow<Value extends string>({
  label,
  value,
  options,
  onValueChange,
}: ChipRowProps<Value>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="scrollbar-none flex items-center gap-0.5 overflow-x-auto p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "flex h-6 shrink-0 items-center gap-1 rounded-chip px-2 text-meta whitespace-nowrap outline-none transition-colors duration-100 focus-visible:shadow-focus",
              selected
                ? "bg-white/9 text-fg shadow-[inset_0_0_0_1px_rgb(255_255_255/6%)]"
                : "text-fg-muted hover:bg-(--wash) hover:text-fg-secondary",
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="font-mono text-[10px] text-fg-faint tabular-nums">
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly tone?: "neutral" | "accent";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-4.5 shrink-0 items-center rounded-full px-1.5 text-[10.5px] leading-none font-medium whitespace-nowrap",
        tone === "accent" ? "bg-input/14 text-input" : "bg-white/6 text-fg-muted",
      )}
    >
      {children}
    </span>
  );
}

export function EmptyLine({ children }: { readonly children: ReactNode }) {
  return <p className="px-2 py-1.5 text-label text-fg-muted">{children}</p>;
}

export function ErrorLine({ message }: { readonly message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="px-2 py-1 text-label break-words text-danger">
      {message}
    </p>
  );
}
