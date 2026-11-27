import { describe, expect, test } from "bun:test";
import type { ScuttleSkill } from "@scuttle/contracts";
import {
  type ComposerEmbed,
  type ComposerSegment,
  createContextEmbed,
  createPlanEmbed,
  createSkillEmbed,
  createSnippetEmbed,
  embedText,
  extractInlineSkillCommand,
  formatByteSize,
  getFileBadge,
  isImageFile,
  loadFileEmbeds,
  reconcileTrackedBlobUrls,
  serializeComposerSegments,
  shouldEmbedPastedText,
} from "@/components/home/composerEmbeds.ts";

const skill = (id: string): ScuttleSkill => ({
  id,
  command: `/scuttle:${id}`,
  name: id,
  description: `The ${id} skill`,
  path: `/skills/${id}/SKILL.md`,
  source: "vendored",
  hidden: false,
});

const SKILLS = [skill("go"), skill("design")];
const INVOCATION_RE = /^\/(?:scuttle|skuttle):([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i;

const text = (value: string): ComposerSegment => ({ kind: "text", text: value });
const embed = (value: ComposerEmbed): ComposerSegment => ({ kind: "embed", embed: value });

const agent = createContextEmbed({
  target: "agent",
  ref: "agent-1",
  label: "Sivir",
  subtitle: "Ships the API",
});
const thread = createContextEmbed({ target: "thread", ref: "thread-9", label: "Fix login bug" });
const folder = createContextEmbed({ target: "folder", ref: "/repo/src/app", label: "src/app/" });
const file = createContextEmbed({
  target: "file",
  ref: "/repo/apps/web/src/components/thread/useStickToBottom.ts",
  label: "apps/web/src/components/thread/useStickToBottom.ts",
  path: "apps/web/src/components/thread/useStickToBottom.ts",
});

const imageEmbed = (name: string): ComposerEmbed => ({
  kind: "image",
  id: name,
  name,
  mimeType: "image/png",
  sizeBytes: 4,
  previewUrl: null,
  attachment: { name, mimeType: "image/png" },
});

describe("isImageFile", () => {
  test("classifies images by MIME type or by extension when the type is missing", () => {
    expect(isImageFile({ name: "shot.png", type: "image/png" })).toBe(true);
    expect(isImageFile({ name: "photo.WEBP", type: "" })).toBe(true);
    expect(isImageFile({ name: "Composer.tsx", type: "text/typescript" })).toBe(false);
    expect(isImageFile({ name: "README.md", type: "" })).toBe(false);
  });
});

describe("getFileBadge", () => {
  test("maps common extensions to short codes and tones", () => {
    expect(getFileBadge("useStickToBottom.ts")).toEqual({ code: "TS", tone: "ts" });
    expect(getFileBadge("Composer.TSX")).toEqual({ code: "TSX", tone: "ts" });
    expect(getFileBadge("main.rs")).toEqual({ code: "RS", tone: "rust" });
    expect(getFileBadge("package.json")).toEqual({ code: "JSON", tone: "json" });
    expect(getFileBadge("ci.yaml")).toEqual({ code: "YML", tone: "data" });
  });

  test("returns null for dotfiles, extensionless, and unknown files", () => {
    expect(getFileBadge(".gitignore")).toBeNull();
    expect(getFileBadge("Makefile")).toBeNull();
    expect(getFileBadge("archive.bin")).toBeNull();
  });
});

describe("loadFileEmbeds", () => {
  test("turns images into previewable embeds and text files into files with content", async () => {
    const image = new File([new Uint8Array([137, 80, 78, 71])], "composer.png", {
      type: "image/png",
    });
    const code = new File(["export const x = 1;"], "ComposerBottomBar.tsx", {
      type: "text/plain",
    });

    const [first, second] = await loadFileEmbeds([image, code]);

    expect(first?.kind).toBe("image");
    if (first?.kind === "image") {
      expect(first.sizeBytes).toBe(4);
      expect(first.attachment).toEqual({ name: "composer.png", mimeType: "image/png" });
      if (first.previewUrl) URL.revokeObjectURL(first.previewUrl);
    }
    expect(second?.kind).toBe("file");
    if (second?.kind === "file") {
      expect(second.attachment.content).toBe("export const x = 1;");
    }
  });

  test("keeps binary files as name-only attachments and caps a batch at six", async () => {
    const [binary] = await loadFileEmbeds([new File([new Uint8Array([0, 1, 0])], "a.bin")]);
    expect(binary?.attachment).toEqual({ name: "a.bin" });
    const files = Array.from({ length: 8 }, (_, i) => new File([`${i}`], `note-${i}.txt`));
    expect(await loadFileEmbeds(files)).toHaveLength(6);
  });

  test("uploads images via uploadAttachment and attaches uploaded metadata", async () => {
    const image = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", {
      type: "image/png",
    });
    const textFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    const errors: string[] = [];

    const embeds = await loadFileEmbeds([image, textFile], {
      uploadAttachment: async (file) => ({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "image",
        name: file.name,
        mimeType: "image/png",
        sizeBytes: 123,
        url: "/api/attachments/11111111-1111-4111-8111-111111111111",
      }),
      onError: (msg) => errors.push(msg),
    });

    expect(errors).toEqual([]);
    expect(embeds).toHaveLength(2);
    const first = embeds[0]!;
    expect(first.kind).toBe("image");
    if (first.kind === "image") {
      expect(first.attachment).toEqual({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "image",
        name: "shot.png",
        mimeType: "image/png",
        sizeBytes: 123,
      });
      if (first.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(first.previewUrl);
    }
  });

  test("reports image upload errors without dropping valid attachments", async () => {
    const badImage = new File([new Uint8Array([1, 2])], "bad.svg", { type: "image/svg+xml" });
    const textFile = new File(["ok"], "ok.txt", { type: "text/plain" });
    const errors: string[] = [];

    const embeds = await loadFileEmbeds([badImage, textFile], {
      uploadAttachment: async () => {
        throw new Error("Unsupported image MIME type.");
      },
      onError: (msg) => errors.push(msg),
    });

    expect(errors).toEqual(["Unsupported image MIME type."]);
    expect(embeds).toHaveLength(1);
    expect(embeds[0]?.kind).toBe("file");
  });
});

describe("reconcileTrackedBlobUrls", () => {
  test("revokes blob URLs that are no longer referenced by active embeds", () => {
    const originalRevoke = URL.revokeObjectURL;
    const revoked: string[] = [];
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
    try {
      const tracked = new Set(["blob:keep", "blob:drop"]);
      reconcileTrackedBlobUrls(tracked, [
        {
          embed: {
            kind: "image",
            id: "1",
            name: "keep.png",
            sizeBytes: 4,
            previewUrl: "blob:keep",
            attachment: { name: "keep.png" },
          },
        },
      ]);
      expect(revoked).toEqual(["blob:drop"]);
      expect(Array.from(tracked)).toEqual(["blob:keep"]);
    } finally {
      URL.revokeObjectURL = originalRevoke;
    }
  });
});

describe("pasted snippets", () => {
  test("keeps short pastes inline and embeds bulky ones", () => {
    expect(shouldEmbedPastedText("npm run dev")).toBe(false);
    expect(shouldEmbedPastedText(Array.from({ length: 14 }, () => "x").join("\n"))).toBe(false);
    expect(shouldEmbedPastedText(Array.from({ length: 15 }, () => "x").join("\n"))).toBe(true);
    expect(shouldEmbedPastedText("a".repeat(1500))).toBe(true);
  });

  test("counts lines without a trailing newline and shows the count inline", () => {
    const snippet = createSnippetEmbed("one\ntwo\nthree\n", 2);
    expect(snippet.lineCount).toBe(3);
    expect(snippet.label).toBe("Pasted text 2");
    expect(embedText(snippet)).toBe("Pasted · 3 lines");
  });
});

describe("createContextEmbed", () => {
  test("shows a file by basename and links its relative path in the token", () => {
    expect(file.label).toBe("useStickToBottom.ts");
    expect(file.path).toBe("apps/web/src/components/thread/useStickToBottom.ts");
    expect(file.token).toBe(
      "[useStickToBottom.ts](apps/web/src/components/thread/useStickToBottom.ts)",
    );
    expect(embedText(file)).toBe("useStickToBottom.ts");
  });

  test("mentions agents, threads, and folders, quoting names with spaces", () => {
    expect(agent.token).toBe("@Sivir");
    expect(thread.token).toBe('@"Fix login bug"');
    expect(folder.token).toBe("@src/app/");
    expect(agent.key).toBe("agent:agent-1");
  });
});

describe("extractInlineSkillCommand", () => {
  test("promotes a known skill at the start or mid-sentence once whitespace follows", () => {
    expect(extractInlineSkillCommand("/scuttle:go ", SKILLS)).toEqual({
      skill: SKILLS[0]!,
      start: 0,
      end: 11,
    });
    expect(extractInlineSkillCommand("please /Skuttle:DESIGN ", SKILLS)).toEqual({
      skill: SKILLS[1]!,
      start: 7,
      end: 22,
    });
  });

  test("ignores partial commands, unknown skills, and commands glued to a word", () => {
    expect(extractInlineSkillCommand("/scuttle:go", SKILLS)).toBeNull();
    expect(extractInlineSkillCommand("/scuttle:nope ", SKILLS)).toBeNull();
    expect(extractInlineSkillCommand("run/scuttle:go ", SKILLS)).toBeNull();
  });
});

describe("formatByteSize", () => {
  test("uses bytes, then one decimal under ten, then whole units", () => {
    expect(formatByteSize(812)).toBe("812 B");
    expect(formatByteSize(4300)).toBe("4.2 KB");
    expect(formatByteSize(48_000)).toBe("47 KB");
    expect(formatByteSize(1_400_000)).toBe("1.3 MB");
  });
});

describe("serializeComposerSegments", () => {
  test("returns null for whitespace and for a lone /plan command", () => {
    expect(serializeComposerSegments([])).toBeNull();
    expect(serializeComposerSegments([text("  \n ")])).toBeNull();
    expect(serializeComposerSegments([embed(createPlanEmbed()), text(" ")])).toBeNull();
  });

  test("keeps context tokens at their inline positions", () => {
    const draft = serializeComposerSegments([
      text("ask "),
      embed(agent),
      text(" to read "),
      embed(file),
      text(" and "),
      embed(folder),
    ]);
    expect(draft).toEqual({
      prompt:
        "ask @Sivir to read [useStickToBottom.ts](apps/web/src/components/thread/useStickToBottom.ts) and @src/app/",
      attachments: [],
    });
  });

  test("names images, files, and snippets inline and sends them as attachments", () => {
    const snippet = createSnippetEmbed("line 1\nline 2", 1);
    const draft = serializeComposerSegments([
      text("compare "),
      embed(imageEmbed("before.png")),
      text(" with "),
      embed(imageEmbed("after.png")),
      text(" using "),
      embed(snippet),
    ]);
    expect(draft?.prompt).toBe(
      "compare [Image: before.png] with [Image: after.png] using [Snippet: Pasted text 1]",
    );
    expect(draft?.attachments).toEqual([
      { name: "before.png", mimeType: "image/png" },
      { name: "after.png", mimeType: "image/png" },
      { name: "Pasted text 1", content: "line 1\nline 2", mimeType: "text/plain" },
    ]);
  });

  test("hoists a mid-prompt skill to the front so the server activates it", () => {
    const go = createSkillEmbed(SKILLS[0]!);
    const draft = serializeComposerSegments([text("polish this "), embed(go), text(" today")]);
    expect(draft?.prompt).toBe("/scuttle:go polish this today");
    expect(INVOCATION_RE.exec(draft?.prompt ?? "")?.[2]).toBe("polish this today");
    const leading = serializeComposerSegments([embed(go), text(" fix it")]);
    expect(leading?.prompt).toBe("/scuttle:go fix it");
    expect(serializeComposerSegments([embed(go), text(" ")])?.prompt).toBe("/scuttle:go");
  });

  test("drops /plan without doubling the spaces around it", () => {
    const draft = serializeComposerSegments([
      text("think first "),
      embed(createPlanEmbed()),
      text(" then edit"),
    ]);
    expect(draft?.prompt).toBe("think first then edit");
  });

  test("preserves indentation and newlines in short pasted code", () => {
    const draft = serializeComposerSegments([
      text("why does this fail?\n\nif (ok) {\n    run();\n}"),
    ]);
    expect(draft?.prompt).toBe("why does this fail?\n\nif (ok) {\n    run();\n}");
  });
});
