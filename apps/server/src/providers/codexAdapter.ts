import * as NodeOS from "node:os";
import type {
  EffortLevel,
  ProviderConfig,
  ProviderModel,
  ProviderSnapshot,
  RuntimeMode,
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
import { parseCodexTokenUsage } from "./usageParsing.ts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const VALID_EFFORTS = new Set<EffortLevel>(["low", "medium", "high", "xhigh", "max"]);

const toEffort = (value: unknown): EffortLevel | undefined => {
  if (typeof value !== "string") return undefined;
  return VALID_EFFORTS.has(value as EffortLevel) ? (value as EffortLevel) : undefined;
};

const parseCodexModels = (raw: unknown): ReadonlyArray<ProviderModel> => {
  if (!isObject(raw)) return [];
  const list = Array.isArray(raw.data) ? raw.data : Array.isArray(raw.models) ? raw.models : [];
  const models: ProviderModel[] = [];
  for (const entry of list) {
    if (!isObject(entry)) continue;
    if (entry.hidden === true) continue;
    const slug = asString(entry.model) ?? asString(entry.id) ?? asString(entry.slug);
    if (!slug) continue;
    const name = asString(entry.displayName) ?? asString(entry.name) ?? slug;
    const efforts: EffortLevel[] = [];
    if (Array.isArray(entry.supportedReasoningEfforts)) {
      for (const eff of entry.supportedReasoningEfforts) {
        const effStr = isObject(eff) ? eff.reasoningEffort : eff;
        const parsed = toEffort(effStr);
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

const mapApprovalPolicy = (mode: RuntimeMode): string => {
  switch (mode) {
    case "full-access":
      return "never";
    case "auto":
      return "on-request";
    case "approval-required":
      return "untrusted";
  }
};

const mapSandbox = (mode: RuntimeMode): string =>
  mode === "full-access" ? "danger-full-access" : "workspace-write";

const describeCodexItem = (item: Record<string, unknown>) => {
  const itemType = asString(item.type) ?? "tool";
  if (itemType === "commandExecution") {
    const cmd = Array.isArray(item.command)
      ? item.command.filter((p): p is string => typeof p === "string").join(" ")
      : asString(item.command);
    return presentToolActivity("command_execution", { command: cmd });
  }
  if (itemType === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const first = changes[0];
    const firstPath = isObject(first) ? asString(first.path) : undefined;
    return presentToolActivity("file_change", { path: firstPath });
  }
  if (itemType === "mcpToolCall") {
    const tool = asString(item.tool) ?? "mcp_tool";
    return presentToolActivity(tool, item.arguments);
  }
  if (itemType === "webSearch") {
    return presentToolActivity("web_search", { query: asString(item.query) });
  }
  return presentToolActivity(itemType, item);
};

export const codexAdapter: HarnessAdapter = {
  kind: "codex",

  probe: (config: ProviderConfig) =>
    Effect.promise(async (): Promise<ProviderSnapshot> => {
      const spec = getBuiltInProviderSpec("codex");
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
          message: "Codex CLI not found on PATH.",
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
          message: versionProbe.stderr || "Failed to execute Codex CLI.",
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
        args: [
          "app-server",
          "-c",
          "thread_unload_delay_secs=0",
          ...tokenizeLaunchArgs(config.launchArgs),
        ],
        cwd: NodeOS.homedir(),
      });

      try {
        await rpc.request(
          "initialize",
          {
            clientInfo: { name: "Scuttle", title: "Scuttle", version: "0.1.0" },
            capabilities: { experimentalApi: true },
          },
          7_000,
        );
        rpc.notify("initialized");

        const [accountRes, modelRes] = await Promise.all([
          rpc.request("account/read", {}, 6_000).catch(() => null),
          rpc.request("model/list", { includeHidden: false }, 6_000).catch(() => null),
        ]);

        const discovered = parseCodexModels(modelRes);
        if (discovered.length > 0) {
          models = discovered;
        }
        if (isObject(accountRes) && accountRes.requiresOpenaiAuth === true && !accountRes.account) {
          status = "unauthenticated";
          message = "Run `codex login` to sign in to Codex.";
        }
      } catch {
        // Keep bundled fallback models if app-server probe timed out.
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
    const spec = getBuiltInProviderSpec("codex");
    const executable = resolveExecutable(input.config.binaryPath, spec.defaultBinary);
    if (!executable) {
      throw new Error("Codex CLI binary not found. Configure it in Settings.");
    }

    let providerThreadId = input.providerSessionId;
    let activeTurnId: string | undefined;
    let streamedAssistant = "";
    let finalAssistantText: string | undefined;
    let latestUsage: TurnUsage | undefined;

    let resolveDone!: () => void;
    let rejectDone!: (error: Error) => void;
    const turnDone = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    const rpc = new StdioJsonRpcProcess({
      command: executable,
      args: [
        "app-server",
        "-c",
        "thread_unload_delay_secs=0",
        ...tokenizeLaunchArgs(input.config.launchArgs),
      ],
      cwd: input.cwd,
      ...(input.extraEnv ? { env: input.extraEnv } : {}),
      onNotification: ({ method, params }) => {
        if (!isObject(params)) return;

        if (method === "item/agentMessage/delta") {
          const delta = asString(params.delta);
          if (delta) {
            streamedAssistant += delta;
            input.emit({ kind: "assistant.delta", text: delta });
          }
          return;
        }

        if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
          const delta = asString(params.delta);
          if (delta) {
            input.emit({ kind: "thinking.delta", text: delta });
          }
          return;
        }

        if (method === "item/started" && isObject(params.item)) {
          const item = params.item;
          const itemId = asString(item.id);
          const itemType = asString(item.type);
          if (
            !itemId ||
            itemType === "agentMessage" ||
            itemType === "userMessage" ||
            itemType === "reasoning"
          ) {
            return;
          }
          const pres = describeCodexItem(item);
          input.emit({
            kind: "activity.started",
            key: itemId,
            activityKind: pres.activityKind,
            label: pres.label,
            activeLabel: pres.activeLabel,
            ...(pres.detail ? { detail: pres.detail } : {}),
          });
          return;
        }

        if (method === "item/completed" && isObject(params.item)) {
          const item = params.item;
          const itemId = asString(item.id);
          const itemType = asString(item.type);
          if (itemType === "agentMessage") {
            const text = asString(item.text);
            if (text) {
              finalAssistantText = text;
              if (streamedAssistant.length === 0) {
                input.emit({ kind: "assistant.replace", text });
              }
            }
            return;
          }
          if (!itemId || itemType === "userMessage" || itemType === "reasoning") return;
          const failed = item.status === "failed" || item.status === "declined";
          input.emit({
            kind: "activity.updated",
            key: itemId,
            status: failed ? "failed" : "completed",
          });
          return;
        }

        if (method === "thread/tokenUsage/updated") {
          const usage = parseCodexTokenUsage(params);
          if (usage) {
            latestUsage = usage;
            input.emit({ kind: "usage", usage });
          }
          return;
        }

        if (method === "turn/completed") {
          const turn = isObject(params.turn) ? params.turn : undefined;
          const status = asString(turn?.status);
          if (status === "failed") {
            const errObj = isObject(turn?.error) ? turn.error : undefined;
            const msg = asString(errObj?.message) ?? "Codex turn failed.";
            rejectDone(new Error(msg));
          } else {
            resolveDone();
          }
        }
      },
      onRequest: async ({ id, method, params }) => {
        if (
          method === "item/commandExecution/requestApproval" ||
          method === "item/fileChange/requestApproval"
        ) {
          if (input.runtimeMode === "full-access") {
            return { decision: "accept" };
          }
          const rec = isObject(params) ? params : {};
          const reason = asString(rec.reason);
          const command = asString(rec.command) ?? reason;
          const decision = await new Promise<ApprovalDecision>((resolve) => {
            input.emit({
              kind: "approval.requested",
              requestId: String(id),
              approvalKind: "permission",
              title:
                method === "item/commandExecution/requestApproval"
                  ? "Approve command execution"
                  : "Approve file changes",
              ...(reason !== undefined ? { description: reason } : {}),
              ...(command !== undefined ? { command } : {}),
              options: [
                { id: "accept", label: "Approve once" },
                { id: "acceptForSession", label: "Approve for session" },
                { id: "decline", label: "Decline" },
              ],
              resolve,
            });
          });
          return { decision: decision.optionId };
        }

        if (method === "item/tool/requestUserInput") {
          const rec = isObject(params) ? params : {};
          const questions = Array.isArray(rec.questions) ? rec.questions : [];
          const first = isObject(questions[0]) ? questions[0] : undefined;
          const qId = asString(first?.id) ?? "answer";
          const questionText = asString(first?.question);
          const rawOpts = Array.isArray(first?.options) ? first.options : [];
          const options = rawOpts.flatMap((opt) => {
            if (!isObject(opt)) return [];
            const label = asString(opt.label);
            if (!label) return [];
            const description = asString(opt.description);
            return [{ id: label, label, ...(description !== undefined ? { description } : {}) }];
          });
          const decision = await new Promise<ApprovalDecision>((resolve) => {
            input.emit({
              kind: "approval.requested",
              requestId: String(id),
              approvalKind: "question",
              title: asString(first?.header) ?? "Codex needs your input",
              ...(questionText !== undefined ? { description: questionText } : {}),
              options: options.length > 0 ? options : [{ id: "Continue", label: "Continue" }],
              resolve,
            });
          });
          const answer = decision.customText?.trim() || decision.optionId;
          return { answers: { [qId]: { answers: [answer] } } };
        }

        return {};
      },
    });

    const onAbort = () => {
      if (providerThreadId && activeTurnId) {
        void rpc
          .request("turn/interrupt", { threadId: providerThreadId, turnId: activeTurnId }, 3_000)
          .catch(() => {});
      }
      rpc.kill();
      resolveDone();
    };
    if (input.signal.aborted) {
      onAbort();
    } else {
      input.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      await rpc.request("initialize", {
        clientInfo: { name: "Scuttle", title: "Scuttle", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      rpc.notify("initialized");

      let turnPrompt = input.prompt;
      if (providerThreadId) {
        const resumed = await rpc
          .request("thread/resume", {
            threadId: providerThreadId,
            cwd: input.cwd,
            model: input.model,
            approvalPolicy: mapApprovalPolicy(input.runtimeMode),
            sandbox: mapSandbox(input.runtimeMode),
          })
          .catch(() => null);
        if (!isObject(resumed)) {
          providerThreadId = undefined;
          turnPrompt = input.freshSessionPrompt ?? input.prompt;
        }
      }

      if (!providerThreadId) {
        const started = await rpc.request("thread/start", {
          cwd: input.cwd,
          model: input.model,
          approvalPolicy: mapApprovalPolicy(input.runtimeMode),
          sandbox: mapSandbox(input.runtimeMode),
        });
        const threadObj =
          isObject(started) && isObject(started.thread) ? started.thread : undefined;
        providerThreadId = asString(threadObj?.id);
        if (providerThreadId) {
          input.emit({ kind: "session", providerSessionId: providerThreadId });
        }
      }

      if (!providerThreadId) {
        throw new Error("Codex app-server did not return a thread ID.");
      }

      const turnStartRes = await rpc.request("turn/start", {
        threadId: providerThreadId,
        input: [{ type: "text", text: turnPrompt }],
        model: input.model,
        ...(input.effort ? { effort: input.effort } : {}),
        cwd: input.cwd,
      });
      const turnObj =
        isObject(turnStartRes) && isObject(turnStartRes.turn) ? turnStartRes.turn : undefined;
      activeTurnId = asString(turnObj?.id);

      await Promise.race([
        turnDone,
        rpc.exited.then((code) => {
          if (!input.signal.aborted && code !== 0) {
            throw new Error(rpc.stderr.trim() || `Codex app-server exited with code ${code}.`);
          }
        }),
      ]);
    } finally {
      input.signal.removeEventListener("abort", onAbort);
      rpc.kill();
    }

    return {
      ...(finalAssistantText ? { finalText: finalAssistantText } : {}),
      ...(providerThreadId ? { providerSessionId: providerThreadId } : {}),
      ...(input.signal.aborted ? { interrupted: true } : {}),
      ...(latestUsage ? { usage: latestUsage } : {}),
    };
  },
};
