import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { ServerWebSocket } from "bun";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as ServerConfig from "./config.ts";
import { handleApiRequest } from "./httpRoutes.ts";
import * as Sqlite from "./persistence/Sqlite.ts";
import { handleRpcMessage } from "./rpc.ts";
import * as AgentService from "./services/AgentService.ts";
import * as EventBus from "./services/EventBus.ts";
import * as GitForgeService from "./services/GitForgeService.ts";
import * as GitService from "./services/GitService.ts";
import * as HealthService from "./services/HealthService.ts";
import * as ProjectService from "./services/ProjectService.ts";
import * as ProviderService from "./services/ProviderService.ts";
import * as ThreadService from "./services/ThreadService.ts";

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
) => {
  const configLayer = ServerConfig.layer(overrides);
  const sqliteLayer = Sqlite.layer.pipe(Layer.provide(configLayer));
  const eventBusLayer = EventBus.layer;
  const gitLayer = GitService.layer;
  const healthLayer = HealthService.layer.pipe(
    Layer.provide(sqliteLayer),
    Layer.provide(configLayer),
  );
  const providerLayer = ProviderService.layer.pipe(
    Layer.provide(sqliteLayer),
    Layer.provide(eventBusLayer),
  );
  const projectLayer = ProjectService.layer.pipe(
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
    healthLayer,
    providerLayer,
    projectLayer,
    threadLayer,
    gitForgeLayer,
    agentLayer,
  );
};

const serveStaticFile = (webDistDir: string, pathname: string): Response | null => {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const resolved = NodePath.resolve(webDistDir, `.${safePath}`);
  if (!resolved.startsWith(NodePath.resolve(webDistDir))) {
    return new Response("Forbidden", { status: 403 });
  }
  if (NodeFS.existsSync(resolved) && NodeFS.statSync(resolved).isFile()) {
    return new Response(Bun.file(resolved));
  }
  const indexHtml = NodePath.join(webDistDir, "index.html");
  if (NodeFS.existsSync(indexHtml)) {
    return new Response(Bun.file(indexHtml));
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
  headers.set("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const startScuttleServer = async (
  overrides?: Partial<ServerConfig.ServerConfigValues>,
): Promise<ScuttleServerHandle> => {
  const config = ServerConfig.defaultServerConfig(overrides);
  const runtime = ManagedRuntime.make(makeAppLayer(config));

  const eventBus = await runtime.runPromise(
    Effect.gen(function* () {
      const health = yield* HealthService.HealthService;
      yield* health.check();
      return yield* EventBus.EventBus;
    }),
  );

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

      if (request.method === "OPTIONS" && isAllowedLocalOrigin(origin)) {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
          /^\/api\/agents\/[^/]+\/delegations\/[^/]+\/ask$/.test(url.pathname)
        ) {
          bunServer.timeout(request, 0);
        }
        const apiResponse = await runtime.runPromise(handleApiRequest(request, url));
        if (apiResponse !== null) {
          return withCors(apiResponse, origin);
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
