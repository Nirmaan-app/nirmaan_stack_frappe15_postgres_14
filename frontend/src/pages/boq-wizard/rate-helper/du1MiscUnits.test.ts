/**
 * DU-1 PART B -- THE MISC-TAB ITEMS BORROWED BY DUCTING (QR-1 Q4 (a); owner 2026-11-15 15:46-15:50: "we use only the sku and units which
 * is there on sheet and any doirect conversions like sqm to sqft kind, others should be left unpriced"; NOTE 3 19:04: per sq.ft BUILT).
 *  - Paint / Fire Retardant Spray Paint: per sq.m (the sheet), per sq.ft = per sq.m x 0.0929 rounded up (the direct conversion);
 *  - Air Balancing per sq.ft keeps the sheet's own Sqft (carpet) item;
 *  - any other unit (Rmt / LS / Nos ...) on such a row is UNPRICED with its note;
 *  - the Valve Package's Misc section is unchanged: its offered families, and every Misc figure it prices, equal v70's.
 */
import path from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";
import { buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { CFG, ITEMS, LATEST, cell } from "./du1Duct.harness";

const KINDS = ["supply_rate", "install_rate", "combined_rate"];
type Cfgs = typeof CFG;
const row = (cfgs: Cfgs, items: unknown, category: string, name: string, unit: string, extracted: unknown[]): ItemListView => {
  const h = makePricingSheetHelper({ configsByCategory: cfgs as never, items: items as never,
    extractionByRow: buildExtractionByRow([{ excel_row: 9, description: name, category_id: category, attributes: {}, items: extracted }] as never) });
  return (h.compute({ excelRow: 9, description: name, nodeType: "Line Item", category, discipline: "HVAC", rateKinds: KINDS, unit,
    headings: [], ownNotes: [], headingNotes: [] } as never, {}) as unknown as ItemListSuggestion).itemList!;
};
const misc = (item: string) => [{ section: "misc", attributes: { item: cell(item), item_as_written: cell(item) } }];
const duct = (name: string, unit: string, item: string) => row(CFG, ITEMS, "hvac_ducting", name, unit, misc(item));
const tot = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];

describe(`DU-1 Misc-tab items on a Ducting row (${LATEST})`, () => {
  it("Paint: per sq.m the sheet's 196 / 140; per sq.ft x 0.0929 rounded up = 19 / 14 (POSITIVE)", () => {
    expect(tot(duct("Painting of ducts", "Sqm", "Paint"))).toEqual([196, 140]);
    const v = duct("Painting of ducts", "Sqft", "Paint");
    expect(v.rowPriced).toBe(true);
    expect(tot(v)).toEqual([Math.ceil(196 * 0.0929), Math.ceil(140 * 0.0929)]);
    expect(JSON.stringify(v)).toContain("per sq.ft = the per sq.m rate x 0.0929");
  });
  it("Fire Retardant Spray Paint: per sq.m 700 / 300; per sq.ft (written Sq.ft) 66 / 28 (POSITIVE)", () => {
    expect(tot(duct("Fire retardant spray paint", "Sqm", "Fire Retardant Spray Paint"))).toEqual([700, 300]);
    expect(tot(duct("Fire retardant spray paint", "Sq.ft", "Fire Retardant Spray Paint"))).toEqual([Math.ceil(700 * 0.0929), Math.ceil(300 * 0.0929)]);
  });
  it("Air Balancing: per sq.ft is the sheet's own carpet item 0 / 5, per sq.m of duct 0 / 57, per CFM 0 / 1.25 (2 decimals)", () => {
    expect(tot(duct("Air balancing", "Sqft", "Air Balancing"))).toEqual([0, 5]);
    expect(tot(duct("Air balancing", "Sqm", "Air Balancing"))).toEqual([0, 57]);
    expect(tot(duct("Air balancing", "CFM", "Air Balancing"))).toEqual([0, 1.25]);
  });
  it("NEGATIVE: any other unit on a painting / balancing row is unpriced, naming the units the sheet has", () => {
    for (const [item, unit] of [["Paint", "Rmt"], ["Fire Retardant Spray Paint", "Nos"], ["Paint", "LS"], ["Air Balancing", "Rmt"]] as const) {
      const v = duct(`${item} row`, unit, item);
      expect(v.rowPriced, `${item} per ${unit}`).toBe(false);
      expect(JSON.stringify(v), `${item} per ${unit}`).toMatch(/price this row by hand/i);
    }
  });
});

describe("DU-1 the Valve Package's Misc section is unchanged by the Misc-tab items", () => {
  const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
  const v70 = readJsonFixture<{ items: Array<Record<string, unknown>>; category_configs: Array<{ category_id: string; list_spec?: { sections?: unknown } }> }>(
    pathToFileURL(path.join(DATA, "rate_master_hvac_all_v70.json")));
  const CFG70 = new Map(v70.category_configs.map((c) => [c.category_id, c]));
  const ITEMS70 = v70.items.map((i) => ({ ...i, discipline: "HVAC" }));
  const VALVE = "hvac_valve_package";
  it("the valve's Misc section offers the same four families as v70 (Paint / Fire Retardant / Air Balancing are Ducting's only)", () => {
    const secs = (c: unknown) => JSON.stringify((c as { list_spec: { sections: unknown } }).list_spec.sections);
    expect(secs(CFG.get(VALVE))).toBe(secs(CFG70.get(VALVE)));
  });
  it("every v70 Misc family prices the same inside a valve row on v70 and on the newest asset", () => {
    const fams = ["Temperature Gauge / Thermometer", "Pressure Gauge", "Test Plug / Thermowell", "Rubber Bellows / Expansion Joint"];
    for (const fam of fams) {
      const extracted = [{ attributes: { valve_type: cell("Ball Valve"), valve_type_as_written: cell("Ball Valve"), size_mm: cell("50") } },
        { section: "misc", attributes: { item: cell(fam), item_as_written: cell(fam), size_mm: cell(fam.startsWith("Rubber") ? "100" : "None") } }];
      const a = row(CFG70, ITEMS70, VALVE, `Ball valve 50 mm with ${fam}`, "Nos", extracted);
      const b = row(CFG, ITEMS, VALVE, `Ball valve 50 mm with ${fam}`, "Nos", extracted);
      expect(a.rowPriced, fam).toBe(true);
      expect(tot(b), fam).toEqual(tot(a));
    }
  });
});
