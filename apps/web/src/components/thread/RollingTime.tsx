import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { formatElapsedSeconds } from "@/lib/format.ts";
import { spring } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";

const SUBPIXEL_BUFFER_PX = 1;

interface TimeSegment {
  readonly unit: string;
  readonly digits: ReadonlyArray<string>;
}

const toSegments = (text: string): ReadonlyArray<TimeSegment> =>
  text.split(" ").map((part) => ({ unit: part.slice(-1), digits: part.slice(0, -1).split("") }));

function RollingDigit({ digit }: { readonly digit: string }) {
  const reduceMotion = useReducedMotion();
  const offset = reduceMotion ? 0 : "70%";
  return (
    <span className="relative inline-flex overflow-clip">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={digit}
          className="inline-block"
          initial={{ y: offset, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: reduceMotion ? 0 : "-70%", opacity: 0 }}
          transition={spring.snappy}
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function RollingTime({
  ms,
  className,
}: {
  readonly ms: number;
  readonly className?: string;
}) {
  const text = formatElapsedSeconds(ms);
  return (
    <span className={cn("inline-flex tabular-nums", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex gap-[0.25em]">
        {toSegments(text).map((segment) => (
          <span key={segment.unit} className="inline-flex">
            {segment.digits.map((digit, index) => (
              <RollingDigit key={`${segment.unit}${segment.digits.length - index}`} digit={digit} />
            ))}
            {segment.unit}
          </span>
        ))}
      </span>
    </span>
  );
}

export function SmoothWidth({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const content = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();

  useLayoutEffect(() => {
    const node = content.current;
    if (node === null) return;
    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.borderBoxSize[0]?.inlineSize;
      if (size !== undefined) setWidth(Math.ceil(size) + SUBPIXEL_BUFFER_PX);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      className={cn(
        "inline-flex overflow-x-clip transition-[width] duration-200 ease-out-quint",
        className,
      )}
      style={{ width }}
    >
      <span ref={content} className="inline-flex shrink-0 items-baseline whitespace-nowrap">
        {children}
      </span>
    </span>
  );
}
