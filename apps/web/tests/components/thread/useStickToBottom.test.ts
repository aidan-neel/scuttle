import { describe, expect, test } from "bun:test";
import {
  computeAnchoredTurnMinHeight,
  computeNextPinned,
  isAnchorableTurn,
  SCROLL_VERTICAL_PADDING_PX,
  STICK_THRESHOLD_PX,
  UNPIN_SUPPRESS_MS,
} from "../../../src/components/thread/useStickToBottom.ts";

describe("computeNextPinned", () => {
  test("unpins immediately when user scrolls upward even within STICK_THRESHOLD_PX", () => {
    expect(
      computeNextPinned({
        currentlyPinned: true,
        prevScrollTop: 1000,
        prevDistanceFromBottom: 0,
        scrollTop: 950,
        distanceFromBottom: 50,
        nowMs: 1000,
        suppressPinUntilMs: 0,
      }),
    ).toBe(false);
  });

  test("stays pinned when collapsing content clamps scrollTop downward while remaining at bottom", () => {
    expect(
      computeNextPinned({
        currentlyPinned: true,
        prevScrollTop: 1600,
        prevDistanceFromBottom: 0,
        scrollTop: 1320,
        distanceFromBottom: 0,
        nowMs: 1000,
        suppressPinUntilMs: 0,
      }),
    ).toBe(true);
  });

  test("stays unpinned during smooth jump suppression window even within threshold", () => {
    const suppressUntil = 1000 + UNPIN_SUPPRESS_MS;
    expect(
      computeNextPinned({
        currentlyPinned: false,
        prevScrollTop: 1000,
        prevDistanceFromBottom: 0,
        scrollTop: 980,
        distanceFromBottom: 20,
        nowMs: 1100,
        suppressPinUntilMs: suppressUntil,
      }),
    ).toBe(false);

    expect(
      computeNextPinned({
        currentlyPinned: false,
        prevScrollTop: 980,
        prevDistanceFromBottom: 20,
        scrollTop: 990,
        distanceFromBottom: 10,
        nowMs: 1200,
        suppressPinUntilMs: suppressUntil,
      }),
    ).toBe(false);
  });

  test("stays unpinned after suppress window unless user scrolls downward near bottom", () => {
    expect(
      computeNextPinned({
        currentlyPinned: false,
        prevScrollTop: 900,
        prevDistanceFromBottom: 100,
        scrollTop: 900,
        distanceFromBottom: 100,
        nowMs: 2500,
        suppressPinUntilMs: 1800,
      }),
    ).toBe(false);

    expect(
      computeNextPinned({
        currentlyPinned: false,
        prevScrollTop: 900,
        prevDistanceFromBottom: 280,
        scrollTop: 960,
        distanceFromBottom: STICK_THRESHOLD_PX,
        nowMs: 2500,
        suppressPinUntilMs: 1800,
      }),
    ).toBe(true);
  });

  test("stays pinned while streaming grows content and keeps scrollTop non-decreasing", () => {
    expect(
      computeNextPinned({
        currentlyPinned: true,
        prevScrollTop: 1200,
        prevDistanceFromBottom: 0,
        scrollTop: 1260,
        distanceFromBottom: 0,
        nowMs: 3000,
        suppressPinUntilMs: 0,
      }),
    ).toBe(true);
  });
});

describe("computeAnchoredTurnMinHeight", () => {
  test("reserves viewport height minus scroll container padding and clamps at zero", () => {
    expect(computeAnchoredTurnMinHeight(800)).toBe(800 - SCROLL_VERTICAL_PADDING_PX);
    expect(computeAnchoredTurnMinHeight(640.8, 60)).toBe(580);
    expect(computeAnchoredTurnMinHeight(40, 60)).toBe(0);
  });

  test("skips system turns so agent onboarding keeps the hero visible", () => {
    expect(isAnchorableTurn(undefined)).toBe(false);
    expect(isAnchorableTurn({ origin: "system" })).toBe(false);
    expect(isAnchorableTurn({ origin: "user" })).toBe(true);
    expect(isAnchorableTurn({})).toBe(true);
  });
});
