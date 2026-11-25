import type { RespondApprovalInput, ThreadTurn } from "@scuttle/contracts";
import { motion } from "motion/react";
import { easeOut } from "@/lib/motion.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { MarkdownView } from "./MarkdownView.tsx";
import { WorkProgress } from "./WorkProgress.tsx";

interface ThreadTurnViewProps {
  readonly turn: ThreadTurn;
  readonly onRespondApproval: (approvalId: string, input: RespondApprovalInput) => Promise<void>;
}

export function ThreadTurnView({ turn, onRespondApproval }: ThreadTurnViewProps) {
  const pendingApprovals = turn.approvals.filter((a) => a.status === "pending");

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: easeOut }}
      className="space-y-2"
    >
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-[14px] bg-raised px-4 py-2.5 text-[14px] leading-[1.55] text-fg shadow-raised whitespace-pre-wrap break-words">
          {turn.userMessage}
        </div>
      </div>

      <WorkProgress turn={turn} />

      {pendingApprovals.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          onRespond={(input) => onRespondApproval(approval.id, input)}
        />
      ))}

      {turn.assistantMessage.trim().length > 0 && (
        <div className="pt-1">
          <MarkdownView content={turn.assistantMessage} />
        </div>
      )}

      {turn.status === "failed" && turn.error && (
        <div className="mt-3 rounded-card border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-label text-danger">
          {turn.error}
        </div>
      )}
    </motion.article>
  );
}
