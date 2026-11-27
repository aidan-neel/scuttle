import { ArrowDown02Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { easeOut, spring } from "@/lib/motion.ts";

interface ScrollToEndButtonProps {
  readonly visible: boolean;
  readonly onClick: () => void;
}

export function ScrollToEndButton({ visible, onClick }: ScrollToEndButtonProps) {
  const still = useReducedMotion() === true;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={still ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: spring.snappy }}
            exit={
              still
                ? { opacity: 0, transition: { duration: 0.12 } }
                : { opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.14, ease: easeOut } }
            }
            className="pointer-events-auto rounded-chip bg-canvas"
          >
            <Button type="button" variant="secondary" size="sm" onClick={onClick}>
              <Icon icon={ArrowDown02Icon} />
              Scroll to end
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
