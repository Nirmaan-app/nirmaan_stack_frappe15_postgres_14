// Unit tests for priceability (BoQ Phase 5 Slice 4b-A -- the shared qty-bearing-priceable
// definition + the computed review-flag derivation). The spine is tested directly: the
// locked owner rule (node_type gate AND qty-bearing in >=1 area; option-(i) fully-priced),
// the three flags (needs-rate / won't-compute / qty-anomaly), F4 not_yet/broken surfacing,
// the priced N/M count, and the incomplete-row predicate.
import { describe, it, expect } from "vitest";
import {
  buildFlagEntries,
  computePricedCount,
  computeRowFlags,
  isFullyPriced,
  isPriceableLine,
  isRateFilled,
  isRowIncomplete,
  qtyBearingAreas,
} from "./priceability";
import type { ColumnDescriptor, ColumnFormula, PricedRow } from "./boqTypes";

function desc(
  col: string,
  role: string,
  value_field: string,
  value_key: string | null = null,
  rate_subkey: string | null = null,
): ColumnDescriptor {
  return { col, role, area: value_key, value_field, value_key, rate_subkey };
}

// Narrow row factory -- priceability reads only these fields; cast the rest.
function prow(p: Partial<PricedRow>): PricedRow {
  return p as unknown as PricedRow;
}

// ── Per-area, two-area combined sheet (the common multi-area shape). ──────────────
const PER_AREA_CDS: ColumnDescriptor[] = [
  desc("A", "sl_no", "sl_no_value"),
  desc("B", "description", "description"),
  desc("D", "qty", "qty_by_area", "A1"),
  desc("E", "rate_combined_by_area", "rate_by_area", "A1", "combined_rate"),
  desc("F", "amount_total_by_area", "amount_by_area", "A1", "total"),
  desc("G", "qty", "qty_by_area", "A2"),
  desc("H", "rate_combined_by_area", "rate_by_area", "A2", "combined_rate"),
  desc("I", "amount_total_by_area", "amount_by_area", "A2", "total"),
];

// ── Scalar single-total sheet (single "area" = the scalar sentinel). ──────────────
const SCALAR_CDS: ColumnDescriptor[] = [
  desc("B", "description", "description"),
  desc("C", "qty_total", "qty_total"),
  desc("E", "rate_combined", "rate_combined"),
  desc("F", "amount_total", "amount_total"),
];

describe("priceability -- the shared spine", () => {
  it("zero-qty-EVERYWHERE priceable row is NOT a priceable line (drops out)", () => {
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_by_area: { A1: 0, A2: 0 },
    });
    expect(qtyBearingAreas(row, PER_AREA_CDS)).toEqual([]);
    expect(isPriceableLine(row, PER_AREA_CDS)).toBe(false);
    expect(isFullyPriced(row, PER_AREA_CDS)).toBe(false);
  });

  it("single-area (scalar) qty-bearing priceable row is a priceable line", () => {
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Preamble", qty_total: 10,
    });
    expect(qtyBearingAreas(row, SCALAR_CDS)).toEqual([null]); // the scalar sentinel
    expect(isPriceableLine(row, SCALAR_CDS)).toBe(true);
  });

  it("a non-priceable node_type is never a priceable line, even with qty", () => {
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Other", qty_total: 10,
    });
    expect(isPriceableLine(row, SCALAR_CDS)).toBe(false);
  });

  it("multi-area PARTIAL-qty: fully-priced IGNORES the no-qty area", () => {
    // qty only in A1; A1 rate filled (committed non-zero). A2 has no qty -> ignored.
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_by_area: { A1: 10, A2: 0 },
      rate_by_area: { A1: { combined_rate: 5 } } as never, // committed non-zero in A1
    });
    expect(qtyBearingAreas(row, PER_AREA_CDS)).toEqual(["A1"]); // A2 excluded (no qty)
    expect(isPriceableLine(row, PER_AREA_CDS)).toBe(true);
    expect(isFullyPriced(row, PER_AREA_CDS)).toBe(true); // A1 filled; A2 ignored
  });

  it("fully-priced MULTI-area row (both qty-bearing areas filled)", () => {
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_by_area: { A1: 10, A2: 4 },
      rate_by_area: { A1: { combined_rate: 5 }, A2: { combined_rate: 7 } } as never,
    });
    expect(qtyBearingAreas(row, PER_AREA_CDS).sort()).toEqual(["A1", "A2"]);
    expect(isFullyPriced(row, PER_AREA_CDS)).toBe(true);
  });

  it("half-priced MULTI-area row (one qty-bearing area unpriced) is NOT fully priced", () => {
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_by_area: { A1: 10, A2: 4 },
      rate_by_area: { A1: { combined_rate: 5 }, A2: { combined_rate: 0 } } as never, // A2 zero/unfilled
    });
    expect(isFullyPriced(row, PER_AREA_CDS)).toBe(false);
  });

  it("FILLED is never a bare zero-check: an editor-priced deliberate 0 counts as filled", () => {
    const rd = PER_AREA_CDS.find((d) => d.col === "E")!; // A1 combined rate
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_by_area: { A1: 10 },
      rate_by_area: { A1: { combined_rate: 0 } } as never, // value 0 ...
      priced_by_area: { A1: { combined_rate: true } }, // ... but editor-priced (marker)
    });
    expect(isRateFilled(row, rd, PER_AREA_CDS)).toBe(true); // a deliberate 0 IS filled
    expect(isFullyPriced(row, PER_AREA_CDS)).toBe(true);
  });

  it("an UNFILLED committed 0 is NOT filled (no marker, value 0)", () => {
    const rd = PER_AREA_CDS.find((d) => d.col === "E")!;
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_by_area: { A1: 10 },
      rate_by_area: { A1: { combined_rate: 0 } } as never, // 0, no marker
    });
    expect(isRateFilled(row, rd, PER_AREA_CDS)).toBe(false);
    expect(isFullyPriced(row, PER_AREA_CDS)).toBe(false);
  });

  it("a prepopulated committed NON-ZERO rate counts as filled (no marker)", () => {
    const rd = PER_AREA_CDS.find((d) => d.col === "E")!;
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_by_area: { A1: 10 },
      rate_by_area: { A1: { combined_rate: 1120 } } as never, // a real tender rate, no marker
    });
    expect(isRateFilled(row, rd, PER_AREA_CDS)).toBe(true);
  });
});

describe("priceability -- the three flags", () => {
  it("needs_rate fires per-area (priced in A1, qty-bearing A2 unpriced -> fires for A2)", () => {
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_by_area: { A1: 10, A2: 4 },
      rate_by_area: { A1: { combined_rate: 5 }, A2: { combined_rate: 0 } } as never,
    });
    const f = computeRowFlags(row, PER_AREA_CDS, []);
    expect(f.needsRate).toBe(true);
    expect(f.needsRateAreas).toEqual(["A2"]);
  });

  it("needs_rate does NOT fire on a fully-priced row", () => {
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_by_area: { A1: 10 },
      rate_by_area: { A1: { combined_rate: 5 } } as never,
    });
    expect(computeRowFlags(row, PER_AREA_CDS, []).needsRate).toBe(false);
  });

  it("qty_anomaly fires on a NON-priceable row type carrying qty (and nowhere else)", () => {
    const anomaly = prow({
      row_index: 1, source_row_number: 11, node_type: "Other", qty_total: 5,
    });
    const clean = prow({
      row_index: 2, source_row_number: 12, node_type: "Line Item", qty_total: 5,
    });
    expect(computeRowFlags(anomaly, SCALAR_CDS, []).qtyAnomaly).toBe(true);
    expect(computeRowFlags(clean, SCALAR_CDS, []).qtyAnomaly).toBe(false);
  });

  it("not_yet fires when a formula needs a not-yet-entered rate (F4 surfaced)", () => {
    const formula: ColumnFormula = {
      target_value_field: "amount_total", target_value_key: null, target_rate_subkey: null,
      target_col: "F",
      formula: { ref: { value_field: "rate_combined", value_key: null, rate_subkey: null } },
    };
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_total: 10, // unfilled rate (no rate_combined / no marker)
    });
    const f = computeRowFlags(row, SCALAR_CDS, [formula]);
    expect(f.notYet).toBe(true);
    expect(f.notYetCols).toContain("F");
    expect(f.broken).toBe(false);
  });

  it("broken fires when a formula references a column that doesn't exist (dangling)", () => {
    const formula: ColumnFormula = {
      target_value_field: "amount_total", target_value_key: null, target_rate_subkey: null,
      target_col: "F",
      formula: { ref: { value_field: "rate_supply", value_key: null, rate_subkey: null } }, // no such col
    };
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_total: 10, rate_combined: 5,
    });
    const f = computeRowFlags(row, SCALAR_CDS, [formula]);
    expect(f.broken).toBe(true);
    expect(f.brokenCols).toContain("F");
  });
});

// FIX (cert): not_yet / broken are GATED behind the priceability spine (isPriceableLine +
// per-area qty-bearing, option-(i)), symmetric with needs_rate -- so a notes/header/non-
// priceable row never flags, and a no-qty area's amount cell is ignored on a priceable row.
describe("priceability -- not_yet/broken priceability gate (FIX)", () => {
  // The scalar amount = rate_combined formula (would evaluate not_yet when the rate is absent).
  const notYetFormula: ColumnFormula = {
    target_value_field: "amount_total", target_value_key: null, target_rate_subkey: null,
    target_col: "F",
    formula: { ref: { value_field: "rate_combined", value_key: null, rate_subkey: null } },
  };
  // A dangling-ref formula (would evaluate broken).
  const danglingFormula: ColumnFormula = {
    target_value_field: "amount_total", target_value_key: null, target_rate_subkey: null,
    target_col: "F",
    formula: { ref: { value_field: "rate_supply", value_key: null, rate_subkey: null } }, // no such col
  };

  it("the BUG REPRO: a NON-priceable row whose amount cell would evaluate blank does NOT flag", () => {
    // "Other" (non-priceable) with qty + a not-yet formula -> would-be not_yet, but the whole
    // loop is skipped (not a priceable line) -> notYet AND broken BOTH false.
    const note = prow({
      row_index: 1, source_row_number: 11, node_type: "Other", qty_total: 10,
    });
    const f = computeRowFlags(note, SCALAR_CDS, [notYetFormula]);
    expect(f.notYet).toBe(false);
    expect(f.broken).toBe(false);
  });

  it("broken does NOT fire on a NON-priceable row (gated out), but DOES on a priceable one", () => {
    const note = prow({
      row_index: 1, source_row_number: 11, node_type: "Other", qty_total: 10, rate_combined: 5,
    });
    const line = prow({
      row_index: 2, source_row_number: 12, node_type: "Line Item", qty_total: 10, rate_combined: 5,
    });
    expect(computeRowFlags(note, SCALAR_CDS, [danglingFormula]).broken).toBe(false); // gated out
    expect(computeRowFlags(line, SCALAR_CDS, [danglingFormula]).broken).toBe(true); // fires
  });

  it("option-(i): a priceable multi-area row flags A1's amount cell but IGNORES the no-qty A2", () => {
    // Area-wildcard default amount = qty x combined_rate. A1 is qty-bearing but unpriced
    // (rate absent) -> not_yet for A1's amount col F. A2 has NO qty -> its amount col I is
    // skipped by the option-(i) gate (never flagged).
    const perAreaFormula: ColumnFormula = {
      target_value_field: "amount_by_area", target_value_key: null, target_rate_subkey: "total",
      target_col: "F",
      formula: {
        op: "*",
        operands: [
          { ref: { value_field: "qty_by_area", value_key: null, rate_subkey: null } },
          { ref: { value_field: "rate_by_area", value_key: null, rate_subkey: "combined_rate" } },
        ],
      },
    };
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_by_area: { A1: 10 }, // A2 absent -> not qty-bearing
    });
    const f = computeRowFlags(row, PER_AREA_CDS, [perAreaFormula]);
    expect(f.notYetCols).toContain("F"); // A1's amount cell flags
    expect(f.notYetCols).not.toContain("I"); // A2 (no qty) is ignored -- option-(i)
  });

  it("no regression: a priceable qty-bearing row with no rate STILL flags not_yet", () => {
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item", qty_total: 10,
    });
    const f = computeRowFlags(row, SCALAR_CDS, [notYetFormula]);
    expect(f.notYet).toBe(true);
    expect(f.notYetCols).toContain("F");
  });
});

describe("priceability -- the priced N/M count", () => {
  it("M = priceable lines, N = fully priced (per-row, strict done-test)", () => {
    const rows = [
      // priceable + fully priced (N + M)
      prow({ row_index: 1, source_row_number: 11, node_type: "Line Item",
        qty_by_area: { A1: 10 }, rate_by_area: { A1: { combined_rate: 5 } } as never }),
      // priceable + half priced (M only)
      prow({ row_index: 2, source_row_number: 12, node_type: "Line Item",
        qty_by_area: { A1: 10, A2: 4 },
        rate_by_area: { A1: { combined_rate: 5 }, A2: { combined_rate: 0 } } as never }),
      // priceable type but zero-qty everywhere -> NOT in M
      prow({ row_index: 3, source_row_number: 13, node_type: "Preamble",
        qty_by_area: { A1: 0, A2: 0 } }),
      // non-priceable type -> NOT in M
      prow({ row_index: 4, source_row_number: 14, node_type: "Other", qty_by_area: { A1: 9 } }),
    ];
    expect(computePricedCount(rows, PER_AREA_CDS)).toEqual({ priced: 1, total: 2 });
  });

  it("empty / no-priceable sheet -> 0 of 0", () => {
    expect(computePricedCount([], PER_AREA_CDS)).toEqual({ priced: 0, total: 0 });
  });
});

describe("priceability -- isRowIncomplete (the incomplete-subtotal atom)", () => {
  it("a half-priced priceable row is incomplete", () => {
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_by_area: { A1: 10, A2: 4 },
      rate_by_area: { A1: { combined_rate: 5 }, A2: { combined_rate: 0 } } as never,
    });
    expect(isRowIncomplete(row, PER_AREA_CDS, [])).toBe(true);
  });

  it("a fully-priced clean row is NOT incomplete", () => {
    const row = prow({
      row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_by_area: { A1: 10 }, rate_by_area: { A1: { combined_rate: 5 } } as never,
    });
    expect(isRowIncomplete(row, PER_AREA_CDS, [])).toBe(false);
  });

  it("a zero-qty / non-priceable row is NEVER incomplete (the don't-flag case)", () => {
    const zeroQty = prow({ row_index: 1, source_row_number: 11, node_type: "Line Item",
      qty_by_area: { A1: 0, A2: 0 } });
    const note = prow({ row_index: 2, source_row_number: 12, node_type: "Other", qty_total: 0 });
    expect(isRowIncomplete(zeroQty, PER_AREA_CDS, [])).toBe(false);
    expect(isRowIncomplete(note, PER_AREA_CDS, [])).toBe(false);
  });
});

describe("priceability -- buildFlagEntries (the strip feed)", () => {
  it("emits one entry per row per active flag kind, carrying the Excel row + description", () => {
    const rows = [
      prow({ row_index: 1, source_row_number: 11, node_type: "Line Item", description: "needs",
        qty_by_area: { A1: 10, A2: 4 },
        rate_by_area: { A1: { combined_rate: 5 }, A2: { combined_rate: 0 } } as never }),
      prow({ row_index: 2, source_row_number: 12, node_type: "Other", description: "anomaly",
        qty_total: 9 }),
    ];
    const entries = buildFlagEntries(rows, PER_AREA_CDS, []);
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain("needs_rate"); // row 11 (A2 unpriced)
    expect(kinds).toContain("qty_anomaly"); // row 12 (Other + qty)
    expect(entries.find((e) => e.kind === "qty_anomaly")!.excelRow).toBe(12);
    expect(entries.find((e) => e.kind === "needs_rate")!.description).toBe("needs");
  });
});
