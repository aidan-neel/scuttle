import type {
  GitChangedFile,
  GitFileStatus,
  GitRemote,
  GitStatusSummary,
  RemoteForge,
} from "@scuttle/contracts";
import { redactUrlCredentials } from "./redact.ts";

export interface ParsedRemoteUrl {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
}

const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const SCP_LIKE = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/;

const splitRepoPath = (host: string, rawPath: string): ParsedRemoteUrl | null => {
  const segments = rawPath
    .replace(/\.git\/?$/i, "")
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.length < 2) return null;
  const repo = segments[segments.length - 1]!;
  const owner = segments.slice(0, -1).join("/");
  return { host: host.toLowerCase(), owner, repo };
};

export const parseRemoteUrl = (rawUrl: string): ParsedRemoteUrl | null => {
  const url = rawUrl.trim();
  if (url.length === 0) return null;
  if (SCHEME_URL.test(url)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
    const host = isHttp ? parsed.host : parsed.hostname;
    if (host.length === 0) return null;
    return splitRepoPath(host, decodeURIComponent(parsed.pathname));
  }
  const scp = SCP_LIKE.exec(url);
  if (scp === null) return null;
  return splitRepoPath(scp[1]!, scp[2]!);
};

export interface KnownForgeHosts {
  readonly github: ReadonlyArray<string>;
  readonly gitlab: ReadonlyArray<string>;
}

export const detectForge = (host: string, known: KnownForgeHosts): Exclude<RemoteForge, "none"> => {
  const normalized = host.toLowerCase();
  if (known.github.includes(normalized)) return "github";
  if (known.gitlab.includes(normalized)) return "gitlab";
  const hostname = normalized.split(":")[0] ?? normalized;
  if (hostname === "github.com" || hostname.split(".").includes("github")) return "github";
  if (hostname === "gitlab.com" || hostname.split(".").includes("gitlab")) return "gitlab";
  return "other";
};

export const describeRemote = (name: string, rawUrl: string, known: KnownForgeHosts): GitRemote => {
  const parsed = parseRemoteUrl(rawUrl);
  const url = redactUrlCredentials(rawUrl.trim());
  if (parsed === null) {
    return { name, url, forge: "other", host: null, owner: null, repo: null, webUrl: null };
  }
  const forge = detectForge(parsed.host, known);
  return {
    name,
    url,
    forge,
    host: parsed.host,
    owner: parsed.owner,
    repo: parsed.repo,
    webUrl: forge === "other" ? null : `https://${parsed.host}/${parsed.owner}/${parsed.repo}`,
  };
};

export interface ParsedPorcelain {
  readonly branch: string | null;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly hasCommits: boolean;
  readonly files: ReadonlyArray<GitChangedFile>;
}

const XY_STATUS: Record<string, GitFileStatus> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "typechange",
};

const statusFromXY = (xy: string): GitFileStatus => {
  for (const code of xy) {
    const status = XY_STATUS[code];
    if (status !== undefined) return status;
  }
  return "modified";
};

const trackedFile = (xy: string, path: string, originalPath: string | null): GitChangedFile => ({
  path,
  originalPath,
  status: statusFromXY(xy),
  staged: xy[0] !== ".",
  unstaged: xy[1] !== ".",
  additions: 0,
  deletions: 0,
});

const fieldsAfter = (record: string, count: number): string =>
  record.split(" ").slice(count).join(" ");

export const parsePorcelainV2 = (output: string): ParsedPorcelain => {
  const records = output.split("\0");
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let hasCommits = true;
  const files: GitChangedFile[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.length === 0) continue;
    if (record.startsWith("# branch.oid ")) {
      hasCommits = record.slice("# branch.oid ".length) !== "(initial)";
    } else if (record.startsWith("# branch.head ")) {
      const head = record.slice("# branch.head ".length);
      branch = head === "(detached)" ? null : head;
    } else if (record.startsWith("# branch.upstream ")) {
      upstream = record.slice("# branch.upstream ".length);
    } else if (record.startsWith("# branch.ab ")) {
      const match = /^\+(\d+) -(\d+)$/.exec(record.slice("# branch.ab ".length));
      if (match !== null) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (record.startsWith("1 ")) {
      files.push(trackedFile(record.slice(2, 4), fieldsAfter(record, 8), null));
    } else if (record.startsWith("2 ")) {
      const originalPath = records[index + 1] ?? null;
      index += 1;
      files.push(trackedFile(record.slice(2, 4), fieldsAfter(record, 9), originalPath));
    } else if (record.startsWith("u ")) {
      files.push({
        ...trackedFile(record.slice(2, 4), fieldsAfter(record, 10), null),
        status: "conflicted",
      });
    } else if (record.startsWith("? ")) {
      files.push({
        path: record.slice(2),
        originalPath: null,
        status: "untracked",
        staged: false,
        unstaged: true,
        additions: 0,
        deletions: 0,
      });
    }
  }

  return { branch, upstream, ahead, behind, hasCommits, files };
};

export interface LineDelta {
  readonly additions: number;
  readonly deletions: number;
}

const toCount = (raw: string): number => {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : 0;
};

export const parseNumstatZ = (output: string): ReadonlyMap<string, LineDelta> => {
  const records = output.split("\0");
  const deltas = new Map<string, LineDelta>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(record);
    if (match === null) continue;
    let path = match[3]!;
    if (path.length === 0) {
      path = records[index + 2] ?? "";
      index += 2;
    }
    if (path.length === 0) continue;
    deltas.set(path, { additions: toCount(match[1]!), deletions: toCount(match[2]!) });
  }
  return deltas;
};

export const applyLineDeltas = (
  files: ReadonlyArray<GitChangedFile>,
  sources: ReadonlyArray<ReadonlyMap<string, LineDelta>>,
): ReadonlyArray<GitChangedFile> =>
  files.map((file) => {
    let additions = 0;
    let deletions = 0;
    for (const source of sources) {
      const delta = source.get(file.path);
      if (delta === undefined) continue;
      additions += delta.additions;
      deletions += delta.deletions;
    }
    return { ...file, additions, deletions };
  });

export const summarizeFiles = (files: ReadonlyArray<GitChangedFile>): GitStatusSummary => ({
  changed: files.length,
  staged: files.filter((file) => file.staged).length,
  untracked: files.filter((file) => file.status === "untracked").length,
  conflicted: files.filter((file) => file.status === "conflicted").length,
  additions: files.reduce((total, file) => total + file.additions, 0),
  deletions: files.reduce((total, file) => total + file.deletions, 0),
});

export const isSafeRepoPath = (path: string): boolean =>
  path.length > 0 &&
  !path.startsWith("/") &&
  !path.startsWith("-") &&
  !/^[a-z]:/i.test(path) &&
  !path.split(/[\\/]/).includes("..") &&
  !path.includes("\0");
