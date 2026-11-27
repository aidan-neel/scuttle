import type { Agent, AgentDelegation, Thread } from "@scuttle/contracts";

export type AgentActivityStatus =
  | { readonly kind: "needs-input" }
  | { readonly kind: "working"; readonly activeDelegations: number }
  | { readonly kind: "error" }
  | { readonly kind: "idle" };

const isDelegationActive = (delegation: AgentDelegation): boolean =>
  delegation.status === "running" || delegation.status === "waiting_parent";

export const countActiveDelegations = (
  agent: Agent,
  loadedDelegations?: ReadonlyArray<AgentDelegation>,
): number => {
  if (loadedDelegations !== undefined) {
    let count = 0;
    for (const delegation of loadedDelegations) {
      if (isDelegationActive(delegation)) count += 1;
    }
    return count;
  }
  return agent.activeDelegationCount ?? 0;
};

export const resolveAgentActivityStatus = (
  agent: Agent,
  primaryThread: Thread | undefined,
  loadedDelegations?: ReadonlyArray<AgentDelegation>,
): AgentActivityStatus => {
  const activeDelegations = countActiveDelegations(agent, loadedDelegations);
  const threadKind = primaryThread?.status.kind;

  if (threadKind === "needs-input") {
    return { kind: "needs-input" };
  }
  if (threadKind === "running" || activeDelegations > 0) {
    return { kind: "working", activeDelegations };
  }
  if (threadKind === "error") {
    return { kind: "error" };
  }
  return { kind: "idle" };
};

export const formatAgentWorkingLabel = (activeDelegations: number): string =>
  activeDelegations > 0 ? `Working · ${activeDelegations}` : "Working";
