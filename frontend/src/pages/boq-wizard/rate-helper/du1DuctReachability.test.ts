/**
 * DU-1 PART B -- 97/97 REACHABILITY on the newest HVAC asset: every duct row of the owner's rate sheet can be priced from the panel
 * (the model's reading of the row) AND from the calculator (a person picking the duct type, the gauge / thickness, the diameter and
 * the insulation by hand), and both entry points give the SAME figure. The calculator has no sheet, so the per-sheet insulation
 * check (DR7 / G-3) never runs there; these rows carry no separate insulation rows, so the panel prices the line too.
 * DR17 + NOTE 3: a round row's diameter is PICKED from the Diameter dropdown (the sheet's round diameters), never typed.
 */
import { describe, expect, it } from "vitest";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { CFG, ITEMS, LATEST as latest, SHEET, ductItems } from "./du1Duct.harness";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const DUCT = "hvac_ducting";
const GAUGE_MM: Record<string, string> = { "26": "0.5", "24": "0.6", "22": "0.8", "20": "1", "18": "1.2" };

const panel = (name: string, unit: string): ItemListView => {
  const h = makePricingSheetHelper({ configsByCategory: CFG as never, items: ITEMS as never,
    extractionByRow: buildExtractionByRow([{ excel_row: 9, description: name, category_id: DUCT, attributes: {}, items: ductItems(name) }] as never) });
  return (h.compute({ excelRow: 9, description: name, nodeType: "Line Item", category: DUCT, discipline: "HVAC", rateKinds: KINDS, unit,
    headings: [], ownNotes: [], headingNotes: [] } as never, {}) as unknown as ItemListSuggestion).itemList!;
};
const calc = (name: string, unit: string): ItemListView => {
  const pir = /PIR/.test(name) ? name.match(/(\d+) mm/)?.[1] : undefined;
  const g = name.match(/(\d{2})G/)?.[1];
  const round = /Round/.test(name);
  const dia = round ? name.match(/(\d+) mm(?! insulation)/)?.[1] : undefined;
  const ins = name.match(/\+ (\d+) mm insulation/)?.[1];
  const family = pir ? "PIR (Pre Insulated Duct)" : /Fire Rated/.test(name) ? "Fire Rated (MS)" : round ? "Round (GI) - per metre"
    : /Spiral/.test(name) ? "Spiral / Oval (GI)" : "Rectangular (GI)";
  const attrs: Record<string, string> = { gauge_as_written: pir ?? GAUGE_MM[g!], ...(dia ? { dia_mm: dia } : {}), insulated: ins ? "Yes" : "No" };
  // an insulation section attached to a duct is edited ON that duct (`ItemEdit.sections`)
  const blocks = { items: [{ base: null, family, attrs, other: [],
    ...(ins ? { sections: { insulation: { base: null, family: "Thermal Nitrile Insulation", attrs: { thickness_mm: ins, cladding: "None" } } } } : {}) }] };
  const h = makePricingSheetHelper({ configsByCategory: CFG as never, items: ITEMS as never, extractionByRow: new Map() });
  return (h.compute(calculatorCtx("HVAC", DUCT), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(blocks), [ROW_UNIT_OVERRIDE_KEY]: unit.toLowerCase() }) as unknown as ItemListSuggestion).itemList!;
};
const tot = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];

describe(`DU-1 duct reachability on ${latest}: 97 rows, panel and calculator`, () => {
  for (const r of SHEET) {
    it(`row ${r.src}: ${r.row}`, () => {
      const unit = r.unit === "Mts" ? "Mts" : "Sqm";
      const p = panel(r.row, unit);
      const c = calc(r.row, unit);
      expect(p.rowPriced, `panel: ${p.reason ?? ""}`).toBe(true);
      expect(c.rowPriced, `calculator: ${c.reason ?? ""} ${JSON.stringify(c.items?.map((b) => b.reason ?? null))}`).toBe(true);
      expect(tot(c)).toEqual(tot(p));
      if (/Round/.test(r.row)) {
        // the diameter came from the dropdown: the field offers it, with "Other..." beside it
        const f = c.items?.[0]?.fields?.find((x) => x.id === "dia_mm");
        expect(f?.options).toEqual(["80", "100", "150", "200", "250", "300"]);
        expect(f?.allowOther).toBe(true);
        expect(f?.options).toContain(r.row.match(/(\d+) mm(?! insulation)/)?.[1]);
      }
    });
  }
});
