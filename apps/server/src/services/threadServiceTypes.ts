import type {
  CompactThreadInput,
  CompactThreadResult,
  CreateThreadInput,
  EditQueuedTurnInput,
  QueuedTurn,
  RespondApprovalInput,
  RewindThreadInput,
  RewindThreadResult,
  SendTurnInput,
  SendTurnResult,
  Thread,
  ThreadDetail,
  ThreadTurn,
  ThreadVisualization,
  TurnOrigin,
  UpdateThreadInput,
  UserInputAnswers,
} from "@scuttle/contracts";
import type { ApprovalId, ThreadId, TurnId } from "@scuttle/shared/ids";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class ThreadServiceError extends Schema.TaggedError<ThreadServiceError>()(
  "ThreadServiceError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface AskUserOptionInput {
  readonly label: string;
  readonly description?: string | undefined;
}

export interface AskUserQuestionInput {
  readonly id?: string | undefined;
  readonly header?: string | undefined;
  readonly question: string;
  readonly options: ReadonlyArray<AskUserOptionInput>;
  readonly multiSelect?: boolean | undefined;
  readonly allowCustom?: boolean | undefined;
}

export interface AskUserInput {
  readonly title?: string | undefined;
  readonly questions: ReadonlyArray<AskUserQuestionInput>;
}

export interface AskUserResult {
  readonly answered: boolean;
  readonly dismissed: boolean;
  readonly answers: UserInputAnswers;
}

export interface ThreadServiceShape {
  readonly list: () => Effect.Effect<ReadonlyArray<Thread>>;
  readonly getDetail: (threadId: ThreadId) => Effect.Effect<ThreadDetail, ThreadServiceError>;
  readonly create: (input: CreateThreadInput) => Effect.Effect<ThreadDetail, ThreadServiceError>;
  readonly createIdle: (input: {
    readonly projectId: CreateThreadInput["projectId"];
    readonly title: string;
    readonly runtime: CreateThreadInput["runtime"];
    readonly branch: string;
    readonly modelSelection: CreateThreadInput["modelSelection"];
    readonly runtimeMode?: CreateThreadInput["runtimeMode"];
    readonly interactionMode?: CreateThreadInput["interactionMode"];
    readonly setupWorktree?: boolean;
  }) => Effect.Effect<Thread, ThreadServiceError>;
  readonly sendTurn: (
    threadId: ThreadId,
    input: SendTurnInput,
    options?: { readonly origin?: TurnOrigin },
  ) => Effect.Effect<ThreadTurn, ThreadServiceError>;
  readonly dispatchTurn: (
    threadId: ThreadId,
    input: SendTurnInput,
    options?: { readonly origin?: TurnOrigin },
  ) => Effect.Effect<SendTurnResult, ThreadServiceError>;
  readonly interrupt: (
    threadId: ThreadId,
    expectedTurnId?: TurnId,
  ) => Effect.Effect<void, ThreadServiceError>;
  readonly settle: (
    threadId: ThreadId,
    settled: boolean,
  ) => Effect.Effect<Thread, ThreadServiceError>;
  readonly compact: (
    threadId: ThreadId,
    input?: CompactThreadInput,
  ) => Effect.Effect<CompactThreadResult, ThreadServiceError>;
  readonly rewindThread: (
    threadId: ThreadId,
    input: RewindThreadInput,
  ) => Effect.Effect<RewindThreadResult, ThreadServiceError>;
  readonly listQueuedTurns: (
    threadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<QueuedTurn>, ThreadServiceError>;
  readonly editQueuedTurn: (
    threadId: ThreadId,
    queuedId: string,
    input: EditQueuedTurnInput,
  ) => Effect.Effect<QueuedTurn, ThreadServiceError>;
  readonly cancelQueuedTurn: (
    threadId: ThreadId,
    queuedId: string,
  ) => Effect.Effect<void, ThreadServiceError>;
  readonly promoteQueuedTurn: (
    threadId: ThreadId,
    queuedId: string,
  ) => Effect.Effect<
    | { readonly kind: "steered"; readonly turn: ThreadTurn }
    | { readonly kind: "queued"; readonly queuedTurn: QueuedTurn },
    ThreadServiceError
  >;
  readonly listVisualizations: (
    threadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<ThreadVisualization>, ThreadServiceError>;
  readonly update: (
    threadId: ThreadId,
    input: UpdateThreadInput,
  ) => Effect.Effect<Thread, ThreadServiceError>;
  readonly remove: (threadId: ThreadId) => Effect.Effect<void, ThreadServiceError>;
  readonly respondApproval: (
    threadId: ThreadId,
    approvalId: ApprovalId,
    input: RespondApprovalInput,
  ) => Effect.Effect<void, ThreadServiceError>;
  readonly askUser: (
    threadId: ThreadId,
    input: AskUserInput,
  ) => Effect.Effect<AskUserResult, ThreadServiceError>;
}
