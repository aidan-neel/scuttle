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
import { defaultServerConfig } from "../config.ts";
import {
  acpInitParams,
  buildAcpMcpServers,
  openAcpSession,
  runAcpProbeCommand,
  runAcpSessionProbe,
} from "./acpMcp.ts";
import {
  extractQuirkToolTitle,
  filterPermissionOptions,
  shouldAlwaysSetModel,
} from "./acpQuirks.ts";
import {
  getBuiltInProviderSpec,
  parseVersionNumber,
  resolveExecutable,
  tokenizeLaunchArgs,
} from "./catalog.ts";
import { materializeProviderRuntime, type ResolvedProviderRuntime } from "./shadowHomes.ts";
import { StdioJsonRpcProcess } from "./stdioJsonRpc.ts";
import { presentToolActivity } from "./toolLabel.ts";
import {
  type ApprovalDecision,
  buildAcpPromptBlocks,
  filterImageAttachments,
  type HarnessTurnInput,
  type HarnessTurnResult,
} from "./types.ts";
import { parseAcpCostUsd, parseAcpUsage } from "./usageParsing.ts";

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const asString = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

const EFFORT_LEVELS: ReadonlyArray<EffortLevel> = ["low", "medium", "high", "xhigh", "max"];
const toEffort = (v: unknown) =>
  typeof v === "string" ? EFFORT_LEVELS.find((e) => e === v.toLowerCase()) : undefined;

type AcpProviderKind = Extract<
  ProviderKind,
  "antigravity" | "opencode" | "copilot" | "acp-registry"
>;
const ACP_BASE_ARGS: Record<AcpProviderKind, ReadonlyArray<string>> = {
  antigravity: ["acp"],
  opencode: ["acp"],
  copilot: ["--acp"],
  "acp-registry": [],
};

const resolveAcpSpec = (kind: AcpProviderKind, c: ProviderConfig) =>
  kind === "acp-registry"
    ? {
        name: c.name,
        defaultBinary: c.binaryPath,
        setupHint: `Install ${c.name} from the ACP Registry.`,
        fallbackModels: [
          { slug: "default", name: `${c.name} Default`, isDefault: true, efforts: [] },
        ] satisfies ReadonlyArray<ProviderModel>,
      }
    : getBuiltInProviderSpec(kind);

const buildAcpRuntime = (kind: AcpProviderKind, c: ProviderConfig, dataDir?: string) =>
  materializeProviderRuntime({
    instanceId: c.id,
    kind,
    dataDir: dataDir ?? process.env.SCUTTLE_DATA_DIR ?? defaultServerConfig().dataDir,
    ...(c.homePath ? { homePath: c.homePath } : {}),
    ...(c.shadowHomePath ? { shadowHomePath: c.shadowHomePath } : {}),
    ...(c.env ? { env: c.env } : {}),
  });

const THINKING_IDS = new Set(["thought_level", "thinking", "reasoning_effort", "effort"]);
const findCfg = (sr: unknown, match: (o: Record<string, unknown>) => boolean) =>
  isObject(sr) && Array.isArray(sr.configOptions)
    ? sr.configOptions.find((o): o is Record<string, unknown> => isObject(o) && match(o))
    : undefined;
const findThinkingCfg = (sr: unknown) =>
  findCfg(sr, (o) => THINKING_IDS.has(asString(o.id) ?? "") || o.category === "thought_level");
const currentAcpModel = (sr: unknown) =>
  asString(findCfg(sr, (o) => o.id === "model" || o.category === "model")?.currentValue) ??
  (isObject(sr) && isObject(sr.models) ? asString(sr.models.currentModelId) : undefined);

const pushModels = (
  items: ReadonlyArray<unknown>,
  cur: string | undefined,
  efforts: ReadonlyArray<EffortLevel>,
  defaultEffort: EffortLevel | undefined,
  flat = false,
): ProviderModel[] => {
  const models: ProviderModel[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!isObject(item)) continue;
    for (const e of !flat && Array.isArray(item.options) ? item.options : [item]) {
      if (!isObject(e)) continue;
      const slug = asString(flat ? e.modelId : e.value) ?? asString(e.id);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      models.push({
        slug,
        name: asString(e.name) ?? slug,
        ...(slug === cur ? { isDefault: true } : {}),
        efforts: [...efforts],
        ...(defaultEffort ? { defaultEffort } : {}),
      });
    }
  }
  return models;
};

const extractAcpModels = (
  sr: unknown,
  fallback: ReadonlyArray<ProviderModel>,
): ReadonlyArray<ProviderModel> => {
  if (!isObject(sr)) return fallback;
  const effortCfg = findThinkingCfg(sr);
  const effortSet = new Set<EffortLevel>();
  if (Array.isArray(effortCfg?.options)) {
    for (const e of effortCfg.options) {
      const f = isObject(e) ? toEffort(e.value ?? e.id) : undefined;
      if (f) effortSet.add(f);
    }
  }
  const efforts = Array.from(effortSet);
  const defEffort = effortCfg ? toEffort(effortCfg.currentValue) : undefined;
  const modelCfg = findCfg(sr, (o) => o.id === "model" || o.category === "model");
  const models =
    modelCfg && Array.isArray(modelCfg.options)
      ? pushModels(modelCfg.options, asString(modelCfg.currentValue), efforts, defEffort)
      : isObject(sr.models) && Array.isArray(sr.models.availableModels)
        ? pushModels(
            sr.models.availableModels,
            asString(sr.models.currentModelId),
            efforts,
            defEffort,
            true,
          )
        : [];
  return models.length > 0 ? models : fallback;
};

const resolveAcpBinary = (kind: AcpProviderKind, c: ProviderConfig, defBin: string) =>
  kind === "acp-registry" && !c.binaryPath.trim()
    ? undefined
    : resolveExecutable(c.binaryPath, defBin);

const buildAcpArgs = (kind: AcpProviderKind, rt: ResolvedProviderRuntime, launchArgs: string) => [
  ...ACP_BASE_ARGS[kind],
  ...rt.extraLaunchArgs,
  ...tokenizeLaunchArgs(launchArgs),
];

const DEFAULT_PERM_OPTIONS = [
  { id: "allow_once", label: "Allow once" },
  { id: "reject_once", label: "Reject" },
];

const handleAcpNotification = (
  agentId: string,
  seenToolIds: Set<string>,
  input: HarnessTurnInput,
  method: string,
  params: unknown,
  onUsage: (u: TurnUsage) => void,
  onFirstToken: () => void,
) => {
  if (method !== "session/update" || !isObject(params) || !isObject(params.update)) return;
  const u = params.update;
  const tag = asString(u.sessionUpdate);
  if (tag === "agent_message_chunk" || tag === "agent_thought_chunk") {
    const c = u.content;
    const text = isObject(c) && c.type === "text" && typeof c.text === "string" ? c.text : "";
    if (text) {
      onFirstToken();
      input.emit({
        kind: tag === "agent_message_chunk" ? "assistant.delta" : "thinking.delta",
        text,
      });
    }
    return;
  }
  if (tag === "usage_update") {
    const usage = parseAcpUsage(u);
    if (usage) {
      onUsage(usage);
      input.emit({ kind: "usage", usage });
    }
    return;
  }
  if (tag !== "tool_call" && tag !== "tool_call_update") return;
  const key = asString(u.toolCallId);
  if (!key) return;
  const qt = extractQuirkToolTitle(agentId, u);
  const pres = presentToolActivity(
    qt ?? asString(u.kind) ?? "tool",
    u.rawInput,
    asString(u.title) ?? qt,
  );
  const detail = pres.detail ? { detail: pres.detail } : {};
  const labels = { label: pres.label, activeLabel: pres.activeLabel };
  if (!seenToolIds.has(key)) {
    seenToolIds.add(key);
    input.emit({
      kind: "activity.started",
      key,
      activityKind: pres.activityKind,
      ...labels,
      ...detail,
    });
  } else {
    const raw = asString(u.status);
    const status =
      raw === "completed"
        ? "completed"
        : raw === "failed" || raw === "cancelled"
          ? "failed"
          : "running";
    input.emit({
      kind: "activity.updated",
      key,
      status,
      ...(asString(u.title) || qt ? labels : {}),
      ...detail,
    });
  }
};

const selectedOutcome = (optionId: string) => ({ outcome: { outcome: "selected", optionId } });

const handleAcpPermission = async (
  agentId: string,
  input: HarnessTurnInput,
  id: string | number,
  params: unknown,
): Promise<unknown> => {
  if (!isObject(params)) return {};
  const raw = Array.isArray(params.options) ? params.options : [];
  const parsed = raw.flatMap((o) => {
    if (!isObject(o)) return [];
    const optionId = asString(o.optionId) ?? asString(o.id);
    const label = asString(o.name) ?? asString(o.label) ?? optionId;
    return optionId && label ? [{ id: optionId, optionId, label, kind: asString(o.kind) }] : [];
  });
  const options = filterPermissionOptions(agentId, parsed);
  if (input.runtimeMode === "full-access" || input.runtimeMode === "auto") {
    const allow =
      options.find((o) => o.kind === "allow_once" || o.kind === "allow_always") ?? options[0];
    if (allow) return selectedOutcome(allow.id);
  }
  const title =
    (isObject(params.toolCall) ? asString(params.toolCall.title) : undefined) ??
    "Approve tool action";
  const promptOpts =
    options.length > 0 ? options.map((o) => ({ id: o.id, label: o.label })) : DEFAULT_PERM_OPTIONS;
  const decision = await new Promise<ApprovalDecision>((resolve) => {
    input.emit({
      kind: "approval.requested",
      requestId: String(id),
      approvalKind: "permission",
      title,
      options: promptOpts,
      resolve,
    });
  });
  return selectedOutcome(decision.optionId);
};

const setOption = (rpc: StdioJsonRpcProcess, sessionId: string, configId: string, value: string) =>
  rpc.request("session/set_config_option", { sessionId, configId, value });

export const createAcpAdapter = (kind: AcpProviderKind) => ({
  kind,

  probe: (config: ProviderConfig, options?: { readonly dataDir?: string }) =>
    Effect.promise(async (): Promise<ProviderSnapshot> => {
      const spec = resolveAcpSpec(kind, config);
      const base = {
        ...config,
        setupHint: spec.setupHint,
        models: [...spec.fallbackModels],
        checkedAt: new Date().toISOString(),
      };
      const fail = (message: string, resolvedPath?: string): ProviderSnapshot => ({
        ...base,
        ...(resolvedPath ? { resolvedPath } : {}),
        status: "unavailable",
        message,
      });
      if (!config.enabled) return { ...base, status: "disabled" };

      const bin = resolveAcpBinary(kind, config, spec.defaultBinary);
      if (!bin) {
        return fail(
          kind === "acp-registry"
            ? `${spec.name} binary path is not configured or missing.`
            : `${spec.name} CLI (${spec.defaultBinary}) not found on PATH.`,
        );
      }
      let runtime: ResolvedProviderRuntime;
      try {
        runtime = buildAcpRuntime(kind, config, options?.dataDir);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err), bin);
      }
      const vp = await runAcpProbeCommand(bin, ["--version"], runtime.env);
      if (!vp.ok && kind !== "acp-registry")
        return fail(vp.stderr || `Failed to execute ${spec.name} CLI.`, bin);
      const version = vp.ok ? parseVersionNumber(vp.stdout || vp.stderr) : config.acpVersion;
      const rpc = new StdioJsonRpcProcess({
        command: bin,
        args: buildAcpArgs(kind, runtime, config.launchArgs),
        cwd: NodeOS.homedir(),
        env: runtime.env,
        replaceEnv: true,
      });
      return {
        ...base,
        resolvedPath: bin,
        ...(version ? { version } : {}),
        ...(await runAcpSessionProbe(
          rpc,
          config.acpAgentId ?? kind,
          spec,
          vp.ok,
          extractAcpModels,
          NodeOS.homedir(),
        )),
      };
    }),

  runTurn: async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
    const spec = resolveAcpSpec(kind, input.config);
    const executable = resolveAcpBinary(kind, input.config, spec.defaultBinary);
    if (!executable)
      throw new Error(`${spec.name} CLI binary not found. Configure it in Settings.`);
    const runtime = buildAcpRuntime(kind, input.config);
    const agentId = input.config.acpAgentId ?? kind;
    const turnStartMs = Date.now();
    let activeSessionId = input.providerSessionId;
    let latestUsage: TurnUsage | undefined;
    let firstTokenMs: number | undefined;
    let turnEnded = false;
    const seenToolIds = new Set<string>();

    const rpc = new StdioJsonRpcProcess({
      command: executable,
      args: buildAcpArgs(kind, runtime, input.config.launchArgs),
      cwd: input.cwd,
      env: { ...runtime.env, ...input.extraEnv },
      replaceEnv: true,
      onNotification: ({ method, params }) =>
        handleAcpNotification(
          agentId,
          seenToolIds,
          input,
          method,
          params,
          (u) => {
            latestUsage = u;
          },
          () => {
            if (firstTokenMs === undefined) firstTokenMs = Math.max(0, Date.now() - turnStartMs);
          },
        ),
      onRequest: ({ id, method, params }) =>
        method === "session/request_permission"
          ? handleAcpPermission(agentId, input, id, params)
          : Promise.resolve({}),
    });

    const onAbort = () => {
      turnEnded = true;
      if (activeSessionId) rpc.notify("session/cancel", { sessionId: activeSessionId });
      rpc.kill();
    };
    if (input.signal.aborted) onAbort();
    else input.signal.addEventListener("abort", onAbort, { once: true });

    try {
      const initRes = await rpc.request("initialize", acpInitParams(agentId));
      const ac = isObject(initRes) ? initRes.agentCapabilities : null;
      const supportsImages =
        isObject(ac) && isObject(ac.promptCapabilities) && ac.promptCapabilities.image === true;
      const mcpServers = buildAcpMcpServers(ac, input.mcpServer);
      const { sessionId, sessionResult, turnPrompt } = await openAcpSession(rpc, input, mcpServers);
      activeSessionId = sessionId;

      if (
        input.model.trim() &&
        input.model !== "default" &&
        (shouldAlwaysSetModel(agentId) || currentAcpModel(sessionResult) !== input.model)
      ) {
        await setOption(rpc, sessionId, "model", input.model).catch(() =>
          rpc.request("session/set_model", { sessionId, modelId: input.model }).catch(() => null),
        );
      }
      const thinkId = input.effort ? asString(findThinkingCfg(sessionResult)?.id) : undefined;
      if (input.effort && thinkId) {
        await setOption(rpc, sessionId, thinkId, input.effort).catch(() => null);
      }

      input.registerSteer?.(async (payload) => {
        if (turnEnded || input.signal.aborted || !activeSessionId) return false;
        const steerAttachments = filterImageAttachments(payload.attachments);
        try {
          await rpc.request(
            "session/prompt",
            {
              sessionId: activeSessionId,
              prompt: buildAcpPromptBlocks(payload.prompt, steerAttachments, supportsImages),
            },
            30 * 60 * 1000,
          );
          return true;
        } catch {
          return false;
        }
      });

      const attachments = filterImageAttachments(input.resolvedAttachments);
      const promptRes = await rpc.request(
        "session/prompt",
        { sessionId, prompt: buildAcpPromptBlocks(turnPrompt, attachments, supportsImages) },
        30 * 60 * 1000,
      );
      turnEnded = true;
      const costUsd = parseAcpCostUsd(promptRes);
      const pu = isObject(promptRes) ? parseAcpUsage(promptRes) : undefined;
      const usage =
        pu?.contextWindowTokens === undefined &&
        pu &&
        latestUsage?.contextWindowTokens !== undefined
          ? { ...pu, contextWindowTokens: latestUsage.contextWindowTokens }
          : (pu ?? latestUsage);
      if (pu && usage) input.emit({ kind: "usage", usage });
      return {
        ...(sessionId ? { providerSessionId: sessionId } : {}),
        ...(input.signal.aborted ? { interrupted: true } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
        ...(usage ? { usage } : {}),
        ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
      };
    } finally {
      turnEnded = true;
      input.signal.removeEventListener("abort", onAbort);
      rpc.kill();
    }
  },
});
