/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { sampleRailTurnIndices } from "../../../src/components/thread/ScrollRuler.tsx";
import {
  computeInitialVisibleStart,
  expandVisibleStart,
  INITIAL_VISIBLE_TURNS,
  LOAD_EARLIER_BATCH,
} from "../../../src/components/thread/ThreadTurnList.tsx";

describe("turnWindow", () => {
  test("computeInitialVisibleStart returns tail window start across short, exact, and long arrays", () => {
    expect(computeInitialVisibleStart(0, INITIAL_VISIBLE_TURNS)).toBe(0);
    expect(computeInitialVisibleStart(5, INITIAL_VISIBLE_TURNS)).toBe(0);
    expect(computeInitialVisibleStart(23, INITIAL_VISIBLE_TURNS)).toBe(0);
    expect(computeInitialVisibleStart(24, INITIAL_VISIBLE_TURNS)).toBe(0);
    expect(computeInitialVisibleStart(25, INITIAL_VISIBLE_TURNS)).toBe(1);
    expect(computeInitialVisibleStart(200, INITIAL_VISIBLE_TURNS)).toBe(176);
  });

  test("expandVisibleStart steps backward by batchSize and clamps at 0", () => {
    expect(expandVisibleStart(176, LOAD_EARLIER_BATCH)).toBe(152);
    expect(expandVisibleStart(152, LOAD_EARLIER_BATCH)).toBe(128);
    expect(expandVisibleStart(24, LOAD_EARLIER_BATCH)).toBe(0);
    expect(expandVisibleStart(10, LOAD_EARLIER_BATCH)).toBe(0);
    expect(expandVisibleStart(0, LOAD_EARLIER_BATCH)).toBe(0);
  });

  test("sampleRailTurnIndices handles 0, <=36, and >36 turns", () => {
    expect(sampleRailTurnIndices(0)).toEqual([]);
    expect(sampleRailTurnIndices(1)).toEqual([0]);
    expect(sampleRailTurnIndices(12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(sampleRailTurnIndices(36)).toEqual(Array.from({ length: 36 }, (_, i) => i));

    for (const total of [37, 100, 200]) {
      const sampled = sampleRailTurnIndices(total);
      expect(sampled.length).toBe(36);
      expect(sampled[0]).toBe(0);
      expect(sampled[sampled.length - 1]).toBe(total - 1);
      for (let i = 1; i < sampled.length; i++) {
        expect(sampled[i]!).toBeGreaterThan(sampled[i - 1]!);
      }
    }
  });
});
