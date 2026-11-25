import { Menu } from "@base-ui/react/menu";
import {
  ArrowUp02Icon,
  Cancel01Icon,
  PlusSignIcon,
  SlidersHorizontalIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import type {
  InteractionMode,
  ModelSelection,
  ProviderSnapshot,
  RuntimeMode,
  ThreadAttachment,
} from "@scuttle/contracts";
import { type ChangeEvent, type KeyboardEvent, useRef, useState } from "react";
import { COMPOSER_ID } from "@/components/shell/AppShell.tsx";
import { Button, buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { MenuGroupLabel, MenuPopup, MenuRadioItem, MenuSeparator } from "@/components/ui/Menu.tsx";
import { INTERACTION_MODE_LABELS, RUNTIME_MODE_LABELS } from "@/lib/format.ts";
import { ModelPicker } from "./ModelPicker.tsx";

export interface ComposerSubmitPayload {
  readonly prompt: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: InteractionMode;
  readonly attachments: ReadonlyArray<ThreadAttachment>;
}

interface ComposerProps {
  readonly id?: string;
  readonly placeholder?: string;
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly modelSelection: ModelSelection;
  readonly onModelSelectionChange: (selection: ModelSelection) => void;
  readonly runtimeMode: RuntimeMode;
  readonly onRuntimeModeChange: (mode: RuntimeMode) => void;
  readonly interactionMode: InteractionMode;
  readonly onInteractionModeChange: (mode: InteractionMode) => void;
  readonly running?: boolean;
  readonly disabled?: boolean;
  readonly onSubmit: (payload: ComposerSubmitPayload) => Promise<void> | void;
  readonly onStop?: () => void;
}

const RUNTIME_MODES: ReadonlyArray<RuntimeMode> = ["auto", "approval-required", "full-access"];
const INTERACTION_MODES: ReadonlyArray<InteractionMode> = ["default", "plan"];

export function Composer({
  id = COMPOSER_ID,
  placeholder = "Describe a task, or type / for commands",
  providers,
  modelSelection,
  onModelSelectionChange,
  runtimeMode,
  onRuntimeModeChange,
  interactionMode,
  onInteractionModeChange,
  running = false,
  disabled = false,
  onSubmit,
  onStop,
}: ComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<ReadonlyArray<ThreadAttachment>>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const trimmed = prompt.trim();
  const empty = trimmed.length === 0;

  const submit = async () => {
    if (empty || disabled || submitting || running) return;
    setSubmitting(true);
    try {
      await onSubmit({
        prompt: trimmed,
        modelSelection,
        runtimeMode,
        interactionMode,
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
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
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
      className="group/composer relative rounded-composer bg-panel shadow-composer transition-[background-color] duration-300 ease-out has-[textarea:focus]:bg-raised"
    >
      <span
        aria-hidden
        className="composer-trace pointer-events-none absolute inset-0 rounded-[inherit] group-has-[textarea:focus]/composer:animate-trace"
      />
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
        id={id}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={2}
        className="block max-h-60 min-h-[68px] w-full resize-none bg-transparent px-4 pt-3.5 text-prompt text-fg caret-primary-top outline-none [field-sizing:content] placeholder:text-fg-muted placeholder:transition-opacity placeholder:duration-200 focus:placeholder:opacity-70"
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

        <Menu.Root>
          <Menu.Trigger
            aria-label="Thread options"
            className={buttonClass(
              "ghost",
              "md",
              "gap-1.5 px-2 text-fg-secondary data-popup-open:bg-(--wash) data-popup-open:text-fg",
            )}
          >
            <Icon icon={SlidersHorizontalIcon} className="size-3.5" />
            <span className="text-label">
              {interactionMode === "plan"
                ? INTERACTION_MODE_LABELS.plan
                : RUNTIME_MODE_LABELS[runtimeMode]}
            </span>
          </Menu.Trigger>
          <MenuPopup label="Thread options">
            <Menu.Group>
              <MenuGroupLabel>Permissions</MenuGroupLabel>
              <Menu.RadioGroup
                value={runtimeMode}
                onValueChange={(next: unknown) => {
                  const picked = RUNTIME_MODES.find((m) => m === next);
                  if (picked) onRuntimeModeChange(picked);
                }}
              >
                {RUNTIME_MODES.map((mode) => (
                  <MenuRadioItem key={mode} value={mode}>
                    {RUNTIME_MODE_LABELS[mode]}
                  </MenuRadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            <MenuSeparator />
            <Menu.Group>
              <MenuGroupLabel>Mode</MenuGroupLabel>
              <Menu.RadioGroup
                value={interactionMode}
                onValueChange={(next: unknown) => {
                  const picked = INTERACTION_MODES.find((m) => m === next);
                  if (picked) onInteractionModeChange(picked);
                }}
              >
                {INTERACTION_MODES.map((mode) => (
                  <MenuRadioItem key={mode} value={mode}>
                    {INTERACTION_MODE_LABELS[mode]}
                  </MenuRadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
          </MenuPopup>
        </Menu.Root>

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
            <Icon
              icon={ArrowUp02Icon}
              className={`transition-transform duration-300 ease-out-quint ${empty ? "translate-y-px" : "-translate-y-px"}`}
            />
          </Button>
        )}
      </div>
    </form>
  );
}
