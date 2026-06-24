// Unit tests for the pure priced-marker helpers in PricingGrid (BoQ Phase 5 Slice 3a).
//
// These pin the marker-derivation logic: a rate cell is "priced" SOLELY from the overlay's
// priced_* markers, NEVER from a zero-check on the value (the load-bearing correctness rule
// -- a committed 0.0 rate can be a valid priced value). The JSX grid itself is manual-cert
// (no jsdom / @testing-library added); only these pure functions are unit-tested.
import { describe, it, expect } from "vitest";
import {
  isRateDescriptor,
  isCellPriced,
  isAmountDescriptor,
  findPairedRateDescriptor,
  findCorrespondingRateDescriptors,
  computeAmount,
  buildRateCell,
  nextCell,
  deriveSaveStatus,
  isTakeoverError,
  orderCommittedSheets,
  isGridOnlySheet,
  isPriceableType,
  colorClassForToken,
  swatchClassForToken,
  rowColorCells,
  remarkPreview,
  evaluateAmountCell,
  lookupOperandValue,
  validateFormulaRefs,
  groupDraftsByRow,
  pricingRowPropsAreEqual,
  isNonZeroNum,
  isRowQtyBearing,
  isRateEditableRow,
  shouldExitFullscreenOnEsc,
  parentExcelRowOf,
  isJumpFlashRow,
} from "./PricingGrid";
import type {
  AmountFormulaNode,
  AmountFormulaRef,
  ColumnDescriptor,
  ColumnFormula,
  PricedRow,
} from "./boqTypes";

function desc(
  value_field: string,
  value_key: string | null = null,
  rate_subkey: string | null = null,
  col = "X",
): ColumnDescriptor {
  return { col, role: "r", area: value_key, value_field, value_key, rate_subkey };
}

describe("isRateDescriptor", () => {
  it("is true for the per-area rate field and the three scalar rate fields", () => {
    expect(isRateDescriptor(desc("rate_by_area", "Phase 1", "combined_rate"))).toBe(true);
    expect(isRateDescriptor(desc("rate_supply"))).toBe(true);
    expect(isRateDescriptor(desc("rate_install"))).toBe(true);
    expect(isRateDescriptor(desc("rate_combined"))).toBe(true);
  });

  it("is false for qty / amount / identity descriptors", () => {
    expect(isRateDescriptor(desc("qty_by_area", "Phase 1"))).toBe(false);
    expect(isRateDescriptor(desc("amount_by_area", "Phase 1", "total"))).toBe(false);
    expect(isRateDescriptor(desc("amount_total"))).toBe(false);
    expect(isRateDescriptor(desc("sl_no_value"))).toBe(false);
  });
});

describe("isCellPriced", () => {
  it("per-area: true when the priced_by_area marker is set", () => {
    const row = {
      rate_by_area: { "Phase 1": { combined_rate: 150 } },
      priced_by_area: { "Phase 1": { combined_rate: true } },
    } as unknown as PricedRow;
    expect(isCellPriced(row, desc("rate_by_area", "Phase 1", "combined_rate"))).toBe(true);
  });

  it("per-area: false when no priced_by_area marker exists (un-priced)", () => {
    const row = { rate_by_area: { "Phase 1": { combined_rate: 150 } } } as unknown as PricedRow;
    expect(isCellPriced(row, desc("rate_by_area", "Phase 1", "combined_rate"))).toBe(false);
  });

  it("per-area: false when the area is marked but not this rate kind", () => {
    const row = {
      priced_by_area: { "Phase 1": { supply_rate: true } },
    } as unknown as PricedRow;
    expect(isCellPriced(row, desc("rate_by_area", "Phase 1", "combined_rate"))).toBe(false);
  });

  it("ZERO-RATE IS PRICED: a 0.0 rate with the marker set is priced (no zero-check)", () => {
    const row = {
      rate_by_area: { "Phase 1": { combined_rate: 0 } },
      priced_by_area: { "Phase 1": { combined_rate: true } },
    } as unknown as PricedRow;
    expect(isCellPriced(row, desc("rate_by_area", "Phase 1", "combined_rate"))).toBe(true);
  });

  it("scalar: true when priced_rate_combined is set; false when absent", () => {
    const priced = { priced_rate_combined: true } as unknown as PricedRow;
    const unpriced = {} as unknown as PricedRow;
    expect(isCellPriced(priced, desc("rate_combined"))).toBe(true);
    expect(isCellPriced(unpriced, desc("rate_combined"))).toBe(false);
  });

  it("non-rate descriptor is never priced (even if a stray marker exists)", () => {
    const row = {
      priced_by_area: { "Phase 1": { combined_rate: true } },
    } as unknown as PricedRow;
    expect(isCellPriced(row, desc("amount_by_area", "Phase 1", "total"))).toBe(false);
    expect(isCellPriced(row, desc("qty_by_area", "Phase 1"))).toBe(false);
  });
});

// ── Slice 3b helpers ──────────────────────────────────────────────────────────

describe("isAmountDescriptor", () => {
  it("is true for the per-area amount field and the scalar amount fields", () => {
    expect(isAmountDescriptor(desc("amount_by_area", "Phase 1", "total"))).toBe(true);
    expect(isAmountDescriptor(desc("amount_total"))).toBe(true);
    expect(isAmountDescriptor(desc("amount_supply"))).toBe(true);
    expect(isAmountDescriptor(desc("amount_install"))).toBe(true);
  });
  it("is false for rate / qty / identity descriptors", () => {
    expect(isAmountDescriptor(desc("rate_by_area", "Phase 1", "combined_rate"))).toBe(false);
    expect(isAmountDescriptor(desc("rate_combined"))).toBe(false);
    expect(isAmountDescriptor(desc("qty_by_area", "Phase 1"))).toBe(false);
    expect(isAmountDescriptor(desc("sl_no_value"))).toBe(false);
  });
});

describe("computeAmount", () => {
  it("returns qty x rate", () => {
    expect(computeAmount(10, 25)).toBe(250);
    expect(computeAmount(2.5, 4)).toBe(10);
  });
  it("a 0 rate yields 0 (a valid priced amount, not null)", () => {
    expect(computeAmount(220, 0)).toBe(0);
  });
  it("returns null when qty or rate is missing", () => {
    expect(computeAmount(null, 5)).toBeNull();
    expect(computeAmount(5, null)).toBeNull();
    expect(computeAmount(undefined, undefined)).toBeNull();
  });
});

describe("findPairedRateDescriptor", () => {
  it("pairs a per-area amount cell to its same-area rate cell by kind (total->combined_rate)", () => {
    const descriptors = [
      desc("rate_by_area", "Phase 1", "combined_rate", "E"),
      desc("amount_by_area", "Phase 1", "total", "F"),
      desc("rate_by_area", "Phase 2", "combined_rate", "H"),
    ];
    const amountD = descriptors[1];
    const paired = findPairedRateDescriptor(amountD, descriptors);
    expect(paired?.col).toBe("E"); // Phase 1 combined_rate -- NOT the Phase 2 rate
  });
  it("pairs a scalar amount field to its scalar rate field (amount_total->rate_combined)", () => {
    const descriptors = [desc("rate_combined", null, null, "D"), desc("amount_total", null, null, "G")];
    const paired = findPairedRateDescriptor(descriptors[1], descriptors);
    expect(paired?.col).toBe("D");
  });
  it("returns null when no matching rate column is mapped (different kind / absent)", () => {
    // amount_install Phase 2, but only a combined_rate Phase 2 rate exists -> no pairing.
    const descriptors = [
      desc("rate_by_area", "Phase 2", "combined_rate", "H"),
      desc("amount_by_area", "Phase 2", "install", "I"),
    ];
    expect(findPairedRateDescriptor(descriptors[1], descriptors)).toBeNull();
  });
});

describe("buildRateCell", () => {
  const row = {
    source_row_number: 34,
    description: "cable 1.1.2",
  } as unknown as PricedRow;

  it("per-area rate cell: area = value_key, rateKind = rate_subkey verbatim", () => {
    const cell = buildRateCell(row, desc("rate_by_area", "Phase 1", "combined_rate", "E"));
    expect(cell).toEqual({
      excelRow: 34,
      colLetter: "E",
      area: "Phase 1",
      rateKind: "combined_rate",
      description: "cable 1.1.2",
    });
  });

  it("scalar rate cell: area omitted, rateKind derived (rate_combined -> combined_rate)", () => {
    const cell = buildRateCell(row, desc("rate_combined", null, null, "D"));
    expect(cell.area).toBeUndefined();
    expect(cell.colLetter).toBe("D");
    expect(cell.rateKind).toBe("combined_rate");
    expect(cell.excelRow).toBe(34);
    expect(cell.description).toBe("cable 1.1.2");
  });
});

// ── Slice 3b.2: nextCell coordinate nav ─────────────────────────────────────────
// A 3-row x 4-col grid (rowCount=3, colCount=4); cells (0,0)..(2,3).
describe("nextCell", () => {
  const R = 3;
  const C = 4;

  it("arrows move one cell and STOP at each edge (no wrap)", () => {
    expect(nextCell({ rowIndex: 1, colIndex: 1 }, "up", R, C)).toEqual({ rowIndex: 0, colIndex: 1 });
    expect(nextCell({ rowIndex: 1, colIndex: 1 }, "down", R, C)).toEqual({ rowIndex: 2, colIndex: 1 });
    expect(nextCell({ rowIndex: 1, colIndex: 1 }, "left", R, C)).toEqual({ rowIndex: 1, colIndex: 0 });
    expect(nextCell({ rowIndex: 1, colIndex: 1 }, "right", R, C)).toEqual({ rowIndex: 1, colIndex: 2 });
    // edges -> null (no move, no wrap)
    expect(nextCell({ rowIndex: 0, colIndex: 1 }, "up", R, C)).toBeNull();
    expect(nextCell({ rowIndex: 2, colIndex: 1 }, "down", R, C)).toBeNull();
    expect(nextCell({ rowIndex: 1, colIndex: 0 }, "left", R, C)).toBeNull();
    expect(nextCell({ rowIndex: 1, colIndex: 3 }, "right", R, C)).toBeNull();
    // an arrow at the row edge does NOT wrap to the next/prev row
    expect(nextCell({ rowIndex: 0, colIndex: 3 }, "right", R, C)).toBeNull();
    expect(nextCell({ rowIndex: 1, colIndex: 0 }, "left", R, C)).toBeNull();
  });

  it("Tab moves right and WRAPS at a row's end to the next row's first cell", () => {
    expect(nextCell({ rowIndex: 0, colIndex: 1 }, "tab", R, C)).toEqual({ rowIndex: 0, colIndex: 2 });
    expect(nextCell({ rowIndex: 0, colIndex: 3 }, "tab", R, C)).toEqual({ rowIndex: 1, colIndex: 0 }); // wrap
    // Tab off the VERY LAST cell of the last row -> null (stop; contain focus)
    expect(nextCell({ rowIndex: 2, colIndex: 3 }, "tab", R, C)).toBeNull();
  });

  it("Shift-Tab moves left and WRAPS at a row's start to the previous row's last cell", () => {
    expect(nextCell({ rowIndex: 1, colIndex: 2 }, "shift-tab", R, C)).toEqual({ rowIndex: 1, colIndex: 1 });
    expect(nextCell({ rowIndex: 1, colIndex: 0 }, "shift-tab", R, C)).toEqual({ rowIndex: 0, colIndex: 3 }); // wrap
    // Shift-Tab off the VERY FIRST cell -> null (stop; contain focus)
    expect(nextCell({ rowIndex: 0, colIndex: 0 }, "shift-tab", R, C)).toBeNull();
  });

  it("Enter (mapped to 'down') moves down and stops at the bottom row", () => {
    expect(nextCell({ rowIndex: 0, colIndex: 2 }, "down", R, C)).toEqual({ rowIndex: 1, colIndex: 2 });
    expect(nextCell({ rowIndex: 2, colIndex: 2 }, "down", R, C)).toBeNull();
  });

  it("includes the trailing remarks column when colCount is +1 (Slice 4a.2)", () => {
    // 5 fixed anchors + 2 descriptors -> remarks is the LAST column at colIndex 7;
    // colCount = FIXED_ANCHOR_COUNT(5) + descriptors(2) + 1 = 8. Two rows (0,1).
    const RC = 8;
    // arrow-right from the last descriptor (col 6) lands ON the remarks cell (col 7)
    expect(nextCell({ rowIndex: 0, colIndex: 6 }, "right", 2, RC)).toEqual({ rowIndex: 0, colIndex: 7 });
    // arrow-left from remarks returns to the last descriptor
    expect(nextCell({ rowIndex: 0, colIndex: 7 }, "left", 2, RC)).toEqual({ rowIndex: 0, colIndex: 6 });
    // arrow-right off the remarks cell (the new right edge) STOPS (no wrap)
    expect(nextCell({ rowIndex: 0, colIndex: 7 }, "right", 2, RC)).toBeNull();
    // Tab off the remarks cell WRAPS to the next row's first cell
    expect(nextCell({ rowIndex: 0, colIndex: 7 }, "tab", 2, RC)).toEqual({ rowIndex: 1, colIndex: 0 });
    // Tab off the remarks cell of the LAST row STOPS (focus contained)
    expect(nextCell({ rowIndex: 1, colIndex: 7 }, "tab", 2, RC)).toBeNull();
  });
});

// ── Slice 3c: deriveSaveStatus (the save-status chip state) ──────────────────────
describe("deriveSaveStatus", () => {
  const base = { inFlight: 0, hasUnsaved: false, hasSaved: false, hasError: false };

  it("error wins over everything", () => {
    expect(deriveSaveStatus({ ...base, hasError: true, inFlight: 1, hasUnsaved: true })).toBe("failed");
  });
  it("in-flight (saving) wins over unsaved/saved when no error", () => {
    expect(deriveSaveStatus({ ...base, inFlight: 2, hasUnsaved: true, hasSaved: true })).toBe("saving");
  });
  it("unsaved drafts (not saving, no error) -> unsaved", () => {
    expect(deriveSaveStatus({ ...base, hasUnsaved: true, hasSaved: true })).toBe("unsaved");
  });
  it("a prior success with nothing pending -> saved", () => {
    expect(deriveSaveStatus({ ...base, hasSaved: true })).toBe("saved");
  });
  it("nothing happened yet -> idle", () => {
    expect(deriveSaveStatus(base)).toBe("idle");
  });
});

// ── Phase-2 prefill: findCorrespondingRateDescriptors (cross-area rate correspondence) ──
// Covers the real committed corpus shapes (recon-verified). The match key is:
// both value_field === "rate_by_area", SAME rate_subkey, DIFFERENT value_key; everything
// else (scalar, half-populated) returns [].
describe("findCorrespondingRateDescriptors", () => {
  // The full VRF 9-rate descriptor set (L1/L2 supply/install/combined per-area + N/O/P scalar).
  const vrf9 = (): ColumnDescriptor[] => [
    desc("rate_by_area", "L1", "supply_rate", "H"),
    desc("rate_by_area", "L1", "install_rate", "I"),
    desc("rate_by_area", "L1", "combined_rate", "J"),
    desc("rate_by_area", "L2", "supply_rate", "K"),
    desc("rate_by_area", "L2", "install_rate", "L"),
    desc("rate_by_area", "L2", "combined_rate", "M"),
    desc("rate_supply", null, null, "N"),
    desc("rate_install", null, null, "O"),
    desc("rate_combined", null, null, "P"),
  ];

  it("per-area symmetric 2-area combined (Electrical/HVAC/FF): Phase 1 -> Phase 2 only", () => {
    const ds = [
      desc("rate_by_area", "Phase 1", "combined_rate", "E"),
      desc("rate_by_area", "Phase 2", "combined_rate", "H"),
    ];
    expect(findCorrespondingRateDescriptors(ds[0], ds).map((d) => d.col)).toEqual(["H"]);
  });

  it("VRF triple subkey: L1 supply_rate -> L2 supply_rate ONLY (not install/combined/scalar)", () => {
    const ds = vrf9();
    const src = ds.find((d) => d.col === "H")!; // L1 supply_rate
    expect(findCorrespondingRateDescriptors(src, ds).map((d) => d.col)).toEqual(["K"]);
  });

  it("scalar source (low side rate_supply, area null) -> []", () => {
    const ds = [desc("rate_supply"), desc("rate_install")];
    expect(findCorrespondingRateDescriptors(ds[0], ds)).toEqual([]);
  });

  it("VRF scalar source (rate_combined, area null) -> [] (no per-area analog)", () => {
    const ds = vrf9();
    const src = ds.find((d) => d.col === "P")!; // scalar rate_combined
    expect(findCorrespondingRateDescriptors(src, ds)).toEqual([]);
  });

  it("half-populated source (rate_by_area, null rate_subkey) -> [] (fail-closed)", () => {
    const ds = [
      desc("rate_by_area", "Phase 1", null, "E"),
      desc("rate_by_area", "Phase 2", "combined_rate", "H"),
    ];
    expect(findCorrespondingRateDescriptors(ds[0], ds)).toEqual([]);
  });

  it("mixed VRF list: L1 combined (J) -> L2 combined (M) ONLY, never a scalar", () => {
    const ds = vrf9();
    const src = ds.find((d) => d.col === "J")!; // L1 combined_rate
    const got = findCorrespondingRateDescriptors(src, ds).map((d) => d.col);
    expect(got).toEqual(["M"]);
  });
});

describe("isTakeoverError", () => {
  it("is true for a message containing the BOQ_PRICING_LOCKED marker", () => {
    expect(
      isTakeoverError("BOQ_PRICING_LOCKED: This sheet is being priced by Asha. Reload to continue."),
    ).toBe(true);
  });

  it("is true for a ', '-joined multi-message string containing the marker", () => {
    // getFrappeError joins multiple _server_messages with ", " -- the marker still survives.
    expect(
      isTakeoverError("Sheet locked, BOQ_PRICING_LOCKED: being priced by Asha."),
    ).toBe(true);
  });

  it("is false for a generic save error", () => {
    expect(isTakeoverError("Could not save the rate. Please try again.")).toBe(false);
  });

  it("is false for an empty string", () => {
    expect(isTakeoverError("")).toBe(false);
  });
});

// ── Slice 3d: orderCommittedSheets (workbook tab order) ─────────────────────────
describe("orderCommittedSheets", () => {
  const s = (sheet_name: string, sheet_order: number | null) => ({ sheet_name, sheet_order });

  it("orders by sheet_order ascending (out-of-order input -> workbook order)", () => {
    const out = orderCommittedSheets([s("Sheet_X", 3), s("Sheet_Y", 1), s("Sheet_Z", 2)]);
    expect(out.map((x) => x.sheet_name)).toEqual(["Sheet_Y", "Sheet_Z", "Sheet_X"]);
    // sheet_order rides through unchanged (the tab strip reads it).
    expect(out.map((x) => x.sheet_order)).toEqual([1, 2, 3]);
  });

  it("sorts a null sheet_order LAST, tiebroken by name", () => {
    const out = orderCommittedSheets([s("B", null), s("A", null), s("C", 5)]);
    expect(out.map((x) => x.sheet_name)).toEqual(["C", "A", "B"]);
  });

  it("preserves the sheet_name VERBATIM (a trailing space is NOT trimmed, #152)", () => {
    // "Elec " (order 2) and "Elec" (order 1) are DISTINCT names; both round-trip verbatim.
    const out = orderCommittedSheets([s("Elec ", 2), s("Elec", 1)]);
    expect(out.map((x) => x.sheet_name)).toEqual(["Elec", "Elec "]);
    expect(out[1].sheet_name).toBe("Elec "); // trailing space intact
  });

  it("does not mutate the input array", () => {
    const input = [s("B", 2), s("A", 1)];
    const out = orderCommittedSheets(input);
    expect(input.map((x) => x.sheet_name)).toEqual(["B", "A"]); // original order untouched
    expect(out.map((x) => x.sheet_name)).toEqual(["A", "B"]);
  });
});

// ── General-specs faithful-grid view: isGridOnlySheet (disposition lookup) ──────
describe("isGridOnlySheet", () => {
  const list = [
    { sheet_name: "SOW", sheet_disposition: "grid_only" },
    { sheet_name: "Electrical", sheet_disposition: "grid_and_nodes" },
    { sheet_name: "Elec ", sheet_disposition: "grid_only" }, // trailing-space variant
  ];

  it("returns true for a grid_only sheet", () => {
    expect(isGridOnlySheet(list, "SOW")).toBe(true);
  });

  it("returns false for a grid_and_nodes data sheet", () => {
    expect(isGridOnlySheet(list, "Electrical")).toBe(false);
  });

  it("returns false when the sheet is not found (indeterminate window)", () => {
    expect(isGridOnlySheet(list, "Unknown")).toBe(false);
    expect(isGridOnlySheet([], "SOW")).toBe(false); // empty list (still loading)
  });

  it("matches sheet_name VERBATIM (#152 -- trailing space is significant)", () => {
    expect(isGridOnlySheet(list, "Elec ")).toBe(true); // trailing-space grid_only
    expect(isGridOnlySheet(list, "Elec")).toBe(false); // trimmed != stored -> not found
  });
});

// ── Slice 3e: priceability gate -- isPriceableType ──────────────────────────────
describe("isPriceableType", () => {
  it("is true for the priceable node types (VERBATIM)", () => {
    expect(isPriceableType("Preamble")).toBe(true);
    expect(isPriceableType("Line Item")).toBe(true);
  });

  it("is false for Other (non-priceable)", () => {
    expect(isPriceableType("Other")).toBe(false);
  });

  it("is false for null / undefined (absent node_type -> non-priceable)", () => {
    expect(isPriceableType(null)).toBe(false);
    expect(isPriceableType(undefined)).toBe(false);
  });

  it("is false for any unrecognized / mis-cased value (no fuzzy match)", () => {
    expect(isPriceableType("preamble")).toBe(false); // lowercase taxonomy != node_type axis
    expect(isPriceableType("line item")).toBe(false);
    expect(isPriceableType("note")).toBe(false);
    expect(isPriceableType("")).toBe(false);
  });
});

// ── Slice 4a: annotation helpers (color + remark) ───────────────────────────────
describe("colorClassForToken", () => {
  it("maps each of the 8 tokens to a distinct left-border class", () => {
    const tokens = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "grey"];
    const classes = tokens.map((t) => colorClassForToken(t));
    classes.forEach((c) => expect(c).toMatch(/^border-l-4 border-l-/));
    expect(new Set(classes).size).toBe(8); // all distinct
    expect(colorClassForToken("red")).toBe("border-l-4 border-l-red-500");
  });

  it("returns '' for an unknown / absent token (fail-safe)", () => {
    expect(colorClassForToken("teal")).toBe("");
    expect(colorClassForToken(null)).toBe("");
    expect(colorClassForToken(undefined)).toBe("");
    expect(colorClassForToken("")).toBe("");
  });
});

describe("swatchClassForToken", () => {
  it("maps a token to a solid bg swatch class; '' for unknown/absent", () => {
    expect(swatchClassForToken("blue")).toBe("bg-blue-500");
    expect(swatchClassForToken("grey")).toBe("bg-gray-400");
    expect(swatchClassForToken("nope")).toBe("");
    expect(swatchClassForToken(null)).toBe("");
    expect(swatchClassForToken(undefined)).toBe("");
  });
});

describe("rowColorCells", () => {
  it("returns every descriptor column's letter (the apply-to-row targets)", () => {
    const ds = [
      desc("rate_by_area", "Phase 1", "combined_rate", "E"),
      desc("amount_by_area", "Phase 1", "total", "F"),
      desc("rate_combined", null, null, "D"),
    ];
    expect(rowColorCells(ds)).toEqual(["E", "F", "D"]);
  });

  it("returns [] for an empty descriptor set", () => {
    expect(rowColorCells([])).toEqual([]);
  });
});

describe("remarkPreview", () => {
  it("returns '' for null / undefined / blank", () => {
    expect(remarkPreview(null)).toBe("");
    expect(remarkPreview(undefined)).toBe("");
    expect(remarkPreview("   ")).toBe("");
  });

  it("returns the trimmed text unchanged when within the cap", () => {
    expect(remarkPreview("  check qty  ")).toBe("check qty");
  });

  it("truncates with an ellipsis past the cap", () => {
    const out = remarkPreview("abcdefghij", 5);
    expect(out).toBe("abcd…");
    expect(out.length).toBe(5);
  });
});

// ── Formula Builder F4: the amount-cell compute swap (formula-wins-else-pairing) ──
//
// These pin the heart of F4: an amount column WITH a formula recomputes from the row's
// draft/saved values via F2 (killing the supply+install->single-total stale bug that
// findPairedRateDescriptor couldn't pair); a column with NO formula keeps the byte-for-byte
// pairing fallback; a formula that can't resolve renders BLANK (not_yet) or BLANK+marker
// (broken / cycle / dangling) -- NEVER a stale/wrong number. Plain value maps + cast rows
// stand in for the live grid (these helpers are pure).
function ref(value_field: string, value_key: string | null = null, rate_subkey: string | null = null): AmountFormulaRef {
  return { value_field, value_key, rate_subkey };
}
function leaf(r: AmountFormulaRef): AmountFormulaNode {
  return { ref: r };
}
function op(o: "+" | "*", ...operands: AmountFormulaNode[]): AmountFormulaNode {
  return { op: o, operands };
}
function cf(
  target_value_field: string,
  target_value_key: string | null,
  target_rate_subkey: string | null,
  formula: AmountFormulaNode | null,
): ColumnFormula {
  return { target_value_field, target_value_key, target_rate_subkey, target_col: null, formula };
}
function prow(p: Partial<PricedRow>): PricedRow {
  return { row_index: 1, source_row_number: 10, ...p } as unknown as PricedRow;
}

describe("parentExcelRowOf (parent click-to-jump resolver)", () => {
  // byIdx mirrors PricingGrid's row_index -> PricedRow map. Parent row_index 2 lives at Excel 30.
  const parent = { row_index: 2, source_row_number: 30 } as unknown as PricedRow;
  const byIdx = new Map<number, PricedRow>([[2, parent]]);

  it("a row with a valid parent resolves to the parent's source_row_number", () => {
    const child = { row_index: 5, source_row_number: 31, effective_parent_index: 2 } as unknown as PricedRow;
    expect(parentExcelRowOf(child, byIdx)).toBe(30);
  });

  it("a root row (effective_parent_index null) resolves to null (no jump target)", () => {
    const root = { row_index: 5, source_row_number: 31, effective_parent_index: null } as unknown as PricedRow;
    expect(parentExcelRowOf(root, byIdx)).toBeNull();
  });

  it("the -1 root sentinel also resolves to null", () => {
    const root = { row_index: 5, source_row_number: 31, effective_parent_index: -1 } as unknown as PricedRow;
    expect(parentExcelRowOf(root, byIdx)).toBeNull();
  });

  it("a parent index absent from byIdx resolves to null safely (no throw)", () => {
    const orphan = { row_index: 5, source_row_number: 31, effective_parent_index: 99 } as unknown as PricedRow;
    expect(parentExcelRowOf(orphan, byIdx)).toBeNull();
  });
});

describe("isJumpFlashRow (parent-jump landing flash predicate)", () => {
  it("the matching row is flashed (true)", () => {
    expect(isJumpFlashRow(30, 30)).toBe(true);
  });

  it("a null flash target -> no row flashed (false)", () => {
    expect(isJumpFlashRow(30, null)).toBe(false);
  });

  it("a non-matching row is not flashed (false)", () => {
    expect(isJumpFlashRow(30, 31)).toBe(false);
  });
});

describe("lookupOperandValue", () => {
  // descriptors: a scalar rate (col E) + a scalar qty.
  const rateE = desc("rate_supply", null, null, "E");
  const qtyD = desc("qty_total", null, null, "C");
  const cols = [rateE, qtyD, desc("amount_total", null, null, "G")];

  it("a RATE operand reads the optimistic DRAFT when editing", () => {
    const row = prow({ row_index: 1 });
    const v = lookupOperandValue(row, ref("rate_supply"), cols, { "1:E": "7.5" });
    expect(v).toBe(7.5);
  });
  it("a RATE operand reads the SAVED rate when priced + not editing", () => {
    const row = prow({ row_index: 1, rate_supply: 12, priced_rate_supply: true });
    expect(lookupOperandValue(row, ref("rate_supply"), cols, {})).toBe(12);
  });
  // Prepopulated-rate fix: an UNMARKED committed rate is usable when its committed value is
  // NON-ZERO (a real tender-doc rate, e.g. 1120 on Alorica/VRF); a committed 0 stays undefined.
  it("a NON-ZERO committed rate (no marker, not editing) is USABLE -> its value (THE FIX)", () => {
    const row = prow({ row_index: 1, rate_supply: 1120 }); // committed value present, NOT priced
    expect(lookupOperandValue(row, ref("rate_supply"), cols, {})).toBe(1120);
  });
  it("a committed 0.0 rate (no marker) stays undefined -> not_yet (genuine-free-0 blanks)", () => {
    const row = prow({ row_index: 1, rate_supply: 0 }); // committed 0, NOT priced
    expect(lookupOperandValue(row, ref("rate_supply"), cols, {})).toBeUndefined();
  });
  it("a DELIBERATELY-priced 0 (marker set) returns 0 -- distinct from a 0.0 unpriced rate", () => {
    const priced0 = prow({ row_index: 1, rate_supply: 0, priced_rate_supply: true });
    expect(lookupOperandValue(priced0, ref("rate_supply"), cols, {})).toBe(0);
  });
  it("a per-area NON-ZERO committed rate (no marker) is USABLE (the 166/VRF case)", () => {
    const areaCols = [desc("rate_by_area", "L1", "combined_rate", "H")];
    // value present in rate_by_area[L1].combined_rate, NO priced_by_area marker.
    const row = prow({
      row_index: 1,
      rate_by_area: { L1: { combined_rate: 158400 } } as unknown as PricedRow["rate_by_area"],
    });
    expect(lookupOperandValue(row, ref("rate_by_area", "L1", "combined_rate"), areaCols, {})).toBe(158400);
  });
  it("a draft (editing) still wins over the committed value (unchanged)", () => {
    const row = prow({ row_index: 1, rate_supply: 1120 });
    expect(lookupOperandValue(row, ref("rate_supply"), cols, { "1:E": "999" })).toBe(999);
  });
  it("a QTY operand reads its stored value; a real 0 stays 0 (NOT marker-gated -- scope guard)", () => {
    // The non-zero rate gate is RATE-ONLY: a committed qty of 0 still reads as 0, not undefined.
    expect(lookupOperandValue(prow({ qty_total: 9 }), ref("qty_total"), cols, {})).toBe(9);
    expect(lookupOperandValue(prow({ qty_total: 0 }), ref("qty_total"), cols, {})).toBe(0);
  });
  it("a missing key -> undefined (never 0-substituted)", () => {
    expect(lookupOperandValue(prow({}), ref("qty_total"), cols, {})).toBeUndefined();
  });
});

describe("validateFormulaRefs (dangling-ref gate)", () => {
  const cols = [desc("qty_total", null, null, "C"), desc("rate_supply", null, null, "E"), desc("amount_total", null, null, "G")];
  it("all refs match a descriptor -> valid", () => {
    const tree = op("*", leaf(ref("qty_total")), leaf(ref("rate_supply")));
    expect(validateFormulaRefs(tree, null, cols)).toBe(true);
  });
  it("a ref matching NO descriptor -> invalid (orphaned by a re-commit)", () => {
    const tree = op("*", leaf(ref("qty_total")), leaf(ref("rate_install"))); // rate_install absent
    expect(validateFormulaRefs(tree, null, cols)).toBe(false);
  });
  it("a wildcard ref binds to the area, then matches the per-area descriptor", () => {
    const areaCols = [desc("rate_by_area", "Phase 1", "combined_rate", "H")];
    const tree = leaf(ref("rate_by_area", null, "combined_rate")); // wildcard
    expect(validateFormulaRefs(tree, "Phase 1", areaCols)).toBe(true);
    expect(validateFormulaRefs(tree, "Phase 2", areaCols)).toBe(false); // no Phase 2 column
  });
});

describe("evaluateAmountCell -- formula wins", () => {
  // The BUG: separate supply + install rates, ONE total-amount column. findPairedRateDescriptor
  // can't pair it (returns null -> stale). A formula amount_total = qty x (supply + install)
  // fixes it -> recompute live from the DRAFT rates.
  const qtyD = desc("qty_total", null, null, "C");
  const supD = desc("rate_supply", null, null, "E");
  const insD = desc("rate_install", null, null, "F");
  const amtD = desc("amount_total", null, null, "G");
  const cols = [qtyD, supD, insD, amtD];
  const formula = cf("amount_total", null, null, op("*", leaf(ref("qty_total")), op("+", leaf(ref("rate_supply")), leaf(ref("rate_install")))));

  it("THE BUG FIX: recomputes from draft rates (qty x (supply + install))", () => {
    const row = prow({ row_index: 1, qty_total: 10 });
    const drafts = { "1:E": "3", "1:F": "4" };
    expect(evaluateAmountCell(amtD, row, cols, [formula], drafts)).toEqual({ kind: "value", value: 70 }); // 10*(3+4)
  });

  it("a single draft updates live; the other rate from its SAVED priced value", () => {
    const row = prow({ row_index: 1, qty_total: 2, rate_install: 4, priced_rate_install: true });
    const drafts = { "1:E": "3" }; // editing supply; install is saved+priced
    expect(evaluateAmountCell(amtD, row, cols, [formula], drafts)).toEqual({ kind: "value", value: 14 }); // 2*(3+4)
  });

  it("a missing rate operand -> BLANK not_yet (never a partial / stale number)", () => {
    const row = prow({ row_index: 1, qty_total: 10 });
    const drafts = { "1:E": "3" }; // install absent + un-priced
    expect(evaluateAmountCell(amtD, row, cols, [formula], drafts)).toEqual({ kind: "blank", reason: "not_yet" });
  });

  it("a real 0 operand computes (0), it is NOT blanked", () => {
    const row = prow({ row_index: 1, qty_total: 0 });
    const drafts = { "1:E": "3", "1:F": "4" };
    expect(evaluateAmountCell(amtD, row, cols, [formula], drafts)).toEqual({ kind: "value", value: 0 }); // 0*(3+4)
  });

  it("a CYCLE (self-referential formula) -> BLANK broken", () => {
    const cyc = cf("amount_total", null, null, leaf(ref("amount_total")));
    const row = prow({ row_index: 1, qty_total: 5 });
    expect(evaluateAmountCell(amtD, row, cols, [cyc], {})).toEqual({ kind: "blank", reason: "broken" });
  });

  it("a DANGLING ref (formula uses a column not on the sheet) -> BLANK broken", () => {
    // rate_install is in the formula but NOT in cols (orphaned by a re-commit).
    const colsNoInstall = [qtyD, supD, amtD];
    const row = prow({ row_index: 1, qty_total: 10 });
    expect(evaluateAmountCell(amtD, row, colsNoInstall, [formula], { "1:E": "3" })).toEqual({ kind: "blank", reason: "broken" });
  });

  it("PREPOPULATED-RATE FIX e2e: non-zero committed rates (no marker, no draft) now COMPUTE", () => {
    // The 150/166 bug: rates present from the tender doc (no priced marker, never edited).
    // Previously every operand read undefined -> the cell blanked. Now it computes.
    const row = prow({ row_index: 1, qty_total: 10, rate_supply: 880, rate_install: 240 });
    expect(evaluateAmountCell(amtD, row, cols, [formula], {})).toEqual({ kind: "value", value: 11200 }); // 10*(880+240)
  });

  it("PREPOPULATED-RATE e2e: a 0.0 unpriced rate still BLANKS (needs a rate)", () => {
    // qty + supply prepopulated, but install is a committed 0.0 (unfilled) -> not_yet.
    const row = prow({ row_index: 1, qty_total: 10, rate_supply: 880, rate_install: 0 });
    expect(evaluateAmountCell(amtD, row, cols, [formula], {})).toEqual({ kind: "blank", reason: "not_yet" });
  });
});

describe("evaluateAmountCell -- no formula falls back to the pairing (UNCHANGED)", () => {
  // amount_total pairs to rate_combined (the SCALAR_AMOUNT_TO_RATE_FIELD map).
  const qtyD = desc("qty_total", null, null, "C");
  const cmbD = desc("rate_combined", null, null, "D");
  const amtD = desc("amount_total", null, null, "G");
  const cols = [qtyD, cmbD, amtD];

  it("computes qty x paired-rate from the draft (the old live path)", () => {
    const row = prow({ row_index: 1, qty_total: 5 });
    expect(evaluateAmountCell(amtD, row, cols, [], { "1:D": "10" })).toEqual({ kind: "value", value: 50 });
  });

  it("computes from the SAVED paired rate when priced + not editing", () => {
    const row = prow({ row_index: 1, qty_total: 4, rate_combined: 25, priced_rate_combined: true });
    expect(evaluateAmountCell(amtD, row, cols, [], {})).toEqual({ kind: "value", value: 100 });
  });

  it("un-priced + not editing -> the committed value (no stale recompute)", () => {
    const row = prow({ row_index: 1, qty_total: 4, rate_combined: 0 }); // not priced
    expect(evaluateAmountCell(amtD, row, cols, [], {})).toEqual({ kind: "committed" });
  });

  it("an amount column with no paired rate at all -> committed", () => {
    const row = prow({ row_index: 1, qty_total: 4 });
    expect(evaluateAmountCell(amtD, row, [qtyD, amtD], [], {})).toEqual({ kind: "committed" });
  });

  it("a per-area override wins over a default for its area", () => {
    // default total = qty x supply; override Phase 1 total = qty x install. cols for Phase 1.
    const qty1 = desc("qty_by_area", "Phase 1", null, "C");
    const sup1 = desc("rate_by_area", "Phase 1", "supply_rate", "E");
    const ins1 = desc("rate_by_area", "Phase 1", "install_rate", "F");
    const amt1 = desc("amount_by_area", "Phase 1", "total", "G");
    const cols = [qty1, sup1, ins1, amt1];
    const def = cf("amount_by_area", null, "total", op("*", leaf(ref("qty_by_area")), leaf(ref("rate_by_area", null, "supply_rate"))));
    const ovr = cf("amount_by_area", "Phase 1", "total", op("*", leaf(ref("qty_by_area", "Phase 1")), leaf(ref("rate_by_area", "Phase 1", "install_rate"))));
    const row = prow({ row_index: 1, qty_by_area: { "Phase 1": 3 } as Record<string, number> });
    // editing supply (E=5) + install (F=10); override uses install -> 3*10 = 30 (not the default's 3*5).
    expect(evaluateAmountCell(amt1, row, cols, [def, ovr], { "1:E": "5", "1:F": "10" })).toEqual({ kind: "value", value: 30 });
  });
});

// ── Editor perf fix: PricingGrid row-level memoization (recon items 1+2) ─────────
//
// These are the MEMO-WORKS proof. The grid environment is `node` (no jsdom / RTL), so the row
// re-render behaviour is proven via the two PURE surfaces the memoization rests on:
//   (1) groupDraftsByRow -- the load-bearing anti-defeat slicer: a memoized row receives only
//       its own draft slice, and an UNRELATED row's slice keeps a STABLE reference across a
//       keystroke (so a keystroke in row X never re-renders row Y);
//   (2) pricingRowPropsAreEqual -- the React.memo comparator: it SKIPS a re-render iff every
//       prop is unchanged (so a cursor move re-renders only the 2 active-flipped rows) and
//       RE-renders when this row's own data/active-state changes (so memoization never goes
//       stale -- the correctness side).

describe("groupDraftsByRow (per-row draft slicing + reference reuse)", () => {
  it("groups a flat `${rowIndex}:${col}` map into per-row sub-maps with FULL keys kept", () => {
    const drafts = { "5:E": "3", "5:F": "4", "7:E": "9" };
    const out = groupDraftsByRow(drafts, new Map());
    expect(out.get(5)).toEqual({ "5:E": "3", "5:F": "4" });
    expect(out.get(7)).toEqual({ "7:E": "9" });
    expect(out.size).toBe(2);
  });

  it("a row with no drafts is simply absent (the grid maps absent -> the shared EMPTY_SLICE)", () => {
    const out = groupDraftsByRow({ "5:E": "3" }, new Map());
    expect(out.has(7)).toBe(false);
  });

  it("THE ANTI-DEFEAT RULE: a keystroke in row 5 does NOT change row 7's slice reference", () => {
    const first = groupDraftsByRow({ "5:E": "3", "7:E": "9" }, new Map());
    const row7a = first.get(7);
    // Simulate a keystroke in row 5 (a NEW drafts object, row 5 changed, row 7 untouched).
    const second = groupDraftsByRow({ "5:E": "3.1", "7:E": "9" }, first);
    expect(second.get(7)).toBe(row7a); // row 7's slice reference is REUSED (memo holds for it)
    expect(second.get(5)).not.toBe(first.get(5)); // row 5's slice changed (it re-renders)
    expect(second.get(5)).toEqual({ "5:E": "3.1" });
  });

  it("an UNCHANGED row keeps its slice reference even when another row changes", () => {
    const first = groupDraftsByRow({ "5:E": "3", "7:E": "9" }, new Map());
    const row5a = first.get(5);
    // row 7 changes this time; row 5 must keep its reference.
    const second = groupDraftsByRow({ "5:E": "3", "7:E": "9.5" }, first);
    expect(second.get(5)).toBe(row5a);
    expect(second.get(7)).not.toBe(first.get(7));
  });

  it("ignores a malformed (no-colon) key without throwing", () => {
    const out = groupDraftsByRow({ bogus: "x", "5:E": "3" }, new Map());
    expect(out.has(5)).toBe(true);
    expect(out.size).toBe(1);
  });
});

describe("pricingRowPropsAreEqual (React.memo comparator)", () => {
  type RowProps = Parameters<typeof pricingRowPropsAreEqual>[0];

  // A base props object with every field a STABLE reference. A `next` built by spreading this
  // keeps all references identical except the one field a test overrides -- exactly the
  // single-field-change scenarios the memo must discriminate.
  function baseProps(): RowProps {
    const noop = () => {};
    return {
      row: { row_index: 5, source_row_number: 50 } as unknown as PricedRow,
      rowIndex: 0,
      depth: 0,
      parentExcelRow: null,
      flags: undefined,
      rowDraftRates: {},
      rowProposedRates: {},
      activeColIndex: null,
      anyCellActive: false,
      openRemark: false,
      displayDescriptors: [],
      columnDescriptors: [],
      columnFormulas: [],
      override: false,
      formulasComplete: true,
      onSaveRate: undefined,
      onSaveColor: undefined,
      onSaveRemark: undefined,
      colCount: 6,
      rowCount: 1,
      remarksColIndex: 5,
      commitRate: noop,
      scheduleAutoSave: noop,
      onCellFocus: noop,
      registerCell: noop,
      focusCell: noop,
      setDraftRates: noop,
      setProposedRates: noop,
      setOpenRemark: noop,
    } as unknown as RowProps;
  }

  it("SKIPS (returns true) when every prop reference is unchanged -- the cursor-move win for an unrelated row", () => {
    const prev = baseProps();
    // An unrelated row's draft changed elsewhere -> THIS row's props are all identical.
    expect(pricingRowPropsAreEqual(prev, { ...prev })).toBe(true);
  });

  it("RE-renders (false) when THIS row's activeColIndex changes (it gained/lost the cursor)", () => {
    const prev = baseProps();
    expect(pricingRowPropsAreEqual(prev, { ...prev, activeColIndex: 3 })).toBe(false);
    // and the inverse: a row losing the cursor (3 -> null) also re-renders
    const active = { ...prev, activeColIndex: 3 };
    expect(pricingRowPropsAreEqual(active, { ...active, activeColIndex: null })).toBe(false);
  });

  it("RE-renders (false) when THIS row's draft slice reference changes (a keystroke in this row)", () => {
    const prev = baseProps();
    expect(pricingRowPropsAreEqual(prev, { ...prev, rowDraftRates: { "5:E": "1" } })).toBe(false);
  });

  it("RE-renders (false) when this row's flags / row / color data changes (no staleness after a save->mutate)", () => {
    const prev = baseProps();
    expect(
      pricingRowPropsAreEqual(prev, { ...prev, flags: { needsRate: true } as unknown as RowProps["flags"] }),
    ).toBe(false);
    expect(
      pricingRowPropsAreEqual(prev, { ...prev, row: { row_index: 5 } as unknown as PricedRow }),
    ).toBe(false);
    expect(pricingRowPropsAreEqual(prev, { ...prev, rowProposedRates: { "5:E": "1" } })).toBe(false);
  });

  it("RE-renders (false) when the open-remark / override / proposal state of this row changes", () => {
    const prev = baseProps();
    expect(pricingRowPropsAreEqual(prev, { ...prev, openRemark: true })).toBe(false);
    expect(pricingRowPropsAreEqual(prev, { ...prev, override: true })).toBe(false);
    expect(pricingRowPropsAreEqual(prev, { ...prev, anyCellActive: true })).toBe(false);
  });

  it("RE-renders (false) when formulasComplete flips (the gate locked/unlocked the sheet)", () => {
    const prev = baseProps(); // formulasComplete: true
    expect(pricingRowPropsAreEqual(prev, { ...prev, formulasComplete: false })).toBe(false);
    // unchanged -> still skips (the per-sheet boolean is identical for an unrelated re-render)
    expect(pricingRowPropsAreEqual(prev, { ...prev })).toBe(true);
  });

  it("RE-renders (false) when a shared callback / descriptor reference changes (a page re-render handed fresh ones)", () => {
    const prev = baseProps();
    expect(pricingRowPropsAreEqual(prev, { ...prev, commitRate: () => {} })).toBe(false);
    expect(pricingRowPropsAreEqual(prev, { ...prev, displayDescriptors: [] })).toBe(false);
    expect(pricingRowPropsAreEqual(prev, { ...prev, columnFormulas: [] })).toBe(false);
  });
});

// ── Preamble-only qty-bearing rate-edit gate (the asymmetric, owner-locked rule) ──
//
// A rate cell is editable iff: override OR Line Item (always) OR a qty-bearing Preamble. A
// zero-qty Preamble is read-only; a zero-qty Line Item stays editable (rate-only). The
// qty-bearing predicate is "qty ANYWHERE" (Definition A) -- scalar qty_total OR any per-area
// qty -- DELIBERATELY looser than priceability.isPriceableLine (which restricts to a
// rate-column area); the two answer different questions and are NOT to be aligned.

describe("isNonZeroNum (the qty-bearing leaf -- self-contained in PricingGrid)", () => {
  it("is true ONLY for a finite non-zero number (a negative qty counts)", () => {
    expect(isNonZeroNum(5)).toBe(true);
    expect(isNonZeroNum(-3)).toBe(true);
    expect(isNonZeroNum(0.0001)).toBe(true);
  });
  it("is false for 0, null, undefined, '', a '0' string, NaN, Infinity", () => {
    expect(isNonZeroNum(0)).toBe(false);
    expect(isNonZeroNum(null)).toBe(false);
    expect(isNonZeroNum(undefined)).toBe(false);
    expect(isNonZeroNum("")).toBe(false);
    expect(isNonZeroNum("0")).toBe(false); // a numeric string is NOT a number -> not qty-bearing
    expect(isNonZeroNum("5")).toBe(false);
    expect(isNonZeroNum(NaN)).toBe(false);
    expect(isNonZeroNum(Infinity)).toBe(false);
  });
});

describe("isRowQtyBearing (qty ANYWHERE: qty_total OR any qty_by_area)", () => {
  it("true when the scalar qty_total is non-zero (even with no area qty)", () => {
    expect(isRowQtyBearing(prow({ qty_total: 220, qty_by_area: null }))).toBe(true);
  });
  it("true when ANY per-area qty is non-zero (even if qty_total is 0/null)", () => {
    expect(isRowQtyBearing(prow({ qty_total: 0, qty_by_area: { "Phase 1": 0, "Phase 2": 4 } }))).toBe(true);
    expect(isRowQtyBearing(prow({ qty_total: null, qty_by_area: { L1: 158400 } }))).toBe(true);
  });
  it("true for a NEGATIVE qty (a real, non-zero quantity)", () => {
    expect(isRowQtyBearing(prow({ qty_total: -2, qty_by_area: null }))).toBe(true);
  });
  it("FALSE when qty_total is 0/null AND every area qty is 0", () => {
    expect(isRowQtyBearing(prow({ qty_total: 0, qty_by_area: { "Phase 1": 0, "Phase 2": 0 } }))).toBe(false);
    expect(isRowQtyBearing(prow({ qty_total: null, qty_by_area: {} }))).toBe(false);
    expect(isRowQtyBearing(prow({ qty_total: 0, qty_by_area: null }))).toBe(false);
  });
});

describe("isRateEditableRow (the asymmetric Preamble/Line-Item gate)", () => {
  it("PREAMBLE zero-qty -> NOT editable (the new lock)", () => {
    expect(isRateEditableRow(prow({ node_type: "Preamble", qty_total: 0, qty_by_area: null }), false)).toBe(false);
    expect(
      isRateEditableRow(prow({ node_type: "Preamble", qty_total: 0, qty_by_area: { A: 0 } }), false),
    ).toBe(false);
  });
  it("PREAMBLE with qty -> editable", () => {
    expect(isRateEditableRow(prow({ node_type: "Preamble", qty_total: 5, qty_by_area: null }), false)).toBe(true);
    expect(
      isRateEditableRow(prow({ node_type: "Preamble", qty_total: 0, qty_by_area: { A: 3 } }), false),
    ).toBe(true);
  });
  it("LINE ITEM is ALWAYS editable -- a zero-qty Line Item is a valid rate-only line", () => {
    expect(isRateEditableRow(prow({ node_type: "Line Item", qty_total: 0, qty_by_area: null }), false)).toBe(true);
    expect(isRateEditableRow(prow({ node_type: "Line Item", qty_total: 220, qty_by_area: { "Phase 1": 220 } }), false)).toBe(true);
  });
  it("a NON-priceable type (Other) -> NOT editable", () => {
    expect(isRateEditableRow(prow({ node_type: "Other", qty_total: 99, qty_by_area: null }), false)).toBe(false);
  });
  it("a null/undefined node_type -> NOT editable (old/absent payload)", () => {
    expect(isRateEditableRow(prow({ node_type: null, qty_total: 5, qty_by_area: null }), false)).toBe(false);
    expect(isRateEditableRow(prow({ qty_total: 5 }), false)).toBe(false); // node_type undefined
  });
  it("OVERRIDE unlocks EVERYTHING (zero-qty Preamble, Other, null type)", () => {
    expect(isRateEditableRow(prow({ node_type: "Preamble", qty_total: 0, qty_by_area: null }), true)).toBe(true);
    expect(isRateEditableRow(prow({ node_type: "Other", qty_total: 0, qty_by_area: null }), true)).toBe(true);
    expect(isRateEditableRow(prow({ node_type: null, qty_total: 0, qty_by_area: null }), true)).toBe(true);
  });
});

// ── The MANDATORY formula gate composition (override can NOT bypass it) ────────────
// The grid's rate-cell render gate is `onSaveRate && formulasComplete && isRateDescriptor(d) &&
// isRateEditableRow(row, override)`. formulasComplete is a SEPARATE AND-term BEFORE
// isRateEditableRow; the override lives INSIDE isRateEditableRow, so it can NEVER reach past
// formulasComplete. The render isn't unit-testable in the node env, so this proves the boolean
// composition directly -- the load-bearing override-can't-bypass property.
describe("the mandatory formula gate composition (override cannot bypass)", () => {
  // The (formulasComplete-aware) editability term, mirroring the grid's render condition with the
  // descriptor/onSaveRate terms factored out (both already covered by other tests).
  const rateEditable = (row: PricedRow, override: boolean, formulasComplete: boolean) =>
    formulasComplete && isRateEditableRow(row, override);

  it("formulasComplete=false => NOT editable EVEN with override=true (any row type)", () => {
    const lineItem = prow({ node_type: "Line Item", qty_total: 220, qty_by_area: null });
    const other = prow({ node_type: "Other", qty_total: 99, qty_by_area: null });
    // override true would unlock the type/qty axis -- but formulasComplete=false gates it OUT.
    expect(rateEditable(lineItem, true, false)).toBe(false);
    expect(rateEditable(other, true, false)).toBe(false);
    expect(rateEditable(lineItem, false, false)).toBe(false);
  });

  it("formulasComplete=true => the asymmetric rules apply unchanged", () => {
    const lineItem = prow({ node_type: "Line Item", qty_total: 0, qty_by_area: null });
    const zeroPreamble = prow({ node_type: "Preamble", qty_total: 0, qty_by_area: null });
    expect(rateEditable(lineItem, false, true)).toBe(true); // Line Item always editable
    expect(rateEditable(zeroPreamble, false, true)).toBe(false); // zero-qty Preamble locked
    expect(rateEditable(zeroPreamble, true, true)).toBe(true); // override unlocks it (gate open)
  });
});

// ── Slice 4c: full-screen Esc-to-exit predicate ────────────────────────────────
describe("shouldExitFullscreenOnEsc", () => {
  // A minimal stand-in for an active element (only tagName is read).
  const el = (tag: string): Element => ({ tagName: tag }) as unknown as Element;

  it("Escape + not-defaultPrevented + non-input focus => exit", () => {
    expect(shouldExitFullscreenOnEsc({ key: "Escape", defaultPrevented: false }, null)).toBe(true);
    expect(shouldExitFullscreenOnEsc({ key: "Escape", defaultPrevented: false }, el("DIV"))).toBe(true);
    expect(shouldExitFullscreenOnEsc({ key: "Escape", defaultPrevented: false }, el("BUTTON"))).toBe(true);
  });

  it("defaultPrevented (a popover already handled the Esc) => no exit", () => {
    expect(shouldExitFullscreenOnEsc({ key: "Escape", defaultPrevented: true }, null)).toBe(false);
  });

  it("focus in an <input> / <textarea> (mid-edit) => no exit", () => {
    expect(shouldExitFullscreenOnEsc({ key: "Escape", defaultPrevented: false }, el("INPUT"))).toBe(false);
    expect(shouldExitFullscreenOnEsc({ key: "Escape", defaultPrevented: false }, el("TEXTAREA"))).toBe(false);
  });

  it("a non-Escape key => no exit (the listener ignores everything else)", () => {
    expect(shouldExitFullscreenOnEsc({ key: "Enter", defaultPrevented: false }, null)).toBe(false);
    expect(shouldExitFullscreenOnEsc({ key: "ArrowDown", defaultPrevented: false }, null)).toBe(false);
    expect(shouldExitFullscreenOnEsc({ key: "Escape ", defaultPrevented: false }, null)).toBe(false);
  });
});
