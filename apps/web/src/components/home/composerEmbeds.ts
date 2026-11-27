import {
  createScuttleApiClient,
  describeApiError,
  resolveBaseHttpUrl,
} from "@scuttle/client-runtime";
import type { ScuttleSkill, ThreadAttachment, UploadedAttachment } from "@scuttle/contracts";
import { getDesktopBridge } from "@/lib/desktopBridge.ts";
import { formatMention } from "./composerTriggers.ts";

export type ContextTarget = "agent" | "thread" | "folder" | "file";

export type ComposerEmbed =
  | {
      readonly kind: "image";
      readonly id: string;
      readonly name: string;
      readonly mimeType?: string;
      readonly sizeBytes: number;
      readonly previewUrl: string | null;
      readonly attachment: ThreadAttachment;
    }
  | {
      readonly kind: "file";
      readonly id: string;
      readonly name: string;
      readonly mimeType?: string;
      readonly sizeBytes: number;
      readonly attachment: ThreadAttachment;
    }
  | {
      readonly kind: "skill";
      readonly id: string;
      readonly skillId: string;
      readonly command: string;
      readonly name: string;
      readonly description: string;
    }
  | {
      readonly kind: "command";
      readonly id: string;
      readonly command: "plan";
      readonly label: string;
    }
  | {
      readonly kind: "context";
      readonly id: string;
      readonly target: ContextTarget;
      readonly key: string;
      readonly label: string;
      readonly path?: string;
      readonly subtitle?: string;
      readonly token: string;
    }
  | {
      readonly kind: "snippet";
      readonly id: string;
      readonly label: string;
      readonly content: string;
      readonly lineCount: number;
    };

export type ComposerEmbedKind = ComposerEmbed["kind"];
export type EmbedOf<K extends ComposerEmbedKind> = Extract<ComposerEmbed, { kind: K }>;

export type ComposerSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "embed"; readonly embed: ComposerEmbed };

export interface ComposerDraft {
  readonly prompt: string;
  readonly attachments: ReadonlyArray<ThreadAttachment>;
}

export type FileBadgeTone = "ts" | "js" | "rust" | "md" | "json" | "css" | "py" | "shell" | "data";

export interface FileBadge {
  readonly code: string;
  readonly tone: FileBadgeTone;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;
const INLINE_SKILL_RE = /(^|\s)(\/(?:scuttle|skuttle):([a-z0-9][a-z0-9-]*))\s$/i;
const MAX_TEXT_BYTES = 256_000;
export const MAX_BATCH_FILES = 6;
const SNIPPET_MIN_LINES = 15;
const SNIPPET_MIN_CHARS = 1500;

const FILE_BADGES: Readonly<Record<string, FileBadge>> = {
  ts: { code: "TS", tone: "ts" },
  mts: { code: "TS", tone: "ts" },
  cts: { code: "TS", tone: "ts" },
  tsx: { code: "TSX", tone: "ts" },
  js: { code: "JS", tone: "js" },
  mjs: { code: "JS", tone: "js" },
  cjs: { code: "JS", tone: "js" },
  jsx: { code: "JSX", tone: "js" },
  rs: { code: "RS", tone: "rust" },
  md: { code: "MD", tone: "md" },
  mdx: { code: "MDX", tone: "md" },
  json: { code: "JSON", tone: "json" },
  jsonc: { code: "JSON", tone: "json" },
  css: { code: "CSS", tone: "css" },
  scss: { code: "CSS", tone: "css" },
  html: { code: "HTML", tone: "css" },
  py: { code: "PY", tone: "py" },
  sh: { code: "SH", tone: "shell" },
  bash: { code: "SH", tone: "shell" },
  zsh: { code: "SH", tone: "shell" },
  sql: { code: "SQL", tone: "data" },
  yml: { code: "YML", tone: "data" },
  yaml: { code: "YML", tone: "data" },
  toml: { code: "TOML", tone: "data" },
  go: { code: "GO", tone: "data" },
};

const newId = () => crypto.randomUUID();

export const isImageFile = (file: Pick<File, "name" | "type">): boolean =>
  file.type.startsWith("image/") || (file.type === "" && IMAGE_EXT_RE.test(file.name));

export function getFileBadge(filename: string): FileBadge | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return null;
  return FILE_BADGES[filename.slice(dot + 1).toLowerCase()] ?? null;
}

const readText = async (file: File): Promise<string | undefined> => {
  if (file.size > MAX_TEXT_BYTES) return undefined;
  const text = await file.text().catch(() => undefined);
  return text === undefined || text.includes("\u0000") ? undefined : text;
};

const createPreviewUrl = (file: File): string | null =>
  typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;

let cachedDesktopBaseUrl: string | undefined;
let pendingDesktopBaseUrl: Promise<string | undefined> | null = null;

export const getCachedAttachmentBaseUrl = (): string | undefined => cachedDesktopBaseUrl;

export const resolveAttachmentBaseUrl = (): Promise<string | undefined> => {
  const bridge = getDesktopBridge();
  if (bridge === null) return Promise.resolve(undefined);
  if (cachedDesktopBaseUrl !== undefined) return Promise.resolve(cachedDesktopBaseUrl);
  pendingDesktopBaseUrl ??= bridge.getDesktopInfo().then((info) => {
    cachedDesktopBaseUrl = resolveBaseHttpUrl(info.serverUrl);
    return cachedDesktopBaseUrl;
  });
  return pendingDesktopBaseUrl;
};

export const attachmentUrl = (id: string, baseUrl?: string): string =>
  `${resolveBaseHttpUrl(baseUrl ?? cachedDesktopBaseUrl)}/api/attachments/${encodeURIComponent(id)}`;

export const uploadImageAttachment = async (file: File): Promise<UploadedAttachment> => {
  const baseUrl = await resolveAttachmentBaseUrl();
  return createScuttleApiClient(baseUrl).uploadAttachment(file);
};

export const trackLoadedBlobUrls = (
  tracked: Set<string>,
  embeds: ReadonlyArray<ComposerEmbed>,
): void => {
  for (const embed of embeds) {
    if (embed.kind === "image" && embed.previewUrl?.startsWith("blob:")) {
      tracked.add(embed.previewUrl);
    }
  }
};

export const createFileDropHandlers = (opts: {
  readonly depthRef: { current: number };
  readonly setDragging: (dragging: boolean) => void;
  readonly onFiles: (files: ReadonlyArray<File>) => void;
}) => {
  const hasFiles = (event: { readonly dataTransfer: DataTransfer }) =>
    event.dataTransfer.types.includes("Files");
  return {
    onDragEnter: (event: { readonly dataTransfer: DataTransfer; preventDefault: () => void }) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      opts.depthRef.current += 1;
      opts.setDragging(true);
    },
    onDragOver: (event: { readonly dataTransfer: DataTransfer; preventDefault: () => void }) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: { readonly dataTransfer: DataTransfer }) => {
      if (!hasFiles(event)) return;
      opts.depthRef.current = Math.max(0, opts.depthRef.current - 1);
      if (opts.depthRef.current === 0) opts.setDragging(false);
    },
    onDrop: (event: { readonly dataTransfer: DataTransfer; preventDefault: () => void }) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      opts.depthRef.current = 0;
      opts.setDragging(false);
      opts.onFiles(Array.from(event.dataTransfer.files));
    },
  };
};

export const reconcileTrackedBlobUrls = (
  tracked: Set<string>,
  embeds: ReadonlyArray<{ readonly embed: ComposerEmbed }>,
): void => {
  const active = new Set<string>();
  for (const entry of embeds) {
    if (entry.embed.kind === "image" && entry.embed.previewUrl?.startsWith("blob:")) {
      active.add(entry.embed.previewUrl);
    }
  }
  for (const url of tracked) {
    if (!active.has(url)) {
      URL.revokeObjectURL(url);
      tracked.delete(url);
    }
  }
};

export interface LoadFileEmbedsOptions {
  readonly uploadAttachment?: (file: File) => Promise<UploadedAttachment>;
  readonly onError?: (message: string, file: File) => void;
}

export async function loadFileEmbeds(
  files: ReadonlyArray<File>,
  options?: LoadFileEmbedsOptions,
): Promise<ReadonlyArray<EmbedOf<"image"> | EmbedOf<"file">>> {
  const loaded: Array<EmbedOf<"image"> | EmbedOf<"file">> = [];
  for (const file of files.slice(0, MAX_BATCH_FILES)) {
    const mime = file.type ? { mimeType: file.type } : {};
    if (isImageFile(file)) {
      if (options?.uploadAttachment) {
        try {
          const uploaded = await options.uploadAttachment(file);
          loaded.push({
            kind: "image",
            id: uploaded.id,
            name: uploaded.name,
            mimeType: uploaded.mimeType,
            sizeBytes: uploaded.sizeBytes,
            previewUrl: createPreviewUrl(file) ?? attachmentUrl(uploaded.id),
            attachment: {
              id: uploaded.id,
              kind: "image",
              name: uploaded.name,
              mimeType: uploaded.mimeType,
              sizeBytes: uploaded.sizeBytes,
            },
          });
        } catch (error) {
          options.onError?.(describeApiError(error, `Failed to upload ${file.name}.`), file);
        }
      } else {
        loaded.push({
          kind: "image",
          id: newId(),
          name: file.name,
          ...mime,
          sizeBytes: file.size,
          previewUrl: createPreviewUrl(file),
          attachment: { name: file.name, ...mime },
        });
      }
      continue;
    }
    const content = await readText(file);
    loaded.push({
      kind: "file",
      id: newId(),
      name: file.name,
      ...mime,
      sizeBytes: file.size,
      attachment: { name: file.name, ...(content !== undefined ? { content } : {}), ...mime },
    });
  }
  return loaded;
}

const countLines = (text: string): number => text.replace(/\r?\n$/, "").split(/\r\n|\r|\n/).length;

export const shouldEmbedPastedText = (text: string): boolean =>
  text.length >= SNIPPET_MIN_CHARS || countLines(text) >= SNIPPET_MIN_LINES;

export const createSnippetEmbed = (content: string, index: number): EmbedOf<"snippet"> => ({
  kind: "snippet",
  id: newId(),
  label: `Pasted text ${index}`,
  content,
  lineCount: countLines(content),
});

export const createSkillEmbed = (skill: ScuttleSkill): EmbedOf<"skill"> => ({
  kind: "skill",
  id: newId(),
  skillId: skill.id,
  command: skill.command,
  name: skill.name,
  description: skill.description,
});

export const createPlanEmbed = (): EmbedOf<"command"> => ({
  kind: "command",
  id: newId(),
  command: "plan",
  label: "/plan",
});

const basename = (path: string): string => path.split(/[/\\]/).findLast(Boolean) ?? path;

export const createContextEmbed = (input: {
  readonly target: ContextTarget;
  readonly ref: string;
  readonly label: string;
  readonly path?: string | undefined;
  readonly subtitle?: string | undefined;
}): EmbedOf<"context"> => {
  const label = input.target === "file" ? basename(input.label) : input.label;
  return {
    kind: "context",
    id: newId(),
    target: input.target,
    key: `${input.target}:${input.ref}`,
    label,
    ...(input.path ? { path: input.path } : {}),
    ...(input.subtitle ? { subtitle: input.subtitle } : {}),
    token:
      input.target === "file" ? `[${label}](${input.path ?? input.label})` : formatMention(label),
  };
};

export function embedText(embed: ComposerEmbed): string {
  switch (embed.kind) {
    case "image":
    case "file":
      return embed.name;
    case "skill":
      return embed.command;
    case "command":
      return embed.label;
    case "context":
      return embed.target === "file" ? embed.label : formatMention(embed.label);
    case "snippet":
      return `Pasted · ${embed.lineCount} ${embed.lineCount === 1 ? "line" : "lines"}`;
  }
}

export function extractInlineSkillCommand(
  textBeforeCaret: string,
  skills: ReadonlyArray<ScuttleSkill>,
): { readonly skill: ScuttleSkill; readonly start: number; readonly end: number } | null {
  const match = INLINE_SKILL_RE.exec(textBeforeCaret);
  if (!match) return null;
  const id = (match[3] ?? "").toLowerCase();
  const skill = skills.find((candidate) => candidate.id.toLowerCase() === id);
  if (!skill) return null;
  const start = match.index + (match[1] ?? "").length;
  return { skill, start, end: start + (match[2] ?? "").length };
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

type Piece = { readonly kind: "text"; readonly text: string } | { readonly kind: "gap" };

const inlinePiece = (
  embed: ComposerEmbed,
): { readonly piece: Piece; readonly attachment: ThreadAttachment | null } => {
  switch (embed.kind) {
    case "context":
      return { piece: { kind: "text", text: embed.token }, attachment: null };
    case "image":
      return {
        piece: { kind: "text", text: `[Image: ${embed.name}]` },
        attachment: embed.attachment,
      };
    case "file":
      return {
        piece: { kind: "text", text: `[File: ${embed.name}]` },
        attachment: embed.attachment,
      };
    case "snippet":
      return {
        piece: { kind: "text", text: `[Snippet: ${embed.label}]` },
        attachment: { name: embed.label, content: embed.content, mimeType: "text/plain" },
      };
    case "skill":
    case "command":
      return { piece: { kind: "gap" }, attachment: null };
  }
};

const joinPieces = (pieces: ReadonlyArray<Piece>): string => {
  let out = "";
  let afterGap = false;
  for (const piece of pieces) {
    if (piece.kind === "gap") {
      afterGap = true;
      continue;
    }
    const seamDuplicated = afterGap && /[ \t]$/.test(out) && /^[ \t]/.test(piece.text);
    out += seamDuplicated ? piece.text.slice(1) : piece.text;
    afterGap = false;
  }
  return out.trim();
};

export function serializeComposerSegments(
  segments: ReadonlyArray<ComposerSegment>,
): ComposerDraft | null {
  const pieces: Piece[] = [];
  const attachments: ThreadAttachment[] = [];
  let skillCommand: string | null = null;
  for (const segment of segments) {
    if (segment.kind === "text") {
      pieces.push({ kind: "text", text: segment.text });
      continue;
    }
    const { piece, attachment } = inlinePiece(segment.embed);
    pieces.push(piece);
    if (attachment) attachments.push(attachment);
    if (segment.embed.kind === "skill" && skillCommand === null) {
      skillCommand = segment.embed.command;
    }
  }
  const body = joinPieces(pieces);
  if (body.length === 0 && skillCommand === null) return null;
  const prompt = skillCommand === null ? body : `${skillCommand} ${body}`.trim();
  return { prompt, attachments };
}
