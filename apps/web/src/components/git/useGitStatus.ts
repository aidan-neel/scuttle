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

export function useGitStatus(target: GitTargetRef, refreshKey: string): GitStatusState {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (isActive: () => boolean) => {
    setLoading(true);
    try {
      const api = await getGitApi();
      const next = await api.getGitStatus(target);
      if (!isActive()) return;
      setStatus(next);
      setError(null);
    } catch (cause) {
      if (isActive()) setError(describeApiError(cause, "Could not read Git status."));
    } finally {
      if (isActive()) setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [target.projectId, target.threadId, refreshKey]);

  return {
    status,
    error,
    loading,
    refresh: () => load(() => true),
    replace: (next) => {
      setStatus(next);
      setError(null);
    },
  };
}
