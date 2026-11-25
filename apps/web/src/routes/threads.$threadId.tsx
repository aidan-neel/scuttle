import {
  ComputerIcon,
  Delete02Icon,
  GitBranchIcon,
  StopIcon,
  Tick02Icon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import type { ModelSelection } from "@scuttle/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Composer, type ComposerSubmitPayload } from "@/components/home/Composer.tsx";
import { ScrollRuler } from "@/components/thread/ScrollRuler.tsx";
import { ThreadTurnView } from "@/components/thread/ThreadTurnView.tsx";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
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
    settleThread,
    updateThread,
    deleteThread,
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
  const isSettled = Boolean(thread.settledAt);

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

  const handleDelete = async () => {
    await deleteThread(thread.id);
    await navigate({ to: "/" });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <Identicon name={thread.projectName} size="sm" />
        <span className="shrink-0 text-label font-medium text-fg-secondary">
          {thread.projectName}
        </span>
        <span className="text-fg-faint">/</span>
        <h1 className="min-w-0 flex-1 truncate text-body font-medium text-fg">{thread.title}</h1>
        <span className="hidden items-center gap-1 rounded-chip bg-white/5 px-2 py-0.5 font-mono text-meta text-fg-muted sm:inline-flex">
          <Icon
            icon={thread.runtime === "local" ? ComputerIcon : GitBranchIcon}
            className="size-3"
          />
          {thread.branch}
        </span>
        <span className="hidden items-center gap-1.5 rounded-chip bg-white/5 px-2 py-0.5 text-meta text-fg-muted md:inline-flex">
          <BrandLogo brand={thread.modelSelection.providerKind} className="size-3" />
          <span className="max-w-36 truncate">{thread.modelSelection.model}</span>
        </span>
        {isRunning && (
          <Button variant="destructive" size="sm" onClick={() => void interruptTurn(thread.id)}>
            <Icon icon={StopIcon} />
            Stop
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => void settleThread(thread.id, !isSettled)}>
          <Icon icon={isSettled ? Undo02Icon : Tick02Icon} />
          {isSettled ? "Unsettle" : "Settle"}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete thread"
          onClick={() => void handleDelete()}
        >
          <Icon icon={Delete02Icon} />
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <ScrollRuler />
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8 sm:pl-10">
          <div className="mx-auto flex w-full max-w-[740px] flex-col gap-9">
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
