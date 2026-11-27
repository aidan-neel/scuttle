import type { ThreadTurn } from "@scuttle/contracts";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

export const STICK_THRESHOLD_PX = 220;
export const AT_BOTTOM_PX = 32;
export const UNPIN_SUPPRESS_MS = 800;
export const SCROLL_VERTICAL_PADDING_PX = 60;

export interface StickToBottom {
  readonly isAtBottom: boolean;
  readonly scrollToBottom: () => void;
  readonly unpin: () => void;
  readonly anchoredTurnId: string | null;
  readonly anchoredTurnMinHeightPx: number;
}

export const computeAnchoredTurnMinHeight = (
  viewportHeight: number,
  verticalPaddingPx: number = SCROLL_VERTICAL_PADDING_PX,
): number => Math.max(0, Math.floor(viewportHeight - verticalPaddingPx));

export const isAnchorableTurn = (turn: Pick<ThreadTurn, "origin"> | undefined): boolean =>
  turn !== undefined && turn.origin !== "system";

export interface PinTransitionInput {
  readonly currentlyPinned: boolean;
  readonly prevScrollTop: number;
  readonly prevDistanceFromBottom: number;
  readonly scrollTop: number;
  readonly distanceFromBottom: number;
  readonly nowMs: number;
  readonly suppressPinUntilMs: number;
}

export const computeNextPinned = ({
  currentlyPinned,
  prevScrollTop,
  prevDistanceFromBottom,
  scrollTop,
  distanceFromBottom,
  nowMs,
  suppressPinUntilMs,
}: PinTransitionInput): boolean => {
  if (distanceFromBottom > STICK_THRESHOLD_PX) return false;
  if (nowMs < suppressPinUntilMs) return false;
  if (scrollTop < prevScrollTop && distanceFromBottom > prevDistanceFromBottom) return false;
  if (currentlyPinned) return true;
  return scrollTop > prevScrollTop;
};

const distanceFromBottom = (el: HTMLElement) =>
  Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);

export function useStickToBottom(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null> | undefined,
  turns: ReadonlyArray<ThreadTurn>,
  resetKey?: string,
): StickToBottom {
  const lastTurn = turns.at(-1);
  const lastTurnId = lastTurn?.id ?? null;
  const lastTurnAnchorable = isAnchorableTurn(lastTurn);
  const lastTurnRunning = lastTurnAnchorable && lastTurn?.status === "running";

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [anchor, setAnchor] = useState<{
    readonly key: string | undefined;
    readonly turnId: string | null;
  }>(() => ({
    key: resetKey,
    turnId: lastTurnRunning ? lastTurnId : null,
  }));

  const pinnedRef = useRef(true);
  const autoScrollingRef = useRef(false);
  const prevScrollTopRef = useRef(0);
  const prevDistanceRef = useRef(0);
  const suppressPinUntilRef = useRef(0);
  const resizeRafRef = useRef<number | null>(null);
  const prevTrackRef = useRef<{
    readonly key: string | undefined;
    readonly lastTurnId: string | null;
    readonly count: number;
  }>({ key: resetKey, lastTurnId, count: turns.length });
  const hasTurns = turns.length > 0;

  const anchoredTurnId =
    anchor.key === resetKey ? anchor.turnId : lastTurnRunning ? lastTurnId : null;
  const anchoredTurnMinHeightPx =
    anchoredTurnId !== null ? computeAnchoredTurnMinHeight(viewportHeight) : 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const syncHeight = () => {
      const next = el.clientHeight;
      setViewportHeight((prev) => (prev === next ? prev : next));
    };
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [resetKey, scrollRef]);

  useLayoutEffect(() => {
    const prev = prevTrackRef.current;
    const sameThread = prev.key === resetKey;
    const appendedTurn =
      sameThread &&
      lastTurnId !== null &&
      lastTurnId !== prev.lastTurnId &&
      turns.length > prev.count;
    prevTrackRef.current = { key: resetKey, lastTurnId, count: turns.length };

    if (!sameThread) {
      setAnchor({ key: resetKey, turnId: lastTurnRunning ? lastTurnId : null });
      return;
    }

    if (appendedTurn && lastTurnAnchorable) {
      setAnchor({ key: resetKey, turnId: lastTurnId });
      pinnedRef.current = true;
      autoScrollingRef.current = true;
      suppressPinUntilRef.current = 0;
    }
  }, [lastTurnAnchorable, lastTurnId, lastTurnRunning, resetKey, turns.length]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || anchoredTurnId === null || !autoScrollingRef.current) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
    prevScrollTopRef.current = el.scrollTop;
    prevDistanceRef.current = distanceFromBottom(el);
    setIsAtBottom(true);
  }, [anchoredTurnId, anchoredTurnMinHeightPx, scrollRef]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = true;
    autoScrollingRef.current = false;
    suppressPinUntilRef.current = 0;
    el.scrollTop = el.scrollHeight;
    prevScrollTopRef.current = el.scrollTop;
    prevDistanceRef.current = distanceFromBottom(el);
    setIsAtBottom(true);
  }, [resetKey, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = contentRef?.current ?? el.firstElementChild;
    if (!target) return;

    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current || autoScrollingRef.current || resizeRafRef.current !== null) return;
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null;
        if (!pinnedRef.current || autoScrollingRef.current) return;
        el.scrollTop = el.scrollHeight;
        prevScrollTopRef.current = el.scrollTop;
        prevDistanceRef.current = distanceFromBottom(el);
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
      if (autoScrollingRef.current) {
        if (scrollTop < prevScrollTopRef.current && dist > prevDistanceRef.current) {
          autoScrollingRef.current = false;
          pinnedRef.current = false;
        } else if (dist <= AT_BOTTOM_PX) {
          autoScrollingRef.current = false;
          pinnedRef.current = true;
        } else {
          pinnedRef.current = true;
        }
      } else {
        pinnedRef.current = computeNextPinned({
          currentlyPinned: pinnedRef.current,
          prevScrollTop: prevScrollTopRef.current,
          prevDistanceFromBottom: prevDistanceRef.current,
          scrollTop,
          distanceFromBottom: dist,
          nowMs: performance.now(),
          suppressPinUntilMs: suppressPinUntilRef.current,
        });
      }
      prevScrollTopRef.current = scrollTop;
      prevDistanceRef.current = dist;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        measureAtBottom();
      });
    };

    prevScrollTopRef.current = el.scrollTop;
    prevDistanceRef.current = distanceFromBottom(el);
    measureAtBottom();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      el.removeEventListener("scroll", onScroll);
    };
  }, [hasTurns, resetKey, scrollRef]);

  const unpin = () => {
    autoScrollingRef.current = false;
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
    autoScrollingRef.current = true;
    suppressPinUntilRef.current = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  };

  return { isAtBottom, scrollToBottom, unpin, anchoredTurnId, anchoredTurnMinHeightPx };
}
