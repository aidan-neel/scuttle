import { Dialog } from "@base-ui/react/dialog";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { DialogAlert, DialogShell } from "@/components/ui/DialogShell.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";

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
    <DialogShell
      open={open}
      onOpenChange={requestOpenChange}
      onExitComplete={() => setFailed(false)}
      initialFocus={confirmRef}
      className="top-[22vh] w-[min(25.625rem,calc(100vw-2rem))]"
    >
      <div className="flex flex-col gap-2 px-5 pt-5 pb-1">
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em] text-fg">
          {title}
        </Dialog.Title>
        <Dialog.Description className="text-label leading-5 text-fg-muted">
          {description}
        </Dialog.Description>
      </div>
      <div className="flex items-center gap-2 py-4 pr-4 pl-5">
        <div className="min-w-0 flex-1">
          {failed && <DialogAlert message="Something went wrong." />}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="dialog"
          disabled={working}
          onClick={() => requestOpenChange(false)}
        >
          {cancelLabel}
        </Button>
        <Button
          ref={confirmRef}
          type="button"
          variant={tone === "danger" ? "destructive" : "primary"}
          size="dialog"
          disabled={working}
          onClick={() => void confirm()}
          className="font-medium"
        >
          {working && <DotSpinner variant="working" label="Working" />}
          {confirmLabel}
        </Button>
      </div>
    </DialogShell>
  );
}
