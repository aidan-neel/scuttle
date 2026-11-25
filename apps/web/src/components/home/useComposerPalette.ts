import { type KeyboardEvent, useId, useState } from "react";
import { type MentionView, useMentionContent } from "./ComposerMentionMenu.tsx";
import { type SlashOptions, type SlashView, useSlashContent } from "./ComposerSlashMenu.tsx";
import { flattenSections, type PaletteContent } from "./ComposerPalette.tsx";
import {
  detectTrigger,
  insertMentionTrigger,
  replaceMention,
  type TextEdit,
  triggerKey,
} from "./composerTriggers.ts";

export type MentionCategory = "agents" | "threads" | "files";

interface NavState {
  readonly key: string;
  readonly mention: MentionView;
  readonly slash: SlashView;
}

interface UseComposerPaletteOptions {
  readonly prompt: string;
  readonly caret: number;
  readonly applyEdit: (edit: TextEdit) => void;
  readonly filesRoot: string | undefined;
  readonly slash: SlashOptions;
}

export interface ComposerPaletteState {
  readonly listboxId: string;
  readonly content: PaletteContent | null;
  readonly activeIndex: number;
  readonly setActiveIndex: (index: number) => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  readonly openMentionCategory: (category: MentionCategory) => void;
}

const MENTION_ROOT: MentionView = { kind: "root" };
const SLASH_ROOT: SlashView = { kind: "root" };

const viewId = (view: MentionView | SlashView) =>
  view.kind === "files" ? `files:${view.dir}` : view.kind;

export function useComposerPalette({
  prompt,
  caret,
  applyEdit,
  filesRoot,
  slash,
}: UseComposerPaletteOptions): ComposerPaletteState {
  const listboxId = useId();
  const trigger = detectTrigger(prompt, caret);
  const key = trigger ? triggerKey(trigger) : "";
  const [nav, setNav] = useState<NavState>({ key: "", mention: MENTION_ROOT, slash: SLASH_ROOT });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [indexState, setIndexState] = useState({ key: "", index: 0 });

  const current = nav.key === key ? nav : { key, mention: MENTION_ROOT, slash: SLASH_ROOT };
  const query = trigger?.query ?? "";

  const clearQuery = () => {
    if (!trigger) return;
    if (trigger.kind === "slash") applyEdit({ text: "/", caret: 1 });
    else
      applyEdit({
        text: prompt.slice(0, trigger.start + 1) + prompt.slice(trigger.end),
        caret: trigger.start + 1,
      });
  };

  const mentionContent = useMentionContent({
    view: current.mention,
    query,
    filesRoot,
    enabled: trigger?.kind === "mention",
    drill: (mention) => {
      setNav({ ...current, mention });
      clearQuery();
    },
    insert: (token) => {
      if (trigger?.kind === "mention") applyEdit(replaceMention(prompt, trigger, token));
    },
  });

  const slashContent = useSlashContent({
    ...slash,
    view: current.slash,
    query,
    drill: (slashView) => {
      setNav({ ...current, slash: slashView });
      clearQuery();
    },
    run: (action) => {
      applyEdit({ text: "", caret: 0 });
      action();
    },
  });

  const activeView = trigger?.kind === "slash" ? current.slash : current.mention;
  const content = trigger?.kind === "slash" ? slashContent : mentionContent;
  const items = flattenSections(content.sections);
  const dismissKey = `${key}|${query}`;
  const atRoot = activeView.kind === "root";
  const open = trigger !== null && dismissed !== dismissKey && (items.length > 0 || !atRoot);

  const indexKey = `${key}|${viewId(activeView)}|${query}`;
  const activeIndex =
    indexState.key === indexKey ? Math.min(indexState.index, Math.max(items.length - 1, 0)) : 0;
  const setActiveIndex = (index: number) => setIndexState({ key: indexKey, index });

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    const consume = (action: () => void) => {
      event.preventDefault();
      action();
      return true;
    };
    switch (event.key) {
      case "Escape":
        return consume(() => setDismissed(dismissKey));
      case "Backspace":
        if (query.length > 0 || !content.onBack) return false;
        return consume(content.onBack);
      case "ArrowDown":
      case "ArrowUp": {
        if (items.length === 0) return false;
        const step = event.key === "ArrowDown" ? 1 : -1;
        return consume(() => setActiveIndex((activeIndex + step + items.length) % items.length));
      }
      case "Enter":
      case "Tab": {
        const item = items[activeIndex];
        if (!item || event.shiftKey) return false;
        return consume(item.onSelect);
      }
      default:
        return false;
    }
  };

  const openMentionCategory = (category: MentionCategory) => {
    const edit = insertMentionTrigger(prompt, caret);
    const mention: MentionView =
      category === "files" && filesRoot !== undefined
        ? { kind: "files", dir: filesRoot }
        : category === "files"
          ? MENTION_ROOT
          : { kind: category };
    setNav({ key: `mention:${edit.caret - 1}`, mention, slash: SLASH_ROOT });
    setDismissed(null);
    applyEdit(edit);
  };

  return {
    listboxId,
    content: open ? content : null,
    activeIndex,
    setActiveIndex,
    handleKeyDown,
    openMentionCategory,
  };
}
