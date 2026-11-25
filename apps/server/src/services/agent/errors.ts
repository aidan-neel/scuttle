import * as Schema from "effect/Schema";

export const AgentErrorReason = Schema.Literals(["not-found", "invalid", "rejected"]);
export type AgentErrorReason = typeof AgentErrorReason.Type;

export class AgentServiceError extends Schema.TaggedError<AgentServiceError>()(
  "AgentServiceError",
  {
    reason: AgentErrorReason,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
