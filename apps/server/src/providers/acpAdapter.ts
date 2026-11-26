import * as NodeOS from "node:os";
import type {
  EffortLevel,
  ProviderConfig,
  ProviderKind,
  ProviderModel,
  ProviderSnapshot,
  TurnUsage,
} from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import {
  getBuiltInProviderSpec,
  parseVersionNumber,
  resolveExecutable,
  runCliProbe,
  tokenizeLaunchArgs,
} from "./catalog.ts";
import { StdioJsonRpcProcess } from "./stdioJsonRpc.ts";
import { presentToolActivity } from "./toolLabel.ts";
import type {
  ApprovalDecision,
  HarnessAdapter,
  HarnessTurnInput,
  HarnessTurnResult,
} from "./types.ts";
import { parseAcpCostUsd, parseAcpUsage } from "./usageParsing.ts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const VALID_EFFORTS = new Set<EffortLevel>(["low", "medium", "high", "xhigh", "max"]);

const toEffort = (value: unknown): EffortLevel | undefined => {
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase();
  return VALID_EFFORTS.has(lower as EffortLevel) ? (lower as EffortLevel) : undefined;
};

type AcpProviderKind = Extract<ProviderKind, "antigravity" | "opencode" | "copilot">;

const ACP_BASE_ARGS: Record<AcpProviderKind, ReadonlyArray<string>> = {
  antigravity: ["acp"],
  opencode: ["acp"],
  copilot: ["--acp"],
};

const extractAcpModels = (
  sessionResult: unknown,
  fallback: ReadonlyArray<ProviderModel>,
): ReadonlyArray<ProviderModel> => {
  if (!isObject(sessionResult)) return fallback;

  const configOptions = Array.isArray(sessionResult.configOptions)
    ? sessionResult.configOptions
    : [];
  const effortConfig = configOptions.find(
    (opt) =>
      isObject(opt) &&
      (opt.id === "thought_level" ||
        opt.id === "thinking" ||
        opt.id === "reasoning_effort" ||
        opt.id === "effort" ||
        opt.category === "thought_level"),
  );
  const discoveredEfforts: EffortLevel[] = [];
  if (isObject(effortConfig) && Array.isArray(effortConfig.options)) {
    for (const entry of effortConfig.options) {
      if (!isObject(entry)) continue;
      const eff = toEffort(entry.value ?? entry.id);
      if (eff && !discoveredEfforts.includes(eff)) discoveredEfforts.push(eff);
    }
  }
  const defaultEffort = isObject(effortConfig) ? toEffort(effortConfig.currentValue) : undefined;

  const modelConfig = configOptions.find(
    (opt) => isObject(opt) && (opt.id === "model" || opt.category === "model"),
  );

  const models: ProviderModel[] = [];
  const seen = new Set<string>();

  if (isObject(modelConfig) && Array.isArray(modelConfig.options)) {
    const currentValue = asString(modelConfig.currentValue);
    const flatOptions: Record<string, unknown>[] = [];
    for (const opt of modelConfig.options) {
      if (!isObject(opt)) continue;
      if (Array.isArray(opt.options)) {
        for (const sub of opt.options) {
          if (isObject(sub)) flatOptions.push(sub);
        }
      } else {
        flatOptions.push(opt);
      }
    }
    for (const entry of flatOptions) {
      const slug = asString(entry.value) ?? asString(entry.id);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const name = asString(entry.name) ?? slug;
      models.push({
        slug,
        name,
        ...(slug === currentValue ? { isDefault: true } : {}),
        efforts: [...discoveredEfforts],
        ...(defaultEffort ? { defaultEffort } : {}),
      });
    }
  } else if (
    isObject(sessionResult.models) &&
    Array.isArray(sessionResult.models.availableModels)
  ) {
    const currentModelId = asString(sessionResult.models.currentModelId);
    for (const entry of sessionResult.models.availableModels) {
      if (!isObject(entry)) continue;
      const slug = asString(entry.modelId) ?? asString(entry.id);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const name = asString(entry.name) ?? slug;
      models.push({
        slug,
        name,
        ...(slug === currentModelId ? { isDefault: true } : {}),
        efforts: [...discoveredEfforts],
        ...(defaultEffort ? { defaultEffort } : {}),
      });
    }
  }

  return models.length > 0 ? models : fallback;
};

const extractContentText = (content: unknown): string => {
  if (!isObject(content)) return "";
  if (content.type === "text" && typeof content.text === "string") {
    return content.text;
  }
  return "";
};

const findThinkingConfigId = (sessionResult: unknown): string | undefined => {
  if (!isObject(sessionResult) || !Array.isArray(sessionResult.configOptions)) return undefined;
  for (const opt of sessionResult.configOptions) {
    if (!isObject(opt)) continue;
    const id = asString(opt.id);
    if (
      id === "thought_level" ||
      id === "thinking" ||
      id === "reasoning_effort" ||
      id === "effort" ||
      opt.category === "thought_level"
    ) {
      return id;
    }
  }
  return undefined;
};

export const createAcpAdapter = (kind: AcpProviderKind): HarnessAdapter => ({
  kind,

  probe: (config: ProviderConfig) =>
    Effect.promise(async (): Promise<ProviderSnapshot> => {
      const spec = getBuiltInProviderSpec(kind);
      const checkedAt = new Date().toISOString();
      if (!config.enabled) {
        return {
          ...config,
          status: "disabled",
          models: [...spec.fallbackModels],
          setupHint: spec.setupHint,
          checkedAt,
        };
      }

      const resolvedPath = resolveExecutable(config.binaryPath, spec.defaultBinary);
      if (!resolvedPath) {
        return {
          ...config,
          status: "unavailable",
          message: `${spec.name} CLI (${spec.defaultBinary}) not found on PATH.`,
          setupHint: spec.setupHint,
          models: [...spec.fallbackModels],
          checkedAt,
        };
      }

      const versionProbe = await runCliProbe(resolvedPath, ["--version"]);
      if (!versionProbe.ok) {
        return {
          ...config,
          resolvedPath,
          status: "unavailable",
          message: versionProbe.stderr || `Failed to execute ${spec.name} CLI.`,
          setupHint: spec.setupHint,
          models: [...spec.fallbackModels],
          checkedAt,
        };
      }

      const version = parseVersionNumber(versionProbe.stdout || versionProbe.stderr);
      let models: ReadonlyArray<ProviderModel> = spec.fallbackModels;
      let status: ProviderSnapshot["status"] = "ready";
      let message: string | undefined;

      const rpc = new StdioJsonRpcProcess({
        command: resolvedPath,
        args: [...ACP_BASE_ARGS[kind], ...tokenizeLaunchArgs(config.launchArgs)],
        cwd: NodeOS.homedir(),
      });

      try {
        await rpc.request(
          "initialize",
          {
            protocolVersion: 1,
            clientInfo: { name: "scuttle", title: "Scuttle", version: "0.1.0" },
            clientCapabilities: {},
          },
          7_000,
        );
        const sessionRes = await rpc
          .request("session/new", { cwd: NodeOS.homedir(), mcpServers: [] }, 7_000)
          .catch((err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            if (/auth|sign\s*in|login|unauthenticated/i.test(errMsg)) {
              status = "unauthenticated";
              message = errMsg;
            }
            return null;
          });
        if (sessionRes !== null) {
          models = extractAcpModels(sessionRes, spec.fallbackModels);
        }
      } catch {
        // Keep version-confirmed ready state with fallback catalog if ACP handshake timed out.
      } finally {
        rpc.kill();
      }

      return {
        ...config,
        resolvedPath,
        ...(version ? { version } : {}),
        status,
        ...(message ? { message } : {}),
        setupHint: spec.setupHint,
        models: [...models],
        checkedAt,
      };
    }),

  runTurn: async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
    const spec = getBuiltInProviderSpec(kind);
    const executable = resolveExecutable(input.config.binaryPath, spec.defaultBinary);
    if (!executable) {
      throw new Error(`${spec.name} CLI binary not found. Configure it in Settings.`);
    }

    let sessionId = input.providerSessionId;
    let latestUsage: TurnUsage | undefined;
    const seenToolIds = new Set<string>();

    const rpc = new StdioJsonRpcProcess({
      command: executable,
      args: [...ACP_BASE_ARGS[kind], ...tokenizeLaunchArgs(input.config.launchArgs)],
      cwd: input.cwd,
      ...(input.extraEnv ? { env: input.extraEnv } : {}),
      onNotification: ({ method, params }) => {
        if (method !== "session/update" || !isObject(params) || !isObject(params.update)) return;
        const update = params.update;
        const kindTag = asString(update.sessionUpdate);

        if (kindTag === "agent_message_chunk") {
          const text = extractContentText(update.content);
          if (text.length > 0) input.emit({ kind: "assistant.delta", text });
          return;
        }

        if (kindTag === "agent_thought_chunk") {
          const text = extractContentText(update.content);
          if (text.length > 0) input.emit({ kind: "thinking.delta", text });
          return;
        }

        if (kindTag === "usage_update") {
          const updateUsage = parseAcpUsage(update);
          if (updateUsage) {
            latestUsage = updateUsage;
            input.emit({ kind: "usage", usage: updateUsage });
          }
          return;
        }

        if (kindTag === "tool_call" || kindTag === "tool_call_update") {
          const toolCallId = asString(update.toolCallId);
          if (!toolCallId) return;
          const toolKind = asString(update.kind) ?? "tool";
          const title = asString(update.title);
          const pres = presentToolActivity(toolKind, update.rawInput, title);
          const rawStatus = asString(update.status);
          const status =
            rawStatus === "completed"
              ? "completed"
              : rawStatus === "failed" || rawStatus === "cancelled"
                ? "failed"
                : "running";

          if (!seenToolIds.has(toolCallId)) {
            seenToolIds.add(toolCallId);
            input.emit({
              kind: "activity.started",
              key: toolCallId,
              activityKind: pres.activityKind,
              label: pres.label,
              activeLabel: pres.activeLabel,
              ...(pres.detail ? { detail: pres.detail } : {}),
            });
          } else {
            input.emit({
              kind: "activity.updated",
              key: toolCallId,
              status,
              ...(title ? { label: pres.label, activeLabel: pres.activeLabel } : {}),
              ...(pres.detail ? { detail: pres.detail } : {}),
            });
          }
        }
      },
      onRequest: async ({ id, method, params }) => {
        if (method === "session/request_permission" && isObject(params)) {
          const rawOptions = Array.isArray(params.options) ? params.options : [];
          const options = rawOptions.flatMap((opt) => {
            if (!isObject(opt)) return [];
            const optionId = asString(opt.optionId) ?? asString(opt.id);
            const label = asString(opt.name) ?? asString(opt.label) ?? optionId;
            if (!optionId || !label) return [];
            return [{ id: optionId, label, kind: asString(opt.kind) }];
          });

          if (input.runtimeMode === "full-access" || input.runtimeMode === "auto") {
            const allow =
              options.find((opt) => opt.kind === "allow_once" || opt.kind === "allow_always") ??
              options[0];
            if (allow) {
              return { outcome: { outcome: "selected", optionId: allow.id } };
            }
          }

          const toolCall = isObject(params.toolCall) ? params.toolCall : undefined;
          const title = asString(toolCall?.title) ?? "Approve tool action";
          const decision = await new Promise<ApprovalDecision>((resolve) => {
            input.emit({
              kind: "approval.requested",
              requestId: String(id),
              approvalKind: "permission",
              title,
              options:
                options.length > 0
                  ? options.map(({ id: optId, label }) => ({ id: optId, label }))
                  : [
                      { id: "allow_once", label: "Allow once" },
                      { id: "reject_once", label: "Reject" },
                    ],
              resolve,
            });
          });
          return { outcome: { outcome: "selected", optionId: decision.optionId } };
        }
        return {};
      },
    });

    const onAbort = () => {
      if (sessionId) {
        rpc.notify("session/cancel", { sessionId });
      }
      rpc.kill();
    };
    if (input.signal.aborted) {
      onAbort();
    } else {
      input.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      await rpc.request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "scuttle", title: "Scuttle", version: "0.1.0" },
        clientCapabilities: {},
      });

      let turnPrompt = input.prompt;
      let sessionResult: unknown = null;
      if (sessionId) {
        sessionResult = await rpc
          .request("session/resume", { sessionId, cwd: input.cwd, mcpServers: [] }, 20_000)
          .catch(() =>
            rpc
              .request("session/load", { sessionId, cwd: input.cwd, mcpServers: [] }, 20_000)
              .catch(() => null),
          );
        if (sessionResult === null) {
          sessionId = undefined;
          turnPrompt = input.freshSessionPrompt ?? input.prompt;
        }
      }

      if (!sessionId) {
        sessionResult = await rpc.request(
          "session/new",
          { cwd: input.cwd, mcpServers: [] },
          30_000,
        );
        if (isObject(sessionResult)) {
          sessionId = asString(sessionResult.sessionId);
        }
        if (sessionId) {
          input.emit({ kind: "session", providerSessionId: sessionId });
        }
      }

      if (!sessionId) {
        throw new Error(`${spec.name} ACP did not return a session ID.`);
      }

      if (input.model.trim().length > 0 && input.model !== "default") {
        await rpc
          .request("session/set_config_option", {
            sessionId,
            configId: "model",
            value: input.model,
          })
          .catch(() =>
            rpc.request("session/set_model", { sessionId, modelId: input.model }).catch(() => null),
          );
      }

      const thinkingConfigId = findThinkingConfigId(sessionResult);
      if (input.effort && thinkingConfigId) {
        await rpc
          .request("session/set_config_option", {
            sessionId,
            configId: thinkingConfigId,
            value: input.effort,
          })
          .catch(() => null);
      }

      const promptRes = await rpc.request(
        "session/prompt",
        {
          sessionId,
          prompt: [{ type: "text", text: turnPrompt }],
        },
        30 * 60 * 1000,
      );
      const costUsd = parseAcpCostUsd(promptRes);
      const promptUsage = isObject(promptRes) ? parseAcpUsage(promptRes) : undefined;
      let usage = promptUsage ?? latestUsage;
      if (
        promptUsage &&
        promptUsage.contextWindowTokens === undefined &&
        latestUsage?.contextWindowTokens !== undefined
      ) {
        usage = { ...promptUsage, contextWindowTokens: latestUsage.contextWindowTokens };
      }
      if (promptUsage && usage) {
        input.emit({ kind: "usage", usage });
      }
      return {
        ...(sessionId ? { providerSessionId: sessionId } : {}),
        ...(input.signal.aborted ? { interrupted: true } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
        ...(usage ? { usage } : {}),
      };
    } finally {
      input.signal.removeEventListener("abort", onAbort);
      rpc.kill();
    }
  },
});
