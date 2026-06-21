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
} from "./PricingGrid";
import type { ColumnDescriptor, PricedRow } from "./boqTypes";

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
