import { Dialog } from "@base-ui/react/dialog";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { ThreadDetail } from "@scuttle/contracts";
import { type RefObject, useState } from "react";
import type { ComposerHandle } from "@/components/home/Composer.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { DialogShell } from "@/components/ui/DialogShell.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { planRewind, type RewindPlan } from "@/lib/threadDetailReducer.ts";
import { useWorkspaceActions } from "@/lib/workspace.tsx";
import { cn } from "@/lib/utils";

const CHOICES = [
  {
    restoreFiles: true,
    title: "Rewind conversation + restore files",
    body: "Drop the later messages and reset the working tree to this checkpoint.",
  },
  {
    restoreFiles: false,
    title: "Rewind conversation only",
    body: "Drop the later messages but keep every file exactly as it is now.",
  },
] as const;

function RewindBody({
  plan,
  onCancel,
  onConfirm,
}: {
  readonly plan: RewindPlan;
  readonly onCancel: () => void;
  readonly onConfirm: (restoreFiles: boolean) => Promise<void>;
}) {
  const [restoreFiles, setRestoreFiles] = useState(plan.target.ref.length > 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasEdits = plan.insertions + plan.deletions > 0;
  const messages = plan.turnsRemoved === 1 ? "1 message" : `${plan.turnsRemoved} messages`;

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm(restoreFiles);
    } catch (err) {
      setError(describeApiError(err, "Could not rewind this thread."));
      setPending(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1.5 px-5 pt-5">
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em] text-fg">
          Rewind to before this message
        </Dialog.Title>
        <Dialog.Description className="text-label leading-5 text-fg-muted">
          Removes {messages} and puts this prompt back in the composer so you can tweak and resend.
        </Dialog.Description>
      </div>
      <div className="mx-5 mt-3 rounded-card bg-panel px-3 py-2.5 shadow-raised">
        <p className="line-clamp-2 text-label text-fg-secondary">{plan.turn.userMessage}</p>
        <p className="mt-1.5 flex items-center gap-2 font-mono text-meta text-fg-muted tabular-nums">
          <span>Checkpoint #{plan.target.ordinal}</span>
          <span aria-hidden>·</span>
          {hasEdits ? (
            <span title="Line changes made after this checkpoint">
              <span className="text-success">+{plan.insertions}</span>{" "}
              <span className="text-danger">−{plan.deletions}</span> since
            </span>
          ) : (
            <span>no file changes since</span>
          )}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="What to rewind"
        className="flex flex-col gap-1.5 px-5 pt-3"
      >
        {CHOICES.map((choice) => {
          const checked = choice.restoreFiles === restoreFiles;
          return (
            <button
              key={choice.title}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={pending}
              onClick={() => setRestoreFiles(choice.restoreFiles)}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-card px-3 py-2.5 text-left outline-none transition-[background-color,box-shadow] duration-(--dur-hover) focus-visible:shadow-focus",
                checked ? "bg-primary/8 ring-1 ring-primary/35" : "ring-1 ring-line hover:bg-fg/4",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full ring-1",
                  checked ? "ring-primary" : "ring-edge-strong",
                )}
              >
                {checked && <span className="size-1.5 rounded-full bg-primary" />}
              </span>
              <span className="min-w-0">
                <span className="block text-label font-medium text-fg">{choice.title}</span>
                <span className="block text-meta text-fg-muted">{choice.body}</span>
              </span>
            </button>
          );
        })}
      </div>
      {restoreFiles && hasEdits && (
        <p className="mx-5 mt-2.5 flex items-start gap-1.5 text-meta text-warning">
          <Icon icon={Alert02Icon} className="mt-px size-3.5 shrink-0" />
          Restoring files discards the {plan.changedCheckpoints === 1 ? "edit" : "edits"} made after
          this checkpoint, including any you made by hand.
        </p>
      )}
      <div className="flex items-center gap-2 py-4 pr-4 pl-5">
        <div className="min-w-0 flex-1">
          {error !== null && (
            <p role="alert" className="text-meta leading-4 text-danger">
              {error}
            </p>
          )}
        </div>
        <Button type="button" variant="ghost" size="dialog" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="dialog"
          disabled={pending}
          onClick={() => void confirm()}
        >
          {pending && <DotSpinner variant="working" label="Rewinding" />}
          Rewind
        </Button>
      </div>
    </>
  );
}

export function useRewindFlow({
  detail,
  composerRef,
}: {
  readonly detail: ThreadDetail;
  readonly composerRef: RefObject<ComposerHandle | null>;
}) {
  const { rewindThread } = useWorkspaceActions();
  const [targetTurnId, setTargetTurnId] = useState<string | null>(null);
  const plan =
    targetTurnId === null ? null : planRewind(detail.turns, detail.checkpoints ?? [], targetTurnId);

  const confirm = async (restoreFiles: boolean) => {
    if (plan === null) return;
    const result = await rewindThread(detail.thread.id, {
      checkpointOrdinal: plan.target.ordinal,
      restoreFiles,
    });
    setTargetTurnId(null);
    composerRef.current?.setDraft(result.restoredPrompt);
  };

  return {
    requestRewind: (turnId: string) => setTargetTurnId(turnId),
    dialog: { plan, onClose: () => setTargetTurnId(null), onConfirm: confirm },
  };
}

export function RewindDialog({
  plan,
  onClose,
  onConfirm,
}: {
  readonly plan: RewindPlan | null;
  readonly onClose: () => void;
  readonly onConfirm: (restoreFiles: boolean) => Promise<void>;
}) {
  return (
    <DialogShell
      open={plan !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      className="top-[16vh] w-[min(28rem,calc(100vw-2rem))]"
    >
      {plan && (
        <RewindBody key={plan.turn.id} plan={plan} onCancel={onClose} onConfirm={onConfirm} />
      )}
    </DialogShell>
  );
}
