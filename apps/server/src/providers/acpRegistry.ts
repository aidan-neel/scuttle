import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Schema from "effect/Schema";

export const ACP_REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
export const MAX_REGISTRY_BYTES = 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
export const REGISTRY_TIMEOUT_MS = 30_000;
export const REGISTRY_CACHE_TTL_MS = 5 * 60 * 1_000;

const SEMVER = "v?[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?";
const NPX_RE = new RegExp(`^(?:@[^/@\\s]+/[^@\\s]+|[a-z0-9][a-z0-9._-]*)@${SEMVER}$`, "iu");
const UVX_RE = new RegExp(`^[a-z0-9][a-z0-9._-]*(?:@|==)${SEMVER}$`, "iu");
const BText = Schema.String.check(Schema.isMaxLength(1_024));
const BVer = Schema.String.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u),
);
const HttpsUrl = Schema.String.check(
  Schema.isMaxLength(2_048),
  Schema.makeFilter((v) => {
    if (!URL.canParse(v)) return "Invalid URL.";
    const u = new URL(v);
    return (u.protocol === "https:" && !u.username && !u.password) || "Must be HTTPS.";
  }),
);
const pin = (re: RegExp) =>
  Schema.String.check(
    Schema.isMaxLength(256),
    Schema.makeFilter((v) => re.test(v) || "Pin semver."),
  );
const OptArgs = Schema.optionalKey(Schema.Array(BText).check(Schema.isMaxLength(64)));
const OptEnv = Schema.optionalKey(
  Schema.Record(Schema.String.check(Schema.isMaxLength(256)), BText),
);
const distPkg = (re: RegExp) =>
  Schema.optionalKey(Schema.Struct({ package: pin(re), args: OptArgs, env: OptEnv }));

export const AcpRegistryBinaryTarget = Schema.Struct({
  archive: HttpsUrl,
  cmd: BText,
  sha256: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/iu))),
  args: OptArgs,
  env: OptEnv,
});
export type AcpRegistryBinaryTarget = typeof AcpRegistryBinaryTarget.Type;

export const AcpRegistryAgent = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(128), Schema.isPattern(/^[a-z0-9][a-z0-9._-]*$/u)),
  name: Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(160)),
  version: BVer,
  description: BText,
  icon: Schema.optionalKey(HttpsUrl),
  website: Schema.optionalKey(HttpsUrl),
  repository: Schema.optionalKey(HttpsUrl),
  distribution: Schema.Struct({
    binary: Schema.optionalKey(Schema.Record(Schema.String, AcpRegistryBinaryTarget)),
    npx: distPkg(NPX_RE),
    uvx: distPkg(UVX_RE),
  }),
});
export type AcpRegistryAgent = typeof AcpRegistryAgent.Type;
export interface AcpRegistryIndex {
  readonly version: string;
  readonly agents: ReadonlyArray<AcpRegistryAgent>;
}

export class AcpRegistryError extends Schema.TaggedError<AcpRegistryError>()("AcpRegistryError", {
  reason: Schema.Literals([
    "registry_unavailable",
    "agent_not_found",
    "unsupported_platform",
    "unsupported_distribution",
    "download_failed",
    "checksum_mismatch",
    "archive_invalid",
    "runner_unavailable",
    "install_failed",
  ]),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}

export type AcpRegistryPlatformTarget = `${"darwin" | "linux" | "windows"}-${"aarch64" | "x86_64"}`;
export type AcpRegistryDistributionKind = "binary" | "npx" | "uvx";
export type AcpRegistryDistributionPreference = "auto" | AcpRegistryDistributionKind;
export interface ResolvedDistribution {
  readonly kind: AcpRegistryDistributionKind;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
  readonly binaryTarget?: AcpRegistryBinaryTarget;
  readonly platformTarget?: AcpRegistryPlatformTarget;
  readonly packageName?: string;
}
export interface InstalledRegistryAgent {
  readonly command: string;
  readonly args: string[];
  readonly env: Record<string, string>;
  readonly installDir: string;
  readonly distributionKind: AcpRegistryDistributionKind;
  readonly version: string;
}

type ErrReason = AcpRegistryError["reason"];
type EnvMap = Record<string, string | undefined>;
const cache = new Map<string, { readonly index: AcpRegistryIndex; readonly fetchedAtMs: number }>();
export const clearRegistryCache = (): void => cache.clear();
const mkdirP = (dir: string) => fs.mkdirSync(dir, { recursive: true });
const rmRf = (target: string) => fs.rmSync(target, { recursive: true, force: true });
const fail = (reason: ErrReason, detail: string, cause?: unknown): never => {
  throw new AcpRegistryError({ reason, detail, cause });
};
const assertHttps = (url: string, reason: ErrReason): string => {
  try {
    return Schema.decodeUnknownSync(HttpsUrl)(url);
  } catch (c) {
    return fail(reason, `URL must use HTTPS: ${url}`, c);
  }
};

const Envelope = Schema.Struct({
  version: BVer,
  agents: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(2_000)),
});
const BinManifest = Schema.fromJsonString(
  Schema.Struct({ bin: Schema.Union([BText, Schema.Record(Schema.String, BText)]) }),
);
const decodeAgent = Schema.decodeUnknownOption(AcpRegistryAgent);

export const parseRegistryJson = (raw: string | unknown): AcpRegistryIndex => {
  try {
    const env = Schema.decodeUnknownSync(Envelope)(typeof raw === "string" ? JSON.parse(raw) : raw);
    const agents = env.agents.flatMap((x) => {
      const d = decodeAgent(x);
      return d._tag === "Some" ? [d.value] : [];
    });
    return { version: env.version, agents };
  } catch (c) {
    return fail("registry_unavailable", "Invalid ACP Registry JSON or schema.", c);
  }
};

const readStream = async (
  res: Response,
  max: number,
  reason: ErrReason,
  onChunk: (c: Uint8Array) => void,
): Promise<void> => {
  const len = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(len) && len > max) fail(reason, `Exceeds ${max} bytes.`);
  const r = res.body?.getReader();
  if (!r) {
    const b = new Uint8Array(await res.arrayBuffer());
    if (b.byteLength > max) fail(reason, `Exceeds ${max} bytes.`);
    return onChunk(b);
  }
  try {
    for (let total = 0; ;) {
      const { done, value } = await r.read();
      if (done) return;
      if ((total += value.byteLength) > max) {
        await r.cancel().catch(() => {});
        fail(reason, `Exceeds ${max} bytes.`);
      }
      onChunk(value);
    }
  } finally {
    r.releaseLock();
  }
};

export const fetchRegistry = async (opts: {
  readonly dataDir: string;
  readonly registryUrl?: string;
  readonly fetchFn?: typeof fetch;
  readonly forceRefresh?: boolean;
  readonly nowMs?: number;
}): Promise<AcpRegistryIndex> => {
  const { dataDir, registryUrl = ACP_REGISTRY_URL, fetchFn = fetch, forceRefresh, nowMs } = opts;
  const url = assertHttps(registryUrl, "registry_unavailable");
  const dir = path.resolve(dataDir);
  const key = `${dir}\0${url}`;
  const now = nowMs ?? Date.now();
  const mem = cache.get(key);
  const age = mem ? now - mem.fetchedAtMs : -1;
  if (!forceRefresh && mem && age >= 0 && age < REGISTRY_CACHE_TTL_MS) return mem.index;
  const cachePath = path.join(dir, "cache", "acp-registry", "registry.json");
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) });
    if (!res.ok) fail("registry_unavailable", `Registry HTTP ${res.status}.`);
    const chunks: Uint8Array[] = [];
    await readStream(res, MAX_REGISTRY_BYTES, "registry_unavailable", (c) => chunks.push(c));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    const index = parseRegistryJson(text);
    mkdirP(path.dirname(cachePath));
    const tmp = `${cachePath}.${process.pid}-${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmp, text, "utf8");
      fs.renameSync(tmp, cachePath);
    } finally {
      rmRf(tmp);
    }
    cache.set(key, { index, fetchedAtMs: now });
    return index;
  } catch (err) {
    if (!forceRefresh && fs.existsSync(cachePath)) {
      try {
        const d = parseRegistryJson(fs.readFileSync(cachePath, "utf8"));
        cache.set(key, { index: d, fetchedAtMs: now });
        return d;
      } catch {}
    }
    if (err instanceof AcpRegistryError) throw err;
    return fail("registry_unavailable", `Registry fetch failed: ${String(err)}`, err);
  }
};

export const resolvePlatformTarget = (
  plat: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): AcpRegistryPlatformTarget | undefined => {
  const os = plat === "darwin" ? "darwin" : plat === "linux" ? "linux" : undefined;
  const normOs = os ?? (plat === "win32" ? "windows" : undefined);
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined;
  return normOs && cpu ? `${normOs}-${cpu}` : undefined;
};

export const resolvePlatformTargetCandidates = (
  plat: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): ReadonlyArray<AcpRegistryPlatformTarget> => {
  const t = resolvePlatformTarget(plat, arch);
  return t === "windows-aarch64" ? ["windows-aarch64", "windows-x86_64"] : t ? [t] : [];
};

export const resolveDistribution = (
  agent: AcpRegistryAgent,
  pref: AcpRegistryDistributionPreference = "auto",
  plat: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): ResolvedDistribution | undefined => {
  const target = resolvePlatformTargetCandidates(plat, arch).find(
    (c) => agent.distribution.binary?.[c],
  );
  const bin = target ? agent.distribution.binary?.[target] : undefined;
  for (const kind of pref === "auto" ? (["binary", "npx", "uvx"] as const) : [pref]) {
    if (kind === "binary" && bin && target)
      return {
        kind,
        args: bin.args ?? [],
        env: bin.env ?? {},
        binaryTarget: bin,
        platformTarget: target,
      };
    const pkg = kind === "binary" ? undefined : agent.distribution[kind];
    if (pkg) return { kind, args: pkg.args ?? [], env: pkg.env ?? {}, packageName: pkg.package };
  }
  return undefined;
};

const safeSegs = (entry: string): ReadonlyArray<string> | undefined => {
  const n = entry.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  const s = n.split("/").filter(Boolean);
  return !s.length ||
    n[0] === "/" ||
    /^[A-Za-z]:/u.test(n) ||
    s.some((x) => x === "." || x === "..")
    ? undefined
    : s;
};

export const validateArchiveEntries = (listing: string): boolean =>
  listing
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter(Boolean)
    .every((l) => l === "./" || safeSegs(l) !== undefined);

const runCmd = async (
  cmd: string,
  args: ReadonlyArray<string>,
  env: EnvMap,
  reason: ErrReason = "archive_invalid",
): Promise<string> => {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env });
  } catch (c) {
    return fail("runner_unavailable", `Failed to spawn '${cmd}'.`, c);
  }
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ]);
  if (code !== 0) fail(reason, `'${cmd}' exited ${code}: ${err.trim().slice(-600)}`);
  return out;
};

const assertExe = (
  root: string,
  exe: string,
  chmodExec: boolean,
  plat: NodeJS.Platform,
): string => {
  const real = fs.realpathSync(exe);
  const rel = path.relative(fs.realpathSync(root), real);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    fail("archive_invalid", `Command escapes '${root}'.`);
  if (chmodExec && plat !== "win32") fs.chmodSync(real, 0o755);
  const st = fs.statSync(real);
  if (!st.isFile() || (plat !== "win32" && (st.mode & 0o111) === 0))
    fail("archive_invalid", `Not executable: ${real}`);
  return real;
};

const FLAGS = {
  tar_gz: ["-tzf", "-xzf"],
  tar_bz2: ["-tjf", "-xjf"],
  zip_tar: ["-tf", "-xf"],
} as const;
const archiveKind = (url: string) => {
  const p = new URL(url).pathname.toLowerCase();
  if (p.endsWith(".tar.gz") || p.endsWith(".tgz")) return "tar_gz";
  if (p.endsWith(".tar.bz2") || p.endsWith(".tbz2")) return "tar_bz2";
  return p.endsWith(".zip") ? "zip" : "raw";
};

const readSingleNpmBin = (dir: string, pkg: string, plat: NodeJS.Platform) => {
  const p = path.join(
    dir,
    plat === "win32" ? "node_modules" : "lib/node_modules",
    pkg,
    "package.json",
  );
  if (!fs.existsSync(p)) return undefined;
  const m = Schema.decodeUnknownOption(BinManifest)(fs.readFileSync(p, "utf8"));
  const ks = m._tag === "Some" && typeof m.value.bin !== "string" ? Object.keys(m.value.bin) : [];
  return ks.length === 1 ? ks[0] : undefined;
};

export const installRegistryAgent = async (input: {
  readonly agent: AcpRegistryAgent;
  readonly dataDir: string;
  readonly preference?: AcpRegistryDistributionPreference;
  readonly fetchFn?: typeof fetch;
  readonly env?: Readonly<EnvMap>;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly maxArchiveBytes?: number;
}): Promise<InstalledRegistryAgent> => {
  const { agent } = input;
  const plat = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const resolved = resolveDistribution(agent, input.preference ?? "auto", plat, arch);
  if (!resolved)
    return fail("unsupported_distribution", `No distribution for '${agent.id}' (${plat}-${arch}).`);
  const ret = (
    command: string,
    installDir: string,
    extraEnv: Readonly<Record<string, string>> = {},
  ): InstalledRegistryAgent => ({
    command,
    args: [...resolved.args],
    env: { ...resolved.env, ...extraEnv },
    installDir,
    distributionKind: resolved.kind,
    version: agent.version,
  });
  const env: EnvMap = { ...(input.env ?? process.env) };
  const base = path.join(
    path.resolve(input.dataDir),
    "tools",
    agent.id,
    encodeURIComponent(agent.version),
  );

  if (resolved.kind === "binary" && resolved.binaryTarget && resolved.platformTarget) {
    const t = resolved.binaryTarget;
    const url = assertHttps(t.archive, "archive_invalid");
    const segs = safeSegs(t.cmd);
    if (!segs) return fail("archive_invalid", `Unsafe command '${t.cmd}'.`);
    const installDir = path.join(base, resolved.platformTarget);
    const finalExe = path.join(installDir, ...segs);
    if (!fs.existsSync(finalExe)) {
      mkdirP(path.dirname(installDir));
      const staging = fs.mkdtempSync(path.join(path.dirname(installDir), `.${agent.id}-`));
      const extDir = path.join(staging, "e");
      mkdirP(extDir);
      try {
        const dl = path.join(staging, "dl.bin");
        const res = await (input.fetchFn ?? fetch)(url).catch((c) =>
          fail("download_failed", `Download failed: ${url}`, c),
        );
        if (!res.ok) fail("download_failed", `Download HTTP ${res.status}.`);
        const hash = crypto.createHash("sha256");
        const fd = fs.openSync(dl, "w");
        try {
          await readStream(
            res,
            input.maxArchiveBytes ?? MAX_ARCHIVE_BYTES,
            "archive_invalid",
            (c) => {
              hash.update(c);
              fs.writeSync(fd, c);
            },
          );
        } finally {
          fs.closeSync(fd);
        }
        if (t.sha256 !== undefined && hash.digest("hex").toLowerCase() !== t.sha256.toLowerCase())
          fail("checksum_mismatch", "SHA-256 mismatch.");
        const kind = archiveKind(url);
        if (kind === "raw") {
          const staged = path.join(extDir, ...segs);
          mkdirP(path.dirname(staged));
          fs.renameSync(dl, staged);
        } else {
          const unzip = kind === "zip" && plat !== "win32";
          const tool = unzip ? "unzip" : "tar";
          const [lf, ef] = FLAGS[kind === "zip" ? "zip_tar" : kind];
          if (!validateArchiveEntries(await runCmd(tool, unzip ? ["-Z1", dl] : [lf, dl], env)))
            fail("archive_invalid", "Unsafe archive entries.");
          await runCmd(tool, unzip ? ["-q", dl, "-d", extDir] : [ef, dl, "-C", extDir], env);
        }
        const stagedExe = path.join(extDir, ...segs);
        if (!fs.existsSync(stagedExe)) fail("archive_invalid", `Archive missing '${t.cmd}'.`);
        assertExe(extDir, stagedExe, true, plat);
        rmRf(installDir);
        fs.renameSync(extDir, installDir);
      } finally {
        rmRf(staging);
      }
    }
    return ret(assertExe(installDir, finalExe, false, plat), installDir);
  }

  if ((resolved.kind !== "npx" && resolved.kind !== "uvx") || !resolved.packageName)
    return fail("unsupported_distribution", `Incomplete distribution for '${agent.id}'.`);
  const spec = resolved.packageName;
  const isNpx = resolved.kind === "npx";
  try {
    Schema.decodeUnknownSync(pin(isNpx ? NPX_RE : UVX_RE))(spec);
  } catch (c) {
    fail("install_failed", `Package '${spec}' must use pinned semver.`, c);
  }
  const installDir = path.join(base, isNpx ? "npm" : "python");
  const binDir = isNpx && plat === "win32" ? installDir : path.join(installDir, "bin");
  mkdirP(binDir);
  const cmdEnv: EnvMap = isNpx
    ? { ...env, npm_config_prefix: installDir }
    : { ...env, UV_TOOL_DIR: installDir, UV_TOOL_BIN_DIR: binDir };
  if (isNpx) delete cmdEnv.NPM_CONFIG_PREFIX;
  await runCmd(
    isNpx ? "npm" : "uv",
    isNpx ? ["install", "--global", spec] : ["tool", "install", "--force", spec],
    cmdEnv,
    "install_failed",
  );

  const sepIdx = !isNpx && spec.includes("==") ? spec.lastIndexOf("==") : spec.lastIndexOf("@");
  const pkgName = spec.slice(0, sepIdx);
  const pkgBase = pkgName.split("/").pop() ?? pkgName;
  const npmBin = isNpx ? readSingleNpmBin(installDir, pkgName, plat) : undefined;
  const cands = [...(npmBin ? [npmBin] : []), agent.id, pkgBase, pkgBase.replace(/-acp$/u, "")];
  const sep = plat === "win32" ? ";" : ":";
  const restPath = env.PATH?.split(sep).filter((p) => p && p !== binDir) ?? [];
  const cmd =
    cands.map((n) => path.join(binDir, n)).find((p) => fs.existsSync(p)) ??
    path.join(binDir, agent.id);
  return ret(cmd, installDir, { PATH: [binDir, ...restPath].join(sep) });
};
