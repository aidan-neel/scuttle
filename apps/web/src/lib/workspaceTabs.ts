export type WorkspaceTab =
  | { readonly kind: "agent"; readonly agentId: string }
  | { readonly kind: "thread"; readonly threadId: string };

const STORAGE_KEY = "scuttle.workspace-tabs.v1";
const MAX_TABS = 16;

export const tabKey = (tab: WorkspaceTab): string =>
  tab.kind === "agent" ? `agent:${tab.agentId}` : `thread:${tab.threadId}`;

export const tabPath = (tab: WorkspaceTab): string =>
  tab.kind === "agent" ? `/agents/${tab.agentId}` : `/threads/${tab.threadId}`;

export const tabFromPathname = (pathname: string): WorkspaceTab | null => {
  const agentMatch = /^\/agents\/([^/]+)$/.exec(pathname);
  if (agentMatch?.[1]) {
    return { kind: "agent", agentId: decodeURIComponent(agentMatch[1]) };
  }
  const threadMatch = /^\/threads\/([^/]+)$/.exec(pathname);
  if (threadMatch?.[1]) {
    return { kind: "thread", threadId: decodeURIComponent(threadMatch[1]) };
  }
  return null;
};

export const upsertOpenTab = (
  tabs: ReadonlyArray<WorkspaceTab>,
  tab: WorkspaceTab,
): ReadonlyArray<WorkspaceTab> => {
  const key = tabKey(tab);
  if (tabs.some((existing) => tabKey(existing) === key)) {
    return tabs;
  }
  const next = [...tabs, tab];
  return next.length <= MAX_TABS ? next : next.slice(next.length - MAX_TABS);
};

export const closeOpenTab = (
  tabs: ReadonlyArray<WorkspaceTab>,
  keyToClose: string,
  activeKey: string | null,
): {
  readonly tabs: ReadonlyArray<WorkspaceTab>;
  readonly nextActive: WorkspaceTab | null;
} => {
  const idx = tabs.findIndex((tab) => tabKey(tab) === keyToClose);
  if (idx === -1) {
    return { tabs, nextActive: null };
  }
  const remaining = tabs.filter((_, i) => i !== idx);
  if (activeKey !== keyToClose) {
    return { tabs: remaining, nextActive: null };
  }
  const fallback = remaining[idx] ?? remaining[idx - 1] ?? null;
  return { tabs: remaining, nextActive: fallback };
};

export const pruneOpenTabs = (
  tabs: ReadonlyArray<WorkspaceTab>,
  validAgentIds: ReadonlySet<string>,
  validThreadIds: ReadonlySet<string>,
): ReadonlyArray<WorkspaceTab> => {
  const next = tabs.filter((tab) =>
    tab.kind === "agent" ? validAgentIds.has(tab.agentId) : validThreadIds.has(tab.threadId),
  );
  return next.length === tabs.length ? tabs : next;
};

const isWorkspaceTab = (value: unknown): value is WorkspaceTab => {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  if (value.kind === "agent" && "agentId" in value && typeof value.agentId === "string") {
    return value.agentId.length > 0;
  }
  if (value.kind === "thread" && "threadId" in value && typeof value.threadId === "string") {
    return value.threadId.length > 0;
  }
  return false;
};

export const readStoredTabs = (): ReadonlyArray<WorkspaceTab> => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const result: WorkspaceTab[] = [];
    for (const item of parsed) {
      if (!isWorkspaceTab(item)) continue;
      const key = tabKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
      if (result.length >= MAX_TABS) break;
    }
    return result;
  } catch {
    return [];
  }
};

export const writeStoredTabs = (tabs: ReadonlyArray<WorkspaceTab>): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // Ignore storage quota or private browsing errors.
  }
};
