import { describeApiError, type GitTargetRef } from "@scuttle/client-runtime";
import type { GitStatus } from "@scuttle/contracts";
import { useEffect, useState } from "react";
import { getGitApi } from "./gitApi.ts";

export interface GitStatusState {
  readonly status: GitStatus | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly refresh: () => Promise<void>;
  readonly replace: (status: GitStatus) => void;
}

const statusCache = new Map<string, GitStatus>();

const targetCacheKey = (target: GitTargetRef) => `${target.projectId}:${target.threadId ?? ""}`;

export function useGitStatus(target: GitTargetRef, refreshKey: string): GitStatusState {
  const cacheKey = targetCacheKey(target);
  const [status, setStatus] = useState<GitStatus | null>(() => statusCache.get(cacheKey) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (isActive: () => boolean) => {
    setLoading(true);
    try {
      const api = await getGitApi();
      const next = await api.getGitStatus(target);
      statusCache.set(cacheKey, next);
      if (isActive()) {
        setStatus(next);
        setError(null);
      }
    } catch (cause) {
      if (isActive()) setError(describeApiError(cause, "Could not read Git status."));
    }
    if (isActive()) setLoading(false);
  };

  useEffect(() => {
    let active = true;
    const cached = statusCache.get(cacheKey);
    if (cached !== undefined) {
      setStatus(cached);
    }
    void load(() => active);
    return () => {
      active = false;
    };
  }, [cacheKey, refreshKey]);

  return {
    status,
    error,
    loading,
    refresh: () => load(() => true),
    replace: (next) => {
      statusCache.set(cacheKey, next);
      setStatus(next);
      setError(null);
    },
  };
}
