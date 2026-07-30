import { describe, it, expect } from "vitest";
import type { ColumnDescriptor, PricedRow, SheetCategoryRow } from "../boqTypes";
import {
  buildRowContext,
  buildSuggestions,
  markSuggestionUsed,
  rateKindOfDescriptor,
  rateKindsOf,
} from "./rateSuggestionModel";
import { rowSuggestionsEqual, type HelperResult, type RateHelper, type RowSuggestions } from "./rateHelperTypes";

// A mock "real" helper (the stub is gone): earthing/hvac_ducting price supply+install;
// wiring_cabling is supply-only; anything else declines.
const mockHelper: RateHelper = {
  id: "pricing_sheet",
  label: "Pricing sheet",
  compute: (c): HelperResult => {
    const tables: Record<string, string[]> = {
      earthing: ["supply_rate", "install_rate"],
      hvac_ducting: ["supply_rate", "install_rate"],
      wiring_cabling: ["supply_rate"],
    };
    const kinds = c.category ? tables[c.category] : undefined;
    if (!kinds) return { kind: "none", reason: "no table" };
    const values: Record<string, number> = {};
    for (const k of kinds) values[k] = 100;
    return {
      kind: "suggestion", values, basis: "b",
      workings: { attributes: [], matchedRows: [], derivation: [], finalValues: { ...values } },
    };
  },
};
const HELPERS = [mockHelper];

const supplyDesc = {
  col: "E",
  role: "rate_supply_by_area",
  area: "Phase 1",
  value_field: "rate_by_area",
  value_key: "Phase 1",
  rate_subkey: "supply_rate",
} as ColumnDescriptor;
const installDesc = {
  col: "G",
  role: "rate_install_by_area",
  area: "Phase 1",
  value_field: "rate_by_area",
  value_key: "Phase 1",
  rate_subkey: "install_rate",
} as ColumnDescriptor;
const amountDesc = {
  col: "F",
  role: "amount_supply_by_area",
  area: "Phase 1",
  value_field: "amount_by_area",
  value_key: "Phase 1",
  rate_subkey: "supply",
} as ColumnDescriptor;
const scalarSupply = {
  col: "E",
  role: "rate_supply",
  area: null,
  value_field: "rate_supply",
  value_key: null,
  rate_subkey: null,
} as ColumnDescriptor;

function row(excelRow: number, nodeType: string): PricedRow {
  return {
    row_index: excelRow,
    source_row_number: excelRow,
    description: `row ${excelRow}`,
    node_type: nodeType,
  } as unknown as PricedRow;
}
function cat(id: string): SheetCategoryRow {
  return { effective_category_id: id } as SheetCategoryRow;
}

describe("rateKindOfDescriptor / rateKindsOf", () => {
  it("reads the per-area kind from rate_subkey and maps scalar fields", () => {
    expect(rateKindOfDescriptor(supplyDesc)).toBe("supply_rate");
    expect(rateKindOfDescriptor(installDesc)).toBe("install_rate");
    expect(rateKindOfDescriptor(scalarSupply)).toBe("supply_rate");
    expect(rateKindOfDescriptor(amountDesc)).toBeNull(); // not a rate descriptor
  });
  it("dedupes kinds across descriptors", () => {
    expect(rateKindsOf([supplyDesc, installDesc, supplyDesc])).toEqual([
      "supply_rate",
      "install_rate",
    ]);
  });
});

describe("buildRowContext", () => {
  it("carries the durable excel_row + resolved category; blank category -> null", () => {
    const c = buildRowContext(row(7, "Line Item"), ["supply_rate"], cat("earthing"));
    expect(c.excelRow).toBe(7);
    expect(c.category).toBe("earthing");
    expect(buildRowContext(row(7, "Line Item"), [], cat("")).category).toBeNull();
  });
});

describe("buildSuggestions", () => {
  const descriptors = [supplyDesc, installDesc, amountDesc];

  it("badges ONLY rate-editable rows the stub suggests for, per kind", () => {
    const rows = [row(7, "Line Item"), row(8, "Line Item"), row(9, "Other")];
    const categories = new Map<number, SheetCategoryRow>([
      [7, cat("earthing")], // both supply + install
      [8, cat("panels")], // no table -> no badge
      [9, cat("earthing")], // Other -> not rate-editable
    ]);
    const map = buildSuggestions(rows, descriptors, false, categories, HELPERS);
    expect([...map.keys()]).toEqual([7]);
    expect(map.get(7)!.byCol).toEqual({
      E: { count: 1, used: false },
      G: { count: 1, used: false },
    });
  });

  it("supply-only category badges only the supply cell (per-kind independence)", () => {
    const rows = [row(11, "Line Item")];
    const categories = new Map<number, SheetCategoryRow>([[11, cat("wiring_cabling")]]);
    const map = buildSuggestions(rows, descriptors, false, categories, HELPERS);
    expect(Object.keys(map.get(11)!.byCol)).toEqual(["E"]); // no install badge
  });

  it("a never-classified row (absent from the category map) gets no badge", () => {
    const map = buildSuggestions([row(12, "Line Item")], descriptors, false, new Map(), HELPERS);
    expect(map.has(12)).toBe(false);
  });
});

describe("markSuggestionUsed (memo-shield friendly)", () => {
  it("flips the one cell to used, preserves the count, and keeps OTHER entries' identity", () => {
    const base = buildSuggestions(
      [row(7, "Line Item"), row(8, "Line Item")],
      [supplyDesc, installDesc, amountDesc],
      false,
      new Map<number, SheetCategoryRow>([
        [7, cat("earthing")],
        [8, cat("hvac_ducting")],
      ]),
      HELPERS,
    );
    const entry8Before = base.get(8);
    const next = markSuggestionUsed(base, 7, "E");
    expect(next).not.toBe(base); // new Map
    expect(next.get(7)!.byCol.E).toEqual({ count: 1, used: true });
    expect(next.get(7)!.byCol.G).toEqual({ count: 1, used: false }); // untouched cell
    expect(next.get(8)).toBe(entry8Before); // other row's entry keeps its reference
  });

  it("is a no-op (same Map) when the cell is absent or already used", () => {
    const base = buildSuggestions(
      [row(7, "Line Item")],
      [supplyDesc],
      false,
      new Map([[7, cat("earthing")]]),
      HELPERS,
    );
    expect(markSuggestionUsed(base, 7, "Z")).toBe(base); // no such col
    const used = markSuggestionUsed(base, 7, "E");
    expect(markSuggestionUsed(used, 7, "E")).toBe(used); // already used
  });
});

describe("rowSuggestionsEqual", () => {
  const a: RowSuggestions = { byCol: { E: { count: 1, used: false } } };
  it("two absent entries are equal; count/used differences are not", () => {
    expect(rowSuggestionsEqual(undefined, undefined)).toBe(true);
    expect(rowSuggestionsEqual(a, undefined)).toBe(false);
    expect(rowSuggestionsEqual(a, { byCol: { E: { count: 1, used: false } } })).toBe(true);
    expect(rowSuggestionsEqual(a, { byCol: { E: { count: 1, used: true } } })).toBe(false);
    expect(rowSuggestionsEqual(a, { byCol: { E: { count: 2, used: false } } })).toBe(false);
    expect(rowSuggestionsEqual(a, { byCol: {} })).toBe(false);
  });
});
