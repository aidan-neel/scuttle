import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ResolvedProviderRuntime } from "./shadowHomes.ts";
import {
  filterImageAttachments,
  type HarnessTurnInput,
  MAX_IMAGE_ATTACHMENT_BYTES,
  type ResolvedAttachment,
  toBase64,
} from "./types.ts";

export const buildClaudeMcpConfigArg = (
  mcpServer: NonNullable<HarnessTurnInput["mcpServer"]>,
): string =>
  JSON.stringify({
    mcpServers: {
      scuttle: {
        type: "http",
        url: mcpServer.url,
        headers: { Authorization: mcpServer.authorizationHeader },
      },
    },
  });

export const buildClaudeUserContent = (
  prompt: string,
  resolvedAttachments: ReadonlyArray<ResolvedAttachment> | undefined,
): string | ReadonlyArray<Record<string, unknown>> => {
  const imageAttachments = filterImageAttachments(resolvedAttachments);
  const totalImageBytes = imageAttachments.reduce((sum, att) => sum + att.bytes.byteLength, 0);
  if (totalImageBytes > MAX_IMAGE_ATTACHMENT_BYTES) {
    throw new Error("Total image attachments exceed the 20 MB limit.");
  }
  if (imageAttachments.length === 0) return prompt;
  return [
    ...imageAttachments.map((att) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: att.mimeType,
        data: toBase64(att.bytes),
      },
    })),
    { type: "text" as const, text: prompt },
  ];
};

export const buildClaudeSteerMessage = (
  prompt: string,
  resolvedAttachments: ReadonlyArray<ResolvedAttachment> | undefined,
) => ({
  type: "user" as const,
  uuid: crypto.randomUUID(),
  priority: "next" as const,
  message: {
    role: "user" as const,
    content: buildClaudeUserContent(prompt, resolvedAttachments),
  },
});

export const runClaudeProbeWithEnv = async (
  command: string,
  args: ReadonlyArray<string>,
  env: Record<string, string>,
  timeoutMs = 5_000,
): Promise<{ readonly ok: boolean; readonly stdout: string; readonly stderr: string }> => {
  try {
    const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe", env });
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
    }, timeoutMs);
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

export const hasClaudeAuthHints = (runtime: ResolvedProviderRuntime): boolean => {
  if (runtime.env.ANTHROPIC_API_KEY || runtime.env.ANTHROPIC_AUTH_TOKEN) return true;
  const configuredDir = runtime.env.CLAUDE_CONFIG_DIR?.trim();
  const candidates = configuredDir
    ? [
        NodePath.join(configuredDir, ".credentials.json"),
        NodePath.join(configuredDir, ".claude.json"),
      ]
    : [
        NodePath.join(NodeOS.homedir(), ".claude", ".credentials.json"),
        NodePath.join(NodeOS.homedir(), ".claude.json"),
      ];
  return candidates.some((file) => NodeFS.existsSync(file));
};
