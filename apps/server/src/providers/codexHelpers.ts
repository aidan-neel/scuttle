import type {
  ApprovalOption,
  EffortLevel,
  ProviderModel,
  RuntimeMode,
  UserInputQuestion,
} from "@scuttle/contracts";
import { presentToolActivity } from "./toolLabel.ts";
import {
  type ApprovalDecision,
  filterImageAttachments,
  type HarnessTurnInput,
  type ResolvedAttachment,
  toBase64,
} from "./types.ts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const VALID_EFFORTS = new Set<EffortLevel>(["low", "medium", "high", "xhigh", "max"]);
const toEffort = (v: unknown): EffortLevel | undefined =>
  typeof v === "string" && VALID_EFFORTS.has(v as EffortLevel) ? (v as EffortLevel) : undefined;

export const parseCodexModels = (raw: unknown): ReadonlyArray<ProviderModel> => {
  if (!isObject(raw)) return [];
  const list = Array.isArray(raw.data) ? raw.data : Array.isArray(raw.models) ? raw.models : [];
  const models: ProviderModel[] = [];
  for (const entry of list) {
    if (!isObject(entry) || entry.hidden === true) continue;
    const slug = asString(entry.model) ?? asString(entry.id) ?? asString(entry.slug);
    if (!slug) continue;
    const name = asString(entry.displayName) ?? asString(entry.name) ?? slug;
    const efforts: EffortLevel[] = [];
    if (Array.isArray(entry.supportedReasoningEfforts)) {
      for (const eff of entry.supportedReasoningEfforts) {
        const parsed = toEffort(isObject(eff) ? eff.reasoningEffort : eff);
        if (parsed && !efforts.includes(parsed)) efforts.push(parsed);
      }
    }
    const defaultEffort = toEffort(entry.defaultReasoningEffort);
    models.push({
      slug,
      name,
      ...(entry.isDefault === true ? { isDefault: true } : {}),
      efforts: efforts.length > 0 ? efforts : ["low", "medium", "high"],
      ...(defaultEffort ? { defaultEffort } : {}),
    });
  }
  return models;
};

export const mapApprovalPolicy = (mode: RuntimeMode): string =>
  mode === "full-access" ? "never" : mode === "auto" ? "on-request" : "untrusted";

export const mapSandbox = (mode: RuntimeMode): string =>
  mode === "full-access" ? "danger-full-access" : "workspace-write";

export const describeCodexItem = (item: Record<string, unknown>) => {
  const itemType = asString(item.type) ?? "tool";
  if (itemType === "commandExecution") {
    const cmd = Array.isArray(item.command)
      ? item.command.filter((p): p is string => typeof p === "string").join(" ")
      : asString(item.command);
    return presentToolActivity("command_execution", { command: cmd });
  }
  if (itemType === "fileChange") {
    const first = Array.isArray(item.changes) ? item.changes[0] : undefined;
    return presentToolActivity("file_change", {
      path: isObject(first) ? asString(first.path) : undefined,
    });
  }
  if (itemType === "mcpToolCall") {
    return presentToolActivity(asString(item.tool) ?? "mcp_tool", item.arguments);
  }
  if (itemType === "webSearch") {
    return presentToolActivity("web_search", { query: asString(item.query) });
  }
  return presentToolActivity(itemType, item);
};

export const runCodexProbeWithEnv = async (
  command: string,
  args: ReadonlyArray<string>,
  env: Record<string, string>,
) => {
  try {
    const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe", env });
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
    }, 5_000);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
};

export const buildCodexTurnInput = (
  prompt: string,
  attachments?: ReadonlyArray<ResolvedAttachment>,
) => [
  { type: "text" as const, text: prompt },
  ...filterImageAttachments(attachments).map((att) => ({
    type: "image" as const,
    url: `data:${att.mimeType};base64,${toBase64(att.bytes)}`,
  })),
];

export const buildCodexMcpConfig = (mcpServer: HarnessTurnInput["mcpServer"]) =>
  mcpServer
    ? {
        config: {
          "mcp_servers.scuttle": {
            url: mcpServer.url,
            http_headers: { Authorization: mcpServer.authorizationHeader },
            tool_timeout_sec: 3900,
          },
        },
      }
    : {};

export const parseCodexUserInputQuestions = (raw: unknown): ReadonlyArray<UserInputQuestion> => {
  if (!Array.isArray(raw)) return [];
  const questions: UserInputQuestion[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    if (!isObject(entry)) continue;
    const id = asString(entry.id) ?? `q${i + 1}`;
    const header = asString(entry.header);
    const question = asString(entry.question) ?? header ?? id;
    const options: ApprovalOption[] = (Array.isArray(entry.options) ? entry.options : []).flatMap(
      (opt) => {
        if (!isObject(opt)) return [];
        const label = asString(opt.label);
        if (!label) return [];
        const description = asString(opt.description);
        return [{ id: label, label, ...(description !== undefined ? { description } : {}) }];
      },
    );
    questions.push({
      id,
      ...(header !== undefined ? { header } : {}),
      question,
      options,
      multiSelect: Boolean(entry.multiSelect || entry.isMultiSelect),
      allowCustom: entry.isOther !== false,
    });
  }
  return questions;
};

export const buildCodexUserInputResponse = (
  questions: ReadonlyArray<UserInputQuestion>,
  decision: ApprovalDecision,
): { readonly answers: Record<string, { readonly answers: ReadonlyArray<string> }> } => {
  if (decision.dismissed) return { answers: {} };
  const answers: Record<string, { readonly answers: ReadonlyArray<string> }> = {};
  if (questions.length === 0) {
    const fallback = decision.customText?.trim() || decision.optionId;
    if (fallback) answers.answer = { answers: [fallback] };
    return { answers };
  }
  const hasExplicitAnswers =
    decision.answers !== undefined && Object.keys(decision.answers).length > 0;
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i]!;
    const val = decision.answers?.[q.id];
    if (val !== undefined) {
      answers[q.id] = { answers: Array.isArray(val) ? [...val] : val ? [val] : [] };
    } else if (i === 0 && !hasExplicitAnswers) {
      const fallback = decision.customText?.trim() || decision.optionId;
      answers[q.id] = { answers: fallback ? [fallback] : [] };
    } else {
      answers[q.id] = { answers: [] };
    }
  }
  return { answers };
};
