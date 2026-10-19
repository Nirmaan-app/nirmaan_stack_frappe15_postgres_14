/**
 * ADP-1 (owner rulings 2026-10-19: H3 slot diffusers, H4 plenums / mixing boxes, A4 Pricing Inputs, F1 / F3 / F4
 * Insulation riders; the owner's piece-length ruling; "the unwanted attributes should be removed from the pricing
 * panel and calculator") -- every new rule through the PANEL'S ENTRY POINT (`makePricingSheetHelper(...).compute`)
 * and the calculator, positive and negative, on the ADP-1 config (`applyAdp1(v46)`; the asset commit pins it equal
 * to v47).
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { itemListRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import { computePricingInputReach } from "@/pages/pricing/rate-master/pricingInputReach";
import { confirmedCandidateSkus } from "@/pages/pricing/rate-master/pricingInputExact";
import type { ExtractionRow } from "./rateHelperTypes";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { PIECE_LENGTH_MIN_MM, itemFieldDefs, itemListPricingSpec, listSpecDefs, numbersLine, readNumber, readPieceLength } from "./itemListPricing";
import { ADP1_ALL, ADP1_INPUTS, ADP1_RETIRED_UIDS, applyAdp1, type AssetLike } from "./adp1.harness";

const V46 = readJsonFixture<AssetLike>(new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v46.json", import.meta.url));
const NEW = applyAdp1(V46);
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const world = (a: AssetLike) => ({
  configs: new Map<string, RateCategoryConfig>(a.category_configs.map((c) => [c.category_id, c])),
  items: a.items.map((it, i) => ({ ...it, name: (it as any).name ?? `item-${i}`, discipline: a.discipline } as RateMasterItem)),
});
const W_NEW = world(NEW), W_OLD = world(V46);

type W = ReturnType<typeof world>;
const cells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
function panel(cat: string, unit: string, model: Record<string, string>, o: { desc?: string; headings?: string[]; w?: W } = {}) {
  const w = o.w ?? W_NEW;
  const ext = new Map<number, ExtractionRow>();
  ext.set(1, { excelRow: 1, description: o.desc ?? "", attributes: {}, items: [{ attributes: cells(model) }] } as unknown as ExtractionRow);
  const r = makePricingSheetHelper({ configsByCategory: w.configs, items: w.items, extractionByRow: ext })
    .compute({ excelRow: 1, description: o.desc ?? "", nodeType: "Line Item", category: cat, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: o.headings ?? [], ownNotes: [], unit } as any, {});
  return view(r as ItemListSuggestion);
}
function calc(cat: string, rowUnit: string, family: string, attrs: Record<string, string>, o: { other?: string[]; w?: W } = {}) {
  const w = o.w ?? W_NEW;
  const r = makePricingSheetHelper({ configsByCategory: w.configs, items: w.items, extractionByRow: new Map() })
    .compute({ excelRow: 1, description: "", nodeType: "Line Item", category: cat, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"] } as any,
      { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family, attrs, other: o.other ?? [] }] }), [ROW_UNIT_OVERRIDE_KEY]: rowUnit });
  return view(r as ItemListSuggestion);
}
function view(s: ItemListSuggestion) {
  const v = s.itemList!;
  const b = v.items[0];
  const fields = (b?.fields ?? []).map((f) => f.label);
  const field = (label: string) => b?.fields.find((f) => f.label === label);
  return { s, v, b, priced: v.rowPriced, supply: s.values.supply_rate, install: s.values.install_rate, reason: b?.reason ?? v.reason, working: b?.working ?? [], fields, field };
}
const SLOT = "slot diffuser", MIX = "mixing box / LP plenum";
const NR = "Nitrile Rubber Insulation", PUF = "Tubular Puf Insulation", ACO = "Acoustic Nitrile Insulation";

// =====================================================================================================================
describe("ADP-1 H3 -- the piece length as the size states it (owner ruling 2026-10-19)", () => {
  it("named length, the longest side of 'a x b' / 'a x b x c', and a lone unlabelled number of 300 mm or more", () => {
    expect(readPieceLength("1500 mm long")).toEqual({ metres: 1.5, how: "the length as written" });
    expect(readPieceLength("2200 mm Length")).toEqual({ metres: 2.2, how: "the length as written" });
    expect(readPieceLength("1000x150")).toEqual({ metres: 1, how: "the longest side" });
    expect(readPieceLength("150 x 1200")).toEqual({ metres: 1.2, how: "the longest side" });
    expect(readPieceLength("(1200x151x350)mm")).toEqual({ metres: 1.2, how: "the longest side" });
    expect(readPieceLength("1000 mm")).toEqual({ metres: 1, how: "a single size of 300 mm or more" });
    expect(readPieceLength("300")).toEqual({ metres: 0.3, how: "a single size of 300 mm or more" });
    expect(PIECE_LENGTH_MIN_MM).toBe(300);
  });
  it("NEGATIVE: below 300 mm a lone number is a slot width; a word beside it, a list or nothing is no length", () => {
    for (const t of ["75mm", "299 mm", "20mm slot", "110 mm wide", "20/25mm", "100/150/200 mm", "", "None", null, "2 slot"]) expect({ t, r: readPieceLength(t) }).toEqual({ t, r: null });
  });
  it("a typed length in metres; mm and cm converted with a line (the reader's unit 'm')", () => {
    const rd = { from: ["piece_length_m"], name: "piece length", unit: "m" };
    expect(readNumber("1.5", rd)).toEqual({ value: 1.5 });
    expect(readNumber("1500 mm", rd)).toEqual({ value: 1.5, note: "1500 mm read as 1.5 m" });
    expect(readNumber("150 cm", rd)).toEqual({ value: 1.5, note: "150 cm read as 1.5 m" });
    // NEGATIVE: a reader in mm is untouched
    expect(readNumber("1500 mm", { from: [], name: "x", unit: "mm" })).toEqual({ value: 1500 });
  });
});

// =====================================================================================================================
describe("ADP-1 H3 -- slot diffusers by unit (owner 14:15 / 14:24, 2026-10-19)", () => {
  it("per sq.m: damper only -- with prices 8960 x 1.45 / 1790 x 1.6 = 12,992 / 2,864, whatever the slots", () => {
    for (const slots of ["2", "3 slot/2slot", "4 slot", undefined]) {
      const x = panel(ADP, "sqm", { family: SLOT, damper: "with", ...(slots ? { slot_count: slots } : {}) });
      expect({ slots, priced: x.priced, f: [x.supply, x.install] }).toEqual({ slots, priced: true, f: [12992, 2864] });
    }
  });
  it("per sq.m: without (stated, or not mentioned) refuses by name, the default shown amber", () => {
    for (const d of ["without", "None"]) {
      const x = panel(ADP, "sqm", { family: SLOT, damper: d });
      expect({ priced: x.priced, reason: x.reason }).toEqual({ priced: false, reason: "No SKU for a slot diffuser per sq.m without damper - price this row by hand" });
      expect(x.field("Damper")?.value).toBe("without");
    }
    // NEGATIVE (v46): the generic sentence
    expect(panel(ADP, "sqm", { family: SLOT, damper: "without" }, { w: W_OLD }).reason).toBe("No SKU for slot diffuser: without damper - price this row by hand");
  });
  it("per metre: slots + damper; 2-slot with damper 1465 / 352; 1- and 4-slot refuse by name", () => {
    const x = panel(ADP, "RMT", { family: SLOT, damper: "with", slot_count: "2 slot" });
    expect([x.priced, x.supply, x.install]).toEqual([true, 1465, 352]);
    for (const n of ["1", "4", "24"]) {
      const y = panel(ADP, "RMT", { family: SLOT, damper: "with", slot_count: `${n} Slot` });
      expect({ n, priced: y.priced, reason: y.reason }).toEqual({ n, priced: false, reason: `No SKU for a ${n}-slot diffuser - price this row by hand` });
    }
    // NEGATIVE (v46): the slot count was one fact among several in the generic sentence
    expect(panel(ADP, "RMT", { family: SLOT, damper: "with", slot_count: "4 Slot" }, { w: W_OLD }).reason).toBe("No SKU for slot diffuser: with damper, slot count 4 - price this row by hand");
  });
  it("per number, a stated length: the per-metre SKU (slots + damper) x the length -- 1520 x 1.5 = 2280 -> 3306 / 220 x 1.5 = 330 -> 528", () => {
    const x = panel(ADP, "Nos", { family: SLOT, damper: "with", slot_count: "3", size_mm: "1500 mm long" });
    expect([x.priced, x.supply, x.install]).toEqual([true, 3306, 528]);
    expect(x.b.skuLine).toBe("Aluminium (Al) Slot diffuser with hit and miss damper / 3 slot (Rmt)");
    expect(x.working).toContain("supply: 1520 x 1.5 = 2280");
    expect(x.working).toContain("install: 220 x 1.5 = 330");
    expect(x.field("Piece length (m)")).toMatchObject({ value: "1.5", note: "BoQ says 1500 mm long -> 1.5 m (the length as written)", defaulted: false });
    // the longest side of a stored "1000x150" (BOQ-26-00093 / 149): 1520 x 1 -> 2204 / 352
    const y = panel(ADP, "Nos", { family: SLOT, damper: "with", slot_count: "3 Slot", size_mm: "1000x150" });
    expect([y.supply, y.install]).toEqual([2204, 352]);
    // a lone "1000 mm" (BOQ-26-00329 / 228-235) is 1 m by the owner's 300 mm ruling, read, not defaulted
    const z = panel(ADP, "each", { family: SLOT, damper: "None", slot_count: "2 slot", size_mm: "1000 mm" });
    expect(z.field("Piece length (m)")).toMatchObject({ value: "1", defaulted: false });
    expect([z.supply, z.install]).toEqual([1160, 352]);
  });
  it("per number, no length: 1 m, amber, with the U2 line; a slot width (75 mm) is not a length", () => {
    for (const size of [undefined, "75mm", "20mm slot"]) {
      const x = panel(ADP, "Nos", { family: SLOT, damper: "with", slot_count: "2", ...(size ? { size_mm: size } : {}) });
      expect({ size, f: [x.supply, x.install] }).toEqual({ size, f: [1465, 352] });
      expect(x.field("Piece length (m)")).toMatchObject({ value: "1", defaulted: true, rule: "no piece length stated - priced at 1 m" });
      expect(x.working).toContain("piece length not mentioned -> 1 (no piece length stated - priced at 1 m)");
    }
  });
  it("per number: no slot count refuses naming it; a 4-slot refuses by name", () => {
    expect(panel(ADP, "Nos", { family: SLOT, damper: "with", size_mm: "600x600" }).reason).toBe("per-number row: no slot count stated to convert the per-metre rate");
    expect(panel(ADP, "Nos", { family: SLOT, damper: "with", slot_count: "4 Slot", size_mm: "1000x150" }).reason).toBe("No SKU for a 4-slot diffuser - price this row by hand");
    // NEGATIVE (v46): per number used the per-sq.m SKU x W x H and ignored the slots
    const old = panel(ADP, "Nos", { family: SLOT, damper: "with", slot_count: "3 Slot", size_mm: "1000x150" }, { w: W_OLD });
    expect([old.supply, old.install]).toEqual([1949, 430]);
  });
  it("calculator: 1.5 m typed prices x 1.5; 1500 mm typed is read as 1.5 m; cleared or untouched -> 1 m, amber", () => {
    expect([calc(ADP, "nos", SLOT, { damper: "with", slot_count: "3", piece_length_m: "1.5" }).supply]).toEqual([3306]);
    const mm = calc(ADP, "nos", SLOT, { damper: "with", slot_count: "3", piece_length_m: "1500 mm" });
    expect(mm.supply).toBe(3306);
    expect(mm.working).toContain("piece length: 1500 mm read as 1.5 m");
    const cleared: Array<Record<string, string>> = [{ damper: "with", slot_count: "3", piece_length_m: "" }, { damper: "with", slot_count: "3" }];
    for (const attrs of cleared) {
      const x = calc(ADP, "nos", SLOT, attrs);
      expect([x.supply, x.install]).toEqual([2204, 352]);
      expect(x.field("Piece length (m)")).toMatchObject({ value: "1", defaulted: true });
    }
    // NEGATIVE: a typed word refuses naming the field, never the 1 m default
    expect(calc(ADP, "nos", SLOT, { damper: "with", slot_count: "3", piece_length_m: "long" }).reason).toBe("no number in 'long' for piece length");
  });
  it("THE FIELDS (owner 15:56): per sq.m Damper; per metre Damper + Slots; per number Damper + Slots + Piece length -- panel and calculator", () => {
    const want: Record<string, string[]> = { sqm: ["Damper"], RMT: ["Damper", "Slots (as written)"], Nos: ["Damper", "Slots (as written)", "Piece length (m)"] };
    for (const [unit, labels] of Object.entries(want)) {
      expect({ unit, panel: panel(ADP, unit, { family: SLOT, damper: "with", slot_count: "3", size_mm: "1000x150", area_band: "up to 0.5 sqm" }).fields }).toEqual({ unit, panel: labels });
      const cu = unit === "sqm" ? "sqm" : unit === "RMT" ? "rmt" : "nos";
      expect({ unit, calc: calc(ADP, cu, SLOT, { damper: "with", slot_count: "3" }).fields }).toEqual({ unit, calc: labels });
    }
    // REMOVED, measured against v46 (the report lists them): per number "Size (as written)" and "Area band (as written)"
    const spec46 = itemListPricingSpec(W_OLD.configs.get(ADP))!, spec47 = itemListPricingSpec(W_NEW.configs.get(ADP))!;
    const labels = (spec: any, cfg: any, cls: string) => itemFieldDefs(spec, listSpecDefs(cfg), SLOT, cls).map((f) => f.label);
    expect(labels(spec46, W_OLD.configs.get(ADP), "count")).toEqual(["Damper", "Size (as written)", "Area band (as written)"]);
    expect(labels(spec47, W_NEW.configs.get(ADP), "count")).toEqual(["Damper", "Slots (as written)", "Piece length (m)"]);
    for (const cls of ["area", "length"]) expect(labels(spec47, W_NEW.configs.get(ADP), cls)).toEqual(labels(spec46, W_OLD.configs.get(ADP), cls));
  });
  it("NEGATIVE: no other family reads, shows or mentions the piece length", () => {
    const spec = itemListPricingSpec(W_NEW.configs.get(ADP))!;
    for (const fam of Object.keys(spec.families)) {
      if (fam === SLOT) continue;
      for (const cls of ["count", "area", "length"]) {
        expect({ fam, cls, has: itemFieldDefs(spec, listSpecDefs(W_NEW.configs.get(ADP)), fam, cls).some((f) => f.id === "piece_length_m") }).toEqual({ fam, cls, has: false });
      }
    }
    const vcd = panel(ADP, "Nos", { family: "VCD", variant: "GI rectangular", size_mm: "1500 mm long x 300" });
    expect(vcd.working.join("\n")).not.toMatch(/piece length/);
  });
});

// =====================================================================================================================
describe("ADP-1 H4 -- the per-number mixing box / LP plenum (owner 14:34 / 14:41, 2026-10-19)", () => {
  it("L, B, H stated: 1230 x 2 x (LB + BH + LH) / 10^6 + 150 = 1423.05 -> 1424 -> x 1.45 = 2065 supply; install has no 150", () => {
    const x = panel(ADP, "Nos", { family: MIX, insulated: "None", size_mm: "450x450x350" });
    expect([x.priced, x.supply, x.install]).toEqual([true, 2065, 0]);
    expect(x.working).toContain("supply: 1230 x 2 x (450 x 450 + 450 x 350 + 450 x 350) / 10^6 + 150 = 1423.05");
    expect(x.working).toContain("supply: pricing input: Mixing box supply adder (amount) = 150");
    expect(x.working.filter((w) => w.startsWith("install:") && /\+ 150/.test(w))).toEqual([]);
    // the same figure v46 gave (S7 is unchanged: the 150 stays on the cost, before the round-up and the markup)
    const old = panel(ADP, "Nos", { family: MIX, insulated: "None", size_mm: "450x450x350" }, { w: W_OLD });
    expect([old.supply, old.install]).toEqual([2065, 0]);
  });
  it("a missing dimension refuses NAMING the missing ones -- a length-only plenum (BOQ-26-00087 rows 70-74) names width and height", () => {
    expect(panel(ADP, "EA", { family: MIX, insulated: "None", size_mm: "2200 mm Length" }).reason).toBe("per-number row: no width and height stated to convert the per-sq.m rate");
    expect(panel(ADP, "Nos", { family: MIX, insulated: "with", size_mm: "600x300" }).reason).toBe("per-number row: no depth stated to convert the per-sq.m rate");
    expect(panel(ADP, "Nos", { family: MIX, insulated: "with" }).reason).toBe("per-number row: no width and height and depth stated to convert the per-sq.m rate");
    // calculator, C5 / C6(i)
    expect(calc(ADP, "nos", MIX, { insulated: "with", size_mm: "2200 mm length" }, { other: ["size_mm"] }).reason).toBe("per-number row: no width and height stated to convert the per-sq.m rate");
    // NEGATIVE (v46): every need was named
    expect(panel(ADP, "EA", { family: MIX, insulated: "None", size_mm: "2200 mm Length" }, { w: W_OLD }).reason).toBe("per-number row: no width and height and depth stated to convert the per-sq.m rate");
  });
  it("per sq.m unchanged: 1230 x 1.45 = 1784", () => {
    for (const w of [W_NEW, W_OLD]) expect(panel(ADP, "sqm", { family: MIX, insulated: "with" }, { w }).supply).toBe(1784);
  });
  it("the two per-number SKUs are gone from v47 and from no rule's reach (they were never matched)", () => {
    expect(NEW.items.filter((it) => (ADP1_RETIRED_UIDS as readonly string[]).includes(String(it.item_uid)))).toEqual([]);
    expect(V46.items.filter((it) => (ADP1_RETIRED_UIDS as readonly string[]).includes(String(it.item_uid))).map((it) => [it.unit, (it.attributes as any).family])).toEqual([["Nos", MIX], ["Nos", MIX]]);
  });
});

// =====================================================================================================================
describe("ADP-1 A4 -- the three literals are HVAC Pricing Inputs, and ZERO prices move at their values", () => {
  it("the three inputs, exactly", () => {
    const pi = NEW.items.filter((it) => it.kind === "hvac_pricing_input").map((it) => [(it.attributes as any).item, it.rates]);
    expect(pi.filter(([id]) => ADP1_INPUTS.some((p) => p.item === id))).toEqual([
      ["mixing_box_supply_adder", { amount: 150 }], ["crosstalk_assumed_depth_mm", { factor: 300 }], ["flexible_duct_length_m", { factor: 2.5 }]]);
  });
  it("a4 alone prices the cross-talk, flexible duct and mixing box per number exactly as v46", () => {
    const A4 = world(applyAdp1(V46, ["a4"]));
    const cross = V46.items.find((it) => (it.attributes as any).family === "cross-talk" && it.unit === "Nos")!.attributes as any;
    const rows: Array<[string, Record<string, string>]> = [
      [MIX, { family: MIX, insulated: "with", size_mm: "600x600x400" }],
      ["flexible duct", { family: "flexible duct", insulated: "with", dia_mm: "200" }],
      ["cross-talk", { family: "cross-talk", size_mm: `${cross.face_w_mm}x${cross.face_h_mm}` }],
    ];
    for (const [fam, m] of rows) {
      const a = panel(ADP, "Nos", m, { w: A4 }), b = panel(ADP, "Nos", m, { w: W_OLD });
      expect({ fam, f: [a.priced, a.supply, a.install] }).toEqual({ fam, f: [b.priced, b.supply, b.install] });
      expect(a.priced).toBe(true);
    }
  });
  it("AC0 (d) in code: the adder moves the per-number supply by exactly the difference before the markup (150 -> 200: cost + 50)", () => {
    const bumped = applyAdp1(V46);
    (bumped.items.find((it) => (it.attributes as any).item === "mixing_box_supply_adder")!.rates as any).amount = 200;
    const x = panel(ADP, "Nos", { family: MIX, insulated: "None", size_mm: "450x450x350" }, { w: world(bumped) });
    expect(x.working).toContain("supply: 1230 x 2 x (450 x 450 + 450 x 350 + 450 x 350) / 10^6 + 200 = 1473.05");
    expect([x.supply, x.install]).toEqual([Math.ceil(1474 * 1.45), 0]);
  });
  it("the reach (owner Q2): all three are read by ADP; the 150 and the 2.5 m move 0 SKUs (they act only on per-number conversion), the 300 the cross-talk SKUs", () => {
    const configs = Object.fromEntries(NEW.category_configs.map((c) => [c.category_id, c]));
    const reach = computePricingInputReach(configs as any, W_NEW.items as any);
    for (const p of ADP1_INPUTS) expect({ id: p.item, readBy: reach[p.item]?.readByCategories }).toEqual({ id: p.item, readBy: [ADP] });
    expect(reach.mixing_box_supply_adder.distinctSkus).toEqual([]);
    expect(reach.flexible_duct_length_m.distinctSkus).toEqual([]);
    const crossNos = W_NEW.items.filter((it) => (it.attributes as any).family === "cross-talk" && it.unit === "Nos").map((it) => it.item_uid).sort();
    expect(crossNos).toHaveLength(6);
    // the cross-talk SKUs store no cost of their own (their cells derive from the base row), so they are the reach's
    // CANDIDATES, each confirmed by pricing it through the product with the input moved
    const byUid = new Map(W_NEW.items.map((it) => [String(it.item_uid), it]));
    const confirmed = (id: string) => confirmedCandidateSkus(reach[id].candidateSkus, byUid, configs, W_NEW.items, id).map((c) => c.itemUid).sort();
    expect(confirmed("crosstalk_assumed_depth_mm")).toEqual(crossNos);
    expect(confirmed("mixing_box_supply_adder")).toEqual([]);
    expect(confirmed("flexible_duct_length_m")).toEqual([]);
    // NEGATIVE: an input no rule reads is reached by nothing; Insulation's inputs keep their reach
    const old = computePricingInputReach(Object.fromEntries(V46.category_configs.map((c) => [c.category_id, c])) as any, W_OLD.items as any);
    expect(old.mixing_box_supply_adder).toBeUndefined();
    for (const id of ["alu_sheet_26g", "gi_sheet_rate", "glass_cloth"]) expect({ id, skus: reach[id].distinctSkus }).toEqual({ id, skus: old[id].distinctSkus });
  });
  it("numbersLine: geometry steps only, the numbers in place", () => {
    expect(numbersLine({ target: "c", formula: "base*l", params: { l_from_attr: "len" } }, { c: 1520 }, { len: 1.5 })).toBe("1520 x 1.5");
    expect(numbersLine({ target: "c", formula: "base*(1+m)", params: { m_from_ctx: "x" } }, { c: 1, x: 0.45 }, {})).toBeNull();
    expect(numbersLine({ target: "c", formula: "base*l", params: { l_from_attr: "len" } }, { c: 1 }, {})).toBeNull();
  });
});

// =====================================================================================================================
describe("ADP-1 F1 / F3 / F4 -- the Insulation riders (owner 09:57 / 10:16, 2026-10-19)", () => {
  const NIT = { item: NR, cladding: "26G Aluminium", thickness_mm: "19" };
  it("F1: a bare '4' on Nitrile refuses (4 inches lies above the largest); v46 priced it at 6.35", () => {
    expect(panel(INS, "RMT", { ...NIT, pipe_size_mm: "4" }).reason).toBe("size 4 has no unit - price this row by hand");
    expect(panel(INS, "RMT", { ...NIT, pipe_size_mm: "4" }, { w: W_OLD }).priced).toBe(true);
    expect(calc(INS, "mts", NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "4" }, { other: ["pipe_size_mm"] }).reason).toBe("size 4 has no unit - price this row by hand");
  });
  it("F1 NEGATIVE: '2' and '4' on Tubular PUF and '2' on Nitrile refuse exactly as before; F2 '2 inch' still 607 / 224; '4 mm' prices", () => {
    for (const [fam, size] of [[PUF, "2"], [PUF, "4"], [NR, "2"]] as const) {
      const m = fam === PUF ? { item: PUF, cladding: "No", thickness_mm: "25", pipe_size_mm: size } : { ...NIT, pipe_size_mm: size };
      expect({ fam, size, r: panel(INS, "RMT", m).reason }).toEqual({ fam, size, r: panel(INS, "RMT", m, { w: W_OLD }).reason });
    }
    expect([panel(INS, "RMT", { ...NIT, pipe_size_mm: "2 inch" }).supply, panel(INS, "RMT", { ...NIT, pipe_size_mm: "2 inch" }).install]).toEqual([607, 224]);
    expect(panel(INS, "RMT", { ...NIT, pipe_size_mm: "4 mm" }).priced).toBe(true);
  });
  it("F1 NEGATIVE: a pipe's size mirrored into its insulation section is the pipe's mm reading, never a bare number (BOQ-26-00149 / 234 'Dia6.24mm')", () => {
    const ext = new Map<number, ExtractionRow>();
    ext.set(1, { excelRow: 1, description: "Dia6.24mm", attributes: {}, items: [
      { attributes: cells({ pipe_type: "Copper", size_mm: "Dia6.24mm", insulated: "Yes" }) },
      { attributes: cells({ item: NR, cladding: "No", thickness_mm: "13" }), section: "insulation" }] } as unknown as ExtractionRow);
    const run = (w: W) => makePricingSheetHelper({ configsByCategory: w.configs, items: w.items, extractionByRow: ext })
      .compute({ excelRow: 1, description: "Dia6.24mm", nodeType: "Line Item", category: PIP, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: [], ownNotes: [], unit: "Rmt" } as any, {}) as ItemListSuggestion;
    const a = run(W_NEW), b = run(W_OLD);
    expect(a.values).toEqual(b.values);
    expect(a.itemList!.rowPriced).toBe(true);
  });
  it("F3: a GI frame with perforated Al sheet copied as the cladding, or only in a heading, prices as the stocked GI Framework option", () => {
    const base = { item: ACO, cladding: "None", thickness_mm: "19" };
    const copy = panel(INS, "sqm", { ...base, cladding_as_written: "GI frame with perforated Al sheet" }, { desc: "Acoustic lining with GI frame with perforated Al sheet" });
    const head = panel(INS, "sqm", base, { headings: ["Acoustic insulation with GI framework and perforated aluminium sheet"] });
    const pick = panel(INS, "sqm", { ...base, cladding: "GI Framework with perforated Al sheet" });
    for (const x of [copy, head]) {
      expect([x.priced, x.supply, x.install]).toEqual([true, pick.supply, pick.install]);
      expect(x.field("Cladding")?.value).toBe("GI Framework with perforated Al sheet");
    }
    expect(copy.working).toContain("BoQ says GI frame with perforated Al sheet -> priced as GI Framework with perforated Al sheet");
    expect(head.working).toContain("BoQ says GI framework and perforated aluminium sheet -> priced as GI Framework with perforated Al sheet");
    const and = panel(INS, "sqm", { ...base, cladding_as_written: "GI framework and perforated aluminium sheet" });
    expect(and.supply).toBe(pick.supply);
    // NEGATIVE: a category whose cladding does NOT offer the GI framework option reads nothing -- the row naming it
    // refuses (the D3 rule) and a heading-only row prices with no cladding, exactly as before ADP-1
    const noGi = structuredClone(NEW) as AssetLike;
    const def = (noGi.category_configs.find((c) => c.category_id === INS) as any).list_spec.attribute_definitions.find((d: any) => d.id === "cladding");
    def.values = def.values.filter((v: string) => v !== "GI Framework with perforated Al sheet");
    const wNo = world(noGi);
    expect(panel(INS, "sqm", { ...base, cladding_as_written: "GI frame with perforated Al sheet" }, { desc: "Acoustic lining with GI frame with perforated Al sheet", w: wNo }).priced).toBe(false);
    const h = panel(INS, "sqm", base, { headings: ["Acoustic insulation with GI framework and perforated aluminium sheet"], w: wNo });
    expect([h.priced, h.supply === pick.supply]).toEqual([true, false]);
  });
  it("F3 NEGATIVE: an answered cladding stands; a GI frame or strip alone (no perforated aluminium) is not a cladding", () => {
    const x = panel(INS, "sqm", { item: ACO, cladding: "No", thickness_mm: "19", cladding_as_written: "GI frame with perforated Al sheet" });
    expect(x.working.join("\n")).not.toMatch(/priced as GI Framework/);
    for (const said of ["GI frame", "GI strip at 1 m grid", "perforated sheet"]) {
      const y = panel(INS, "RMT", { item: NR, cladding: "None", thickness_mm: "19", pipe_size_mm: "50", cladding_as_written: said });
      expect({ said, hit: y.working.some((w) => /GI Framework/.test(w)) }).toEqual({ said, hit: false });
    }
  });
  it("F4: RPUF on a per-sq.m row refuses by name; per metre still prices as Tubular PUF", () => {
    const sq = { item: "None", cladding: "No", thickness_mm: "50", material_as_written: "RPUF" };
    expect(panel(INS, "sqm", sq).reason).toBe("No SKU in the catalogue for RPUF - price this row by hand");
    // NEGATIVE: a catalogue that stocks a PUF sheet (the PUF family offered per sq.m) does not refuse
    const sheet = structuredClone(NEW) as AssetLike;
    const fams = (sheet.category_configs.find((c) => c.category_id === INS) as any).list_spec.pricing.families;
    fams[PUF].units.area = fams["Thermal Nitrile Insulation"].units.area;
    expect(panel(INS, "sqm", sq, { w: world(sheet) }).reason ?? "").not.toBe("No SKU in the catalogue for RPUF - price this row by hand");
    const m = panel(INS, "RMT", { ...sq, thickness_mm: "40", pipe_size_mm: "100" });
    expect([m.priced, m.b.family]).toEqual([true, PUF]);
    // NEGATIVE: an answered material stands on a sheet row
    expect(panel(INS, "sqm", { ...sq, item: "Thermal Nitrile Insulation" }).priced).toBe(true);
  });
  it("F4 NEGATIVE (AC6): an ADP double-skin plenum saying 'RPUF injected panel' prices exactly as on v46", () => {
    for (const t of ["25 mm", "50 mm"]) {
      const m = { family: "double-skin plenum", thickness_mm: t };
      const o = { desc: `Double skin plenum ${t} RPUF injected panel` };
      expect([panel(ADP, "sqm", m, o).supply, panel(ADP, "sqm", m, o).install]).toEqual([panel(ADP, "sqm", m, { ...o, w: W_OLD }).supply, panel(ADP, "sqm", m, { ...o, w: W_OLD }).install]);
    }
  });
});

// =====================================================================================================================
describe("ADP-1 U6 -- the Derivation tab: lines ADDED, every earlier line kept", () => {
  const titles = (a: AssetLike, cat: string) => itemListRuleOrder(a.category_configs.find((c) => c.category_id === cat), a.items as any).map((l) => l.title);
  it("ADP gains exactly its new lines, every v46 line kept in order", () => {
    const before = titles(V46, ADP), after = titles(NEW, ADP);
    expect(after.filter((t) => before.includes(t))).toEqual(before);
    expect(after.filter((t) => !before.includes(t))).toEqual([
      "A per-number slot diffuser is priced from the per-metre rate",
      "A per-number slot diffuser without slot count refuses, naming what is missing",
      "A per-number mixing box / LP plenum is priced from the per-sq.m rate",
      "A per-number mixing box / LP plenum without width, height, depth refuses, naming what is missing",
      "A slot count the catalogue does not stock refuses",
      "A piece length is typed in 'Piece length (m)', else read from the size",
      "without as the damper on a per-sq.m row of slot diffuser refuses",
    ]);
  });
  it("Insulation: v47's key adds the F1 line; the F3 and F4 lines come from the code over keys v46 already carries; Piping gains none", () => {
    const before = titles(V46, INS), after = titles(NEW, INS);
    expect(after.filter((t) => before.includes(t))).toEqual(before);
    expect(after.filter((t) => !before.includes(t))).toEqual(["A pipe size written as a bare number whose inch reading is above the largest refuses"]);
    for (const t of ["RPUF on a per-sq.m row refuses by name", "A GI frame or framework with perforated aluminium sheet, with no cladding answered, prices as GI Framework with perforated Al sheet"]) {
      expect({ t, v46: before.includes(t), v47: after.includes(t) }).toEqual({ t, v46: true, v47: true });
      expect(titles(NEW, ADP)).not.toContain(t);
    }
    expect(titles(NEW, PIP)).toEqual(titles(V46, PIP));
  });
  it("the three literals are shown as Pricing Inputs; the 1 m default is said in metres, with no ladder", () => {
    const lines = itemListRuleOrder(NEW.category_configs.find((c) => c.category_id === ADP), NEW.items as any);
    const steps = lines.find((l) => l.title === "Then the priced steps below, in their own order")!.detail!;
    for (const n of ["Mixing box supply adder", "Cross-talk assumed depth", "Flexible duct length per piece"]) expect(steps).toContain(n);
    expect(lines.find((l) => l.title === "A fact the row does not mention takes its ruled value")!.detail).toContain("piece length not mentioned at all -> 1 m; a piece length the row itself states always wins");
    // NEGATIVE: Insulation's thickness default keeps its words, byte for byte
    const ins = (a: AssetLike) => itemListRuleOrder(a.category_configs.find((c) => c.category_id === INS), a.items as any).find((l) => l.title === "A fact the row does not mention takes its ruled value")!.detail;
    expect(ins(NEW)).toBe(ins(V46));
  });
  it("every part of the delta is applied by ADP1_ALL", () => {
    expect([...ADP1_ALL].sort()).toEqual(["a4", "f1", "h3", "h4", "retire"]);
  });
});

// =====================================================================================================================
describe("ADP-1 AC10 -- the minted HVAC v47 IS v46 + applyAdp1 (the harness every test above runs on cannot drift from the asset)", () => {
  const V47 = readJsonFixture<AssetLike>(new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v47.json", import.meta.url));
  it("every config is deep-equal, in the same order", () => {
    expect(V47.category_configs.map((c) => c.category_id)).toEqual(NEW.category_configs.map((c) => c.category_id));
    for (const c of V47.category_configs) expect({ id: c.category_id, cfg: c }).toEqual({ id: c.category_id, cfg: NEW.category_configs.find((x) => x.category_id === c.category_id) });
  });
  it("the items: every carried one byte-equal, the two retired absent, the three inputs equal by content (their uids are the mint's)", () => {
    const strip = (it: any) => ({ kind: it.kind, brand: it.brand ?? null, unit: it.unit, attributes: it.attributes, rates: it.rates });
    const byUid = new Map(V47.items.map((it) => [String(it.item_uid), it]));
    const carried = NEW.items.filter((it) => it.item_uid);
    for (const it of carried) expect({ uid: it.item_uid, it: byUid.get(String(it.item_uid)) }).toEqual({ uid: it.item_uid, it });
    for (const u of ADP1_RETIRED_UIDS) expect(byUid.has(u)).toBe(false);
    const fresh = V47.items.filter((it) => !V46.items.some((o) => o.item_uid === it.item_uid));
    expect(fresh.map(strip).sort((a, b) => String(a.attributes.item).localeCompare(String(b.attributes.item))))
      .toEqual(NEW.items.filter((it) => !it.item_uid).map(strip).sort((a, b) => String(a.attributes.item).localeCompare(String(b.attributes.item))));
    expect(V47.items).toHaveLength(NEW.items.length);
  });
});
