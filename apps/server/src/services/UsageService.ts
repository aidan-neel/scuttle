import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { UsageProviderFilter, UsageRange, UsageReport } from "@scuttle/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sqlite from "../persistence/Sqlite.ts";
import { type JsonlScanJob, scanJsonlBatch, type ScannedFileUsage } from "./usage/jsonlFallback.ts";
import {
  type CachedSourceMeta,
  scanAntigravityDir,
  scanOpenCodeDatabase,
} from "./usage/sqliteSources.ts";
import {
  queryUsageReport,
  RANGE_DAYS,
  readCachedSourceMeta,
  writeScannedUsageBatch,
} from "./usage/usageStore.ts";

export interface UsageSourcePaths {
  readonly claudeDirs: ReadonlyArray<string>;
  readonly codexDirs: ReadonlyArray<string>;
  readonly openCodeDbPath: string | null;
  readonly antigravityDirs: ReadonlyArray<string>;
  readonly disableNative?: boolean;
}

export interface UsageQueryInput {
  readonly range: UsageRange;
  readonly provider: UsageProviderFilter;
  readonly refresh?: boolean;
}

export interface UsageServiceShape {
  readonly getReport: (input: UsageQueryInput) => Effect.Effect<UsageReport>;
}

export class UsageService extends Context.Service<UsageService, UsageServiceShape>()(
  "scuttle/server/UsageService",
) {}

const defaultSourcePaths = (): UsageSourcePaths => {
  const home = NodeOS.homedir();
  return {
    claudeDirs: [NodePath.join(home, ".claude", "projects")],
    codexDirs: [
      NodePath.join(home, ".codex", "sessions"),
      NodePath.join(home, ".codex", "archived_sessions"),
    ],
    openCodeDbPath: NodePath.join(home, ".local", "share", "opencode", "opencode.db"),
    antigravityDirs: [
      NodePath.join(home, ".gemini", "antigravity-cli", "conversations"),
      NodePath.join(home, ".gemini", "antigravity", "conversations"),
    ],
  };
};

interface DiscoveredJsonl {
  readonly providerKind: "claude" | "codex";
  readonly path: string;
  readonly mtimeMs: number;
  readonly sizeBytes: number;
}

const walkJsonlFiles = (
  rootDir: string,
  providerKind: "claude" | "codex",
  cutoffMs: number,
  out: DiscoveredJsonl[],
  depth = 0,
): void => {
  if (depth > 5 || !NodeFS.existsSync(rootDir)) return;
  let entries: NodeFS.Dirent[];
  try {
    entries = NodeFS.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = NodePath.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkJsonlFiles(full, providerKind, cutoffMs, out, depth + 1);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    let stat: NodeFS.Stats;
    try {
      stat = NodeFS.statSync(full);
    } catch {
      continue;
    }
    if (stat.mtimeMs < cutoffMs) continue;
    out.push({
      providerKind,
      path: full,
      mtimeMs: Math.floor(stat.mtimeMs),
      sizeBytes: stat.size,
    });
  }
};

const FRESHNESS_TTL_MS = 5_000;
const MAX_HISTORY_DAYS = 90;

export const layer = (options?: {
  readonly sources?: UsageSourcePaths;
  readonly now?: () => number;
}) =>
  Layer.effect(
    UsageService,
    Effect.gen(function* () {
      const sqlite = yield* Sqlite.SqliteDatabase;
      const sources = options?.sources ?? defaultSourcePaths();
      const nowFn = options?.now ?? (() => Date.now());

      let lastSyncedCutoffDays = 0;
      let lastSyncFinishedMs = 0;
      let activeSync: Promise<void> | null = null;
      let activeSyncTargetDays = 0;

      const syncWindow = async (days: number, pruneStale: boolean): Promise<boolean> => {
        const nowMs = nowFn();
        const cutoffMs = nowMs - (days + 1) * 86_400_000;
        const cached: Map<string, CachedSourceMeta> = readCachedSourceMeta(sqlite.db);

        const discovered: DiscoveredJsonl[] = [];
        for (const dir of sources.claudeDirs) {
          walkJsonlFiles(dir, "claude", cutoffMs, discovered);
        }
        for (const dir of sources.codexDirs) {
          walkJsonlFiles(dir, "codex", cutoffMs, discovered);
        }

        const activeKeys = new Set<string>();
        const changedJobs: JsonlScanJob[] = [];
        for (const file of discovered) {
          activeKeys.add(file.path);
          const prev = cached.get(file.path);
          if (prev && prev.mtimeMs === file.mtimeMs && prev.sizeBytes === file.sizeBytes) {
            continue;
          }
          changedJobs.push(file);
        }

        const scannedJsonl = await scanJsonlBatch(
          changedJobs,
          sources.disableNative !== undefined ? { disableNative: sources.disableNative } : {},
        );

        const updated: ScannedFileUsage[] = [...scannedJsonl];
        let openCodeSkipped = false;

        if (sources.openCodeDbPath) {
          const oc = scanOpenCodeDatabase(
            sources.openCodeDbPath,
            cutoffMs,
            cached,
            lastSyncedCutoffDays >= days,
          );
          openCodeSkipped = oc.skippedUnchanged;
          for (const k of oc.activeKeys) activeKeys.add(k);
          updated.push(...oc.updated);
        }

        for (const dir of sources.antigravityDirs) {
          const ag = scanAntigravityDir(dir, cutoffMs, cached);
          for (const k of ag.activeKeys) activeKeys.add(k);
          updated.push(...ag.updated);
        }

        const pruneKeys: string[] = [];
        if (pruneStale) {
          for (const existingKey of cached.keys()) {
            if (openCodeSkipped && existingKey.startsWith("opencode:")) continue;
            if (!activeKeys.has(existingKey)) {
              pruneKeys.push(existingKey);
            }
          }
        }

        writeScannedUsageBatch(sqlite.db, updated, pruneKeys);
        lastSyncedCutoffDays = Math.max(lastSyncedCutoffDays, days);
        lastSyncFinishedMs = nowFn();
        return changedJobs.length > 0 || updated.length > 0;
      };

      const startSingleFlightSync = (targetDays: number): Promise<void> => {
        if (activeSync !== null) return activeSync;
        activeSyncTargetDays = targetDays;
        activeSync = syncWindow(targetDays, targetDays >= MAX_HISTORY_DAYS)
          .then(() => undefined)
          .catch(() => undefined)
          .finally(() => {
            activeSync = null;
            activeSyncTargetDays = 0;
          });
        return activeSync;
      };

      const ensureBackfill = (requestedDays: number): boolean => {
        if (lastSyncedCutoffDays >= MAX_HISTORY_DAYS) return false;
        if (requestedDays >= MAX_HISTORY_DAYS) return false;
        if (activeSync !== null) return activeSyncTargetDays >= MAX_HISTORY_DAYS;
        void startSingleFlightSync(MAX_HISTORY_DAYS);
        return true;
      };

      const getReport = Effect.fn("UsageService.getReport")(function* (input: UsageQueryInput) {
        return yield* Effect.promise(async () => {
          const t0 = performance.now();
          const requestedDays = RANGE_DAYS[input.range];
          const nowMs = nowFn();
          const needsRefresh =
            input.refresh === true ||
            lastSyncedCutoffDays < requestedDays ||
            nowMs - lastSyncFinishedMs >= FRESHNESS_TTL_MS;

          if (needsRefresh) {
            if (activeSync !== null) {
              await activeSync;
            }
            const stillNeedsSync =
              input.refresh === true ||
              lastSyncedCutoffDays < requestedDays ||
              nowFn() - lastSyncFinishedMs >= FRESHNESS_TTL_MS;
            if (stillNeedsSync) {
              const targetDays =
                input.refresh === true
                  ? Math.max(requestedDays, lastSyncedCutoffDays)
                  : requestedDays;
              await startSingleFlightSync(targetDays);
            }
          }

          const indexing = ensureBackfill(requestedDays);
          const scanMs = performance.now() - t0;
          return queryUsageReport(sqlite.db, {
            range: input.range,
            provider: input.provider,
            nowMs: nowFn(),
            scanMs,
            indexing,
          });
        });
      });

      return { getReport };
    }),
  );
