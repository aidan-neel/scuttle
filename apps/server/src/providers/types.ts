import type {
  ActivityKind,
  ActivityStatus,
  ApprovalOption,
  EffortLevel,
  InteractionMode,
  ProviderConfig,
  ProviderKind,
  ProviderSnapshot,
  RuntimeMode,
  ThreadAttachment,
  TurnUsage,
  UserInputAnswers,
  UserInputQuestion,
} from "@scuttle/contracts";
import type * as Effect from "effect/Effect";

export interface ResolvedAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly path: string;
  readonly bytes: Uint8Array;
}

export type ResolvedImageAttachment = ResolvedAttachment;

export interface SteerPayload {
  readonly prompt: string;
  readonly attachments?: ReadonlyArray<ResolvedImageAttachment>;
}

export type SteerHandler = (payload: SteerPayload) => Promise<boolean>;

export const MAX_IMAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export const filterImageAttachments = (
  resolved: ReadonlyArray<ResolvedAttachment> | undefined,
): ReadonlyArray<ResolvedAttachment> =>
  (resolved ?? []).filter(
    (att) => SUPPORTED_IMAGE_MIME_TYPES.has(att.mimeType) && att.bytes.byteLength > 0,
  );

export const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

export const buildAcpPromptBlocks = (
  prompt: string,
  images: ReadonlyArray<ResolvedAttachment>,
  supportsImages: boolean,
): ReadonlyArray<Record<string, unknown>> => {
  if (images.length === 0) return [{ type: "text", text: prompt }];
  if (supportsImages) {
    return [
      ...images.map((att) => ({
        type: "image",
        data: toBase64(att.bytes),
        mimeType: att.mimeType,
      })),
      { type: "text", text: prompt },
    ];
  }
  const paths = images.map((att) => `Attached image saved at: ${att.path}`).join("\n");
  return [{ type: "text", text: `${prompt}\n\n${paths}` }];
};

export type HarnessEvent =
  | { readonly kind: "session"; readonly providerSessionId: string }
  | { readonly kind: "thinking.delta"; readonly text: string }
  | { readonly kind: "assistant.delta"; readonly text: string }
  | { readonly kind: "assistant.replace"; readonly text: string }
  | {
      readonly kind: "activity.started";
      readonly key: string;
      readonly activityKind: ActivityKind;
      readonly label: string;
      readonly activeLabel: string;
      readonly detail?: string;
    }
  | {
      readonly kind: "activity.updated";
      readonly key: string;
      readonly status: ActivityStatus;
      readonly label?: string;
      readonly activeLabel?: string;
      readonly detail?: string;
    }
  | {
      readonly kind: "approval.requested";
      readonly requestId: string;
      readonly approvalKind: "permission" | "question";
      readonly title: string;
      readonly description?: string;
      readonly command?: string;
      readonly options: ReadonlyArray<ApprovalOption>;
      readonly questions?: ReadonlyArray<UserInputQuestion>;
      readonly resolve: (decision: ApprovalDecision) => void;
    }
  | { readonly kind: "usage"; readonly usage: TurnUsage };

export interface ApprovalDecision {
  readonly optionId: string;
  readonly customText?: string;
  readonly answers?: UserInputAnswers;
  readonly dismissed?: boolean;
}

export interface HarnessTurnInput {
  readonly config: ProviderConfig;
  readonly cwd: string;
  readonly prompt: string;
  readonly freshSessionPrompt?: string;
  readonly model: string;
  readonly effort?: EffortLevel;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: InteractionMode;
  readonly providerSessionId?: string;
  readonly attachments?: ReadonlyArray<ThreadAttachment>;
  readonly resolvedAttachments?: ReadonlyArray<ResolvedAttachment>;
  readonly extraEnv?: Readonly<Record<string, string>>;
  readonly registerSteer?: (handler: SteerHandler) => void;
  readonly mcpServer?: {
    readonly url: string;
    readonly authorizationHeader: string;
    readonly threadId: string;
  };
  readonly signal: AbortSignal;
  readonly emit: (event: HarnessEvent) => void;
}

export interface HarnessTurnResult {
  readonly finalText?: string;
  readonly providerSessionId?: string;
  readonly interrupted?: boolean;
  readonly costUsd?: number;
  readonly usage?: TurnUsage;
  readonly firstTokenMs?: number;
}

export interface HarnessAdapter {
  readonly kind: ProviderKind;
  readonly probe: (config: ProviderConfig) => Effect.Effect<ProviderSnapshot>;
  readonly runTurn: (input: HarnessTurnInput) => Promise<HarnessTurnResult>;
}
