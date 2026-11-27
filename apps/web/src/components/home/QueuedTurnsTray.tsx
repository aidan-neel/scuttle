import {
  Attachment01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  SteeringIcon,
} from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { QueuedTurn, ThreadDetail } from "@scuttle/contracts";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type RefObject, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { easeOut } from "@/lib/motion.ts";
import { activeQueuedTurns } from "@/lib/threadDetailReducer.ts";
import { cn } from "@/lib/utils";
import { useWorkspaceActions } from "@/lib/workspace.tsx";
import type { ComposerHandle, ComposerSubmitPayload } from "./Composer.tsx";
import type { ComposerSubmitOutcome } from "./ComposerBottomBar.tsx";

interface QueuedTurnsTrayProps {
  readonly items: ReadonlyArray<QueuedTurn>;
  readonly running: boolean;
  readonly editingId: string | null;
  readonly busyId: string | null;
  readonly onSteerNow: (item: QueuedTurn) => void;
  readonly onEdit: (item: QueuedTurn) => void;
  readonly onCancelEdit: () => void;
  readonly onRemove: (item: QueuedTurn) => void;
}

export const queuedTrayHeading = (count: number, running: boolean): string => {
  const noun = count === 1 ? "message" : "messages";
  return running ? `${count} queued ${noun} · runs after this turn` : `${count} queued ${noun}`;
};

export const queuedSnippet = (prompt: string): string => prompt.replace(/\s+/g, " ").trim();

const REVEAL =
  "opacity-55 transition-opacity duration-(--dur-hover) group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

function QueuedTurnRow({
  item,
  index,
  running,
  editing,
  busy,
  onSteerNow,
  onEdit,
  onCancelEdit,
  onRemove,
}: {
  readonly item: QueuedTurn;
  readonly index: number;
  readonly running: boolean;
  readonly editing: boolean;
  readonly busy: boolean;
  readonly onSteerNow: () => void;
  readonly onEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onRemove: () => void;
}) {
  const attachmentCount = item.attachments?.length ?? 0;
  return (
    <div
      className={cn(
        "group flex items-start gap-2 rounded-row px-2 py-1.5 transition-colors duration-(--dur-hover)",
        editing ? "bg-primary/8 ring-1 ring-primary/30" : "hover:bg-fg/4 focus-within:bg-fg/4",
        busy && "opacity-60",
      )}
    >
      <span className="mt-px inline-flex h-[1.125rem] min-w-[1.375rem] shrink-0 items-center justify-center rounded-chip bg-fg/7 px-1 font-mono text-[0.6875rem] text-fg-muted tabular-nums">
        #{index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-label leading-[1.45] break-words text-fg-secondary">
          {queuedSnippet(item.prompt)}
        </p>
        {(attachmentCount > 0 || editing) && (
          <p className="mt-0.5 flex items-center gap-2 text-meta text-fg-muted">
            {attachmentCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Icon icon={Attachment01Icon} className="size-3" />
                {attachmentCount} {attachmentCount === 1 ? "attachment" : "attachments"}
              </span>
            )}
            {editing && <span className="text-primary">Editing in composer</span>}
          </p>
        )}
      </div>
      {editing ? (
        <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit}>
          Cancel
        </Button>
      ) : (
        <div className={cn("flex shrink-0 items-center gap-0.5", REVEAL)}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onSteerNow}
            title={running ? "Send into the active turn now" : "Move to the front of the queue"}
            className="active:scale-[0.97]"
          >
            <Icon icon={SteeringIcon} />
            {running ? "Steer now" : "Send next"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit queued message ${index + 1}`}
            title="Edit in composer"
            disabled={busy}
            onClick={onEdit}
            className="active:scale-[0.94]"
          >
            <Icon icon={PencilEdit02Icon} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove queued message ${index + 1}`}
            title="Remove from queue"
            disabled={busy}
            onClick={onRemove}
            className="hover:text-danger active:scale-[0.94]"
          >
            <Icon icon={Delete02Icon} />
          </Button>
        </div>
      )}
    </div>
  );
}

export function QueuedTurnsTray({
  items,
  running,
  editingId,
  busyId,
  onSteerNow,
  onEdit,
  onCancelEdit,
  onRemove,
}: QueuedTurnsTrayProps) {
  const still = useReducedMotion() === true;
  return (
    <AnimatePresence initial={false}>
      {items.length > 0 && (
        <motion.section
          key="queued-tray"
          aria-label="Queued messages"
          initial={still ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={still ? { opacity: 0 } : { opacity: 0, y: 6 }}
          transition={{ duration: 0.16, ease: easeOut }}
          className="mx-3 rounded-t-card bg-panel/85 px-1.5 pt-1.5 pb-2 shadow-raised backdrop-blur-sm"
        >
          <h3 className="px-2 pb-1 text-meta text-fg-muted">
            {queuedTrayHeading(items.length, running)}
          </h3>
          <ol className="scrollbar-none flex max-h-44 flex-col gap-px overflow-y-auto">
            {items.map((item, index) => (
              <li key={item.id}>
                <QueuedTurnRow
                  item={item}
                  index={index}
                  running={running}
                  editing={item.id === editingId}
                  busy={item.id === busyId}
                  onSteerNow={() => onSteerNow(item)}
                  onEdit={() => onEdit(item)}
                  onCancelEdit={onCancelEdit}
                  onRemove={() => onRemove(item)}
                />
              </li>
            ))}
          </ol>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

export function useQueuedTurnsTray({
  detail,
  running,
  composerRef,
  onError,
}: {
  readonly detail: ThreadDetail;
  readonly running: boolean;
  readonly composerRef: RefObject<ComposerHandle | null>;
  readonly onError: (message: string | null) => void;
}) {
  const { editQueuedTurn, cancelQueuedTurn, promoteQueuedTurn } = useWorkspaceActions();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const threadId = detail.thread.id;
  const items = activeQueuedTurns(detail.queuedTurns ?? []);
  const editing = items.find((item) => item.id === editingId) ?? null;

  const act = async (item: QueuedTurn, run: () => Promise<unknown>, fallback: string) => {
    setBusyId(item.id);
    onError(null);
    try {
      await run();
    } catch (error) {
      onError(describeApiError(error, fallback));
    } finally {
      setBusyId(null);
    }
  };

  const submitEdit = async (
    payload: ComposerSubmitPayload,
  ): Promise<ComposerSubmitOutcome | null> => {
    if (editing === null) return null;
    const updated = await editQueuedTurn(threadId, editing.id, {
      prompt: payload.prompt,
      ...(payload.attachments.length > 0 ? { attachments: [...payload.attachments] } : {}),
    });
    setEditingId(null);
    return updated.status === "queued" ? { kind: "edited" } : null;
  };

  const tray: QueuedTurnsTrayProps = {
    items,
    running,
    editingId: editing?.id ?? null,
    busyId,
    onSteerNow: (item) =>
      void act(item, () => promoteQueuedTurn(threadId, item.id), "Could not send that message."),
    onEdit: (item) => {
      setEditingId(item.id);
      composerRef.current?.setDraft(item.prompt);
    },
    onCancelEdit: () => {
      setEditingId(null);
      composerRef.current?.setDraft("");
    },
    onRemove: (item) =>
      void act(item, () => cancelQueuedTurn(threadId, item.id), "Could not remove that message."),
  };

  return { tray, submitEdit };
}
