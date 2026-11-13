/**
 * VP-3 (2026-11-13) -- HVAC v67's Valve Package / Misc config changes (owner C1 / C2 / C4 / C5 "ok", 2026-11-13) through the panel's
 * entry point (`makePricingSheetHelper(...).compute`) on the COMMITTED v67 asset, each POSITIVE and NEGATIVE (the negative on v66 or
 * on a row the key does not touch):
 *   C1  the insulation line on a Misc instrument / bellows row, and on the misspelled "insulaion"
 *   C2  the air vent's one-price line on every air-vent row
 *   C4  a per-metre row says "PRICED PER METRE - NOT A VALVE UNIT", a Lot row keeps "PRICED PER LOT"
 *   C5  a Set row's named gauge is priced per Set, never "not stocked per 'Set'"
 * and THE DERIVATION TAB: v67 adds no rule (`itemListRuleOrder` never renders `text_notes`; the C1 / C2 lines are row notes).
 */
import { chai, describe, expect, it } from "vitest"; chai.config.truncateThreshold = 0;
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { type ExtractedListItem } from "./itemListPricing";
import { buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h66 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v66.json`, import.meta.url));
const h67 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v67.json`, import.meta.url));
const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: { ...it.attributes } } as RateMasterItem));
const cfgOf = (a: Asset) => new Map<string, RateCategoryConfig>(a.category_configs.map((c) => [c.category_id, { ...c, discipline: "HVAC" } as RateCategoryConfig]));
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const VALVE = "hvac_valve_package", MISC = "hvac_misc";

type Item = Record<string, string | null> & { _section?: string };
const mi = (a: Item): ExtractedListItem => {
  const { _section, ...attrs } = a;
  return { ...(_section ? { section: _section } : {}), attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) } as never;
};
const V = (fam: string, size: string | null): Item => ({ valve_type: fam, valve_type_as_written: fam, size_mm: size });
const M = (item: string, size: string | null = null): Item => ({ _section: "misc", item, item_as_written: item, size_mm: size });
const one = (a: Asset, items: Item[], o: { unit?: string; text?: string; headings?: string[] } = {}): ItemListView => {
  const h = makePricingSheetHelper({ configsByCategory: cfgOf(a), items: toItems(a),
    extractionByRow: buildExtractionByRow([{ excel_row: 9, description: o.text ?? "", category_id: VALVE, attributes: {}, items: items.map(mi) }] as never) });
  return (h.compute({ excelRow: 9, description: o.text ?? "", nodeType: "Line Item", category: VALVE, discipline: "HVAC", rateKinds: KINDS,
    unit: o.unit ?? "Nos", quantity: 1, headings: o.headings ?? [], ownNotes: [], headingNotes: [] } as never, {}) as unknown as ItemListSuggestion).itemList!;
};
const all = (v: ItemListView) => JSON.stringify(v);
const totals = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];
const INSUL_MISC = /The BoQ asks for insulation\. Insulation is not on our sheets and is not in this price/;
const INSUL_VALVE = /The BoQ asks for the valve to be insulated/;
const AAV = /One price for an automatic air vent of any size - the sheet has a single air-vent price/;

describe("VP-3 C1 -- the insulation line on Misc rows and on 'insulaion'", () => {
  const head = ["Neoprene Rubber Single Arch Expansion Joint ... with 32mm thick NItrile rubber insulation"];
  it("POSITIVE: a rubber bellows row under an insulation heading carries the Misc insulation line (v67)", () => {
    expect(all(one(h67, [M("Rubber Bellows / Expansion Joint", "65 mm")], { text: "65NB", headings: head }))).toMatch(INSUL_MISC);
  });
  it("NEGATIVE: the same row on v66 had no line; a Misc row naming no insulation has none on v67", () => {
    expect(all(one(h66, [M("Rubber Bellows / Expansion Joint", "65 mm")], { text: "65NB", headings: head }))).not.toMatch(INSUL_MISC);
    expect(all(one(h67, [M("Pressure Gauge")], { text: "Pressure gauge 100 mm dial" }))).not.toMatch(INSUL_MISC);
  });
  it("POSITIVE: a valve row saying 'insulaion' carries the valve insulation line (v67); NEGATIVE: v66 did not", () => {
    expect(all(one(h67, [V("Butterfly Valve", "100 mm")], { text: "Butterfly valve 100 mm with nitrile insulaion" }))).toMatch(INSUL_VALVE);
    expect(all(one(h66, [V("Butterfly Valve", "100 mm")], { text: "Butterfly valve 100 mm with nitrile insulaion" }))).not.toMatch(INSUL_VALVE);
  });
});

describe("VP-3 C2 -- the air vent's one-price line", () => {
  it("POSITIVE: an air-vent row carries it (price unchanged 1,120 / 1,000)", () => {
    const v = one(h67, [V("Automatic Air Vent", "25 mm")], { text: "Automatic Air vents - 25mm dia" });
    expect(all(v)).toMatch(AAV);
    expect(totals(v)).toEqual([1120, 1000]);
  });
  it("NEGATIVE: a ball-valve row has no air-vent line; v66 had none", () => {
    expect(all(one(h67, [V("Ball Valve", "25 mm")], { text: "Ball valve 25 mm" }))).not.toMatch(AAV);
    expect(all(one(h66, [V("Automatic Air Vent", "25 mm")], { text: "Automatic Air vents - 25mm dia" }))).not.toMatch(AAV);
  });
});

describe("VP-3 C4 -- a per-metre row's bar", () => {
  it("POSITIVE: unit RMT -> 'PRICED PER METRE - NOT A VALVE UNIT. PRICE THIS ROW BY HAND.'", () => {
    const v = one(h67, [M("Pressure Gauge")], { unit: "RMT", text: "Pressure Gauge (4\" dia)" });
    expect(v.rowPriced).toBe(false);
    expect(v.unitBar?.title).toBe("PRICED PER METRE - NOT A VALVE UNIT. PRICE THIS ROW BY HAND.");
  });
  it("NEGATIVE: a Lot row keeps 'PRICED PER LOT'; v66's RMT row said PER LOT", () => {
    expect(one(h67, [M("Pressure Gauge")], { unit: "Lot" }).unitBar?.title).toBe("PRICED PER LOT - NOT PRICED. PRICE THIS ROW BY HAND.");
    expect(one(h66, [M("Pressure Gauge")], { unit: "RMT" }).unitBar?.title).toBe("PRICED PER LOT - NOT PRICED. PRICE THIS ROW BY HAND.");
  });
});

describe("VP-3 C5 -- a Set row's named gauge", () => {
  it("POSITIVE: unit Set, a pressure gauge -> priced per Set (2,175 / 500), no 'not stocked per Set'", () => {
    const v = one(h67, [M("Pressure Gauge")], { unit: "Set", text: "Pressure gauge set" });
    expect(v.rowPriced).toBe(true);
    expect(totals(v)).toEqual([2175, 500]);
    expect(all(v)).not.toMatch(/not stocked per 'Set'/);
  });
  it("NEGATIVE: on v66 the same row refused 'not stocked per Set'", () => {
    expect(all(one(h66, [M("Pressure Gauge")], { unit: "Set", text: "Pressure gauge set" }))).toMatch(/not stocked per 'Set'/);
  });
});

describe("VP-3 the Derivation tab: v67 adds NO rule (the C1 / C2 lines are row notes, `text_notes`, which the rule list never renders)", () => {
  const lines = (a: Asset, id: string) => itemListRuleOrder(cfgOf(a).get(id)!, toItems(a) as never).map((l: { title: string; detail?: string }) => `${l.title} | ${l.detail ?? ""}`);
  it("Valve Package: the rule list (titles and details) of v67 = v66's", () => {
    expect(lines(h67, VALVE)).toEqual(lines(h66, VALVE));
  });
  it("Misc: = v66's but the unit rule's example of an unknown unit, 'Set' -> 'Lot' (C5 made Set a Misc unit; G3: the example is a unit the category does not know)", () => {
    const was = lines(h66, MISC), now = lines(h67, MISC);
    expect(now.length).toBe(was.length);
    const moved = now.map((l, i) => (l === was[i] ? null : i)).filter((i): i is number => i !== null);
    expect(moved).toEqual([0]);
    expect(was[0]).toMatch(/unit 'Set' is not a Misc unit/);
    expect(now[0]).toBe(was[0].replace("unit 'Set' is not a Misc unit", "unit 'Lot' is not a Misc unit"));
  });
  it("NEGATIVE: the rule list does read the configs (a removed family changes it)", () => {
    const v = structuredClone(h67) as Asset;
    const cfg = v.category_configs.find((c) => c.category_id === VALVE) as unknown as { list_spec: { pricing: { blank_unit_refuses?: boolean } } };
    delete cfg.list_spec.pricing.blank_unit_refuses;
    expect(lines(v, VALVE)).not.toEqual(lines(h67, VALVE));
  });
});
