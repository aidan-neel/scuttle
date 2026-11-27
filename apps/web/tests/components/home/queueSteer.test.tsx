import { describe, expect, test } from "bun:test";
import type { ModelSelection, QueuedTurn, SendTurnResult } from "@scuttle/contracts";
import { ProviderId, ThreadId, TurnId } from "@scuttle/shared/ids";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ComposerActionRow,
  flipDispatchMode,
  isQueueShortcut,
  resolveSendMode,
  toSubmitOutcome,
} from "../../../src/components/home/ComposerBottomBar.tsx";
import {
  QueuedTurnsTray,
  queuedSnippet,
  queuedTrayHeading,
} from "../../../src/components/home/QueuedTurnsTray.tsx";
import { readPreferences } from "../../../src/components/settings/preferences.ts";

const THREAD_ID = ThreadId.make("thread-1");
const AT = "2026-11-26T00:00:00.000Z";
const SELECTION: ModelSelection = {
  providerId: ProviderId.make("claude"),
  providerKind: "claude",
  model: "claude-opus-5-5",
  effort: "high",
};

const queued = (id: string, position: number, extra: Partial<QueuedTurn> = {}): QueuedTurn => ({
  id,
  threadId: THREAD_ID,
  prompt: `Follow-up ${id}`,
  position,
  status: "queued",
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

const noop = () => undefined;

const renderTray = (items: ReadonlyArray<QueuedTurn>, editingId: string | null = null) =>
  renderToStaticMarkup(
    <QueuedTurnsTray
      items={items}
      running
      editingId={editingId}
      busyId={null}
      onSteerNow={noop}
      onEdit={noop}
      onCancelEdit={noop}
      onRemove={noop}
    />,
  );

describe("steer-default dispatch", () => {
  test("a running thread sends with the active mode, which defaults to steer", () => {
    expect(resolveSendMode(true, "steer", false)).toBe("steer");
    expect(resolveSendMode(true, "queue", false)).toBe("queue");
  });

  test("Alt+Enter flips the active mode for one send", () => {
    expect(resolveSendMode(true, "steer", true)).toBe("queue");
    expect(resolveSendMode(true, "queue", true)).toBe("steer");
    expect(flipDispatchMode("steer")).toBe("queue");
  });

  test("an idle thread omits the mode so normal sends are unchanged", () => {
    expect(resolveSendMode(false, "steer", false)).toBeUndefined();
    expect(resolveSendMode(false, "queue", true)).toBeUndefined();
  });

  test("only Alt+Enter without Shift counts as the queue shortcut", () => {
    expect(isQueueShortcut({ key: "Enter", altKey: true, shiftKey: false })).toBe(true);
    expect(isQueueShortcut({ key: "Enter", altKey: false, shiftKey: false })).toBe(false);
    expect(isQueueShortcut({ key: "Enter", altKey: true, shiftKey: true })).toBe(false);
  });
});

describe("dispatch outcome", () => {
  const turn = {
    id: TurnId.make("turn-1"),
    threadId: THREAD_ID,
    userMessage: "x",
    assistantMessage: "",
    thinkingText: "",
    status: "running" as const,
    startedAt: AT,
    modelSelection: SELECTION,
    activities: [],
    approvals: [],
  };

  test("a queued result reports its display position among the current queue", () => {
    const result: SendTurnResult = { kind: "queued", queuedTurn: queued("new", 5) };
    const outcome = toSubmitOutcome(result, [queued("a", 1), queued("b", 3), queued("c", 9)]);
    expect(outcome).toEqual({ kind: "queued", position: 3 });
  });

  test("steered and started results pass through", () => {
    expect(toSubmitOutcome({ kind: "steered", turn }, [])).toEqual({ kind: "steered" });
    expect(toSubmitOutcome({ kind: "started", turn }, [])).toEqual({ kind: "started" });
  });

  test("activeTurnDispatch preference defaults to steer", () => {
    expect(readPreferences().activeTurnDispatch).toBe("steer");
  });

  test("composer action row stays normal with no steer/queue controls", () => {
    const plusMenu = {
      editorRef: { current: null },
      filesAvailable: false,
      onUpload: noop,
      onMention: noop,
      onSkills: noop,
    };
    const runningEmpty = renderToStaticMarkup(
      <ComposerActionRow
        compact
        plusMenu={plusMenu}
        onPlanOff={null}
        uploadingCount={0}
        uploadError={null}
        onDismissUploadError={noop}
        running
        canSend={false}
        hasDraft={false}
        onStop={noop}
      />,
    );
    expect(runningEmpty).toContain('aria-label="Stop running turn"');
    expect(runningEmpty).not.toContain("Steer");
    expect(runningEmpty).not.toContain("Queue");

    const runningDraft = renderToStaticMarkup(
      <ComposerActionRow
        compact
        plusMenu={plusMenu}
        onPlanOff={null}
        uploadingCount={0}
        uploadError={null}
        onDismissUploadError={noop}
        running
        canSend
        hasDraft
        onStop={noop}
      />,
    );
    expect(runningDraft).toContain('aria-label="Send message"');
    expect(runningDraft).not.toContain("Steer");
    expect(runningDraft).not.toContain("Queue");
  });
});

describe("QueuedTurnsTray", () => {
  test("renders nothing when the queue is empty", () => {
    expect(renderTray([])).toBe("");
  });

  test("renders each queued message with its position, snippet, and attachment count", () => {
    const html = renderTray([
      queued("a", 4),
      queued("b", 7, { attachments: [{ name: "shot.png" }, { name: "log.txt" }] }),
    ]);
    expect(html).toContain("#1");
    expect(html).toContain("#2");
    expect(html).toContain("Follow-up a");
    expect(html).toContain("2 attachments");
    expect(html).toContain("Steer now");
    expect(html).toContain("2 queued messages · runs after this turn");
  });

  test("marks the message being edited and offers cancel instead of actions", () => {
    const html = renderTray([queued("a", 1)], "a");
    expect(html).toContain("Editing in composer");
    expect(html).toContain("Cancel");
    expect(html).not.toContain("Steer now");
  });

  test("helpers collapse whitespace and pluralize the heading", () => {
    expect(queuedSnippet("  fix\n\n  the   bug ")).toBe("fix the bug");
    expect(queuedTrayHeading(1, false)).toBe("1 queued message");
  });
});
