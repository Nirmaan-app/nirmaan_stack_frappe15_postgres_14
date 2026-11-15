/**
 * DU-1 PART B -- THE 97-ROW DUCT PARITY on the newest HVAC asset, through the product's own pricer (makePricingSheetHelper).
 * The rows are the owner's rate sheet (DU-D0 D6). Expected, re-based per QR-1 (owner 2026-11-15):
 *  - the 39 rows without insulation: the figure the sheet states;
 *  - the 58 rows with insulation (QR-1 (a): a duct line + its own Insulation line): the sheet's figure for the same duct without
 *    insulation (its twin row) + the Insulation line priced LIVE by the Insulation category's own pricer at test time (never
 *    hard-coded); on a per-metre round row the Insulation line is its per-sq.m figure x 3.14 x dia / 1000, rounded up.
 * QR-1 (c): the round per-metre pipeline rounds half up, so rows 25 and 32 equal the sheet.
 */
import { describe, expect, it } from "vitest";
import { buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { CFG, ITEMS, LATEST as latest, SHEET, cell, ductItems } from "./du1Duct.harness";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];

function priceRow(category: string, description: string, unit: string, items: unknown[]): ItemListSuggestion["itemList"] {
  const h = makePricingSheetHelper({ configsByCategory: CFG as never, items: ITEMS as never,
    extractionByRow: buildExtractionByRow([{ excel_row: 9, description, category_id: category, attributes: {}, items }] as never) });
  const res = h.compute({ excelRow: 9, description, nodeType: "Line Item", category, discipline: "HVAC", rateKinds: KINDS, unit,
    headings: [], ownNotes: [], headingNotes: [] } as never, {}) as unknown as ItemListSuggestion;
  return res.itemList;
}

/** the Insulation category's own figure per sq.m for this thickness, priced live */
function insulationPerSqm(mm: string): [number, number] {
  const v = priceRow("hvac_insulation", `Thermal nitrile insulation ${mm} mm`, "Sqm",
    [{ attributes: { item: cell("Thermal Nitrile Insulation"), thickness_mm: cell(`${mm} mm`), cladding: cell("None") } }]);
  expect(v?.rowPriced, `insulation ${mm} mm prices on its own`).toBe(true);
  return [Number(v!.totals!.supply_rate), Number(v!.totals!.install_rate)];
}

const twinOf = (name: string) => name.replace(" with Insulation", "").replace(/ \+ \d+ mm insulation$/, "");

describe(`DU-1 duct parity on ${latest}: 97 sheet rows`, () => {
  it("the sheet has 97 rows: 39 without insulation, 58 with", () => {
    expect(SHEET.length).toBe(97);
    expect(SHEET.filter((r) => /insulation/.test(r.row)).length).toBe(58);
  });

  const byName = new Map(SHEET.map((r) => [r.row, r]));
  for (const r of SHEET) {
    it(`row ${r.src}: ${r.row} (${r.unit})`, () => {
      const unit = r.unit === "Mts" ? "Mts" : "Sqm";
      const v = priceRow("hvac_ducting", r.row, unit, ductItems(r.row));
      expect(v?.rowPriced, v?.reason ?? "").toBe(true);
      const got = [Number(v!.totals!.supply_rate), Number(v!.totals!.install_rate)];
      const ins = r.row.match(/\+ (\d+) mm insulation/)?.[1];
      if (!ins) { expect(got).toEqual(r.sheet); return; }
      const twin = byName.get(twinOf(r.row));
      expect(twin, `twin of ${r.row}`).toBeTruthy();
      const per = insulationPerSqm(ins);
      const dia = Number(r.row.match(/(\d+) mm(?! insulation)/)?.[1]);
      const line = unit === "Mts" ? per.map((x) => Math.ceil(x * 3.14 * dia / 1000)) : per;
      expect(got).toEqual([twin!.sheet[0] + line[0], twin!.sheet[1] + line[1]]);
    });
  }
});
