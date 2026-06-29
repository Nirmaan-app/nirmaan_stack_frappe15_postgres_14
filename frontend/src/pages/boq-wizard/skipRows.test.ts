// Unit tests for skipRows.ts -- the PURE "skip rows after header" leaf (header-config redesign).
import { describe, it, expect } from "vitest";
import { resolveSkipDefinitions, firstDataRow, defsFromLegacyList } from "./skipRows";
import type { SkipDefinition } from "./boqTypes";

describe("resolveSkipDefinitions (flatten -> sorted, deduped row set)", () => {
  it("resolves a single to a one-element array", () => {
    expect(resolveSkipDefinitions([{ kind: "single", row: 8 }])).toEqual([8]);
  });

  it("expands a range INCLUSIVE of both ends", () => {
    expect(resolveSkipDefinitions([{ kind: "range", start: 3, end: 6 }])).toEqual([3, 4, 5, 6]);
  });

  it("merges mixed singles + ranges, sorted ascending", () => {
    const defs: SkipDefinition[] = [
      { kind: "single", row: 10 },
      { kind: "range", start: 3, end: 5 },
      { kind: "single", row: 1 },
    ];
    expect(resolveSkipDefinitions(defs)).toEqual([1, 3, 4, 5, 10]);
  });

  it("de-duplicates overlapping definitions", () => {
    const defs: SkipDefinition[] = [
      { kind: "range", start: 3, end: 6 },
      { kind: "range", start: 5, end: 8 },
      { kind: "single", row: 4 },
    ];
    expect(resolveSkipDefinitions(defs)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it("drops a single with row < 1 and a range with end < start", () => {
    const defs: SkipDefinition[] = [
      { kind: "single", row: 0 },
      { kind: "single", row: -2 },
      { kind: "range", start: 8, end: 4 },
      { kind: "single", row: 7 },
    ];
    expect(resolveSkipDefinitions(defs)).toEqual([7]);
  });

  it("drops a range whose start < 1", () => {
    expect(resolveSkipDefinitions([{ kind: "range", start: 0, end: 3 }])).toEqual([]);
  });

  it("ignores non-integer / NaN values", () => {
    const defs: SkipDefinition[] = [
      { kind: "single", row: 2.5 },
      { kind: "single", row: NaN },
      { kind: "range", start: 1.5, end: 3 },
      { kind: "single", row: 4 },
    ];
    expect(resolveSkipDefinitions(defs)).toEqual([4]);
  });

  it("returns [] for an empty list", () => {
    expect(resolveSkipDefinitions([])).toEqual([]);
  });
});

describe("firstDataRow (step past skips contiguous with the header)", () => {
  it("returns headerRow + 1 when there are no skips", () => {
    expect(firstDataRow(2, [])).toBe(3);
  });

  it("steps past leading contiguous skips", () => {
    expect(firstDataRow(2, [3, 4, 5])).toBe(6);
  });

  it("stops before a gap in the skip set (does NOT jump the gap)", () => {
    expect(firstDataRow(2, [4, 5])).toBe(3);
  });

  it("returns headerRow + 1 when skips are not adjacent to the header", () => {
    expect(firstDataRow(2, [10, 11])).toBe(3);
  });

  it("returns NaN when headerRow is not a positive integer", () => {
    expect(firstDataRow(0, [])).toBeNaN();
    expect(firstDataRow(-1, [2, 3])).toBeNaN();
    expect(firstDataRow(2.5, [])).toBeNaN();
    expect(firstDataRow(NaN, [])).toBeNaN();
  });
});

describe("defsFromLegacyList (flat list -> structured singles)", () => {
  it("maps each row to a single, preserving order", () => {
    expect(defsFromLegacyList([8, 40])).toEqual([
      { kind: "single", row: 8 },
      { kind: "single", row: 40 },
    ]);
  });

  it("drops invalid (< 1, non-integer, NaN) entries", () => {
    expect(defsFromLegacyList([0, 3, -1, 2.5, NaN, 9])).toEqual([
      { kind: "single", row: 3 },
      { kind: "single", row: 9 },
    ]);
  });

  it("returns [] for an empty list", () => {
    expect(defsFromLegacyList([])).toEqual([]);
  });
});
