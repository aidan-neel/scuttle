import * as Schema from "effect/Schema";
import type { ForgeHttpError } from "./forgeHttp.ts";

export const GitForgeErrorReason = Schema.Literals([
  "invalid",
  "not-found",
  "unauthorized",
  "unavailable",
  "rejected",
]);
export type GitForgeErrorReason = typeof GitForgeErrorReason.Type;

export class GitForgeError extends Schema.TaggedError<GitForgeError>()("GitForgeError", {
  reason: GitForgeErrorReason,
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export const fromHttpError = (error: ForgeHttpError): GitForgeError =>
  new GitForgeError({
    reason: error.status === 401 || error.status === 403 ? "unauthorized" : "rejected",
    detail: error.detail,
  });
