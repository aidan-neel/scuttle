import { StopIcon } from "@hugeicons/core-free-icons";
import type { ModelSelection } from "@scuttle/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Composer, type ComposerSubmitPayload } from "@/components/home/Composer.tsx";
import { ScrollRuler } from "@/components/thread/ScrollRuler.tsx";
import { ThreadTurnView } from "@/components/thread/ThreadTurnView.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";

export const Route = createFileRoute("/threads/$threadId")({
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const {
    providers,
    threadDetails,
    loadThreadDetail,
    sendTurn,
    interruptTurn,
    updateThread,
    respondApproval,
  } = useWorkspace();

  const detail = threadDetails[threadId];
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  const turns = detail?.turns ?? [];
  const lastTurn = turns[turns.length - 1];
  const scrollSignature = `${turns.length}:${lastTurn?.assistantMessage.length ?? 0}:${lastTurn?.activities.length ?? 0}:${lastTurn?.approvals.length ?? 0}`;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 220) {
      el.scrollTop = el.scrollHeight;
    }
  }, [scrollSignature]);

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

  const { thread } = detail;
  const isRunning = thread.status.kind === "running" || thread.status.kind === "needs-input";

  const handleModelChange = (modelSelection: ModelSelection) => {
    void updateThread(thread.id, { modelSelection });
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
      setSubmitError(error instanceof Error ? error.message : "Failed to send message.");
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
        {isRunning && (
          <Button variant="destructive" size="sm" onClick={() => void interruptTurn(thread.id)}>
            <Icon icon={StopIcon} />
            Stop
          </Button>
        )}
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <ScrollRuler turns={turns} scrollRef={scrollRef} />
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-8">
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
      </div>

      <div className="shrink-0 px-4 pt-2 pb-4">
        <div className="mx-auto w-full max-w-composer space-y-2">
          {submitError && (
            <div className="rounded-control border border-danger/30 bg-danger/10 px-3 py-1.5 text-label text-danger">
              {submitError}
            </div>
          )}
          <Composer
            id={`composer-${thread.id}`}
            placeholder={
              isRunning
                ? "Agent is working… press Esc or click Stop to interrupt"
                : "Reply to thread"
            }
            providers={providers}
            modelSelection={thread.modelSelection}
            onModelSelectionChange={handleModelChange}
            running={isRunning}
            onSubmit={handleSubmit}
            onStop={() => void interruptTurn(thread.id)}
          />
        </div>
      </div>
    </section>
  );
}
