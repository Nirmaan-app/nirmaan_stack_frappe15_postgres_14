/**
 * VRF-3b (owner O-5 / O-6 / B / SHEETS 2026-11-03; 2026-11-05 11:30-14:56; boards 12-15) -- THE EXTRAS A UNIT'S PRICE
 * INCLUDES, the per-field undo, Lot in the calculator.
 *
 * FIXTURE: v58 + Electrical v72, with hvac_vrf's `extras` and the 13 Pricing Inputs taken from
 * `pricing/__fixtures__/vrf3bExtras.json` (the file the v59 mint writes; test_vrf_v59 proves the asset equals it) and
 * `calculator_only` left in (the calculator surface admits it). Proves the CODE, positive AND negative: bands after
 * conversion, closest sizes, rates by Piping / Insulation / Electrical's own rules, tags, a typed size, the blank hold,
 * removal / put back / no re-add, per module, Lot, the undo operations -- and that a config without `extras` is untouched.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import {
  closestSize, extraBandOf, itemListPricingSpec, parseCableSpec, pricingInputRates, readTypedSizeMm, type ExtrasSpec,
} from "./itemListPricing";
import {
  EXTRAS_INCLUDES_KEY, ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, decodeItemEdits, extrasIncludesOf,
  makePricingSheetHelper, unitChoicesOf, type ExtraLineView, type ItemListEditState, type ItemListSuggestion, type ItemListView,
} from "./pricingSheetHelper";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";
import { computePricingInputReach, extrasSnapSizes, extrasTablesOf, extrasUses, reachedSkuCount } from "../../pricing/rate-master/pricingInputReach";
import { pricingInputUsedBy } from "../../pricing/rate-master/rateMasterSpec";
import { computeExampleImpacts, exampleCrossTargets } from "../../pricing/rate-master/pricingInputExamples";
import { mergeItemsByName } from "./rateHelperPlumbing";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h58 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v58.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));
const FIX = readJsonFixture<{ extras: ExtrasSpec; inputs: Array<Record<string, any>>; examples: Array<Record<string, unknown>> }>(new URL("../../pricing/__fixtures__/vrf3bExtras.json", import.meta.url));
const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const INPUTS = FIX.inputs.map((it, n) => ({ ...it, item_uid: `rmi-fx${n}`, discipline: "HVAC" } as unknown as RateMasterItem));
const ITEMS: RateMasterItem[] = [...toItems(h58), ...toItems(e72), ...INPUTS];
const VRF = "hvac_vrf";
const withExtras = (extras: ExtrasSpec | null = FIX.extras): RateCategoryConfig => {
  const c = structuredClone(h58.category_configs.find((x) => x.category_id === VRF)) as Record<string, any>;
  if (extras) c.list_spec.pricing.extras = structuredClone(extras);
  return c as RateCategoryConfig;
};
const configsOf = (vrf: RateCategoryConfig, opts: { noElectrical?: boolean } = {}) => new Map<string, RateCategoryConfig>([
  ...h58.category_configs.map((c) => [c.category_id, c.category_id === VRF ? vrf : c] as [string, RateCategoryConfig]),
  ...(opts.noElectrical ? [] : e72.category_configs.map((c) => [c.category_id, c] as [string, RateCategoryConfig])),
]);
const calcOf = (vrf = withExtras(), items = ITEMS, opts: { noElectrical?: boolean } = {}) =>
  makePricingSheetHelper({ configsByCategory: configsOf(vrf, opts), items, extractionByRow: new Map(), calculatorSurface: true });
const CALC = calcOf();
const ALL = "copper,insulation,power,comm";
const run = (blocks: Array<Record<string, unknown>>, inc = ALL, unit = "Nos", calc = CALC): ItemListView =>
  (calc.compute(calculatorCtx("HVAC", VRF), {
    [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: blocks }), [ROW_UNIT_OVERRIDE_KEY]: unit, [EXTRAS_INCLUDES_KEY]: inc,
  }) as unknown as ItemListSuggestion).itemList!;
const unit = (family: string, capacity: string, more: Record<string, unknown> = {}) => ({ base: null, family, attrs: { brand: "Blue Star", capacity }, ...more });
const ODU10 = unit("Outdoor Unit", "10");
const lines = (v: ItemListView, b = 0): ExtraLineView[] => v.items[b].extras?.lines ?? [];
const fig = (l: ExtraLineView) => [l.figures.supply_rate, l.figures.install_rate];
const val = (l: ExtraLineView, id: string) => l.fields.find((f) => f.id === id)?.value;
const fieldOf = (l: ExtraLineView, id: string) => l.fields.find((f) => f.id === id)!;
const byId = (v: ItemListView, id: string, b = 0) => lines(v, b).find((l) => l.id === id)!;
const tot = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];

describe("VRF-3b C1 / C2 / C3 -- the lines from the defaults, each by its own category's rules", () => {
  it("C1 (AC0): 10 HP outdoor, all four ticked -> 7 lines, the figures of the v58 / E72 catalogues x 30 m, every default tagged", () => {
    const v = run([ODU10]);
    expect(v.rowPriced).toBe(true);
    expect(v.lineCount).toEqual({ lines: 7, bad: 0 });
    expect([v.items[0].figures.supply_rate, v.items[0].figures.install_rate]).toEqual([301560, 10000]);
    expect(lines(v).map((l) => [l.id, ...fig(l)])).toEqual([
      ["copper_supply", 54420, 6600], ["copper_return", 38940, 6600], ["ins_supply", 7950, 420], ["ins_return", 7440, 420],
      ["power", 28500, 1200], ["comm", 2400, 720],
    ]);
    expect(tot(v)).toEqual([441210, 25960]);
    expect(val(byId(v, "copper_supply"), "size")).toBe("22.2");
    expect(val(byId(v, "copper_return"), "size")).toBe("15.9");
    expect(val(byId(v, "ins_supply"), "thickness")).toBe("19");
    expect(fieldOf(byId(v, "ins_supply"), "size").note).toBe("22.23 mm (follows the copper line)");
    expect(val(byId(v, "power"), "spec")).toBe("4C x 10");
    expect(val(byId(v, "comm"), "spec")).toBe("2C x 1.5");
    for (const l of lines(v)) {
      expect(l.heading).toMatch(/^Item \d+ · extra the BoQ includes · from (Piping|Insulation|Electrical)$/);
      const size = l.fields[0];
      if (size.id !== "size") expect(size.tagText).toBe("default (Pricing Inputs)");
      expect(fieldOf(l, "count").tagText).toBe("default");
    }
    expect(lines(v).map((l) => l.lineNo)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(v.items[0].lineNo).toBe(1);
    expect(byId(v, "copper_supply").working).toEqual([
      "Copper pipe - supply line 22.2 mm: per metre by Piping's rules, supply 1814 + install 220",
      "Per Nos: 30 m x 1814 = 54420 supply; 30 m x 220 = 6600 install (rounded up)",
    ]);
  });
  it("C2: Hi-Wall 1.5 TR -> 12.7 / 6.4 mm, insulation on 12.7 / 6.35, 3C x 1.5 power", () => {
    const v = run([unit("Hi-Wall", "1.5")]);
    expect(lines(v).map((l) => [l.id, ...fig(l)])).toEqual([
      ["copper_supply", 28080, 6600], ["copper_return", 11700, 6600], ["ins_supply", 7140, 420], ["ins_return", 6360, 420],
      ["power", 3600, 720], ["comm", 2400, 720],
    ]);
    expect(fieldOf(byId(v, "ins_return"), "size").value).toBe("6.35");
  });
  it("C3: 54 HP splits 28 + 26 and EACH module carries its own six extras (34.9 / 22.2 mm, 4C x 16)", () => {
    const v = run([unit("Outdoor Unit", "54")]);
    expect(v.items.length).toBe(2);
    expect(v.lineCount).toEqual({ lines: 14, bad: 0 });
    for (const b of [0, 1]) {
      expect(lines(v, b).length).toBe(6);
      expect(val(byId(v, "copper_supply", b), "size")).toBe("34.9");
      expect(val(byId(v, "copper_return", b), "size")).toBe("22.2");
      expect(val(byId(v, "power", b), "spec")).toBe("4C x 16");
    }
    expect(v.items[1].lineNo).toBe(8);
  });
});

describe("VRF-3b BANDS (AC1) -- per unit, after conversion; an edge belongs to the band below", () => {
  const pipe = (fam: string, cap: string) => val(byId(run([unit(fam, cap)], "copper"), "copper_supply"), "size");
  const power = (fam: string, cap: string) => val(byId(run([unit(fam, cap)], "power"), "power"), "spec");
  it("indoor 4.0 vs 4.1 TR (pipes and power); outdoor 12 vs 14 and 20 vs 22 HP (pipes); 8 vs 10 and 14 vs 16 HP (power)", () => {
    expect([pipe("Ductable", "4"), pipe("Ductable", "4.1")]).toEqual(["12.7", "15.9"]);
    expect([power("Ductable", "4"), power("Ductable", "4.1"), power("Ductable", "8")]).toEqual(["3C x 1.5", "3C x 2.5", "3C x 2.5"]);
    expect([pipe("Outdoor Unit", "12"), pipe("Outdoor Unit", "14"), pipe("Outdoor Unit", "20"), pipe("Outdoor Unit", "22")]).toEqual(["22.2", "28.6", "28.6", "34.9"]);
    expect([power("Outdoor Unit", "8"), power("Outdoor Unit", "10"), power("Outdoor Unit", "14"), power("Outdoor Unit", "16")]).toEqual(["4C x 6", "4C x 10", "4C x 10", "4C x 16"]);
  });
  it("after conversion: 8 TR on an outdoor unit is 10 HP -> the 12-HP band; 4.1 TR stated, laddered to 5 TR, bands on 4.1", () => {
    expect(pipe("Outdoor Unit", "8 TR")).toBe("22.2");
    expect(power("Outdoor Unit", "8 TR")).toBe("4C x 10");
    // the STATED size bands, not the rung it laddered to: TFA stocks 3.5 / 5.5 TR -- 3.8 prices on the 5.5 unit, its pipes
    // are the up-to-4-TR sizes
    const tfa = run([unit("Single Skin Treated Fresh Air", "3.8")], "copper");
    expect(tfa.rowPriced).toBe(true);
    expect(val(byId(tfa, "copper_supply"), "size")).toBe("12.7");
  });
  it("NEGATIVE: indoor above 8 TR has no power default -> that line red 'no default for this size', the row held", () => {
    const v = run([unit("Packaged Unit", "10")], "power,comm");
    const p = byId(v, "power");
    expect(p.state).toBe("blank");
    expect(p.reason).toBe("No default for this size (10 TR) - pick a cable spec.");
    expect(byId(v, "comm").state).toBe("priced");
    expect(v.rowPriced).toBe(false);
    expect(v.lineCount).toEqual({ lines: 3, bad: 1 });
  });
  it("a table row is read cell by cell (one single-factor input per cell); a missing cell is absent", () => {
    expect(pricingInputRates(ITEMS, "vrf_extra_pipe_outdoor_upto_12hp")).toEqual({ supply_mm: 22.2, return_mm: 15.9, insulation_mm: 19 });
    expect(pricingInputRates(ITEMS, "vrf_extra_comm_cable")).toEqual({ cores: 2, sqmm: 1.5 });
    expect(pricingInputRates(ITEMS.filter((it) => (it.attributes as Record<string, unknown>)?.item !== "vrf_extra_comm_cable_sqmm"), "vrf_extra_comm_cable")).toEqual({ cores: 2 });
    expect(pricingInputRates(ITEMS, "vrf_extra_nothing")).toBeNull();
    expect(INPUTS.length).toBe(29);
    expect(INPUTS.every((i) => Object.keys((i.rates ?? {}) as object).join() === "factor")).toBe(true);
  });
  it("the pure band reader: edges, open last band, no band, unknown size", () => {
    const b = FIX.extras.power_bands.indoor;
    expect(extraBandOf(b, 4)?.input).toBe("vrf_extra_power_indoor_upto_4tr");
    expect(extraBandOf(b, 4.01)?.input).toBe("vrf_extra_power_indoor_4_to_8tr");
    expect(extraBandOf(b, 8.5)).toBeNull();
    expect(extraBandOf(FIX.extras.pipe_bands.outdoor, 300)?.input).toBe("vrf_extra_pipe_outdoor_above_20hp");
    expect(extraBandOf(b, null)).toBeNull();
  });
});

describe("VRF-3b SIZES (AC1 / AC3) -- the closest stocked size; a typed size (mm or inch) is replaced by the one used", () => {
  it("closestSize / readTypedSizeMm / parseCableSpec", () => {
    const ins = [6.35, 9.52, 12.7, 15.88, 19.05, 22.23, 28.58, 34.93];
    expect([6.4, 9.5, 15.9, 19.1, 22.2, 28.6, 34.9].map((x) => closestSize(x, ins))).toEqual([6.35, 9.52, 15.88, 19.05, 22.23, 28.58, 34.93]);
    expect(closestSize(12, [6.4, 9.5, 12.7])).toBe(12.7);
    expect(closestSize(null, ins)).toBeNull();
    expect(readTypedSizeMm("1.125 inch")).toBeCloseTo(28.575, 6);
    expect(readTypedSizeMm("1 1/8\"")).toBeCloseTo(28.575, 6);
    expect(readTypedSizeMm("15 mm")).toBe(15);
    expect(readTypedSizeMm("abc")).toBeNull();
    expect(parseCableSpec("4C x 10")).toEqual({ cores: 4, sqmm: 10 });
    expect(parseCableSpec("4c*10 sqmm")).toEqual({ cores: 4, sqmm: 10 });
    expect(parseCableSpec("10")).toBeNull();
  });
  it("C5: a picked 9.5 shows 'picked by you' and prices; '1.125 inch' typed -> 28.6 used, the note, its insulation follows to 28.58", () => {
    const p = run([{ ...ODU10, extras: { set: { copper_supply: { size: "9.5" } } } }]);
    const cs = byId(p, "copper_supply");
    expect(val(cs, "size")).toBe("9.5");
    expect(fieldOf(cs, "size").tagText).toBe("picked by you");
    expect(fieldOf(cs, "size").userEdited).toBe(true);
    expect(fig(cs)).toEqual([12870, 6600]);
    const t = run([{ ...ODU10, extras: { set: { copper_supply: { size: "1.125 inch" } } } }]);
    const ct = byId(t, "copper_supply");
    expect(val(ct, "size")).toBe("28.6");
    expect(fieldOf(ct, "size").note).toBe("You typed 1.125 inch -> 28.6 mm, the closest Piping size (only it is used).");
    expect(fieldOf(ct, "size").otherMode).toBe(true);
    expect(fieldOf(byId(t, "ins_supply"), "size").value).toBe("28.58");
  });
  it("NEGATIVE: an unreadable typed size holds the line ('Size needed. ...'); an unstocked cable spec holds its line", () => {
    const v = run([{ ...ODU10, extras: { set: { copper_supply: { size: "big" }, power: { spec: "3C x 400" } } } }]);
    expect(byId(v, "copper_supply").reason).toBe("Size needed. \"big\" is not a size. Pick a size, or fill the table.");
    expect(byId(v, "ins_supply").reason).toBe("Size needed. Its copper line has no size yet. Pick a size, or fill the table.");
    // K1b (owner ANSWER 2): the sentence names the conductor and the armour picked (BEFORE: "3C x 400 unarmoured copper cable ...")
    expect(byId(v, "power").reason).toBe("3C x 400 copper unarmoured cable is not stocked - pick a spec.");
    expect(v.rowPriced).toBe(false);
    expect(v.lineCount).toEqual({ lines: 7, bad: 3 });
  });
});

describe("VRF-3b LENGTH / COUNT / TAGS (AC3)", () => {
  it("C6: length 25 on the supply copper moves it AND its insulation (insulation = copper); the return side stays 30", () => {
    const v = run([{ ...ODU10, extras: { set: { copper_supply: { length: "25" } } } }]);
    expect(fig(byId(v, "copper_supply"))).toEqual([45350, 5500]);
    expect(fig(byId(v, "ins_supply"))).toEqual([6625, 350]);
    expect(fieldOf(byId(v, "ins_supply"), "length").tagText).toBe("follows the copper line");
    expect(fig(byId(v, "copper_return"))).toEqual([38940, 6600]);
  });
  it("How many in one Nos multiplies the rounded-up line; a 0 or blank count holds the line", () => {
    const v = run([{ ...ODU10, extras: { set: { power: { count: "2" } } } }]);
    expect(fig(byId(v, "power"))).toEqual([57000, 2400]);
    expect(byId(v, "power").working[2]).toBe("x 2 in one Nos of this row = 57000 supply + 2400 install");
    const z = run([{ ...ODU10, extras: { set: { power: { count: "" } } } }]);
    expect(byId(z, "power").reason).toBe("How many in one Nos of this row is needed.");
  });
  it("'from the BoQ' (VRF-4's path, a fixture now): a BoQ row whose model flags the includes and states a copper size", () => {
    const panel = makePricingSheetHelper({
      configsByCategory: configsOf(withExtras()), items: ITEMS, calculatorSurface: true,
      extractionByRow: new Map([[7, { excelRow: 7, description: "10 HP ODU", attributes: { includes: { value: "copper", confidence: 1 } },
        items: [{ attributes: { item: { value: "Outdoor Unit" }, brand: { value: "Blue Star" }, capacity: { value: "10" }, extra_copper_supply_size: { value: "28.6" } } }] } as never]]),
    });
    const v = (panel.compute({ excelRow: 7, description: "10 HP ODU", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"], unit: "Nos" } as never) as unknown as ItemListSuggestion).itemList!;
    expect(fieldOf(byId(v, "copper_supply"), "size").tagText).toBe("from the BoQ");
    expect(val(byId(v, "copper_supply"), "size")).toBe("28.6");
    expect(lines(v).map((l) => l.id)).toEqual(["copper_supply", "copper_return"]);
    expect(v.extrasIncludes).toBeUndefined();
  });
});

describe("VRF-3b BLANK (AC4, owner B) -- an empty default holds the line and the row; the unit rate is kept where known", () => {
  it("a missing size-table input: copper lines red 'Size needed', insulation red, the rest price, Use this value off", () => {
    const items = ITEMS.filter((it) => !String((it.attributes as Record<string, unknown>)?.item ?? "").startsWith("vrf_extra_pipe_outdoor_upto_12hp_"));
    const v = run([ODU10], ALL, "Nos", calcOf(withExtras(), items));
    expect(byId(v, "copper_supply").reason).toBe("Size needed. The Pricing Inputs table has no size for 10 HP. Pick a size, or fill the table.");
    expect(byId(v, "power").state).toBe("priced");
    expect(v.rowPriced).toBe(false);
    expect(v.lineCount).toEqual({ lines: 7, bad: 4 });
    expect(v.totals).toBeUndefined();
  });
  it("a missing length input: the line red 'Length needed', its per-metre rate still shown", () => {
    const items = ITEMS.filter((it) => (it.attributes as Record<string, unknown>)?.item !== "vrf_extra_cable_length_m");
    const v = run([ODU10], "power", "Nos", calcOf(withExtras(), items));
    const p = byId(v, "power");
    expect(p.reason).toBe("Length needed - type the length per Nos, or fill the table.");
    expect(p.perMetre).toEqual({ supply: 950, install: 40 });
    expect(p.working[0]).toBe("Power cable 4C x 10: per metre by Electrical's rules, supply 950 + install 40");
  });
  it("NEGATIVE: without Electrical's rules loaded the cable lines refuse by name -- never priced by another category", () => {
    const v = run([ODU10], "power", "Nos", calcOf(withExtras(), ITEMS, { noElectrical: true }));
    expect(byId(v, "power").state).toBe("blank");
    expect(v.rowPriced).toBe(false);
  });
});

describe("VRF-3b REMOVE / PUT BACK (AC5, owner 12:23) -- the hidden tag; per module", () => {
  it("C7: x on copper supply takes its insulation; 'You removed' + the note; the row prices without them; Put it back restores", () => {
    const s0: ItemListEditState = { items: [ODU10 as never] };
    const s1 = applyItemEdit(s0, { op: "extra_remove", index: 0, line: "copper_supply" });
    expect(s1.items[0].extras).toEqual({ removed: ["copper_supply"] });
    const v = run(s1.items as never);
    expect(lines(v).map((l) => l.id)).toEqual(["copper_return", "ins_return", "power", "comm"]);
    expect(v.items[0].extras?.removed).toEqual([{ id: "copper_supply", label: "Copper pipe - supply line" }]);
    expect(v.items[0].extras?.removedNote).toBe("The helper will not add removed extras back on its own. The row prices without them.");
    expect(v.rowPriced).toBe(true);
    expect(tot(v)).toEqual([441210 - 54420 - 7950, 25960 - 6600 - 420]);
    // no re-add: another edit does not bring it back
    const s2 = applyItemEdit(s1, { op: "extra_set", index: 0, line: "power", field: "length", value: "20" });
    expect(lines(run(s2.items as never)).some((l) => l.id === "copper_supply")).toBe(false);
    const s3 = applyItemEdit(s2, { op: "extra_restore", index: 0, line: "copper_supply" });
    expect(lines(run(s3.items as never)).map((l) => l.id)).toEqual(["copper_supply", "copper_return", "ins_supply", "ins_return", "power", "comm"]);
  });
  it("C7: '+ Add item' adds a blank line -> 1 of 8 need a person", () => {
    const v = run([ODU10, { base: null, family: "Drain Pump", attrs: {}, qty: "" }]);
    expect(v.lineCount).toEqual({ lines: 8, bad: 1 });
    expect(v.rowPriced).toBe(false);
  });
  it("a removed split module takes its extras with it; the other module keeps its own", () => {
    const v = run([unit("Outdoor Unit", "54")]);
    const s = applyItemEdit(v.editState, { op: "remove", index: 1 });
    const w = run(s.items as never);
    expect(w.items.length).toBe(1);
    expect(w.lineCount).toEqual({ lines: 7, bad: 0 });
  });
  it("C8: unticking Insulation and Communication cable leaves the unit, two copper lines and the power cable", () => {
    expect(lines(run([ODU10], "copper,power")).map((l) => l.id)).toEqual(["copper_supply", "copper_return", "power"]);
  });
  it("'Insulation needs copper piping': insulation ticked without copper adds no insulation; its tick is disabled with the line", () => {
    const v = run([ODU10], "insulation,comm");
    expect(lines(v).map((l) => l.id)).toEqual(["comm"]);
    const ins = v.extrasIncludes!.options.find((o) => o.id === "insulation")!;
    expect(ins).toMatchObject({ checked: false, disabled: true, note: "Insulation needs copper piping" });
    expect(v.extrasIncludes!.title).toBe("This row's price includes");
  });
  it("NEGATIVE: accessories never carry extras; nothing ticked = no line, the row exactly as without extras", () => {
    const acc = run([{ base: null, family: "Remote Controller", attrs: { brand: "Blue Star", remote_type: "Wired" } }]);
    expect(acc.items[0].extras).toBeUndefined();
    const none = run([ODU10], "");
    const bare = run([ODU10], "", "Nos", calcOf(withExtras(null)));
    const { extrasIncludes: _x, ...noneRest } = none;
    expect(noneRest).toEqual(bare);
    expect(none.items[0].extras).toBeUndefined();
  });
});

describe("VRF-3b LOT (AC6, owner 01:15) -- Lot in the calculator's Row unit", () => {
  it("the Row unit offers Lot last; a Lot row shows board 9's red bar, 1 of 1 item needs a person, the items kept", () => {
    const spec = itemListPricingSpec(withExtras())!;
    expect(unitChoicesOf(spec, ["Outdoor Unit"])).toEqual(["Nos", "Set", "Lot"]);
    const v = run([ODU10], ALL, "Lot");
    expect(v.unit).toBe("Lot");
    expect(v.unitBar?.tone).toBe("red");
    expect(v.unitBar?.title).toBe("PRICED PER LOT - NOT PRICED. PRICE THIS ROW BY HAND.");
    expect(v.rowPriced).toBe(false);
    expect(v.items.length).toBe(1);
    expect(v.editState.items[0]).toMatchObject({ family: "Outdoor Unit", attrs: { capacity: "10" } });
    expect(run([ODU10], ALL, "Nos").rowPriced).toBe(true);
  });
  it("NEGATIVE: a config without lot_units offers no Lot (Piping, Insulation, ADP byte-identical)", () => {
    for (const id of ["hvac_piping", "hvac_insulation", "hvac_adp"]) {
      const sp = itemListPricingSpec(h58.category_configs.find((c) => c.category_id === id)!)!;
      expect(unitChoicesOf(sp, [])).not.toContain("Lot");
    }
  });
});

describe("VRF-3b edit operations and decode (pure)", () => {
  it("extra_set / extra_undo / extra_remove / extra_restore / undo_qty", () => {
    let s: ItemListEditState = { items: [{ base: null, family: "Outdoor Unit", attrs: {}, qty: "2" }] };
    s = applyItemEdit(s, { op: "extra_set", index: 0, line: "power", field: "spec", value: "4C x 16" });
    expect(s.items[0].extras).toEqual({ set: { power: { spec: "4C x 16" } } });
    s = applyItemEdit(s, { op: "extra_undo", index: 0, line: "power", field: "spec" });
    expect(s.items[0].extras).toBeUndefined();
    s = applyItemEdit(s, { op: "undo_qty", index: 0 });
    expect(s.items[0].qty).toBeUndefined();
    expect(applyItemEdit(s, { op: "extra_remove", index: 9, line: "power" })).toBe(s);
  });
  it("decodeItemEdits keeps extras (strings only) and drops junk", () => {
    const d = decodeItemEdits(JSON.stringify({ items: [{ base: null, family: "Outdoor Unit", attrs: {}, extras: { set: { power: { spec: "4C x 6", bad: 3 } }, removed: ["comm", 7] } }] }), 0);
    expect(d.items[0].extras).toEqual({ set: { power: { spec: "4C x 6" } }, removed: ["comm"] });
    expect(decodeItemEdits(JSON.stringify({ items: [{ base: null, family: "X", attrs: {}, extras: "nope" }] }), 0).items[0].extras).toBeUndefined();
  });
  it("extrasIncludesOf reads only the four ids", () => {
    expect([...extrasIncludesOf("copper, power,foo")]).toEqual(["copper", "power"]);
    expect(extrasIncludesOf(undefined).size).toBe(0);
  });
  it("undo on a changed extra field puts the default back and re-prices (C5 undo)", () => {
    const s = applyItemEdit({ items: [{ ...ODU10, extras: { set: { copper_supply: { size: "9.5" } } } } as never] }, { op: "extra_undo", index: 0, line: "copper_supply", field: "size" });
    const v = run(s.items as never);
    expect(val(byId(v, "copper_supply"), "size")).toBe("22.2");
    expect(fieldOf(byId(v, "copper_supply"), "size").tagText).toBe("default (Pricing Inputs)");
    expect(fieldOf(byId(v, "copper_supply"), "size").userEdited).toBe(false);
  });
});

describe("VRF-3b panel source pins (U1 / U5 / U6 / U8)", () => {
  const RHP = readFileSync(new URL("./RateHelperPanel.tsx", import.meta.url), "utf8");
  it("the panel draws the extra lines, their x, 'You removed' + 'Put it back', the tick boxes and the extras' undo", () => {
    for (const s of ['data-testid="extra-line"', 'data-testid="extra-line-remove"', "You removed: {r.label}", "Put it back",
      'data-testid="extras-includes"', 'op: "extra_undo"']) {
      expect(RHP).toContain(s);
    }
  });
});

describe("VRF-3b Derivation tab (13e) -- the extras' rules, written from the config", () => {
  const titles = (cfg: RateCategoryConfig) => itemListRuleOrder(cfg, ITEMS as never).map((l) => l.title);
  const NEW = [
    "A unit's price can include its copper, insulation, power cable and communication cable, each as its own line",
    "An extra's size comes from the Pricing Inputs table by the unit's size, after conversion",
    "Each extra is priced per metre by its own sheet's rules, then per Nos of the row",
    "An extra with no size, spec or length holds the row",
    "A removed extra stays removed",
  ];
  it("five lines, last, with the bands written from the config; NEGATIVE: without `extras` none and the rest unchanged", () => {
    const withX = titles(withExtras());
    const without = titles(withExtras(null));
    expect(withX.slice(-5)).toEqual(NEW);
    expect(withX.slice(0, -5)).toEqual(without);
    for (const t of NEW) expect(without).not.toContain(t);
    const band = itemListRuleOrder(withExtras(), ITEMS as never).find((l) => l.title === NEW[1])!.detail!;
    expect(band).toContain("pipes: indoor up to 4 TR, above 4 TR; outdoor up to 12 HP, above 12 up to 20 HP, above 20 HP");
    expect(band).toContain("Power cable: indoor up to 4 TR, above 4 up to 8 TR (above that, no default - pick a spec); outdoor up to 8 HP, above 8 up to 14 HP, above 14 HP");
  });
});


describe("VRF-3b K1b (owner ANSWER 2, 15:31 + 16:07 'ok with b') -- every extra line's choices are its own catalogue's", () => {
  it("copper: the item is Copper by default and Change item lists every pipe Piping stocks; the size lists every size of that pipe", () => {
    const v = run([ODU10], "copper");
    const cs = byId(v, "copper_supply");
    expect(fieldOf(cs, "family")).toMatchObject({ value: "Copper", changeItem: true, options: ["Copper", "MS", "PVC", "CPVC"], tagText: "default (Pricing Inputs)" });
    expect(fieldOf(cs, "size").options).toEqual(["6.4", "9.5", "12.7", "15.9", "19.1", "22.2", "25.4", "28.6", "31.7", "34.9", "38.1", "41.3", "47.6"]);
    // a non-default copper size: picked by you, priced by Piping's rules
    const p = run([{ ...ODU10, extras: { set: { copper_supply: { size: "28.6" } } } }], "copper");
    expect(fig(byId(p, "copper_supply"))).toEqual([73140, 6600]);
    expect(fieldOf(byId(p, "copper_supply"), "size").tagText).toBe("picked by you");
    // Change item -> MS: the sizes are MS's, the rate MS's own (Piping's rules)
    const ms = run([{ ...ODU10, extras: { set: { copper_supply: { family: "MS", size: "25" } } } }], "copper");
    const m = byId(ms, "copper_supply");
    expect(fieldOf(m, "family")).toMatchObject({ value: "MS", tagText: "picked by you", userEdited: true });
    expect(fieldOf(m, "size").options).not.toEqual(fieldOf(cs, "size").options);
    expect(m.state).toBe("priced");
    expect(m.working[0]).toContain("25 mm (MS): per metre by Piping's rules");
    // MS's own figure, not Copper's at the nearest size
    const cu25 = byId(run([{ ...ODU10, extras: { set: { copper_supply: { size: "25.4" } } } }], "copper"), "copper_supply");
    expect(m.figures.supply_rate).not.toBe(cu25.figures.supply_rate);
  });
  it("insulation: the item (Nitrile Rubber by default; Tubular Puf), the cladding and the thickness Insulation stocks on the copper size", () => {
    const v = run([ODU10], "copper,insulation");
    const ins = byId(v, "ins_supply");
    expect(fieldOf(ins, "family")).toMatchObject({ value: "Nitrile Rubber Insulation", options: ["Nitrile Rubber Insulation", "Tubular Puf Insulation"], changeItem: true });
    expect(fieldOf(ins, "cladding").value).toBe("No");
    expect(fieldOf(ins, "cladding").options).toEqual(expect.arrayContaining(["No", "24G Aluminium", "26G Aluminium", "Glass Cloth with paint"]));
    expect(fieldOf(ins, "thickness").options).toEqual(["13", "19", "25"]);
    // an insulation with cladding: picked by you, re-priced by Insulation's rules, more than the bare one
    const c = run([{ ...ODU10, extras: { set: { ins_supply: { cladding: "24G Aluminium" } } } }], "copper,insulation");
    const ci = byId(c, "ins_supply");
    expect(ci.state).toBe("priced");
    expect(fieldOf(ci, "cladding").tagText).toBe("picked by you");
    expect(ci.figures.supply_rate!).toBeGreaterThan(7950);
    // undo puts the default back
    const u = applyItemEdit({ items: [{ ...ODU10, extras: { set: { ins_supply: { cladding: "24G Aluminium" } } } } as never] }, { op: "extra_undo", index: 0, line: "ins_supply", field: "cladding" });
    expect(fig(byId(run(u.items as never, "copper,insulation"), "ins_supply"))).toEqual([7950, 420]);
    // NEGATIVE: a cladding the catalogue does not stock on that size holds the line by name
    const bad = run([{ ...ODU10, extras: { set: { ins_supply: { cladding: "Aluminium Foil" } } } }], "copper,insulation");
    expect(byId(bad, "ins_supply").reason).toBe("Aluminium Foil is not stocked for Nitrile Rubber Insulation on 22.23 mm - pick another.");
  });
  it("cable: conductor, armour, cores and size list every value Electrical stocks (read only); an armoured or aluminium cable prices by Electrical's rules", () => {
    const v = run([ODU10], "power");
    const p = byId(v, "power");
    expect(fieldOf(p, "conductor")).toMatchObject({ value: "COPPER", options: ["ALUMINIUM", "COPPER"], tagText: "default (Pricing Inputs)" });
    expect(fieldOf(p, "armour")).toMatchObject({ value: "UNARMOURED", options: ["ARMOURED", "UNARMOURED"] });
    expect(fieldOf(p, "cores").value).toBe("4");
    expect(fieldOf(p, "sqmm").value).toBe("10");
    expect(fieldOf(p, "spec")).toMatchObject({ value: "4C x 10", readOnly: true });
    const arm = run([{ ...ODU10, extras: { set: { power: { armour: "ARMOURED" } } } }], "power");
    const a = byId(arm, "power");
    expect(a.state).toBe("priced");
    expect(fieldOf(a, "armour").tagText).toBe("picked by you");
    // Electrical's own armoured discount / markup: 740 per metre -> 22,200 per Nos (not the unarmoured 28,500)
    expect(a.figures.supply_rate).toBe(22200);
    expect(a.working[0]).toContain("4C x 10 copper armoured");
    const al = run([{ ...ODU10, extras: { set: { power: { conductor: "ALUMINIUM", armour: "ARMOURED", cores: "4", sqmm: "16" } } } }], "power");
    expect(byId(al, "power").state).toBe("priced");
    expect(byId(al, "power").working[0]).toContain("per metre by Electrical's rules");
    // NEGATIVE: a combination Electrical does not stock holds the line by name
    const no = run([{ ...ODU10, extras: { set: { power: { conductor: "ALUMINIUM", cores: "6", sqmm: "1.5" } } } }], "power");
    expect(byId(no, "power").reason).toBe("6C x 1.5 aluminium unarmoured cable is not stocked - pick a spec.");
  });
  it("the panel draws Change item on an extra line and the read-only spec with its own unit", () => {
    const RHP_SRC = readFileSync(new URL("./RateHelperPanel.tsx", import.meta.url), "utf8");
    expect(RHP_SRC).toContain('data-testid="extra-change-item"');
    expect(RHP_SRC).toContain('data-testid="extra-item-picker"');
    expect(RHP_SRC).toContain("{f.value ? `${f.value}${f.suffix ? ` ${f.suffix}` : \"\"}` : \"-\"}");
  });
});


// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// K2 -- PER-FIELD UNDO (owner 14:20 / 14:56) and the PRICING INPUTS (owner 12:07 / 13:54; board 14)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("VRF-3b K2 UNDO (AC7, owner 14:20 'revert actions for each individual attribute'; 14:56 'yes' = every item-list block)", () => {
  const RHP_SRC = readFileSync(new URL("./RateHelperPanel.tsx", import.meta.url), "utf8");
  it("undo_qty takes a typed quantity back to the assumed 1 (amber 'default') and re-prices -- on ADP, Insulation, Piping and VRF alike", () => {
    const s = applyItemEdit({ items: [{ base: null, family: "Outdoor Unit", attrs: { brand: "Blue Star", capacity: "10" }, qty: "2" }] }, { op: "undo_qty", index: 0 });
    expect(s.items[0].qty).toBeUndefined();
    const two = run([{ ...ODU10, qty: "2" }], "");
    const back = run(s.items as never, "");
    expect(tot(two)).toEqual([603120, 20000]);
    expect(tot(back)).toEqual([301560, 10000]);
    expect(back.items[0].qtyDefaulted).toBe(true);
    // the operation is the category-agnostic one every block dispatches (one component, panel AND calculator)
    for (const fam of ["Nitrile Rubber Insulation", "Copper", "Supply Air Diffuser"]) {
      const t = applyItemEdit({ items: [{ base: null, family: fam, attrs: {}, qty: "3" }] }, { op: "undo_qty", index: 0 });
      expect(t.items[0]).toEqual({ base: null, family: fam, attrs: {} });
    }
  });
  it("the panel draws the quantity undo beside a typed quantity (never on a quantity that follows its pipe), and the refnet counts' undo", () => {
    expect(RHP_SRC).toContain('{view.editState.items[i]?.qty !== undefined && !b.qtyMirrorTag && (');
    expect(RHP_SRC).toContain('onClick={() => onEdit({ op: "undo_qty", index: i })}');
    expect(RHP_SRC).toContain('data-testid="item-qty-undo"');
    expect(RHP_SRC).toContain('data-testid="item-set-count-undo"');
    // the attribute fields' own undo is unchanged (it existed on every category before this slice -- P0 (b))
    expect(RHP_SRC).toContain('onClick={() => onEdit({ op: "undo_attr", index: i, id: f.id })}');
  });
  it("a refnet count the pricer typed is marked edited (its undo arrow); one read from the row is not", () => {
    const helper = makePricingSheetHelper({ configsByCategory: configsOf(withExtras()), items: ITEMS, extractionByRow: new Map(), calculatorSurface: true });
    const v = (helper.compute(calculatorCtx("HVAC", VRF), {
      [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "Refnet/Y-Joint", attrs: { brand: "Blue Star", set_covers: "Whole system (indoor + outdoor)", set_odu: "3" } }] }),
      [ROW_UNIT_OVERRIDE_KEY]: "Set",
    }) as unknown as ItemListSuggestion).itemList!;
    const f = v.items[0].setCount!.fields;
    expect(f.find((x) => x.id === "set_odu")?.edited).toBe(true);
    expect(f.find((x) => x.id === "set_idu")?.edited).toBeUndefined();
  });
});

describe("VRF-3b K2 PRICING INPUTS (AC8) -- reach, used-by, snap, tables, worked examples", () => {
  const HV = Object.fromEntries([...configsOf(withExtras()).entries()].filter(([, c]) => (c as { discipline?: string }).discipline !== "Electrical").map(([k, c]) => [k, { ...c, discipline: "HVAC" }])) as Record<string, RateCategoryConfig>;
  const HV_ITEMS = ITEMS.filter((it) => it.discipline === "HVAC");
  const reach = computePricingInputReach(HV, HV_ITEMS);
  const ids = FIX.inputs.map((i) => String(i.attributes.item));
  it("every one of the 29 inputs is READ by VRF (Used by 'VRF'), moves no SKU's own rate, and reaches the VRF units it sizes", () => {
    for (const id of ids) {
      expect(reach[id]?.readByCategories).toEqual(["hvac_vrf"]);
      expect(reach[id]?.distinctSkus).toEqual([]);
      expect(reachedSkuCount(reach, id)).toBeGreaterThan(0);
    }
    const n = (id: string) => reachedSkuCount(reach, id);
    // a band reaches its own units only; the lengths and the communication cable every unit
    expect(n("vrf_extra_copper_length_m")).toBe(n("vrf_extra_comm_cable_cores"));
    expect(n("vrf_extra_pipe_indoor_upto_4tr_supply_mm") + n("vrf_extra_pipe_indoor_above_4tr_supply_mm")
      + n("vrf_extra_pipe_outdoor_upto_12hp_supply_mm") + n("vrf_extra_pipe_outdoor_12_to_20hp_supply_mm") + n("vrf_extra_pipe_outdoor_above_20hp_supply_mm"))
      .toBe(n("vrf_extra_copper_length_m"));
    expect(extrasUses(HV.hvac_vrf, HV_ITEMS)).toHaveLength(29);
  });
  it("the two convert factors no longer read '0 items': each reaches the VRF units whose capacity it converts (owner)", () => {
    for (const id of ["vrf_hp_per_tr", "vrf_kw_per_tr"]) {
      expect(reach[id]?.distinctSkus).toEqual([]);
      expect(reachedSkuCount(reach, id)).toBeGreaterThan(100);
    }
    // NEGATIVE: an input that moves a SKU's own rate still counts its SKUs, untouched
    expect(reachedSkuCount(reach, "piping_accessories_copper")).toBe(13);
  });
  it("the used-by twin: VRF, one use per cell (= csv_exporter.pricing_input_used_by via extras_input_ids); no other input's count moves", () => {
    const after = pricingInputUsedBy(Object.values(HV) as never);
    const before = pricingInputUsedBy(Object.values(Object.fromEntries(Object.entries(HV).map(([k, c]) => [k, k === "hvac_vrf" ? withExtras(null) : c]))) as never);
    for (const id of ids) expect(after[id]).toEqual({ sites: 1, categories: ["hvac_vrf"] });
    const others = (m: Record<string, unknown>) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith("vrf_extra_")));
    expect(others(after)).toEqual(others(before));
  });
  it("a pipe-size cell snaps to the closest stocked Piping size ('15 mm' -> 15.9); a thickness or a length cell does not", () => {
    const snap = extrasSnapSizes(HV, HV_ITEMS, "vrf_extra_pipe_outdoor_upto_12hp_supply_mm")!;
    expect(snap).toEqual([6.4, 9.5, 12.7, 15.9, 19.1, 22.2, 25.4, 28.6, 31.7, 34.9, 38.1, 41.3, 47.6]);
    expect(closestSize(readTypedSizeMm("15 mm"), snap)).toBe(15.9);
    expect(closestSize(readTypedSizeMm("1.125 inch"), snap)).toBe(28.6);
    expect(extrasSnapSizes(HV, HV_ITEMS, "vrf_extra_pipe_outdoor_upto_12hp_insulation_mm")).toBeNull();
    expect(extrasSnapSizes(HV, HV_ITEMS, "vrf_extra_copper_length_m")).toBeNull();
    expect(extrasSnapSizes(HV, HV_ITEMS, "piping_accessories_copper")).toBeNull();
  });
  it("the two tables (board 14) read the live cells: 5 pipe bands, 5 power bands + communication, Copper / Unarmoured, the lengths", () => {
    const t = extrasTablesOf(HV.hvac_vrf, HV_ITEMS)!;
    expect(t.pipes).toEqual([
      { band: "Indoor up to 4 TR", supply: 12.7, ret: 6.4, insulation: 19 },
      { band: "Indoor above 4 TR", supply: 15.9, ret: 9.5, insulation: 19 },
      { band: "Outdoor up to 12 HP", supply: 22.2, ret: 15.9, insulation: 19 },
      { band: "Outdoor above 12 up to 20 HP", supply: 28.6, ret: 19.1, insulation: 19 },
      { band: "Outdoor above 20 HP", supply: 34.9, ret: 22.2, insulation: 19 },
    ]);
    // K3: 'COPPER' -- the loader canonicalises an item's `material` to upper case on ingest (Electrical's rule), so the asset
    // and this fixture carry it so (BEFORE: "Copper")
    expect(t.cables.map((c) => [c.band, c.cores, c.sqmm, c.material, c.armour])).toEqual([
      ["Power - Indoor up to 4 TR", 3, 1.5, "COPPER", "Unarmoured"], ["Power - Indoor above 4 up to 8 TR", 3, 2.5, "COPPER", "Unarmoured"],
      ["Power - Outdoor up to 8 HP", 4, 6, "COPPER", "Unarmoured"], ["Power - Outdoor above 8 up to 14 HP", 4, 10, "COPPER", "Unarmoured"],
      ["Power - Outdoor above 14 HP", 4, 16, "COPPER", "Unarmoured"], ["Communication - every unit", 2, 1.5, "COPPER", "Unarmoured"],
    ]);
    expect(t.lengths.map((l) => l.value)).toEqual([30, 30]);
    // NEGATIVE: a config without extras makes no table
    expect(extrasTablesOf(withExtras(null), HV_ITEMS)).toBeNull();
  });
  it("C11: the copper length 30 -> 25 moves the worked example (now -> becomes) by exactly its four copper / insulation lines", () => {
    const cfgs = { ...HV, hvac_vrf: { ...HV.hvac_vrf, impact_examples: FIX.examples } } as Record<string, RateCategoryConfig>;
    const r2 = computePricingInputReach(cfgs, HV_ITEMS);
    const allItems = [...HV_ITEMS, ...ITEMS.filter((it) => it.discipline === "Electrical")];
    const cfgsAll = { ...cfgs, ...Object.fromEntries(e72.category_configs.map((c) => [c.category_id, { ...c, discipline: "Electrical" }])) };
    const ex = computeExampleImpacts("vrf_extra_copper_length_m", { factor: 25 }, r2.vrf_extra_copper_length_m, cfgsAll as never, allItems);
    const ex5 = ex.find((e) => e.example.id === "VRF-5")!;
    expect(ex5.before).toMatchObject({ ok: true, values: { supply_rate: 441210, install_rate: 25960 } });
    // 25 m: copper 45,350 + 32,450, insulation 6,625 + 6,200 (each / 30 x 25, rounded up per line)
    expect(ex5.after).toMatchObject({ ok: true, values: { supply_rate: 441210 - (54420 + 38940 + 7950 + 7440) + (45350 + 32450 + 6625 + 6200) } });
    expect(ex5.moved).toBe(true);
    expect(ex.map((e) => e.example.id)).toEqual(["VRF-5", "VRF-6"]);
    // an example that names other inputs is not on this input's panel
    expect(computeExampleImpacts("vrf_extra_power_outdoor_upto_8hp_sqmm", {}, r2.vrf_extra_power_outdoor_upto_8hp_sqmm, cfgsAll as never, allItems).map((e) => e.example.id)).toEqual(["VRF-10"]);
  });
  it("CERT FIX (C11): the page's example map -- HVAC alone cannot price a cable example; HVAC + exampleCrossTargets' fetch can", () => {
    const cfgs = { ...HV, hvac_vrf: { ...HV.hvac_vrf, impact_examples: FIX.examples } } as Record<string, RateCategoryConfig>;
    const r2 = computePricingInputReach(cfgs, HV_ITEMS);
    // what the page fetches: exactly Electrical wiring_cabling (the cable's target); nothing for Electrical's own page
    const targets = exampleCrossTargets(cfgs as never, "HVAC");
    expect(targets).toEqual([{ discipline: "Electrical", categoryId: "wiring_cabling" }]);
    expect(exampleCrossTargets(cfgs as never, "Electrical")).toEqual([]);
    expect(exampleCrossTargets({ a: { list_spec: { pricing: {} } }, b: null } as never, "HVAC")).toEqual([]);
    // ⚠️ NEGATIVE (the run-1 screen): the page's OWN discipline only -> the cable line refuses, the example does not price
    const hvOnly = computeExampleImpacts("vrf_extra_copper_length_m", { factor: 25 }, r2.vrf_extra_copper_length_m, cfgs as never, HV_ITEMS);
    expect(hvOnly.find((e) => e.example.id === "VRF-5")!.before.ok).toBe(false);
    // the fix: the page's merge -- every target's config by category id, the target disciplines' items behind the own set
    const e72Cfg = Object.fromEntries(e72.category_configs.map((c) => [c.category_id, { ...c, discipline: "Electrical" }]));
    const exampleConfigs = { ...cfgs, ...Object.fromEntries(targets.map((t) => [t.categoryId, e72Cfg[t.categoryId]])) };
    const exampleItems = mergeItemsByName(HV_ITEMS, ITEMS.filter((it) => targets.some((t) => t.discipline === it.discipline)));
    const ex5 = computeExampleImpacts("vrf_extra_copper_length_m", { factor: 25 }, r2.vrf_extra_copper_length_m, exampleConfigs as never, exampleItems)
      .find((e) => e.example.id === "VRF-5")!;
    expect(ex5.before).toMatchObject({ ok: true, values: { supply_rate: 441210, install_rate: 25960 } });
    expect(ex5.moved).toBe(true);
    // the reach (badges) is built from the page's own configs: the cross target never joins it
    expect(computePricingInputReach(exampleConfigs as never, HV_ITEMS).vrf_extra_copper_length_m?.readByCategories)
      .toEqual(r2.vrf_extra_copper_length_m?.readByCategories);
  });
  it("CERT FIX (C11) source: the page fetches the cross targets into an EXAMPLE-ONLY map and hands it to the panel's examples", () => {
    const PAGE = readFileSync(new URL("../../pricing/rate-master/RateMasterPage.tsx", import.meta.url), "utf8");
    const PANEL = readFileSync(new URL("../../pricing/rate-master/PricingInputImpactPanel.tsx", import.meta.url), "utf8");
    expect(PAGE).toContain("exampleCrossTargets(allConfigs as never, disciplineId)");
    expect(PAGE).toContain("onLoaded={onCrossConfigLoaded}");
    expect(PAGE).toContain("<RateItemsFetcher key={`example-items-${d}`} discipline={d} onLoaded={onCrossItemsLoaded} />");
    expect(PAGE).toContain("exampleConfigs={exampleConfigs as never}");
    expect(PAGE).toContain("exampleItems={exampleItems}");
    // ⚠️ NEGATIVE: the reach walk and the panel's own props keep the page's discipline only
    expect(PAGE).toContain("computePricingInputReach(allConfigs as never, items)");
    expect(PAGE).toContain("allItems={items}");
    expect(PANEL).toContain("(exampleConfigs ?? allConfigs) as never, exampleItems ?? allItems)");
  });
  it("the panel and the grid source: the snap note, Save / Cancel unchanged ('nothing is saved until you press Save'), the tables mounted", () => {
    const PANEL = readFileSync(new URL("../../pricing/rate-master/PricingInputImpactPanel.tsx", import.meta.url), "utf8");
    const PAGE = readFileSync(new URL("../../pricing/rate-master/RateMasterPage.tsx", import.meta.url), "utf8");
    const GRID = readFileSync(new URL("../../pricing/rate-master/RateMasterDataViewer.tsx", import.meta.url), "utf8");
    expect(PANEL).toContain("becomes ${edited[k]} mm (the closest Piping size)");
    expect(PANEL).toContain("nothing is saved until you press Save");
    expect(PANEL).toContain('data-testid="vrf-extras-tables"');
    expect(PAGE).toContain("<VrfExtrasTables configs={allConfigs as never} items={items} />");
    expect(PAGE).toContain("snapSizesFor={(id) => extrasSnapSizes(allConfigs as never, items, id)}");
    expect(GRID).toContain('const n = snap && k === "factor" ? closestSize(readTypedSizeMm(raw), snap) : parseFiniteInput(raw);');
  });
});
