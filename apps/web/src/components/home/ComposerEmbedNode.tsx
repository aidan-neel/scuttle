import {
  BubbleChatIcon,
  Cancel01Icon,
  CommandIcon,
  File01Icon,
  Folder01Icon,
  Idea01Icon,
  Image01Icon,
  TextAlignLeftIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import {
  $applyNodeReplacement,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { createContext, type ReactElement, type ReactNode, use } from "react";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { cn } from "@/lib/utils";
import {
  attachmentUrl,
  type ComposerEmbed,
  type EmbedOf,
  embedText,
  type FileBadgeTone,
  formatByteSize,
  getFileBadge,
} from "./composerEmbeds.ts";

export type SerializedComposerEmbedNode = Spread<
  { readonly embed: ComposerEmbed },
  SerializedLexicalNode
>;

export class ComposerEmbedNode extends DecoratorNode<ReactElement> {
  __embed: ComposerEmbed;

  static override getType(): string {
    return "composer-embed";
  }

  static override clone(node: ComposerEmbedNode): ComposerEmbedNode {
    return new ComposerEmbedNode(node.__embed, node.__key);
  }

  static override importJSON(json: SerializedComposerEmbedNode): ComposerEmbedNode {
    return $createComposerEmbedNode(json.embed);
  }

  constructor(embed: ComposerEmbed, key?: NodeKey) {
    super(key);
    this.__embed = embed;
  }

  override exportJSON(): SerializedComposerEmbedNode {
    return { ...super.exportJSON(), embed: this.getEmbed() };
  }

  override createDOM(): HTMLElement {
    return document.createElement("span");
  }

  override updateDOM(): false {
    return false;
  }

  override isInline(): true {
    return true;
  }

  override isIsolated(): false {
    return false;
  }

  override isKeyboardSelectable(): true {
    return true;
  }

  override getTextContent(): string {
    return embedText(this.getEmbed());
  }

  getEmbed(): ComposerEmbed {
    return this.getLatest().__embed;
  }

  override decorate(): ReactElement {
    return <InlineEmbedToken embed={this.__embed} nodeKey={this.__key} />;
  }
}

export function $createComposerEmbedNode(embed: ComposerEmbed): ComposerEmbedNode {
  return $applyNodeReplacement(new ComposerEmbedNode(embed));
}

export function $isComposerEmbedNode(
  node: LexicalNode | null | undefined,
): node is ComposerEmbedNode {
  return node instanceof ComposerEmbedNode;
}

interface EmbedTokenActions {
  readonly onPreview: (nodeKey: NodeKey) => void;
}

export const EmbedTokenContext = createContext<EmbedTokenActions>({ onPreview: () => {} });

const FILE_TEXT = "text-[#56b6e0]";
const NEUTRAL_WASH = "bg-fg/[0.045]";
const HOVER_WASH = "hover:bg-fg/[0.07]";
const MAX_LABEL = 42;

const BADGE_TONE: Record<FileBadgeTone, string> = {
  ts: "bg-[#33445c] text-[#c3d3ea]",
  js: "bg-[#e8c547]/20 text-[#ead58a]",
  rust: "bg-[#dea584]/22 text-[#ebc2a8]",
  md: "bg-fg/[0.12] text-fg-secondary",
  json: "bg-warning/20 text-[#efc983]",
  css: "bg-[#a774e8]/24 text-[#cdb1f3]",
  py: "bg-[#4b8bbe]/28 text-[#a6c8e6]",
  shell: "bg-success/20 text-[#93d9ab]",
  data: "bg-fg/[0.1] text-fg-muted",
};

const clip = (label: string) =>
  label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1).trimEnd()}…` : label;

const iconLead = (icon: IconSvgElement, tone: string) => (
  <Icon icon={icon} className={cn("inline-block size-3.5 align-[-0.125rem]", tone)} />
);

export function FileBadgeMark({
  name,
  className,
}: {
  readonly name: string;
  readonly className?: string;
}) {
  const badge = getFileBadge(name);
  if (!badge) return iconLead(File01Icon, cn("text-fg-muted", className));
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-[0.25rem] px-[0.1875rem] align-middle font-mono text-[0.53125rem] leading-none font-bold tracking-[-0.02em]",
        BADGE_TONE[badge.tone],
        className,
      )}
    >
      {badge.code}
    </span>
  );
}

interface TokenLook {
  readonly lead: ReactNode;
  readonly label: string;
  readonly labelClass: string;
  readonly wash: string;
  readonly title: string;
}

function tokenLook(embed: ComposerEmbed): TokenLook {
  switch (embed.kind) {
    case "image": {
      const src =
        embed.previewUrl ?? (embed.attachment.id ? attachmentUrl(embed.attachment.id) : null);
      return {
        lead: src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            className="inline-block size-[1.125rem] rounded-[0.25rem] object-cover align-[-0.25rem] outline outline-1 -outline-offset-1 outline-white/15"
          />
        ) : (
          iconLead(Image01Icon, "text-fg-muted")
        ),
        label: embed.name,
        labelClass: "text-fg-secondary",
        wash: HOVER_WASH,
        title: `${embed.name} · ${formatByteSize(embed.sizeBytes)} · click to preview`,
      };
    }
    case "file":
      return {
        lead: <FileBadgeMark name={embed.name} />,
        label: embed.name,
        labelClass: FILE_TEXT,
        wash: "hover:bg-fg/[0.06]",
        title: `${embed.name} · ${formatByteSize(embed.sizeBytes)}`,
      };
    case "skill":
      return {
        lead: iconLead(CommandIcon, "text-claude"),
        label: embed.command,
        labelClass: "font-mono text-[0.84375rem] text-claude",
        wash: "bg-claude/[0.1]",
        title: embed.description || embed.name,
      };
    case "command":
      return {
        lead: iconLead(Idea01Icon, "text-input"),
        label: embed.label,
        labelClass: "font-mono text-[0.84375rem] text-input",
        wash: "bg-input/[0.1]",
        title: "Plan mode: the agent proposes a plan before editing",
      };
    case "snippet":
      return {
        lead: iconLead(TextAlignLeftIcon, "text-fg-muted"),
        label: embedText(embed),
        labelClass: "text-fg-secondary",
        wash: cn(NEUTRAL_WASH, HOVER_WASH),
        title: `${embed.label} · click to preview`,
      };
    case "context":
      return contextLook(embed);
  }
}

function contextLook(embed: EmbedOf<"context">): TokenLook {
  const title = embed.path ?? (embed.subtitle ? `${embed.label} · ${embed.subtitle}` : embed.label);
  switch (embed.target) {
    case "file":
      return {
        lead: <FileBadgeMark name={embed.label} />,
        label: embed.label,
        labelClass: FILE_TEXT,
        wash: "hover:bg-fg/[0.06]",
        title,
      };
    case "folder":
      return {
        lead: iconLead(Folder01Icon, "text-[#56b6e0]/80"),
        label: embed.label,
        labelClass: FILE_TEXT,
        wash: "hover:bg-fg/[0.06]",
        title,
      };
    case "agent":
      return {
        lead: (
          <Identicon name={embed.label} size="sm" className="inline-block align-[-0.1875rem]" />
        ),
        label: embed.label,
        labelClass: "font-medium text-fg",
        wash: NEUTRAL_WASH,
        title,
      };
    case "thread":
      return {
        lead: iconLead(BubbleChatIcon, "text-fg-muted"),
        label: embed.label,
        labelClass: "text-fg-secondary",
        wash: NEUTRAL_WASH,
        title,
      };
  }
}

function InlineEmbedToken({
  embed,
  nodeKey,
}: {
  readonly embed: ComposerEmbed;
  readonly nodeKey: NodeKey;
}) {
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const { onPreview } = use(EmbedTokenContext);
  const previewable = embed.kind === "image" || embed.kind === "snippet";
  const look = tokenLook(embed);

  return (
    <span
      data-embed-kind={embed.kind}
      data-embed-target={embed.kind === "context" ? embed.target : undefined}
      title={look.title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (previewable) {
          onPreview(nodeKey);
          return;
        }
        clearSelection();
        setSelected(true);
      }}
      className={cn(
        "rounded-[0.25rem] py-px leading-none whitespace-nowrap transition-[background-color,box-shadow] duration-(--dur-hover) select-none",
        look.wash.startsWith("hover:") ? "px-[0.125rem]" : "mx-px px-[0.1875rem]",
        previewable ? "cursor-pointer" : "cursor-default",
        look.wash,
        isSelected && "bg-fg/[0.11] shadow-[0_0_0_1px_var(--color-input)]",
      )}
    >
      {look.lead}
      <span className={cn("ml-1", look.labelClass)}>{clip(look.label)}</span>
    </span>
  );
}

export function ComposerUploadStatus({
  uploadingCount,
  uploadError,
  onDismissError,
}: {
  readonly uploadingCount: number;
  readonly uploadError: string | null;
  readonly onDismissError: () => void;
}) {
  if (uploadError) {
    return (
      <span role="alert" className="flex min-w-0 items-center gap-1 px-2 text-meta text-danger">
        <span className="truncate">{uploadError}</span>
        <button
          type="button"
          aria-label="Dismiss upload error"
          onClick={onDismissError}
          className="cursor-pointer opacity-75 hover:opacity-100"
        >
          <Icon icon={Cancel01Icon} className="size-3" />
        </button>
      </span>
    );
  }
  if (uploadingCount > 0) {
    return (
      <span role="status" className="px-2 text-meta text-fg-muted">
        Uploading image…
      </span>
    );
  }
  return null;
}

export function ComposerDropOverlay({ active }: { readonly active: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-composer bg-raised transition-opacity duration-150 ease-out",
        active ? "opacity-100" : "opacity-0",
      )}
    >
      <span className="absolute inset-1.5 rounded-canvas border border-dashed border-edge-strong" />
      <Icon icon={Image01Icon} className="mb-1 size-5 text-fg-muted" />
      <span className="text-label text-fg">Drop to attach</span>
      <span className="text-meta text-fg-muted">Images and text files</span>
    </div>
  );
}
