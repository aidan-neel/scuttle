import { StopIcon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type {
  InteractionMode,
  ModelSelection,
  ThreadDetail,
  ThreadRuntime,
  ThreadTurn,
} from "@scuttle/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ThreadGitPopover } from "@/components/git/ThreadGitPopover.tsx";
import { Composer, type ComposerSubmitPayload } from "@/components/home/Composer.tsx";
import { estimateContextUsage } from "@/components/home/contextUsage.ts";
import { useThreadLocationControls } from "@/components/home/useThreadLocationControls.ts";
import { ScrollRuler } from "@/components/thread/ScrollRuler.tsx";
import { ScrollToEndButton } from "@/components/thread/ScrollToEndButton.tsx";
import {
  computeInitialVisibleStart,
  expandVisibleStart,
  INITIAL_VISIBLE_TURNS,
  LOAD_EARLIER_BATCH,
  ThreadTurnList,
} from "@/components/thread/ThreadTurnList.tsx";
import { useStickToBottom } from "@/components/thread/useStickToBottom.ts";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { easeOut } from "@/lib/motion.ts";
import { useThreadDetail, useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";

export const Route = createFileRoute("/threads/$threadId")({
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const detail = useThreadDetail(threadId);
  const { loadThreadDetail } = useWorkspaceActions();
  const [loadError, setLoadError] = useState<string | null>(null);

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

  if (!detail) {
    return (
      <section className="flex flex-1 items-center justify-center gap-2 text-label text-fg-muted">
        <DotSpinner variant="loading" label="Loading thread" />
        Loading thread…
      </section>
    );
  }

  return <ThreadView detail={detail} />;
}

const EMPTY_TURNS: ReadonlyArray<ThreadTurn> = [];

function ThreadView({ detail }: { readonly detail: ThreadDetail }) {
  const providers = useWorkspaceSelector((s) => s.providers);
  const { sendTurn, interruptTurn, updateThread, compactThread, respondApproval } =
    useWorkspaceActions();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

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

  const { isAtBottom, scrollToBottom } = useStickToBottom(scrollRef, contentRef, turns, thread.id);
  const isRunning = thread.status.kind === "running" || thread.status.kind === "needs-input";
  const contextUsage = estimateContextUsage({
    turns: thread.lastUsage ? EMPTY_TURNS : turns,
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

  const handleSubmit = async (payload: ComposerSubmitPayload) => {
    setSubmitError(null);
    try {
      await sendTurn(thread.id, {
        prompt: payload.prompt,
        modelSelection: payload.modelSelection,
        ...(payload.attachments.length > 0 ? { attachments: [...payload.attachments] } : {}),
      });
    } catch (error) {
      setSubmitError(describeApiError(error, "Failed to send message."));
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
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <Identicon name={thread.projectName} size="sm" />
        <span className="shrink-0 text-label font-medium text-fg-secondary">
          {thread.projectName}
        </span>
        <span className="text-fg-faint">/</span>
        <h1 className="min-w-0 flex-1 truncate text-body font-medium text-fg">{thread.title}</h1>
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
      </header>

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
        />
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pt-8 pb-10">
          <div className="mx-auto w-full max-w-composer">
            <ThreadTurnList
              turns={turns}
              threadId={thread.id}
              scrollRef={scrollRef}
              contentRef={contentRef}
              visibleStart={visibleStart}
              onLoadEarlier={handleLoadEarlier}
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

      <div className="shrink-0 px-4 pt-0 pb-2">
        <div className="mx-auto w-full max-w-composer space-y-2">
          {submitError && (
            <div className="rounded-control border border-danger/30 bg-danger/10 px-3 py-1.5 text-label text-danger">
              {submitError}
            </div>
          )}
          <Composer
            id={`composer-${thread.id}`}
            placeholder={
              isRunning ? "Agent is working… press Esc or click Stop to interrupt" : undefined
            }
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
          />
        </div>
      </div>
    </section>
  );
}
