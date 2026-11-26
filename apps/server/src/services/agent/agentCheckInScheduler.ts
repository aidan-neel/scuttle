import type { Agent, AgentCheckIn } from "@scuttle/contracts";
import type { AgentId } from "@scuttle/shared/ids";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import type { AgentServiceError } from "./errors.ts";

export const isCheckInDue = (agent: Agent, nowMs: number): boolean => {
  const intervalMinutes = agent.checkInIntervalMinutes;
  if (intervalMinutes === undefined || !Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    return false;
  }
  if (!agent.lastCheckInAt) return true;
  const lastMs = Date.parse(agent.lastCheckInAt);
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= intervalMinutes * 60_000;
};

export const runDueCheckIns = (deps: {
  readonly listAgents: () => ReadonlyArray<Agent>;
  readonly runCheckIn: (agentId: AgentId) => Effect.Effect<AgentCheckIn, AgentServiceError>;
  readonly now?: () => number;
}) =>
  Effect.gen(function* () {
    const nowMs = (deps.now ?? Date.now)();
    const agents = deps.listAgents();
    let ran = 0;
    for (const agent of agents) {
      if (!isCheckInDue(agent, nowMs)) continue;
      const succeeded = yield* deps.runCheckIn(agent.id).pipe(
        Effect.as(true),
        Effect.catchCause(() => Effect.succeed(false)),
      );
      if (succeeded) ran += 1;
    }
    return ran;
  });

export const forkCheckInScheduler = (deps: {
  readonly listAgents: () => ReadonlyArray<Agent>;
  readonly runCheckIn: (agentId: AgentId) => Effect.Effect<AgentCheckIn, AgentServiceError>;
  readonly interval?: Duration.Input;
}) => {
  const interval = deps.interval ?? "1 minute";
  return Effect.sleep(interval).pipe(
    Effect.andThen(
      runDueCheckIns(deps).pipe(
        Effect.catchCause(() => Effect.void),
        Effect.repeat(Schedule.spaced(interval)),
      ),
    ),
    Effect.forkScoped,
  );
};
