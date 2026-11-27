import type { Database } from "bun:sqlite";
import * as C from "@scuttle/contracts";
import * as Ids from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as AgentService from "../services/AgentService.ts";
import { readAgentIdForThread } from "../services/agent/agentWorkStore.ts";
import * as EventBus from "../services/EventBus.ts";
import * as ModelPerformanceService from "../services/ModelPerformanceService.ts";
import { readScopedModelTierConfigs } from "../services/ModelTierService.ts";
import * as ProviderService from "../services/ProviderService.ts";
import * as ThreadService from "../services/ThreadService.ts";
import * as VisualizationStore from "../services/VisualizationStore.ts";
import type { McpSessionContext } from "./McpSessionRegistry.ts";
import type { DelegateTaskMcpInput, ScuttleMcpDeps } from "./ScuttleMcpServer.ts";

type DelRow = {
  id: string;
  agent_id: string | null;
  child_thread_id: string;
  title: string;
  status: string;
  model_selection_json: string;
  result_summary: string | null;
};
const run = Effect.runPromise;
const DEL_SQL =
  "SELECT id, agent_id, child_thread_id, title, status, model_selection_json, result_summary FROM agent_delegations";

const snapSel = (
  s: C.ProviderSnapshot,
  m?: string,
  eff?: C.ModelSelection["effort"],
): C.ModelSelection => ({
  providerId: s.id,
  providerKind: s.kind,
  model: m ?? s.defaultModel ?? s.models[0]?.slug ?? "default",
  ...((eff ?? s.defaultEffort) ? { effort: eff ?? s.defaultEffort } : {}),
});

const pickSel = (
  db: Database,
  ctx: McpSessionContext,
  input: DelegateTaskMcpInput,
  snaps: ReadonlyArray<C.ProviderSnapshot>,
) => {
  const on = snaps.filter((p) => p.enabled);
  if (input.providerId || input.model) {
    const s = input.providerId
      ? on.find((p) => p.id === input.providerId)
      : (on.find((p) => p.models.some((m) => m.slug === input.model)) ??
        on.find((p) => p.id === ctx.providerId) ??
        on[0]);
    if (!s)
      throw new Error(
        input.providerId ? `Provider "${input.providerId}" unavailable.` : "No enabled provider.",
      );
    return snapSel(s, input.model, input.effort);
  }
  if (!input.role) return undefined;
  const r = C.resolveModelForRole(
    C.resolveEffectiveModelTiers(readScopedModelTierConfigs(db), {
      projectId: ctx.projectId,
      ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
    }),
    input.role,
  );
  return r && input.effort ? { ...r, effort: input.effort } : r;
};

const parseSel = (raw?: string): { model?: string; providerId?: string } => {
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (typeof v !== "object" || v === null) return {};
    const m = Reflect.get(v, "model"),
      p = Reflect.get(v, "providerId");
    return {
      ...(typeof m === "string" ? { model: m } : {}),
      ...(typeof p === "string" ? { providerId: p } : {}),
    };
  } catch {
    return {};
  }
};

const findDel = (db: Database, delId?: string, childId?: string) =>
  delId
    ? db.query<DelRow, [string]>(`${DEL_SQL} WHERE id = ? LIMIT 1`).get(delId)
    : childId
      ? db
          .query<DelRow, [string]>(
            `${DEL_SQL} WHERE child_thread_id = ? ORDER BY created_at DESC LIMIT 1`,
          )
          .get(childId)
      : null;

export const buildScuttleMcpDeps = Effect.gen(function* () {
  const [{ db }, eventBus, perfSvc, provSvc, threadSvc, agentSvc] = yield* Effect.all([
    Sqlite.SqliteDatabase,
    EventBus.EventBus,
    ModelPerformanceService.ModelPerformanceService,
    ProviderService.ProviderService,
    ThreadService.ThreadService,
    AgentService.AgentService,
  ]);

  const saveViz = (tid: string, spec: C.ScuttleVizSpec, id?: string, title?: string) => {
    const t = id
      ? null
      : db
          .query<{ id: string }, [string]>(
            "SELECT id FROM turns WHERE thread_id = ? AND status = 'running' ORDER BY seq DESC LIMIT 1",
          )
          .get(tid);
    return VisualizationStore.upsertVisualization(
      db,
      {
        threadId: Ids.ThreadId.make(tid),
        spec,
        ...(id ? { id: C.VisualizationId.make(id) } : {}),
        ...(t ? { turnId: Ids.TurnId.make(t.id) } : {}),
        ...(title !== undefined ? { title } : {}),
      },
      eventBus,
    );
  };

  return {
    renderViz: (ctx, spec) => {
      const v = saveViz(ctx.threadId, spec);
      return {
        vizId: v.id,
        title: v.title,
        mode: v.spec.mode,
        threadId: v.threadId,
        createdAt: v.createdAt,
      };
    },
    updateViz: (ctx, input) => {
      const row = db
        .query<{ spec_json: string }, [string, string]>(
          "SELECT spec_json FROM thread_visualizations WHERE id = ? AND thread_id = ?",
        )
        .get(input.vizId, ctx.threadId);
      if (!row) throw new Error(`Visualization "${input.vizId}" was not found.`);
      let spec = input.spec;
      if (!spec) {
        const dec = C.decodeScuttleVizSpec(JSON.parse(row.spec_json));
        if (Exit.isFailure(dec)) throw new Error("Stored visualization spec is invalid.");
        spec = dec.value;
      }
      const v = saveViz(ctx.threadId, spec, input.vizId, input.title);
      return { vizId: v.id, title: v.title, updatedAt: v.updatedAt };
    },
    recordPerf: (_ctx, input) => {
      const c =
        input.delegationId && !input.threadId
          ? findDel(db, input.delegationId)?.child_thread_id
          : undefined;
      return run(perfSvc.rateRun(c ? { ...input, threadId: c } : input));
    },
    queryPerf: (_ctx, input) => run(perfSvc.querySummary(input)),
    getCapabilities: async (_ctx, input) => {
      const [snaps, sum] = await Promise.all([
        run(provSvc.listSnapshots()),
        run(
          perfSvc.querySummary({
            ...(input.category ? { category: input.category } : {}),
            limit: 10,
          }),
        ),
      ]);
      return { providers: snaps.filter((p) => p.enabled), performanceHighlights: sum.summaryLines };
    },
    delegateTask: async (ctx, input) => {
      const snaps = await run(provSvc.listSnapshots());
      const sel = pickSel(db, ctx, input, snaps);
      const agentId = ctx.agentId ?? readAgentIdForThread(db, ctx.threadId) ?? undefined;
      const d = agentId
        ? await run(
            agentSvc.delegateTask(Ids.AgentId.make(agentId), {
              role: input.role ?? "medium",
              kind: input.kind ?? "task",
              title: input.title,
              brief: input.brief,
              ...(input.runtime ? { runtime: input.runtime } : {}),
              ...(input.issueId ? { issueId: Ids.AgentIssueId.make(input.issueId) } : {}),
              ...(sel ? { modelSelection: sel } : {}),
            }),
          )
        : await run(
            agentSvc.delegateFromThread(Ids.ThreadId.make(ctx.threadId), {
              role: input.role ?? "medium",
              kind: input.kind ?? "task",
              title: input.title,
              brief: input.brief,
              ...(input.runtime ? { runtime: input.runtime } : {}),
              ...(sel ? { modelSelection: sel } : {}),
            }),
          );
      return { delegationId: d.id, childThreadId: d.childThreadId, status: d.status };
    },
    getTaskStatus: async (_ctx, input) => {
      const aRow = findDel(db, input.delegationId, input.childThreadId);
      const childId = aRow?.child_thread_id ?? input.childThreadId;
      if (!childId) throw new Error("Delegation or child thread not found.");
      const delId = aRow?.id ?? input.delegationId ?? childId;
      const detail = await run(threadSvc.getDetail(Ids.ThreadId.make(childId))).catch(() => null);
      const turn = detail?.turns.at(-1);
      const r = await run(
        perfSvc.getRunByTurnOrDelegation({
          ...(aRow ? { delegationId: delId } : {}),
          ...(turn ? { turnId: turn.id } : {}),
          threadId: childId,
        }),
      );
      const sel = aRow ? parseSel(aRow.model_selection_json) : detail?.thread.modelSelection;
      const status = aRow?.status ?? detail?.thread.status.kind ?? "unknown";
      return {
        delegationId: delId,
        childThreadId: childId,
        status,
        title: aRow?.title ?? detail?.thread.title,
        model: sel?.model,
        providerId: sel?.providerId,
        summary:
          aRow?.result_summary ??
          (turn?.assistantMessage.trim() || turn?.error?.trim() || undefined),
        telemetry: r
          ? {
              tokensPerSecond: r.tokensPerSecond,
              durationMs: r.durationMs,
              costUsd: r.costUsd,
              inputTokens: r.inputTokens,
              outputTokens: r.outputTokens,
              cacheReadTokens: r.cacheReadTokens,
              firstTokenMs: r.firstTokenMs,
            }
          : undefined,
      };
    },
    cancelTask: async (_ctx, input) => {
      const c = await run(
        agentSvc.cancelDelegationById(Ids.AgentDelegationId.make(input.delegationId)),
      );
      return { delegationId: c.id, status: c.status };
    },
    listThreads: async (ctx, input) => {
      const all = await run(threadSvc.list());
      const pid = input.allProjects ? null : (input.projectId ?? ctx.projectId);
      return {
        projectId: pid,
        threads: (pid ? all.filter((t) => t.projectId === pid) : all).slice(0, input.limit ?? 20),
      };
    },
    readThread: async (_ctx, input) => {
      const d = await run(threadSvc.getDetail(Ids.ThreadId.make(input.threadId)));
      return {
        threadId: d.thread.id,
        title: d.thread.title,
        status: d.thread.status.kind,
        turns: d.turns.slice(-(input.turnLimit ?? 10)),
      };
    },
    askUser: (ctx, input) => run(threadSvc.askUser(Ids.ThreadId.make(ctx.threadId), input)),
  } satisfies ScuttleMcpDeps;
});
