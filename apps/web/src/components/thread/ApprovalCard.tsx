import { HelpCircleIcon } from "@hugeicons/core-free-icons";
import type { PendingApproval, RespondApprovalInput } from "@scuttle/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { isQuestionApproval } from "./questionModel.ts";
import { ResolvedQuestionCard } from "./ResolvedQuestionCard.tsx";

interface ApprovalCardProps {
  readonly approval: PendingApproval;
  readonly onRespond: (input: RespondApprovalInput) => Promise<void>;
}

export function ApprovalCard({ approval, onRespond }: ApprovalCardProps) {
  if (isQuestionApproval(approval)) {
    return approval.status === "resolved" ? <ResolvedQuestionCard approval={approval} /> : null;
  }
  if (approval.status === "resolved") return null;
  return <PermissionCard approval={approval} onRespond={onRespond} />;
}

function PermissionCard({ approval, onRespond }: ApprovalCardProps) {
  const [busy, setBusy] = useState(false);

  const pick = (optionId: string) => {
    if (busy) return;
    setBusy(true);
    void onRespond({ optionId }).finally(() => {
      setBusy(false);
    });
  };

  return (
    <div className="my-4 rounded-card bg-panel p-4 shadow-raised">
      <div className="flex items-start gap-2.5">
        <Icon icon={HelpCircleIcon} className="mt-0.5 size-4 shrink-0 text-input" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-body font-medium text-fg">{approval.title}</div>
          {approval.description && (
            <p className="text-label text-fg-secondary">{approval.description}</p>
          )}
          {approval.command && (
            <pre className="overflow-x-auto rounded-control bg-chrome px-3 py-2 font-mono text-[0.8125rem] text-fg-secondary">
              {approval.command}
            </pre>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {approval.options.map((option, idx) => (
              <Button
                key={option.id}
                variant={
                  option.id === "decline" || option.id.startsWith("reject")
                    ? "destructive"
                    : idx === 0
                      ? "primary"
                      : "secondary"
                }
                size="md"
                disabled={busy}
                onClick={() => void pick(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
