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
  foldBcsWrites,
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

  // ── BCS-S3a: the cost boxes are a THIRD kind ─────────────────────────────────
  it("WRITE: bcs clipboard onto a writable bcs target", () => {
    expect(classifyPasteTarget("bcs", "bcs", true)).toBe("WRITE");
  });

  it("SKIP_NOT_COSTABLE: bcs clipboard onto a bcs target that cannot be written", () => {
    // Its OWN verdict, not SKIP_NON_PRICEABLE: a cost box is refused by the BCS gates
    // (locked / not set up), never by priceability, so borrowing that word would put a
    // wrong reason in the paste summary.
    expect(classifyPasteTarget("bcs", "bcs", false)).toBe("SKIP_NOT_COSTABLE");
  });

  it("SKIP_CROSS_KIND: a cost value never lands in a rate, remark or Total cell", () => {
    expect(classifyPasteTarget("bcs", "rate", true)).toBe("SKIP_CROSS_KIND");
    expect(classifyPasteTarget("bcs", "remark", true)).toBe("SKIP_CROSS_KIND");
    // The Total Amount column is computed, so it classifies as "other" and is never a target.
    expect(classifyPasteTarget("bcs", "other", true)).toBe("SKIP_CROSS_KIND");
  });

  it("SKIP_CROSS_KIND: a rate or remark never lands in a cost box either", () => {
    expect(classifyPasteTarget("rate", "bcs", true)).toBe("SKIP_CROSS_KIND");
    expect(classifyPasteTarget("remark", "bcs", true)).toBe("SKIP_CROSS_KIND");
  });
});

describe("foldBcsWrites -- N cost cells become ONE whole-row save per row", () => {
  // ⚠️ THE ROW-VS-CELL SHAPE. save_row_bcs_rates is a WHOLE-ROW snapshot write that zeroes
  // any rate it is not given, so a paste spanning several cost columns must gather each row's
  // siblings into ONE call. Firing per cell would have the second call overwrite the first
  // with a 0 for the column the first had just written.
  const base = () => ({ supply_rate: 0, install_rate: 0, combined_rate: 0 });

  it("folds two columns of one row into a single write carrying both", () => {
    const writes = foldBcsWrites(
      [
        { excelRow: 7, field: "supply_rate", value: 100, description: "Cable" },
        { excelRow: 7, field: "install_rate", value: 40, description: "Cable" },
      ],
      base,
    );
    expect(writes).toEqual([
      {
        kind: "bcs",
        args: {
          excelRow: 7,
          description: "Cable",
          rates: { supply_rate: 100, install_rate: 40, combined_rate: 0 },
        },
      },
    ]);
  });

  it("keeps one write PER ROW, in first-touched order", () => {
    const writes = foldBcsWrites(
      [
        { excelRow: 9, field: "supply_rate", value: 1 },
        { excelRow: 7, field: "supply_rate", value: 2 },
        { excelRow: 9, field: "install_rate", value: 3 },
      ],
      base,
    );
    expect(writes.map((w) => w.args.excelRow)).toEqual([9, 7]);
    expect(writes[0].args.rates).toEqual({ supply_rate: 1, install_rate: 3, combined_rate: 0 });
    expect(writes[1].args.rates).toEqual({ supply_rate: 2, install_rate: 0, combined_rate: 0 });
  });

  it("starts each row from ITS OWN current values, so untouched siblings survive", () => {
    const writes = foldBcsWrites([{ excelRow: 7, field: "supply_rate", value: 100 }], (r) =>
      r === 7 ? { supply_rate: 5, install_rate: 40, combined_rate: 77 } : base(),
    );
    expect(writes[0].args.rates).toEqual({
      supply_rate: 100,
      install_rate: 40, // <- would be 0 under a per-cell save
      combined_rate: 77, // <- a field this sheet offers no box for is still not stranded
    });
  });

  it("lets a later entry win for the same field (a fill-down over its own source)", () => {
    const writes = foldBcsWrites(
      [
        { excelRow: 7, field: "supply_rate", value: 1 },
        { excelRow: 7, field: "supply_rate", value: 2 },
      ],
      base,
    );
    expect(writes).toHaveLength(1);
    expect(writes[0].args.rates.supply_rate).toBe(2);
  });

  it("writes nothing for an empty gesture", () => {
    expect(foldBcsWrites([], base)).toEqual([]);
  });

  it("omits an absent description rather than sending an empty one", () => {
    const writes = foldBcsWrites([{ excelRow: 7, field: "supply_rate", value: 1 }], base);
    expect(writes[0].args.description).toBeUndefined();
  });
});
