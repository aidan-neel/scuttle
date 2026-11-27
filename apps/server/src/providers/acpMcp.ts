import * as NodePath from "node:path";
import type { ProviderModel, ProviderSnapshot } from "@scuttle/contracts";
import { buildClientCapabilitiesMeta } from "./acpQuirks.ts";
import type { StdioJsonRpcProcess } from "./stdioJsonRpc.ts";
import type { HarnessTurnInput } from "./types.ts";

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asString = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export const DEFAULT_ACP_STDIO_BRIDGE_PATH = NodePath.resolve(
  import.meta.dir,
  "../mcp/stdioBridge.ts",
);

export const buildAcpMcpServers = (
  agentCapabilities: unknown,
  mcpServer: HarnessTurnInput["mcpServer"],
  stdioBridgePath = DEFAULT_ACP_STDIO_BRIDGE_PATH,
): ReadonlyArray<Record<string, unknown>> => {
  if (!mcpServer) return [];
  const mcpCaps =
    isObject(agentCapabilities) && isObject(agentCapabilities.mcpCapabilities)
      ? agentCapabilities.mcpCapabilities
      : undefined;
  if (mcpCaps?.http === true) {
    return [
      {
        type: "http",
        name: "scuttle",
        url: mcpServer.url,
        headers: [{ name: "Authorization", value: mcpServer.authorizationHeader }],
      },
    ];
  }
  return [
    {
      name: "scuttle",
      command: process.execPath,
      args: [stdioBridgePath],
      env: [
        { name: "SCUTTLE_MCP_ENDPOINT", value: mcpServer.url },
        { name: "SCUTTLE_MCP_AUTHORIZATION", value: mcpServer.authorizationHeader },
      ],
    },
  ];
};

export const acpInitParams = (agentId: string, meta = buildClientCapabilitiesMeta(agentId)) => ({
  protocolVersion: 1,
  clientInfo: { name: "scuttle", title: "Scuttle", version: "0.1.0" },
  clientCapabilities: Object.keys(meta).length > 0 ? { _meta: meta } : {},
});

export const openAcpSession = async (
  rpc: StdioJsonRpcProcess,
  input: HarnessTurnInput,
  mcpServers: ReadonlyArray<Record<string, unknown>>,
) => {
  let sessionId = input.providerSessionId;
  let turnPrompt = input.prompt;
  let sessionResult: unknown = null;
  if (sessionId) {
    const p = { sessionId, cwd: input.cwd, mcpServers };
    sessionResult = await rpc
      .request("session/resume", p, 20_000)
      .catch(() => rpc.request("session/load", p, 20_000).catch(() => null));
    if (sessionResult === null) {
      sessionId = undefined;
      turnPrompt = input.freshSessionPrompt ?? input.prompt;
    }
  }
  if (!sessionId) {
    sessionResult = await rpc.request("session/new", { cwd: input.cwd, mcpServers }, 30_000);
    if (isObject(sessionResult)) sessionId = asString(sessionResult.sessionId);
    if (sessionId) input.emit({ kind: "session", providerSessionId: sessionId });
  }
  if (!sessionId) throw new Error("ACP did not return a session ID.");
  return { sessionId, sessionResult, turnPrompt };
};

export const runAcpProbeCommand = async (
  cmd: string,
  args: ReadonlyArray<string>,
  env: Record<string, string>,
) => {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env });
  const timer = setTimeout(() => {
    try {
      proc.kill("SIGKILL");
    } catch {}
  }, 5_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return { ok: false, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
};

export const runAcpSessionProbe = async (
  rpc: StdioJsonRpcProcess,
  agentId: string,
  spec: { readonly name: string; readonly fallbackModels: ReadonlyArray<ProviderModel> },
  versionOk: boolean,
  extractModels: (
    sr: unknown,
    fallback: ReadonlyArray<ProviderModel>,
  ) => ReadonlyArray<ProviderModel>,
  cwd: string,
) => {
  let models: ReadonlyArray<ProviderModel> = spec.fallbackModels;
  let status: ProviderSnapshot["status"] = "ready";
  let message: string | undefined;
  try {
    await rpc.request("initialize", acpInitParams(agentId), 7_000);
    const sessionRes = await rpc
      .request("session/new", { cwd, mcpServers: [] }, 7_000)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (/auth|sign\s*in|login|unauthenticated/i.test(msg)) {
          status = "unauthenticated";
          message = msg;
        }
        return null;
      });
    if (sessionRes !== null) models = extractModels(sessionRes, spec.fallbackModels);
  } catch (err) {
    if (!versionOk) {
      status = "unavailable";
      message = err instanceof Error ? err.message : `Failed to initialize ${spec.name} ACP.`;
    }
  } finally {
    rpc.kill();
  }
  return { models: [...models], status, ...(message ? { message } : {}) };
};
