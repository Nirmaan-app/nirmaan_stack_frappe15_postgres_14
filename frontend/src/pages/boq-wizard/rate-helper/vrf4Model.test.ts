/**
 * VRF-4 K1 (owner 2026-11-06 "q1 ok" / "q2 ok" / "q3 yes"; D-5 "option D"; D-9 "it should say check the quantity"; R-BRAND (a);
 * O-5 "...we can add a note") -- THE PRICER READS THE MODEL, per item, on a BoQ row: the four includes, the copied sizes /
 * thickness / cable / length, the brand as written, the refnet's covers + the unit counts added up from the sheet, and the
 * working + standby bar.
 *
 * FIXTURE: HVAC v59 + Electrical v72, with hvac_vrf's VRF-4 keys taken from `pricing/__fixtures__/vrf4Model.json` (the file
 * the v60 mint writes; test_vrf_v60 proves the asset equals it) and `calculator_only` taken OUT (as v60 has it). Proves the
 * CODE through the panel's entry point (`makePricingSheetHelper(...).compute`), positive AND negative, and that a config
 * without the keys behaves exactly as before.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import {
  boqExtrasOf, readCableSpecWords, readLengthWords, sheetUnitCounts, splitAsWrittenPair, workingStandbyWords,
  type ExtractedListItem, type ExtrasFromModel, type ItemListPricingSpec,
} from "./itemListPricing";
import {
  EXTRAS_INCLUDES_KEY, ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, buildExtractionByRow, makePricingSheetHelper,
  type ExtraLineView, type ItemListSuggestion, type ItemListView,
} from "./pricingSheetHelper";
import { rowQuantitiesOf } from "./rateSuggestionModel";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h59 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v59.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));
type Fx = {
  extras_from_model: ExtrasFromModel; extras_words: Record<string, string>; brand_from_attr: string;
  counted_from_sheet: Record<string, unknown>; working_standby: ItemListPricingSpec["working_standby"]; questions: unknown[];
};
const FX = readJsonFixture<Fx>(new URL("../../pricing/__fixtures__/vrf4Model.json", import.meta.url));
const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const ITEMS: RateMasterItem[] = [...toItems(h59), ...toItems(e72)];
const VRF = "hvac_vrf";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];

/** v59's hvac_vrf, calculator_only out, + the VRF-4 keys (each can be left out to prove the config without it is unchanged) */
const vrf4 = (omit: string[] = []): RateCategoryConfig => {
  const c = structuredClone(h59.category_configs.find((x) => x.category_id === VRF)) as Record<string, any>;
  delete c.calculator_only;
  const p = c.list_spec.pricing;
  if (!omit.includes("from_model")) { p.extras.from_model = structuredClone(FX.extras_from_model); p.extras.lines.boq_note = FX.extras_words.boq_note; }
  if (!omit.includes("brand")) p.defaults.brand.unlisted.from_attr = FX.brand_from_attr;
  if (!omit.includes("from_sheet")) p.per_set.counted.from_sheet = structuredClone(FX.counted_from_sheet);
  if (!omit.includes("working_standby")) p.working_standby = structuredClone(FX.working_standby);
  if (!omit.includes("questions")) c.list_spec.attribute_definitions = structuredClone(FX.questions);
  return c as RateCategoryConfig;
};
const configsOf = (vrf: RateCategoryConfig) => new Map<string, RateCategoryConfig>([
  ...h59.category_configs.map((c) => [c.category_id, c.category_id === VRF ? vrf : c] as [string, RateCategoryConfig]),
  ...e72.category_configs.map((c) => [c.category_id, c] as [string, RateCategoryConfig]),
]);
type Item = Record<string, string>;
const mi = (a: Item): ExtractedListItem => ({ attributes: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) });
/** a BoQ sheet: excel row -> { the model's items, the row's unit / qty / text, optionally a row-level `includes` cell } */
type Row = { items: Item[]; unit?: string; qty?: number; text?: string; cell?: string; category?: string };
const sheet = (rows: Record<number, Row>, cfg = vrf4()) => {
  const results = Object.entries(rows).map(([er, r]) => ({
    excel_row: Number(er), description: r.text ?? "", category_id: r.category ?? VRF,
    attributes: r.cell ? { includes: { value: r.cell, confidence: 1 } } : {}, items: r.items.map(mi),
  }));
  const helper = makePricingSheetHelper({ configsByCategory: configsOf(cfg), items: ITEMS, extractionByRow: buildExtractionByRow(results as never) });
  const priced = Object.entries(rows).map(([er, r]) => ({ source_row_number: Number(er), qty_total: r.qty ?? 1 }));
  const rowQuantities = rowQuantitiesOf(priced as never);
  return (er: number, overrides: Record<string, string> = {}): ItemListView => {
    const r = rows[er];
    const res = helper.compute({ excelRow: er, description: r.text ?? "", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: KINDS,
      unit: r.unit ?? "Nos", quantity: r.qty ?? 1, rowQuantities } as never, overrides) as unknown as ItemListSuggestion;
    return res.itemList!;
  };
};
const ODU = (more: Item = {}): Item => ({ item: "Outdoor Unit", brand: "Blue Star", capacity: "10 HP", ...more });
const lines = (v: ItemListView, b = 0): ExtraLineView[] => v.items[b].extras?.lines ?? [];
const byId = (v: ItemListView, id: string, b = 0) => lines(v, b).find((l) => l.id === id)!;
const val = (l: ExtraLineView, id: string) => l.fields.find((f) => f.id === id)?.value;
const tag = (l: ExtraLineView, id: string) => l.fields.find((f) => f.id === id)?.tagText;
const tot = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];

describe("VRF-4 B1 -- the includes are read PER ITEM from the model (owner 'q1 ok'); lines 'from the BoQ' + O-5's note", () => {
  it("includes_copper + includes_insulation = Yes -> four lines, each tagged 'from the BoQ', the O-5 note; the figures of v59 x 30 m", () => {
    const v = sheet({ 9: { items: [ODU({ includes_copper: "Yes", includes_insulation: "Yes" })] } })(9);
    expect(lines(v).map((l) => l.id)).toEqual(["copper_supply", "copper_return", "ins_supply", "ins_return"]);
    expect(lines(v).every((l) => l.fromBoq === true && l.fromBoqText === "from the BoQ")).toBe(true);
    expect(v.items[0].extras?.boqNote).toBe("The BoQ says this unit's price includes copper piping, insulation (read by the model). Each is priced below by its own sheet's rules.");
    expect(tot(v)).toEqual([301560 + 54420 + 38940 + 7950 + 7440, 10000 + 6600 * 2 + 420 * 2]);
    expect(v.extrasIncludes).toBeUndefined();   // no tick boxes on a BoQ row
  });
  it("all four Yes -> 7 items, = the calculator's four ticks (441,210 / 25,960, VRF-3b C1)", () => {
    const v = sheet({ 9: { items: [ODU({ includes_copper: "Yes", includes_insulation: "Yes", includes_power: "Yes", includes_comm: "Yes" })] } })(9);
    expect(v.lineCount).toEqual({ lines: 7, bad: 0 });
    expect(tot(v)).toEqual([441210, 25960]);
  });
  it("NEGATIVE: None / No / blank include nothing; insulation alone needs copper; the row's `includes` cell is NOT read once the config reads the item", () => {
    for (const a of [{}, { includes_copper: "No", includes_power: "None" }, { includes_insulation: "Yes" }] as Item[]) {
      const v = sheet({ 9: { items: [ODU(a)] } })(9);
      expect(v.items[0].extras).toBeUndefined();
      expect(tot(v)).toEqual([301560, 10000]);
    }
    const cellOnly = sheet({ 9: { items: [ODU()], cell: "copper,insulation,power,comm" } })(9);
    expect(cellOnly.items[0].extras).toBeUndefined();
  });
  it("two items on one row read their OWN includes: the outdoor unit power only, the hi-wall comm only", () => {
    const v = sheet({ 9: { items: [ODU({ includes_power: "Yes" }), { item: "Hi-Wall", brand: "Blue Star", capacity: "1.5 TR", includes_comm: "Yes" }] } })(9);
    expect(lines(v, 0).map((l) => l.id)).toEqual(["power"]);
    expect(lines(v, 1).map((l) => l.id)).toEqual(["comm"]);
  });
  it("q3: a split copied WHOLE on one item ('38HP (20+18)') -> two modules, EACH inheriting the item's includes", () => {
    const v = sheet({ 14: { items: [ODU({ capacity: "38HP (20+18)", includes_power: "Yes" })], text: "System-1 38HP (20+18)" } })(14);
    expect(v.items.length).toBe(2);
    expect(lines(v, 0).map((l) => l.id)).toEqual(["power"]);
    expect(lines(v, 1).map((l) => l.id)).toEqual(["power"]);
  });
  it("NEGATIVE: the calculator is unchanged -- its tick boxes decide, a config without `from_model` reads the row cell as VRF-3b did", () => {
    const calc = makePricingSheetHelper({ configsByCategory: configsOf(vrf4()), items: ITEMS, extractionByRow: new Map() });
    const c = (calc.compute(calculatorCtx("HVAC", VRF), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "Outdoor Unit", attrs: { brand: "Blue Star", capacity: "10" } }] }),
      [ROW_UNIT_OVERRIDE_KEY]: "Nos", [EXTRAS_INCLUDES_KEY]: "copper,insulation,power,comm" }) as unknown as ItemListSuggestion).itemList!;
    expect(tot(c)).toEqual([441210, 25960]);
    expect(c.extrasIncludes?.options.map((o) => o.checked)).toEqual([true, true, true, true]);
    expect(lines(c).some((l) => l.fromBoq)).toBe(false);
    const old = sheet({ 9: { items: [ODU({ includes_power: "Yes" })], cell: "copper" } }, vrf4(["from_model"]))(9);
    expect(lines(old).map((l) => l.id)).toEqual(["copper_supply", "copper_return"]);
    expect(old.items[0].extras?.boqNote).toBeUndefined();
  });
});

describe("VRF-4 B1 -- the copied words feed the lines' fields ('*_as_written' -> extra_<line>_<field>)", () => {
  it("pure: a pair = supply / return; a fraction stays one; cable words -> cores + sqmm; a length in metres", () => {
    expect(splitAsWrittenPair("12.7 mm / 6.4 mm")).toEqual(["12.7 mm", "6.4 mm"]);
    expect(splitAsWrittenPair("12.7/6.4")).toEqual(["12.7", "6.4"]);
    expect(splitAsWrittenPair('1/2" & 1/4"')).toEqual(['1/2"', '1/4"']);
    expect(splitAsWrittenPair('1/2"')).toEqual(['1/2"']);
    expect(splitAsWrittenPair("40/50")).toEqual(["40", "50"]);
    expect(splitAsWrittenPair("19 mm")).toEqual(["19 mm"]);
    expect(splitAsWrittenPair("")).toEqual([]);
    expect(readCableSpecWords("4C x 10")).toEqual({ cores: 4, sqmm: 10 });
    expect(readCableSpecWords("4 core x 10 sqmm")).toEqual({ cores: 4, sqmm: 10 });
    expect(readCableSpecWords("2C x 1.5 Sqmm copper")).toEqual({ cores: 2, sqmm: 1.5 });
    expect(readCableSpecWords("3 cores x 2.5 sq mm flexible")).toEqual({ cores: 3, sqmm: 2.5 });
    expect(readCableSpecWords("3 core flexible copper cable")).toBeNull();
    expect(readLengthWords("up to 15 m")).toBe("15");
    expect(readLengthWords("first 10 RMT")).toBe("10");
    expect(readLengthWords("15 mtr")).toBe("15");
    expect(readLengthWords("as required")).toBeNull();
  });
  it("pure: boqExtrasOf maps one item's answers to the lines (a single size = both lines; 'control' = the communication cable)", () => {
    const fm = FX.extras_from_model;
    const one = boqExtrasOf(mi({ includes_copper: "Yes", includes_comm: "yes", extra_copper_size_as_written: "15.9 mm", extra_cable_spec_as_written: "control cable 2C x 1.5 sqmm", extra_length_as_written: "up to 15 m" }), fm);
    expect([...one.includes].sort()).toEqual(["comm", "copper"]);
    expect(one.values).toEqual({ copper_supply_size: "15.9 mm", copper_return_size: "15.9 mm", comm_cores: "2", comm_sqmm: "1.5",
      copper_supply_length: "15", copper_return_length: "15", power_length: "15", comm_length: "15" });
    const words = boqExtrasOf(mi({ includes_power: "Yes", extra_cable_spec_as_written: "3 core flexible copper cable" }), fm);
    expect(words.values).toEqual({ power_spec: "3 core flexible copper cable" });
    expect(boqExtrasOf(undefined, fm).values).toEqual({});
    expect(boqExtrasOf(mi({ includes_copper: "Yes" }), undefined).includes.size).toBe(0);
  });
  it("on the panel: '12.7 / 6.4' sizes the copper lines (tag 'from the BoQ'), '19 mm' the insulation, '4 core x 10 sqmm' the power cable, '15 m' every length", () => {
    const v = sheet({ 9: { items: [ODU({ includes_copper: "Yes", includes_insulation: "Yes", includes_power: "Yes",
      extra_copper_size_as_written: "12.7 / 6.4", extra_insulation_thickness_as_written: "19 mm", extra_cable_spec_as_written: "4 core x 10 sqmm",
      extra_length_as_written: "up to 15 m" })] } })(9);
    expect(val(byId(v, "copper_supply"), "size")).toBe("12.7");
    expect(val(byId(v, "copper_return"), "size")).toBe("6.4");
    expect(tag(byId(v, "copper_supply"), "size")).toBe("from the BoQ");
    expect(val(byId(v, "ins_supply"), "thickness")).toBe("19");
    expect(tag(byId(v, "ins_supply"), "thickness")).toBe("from the BoQ");
    expect([val(byId(v, "power"), "cores"), val(byId(v, "power"), "sqmm"), val(byId(v, "power"), "spec")]).toEqual(["4", "10", "4C x 10"]);
    expect(tag(byId(v, "power"), "cores")).toBe("from the BoQ");
    expect(val(byId(v, "copper_supply"), "length")).toBe("15");
    expect(tag(byId(v, "power"), "length")).toBe("from the BoQ");
    expect(val(byId(v, "ins_supply"), "length")).toBe("15");   // follows its copper line
  });
  it("NEGATIVE: no copied words -> the Pricing Inputs defaults (amber), exactly as on the calculator", () => {
    const v = sheet({ 9: { items: [ODU({ includes_copper: "Yes", includes_power: "Yes" })] } })(9);
    expect(val(byId(v, "copper_supply"), "size")).toBe("22.2");
    expect(tag(byId(v, "copper_supply"), "size")).toBe("default (Pricing Inputs)");
    expect(val(byId(v, "power"), "spec")).toBe("4C x 10");
    expect(val(byId(v, "power"), "length")).toBe("30");
  });
});

describe("VRF-4 B1 -- the brand as written (R-BRAND (a) on a BoQ row)", () => {
  const brandOf = (a: Item, cfg = vrf4()) => {
    const v = sheet({ 9: { items: [{ item: "Outdoor Unit", capacity: "10 HP", ...a }] } }, cfg)(9);
    const b = v.items[0];
    return { value: b.fields.find((f) => f.id === "brand")?.value, line: JSON.stringify(b).match(/(several brands stated[^"]*|brand [^"]* is not on the sheet[^"]*)/)?.[0] ?? null, supply: b.figures.supply_rate };
  };
  it("several makes -> priced as Blue Star with the several line; one off the sheet -> the off-sheet line", () => {
    expect(brandOf({ brand: "Daikin", brand_as_written: "Daikin / Toshiba" }).line).toBe("several brands stated (Daikin / Toshiba) - priced as Blue Star");
    expect(brandOf({ brand_as_written: "Toshiba" }).line).toBe("brand Toshiba is not on the sheet - priced as Blue Star");
  });
  it("NEGATIVE: a listed choice is kept when the copy names one make ('DAIKEN' + Daikin); one listed make fills a blank choice with no line", () => {
    const k = brandOf({ brand: "Daikin", brand_as_written: "DAIKEN" });
    expect(k.line).toBeNull();
    const kd = brandOf({ brand: "Daikin" });
    expect(k.supply).toBe(kd.supply);
    const fill = brandOf({ brand_as_written: "Blue Star" });
    expect(fill.line).toBeNull();
    expect(fill.supply).toBe(brandOf({ brand: "Blue Star" }).supply);
    // without `from_attr` the copy is not read: a blank choice is the default's own line
    expect(brandOf({ brand_as_written: "Toshiba" }, vrf4(["brand"])).line).toBeNull();
  });
});

describe("VRF-4 B1 -- refnet counts added up from the sheet's VRF unit rows (owner 'q2 ok'), set_covers from the model", () => {
  const WHOLE = "Whole system (indoor + outdoor)";
  const rows = (refnetQty: number, extra: Record<number, Row> = {}): Record<number, Row> => ({
    14: { items: [ODU({ capacity: "20 HP" })], qty: 2 },
    15: { items: [ODU({ capacity: "18 HP" })], qty: 1 },
    20: { items: [{ item: "Hi-Wall", capacity: "1 TR" }], qty: 10 },
    21: { items: [{ item: "Cassette", capacity: "2 TR" }, { item: "Cassette", capacity: "3 TR" }], qty: 7 },
    115: { items: [{ item: "Refnet/Y-Joint", set_covers: WHOLE }], unit: "Set", qty: refnetQty },
    ...extra,
  });
  it("pure: outdoor 2 + 1 = 3, indoor 10 + 2 x 7 = 24; the asking row and other categories are never counted", () => {
    const fs = FX.counted_from_sheet as never;
    const ext = [
      { excelRow: 14, category: VRF, items: [mi({ item: "Outdoor Unit" })] }, { excelRow: 15, category: VRF, items: [mi({ item: "Outdoor Unit" })] },
      { excelRow: 20, category: VRF, items: [mi({ item: "Hi-Wall" })] }, { excelRow: 21, category: VRF, items: [mi({ item: "Cassette" }), mi({ item: "Cassette" })] },
      { excelRow: 30, category: "hvac_adp", items: [mi({ item: "Outdoor Unit" })] }, { excelRow: 115, category: VRF, items: [mi({ item: "Outdoor Unit" })] },
    ];
    const c = sheetUnitCounts(fs, ext, 115, VRF, { 14: 2, 15: 1, 20: 10, 21: 7, 30: 5, 115: 9 }, "item");
    expect(c.outdoor.n).toBe(3);
    expect(c.indoor.n).toBe(24);
    expect(c.indoor.rows).toEqual([{ row: 20, units: 1, qty: 10 }, { row: 21, units: 2, qty: 7 }]);
  });
  it("on the panel: the counts fill the refnet's fields with the rows named, (3-1) + (24-1) = 25 expected; BoQ qty 25 -> 1 piece", () => {
    const v = sheet(rows(25))(115);
    const f = v.items[0].setCount!.fields;
    expect(f.map((x) => x.value)).toEqual([WHOLE, "3", "24"]);
    expect(f[1].fromSheet).toBe(true);
    expect(f[1].note).toBe("Counted from this sheet: 3 outdoor units (row 14 x 2, row 15 x 1). Change it if this row's system differs.");
    expect(f[2].note).toBe("Counted from this sheet: 24 indoor units (row 20 x 10, row 21 (2 units) x 7). Change it if this row's system differs.");
    expect(v.items[0].qty).toBe("1");
    expect(v.rowPriced).toBe(true);
  });
  it("editable: a typed count wins (and carries its undo arrow); set_covers left blank by the model holds the row", () => {
    const v = sheet(rows(25))(115, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: 0, family: null, attrs: { set_odu: "2" } }] }) });
    const f = v.items[0].setCount!.fields;
    expect(f.map((x) => x.value)).toEqual([WHOLE, "2", "24"]);
    expect(f[1].edited).toBe(true);
    expect(f[1].fromSheet).toBeUndefined();
    const noCovers = sheet({ ...rows(25), 115: { items: [{ item: "Refnet/Y-Joint" }], unit: "Set", qty: 25 } })(115);
    expect(noCovers.rowPriced).toBe(false);
  });
  it("NEGATIVE: no unit rows read on the sheet -> the counts stay blank with the 'type the count' note; without `from_sheet` the fields are typed only", () => {
    const lone = sheet({ 115: { items: [{ item: "Refnet/Y-Joint", set_covers: WHOLE }], unit: "Set", qty: 25 } })(115);
    expect(lone.items[0].setCount!.fields.map((x) => x.value)).toEqual([WHOLE, "", ""]);
    expect(lone.items[0].setCount!.fields[1].note).toBe("No outdoor unit was read on this sheet - type the count.");
    expect(lone.rowPriced).toBe(false);
    const off = sheet(rows(25), vrf4(["from_sheet"]))(115);
    expect(off.items[0].setCount!.fields.map((x) => x.value)).toEqual([WHOLE, "", ""]);
    // a Nos refnet row is one piece per Nos: no count is read at all
    const nos = sheet(rows(25, { 115: { items: [{ item: "Refnet/Y-Joint", set_covers: WHOLE }], unit: "Nos", qty: 25 } }))(115);
    expect(nos.items[0].setCount).toBeUndefined();
  });
});

describe("VRF-4 B1 -- WORKING + STANDBY (D-5 option D, D-9): the red bar on the model's W+S words ONLY; ONE unit, never doubled", () => {
  const WS = FX.working_standby!;
  it("pure: W+S, 1W+1S, N+N, 2N+N, 'working + standby', '1 Working + 1 Standby' fire; standby-only and damper modes never", () => {
    for (const t of ["W+S", "1W+1S", "1 W + 1 S", "N+N", "2N+N", "WORKING + STANDBY", "2# (WORKING + STANDBY)", "1 Working + 1 Standby", "Working and standby"]) {
      expect(workingStandbyWords(WS, t)).toBe(t);
    }
    for (const t of ["(Standby)", "Standby units for Lab area", "Critical Room Standby", "Working/Standby Mode", "working", "", null, "WS-1"]) {
      expect(workingStandbyWords(WS, t)).toBeNull();
    }
    expect(workingStandbyWords(undefined, "1W+1S")).toBeNull();
  });
  it("on the panel: the bar above the card, the D-9 sentence with the BoQ quantity, the ring; figures EQUAL to the same row without it", () => {
    const v = sheet({ 36: { items: [ODU({ capacity: "12 HP", working_standby_as_written: "WORKING + STANDBY" })], qty: 2, unit: "Nos." } })(36);
    expect(v.standbyBar).toEqual({
      title: "WORKING + STANDBY - THIS RATE IS FOR 1 UNIT ONLY.",
      lines: ["The BoQ says \"WORKING + STANDBY\" and its quantity is 2. Working and standby must be priced together: check that the quantity covers both before changing the rate."],
      ring: "Unit Nos. · Qty 2",
    });
    const plain = sheet({ 36: { items: [ODU({ capacity: "12 HP" })], qty: 2, unit: "Nos." } })(36);
    expect(plain.standbyBar).toBeUndefined();
    expect(tot(v)).toEqual(tot(plain));
    expect(v.items[0].qty).toBe(plain.items[0].qty);
  });
  it("NEGATIVE: '(Standby)' copied -> no bar; a config without `working_standby` -> no bar", () => {
    expect(sheet({ 28: { items: [ODU({ capacity: "14 HP", working_standby_as_written: "(Standby)" })] } })(28).standbyBar).toBeUndefined();
    expect(sheet({ 36: { items: [ODU({ capacity: "12 HP", working_standby_as_written: "1W+1S" })], qty: 2 } }, vrf4(["working_standby"]))(36).standbyBar).toBeUndefined();
  });
});
