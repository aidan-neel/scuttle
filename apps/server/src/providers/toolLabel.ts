import * as NodePath from "node:path";
import type { ActivityKind } from "@scuttle/contracts";

export interface ToolActivityPresentation {
  readonly activityKind: ActivityKind;
  readonly activeLabel: string;
  readonly label: string;
  readonly detail?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const shortPath = (raw: string): string => {
  const normalized = raw.replaceAll("\\", "/");
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.length <= 2) return normalized;
  return parts.slice(-2).join("/");
};

const truncate = (value: string, max = 72): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

const extractCommand = (input: Record<string, unknown> | undefined): string | undefined => {
  if (!input) return undefined;
  const direct = asString(input.command) ?? asString(input.cmd) ?? asString(input.CommandLine);
  if (direct) return direct;
  if (Array.isArray(input.command)) {
    const joined = input.command
      .filter((part): part is string => typeof part === "string")
      .join(" ");
    if (joined.trim().length > 0) return joined.trim();
  }
  return undefined;
};

const extractFilePath = (input: Record<string, unknown> | undefined): string | undefined => {
  if (!input) return undefined;
  return (
    asString(input.file_path) ??
    asString(input.filePath) ??
    asString(input.path) ??
    asString(input.Path) ??
    asString(input.filename)
  );
};

const extractQuery = (input: Record<string, unknown> | undefined): string | undefined => {
  if (!input) return undefined;
  return (
    asString(input.pattern) ??
    asString(input.query) ??
    asString(input.glob) ??
    asString(input.search)
  );
};

export const presentToolActivity = (
  rawName: string,
  rawInput: unknown,
  fallbackTitle?: string,
): ToolActivityPresentation => {
  const input = asRecord(rawInput);
  const name = rawName.trim().toLowerCase();
  const description = asString(input?.description) ?? asString(input?.toolSummary);

  if (
    name === "bash" ||
    name === "shell" ||
    name === "run_command" ||
    name === "command_execution" ||
    name === "execute" ||
    name === "terminal"
  ) {
    const command = extractCommand(input);
    const active = description ? truncate(description) : "Running a script";
    const done = description
      ? truncate(description.replace(/^Running\b/i, "Ran").replace(/^Checking\b/i, "Checked"))
      : "Ran a script";
    return {
      activityKind: "command",
      activeLabel: active,
      label: done,
      ...(command ? { detail: command } : {}),
    };
  }

  if (name === "read" || name === "read_file" || name === "view_file" || name === "cat") {
    const filePath = extractFilePath(input);
    const target = filePath ? shortPath(filePath) : "a file";
    return {
      activityKind: "file",
      activeLabel: `Reading ${target}`,
      label: `Read ${target}`,
      ...(filePath ? { detail: filePath } : {}),
    };
  }

  if (
    name === "edit" ||
    name === "write" ||
    name === "edit_file" ||
    name === "write_file" ||
    name === "multiedit" ||
    name === "notebookedit" ||
    name === "file_change" ||
    name === "apply_patch"
  ) {
    const filePath = extractFilePath(input);
    const target = filePath ? shortPath(filePath) : "files";
    const verb = name.includes("write") ? ["Writing", "Wrote"] : ["Editing", "Edited"];
    return {
      activityKind: "file",
      activeLabel: `${verb[0]} ${target}`,
      label: `${verb[1]} ${target}`,
      ...(filePath ? { detail: filePath } : {}),
    };
  }

  if (
    name === "grep" ||
    name === "glob" ||
    name === "search" ||
    name === "websearch" ||
    name === "web_search" ||
    name === "search_web" ||
    name === "find_by_name" ||
    name === "grep_search"
  ) {
    const query = extractQuery(input);
    const isWeb = name.includes("web");
    const target = query ? `"${truncate(query, 44)}"` : isWeb ? "the web" : "the codebase";
    return {
      activityKind: "search",
      activeLabel: `Searching ${target}`,
      label: `Searched ${target}`,
      ...(query ? { detail: query } : {}),
    };
  }

  if (name === "webfetch" || name === "fetch") {
    const url = asString(input?.url);
    const host = url ? NodePath.basename(url.replace(/\/+$/, "")) : "page";
    return {
      activityKind: "search",
      activeLabel: `Fetching ${truncate(host, 40)}`,
      label: `Fetched ${truncate(host, 40)}`,
      ...(url ? { detail: url } : {}),
    };
  }

  if (fallbackTitle && fallbackTitle.trim().length > 0) {
    const clean = truncate(fallbackTitle.trim());
    return {
      activityKind: "tool",
      activeLabel: clean,
      label: clean,
      ...(description && description !== clean ? { detail: description } : {}),
    };
  }

  const pretty = rawName
    .replace(/^mcp__[^_]+__/i, "")
    .replaceAll("_", " ")
    .trim();
  const display = pretty.length > 0 ? pretty : "tool";
  return {
    activityKind: "tool",
    activeLabel: `Running ${display}`,
    label: `Ran ${display}`,
    ...(description ? { detail: description } : {}),
  };
};
