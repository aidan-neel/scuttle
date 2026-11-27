import type { RespondApprovalInput, ThreadTurn } from "@scuttle/contracts";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { ThreadTurnView } from "./ThreadTurnView.tsx";

export const INITIAL_VISIBLE_TURNS = 24;
export const LOAD_EARLIER_BATCH = 24;

export function computeInitialVisibleStart(total: number, windowSize: number): number {
  if (total <= 0) return 0;
  return Math.max(0, total - Math.max(0, windowSize));
}

export function expandVisibleStart(currentStart: number, batchSize: number): number {
  if (currentStart <= 0) return 0;
  return Math.max(0, currentStart - Math.max(0, batchSize));
}

interface ThreadTurnListProps {
  readonly turns: ReadonlyArray<ThreadTurn>;
  readonly threadId: string;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly contentRef?: RefObject<HTMLDivElement | null>;
  readonly visibleStart: number;
  readonly onLoadEarlier: () => void;
  readonly onRespondApproval: (
    threadId: string,
    approvalId: string,
    input: RespondApprovalInput,
  ) => Promise<void>;
}

export function ThreadTurnList({
  turns,
  threadId,
  scrollRef,
  contentRef,
  visibleStart,
  onLoadEarlier,
  onRespondApproval,
}: ThreadTurnListProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollHeightRef = useRef<number | null>(null);
  const prevThreadIdRef = useRef(threadId);
  const prevVisibleStartRef = useRef(visibleStart);
  const onLoadEarlierRef = useRef(onLoadEarlier);

  useLayoutEffect(() => {
    onLoadEarlierRef.current = onLoadEarlier;
  });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const sameThread = prevThreadIdRef.current === threadId;
    const expandedUpward = sameThread && visibleStart < prevVisibleStartRef.current;
    const prevHeight = pendingScrollHeightRef.current;
    pendingScrollHeightRef.current = null;
    prevThreadIdRef.current = threadId;
    prevVisibleStartRef.current = visibleStart;

    if (el && expandedUpward && prevHeight !== null && el.scrollTop > 0) {
      const delta = el.scrollHeight - prevHeight;
      if (delta > 0) {
        el.scrollTop += delta;
      }
    }
  }, [scrollRef, threadId, visibleStart]);

  useEffect(() => {
    if (visibleStart <= 0) return;
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            pendingScrollHeightRef.current = root.scrollHeight;
            onLoadEarlierRef.current();
            break;
          }
        }
      },
      { root, rootMargin: "400px 0px 0px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollRef, visibleStart]);

  const handleLoadEarlierClick = () => {
    const el = scrollRef.current;
    if (el) {
      pendingScrollHeightRef.current = el.scrollHeight;
    }
    onLoadEarlier();
  };

  if (turns.length === 0) return null;

  const visibleTurns = visibleStart > 0 ? turns.slice(visibleStart) : turns;

  return (
    <div ref={contentRef} className="flex flex-col gap-9">
      {visibleStart > 0 && (
        <div ref={sentinelRef} className="flex justify-center pb-1">
          <button
            type="button"
            onClick={handleLoadEarlierClick}
            className="cursor-pointer rounded-chip border border-line bg-surface px-3 py-1 text-label text-fg-muted outline-none transition-colors hover:border-line-strong hover:text-fg focus-visible:shadow-focus"
          >
            Show earlier messages ({visibleStart} more)
          </button>
        </div>
      )}
      {visibleTurns.map((turn) => (
        <ThreadTurnView key={turn.id} turn={turn} onRespondApproval={onRespondApproval} />
      ))}
    </div>
  );
}
