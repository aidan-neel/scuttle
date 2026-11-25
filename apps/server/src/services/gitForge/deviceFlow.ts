import type {
  DeviceFlowPoll,
  DeviceFlowPollInput,
  DeviceFlowStart,
  ForgeStatus,
} from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import { fromHttpError, GitForgeError } from "./errors.ts";
import {
  DEFAULT_HOST,
  type FetchFn,
  fetchForgeUsername,
  requestDeviceCode,
  requestDeviceToken,
} from "./forgeHttp.ts";

interface PendingFlow {
  readonly deviceCode: string;
  readonly expiresAt: number;
  intervalSeconds: number;
}

export const makeDeviceFlow = (deps: {
  readonly clientId: string | null;
  readonly fetch: FetchFn;
  readonly now: () => number;
  readonly onToken: (token: string, username: string) => Effect.Effect<ForgeStatus>;
}) => {
  const flows = new Map<string, PendingFlow>();

  const requireClientId = () =>
    deps.clientId === null
      ? Effect.fail(
          new GitForgeError({
            reason: "unavailable",
            detail:
              "GitHub OAuth is not configured. Set SCUTTLE_GITHUB_OAUTH_CLIENT_ID, sign in with `gh auth login`, or connect with a token.",
          }),
        )
      : Effect.succeed(deps.clientId);

  const start = Effect.fn("GitForgeService.startDeviceFlow")(function* () {
    const clientId = yield* requireClientId();
    for (const [id, flow] of flows) {
      if (flow.expiresAt <= deps.now()) flows.delete(id);
    }
    const code = yield* requestDeviceCode(deps.fetch, clientId).pipe(
      Effect.mapError(fromHttpError),
    );
    const flowId = crypto.randomUUID();
    const expiresAt = deps.now() + code.expires_in * 1000;
    flows.set(flowId, { deviceCode: code.device_code, expiresAt, intervalSeconds: code.interval });
    return {
      flowId,
      userCode: code.user_code,
      verificationUri: code.verification_uri,
      expiresAt: new Date(expiresAt).toISOString(),
      intervalSeconds: code.interval,
    } satisfies DeviceFlowStart;
  });

  const poll = Effect.fn("GitForgeService.pollDeviceFlow")(function* (input: DeviceFlowPollInput) {
    const clientId = yield* requireClientId();
    const flow = flows.get(input.flowId);
    if (flow === undefined) {
      return yield* new GitForgeError({
        reason: "not-found",
        detail: "This sign-in request is unknown or finished. Start a new one.",
      });
    }
    if (flow.expiresAt <= deps.now()) {
      flows.delete(input.flowId);
      return { kind: "expired" } satisfies DeviceFlowPoll;
    }
    const result = yield* requestDeviceToken(deps.fetch, clientId, flow.deviceCode).pipe(
      Effect.mapError(fromHttpError),
    );
    if ("access_token" in result) {
      flows.delete(input.flowId);
      const username = yield* fetchForgeUsername(
        deps.fetch,
        "github",
        DEFAULT_HOST.github,
        result.access_token,
      ).pipe(Effect.mapError(fromHttpError));
      const status = yield* deps.onToken(result.access_token, username);
      return { kind: "complete", status } satisfies DeviceFlowPoll;
    }
    switch (result.error) {
      case "authorization_pending":
        return { kind: "pending", intervalSeconds: flow.intervalSeconds } satisfies DeviceFlowPoll;
      case "slow_down":
        flow.intervalSeconds = result.interval ?? flow.intervalSeconds + 5;
        return { kind: "pending", intervalSeconds: flow.intervalSeconds } satisfies DeviceFlowPoll;
      case "expired_token":
        flows.delete(input.flowId);
        return { kind: "expired" } satisfies DeviceFlowPoll;
      case "access_denied":
        flows.delete(input.flowId);
        return { kind: "denied" } satisfies DeviceFlowPoll;
      default:
        flows.delete(input.flowId);
        return yield* new GitForgeError({
          reason: "rejected",
          detail: `GitHub sign-in failed: ${result.error}.`,
        });
    }
  });

  return { start, poll };
};
