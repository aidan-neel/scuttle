/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { computeListWindow } from "../../../src/components/shell/useListWindow.ts";

describe("computeListWindow", () => {
  test("returns empty window for empty list or non-positive stride", () => {
    expect(computeListWindow(0, 600, 0, 0, 57, 8)).toEqual({ startIndex: 0, endIndex: 0 });
    expect(computeListWindow(200, 600, 0, 0, 57, 8)).toEqual({ startIndex: 0, endIndex: 0 });
    expect(computeListWindow(0, 600, 0, 20, 0, 8)).toEqual({ startIndex: 0, endIndex: 0 });
  });

  test("renders full range when list is shorter than viewport", () => {
    expect(computeListWindow(0, 600, 0, 5, 57, 8)).toEqual({ startIndex: 0, endIndex: 5 });
    expect(computeListWindow(0, 224, 0, 4, 33, 6)).toEqual({ startIndex: 0, endIndex: 4 });
  });

  test("windows scrolled middle and accounts for listOffsetTop", () => {
    expect(computeListWindow(5700, 570, 0, 380, 57, 8)).toEqual({
      startIndex: 92,
      endIndex: 118,
    });
    expect(computeListWindow(6000, 570, 300, 380, 57, 8)).toEqual({
      startIndex: 92,
      endIndex: 118,
    });
  });

  test("clamps overscan at top and bottom of list", () => {
    expect(computeListWindow(57, 570, 0, 380, 57, 8)).toEqual({
      startIndex: 0,
      endIndex: 19,
    });
    expect(computeListWindow(380 * 57 - 570, 570, 0, 380, 57, 8)).toEqual({
      startIndex: 362,
      endIndex: 380,
    });
  });

  test("clamps range when count shrinks below previous scroll offset", () => {
    expect(computeListWindow(5700, 570, 0, 20, 57, 8)).toEqual({
      startIndex: 20,
      endIndex: 20,
    });
    expect(computeListWindow(600, 570, 0, 20, 57, 8)).toEqual({
      startIndex: 2,
      endIndex: 20,
    });
  });

  test("clamps negative overscan and handles list entirely below fold", () => {
    expect(computeListWindow(0, 200, 500, 100, 57, 8)).toEqual({
      startIndex: 0,
      endIndex: 8,
    });
    expect(computeListWindow(570, 570, 0, 100, 57, -3)).toEqual({
      startIndex: 10,
      endIndex: 20,
    });
  });
});
