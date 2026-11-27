import { Dialog } from "@base-ui/react/dialog";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { easeOut, spring } from "@/lib/motion.ts";

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly tone?: "danger" | "primary";
  readonly busy?: boolean;
  readonly onConfirm: () => Promise<void> | void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  onConfirm,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const working = busy || pending;

  const requestOpenChange = (next: boolean) => {
    if (working && !next) return;
    onOpenChange(next);
  };

  const confirm = async () => {
    if (working) return;
    setPending(true);
    setFailed(false);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      setFailed(true);
    }
    setPending(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={requestOpenChange}>
      <AnimatePresence onExitComplete={() => setFailed(false)}>
        {open && (
          <Dialog.Portal keepMounted>
            <Dialog.Backdrop
              render={
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.16, ease: easeOut } }}
                  exit={{ opacity: 0, transition: { duration: 0.12, ease: easeOut } }}
                />
              }
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
            />
            <Dialog.Popup
              initialFocus={confirmRef}
              render={
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1, transition: spring.snappy }}
                  exit={{ opacity: 0, y: 4, scale: 0.985, transition: { duration: 0.12 } }}
                />
              }
              className="fixed inset-x-0 top-[22vh] z-50 mx-auto flex w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-canvas bg-menu shadow-menu outline-none"
            >
              <div className="flex flex-col gap-1.5 px-4 pt-4 pb-4">
                <Dialog.Title className="text-body font-medium text-fg">{title}</Dialog.Title>
                <Dialog.Description className="text-label leading-[1.55] text-fg-muted">
                  {description}
                </Dialog.Description>
              </div>
              <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-line bg-black/10 px-3">
                <div className="min-w-0 flex-1">
                  {failed && (
                    <p role="alert" className="flex items-center gap-1.5 text-label text-danger">
                      <Icon icon={Alert02Icon} className="size-3.5 shrink-0" />
                      <span className="truncate">Something went wrong.</span>
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  disabled={working}
                  onClick={() => requestOpenChange(false)}
                >
                  {cancelLabel}
                </Button>
                <Button
                  ref={confirmRef}
                  type="button"
                  variant={tone === "danger" ? "destructive" : "primary"}
                  size="md"
                  disabled={working}
                  onClick={() => void confirm()}
                >
                  {working && <DotSpinner variant="working" label="Working" />}
                  {confirmLabel}
                </Button>
              </footer>
            </Dialog.Popup>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
