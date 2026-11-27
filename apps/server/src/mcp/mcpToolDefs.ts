export interface McpToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const s = { type: "string" };
const str = (maxLength?: number, minLength?: number) => ({
  ...s,
  ...(minLength !== undefined ? { minLength } : {}),
  ...(maxLength !== undefined ? { maxLength } : {}),
});
const keyProp = str(120, 1);
const labelProp = str(200);
const bodyProp = str(4000);
const AGENT_ROLES = [
  "nano",
  "small",
  "medium",
  "large",
  "xlarge",
  "max",
  "design",
  "agent",
  "workhorse",
  "review",
  "fast",
] as const;
const toneProp = {
  type: "string",
  enum: ["neutral", "primary", "success", "warning", "danger"],
  description: "Semantic tone synced to all Scuttle themes. Never hardcode hex colors.",
};
const filterKeyProp = {
  ...keyProp,
  description: "Shared filter dimension wired to table filterTags or filterColumn.",
};
const arr = (items: unknown, maxItems: number) => ({ type: "array", maxItems, items });
const obj = (
  properties: Record<string, unknown>,
  required: ReadonlyArray<string>,
  description?: string,
) => ({
  type: "object",
  ...(description ? { description } : {}),
  properties,
  required,
});

const VIZ_BLOCKS_SCHEMA = arr(
  {
    oneOf: [
      obj(
        {
          kind: { const: "kpis" },
          items: arr(
            obj(
              {
                id: keyProp,
                label: labelProp,
                value: { type: ["number", "string"] },
                delta: labelProp,
                tone: toneProp,
                note: labelProp,
                sparkline: arr({ type: "number" }, 120),
                filterKey: filterKeyProp,
                filterValue: labelProp,
              },
              ["label", "value"],
            ),
            12,
          ),
        },
        ["kind", "items"],
      ),
      obj(
        {
          kind: { const: "chart" },
          title: labelProp,
          subtitle: labelProp,
          chartType: {
            type: "string",
            enum: ["bar", "horizontal-bar", "stacked-bar", "line", "area", "donut"],
          },
          unit: str(24),
          categories: arr(labelProp, 500),
          series: arr(
            obj(
              {
                id: keyProp,
                label: labelProp,
                tone: toneProp,
                values: arr({ type: "number" }, 500),
              },
              ["id", "label", "values"],
            ),
            12,
          ),
          filterKey: filterKeyProp,
          height: { type: "number", minimum: 120, maximum: 640 },
        },
        ["kind", "chartType", "series"],
      ),
      obj(
        {
          kind: { const: "table" },
          title: labelProp,
          searchable: { type: "boolean" },
          filterColumn: filterKeyProp,
          columns: arr(
            obj(
              {
                key: keyProp,
                label: labelProp,
                align: { type: "string", enum: ["left", "right"] },
                kind: { type: "string", enum: ["text", "number", "badge", "bar", "code"] },
              },
              ["key", "label"],
            ),
            16,
          ),
          rows: arr(
            obj(
              {
                id: keyProp,
                cells: { type: "object", additionalProperties: { type: ["number", "string"] } },
                tone: toneProp,
                filterTags: { type: "object", additionalProperties: labelProp },
                detail: bodyProp,
              },
              ["id", "cells"],
            ),
            1000,
          ),
        },
        ["kind", "columns", "rows"],
      ),
      obj(
        {
          kind: { const: "comparison" },
          title: labelProp,
          columns: arr(labelProp, 6),
          items: arr(
            obj(
              {
                id: keyProp,
                title: labelProp,
                subtitle: labelProp,
                status: labelProp,
                tone: toneProp,
                metric: labelProp,
                detail: bodyProp,
                group: labelProp,
              },
              ["id", "title", "status"],
            ),
            200,
          ),
        },
        ["kind", "items"],
      ),
      obj(
        {
          kind: { const: "flow" },
          title: labelProp,
          direction: { type: "string", enum: ["horizontal", "vertical"] },
          nodes: arr(
            obj(
              {
                id: keyProp,
                label: labelProp,
                sublabel: labelProp,
                tone: toneProp,
                badge: str(40),
                detail: bodyProp,
                group: labelProp,
              },
              ["id", "label"],
            ),
            80,
          ),
          edges: arr(
            obj({ from: keyProp, to: keyProp, label: str(60), dashed: { type: "boolean" } }, [
              "from",
              "to",
            ]),
            200,
          ),
        },
        ["kind", "nodes", "edges"],
      ),
      obj({ kind: { const: "callout" }, tone: toneProp, title: labelProp, body: bodyProp }, [
        "kind",
        "body",
      ]),
    ],
  },
  24,
);

const VIZ_SPEC_PROPERTIES = {
  mode: {
    type: "string",
    enum: ["structured", "sandbox"],
    description:
      "Always prefer 'structured'. Use 'sandbox' only for custom simulations or canvases structured blocks cannot express.",
  },
  title: { ...labelProp, description: "Short, clear title." },
  subtitle: { ...labelProp, description: "Optional crisp context line." },
  takeaway: { ...str(400), description: "1-2 concise sentences stating the key insight." },
  tabs: {
    ...arr(
      obj({ id: keyProp, label: labelProp, badge: str(40), blocks: VIZ_BLOCKS_SCHEMA }, [
        "id",
        "label",
        "blocks",
      ]),
      8,
    ),
    description: "Split multi-view visuals into tabs rather than long vertical walls.",
  },
  blocks: VIZ_BLOCKS_SCHEMA,
  html: {
    ...str(200000, 1),
    description: "Required only for mode='sandbox'. Never hardcode dark/light hex backgrounds.",
  },
  height: { type: "number", minimum: 80, maximum: 1600 },
};

const VIZ_GUIDANCE = [
  "Prefer mode: 'structured' over mode: 'sandbox' for crisp, theme-synced native UI.",
  "Use semantic tones ('neutral', 'primary', 'success', 'warning', 'danger') so obsidian, nord, espresso, daylight, and paper themes all render natively—never hardcode hex colors.",
  "Keep labels scannable, lead with a 1-2 line takeaway, use sparklines on KPIs, bar columns in tables, detail fields for click-to-expand context, and tabs for multi-view layouts.",
  "Wire filterKey/filterValue on KPIs and filterKey on charts to matching table filterTags or filterColumn for instant click-to-filter interactivity.",
].join(" ");

export const SCUTTLE_MCP_TOOLS: ReadonlyArray<McpToolDefinition> = [
  {
    name: "scuttle_viz_render",
    title: "Render Scuttle Visualization",
    description: `Render a native, theme-synced, interactive visualization directly in Scuttle. ${VIZ_GUIDANCE}`,
    inputSchema: obj(VIZ_SPEC_PROPERTIES, ["mode", "title"]),
  },
  {
    name: "scuttle_viz_update",
    title: "Update Scuttle Visualization",
    description: `Live-update an existing visualization by vizId with an updated title or spec. ${VIZ_GUIDANCE}`,
    inputSchema: obj(
      {
        vizId: { ...str(undefined, 1), description: "Visualization ID from scuttle_viz_render." },
        title: { ...labelProp, description: "Optional replacement title." },
        spec: obj(VIZ_SPEC_PROPERTIES, ["mode", "title"], "Optional replacement ScuttleVizSpec."),
      },
      ["vizId"],
    ),
  },
  {
    name: "scuttle_perf_record",
    title: "Record Model Performance Rating",
    description:
      "Record an orchestrator quality rating (category, score 0-10, outcome pass/partial/fail, rework none/minor/major, notes) for a completed delegationId, turnId, or threadId. Scuttle automatically joins real measured tok/sec, durationMs, and costUsd.",
    inputSchema: obj(
      {
        runId: s,
        delegationId: s,
        turnId: s,
        threadId: s,
        providerId: s,
        model: s,
        category: {
          ...str(undefined, 1),
          description: "Task category, e.g. bugfix, feature, ui, refactor, review, research.",
        },
        score: { type: "number", minimum: 0, maximum: 10 },
        outcome: { type: "string", enum: ["pass", "partial", "fail"] },
        rework: { type: "string", enum: ["none", "minor", "major"] },
        notes: s,
      },
      ["category", "score", "outcome"],
    ),
  },
  {
    name: "scuttle_perf_query",
    title: "Query Model Performance Metrics",
    description:
      "Query per-model and per-category performance metrics (avg score, pass/partial/fail counts, avg/median tok/sec, avg duration, avg cost, and formatted summaryLines) so you can choose the right model from real measured data.",
    inputSchema: obj(
      {
        model: s,
        providerId: s,
        category: s,
        days: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1 },
      },
      [],
    ),
  },
  {
    name: "scuttle_capabilities",
    title: "List Provider Capabilities",
    description:
      "List enabled provider instances (including multi-account instances and installed ACP Registry agents), their models and effort levels, and recent measured performance highlights.",
    inputSchema: obj(
      { category: { ...s, description: "Optional category filter for highlights." } },
      [],
    ),
  },
  {
    name: "scuttle_delegate_task",
    title: "Delegate Task to Child Thread",
    description:
      "Spawn a child thread (local or worktree isolation) on any enabled provider instance/model or astack tier/role. Returns delegationId, childThreadId, and status.",
    inputSchema: obj(
      {
        title: { ...str(undefined, 1), description: "Concise task title." },
        brief: {
          ...str(undefined, 1),
          description:
            "Self-contained assignment: goal, owned files, verification bar, report format.",
        },
        runtime: { type: "string", enum: ["local", "worktree"], default: "local" },
        providerId: { ...s, description: "Provider instance ID from scuttle_capabilities." },
        model: { ...s, description: "Target model slug." },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"] },
        role: {
          type: "string",
          enum: [...AGENT_ROLES],
          description: "Optional astack tier/role when providerId/model omitted.",
        },
        kind: { type: "string", enum: ["task", "pr", "review", "issue"], default: "task" },
        branch: { ...s, description: "Optional base branch when runtime='worktree'." },
        issueId: s,
      },
      ["title", "brief"],
    ),
  },
  {
    name: "scuttle_task_status",
    title: "Check Delegated Task Status",
    description:
      "Check status, summary, and real measured telemetry (tokensPerSecond, durationMs, costUsd, inputTokens, outputTokens) of a delegated task.",
    inputSchema: obj({ delegationId: str(undefined, 1), childThreadId: str(undefined, 1) }, []),
  },
  {
    name: "scuttle_task_cancel",
    title: "Cancel Delegated Task",
    description: "Cancel a running delegated task by delegationId.",
    inputSchema: obj({ delegationId: str(undefined, 1), reason: s }, ["delegationId"]),
  },
  {
    name: "scuttle_thread_list",
    title: "List Recent Threads",
    description: "List recent threads in the current project or across all projects.",
    inputSchema: obj(
      {
        projectId: s,
        allProjects: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      [],
    ),
  },
  {
    name: "scuttle_thread_read",
    title: "Read Thread Turns",
    description: "Read recent turns and summary of a thread by threadId.",
    inputSchema: obj(
      {
        threadId: str(undefined, 1),
        turnLimit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      ["threadId"],
    ),
  },
  {
    name: "scuttle_ask_user",
    title: "Ask User Structured Questions",
    description:
      "Ask the user 1-4 structured single-select, multi-select, or free-text questions in Scuttle's native input UI and wait for their answers. Use when a decision genuinely needs user input rather than dumping a wall of questions in plain text.",
    inputSchema: obj(
      {
        title: { ...labelProp, description: "Optional short title for the prompt." },
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: obj(
            {
              id: { ...keyProp, description: "Optional stable key for this question's answer." },
              header: { ...str(40, 1), description: "Short chip label (e.g. 'Auth', 'Scope')." },
              question: { ...str(1000, 1), description: "Clear question text." },
              options: {
                type: "array",
                minItems: 2,
                maxItems: 6,
                items: obj(
                  {
                    label: { ...str(200, 1), description: "Concise choice label." },
                    description: str(400),
                  },
                  ["label"],
                ),
              },
              multiSelect: { type: "boolean", default: false },
              allowCustom: { type: "boolean", default: true },
            },
            ["question", "options"],
          ),
        },
      },
      ["questions"],
    ),
  },
];

export const SCUTTLE_MCP_TOOL_NAMES = SCUTTLE_MCP_TOOLS.map((tool) => tool.name);
