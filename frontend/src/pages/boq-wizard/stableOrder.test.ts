import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stableOrder } from "./stableOrder";

// The column-map screen's own sort: A, B, ..., Z, AA, AB, ...
const sortCols = (cols: string[]) => [...cols].sort((a, b) => (a.length !== b.length ? a.length - b.length : a.localeCompare(b)));

describe("column-map rows stay in place (S6 F9 / U8)", () => {
  it("first load: letter order, as before", () => {
    expect(stableOrder([], ["K", "B", "AA", "C"], null, sortCols)).toEqual(["B", "C", "K", "AA"]);
  });

  it("picking a column for a new row adds it at the END, not in its letter slot", () => {
    expect(stableOrder(["B", "C", "K"], ["B", "C", "K", "A"], null, sortCols)).toEqual(["B", "C", "K", "A"]);
  });

  it("changing a row's column keeps the row where it was", () => {
    expect(stableOrder(["B", "C", "K"], ["B", "K", "Z"], { from: "C", to: "Z" }, sortCols)).toEqual(["B", "Z", "K"]);
  });

  it("a removed row drops out; the rest keep their order", () => {
    expect(stableOrder(["B", "C", "K"], ["B", "K"], null, sortCols)).toEqual(["B", "K"]);
  });

  it("negative: without the rename hint a changed column would move to the end (the hint is what keeps it)", () => {
    expect(stableOrder(["B", "C", "K"], ["B", "K", "Z"], null, sortCols)).toEqual(["B", "K", "Z"]);
  });

  it("is idempotent when React renders twice with the same hint", () => {
    const once = stableOrder(["B", "C", "K"], ["B", "K", "Z"], { from: "C", to: "Z" }, sortCols);
    expect(stableOrder(once, ["B", "K", "Z"], { from: "C", to: "Z" }, sortCols)).toEqual(once);
  });

  it("the config panel renders from it and gives the rename hint (source)", () => {
    const panel = readFileSync(join(__dirname, "SheetConfigPanel.tsx"), "utf8");
    expect(panel).toContain("stableOrder(displayOrderRef.current, Object.keys(columnRoleMap), renameRef.current, sortColLetters)");
    expect(panel).toContain("renameRef.current = { from: oldCol, to: newCol };");
    expect(panel).not.toContain("() => sortColLetters(Object.keys(columnRoleMap)),");
  });
});
