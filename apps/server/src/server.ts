import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { ServerWebSocket } from "bun";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as ServerConfig from "./config.ts";
import { handleApiRequest } from "./httpRoutes.ts";
import { type McpSessionRegistry, makeMcpSessionRegistry } from "./mcp/McpSessionRegistry.ts";
import { createScuttleMcpHandler } from "./mcp/ScuttleMcpServer.ts";
import { buildScuttleMcpDeps } from "./mcp/wireMcpDeps.ts";
import * as Sqlite from "./persistence/Sqlite.ts";
import { handleRpcMessage } from "./rpc.ts";
import * as AgentService from "./services/AgentService.ts";
import * as AttachmentService from "./services/AttachmentService.ts";
import * as CheckpointService from "./services/CheckpointService.ts";
import * as EventBus from "./services/EventBus.ts";
import * as GitForgeService from "./services/GitForgeService.ts";
import * as GitService from "./services/GitService.ts";
import * as HealthService from "./services/HealthService.ts";
import * as ModelPerformanceService from "./services/ModelPerformanceService.ts";
import * as ModelTierService from "./services/ModelTierService.ts";
import * as ProjectService from "./services/ProjectService.ts";
import * as ProviderService from "./services/ProviderService.ts";
import * as SkillService from "./services/SkillService.ts";
import * as ThreadService from "./services/ThreadService.ts";
import { registerMcpSessionRegistry } from "./services/threadTurnDispatch.ts";
import * as UsageService from "./services/UsageService.ts";

export interface ScuttleServerHandle {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly stop: () => Promise<void>;
}

export const makeAppLayer = (
  overrides?: Partial<ServerConfig.ServerConfigValues>,
  forgeOptions: GitForgeService.GitForgeOptions = GitForgeService.readGitForgeOptions(process.env),
  agentOptions?: Pick<
    AgentService.AgentServiceOptions,
    "askParentTimeoutMs" | "enableCheckInScheduler"
  >,
  mcpRegistry?: McpSessionRegistry,
) => {
  const resolvedConfig = ServerConfig.defaultServerConfig(overrides);
  if (mcpRegistry) {
    registerMcpSessionRegistry(resolvedConfig.apiBaseUrlRef, mcpRegistry);
  }
  const configLayer = ServerConfig.layer(resolvedConfig);
  const sqliteLayer = Sqlite.layer.pipe(Layer.provide(configLayer));
  const eventBusLayer = EventBus.layer;
  const gitLayer = GitService.layer;
  const checkpointLayer = CheckpointService.layer;
  const modelPerformanceLayer = ModelPerformanceService.layer().pipe(Layer.provide(sqliteLayer));
  const healthLayer = HealthService.layer.pipe(
    Layer.provide(sqliteLayer),
    Layer.provide(configLayer),
  );
  const attachmentLayer = AttachmentService.layer.pipe(
    Layer.provide(configLayer),
    Layer.provide(sqliteLayer),
  );
  const skillLayer = SkillService.layer.pipe(Layer.provide(configLayer));
  const usageLayer = UsageService.layer().pipe(Layer.provide(sqliteLayer));
  const modelTierLayer = ModelTierService.layer.pipe(
    Layer.provide(sqliteLayer),
    Layer.provide(eventBusLayer),
  );
  const providerLayer = ProviderService.layer.pipe(
    Layer.provide(configLayer),
    Layer.provide(sqliteLayer),
    Layer.provide(eventBusLayer),
  );
  const projectLayer = ProjectService.layer.pipe(
    Layer.provide(configLayer),
    Layer.provide(sqliteLayer),
    Layer.provide(gitLayer),
    Layer.provide(eventBusLayer),
  );
  const threadLayer = ThreadService.layer.pipe(
    Layer.provide(configLayer),
    Layer.provide(sqliteLayer),
    Layer.provide(eventBusLayer),
    Layer.provide(gitLayer),
    Layer.provide(projectLayer),
    Layer.provide(providerLayer),
    Layer.provide(checkpointLayer),
    Layer.provide(modelPerformanceLayer),
  );
  const gitForgeLayer = GitForgeService.layer(forgeOptions).pipe(
    Layer.provide(sqliteLayer),
    Layer.provide(gitLayer),
    Layer.provide(projectLayer),
    Layer.provide(threadLayer),
  );
  const agentLayer = AgentService.layer({
    runner: forgeOptions.runner,
    fetch: forgeOptions.fetch,
    ...agentOptions,
  }).pipe(
    Layer.provide(configLayer),
    Layer.provide(sqliteLayer),
    Layer.provide(eventBusLayer),
    Layer.provide(projectLayer),
    Layer.provide(providerLayer),
    Layer.provide(threadLayer),
    Layer.provide(gitLayer),
    Layer.provide(gitForgeLayer),
  );

  return Layer.mergeAll(
    configLayer,
    sqliteLayer,
    eventBusLayer,
    gitLayer,
    checkpointLayer,
    modelPerformanceLayer,
    healthLayer,
    attachmentLayer,
    skillLayer,
    usageLayer,
    modelTierLayer,
    providerLayer,
    projectLayer,
    threadLayer,
    gitForgeLayer,
    agentLayer,
  );
};

const GZIP_THRESHOLD_BYTES = 4096;

const appendVaryHeader = (headers: Headers, token: string): void => {
  const existing = headers.get("Vary");
  if (!existing) {
    headers.set("Vary", token);
    return;
  }
  const needle = token.toLowerCase();
  if (!existing.split(",").some((part) => part.trim().toLowerCase() === needle)) {
    headers.set("Vary", `${existing}, ${token}`);
  }
};

const serveStaticFile = (webDistDir: string, pathname: string): Response | null => {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const resolved = NodePath.resolve(webDistDir, `.${safePath}`);
  if (!resolved.startsWith(NodePath.resolve(webDistDir))) {
    return new Response("Forbidden", { status: 403 });
  }
  if (NodeFS.existsSync(resolved) && NodeFS.statSync(resolved).isFile()) {
    if (safePath.startsWith("/assets/")) {
      return new Response(Bun.file(resolved), {
        headers: { "Cache-Control": "public, max-age=31536000, immutable" },
      });
    }
    if (safePath === "/index.html") {
      return new Response(Bun.file(resolved), {
        headers: { "Cache-Control": "no-cache" },
      });
    }
    return new Response(Bun.file(resolved));
  }
  const indexHtml = NodePath.join(webDistDir, "index.html");
  if (NodeFS.existsSync(indexHtml)) {
    return new Response(Bun.file(indexHtml), {
      headers: { "Cache-Control": "no-cache" },
    });
  }
  return null;
};

const isAllowedLocalOrigin = (origin: string | null): origin is string => {
  if (origin === null) return false;
  return (
    origin.startsWith("views://") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("http://localhost:")
  );
};

const withCors = (response: Response, origin: string | null): Response => {
  if (!isAllowedLocalOrigin(origin)) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  appendVaryHeader(headers, "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const isLoopbackHost = (hostname: string): boolean =>
  hostname === "127.0.0.1" ||
  hostname === "localhost" ||
  hostname === "::1" ||
  hostname === "[::1]";

const acceptsGzip = (header: string | null): boolean => {
  if (!header) return false;
  for (const rawPart of header.split(",")) {
    const [encodingPart, ...params] = rawPart.trim().toLowerCase().split(";");
    if (encodingPart?.trim() !== "gzip") continue;
    for (const param of params) {
      const match = /^q\s*=\s*(.+)$/.exec(param.trim());
      if (match !== null) {
        const q = Number(match[1]);
        return Number.isFinite(q) && q > 0;
      }
    }
    return true;
  }
  return false;
};

const maybeCompressJsonResponse = async (
  request: Request,
  url: URL,
  response: Response,
): Promise<Response> => {
  if (
    isLoopbackHost(url.hostname) ||
    response.status !== 200 ||
    response.headers.has("Content-Encoding")
  ) {
    return response;
  }
  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.toLowerCase().includes("application/json")) {
    return response;
  }
  if (!acceptsGzip(request.headers.get("accept-encoding"))) {
    return response;
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.byteLength <= GZIP_THRESHOLD_BYTES) {
    return new Response(raw, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  const compressed = Bun.gzipSync(raw, { level: 1 });
  const headers = new Headers(response.headers);
  headers.set("Content-Encoding", "gzip");
  headers.delete("Content-Length");
  appendVaryHeader(headers, "Accept-Encoding");
  return new Response(compressed, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const startScuttleServer = async (
  overrides?: Partial<ServerConfig.ServerConfigValues>,
): Promise<ScuttleServerHandle> => {
  const config = ServerConfig.defaultServerConfig(overrides);
  const mcpRegistry = makeMcpSessionRegistry();
  const runtime = ManagedRuntime.make(makeAppLayer(config, undefined, undefined, mcpRegistry));

  const { eventBus, mcpDeps } = await runtime.runPromise(
    Effect.gen(function* () {
      const health = yield* HealthService.HealthService;
      yield* health.check();
      const eventBus = yield* EventBus.EventBus;
      const mcpDeps = yield* buildScuttleMcpDeps;
      return { eventBus, mcpDeps };
    }),
  );
  const mcpHandler = createScuttleMcpHandler({ registry: mcpRegistry, deps: mcpDeps });

  const clients = new Set<ServerWebSocket<unknown>>();
  const unsubscribeBus = eventBus.subscribe((event) => {
    if (clients.size === 0) return;
    const encoded = JSON.stringify(event);
    for (const client of clients) {
      try {
        client.send(encoded);
      } catch {
        clients.delete(client);
      }
    }
  });

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    async fetch(request, bunServer) {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");

      if (url.pathname === "/mcp") {
        if (request.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: {
              ...(isAllowedLocalOrigin(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
              "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
              "Access-Control-Allow-Headers":
                "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
              "Access-Control-Expose-Headers": "Mcp-Session-Id",
              Vary: "Origin",
            },
          });
        }
        if (request.method.toUpperCase() === "POST") {
          bunServer.timeout(request, 0);
        }
        return mcpHandler(request);
      }

      if (request.method === "OPTIONS" && isAllowedLocalOrigin(origin)) {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Attachment-Name",
            Vary: "Origin",
          },
        });
      }

      if (url.pathname === "/ws") {
        const upgraded = bunServer.upgrade(request);
        return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
      }

      if (url.pathname.startsWith("/api/")) {
        if (
          request.method.toUpperCase() === "POST" &&
          /^\/api\/(?:agents\/[^/]+\/)?delegations\/[^/]+\/ask$/.test(url.pathname)
        ) {
          bunServer.timeout(request, 0);
        }
        const apiResponse = await runtime.runPromise(handleApiRequest(request, url));
        if (apiResponse !== null) {
          const compressed = await maybeCompressJsonResponse(request, url, apiResponse);
          return withCors(compressed, origin);
        }
        return withCors(Response.json({ error: "Not found" }, { status: 404 }), origin);
      }

      if (config.webDistDir !== undefined) {
        const staticResponse = serveStaticFile(config.webDistDir, url.pathname);
        if (staticResponse !== null) {
          return staticResponse;
        }
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
    websocket: {
      open(ws) {
        clients.add(ws);
      },
      close(ws) {
        clients.delete(ws);
      },
      async message(ws, raw) {
        const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
        const reply = await runtime.runPromise(handleRpcMessage(text));
        ws.send(JSON.stringify(reply));
      },
    },
  });

  const boundPort = server.port ?? config.port;
  const boundUrl = `http://${config.host}:${boundPort}`;
  config.apiBaseUrlRef.url = boundUrl;

  return {
    host: config.host,
    port: boundPort,
    url: boundUrl,
    stop: async () => {
      unsubscribeBus();
      clients.clear();
      await server.stop(true);
      await runtime.dispose();
    },
  };
};
