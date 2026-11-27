import { Dialog } from "@base-ui/react/dialog";
import { Cancel01Icon, Image01Icon, TextAlignLeftIcon } from "@hugeicons/core-free-icons";
import { type RefObject, useRef } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { DialogShell } from "@/components/ui/DialogShell.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { type EmbedOf, formatByteSize } from "./composerEmbeds.ts";

export type PreviewableEmbed = EmbedOf<"image"> | EmbedOf<"snippet">;

interface ComposerEmbedPreviewDialogProps {
  readonly embed: PreviewableEmbed | null;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly onRemove: () => void;
  readonly onMoveToInput: () => void;
}

const describe = (embed: PreviewableEmbed) =>
  embed.kind === "image"
    ? [embed.mimeType, formatByteSize(embed.sizeBytes)].filter(Boolean).join(" · ")
    : `${embed.lineCount} ${embed.lineCount === 1 ? "line" : "lines"} · ${formatByteSize(
        new Blob([embed.content]).size,
      )}`;

function PreviewBody({ embed }: { readonly embed: PreviewableEmbed }) {
  if (embed.kind === "image") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black/20 p-4">
        {embed.previewUrl ? (
          <img
            src={embed.previewUrl}
            alt={embed.name}
            className="max-h-[min(68dvh,45rem)] max-w-full rounded-row object-contain"
          />
        ) : (
          <p className="py-10 text-label text-fg-muted">No preview available.</p>
        )}
      </div>
    );
  }

  return (
    <pre
      tabIndex={0}
      aria-label={`${embed.label} contents`}
      className="max-h-[min(60dvh,35rem)] min-h-0 flex-1 overflow-auto bg-black/20 px-4 py-3 font-mono text-meta leading-[1.65] whitespace-pre text-fg-secondary outline-none focus-visible:shadow-[inset_0_0_0_2px_rgb(235_235_236/42%)]"
    >
      {embed.content}
    </pre>
  );
}

function PreviewCard({
  embed,
  primaryRef,
  onClose,
  onRemove,
  onMoveToInput,
}: {
  readonly embed: PreviewableEmbed;
  readonly primaryRef: RefObject<HTMLButtonElement | null>;
  readonly onClose: () => void;
  readonly onRemove: () => void;
  readonly onMoveToInput: () => void;
}) {
  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-dialog-line pr-1.5 pl-4">
        <Icon
          icon={embed.kind === "image" ? Image01Icon : TextAlignLeftIcon}
          className="size-3.5 shrink-0 text-fg-muted"
        />
        <Dialog.Title className="min-w-0 truncate text-label font-medium text-fg">
          {embed.kind === "image" ? embed.name : embed.label}
        </Dialog.Title>
        <Dialog.Description className="shrink-0 truncate text-meta text-fg-muted tabular-nums">
          {describe(embed)}
        </Dialog.Description>
        <span className="flex-1" />
        <Dialog.Close
          aria-label="Close preview"
          render={<Button type="button" variant="ghost" size="icon" />}
        >
          <Icon icon={Cancel01Icon} />
        </Dialog.Close>
      </header>
      <PreviewBody embed={embed} />
      <footer className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-dialog-line px-3">
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={() => {
            onRemove();
            onClose();
          }}
        >
          Remove
        </Button>
        {embed.kind === "snippet" ? (
          <Button
            ref={primaryRef}
            type="button"
            variant="primary"
            size="md"
            onClick={() => {
              onMoveToInput();
              onClose();
            }}
          >
            Move to input
          </Button>
        ) : (
          <Button ref={primaryRef} type="button" variant="secondary" size="md" onClick={onClose}>
            Done
          </Button>
        )}
      </footer>
    </>
  );
}

export function ComposerEmbedPreviewDialog({
  embed,
  returnFocusRef,
  onClose,
  onRemove,
  onMoveToInput,
}: ComposerEmbedPreviewDialogProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  return (
    <DialogShell
      open={embed !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      initialFocus={primaryRef}
      finalFocus={returnFocusRef}
      className="inset-y-0 my-auto h-fit max-h-[calc(100dvh-2rem)] w-[min(47.5rem,calc(100vw-2rem))]"
    >
      {embed && (
        <PreviewCard
          embed={embed}
          primaryRef={primaryRef}
          onClose={onClose}
          onRemove={onRemove}
          onMoveToInput={onMoveToInput}
        />
      )}
    </DialogShell>
  );
}
