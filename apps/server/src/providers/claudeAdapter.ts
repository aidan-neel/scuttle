import type { ProviderConfig, ProviderSnapshot, TurnUsage } from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import { defaultServerConfig } from "../config.ts";
import {
  getBuiltInProviderSpec,
  parseVersionNumber,
  resolveExecutable,
  tokenizeLaunchArgs,
} from "./catalog.ts";
import {
  buildClaudeMcpConfigArg,
  buildClaudeSteerMessage,
  buildClaudeUserContent,
  hasClaudeAuthHints,
  runClaudeProbeWithEnv,
} from "./claudeMcpAndSteer.ts";
import { handleClaudeControlRequest } from "./claudePermissions.ts";
import { materializeProviderRuntime, type ResolvedProviderRuntime } from "./shadowHomes.ts";
import { presentToolActivity } from "./toolLabel.ts";
import type {
  ApprovalDecision,
  HarnessAdapter,
  HarnessTurnInput,
  HarnessTurnResult,
} from "./types.ts";
import { parseClaudeUsage } from "./usageParsing.ts";

export { isScuttleBridgeCurl } from "./claudePermissions.ts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const mapPermissionMode = (input: HarnessTurnInput): string => {
  if (input.interactionMode === "plan") return "plan";
  switch (input.runtimeMode) {
    case "full-access":
      return "bypassPermissions";
    case "auto":
      return "acceptEdits";
    case "approval-required":
      return "default";
  }
};

const buildClaudeRuntime = (config: ProviderConfig, dataDir?: string): ResolvedProviderRuntime =>
  materializeProviderRuntime({
    instanceId: config.id,
    kind: "claude",
    dataDir: dataDir ?? process.env.SCUTTLE_DATA_DIR ?? defaultServerConfig().dataDir,
    ...(config.homePath ? { homePath: config.homePath } : {}),
    ...(config.shadowHomePath ? { shadowHomePath: config.shadowHomePath } : {}),
    ...(config.env ? { env: config.env } : {}),
  });

export const claudeAdapter: HarnessAdapter & {
  readonly probe: (
    config: ProviderConfig,
    options?: { readonly dataDir?: string },
  ) => Effect.Effect<ProviderSnapshot>;
} = {
  kind: "claude",

  probe: (config: ProviderConfig, options?: { readonly dataDir?: string }) =>
    Effect.promise(async (): Promise<ProviderSnapshot> => {
      const spec = getBuiltInProviderSpec("claude");
      const checkedAt = new Date().toISOString();
      const baseSnap = {
        ...config,
        setupHint: spec.setupHint,
        models: [...spec.fallbackModels],
        checkedAt,
      };
      if (!config.enabled) return { ...baseSnap, status: "disabled" };

      const resolvedPath = resolveExecutable(config.binaryPath, spec.defaultBinary);
      if (!resolvedPath) {
        return { ...baseSnap, status: "unavailable", message: "Claude CLI not found on PATH." };
      }

      let runtime: ResolvedProviderRuntime;
      try {
        runtime = buildClaudeRuntime(config, options?.dataDir);
      } catch (err) {
        return {
          ...baseSnap,
          resolvedPath,
          status: "unavailable",
          message: err instanceof Error ? err.message : String(err),
        };
      }

      const probe = await runClaudeProbeWithEnv(resolvedPath, ["--version"], runtime.env);
      if (!probe.ok) {
        return {
          ...baseSnap,
          resolvedPath,
          status: "unavailable",
          message: probe.stderr || "Failed to execute Claude CLI.",
        };
      }

      const version = parseVersionNumber(probe.stdout || probe.stderr);
      const authed = hasClaudeAuthHints(runtime);
      return {
        ...baseSnap,
        resolvedPath,
        ...(version ? { version } : {}),
        status: authed ? "ready" : "unauthenticated",
        ...(authed ? {} : { message: "Run `claude login` to authenticate Claude Code." }),
      };
    }),

  runTurn: async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
    const spec = getBuiltInProviderSpec("claude");
    const executable = resolveExecutable(input.config.binaryPath, spec.defaultBinary);
    if (!executable) {
      throw new Error("Claude CLI binary not found. Configure it in Settings.");
    }

    const initialContent = buildClaudeUserContent(input.prompt, input.resolvedAttachments);

    const args: string[] = [
      "--print",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      mapPermissionMode(input),
      "--permission-prompt-tool",
      "stdio",
    ];

    if (input.runtimeMode === "full-access") {
      args.push("--allow-dangerously-skip-permissions");
    }
    if (input.model.trim().length > 0 && input.model !== "default") {
      args.push("--model", input.model);
    }
    if (input.effort) {
      args.push("--effort", input.effort);
    }
    if (input.providerSessionId) {
      args.push("--resume", input.providerSessionId);
    }
    if (input.mcpServer) {
      args.push("--mcp-config", buildClaudeMcpConfigArg(input.mcpServer));
    }
    const runtime = buildClaudeRuntime(input.config);
    args.push(...runtime.extraLaunchArgs, ...tokenizeLaunchArgs(input.config.launchArgs));

    const env: Record<string, string> = { ...runtime.env };
    if (input.extraEnv) {
      for (const [k, v] of Object.entries(input.extraEnv)) {
        env[k] = v;
      }
    }

    const turnStartMs = Date.now();
    const proc = Bun.spawn([executable, ...args], {
      cwd: input.cwd,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    let stdinClosed = false;
    let turnEnded = false;
    const writeStdin = (payload: unknown): boolean => {
      if (stdinClosed || turnEnded) return false;
      try {
        proc.stdin.write(`${JSON.stringify(payload)}\n`);
        void proc.stdin.flush();
        return true;
      } catch {
        stdinClosed = true;
        return false;
      }
    };
    const closeStdin = () => {
      if (stdinClosed) return;
      stdinClosed = true;
      try {
        void proc.stdin.end();
      } catch {
        // Ignore already-closed stdin.
      }
    };

    const pendingApprovalResolvers = new Set<(decision: ApprovalDecision) => void>();

    const onAbort = () => {
      turnEnded = true;
      for (const resolve of pendingApprovalResolvers) {
        resolve({ optionId: "deny", customText: "Turn interrupted." });
      }
      pendingApprovalResolvers.clear();
      closeStdin();
      try {
        proc.kill("SIGTERM");
      } catch {
        // Ignore already-exited process.
      }
    };
    if (input.signal.aborted) {
      onAbort();
    } else {
      input.signal.addEventListener("abort", onAbort, { once: true });
      writeStdin({
        type: "user",
        message: { role: "user", content: initialContent },
      });
      input.registerSteer?.(async (payload) => {
        if (stdinClosed || turnEnded || input.signal.aborted) return false;
        try {
          return writeStdin(buildClaudeSteerMessage(payload.prompt, payload.attachments));
        } catch {
          return false;
        }
      });
    }

    let providerSessionId = input.providerSessionId;
    let streamedAssistant = "";
    let finalResultText: string | undefined;
    let resultError: string | undefined;
    let costUsd: number | undefined;
    let turnUsage: TurnUsage | undefined;
    let firstTokenMs: number | undefined;
    const seenToolIds = new Set<string>();
    let stderrText = "";

    const markFirstToken = () => {
      if (firstTokenMs === undefined) {
        firstTokenMs = Math.max(0, Date.now() - turnStartMs);
      }
    };

    const stderrPromise = (async () => {
      try {
        stderrText = await new Response(proc.stderr).text();
      } catch {
        // Ignore.
      }
    })();

    const processEvent = (parsed: Record<string, unknown>) => {
      const eventType = asString(parsed.type);
      const sessionId = asString(parsed.session_id);
      if (sessionId && sessionId !== providerSessionId) {
        providerSessionId = sessionId;
        input.emit({ kind: "session", providerSessionId: sessionId });
      }

      if (eventType === "control_request") {
        void handleClaudeControlRequest({
          parsed,
          input,
          writeStdin: (payload) => {
            writeStdin(payload);
          },
          pendingResolvers: pendingApprovalResolvers,
        });
        return;
      }

      if (eventType === "stream_event" && isObject(parsed.event)) {
        const inner = parsed.event;
        const innerType = asString(inner.type);
        if (innerType === "content_block_delta" && isObject(inner.delta)) {
          const deltaType = asString(inner.delta.type);
          if (deltaType === "text_delta" && typeof inner.delta.text === "string") {
            if (inner.delta.text.length > 0) markFirstToken();
            streamedAssistant += inner.delta.text;
            input.emit({ kind: "assistant.delta", text: inner.delta.text });
          } else if (deltaType === "thinking_delta" && typeof inner.delta.thinking === "string") {
            if (inner.delta.thinking.length > 0) markFirstToken();
            input.emit({ kind: "thinking.delta", text: inner.delta.thinking });
          }
        } else if (innerType === "content_block_start" && isObject(inner.content_block)) {
          const block = inner.content_block;
          if (block.type === "tool_use") {
            const toolId = asString(block.id);
            const toolName = asString(block.name) ?? "tool";
            if (toolId && !seenToolIds.has(toolId)) {
              seenToolIds.add(toolId);
              const pres = presentToolActivity(toolName, block.input);
              input.emit({
                kind: "activity.started",
                key: toolId,
                activityKind: pres.activityKind,
                label: pres.label,
                activeLabel: pres.activeLabel,
                ...(pres.detail ? { detail: pres.detail } : {}),
              });
            }
          }
        }
        return;
      }

      if (eventType === "assistant" && isObject(parsed.message)) {
        const content = parsed.message.content;
        if (Array.isArray(content)) {
          let messageText = "";
          for (const block of content) {
            if (!isObject(block)) continue;
            if (block.type === "tool_use") {
              const toolId = asString(block.id);
              const toolName = asString(block.name) ?? "tool";
              if (toolId) {
                const pres = presentToolActivity(toolName, block.input);
                if (!seenToolIds.has(toolId)) {
                  seenToolIds.add(toolId);
                  input.emit({
                    kind: "activity.started",
                    key: toolId,
                    activityKind: pres.activityKind,
                    label: pres.label,
                    activeLabel: pres.activeLabel,
                    ...(pres.detail ? { detail: pres.detail } : {}),
                  });
                } else {
                  input.emit({
                    kind: "activity.updated",
                    key: toolId,
                    status: "running",
                    label: pres.label,
                    activeLabel: pres.activeLabel,
                    ...(pres.detail ? { detail: pres.detail } : {}),
                  });
                }
              }
            } else if (block.type === "text" && typeof block.text === "string") {
              messageText += block.text;
            }
          }
          if (messageText.length > 0 && streamedAssistant.length === 0) {
            markFirstToken();
            streamedAssistant = messageText;
            input.emit({ kind: "assistant.replace", text: messageText });
          }
        }
        return;
      }

      if (eventType === "user" && isObject(parsed.message)) {
        const content = parsed.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (!isObject(block) || block.type !== "tool_result") continue;
            const toolUseId = asString(block.tool_use_id);
            if (!toolUseId) continue;
            const isError = block.is_error === true;
            input.emit({
              kind: "activity.updated",
              key: toolUseId,
              status: isError ? "failed" : "completed",
            });
          }
        }
        return;
      }

      if (eventType === "result") {
        if (typeof parsed.total_cost_usd === "number" && Number.isFinite(parsed.total_cost_usd)) {
          costUsd = parsed.total_cost_usd;
        }
        const parsedUsage = parseClaudeUsage(parsed, input.model);
        if (parsedUsage) {
          turnUsage = parsedUsage;
          input.emit({ kind: "usage", usage: parsedUsage });
        }
        if (parsed.is_error === true) {
          resultError = asString(parsed.result) ?? "Claude Code returned an error.";
        } else if (typeof parsed.result === "string" && parsed.result.length > 0) {
          finalResultText = parsed.result;
          if (streamedAssistant.length === 0) {
            input.emit({ kind: "assistant.replace", text: parsed.result });
          }
        }
        turnEnded = true;
        closeStdin();
      }
    };

    try {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf("\n");
        while (idx !== -1) {
          const line = buffer.slice(0, idx).replace(/\r$/, "").trim();
          buffer = buffer.slice(idx + 1);
          if (line.length > 0) {
            try {
              const parsed: unknown = JSON.parse(line);
              if (isObject(parsed)) processEvent(parsed);
            } catch {
              // Ignore non-JSON diagnostic lines.
            }
          }
          idx = buffer.indexOf("\n");
        }
      }
    } finally {
      turnEnded = true;
      for (const resolve of pendingApprovalResolvers) {
        resolve({ optionId: "deny", customText: "Claude process exited." });
      }
      pendingApprovalResolvers.clear();
      closeStdin();
      input.signal.removeEventListener("abort", onAbort);
    }

    const exitCode = await proc.exited;
    await stderrPromise;

    if (input.signal.aborted) {
      return {
        ...(providerSessionId ? { providerSessionId } : {}),
        interrupted: true,
      };
    }

    if (resultError) {
      throw new Error(resultError);
    }

    if (exitCode !== 0 && streamedAssistant.length === 0 && !finalResultText) {
      throw new Error(stderrText.trim() || `Claude CLI exited with status ${exitCode}.`);
    }

    return {
      ...(finalResultText ? { finalText: finalResultText } : {}),
      ...(providerSessionId ? { providerSessionId } : {}),
      ...(costUsd !== undefined && costUsd > 0 ? { costUsd } : {}),
      ...(turnUsage ? { usage: turnUsage } : {}),
      ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
    };
  },
};
