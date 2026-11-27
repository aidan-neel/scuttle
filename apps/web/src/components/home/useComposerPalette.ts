import { useId, useState } from "react";
import { type MentionView, useMentionContent } from "./ComposerMentionMenu.tsx";
import { type SlashOptions, type SlashView, useSlashContent } from "./ComposerSlashMenu.tsx";
import { flattenSections, type PaletteContent } from "./ComposerPalette.tsx";
import type { EditorCaret } from "./ComposerLexicalPlugins.tsx";
import type { ComposerEmbed } from "./composerEmbeds.ts";
import { type ComposerTrigger, detectTrigger, type TriggerChar } from "./composerTriggers.ts";

export type MentionCategory = "agents" | "threads" | "files";

export interface PaletteTrigger extends ComposerTrigger {
  readonly nodeKey: string;
}

export interface PaletteEditorOps {
  readonly replaceWithEmbed: (trigger: PaletteTrigger, embed: ComposerEmbed) => void;
  readonly replaceWithText: (trigger: PaletteTrigger, start: number, text: string) => void;
  readonly insertTrigger: (char: TriggerChar) => void;
}

interface NavState {
  readonly key: string;
  readonly mention: MentionView;
  readonly slash: SlashView;
}

interface UseComposerPaletteOptions {
  readonly caret: EditorCaret | null;
  readonly ops: PaletteEditorOps;
  readonly filesRoot: string | undefined;
  readonly focused: boolean;
  readonly slash: SlashOptions;
}

export interface ComposerPaletteState {
  readonly listboxId: string;
  readonly content: PaletteContent | null;
  readonly activeIndex: number;
  readonly setActiveIndex: (index: number) => void;
  readonly handleKeyDown: (event: KeyboardEvent) => boolean;
  readonly openMentionCategory: (category: MentionCategory) => void;
  readonly openSlashMenu: () => void;
}

const MENTION_ROOT: MentionView = { kind: "root" };
const SLASH_ROOT: SlashView = { kind: "root" };
const INITIAL_NAV: NavState = { key: "", mention: MENTION_ROOT, slash: SLASH_ROOT };
const PENDING_KEY = "pending";

const viewId = (view: MentionView | SlashView) =>
  view.kind === "files" ? `files:${view.dir}` : view.kind;

const readTrigger = (caret: EditorCaret | null): PaletteTrigger | null => {
  if (caret === null) return null;
  const trigger = detectTrigger(caret.text, caret.offset);
  return trigger ? { ...trigger, nodeKey: caret.nodeKey } : null;
};

export function useComposerPalette({
  caret,
  ops,
  filesRoot,
  focused,
  slash,
}: UseComposerPaletteOptions): ComposerPaletteState {
  const listboxId = useId();
  const trigger = readTrigger(caret);
  const key = trigger ? `${trigger.nodeKey}:${trigger.kind}:${trigger.start}` : "";
  const [nav, setNav] = useState<NavState>(INITIAL_NAV);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [indexState, setIndexState] = useState({ key: "", index: 0 });
  const [previousKey, setPreviousKey] = useState(key);
  if (previousKey !== key) {
    setPreviousKey(key);
    if (key === "") {
      setNav(INITIAL_NAV);
      setDismissed(null);
    } else if (nav.key === PENDING_KEY) {
      setNav({ ...nav, key });
    }
  }

  const current = nav.key === key ? nav : { key, mention: MENTION_ROOT, slash: SLASH_ROOT };
  const query = trigger?.query ?? "";

  const clearQuery = () => {
    if (trigger) ops.replaceWithText(trigger, trigger.start + 1, "");
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
    embed: (embed) => {
      if (trigger?.kind === "mention") ops.replaceWithEmbed(trigger, embed);
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
      if (trigger) ops.replaceWithText(trigger, trigger.start, "");
      action();
    },
    embed: (embed) => {
      if (trigger?.kind === "slash") ops.replaceWithEmbed(trigger, embed);
    },
  });

  const activeView = trigger?.kind === "slash" ? current.slash : current.mention;
  const content = trigger?.kind === "slash" ? slashContent : mentionContent;
  const items = flattenSections(content.sections);
  const dismissKey = `${key}|${query}`;
  const atRoot = activeView.kind === "root";
  const open =
    focused && trigger !== null && dismissed !== dismissKey && (items.length > 0 || !atRoot);

  const indexKey = `${key}|${viewId(activeView)}|${query}`;
  const activeIndex =
    indexState.key === indexKey ? Math.min(indexState.index, Math.max(items.length - 1, 0)) : 0;
  const setActiveIndex = (index: number) => setIndexState({ key: indexKey, index });

  const handleKeyDown = (event: KeyboardEvent): boolean => {
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
        if (event.shiftKey) return false;
        return consume(() => items[activeIndex]?.onSelect());
      }
      default:
        return false;
    }
  };

  const openMentionCategory = (category: MentionCategory) => {
    const mention: MentionView =
      category === "files" && filesRoot !== undefined
        ? { kind: "files", dir: filesRoot }
        : category === "files"
          ? MENTION_ROOT
          : { kind: category };
    setNav({ key: PENDING_KEY, mention, slash: SLASH_ROOT });
    setDismissed(null);
    ops.insertTrigger("@");
  };

  const openSlashMenu = () => {
    setNav(INITIAL_NAV);
    setDismissed(null);
    ops.insertTrigger("/");
  };

  return {
    listboxId,
    content: open ? content : null,
    activeIndex,
    setActiveIndex,
    handleKeyDown,
    openMentionCategory,
    openSlashMenu,
  };
}
