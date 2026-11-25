import { AiMagicIcon, RefreshIcon, Task01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { describeApiError } from "@scuttle/client-runtime";
import type { Agent, ThreadDetail } from "@scuttle/contracts";
import { useRef, useState } from "react";
import { Composer, type ComposerSubmitPayload } from "@/components/home/Composer.tsx";
import { ScrollRuler } from "@/components/thread/ScrollRuler.tsx";
import { ThreadTurnView } from "@/components/thread/ThreadTurnView.tsx";
import { useStickToBottom } from "@/components/thread/useStickToBottom.ts";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";
import { useTask } from "./useTask.ts";

export type QuickAction = "checkin" | "sync" | "delegate";

interface AgentConversationProps {
  readonly agent: Agent;
  readonly detail: ThreadDetail;
  readonly onQuickAction: (action: QuickAction) => void;
}

const QUICK_ACTIONS: ReadonlyArray<{
  readonly action: QuickAction;
  readonly label: string;
  readonly icon: IconSvgElement;
}> = [
  { action: "checkin", label: "Run check-in", icon: RefreshIcon },
  { action: "sync", label: "Sync issues", icon: Task01Icon },
  { action: "delegate", label: "Delegate a task", icon: UserGroupIcon },
];

function EmptyState({
  agent,
  onQuickAction,
}: {
  readonly agent: Agent;
  readonly onQuickAction: (action: QuickAction) => void;
}) {
  const { startAgentSetup } = useWorkspace();
  const task = useTask();
  const purpose =
    agent.purpose.trim().length > 0
      ? agent.purpose
      : `Tell ${agent.name} its purpose and the first piece of work.`;

  return (
    <div className="mx-auto flex w-full max-w-composer flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
      <Identicon name={agent.name} size="xl" />
      <div className="flex max-w-md flex-col gap-1">
        <h2 className="text-title font-semibold text-fg">{agent.name}</h2>
        <p className="text-label leading-[1.55] text-fg-muted">{purpose}</p>
      </div>
      <Button
        variant="primary"
        size="lg"
        disabled={task.busy !== null}
        onClick={() =>
          void task.run("setup", () => startAgentSetup(agent.id), "Could not start setup.")
        }
      >
        {task.busy === "setup" ? (
          <DotSpinner variant="working" label="Starting setup" />
        ) : (
          <Icon icon={AiMagicIcon} />
        )}
        Ask {agent.name} to set up
      </Button>
      {task.error !== null && <p className="text-label text-danger">{task.error}</p>}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {QUICK_ACTIONS.map((item) => (
          <Button
            key={item.action}
            variant="outline"
            size="sm"
            onClick={() => onQuickAction(item.action)}
          >
            <Icon icon={item.icon} className="text-fg-muted" />
            {item.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function AgentConversation({ agent, detail, onQuickAction }: AgentConversationProps) {
  const { providers, sendAgentTurn, updateAgent, interruptTurn, respondApproval } = useWorkspace();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { thread, turns } = detail;
  const isRunning = thread.status.kind === "running" || thread.status.kind === "needs-input";
  useStickToBottom(scrollRef, turns);

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
        <div ref={scrollRef} className="flex flex-1 flex-col overflow-y-auto px-4 py-8">
          {turns.length === 0 ? (
            <EmptyState agent={agent} onQuickAction={onQuickAction} />
          ) : (
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
          )}
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
            id={`composer-agent-${agent.id}`}
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
