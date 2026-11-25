import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { textSwap } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface SwapTextProps {
  swapKey: string | number;
  children: ReactNode;
  className?: string;
}

export function SwapText({ swapKey, children, className }: SwapTextProps) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={swapKey} className="inline-flex items-center gap-[inherit]" {...textSwap}>
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
