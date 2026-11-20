/**
 * VAV-2b1 K2 (ANSWER 44 point 4): pricingSheetHelper.ts is shared by every built category -- v80's new paths (`vavSheetOf` giving the sheet's
 * VAVs to any BoQ row; a row priced by its full-rate block alone) must reach NO other category and no VAV config without the keys. Direct
 * proof through the product's own entry point (makePricingSheetHelper(...).compute), on the v79 FILE and the v80 FILE by name:
 *  - a Ducting row and a Valve Package row (each on a sheet with a VAV box row beside it, so a leaking sheet rule would have something to
 *    read) give byte-identical output on v79 and v80 (figures, items, notes, blocks);
 *  - a VAV box row on v80's config with `sheet_shares.whole` REMOVED gives exactly v79's output.
 * VACUITY: on a scratch copy, the Ducting config made to carry v80's `sheet_shares` (the gate's own key) -> its output changes; so the
 * byte-identity above holds because the gate key is absent, not because the comparison is blind. The replay PF1 is the standing proof over
 * every stored row.
 */
import { describe, expect, it } from "vitest";
import { parseJson } from "@/lib/parseJson";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import { buildExtractionByRow, makePricingSheetHelper } from "./pricingSheetHelper";
import { cell, ductItems, SHEET } from "./du1Duct.harness";
import { assetByName } from "./v78ByName.harness";
import { boxItem } from "./vav2a.harness";

const V79 = assetByName("rate_master_hvac_all_v79.json", "a5e43564");
const V80 = assetByName("rate_master_hvac_all_v80.json", "76f0a942");
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
type Asset = typeof V79;

/** one sheet: row 9 (the priced row, its own category) + row 20 (a VAV box row with a BACnet reading), priced through the BoQ entry point */
function price(a: Asset, category: string, description: string, unit: string, items: unknown[], cfgs?: Map<string, RateCategoryConfig>) {
  const box = { ...boxItem({ controller_mention: "bacnet", controller_by_others: "No", dp_sensor_mention: "Yes" }) };
  const results = [{ excel_row: 9, description, category_id: category, attributes: {}, items },
    { excel_row: 20, description: "VAV box 650 CFM", category_id: "hvac_vav_box", attributes: {}, items: [{ attributes: Object.fromEntries(Object.entries(box).map(([k, v]) => [k, cell(String(v))])) }] }];
  const m = new Map(cfgs ?? a.byId);
  const vav = structuredClone(m.get("hvac_vav_box")!) as unknown as Record<string, unknown>;
  delete vav.calculator_only;
  m.set("hvac_vav_box", vav as unknown as RateCategoryConfig);
  const h = makePricingSheetHelper({ configsByCategory: m as never, items: a.items as never, extractionByRow: buildExtractionByRow(results as never) });
  const sheetLines = [{ row: 9, text: description, unit, preamble: false }, { row: 20, text: "VAV box 650 CFM", unit: "Nos", preamble: false }];
  return JSON.stringify(h.compute({ excelRow: 9, description, nodeType: "Line Item", category, discipline: "HVAC", rateKinds: KINDS, unit, quantity: 2,
    rowQuantities: { 9: 2, 20: 40 }, sheetLines, sheetCategories: { 9: category, 20: "hvac_vav_box" }, headings: [], ownNotes: [], headingNotes: [] } as never, {}));
}

const DUCT = SHEET[0];
const VALVE = ["hvac_valve_package", "Butterfly valve 50 mm dia with lever", "Nos",
  [{ attributes: { valve_type: cell("Butterfly Valve"), valve_type_as_written: cell("Butterfly valve"), size_mm: cell("50") } }]] as const;

describe("ANSWER 44 (4): v80's shared-file paths reach no other category and no VAV config without the keys", () => {
  it("a Ducting row: v79 FILE = v80 FILE, byte for byte (and it prices)", () => {
    const a = price(V79, "hvac_ducting", DUCT.row, DUCT.unit === "Mts" ? "Mts" : "Sqm", ductItems(DUCT.row));
    expect(price(V80, "hvac_ducting", DUCT.row, DUCT.unit === "Mts" ? "Mts" : "Sqm", ductItems(DUCT.row))).toBe(a);
    expect(a).toContain('"rowPriced":true');
  });
  it("a Valve Package row: v79 FILE = v80 FILE, byte for byte", () => {
    const [cat, d, u, its] = VALVE;
    expect(price(V80, cat, d, u, [...its])).toBe(price(V79, cat, d, u, [...its]));
  });
  it("a VAV box row on v80 with its two user-facing keys REMOVED (sheet_shares.whole, user_addable) = v79's, byte for byte", () => {
    // measured (the K2 measurement on v80): with `whole` alone removed the row's output still differs from v79's; the other v80 key a box
    // row SHOWS is user_addable (its "Add sensor" list then offers the Duct Static Pressure Sensor, the owner's 01:09 ruling); with both
    // removed the output equals v79's
    const m = new Map(V80.byId);
    const v = structuredClone(m.get("hvac_vav_box")!) as unknown as { list_spec: { pricing: { sheet_shares: Record<string, unknown>; user_addable?: unknown } } };
    delete v.list_spec.pricing.sheet_shares.whole;
    delete v.list_spec.pricing.user_addable;
    m.set("hvac_vav_box", v as unknown as RateCategoryConfig);
    const its = [{ attributes: Object.fromEntries(Object.entries(boxItem({ controller_mention: "bacnet", controller_by_others: "No", dp_sensor_mention: "Yes" })).map(([k, x]) => [k, cell(String(x))])) }];
    const sansWhole = price(V80, "hvac_vav_box", "VAV box 650 CFM", "Nos", its, m);
    // v79 and v80 differ ONLY by keys a box row does not show (user_addable / the not-box line / the DDC words): with `whole` removed they match
    expect(sansWhole).toBe(price(V79, "hvac_vav_box", "VAV box 650 CFM", "Nos", its));
  });
  it("ANSWER 45 (c) MIRROR: each v80 key does only its own job on a box row -- only user_addable removed: the one difference from v80 is the 'Add sensor' list; only whole removed: the two '(full rate)' entries", () => {
    const its = [{ attributes: Object.fromEntries(Object.entries(boxItem({ controller_mention: "bacnet", controller_by_others: "No", dp_sensor_mention: "Yes" })).map(([k, x]) => [k, cell(String(x))])) }];
    const run = (drop: Array<"whole" | "user_addable">) => {
      const m = new Map(V80.byId);
      const v = structuredClone(m.get("hvac_vav_box")!) as unknown as { list_spec: { pricing: { sheet_shares: Record<string, unknown>; user_addable?: unknown } } };
      if (drop.includes("whole")) delete v.list_spec.pricing.sheet_shares.whole;
      if (drop.includes("user_addable")) delete v.list_spec.pricing.user_addable;
      m.set("hvac_vav_box", v as unknown as RateCategoryConfig);
      return parseJson(price(V80, "hvac_vav_box", "VAV box 650 CFM", "Nos", its, m)) as Record<string, unknown>;
    };
    const full = run([]);
    const sensorsOf = (o: Record<string, unknown>) => ((o.itemList as { sections?: { adds?: Array<{ id: string; families: Array<{ family: string }> }> } }).sections?.adds ?? [])
      .find((a) => a.id === "sensors")?.families.map((f) => f.family);
    const wholesOf = (o: Record<string, unknown>) => (o.itemList as { shares?: { wholeAdds?: unknown } }).shares?.wholeAdds;
    const strip = (o: Record<string, unknown>, sens: boolean, wh: boolean) => {
      const c = structuredClone(o) as { itemList: { sections?: { adds?: Array<{ id: string; families: unknown }> }; shares?: { wholeAdds?: unknown } } };
      if (sens) for (const a of c.itemList.sections?.adds ?? []) if (a.id === "sensors") a.families = null;
      if (wh && c.itemList.shares) c.itemList.shares.wholeAdds = null;
      return JSON.stringify(c);
    };
    const noUa = run(["user_addable"]), noWhole = run(["whole"]);
    expect(sensorsOf(full)).toEqual(["CO2 Sensor", "Duct Static Pressure Sensor"]);
    expect(sensorsOf(noUa)).toEqual(["CO2 Sensor"]);
    expect(strip(noUa, true, false)).toBe(strip(full, true, false));
    expect(wholesOf(full)).toEqual([{ id: "bacnet_whole", label: "BACnet over IP controller (full rate)" }, { id: "ddc_whole", label: "DDC Panel/ Controller (full rate)" }]);
    expect(wholesOf(noWhole)).toEqual([]);
    expect(strip(noWhole, false, true)).toBe(strip(full, false, true));
  });
  it("VACUITY: the Ducting config given v80's sheet_shares (the gate's key) on a scratch copy -> its output CHANGES", () => {
    const m = new Map(V80.byId);
    const d = structuredClone(m.get("hvac_ducting")!) as unknown as { list_spec: { pricing: Record<string, unknown> } };
    d.list_spec.pricing.sheet_shares = structuredClone((m.get("hvac_vav_box") as unknown as { list_spec: { pricing: { sheet_shares: unknown } } }).list_spec.pricing.sheet_shares);
    m.set("hvac_ducting", d as unknown as RateCategoryConfig);
    const u = DUCT.unit === "Mts" ? "Mts" : "Sqm";
    expect(price(V80, "hvac_ducting", DUCT.row, u, ductItems(DUCT.row), m)).not.toBe(price(V80, "hvac_ducting", DUCT.row, u, ductItems(DUCT.row)));
  });
});
