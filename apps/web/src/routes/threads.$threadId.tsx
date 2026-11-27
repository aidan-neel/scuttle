import { StopIcon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type {
  InteractionMode,
  ModelSelection,
  ThreadDetail,
  ThreadRuntime,
} from "@scuttle/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Skeleton } from "skullet/react";
import { ThreadGitPopover } from "@/components/git/ThreadGitPopover.tsx";
import {
  Composer,
  type ComposerHandle,
  type ComposerSubmitPayload,
} from "@/components/home/Composer.tsx";
import {
  type ComposerSubmitOutcome,
  toSubmitOutcome,
} from "@/components/home/ComposerBottomBar.tsx";
import { estimateContextUsage } from "@/components/home/contextUsage.ts";
import { QueuedTurnsTray, useQueuedTurnsTray } from "@/components/home/QueuedTurnsTray.tsx";
import { useThreadLocationControls } from "@/components/home/useThreadLocationControls.ts";
import { WorkspaceHeaderActions } from "@/components/shell/WorkspaceHeaderContext.tsx";
import { RewindDialog, useRewindFlow } from "@/components/thread/RewindDialog.tsx";
import { ScrollRuler } from "@/components/thread/ScrollRuler.tsx";
import { ScrollToEndButton } from "@/components/thread/ScrollToEndButton.tsx";
import { ThreadDelegationsBar } from "@/components/thread/ThreadDelegationsBar.tsx";
import {
  computeInitialVisibleStart,
  expandVisibleStart,
  INITIAL_VISIBLE_TURNS,
  LOAD_EARLIER_BATCH,
  ThreadTurnList,
} from "@/components/thread/ThreadTurnList.tsx";
import { QuestionPromptPanel } from "@/components/thread/QuestionPromptPanel.tsx";
import { findPendingQuestion } from "@/components/thread/questionModel.ts";
import { useStickToBottom } from "@/components/thread/useStickToBottom.ts";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { ConversationPageSkeleton } from "@/components/ui/SkeletonSamples.tsx";
import { easeOut } from "@/lib/motion.ts";
import { useThreadDetail, useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";

export const Route = createFileRoute("/threads/$threadId")({
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const detail = useThreadDetail(threadId);
  const { loadThreadDetail, setActiveThread } = useWorkspaceActions();
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setActiveThread(threadId);
    return () => {
      setActiveThread(null);
    };
  }, [threadId, setActiveThread]);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    void loadThreadDetail(threadId).catch((error: unknown) => {
      if (!active) return;
      setLoadError(error instanceof Error ? error.message : "Failed to load thread.");
    });
    return () => {
      active = false;
    };
  }, [threadId]);

  if (loadError) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-body text-fg-secondary">{loadError}</p>
        <Button variant="secondary" onClick={() => void navigate({ to: "/" })}>
          Back to home
        </Button>
      </section>
    );
  }

  return (
    <Skeleton
      loading={detail === undefined}
      id="thread-page"
      label="Loading thread"
      className="skullet-fill"
    >
      {detail ? <ThreadView detail={detail} /> : <ConversationPageSkeleton showBreadcrumb />}
    </Skeleton>
  );
}

function ThreadView({ detail }: { readonly detail: ThreadDetail }) {
  const providers = useWorkspaceSelector((s) => s.providers);
  const { sendTurn, interruptTurn, updateThread, compactThread, respondApproval } =
    useWorkspaceActions();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<ComposerHandle | null>(null);

  const { thread, turns } = detail;
  const [visibleWindow, setVisibleWindow] = useState<{
    readonly threadId: string;
    readonly start: number;
  }>(() => ({
    threadId: thread.id,
    start: computeInitialVisibleStart(turns.length, INITIAL_VISIBLE_TURNS),
  }));
  const visibleStart =
    visibleWindow.threadId === thread.id
      ? Math.min(visibleWindow.start, turns.length)
      : computeInitialVisibleStart(turns.length, INITIAL_VISIBLE_TURNS);

  const handleLoadEarlier = () => {
    setVisibleWindow((prev) => {
      const base =
        prev.threadId === thread.id
          ? Math.min(prev.start, turns.length)
          : computeInitialVisibleStart(turns.length, INITIAL_VISIBLE_TURNS);
      return {
        threadId: thread.id,
        start: expandVisibleStart(base, LOAD_EARLIER_BATCH),
      };
    });
  };

  const handleEnsureTurnVisible = (turnIndex: number) => {
    setVisibleWindow((prev) => {
      const base =
        prev.threadId === thread.id
          ? Math.min(prev.start, turns.length)
          : computeInitialVisibleStart(turns.length, INITIAL_VISIBLE_TURNS);
      if (turnIndex >= base) {
        return prev.threadId === thread.id ? prev : { threadId: thread.id, start: base };
      }
      return { threadId: thread.id, start: Math.max(0, turnIndex) };
    });
  };

  const { isAtBottom, scrollToBottom, unpin, anchoredTurnId, anchoredTurnMinHeightPx } =
    useStickToBottom(scrollRef, contentRef, turns, thread.id);
  const isRunning = thread.status.kind === "running" || thread.status.kind === "needs-input";
  const queue = useQueuedTurnsTray({
    detail,
    running: isRunning,
    composerRef,
    onError: setSubmitError,
  });
  const rewind = useRewindFlow({ detail, composerRef });
  const pendingQuestion = findPendingQuestion(turns);
  const contextUsage = estimateContextUsage({
    turns,
    model: thread.modelSelection.model,
    ...(thread.lastUsage ? { lastUsage: thread.lastUsage } : {}),
    ...(thread.sessionEpoch !== undefined ? { sessionEpoch: thread.sessionEpoch } : {}),
    ...(thread.activeSummary ? { activeSummary: thread.activeSummary } : {}),
  });

  const handleRuntimeUpdate = (runtime: ThreadRuntime) => updateThread(thread.id, { runtime });

  const status = useThreadLocationControls({
    thread,
    disabled: isRunning,
    onRuntimeUpdate: handleRuntimeUpdate,
    onError: setSubmitError,
  });

  const handleModelSelectionChange = (modelSelection: ModelSelection) => {
    setSubmitError(null);
    void updateThread(thread.id, { modelSelection }).catch((error: unknown) => {
      setSubmitError(describeApiError(error, "Could not update model."));
    });
  };

  const handleSubmit = async (payload: ComposerSubmitPayload): Promise<ComposerSubmitOutcome> => {
    setSubmitError(null);
    try {
      const edited = await queue.submitEdit(payload);
      if (edited !== null) return edited;
      const result = await sendTurn(thread.id, {
        prompt: payload.prompt,
        modelSelection: payload.modelSelection,
        ...(payload.mode !== undefined ? { mode: payload.mode } : {}),
        ...(payload.attachments.length > 0 ? { attachments: [...payload.attachments] } : {}),
      });
      return toSubmitOutcome(result, queue.tray.items);
    } catch (error) {
      setSubmitError(describeApiError(error, "Failed to send message."));
      return { kind: "failed" };
    }
  };

  const handleCompact = () => {
    if (compacting || isRunning) return;
    setSubmitError(null);
    setCompacting(true);
    void compactThread(thread.id)
      .catch((error: unknown) => {
        setSubmitError(describeApiError(error, "Failed to compact thread."));
      })
      .finally(() => {
        setCompacting(false);
      });
  };

  const handleStop = () => {
    void interruptTurn(thread.id);
  };

  const handleInteractionModeChange = (interactionMode: InteractionMode) => {
    void updateThread(thread.id, { interactionMode });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <WorkspaceHeaderActions>
        <ThreadGitPopover
          target={{ projectId: thread.projectId, threadId: thread.id }}
          fallbackBranch={thread.branch}
          refreshKey={`${thread.status.kind}:${turns.length}:${thread.branch}:${thread.runtime}`}
        />
        {isRunning && (
          <Button variant="destructive" size="sm" onClick={handleStop}>
            <Icon icon={StopIcon} />
            Stop
          </Button>
        )}
      </WorkspaceHeaderActions>

      <motion.div
        key={thread.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.11, ease: easeOut }}
        className="relative flex min-h-0 flex-1 flex-col"
      >
        <ScrollRuler
          turns={turns}
          scrollRef={scrollRef}
          mountedStart={visibleStart}
          onEnsureTurnVisible={handleEnsureTurnVisible}
          onBeforeJump={unpin}
        />
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 pt-8 pb-10 [scrollbar-gutter:stable_both-edges]"
        >
          <div className="mx-auto w-full max-w-composer">
            <ThreadDelegationsBar threadId={thread.id} projectId={thread.projectId} />
            <ThreadTurnList
              turns={turns}
              threadId={thread.id}
              scrollRef={scrollRef}
              contentRef={contentRef}
              visibleStart={visibleStart}
              anchoredTurnId={anchoredTurnId}
              anchoredTurnMinHeightPx={anchoredTurnMinHeightPx}
              onLoadEarlier={handleLoadEarlier}
              checkpoints={detail.checkpoints}
              visualizations={detail.visualizations}
              onRewind={isRunning ? undefined : rewind.requestRewind}
              onRespondApproval={respondApproval}
            />
          </div>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-canvas via-canvas/80 to-transparent"
        />
        <ScrollToEndButton visible={!isAtBottom} onClick={scrollToBottom} />
      </motion.div>

      <div className="shrink-0 px-4 pt-0 pb-6">
        <div className="mx-auto w-full max-w-composer space-y-2">
          {submitError && (
            <div className="rounded-control border border-danger/30 bg-danger/10 px-3 py-1.5 text-label text-danger">
              {submitError}
            </div>
          )}
          <div>
            <QueuedTurnsTray {...queue.tray} />
            <QuestionPromptPanel
              approval={pendingQuestion}
              returnFocusId={`composer-${thread.id}`}
              onRespond={(approvalId, input) => respondApproval(thread.id, approvalId, input)}
            />
            <Composer
              ref={composerRef}
              id={`composer-${thread.id}`}
              compact
              providers={providers}
              modelSelection={thread.modelSelection}
              onModelSelectionChange={handleModelSelectionChange}
              running={isRunning}
              onSubmit={handleSubmit}
              onStop={handleStop}
              interactionMode={thread.interactionMode}
              onInteractionModeChange={handleInteractionModeChange}
              onCompact={compacting ? undefined : handleCompact}
              filesRoot={thread.cwd}
              status={status}
              contextUsage={contextUsage}
              threadCompactAtTokens={thread.compactAtTokens}
              onCompactAtChange={(tokens) =>
                updateThread(thread.id, { compactAtTokens: tokens }).then(() => undefined)
              }
            />
          </div>
        </div>
      </div>
      <RewindDialog {...rewind.dialog} />
    </section>
  );
}
