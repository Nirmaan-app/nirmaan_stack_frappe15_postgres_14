// Unit tests for the V1 virtualized-grid pure helpers (pricingVirtual.ts).
import { describe, it, expect } from "vitest";

import {
  selectRenderPath,
  seedEstimate,
  deriveSpacers,
  topVisibleIndex,
  clampIndex,
  paneColSpan,
} from "./pricingVirtual";

describe("selectRenderPath (toggle x frozen x split)", () => {
  it("empty when no rows, regardless of mode", () => {
    expect(selectRenderPath({ rowCount: 0, virtualized: true, frozen: true, split: true })).toBe("empty");
    expect(selectRenderPath({ rowCount: 0, virtualized: false, frozen: false, split: false })).toBe("empty");
  });

  it("VIRTUALIZED: two-pane gates on `frozen` (NOT split -- split never commits when windowed)", () => {
    // frozen=true, split=false (measure-all never completes on the windowed path) -> still twoPane
    expect(selectRenderPath({ rowCount: 100, virtualized: true, frozen: true, split: false })).toBe("twoPane");
    expect(selectRenderPath({ rowCount: 100, virtualized: true, frozen: false, split: false })).toBe("single");
  });

  it("CLASSIC: two-pane gates on `split` (frozen alone is not enough)", () => {
    expect(selectRenderPath({ rowCount: 100, virtualized: false, frozen: true, split: false })).toBe("single");
    expect(selectRenderPath({ rowCount: 100, virtualized: false, frozen: true, split: true })).toBe("twoPane");
    expect(selectRenderPath({ rowCount: 100, virtualized: false, frozen: false, split: false })).toBe("single");
  });
});

describe("seedEstimate (manual/measured wins else fallback)", () => {
  it("uses the applied height when known and positive", () => {
    expect(seedEstimate(48, 34)).toBe(48);
    expect(seedEstimate(120, 34)).toBe(120);
  });
  it("falls back for undefined / null / non-positive", () => {
    expect(seedEstimate(undefined, 34)).toBe(34);
    expect(seedEstimate(null, 34)).toBe(34);
    expect(seedEstimate(0, 34)).toBe(34);
    expect(seedEstimate(-5, 34)).toBe(34);
  });
});

describe("deriveSpacers (window bracket math)", () => {
  it("empty window -> 0/0", () => {
    expect(deriveSpacers([], 5000)).toEqual({ paddingTop: 0, paddingBottom: 0 });
  });
  it("single mounted item", () => {
    expect(deriveSpacers([{ start: 100, end: 140 }], 5000)).toEqual({ paddingTop: 100, paddingBottom: 4860 });
  });
  it("full window from the top (no top spacer)", () => {
    expect(
      deriveSpacers([{ start: 0, end: 40 }, { start: 40, end: 80 }], 80),
    ).toEqual({ paddingTop: 0, paddingBottom: 0 });
  });
  it("clamps negative bottom (transient measurement drift) to 0", () => {
    expect(deriveSpacers([{ start: 0, end: 200 }], 150).paddingBottom).toBe(0);
  });
});

describe("topVisibleIndex + clampIndex (flip re-anchor)", () => {
  it("topVisibleIndex returns the first mounted index, else null", () => {
    expect(topVisibleIndex([{ index: 37 }, { index: 38 }])).toBe(37);
    expect(topVisibleIndex([])).toBeNull();
  });
  it("clampIndex keeps the anchor in-range after a collapse shrank the set", () => {
    expect(clampIndex(500, 100)).toBe(99); // set shrank to 100 rows -> clamp to last
    expect(clampIndex(0, 100)).toBe(0);
    expect(clampIndex(50, 100)).toBe(50);
    expect(clampIndex(null, 100)).toBeNull();
    expect(clampIndex(50, 0)).toBeNull();
  });
});

describe("paneColSpan (spacer <td> colSpan per pane)", () => {
  it("frozen = anchors, scrolling = 1 + descriptors + 1, single = all", () => {
    expect(paneColSpan("frozen", 5, 8)).toBe(5);
    expect(paneColSpan("scrolling", 5, 8)).toBe(1 + 8 + 1);
    expect(paneColSpan(undefined, 5, 8)).toBe(5 + 1 + 8 + 1);
  });
});
