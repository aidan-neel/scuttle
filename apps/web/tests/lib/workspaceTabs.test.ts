import { describe, expect, it } from "bun:test";
import {
  closeOpenTab,
  pruneOpenTabs,
  tabFromPathname,
  tabKey,
  tabPath,
  upsertOpenTab,
  type WorkspaceTab,
} from "../../src/lib/workspaceTabs.ts";

describe("workspaceTabs", () => {
  it("parses agent and thread paths and ignores unrelated routes", () => {
    expect(tabFromPathname("/agents/ag-1")).toEqual({ kind: "agent", agentId: "ag-1" });
    expect(tabFromPathname("/threads/th-2")).toEqual({ kind: "thread", threadId: "th-2" });
    expect(tabFromPathname("/issues")).toBeNull();
    expect(tabFromPathname("/settings/general")).toBeNull();
    expect(tabFromPathname("/")).toBeNull();
  });

  it("upserts without duplicating existing tabs", () => {
    const a: WorkspaceTab = { kind: "agent", agentId: "ag-1" };
    const b: WorkspaceTab = { kind: "thread", threadId: "th-1" };
    const first = upsertOpenTab([], a);
    const second = upsertOpenTab(first, b);
    const dedup = upsertOpenTab(second, a);
    expect(dedup).toBe(second);
    expect(dedup.map(tabPath)).toEqual(["/agents/ag-1", "/threads/th-1"]);
  });

  it("closes active tab and picks adjacent neighbor", () => {
    const tabs: ReadonlyArray<WorkspaceTab> = [
      { kind: "agent", agentId: "ag-1" },
      { kind: "thread", threadId: "th-1" },
      { kind: "thread", threadId: "th-2" },
    ];
    const closedMiddle = closeOpenTab(tabs, tabKey(tabs[1]!), tabKey(tabs[1]!));
    expect(closedMiddle.tabs.length).toBe(2);
    expect(closedMiddle.nextActive).toEqual(tabs[2] ?? null);

    const closedLast = closeOpenTab(
      closedMiddle.tabs,
      tabKey(closedMiddle.tabs[1]!),
      tabKey(closedMiddle.tabs[1]!),
    );
    expect(closedLast.nextActive).toEqual(tabs[0] ?? null);
  });

  it("prunes deleted agents and threads", () => {
    const tabs: ReadonlyArray<WorkspaceTab> = [
      { kind: "agent", agentId: "ag-1" },
      { kind: "agent", agentId: "ag-gone" },
      { kind: "thread", threadId: "th-1" },
    ];
    const pruned = pruneOpenTabs(tabs, new Set(["ag-1"]), new Set(["th-1"]));
    expect(pruned).toEqual([
      { kind: "agent", agentId: "ag-1" },
      { kind: "thread", threadId: "th-1" },
    ]);
  });
});
