import type { Agent, AgentCheckIn } from "@scuttle/contracts";
import type { AgentId } from "@scuttle/shared/ids";
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
      const outcome = yield* deps.runCheckIn(agent.id).pipe(Effect.option);
      if (outcome._tag === "Some") ran += 1;
    }
    return ran;
  });

export const forkCheckInScheduler = (deps: {
  readonly listAgents: () => ReadonlyArray<Agent>;
  readonly runCheckIn: (agentId: AgentId) => Effect.Effect<AgentCheckIn, AgentServiceError>;
}) =>
  Effect.sleep("1 minute").pipe(
    Effect.andThen(runDueCheckIns(deps)),
    Effect.repeat(Schedule.spaced("1 minute")),
    Effect.forkScoped,
  );
