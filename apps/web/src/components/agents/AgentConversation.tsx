import { describeApiError } from "@scuttle/client-runtime";
import type { Agent, ModelSelection, ThreadDetail } from "@scuttle/contracts";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { Composer, type ComposerSubmitPayload } from "@/components/home/Composer.tsx";
import { estimateContextUsage } from "@/components/home/contextUsage.ts";
import { useThreadLocationControls } from "@/components/home/useThreadLocationControls.ts";
import { ScrollRuler } from "@/components/thread/ScrollRuler.tsx";
import { ScrollToEndButton } from "@/components/thread/ScrollToEndButton.tsx";
import { ThreadTurnView } from "@/components/thread/ThreadTurnView.tsx";
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
    sendAgentTurn,
    startAgentSetup,
    updateAgent,
    updateThread,
    compactThread,
    interruptTurn,
    respondApproval,
  } = useWorkspaceActions();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [waitingDismissed, setWaitingDismissed] = useState(false);
  const introTask = useTask();
  const { thread, turns } = detail;
  const isRunning = thread.status.kind === "running" || thread.status.kind === "needs-input";
  const composerId = `composer-agent-${agent.id}`;
  const { isAtBottom, scrollToBottom } = useStickToBottom(scrollRef, turns, thread.id);
  const contextUsage = estimateContextUsage({
    turns,
    model: thread.modelSelection.model,
    ...(thread.lastUsage ? { lastUsage: thread.lastUsage } : {}),
    ...(thread.sessionEpoch !== undefined ? { sessionEpoch: thread.sessionEpoch } : {}),
    ...(thread.activeSummary ? { activeSummary: thread.activeSummary } : {}),
  });
  const status = useThreadLocationControls({
    thread,
    disabled: isRunning,
    onRuntimeUpdate: (runtime) => updateAgent(agent.id, { runtime }),
    onError: setSubmitError,
  });

  const needsPurpose = !isRunning && agent.purpose.trim().length === 0 && !waitingDismissed;

  const focusComposer = () => {
    document.getElementById(composerId)?.focus();
  };

  const handleSubmit = async (payload: ComposerSubmitPayload) => {
    setSubmitError(null);
    try {
      await sendAgentTurn(agent.id, {
        prompt: payload.prompt,
        modelSelection: payload.modelSelection,
        ...(payload.attachments.length > 0 ? { attachments: [...payload.attachments] } : {}),
      });
    } catch (error) {
      setSubmitError(describeApiError(error, "Failed to send message."));
    }
  };

  const handleCompact = async () => {
    if (compacting || isRunning) return;
    setSubmitError(null);
    setCompacting(true);
    try {
      await compactThread(thread.id);
    } catch (error) {
      setSubmitError(describeApiError(error, "Failed to compact thread."));
    } finally {
      setCompacting(false);
    }
  };

  const handleModelSelectionChange = async (modelSelection: ModelSelection) => {
    setSubmitError(null);
    try {
      await updateAgent(agent.id, { modelSelection });
    } catch (error) {
      setSubmitError(describeApiError(error, "Could not update model."));
    }
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
        {turns.length > 0 && <ScrollRuler turns={turns} scrollRef={scrollRef} />}
        <div
          ref={scrollRef}
          className="flex flex-1 flex-col overflow-y-auto px-4 pt-8 pb-10 sm:px-10"
        >
          <div className="mx-auto flex w-full max-w-composer flex-col">
            <header className="flex flex-col items-center pt-2 pb-7 text-center">
              <Identicon name={agent.name} size="xl" className="size-16 rounded-[14px]" />
              <h2 className="mt-3 text-[23px] leading-tight font-semibold tracking-tight text-fg">
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

            {turns.length > 0 && (
              <div className="flex flex-col gap-9">
                {turns.map((turn) => (
                  <ThreadTurnView
                    key={turn.id}
                    turn={turn}
                    onRespondApproval={(approvalId, input) =>
                      respondApproval(thread.id, approvalId, input)
                    }
                  />
                ))}
              </div>
            )}

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
                    <button
                      type="button"
                      onClick={() => setWaitingDismissed(true)}
                      className="ml-1.5 cursor-pointer text-fg-faint outline-none transition-colors hover:text-fg-muted focus-visible:shadow-focus"
                    >
                      Dismiss
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

      <div className="shrink-0 px-4 pt-0 pb-4">
        <div className="mx-auto w-full max-w-composer space-y-2">
          {submitError !== null && (
            <div className="rounded-control border border-danger/30 bg-danger/10 px-3 py-1.5 text-label text-danger">
              {submitError}
            </div>
          )}
          <Composer
            id={composerId}
            placeholder={
              isRunning
                ? `${agent.name} is working… press Esc to interrupt`
                : `Message ${agent.name}, / for commands, @ for context`
            }
            providers={providers}
            modelSelection={thread.modelSelection}
            onModelSelectionChange={(modelSelection) =>
              void handleModelSelectionChange(modelSelection)
            }
            interactionMode={thread.interactionMode}
            onInteractionModeChange={(interactionMode) =>
              void updateThread(thread.id, { interactionMode })
            }
            {...(compacting ? {} : { onCompact: () => void handleCompact() })}
            filesRoot={thread.cwd}
            status={status}
            contextUsage={contextUsage}
            running={isRunning}
            onSubmit={handleSubmit}
            onStop={() => void interruptTurn(thread.id)}
          />
        </div>
      </div>
    </>
  );
}
