import { describe, expect, test } from "bun:test";
import {
  formatAxisTokens,
  formatSessions,
  formatShare,
  formatTokens,
  formatUsd,
} from "../../src/components/settings/usage/usageFormat.ts";

describe("usageFormat", () => {
  test("formats token counts cleanly across scales", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(842)).toBe("842");
    expect(formatTokens(44_100)).toBe("44.1K");
    expect(formatTokens(97_000_000)).toBe("97M");
    expect(formatTokens(4_640_000_000)).toBe("4.64B");
  });

  test("formats axis ticks, usd, share, and session counts", () => {
    expect(formatAxisTokens(1_500_000_000)).toBe("1.5B");
    expect(formatAxisTokens(500_000_000)).toBe("500M");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(1634.32)).toBe("$1,634.32");
    expect(formatShare(0.7452)).toBe("74.5%");
    expect(formatShare(0.0004)).toBe("<0.1%");
    expect(formatSessions(1)).toBe("1 session");
    expect(formatSessions(301)).toBe("301 sessions");
  });
});
