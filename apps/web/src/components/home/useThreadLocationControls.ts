import { describeApiError } from "@scuttle/client-runtime";
import type { Thread, ThreadRuntime } from "@scuttle/contracts";
import { useEffect, useState } from "react";
import { getGitApi } from "@/components/git/gitApi.ts";
import { useWorkspace } from "@/lib/workspace.tsx";
import type { ComposerStatus } from "./ComposerBottomBar.tsx";

interface UseThreadLocationOptions {
  readonly thread: Thread;
  readonly disabled: boolean;
  readonly onRuntimeUpdate: (runtime: ThreadRuntime) => Promise<unknown>;
  readonly onError: (message: string | null) => void;
}

export function useThreadLocationControls({
  thread,
  disabled,
  onRuntimeUpdate,
  onError,
}: UseThreadLocationOptions): ComposerStatus {
  const { branchesByProject, loadBranches, loadThreadDetail } = useWorkspace();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadBranches(thread.projectId).catch(() => {});
  }, [thread.projectId]);

  const branches = branchesByProject[thread.projectId] ?? [];

  const handleRuntimeChange = (nextRuntime: ThreadRuntime) => {
    if (nextRuntime === thread.runtime || busy || disabled) return;
    onError(null);
    setBusy(true);
    void onRuntimeUpdate(nextRuntime)
      .then(() => Promise.all([loadThreadDetail(thread.id), loadBranches(thread.projectId)]))
      .catch((error: unknown) => {
        onError(describeApiError(error, "Failed to switch runtime."));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const handleBranchChange = (nextBranch: string) => {
    if (nextBranch === thread.branch || busy || disabled) return;
    onError(null);
    setBusy(true);
    void getGitApi()
      .then((api) =>
        api.checkoutGit(
          { projectId: thread.projectId, threadId: thread.id },
          { branch: nextBranch },
        ),
      )
      .then(() => Promise.all([loadThreadDetail(thread.id), loadBranches(thread.projectId)]))
      .catch((error: unknown) => {
        onError(describeApiError(error, "Failed to switch branch."));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return {
    runtime: thread.runtime,
    branch: thread.branch,
    state: thread.status.kind,
    branches,
    busy,
    disabled,
    onRuntimeChange: handleRuntimeChange,
    onBranchChange: handleBranchChange,
  };
}
