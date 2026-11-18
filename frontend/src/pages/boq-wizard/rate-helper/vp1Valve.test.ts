/**
 * VP-1 (2026-11-13) -- THE VALVE PACKAGE, through the panel's entry point (`makePricingSheetHelper(...).compute`) and the
 * calculator's, on HVAC v65 + the VP-1 fixture (= v66; `vp1.harness.ts`). Every mechanism positive AND negative:
 *   IDENTITY  one synthetic row per SKU = the ruled sheet's BoQ supply / install (124 valve + 12 Misc = 136)
 *   VR2 size (exact / next up / below -> smallest / above refuses), VR3 types not on the sheet (drain, the no-SKU refusal naming
 *   ONLY the row's item), N4 the size split (isolation / type stated nowhere), VR4 flanges, VR5 lists, VR6 no size, VR7 amber
 *   defaults, VR8 the butterfly operator, VR11 a bare Set, VR12 PIBCV, QR-1 Q4 insulation, QR-1 Q2 / Q3 the Misc instruments
 *   N1 the scope pick + the installation-only rule (the new 50% input), N2 no unit, N5 the Piping valve-heading note (12a / 12b),
 *   N6 the registry's fetch-only flag, G2 / G3 / G4 / G6 / G7 wording, A1 the VRF "not priced" line.
 * NEGATIVES on the unchanged categories: VRF's switch stays off on the valve config, Piping keeps its default unit and figures,
 * Insulation keeps its XLPE rule and lines.
 */
import { chai, describe, expect, it } from "vitest"; chai.config.truncateThreshold = 0;
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { type ExtractedListItem, itemListPricingSpec, onlyTheseWords, oneSizeMessage, ONE_SIZE_MESSAGE, vrf10On, xlpeAliasRefusal } from "./itemListPricing";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, SCOPE_OVERRIDE_KEY, VRF10_BLANK_LINE_REASON, buildExtractionByRow, makePricingSheetHelper, scopeSpecOf,
  type ItemListSuggestion, type ItemListView,
} from "./pricingSheetHelper";
import { rowQuantitiesOf, sheetCategoriesOf, sheetLinesOf } from "./rateSuggestionModel";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { itemListRuleOrder, insulationMaterialWords } from "../../pricing/rate-master/itemListRuleOrder";
import { RATE_MASTER_DISCIPLINES, calculatorEntry, rateMasterPageEntry, type RateMasterDisciplineEntry } from "../../pricing/rate-master/rateMasterRegistry";
import { scopeUses } from "../../pricing/rate-master/pricingInputReach";
import { missingNotes } from "./panelFieldAudit";
import { MISC, VALVE, VP1, applyVp1 } from "./vp1.harness";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h65 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v65.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));
const h66 = applyVp1(h65 as never) as unknown as Asset;
const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const ITEMS: RateMasterItem[] = [...toItems(h66), ...toItems(e72)];
const ITEMS65: RateMasterItem[] = [...toItems(h65), ...toItems(e72)];
const CFG = new Map<string, RateCategoryConfig>([...h66.category_configs, ...e72.category_configs].map((c) => [c.category_id, c]));
const CFG65 = new Map<string, RateCategoryConfig>([...h65.category_configs, ...e72.category_configs].map((c) => [c.category_id, c]));
const KINDS = ["supply_rate", "install_rate", "combined_rate"];

type Item = Record<string, string | null> & { _section?: string };
const mi = (a: Item): ExtractedListItem => {
  const { _section, ...attrs } = a;
  return { ...(_section ? { section: _section } : {}), attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v, confidence: v === null ? 0 : 0.9 }])) } as never;
};
type Row = { items?: Item[]; unit?: string; qty?: number; text?: string; headings?: string[]; ownNotes?: string[]; headingNotes?: string[]; category?: string; node?: string };
/** A sheet of rows; `cats` = the PAGE's category of each row (N5). */
const sheet = (rows: Record<number, Row>, opts: { cats?: Record<number, string>; v65?: boolean } = {}) => {
  const results = Object.entries(rows).filter(([, r]) => r.items).map(([er, r]) => ({
    excel_row: Number(er), description: r.text ?? "", category_id: r.category ?? VALVE, attributes: {}, items: r.items!.map(mi),
  }));
  const helper = makePricingSheetHelper({ configsByCategory: opts.v65 ? CFG65 : CFG, items: opts.v65 ? ITEMS65 : ITEMS, extractionByRow: buildExtractionByRow(results as never) });
  const priced = Object.entries(rows).map(([er, r]) => ({ source_row_number: Number(er), qty_total: r.qty ?? 1, node_type: r.node ?? "Line Item", description: r.text ?? "", unit: r.unit ?? "Nos" }));
  const sheetLines = sheetLinesOf(priced as never);
  const rowQuantities = rowQuantitiesOf(priced as never);
  const sheetCategories = opts.cats ? sheetCategoriesOf(new Map(Object.entries(opts.cats).map(([r, c]) => [Number(r), { effective_category_id: c } as never]))) : undefined;
  return (er: number, ov: Record<string, string> = {}): ItemListSuggestion => {
    const r = rows[er];
    return helper.compute({ excelRow: er, description: r.text ?? "", nodeType: "Line Item", category: r.category ?? VALVE, discipline: "HVAC", rateKinds: KINDS,
      unit: r.unit ?? "Nos", quantity: r.qty ?? 1, rowQuantities, sheetLines, headings: r.headings ?? [], ownNotes: r.ownNotes ?? [], headingNotes: r.headingNotes ?? [],
      ...(sheetCategories ? { sheetCategories } : {}) } as never, ov) as unknown as ItemListSuggestion;
  };
};
const one = (r: Row, ov: Record<string, string> = {}) => sheet({ 9: r })(9, ov).itemList!;
const totals = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];
const lines = (v: ItemListView, b = 0) => (v.items[b]?.working ?? []).join("\n");
const allText = (v: ItemListView) => JSON.stringify(v);
const shn = (v: ItemListView) => (v.sheetHeadingNotes ?? []).join(" || ");
const V = (fam: string, size: string | null, more: Item = {}): Item => ({ valve_type: fam, valve_type_as_written: fam, size_mm: size, ...more });
const M = (item: string, more: Item = {}): Item => ({ _section: "misc", item, item_as_written: item, size_mm: null, ...more });

describe("VP-1 identity -- every SKU priced by the product = the ruled sheet's BoQ columns (136 / 136)", () => {
  it("124 valve SKUs: one synthetic row each (family, its choice, its size)", () => {
    let n = 0;
    for (const it of VP1.valve_items) {
      const a = it.attributes as Record<string, unknown>;
      const item: Item = V(String(a.valve_type), typeof a.size_mm === "number" ? `${a.size_mm} mm` : null);
      for (const k of ["actuation", "nrv_type", "spindle", "strainer_type", "operation"]) if (typeof a[k] === "string") item[k] = String(a[k]);
      const v = one({ items: [item], text: "valve" });
      expect([String(a.item_name), a.size_mm, v.rowPriced, totals(v)], JSON.stringify(a)).toEqual([String(a.item_name), a.size_mm, true, it._boq]);
      n++;
    }
    expect(n).toBe(124);
  });
  it("12 Misc SKUs: each as the Misc section of a valve row, priced by Misc's own config", () => {
    let n = 0;
    for (const it of VP1.misc_items) {
      const a = it.attributes as Record<string, unknown>;
      const v = one({ items: [M(String(a.item), { size_mm: typeof a.size_mm === "number" ? `${a.size_mm} mm` : null })], text: String(a.item_name) });
      expect([String(a.item), a.size_mm, v.rowPriced, totals(v)]).toEqual([String(a.item), a.size_mm, true, it._boq]);
      n++;
    }
    expect(n).toBe(12);
  });
  it("brand is null on all 136 and never a match attribute; the empty 'Flow' row is not in the fixture", () => {
    expect([...VP1.valve_items, ...VP1.misc_items].every((it) => it.brand === null)).toBe(true);
    const p = itemListPricingSpec(VP1.valve_config)!;
    expect(p.match_attrs).not.toContain("brand");
    expect(VP1.misc_items.some((it) => /^flow/i.test(String((it.attributes as Record<string, unknown>).item_name)))).toBe(false);
  });
});

describe("VP-1 VR2 -- the valve size against the sheet's sizes", () => {
  it("exact; between -> next size up; below the smallest -> the smallest, noted; above the largest refuses naming it", () => {
    expect(totals(one({ items: [V("Butterfly Valve", "150 mm")] }))).toEqual([5708, 1000]);
    const up = one({ items: [V("Butterfly Valve", "140 mm")] });
    expect(totals(up)).toEqual([5708, 1000]);
    expect(allText(up)).toMatch(/next size up/);
    const below = one({ items: [V("Strainer", "25 mm")] });
    expect(totals(below)).toEqual([3141, 1000]);
    expect(allText(below)).toMatch(/50 mm \(the smallest size\)/);
    const above = one({ items: [V("Butterfly Valve", "400 mm")] });
    expect(above.rowPriced).toBe(false);
    expect(allText(above)).toContain("valve size 400 is above the largest size on the sheet (300)");
  });
  it("NB is read as mm, inches convert (2 inch -> 50 mm)", () => {
    expect(totals(one({ items: [V("Ball Valve", "40 NB")] }))).toEqual(totals(one({ items: [V("Ball Valve", "40 mm")] })));
    expect(totals(one({ items: [V("Butterfly Valve", "2 inch")] }))).toEqual(totals(one({ items: [V("Butterfly Valve", "50 mm")] })));
  });
});

describe("VP-1 VR3 -- types not on the sheet", () => {
  it("a drain valve prices as the Ball Valve of the same size, with its line", () => {
    const v = one({ items: [V("none of these", "25 mm", { valve_type_as_written: "Drain valve" })], text: "Drain valve with nut" });
    expect(v.rowPriced).toBe(true);
    expect(v.items[0].family).toBe("Ball Valve");
    expect(totals(v)).toEqual([682, 1000]);
    expect(lines(v)).toMatch(/drain valve -> priced as the Ball Valve of the same size/);
  });
  it("C8 flow switch: 'No SKU in the catalogue for flow switch - price this row by hand.' naming ONLY the row's item", () => {
    const v = one({ items: [V("none of these", null, { valve_type_as_written: "flow switch" })], text: "Supply and fixing of flow switch with gauges" });
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toBe("No SKU in the catalogue for flow switch - price this row by hand");
    expect(v.items.map((x) => x.reason ?? "").join(" ")).not.toMatch(/gauge/i);
  });
  it("a flow meter in the row's own text refuses by name; NEGATIVE a stated stocked type with no such word prices", () => {
    const v = one({ items: [V("none of these", "50 mm", { valve_type_as_written: "Flow meter" })], text: "Electromagnetic flow meter 50 mm" });
    expect(v.rowPriced).toBe(false);
    expect(allText(v)).toMatch(/No SKU in the catalogue for Flow meter - price this row by hand/);
    expect(one({ items: [V("Ball Valve", "50 mm")], text: "Ball valve 50 mm" }).rowPriced).toBe(true);
  });
  it("QR-1 Q3: a gauge cock WITH a gauge does not refuse the row; a lone gauge cock refuses naming it", () => {
    const g = one({ items: [M("Pressure Gauge", { item_as_written: "Pressure gauge with gauge cock" })], text: "Pressure gauge with gauge cock and syphon" });
    expect(g.rowPriced).toBe(true);
    expect(totals(g)).toEqual([2175, 500]);
    const c = one({ items: [V("none of these", "15 mm", { valve_type_as_written: "gauge cock" })], text: "Gauge cock 15 mm" });
    expect(c.rowPriced).toBe(false);
    expect(allText(c)).toContain("No SKU in the catalogue for gauge cock - price this row by hand");
  });
});

describe("VP-1 N4 -- isolation valve / valve type stated nowhere -> ball 40 mm and below, butterfly above (amber)", () => {
  const ISO = (size: string | null, said = "Isolation valve") => one({ items: [V("none of these", size, { valve_type_as_written: said })], text: said });
  it("C4: 40 mm isolation valve -> Ball Valve 1,470 / 1,000 with the N4 line", () => {
    const v = ISO("40 mm");
    expect(v.items[0].family).toBe("Ball Valve");
    expect(totals(v)).toEqual([1470, 1000]);
    expect(lines(v)).toMatch(/does not say which valve type\. Priced as the Ball Valve by size/);
  });
  it("65 mm -> the manual butterfly valve by size; 'Valves' alone (type stated nowhere) the same rule", () => {
    const v = ISO("65 mm");
    expect(v.items[0].family).toBe("Butterfly Valve");
    expect(v.rowPriced).toBe(true);
    expect(ISO("25 mm", "Valves").items[0].family).toBe("Ball Valve");
    expect(ISO("80 mm", "valve").items[0].family).toBe("Butterfly Valve");
  });
  it("no size still refuses (for the size); a stated type the catalogue does not stock (globe) keeps the refusal by name", () => {
    const n = ISO(null);
    expect(n.rowPriced).toBe(false);
    expect(allText(n)).toMatch(/no valve size stated/);
    const g = ISO("50 mm", "Globe valve");
    expect(g.rowPriced).toBe(false);
    expect(allText(g)).toContain("No SKU in the catalogue for Globe valve - price this row by hand");
  });
  it("NEGATIVE: a stated type always wins (the model answered Sluice / Gate Valve at 40 mm)", () => {
    const v = one({ items: [V("Sluice / Gate Valve", "40 mm", { valve_type_as_written: "isolation sluice valve" })] });
    expect(v.items[0].family).toBe("Sluice / Gate Valve");
  });
  it("onlyTheseWords: generic words, numbers and units only", () => {
    expect(onlyTheseWords("Isolation valve 40 mm dia", ["isolation", "valve"])).toBe(true);
    expect(onlyTheseWords("Globe valve", ["isolation", "valve"])).toBe(false);
  });
});

describe("VP-1 VR4 / VR7 / VR8 / VR12 / Q4 -- flanges, amber defaults, the butterfly operator, PIBCV, insulation", () => {
  it("VR4: a type-unstated NRV that is flanged -> Flanged NRV; NEGATIVE Dual Plate stated + flanged stays Dual Plate", () => {
    const f = one({ items: [V("NRV / Check Valve", "50 mm", { nrv_type: "None", flanged: "Yes" })] });
    expect(allText(f)).toContain("Flanged NRV");
    expect(totals(f)).toEqual([4833, 1000]);
    const d = one({ items: [V("NRV / Check Valve", "50 mm", { nrv_type: "Dual Plate", flanged: "Yes" })] });
    expect(allText(d)).toContain("Dual Plate NRV");
  });
  it("VR4 note: a butterfly row naming flanges carries the fitting note, never a refusal", () => {
    const v = one({ items: [V("Butterfly Valve", "100 mm")], text: "Butterfly valve with companion flanges, nuts and bolts" });
    expect(v.rowPriced).toBe(true);
    expect(lines(v)).toMatch(/flanges, nuts, bolts and gaskets are part of fitting the valve/);
  });
  it("C2 VR7: a 250 mm motorised butterfly, duty unstated -> On-Off 178,009 / 3,000 (amber); Modulating follows the pick", () => {
    const v = one({ items: [V("Motorised Butterfly Valve", "250 mm", { actuation: "None" })] });
    expect(totals(v)).toEqual([178009, 3000]);
    expect(allText(v)).toMatch(/actuator duty not stated - priced as On-Off/);
    const m = one({ items: [V("Motorised Butterfly Valve", "250 mm", { actuation: "Modulating" })] });
    expect(m.rowPriced).toBe(true);
    expect(totals(m)).not.toEqual([178009, 3000]);
  });
  it("C1 VR8: 150 mm butterfly, 'gear' -> Hand lever 5,708 / 1,000 + the operator line; never a refusal", () => {
    const v = one({ items: [V("Butterfly Valve", "150 mm", { operator_as_written: "gear operated" })] });
    expect(totals(v)).toEqual([5708, 1000]);
    expect(lines(v)).toMatch(/BoQ says gear operated - the size decides the sheet's butterfly valve/);
    expect(allText(v)).toContain("Butterfly Valve (Hand lever)");
  });
  it("C9 VR12: a 32 mm PIBCV -> 28,093 / 1,000 + the line naming the item", () => {
    const v = one({ items: [V("PIBCV", "32 mm", { valve_type_as_written: "PIBCV" })] });
    expect(totals(v)).toEqual([28093, 1000]);
    expect(lines(v)).toMatch(/priced as the sheet's one PIBCV item \(Pressure Independent control valve/);
  });
  it("QR-1 Q4: a valve to be insulated -> priced, with the amber insulation note", () => {
    const v = one({ items: [V("Ball Valve", "25 mm")], text: "Ball valve 25 mm including insulation" });
    expect(v.rowPriced).toBe(true);
    expect(lines(v)).toMatch(/Valve insulation is not on our sheets and is not in this price/);
  });
});

describe("VP-1 VR5 / VR6 / VR11 -- lists, no size, a bare Set", () => {
  it("C5: '20mm Auto Air Vents with ball valve of 20 mm' -> two items, Row total 1,571 / 2,000", () => {
    const v = one({ items: [V("Automatic Air Vent", "20 mm"), V("Ball Valve", "20 mm")], text: "SITC of 20mm Auto Air Vents with ball valve of 20 mm dia." });
    expect(v.rowPriced).toBe(true);
    expect(totals(v)).toEqual([1571, 2000]);
  });
  it("a valve with a pressure gauge read beside it (a Misc section item) prices BOTH -- the gauge is not dropped", () => {
    const v = one({ items: [V("Ball Valve", "25 mm"), M("Pressure Gauge", { item_as_written: "pressure gauge" })], text: "Ball valve 25 mm with pressure gauge" });
    expect(v.rowPriced).toBe(true);
    expect(totals(v)).toEqual([682 + 2175, 1000 + 500]);
    expect(v.sections?.independent.map((s) => s.view.items.map((b) => b.family))).toEqual([["Pressure Gauge"]]);
  });
  it("NEGATIVE: a Piping row's insulation item still belongs to the k-th pipe (an attachable section), never a second line", () => {
    const p = sheet({ 9: { category: "hvac_piping", unit: "Rmt", items: [{ pipe_type: "MS", size_mm: "50 mm", insulated: "Yes" },
      { _section: "insulation", material: "Nitrile Rubber Insulation", thickness_mm: "19 mm" }] } })(9).itemList!;
    expect(p.sections?.independent ?? []).toEqual([]);
    expect((p.items[0].sections ?? []).length).toBe(1);
  });
  it("11-12 23:59: on a list row naming a 3-way valve, ONLY the 3-way item is refused by name; the stocked items are not (00017 'AHU' r51 shape)", () => {
    const text = "Valve station consists of 2 way pressure independent control and balancing valve, ball valves, strainer and a 3-way valve";
    const v = one({ items: [V("Balancing Valve", "20 mm"), V("Ball Valve", "20 mm"), V("none of these", "20 mm", { valve_type_as_written: "3-way valve" })], text });
    expect(v.rowPriced).toBe(false);
    expect(v.items.map((b) => [b.family, b.state, b.reason ?? null])).toEqual([
      ["Balancing Valve", "priced", null], ["Ball Valve", "priced", null],
      ["none of these", "blank", "No SKU in the catalogue for 3-way valve - price this row by hand"]]);
    expect(allText(v)).not.toMatch(/No SKU in the catalogue for (balancing|ball) valve/i);
  });
  it("the same when the row writes '3 way' and the item's own words '3-way' (spelling variants of one unstocked thing)", () => {
    const text = "Valve station: balancing valve and a 3 way valve with actuator";
    const v = one({ items: [V("Balancing Valve", "20 mm"), V("none of these", "20 mm", { valve_type_as_written: "3-way valve" })], text });
    expect(v.items.map((b) => [b.state, b.reason ?? null])).toEqual([["priced", null], ["blank", "No SKU in the catalogue for 3-way valve - price this row by hand"]]);
  });
  it("a row-text unstocked word that NO item carries refuses naming the WORD, never the stocked item (a flow meter the model did not list)", () => {
    const v = one({ items: [V("Ball Valve", "50 mm"), V("Strainer", "50 mm", { strainer_type: "Y-Type" })], text: "Ball valve and strainer with flow meter" });
    expect(v.rowPriced).toBe(false);
    expect(v.items[0].reason).toBe("No SKU in the catalogue for flow meter - price this row by hand");
    expect(allText(v)).not.toMatch(/No SKU in the catalogue for ball valve/i);
  });
  it("one item not stocked stops the row naming it", () => {
    const v = one({ items: [V("Ball Valve", "20 mm"), V("none of these", "20 mm", { valve_type_as_written: "3-way valve" })], text: "Ball valve and 3-way valve" });
    expect(v.rowPriced).toBe(false);
    expect(allText(v)).toMatch(/No SKU in the catalogue for 3-way valve/);
  });
  it("VR6: a BTU meter with no size -> 'no valve size stated'; the air vent prices without one", () => {
    const b = one({ items: [V("BTU Meter", null)] });
    expect(b.rowPriced).toBe(false);
    expect(allText(b)).toMatch(/no valve size stated/);
    expect(one({ items: [V("Automatic Air Vent", null)] }).rowPriced).toBe(true);
  });
  it("VR11: a bare 'Set' with no contents refuses; a kit with its valve read prices per Set (orange bar)", () => {
    const bare = one({ items: [], unit: "Set" });
    expect(bare.rowPriced).toBe(false);
    expect(allText(bare)).toMatch(/no items were read on this row/);
    const kit = one({ items: [V("Ball Valve", "32 mm")], unit: "Sets" });
    expect(kit.rowPriced).toBe(true);
  });
});

describe("VP-1 Misc borrowed under Misc's own rules (QR-1 Q2 / Q3, C6)", () => {
  it("C6: a thermometer with a thermowell -> Misc thermometer 2,175 / 500 + the accessory note", () => {
    const v = one({ items: [M("Temperature Gauge / Thermometer", { item_as_written: "Dial type Thermometers" })], text: "Dial type Thermometers, Accessories: With suitable thermowell" });
    expect(v.rowPriced).toBe(true);
    expect(totals(v)).toEqual([2175, 500]);
    expect(allText(v)).toMatch(/thermowell with the thermometer; it is part of fitting it/);
  });
  it("QR-1 Q2: a row naming only a thermowell = Misc Test Plug / Thermowell 720 / 100", () => {
    expect(totals(one({ items: [M("Test Plug / Thermowell", { item_as_written: "Thermowell" })], text: "Thermowell" }))).toEqual([720, 100]);
  });
  it("rubber bellows by size with the ladder up (90 mm -> 100 mm); NEGATIVE above 300 refuses", () => {
    expect(totals(one({ items: [M("Rubber Bellows / Expansion Joint", { size_mm: "90 mm" })] }))).toEqual([8888, 1200]);
    expect(one({ items: [M("Rubber Bellows / Expansion Joint", { size_mm: "350 mm" })] }).rowPriced).toBe(false);
  });
  it("NEGATIVE: Misc is borrow-only -- its own rows keep 'coming soon' (no top-level attribute definitions)", () => {
    const r = sheet({ 9: { category: MISC, text: "Pressure gauge" } })(9);
    expect((r as unknown as { kind: string }).kind).toBe("none");
  });
});

describe("VP-1 N1 -- the scope pick on every priced valve row + the installation-only rule", () => {
  it("the pick is offered, defaulting to Supply + installation; Supply only -> install 0", () => {
    const v = one({ items: [V("Butterfly Valve", "150 mm", { scope: "Supply + installation" })] });
    expect(v.scope?.picker?.value).toBe("Supply + installation");
    expect(v.scope?.picker?.options).toEqual(["Supply + installation", "Supply only", "Installation only"]);
    const s = one({ items: [V("Butterfly Valve", "150 mm", { scope: "Supply + installation" })] }, { [SCOPE_OVERRIDE_KEY]: "Supply only" });
    expect(totals(s)).toEqual([5708, 0]);
    expect(s.scope?.note).toMatch(/Scope changed by user/);
  });
  it("C10: Installation only with no supply row on the sheet -> 0 / 1,500 (install x 1.5, the new 50% input)", () => {
    const v = one({ items: [V("Butterfly Valve", "150 mm", { scope: "Supply + installation" })] }, { [SCOPE_OVERRIDE_KEY]: "Installation only" });
    expect(totals(v)).toEqual([0, 1500]);
    expect(v.scope?.note).toMatch(/does not quote this valve.s supply on another row, so the uplift applies/);
  });
  it("Installation only WITH the same valve's supply row on the sheet -> the normal 1,000, naming that row", () => {
    const s = sheet({
      5: { items: [V("Butterfly Valve", "150 mm", { scope: "Supply only" })] },
      9: { items: [V("Butterfly Valve", "150 mm", { scope: "Installation only" })] },
    });
    const v = s(9).itemList!;
    expect(totals(v)).toEqual([0, 1000]);
    expect(v.scope?.note).toMatch(/Supply row\(s\) of this valve on this sheet: row 5/);
  });
  it("NEGATIVE: VRF's switch stays off on the valve config; scopeSpecOf reads VRF's extras.scope unchanged", () => {
    const vp = itemListPricingSpec(VP1.valve_config)!;
    expect(vrf10On(vp)).toBe(false);
    const vrf = itemListPricingSpec(CFG.get("hvac_vrf")!)!;
    expect(scopeSpecOf(vrf)).toBe(vrf.extras!.scope);
    expect(scopeSpecOf(itemListPricingSpec(CFG.get("hvac_piping")!)!)).toBeUndefined();
  });
  it("the uplift input reaches every valve SKU and nothing else; VRF's display name is 'VRF - installation-only uplift'", () => {
    const u = scopeUses(VP1.valve_config, ITEMS);
    expect(u.map((x) => [x.input, x.skus.length])).toEqual([["valve_install_only_uplift", 124]]);
    expect(scopeUses(CFG.get("hvac_vrf")!, ITEMS)).toEqual([]);
    const names = ITEMS.filter((i) => i.kind === "hvac_pricing_input").map((i) => [i.attributes?.item, i.attributes?.name]);
    expect(names).toContainEqual(["valve_install_only_uplift", "Valve - installation-only uplift"]);
    expect(names).toContainEqual(["vrf_install_only_uplift", "VRF - installation-only uplift"]);
  });
});

describe("VP-1 N2 -- a valve row with no unit refuses", () => {
  it("blank unit -> 'no unit on this row'", () => {
    const v = one({ items: [V("Ball Valve", "25 mm")], unit: "" });
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toBe("no unit on this row");
  });
  it("Lot refuses with the red bar line", () => {
    const v = one({ items: [V("Ball Valve", "25 mm")], unit: "Lot" });
    expect(v.rowPriced).toBe(false);
    expect(allText(v)).toMatch(/is not a valve unit/);
  });
  it("NEGATIVE: a Piping row with no unit keeps the 12c-U default unit (priced per metre)", () => {
    const p = sheet({ 9: { category: "hvac_piping", unit: "", items: [{ pipe_type: "MS", size_mm: "50 mm" }] } })(9).itemList!;
    expect(p.rowPriced).toBe(true);
  });
});

describe("VP-1 N5 -- the Piping valve-heading note (12a names the valve rows, 12b warns); display only", () => {
  const PIPE: Row = { category: "hvac_piping", items: [{ pipe_type: "MS", size_mm: "50 mm" }], headings: ["CHW pipes , Valves"], unit: "Rmt" };
  const valveRows = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [100 + i, VALVE]));
  /** the sheet: the Piping row + valve LINE ITEMS at the given rows (the page's categories say Valve Package) */
  const withLines = (rows: number[], extra: Record<number, Row> = {}) => ({ 9: PIPE, ...Object.fromEntries(rows.map((r) => [r, { category: VALVE, text: "valve" } as Row])), ...extra });
  it("12a: the sheet has Valve Package rows -> the note names them", () => {
    const v = sheet(withLines([101, 102]), { cats: { 9: "hvac_piping", 101: VALVE, 102: VALVE } })(9).itemList!;
    expect(shn(v)).toContain("This row's heading mentions valves. This sheet prices valves on their own rows (rows 101, 102), so valves are not included in this pipe price.");
  });
  it("12a long list: the first 10 rows, then 'and N more'", () => {
    const v = sheet(withLines(Array.from({ length: 13 }, (_, i) => 100 + i)), { cats: { 9: "hvac_piping", ...valveRows(13) } })(9).itemList!;
    expect(shn(v)).toContain("(rows 100, 101, 102, 103, 104, 105, 106, 107, 108, 109 and 3 more)");
  });
  it("12b: no Valve Package row on the sheet -> the warning", () => {
    const v = sheet({ 9: PIPE }, { cats: { 9: "hvac_piping" } })(9).itemList!;
    expect(shn(v)).toContain("This row's heading mentions valves, but this sheet quotes no valve on its own row. Valves are not included in this pipe price - add them on their own rows if the BoQ needs them.");
  });
  it("NEGATIVE: no valve in the headings -> no note; no page categories (calculator / harness) -> no note; figures equal with and without", () => {
    const plain = sheet({ ...withLines([101]), 9: { ...PIPE, headings: ["CHW pipes"] } }, { cats: { 9: "hvac_piping", 101: VALVE } })(9).itemList!;
    expect(shn(plain)).not.toMatch(/mentions valves/);
    const noCats = sheet({ 9: PIPE })(9).itemList!;
    expect(shn(noCats)).not.toMatch(/mentions valves/);
    const withNote = sheet({ 9: PIPE }, { cats: { 9: "hvac_piping" } })(9).itemList!;
    expect(totals(withNote)).toEqual(totals(noCats));
    expect(withNote.totals).toEqual(noCats.totals);
  });
  it("the note shows on a Piping row with no item read yet (no block to carry it)", () => {
    const v = sheet({ ...withLines([101]), 9: { ...PIPE, items: undefined } }, { cats: { 9: "hvac_piping", 101: VALVE } })(9).itemList!;
    expect(shn(v)).toMatch(/rows 101/);
  });
  it("NEGATIVE: a valve HEADING (a Preamble filed Valve Package) is not a row that prices a valve -- not named; alone it gives 12b", () => {
    const v = sheet(withLines([101], { 100: { category: VALVE, node: "Preamble", text: "BUTTERFLY VALVES" } }), { cats: { 9: "hvac_piping", 100: VALVE, 101: VALVE } })(9).itemList!;
    expect(shn(v)).toContain("(rows 101)");
    const only = sheet({ 9: PIPE, 100: { category: VALVE, node: "Preamble", text: "BUTTERFLY VALVES" } }, { cats: { 9: "hvac_piping", 100: VALVE } })(9).itemList!;
    expect(shn(only)).toMatch(/quotes no valve on its own row/);
  });
});

describe("VP-1 N6 -- Misc is fetched but listed neither in the calculator nor on the Rate Master page", () => {
  const entry: RateMasterDisciplineEntry = { discipline: "HVAC", label: "HVAC", categories: [{ category_id: VALVE, label: "Valve Package" }, { category_id: MISC, label: "Misc", fetch_only: true }] };
  it("calculatorEntry / rateMasterPageEntry drop a fetch_only entry", () => {
    expect(calculatorEntry(entry).categories.map((c) => c.category_id)).toEqual([VALVE]);
    expect(rateMasterPageEntry(entry).categories.map((c) => c.category_id)).toEqual([VALVE]);
  });
  it("NEGATIVE: an entry without fetch_only is returned as the SAME object", () => {
    for (const d of RATE_MASTER_DISCIPLINES) if (!d.categories.some((c) => c.fetch_only)) expect(calculatorEntry(d)).toBe(d);
  });
});

describe("VP-1 wording -- G2 / G3 / G4 / G6 / G7 on the valve Derivation tab; A1", () => {
  const rules = (cfg: RateCategoryConfig) => itemListRuleOrder(cfg, ITEMS as never).map((r: { title: string; detail?: string }) => `${r.title} | ${r.detail ?? ""}`).join("\n");
  it("G2: no insulation-material lines on the valve tab; Insulation keeps them; the XLPE refusal never fires on a valve row", () => {
    expect(rules(VP1.valve_config)).not.toMatch(/XLPE|nitrile/i);
    expect(rules(CFG.get("hvac_insulation")!)).toMatch(/XLPE and refuse by name/);
    expect(insulationMaterialWords(["flow meter"])).toBe(false);
    const vp = itemListPricingSpec(VP1.valve_config)!;
    expect(xlpeAliasRefusal(vp, mi(V("Ball Valve", "25 mm")), "ball valve with cross linked polyethylene (XPE) insulation")).toBeNull();
    const row = one({ items: [V("Ball Valve", "25 mm")], text: "Ball valve 25 mm with cross linked polyethylene (XPE) insulation" });
    expect(row.rowPriced).toBe(true);
    expect(allText(row)).not.toMatch(/\(XLPE\) - price this row by hand/);
    const ins = itemListPricingSpec(CFG.get("hvac_insulation")!)!;
    expect(xlpeAliasRefusal(ins, mi({ family: "none of these" }), "cross linked polyethylene")).not.toBeNull();
  });
  it("G3: the unit line's example is never a spelling valves price ('nos' / 'Set')", () => {
    expect(rules(VP1.valve_config)).toMatch(/unit 'Sqm' is not a valve unit/);
    expect(rules(VP1.valve_config)).not.toMatch(/unit 'nos' is not a valve unit/);
  });
  it("G4: the operator and PIBCV lines read the config's own words, not 'stating its own figure'", () => {
    const r = rules(VP1.valve_config);
    expect(r).not.toMatch(/stating its own figure/);
    expect(r).toMatch(/the operator is noted, never refused/);
    expect(r).toMatch(/Every PIBCV row is priced as the sheet's one PIBCV item/);
  });
  it("G6: the Lot line on the valve tab has no 'read at VRF-4'; VRF's keeps its own words", () => {
    expect(rules(VP1.valve_config)).not.toMatch(/VRF-4/);
    expect(rules(CFG.get("hvac_vrf")!)).toMatch(/copied by the model for review only/);
  });
  it("G7: 'valve size' wording; a typed 'DN 50' is 50 mm on the valve; NEGATIVE Piping keeps 'Type one pipe size'", () => {
    expect(oneSizeMessage("valve size")).toBe("Type one valve size, in mm or inches");
    expect(oneSizeMessage("pipe size")).toBe(ONE_SIZE_MESSAGE);
    expect(rules(VP1.valve_config)).toMatch(/Type one valve size, in mm or inches/);
    expect(rules(CFG.get("hvac_piping")!)).toMatch(/Type one pipe size, in mm or inches/);
    const calc = makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS, extractionByRow: new Map() });
    const typed = (size: string, cat = VALVE, fam = "Butterfly Valve") => (calc.compute(calculatorCtx("HVAC", cat), {
      [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: fam, attrs: { size_mm: size }, other: ["size_mm"] }] }), [ROW_UNIT_OVERRIDE_KEY]: cat === VALVE ? "Nos" : "Rmt",
    }) as unknown as ItemListSuggestion).itemList!;
    expect(totals(typed("DN 50"))).toEqual(totals(typed("50")));
    expect(typed("DN 50").rowPriced).toBe(true);
    expect(allText(typed("40-50"))).toContain("Type one valve size, in mm or inches");
  });
  it("G5: the Misc size field carries its note (the product's field audit finds no typed mandatory field without one); NEGATIVE without it", () => {
    expect(missingNotes(VP1.misc_config, ITEMS)).toEqual([]);
    expect(missingNotes(VP1.valve_config, ITEMS)).toEqual([]);
    const bare = structuredClone(VP1.misc_config) as unknown as { list_spec: { pricing: Record<string, unknown> } };
    delete bare.list_spec.pricing.panel_notes;
    expect(missingNotes(bare, ITEMS).join(" ")).toMatch(/size_mm/);
  });
  it("A1: the VRF blank-line reason no longer repeats 'not priced' (the panel leads with 'Not priced -')", () => {
    expect(VRF10_BLANK_LINE_REASON).toBe("the unit it belongs to is not priced");
  });
});

describe("VP-1 C11 -- the calculator: Valve Package, Butterfly 'Other...' 140 + Misc pressure gauge = the panel", () => {
  it("7,883 / 1,500 / 9,383; the same figures on a BoQ row", () => {
    const calc = makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS, extractionByRow: new Map() });
    const v = (calc.compute(calculatorCtx("HVAC", VALVE), {
      [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "Butterfly Valve", attrs: { size_mm: "140" }, other: ["size_mm"] }],
        sections: { misc: [{ base: null, family: "Pressure Gauge", attrs: {} }] } }),
      [ROW_UNIT_OVERRIDE_KEY]: "Nos",
    }) as unknown as ItemListSuggestion).itemList!;
    expect([v.totals?.supply_rate, v.totals?.install_rate, v.totals?.combined_rate]).toEqual([7883, 1500, 9383]);
    const panel = one({ items: [V("Butterfly Valve", "140 mm"), M("Pressure Gauge")] });
    expect(panel.totals).toEqual(v.totals);
  });
});
