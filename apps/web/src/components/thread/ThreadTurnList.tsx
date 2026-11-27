import type {
  RespondApprovalInput,
  ThreadCheckpoint,
  ThreadTurn,
  ThreadVisualization,
} from "@scuttle/contracts";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { ScuttleVizCard } from "@/components/viz/index.ts";
import { rewindTargetFor } from "@/lib/threadDetailReducer.ts";
import { ThreadTurnView } from "./ThreadTurnView.tsx";

export const INITIAL_VISIBLE_TURNS = 24;
export const LOAD_EARLIER_BATCH = 24;

export function computeInitialVisibleStart(total: number, windowSize: number): number {
  if (total <= 0) return 0;
  return Math.max(0, total - Math.max(0, windowSize));
}

const NO_VISUALIZATIONS: ReadonlyArray<ThreadVisualization> = [];

export const groupVisualizationsByTurn = (
  visualizations: ReadonlyArray<ThreadVisualization>,
): ReadonlyMap<string, ReadonlyArray<ThreadVisualization>> => {
  const byTurn = new Map<string, Array<ThreadVisualization>>();
  for (const viz of visualizations) {
    if (viz.turnId === undefined) continue;
    const list = byTurn.get(viz.turnId) ?? [];
    list.push(viz);
    byTurn.set(viz.turnId, list);
  }
  return byTurn;
};

export const unlinkedVisualizations = (
  turns: ReadonlyArray<ThreadTurn>,
  visualizations: ReadonlyArray<ThreadVisualization>,
): ReadonlyArray<ThreadVisualization> => {
  if (visualizations.length === 0) return NO_VISUALIZATIONS;
  const turnIds = new Set<string>(turns.map((turn) => turn.id));
  return visualizations.filter((viz) => viz.turnId === undefined || !turnIds.has(viz.turnId));
};

export const rewindableTurnIds = (
  turns: ReadonlyArray<ThreadTurn>,
  checkpoints: ReadonlyArray<ThreadCheckpoint>,
): ReadonlySet<string> => {
  const ids = new Set<string>();
  turns.forEach((turn, index) => {
    if (turn.origin !== "system" && rewindTargetFor(turns, checkpoints, index) !== undefined) {
      ids.add(turn.id);
    }
  });
  return ids;
};

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
  readonly anchoredTurnId?: string | null;
  readonly anchoredTurnMinHeightPx?: number;
  readonly onLoadEarlier: () => void;
  readonly checkpoints?: ReadonlyArray<ThreadCheckpoint> | undefined;
  readonly visualizations?: ReadonlyArray<ThreadVisualization> | undefined;
  readonly onRewind?: ((turnId: string) => void) | undefined;
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
  anchoredTurnId = null,
  anchoredTurnMinHeightPx = 0,
  onLoadEarlier,
  checkpoints = [],
  visualizations = NO_VISUALIZATIONS,
  onRewind,
  onRespondApproval,
}: ThreadTurnListProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pendingAnchorRef = useRef<{ readonly height: number; readonly top: number } | null>(null);
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
    const pending = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    prevThreadIdRef.current = threadId;
    prevVisibleStartRef.current = visibleStart;

    if (el && expandedUpward && pending !== null) {
      const delta = el.scrollHeight - pending.height;
      if (delta > 0) {
        el.scrollTop = pending.top + delta;
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
            pendingAnchorRef.current = { height: root.scrollHeight, top: root.scrollTop };
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
      pendingAnchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
    }
    onLoadEarlier();
  };

  const vizByTurn = groupVisualizationsByTurn(visualizations);
  const unlinked = unlinkedVisualizations(turns, visualizations);
  const rewindable = onRewind === undefined ? null : rewindableTurnIds(turns, checkpoints);
  const checkpointByTurn = new Map<string, ThreadCheckpoint>();
  for (const cp of checkpoints) {
    if (cp.turnId !== undefined) checkpointByTurn.set(cp.turnId, cp);
  }

  if (turns.length === 0 && unlinked.length === 0) return null;

  const visibleTurns = visibleStart > 0 ? turns.slice(visibleStart) : turns;

  return (
    <div ref={contentRef} className="flex flex-col gap-8">
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
        <ThreadTurnView
          key={turn.id}
          turn={turn}
          minHeightPx={turn.id === anchoredTurnId ? anchoredTurnMinHeightPx : 0}
          checkpoint={checkpointByTurn.get(turn.id)}
          visualizations={vizByTurn.get(turn.id) ?? NO_VISUALIZATIONS}
          onRewind={rewindable?.has(turn.id) ? onRewind : undefined}
          onRespondApproval={onRespondApproval}
        />
      ))}
      {unlinked.length > 0 && (
        <div className="flex flex-col gap-3">
          {unlinked.map((viz) => (
            <ScuttleVizCard key={viz.id} spec={viz.spec} />
          ))}
        </div>
      )}
    </div>
  );
}
