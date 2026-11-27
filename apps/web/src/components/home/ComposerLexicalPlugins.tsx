import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  DROP_COMMAND,
  KEY_DOWN_COMMAND,
  type LexicalNode,
  mergeRegister,
  type NodeKey,
  PASTE_COMMAND,
  type RangeSelection,
} from "lexical";
import { useEffect, useEffectEvent } from "react";
import {
  $createComposerEmbedNode,
  $isComposerEmbedNode,
  type ComposerEmbedNode,
} from "./ComposerEmbedNode.tsx";
import type { ComposerEmbed, ComposerSegment } from "./composerEmbeds.ts";
import { type TriggerChar, triggerInsertion } from "./composerTriggers.ts";

export interface EditorCaret {
  readonly nodeKey: NodeKey;
  readonly text: string;
  readonly offset: number;
}

export interface PlacedEmbed {
  readonly nodeKey: NodeKey;
  readonly embed: ComposerEmbed;
}

export interface EditorSnapshot {
  readonly segments: ReadonlyArray<ComposerSegment>;
  readonly embeds: ReadonlyArray<PlacedEmbed>;
  readonly caret: EditorCaret | null;
}

export const EMPTY_SNAPSHOT: EditorSnapshot = { segments: [], embeds: [], caret: null };

const $inlineChildren = (): ReadonlyArray<ReadonlyArray<LexicalNode>> =>
  $getRoot()
    .getChildren()
    .map((block) => ($isElementNode(block) ? block.getChildren() : [block]));

const $embedNodes = (): ReadonlyArray<ComposerEmbedNode> =>
  $inlineChildren().flat().filter($isComposerEmbedNode);

function $readCaret(): EditorCaret | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const node = selection.anchor.getNode();
  if (!$isTextNode(node)) return null;
  return { nodeKey: node.getKey(), text: node.getTextContent(), offset: selection.anchor.offset };
}

export function $readSnapshot(): EditorSnapshot {
  const segments: ComposerSegment[] = [];
  const embeds: PlacedEmbed[] = [];
  let text = "";
  const flush = () => {
    if (text.length > 0) segments.push({ kind: "text", text });
    text = "";
  };
  $inlineChildren().forEach((children, index) => {
    if (index > 0) text += "\n";
    for (const child of children) {
      if ($isComposerEmbedNode(child)) {
        flush();
        const embed = child.getEmbed();
        segments.push({ kind: "embed", embed });
        embeds.push({ nodeKey: child.getKey(), embed });
      } else if ($isLineBreakNode(child)) {
        text += "\n";
      } else {
        text += child.getTextContent();
      }
    }
  });
  flush();
  return { segments, embeds, caret: $readCaret() };
}

const $rangeSelection = (): RangeSelection => {
  const selection = $getSelection();
  if ($isRangeSelection(selection)) return selection;
  $getRoot().selectEnd();
  const fallback = $getSelection();
  if (!$isRangeSelection(fallback)) throw new Error("Composer could not place a caret.");
  return fallback;
};

export function $insertEmbedsAtSelection(embeds: ReadonlyArray<ComposerEmbed>): void {
  if (embeds.length === 0) return;
  $rangeSelection().insertNodes(
    embeds.flatMap((embed) => [$createComposerEmbedNode(embed), $createTextNode(" ")]),
  );
}

export function $replaceRangeWithEmbed(
  nodeKey: NodeKey,
  start: number,
  end: number,
  embed: ComposerEmbed,
): void {
  const node = $getNodeByKey(nodeKey);
  if (!$isTextNode(node)) return;
  const followedBySpace = /^\s/.test(node.getTextContent().slice(end));
  const embedNode = $createComposerEmbedNode(embed);
  node
    .select(start, end)
    .insertNodes(followedBySpace ? [embedNode] : [embedNode, $createTextNode(" ")]);
  const next = embedNode.getNextSibling();
  if (followedBySpace && $isTextNode(next)) next.select(1, 1);
}

export function $replaceRangeWithText(
  nodeKey: NodeKey,
  start: number,
  end: number,
  text: string,
): void {
  const node = $getNodeByKey(nodeKey);
  if ($isTextNode(node)) node.spliceText(start, end - start, text, true);
}

export function $insertTriggerAtSelection(char: TriggerChar): void {
  const selection = $rangeSelection();
  const anchor = selection.anchor.getNode();
  const before = $isTextNode(anchor)
    ? anchor.getTextContent().slice(0, selection.anchor.offset)
    : "";
  selection.insertText(triggerInsertion(before, char));
}

const $removeWithTrailingSpace = (node: ComposerEmbedNode) => {
  const next = node.getNextSibling();
  if ($isTextNode(next) && next.getTextContent().startsWith(" ")) next.spliceText(0, 1, "");
  node.remove();
};

export function $removeEmbeds(predicate: (embed: ComposerEmbed) => boolean): void {
  for (const node of $embedNodes()) {
    if (predicate(node.getEmbed())) $removeWithTrailingSpace(node);
  }
}

export function $replaceEmbedWithText(nodeKey: NodeKey, text: string): void {
  const node = $getNodeByKey(nodeKey);
  if (!$isComposerEmbedNode(node)) return;
  const placeholder = $createTextNode("");
  node.replace(placeholder);
  placeholder.select(0, 0).insertRawText(text);
}

export function $removeEmbedNode(nodeKey: NodeKey): void {
  const node = $getNodeByKey(nodeKey);
  if ($isComposerEmbedNode(node)) $removeWithTrailingSpace(node);
}

function $deleteSelectedEmbeds(): boolean {
  const selection = $getSelection();
  if (!$isNodeSelection(selection)) return false;
  const nodes = selection.getNodes().filter($isComposerEmbedNode);
  const first = nodes[0];
  if (!first) return false;
  first.selectPrevious();
  for (const node of nodes) node.remove();
  return true;
}

export function $clearComposer(): void {
  const root = $getRoot();
  root.clear();
  root.append($createParagraphNode());
  root.selectEnd();
}

interface ComposerEditorPluginProps {
  readonly onKeyDown: (event: KeyboardEvent) => boolean;
  readonly onPaste: (event: ClipboardEvent) => boolean;
  readonly onUpdate: (snapshot: EditorSnapshot, tags: ReadonlySet<string>) => void;
}

export function ComposerEditorPlugin({ onKeyDown, onPaste, onUpdate }: ComposerEditorPluginProps) {
  const [editor] = useLexicalComposerContext();
  const keyDown = useEffectEvent(onKeyDown);
  const paste = useEffectEvent(onPaste);
  const update = useEffectEvent(onUpdate);

  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(
          KEY_DOWN_COMMAND,
          (event) => {
            if (keyDown(event)) return true;
            if (event.key !== "Backspace" && event.key !== "Delete") return false;
            if (!$deleteSelectedEmbeds()) return false;
            event.preventDefault();
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          PASTE_COMMAND,
          (event) => event instanceof ClipboardEvent && paste(event),
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          DROP_COMMAND,
          (event) => {
            if (!event.dataTransfer?.types.includes("Files")) return false;
            event.preventDefault();
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerUpdateListener(({ editorState, tags }) => {
          update(editorState.read($readSnapshot, { editor }), tags);
        }),
      ),
    [editor],
  );

  return null;
}
