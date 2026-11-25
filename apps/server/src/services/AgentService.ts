import type {
  Agent,
  AgentCheckIn,
  AgentDelegation,
  AgentDetail,
  AgentIssue,
  AgentMemory,
  AssignAgentIssueInput,
  AssignAgentIssueResult,
  CreateAgentInput,
  CreateIssueInput,
  CreateMemoryInput,
  DelegateAgentTaskInput,
  ModelSelection,
  Project,
  SendTurnInput,
  SetupAgentStartInput,
  ThreadTurn,
  TriggerCheckInInput,
  TurnOrigin,
  UpdateAgentInput,
  UpdateIssueInput,
  UpdateMemoryInput,
} from "@scuttle/contracts";
import {
  type AgentDelegationId,
  AgentId,
  type AgentIssueId,
  type AgentMemoryId,
  ProjectId,
} from "@scuttle/shared/ids";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as EventBus from "./EventBus.ts";
import * as GitForgeService from "./GitForgeService.ts";
import * as GitService from "./GitService.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProviderService from "./ProviderService.ts";
import * as ThreadService from "./ThreadService.ts";
import { makeAgentDelegationOps } from "./agent/agentDelegationOps.ts";
import { makeAgentIssueOps } from "./agent/agentIssueOps.ts";
import { makeAgentMemoryOps } from "./agent/agentMemoryOps.ts";
import {
  buildAgentContextBlock,
  buildSetupStartPrompt,
  defaultInstructionsMd,
  formatAgentName,
  pickDefaultModelSelection,
} from "./agent/agentPrompts.ts";
import {
  deleteAgentRow,
  insertAgent,
  listAgents,
  listCheckIns,
  listMemories,
  listProjectsMissingAgents,
  readAgentById,
  updateAgentRow,
} from "./agent/agentStore.ts";
import { listDelegations, listIssues, recoverStaleDelegations } from "./agent/agentWorkStore.ts";
import { AgentServiceError } from "./agent/errors.ts";
import type { FetchFn } from "./gitForge/forgeHttp.ts";
import { type CommandRunner, runCommand } from "./gitForge/processRunner.ts";

export { AgentServiceError } from "./agent/errors.ts";

export interface AgentServiceOptions {
  readonly runner: CommandRunner;
  readonly fetch: FetchFn;
}

const DEFAULT_OPTIONS: AgentServiceOptions = {
  runner: runCommand,
  fetch: (input, init) => fetch(input, init),
};

export class AgentService extends Context.Service<
  AgentService,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Agent>>;
    readonly getDetail: (agentId: AgentId) => Effect.Effect<AgentDetail, AgentServiceError>;
    readonly create: (input: CreateAgentInput) => Effect.Effect<Agent, AgentServiceError>;
    readonly update: (
      agentId: AgentId,
      input: UpdateAgentInput,
    ) => Effect.Effect<Agent, AgentServiceError>;
    readonly remove: (agentId: AgentId) => Effect.Effect<void, AgentServiceError>;
    readonly sendTurn: (
      agentId: AgentId,
      input: SendTurnInput,
      options?: { readonly origin?: TurnOrigin },
    ) => Effect.Effect<ThreadTurn, AgentServiceError>;
    readonly startSetup: (
      agentId: AgentId,
      input?: SetupAgentStartInput,
    ) => Effect.Effect<ThreadTurn, AgentServiceError>;
    readonly buildAgentContext: (
      agentId: AgentId,
      query?: string,
    ) => Effect.Effect<string, AgentServiceError>;
    readonly listMemories: (
      agentId: AgentId,
      query?: string,
    ) => Effect.Effect<ReadonlyArray<AgentMemory>, AgentServiceError>;
    readonly searchMemories: (
      agentId: AgentId,
      query: string,
      limit?: number,
    ) => Effect.Effect<ReadonlyArray<AgentMemory>, AgentServiceError>;
    readonly createMemory: (
      agentId: AgentId,
      input: CreateMemoryInput,
    ) => Effect.Effect<AgentMemory, AgentServiceError>;
    readonly updateMemory: (
      agentId: AgentId,
      memoryId: AgentMemoryId,
      input: UpdateMemoryInput,
    ) => Effect.Effect<AgentMemory, AgentServiceError>;
    readonly deleteMemory: (
      agentId: AgentId,
      memoryId: AgentMemoryId,
    ) => Effect.Effect<void, AgentServiceError>;
    readonly listIssues: (
      agentId: AgentId,
    ) => Effect.Effect<ReadonlyArray<AgentIssue>, AgentServiceError>;
    readonly createIssue: (
      agentId: AgentId,
      input: CreateIssueInput,
    ) => Effect.Effect<AgentIssue, AgentServiceError>;
    readonly updateIssue: (
      agentId: AgentId,
      issueId: AgentIssueId,
      input: UpdateIssueInput,
    ) => Effect.Effect<AgentIssue, AgentServiceError>;
    readonly deleteIssue: (
      agentId: AgentId,
      issueId: AgentIssueId,
    ) => Effect.Effect<void, AgentServiceError>;
    readonly syncIssues: (
      agentId: AgentId,
    ) => Effect.Effect<ReadonlyArray<AgentIssue>, AgentServiceError>;
    readonly assignIssue: (
      agentId: AgentId,
      issueId: AgentIssueId,
      input?: AssignAgentIssueInput,
    ) => Effect.Effect<AssignAgentIssueResult, AgentServiceError>;
    readonly delegateTask: (
      agentId: AgentId,
      input: DelegateAgentTaskInput,
    ) => Effect.Effect<AgentDelegation, AgentServiceError>;
    readonly cancelDelegation: (
      agentId: AgentId,
      delegationId: AgentDelegationId,
    ) => Effect.Effect<AgentDelegation, AgentServiceError>;
    readonly runCheckIn: (
      agentId: AgentId,
      input?: TriggerCheckInInput,
    ) => Effect.Effect<AgentCheckIn, AgentServiceError>;
  }
>()("scuttle/server/AgentService") {}

export const makeAgentService = (options: AgentServiceOptions = DEFAULT_OPTIONS) =>
  Effect.gen(function* () {
    const { db } = yield* Sqlite.SqliteDatabase;
    const config = yield* ServerConfig.ServerConfig;
    const eventBus = yield* EventBus.EventBus;
    const projects = yield* ProjectService.ProjectService;
    const providers = yield* ProviderService.ProviderService;
    const threads = yield* ThreadService.ThreadService;
    const git = yield* GitService.GitService;
    const gitForge = yield* GitForgeService.GitForgeService;

    recoverStaleDelegations(db);

    const requireAgent = (agentId: AgentId): Effect.Effect<Agent, AgentServiceError> =>
      Effect.sync(() => readAgentById(db, agentId)).pipe(
        Effect.flatMap((agent) =>
          agent !== null
            ? Effect.succeed(agent)
            : Effect.fail(
                new AgentServiceError({
                  reason: "not-found",
                  detail: `Agent "${agentId}" was not found.`,
                }),
              ),
        ),
      );

    const createAgentForProject = Effect.fn("AgentService.createAgentForProject")(
      function* (input: {
        readonly project: Project;
        readonly name: string;
        readonly purpose?: string;
        readonly runtime?: Agent["runtime"];
        readonly modelSelection?: ModelSelection;
        readonly modelStack?: Agent["modelStack"];
        readonly instructionsMd?: string;
        readonly checkInIntervalMinutes?: number;
      }) {
        const snapshots = yield* providers.listSnapshots();
        const modelSelection = input.modelSelection ?? pickDefaultModelSelection(snapshots);
        const runtime = input.runtime ?? "local";
        const primaryThread = yield* threads
          .createIdle({
            projectId: input.project.id,
            title: input.name,
            runtime,
            branch: input.project.defaultBranch,
            modelSelection,
          })
          .pipe(
            Effect.mapError(
              (err) => new AgentServiceError({ reason: "rejected", detail: err.message }),
            ),
          );

        const now = new Date().toISOString();
        const agent: Agent = {
          id: AgentId.make(crypto.randomUUID()),
          projectId: input.project.id,
          projectName: input.project.name,
          projectPath: input.project.path,
          name: input.name,
          purpose: input.purpose?.trim() ?? "",
          primaryThreadId: primaryThread.id,
          runtime,
          modelSelection,
          modelStack: input.modelStack ?? { agent: modelSelection },
          instructionsMd:
            input.instructionsMd !== undefined
              ? input.instructionsMd
              : defaultInstructionsMd(input.name, input.project.name, input.project.path),
          ...(input.checkInIntervalMinutes !== undefined
            ? { checkInIntervalMinutes: input.checkInIntervalMinutes }
            : {}),
          pinned: false,
          needsAttention: false,
          createdAt: now,
          updatedAt: now,
        };
        insertAgent(db, agent);
        eventBus.publishSync({ kind: "agent.upserted", agent });
        return agent;
      },
    );

    const ensureSeeded = Effect.fn("AgentService.ensureSeeded")(function* () {
      const missing = listProjectsMissingAgents(db);
      for (const row of missing) {
        const project = yield* projects.get(ProjectId.make(row.id)).pipe(Effect.option);
        if (project._tag !== "Some") continue;
        yield* createAgentForProject({
          project: project.value,
          name: formatAgentName(project.value.name),
        }).pipe(Effect.ignore);
      }
    });

    const sendTurn = Effect.fn("AgentService.sendTurn")(function* (
      agentId: AgentId,
      input: SendTurnInput,
      options?: { readonly origin?: TurnOrigin },
    ) {
      const agent = yield* requireAgent(agentId);
      return yield* threads
        .sendTurn(agent.primaryThreadId, input, options)
        .pipe(
          Effect.mapError(
            (err) => new AgentServiceError({ reason: "rejected", detail: err.message }),
          ),
        );
    });

    const memoryOps = makeAgentMemoryOps({ db, eventBus, requireAgent });
    const issueOps = makeAgentIssueOps({
      db,
      eventBus,
      git,
      runner: options.runner,
      fetch: options.fetch,
      requireAgent,
    });
    const delegationOps = makeAgentDelegationOps({
      db,
      eventBus,
      projects,
      threads,
      git,
      gitForge,
      requireAgent,
      sendAgentTurn: sendTurn,
    });

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        eventBus.subscribe((event) => {
          if (event.kind === "turn.upserted") {
            delegationOps.handleTurnSettled(event.turn);
          }
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );

    const list = Effect.fn("AgentService.list")(function* () {
      yield* ensureSeeded();
      return listAgents(db);
    });

    const getDetail = Effect.fn("AgentService.getDetail")(function* (agentId: AgentId) {
      yield* ensureSeeded();
      const agent = yield* requireAgent(agentId);
      const primaryThread = yield* threads
        .getDetail(agent.primaryThreadId)
        .pipe(
          Effect.mapError(
            (err) => new AgentServiceError({ reason: "not-found", detail: err.message }),
          ),
        );
      return {
        agent,
        primaryThread,
        memories: listMemories(db, agent.id, 100),
        issues: listIssues(db, agent.id),
        delegations: listDelegations(db, agent.id),
        checkIns: listCheckIns(db, agent.id),
      } satisfies AgentDetail;
    });

    const create = Effect.fn("AgentService.create")(function* (input: CreateAgentInput) {
      if (!input.projectId && !input.path) {
        return yield* new AgentServiceError({
          reason: "invalid",
          detail: "Either projectId or path is required.",
        });
      }
      const project = input.projectId
        ? yield* projects
            .get(input.projectId)
            .pipe(
              Effect.mapError(
                (err) => new AgentServiceError({ reason: "not-found", detail: err.message }),
              ),
            )
        : yield* projects
            .create({ path: input.path! })
            .pipe(
              Effect.mapError(
                (err) => new AgentServiceError({ reason: "invalid", detail: err.message }),
              ),
            );
      const created = yield* createAgentForProject({
        project,
        name: input.name.trim(),
        ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
        ...(input.runtime !== undefined ? { runtime: input.runtime } : {}),
        ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
        ...(input.modelStack !== undefined ? { modelStack: input.modelStack } : {}),
        ...(input.instructionsMd !== undefined ? { instructionsMd: input.instructionsMd } : {}),
        ...(input.checkInIntervalMinutes !== undefined
          ? { checkInIntervalMinutes: input.checkInIntervalMinutes }
          : {}),
      });
      if (input.startOnboarding === true) {
        yield* startSetup(created.id).pipe(Effect.ignore);
      }
      return created;
    });

    const update = Effect.fn("AgentService.update")(function* (
      agentId: AgentId,
      input: UpdateAgentInput,
    ) {
      const existing = yield* requireAgent(agentId);
      const nextInterval =
        input.checkInIntervalMinutes === undefined
          ? existing.checkInIntervalMinutes
          : input.checkInIntervalMinutes === null
            ? undefined
            : input.checkInIntervalMinutes;
      const nextName = input.name?.trim() || existing.name;
      const nextModel = input.modelSelection ?? existing.modelSelection;
      const updated: Agent = {
        id: existing.id,
        projectId: existing.projectId,
        projectName: existing.projectName,
        projectPath: existing.projectPath,
        name: nextName,
        purpose: input.purpose !== undefined ? input.purpose : existing.purpose,
        primaryThreadId: existing.primaryThreadId,
        runtime: input.runtime ?? existing.runtime,
        modelSelection: nextModel,
        modelStack: input.modelStack ?? existing.modelStack,
        instructionsMd:
          input.instructionsMd !== undefined ? input.instructionsMd : existing.instructionsMd,
        ...(nextInterval !== undefined ? { checkInIntervalMinutes: nextInterval } : {}),
        ...(existing.lastCheckInAt !== undefined ? { lastCheckInAt: existing.lastCheckInAt } : {}),
        ...(existing.lastSummary !== undefined ? { lastSummary: existing.lastSummary } : {}),
        pinned: input.pinned ?? existing.pinned,
        needsAttention: input.needsAttention ?? existing.needsAttention,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      if (input.runtime !== undefined && input.runtime !== existing.runtime) {
        yield* threads
          .update(existing.primaryThreadId, { runtime: input.runtime })
          .pipe(
            Effect.mapError(
              (err) => new AgentServiceError({ reason: "rejected", detail: err.message }),
            ),
          );
      }
      updateAgentRow(db, updated);
      if (input.name !== undefined || input.modelSelection !== undefined) {
        yield* threads
          .update(existing.primaryThreadId, { title: nextName, modelSelection: nextModel })
          .pipe(Effect.ignore);
      }
      eventBus.publishSync({ kind: "agent.upserted", agent: updated });
      return updated;
    });

    const remove = Effect.fn("AgentService.remove")(function* (agentId: AgentId) {
      const existing = yield* requireAgent(agentId);
      deleteAgentRow(db, existing.id);
      yield* threads.remove(existing.primaryThreadId).pipe(Effect.ignore);
      eventBus.publishSync({ kind: "agent.deleted", agentId: existing.id });
    });

    const startSetup = Effect.fn("AgentService.startSetup")(function* (
      agentId: AgentId,
      input?: SetupAgentStartInput,
    ) {
      const agent = yield* requireAgent(agentId);
      const prompt = buildSetupStartPrompt(agent, input?.instructions);
      return yield* sendTurn(agentId, { prompt }, { origin: "system" });
    });

    const buildAgentContext = Effect.fn("AgentService.buildAgentContext")(function* (
      agentId: AgentId,
      query = "",
    ) {
      const agent = yield* requireAgent(agentId);
      return buildAgentContextBlock({
        db,
        agent,
        userPrompt: query,
        apiBaseUrl: config.apiBaseUrlRef.url,
      });
    });

    return AgentService.of({
      list,
      getDetail,
      create,
      update,
      remove,
      sendTurn,
      startSetup,
      buildAgentContext,
      listMemories: memoryOps.list,
      searchMemories: memoryOps.search,
      createMemory: memoryOps.create,
      updateMemory: memoryOps.update,
      deleteMemory: memoryOps.remove,
      listIssues: issueOps.list,
      createIssue: issueOps.create,
      updateIssue: issueOps.update,
      deleteIssue: issueOps.remove,
      syncIssues: issueOps.sync,
      assignIssue: delegationOps.assignIssue,
      delegateTask: delegationOps.delegateTask,
      cancelDelegation: delegationOps.cancelDelegation,
      runCheckIn: delegationOps.runCheckIn,
    });
  });

export const layer = (options: AgentServiceOptions = DEFAULT_OPTIONS) =>
  Layer.effect(AgentService, makeAgentService(options));
