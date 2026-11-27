import * as NodeOS from "node:os";
import type {
  ProviderConfig,
  ProviderModel,
  ProviderSnapshot,
  TurnUsage,
} from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import { defaultServerConfig } from "../config.ts";
import {
  getBuiltInProviderSpec,
  parseVersionNumber,
  resolveExecutable,
  tokenizeLaunchArgs,
} from "./catalog.ts";
import {
  buildCodexMcpConfig,
  buildCodexTurnInput,
  buildCodexUserInputResponse,
  describeCodexItem,
  mapApprovalPolicy,
  mapSandbox,
  parseCodexModels,
  parseCodexUserInputQuestions,
  runCodexProbeWithEnv,
} from "./codexHelpers.ts";
import { materializeProviderRuntime, type ResolvedProviderRuntime } from "./shadowHomes.ts";
import { StdioJsonRpcProcess } from "./stdioJsonRpc.ts";
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

const buildCodexRuntime = (config: ProviderConfig, dataDir?: string): ResolvedProviderRuntime =>
  materializeProviderRuntime({
    instanceId: config.id,
    kind: "codex",
    dataDir: dataDir ?? process.env.SCUTTLE_DATA_DIR ?? defaultServerConfig().dataDir,
    ...(config.homePath ? { homePath: config.homePath } : {}),
    ...(config.shadowHomePath ? { shadowHomePath: config.shadowHomePath } : {}),
    ...(config.env ? { env: config.env } : {}),
  });

export const codexAdapter: HarnessAdapter & {
  readonly probe: (
    config: ProviderConfig,
    options?: { readonly dataDir?: string },
  ) => Effect.Effect<ProviderSnapshot>;
} = {
  kind: "codex",

  probe: (config: ProviderConfig, options?: { readonly dataDir?: string }) =>
    Effect.promise(async (): Promise<ProviderSnapshot> => {
      const spec = getBuiltInProviderSpec("codex");
      const baseSnap = {
        ...config,
        setupHint: spec.setupHint,
        models: [...spec.fallbackModels],
        checkedAt: new Date().toISOString(),
      };
      const failSnap = (message: string, resolvedPath?: string): ProviderSnapshot => ({
        ...baseSnap,
        ...(resolvedPath ? { resolvedPath } : {}),
        status: "unavailable",
        message,
      });
      if (!config.enabled) return { ...baseSnap, status: "disabled" };

      const resolvedPath = resolveExecutable(config.binaryPath, spec.defaultBinary);
      if (!resolvedPath) return failSnap("Codex CLI not found on PATH.");

      let runtime: ResolvedProviderRuntime;
      try {
        runtime = buildCodexRuntime(config, options?.dataDir);
      } catch (err) {
        return failSnap(err instanceof Error ? err.message : String(err), resolvedPath);
      }

      const versionProbe = await runCodexProbeWithEnv(resolvedPath, ["--version"], runtime.env);
      if (!versionProbe.ok) {
        return failSnap(versionProbe.stderr || "Failed to execute Codex CLI.", resolvedPath);
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
          ...runtime.extraLaunchArgs,
          ...tokenizeLaunchArgs(config.launchArgs),
        ],
        cwd: NodeOS.homedir(),
        env: runtime.env,
        replaceEnv: true,
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
        if (discovered.length > 0) models = discovered;
        if (isObject(accountRes) && accountRes.requiresOpenaiAuth === true && !accountRes.account) {
          status = "unauthenticated";
          message = "Run `codex login` to sign in to Codex.";
        }
      } catch {
        /* keep bundled fallback models */
      } finally {
        rpc.kill();
      }
      return {
        ...baseSnap,
        resolvedPath,
        ...(version ? { version } : {}),
        status,
        ...(message ? { message } : {}),
        models: [...models],
      };
    }),

  runTurn: async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
    const spec = getBuiltInProviderSpec("codex");
    const executable = resolveExecutable(input.config.binaryPath, spec.defaultBinary);
    if (!executable) throw new Error("Codex CLI binary not found. Configure it in Settings.");
    const runtime = buildCodexRuntime(input.config);
    const mergedEnv = { ...runtime.env, ...input.extraEnv };

    const turnStartMs = Date.now();
    let providerThreadId = input.providerSessionId;
    let activeTurnId: string | undefined;
    let streamedAssistant = "";
    let finalAssistantText: string | undefined;
    let latestUsage: TurnUsage | undefined;
    let firstTokenMs: number | undefined;
    let turnEnded = false;

    const markFirstToken = () => {
      if (firstTokenMs === undefined) {
        firstTokenMs = Math.max(0, Date.now() - turnStartMs);
      }
    };

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
        ...runtime.extraLaunchArgs,
        ...tokenizeLaunchArgs(input.config.launchArgs),
      ],
      cwd: input.cwd,
      env: mergedEnv,
      replaceEnv: true,
      onNotification: ({ method, params }) => {
        if (!isObject(params)) return;

        if (method === "item/agentMessage/delta") {
          const delta = asString(params.delta);
          if (delta) {
            markFirstToken();
            streamedAssistant += delta;
            input.emit({ kind: "assistant.delta", text: delta });
          }
          return;
        }

        if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
          const delta = asString(params.delta);
          if (delta) {
            markFirstToken();
            input.emit({ kind: "thinking.delta", text: delta });
          }
          return;
        }

        if (method === "turn/started" && isObject(params.turn) && !activeTurnId) {
          activeTurnId = asString(params.turn.id);
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
                markFirstToken();
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
          turnEnded = true;
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
          if (input.runtimeMode === "full-access") return { decision: "accept" };
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
          const questions = parseCodexUserInputQuestions(rec.questions);
          const first = questions[0];
          const decision = await new Promise<ApprovalDecision>((resolve) => {
            if (input.signal.aborted) {
              resolve({ optionId: "decline", dismissed: true });
              return;
            }
            const onAbort = () => resolve({ optionId: "decline", dismissed: true });
            input.signal.addEventListener("abort", onAbort, { once: true });
            input.emit({
              kind: "approval.requested",
              requestId: String(id),
              approvalKind: "question",
              title: first?.header ?? "Codex needs your input",
              ...(first?.question !== undefined ? { description: first.question } : {}),
              options:
                first && first.options.length > 0
                  ? first.options
                  : [{ id: "Continue", label: "Continue" }],
              ...(questions.length > 0 ? { questions } : {}),
              resolve: (value) => {
                input.signal.removeEventListener("abort", onAbort);
                resolve(value);
              },
            });
          });
          return buildCodexUserInputResponse(questions, decision);
        }
        return {};
      },
    });

    const onAbort = () => {
      turnEnded = true;
      if (providerThreadId && activeTurnId) {
        void rpc
          .request("turn/interrupt", { threadId: providerThreadId, turnId: activeTurnId }, 3_000)
          .catch(() => {});
      }
      rpc.kill();
      resolveDone();
    };
    if (input.signal.aborted) onAbort();
    else input.signal.addEventListener("abort", onAbort, { once: true });

    try {
      await rpc.request("initialize", {
        clientInfo: { name: "Scuttle", title: "Scuttle", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      rpc.notify("initialized");

      let turnPrompt = input.prompt;
      const sessionOpts = {
        cwd: input.cwd,
        model: input.model,
        approvalPolicy: mapApprovalPolicy(input.runtimeMode),
        sandbox: mapSandbox(input.runtimeMode),
        ...buildCodexMcpConfig(input.mcpServer),
      };
      if (providerThreadId) {
        const resumed = await rpc
          .request("thread/resume", { threadId: providerThreadId, ...sessionOpts })
          .catch(() => null);
        if (!isObject(resumed)) {
          providerThreadId = undefined;
          turnPrompt = input.freshSessionPrompt ?? input.prompt;
        }
      }

      if (!providerThreadId) {
        const started = await rpc.request("thread/start", sessionOpts);
        const tid =
          isObject(started) && isObject(started.thread) ? asString(started.thread.id) : undefined;
        providerThreadId = tid;
        if (tid) input.emit({ kind: "session", providerSessionId: tid });
      }
      if (!providerThreadId) throw new Error("Codex app-server did not return a thread ID.");

      const turnInput = buildCodexTurnInput(turnPrompt, input.resolvedAttachments);
      const turnStartRes = await rpc.request("turn/start", {
        threadId: providerThreadId,
        input: turnInput,
        model: input.model,
        ...(input.effort ? { effort: input.effort } : {}),
        cwd: input.cwd,
      });
      activeTurnId =
        (isObject(turnStartRes) && isObject(turnStartRes.turn)
          ? asString(turnStartRes.turn.id)
          : undefined) ?? activeTurnId;

      input.registerSteer?.(async (payload) => {
        if (turnEnded || input.signal.aborted || !providerThreadId || !activeTurnId) return false;
        try {
          await rpc.request("turn/steer", {
            threadId: providerThreadId,
            expectedTurnId: activeTurnId,
            input: buildCodexTurnInput(payload.prompt, payload.attachments),
          });
          return true;
        } catch {
          return false;
        }
      });

      await Promise.race([
        turnDone,
        rpc.exited.then((code) => {
          if (!input.signal.aborted && code !== 0) {
            throw new Error(rpc.stderr.trim() || `Codex app-server exited with code ${code}.`);
          }
        }),
      ]);
    } finally {
      turnEnded = true;
      input.signal.removeEventListener("abort", onAbort);
      rpc.kill();
    }
    return {
      ...(finalAssistantText ? { finalText: finalAssistantText } : {}),
      ...(providerThreadId ? { providerSessionId: providerThreadId } : {}),
      ...(input.signal.aborted ? { interrupted: true } : {}),
      ...(latestUsage ? { usage: latestUsage } : {}),
      ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
    };
  },
};
