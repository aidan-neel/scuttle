import { Database } from "bun:sqlite";
import { describe, expect, spyOn, test } from "bun:test";
import type { ProviderConfig, ServerPushEvent, Thread, ThreadTurn } from "@scuttle/contracts";
import { ProjectId, ProviderId, ThreadId, TurnId } from "@scuttle/shared/ids";
import { applyScuttleMigrations } from "../../src/persistence/migrations.ts";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import * as EventBus from "../../src/services/EventBus.ts";
import { readThreadById } from "../../src/services/threadStore.ts";
import { deriveThreadTitle, shouldRefreshThreadTitle } from "../../src/services/threadTitle.ts";
import {
  type ActiveRun,
  launchTurnExecution,
  type PendingApprovalResolver,
} from "../../src/services/turnRunner.ts";

const turn = (userMessage: string, assistantMessage = "") => ({ userMessage, assistantMessage });

describe("shouldRefreshThreadTitle", () => {
  test("refreshes on the first turn and every third turn after", () => {
    const refreshed = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12].filter(shouldRefreshThreadTitle);
    expect(refreshed).toEqual([1, 3, 6, 9, 12]);
  });
});

describe("deriveThreadTitle", () => {
  test("returns an empty string when there are no turns", () => {
    expect(deriveThreadTitle([])).toBe("");
  });

  test("sentence-cases a plain prompt", () => {
    expect(deriveThreadTitle([turn("add retry logic to the sync worker")])).toBe(
      "Add retry logic to the sync worker",
    );
  });

  test("follows a topic pivot using the most recent turns", () => {
    const title = deriveThreadTitle([
      turn("set up sqlite for the server"),
      turn("add a migration for threads"),
      turn("can you fix the reasoning slider alignment please?"),
    ]);
    expect(title).toBe("Fix the reasoning slider alignment");
  });

  test("ignores older turns beyond the latest when the latest has content", () => {
    const title = deriveThreadTitle([
      turn("setup sqlite database"),
      turn("write the tests"),
      turn("update the docs"),
      turn("polish the sidebar animation"),
    ]);
    expect(title).toBe("Polish the sidebar animation");
  });

  test("strips fenced code blocks, inline code syntax, and URLs", () => {
    const prompt = [
      "Refactor the router. See https://example.com/docs/routing for context.",
      "```ts",
      "const router = createRouter({ routes });",
      "```",
    ].join("\n");
    expect(deriveThreadTitle([turn(prompt)])).toBe("Refactor the router");
  });

  test("keeps plain inline code identifiers without backticks", () => {
    expect(deriveThreadTitle([turn("`bun run check` fails on the server package")])).toBe(
      "Bun run check fails on the server package",
    );
  });

  test("strips markdown headers, bullets, and links", () => {
    expect(deriveThreadTitle([turn("## Fix the sidebar flicker on thread switch")])).toBe(
      "Fix the sidebar flicker on thread switch",
    );
    expect(
      deriveThreadTitle([turn("- improve [the onboarding flow](https://example.com) copy")]),
    ).toBe("Improve the onboarding flow copy");
  });

  test("skips a short header and uses the following request", () => {
    expect(
      deriveThreadTitle([
        turn("## Goal\n- improve [the onboarding flow](https://example.com) copy"),
      ]),
    ).toBe("Improve the onboarding flow copy");
  });

  test("does not glue a short opener onto the real question", () => {
    expect(deriveThreadTitle([turn("Quick question. How does the router work?")])).toBe(
      "How does the router work",
    );
  });

  test("keeps the whole sentence when a comma follows a subordinate clause", () => {
    expect(deriveThreadTitle([turn("When I click save, the app crashes")])).toBe(
      "When I click save the app crashes",
    );
  });

  test("strips slash command prefixes", () => {
    expect(deriveThreadTitle([turn("$go migrate the settings store to effect")])).toBe(
      "Migrate the settings store to effect",
    );
    expect(deriveThreadTitle([turn("/plan redesign the add project dialog")])).toBe(
      "Redesign the add project dialog",
    );
  });

  test("strips conversational filler", () => {
    expect(
      deriveThreadTitle([
        turn("hey, can you also make sure to wire up the websocket reconnect please"),
      ]),
    ).toBe("Wire up the websocket reconnect");
    expect(deriveThreadTitle([turn("i want to rename the provider settings panel")])).toBe(
      "Rename the provider settings panel",
    );
  });

  test("limits titles to eight words", () => {
    const title = deriveThreadTitle([
      turn("investigate why the desktop shell keeps dropping the websocket connection after sleep"),
    ]);
    expect(title.split(" ").length).toBeLessThanOrEqual(8);
    expect(title.startsWith("Investigate why the desktop shell")).toBe(true);
  });

  test("limits titles to 56 characters at a word boundary", () => {
    const title = deriveThreadTitle([
      turn("reconfigure internationalization infrastructure documentation generators thoroughly"),
    ]);
    expect(title.length).toBeLessThanOrEqual(56);
    expect(title).toBe("Reconfigure internationalization infrastructure");
  });

  test("drops dangling trailing prepositions after truncation", () => {
    const title = deriveThreadTitle([turn("refactor the thread store into smaller modules for")]);
    expect(title).toBe("Refactor the thread store into smaller modules");
  });

  test("cuts at a comma once there are enough words", () => {
    expect(deriveThreadTitle([turn("fix the slider, and also update the docs")])).toBe(
      "Fix the slider",
    );
  });

  test.each(["try again", "that didn't work", "looks good, ship it", "thanks!", "ok continue"])(
    "keeps the earlier topic when the latest prompt is a low-content follow-up: %s",
    (followUp) => {
      const title = deriveThreadTitle([
        turn("set up sqlite for the server"),
        turn("add a migration for threads"),
        turn(followUp),
      ]);
      expect(title).toBe("Add a migration for threads");
    },
  );

  test("prefers the assistant summary over older prompts after a low-content follow-up", () => {
    const title = deriveThreadTitle([
      turn("set up sqlite for the server"),
      turn("try again", "Retried the websocket reconnect and it now succeeds."),
    ]);
    expect(title).toBe("Retried the websocket reconnect and it now succeeds");
  });

  test("falls back to the assistant summary when the prompt has no meaningful words", () => {
    const title = deriveThreadTitle([
      turn("yes please continue", "Done. I've updated the model picker to group by provider."),
    ]);
    expect(title).toBe("Updated the model picker to group by provider");
  });

  test("falls back to the assistant summary for code-only prompts", () => {
    const title = deriveThreadTitle([
      turn("```ts\nexport const x = 1;\n```", "Added the constant export to the shared package."),
    ]);
    expect(title).toBe("Added the constant export to the shared package");
  });

  test("falls back to an earlier prompt when the latest turn has no usable text", () => {
    const title = deriveThreadTitle([turn("tighten the context menu spacing"), turn("ok", "")]);
    expect(title).toBe("Tighten the context menu spacing");
  });

  test("returns an empty string when nothing meaningful remains", () => {
    expect(deriveThreadTitle([turn("```\ncode only\n```", "")])).toBe("");
    expect(deriveThreadTitle([turn("https://example.com/only-a-link", "")])).toBe("");
  });

  test("uses a single meaningful word when nothing better exists", () => {
    expect(deriveThreadTitle([turn("refactor", "")])).toBe("Refactor");
  });
});

const providerConfig: ProviderConfig = {
  id: ProviderId.make("claude-default"),
  kind: "claude",
  name: "Claude",
  enabled: true,
  binaryPath: "",
  launchArgs: "",
};

const makeRunnerHarness = () => {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON;");
  applyScuttleMigrations(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run("project-1", "Demo", "/tmp/demo", now, now);
  db.prepare(
    `INSERT INTO threads
       (id, project_id, project_name, title, runtime, branch, cwd, provider_id, provider_kind, model, status_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'local', 'main', '/tmp/demo', 'claude-default', 'claude', 'sonnet', ?, ?, ?)`,
  ).run(
    "thread-1",
    "project-1",
    "Demo",
    "Original title",
    JSON.stringify({ kind: "idle" }),
    now,
    now,
  );

  const events: ServerPushEvent[] = [];
  const subscribers = new Set<(event: ServerPushEvent) => void>();
  subscribers.add((event) => events.push(event));
  const eventBus: EventBus.EventBus["Service"] = {
    publish: () => {
      throw new Error("publish is not used by the turn runner");
    },
    publishSync: (event) => {
      for (const subscriber of subscribers) subscriber(event);
    },
    subscribe: (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };
  const activeRuns = new Map<string, ActiveRun>();
  const pendingApprovals = new Map<string, PendingApprovalResolver>();
  const deps = {
    db,
    eventBus,
    activeRuns,
    pendingApprovals,
    updateThreadStatus: (): Thread | null => null,
    onProjectActivity: () => {},
  };

  const runTurn = async (seq: number, prompt: string): Promise<void> => {
    const thread = readThreadById(db, "thread-1");
    if (!thread) throw new Error("thread missing");
    const startedAt = new Date().toISOString();
    const turn: ThreadTurn = {
      id: TurnId.make(`turn-${seq}`),
      threadId: ThreadId.make("thread-1"),
      userMessage: prompt,
      assistantMessage: "",
      thinkingText: "",
      status: "running",
      startedAt,
      modelSelection: thread.modelSelection,
      activities: [],
      approvals: [],
    };
    db.prepare(
      `INSERT INTO turns (id, thread_id, seq, user_message, status, started_at, model_selection_json)
       VALUES (?, ?, ?, ?, 'running', ?, ?)`,
    ).run(turn.id, "thread-1", seq, prompt, startedAt, JSON.stringify(thread.modelSelection));
    launchTurnExecution(deps, thread, turn, prompt, providerConfig);
    while (activeRuns.size > 0) await Bun.sleep(1);
  };

  const titleEvents = () =>
    events.flatMap((event) => (event.kind === "thread.upserted" ? [event.thread.title] : []));

  return { db, runTurn, titleEvents, projectId: ProjectId.make("project-1") };
};

describe("turn runner title refresh", () => {
  test("refreshes the title on turns 1 and 3 and publishes thread.upserted", async () => {
    const spy = spyOn(claudeAdapter, "runTurn").mockResolvedValue({ finalText: "Done." });
    try {
      const { db, runTurn, titleEvents } = makeRunnerHarness();

      await runTurn(1, "please set up sqlite for the server");
      expect(readThreadById(db, "thread-1")?.title).toBe("Set up sqlite for the server");
      expect(titleEvents()).toEqual(["Set up sqlite for the server"]);

      await runTurn(2, "fix the reasoning slider alignment");
      expect(readThreadById(db, "thread-1")?.title).toBe("Set up sqlite for the server");

      await runTurn(3, "polish the sidebar animation");
      expect(readThreadById(db, "thread-1")?.title).toBe("Polish the sidebar animation");
      expect(titleEvents()).toEqual([
        "Set up sqlite for the server",
        "Polish the sidebar animation",
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  test("leaves the title alone and completes the turn when the turn is interrupted", async () => {
    const spy = spyOn(claudeAdapter, "runTurn").mockResolvedValue({ interrupted: true });
    try {
      const { db, runTurn } = makeRunnerHarness();
      await runTurn(1, "set up sqlite for the server");
      expect(readThreadById(db, "thread-1")?.title).toBe("Original title");
    } finally {
      spy.mockRestore();
    }
  });
});
