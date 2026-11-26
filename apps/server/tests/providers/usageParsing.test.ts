import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ServerPushEvent } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import type { HarnessTurnInput, HarnessTurnResult } from "../../src/providers/types.ts";
import {
  parseAcpUsage,
  parseClaudeUsage,
  parseCodexTokenUsage,
} from "../../src/providers/usageParsing.ts";
import { makeAppLayer } from "../../src/server.ts";
import * as EventBus from "../../src/services/EventBus.ts";
import * as ProjectService from "../../src/services/ProjectService.ts";
import * as ThreadService from "../../src/services/ThreadService.ts";

const waitUntil = async (fn: () => boolean, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for condition.");
};

describe("provider usage parsing and turnRunner persistence", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop()!;
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses Claude result usage preferring usage.iterations[], falling back to top-level iterations[] and aggregate usage", () => {
    const nestedIterations = parseClaudeUsage(
      {
        type: "result",
        usage: {
          input_tokens: 9000,
          output_tokens: 900,
          cache_read_input_tokens: 4000,
          cache_creation_input_tokens: 1000,
          iterations: [
            {
              type: "message",
              input_tokens: 1000,
              output_tokens: 200,
              cache_read_input_tokens: 500,
            },
            {
              type: "message",
              input_tokens: 450,
              output_tokens: 180,
              cache_read_input_tokens: 3400,
              cache_creation_input_tokens: 700,
            },
          ],
        },
        modelUsage: {
          "claude-opus-4-5[1m]": { contextWindow: 1_000_000 },
        },
      },
      "claude-opus-4-5[1m]",
    );
    expect(nestedIterations).toEqual({
      inputTokens: 450,
      outputTokens: 180,
      cacheReadTokens: 3400,
      cacheCreationTokens: 700,
      contextWindowTokens: 1_000_000,
    });

    const withIterations = parseClaudeUsage(
      {
        type: "result",
        usage: {
          input_tokens: 9000,
          output_tokens: 900,
          cache_read_input_tokens: 4000,
          cache_creation_input_tokens: 1000,
        },
        iterations: [
          {
            usage: {
              input_tokens: 1000,
              output_tokens: 200,
              cache_read_input_tokens: 500,
            },
          },
          {
            usage: {
              input_tokens: 400,
              output_tokens: 150,
              cache_read_input_tokens: 3200,
              cache_creation_input_tokens: 600,
            },
          },
        ],
        modelUsage: {
          "claude-sonnet-4-5": { contextWindow: 200_000 },
          "claude-opus-4-5[1m]": { contextWindow: 1_000_000 },
        },
      },
      "claude-opus-4-5[1m]",
    );
    expect(withIterations).toEqual({
      inputTokens: 400,
      outputTokens: 150,
      cacheReadTokens: 3200,
      cacheCreationTokens: 600,
      contextWindowTokens: 1_000_000,
    });

    const topLevelOnly = parseClaudeUsage(
      {
        usage: {
          input_tokens: 500,
          output_tokens: 120,
          cache_read_input_tokens: 2000,
        },
        modelUsage: {
          "claude-sonnet-4-5": { contextWindow: 200_000 },
        },
      },
      "claude-sonnet-4-5",
    );
    expect(topLevelOnly).toEqual({
      inputTokens: 500,
      outputTokens: 120,
      cacheReadTokens: 2000,
      contextWindowTokens: 200_000,
    });
  });

  it("parses Codex thread/tokenUsage/updated without double-counting cachedInputTokens", () => {
    const openAiStyle = parseCodexTokenUsage({
      threadId: "t1",
      turnId: "turn1",
      tokenUsage: {
        last: {
          inputTokens: 10_000,
          cachedInputTokens: 7_500,
          outputTokens: 400,
          reasoningOutputTokens: 100,
          totalTokens: 10_400,
        },
        modelContextWindow: 400_000,
      },
    });
    expect(openAiStyle).toEqual({
      inputTokens: 2_500,
      outputTokens: 400,
      cacheReadTokens: 7_500,
      contextWindowTokens: 400_000,
    });
  });

  it("parses ACP session/prompt and usage_update without double-counting cached reads", () => {
    const usage = parseAcpUsage({
      usage: {
        inputTokens: 1800,
        outputTokens: 350,
        cachedReadTokens: 900,
        cachedWriteTokens: 250,
        contextWindowTokens: 1_000_000,
      },
    });
    expect(usage).toEqual({
      inputTokens: 900,
      outputTokens: 350,
      cacheReadTokens: 900,
      cacheCreationTokens: 250,
      contextWindowTokens: 1_000_000,
    });

    const disjoint = parseAcpUsage({
      usage: {
        inputTokens: 300,
        outputTokens: 120,
        cachedReadTokens: 900,
      },
    });
    expect(disjoint).toEqual({
      inputTokens: 300,
      outputTokens: 120,
      cacheReadTokens: 900,
    });

    const liveOccupancy = parseAcpUsage({
      sessionUpdate: "usage_update",
      used: 42_000,
      size: 1_048_576,
    });
    expect(liveOccupancy).toEqual({
      inputTokens: 42_000,
      outputTokens: 0,
      contextWindowTokens: 1_048_576,
    });
  });

  it("persists turns.usage_json and threads.last_usage_json in turnRunner and publishes updates", async () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-usage-test-"));
    tempRoots.push(root);
    const repo = NodePath.join(root, "repo");
    NodeFS.mkdirSync(repo, { recursive: true });

    const expectedUsage = {
      inputTokens: 1500,
      outputTokens: 250,
      cacheReadTokens: 8000,
      cacheCreationTokens: 400,
      contextWindowTokens: 200_000,
    };
    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        input.emit({ kind: "usage", usage: expectedUsage });
        return { finalText: "Done", usage: expectedUsage };
      },
    );

    const runtime = ManagedRuntime.make(makeAppLayer({ dbPath: ":memory:" }));
    const events: ServerPushEvent[] = [];

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const eventBus = yield* EventBus.EventBus;
          const unsub = eventBus.subscribe((e) => events.push(e));
          const projects = yield* ProjectService.ProjectService;
          const threads = yield* ThreadService.ThreadService;

          const proj = yield* projects.create({ path: repo, name: "repo" });
          const created = yield* threads.create({
            projectId: proj.id,
            prompt: "Measure usage",
            runtime: "local",
            branch: "main",
            modelSelection: {
              providerId: ProviderId.make("claude"),
              providerKind: "claude",
              model: "claude-sonnet-4-5",
            },
          });

          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.threadId === created.thread.id &&
                  e.turn.status === "completed",
              ),
            ),
          );

          const detail = yield* threads.getDetail(created.thread.id);
          expect(detail.thread.lastUsage).toEqual(expectedUsage);
          expect(detail.turns[0]?.usage).toEqual(expectedUsage);
          unsub();
        }),
      );
    } finally {
      runSpy.mockRestore();
      await runtime.dispose();
    }
  });
});
