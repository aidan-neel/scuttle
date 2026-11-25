import { describe, expect, test } from "bun:test";
import { IDENTICON_GRID, identicon } from "./identicon.ts";

describe("identicon", () => {
  test("returns the same identicon for the same name", () => {
    expect(identicon("scuttle")).toEqual(identicon("scuttle"));
  });

  test("matches the colors of the chosen design for known projects", () => {
    expect(identicon("scuttle")).toMatchObject({ background: "#22381e", foreground: "#8dda80" });
    expect(identicon("recoder")).toMatchObject({ background: "#38231e", foreground: "#da9380" });
    expect(identicon("sivir-ui")).toMatchObject({ background: "#1e3834", foreground: "#80dacc" });
  });

  test("gives different project names different colors", () => {
    const names = ["scuttle", "recoder", "sivir-ui"];
    const colors = new Set(names.map((name) => identicon(name).foreground));
    expect(colors.size).toBe(names.length);
  });

  test("mirrors every row left to right", () => {
    for (const name of ["scuttle", "recoder", "sivir-ui", "a"]) {
      const { cells } = identicon(name);
      expect(cells).toHaveLength(IDENTICON_GRID);
      for (const row of cells) {
        expect(row).toEqual([...row].reverse());
      }
    }
  });
});
