import type {
  Agent,
  AgentDelegation,
  AgentDelegationQuestion,
  AgentDetail,
  AskDelegationParentInput,
  CreateAgentInput,
  CreateThreadDelegationInput,
  DelegationLink,
  ModelSelection,
  Project,
  SendTurnInput,
  SetupAgentStartInput,
  TurnOrigin,
  UpdateAgentInput,
} from "@scuttle/contracts";
import { type AgentDelegationId, AgentId, ProjectId, type ThreadId } from "@scuttle/shared/ids";
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
import { makeAgentBounceOps } from "./agent/agentBounceOps.ts";
import { forkCheckInScheduler } from "./agent/agentCheckInScheduler.ts";
import { buildAgentContextBlock } from "./agent/agentContext.ts";
import { makeAgentDelegationOps } from "./agent/agentDelegationOps.ts";
import { makeAgentIssueOps } from "./agent/agentIssueOps.ts";
import { makeAgentMemoryOps } from "./agent/agentMemoryOps.ts";
import {
  buildSetupStartPrompt,
  defaultInstructionsMd,
  formatAgentName,
  pickDefaultModelSelection,
} from "./agent/agentPrompts.ts";
import type { AgentServiceShape } from "./agent/agentServiceTypes.ts";
import {
  buildUpdatedAgent,
  deleteAgentRow,
  insertAgent,
  listAgents,
  listCheckIns,
  listMemories,
  listProjectsMissingAgents,
  readAgentById,
  updateAgentRow,
} from "./agent/agentStore.ts";
import {
  listActiveDelegationLinks,
  listDelegations,
  listDelegationsByParentThread,
  listIssues,
  readDelegationByDelegationId,
  recoverStaleDelegations,
} from "./agent/agentWorkStore.ts";
import { readThreadById } from "./threadStore.ts";
import { AgentServiceError } from "./agent/errors.ts";
import type { FetchFn } from "./gitForge/forgeHttp.ts";
import { type CommandRunner, runCommand } from "./gitForge/processRunner.ts";

export { AgentServiceError } from "./agent/errors.ts";

export interface UnifiedAgentServiceShape extends AgentServiceShape {
  readonly listActiveDelegationLinks: () => Effect.Effect<ReadonlyArray<DelegationLink>>;
  readonly listThreadDelegations: (
    parentThreadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<AgentDelegation>, AgentServiceError>;
  readonly delegateFromThread: (
    parentThreadId: ThreadId,
    input: CreateThreadDelegationInput,
  ) => Effect.Effect<AgentDelegation, AgentServiceError>;
  readonly getDelegation: (
    delegationId: AgentDelegationId,
  ) => Effect.Effect<AgentDelegation, AgentServiceError>;
  readonly cancelDelegationById: (
    delegationId: AgentDelegationId,
  ) => Effect.Effect<AgentDelegation, AgentServiceError>;
  readonly askParentByDelegation: (
    delegationId: AgentDelegationId,
    input: AskDelegationParentInput,
    options?: { readonly signal?: AbortSignal },
  ) => Effect.Effect<AgentDelegationQuestion, AgentServiceError>;
  readonly listDelegationQuestionsById: (
    delegationId: AgentDelegationId,
  ) => Effect.Effect<ReadonlyArray<AgentDelegationQuestion>, AgentServiceError>;
}

export interface AgentServiceOptions {
  readonly runner: CommandRunner;
  readonly fetch: FetchFn;
  readonly enableCheckInScheduler?: boolean;
  readonly askParentTimeoutMs?: number;
}

const DEFAULT_OPTIONS: AgentServiceOptions = {
  runner: runCommand,
  fetch: (input, init) => fetch(input, init),
  enableCheckInScheduler: true,
};

const toRejectedError = (err: { readonly message: string }) =>
  new AgentServiceError({ reason: "rejected", detail: err.message });

const toNotFoundError = (err: { readonly message: string }) =>
  new AgentServiceError({ reason: "not-found", detail: err.message });

export class AgentService extends Context.Service<AgentService, UnifiedAgentServiceShape>()(
  "scuttle/server/AgentService",
) {}

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
        readonly identiconStyle?: Agent["identiconStyle"];
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
          .pipe(Effect.mapError(toRejectedError));

        const now = new Date().toISOString();
        const agent: Agent = {
          id: AgentId.make(crypto.randomUUID()),
          projectId: input.project.id,
          projectName: input.project.name,
          projectPath: input.project.path,
          name: input.name,
          ...(input.identiconStyle !== undefined ? { identiconStyle: input.identiconStyle } : {}),
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

    const sendThreadTurn = Effect.fn("AgentService.sendThreadTurn")(function* (
      threadId: ThreadId,
      input: SendTurnInput,
      turnOptions?: { readonly origin?: TurnOrigin },
    ) {
      return yield* threads
        .sendTurn(threadId, input, turnOptions)
        .pipe(Effect.mapError(toRejectedError));
    });

    const sendTurn = Effect.fn("AgentService.sendTurn")(function* (
      agentId: AgentId,
      input: SendTurnInput,
      turnOptions?: { readonly origin?: TurnOrigin },
    ) {
      const agent = yield* requireAgent(agentId);
      return yield* sendThreadTurn(agent.primaryThreadId, input, turnOptions);
    });

    const memoryOps = makeAgentMemoryOps({ db, eventBus, requireAgent });
    const issueOps = makeAgentIssueOps({
      db,
      eventBus,
      git,
      runner: options.runner,
      fetch: options.fetch,
      requireAgent,
      sendAgentTurn: sendTurn,
    });
    const bounceOps = makeAgentBounceOps({
      db,
      eventBus,
      requireAgent,
      sendThreadTurn,
      interruptThreadTurn: threads.interrupt,
      ...(options.askParentTimeoutMs !== undefined
        ? { askParentTimeoutMs: options.askParentTimeoutMs }
        : {}),
    });
    const delegationOps = makeAgentDelegationOps({
      db,
      eventBus,
      projects,
      providers,
      threads,
      git,
      gitForge,
      requireAgent,
      sendAgentTurn: sendTurn,
      bounceOps,
    });

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        eventBus.subscribe((event) => {
          if (event.kind === "turn.upserted") {
            delegationOps.handleTurnSettled(event.turn);
          }
        }),
      ),
      (unsubscribe) =>
        Effect.sync(() => {
          unsubscribe();
          bounceOps.dispose();
        }),
    );

    if (options.enableCheckInScheduler ?? true) {
      yield* forkCheckInScheduler({
        listAgents: () => listAgents(db),
        runCheckIn: delegationOps.runCheckIn,
      });
    }

    const list = Effect.fn("AgentService.list")(function* () {
      yield* ensureSeeded();
      return listAgents(db);
    });

    const getDetail = Effect.fn("AgentService.getDetail")(function* (agentId: AgentId) {
      yield* ensureSeeded();
      const agent = yield* requireAgent(agentId);
      const primaryThread = yield* threads
        .getDetail(agent.primaryThreadId)
        .pipe(Effect.mapError(toNotFoundError));
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
        ? yield* projects.get(input.projectId).pipe(Effect.mapError(toNotFoundError))
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
        ...(input.identiconStyle !== undefined ? { identiconStyle: input.identiconStyle } : {}),
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
      const updated = buildUpdatedAgent(existing, input);
      const runtimeChanged = input.runtime !== undefined && input.runtime !== existing.runtime;
      const nameChanged = input.name !== undefined && updated.name !== existing.name;
      const modelProvided = input.modelSelection !== undefined;
      if (runtimeChanged || nameChanged || modelProvided) {
        yield* threads
          .update(existing.primaryThreadId, {
            ...(runtimeChanged ? { runtime: updated.runtime } : {}),
            ...(nameChanged ? { title: updated.name } : {}),
            ...(modelProvided ? { modelSelection: updated.modelSelection } : {}),
          })
          .pipe(Effect.mapError(toRejectedError));
      }
      updateAgentRow(db, updated);
      eventBus.publishSync({ kind: "agent.upserted", agent: updated });
      return updated;
    });

    const remove = Effect.fn("AgentService.remove")(function* (agentId: AgentId) {
      const existing = yield* requireAgent(agentId);
      bounceOps.cancelPendingForAgent(existing.id, "Agent was deleted.");
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
      listAllIssues: issueOps.listAll,
      listIssues: issueOps.list,
      listIssueActivities: issueOps.listActivities,
      createIssue: issueOps.create,
      updateIssue: issueOps.update,
      addIssueComment: issueOps.addComment,
      deleteIssue: issueOps.remove,
      syncIssues: issueOps.sync,
      assignIssue: delegationOps.assignIssue,
      delegateTask: delegationOps.delegateTask,
      cancelDelegation: delegationOps.cancelDelegation,
      askParent: bounceOps.askParent,
      listDelegationQuestions: bounceOps.listQuestions,
      runCheckIn: delegationOps.runCheckIn,
      listActiveDelegationLinks: () => Effect.sync(() => listActiveDelegationLinks(db)),
      listThreadDelegations: (parentThreadId) =>
        readThreadById(db, parentThreadId)
          ? Effect.sync(() => listDelegationsByParentThread(db, parentThreadId))
          : Effect.fail(
              new AgentServiceError({
                reason: "not-found",
                detail: `Thread "${parentThreadId}" was not found.`,
              }),
            ),
      delegateFromThread: delegationOps.delegateFromThread,
      getDelegation: (delegationId) => {
        const delegation = readDelegationByDelegationId(db, delegationId);
        return delegation
          ? Effect.succeed(delegation)
          : Effect.fail(
              new AgentServiceError({
                reason: "not-found",
                detail: `Delegation "${delegationId}" was not found.`,
              }),
            );
      },
      cancelDelegationById: delegationOps.cancelDelegationById,
      askParentByDelegation: bounceOps.askParentByDelegation,
      listDelegationQuestionsById: bounceOps.listDelegationQuestionsById,
    });
  });

export const layer = (options: AgentServiceOptions = DEFAULT_OPTIONS) =>
  Layer.effect(AgentService, makeAgentService(options));
