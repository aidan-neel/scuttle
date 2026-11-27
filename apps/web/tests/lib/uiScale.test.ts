import { describe, expect, test } from "bun:test";
import { getRootFontSizePx, remToPx } from "@/lib/uiScale.ts";

describe("uiScale", () => {
  test("falls back to the 110% root font size outside the browser", () => {
    expect(getRootFontSizePx()).toBe(17.6);
    expect(remToPx(2)).toBeCloseTo(35.2, 5);
    expect(remToPx(3.5)).toBeCloseTo(61.6, 5);
  });
});
