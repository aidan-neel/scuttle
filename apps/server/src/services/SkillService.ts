import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { ScuttleSkill, ScuttleSkillDetail } from "@scuttle/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";

export const SKILL_COMMAND_PREFIX = "/scuttle:";

const INVOCATION_RE = /^\/(?:scuttle|skuttle):([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i;

const unquoteYaml = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
};

export const parseSkillFrontmatter = (
  markdown: string,
  fallbackId: string,
): { readonly name: string; readonly description: string; readonly hidden: boolean } => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) {
    return { name: fallbackId, description: "", hidden: false };
  }
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = unquoteYaml(line.slice(idx + 1));
    if (key.length > 0) fields[key] = val;
  }
  return {
    name: fields.name && fields.name.length > 0 ? fields.name : fallbackId,
    description: fields.description ?? "",
    hidden: fields["disable-model-invocation"]?.toLowerCase() === "true",
  };
};

export const scanVendoredSkills = (skillsRoot: string): ReadonlyArray<ScuttleSkill> => {
  const skillsDir = NodePath.join(skillsRoot, "skills");
  if (!NodeFS.existsSync(skillsDir)) return [];
  let entries: ReadonlyArray<NodeFS.Dirent>;
  try {
    entries = NodeFS.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: ScuttleSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const id = entry.name;
    const skillPath = NodePath.join(skillsDir, id, "SKILL.md");
    if (!NodeFS.existsSync(skillPath)) continue;
    try {
      const content = NodeFS.readFileSync(skillPath, "utf8");
      const meta = parseSkillFrontmatter(content, id);
      result.push({
        id,
        command: `${SKILL_COMMAND_PREFIX}${id}`,
        name: meta.name,
        description: meta.description,
        path: skillPath,
        source: "vendored",
        hidden: meta.hidden,
      });
    } catch {
      // Skip unreadable skill files.
    }
  }
  return result.toSorted((a, b) => a.id.localeCompare(b.id));
};

const SKILL_CACHE = new Map<string, ReadonlyArray<ScuttleSkill>>();

export const getCachedVendoredSkills = (skillsRoot: string): ReadonlyArray<ScuttleSkill> => {
  const existing = SKILL_CACHE.get(skillsRoot);
  if (existing !== undefined) return existing;
  const scanned = scanVendoredSkills(skillsRoot);
  SKILL_CACHE.set(skillsRoot, scanned);
  return scanned;
};

export const looksLikeSkillInvocation = (prompt: string): boolean =>
  INVOCATION_RE.test(prompt.trim());

export interface ParsedSkillInvocation {
  readonly skill: ScuttleSkill;
  readonly remainder: string;
}

export const matchSkillInvocation = (
  skills: ReadonlyArray<ScuttleSkill>,
  prompt: string,
): ParsedSkillInvocation | null => {
  const match = INVOCATION_RE.exec(prompt.trim());
  if (!match) return null;
  const id = match[1]!.toLowerCase();
  const skill = skills.find((s) => s.id.toLowerCase() === id);
  if (!skill) return null;
  return {
    skill,
    remainder: (match[2] ?? "").trim(),
  };
};

const stripFrontmatter = (markdown: string): string =>
  markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart();

const MAX_SKILL_FILES = 60;

const listSkillFiles = (skillDir: string): ReadonlyArray<string> => {
  const results: string[] = [];
  const walk = (dir: string, prefix: string) => {
    if (results.length >= MAX_SKILL_FILES) return;
    let entries: ReadonlyArray<NodeFS.Dirent>;
    try {
      entries = NodeFS.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].toSorted((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (results.length >= MAX_SKILL_FILES) break;
      if (entry.name.startsWith(".")) continue;
      const rel = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(NodePath.join(dir, entry.name), rel);
      } else if (entry.isFile() && rel !== "SKILL.md") {
        results.push(rel);
      }
    }
  };
  walk(skillDir, "");
  return results;
};

export const readSkillDetail = (
  skills: ReadonlyArray<ScuttleSkill>,
  id: string,
  requestedFile?: string,
): ScuttleSkillDetail | null => {
  const normalizedId = id.trim().toLowerCase();
  const skill = skills.find((s) => s.id.toLowerCase() === normalizedId);
  if (!skill) return null;

  const skillDir = NodePath.dirname(skill.path);
  const files = listSkillFiles(skillDir);
  const activeFile =
    requestedFile && requestedFile.trim().length > 0 ? requestedFile.trim() : "SKILL.md";

  let targetPath: string;
  if (activeFile === "SKILL.md") {
    targetPath = skill.path;
  } else {
    if (!files.includes(activeFile)) return null;
    targetPath = NodePath.join(skillDir, activeFile);
  }

  try {
    const raw = NodeFS.readFileSync(targetPath, "utf8");
    const content = activeFile === "SKILL.md" ? stripFrontmatter(raw) : raw;
    return {
      skill,
      activeFile,
      content,
      files: ["SKILL.md", ...files],
    };
  } catch {
    return null;
  }
};

export class SkillService extends Context.Service<
  SkillService,
  {
    readonly skillsRoot: string;
    readonly list: () => Effect.Effect<ReadonlyArray<ScuttleSkill>>;
    readonly getDetail: (id: string, file?: string) => Effect.Effect<ScuttleSkillDetail | null>;
    readonly resolveInvocation: (prompt: string) => Effect.Effect<ParsedSkillInvocation | null>;
  }
>()("scuttle/server/SkillService") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const cached = getCachedVendoredSkills(config.skillsRoot);

  return {
    skillsRoot: config.skillsRoot,
    list: () => Effect.succeed(cached),
    getDetail: (id: string, file?: string) => Effect.succeed(readSkillDetail(cached, id, file)),
    resolveInvocation: (prompt: string) => Effect.succeed(matchSkillInvocation(cached, prompt)),
  };
});

export const layer = Layer.effect(SkillService, make);
