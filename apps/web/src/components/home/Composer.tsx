import { type InitialConfigType, LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { EditorRefPlugin } from "@lexical/react/LexicalEditorRefPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import type {
  InteractionMode,
  ModelSelection,
  ProviderSnapshot,
  ThreadAttachment,
} from "@scuttle/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  $getSelection,
  $isRangeSelection,
  CLEAR_HISTORY_COMMAND,
  HISTORIC_TAG,
  type LexicalEditor,
} from "lexical";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { isSubmitKey, usePreferences } from "@/components/settings/preferences.ts";
import { COMPOSER_ID } from "@/components/shell/AppShell.tsx";
import { cn } from "@/lib/utils";
import { useWorkspaceSelector } from "@/lib/workspace.tsx";
import {
  type ActiveDispatchMode,
  ComposerActionRow,
  ComposerBottomBar,
  type ComposerStatus,
  type ComposerSubmitOutcome,
  isQueueShortcut,
  resolveSendMode,
} from "./ComposerBottomBar.tsx";
import type { ComposerProjectControl } from "./ComposerContextBar.tsx";
import { ComposerDropOverlay, ComposerEmbedNode, EmbedTokenContext } from "./ComposerEmbedNode.tsx";
import {
  ComposerEmbedPreviewDialog,
  type PreviewableEmbed,
} from "./ComposerEmbedPreviewDialog.tsx";
import {
  $clearComposer,
  $insertEmbedsAtSelection,
  $insertTriggerAtSelection,
  $removeEmbedNode,
  $removeEmbeds,
  $replaceEmbedWithText,
  $replaceRangeWithEmbed,
  $replaceRangeWithText,
  ComposerEditorPlugin,
  EMPTY_SNAPSHOT,
  type EditorSnapshot,
} from "./ComposerLexicalPlugins.tsx";
import { ComposerPalette, paletteOptionId } from "./ComposerPalette.tsx";
import {
  type ComposerEmbed,
  createSkillEmbed,
  createSnippetEmbed,
  extractInlineSkillCommand,
  reconcileTrackedBlobUrls,
  serializeComposerSegments,
  shouldEmbedPastedText,
} from "./composerEmbeds.ts";
import type { ComposerContextUsage } from "./contextUsage.ts";
import { useComposerFileIngest } from "./useComposerFileIngest.ts";
import { type PaletteEditorOps, useComposerPalette } from "./useComposerPalette.ts";

export interface ComposerSubmitPayload {
  readonly prompt: string;
  readonly modelSelection: ModelSelection;
  readonly attachments: ReadonlyArray<ThreadAttachment>;
  readonly mode?: ActiveDispatchMode;
}

export interface ComposerHandle {
  readonly setDraft: (text: string) => void;
}

interface ComposerProps {
  readonly ref?: Ref<ComposerHandle>;
  readonly id?: string;
  readonly placeholder?: string | undefined;
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly modelSelection: ModelSelection;
  readonly onModelSelectionChange: (selection: ModelSelection) => void;
  readonly running?: boolean;
  readonly disabled?: boolean;
  readonly onSubmit: (
    payload: ComposerSubmitPayload,
  ) => Promise<ComposerSubmitOutcome | void> | ComposerSubmitOutcome | void;
  readonly onStop?: () => void;
  readonly interactionMode?: InteractionMode;
  readonly onInteractionModeChange?: (mode: InteractionMode) => void;
  readonly onCompact?: (() => void) | undefined;
  readonly filesRoot?: string | undefined;
  readonly project?: ComposerProjectControl | undefined;
  readonly status?: ComposerStatus | undefined;
  readonly contextUsage?: ComposerContextUsage | undefined;
  readonly threadCompactAtTokens?: number | undefined;
  readonly onCompactAtChange?: ((tokens: number | null) => Promise<void> | void) | undefined;
  readonly compact?: boolean;
}

const EDITOR_CONFIG: InitialConfigType = {
  namespace: "scuttle-composer",
  nodes: [ComposerEmbedNode],
  onError: (error) => {
    throw error;
  },
};

const isPlan = (embed: ComposerEmbed) => embed.kind === "command" && embed.command === "plan";
const SUBMIT_CLEAR_TAG = "composer-submit-clear";

export function Composer(props: ComposerProps) {
  return (
    <LexicalComposer initialConfig={EDITOR_CONFIG}>
      <ComposerEditor {...props} />
    </LexicalComposer>
  );
}

function ComposerEditor({
  ref,
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
  project,
  status,
  contextUsage,
  threadCompactAtTokens,
  onCompactAtChange,
  compact = false,
}: ComposerProps) {
  const { enterBehavior, activeTurnDispatch } = usePreferences();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<EditorSnapshot>(EMPTY_SNAPSHOT);
  const [focused, setFocused] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const skills = useWorkspaceSelector((s) => s.skills);
  const editorRef = useRef<LexicalEditor | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const blobUrlsRef = useRef(new Set<string>());
  const planNodeRef = useRef(false);
  const snippetCountRef = useRef(0);

  const revokeBlobUrls = () => {
    for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
    blobUrlsRef.current.clear();
  };

  useEffect(() => () => revokeBlobUrls(), []);

  const edit = (fn: () => void) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.update(fn);
    editor.focus();
  };

  const { dragging, uploadingCount, uploadError, clearUploadError, addFiles, ...ingest } =
    useComposerFileIngest({
      blobUrlsRef,
      insertEmbeds: (embeds) => edit(() => $insertEmbedsAtSelection(embeds)),
    });

  useImperativeHandle(ref, () => ({
    setDraft: (text) =>
      edit(() => {
        $clearComposer();
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertRawText(text);
      }),
  }));

  useEffect(() => {
    if (interactionMode === "plan" || !planNodeRef.current) return;
    editorRef.current?.update(() => $removeEmbeds(isPlan));
  }, [interactionMode]);

  const insertEmbed = (embed: ComposerEmbed, place: () => void) => {
    edit(() => {
      place();
      if (embed.kind !== "skill" && embed.kind !== "command") return;
      $removeEmbeds((other) => other.kind === embed.kind && other.id !== embed.id);
    });
  };

  const ops: PaletteEditorOps = {
    replaceWithEmbed: (trigger, embed) =>
      insertEmbed(embed, () =>
        $replaceRangeWithEmbed(trigger.nodeKey, trigger.start, trigger.end, embed),
      ),
    replaceWithText: (trigger, start, text) =>
      edit(() => $replaceRangeWithText(trigger.nodeKey, start, trigger.end, text)),
    insertTrigger: (char) => edit(() => $insertTriggerAtSelection(char)),
  };

  const palette = useComposerPalette({
    caret: snapshot.caret,
    ops,
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

  const draft = serializeComposerSegments(snapshot.segments);
  const planNodePresent = snapshot.embeds.some(({ embed }) => isPlan(embed));
  const planPill =
    interactionMode === "plan" && onInteractionModeChange !== undefined && !planNodePresent;
  const previewPlaced = snapshot.embeds.find(({ nodeKey }) => nodeKey === previewKey);
  const previewEmbed: PreviewableEmbed | null =
    previewPlaced?.embed.kind === "image" || previewPlaced?.embed.kind === "snippet"
      ? previewPlaced.embed
      : null;

  const onEditorUpdate = (next: EditorSnapshot, tags: ReadonlySet<string>) => {
    setSnapshot(next);
    reconcileTrackedBlobUrls(blobUrlsRef.current, next.embeds);
    const hasPlan = next.embeds.some(({ embed }) => isPlan(embed));
    if (hasPlan !== planNodeRef.current) {
      planNodeRef.current = hasPlan;
      if (!tags.has(SUBMIT_CLEAR_TAG)) onInteractionModeChange?.(hasPlan ? "plan" : "default");
    }
    const caret = next.caret;
    if (tags.has(HISTORIC_TAG) || caret === null) return;
    const promoted = extractInlineSkillCommand(caret.text.slice(0, caret.offset), skills);
    if (!promoted) return;
    const embed = createSkillEmbed(promoted.skill);
    insertEmbed(embed, () =>
      $replaceRangeWithEmbed(caret.nodeKey, promoted.start, promoted.end, embed),
    );
  };

  const canSend = draft !== null && !disabled && !submitting && uploadingCount === 0;

  const submit = (flip = false) => {
    const editor = editorRef.current;
    if (!canSend || draft === null || editor === null) return;
    const mode = resolveSendMode(running, activeTurnDispatch, flip);
    setSubmitting(true);
    const run = async () => {
      const outcome = await onSubmit({
        prompt: draft.prompt,
        modelSelection,
        attachments: draft.attachments,
        ...(mode !== undefined ? { mode } : {}),
      });
      if (outcome?.kind === "failed") return;
      editor.update(() => $clearComposer(), { tag: SUBMIT_CLEAR_TAG });
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
      revokeBlobUrls();
      snippetCountRef.current = 0;
    };
    void run().finally(() => setSubmitting(false));
  };

  const onEditorKeyDown = (event: KeyboardEvent): boolean => {
    if (event.isComposing) return false;
    if (palette.handleKeyDown(event)) return true;
    if (event.key === "Escape" && running && onStop) {
      event.preventDefault();
      onStop();
      return true;
    }
    if (running && isQueueShortcut(event)) {
      event.preventDefault();
      submit(true);
      return true;
    }
    if (!isSubmitKey(enterBehavior, event)) return false;
    event.preventDefault();
    submit();
    return true;
  };

  const onEditorPaste = (event: ClipboardEvent): boolean => {
    const data = event.clipboardData;
    if (!data) return false;
    const files = Array.from(data.files);
    if (files.length > 0) {
      event.preventDefault();
      void addFiles(files);
      return true;
    }
    const text = data.getData("text/plain");
    if (data.types.includes("application/x-lexical-editor") || !shouldEmbedPastedText(text)) {
      return false;
    }
    event.preventDefault();
    snippetCountRef.current += 1;
    const snippet = createSnippetEmbed(text, snippetCountRef.current);
    edit(() => $insertEmbedsAtSelection([snippet]));
    return true;
  };

  const onFormKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "/") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const activeOptionId =
    palette.content === null ? undefined : paletteOptionId(palette.listboxId, palette.activeIndex);

  return (
    <div>
      <EditorRefPlugin editorRef={editorRef} />
      <ComposerEditorPlugin
        onKeyDown={onEditorKeyDown}
        onPaste={onEditorPaste}
        onUpdate={onEditorUpdate}
      />
      <HistoryPlugin />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={onFormKeyDown}
        {...ingest.dropHandlers}
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
        <EmbedTokenContext value={{ onPreview: setPreviewKey }}>
          <div className="relative">
            <PlainTextPlugin
              contentEditable={
                <ContentEditable
                  ref={rootRef}
                  id={id}
                  role="combobox"
                  aria-label="Task"
                  aria-multiline
                  aria-autocomplete="list"
                  aria-expanded={palette.content !== null}
                  aria-controls={palette.content ? palette.listboxId : undefined}
                  aria-activedescendant={activeOptionId}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  className={cn(
                    "block w-full overflow-x-hidden overflow-y-auto px-4 text-prompt break-words whitespace-pre-wrap text-fg caret-fg outline-none",
                    compact
                      ? "max-h-[12.5rem] min-h-12 pt-3.5 pb-1"
                      : "max-h-[13.75rem] min-h-15 pt-4 pb-1.5",
                  )}
                />
              }
              placeholder={
                <div
                  className={cn(
                    "pointer-events-none absolute right-4 left-4 truncate text-prompt text-fg-muted select-none",
                    compact ? "top-3.5" : "top-4",
                  )}
                >
                  {placeholder}
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          </div>
        </EmbedTokenContext>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => void ingest.onFilesPicked(event)}
        />
        <ComposerActionRow
          compact={compact}
          plusMenu={{
            editorRef: rootRef,
            filesAvailable: filesRoot !== undefined,
            onUpload: () => fileInputRef.current?.click(),
            onMention: palette.openMentionCategory,
            onSkills: palette.openSlashMenu,
          }}
          onPlanOff={planPill ? () => onInteractionModeChange?.("default") : null}
          uploadingCount={uploadingCount}
          uploadError={uploadError}
          onDismissUploadError={clearUploadError}
          running={running}
          canSend={canSend}
          hasDraft={draft !== null}
          onStop={onStop}
        />
        <ComposerDropOverlay active={dragging} />
      </form>
      <ComposerEmbedPreviewDialog
        embed={previewEmbed}
        returnFocusRef={rootRef}
        onClose={() => setPreviewKey(null)}
        onRemove={() => {
          if (previewKey !== null) edit(() => $removeEmbedNode(previewKey));
        }}
        onMoveToInput={() => {
          if (previewKey === null || previewEmbed?.kind !== "snippet") return;
          const content = previewEmbed.content;
          edit(() => $replaceEmbedWithText(previewKey, content));
        }}
      />
      <ComposerBottomBar
        project={project}
        status={status}
        contextUsage={contextUsage}
        threadCompactAtTokens={threadCompactAtTokens}
        onCompactAtChange={onCompactAtChange}
        providers={providers}
        modelSelection={modelSelection}
        onModelSelectionChange={onModelSelectionChange}
      />
    </div>
  );
}
