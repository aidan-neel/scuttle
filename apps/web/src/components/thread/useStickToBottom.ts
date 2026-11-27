import type { ThreadTurn } from "@scuttle/contracts";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

export const STICK_THRESHOLD_PX = 220;
export const AT_BOTTOM_PX = 32;
export const UNPIN_SUPPRESS_MS = 800;

export interface StickToBottom {
  readonly isAtBottom: boolean;
  readonly scrollToBottom: () => void;
  readonly unpin: () => void;
}

export interface PinTransitionInput {
  readonly currentlyPinned: boolean;
  readonly prevScrollTop: number;
  readonly scrollTop: number;
  readonly distanceFromBottom: number;
  readonly nowMs: number;
  readonly suppressPinUntilMs: number;
}

export const computeNextPinned = ({
  currentlyPinned,
  prevScrollTop,
  scrollTop,
  distanceFromBottom,
  nowMs,
  suppressPinUntilMs,
}: PinTransitionInput): boolean => {
  if (distanceFromBottom > STICK_THRESHOLD_PX) return false;
  if (nowMs < suppressPinUntilMs) return false;
  if (scrollTop < prevScrollTop) return false;
  if (currentlyPinned) return true;
  return scrollTop > prevScrollTop;
};

const distanceFromBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

export function useStickToBottom(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null> | undefined,
  turns: ReadonlyArray<ThreadTurn>,
  resetKey?: string,
): StickToBottom {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const pinnedRef = useRef(true);
  const prevScrollTopRef = useRef(0);
  const suppressPinUntilRef = useRef(0);
  const resizeRafRef = useRef<number | null>(null);
  const hasTurns = turns.length > 0;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = true;
    suppressPinUntilRef.current = 0;
    el.scrollTop = el.scrollHeight;
    prevScrollTopRef.current = el.scrollTop;
    setIsAtBottom(true);
  }, [resetKey, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = contentRef?.current ?? el.firstElementChild;
    if (!target) return;

    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current || resizeRafRef.current !== null) return;
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null;
        if (!pinnedRef.current) return;
        el.scrollTop = el.scrollHeight;
        prevScrollTopRef.current = el.scrollTop;
        setIsAtBottom(true);
      });
    });

    observer.observe(target);
    return () => {
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      observer.disconnect();
    };
  }, [contentRef, hasTurns, resetKey, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let rafId: number | null = null;
    const measureAtBottom = () => {
      const nextAtBottom = distanceFromBottom(el) <= AT_BOTTOM_PX;
      setIsAtBottom((prev) => (prev === nextAtBottom ? prev : nextAtBottom));
    };

    const onScroll = () => {
      const scrollTop = el.scrollTop;
      const dist = distanceFromBottom(el);
      pinnedRef.current = computeNextPinned({
        currentlyPinned: pinnedRef.current,
        prevScrollTop: prevScrollTopRef.current,
        scrollTop,
        distanceFromBottom: dist,
        nowMs: performance.now(),
        suppressPinUntilMs: suppressPinUntilRef.current,
      });
      prevScrollTopRef.current = scrollTop;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        measureAtBottom();
      });
    };

    prevScrollTopRef.current = el.scrollTop;
    measureAtBottom();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      el.removeEventListener("scroll", onScroll);
    };
  }, [hasTurns, resetKey, scrollRef]);

  const unpin = () => {
    pinnedRef.current = false;
    suppressPinUntilRef.current = performance.now() + UNPIN_SUPPRESS_MS;
    if (resizeRafRef.current !== null) {
      cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = null;
    }
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = true;
    suppressPinUntilRef.current = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  };

  return { isAtBottom, scrollToBottom, unpin };
}
