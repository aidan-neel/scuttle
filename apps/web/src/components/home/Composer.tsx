import { ArrowUp02Icon, Cancel01Icon, PlusSignIcon, StopIcon } from "@hugeicons/core-free-icons";
import type { ModelSelection, ProviderSnapshot, ThreadAttachment } from "@scuttle/contracts";
import { type ChangeEvent, type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { isSubmitKey, usePreferences } from "@/components/settings/preferences.ts";
import { COMPOSER_ID } from "@/components/shell/AppShell.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { ModelPicker } from "./ModelPicker.tsx";

export interface ComposerSubmitPayload {
  readonly prompt: string;
  readonly modelSelection: ModelSelection;
  readonly attachments: ReadonlyArray<ThreadAttachment>;
}

interface ComposerProps {
  readonly id?: string;
  readonly placeholder?: string;
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly modelSelection: ModelSelection;
  readonly onModelSelectionChange: (selection: ModelSelection) => void;
  readonly running?: boolean;
  readonly disabled?: boolean;
  readonly onSubmit: (payload: ComposerSubmitPayload) => Promise<void> | void;
  readonly onStop?: () => void;
}

const MIN_TEXTAREA_PX = 56;
const MAX_TEXTAREA_PX = 220;

export function Composer({
  id = COMPOSER_ID,
  placeholder = "Ask anything, / for commands",
  providers,
  modelSelection,
  onModelSelectionChange,
  running = false,
  disabled = false,
  onSubmit,
  onStop,
}: ComposerProps) {
  const { enterBehavior } = usePreferences();
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<ReadonlyArray<ThreadAttachment>>([]);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const trimmed = prompt.trim();
  const empty = trimmed.length === 0;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(MAX_TEXTAREA_PX, Math.max(MIN_TEXTAREA_PX, el.scrollHeight));
    el.style.height = `${next}px`;
  }, [prompt]);

  const submit = async () => {
    if (empty || disabled || submitting || running) return;
    setSubmitting(true);
    try {
      await onSubmit({
        prompt: trimmed,
        modelSelection,
        attachments,
      });
      setPrompt("");
      setAttachments([]);
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && running && onStop) {
      event.preventDefault();
      onStop();
      return;
    }
    if (event.nativeEvent.isComposing || !isSubmitKey(enterBehavior, event)) return;
    event.preventDefault();
    void submit();
  };

  const onFilesPicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const loaded: ThreadAttachment[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      const content = file.size <= 256_000 ? await file.text().catch(() => undefined) : undefined;
      loaded.push({
        name: file.name,
        ...(content !== undefined ? { content } : {}),
        ...(file.type ? { mimeType: file.type } : {}),
      });
    }
    setAttachments((prev) => [...prev, ...loaded]);
    event.target.value = "";
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="relative rounded-composer bg-panel shadow-composer transition-[background-color,box-shadow] duration-150 ease-out focus-within:bg-raised focus-within:shadow-composer-focus"
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3.5 pt-3">
          {attachments.map((file, idx) => (
            <span
              key={`${file.name}-${idx}`}
              className="inline-flex items-center gap-1 rounded-chip bg-white/7 px-2 py-0.5 text-meta text-fg-secondary"
            >
              <span className="max-w-44 truncate">{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                className="text-fg-muted hover:text-fg"
              >
                <Icon icon={Cancel01Icon} className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <label htmlFor={id} className="sr-only">
        Task
      </label>
      <textarea
        ref={textareaRef}
        id={id}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={2}
        className="block w-full resize-none overflow-x-hidden overflow-y-auto bg-transparent px-4 pt-3.5 pb-1 text-prompt text-fg caret-fg outline-none break-words placeholder:text-fg-muted"
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => void onFilesPicked(event)}
      />
      <div className="flex items-center gap-1 px-2.5 pt-1 pb-2.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Attach files"
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon icon={PlusSignIcon} />
        </Button>

        <ModelPicker
          providers={providers}
          selection={modelSelection}
          onChange={onModelSelectionChange}
        />

        <span className="flex-1" />

        {running && onStop ? (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            aria-label="Stop running turn"
            onClick={onStop}
          >
            <Icon icon={StopIcon} />
          </Button>
        ) : (
          <Button
            type="submit"
            variant={empty ? "secondary" : "primary"}
            size="icon"
            aria-label="Send message"
            disabled={empty || disabled || submitting}
            className="disabled:opacity-50"
          >
            <Icon icon={ArrowUp02Icon} />
          </Button>
        )}
      </div>
    </form>
  );
}
