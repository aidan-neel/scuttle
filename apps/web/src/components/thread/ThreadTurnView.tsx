import { Dialog } from "@base-ui/react/dialog";
import { Cancel01Icon, Image01Icon, RewindIcon } from "@hugeicons/core-free-icons";
import type {
  RespondApprovalInput,
  ThreadAttachment,
  ThreadCheckpoint,
  ThreadTurn,
  ThreadVisualization,
} from "@scuttle/contracts";
import { memo, useEffect, useState } from "react";
import {
  attachmentUrl,
  formatByteSize,
  getCachedAttachmentBaseUrl,
  resolveAttachmentBaseUrl,
} from "@/components/home/composerEmbeds.ts";
import { Button } from "@/components/ui/Button.tsx";
import { DialogShell } from "@/components/ui/DialogShell.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { ScuttleVizCard } from "@/components/viz/index.ts";
import { getDesktopBridge } from "@/lib/desktopBridge.ts";
import { formatClockTime } from "@/lib/format.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { MarkdownView } from "./MarkdownView.tsx";
import { WorkProgress } from "./WorkProgress.tsx";

interface ThreadTurnViewProps {
  readonly turn: ThreadTurn;
  readonly minHeightPx?: number;
  readonly checkpoint?: ThreadCheckpoint | undefined;
  readonly visualizations?: ReadonlyArray<ThreadVisualization>;
  readonly onRewind?: ((turnId: string) => void) | undefined;
  readonly onRespondApproval: (
    threadId: string,
    approvalId: string,
    input: RespondApprovalInput,
  ) => Promise<void>;
}

type ImageAttachment = ThreadAttachment & { readonly id: string };

const isImageAttachment = (att: ThreadAttachment): att is ImageAttachment =>
  typeof att.id === "string" &&
  att.id.length > 0 &&
  (att.kind === "image" || att.mimeType?.startsWith("image/") === true);

function TurnImageThumbnail({
  attachment,
  src,
  onPreview,
}: {
  readonly attachment: ImageAttachment;
  readonly src: string | undefined;
  readonly onPreview: () => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={onPreview}
      aria-label={`Preview ${attachment.name}`}
      title={
        attachment.sizeBytes !== undefined
          ? `${attachment.name} · ${formatByteSize(attachment.sizeBytes)}`
          : attachment.name
      }
      className="group relative cursor-pointer overflow-hidden rounded-card border border-edge/60 bg-panel transition-[border-color,opacity] duration-(--dur-hover) hover:border-edge-strong focus-visible:outline-none focus-visible:shadow-focus"
    >
      {src && !failed ? (
        <img
          src={src}
          alt={attachment.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="block max-h-40 max-w-56 object-cover transition-opacity duration-(--dur-hover) group-hover:opacity-90"
        />
      ) : (
        <span className="flex items-center gap-1.5 px-2.5 py-1.5 text-meta text-fg-secondary">
          <Icon icon={Image01Icon} className="size-3.5 text-fg-muted" />
          <span className="max-w-44 truncate">{attachment.name}</span>
        </span>
      )}
    </button>
  );
}

function TurnAttachmentLightbox({
  attachment,
  src,
  onClose,
}: {
  readonly attachment: ImageAttachment | null;
  readonly src: string | undefined;
  readonly onClose: () => void;
}) {
  const meta = attachment
    ? [
        attachment.mimeType,
        attachment.sizeBytes !== undefined ? formatByteSize(attachment.sizeBytes) : undefined,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <DialogShell
      open={attachment !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      className="inset-y-0 my-auto h-fit max-h-[calc(100dvh-2rem)] w-[min(52rem,calc(100vw-2rem))]"
    >
      {attachment && (
        <>
          <header className="flex h-11 shrink-0 items-center gap-2 border-b border-dialog-line pr-1.5 pl-4">
            <Icon icon={Image01Icon} className="size-3.5 shrink-0 text-fg-muted" />
            <Dialog.Title className="min-w-0 truncate text-label font-medium text-fg">
              {attachment.name}
            </Dialog.Title>
            {meta.length > 0 && (
              <Dialog.Description className="shrink-0 truncate text-meta text-fg-muted tabular-nums">
                {meta}
              </Dialog.Description>
            )}
            <span className="flex-1" />
            <Dialog.Close
              aria-label="Close preview"
              render={<Button type="button" variant="ghost" size="icon" />}
            >
              <Icon icon={Cancel01Icon} />
            </Dialog.Close>
          </header>
          <div className="flex min-h-0 flex-1 items-center justify-center bg-black/20 p-4">
            {src ? (
              <img
                src={src}
                alt={attachment.name}
                className="max-h-[min(75dvh,48rem)] max-w-full rounded-row object-contain"
              />
            ) : (
              <p className="py-10 text-label text-fg-muted">Loading image…</p>
            )}
          </div>
          <footer className="flex h-12 shrink-0 items-center justify-end border-t border-dialog-line px-3">
            <Button type="button" variant="secondary" size="md" onClick={onClose}>
              Done
            </Button>
          </footer>
        </>
      )}
    </DialogShell>
  );
}

function CheckpointPill({ checkpoint }: { readonly checkpoint: ThreadCheckpoint }) {
  const files = checkpoint.filesChanged === 1 ? "1 file" : `${checkpoint.filesChanged} files`;
  return (
    <span
      title={`Checkpoint #${checkpoint.ordinal} · ${files} changed in this turn`}
      className="inline-flex h-5 items-center gap-1.5 rounded-chip bg-fg/5 px-1.5 font-mono text-[0.6875rem] text-fg-muted tabular-nums"
    >
      <span className="text-success/85">+{checkpoint.insertions}</span>
      <span className="text-danger/85">−{checkpoint.deletions}</span>
      <span className="font-sans text-fg-faint">{files}</span>
    </span>
  );
}

export const ThreadTurnView = memo(function ThreadTurnView({
  turn,
  minHeightPx = 0,
  checkpoint,
  visualizations = [],
  onRewind,
  onRespondApproval,
}: ThreadTurnViewProps) {
  const isDesktop = getDesktopBridge() !== null;
  const [desktopBaseUrl, setDesktopBaseUrl] = useState<string | undefined>(
    getCachedAttachmentBaseUrl,
  );
  const [previewAttachment, setPreviewAttachment] = useState<ImageAttachment | null>(null);

  const imageAttachments = (turn.attachments ?? []).filter(isImageAttachment);
  const needsDesktopUrl = isDesktop && imageAttachments.length > 0 && desktopBaseUrl === undefined;

  useEffect(() => {
    if (!needsDesktopUrl) return;
    let active = true;
    void resolveAttachmentBaseUrl().then((url) => {
      if (active && url !== undefined) setDesktopBaseUrl(url);
    });
    return () => {
      active = false;
    };
  }, [needsDesktopUrl]);

  const streaming = turn.status === "running";
  const isSystem = turn.origin === "system";
  const clockTime = isSystem ? formatClockTime(turn.startedAt) : "";
  const anchored = minHeightPx > 0;
  const srcFor = (id: string) =>
    !isDesktop || desktopBaseUrl !== undefined ? attachmentUrl(id, desktopBaseUrl) : undefined;

  return (
    <article
      data-turn-id={turn.id}
      style={anchored ? { minHeight: minHeightPx } : undefined}
      className={
        streaming || anchored
          ? "scroll-mt-6"
          : "scroll-mt-6 [content-visibility:auto] [contain-intrinsic-size:auto_320px]"
      }
    >
      {isSystem ? (
        clockTime.length > 0 && (
          <p className="mb-2 text-center text-meta text-fg-faint tabular-nums">{clockTime}</p>
        )
      ) : (
        <div className="mb-5 flex flex-col items-end gap-1.5">
          {imageAttachments.length > 0 && (
            <div className="flex max-w-[78%] flex-wrap justify-end gap-2">
              {imageAttachments.map((att) => (
                <TurnImageThumbnail
                  key={att.id}
                  attachment={att}
                  src={srcFor(att.id)}
                  onPreview={() => setPreviewAttachment(att)}
                />
              ))}
            </div>
          )}
          <div className="group/prompt flex max-w-[78%] items-start justify-end gap-1">
            {onRewind && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Rewind to before this message"
                title="Rewind to before this message"
                onClick={() => onRewind(turn.id)}
                className="mt-1 opacity-0 transition-opacity duration-(--dur-hover) group-hover/prompt:opacity-100 focus-visible:opacity-100 active:scale-[0.94] [@media(hover:none)]:opacity-100"
              >
                <Icon icon={RewindIcon} />
              </Button>
            )}
            <div className="min-w-0 rounded-canvas bg-raised px-3.5 py-2 text-[0.90625rem] leading-[1.5] text-fg whitespace-pre-wrap break-words">
              {turn.userMessage}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <WorkProgress turn={turn} />

        {turn.approvals.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            onRespond={(input) => onRespondApproval(turn.threadId, approval.id, input)}
          />
        ))}

        {turn.assistantMessage.trim().length > 0 && (
          <div>
            <MarkdownView content={turn.assistantMessage} streaming={streaming} />
          </div>
        )}

        {visualizations.map((viz) => (
          <ScuttleVizCard key={viz.id} spec={viz.spec} className="my-3" />
        ))}

        {!streaming && checkpoint !== undefined && checkpoint.filesChanged > 0 && (
          <div className="flex pt-1">
            <CheckpointPill checkpoint={checkpoint} />
          </div>
        )}

        {turn.status === "failed" && turn.error && (
          <div className="rounded-card border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-label text-danger">
            {turn.error}
          </div>
        )}
      </div>

      <TurnAttachmentLightbox
        attachment={previewAttachment}
        src={previewAttachment ? srcFor(previewAttachment.id) : undefined}
        onClose={() => setPreviewAttachment(null)}
      />
    </article>
  );
});
