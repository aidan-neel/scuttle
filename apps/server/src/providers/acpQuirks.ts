const COPILOT_META_KEY = "github.com/copilot";

export const COPILOT_CLIENT_EVENTS = [
  "subagent.started",
  "subagent.completed",
  "subagent.failed",
  "assistant.message_delta",
  "assistant.reasoning_delta",
  "session.compaction_complete",
  "assistant.turn_start",
  "assistant.idle",
  "tool.execution_start",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeAgentId = (agentId: string): string => agentId.trim().toLowerCase();

export const isDevinAgent = (agentId: string): boolean => {
  const normalized = normalizeAgentId(agentId);
  return normalized === "devin" || normalized.startsWith("devin-");
};

export const isCopilotAgent = (agentId: string): boolean => {
  const normalized = normalizeAgentId(agentId);
  return (
    normalized === "copilot" ||
    normalized === "github-copilot" ||
    normalized === "github-copilot-cli"
  );
};

export const buildClientCapabilitiesMeta = (agentId: string): Record<string, unknown> => {
  if (isDevinAgent(agentId)) {
    return {
      "cognition.ai/subagentSupport": true,
      "cognition.ai/messageGrouping": true,
    };
  }
  if (isCopilotAgent(agentId)) {
    return {
      [COPILOT_META_KEY]: {
        events: [...COPILOT_CLIENT_EVENTS],
      },
    };
  }
  return {};
};

export interface PermissionOptionLike {
  readonly optionId?: string;
  readonly id?: string;
}

// Devin's plan exit advertises plan_bypass alongside standard allow_once options; never pick it.
export const filterPermissionOptions = <T extends PermissionOptionLike>(
  agentId: string,
  options: ReadonlyArray<T>,
): ReadonlyArray<T> => {
  if (!isDevinAgent(agentId)) return options;
  return options.filter((option) => (option.optionId ?? option.id ?? "").trim() !== "plan_bypass");
};

export const extractQuirkToolTitle = (agentId: string, update: unknown): string | undefined => {
  if (!isDevinAgent(agentId) || !isRecord(update)) return undefined;
  const data = isRecord(update.data) ? update.data : undefined;
  const meta = isRecord(update._meta)
    ? update._meta
    : isRecord(update.meta)
      ? update.meta
      : isRecord(data?.meta)
        ? data.meta
        : undefined;
  const toolName = meta?.["cognition.ai/inferenceToolName"];
  return typeof toolName === "string" && toolName.trim().length > 0 ? toolName : undefined;
};

// Copilot's session/new reports a built-in default rather than the configured model.
export const shouldAlwaysSetModel = (agentId: string): boolean => isCopilotAgent(agentId);
