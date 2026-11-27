import { HelpCircleIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { PendingApproval } from "@scuttle/contracts";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";
import { formatResolvedSummary, type ResolvedQuestionItem } from "./questionModel.ts";

function AnswerRow({
  item,
  skipped,
}: {
  readonly item: ResolvedQuestionItem;
  readonly skipped: boolean;
}) {
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <span title={item.question} className="max-w-full min-w-0 truncate text-label text-fg-muted">
        {item.header !== null && (
          <span className="font-medium text-fg-secondary">{item.header} · </span>
        )}
        {item.question}
      </span>
      {item.answers.length > 0 ? (
        <span className="flex min-w-0 flex-wrap gap-1">
          {item.answers.map((answer) => (
            <span
              key={answer.text}
              className={cn(
                "max-w-full truncate rounded-chip px-1.5 py-px text-label",
                answer.custom ? "bg-fg/5 text-fg-secondary italic" : "bg-fg/7 text-fg",
              )}
            >
              {answer.text}
            </span>
          ))}
        </span>
      ) : (
        <span className="text-label text-fg-faint">
          {skipped ? "Skipped" : "No answer recorded"}
        </span>
      )}
    </li>
  );
}

export function ResolvedQuestionCard({ approval }: { readonly approval: PendingApproval }) {
  const summary = formatResolvedSummary(approval);
  const skipped = summary.kind === "skipped";
  const count = summary.items.length;
  return (
    <section
      aria-label={skipped ? "Skipped question" : "Answered question"}
      className="my-3 rounded-card px-3 py-2 ring-1 ring-edge ring-inset"
    >
      <header className="flex items-center gap-1.5 text-meta text-fg-muted">
        <Icon
          icon={skipped ? HelpCircleIcon : Tick02Icon}
          className={cn("size-3.5", skipped ? "text-fg-faint" : "text-success")}
        />
        <span className="font-medium text-fg-secondary">{skipped ? "Skipped" : "Answered"}</span>
        {count > 1 && <span className="tabular-nums">· {count} questions</span>}
      </header>
      {count > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {summary.items.map((item) => (
            <AnswerRow key={item.id} item={item} skipped={skipped} />
          ))}
        </ul>
      )}
    </section>
  );
}
