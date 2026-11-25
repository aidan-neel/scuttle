import type { ThreadTurn } from "@scuttle/contracts";
import { type RefObject, useEffect } from "react";

const STICK_THRESHOLD_PX = 220;

export function useStickToBottom(
  scrollRef: RefObject<HTMLDivElement | null>,
  turns: ReadonlyArray<ThreadTurn>,
): void {
  const lastTurn = turns[turns.length - 1];
  const signature = `${turns.length}:${lastTurn?.assistantMessage.length ?? 0}:${lastTurn?.activities.length ?? 0}:${lastTurn?.approvals.length ?? 0}`;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < STICK_THRESHOLD_PX) {
      el.scrollTop = el.scrollHeight;
    }
  }, [signature]);
}
