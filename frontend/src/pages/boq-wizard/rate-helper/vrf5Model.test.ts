/**
 * VRF-5 K1 (owner 2026-11-06: R1 18:14-18:21 + SAFEGUARD; R2 "yes"; R4-R8 scope + uplift; R5 / ANSWER 4 "2 ok"; ANSWER 4 defaults;
 * F2 the review's one code bug) -- THE PRICER, through the panel's entry point (`makePricingSheetHelper(...).compute`) and the
 * calculator's, positive AND negative per mechanism:
 *   R1   an accessory the BoQ says a unit's price includes is its OWN line on the unit (quantity from the BoQ, else the Pricing
 *        Inputs default by band), never a separate blocking item; a model item listing it is folded into that line; an item that
 *        is no extra is a note point; a line that cannot price never blocks the unit.
 *   SAFEGUARD  the row's own text -> added; a heading / note only -> added unless the BoQ quotes it on its own row (then not, the
 *        note names the row); either heading case raises "This row may include extras - please review".
 *   F2   cable words with no size -> the band's default spec, the stated armour / length applied, the note says which is which.
 *   R2   discharge not stated + below the smallest Top unit -> Side, the note naming that size; a stated discharge wins.
 *   R5   several makes -> Blue Star if stated; else the first stated make stocked for the item; else Blue Star + note.
 *   SCOPE  supply only -> install 0 on every line; installation only -> supply 0, install = final x (1 + uplift) per line.
 *
 * FIXTURE: HVAC v60 + Electrical v72, hvac_vrf's VRF-5 keys and the 13 new Pricing Inputs from `pricing/__fixtures__/vrf5Model.json`
 * (the file the v61 mint reads; test_vrf_v61 proves the asset equals it). A config WITHOUT the keys (v60 as it is) is unchanged.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { ownRowQuotes, readCableKindWords, readLengthRange, readQtyWords, type ExtractedListItem } from "./itemListPricing";
import {
  EXTRAS_INCLUDES_KEY, ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, SCOPE_OVERRIDE_KEY, buildExtractionByRow, makePricingSheetHelper,
  type ExtraLineView, type ItemListSuggestion, type ItemListView,
} from "./pricingSheetHelper";
import { rowQuantitiesOf, sheetLinesOf } from "./rateSuggestionModel";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h60 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v60.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fx = Record<string, any>;
const FX = readJsonFixture<Fx>(new URL("../../pricing/__fixtures__/vrf5Model.json", import.meta.url));
const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const inputItem = (p: { item: string; name: string; unit: string; factor: number }): RateMasterItem =>
  ({ name: `fx-${p.item}`, discipline: "HVAC", kind: "hvac_pricing_input", brand: null, unit: p.unit, attributes: { item: p.item, name: p.name, shared_by: "vrf" }, rates: { factor: p.factor } } as unknown as RateMasterItem);
const BASE: RateMasterItem[] = [...toItems(h60), ...toItems(e72)];
const ITEMS: RateMasterItem[] = [...BASE, ...FX.inputs.map(inputItem)];
const VRF = "hvac_vrf";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];

/** v60's hvac_vrf + the VRF-5 keys (each can be left out to prove the config without it is unchanged) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vrf5 = (omit: string[] = []): RateCategoryConfig => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = structuredClone(h60.category_configs.find((x) => x.category_id === VRF)) as Record<string, any>;
  const p = c.list_spec.pricing;
  if (!omit.includes("accessories")) { p.extras.accessories = structuredClone(FX.accessories); p.extras.folded = structuredClone(FX.folded); }
  if (!omit.includes("safeguard")) p.extras.safeguard = structuredClone(FX.safeguard);
  if (!omit.includes("scope")) p.extras.scope = structuredClone(FX.scope);
  if (!omit.includes("words")) Object.assign(p.extras.lines, FX.extras_words);
  Object.assign(p.extras.from_model, FX.from_model_add);
  if (!omit.includes("r2")) Object.assign(p.defaults.discharge, FX.defaults_add.discharge);
  if (!omit.includes("r5")) Object.assign(p.defaults.brand.unlisted, FX.defaults_add.brand);
  p.lot_units.bar_by_unit = structuredClone(FX.wording.lot_bar_by_unit);
  c.list_spec.attribute_definitions = [...c.list_spec.attribute_definitions, ...structuredClone(FX.questions_add)];
  return c as RateCategoryConfig;
};
const configsOf = (vrf: RateCategoryConfig) => new Map<string, RateCategoryConfig>([
  ...h60.category_configs.map((c) => [c.category_id, c.category_id === VRF ? vrf : c] as [string, RateCategoryConfig]),
  ...e72.category_configs.map((c) => [c.category_id, c] as [string, RateCategoryConfig]),
]);
type Item = Record<string, string>;
const mi = (a: Item): ExtractedListItem => ({ attributes: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) });
/** a BoQ sheet: excel row -> the model's items, the row's unit / qty / text / headings; `lines` = other line items with no run */
type Row = { items?: Item[]; unit?: string; qty?: number; text?: string; headings?: string[]; category?: string };
const sheet = (rows: Record<number, Row>, cfg = vrf5(), items = ITEMS) => {
  const results = Object.entries(rows).filter(([, r]) => r.items).map(([er, r]) => ({
    excel_row: Number(er), description: r.text ?? "", category_id: r.category ?? VRF, attributes: {}, items: r.items!.map(mi),
  }));
  const helper = makePricingSheetHelper({ configsByCategory: configsOf(cfg), items, extractionByRow: buildExtractionByRow(results as never) });
  const priced = Object.entries(rows).map(([er, r]) => ({ source_row_number: Number(er), qty_total: r.qty ?? 1, node_type: "Line Item", description: r.text ?? "" }));
  const rowQuantities = rowQuantitiesOf(priced as never);
  const sheetLines = sheetLinesOf(priced as never);
  return (er: number, overrides: Record<string, string> = {}): ItemListView => {
    const r = rows[er];
    const res = helper.compute({ excelRow: er, description: r.text ?? "", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: KINDS,
      unit: r.unit ?? "Nos", quantity: r.qty ?? 1, rowQuantities, sheetLines, ...(r.headings ? { headings: r.headings } : {}) } as never, overrides) as unknown as ItemListSuggestion;
    return res.itemList!;
  };
};
const calc = (edits: unknown[], more: Record<string, string> = {}, cfg = vrf5()): ItemListView => {
  const h = makePricingSheetHelper({ configsByCategory: configsOf(cfg), items: ITEMS, extractionByRow: new Map() });
  return (h.compute(calculatorCtx("HVAC", VRF), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: edits }), [ROW_UNIT_OVERRIDE_KEY]: "Nos", ...more }) as unknown as ItemListSuggestion).itemList!;
};
const ODU = (more: Item = {}): Item => ({ item: "Outdoor Unit", brand: "Blue Star", capacity: "10 HP", ...more });
const lines = (v: ItemListView, b = 0): ExtraLineView[] => v.items[b].extras?.lines ?? [];
const byId = (v: ItemListView, id: string, b = 0) => lines(v, b).find((l) => l.id === id);
const val = (l: ExtraLineView | undefined, id: string) => l?.fields.find((f) => f.id === id)?.value;
const tagOf = (l: ExtraLineView | undefined, id: string) => l?.fields.find((f) => f.id === id)?.tag;
const tot = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];
const fieldOf = (v: ItemListView, id: string, b = 0) => v.items[b].fields.find((f) => f.id === id);

describe("VRF-5 pure readers", () => {
  it("readLengthRange: a range takes the higher figure and keeps the range; one length; none", () => {
    expect(readLengthRange("multicore copper cables about 5-10 Rmt in PVC conduit")).toEqual({ value: "10", range: ["5", "10"] });
    expect(readLengthRange("up to 15 m")).toEqual({ value: "15" });
    expect(readLengthRange("armoured copper conductor cabling")).toBeNull();
  });
  it("readCableKindWords: armoured / unarmoured / aluminium / copper; nothing stated -> nothing", () => {
    expect(readCableKindWords("armoured copper conductor cabling")).toEqual({ armour: "ARMOURED", conductor: "COPPER" });
    expect(readCableKindWords("unarmoured aluminium cable")).toEqual({ armour: "UNARMOURED", conductor: "ALUMINIUM" });
    expect(readCableKindWords("multicore cables")).toEqual({});
  });
  it("readQtyWords: the number written; none -> null", () => {
    expect(readQtyWords("2 nos")).toBe(2);
    expect(readQtyWords("15 kg")).toBe(15);
    expect(readQtyWords("as required")).toBeNull();
  });
  it("ownRowQuotes: a row of its own by words or item-1 family; never the asking row, never a unit row; not_words exclude", () => {
    const rule = { words: ["\\brefnet"], families: ["Refnet/Y-Joint"] };
    const rows = [{ row: 9, text: "8 HP outdoor unit with refnet" , family1: "Outdoor Unit" }, { row: 24, text: "refnet included" }, { row: 134, text: "Refnet joints" }, { row: 140, text: "Branch kit", family1: "Refnet/Y-Joint" }];
    expect(ownRowQuotes(rule, rows, 24, new Set(["Outdoor Unit"])).map((q) => q.row)).toEqual([134, 140]);
    expect(ownRowQuotes({ words: ["\\bpower\\s+cabl"], not_words: ["\\bcommunication\\b"] }, [{ row: 5, text: "power cable and communication cable" }], 1, new Set())).toEqual([]);
    expect(ownRowQuotes(undefined, rows, 1, new Set())).toEqual([]);
  });
});

describe("VRF-5 R1 -- accessories are the unit's own lines; a model item listing one is folded in; nothing blocks the unit", () => {
  it("AC0 shape: '38HP (20+18)' with gas + frame listed as their own items (00350 r14) -> both modules priced, each with gas + frame lines (the default by band), no block", () => {
    const v = sheet({ 14: { items: [ODU({ capacity: "38HP (20+18)" }), { item: "Refrigerant Gas Filling (R-410)" }, { item: "MS Angle Base Frame Structure" }], text: "System-1 38HP (20+18)" } })(14);
    expect(v.items.map((b) => b.family)).toEqual(["Outdoor Unit", "Outdoor Unit"]);
    expect(v.rowPriced).toBe(true);
    for (const b of [0, 1]) {
      expect(lines(v, b).map((l) => l.id)).toEqual(["acc_frame", "acc_gas", "acc_mccb"].filter((id) => id !== "acc_mccb" || lines(v, b).some((l) => l.id === id)));
      const gas = byId(v, "acc_gas", b)!;
      expect(val(gas, "qty")).toBe("8");                        // the 20 / 18 HP modules -> the above-14 HP band (8 Kg)
      expect(tagOf(gas, "qty")).toBe("default");
    }
    // the review note: the inclusion came from a separate item, not the row's own words -> "please review"
    expect(v.items[0].extras?.review?.title).toBe("This row may include extras - please review");
  });
  it("the quantity: the BoQ's (from the BoQ) beats the default; a typed one beats both; figures = qty x the per-Kg rate, rounded up", () => {
    const v = sheet({ 9: { items: [ODU({ includes_gas: "Yes", includes_gas_where: "Row", includes_gas_qty_as_written: "2.5 kg" })] } })(9);
    const gas = byId(v, "acc_gas")!;
    expect(val(gas, "qty")).toBe("2.5");
    expect(tagOf(gas, "qty")).toBe("boq");
    expect(gas.figures.supply_rate).toBe(Math.ceil(2.5 * gas.perMetre!.supply - 1e-9));
    expect(v.items[0].extras?.review).toBeUndefined();          // stated on the row itself: added, nothing to review
    const typed = sheet({ 9: { items: [ODU({ includes_gas: "Yes", includes_gas_where: "Row" })] } })(9, {
      [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: 0, family: null, attrs: {}, extras: { set: { acc_gas: { qty: "4" } } } }] }) });
    expect(val(byId(typed, "acc_gas"), "qty")).toBe("4");
    expect(tagOf(byId(typed, "acc_gas"), "qty")).toBe("picked");
  });
  it("the defaults by band (ANSWER 4): 8 HP -> frame 30 Kg / gas 3 Kg; 10 HP -> 45 / 5; 16 HP -> 60 / 8; indoor -> drain pump / remote / refnet 1", () => {
    const at = (cap: string) => sheet({ 9: { items: [ODU({ capacity: cap, includes_frame: "Yes", includes_frame_where: "Row", includes_gas: "Yes", includes_gas_where: "Row" })] } })(9);
    expect([val(byId(at("8 HP"), "acc_frame"), "qty"), val(byId(at("8 HP"), "acc_gas"), "qty")]).toEqual(["30", "3"]);
    expect([val(byId(at("10 HP"), "acc_frame"), "qty"), val(byId(at("10 HP"), "acc_gas"), "qty")]).toEqual(["45", "5"]);
    expect([val(byId(at("16 HP"), "acc_frame"), "qty"), val(byId(at("16 HP"), "acc_gas"), "qty")]).toEqual(["60", "8"]);
    const idu = sheet({ 9: { items: [{ item: "Hi-Wall", brand: "Blue Star", capacity: "1.5 TR", includes_drain_pump: "Yes", includes_drain_pump_where: "Row",
      includes_remote: "Yes", includes_remote_where: "Row", includes_refnet: "Yes", includes_refnet_where: "Row" }] } })(9);
    expect(lines(idu).map((l) => [l.id, val(l, "qty")])).toEqual([["acc_drain_pump", "1"], ["acc_remote", "1"], ["acc_refnet", "1"]]);
    expect(idu.rowPriced).toBe(true);
  });
  it("the remote is Cordless unless the row says wired / corded", () => {
    const one = (text: string) => val(byId(sheet({ 9: { items: [{ item: "Cassette", brand: "Blue Star", capacity: "2 TR", includes_remote: "Yes", includes_remote_where: "Row" }], text } })(9), "acc_remote"), "item");
    expect(one("2 TR cassette with remote")).toBe("Cordless Remote controller");
    expect(one("2 TR cassette with wired remote")).toBe("Wired Remote controller");
  });
  it("a default not set (Pricing Input absent) -> 'default needed - set it in Pricing Inputs' and the unit STILL prices", () => {
    const noFrame = ITEMS.filter((it) => !String(it.attributes?.item ?? "").startsWith("vrf_acc_frame"));
    const v = sheet({ 9: { items: [ODU({ includes_frame: "Yes", includes_frame_where: "Row" })] } }, vrf5(), noFrame)(9);
    const fr = byId(v, "acc_frame")!;
    expect(fr.state).toBe("blank");
    expect(fr.reason).toBe("default needed - set it in Pricing Inputs");
    expect(fr.optional).toBe(true);
    expect(v.rowPriced).toBe(true);
    expect(tot(v)).toEqual([301560, 10000]);
  });
  it("the MCCB is borrowed from Electrical by its own rules -- priced, or its own sentence as a note; never a block", () => {
    const v = sheet({ 9: { items: [ODU({ includes_mccb: "Yes", includes_mccb_where: "Row" })] } })(9);
    const m = byId(v, "acc_mccb")!;
    expect(val(m, "item")).toBe("40A FP MCCB");                   // 10 HP -> the > 8 up to 14 HP band (ANSWER 6)
    expect(m.state).toBe("priced");                               // Electrical stocks the 40A FP MCCB: priced by its own rules
    expect(m.heading).toContain("from Electrical");
    expect(v.rowPriced).toBe(true);
  });
  it("an isolator the BoQ names prices as the default MCCB, the working says so (ANSWER 6)", () => {
    const v = sheet({ 9: { items: [ODU({ capacity: "16 HP", includes_mccb: "Yes", includes_mccb_where: "Row" })], text: "16 HP ODU with isolator" } })(9);
    const m = byId(v, "acc_mccb")!;
    expect(val(m, "item")).toBe("63A FP MCCB");
    expect(m.working[0]).toBe("BoQ says isolator - priced as the default 63A FP MCCB (owner 2026-11-06)");
  });
  it("a folded item that is no extra ('none of these' -- the isolator / AV pads the catalogue does not hold) -> a note point, the unit priced (00401 r12)", () => {
    const v = sheet({ 12: { items: [ODU({ capacity: "18 HP" }), { item: "none of these" }] } })(12);
    expect(v.items.length).toBe(1);
    expect(v.rowPriced).toBe(true);
    expect(v.items[0].extras?.notes).toEqual({ title: "Also listed with the unit (not priced as an extra)", points: ["An item the catalogue does not identify (not identified in the catalogue)"] });
  });
  it("NEGATIVE: a row whose ITEM 1 is the accessory prices it as today (MS frame on a Kg row; a remote of its own)", () => {
    const kg = sheet({ 135: { items: [{ item: "MS Angle Base Frame Structure" }], unit: "Kg" } })(135);
    expect(kg.items.map((b) => b.family)).toEqual(["MS Angle Base Frame Structure"]);
    expect(kg.items[0].extras).toBeUndefined();
    const rem = sheet({ 60: { items: [{ item: "Remote Controller", remote_type: "Wired" }, { item: "Drain Pump" }] } })(60);
    expect(rem.items.map((b) => b.family)).toEqual(["Remote Controller", "Drain Pump"]);   // no unit first -> nothing folds
  });
  it("NEGATIVE: v60's config (no accessories / folded) -> the gas + frame items still refuse the row, as VRF-4 measured", () => {
    const v = sheet({ 14: { items: [ODU({ capacity: "38HP (20+18)" }), { item: "Refrigerant Gas Filling (R-410)" }, { item: "MS Angle Base Frame Structure" }] } }, vrf5(["accessories", "safeguard"]))(14);
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toContain("not stocked per Nos");
  });
  it("the calculator: ticking an accessory adds its line with the same quantity and figures as the panel", () => {
    const c = calc([{ base: null, family: "Outdoor Unit", attrs: { brand: "Blue Star", capacity: "10" } }], { [EXTRAS_INCLUDES_KEY]: "gas" });
    const p = sheet({ 9: { items: [ODU({ includes_gas: "Yes", includes_gas_where: "Row" })] } })(9);
    expect(c.extrasIncludes?.options.map((o) => o.id)).toEqual(["copper", "insulation", "power", "comm", "frame", "gas", "mccb", "drain_pump", "remote", "refnet"]);
    expect(byId(c, "acc_gas")?.figures).toEqual(byId(p, "acc_gas")?.figures);
    expect(tot(c)).toEqual(tot(p));
  });
});

describe("VRF-5 R1 SAFEGUARD -- where the BoQ states an inclusion decides it; own rows exclude; heading cases ask for a review", () => {
  it("only a heading says it + the BoQ quotes it on its own row (00114 r24 '(Including Y-Joint)' vs r134) -> NOT added, the note names the row", () => {
    const REFNET_ROW = { items: [{ item: "Refnet/Y-Joint" }], text: "Refnet joints for VRF" };
    const rows = { 24: { items: [ODU({ includes_refnet: "Yes", includes_refnet_where: "Heading", includes_refnet_wording: "Price" })] }, 134: REFNET_ROW };
    const v = sheet(rows)(24);
    expect(byId(v, "acc_refnet")).toBeUndefined();
    // refnet is per indoor unit -> the outdoor unit never carries it; check the review point for the four instead below
    const idu = sheet({ 24: { items: [{ item: "Cassette", brand: "Blue Star", capacity: "2 TR", includes_refnet: "Yes", includes_refnet_where: "Heading", includes_refnet_wording: "Price" }] }, 134: REFNET_ROW })(24);
    expect(byId(idu, "acc_refnet")).toBeUndefined();
    expect(idu.items[0].extras?.review?.points).toEqual(["Refnet: stated in heading (price wording) - NOT added: the BoQ quotes it on its own row (row 134)"]);
    expect(idu.rowPriced).toBe(true);
  });
  it("only a heading says it, no row of its own -> ADDED, with the review point", () => {
    const v = sheet({ 9: { items: [{ item: "Cassette", brand: "Blue Star", capacity: "2 TR", includes_refnet: "Yes", includes_refnet_where: "Heading" }] } })(9);
    expect(val(byId(v, "acc_refnet"), "qty")).toBe("1");
    expect(v.items[0].extras?.review?.points).toEqual(["Refnet: stated in heading - added (the BoQ has no row of its own for it)"]);
  });
  it("the safeguard covers the FOUR too: copper stated in a heading + a copper-piping row of its own -> no copper (nor its insulation) lines", () => {
    const v = sheet({ 9: { items: [ODU({ includes_copper: "Yes", includes_copper_where: "Heading", includes_insulation: "Yes", includes_insulation_where: "Heading" })] },
      40: { items: [{ item: "Copper" }], category: "hvac_piping", text: "Copper piping 12.7 mm with insulation" } })(9);
    expect(lines(v).map((l) => l.id)).toEqual([]);
    expect(v.items[0].extras?.review?.points.length).toBe(2);
    expect(tot(v)).toEqual([301560, 10000]);
  });
  it("NEGATIVE: the row's OWN text states it -> added whatever the sheet quotes elsewhere, no review", () => {
    const v = sheet({ 9: { items: [ODU({ includes_copper: "Yes", includes_copper_where: "Row" })] }, 40: { items: [{ item: "Copper" }], category: "hvac_piping", text: "Copper piping 12.7 mm" } })(9);
    expect(lines(v).map((l) => l.id)).toEqual(["copper_supply", "copper_return"]);
    expect(v.items[0].extras?.review).toBeUndefined();
  });
  it("NEGATIVE (owner ANSWER 9): only THIS sheet's rows of an HVAC category count -- an Electrical-category cable row, or a row no run read, is never a quote", () => {
    const elec = sheet({ 9: { items: [ODU({ includes_power: "Yes", includes_power_where: "Heading" })] }, 50: { items: [{ item: "x" }], category: "wiring_cabling", text: "Power cable 4C x 6 sqmm armoured" } })(9);
    expect(lines(elec).map((l) => l.id)).toEqual(["power"]);
    const unread = sheet({ 9: { items: [ODU({ includes_power: "Yes", includes_power_where: "Heading" })] }, 50: { text: "Power cable 4C x 6 sqmm armoured" } })(9);
    expect(lines(unread).map((l) => l.id)).toEqual(["power"]);
    const hvac = sheet({ 9: { items: [ODU({ includes_power: "Yes", includes_power_where: "Heading" })] }, 50: { items: [{ item: "x" }], category: "hvac_cables", text: "Power cable 4C x 6 sqmm armoured" } })(9);
    expect(lines(hvac).map((l) => l.id)).toEqual([]);
  });
  it("NEGATIVE: a unit row naming the item is not a quote of its own (another ODU row 'with copper piping')", () => {
    const v = sheet({ 9: { items: [ODU({ includes_copper: "Yes", includes_copper_where: "Heading" })] }, 10: { items: [ODU({ capacity: "12 HP" })], text: "12 HP ODU with copper piping" } })(9);
    expect(lines(v).map((l) => l.id)).toEqual(["copper_supply", "copper_return"]);
  });
  it("NEGATIVE: a config without `safeguard` adds every include as VRF-4 did (no review)", () => {
    const v = sheet({ 9: { items: [ODU({ includes_copper: "Yes", includes_copper_where: "Heading" })] }, 40: { items: [{ item: "Copper" }], category: "hvac_piping", text: "Copper piping" } }, vrf5(["safeguard"]))(9);
    expect(lines(v).map((l) => l.id)).toEqual(["copper_supply", "copper_return"]);
    expect(v.items[0].extras?.review).toBeUndefined();
  });
});

describe("VRF-5 F2 -- cable words with no size take the band's default; a stated armour / length applies; the note says which is which", () => {
  it("00117 r233 'multicore copper cables about 5-10 Rmt' -> the default spec, length 10 m (the higher figure, noted), priced", () => {
    const v = sheet({ 233: { items: [ODU({ capacity: "18 HP", includes_power: "Yes", includes_power_where: "Row", extra_cable_spec_as_written: "multicore copper cables about 5-10 Rmt in PVC conduit from isolator to vrf odu" })] } })(233);
    const pw = byId(v, "power")!;
    expect(pw.state).toBe("priced");
    expect(tagOf(pw, "cores")).toBe("default");
    expect(val(pw, "length")).toBe("10");
    expect(tagOf(pw, "length")).toBe("boq");
    expect(pw.fields.find((f) => f.id === "length")?.note).toBe("BoQ says 5-10 m -> 10 m (the higher figure)");
    expect(pw.fields.find((f) => f.id === "spec")?.note).toContain("no size stated: priced at the default");
  });
  it("00401 r10 'armoured copper conductor cabling' -> armour ARMOURED from the BoQ, the size the default", () => {
    const v = sheet({ 10: { items: [ODU({ capacity: "8 HP", includes_power: "Yes", includes_power_where: "Row", extra_cable_spec_as_written: "armoured copper conductor cabling with end termination from Switch to ODU" })] } })(10);
    const pw = byId(v, "power")!;
    expect(val(pw, "armour")).toBe("ARMOURED");
    expect(tagOf(pw, "armour")).toBe("boq");
    expect(tagOf(pw, "sqmm")).toBe("default");
    expect(pw.reason ?? "").not.toContain("Size needed");
    expect(pw.fields.find((f) => f.id === "spec")?.note).toContain("from the BoQ: armoured");
  });
  it("NEGATIVE: v60's words (no cable_words_default) -> 'Size needed' as VRF-4 measured", () => {
    const v = sheet({ 233: { items: [ODU({ capacity: "18 HP", includes_power: "Yes", extra_cable_spec_as_written: "multicore copper cables about 5-10 Rmt" })] } }, vrf5(["words", "safeguard"]))(233);
    expect(byId(v, "power")?.reason).toContain("Size needed");
  });
  it("NEGATIVE: a stated spec ('4C x 10') is read as before", () => {
    const v = sheet({ 9: { items: [ODU({ includes_power: "Yes", includes_power_where: "Row", extra_cable_spec_as_written: "4C x 10 sqmm" })] } })(9);
    expect([val(byId(v, "power"), "cores"), val(byId(v, "power"), "sqmm"), tagOf(byId(v, "power"), "cores")]).toEqual(["4", "10", "boq"]);
  });
});

describe("VRF-5 R2 -- discharge not stated, below the smallest Top unit -> Side", () => {
  it("6 HP W+S (00392 r12) -> Side, the note naming the smallest Top size; priced at the 6 HP Side unit (not the 7 HP Top)", () => {
    const v = sheet({ 12: { items: [ODU({ capacity: "6 HP" })] } })(12);
    const d = fieldOf(v, "discharge")!;
    expect(d.value).toBe("Side");
    expect(d.rule).toMatch(/discharge not stated - priced as Side: the smallest Top unit is 7 HP/);
    expect(v.totals?.supply_rate).toBeLessThan(264240);
  });
  it("3 TR (00098 r14) converts to 3.75 HP -> Side", () => {
    expect(fieldOf(sheet({ 14: { items: [ODU({ capacity: "3 TR" })] } })(14), "discharge")?.value).toBe("Side");
  });
  it("NEGATIVE: a STATED Top wins (00341 r114 '6 HP-top discharge'); 10 HP not stated stays Top; v60's config stays Top", () => {
    expect(fieldOf(sheet({ 114: { items: [ODU({ capacity: "6 HP", discharge: "Top" })] } })(114), "discharge")?.value).toBe("Top");
    expect(fieldOf(sheet({ 9: { items: [ODU({ capacity: "10 HP" })] } })(9), "discharge")?.value).toBe("Top");
    expect(fieldOf(sheet({ 12: { items: [ODU({ capacity: "6 HP" })] } }, vrf5(["r2"]))(12), "discharge")?.value).toBe("Top");
  });
});

describe("VRF-5 R5 -- several makes", () => {
  const brandOf = (said: string, fam: Item = ODU()) => fieldOf(sheet({ 9: { items: [{ ...fam, brand: "None", brand_as_written: said }] } })(9), "brand");
  it("Blue Star among them -> Blue Star, the note says so (00370 r4 'Mitsubshi Electric, Bluestar')", () => {
    const f = brandOf("Mitsubshi Electric, Bluestar")!;
    expect(f.value).toBe("Blue Star");
    expect(f.rule).toBe("several brands stated (Mitsubshi Electric, Bluestar) - Blue Star is one of them: priced as Blue Star");
  });
  it("Blue Star not among them, Daikin stocked -> Daikin, the first stated make stocked", () => {
    const f = brandOf("Toshiba / Daikin")!;
    expect(f.value).toBe("Daikin");
    expect(f.rule).toContain("priced as Daikin, the first stated make the catalogue stocks for this item");
  });
  it("none stocked -> Blue Star + 'none of the stated makes (...) is in the catalogue'", () => {
    const f = brandOf("Toshiba / Hitachi")!;
    expect(f.value).toBe("Blue Star");
    expect(f.rule).toBe("none of the stated makes (Toshiba / Hitachi) is in the catalogue - priced as Blue Star");
  });
  it("NEGATIVE: one make stated = today's rule (a listed one fills the choice; an unlisted one -> the off-sheet default); v60 config: several -> Blue Star", () => {
    // a listed make fills the blank choice (VRF-4's rule): priced as the Daikin unit, no line
    const oneD = sheet({ 9: { items: [{ ...ODU(), brand: "None", brand_as_written: "Daikin" }] } })(9);
    expect(oneD.items[0].figures.supply_rate).toBe(sheet({ 9: { items: [{ ...ODU(), brand: "Daikin" }] } })(9).items[0].figures.supply_rate);
    expect(brandOf("Toshiba")?.rule).toBe("brand Toshiba is not on the sheet - priced as Blue Star");
    expect(fieldOf(sheet({ 9: { items: [{ ...ODU(), brand: "None", brand_as_written: "Toshiba / Daikin" }] } }, vrf5(["r5"]))(9), "brand")?.value).toBe("Blue Star");
  });
});

describe("VRF-5 SCOPE -- supply only / installation only, on every line of the row", () => {
  const withPower = (scope: string) => sheet({ 9: { items: [ODU({ includes_power: "Yes", includes_power_where: "Row", scope })] } })(9);
  it("supply only -> install 0 on the unit AND the extra; the note", () => {
    const base = withPower("Supply + installation");
    const v = withPower("Supply only");
    expect(tot(v)).toEqual([base.totals?.supply_rate, 0]);
    expect(v.items[0].figures.install_rate).toBe(0);
    expect(byId(v, "power")?.figures.install_rate).toBe(0);
    expect(v.scope?.note).toBe("BoQ says supply only - no installation: install 0 on every line of this row.");
  });
  it("installation only -> supply 0; each line's final install x 1.5 rounded up once; the working in the note", () => {
    const base = withPower("");
    const v = withPower("Installation only");
    const ui = base.items[0].figures.install_rate!;
    const pi = byId(base, "power")!.figures.install_rate!;
    expect(tot(v)).toEqual([0, Math.ceil(ui * 1.5) + Math.ceil(pi * 1.5)]);
    expect(v.scope?.note).toContain(`Outdoor Unit ${ui} x (1 + 50%) = ${Math.ceil(ui * 1.5)}`);
  });
  it("installation only with the uplift input absent -> the row refuses, naming the Pricing Input", () => {
    const noUplift = ITEMS.filter((it) => it.attributes?.item !== "vrf_install_only_uplift");
    const v = sheet({ 9: { items: [ODU({ scope: "Installation only" })] } }, vrf5(), noUplift)(9);
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toContain("installation-only uplift");
  });
  it("the calculator's 'BoQ scope' choice gives the panel's figures", () => {
    const p = withPower("Installation only");
    const c = calc([{ base: null, family: "Outdoor Unit", attrs: { brand: "Blue Star", capacity: "10" } }], { [EXTRAS_INCLUDES_KEY]: "power", [SCOPE_OVERRIDE_KEY]: "Installation only" });
    expect(c.scope?.picker?.options).toEqual(["Supply + installation", "Supply only", "Installation only"]);
    expect(tot(c)).toEqual(tot(p));
  });
  it("NEGATIVE: blank / supply + installation -> unchanged; a config without `scope` ignores the answer", () => {
    expect(tot(withPower(""))).toEqual(tot(withPower("Supply + installation")));
    const v = sheet({ 9: { items: [ODU({ scope: "Supply only" })] } }, vrf5(["scope"]))(9);
    expect(tot(v)).toEqual([301560, 10000]);
    expect(v.scope).toBeUndefined();
  });
});

describe("VRF-5 wording -- the per-HP bar", () => {
  it("a 'per HP' row's bar reads PRICED PER HP; a Lot row keeps PRICED PER LOT", () => {
    expect(sheet({ 56: { items: [ODU()], unit: "per HP" } })(56).unitBar?.title).toBe("PRICED PER HP - NOT PRICED. PRICE THIS ROW BY HAND.");
    expect(sheet({ 138: { items: [ODU()], unit: "Lot" } })(138).unitBar?.title).toBe("PRICED PER LOT - NOT PRICED. PRICE THIS ROW BY HAND.");
  });
});
