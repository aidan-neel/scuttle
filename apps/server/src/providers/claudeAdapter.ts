import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ProviderConfig, ProviderSnapshot } from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import {
  getBuiltInProviderSpec,
  parseVersionNumber,
  resolveExecutable,
  runCliProbe,
  tokenizeLaunchArgs,
} from "./catalog.ts";
import { presentToolActivity } from "./toolLabel.ts";
import type { HarnessAdapter, HarnessTurnInput, HarnessTurnResult } from "./types.ts";

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

const hasClaudeAuthHints = (): boolean => {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  const home = NodeOS.homedir();
  const candidates = [
    NodePath.join(home, ".claude", ".credentials.json"),
    NodePath.join(home, ".claude.json"),
  ];
  return candidates.some((file) => NodeFS.existsSync(file));
};

export const claudeAdapter: HarnessAdapter = {
  kind: "claude",

  probe: (config: ProviderConfig) =>
    Effect.promise(async (): Promise<ProviderSnapshot> => {
      const spec = getBuiltInProviderSpec("claude");
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
          message: "Claude CLI not found on PATH.",
          setupHint: spec.setupHint,
          models: [...spec.fallbackModels],
          checkedAt,
        };
      }

      const probe = await runCliProbe(resolvedPath, ["--version"]);
      if (!probe.ok) {
        return {
          ...config,
          resolvedPath,
          status: "unavailable",
          message: probe.stderr || "Failed to execute Claude CLI.",
          setupHint: spec.setupHint,
          models: [...spec.fallbackModels],
          checkedAt,
        };
      }

      const version = parseVersionNumber(probe.stdout || probe.stderr);
      const authed = hasClaudeAuthHints();

      return {
        ...config,
        resolvedPath,
        ...(version ? { version } : {}),
        status: authed ? "ready" : "unauthenticated",
        ...(authed ? {} : { message: "Run `claude login` to authenticate Claude Code." }),
        setupHint: spec.setupHint,
        models: [...spec.fallbackModels],
        checkedAt,
      };
    }),

  runTurn: async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
    const spec = getBuiltInProviderSpec("claude");
    const executable = resolveExecutable(input.config.binaryPath, spec.defaultBinary);
    if (!executable) {
      throw new Error("Claude CLI binary not found. Configure it in Settings.");
    }

    const args: string[] = [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      mapPermissionMode(input),
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
    args.push(...tokenizeLaunchArgs(input.config.launchArgs));
    args.push("--", input.prompt);

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "CLAUDECODE") env[k] = v;
    }
    if (input.extraEnv) {
      for (const [k, v] of Object.entries(input.extraEnv)) {
        env[k] = v;
      }
    }

    const proc = Bun.spawn([executable, ...args], {
      cwd: input.cwd,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    const onAbort = () => {
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
    }

    let providerSessionId = input.providerSessionId;
    let streamedAssistant = "";
    let finalResultText: string | undefined;
    let resultError: string | undefined;
    let costUsd: number | undefined;
    const seenToolIds = new Set<string>();
    let stderrText = "";

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

      if (eventType === "stream_event" && isObject(parsed.event)) {
        const inner = parsed.event;
        const innerType = asString(inner.type);
        if (innerType === "content_block_delta" && isObject(inner.delta)) {
          const deltaType = asString(inner.delta.type);
          if (deltaType === "text_delta" && typeof inner.delta.text === "string") {
            streamedAssistant += inner.delta.text;
            input.emit({ kind: "assistant.delta", text: inner.delta.text });
          } else if (deltaType === "thinking_delta" && typeof inner.delta.thinking === "string") {
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
        if (parsed.is_error === true) {
          resultError = asString(parsed.result) ?? "Claude Code returned an error.";
        } else if (typeof parsed.result === "string" && parsed.result.length > 0) {
          finalResultText = parsed.result;
          if (streamedAssistant.length === 0) {
            input.emit({ kind: "assistant.replace", text: parsed.result });
          }
        }
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
    };
  },
};
