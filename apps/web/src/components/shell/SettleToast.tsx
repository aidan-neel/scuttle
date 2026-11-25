import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { spring, textSwap } from "@/lib/motion";

export interface SettledNotice {
  readonly id: string;
  readonly title: string;
}

const TOAST_MS = 4000;

interface SettleToastProps {
  notice: SettledNotice | null;
  onUndo: (id: string) => void;
  onDismiss: () => void;
}

export function SettleToast({ notice, onUndo, onDismiss }: SettleToastProps) {
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);

  return (
    <div role="status" className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-2">
      <AnimatePresence>
        {notice !== null && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: spring.gentle }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
            className="pointer-events-auto flex h-10 items-center gap-2 rounded-card bg-menu pr-1.5 pl-3 shadow-menu"
          >
            <span className="relative min-w-0 flex-1 text-label text-fg-secondary">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={notice.id} {...textSwap} className="block truncate">
                  Settled <span className="text-fg">{notice.title}</span>
                </motion.span>
              </AnimatePresence>
            </span>
            <Button variant="quiet" size="sm" onClick={() => onUndo(notice.id)}>
              Undo
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
