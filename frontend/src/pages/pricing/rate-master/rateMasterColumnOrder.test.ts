/**
 * SLICE 12c, ACCEPTANCE 4 -- the TypeScript side of the shared column order.
 *
 * ⚠️ THE FIXTURE AND THE EXPECTATIONS ARE THE SAME AS `test_rate_master.TestColumnOrderIsShared`, which
 * greps this file for them. The screen cannot call the exporter for one header, so the rule exists in
 * two languages and this pair of tests IS the mechanism that stops them drifting -- the `FORMULA_FIXTURE`
 * idiom, which this follows deliberately.
 */
import { describe, it, expect } from "vitest";
import { columnOrderForFile, sourceOrder } from "./rateMasterSpec";

const ITEMS = [
  { attributes: { zeta: 1, alpha: 2, cladding: "No" },
    rates: { install_markup: 0.4, cost_adhesive: 30.0, supply_markup: 0.4,
             cost_insulation: 99.0, wastage: 0.05, stray_rate: 1.0 } },
  { attributes: { alpha: 3, mid: 4 }, rates: { cost_cladding: 7.0 } },
];
const DECLARED = {
  attribute_definitions: [{ id: "cladding" }, { id: "zeta" }, { id: "alpha" }],
  rate_composition: {
    supply: { parts: ["cost_insulation", "cost_adhesive", "cost_cladding"],
              wastage_key: "wastage", markup_key: "supply_markup" },
    install: { parts: ["cost_install_x"], markup_key: "install_markup" },
  },
};
const BARE = { attribute_definitions: [{ id: "zeta" }, { id: "alpha" }] };

describe("acceptance 4: columnOrderForFile mirrors csv_exporter.column_order_for", () => {
  it("a DECLARING category takes the sheet's order", () => {
    const { attrs, rates } = columnOrderForFile(DECLARED, ITEMS);
    expect(attrs).toEqual(["cladding", "zeta", "alpha", "mid"]);
    expect(rates).toEqual(["cost_insulation", "cost_adhesive", "cost_cladding", "wastage",
                           "supply_markup", "install_markup", "stray_rate"]);
    // NEGATIVE: a declared part the items do not carry is not invented as a column
    expect(rates).not.toContain("cost_install_x");
  });

  it("a category that declares NOTHING keeps the sorted order", () => {
    // ⚠️ THIS IS WHAT KEEPS EVERY ELECTRICAL FILE AND SCREEN BYTE-IDENTICAL.
    const { attrs, rates } = columnOrderForFile(BARE, ITEMS);
    expect(attrs).toEqual(["alpha", "cladding", "mid", "zeta"]);
    expect(rates).toEqual([...rates].sort());
    expect(attrs).toEqual([...attrs].sort());
  });

  it("NEGATIVE: no config, no items, an empty composition -- none of them throw", () => {
    expect(columnOrderForFile(null, ITEMS).attrs).toEqual(["alpha", "cladding", "mid", "zeta"]);
    expect(columnOrderForFile(DECLARED, [])).toEqual({ attrs: [], rates: [] });
    expect(columnOrderForFile({ ...DECLARED, rate_composition: {} }, ITEMS).rates)
      .toEqual(columnOrderForFile(BARE, ITEMS).rates);
  });

  it("sourceOrder sorts by SHEET first, then row, then uid", () => {
    const got = sourceOrder([
      { item_uid: "d", source_sheet: "B", source_row: 1 },
      { item_uid: "b", source_sheet: "A", source_row: 10 },
      { item_uid: "a", source_sheet: "A", source_row: 2 },
      { item_uid: "c", source_sheet: "A", source_row: 10 },
    ]).map((x) => x.item_uid);
    // ⚠️ sheet FIRST: row 10 of sheet A comes before row 1 of sheet B. Ordering on the row alone
    // interleaves two sheets, which is the defect this mirrors the exporter to avoid.
    expect(got).toEqual(["a", "b", "c", "d"]);
  });

  it("NEGATIVE: a row with no source row sorts AFTER the ones that have one, never first", () => {
    const got = sourceOrder([
      { item_uid: "x", source_sheet: "A" },
      { item_uid: "y", source_sheet: "A", source_row: 5 },
      { item_uid: "z", source_sheet: "A", source_row: "" },
    ]).map((x) => x.item_uid);
    expect(got[0]).toBe("y");
    expect(got.slice(1).sort()).toEqual(["x", "z"]);
  });

  it("NEGATIVE: sourceOrder does not mutate its input", () => {
    const input = [{ item_uid: "b", source_row: 2 }, { item_uid: "a", source_row: 1 }];
    const before = input.map((x) => x.item_uid);
    sourceOrder(input);
    expect(input.map((x) => x.item_uid)).toEqual(before);
  });
});
