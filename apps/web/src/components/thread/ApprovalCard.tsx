import { HelpCircleIcon } from "@hugeicons/core-free-icons";
import type { PendingApproval, RespondApprovalInput } from "@scuttle/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";

interface ApprovalCardProps {
  readonly approval: PendingApproval;
  readonly onRespond: (input: RespondApprovalInput) => Promise<void>;
}

export function ApprovalCard({ approval, onRespond }: ApprovalCardProps) {
  const [busy, setBusy] = useState(false);
  const [customText, setCustomText] = useState("");

  if (approval.status === "resolved") {
    return null;
  }

  const pick = async (optionId: string, custom?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await onRespond({
        optionId,
        ...(custom && custom.trim().length > 0 ? { customText: custom.trim() } : {}),
      });
    } finally {
      setBusy(false);
    }
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
            <pre className="overflow-x-auto rounded-control bg-chrome px-3 py-2 font-mono text-[12px] text-fg-secondary">
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
          {approval.kind === "question" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (customText.trim().length > 0) {
                  void pick(customText.trim(), customText.trim());
                }
              }}
              className="flex items-center gap-2 pt-1"
            >
              <input
                type="text"
                value={customText}
                onChange={(event) => setCustomText(event.target.value)}
                placeholder="Or type a custom reply..."
                className="h-8 flex-1 rounded-control bg-chrome px-3 text-label text-fg shadow-raised outline-none placeholder:text-fg-muted focus:shadow-focus"
              />
              <Button
                type="submit"
                variant="secondary"
                size="md"
                disabled={busy || customText.trim().length === 0}
              >
                Reply
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
