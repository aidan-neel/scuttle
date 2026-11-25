import { ArrowDown02Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/ui/Icon.tsx";
import { easeOut } from "@/lib/motion.ts";

interface ScrollToEndButtonProps {
  readonly visible: boolean;
  readonly onClick: () => void;
}

export function ScrollToEndButton({ visible, onClick }: ScrollToEndButtonProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
      <AnimatePresence>
        {visible && (
          <motion.button
            type="button"
            onClick={onClick}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18, ease: easeOut }}
            className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-full border border-edge bg-raised/95 px-3 py-1.5 text-label text-fg-secondary shadow-menu outline-none backdrop-blur-xs transition-colors duration-(--dur-hover) hover:text-fg focus-visible:shadow-focus"
          >
            <Icon icon={ArrowDown02Icon} className="size-3.5" />
            Scroll to end
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
