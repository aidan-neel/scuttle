import type { ApprovalOption, UserInputQuestion } from "@scuttle/contracts";
import type { ApprovalDecision, HarnessTurnInput } from "./types.ts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const parseClaudeQuestions = (raw: unknown): ReadonlyArray<UserInputQuestion> => {
  if (!Array.isArray(raw)) return [];
  const questions: UserInputQuestion[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const question = asString(entry.question);
    if (!question) continue;
    const header = asString(entry.header);
    const options: ApprovalOption[] = (Array.isArray(entry.options) ? entry.options : []).flatMap(
      (opt) => {
        if (!isObject(opt)) return [];
        const label = asString(opt.label);
        if (!label) return [];
        const desc = asString(opt.description);
        return [{ id: label, label, ...(desc !== undefined ? { description: desc } : {}) }];
      },
    );
    questions.push({
      id: question,
      ...(header !== undefined ? { header } : {}),
      question,
      options,
      ...(typeof entry.multiSelect === "boolean" ? { multiSelect: entry.multiSelect } : {}),
      allowCustom: true,
    });
  }
  return questions;
};

const formatClaudeAnswers = (
  questions: ReadonlyArray<UserInputQuestion>,
  decision: ApprovalDecision,
): Record<string, string> => {
  const answers: Record<string, string> = {};
  if (decision.answers && Object.keys(decision.answers).length > 0) {
    for (const [key, val] of Object.entries(decision.answers)) {
      answers[key] = typeof val === "string" ? val : val.join(", ");
    }
    return answers;
  }
  const fallback = decision.customText?.trim() || decision.optionId;
  if (fallback && questions[0]) {
    answers[questions[0].id] = fallback;
  }
  return answers;
};

const hasShellMetacharacters = (command: string): boolean => {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (!inSingle && ch === "\\") {
      escaped = true;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle) {
      if (ch === "`" || (ch === "$" && command[i + 1] === "(")) return true;
      if (!inDouble && ";|&><\n\r".includes(ch)) return true;
    }
  }
  return inSingle || inDouble;
};

export const isScuttleBridgeCurl = (
  toolName: string,
  command: string | undefined,
  apiBaseUrl: string | undefined,
): boolean => {
  if (toolName !== "Bash" || !command || !apiBaseUrl) return false;
  const trimmed = command.trim();
  if (!/^curl(?:\s|$)/.test(trimmed)) return false;
  if (hasShellMetacharacters(trimmed)) return false;
  const base = apiBaseUrl.replace(/\/+$/, "");
  return (
    trimmed.includes(`${base}/api/`) ||
    trimmed.includes("$SCUTTLE_API_URL/api/") ||
    trimmed.includes("${SCUTTLE_API_URL}/api/")
  );
};

export const handleClaudeControlRequest = async (deps: {
  readonly parsed: Record<string, unknown>;
  readonly input: HarnessTurnInput;
  readonly writeStdin: (payload: unknown) => void;
  readonly pendingResolvers: Set<(decision: ApprovalDecision) => void>;
}): Promise<void> => {
  const { parsed, input, writeStdin, pendingResolvers } = deps;
  const requestId = asString(parsed.request_id);
  const request = isObject(parsed.request) ? parsed.request : undefined;
  if (!requestId || !request) return;

  if (asString(request.subtype) !== "can_use_tool") {
    writeStdin({
      type: "control_response",
      response: {
        subtype: "error",
        request_id: requestId,
        error: "Unsupported control request.",
      },
    });
    return;
  }

  const toolName = asString(request.tool_name) ?? "tool";
  const toolInput = isObject(request.input) ? request.input : {};
  const description = asString(request.description) ?? asString(request.decision_reason);
  const command = toolName === "Bash" ? asString(toolInput.command) : undefined;
  const isAskUserQuestion = toolName === "AskUserQuestion";

  const autoApprove =
    !isAskUserQuestion &&
    ((input.interactionMode !== "plan" &&
      (input.runtimeMode === "full-access" || input.runtimeMode === "auto")) ||
      isScuttleBridgeCurl(toolName, command, input.extraEnv?.SCUTTLE_API_URL));

  if (autoApprove) {
    writeStdin({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response: { behavior: "allow", updatedInput: toolInput },
      },
    });
    return;
  }

  const questions = isAskUserQuestion ? parseClaudeQuestions(toolInput.questions) : [];

  const decision = await new Promise<ApprovalDecision>((resolve) => {
    if (input.signal.aborted) {
      resolve({ optionId: "deny", dismissed: true, customText: "Turn interrupted." });
      return;
    }
    const settle = (value: ApprovalDecision) => {
      pendingResolvers.delete(settle);
      resolve(value);
    };
    pendingResolvers.add(settle);
    if (isAskUserQuestion) {
      const firstQuestion = questions[0];
      const questionDesc = firstQuestion?.question ?? description;
      input.emit({
        kind: "approval.requested",
        requestId,
        approvalKind: "question",
        title: firstQuestion?.header ?? "Claude has a question",
        ...(questionDesc !== undefined ? { description: questionDesc } : {}),
        options: firstQuestion?.options ?? [],
        questions,
        resolve: settle,
      });
      return;
    }
    input.emit({
      kind: "approval.requested",
      requestId,
      approvalKind: "permission",
      title: toolName === "Bash" ? "Approve shell command" : `Approve ${toolName}`,
      ...(description ? { description } : {}),
      ...(command ? { command } : {}),
      options: [
        { id: "allow", label: "Allow" },
        { id: "deny", label: "Deny" },
      ],
      resolve: settle,
    });
  });

  if (isAskUserQuestion) {
    const response =
      decision.dismissed || input.signal.aborted
        ? { behavior: "deny", message: decision.customText ?? "User dismissed question." }
        : {
            behavior: "allow",
            updatedInput: { ...toolInput, answers: formatClaudeAnswers(questions, decision) },
          };
    writeStdin({
      type: "control_response",
      response: { subtype: "success", request_id: requestId, response },
    });
    return;
  }

  const allow = decision.optionId === "allow" && !input.signal.aborted;
  writeStdin({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: allow
        ? { behavior: "allow", updatedInput: toolInput }
        : { behavior: "deny", message: decision.customText ?? "Denied by user." },
    },
  });
};
