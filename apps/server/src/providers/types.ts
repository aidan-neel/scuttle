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
  TurnUsage,
} from "@scuttle/contracts";
import type * as Effect from "effect/Effect";

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
      readonly resolve: (decision: ApprovalDecision) => void;
    }
  | { readonly kind: "usage"; readonly usage: TurnUsage };

export interface ApprovalDecision {
  readonly optionId: string;
  readonly customText?: string;
}

export interface HarnessTurnInput {
  readonly config: ProviderConfig;
  readonly cwd: string;
  readonly prompt: string;
  readonly model: string;
  readonly effort?: EffortLevel;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: InteractionMode;
  readonly providerSessionId?: string;
  readonly extraEnv?: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly emit: (event: HarnessEvent) => void;
}

export interface HarnessTurnResult {
  readonly finalText?: string;
  readonly providerSessionId?: string;
  readonly interrupted?: boolean;
  readonly costUsd?: number;
  readonly usage?: TurnUsage;
}

export interface HarnessAdapter {
  readonly kind: ProviderKind;
  readonly probe: (config: ProviderConfig) => Effect.Effect<ProviderSnapshot>;
  readonly runTurn: (input: HarnessTurnInput) => Promise<HarnessTurnResult>;
}
