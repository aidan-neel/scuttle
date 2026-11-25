import type { ThreadTurn } from "@scuttle/contracts";
import { type RefObject, useEffect, useState } from "react";

const STICK_THRESHOLD_PX = 220;
const AT_BOTTOM_PX = 32;

export interface StickToBottom {
  readonly isAtBottom: boolean;
  readonly scrollToBottom: () => void;
}

const distanceFromBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

export function useStickToBottom(
  scrollRef: RefObject<HTMLDivElement | null>,
  turns: ReadonlyArray<ThreadTurn>,
): StickToBottom {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const lastTurn = turns[turns.length - 1];
  const signature = `${turns.length}:${lastTurn?.assistantMessage.length ?? 0}:${lastTurn?.activities.length ?? 0}:${lastTurn?.approvals.length ?? 0}`;
  const hasTurns = turns.length > 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (distanceFromBottom(el) < STICK_THRESHOLD_PX) {
      el.scrollTop = el.scrollHeight;
    }
    setIsAtBottom(distanceFromBottom(el) <= AT_BOTTOM_PX);
  }, [signature]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setIsAtBottom(distanceFromBottom(el) <= AT_BOTTOM_PX);
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [hasTurns]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  };

  return { isAtBottom, scrollToBottom };
}
