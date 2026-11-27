import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ProviderConfig } from "@scuttle/contracts";
import { ProviderId, ThreadId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as ServerConfig from "../../src/config.ts";
import * as Sqlite from "../../src/persistence/Sqlite.ts";
import { makeAppLayer, startScuttleServer } from "../../src/server.ts";
import * as AttachmentService from "../../src/services/AttachmentService.ts";
import * as EventBus from "../../src/services/EventBus.ts";
import {
  readThreadById,
  readTurnById,
  readTurnsForThread,
} from "../../src/services/threadStore.ts";
import { dispatchThreadTurn } from "../../src/services/threadTurnDispatch.ts";
import type { TurnRunnerDeps } from "../../src/services/turnRunner.ts";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import type { HarnessTurnInput } from "../../src/providers/types.ts";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe("AttachmentService and HTTP routes", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      NodeFS.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  const makeTempDir = (prefix: string) => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  };

  it("saves validated images under <dataDir>/attachments/<uuid>.<ext> and rejects traversal", async () => {
    const root = makeTempDir("scuttle-att-svc-");
    const dbPath = NodePath.join(root, "state.sqlite");
    const configLayer = ServerConfig.layer({ dbPath, dataDir: root });
    const sqliteLayer = Sqlite.layer.pipe(Layer.provide(configLayer));
    const attachmentLayer = AttachmentService.layer.pipe(
      Layer.provide(configLayer),
      Layer.provide(sqliteLayer),
    );
    const runtime = ManagedRuntime.make(Layer.mergeAll(configLayer, sqliteLayer, attachmentLayer));

    try {
      const uploaded = await runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* AttachmentService.AttachmentService;
          return yield* svc.saveUpload({
            name: "../../evil/shot.png",
            mimeType: "image/png",
            bytes: PNG_BYTES,
          });
        }),
      );

      expect(uploaded.kind).toBe("image");
      expect(uploaded.name).toBe("shot.png");
      expect(uploaded.mimeType).toBe("image/png");
      expect(uploaded.sizeBytes).toBe(PNG_BYTES.byteLength);
      expect(uploaded.url).toBe(`/api/attachments/${uploaded.id}`);

      const storedPath = await runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* AttachmentService.AttachmentService;
          return yield* svc.resolveStoredPath(uploaded.id);
        }),
      );
      expect(storedPath).toBe(NodePath.join(root, "attachments", `${uploaded.id}.png`));
      expect(NodeFS.existsSync(storedPath)).toBe(true);

      const loaded = await runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* AttachmentService.AttachmentService;
          return yield* svc.readAttachment(uploaded.id);
        }),
      );
      expect(loaded.bytes).toEqual(PNG_BYTES);
      expect(loaded.mimeType).toBe("image/png");
      expect(loaded.name).toBe("shot.png");

      for (const badId of ["../etc/passwd", "..\\state.sqlite", "not-a-uuid", `${uploaded.id}/x`]) {
        const exit = await runtime.runPromiseExit(
          Effect.gen(function* () {
            const svc = yield* AttachmentService.AttachmentService;
            return yield* svc.resolveStoredPath(badId);
          }),
        );
        expect(exit._tag).toBe("Failure");
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("validates MIME types, magic bytes, empty payloads, and 20 MB cap", async () => {
    const root = makeTempDir("scuttle-att-val-");
    const dbPath = NodePath.join(root, "state.sqlite");
    const configLayer = ServerConfig.layer({ dbPath, dataDir: root });
    const sqliteLayer = Sqlite.layer.pipe(Layer.provide(configLayer));
    const attachmentLayer = AttachmentService.layer.pipe(
      Layer.provide(configLayer),
      Layer.provide(sqliteLayer),
    );
    const runtime = ManagedRuntime.make(Layer.mergeAll(configLayer, sqliteLayer, attachmentLayer));

    try {
      const save = (name: string, mimeType: string, bytes: Uint8Array) =>
        runtime.runPromiseExit(
          Effect.gen(function* () {
            const svc = yield* AttachmentService.AttachmentService;
            return yield* svc.saveUpload({ name, mimeType, bytes });
          }),
        );

      expect((await save("a.jpg", "image/jpeg", JPEG_BYTES))._tag).toBe("Success");
      expect((await save("a.gif", "image/gif", GIF_BYTES))._tag).toBe("Success");
      expect((await save("a.webp", "image/webp", WEBP_BYTES))._tag).toBe("Success");

      expect((await save("a.svg", "image/svg+xml", new Uint8Array([60, 115])))._tag).toBe(
        "Failure",
      );
      expect((await save("empty.png", "image/png", new Uint8Array()))._tag).toBe("Failure");
      expect(
        (await save("spoof.png", "image/png", new TextEncoder().encode("not a png image")))._tag,
      ).toBe("Failure");

      const tooBig = new Uint8Array(20 * 1024 * 1024 + 1);
      tooBig.set(PNG_BYTES, 0);
      expect((await save("huge.png", "image/png", tooBig))._tag).toBe("Failure");
    } finally {
      await runtime.dispose();
    }
  });

  it("serves POST /api/attachments (multipart and raw) and GET /api/attachments/:id", async () => {
    const root = makeTempDir("scuttle-att-http-");
    const server = await startScuttleServer({
      port: 0,
      dbPath: NodePath.join(root, "state.sqlite"),
      dataDir: root,
    });

    try {
      const form = new FormData();
      form.append("file", new File([PNG_BYTES], "screen.png", { type: "image/png" }));
      const multiRes = await fetch(`${server.url}/api/attachments`, {
        method: "POST",
        body: form,
      });
      expect(multiRes.status).toBe(201);
      const multiBody = (await multiRes.json()) as {
        id: string;
        kind: string;
        name: string;
        mimeType: string;
        sizeBytes: number;
        url: string;
      };
      expect(multiBody.kind).toBe("image");
      expect(multiBody.name).toBe("screen.png");
      expect(multiBody.mimeType).toBe("image/png");
      expect(multiBody.sizeBytes).toBe(PNG_BYTES.byteLength);
      expect(multiBody.url).toBe(`/api/attachments/${multiBody.id}`);

      const rawRes = await fetch(`${server.url}/api/attachments`, {
        method: "POST",
        headers: {
          "Content-Type": "image/webp",
          "X-Attachment-Name": "clip.webp",
        },
        body: WEBP_BYTES,
      });
      expect(rawRes.status).toBe(201);
      const rawBody = (await rawRes.json()) as { id: string; mimeType: string; name: string };
      expect(rawBody.mimeType).toBe("image/webp");
      expect(rawBody.name).toBe("clip.webp");

      const getRes = await fetch(`${server.url}${multiBody.url}`);
      expect(getRes.status).toBe(200);
      expect(getRes.headers.get("content-type")).toBe("image/png");
      expect(getRes.headers.get("cache-control")).toContain("immutable");
      expect(getRes.headers.get("content-disposition")).toContain("inline");
      expect(new Uint8Array(await getRes.arrayBuffer())).toEqual(PNG_BYTES);

      const travRes = await fetch(`${server.url}/api/attachments/..%2F..%2Fetc%2Fpasswd`);
      expect(travRes.status).toBe(400);

      const missingRes = await fetch(
        `${server.url}/api/attachments/00000000-0000-4000-8000-000000000000`,
      );
      expect(missingRes.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it("persists turn attachments in SQLite and forwards resolved image bytes without degrading prompt", async () => {
    const root = makeTempDir("scuttle-att-turn-");
    const dbPath = NodePath.join(root, "state.sqlite");
    const runtime = ManagedRuntime.make(makeAppLayer({ dbPath, dataDir: root }));

    let capturedInput: HarnessTurnInput | undefined;
    const runTurnSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(async (input) => {
      capturedInput = input;
      return { finalText: "Looked at image." };
    });

    try {
      const uploaded = await runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* AttachmentService.AttachmentService;
          return yield* svc.saveUpload({
            name: "bug.png",
            mimeType: "image/png",
            bytes: PNG_BYTES,
          });
        }),
      );

      const { turn, thread } = await runtime.runPromise(
        Effect.gen(function* () {
          const { db } = yield* Sqlite.SqliteDatabase;
          const eventBus = yield* EventBus.EventBus;
          const now = "2026-11-27T00:00:00.000Z";
          db.query(
            "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          ).run("proj-att", "Scuttle", root, now, now);
          db.query(
            `INSERT INTO threads
               (id, project_id, project_name, title, runtime, branch, cwd, provider_id, provider_kind, model, status_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'local', 'main', ?, 'claude', 'claude', 'claude-sonnet-4-6', ?, ?, ?)`,
          ).run(
            "thread-att",
            "proj-att",
            "Scuttle",
            "Image turn",
            root,
            JSON.stringify({ kind: "idle" }),
            now,
            now,
          );

          const threadRow = readThreadById(db, ThreadId.make("thread-att"))!;
          const runnerDeps: TurnRunnerDeps = {
            db,
            eventBus,
            activeRuns: new Map(),
            pendingApprovals: new Map(),
            updateThreadStatus: () => threadRow,
            onProjectActivity: () => {},
          };
          const providerConfig: ProviderConfig = {
            id: ProviderId.make("claude"),
            kind: "claude",
            name: "Claude Code",
            enabled: true,
            binaryPath: "",
            launchArgs: "",
          };
          const dispatched = dispatchThreadTurn({
            db,
            eventBus,
            runnerDeps,
            updateThreadStatus: () => threadRow,
            thread: threadRow,
            prompt: "Inspect [Image: bug.png]",
            attachments: [
              {
                id: uploaded.id,
                kind: "image",
                name: uploaded.name,
                mimeType: uploaded.mimeType,
                sizeBytes: uploaded.sizeBytes,
                path: "/etc/passwd",
              },
              {
                name: "notes.txt",
                content: "stack trace line 1",
                mimeType: "text/plain",
              },
            ],
            origin: "user",
            providerConfig,
            apiBaseUrl: "http://127.0.0.1:4310",
          });
          return { turn: dispatched, thread: threadRow };
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(capturedInput).toBeDefined();
      expect(capturedInput!.prompt).not.toContain("Attached file: bug.png");
      expect(capturedInput!.prompt).toContain('<attached_file name="notes.txt">');
      expect(capturedInput!.resolvedAttachments).toHaveLength(1);
      expect(capturedInput!.resolvedAttachments![0]!.id).toBe(uploaded.id);
      expect(capturedInput!.resolvedAttachments![0]!.path).toBe(
        NodePath.join(root, "attachments", `${uploaded.id}.png`),
      );
      expect(capturedInput!.resolvedAttachments![0]!.bytes).toEqual(PNG_BYTES);

      const persistedTurns = await runtime.runPromise(
        Effect.gen(function* () {
          const { db } = yield* Sqlite.SqliteDatabase;
          return {
            list: readTurnsForThread(db, thread),
            single: readTurnById(db, turn.id, thread.modelSelection),
          };
        }),
      );
      expect(persistedTurns.list).toHaveLength(1);
      expect(persistedTurns.list[0]!.attachments).toHaveLength(2);
      expect(persistedTurns.list[0]!.attachments![0]).toEqual({
        id: uploaded.id,
        kind: "image",
        name: "bug.png",
        mimeType: "image/png",
        sizeBytes: PNG_BYTES.byteLength,
      });
      expect(persistedTurns.single?.attachments).toEqual(persistedTurns.list[0]!.attachments);
    } finally {
      runTurnSpy.mockRestore();
      await runtime.dispose();
    }
  });
});
