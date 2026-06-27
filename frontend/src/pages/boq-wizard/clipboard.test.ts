// Unit tests for the PURE clipboard helpers (BoQ Phase 5 Slice A: copy/cut/paste/fill-down).
// These pin the geometry + classification logic; the React orchestration in PricingGrid is
// manual-cert (no jsdom), exactly like the rest of the pricing-grid pure-helper suites.
import { describe, it, expect } from "vitest";
import {
  selectionRect,
  rowSelectionRange,
  rectDims,
  shapesMatch,
  classifyPasteTarget,
} from "./clipboard";

describe("selectionRect", () => {
  it("normalizes a top-left -> bottom-right selection", () => {
    expect(selectionRect({ rowIndex: 1, colIndex: 2 }, { rowIndex: 4, colIndex: 6 })).toEqual({
      top: 1,
      bottom: 4,
      left: 2,
      right: 6,
    });
  });

  it("is order-independent (focus above/left of anchor)", () => {
    expect(selectionRect({ rowIndex: 4, colIndex: 6 }, { rowIndex: 1, colIndex: 2 })).toEqual({
      top: 1,
      bottom: 4,
      left: 2,
      right: 6,
    });
  });

  it("collapses to a 1x1 rectangle when anchor === focus", () => {
    expect(selectionRect({ rowIndex: 3, colIndex: 5 }, { rowIndex: 3, colIndex: 5 })).toEqual({
      top: 3,
      bottom: 3,
      left: 5,
      right: 5,
    });
  });
});

describe("rowSelectionRange (per-row scalar derivation)", () => {
  const rect = { top: 2, bottom: 5, left: 3, right: 7 };

  it("returns the column span for a row inside the rectangle", () => {
    expect(rowSelectionRange(rect, 2)).toEqual({ left: 3, right: 7 });
    expect(rowSelectionRange(rect, 4)).toEqual({ left: 3, right: 7 });
    expect(rowSelectionRange(rect, 5)).toEqual({ left: 3, right: 7 });
  });

  it("returns null for a row above or below the rectangle", () => {
    expect(rowSelectionRange(rect, 1)).toBeNull();
    expect(rowSelectionRange(rect, 6)).toBeNull();
  });

  it("returns null when there is no rectangle", () => {
    expect(rowSelectionRange(null, 3)).toBeNull();
  });
});

describe("rectDims", () => {
  it("reports inclusive width/height", () => {
    expect(rectDims({ top: 2, bottom: 5, left: 3, right: 7 })).toEqual({ rows: 4, cols: 5 });
  });

  it("reports 1x1 for a collapsed rectangle", () => {
    expect(rectDims({ top: 3, bottom: 3, left: 5, right: 5 })).toEqual({ rows: 1, cols: 1 });
  });
});

describe("shapesMatch", () => {
  it("matches identical dimensions", () => {
    expect(shapesMatch({ rows: 2, cols: 3 }, { rows: 2, cols: 3 })).toBe(true);
    expect(shapesMatch({ rows: 1, cols: 1 }, { rows: 1, cols: 1 })).toBe(true);
  });

  it("rejects a row-count mismatch", () => {
    expect(shapesMatch({ rows: 2, cols: 3 }, { rows: 3, cols: 3 })).toBe(false);
  });

  it("rejects a col-count mismatch", () => {
    expect(shapesMatch({ rows: 2, cols: 3 }, { rows: 2, cols: 4 })).toBe(false);
  });

  it("rejects a single cell onto a multi-cell range (no tiling)", () => {
    expect(shapesMatch({ rows: 1, cols: 1 }, { rows: 2, cols: 2 })).toBe(false);
  });
});

describe("classifyPasteTarget (all three verdicts)", () => {
  it("WRITE: rate clipboard onto a writable rate target", () => {
    expect(classifyPasteTarget("rate", "rate", true)).toBe("WRITE");
  });

  it("WRITE: remark clipboard onto a remark target (isRateWritable ignored)", () => {
    expect(classifyPasteTarget("remark", "remark", false)).toBe("WRITE");
  });

  it("SKIP_NON_PRICEABLE: rate clipboard onto a non-writable rate target", () => {
    expect(classifyPasteTarget("rate", "rate", false)).toBe("SKIP_NON_PRICEABLE");
  });

  it("SKIP_CROSS_KIND: rate clipboard onto a remark target", () => {
    expect(classifyPasteTarget("rate", "remark", true)).toBe("SKIP_CROSS_KIND");
  });

  it("SKIP_CROSS_KIND: remark clipboard onto a rate target", () => {
    expect(classifyPasteTarget("remark", "rate", true)).toBe("SKIP_CROSS_KIND");
  });

  it("SKIP_CROSS_KIND: any clipboard onto an 'other' (anchor/amount/qty) target", () => {
    expect(classifyPasteTarget("rate", "other", true)).toBe("SKIP_CROSS_KIND");
    expect(classifyPasteTarget("remark", "other", true)).toBe("SKIP_CROSS_KIND");
  });

  it("cross-kind beats the priceability check (kind is checked first)", () => {
    // rate clipboard, remark target, even with isRateWritable true -> cross-kind, never priceable.
    expect(classifyPasteTarget("rate", "remark", true)).toBe("SKIP_CROSS_KIND");
  });
});
