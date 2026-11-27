import { type RefObject, useLayoutEffect, useState } from "react";

const INITIAL_WINDOW = 24;

export interface ListWindow {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly paddingTop: number;
  readonly paddingBottom: number;
}

export interface UseListWindowOptions {
  readonly count: number;
  readonly rowStride: number;
  readonly scrollRef: RefObject<HTMLElement | null>;
  readonly listRef: RefObject<HTMLElement | null>;
  readonly overscan?: number;
  readonly enabled?: boolean;
}

export function computeListWindow(
  scrollTop: number,
  viewportHeight: number,
  listOffsetTop: number,
  count: number,
  rowStride: number,
  overscan: number,
): { readonly startIndex: number; readonly endIndex: number } {
  if (count <= 0 || rowStride <= 0) return { startIndex: 0, endIndex: 0 };
  const pad = Math.max(0, overscan);
  const top = Math.max(0, scrollTop - listOffsetTop);
  const bottom = Math.max(0, scrollTop + Math.max(0, viewportHeight) - listOffsetTop);
  const startIndex = Math.max(0, Math.min(count, Math.floor(top / rowStride) - pad));
  const endIndex = Math.max(startIndex, Math.min(count, Math.ceil(bottom / rowStride) + pad));
  return { startIndex, endIndex };
}

export function useListWindow({
  count,
  rowStride,
  scrollRef,
  listRef,
  overscan = 8,
  enabled = true,
}: UseListWindowOptions): ListWindow {
  const [range, setRange] = useState(() => ({
    startIndex: 0,
    endIndex: Math.min(count, INITIAL_WINDOW),
  }));

  useLayoutEffect(() => {
    if (!enabled) return;
    const scrollEl = scrollRef.current;
    const listEl = listRef.current;
    if (scrollEl === null || listEl === null) return;

    const measure = () => {
      const offset =
        listEl === scrollEl
          ? 0
          : listEl.getBoundingClientRect().top -
            scrollEl.getBoundingClientRect().top +
            scrollEl.scrollTop;
      const next = computeListWindow(
        scrollEl.scrollTop,
        scrollEl.clientHeight,
        offset,
        count,
        rowStride,
        overscan,
      );
      setRange((p) =>
        p.startIndex === next.startIndex && p.endIndex === next.endIndex ? p : next,
      );
    };

    measure();
    let frameId: number | null = null;
    const onSchedule = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        measure();
      });
    };

    scrollEl.addEventListener("scroll", onSchedule, { passive: true });
    const observer = new ResizeObserver(onSchedule);
    observer.observe(scrollEl);
    if (listEl !== scrollEl) {
      observer.observe(listEl);
    }
    const firstChild = scrollEl.firstElementChild;
    if (firstChild !== null && firstChild !== scrollEl && firstChild !== listEl) {
      observer.observe(firstChild);
    }
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      scrollEl.removeEventListener("scroll", onSchedule);
      observer.disconnect();
    };
  }, [count, enabled, listRef, overscan, rowStride, scrollRef]);

  if (!enabled || count <= 0 || rowStride <= 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
  }
  const endIndex = Math.min(count, range.endIndex);
  const startIndex = Math.min(endIndex, Math.max(0, range.startIndex));
  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * rowStride,
    paddingBottom: (count - endIndex) * rowStride,
  };
}
