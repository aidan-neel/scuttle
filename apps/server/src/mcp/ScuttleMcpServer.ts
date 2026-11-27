import * as Crypto from "node:crypto";
import {
  AgentDelegationKind,
  AgentModelRole,
  EffortLevel,
  ModelPerfQueryInput,
  type ModelPerfRun,
  type ModelPerformanceSummary,
  RateModelRunInput,
  ScuttleVizSpec,
  ThreadRuntime,
  type UserInputAnswers,
} from "@scuttle/contracts";
import * as Schema from "effect/Schema";
import type { McpSessionContext, McpSessionRegistry } from "./McpSessionRegistry.ts";
import { SCUTTLE_MCP_TOOLS } from "./mcpToolDefs.ts";

type MaybePromise<T> = Promise<T> | T;

const NonEmpty = Schema.String.check(Schema.isMinLength(1));
const PosInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));

const CapabilitiesArgsSchema = Schema.Struct({ category: Schema.optionalKey(Schema.String) });
const DelegateTaskArgsSchema = Schema.Struct({
  title: NonEmpty,
  brief: NonEmpty,
  runtime: Schema.optionalKey(ThreadRuntime),
  providerId: Schema.optionalKey(NonEmpty),
  model: Schema.optionalKey(NonEmpty),
  effort: Schema.optionalKey(EffortLevel),
  role: Schema.optionalKey(AgentModelRole),
  kind: Schema.optionalKey(AgentDelegationKind),
  branch: Schema.optionalKey(NonEmpty),
  issueId: Schema.optionalKey(NonEmpty),
});
const TaskStatusArgsSchema = Schema.Struct({
  delegationId: Schema.optionalKey(NonEmpty),
  childThreadId: Schema.optionalKey(NonEmpty),
});
const TaskCancelArgsSchema = Schema.Struct({
  delegationId: NonEmpty,
  reason: Schema.optionalKey(Schema.String),
});
const ThreadListArgsSchema = Schema.Struct({
  projectId: Schema.optionalKey(NonEmpty),
  allProjects: Schema.optionalKey(Schema.Boolean),
  limit: Schema.optionalKey(PosInt),
});
const ThreadReadArgsSchema = Schema.Struct({
  threadId: NonEmpty,
  turnLimit: Schema.optionalKey(PosInt),
});
const AskUserQuestionArgsSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  header: Schema.optionalKey(Schema.String),
  question: NonEmpty,
  options: Schema.Array(
    Schema.Struct({
      label: NonEmpty,
      description: Schema.optionalKey(Schema.String),
    }),
  ).check(Schema.isMinLength(2), Schema.isMaxLength(6)),
  multiSelect: Schema.optionalKey(Schema.Boolean),
  allowCustom: Schema.optionalKey(Schema.Boolean),
});
const AskUserArgsSchema = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  questions: Schema.Array(AskUserQuestionArgsSchema).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(4),
  ),
});

export interface RenderVizResult {
  readonly vizId: string;
  readonly title: string;
  readonly mode: ScuttleVizSpec["mode"];
  readonly threadId: string;
  readonly createdAt?: string | undefined;
}
export interface UpdateVizInput {
  readonly vizId: string;
  readonly title?: string | undefined;
  readonly spec?: ScuttleVizSpec | undefined;
}
export interface UpdateVizResult {
  readonly vizId: string;
  readonly title: string;
  readonly updatedAt?: string | undefined;
}
export interface CapabilitiesResult {
  readonly providers: ReadonlyArray<unknown>;
  readonly performanceHighlights?: ReadonlyArray<string> | undefined;
}
export type DelegateTaskMcpInput = typeof DelegateTaskArgsSchema.Type;
export interface DelegateTaskMcpResult {
  readonly delegationId: string;
  readonly childThreadId: string;
  readonly status: string;
}
export interface TaskTelemetry {
  readonly tokensPerSecond: number;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number | undefined;
  readonly firstTokenMs?: number | undefined;
}
export interface TaskStatusMcpResult {
  readonly delegationId: string;
  readonly childThreadId: string;
  readonly status: string;
  readonly title?: string | undefined;
  readonly model?: string | undefined;
  readonly providerId?: string | undefined;
  readonly summary?: string | undefined;
  readonly telemetry?: TaskTelemetry | undefined;
}
export type TaskStatusQueryInput = typeof TaskStatusArgsSchema.Type;
export type CancelTaskMcpInput = typeof TaskCancelArgsSchema.Type;
export type ListThreadsMcpInput = typeof ThreadListArgsSchema.Type;
export type ReadThreadMcpInput = typeof ThreadReadArgsSchema.Type;
export type AskUserMcpInput = typeof AskUserArgsSchema.Type;
export interface AskUserMcpResult {
  readonly answered: boolean;
  readonly dismissed: boolean;
  readonly answers: UserInputAnswers;
}

export interface ScuttleMcpDeps {
  readonly renderViz: (
    ctx: McpSessionContext,
    spec: ScuttleVizSpec,
  ) => MaybePromise<RenderVizResult>;
  readonly updateViz: (
    ctx: McpSessionContext,
    input: UpdateVizInput,
  ) => MaybePromise<UpdateVizResult>;
  readonly recordPerf: (
    ctx: McpSessionContext,
    input: RateModelRunInput,
  ) => MaybePromise<ModelPerfRun>;
  readonly queryPerf: (
    ctx: McpSessionContext,
    input: ModelPerfQueryInput,
  ) => MaybePromise<ModelPerformanceSummary>;
  readonly getCapabilities: (
    ctx: McpSessionContext,
    input: typeof CapabilitiesArgsSchema.Type,
  ) => MaybePromise<CapabilitiesResult>;
  readonly delegateTask: (
    ctx: McpSessionContext,
    input: DelegateTaskMcpInput,
  ) => MaybePromise<DelegateTaskMcpResult>;
  readonly getTaskStatus: (
    ctx: McpSessionContext,
    input: TaskStatusQueryInput,
  ) => MaybePromise<TaskStatusMcpResult>;
  readonly cancelTask: (
    ctx: McpSessionContext,
    input: CancelTaskMcpInput,
  ) => MaybePromise<{ readonly delegationId: string; readonly status: string }>;
  readonly listThreads: (
    ctx: McpSessionContext,
    input: ListThreadsMcpInput,
  ) => MaybePromise<unknown>;
  readonly readThread: (ctx: McpSessionContext, input: ReadThreadMcpInput) => MaybePromise<unknown>;
  readonly askUser: (
    ctx: McpSessionContext,
    input: AskUserMcpInput,
  ) => MaybePromise<AskUserMcpResult>;
}

export interface ScuttleMcpServerOptions {
  readonly registry: McpSessionRegistry;
  readonly deps: ScuttleMcpDeps;
}

const JsonRpcRequestSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number, Schema.Null])),
  method: NonEmpty,
  params: Schema.optionalKey(Schema.Unknown),
});
const ToolCallParamsSchema = Schema.Struct({
  name: NonEmpty,
  arguments: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
const UpdateVizArgsSchema = Schema.Struct({
  vizId: NonEmpty,
  title: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  spec: Schema.optionalKey(Schema.Unknown),
});

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const decodeVizSpecWithHint = (raw: unknown): ScuttleVizSpec => {
  try {
    return Schema.decodeUnknownSync(ScuttleVizSpec)(raw);
  } catch (error) {
    throw new Error(
      `Invalid ScuttleVizSpec: ${formatErrorMessage(error)}. Use mode: "structured" with title and blocks/tabs (using semantic tones: neutral, primary, success, warning, danger), or mode: "sandbox" with title and html.`,
    );
  }
};

const jsonRpcSuccess = (
  id: string | number | null,
  result: unknown,
  headers?: Record<string, string>,
): Response =>
  Response.json({ jsonrpc: "2.0", id, result }, { status: 200, ...(headers ? { headers } : {}) });

const jsonRpcError = (
  id: string | number | null,
  code: number,
  message: string,
  status: number,
  headers?: Record<string, string>,
): Response =>
  Response.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status, ...(headers ? { headers } : {}) },
  );

const toToolResult = (payload: unknown, isError = false): Record<string, unknown> => ({
  content: [
    { type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) },
  ],
  structuredContent: typeof payload === "string" ? { error: payload } : payload,
  isError,
});

class UnknownToolError extends Error {
  constructor(toolName: string) {
    super(`Unknown MCP tool: ${toolName}`);
  }
}

const dispatchToolCall = async (
  name: string,
  args: Record<string, unknown>,
  ctx: McpSessionContext,
  deps: ScuttleMcpDeps,
): Promise<unknown> => {
  switch (name) {
    case "scuttle_viz_render": {
      const rawSpec = "spec" in args && args.spec !== undefined ? args.spec : args;
      return await deps.renderViz(ctx, decodeVizSpecWithHint(rawSpec));
    }
    case "scuttle_viz_update": {
      const parsed = Schema.decodeUnknownSync(UpdateVizArgsSchema)(args);
      if (parsed.title === undefined && parsed.spec === undefined) {
        throw new Error("scuttle_viz_update requires at least one of 'title' or 'spec'.");
      }
      const spec = parsed.spec !== undefined ? decodeVizSpecWithHint(parsed.spec) : undefined;
      return await deps.updateViz(ctx, {
        vizId: parsed.vizId,
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(spec !== undefined ? { spec } : {}),
      });
    }
    case "scuttle_perf_record": {
      const hasLookup =
        args.runId !== undefined ||
        args.turnId !== undefined ||
        args.delegationId !== undefined ||
        args.threadId !== undefined;
      const enriched: Record<string, unknown> = hasLookup
        ? args
        : {
            ...args,
            threadId: ctx.threadId,
            ...(ctx.delegationId !== undefined ? { delegationId: ctx.delegationId } : {}),
            ...(ctx.providerId !== undefined && args.providerId === undefined
              ? { providerId: ctx.providerId }
              : {}),
          };
      return await deps.recordPerf(ctx, Schema.decodeUnknownSync(RateModelRunInput)(enriched));
    }
    case "scuttle_perf_query":
      return await deps.queryPerf(ctx, Schema.decodeUnknownSync(ModelPerfQueryInput)(args));
    case "scuttle_capabilities":
      return await deps.getCapabilities(
        ctx,
        Schema.decodeUnknownSync(CapabilitiesArgsSchema)(args),
      );
    case "scuttle_delegate_task":
      return await deps.delegateTask(ctx, Schema.decodeUnknownSync(DelegateTaskArgsSchema)(args));
    case "scuttle_task_status": {
      const input = Schema.decodeUnknownSync(TaskStatusArgsSchema)(args);
      if (input.delegationId === undefined && input.childThreadId === undefined) {
        throw new Error("scuttle_task_status requires 'delegationId' or 'childThreadId'.");
      }
      return await deps.getTaskStatus(ctx, input);
    }
    case "scuttle_task_cancel":
      return await deps.cancelTask(ctx, Schema.decodeUnknownSync(TaskCancelArgsSchema)(args));
    case "scuttle_thread_list":
      return await deps.listThreads(ctx, Schema.decodeUnknownSync(ThreadListArgsSchema)(args));
    case "scuttle_thread_read":
      return await deps.readThread(ctx, Schema.decodeUnknownSync(ThreadReadArgsSchema)(args));
    case "scuttle_ask_user":
      return await deps.askUser(ctx, Schema.decodeUnknownSync(AskUserArgsSchema)(args));
    default:
      throw new UnknownToolError(name);
  }
};

export const createScuttleMcpHandler = (
  options: ScuttleMcpServerOptions,
): ((req: Request) => Promise<Response>) => {
  const { registry, deps } = options;

  return async (req: Request): Promise<Response> => {
    const session = registry.verifyAuthorization(req.headers.get("authorization"));
    if (session === null) {
      return jsonRpcError(null, -32001, "Unauthorized: missing or invalid Bearer token.", 401);
    }

    const method = req.method.toUpperCase();
    const mcpSessionId = req.headers.get("mcp-session-id") ?? Crypto.randomUUID();
    const responseHeaders = { "mcp-session-id": mcpSessionId };

    if (method === "DELETE") {
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    if (method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "POST, DELETE", ...responseHeaders },
      });
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return jsonRpcError(null, -32700, "Parse error: invalid JSON payload.", 400, responseHeaders);
    }

    let rpcRequest: typeof JsonRpcRequestSchema.Type;
    try {
      rpcRequest = Schema.decodeUnknownSync(JsonRpcRequestSchema)(rawBody);
    } catch (error) {
      const rawId =
        isPlainRecord(rawBody) &&
        (typeof rawBody.id === "string" || typeof rawBody.id === "number" || rawBody.id === null)
          ? rawBody.id
          : null;
      return jsonRpcError(
        rawId,
        -32600,
        `Invalid Request: ${formatErrorMessage(error)}`,
        400,
        responseHeaders,
      );
    }

    if (rpcRequest.id === undefined || rpcRequest.method === "notifications/initialized") {
      return new Response(null, { status: 202, headers: responseHeaders });
    }

    const requestId = rpcRequest.id;
    switch (rpcRequest.method) {
      case "initialize":
        return jsonRpcSuccess(
          requestId,
          {
            protocolVersion: "2025-03-26",
            serverInfo: { name: "scuttle", version: "1.0.0" },
            capabilities: { tools: {} },
          },
          responseHeaders,
        );
      case "ping":
        return jsonRpcSuccess(requestId, {}, responseHeaders);
      case "tools/list":
        return jsonRpcSuccess(requestId, { tools: SCUTTLE_MCP_TOOLS }, responseHeaders);
      case "tools/call": {
        let callParams: typeof ToolCallParamsSchema.Type;
        try {
          callParams = Schema.decodeUnknownSync(ToolCallParamsSchema)(rpcRequest.params ?? {});
        } catch (error) {
          return jsonRpcError(
            requestId,
            -32602,
            `Invalid tools/call params: ${formatErrorMessage(error)}`,
            200,
            responseHeaders,
          );
        }
        try {
          const result = await dispatchToolCall(
            callParams.name,
            callParams.arguments ?? {},
            session,
            deps,
          );
          return jsonRpcSuccess(requestId, toToolResult(result, false), responseHeaders);
        } catch (error) {
          if (error instanceof UnknownToolError) {
            return jsonRpcError(requestId, -32602, error.message, 200, responseHeaders);
          }
          return jsonRpcSuccess(
            requestId,
            toToolResult(formatErrorMessage(error), true),
            responseHeaders,
          );
        }
      }
      default:
        return jsonRpcError(
          requestId,
          -32601,
          `Method not found: ${rpcRequest.method}`,
          200,
          responseHeaders,
        );
    }
  };
};
