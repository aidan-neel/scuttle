import { Dialog } from "@base-ui/react/dialog";
import { Alert02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";
import { easeOut, spring } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";

type PopupProps = ComponentProps<typeof Dialog.Popup>;

interface DialogShellProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onExitComplete?: () => void;
  readonly initialFocus?: PopupProps["initialFocus"];
  readonly finalFocus?: PopupProps["finalFocus"];
  readonly className: string;
  readonly children: ReactNode;
}

export function DialogShell({
  open,
  onOpenChange,
  onExitComplete,
  initialFocus,
  finalFocus,
  className,
  children,
}: DialogShellProps) {
  const still = useReducedMotion() === true;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <AnimatePresence {...(onExitComplete ? { onExitComplete } : {})}>
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
              className="scrim-backdrop fixed inset-0 z-50 backdrop-blur-[2px]"
            />
            <Dialog.Popup
              initialFocus={initialFocus}
              finalFocus={finalFocus}
              render={
                <motion.div
                  initial={still ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1, transition: spring.snappy }}
                  exit={
                    still
                      ? { opacity: 0, transition: { duration: 0.12 } }
                      : { opacity: 0, y: 4, scale: 0.985, transition: { duration: 0.12 } }
                  }
                />
              }
              className={cn(
                "fixed inset-x-0 z-50 mx-auto flex flex-col overflow-hidden rounded-dialog bg-dialog shadow-dialog outline-none",
                className,
              )}
            >
              {children}
            </Dialog.Popup>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

export function DialogCloseButton({ label = "Close" }: { readonly label?: string }) {
  return (
    <Dialog.Close
      aria-label={label}
      render={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="group/close absolute top-[0.5625rem] right-2.5 z-10 size-[1.625rem]"
        />
      }
    >
      <Icon
        icon={Cancel01Icon}
        className="size-3.5 text-fg-muted transition-colors duration-(--dur-hover) group-hover/close:text-fg"
      />
    </Dialog.Close>
  );
}

export function DialogSettings({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <div className={cn("flex flex-col pr-3.5 pl-5", className)}>{children}</div>;
}

export function DialogSettingRow({
  label,
  dirty = false,
  children,
}: {
  readonly label: string;
  readonly dirty?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className="relative flex h-11 shrink-0 items-center justify-between gap-3 before:absolute before:top-0 before:right-1.5 before:left-0 before:h-px before:bg-dialog-line">
      <span className="flex shrink-0 items-center gap-2 text-label text-fg-muted">
        {label}
        {dirty && (
          <>
            <span aria-hidden className="size-[0.3125rem] rounded-full bg-input" />
            <span className="sr-only">(changed)</span>
          </>
        )}
      </span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}

export function DialogFooter({ children }: { readonly children: ReactNode }) {
  return (
    <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-dialog-line pr-4 pl-5">
      {children}
    </footer>
  );
}

export function DialogAlert({ message }: { readonly message: string }) {
  return (
    <p role="alert" className="flex min-w-0 items-center gap-1.5 text-label text-danger">
      <Icon icon={Alert02Icon} className="size-3.5 shrink-0" />
      <span className="truncate">{message}</span>
    </p>
  );
}
