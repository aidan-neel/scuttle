import type { KeyboardEvent, PointerEvent } from "react";
import { SIDEBAR } from "@/lib/sidebarWidth.ts";

interface ResizeHandleProps {
  width: number;
  onResize: (width: number) => void;
  onResizeEnd: () => void;
  onReset: () => void;
}

const KEY_STEP = 16;

export function ResizeHandle({ width, onResize, onResizeEnd, onReset }: ResizeHandleProps) {
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const origin = event.clientX - width;
    handle.setPointerCapture(event.pointerId);
    document.documentElement.dataset.resizing = "";
    const move = (moveEvent: globalThis.PointerEvent) => onResize(moveEvent.clientX - origin);
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      delete document.documentElement.dataset.resizing;
      onResizeEnd();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    onResize(width + delta);
    onResizeEnd();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR.min}
      aria-valuemax={SIDEBAR.max}
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={nudge}
      onDoubleClick={onReset}
      className="group/handle absolute inset-y-0 right-0 z-20 flex w-2 cursor-col-resize justify-end outline-none"
    >
      <span className="my-3 w-px rounded-full bg-edge-strong opacity-0 transition-opacity duration-150 ease-out group-hover/handle:opacity-100 group-focus-visible/handle:bg-fg-muted group-focus-visible/handle:opacity-100 group-active/handle:bg-fg-muted group-active/handle:opacity-100" />
    </div>
  );
}
