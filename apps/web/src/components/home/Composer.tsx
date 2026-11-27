import { ArrowUp02Icon, Cancel01Icon, Idea01Icon, StopIcon } from "@hugeicons/core-free-icons";
import type {
  InteractionMode,
  ModelSelection,
  ProviderSnapshot,
  ThreadAttachment,
} from "@scuttle/contracts";
import { useNavigate } from "@tanstack/react-router";
import { type ChangeEvent, type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { isSubmitKey, usePreferences } from "@/components/settings/preferences.ts";
import { COMPOSER_ID } from "@/components/shell/AppShell.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { ComposerBottomBar, type ComposerStatus } from "./ComposerBottomBar.tsx";
import { ComposerPalette, paletteOptionId } from "./ComposerPalette.tsx";
import { ComposerPlusMenu } from "./ComposerPlusMenu.tsx";
import type { TextEdit } from "./composerTriggers.ts";
import type { ComposerContextUsage } from "./contextUsage.ts";
import { ModelPicker } from "./ModelPicker.tsx";
import { useComposerPalette } from "./useComposerPalette.ts";

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
  readonly interactionMode?: InteractionMode;
  readonly onInteractionModeChange?: (mode: InteractionMode) => void;
  readonly onCompact?: () => void;
  readonly filesRoot?: string;
  readonly status?: ComposerStatus;
  readonly contextUsage?: ComposerContextUsage;
}

const MIN_TEXTAREA_PX = 60;
const MAX_TEXTAREA_PX = 220;

export function Composer({
  id = COMPOSER_ID,
  placeholder = "Ask anything, / for commands, @ for context",
  providers,
  modelSelection,
  onModelSelectionChange,
  running = false,
  disabled = false,
  onSubmit,
  onStop,
  interactionMode,
  onInteractionModeChange,
  onCompact,
  filesRoot,
  status,
  contextUsage,
}: ComposerProps) {
  const { enterBehavior } = usePreferences();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState<ReadonlyArray<ThreadAttachment>>([]);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingCaretRef = useRef<number | null>(null);

  const applyEdit = (edit: TextEdit) => {
    setCaret(edit.caret);
    if (edit.text === prompt) {
      textareaRef.current?.setSelectionRange(edit.caret, edit.caret);
      return;
    }
    pendingCaretRef.current = edit.caret;
    setPrompt(edit.text);
  };

  const palette = useComposerPalette({
    prompt,
    caret,
    applyEdit,
    filesRoot,
    focused,
    slash: {
      providers,
      modelSelection,
      onModelSelectionChange,
      interactionMode,
      onInteractionModeChange,
      onCompact: running || disabled ? undefined : onCompact,
      onNewThread: () =>
        void navigate({ to: "/" }).then(() => document.getElementById(COMPOSER_ID)?.focus()),
    },
  });

  const trimmed = prompt.trim();
  const empty = trimmed.length === 0;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(MAX_TEXTAREA_PX, Math.max(MIN_TEXTAREA_PX, el.scrollHeight));
    el.style.height = `${next}px`;
    const pendingCaret = pendingCaretRef.current;
    if (pendingCaret !== null) {
      pendingCaretRef.current = null;
      el.focus();
      el.setSelectionRange(pendingCaret, pendingCaret);
    }
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
      applyEdit({ text: "", caret: 0 });
      setAttachments([]);
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (palette.handleKeyDown(event)) return;
    if (event.key === "Escape" && running && onStop) {
      event.preventDefault();
      onStop();
      return;
    }
    if (!isSubmitKey(enterBehavior, event)) return;
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

  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "/") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const activeOptionId =
    palette.content === null ? undefined : paletteOptionId(palette.listboxId, palette.activeIndex);
  const planOn = interactionMode === "plan";

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onKeyDown={onFormKeyDown}
        className="relative rounded-composer bg-panel shadow-composer transition-[background-color,box-shadow] duration-150 ease-out focus-within:bg-raised focus-within:shadow-composer-focus"
      >
        {palette.content && (
          <ComposerPalette
            listboxId={palette.listboxId}
            content={palette.content}
            activeIndex={palette.activeIndex}
            onActiveIndexChange={palette.setActiveIndex}
          />
        )}
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
          onChange={(event) => {
            setPrompt(event.target.value);
            setCaret(event.target.selectionStart);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={palette.content !== null}
          aria-controls={palette.content ? palette.listboxId : undefined}
          aria-activedescendant={activeOptionId}
          className="block w-full resize-none overflow-x-hidden overflow-y-auto bg-transparent px-4 pt-4 pb-1.5 text-prompt text-fg caret-fg outline-none break-words placeholder:text-fg-muted"
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => void onFilesPicked(event)}
        />
        <div className="flex items-center gap-1 px-2.5 pt-1 pb-3">
          <ComposerPlusMenu
            textareaRef={textareaRef}
            filesAvailable={filesRoot !== undefined}
            onUpload={() => fileInputRef.current?.click()}
            onMention={palette.openMentionCategory}
          />

          <ModelPicker
            providers={providers}
            selection={modelSelection}
            onChange={onModelSelectionChange}
          />

          {planOn && onInteractionModeChange && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed
              title="Plan mode is on. Click to turn it off."
              onClick={() => onInteractionModeChange("default")}
              className="text-input hover:text-input"
            >
              <Icon icon={Idea01Icon} />
              Plan
            </Button>
          )}

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
      {(status || contextUsage) && (
        <ComposerBottomBar status={status} contextUsage={contextUsage} />
      )}
    </div>
  );
}
