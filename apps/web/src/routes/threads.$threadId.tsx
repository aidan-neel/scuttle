import { StopIcon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { ModelSelection, ThreadDetail } from "@scuttle/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ThreadGitPopover } from "@/components/git/ThreadGitPopover.tsx";
import { Composer, type ComposerSubmitPayload } from "@/components/home/Composer.tsx";
import { estimateContextUsage } from "@/components/home/contextUsage.ts";
import { useThreadLocationControls } from "@/components/home/useThreadLocationControls.ts";
import { ScrollRuler } from "@/components/thread/ScrollRuler.tsx";
import { ScrollToEndButton } from "@/components/thread/ScrollToEndButton.tsx";
import { ThreadTurnView } from "@/components/thread/ThreadTurnView.tsx";
import { useStickToBottom } from "@/components/thread/useStickToBottom.ts";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { easeOut } from "@/lib/motion.ts";
import { useWorkspace } from "@/lib/workspace.tsx";

export const Route = createFileRoute("/threads/$threadId")({
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const { threadDetails, loadThreadDetail } = useWorkspace();

  const detail = threadDetails[threadId];
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

function ThreadView({ detail }: { readonly detail: ThreadDetail }) {
  const { providers, sendTurn, interruptTurn, updateThread, compactThread, respondApproval } =
    useWorkspace();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { thread, turns } = detail;
  const { isAtBottom, scrollToBottom } = useStickToBottom(scrollRef, turns, thread.id);
  const isRunning = thread.status.kind === "running" || thread.status.kind === "needs-input";
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
    onRuntimeUpdate: (runtime) => updateThread(thread.id, { runtime }),
    onError: setSubmitError,
  });

  const handleModelSelectionChange = async (modelSelection: ModelSelection) => {
    setSubmitError(null);
    try {
      await updateThread(thread.id, { modelSelection });
    } catch (error) {
      setSubmitError(describeApiError(error, "Could not update model."));
    }
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
          <Button variant="destructive" size="sm" onClick={() => void interruptTurn(thread.id)}>
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
        <ScrollRuler turns={turns} scrollRef={scrollRef} />
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pt-8 pb-10">
          <div className="mx-auto flex w-full max-w-composer flex-col gap-9">
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
            {...(isRunning
              ? { placeholder: "Agent is working… press Esc or click Stop to interrupt" }
              : {})}
            providers={providers}
            modelSelection={thread.modelSelection}
            onModelSelectionChange={(modelSelection) =>
              void handleModelSelectionChange(modelSelection)
            }
            running={isRunning}
            onSubmit={handleSubmit}
            onStop={() => void interruptTurn(thread.id)}
            interactionMode={thread.interactionMode}
            onInteractionModeChange={(interactionMode) =>
              void updateThread(thread.id, { interactionMode })
            }
            {...(compacting ? {} : { onCompact: () => void handleCompact() })}
            filesRoot={thread.cwd}
            status={status}
            contextUsage={contextUsage}
          />
        </div>
      </div>
    </section>
  );
}
