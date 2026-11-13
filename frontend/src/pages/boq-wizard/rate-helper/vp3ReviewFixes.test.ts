/**
 * VP-3 (2026-11-13) -- THE VP-2 REVIEW RULINGS' CODE SAFETY NETS (owner 2026-11-13 17:26-17:47), through the panel's entry point
 * (`makePricingSheetHelper(...).compute`) on the COMMITTED HVAC v66 + Electrical v72 assets. Each mechanism POSITIVE and NEGATIVE:
 *   D1  a PIBCV's thermostat / controller / actuator (panel) is part of the PIBCV item (a 2-way valve "with thermostat" still refuses)
 *   D2  "dual plate" stated -> Dual Plate NRV, over the flanged rule (a flanged NRV with no type stays Flanged)
 *   D3  "portable" / "handed over" -> supply only (a "Supply of ..." row keeps the model's scope)
 *   D4  a gauge's tied, sizeless ball / gate valve is part of the gauge (a ball valve with its own size stays a valve)
 *   D5  air vent + ball valve: the one size goes to the ball valve; "15mm\"" = 15 mm (no size anywhere -> still refuses)
 *   D6  a blank unit read from the description's last " | " piece, every category (no such piece -> unchanged; never the calculator)
 *   D7b "BV" / "Bal valve" at 40 mm and below -> Ball Valve, amber (above 40 -> the model's reading)
 *   D7c "valve with strainer" / integral strainer -> + Y-strainer; a with + without Set -> three blocks (a "without" row -> nothing)
 *   C3  the row names the item that cannot be priced at all, not a missing size; an unstocked word before "no type"
 */
import { chai, describe, expect, it } from "vitest"; chai.config.truncateThreshold = 0;
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { type ExtractedListItem, MISSING_FACT_REASON, NET_LINES_ATTR, netLinesOf } from "./itemListPricing";
import {
  DESCRIPTION_UNIT_NOTE, ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, VALVE_NETS, buildExtractionByRow, descriptionUnitOf, makePricingSheetHelper,
  type ItemListSuggestion, type ItemListView,
} from "./pricingSheetHelper";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { calculatorCtx } from "../../pricing/PricingCalculator";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h66 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v66.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));
const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const ITEMS: RateMasterItem[] = [...toItems(h66), ...toItems(e72)];
const CFG = new Map<string, RateCategoryConfig>([...h66.category_configs.map((c) => ({ ...c, discipline: "HVAC" })), ...e72.category_configs.map((c) => ({ ...c, discipline: "Electrical" }))].map((c) => [c.category_id, c as RateCategoryConfig]));
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const VALVE = "hvac_valve_package";

type Item = Record<string, string | null> & { _section?: string };
const mi = (a: Item): ExtractedListItem => {
  const { _section, ...attrs } = a;
  return { ...(_section ? { section: _section } : {}), attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v, confidence: v === null ? 0 : 0.9 }])) } as never;
};
type Row = { items: Item[]; unit?: string; text?: string; headings?: string[]; category?: string; discipline?: string };
const compute = (r: Row, ov: Record<string, string> = {}) => {
  const helper = makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS,
    extractionByRow: buildExtractionByRow([{ excel_row: 9, description: r.text ?? "", category_id: r.category ?? VALVE, attributes: {}, items: r.items.map(mi) }] as never) });
  return helper.compute({ excelRow: 9, description: r.text ?? "", nodeType: "Line Item", category: r.category ?? VALVE, discipline: r.discipline ?? "HVAC", rateKinds: KINDS,
    unit: r.unit ?? "Nos", quantity: 1, headings: r.headings ?? [], ownNotes: [], headingNotes: [] } as never, ov);
};
const one = (r: Row): ItemListView => (compute(r) as unknown as ItemListSuggestion).itemList!;
const totals = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];
const all = (v: ItemListView) => JSON.stringify(v);
const fams = (v: ItemListView) => v.items.map((b) => b.family);
const V = (fam: string | null, size: string | null, more: Item = {}): Item => ({ valve_type: fam, valve_type_as_written: fam, size_mm: size, ...more });
const M = (item: string, more: Item = {}): Item => ({ _section: "misc", item, item_as_written: item, size_mm: null, ...more });
const NONE = (said: string, more: Item = {}): Item => ({ valve_type: "none of these", valve_type_as_written: said, size_mm: null, ...more });
const misc = (v: ItemListView) => JSON.stringify(v.sections ?? []);

describe("VP-3 D1 -- a PIBCV's thermostat / controller / actuator is part of the PIBCV item", () => {
  const head = ["PIBCV - 2 way Modulating / Self Dynamic Balancing Valves along with thermostat"];
  it("POSITIVE: PIBCV 50 + 'none of these' Thermostat -> one PIBCV item, priced 50,699 / 1,000, with the line", () => {
    const v = one({ items: [V("PIBCV", "50 mm"), NONE("Thermostat")], text: "50 mm Dia", headings: head });
    expect(v.rowPriced).toBe(true);
    expect(totals(v)).toEqual([50699, 1000]);
    expect(fams(v)).toEqual(["PIBCV"]);
    expect(all(v)).toMatch(/BoQ names \\"Thermostat\\" with the PIBCV: thermostat \/ actuator included in the PIBCV item/);
  });
  it("POSITIVE: a controller, an actuator panel -> folded too (one item)", () => {
    expect(one({ items: [V("PIBCV", "32 mm"), NONE("Microprocessor Remote Controller (Thermostat)")] }).rowPriced).toBe(true);
    expect(totals(one({ items: [V("PIBCV", "40 mm"), NONE("Actuator panel")] }))).toEqual([35168, 1000]);
  });
  it("NEGATIVE: a 2-way modulating valve 'with thermostat' keeps its refusal (no PIBCV on the row)", () => {
    const v = one({ items: [V("2-Way Valve", "25 mm"), NONE("Thermostat")] });
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toMatch(/No SKU in the catalogue for Thermostat/);
  });
  it("NEGATIVE: a second VALVE named beside the PIBCV (a globe valve) is not folded", () => {
    expect(one({ items: [V("PIBCV", "50 mm"), NONE("globe type modulating control valve")] }).rowPriced).toBe(false);
  });
});

describe("VP-3 D2 -- 'dual plate' stated -> Dual Plate NRV over the flanged rule", () => {
  it("POSITIVE: heading 'wafer type dual plate check valves ... companion flanges', nrv_type None + flanged Yes -> Dual Plate 27,004 / 1,000", () => {
    const v = one({ items: [V("NRV / Check Valve", "250 mm", { nrv_type: "None", flanged: "Yes" })], text: "250 mm dia",
      headings: ["Supply and fixing of wafer type dual plate check valves PN16 complete with companion flanges"] });
    expect(totals(v)).toEqual([27004, 1000]);
    expect(all(v)).toMatch(/priced as the Dual Plate NRV \(a stated type wins over the flanged rule\)/);
  });
  it("NEGATIVE: a flanged NRV with no type named stays the Flanged NRV (44,331 / 1,000)", () => {
    const v = one({ items: [V("NRV / Check Valve", "250 mm", { nrv_type: "None", flanged: "Yes" })], text: "250 mm dia", headings: ["Check valves complete with companion flanges"] });
    expect(totals(v)).toEqual([44331, 1000]);
    expect(all(v)).not.toMatch(/Dual Plate NRV \(a stated/);
  });
});

describe("VP-3 D3 -- 'portable' / 'handed over' = supply only", () => {
  it("POSITIVE: a portable thermometer handed over -> 2,175 / 0 with the words quoted", () => {
    const v = one({ items: [M("Temperature Gauge / Thermometer", { scope: "Supply + installation" })],
      text: "Supply of portable dial type thermometer, the same shall be handed over in good working condition" });
    expect(totals(v)).toEqual([2175, 0]);
    expect(all(v)).toMatch(/BoQ says \\"portable\\" \/ \\"handed over\\" -> supply only, installation 0/);
  });
  it("NEGATIVE: 'Supply of ...' alone keeps the model's scope (supply + installation, 2,175 / 500)", () => {
    const v = one({ items: [M("Temperature Gauge / Thermometer", { scope: "Supply + installation" })], text: "Supply of dial type thermometer" });
    expect(totals(v)).toEqual([2175, 500]);
  });
});

describe("VP-3 D4 -- a gauge's tied, sizeless ball / gate valve is part of the gauge", () => {
  const text = "Pressure gauges ... Syphons and cocks to be provided. The price should include the cost of gate valve of suitable size";
  it("POSITIVE: gauge + sizeless Sluice / Gate Valve, tie words -> one gauge 2,175 / 500 with the line", () => {
    const v = one({ items: [V("Sluice / Gate Valve", null), M("Pressure Gauge")], text });
    expect(v.rowPriced).toBe(true);
    expect(totals(v)).toEqual([2175, 500]);
    expect(misc(v)).toMatch(/goes with the pressure gauge/);
  });
  it("POSITIVE: 'ball valve shall be provided and cost ... considered in this item' -> folded", () => {
    expect(totals(one({ items: [V("Ball Valve", null), M("Pressure Gauge")], text: "Pressure Guages, Ball valve shall be provided and cost of the same shall be considered in this item" }))).toEqual([2175, 500]);
  });
  it("NEGATIVE: a ball valve with its OWN size stays a separate valve (gauge + Ball 25)", () => {
    const v = one({ items: [V("Ball Valve", "25 mm"), M("Pressure Gauge")], text: "Pressure gauge with isolation 25 mm ball valve" });
    expect(totals(v)).toEqual([2175 + 682, 500 + 1000]);
  });
  it("POSITIVE: the row's scope answer, carried by the folded valve, survives (installation only: 0 / 500 x 1.5 = 750)", () => {
    const v = one({ items: [V("Ball Valve", null, { scope: "Installation only" }), M("Pressure Gauge")], text: "Installation of pressure gauges and ball valves with syphon tube" });
    expect(totals(v)).toEqual([0, 750]);
  });
  it("NEGATIVE: no gauge on the row -> a sizeless ball valve still refuses for its size", () => {
    expect(one({ items: [V("Ball Valve", null)], text: "Ball valve for isolation of suitable size" }).reason).toMatch(/no valve size stated/);
  });
});

describe("VP-3 D5 -- air vent + ball valve: the one size is the ball valve's", () => {
  it("POSITIVE: AAV 25 mm + sizeless Ball Valve -> list 1,802 / 2,000 with the line", () => {
    const v = one({ items: [V("Automatic Air Vent", "25 mm"), V("Ball Valve", null)], text: "25 mm Diameter" });
    expect(totals(v)).toEqual([1802, 2000]);
    expect(all(v)).toMatch(/The row's one size \(25 mm\) belongs to the ball valve/);
  });
  it("POSITIVE: 3/8\" -> the ball valve at 15 mm (below the smallest), 1,372 / 2,000", () => {
    expect(totals(one({ items: [V("Automatic Air Vent", "3/8\""), V("Ball Valve", null)] }))).toEqual([1372, 2000]);
  });
  it("POSITIVE: '15mm\"' (a stray inch mark) = 15 mm, not 15 inch", () => {
    const v = one({ items: [V("Automatic Air Vent", null), V("Ball Valve", "15mm\"")] });
    expect(totals(v)).toEqual([1372, 2000]);
    expect(all(v)).toMatch(/read as 15 mm \(a stray inch mark after/);
  });
  it("NEGATIVE: no size anywhere -> the ball valve still refuses 'no valve size stated'", () => {
    expect(one({ items: [V("Automatic Air Vent", null), V("Ball Valve", null)] }).reason).toMatch(/item 2 \(Ball Valve\): no valve size stated/);
  });
});

describe("VP-3 D7b -- 'BV' / 'Bal valve' at 40 mm and below is a ball valve", () => {
  it("POSITIVE: 'Φ 32 mm (BV)' read as Butterfly -> Ball Valve 32, 1,224 / 1,000, amber line", () => {
    const v = one({ items: [V("Butterfly Valve", "32 mm", { valve_type_as_written: "Butterfly valves" })], text: "Φ 32 mm (BV)" });
    expect(totals(v)).toEqual([1224, 1000]);
    expect(v.items[0].familyLine).toMatch(/BoQ says "BV" at 32 mm -> read as a Ball Valve/);
  });
  it("POSITIVE: 'Bal valve' with no type told -> Ball Valve 32", () => {
    expect(totals(one({ items: [V(null, "32 mm", { valve_type_as_written: "Bal valve" })], text: "Φ 32 mm - Bal valve" }))).toEqual([1224, 1000]);
  });
  it("NEGATIVE: 'BV' at 50 mm -> the model's reading stands (the butterfly)", () => {
    const v = one({ items: [V("Butterfly Valve", "50 mm", { valve_type_as_written: "Butterfly valves" })], text: "Φ 50 mm (BV)" });
    expect(fams(v)).toEqual(["Butterfly Valve"]);
    expect(v.items[0].familyLine ?? "").not.toMatch(/read as a Ball Valve/);
  });
  it("NEGATIVE: 'Ball valve' / 'Balancing valve' are not the abbreviation", () => {
    expect(VALVE_NETS.bv.test("Ball valve")).toBe(false);
    expect(VALVE_NETS.bv.test("Balancing valve")).toBe(false);
  });
});

describe("VP-3 D7c -- strainers and Sets", () => {
  it("POSITIVE (1): 'Ball Valve with strainer' 25 mm -> Ball 25 + Y-strainer at 50, 3,823 / 2,000, each its own block", () => {
    const v = one({ items: [V("Ball Valve", "25 mm")], text: "25 mm dia", headings: ["Ball Valve with strainer"] });
    expect(fams(v)).toEqual(["Ball Valve", "Strainer"]);
    expect(totals(v)).toEqual([3823, 2000]);
  });
  it("POSITIVE (2): an integral strainer -> + Y-strainer with the ruled note", () => {
    const v = one({ items: [V("Ball Valve", "25 mm")], text: "Ball valve with integral strainer 25 mm" });
    expect(totals(v)).toEqual([3823, 2000]);
    expect(all(v)).toMatch(/BoQ asks for an integral strainer; our ball valve has none, so a Y-strainer is added/);
  });
  it("POSITIVE (3): a Set 'ball valves one with Y-strainer and other without strainer' 25 mm -> 2 ball valves + 1 strainer, 4,505 / 3,000", () => {
    const v = one({ items: [V("Ball Valve", "25 mm")], unit: "Sets", text: "25mm dia valves", headings: ["ball valves one with Y-strainer and other without strainer"] });
    expect(fams(v)).toEqual(["Ball Valve", "Ball Valve", "Strainer"]);
    expect(totals(v)).toEqual([4505, 3000]);
    expect(all(v)).toMatch(/One Ball Valve WITH strainer in each Set/);
    expect(all(v)).toMatch(/One Ball Valve WITHOUT strainer in each Set/);
  });
  it("NEGATIVE: 'ball valve without strainer' -> the ball valve alone", () => {
    expect(totals(one({ items: [V("Ball Valve", "25 mm")], headings: ["Ball valve without strainer"] }))).toEqual([682, 1000]);
  });
  it("NEGATIVE: a strainer the model already listed is not doubled", () => {
    expect(fams(one({ items: [V("Ball Valve", "25 mm"), V("Strainer", "25 mm")], headings: ["Ball Valve with strainer"] }))).toEqual(["Ball Valve", "Strainer"]);
  });
});

describe("VP-3 D6 -- a blank unit read from the description, every category", () => {
  it("POSITIVE (valve): '100 mm | Nos', blank unit -> Butterfly 100 priced 4,108 / 1,000 + 'Unit read from the description: Nos'", () => {
    const v = one({ items: [V("Butterfly Valve", "100 mm")], unit: "", text: "100 mm | Nos" });
    expect(totals(v)).toEqual([4108, 1000]);
    expect(v.unitNote).toBe("Unit read from the description: Nos");
  });
  it("POSITIVE (valve, Lot): '| Lot' -> the usual Lot refusal applies", () => {
    expect(one({ items: [V("Butterfly Valve", "100 mm")], unit: "", text: "Valves | Lot" }).rowPriced).toBe(false);
  });
  it("POSITIVE (another category, Piping): '50 mm | Mtr' -> the D6 note replaces the 'No unit' default note", () => {
    const v = one({ items: [{ pipe_type: "MS", size_mm: "50 mm" }], category: "hvac_piping", unit: "", text: "50 mm | Mtr" });
    expect(v.unitNote).toBe("Unit read from the description: Mtr");
  });
  it("NEGATIVE: no unit piece -> 'no unit on this row' as before; a size is never a unit", () => {
    expect(one({ items: [V("Butterfly Valve", "100 mm")], unit: "", text: "100 mm" }).reason).toMatch(/no unit on this row/);
    expect(descriptionUnitOf({ excelRow: 1, description: "100 | mm", unit: "" } as never)).toBe(null);
    expect(descriptionUnitOf({ excelRow: 1, description: "Fire Extinguisher 1 Kg", unit: "" } as never)).toBe(null);
  });
  it("NEGATIVE: a row WITH a unit, and the calculator, never read the description", () => {
    expect(descriptionUnitOf({ excelRow: 1, description: "x | Nos", unit: "Set" } as never)).toBe(null);
    expect(descriptionUnitOf({ ...calculatorCtx("HVAC", VALVE), description: "x | Nos" } as never)).toBe(null);
    expect(DESCRIPTION_UNIT_NOTE).toBe("Unit read from the description: {unit}");
  });
});

describe("VP-3 C3 -- the refusal names the item that actually refuses", () => {
  it("POSITIVE: a sizeless drain cock + an unstocked 3-way valve -> the row names the 3-way valve", () => {
    const v = one({ items: [V("Ball Valve", null, { valve_type_as_written: "drain cock" }), NONE("3 way shutoff ball valves")] });
    expect(v.reason).toMatch(/item 2 \(none of these\): No SKU in the catalogue for 3 way shutoff ball valves/);
  });
  it("POSITIVE: no type told but the item's words name an unstocked 3-way -> named, not 'no valve type could be told'", () => {
    expect(one({ items: [V(null, "25 mm", { valve_type_as_written: "On-Off type 2/3 way motorised valves" })] }).reason).toMatch(/^No SKU in the catalogue for On-Off type 2\/3 way motorised valves/);
  });
  it("NEGATIVE: two missing facts -> the first item still names its own (unchanged order)", () => {
    expect(one({ items: [V("Ball Valve", null), V("Butterfly Valve", null)] }).reason).toMatch(/^item 1 \(Ball Valve\): no valve size stated/);
    expect(MISSING_FACT_REASON.test("valve size 400 is above the largest size on the sheet (300)")).toBe(false);
  });
});

describe("VP-3 the nets' plumbing", () => {
  it("a changed item drops the net lines (the pricer's change starts from the family alone)", () => {
    expect(netLinesOf({ attributes: { [NET_LINES_ATTR]: { value: "a\nb" } } } as never)).toEqual(["a", "b"]);
    expect(netLinesOf({ attributes: { [NET_LINES_ATTR]: { value: null } } } as never)).toEqual([]);
  });
  it("the calculator (no model items) is never touched by the nets", () => {
    const h = makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS, extractionByRow: new Map() });
    const r = h.compute(calculatorCtx("HVAC", VALVE), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "PIBCV", attrs: { size_mm: "50" } }] }), [ROW_UNIT_OVERRIDE_KEY]: "Nos" }) as unknown as ItemListSuggestion;
    expect([r.itemList!.totals?.supply_rate, r.itemList!.totals?.install_rate]).toEqual([50699, 1000]);
    expect(JSON.stringify(r)).not.toMatch(/owner D\d/);
  });
});
