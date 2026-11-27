import { describeApiError } from "@scuttle/client-runtime";
import type {
  Agent,
  InteractionMode,
  ModelSelection,
  ThreadDetail,
  ThreadRuntime,
} from "@scuttle/contracts";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
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
import { RewindDialog, useRewindFlow } from "@/components/thread/RewindDialog.tsx";
import { ScrollRuler } from "@/components/thread/ScrollRuler.tsx";
import { ScrollToEndButton } from "@/components/thread/ScrollToEndButton.tsx";
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
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { easeOut } from "@/lib/motion.ts";
import { useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";
import { useTask } from "./useTask.ts";

interface AgentConversationProps {
  readonly agent: Agent;
  readonly detail: ThreadDetail;
  readonly onViewAgent: () => void;
}

export function AgentConversation({ agent, detail, onViewAgent }: AgentConversationProps) {
  const providers = useWorkspaceSelector((s) => s.providers);
  const {
    sendTurn,
    sendAgentTurn,
    startAgentSetup,
    updateAgent,
    updateThread,
    compactThread,
    interruptTurn,
    respondApproval,
  } = useWorkspaceActions();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<ComposerHandle | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);
  const introTask = useTask();
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

  const isRunning = thread.status.kind === "running" || thread.status.kind === "needs-input";
  const composerId = `composer-agent-${agent.id}`;
  const queue = useQueuedTurnsTray({
    detail,
    running: isRunning,
    composerRef,
    onError: setSubmitError,
  });
  const rewind = useRewindFlow({ detail, composerRef });
  const pendingQuestion = findPendingQuestion(turns);
  const { isAtBottom, scrollToBottom, unpin, anchoredTurnId, anchoredTurnMinHeightPx } =
    useStickToBottom(scrollRef, contentRef, turns, thread.id);
  const contextUsage = estimateContextUsage({
    turns,
    model: thread.modelSelection.model,
    ...(thread.lastUsage ? { lastUsage: thread.lastUsage } : {}),
    ...(thread.sessionEpoch !== undefined ? { sessionEpoch: thread.sessionEpoch } : {}),
    ...(thread.activeSummary ? { activeSummary: thread.activeSummary } : {}),
  });
  const handleRuntimeUpdate = (runtime: ThreadRuntime) => updateAgent(agent.id, { runtime });
  const status = useThreadLocationControls({
    thread,
    disabled: isRunning,
    onRuntimeUpdate: handleRuntimeUpdate,
    onError: setSubmitError,
  });

  const needsPurpose = !isRunning && agent.purpose.trim().length === 0;

  const focusComposer = () => {
    document.getElementById(composerId)?.focus();
  };

  const handleSubmit = async (payload: ComposerSubmitPayload): Promise<ComposerSubmitOutcome> => {
    setSubmitError(null);
    const input = {
      prompt: payload.prompt,
      modelSelection: payload.modelSelection,
      ...(payload.attachments.length > 0 ? { attachments: [...payload.attachments] } : {}),
    };
    try {
      const edited = await queue.submitEdit(payload);
      if (edited !== null) return edited;
      if (payload.mode === undefined) {
        await sendAgentTurn(agent.id, input);
        return { kind: "started" };
      }
      const result = await sendTurn(thread.id, { ...input, mode: payload.mode });
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

  const handleModelSelectionChange = (modelSelection: ModelSelection) => {
    setSubmitError(null);
    void updateAgent(agent.id, { modelSelection }).catch((error: unknown) => {
      setSubmitError(describeApiError(error, "Could not update model."));
    });
  };

  const handleInteractionModeChange = (interactionMode: InteractionMode) => {
    void updateThread(thread.id, { interactionMode });
  };

  const handleStop = () => {
    void interruptTurn(thread.id);
  };

  return (
    <>
      <motion.div
        key={agent.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.11, ease: easeOut }}
        className="relative flex min-h-0 flex-1 flex-col"
      >
        {turns.length > 0 && (
          <ScrollRuler
            turns={turns}
            scrollRef={scrollRef}
            mountedStart={visibleStart}
            onEnsureTurnVisible={handleEnsureTurnVisible}
            onBeforeJump={unpin}
          />
        )}
        <div
          ref={scrollRef}
          className="flex flex-1 flex-col overflow-y-auto px-4 pt-8 pb-10 [scrollbar-gutter:stable_both-edges]"
        >
          <div className="mx-auto flex w-full max-w-composer flex-col">
            <header className="flex flex-col items-center pt-2 pb-7 text-center">
              <Identicon
                name={agent.name}
                style={agent.identiconStyle}
                size="xl"
                className="size-16 rounded-dialog"
              />
              <h2 className="mt-3 text-[1.4375rem] leading-tight font-semibold tracking-tight text-fg">
                {agent.name}
              </h2>
              <div className="mt-2 flex items-center justify-center gap-4 text-label">
                <button
                  type="button"
                  onClick={onViewAgent}
                  className="cursor-pointer font-medium text-input outline-none transition-colors hover:underline focus-visible:shadow-focus"
                >
                  View Agent
                </button>
                {turns.length === 0 && !isRunning && (
                  <button
                    type="button"
                    disabled={introTask.busy !== null}
                    onClick={() =>
                      void introTask.run(
                        "intro",
                        () => startAgentSetup(agent.id),
                        "Could not start introduction.",
                      )
                    }
                    className="inline-flex cursor-pointer items-center gap-1.5 text-fg-muted outline-none transition-colors hover:text-fg focus-visible:shadow-focus disabled:opacity-50"
                  >
                    {introTask.busy !== null && (
                      <DotSpinner variant="working" label="Starting introduction" />
                    )}
                    Introduce
                  </button>
                )}
              </div>
              {introTask.error !== null && (
                <p role="alert" className="mt-2 text-label text-danger">
                  {introTask.error}
                </p>
              )}
            </header>

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

            <AnimatePresence initial={false}>
              {needsPurpose && (
                <motion.div
                  key="waiting-prompt"
                  initial={{ opacity: 0, y: 4, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -4, height: 0 }}
                  transition={{ duration: 0.22, ease: easeOut }}
                  className="overflow-hidden"
                >
                  <div className="flex flex-wrap items-center justify-center gap-1.5 pt-8 text-center text-label text-fg-muted">
                    <DotSpinner variant="thinking" label="Waiting" className="text-fg-muted" />
                    <span>Waiting on</span>
                    <button
                      type="button"
                      onClick={focusComposer}
                      className="cursor-pointer text-input outline-none hover:underline focus-visible:shadow-focus"
                    >
                      you to tell {agent.name} its purpose and the first piece of work
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
          {submitError !== null && (
            <div className="rounded-control border border-danger/30 bg-danger/10 px-3 py-1.5 text-label text-danger">
              {submitError}
            </div>
          )}
          <div>
            <QueuedTurnsTray {...queue.tray} />
            <QuestionPromptPanel
              approval={pendingQuestion}
              returnFocusId={composerId}
              onRespond={(approvalId, input) => respondApproval(thread.id, approvalId, input)}
            />
            <Composer
              ref={composerRef}
              id={composerId}
              compact
              placeholder={`Message ${agent.name}, / for commands, @ for context`}
              providers={providers}
              modelSelection={thread.modelSelection}
              onModelSelectionChange={handleModelSelectionChange}
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
              running={isRunning}
              onSubmit={handleSubmit}
              onStop={handleStop}
            />
          </div>
        </div>
      </div>
      <RewindDialog {...rewind.dialog} />
    </>
  );
}
