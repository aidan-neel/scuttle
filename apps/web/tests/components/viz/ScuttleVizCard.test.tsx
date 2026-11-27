import { describe, expect, test } from "bun:test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { renderToStaticMarkup } from "react-dom/server";
import {
  activeTabBlocks,
  initialVizCardState,
  ScuttleVizCard,
  vizCardReducer,
} from "../../../src/components/viz/ScuttleVizCard.tsx";
import { comparisonView, statusCounts } from "../../../src/components/viz/VizComparison.tsx";
import {
  FLOW_NODE,
  flowNeighbors,
  layoutFlow,
  toggleNode,
} from "../../../src/components/viz/VizFlow.tsx";
import {
  buildSandboxSrcDoc,
  clampFrameHeight,
} from "../../../src/components/viz/VizSandboxFrame.tsx";
import { nextSort, pillCounts, tableView } from "../../../src/components/viz/VizTable.tsx";
import {
  chartCategories,
  chartEntries,
  formatVizNumber,
  niceTicks,
  toggleHidden,
  vizToMarkdown,
} from "../../../src/components/viz/vizModel.ts";
import {
  decodeScuttleVizSpec,
  ScuttleVizSpec,
  ThreadVisualization,
  VizChartBlock,
  VizComparisonBlock,
  VizFlowBlock,
  VizTableBlock,
} from "../../../../../packages/contracts/src/viz.ts";

const decodeSpec = Schema.decodeUnknownSync(ScuttleVizSpec);
const decodeChart = Schema.decodeUnknownSync(VizChartBlock);

const table = Schema.decodeUnknownSync(VizTableBlock)({
  kind: "table",
  title: "Services",
  filterColumn: "status",
  columns: [
    { key: "name", label: "Service" },
    { key: "status", label: "Status", kind: "badge" },
    { key: "p95", label: "p95 ms", kind: "bar" },
  ],
  rows: [
    {
      id: "api",
      cells: { name: "api", status: "healthy", p95: 120 },
      filterTags: { region: "us" },
    },
    {
      id: "web",
      cells: { name: "web", status: "degraded", p95: 480 },
      filterTags: { region: "eu" },
    },
    { id: "jobs", cells: { name: "jobs", status: "healthy", p95: 95 }, detail: "Runs nightly" },
    {
      id: "auth",
      cells: { name: "auth10", status: "failing", p95: 900 },
      filterTags: { region: "us" },
    },
    { id: "auth2", cells: { name: "auth9", status: "healthy", p95: 60 } },
  ],
});

const comparison = Schema.decodeUnknownSync(VizComparisonBlock)({
  kind: "comparison",
  items: [
    { id: "a", title: "Option A", status: "Ready", group: "Fast" },
    { id: "b", title: "Option B", status: "Blocked", group: "Slow", metric: "12 ms" },
    { id: "c", title: "Option C", status: "Ready", group: "Slow" },
  ],
});

const flow = (edges: ReadonlyArray<object>, direction?: "vertical") =>
  Schema.decodeUnknownSync(VizFlowBlock)({
    kind: "flow",
    ...(direction === undefined ? {} : { direction }),
    nodes: ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase() })),
    edges,
  });

const structured = decodeSpec({
  mode: "structured",
  title: "Release health",
  subtitle: "Last 7 days",
  takeaway: "Web latency regressed after Tuesday's deploy.",
  blocks: [
    {
      kind: "kpis",
      items: [
        { label: "Healthy", value: 3, delta: "+1", filterKey: "status", filterValue: "healthy" },
        { label: "p95", value: "480 ms", tone: "warning", sparkline: [1, 3, 2, 5] },
      ],
    },
  ],
  tabs: [
    {
      id: "overview",
      label: "Overview",
      blocks: [
        {
          kind: "chart",
          title: "Requests",
          chartType: "stacked-bar",
          categories: ["Mon", "Tue", "Wed"],
          series: [
            { id: "ok", label: "OK", values: [10, 12, 9] },
            { id: "err", label: "Errors", tone: "danger", values: [1, 4, 0] },
          ],
          filterKey: "day",
        },
        { kind: "callout", tone: "warning", title: "Heads up", body: "Tuesday spike." },
      ],
    },
    { id: "services", label: "Services", badge: "5", blocks: [table] },
    { id: "plan", label: "Plan", blocks: [comparison, flow([{ from: "a", to: "b" }])] },
  ],
});

describe("ScuttleVizSpec schema", () => {
  test("decodes a sandbox spec", () => {
    const exit = decodeScuttleVizSpec({
      mode: "sandbox",
      title: "Map",
      html: "<p>hi</p>",
      height: 320,
    });
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  test("rejects an unknown chart type, a non-finite number, and an unknown mode", () => {
    const chart = { kind: "chart", chartType: "pie", series: [] };
    const nan = { kind: "kpis", items: [{ label: "x", value: Number.NaN }] };
    for (const blocks of [[chart], [nan]]) {
      expect(Exit.isFailure(decodeScuttleVizSpec({ mode: "structured", title: "t", blocks }))).toBe(
        true,
      );
    }
    expect(Exit.isFailure(decodeScuttleVizSpec({ mode: "iframe", title: "t", html: "x" }))).toBe(
      true,
    );
  });

  test("rejects a sandbox spec with empty or oversized html", () => {
    for (const html of ["", "x".repeat(200_001)]) {
      expect(Exit.isFailure(decodeScuttleVizSpec({ mode: "sandbox", title: "t", html }))).toBe(
        true,
      );
    }
  });

  test("decodes a thread visualization with branded ids", () => {
    const viz = Schema.decodeUnknownSync(ThreadVisualization)({
      id: "viz-1",
      threadId: "thread-1",
      title: "Release health",
      spec: { mode: "sandbox", title: "x", html: "<b>x</b>" },
      createdAt: "2026-11-27T00:00:00.000Z",
      updatedAt: "2026-11-27T00:00:00.000Z",
    });
    expect(viz.threadId).toBe(
      Schema.decodeUnknownSync(ThreadVisualization.fields.threadId)("thread-1"),
    );
  });
});

describe("card state", () => {
  const initial = initialVizCardState(structured);
  const healthy = { key: "status", value: "healthy" };

  test("starts on the first tab with no filter and toggles fullscreen", () => {
    expect(initial).toEqual({ tabId: "overview", filter: null, expanded: false });
    expect(vizCardReducer(initial, { _tag: "SetExpanded", expanded: true }).expanded).toBe(true);
  });

  test("switching tabs keeps the cross-filter so root KPIs still narrow tab content", () => {
    const filtered = vizCardReducer(initial, { _tag: "SetFilter", filter: healthy });
    const next = vizCardReducer(filtered, { _tag: "SelectTab", tabId: "services" });
    expect(next.filter).toEqual(healthy);
    expect(activeTabBlocks(structured, next.tabId).map((b) => b.kind)).toEqual(["table"]);
  });

  test("an unknown tab id falls back to the first tab", () => {
    expect(activeTabBlocks(structured, "missing").map((b) => b.kind)).toEqual(["chart", "callout"]);
  });

  test("setting the same filter twice clears it and null always clears", () => {
    const once = vizCardReducer(initial, { _tag: "SetFilter", filter: healthy });
    expect(once.filter).toEqual(healthy);
    expect(
      vizCardReducer(once, { _tag: "SetFilter", filter: { key: "status", value: "HEALTHY" } })
        .filter,
    ).toBeNull();
    expect(vizCardReducer(once, { _tag: "SetFilter", filter: null }).filter).toBeNull();
  });
});

describe("cross-filtering", () => {
  const controls = { query: "", sort: null, pill: null } as const;
  const ids = (rows: ReadonlyArray<{ readonly id: string }>) => rows.map((r) => r.id);

  test("a KPI filter on a cell column narrows table rows case-insensitively", () => {
    const view = tableView(table, controls, { key: "status", value: "Healthy" });
    expect(view.crossFiltered).toBe(true);
    expect(ids(view.rows)).toEqual(["api", "jobs", "auth2"]);
  });

  test("a filter tag narrows table rows", () => {
    expect(ids(tableView(table, controls, { key: "region", value: "us" }).rows)).toEqual([
      "api",
      "auth",
    ]);
  });

  test("a filter key no row carries leaves the table untouched", () => {
    const view = tableView(table, controls, { key: "day", value: "Tue" });
    expect(view.crossFiltered).toBe(false);
    expect(view.rows).toHaveLength(5);
  });

  test("comparison items filter by status or group", () => {
    expect(
      ids(comparisonView(comparison.items, null, { key: "status", value: "ready" }).visible),
    ).toEqual(["a", "c"]);
    expect(
      ids(comparisonView(comparison.items, null, { key: "group", value: "Slow" }).visible),
    ).toEqual(["b", "c"]);
    expect(
      comparisonView(comparison.items, null, { key: "region", value: "us" }).visible,
    ).toHaveLength(3);
  });

  test("comparison status chips count items and the chip narrows within groups", () => {
    expect(statusCounts(comparison.items)).toEqual([
      { status: "Ready", count: 2, tone: "success" },
      { status: "Blocked", count: 1, tone: "danger" },
    ]);
    const view = comparisonView(comparison.items, "Ready", null);
    expect(view.groups.map(([group, items]) => [group, ids(items)])).toEqual([
      ["Fast", ["a"]],
      ["Slow", ["c"]],
    ]);
  });
});

describe("table controls", () => {
  const view = (query: string, sort: ReturnType<typeof nextSort>, pill: string | null) =>
    tableView(table, { query, sort, pill }, null).rows.map((r) => r.id);

  test("sort cycles ascending, descending, then off", () => {
    const asc = nextSort(null, "p95");
    const desc = nextSort(asc, "p95");
    expect(asc).toEqual({ key: "p95", dir: "asc" });
    expect(desc).toEqual({ key: "p95", dir: "desc" });
    expect(nextSort(desc, "p95")).toBeNull();
    expect(nextSort(desc, "name")).toEqual({ key: "name", dir: "asc" });
  });

  test("numbers sort numerically and text sorts with numeric collation", () => {
    expect(view("", { key: "p95", dir: "desc" }, null)).toEqual([
      "auth",
      "web",
      "api",
      "jobs",
      "auth2",
    ]);
    expect(view("", { key: "name", dir: "asc" }, null)).toEqual([
      "api",
      "auth2",
      "auth",
      "jobs",
      "web",
    ]);
  });

  test("search matches cells and detail text", () => {
    expect(view("AUTH", null, null)).toEqual(["auth", "auth2"]);
    expect(view("nightly", null, null)).toEqual(["jobs"]);
    expect(view("nothing-here", null, null)).toEqual([]);
  });

  test("status pills count values and combine with search", () => {
    expect(pillCounts(table.rows, "status")).toEqual([
      { value: "healthy", count: 3 },
      { value: "degraded", count: 1 },
      { value: "failing", count: 1 },
    ]);
    expect(view("auth", null, "healthy")).toEqual(["auth2"]);
  });
});

describe("flow layout", () => {
  const depthOf = (block: VizFlowBlock) =>
    Object.fromEntries(layoutFlow(block).nodes.map((n) => [n.node.id, n.depth]));

  test("ranks nodes by longest path so a shortcut edge does not pull a node forward", () => {
    const block = flow([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "a", to: "c" },
      { from: "c", to: "d" },
    ]);
    expect(depthOf(block)).toEqual({ a: 0, b: 1, c: 2, d: 3 });
  });

  test("survives cycles, self loops, and edges to missing nodes", () => {
    const block = flow([
      { from: "a", to: "b" },
      { from: "b", to: "a" },
      { from: "c", to: "c" },
      { from: "a", to: "ghost" },
    ]);
    const layout = layoutFlow(block);
    expect(layout.edges.map((e) => [e.edge.from, e.edge.to, e.back])).toEqual([
      ["a", "b", false],
      ["b", "a", true],
    ]);
    expect(layout.nodes).toHaveLength(4);
    expect(layout.height).toBeGreaterThan(FLOW_NODE.h);
  });

  test("vertical flows stack ranks downward", () => {
    const [a, b] = layoutFlow(flow([{ from: "a", to: "b" }], "vertical")).nodes.filter((n) =>
      ["a", "b"].includes(n.node.id),
    );
    expect(a?.y).toBe(0);
    expect((b?.y ?? 0) > (a?.y ?? 0)).toBe(true);
  });

  test("selecting a node exposes its neighbors and selecting it again clears it", () => {
    const edges = flow([
      { from: "a", to: "b" },
      { from: "c", to: "b" },
      { from: "b", to: "d" },
    ]).edges;
    expect(flowNeighbors(edges, "b")).toEqual({ incoming: ["a", "c"], outgoing: ["d"] });
    expect(toggleNode(null, "b")).toBe("b");
    expect(toggleNode("b", "b")).toBeNull();
    expect(toggleNode("b", "d")).toBe("d");
  });
});

describe("chart model", () => {
  test("ticks are round numbers that cover the range", () => {
    expect(niceTicks(0, 17)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(0, 0)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(-3, 8)).toEqual([-5, 0, 5, 10]);
  });

  test("categories fill in for series longer than the labels", () => {
    const block = decodeChart({
      kind: "chart",
      chartType: "line",
      categories: ["a"],
      series: [{ id: "s", label: "S", values: [1, 2, 3] }],
    });
    expect(chartCategories(block)).toEqual(["a", "2", "3"]);
  });

  test("a donut with categories makes one slice per category and clamps negatives", () => {
    const block = decodeChart({
      kind: "chart",
      chartType: "donut",
      categories: ["x", "y"],
      series: [{ id: "s", label: "S", values: [4, -2] }],
    });
    expect(chartEntries(block).map((e) => [e.label, e.values])).toEqual([
      ["x", [4]],
      ["y", [0]],
    ]);
  });

  test("untoned series use a neutral ramp when another series carries a tone", () => {
    const [ok, err] = chartEntries(
      decodeChart({
        kind: "chart",
        chartType: "bar",
        series: [
          { id: "ok", label: "OK", values: [1] },
          { id: "err", label: "Errors", tone: "danger", values: [1] },
        ],
      }),
    );
    expect(ok?.color).toContain("--color-fg-muted");
    expect(err?.color).toBe("var(--color-danger)");
  });

  test("legend toggles never hide the last visible series", () => {
    expect(toggleHidden([], "a", 2)).toEqual(["a"]);
    expect(toggleHidden(["a"], "b", 2)).toEqual(["a"]);
    expect(toggleHidden(["a"], "a", 2)).toEqual([]);
  });

  test("numbers format with units and compact notation", () => {
    expect(formatVizNumber(1234.567)).toBe("1,234.57");
    expect(formatVizNumber(125_000, "$")).toBe("$125K");
    expect(formatVizNumber(-12, "$")).toBe("-$12");
    expect(formatVizNumber(42, "%")).toBe("42%");
    expect(formatVizNumber(3, "ms")).toBe("3 ms");
  });
});

describe("sandbox frame", () => {
  const theme = {
    appearance: "light" as const,
    tokens: {
      "--color-fg": "#141416",
      "--color-panel": "red;}</style><script>x</script>",
      bad: "1",
    },
  };

  test("the document carries a locked-down CSP and theme tokens; heights are clamped", () => {
    const doc = buildSandboxSrcDoc("<h1>Hi</h1>", theme);
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('data-appearance="light"');
    expect(doc).toContain("--color-fg:#141416");
    expect(doc).toContain("<body><h1>Hi</h1></body>");
    expect(doc).not.toContain("bad:1");
    expect(doc).not.toContain("</style><script>x");
    expect(clampFrameHeight(10)).toBe(80);
    expect(clampFrameHeight(300.2)).toBe(301);
    expect(clampFrameHeight(10_000)).toBe(1_600);
  });
});

describe("rendering", () => {
  test("a structured card renders the header, takeaway, KPIs, and only the active tab", () => {
    const html = renderToStaticMarkup(<ScuttleVizCard spec={structured} />);
    expect(html).toContain("Release health");
    expect(html).toContain("Web latency regressed");
    expect(html).toContain("Healthy");
    expect(html).toContain("Requests");
    expect(html).toContain("Services");
    expect(html).not.toContain("Option A");
  });

  test("a sandbox card renders a scripts-only sandboxed iframe", () => {
    const spec = decodeSpec({ mode: "sandbox", title: "Map", html: "<p>hi</p>" });
    const html = renderToStaticMarkup(<ScuttleVizCard spec={spec} />);
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
  });

  test("every block kind renders, including empty charts", () => {
    const spec = decodeSpec({
      mode: "structured",
      title: "All",
      blocks: [
        table,
        comparison,
        flow([{ from: "a", to: "b", label: "calls", dashed: true }]),
        { kind: "chart", chartType: "bar", series: [] },
        {
          kind: "chart",
          chartType: "horizontal-bar",
          categories: ["a"],
          series: [{ id: "s", label: "S", values: [2] }],
        },
        {
          kind: "chart",
          chartType: "area",
          categories: ["a", "b"],
          series: [{ id: "s", label: "S", values: [1, 2] }],
        },
        { kind: "chart", chartType: "donut", series: [{ id: "s", label: "S", values: [0] }] },
      ],
    });
    const html = renderToStaticMarkup(<ScuttleVizCard spec={spec} />);
    expect(html).toContain("No data");
    expect(html).toContain("Option B");
    expect(html).toContain("calls");
  });

  test("the markdown summary covers tabs and blocks", () => {
    const md = vizToMarkdown(structured);
    expect(md).toContain("# Release health");
    expect(md).toContain("> Web latency regressed");
    expect(md).toContain("- **Healthy:** 3 (+1)");
    expect(md).toContain("## Services");
    expect(md).toContain("| Service | Status | p95 ms |");
    expect(md).toContain("- A → B");
  });
});
