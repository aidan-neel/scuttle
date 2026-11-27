import { describe, expect, it } from "bun:test";
import type { ActivityItem, ThreadTurn } from "@scuttle/contracts";
import { ActivityId, ProviderId, ThreadId, TurnId } from "@scuttle/shared/ids";
import {
  formatElapsedTokens,
  isTurnWorking,
} from "../../../src/components/thread/WorkProgress.tsx";

const makeTurn = (overrides: Partial<ThreadTurn> = {}): ThreadTurn => ({
  id: TurnId.make("turn-1"),
  threadId: ThreadId.make("thread-1"),
  userMessage: "hi",
  assistantMessage: "",
  thinkingText: "",
  status: "running",
  startedAt: "2026-11-27T00:00:00.000Z",
  modelSelection: {
    providerId: ProviderId.make("claude"),
    providerKind: "claude",
    model: "claude-sonnet-4-6",
  },
  activities: [],
  approvals: [],
  ...overrides,
});

const makeActivity = (status: ActivityItem["status"]): ActivityItem => ({
  id: ActivityId.make("act-1"),
  turnId: TurnId.make("turn-1"),
  threadId: ThreadId.make("thread-1"),
  kind: "command",
  label: "Ran command",
  activeLabel: "Running command",
  status,
  startedAt: "2026-11-27T00:00:01.000Z",
});

describe("formatElapsedTokens", () => {
  it("assigns stable right-aligned keys to second digits", () => {
    expect(formatElapsedTokens(9_000)).toEqual([
      { key: "s-0", char: "9", isDigit: true },
      { key: "u-s", char: "s", isDigit: false },
    ]);
    expect(formatElapsedTokens(10_000)).toEqual([
      { key: "s-1", char: "1", isDigit: true },
      { key: "s-0", char: "0", isDigit: true },
      { key: "u-s", char: "s", isDigit: false },
    ]);
    expect(formatElapsedTokens(16_400)).toEqual([
      { key: "s-1", char: "1", isDigit: true },
      { key: "s-0", char: "6", isDigit: true },
      { key: "u-s", char: "s", isDigit: false },
    ]);
  });

  it("formats whole minutes and minute-second spans with stable unit keys", () => {
    expect(formatElapsedTokens(60_000)).toEqual([
      { key: "m-0", char: "1", isDigit: true },
      { key: "u-m", char: "m", isDigit: false },
    ]);
    expect(formatElapsedTokens(75_000)).toEqual([
      { key: "m-0", char: "1", isDigit: true },
      { key: "u-m", char: "m", isDigit: false },
      { key: "sp", char: " ", isDigit: false },
      { key: "s-1", char: "1", isDigit: true },
      { key: "s-0", char: "5", isDigit: true },
      { key: "u-s", char: "s", isDigit: false },
    ]);
  });
});

describe("isTurnWorking", () => {
  it("stays true while waiting or running activities, and stops once responding", () => {
    expect(isTurnWorking(makeTurn())).toBe(true);
    expect(isTurnWorking(makeTurn({ activities: [makeActivity("running")] }))).toBe(true);
    expect(
      isTurnWorking(
        makeTurn({
          assistantMessage: "Let me check...",
          activities: [makeActivity("running")],
        }),
      ),
    ).toBe(true);
    expect(
      isTurnWorking(
        makeTurn({
          assistantMessage: "Here is the answer.",
          activities: [makeActivity("completed")],
        }),
      ),
    ).toBe(false);
    expect(isTurnWorking(makeTurn({ assistantMessage: "Direct reply." }))).toBe(false);
    expect(isTurnWorking(makeTurn({ status: "completed" }))).toBe(false);
  });
});
