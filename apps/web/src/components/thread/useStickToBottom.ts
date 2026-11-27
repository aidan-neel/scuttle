import type { ThreadTurn } from "@scuttle/contracts";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

const STICK_THRESHOLD_PX = 220;
const AT_BOTTOM_PX = 32;

export interface StickToBottom {
  readonly isAtBottom: boolean;
  readonly scrollToBottom: () => void;
}

const distanceFromBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

export function useStickToBottom(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null> | undefined,
  turns: ReadonlyArray<ThreadTurn>,
  resetKey?: string,
): StickToBottom {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const pinnedRef = useRef(true);
  const hasTurns = turns.length > 0;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = true;
    el.scrollTop = el.scrollHeight;
    setIsAtBottom(true);
  }, [resetKey, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = contentRef?.current ?? el.firstElementChild;
    if (!target) return;

    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current || rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!pinnedRef.current) return;
        el.scrollTop = el.scrollHeight;
        setIsAtBottom(true);
      });
    });

    observer.observe(target);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [contentRef, hasTurns, resetKey, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let rafId: number | null = null;
    const measure = () => {
      const dist = distanceFromBottom(el);
      pinnedRef.current = dist <= STICK_THRESHOLD_PX;
      const nextAtBottom = dist <= AT_BOTTOM_PX;
      setIsAtBottom((prev) => (prev === nextAtBottom ? prev : nextAtBottom));
    };

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        measure();
      });
    };

    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      el.removeEventListener("scroll", onScroll);
    };
  }, [hasTurns, resetKey, scrollRef]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = true;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  };

  return { isAtBottom, scrollToBottom };
}
