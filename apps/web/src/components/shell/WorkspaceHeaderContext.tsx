import { createContext, type ReactNode, use, useState } from "react";
import { createPortal } from "react-dom";

interface WorkspaceHeaderContextValue {
  readonly slot: HTMLDivElement | null;
  readonly setSlot: (el: HTMLDivElement | null) => void;
}

const WorkspaceHeaderContext = createContext<WorkspaceHeaderContextValue | null>(null);

export function WorkspaceHeaderProvider({ children }: { readonly children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return <WorkspaceHeaderContext value={{ slot, setSlot }}>{children}</WorkspaceHeaderContext>;
}

export function useWorkspaceHeaderSlot() {
  const ctx = use(WorkspaceHeaderContext);
  if (ctx === null) {
    throw new Error("useWorkspaceHeaderSlot must be called inside <WorkspaceHeaderProvider>.");
  }
  return ctx;
}

export function WorkspaceHeaderActions({ children }: { readonly children: ReactNode }) {
  const ctx = use(WorkspaceHeaderContext);
  if (!ctx?.slot) return null;
  return createPortal(children, ctx.slot);
}
