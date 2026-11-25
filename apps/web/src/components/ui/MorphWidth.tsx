import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

export function MorphWidth({ children }: { children: ReactNode }) {
  const content = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();

  useLayoutEffect(() => {
    const node = content.current;
    if (node === null) return;
    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.borderBoxSize[0]?.inlineSize;
      if (size !== undefined) setWidth(size);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      className="inline-flex overflow-hidden transition-[width] duration-200 ease-out-quint"
      style={{ width }}
    >
      <span ref={content} className="inline-flex shrink-0 items-center gap-[inherit]">
        {children}
      </span>
    </span>
  );
}
