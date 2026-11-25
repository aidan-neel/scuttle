import { describeApiError } from "@scuttle/client-runtime";
import type { Agent, ThreadDetail } from "@scuttle/contracts";
import { useRef, useState } from "react";
import { Composer, type ComposerSubmitPayload } from "@/components/home/Composer.tsx";
import { ScrollRuler } from "@/components/thread/ScrollRuler.tsx";
import { ThreadTurnView } from "@/components/thread/ThreadTurnView.tsx";
import { useStickToBottom } from "@/components/thread/useStickToBottom.ts";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";
import { useTask } from "./useTask.ts";

interface AgentConversationProps {
  readonly agent: Agent;
  readonly detail: ThreadDetail;
  readonly onViewAgent: () => void;
}

function WaitingGlyph() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 12 12"
      className="size-3 shrink-0 text-fg-faint"
    >
      {[2, 6, 10].map((cy) =>
        [2, 6, 10].map((cx) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1" fill="currentColor" />
        )),
      )}
    </svg>
  );
}

export function AgentConversation({ agent, detail, onViewAgent }: AgentConversationProps) {
  const { providers, sendAgentTurn, startAgentSetup, updateAgent, interruptTurn, respondApproval } =
    useWorkspace();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [waitingDismissed, setWaitingDismissed] = useState(false);
  const introTask = useTask();
  const { thread, turns } = detail;
  const isRunning = thread.status.kind === "running" || thread.status.kind === "needs-input";
  const composerId = `composer-agent-${agent.id}`;
  useStickToBottom(scrollRef, turns);

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

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {turns.length > 0 && <ScrollRuler turns={turns} scrollRef={scrollRef} />}
        <div ref={scrollRef} className="flex flex-1 flex-col overflow-y-auto px-4 py-8 sm:px-10">
          <div className="mx-auto flex w-full max-w-composer flex-col">
            <header className="flex flex-col items-center pt-2 pb-7 text-center">
              <Identicon name={agent.name} size="xl" className="size-16 rounded-[14px]" />
              <h2 className="mt-3 text-[22px] leading-tight font-semibold tracking-tight text-fg">
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

            {needsPurpose && (
              <div className="mt-8 flex flex-wrap items-center justify-center gap-1.5 text-center text-label text-fg-muted">
                <WaitingGlyph />
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
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-4 pt-2 pb-4">
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
                : `Message ${agent.name}`
            }
            providers={providers}
            modelSelection={thread.modelSelection}
            onModelSelectionChange={(modelSelection) =>
              void updateAgent(agent.id, { modelSelection })
            }
            running={isRunning}
            onSubmit={handleSubmit}
            onStop={() => void interruptTurn(thread.id)}
          />
        </div>
      </div>
    </>
  );
}
