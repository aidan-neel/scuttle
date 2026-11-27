import type { RespondApprovalInput, ThreadTurn } from "@scuttle/contracts";
import { memo } from "react";
import { formatClockTime } from "@/lib/format.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { MarkdownView } from "./MarkdownView.tsx";
import { WorkProgress } from "./WorkProgress.tsx";

interface ThreadTurnViewProps {
  readonly turn: ThreadTurn;
  readonly onRespondApproval: (
    threadId: string,
    approvalId: string,
    input: RespondApprovalInput,
  ) => Promise<void>;
}

export const ThreadTurnView = memo(function ThreadTurnView({
  turn,
  onRespondApproval,
}: ThreadTurnViewProps) {
  const pendingApprovals = turn.approvals.filter((a) => a.status === "pending");
  const streaming = turn.status === "running";
  const isSystem = turn.origin === "system";
  const clockTime = isSystem ? formatClockTime(turn.startedAt) : "";

  return (
    <article
      data-turn-id={turn.id}
      className={
        streaming
          ? "scroll-mt-6 space-y-3"
          : "scroll-mt-6 space-y-3 [content-visibility:auto] [contain-intrinsic-size:auto_320px]"
      }
    >
      {isSystem ? (
        clockTime.length > 0 && (
          <p className="text-center text-meta text-fg-faint tabular-nums">{clockTime}</p>
        )
      ) : (
        <div className="flex justify-end">
          <div className="max-w-[78%] rounded-[14px] bg-raised px-4 py-2.5 text-[15px] leading-[1.55] text-fg shadow-raised whitespace-pre-wrap break-words">
            {turn.userMessage}
          </div>
        </div>
      )}

      <WorkProgress turn={turn} />

      {pendingApprovals.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          onRespond={(input) => onRespondApproval(turn.threadId, approval.id, input)}
        />
      ))}

      {turn.assistantMessage.trim().length > 0 && (
        <div className="pt-1">
          <MarkdownView content={turn.assistantMessage} streaming={streaming} />
        </div>
      )}

      {turn.status === "failed" && turn.error && (
        <div className="mt-3 rounded-card border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-label text-danger">
          {turn.error}
        </div>
      )}
    </article>
  );
});
