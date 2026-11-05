/**
 * VRF-3a K2 (owner SET 2026-11-04 17:00 / 17:37 / 17:39 / 18:49, LOT "Refuse + review list" / O-7, QR-1 (a) 19:07, boards 9 / 11).
 *
 * FIXTURE ONLY: v57's VRF config with the 3a per-Set / lot keys added IN THIS FILE (`withVrf3aSet`) and `calculator_only`
 * projected out. The asset (v58) is proved by test_vrf_v58 and the parity / R-39 blocks; this file proves the CODE -- Set =
 * 1 piece with its bar, the refnet count rule in every case, the Lot class -- positive AND negative, and that a config
 * without the keys is untouched.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { countedPieces, itemListPricingSpec, priceItemList, type CountedSpec } from "./itemListPricing";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_QTY_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, unitChoicesOf,
  type ItemListSuggestion, type ItemListView,
} from "./pricingSheetHelper";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const v57 = readJsonFixture<Asset>(new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v57.json", import.meta.url));
const ITEMS: RateMasterItem[] = v57.items.map((it) => ({
  ...it, discipline: v57.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes },
} as RateMasterItem));
const VRF = "hvac_vrf";
const base57 = (): Record<string, any> => {
  const c = structuredClone(v57.category_configs.find((x) => x.category_id === VRF)) as Record<string, any>;
  delete c.calculator_only;
  return c;
};
export const VRF3A_COUNTED: CountedSpec = {
  families: ["Refnet/Y-Joint"],
  covers: {
    id: "set_covers", label: "This row covers *", note: "Which refnets the row buys: both sides of the system, or one side only.",
    options: [
      { value: "Whole system (indoor + outdoor)", sides: ["outdoor", "indoor"] },
      { value: "Outdoor side only", sides: ["outdoor"] },
      { value: "Indoor side only", sides: ["indoor"] },
    ],
  },
  counts: [
    { side: "outdoor", id: "set_odu", label: "Outdoor units in this system *", word: "outdoor", note: "Outdoor refnets = outdoor units - 1." },
    { side: "indoor", id: "set_idu", label: "Indoor units in this system *", word: "indoor", note: "Indoor refnets = indoor units - 1." },
  ],
  tolerance: { share: 0.1, min: 1 },
  bar: "REFNETS PRICED PER SET - CHECK THE COUNT.",
  lines: {
    formula: "Refnets expected: {parts} = {E}",
    match: "The BoQ quantity ({q}) is within +-{W} of the {E} refnets expected: 1 piece in one Set.",
    below: "The BoQ quantity ({q}) is below the {E} refnets expected: {p} pieces in one Set ({q} Sets x {p} = {E}).",
    rounded: "ROUNDED UP to {p} pieces in one Set. {q} Sets x {p} = {n} pieces, {k} more than the {E} expected - check.",
    misfit: "The BoQ quantity ({q}) does not fit the {E} refnets expected - not priced: type the pieces in one Set.",
    counts_missing: "Not priced: say what the row covers and how many outdoor and indoor units the system has - or type the pieces in one Set.",
    qty_missing: "Not priced: type the BoQ quantity of this row - or type the pieces in one Set.",
    typed: "You typed {p} pieces in one Set.",
  },
};
export const VRF3A_LOT = {
  units: ["Lot", "complete system", "LS", "Job", "per HP"],
  bar: "PRICED PER LOT - NOT PRICED. PRICE THIS ROW BY HAND.",
  line: "Unit \"{unit}\" is not a VRF unit: VRF is priced per Nos, per Set or per Kg. What a Lot holds is read at VRF-4. Price this row by hand.",
};
function withVrf3aSet(cfg: Record<string, any>, drop: string[] = []): RateCategoryConfig {
  const c = structuredClone(cfg);
  const pr = c.list_spec.pricing;
  if (!drop.includes("set")) {
    pr.unit_classes.count = [...pr.unit_classes.count, "Set", "Sets"];
    pr.unit_refusal = "unit '{unit}' is not a VRF unit - VRF is priced per Nos, per Set or per Kg - price this row by hand";
    pr.per_set = {
      units: ["Set", "Sets"],
      qty_label: "Pieces in one Set of this row",
      bar: { title: "PRICED PER SET - CHECK WHAT ONE SET HOLDS.", line: "The BoQ prices this row per Set. The helper took one Set = 1 {item} (team rule: 1 Set = 1 piece). If the Set holds more, change \"Pieces in one Set\" below." },
      ...(drop.includes("counted") ? {} : { counted: structuredClone(VRF3A_COUNTED) }),
    };
  }
  if (!drop.includes("lot")) pr.lot_units = structuredClone(VRF3A_LOT);
  return c as RateCategoryConfig;
}
const CFG = withVrf3aSet(base57());
const SPEC = itemListPricingSpec(CFG)!;
const configsOf = (cfg: RateCategoryConfig) => new Map<string, RateCategoryConfig>(v57.category_configs.map((c) => [c.category_id, c.category_id === VRF ? cfg : c]));
const calcOf = (cfg: RateCategoryConfig = CFG) => makePricingSheetHelper({ configsByCategory: configsOf(cfg), items: ITEMS, extractionByRow: new Map(), calculatorSurface: true });
const CALC = calcOf();
const run = (blocks: Array<Record<string, unknown>>, unit: string, rowQty?: string, calc = CALC): ItemListView =>
  (calc.compute(calculatorCtx("HVAC", VRF), {
    [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: blocks }), [ROW_UNIT_OVERRIDE_KEY]: unit,
    ...(rowQty !== undefined ? { [ROW_QTY_OVERRIDE_KEY]: rowQty } : {}),
  }) as unknown as ItemListSuggestion).itemList!;
const tot = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];
const refnet = (covers: string, odu: string, idu: string, qty?: string) => ({ base: null, family: "Refnet/Y-Joint", attrs: { set_covers: covers, set_odu: odu, set_idu: idu }, ...(qty !== undefined ? { qty } : {}) });
const WHOLE = "Whole system (indoor + outdoor)";

describe("VRF-3a SET -- 1 Set = 1 piece (owner 17:00), with the orange bar and 'Pieces in one Set' (U4, board 9)", () => {
  it("C6: Touch Screen Central Controller on a Set row -> 42,000 / 1,500 at 1 piece; 2 pieces -> 84,000 / 3,000", () => {
    const v = run([{ base: null, family: "Touch Screen Central Controller", attrs: {} }], "Set");
    expect(v.rowPriced).toBe(true);
    expect(tot(v)).toEqual([42000, 1500]);
    expect(v.items[0].qty).toBe("1");
    expect(v.items[0].qtyDefaulted).toBe(true);
    expect(v.qtyLabel).toBe("Pieces in one Set of this row");
    expect(v.unitBar).toEqual({
      tone: "orange", title: "PRICED PER SET - CHECK WHAT ONE SET HOLDS.",
      lines: ["The BoQ prices this row per Set. The helper took one Set = 1 Touch Screen Central Controller (team rule: 1 Set = 1 piece). If the Set holds more, change \"Pieces in one Set\" below."],
      ring: "Unit Set · Qty -",
    });
    const two = run([{ base: null, family: "Touch Screen Central Controller", attrs: {}, qty: "2" }], "Set");
    expect(tot(two)).toEqual([84000, 3000]);
    expect(two.items[0].qtyDefaulted).toBe(false);
  });
  it("every spelling: Set / Sets / set / sets price the same; every family but the refnet takes 1 piece", () => {
    for (const u of ["Set", "Sets", "set", "sets"]) expect(tot(run([{ base: null, family: "Remote Controller", attrs: {} }], u))).toEqual(tot(run([{ base: null, family: "Remote Controller", attrs: {} }], "Nos")));
    expect(tot(run([{ base: null, family: "Outdoor Unit", attrs: { capacity: "20" }, other: ["capacity"] }], "Set"))).toEqual([476040, 20000]);
  });
  it("the calculator's Row unit offers Set after Nos; NEGATIVE: without `per_set` it offers Nos only", () => {
    // INVERTED at VRF-3b (owner 2026-11-05 01:15 "Lot in the calculator's Row unit") by mechanical authority: BEFORE
    // ["Nos", "Set"] / ["Nos"]. A config with `lot_units` now offers its first spelling LAST; Set's place after Nos is unchanged
    expect(unitChoicesOf(SPEC, ["Touch Screen Central Controller"])).toEqual(["Nos", "Set", "Lot"]);
    const off = itemListPricingSpec(withVrf3aSet(base57(), ["set"]))!;
    expect(unitChoicesOf(off, ["Touch Screen Central Controller"])).toEqual(["Nos", "Lot"]);
    const offBoth = itemListPricingSpec(withVrf3aSet(base57(), ["set", "lot"]))!;
    expect(unitChoicesOf(offBoth, ["Touch Screen Central Controller"])).toEqual(["Nos"]);
  });
  it("NEGATIVE: a Nos row carries no bar, no label change; without the keys a Set row refuses as v57 does", () => {
    const n = run([{ base: null, family: "Touch Screen Central Controller", attrs: {} }], "Nos");
    expect(n.unitBar).toBeUndefined();
    expect(n.qtyLabel).toBeUndefined();
    const r = priceItemList(itemListPricingSpec(withVrf3aSet(base57(), ["set", "lot"]))!, ITEMS, "Set", [{ attributes: { item: { value: "Touch Screen Central Controller" } } }]);
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("Touch Screen Central Controller is not stocked per 'Set' (stocked per Nos) - price this row by hand");
  });
});

describe("VRF-3a REFNET -- the pieces in one Set from the system's counts (owner 17:00 / 17:37 / 17:39 / 18:49; U5, board 11)", () => {
  it("the rule, every case (pure): match, below, rounded up, misfit, counts missing, quantity missing", () => {
    const a = (covers: string, odu: string, idu: string) => ({ set_covers: covers, set_odu: odu, set_idu: idu });
    expect(countedPieces(VRF3A_COUNTED, a(WHOLE, "4", "50"), 52)).toMatchObject({ state: "match", pieces: 1, expected: 52, formula: "Refnets expected: (4 outdoor - 1) + (50 indoor - 1) = 52" });
    expect(countedPieces(VRF3A_COUNTED, a(WHOLE, "3", "24"), 1)).toMatchObject({ state: "below", pieces: 25, expected: 25 });
    expect(countedPieces(VRF3A_COUNTED, a(WHOLE, "3", "24"), 2)).toMatchObject({ state: "rounded", pieces: 13,
      sentence: "ROUNDED UP to 13 pieces in one Set. 2 Sets x 13 = 26 pieces, 1 more than the 25 expected - check." });
    expect(countedPieces(VRF3A_COUNTED, a(WHOLE, "3", "24"), 20)).toMatchObject({ state: "misfit", pieces: null });
    expect(countedPieces(VRF3A_COUNTED, a(WHOLE, "3", ""), 20)).toMatchObject({ state: "counts_missing", pieces: null });
    expect(countedPieces(VRF3A_COUNTED, a("", "3", "24"), 20)).toMatchObject({ state: "counts_missing", pieces: null });
    expect(countedPieces(VRF3A_COUNTED, a(WHOLE, "3", "24"), null)).toMatchObject({ state: "qty_missing", pieces: null, expected: 25 });
    // one side only: the other count is not needed
    expect(countedPieces(VRF3A_COUNTED, a("Indoor side only", "", "24"), 23)).toMatchObject({ state: "match", pieces: 1, formula: "Refnets expected: (24 indoor - 1) = 23" });
    expect(countedPieces(VRF3A_COUNTED, a("Outdoor side only", "3", ""), 1)).toMatchObject({ state: "match", pieces: 1, expected: 2 });
  });
  it("the tolerance: +-10% or +-1 piece, whichever larger (52 expected: 47..57 match; 10 expected: 9..11 match)", () => {
    const a = (odu: string, idu: string) => ({ set_covers: WHOLE, set_odu: odu, set_idu: idu });
    expect(countedPieces(VRF3A_COUNTED, a("4", "50"), 47).state).toBe("match");
    expect(countedPieces(VRF3A_COUNTED, a("4", "50"), 57).state).toBe("match");
    expect(countedPieces(VRF3A_COUNTED, a("4", "50"), 46).state).toBe("misfit");
    expect(countedPieces(VRF3A_COUNTED, a("2", "10"), 11).state).toBe("match");
    expect(countedPieces(VRF3A_COUNTED, a("2", "10"), 12).state).toBe("misfit");
  });
  it("C7: 3 + 24, qty 1 -> 25 pieces 105,000 / 20,000; qty 2 -> ROUNDED UP to 13, 54,600 / 10,400", () => {
    const v1 = run([refnet(WHOLE, "3", "24")], "Set", "1");
    expect(v1.items[0].qty).toBe("25");
    expect(tot(v1)).toEqual([105000, 20000]);
    expect(v1.unitBar?.tone).toBe("orange");
    expect(v1.unitBar?.title).toBe("REFNETS PRICED PER SET - CHECK THE COUNT.");
    expect(v1.items[0].setCount?.formula).toBe("Refnets expected: (3 outdoor - 1) + (24 indoor - 1) = 25");
    expect(v1.rowQtyField).toEqual({ label: "BoQ quantity of this row", value: "1" });
    expect(v1.unitBar?.ring).toBe("Unit Set · Qty 1");
    const v2 = run([refnet(WHOLE, "3", "24")], "Set", "2");
    expect(v2.items[0].qty).toBe("13");
    expect(tot(v2)).toEqual([54600, 10400]);
    expect(v2.unitBar?.lines).toEqual(["ROUNDED UP to 13 pieces in one Set. 2 Sets x 13 = 26 pieces, 1 more than the 25 expected - check."]);
  });
  it("C7: 4 + 50, qty 52 -> 1 piece 4,200 / 800; 3 + 24, qty 20 -> red, withheld, the box blank", () => {
    const m = run([refnet(WHOLE, "4", "50")], "Set", "52");
    expect(m.items[0].qty).toBe("1");
    expect(tot(m)).toEqual([4200, 800]);
    const w = run([refnet(WHOLE, "3", "24")], "Set", "20");
    expect(w.rowPriced).toBe(false);
    expect(w.items[0].qty).toBe("");
    expect(w.items[0].setCount?.pieces).toBeNull();
    expect(w.items[0].reason).toBe("The BoQ quantity (20) does not fit the 25 refnets expected - not priced: type the pieces in one Set.");
    expect(w.unitBar?.tone).toBe("red");
    expect(w.reason).toBe("The BoQ quantity (20) does not fit the 25 refnets expected - not priced: type the pieces in one Set.");
  });
  it("a typed pieces value wins (the rule does not run); a blank quantity field withholds the row (counts missing too)", () => {
    const t = run([refnet(WHOLE, "3", "24", "20")], "Set", "20");
    expect(t.rowPriced).toBe(true);
    expect(tot(t)).toEqual([84000, 16000]);
    expect(t.items[0].setCount?.sentence).toBe("You typed 20 pieces in one Set.");
    const q = run([refnet(WHOLE, "3", "24")], "Set", "");
    expect(q.rowPriced).toBe(false);
    expect(q.items[0].reason).toBe("Not priced: type the BoQ quantity of this row - or type the pieces in one Set.");
    const c = run([refnet(WHOLE, "", "24")], "Set", "2");
    expect(c.rowPriced).toBe(false);
    expect(c.unitBar?.tone).toBe("red");
  });
  it("a BoQ row (the panel): the three answers read from the row's item and the row's own quantity (ctx.quantity) give the same pieces -- found by the K3 parity", () => {
    const ext = new Map([[7, { excelRow: 7, description: "", attributes: {}, items: [{ attributes: {
      item: { value: "Refnet/Y-Joint" }, set_covers: { value: WHOLE }, set_odu: { value: "3" }, set_idu: { value: "24" } } }] } as never]]);
    const panel = makePricingSheetHelper({ configsByCategory: configsOf(CFG), items: ITEMS, extractionByRow: ext });
    const v = (panel.compute({ excelRow: 7, description: "", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"], unit: "Set", quantity: 1 } as never, {}) as unknown as ItemListSuggestion).itemList!;
    expect(v.items[0].qty).toBe("25");
    expect(tot(v)).toEqual([105000, 20000]);
    expect(v.items[0].setCount?.fields.map((f) => f.value)).toEqual([WHOLE, "3", "24"]);
    expect(v.rowQtyField).toBeUndefined();
    expect(v.unitBar?.ring).toBe("Unit Set · Qty 1");
  });
  it("NEGATIVE: a refnet on a Nos row is one piece per Nos, no fields; without `counted` a Set refnet is 1 piece like the rest", () => {
    const n = run([refnet(WHOLE, "3", "24")], "Nos", "1");
    expect(n.items[0].setCount).toBeUndefined();
    expect(tot(n)).toEqual([4200, 800]);
    expect(n.rowQtyField).toBeUndefined();
    const off = run([refnet(WHOLE, "3", "24")], "Set", "1", calcOf(withVrf3aSet(base57(), ["counted"])));
    expect(tot(off)).toEqual([4200, 800]);
    expect(off.items[0].setCount).toBeUndefined();
  });
});

describe("VRF-3a LOT -- a whole-lot unit refuses with the red bar (owner LOT 'Refuse + review list'; U6, board 9)", () => {
  it("Lot / LOT / lot / LS / Job / per HP / complete system refuse with the line naming the unit as written", () => {
    for (const u of ["Lot", "LOT", "lot", "LS", "Job", "per HP", "complete system"]) {
      const r = priceItemList(SPEC, ITEMS, u, [{ attributes: { item: { value: "Outdoor Unit" }, capacity: { value: "20" } } }]);
      expect(r.priced).toBe(false);
      expect(r.reason).toBe(`Unit "${u}" is not a VRF unit: VRF is priced per Nos, per Set or per Kg. What a Lot holds is read at VRF-4. Price this row by hand.`);
    }
  });
  it("the panel's red bar (a BoQ row supplies the unit; the calculator cannot state Lot)", () => {
    const helper = makePricingSheetHelper({ configsByCategory: configsOf(CFG), items: ITEMS, extractionByRow: new Map(), calculatorSurface: true });
    const v = (helper.compute({ ...calculatorCtx("HVAC", VRF), unit: "Lot" } as any, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "Outdoor Unit", attrs: { capacity: "20" } }] }) }) as unknown as ItemListSuggestion).itemList!;
    expect(v.unitBar).toEqual({ tone: "red", title: "PRICED PER LOT - NOT PRICED. PRICE THIS ROW BY HAND.", lines: ["Unit \"Lot\" is not a VRF unit: VRF is priced per Nos, per Set or per Kg. What a Lot holds is read at VRF-4. Price this row by hand."] });
    // INVERTED at VRF-3b (owner 01:15, U7) by mechanical authority: BEFORE `.not.toContain("Lot")` (the calculator could not
    // state Lot). It can now; the NEGATIVE half is kept: a config without `lot_units` still offers no Lot
    expect(unitChoicesOf(SPEC, ["Outdoor Unit"])).toContain("Lot");
    expect(unitChoicesOf(itemListPricingSpec(withVrf3aSet(base57(), ["lot"]))!, ["Outdoor Unit"])).not.toContain("Lot");
  });
  it("NEGATIVE: without `lot_units` a Lot row refuses with the unit sentence as v57 does", () => {
    const off = itemListPricingSpec(withVrf3aSet(base57(), ["lot"]))!;
    const r = priceItemList(off, ITEMS, "Lot", [{ attributes: { item: { value: "Outdoor Unit" }, capacity: { value: "20" } } }]);
    expect(r.reason).toBe("Outdoor Unit is not stocked per 'Lot' (stocked per Nos) - price this row by hand");
  });
});

describe("VRF-3a -- the Set / refnet / Lot Derivation lines (U8)", () => {
  const linesOf = (cfg: RateCategoryConfig) => itemListRuleOrder(cfg, ITEMS as never).map((l) => `${l.title}. ${l.detail ?? ""}`);
  const L = linesOf(CFG);
  it("three lines added last: Set = 1 piece (every kind but the refnet), the refnet count, Lot not priced", () => {
    expect(L.find((l) => l.startsWith("A row priced per Set takes one Set as one piece (every kind but Refnet/Y-Joint)."))).toContain("'Pieces in one Set of this row' starts at 1 and can be changed");
    expect(L.find((l) => l.startsWith("A Refnet/Y-Joint on a Set row holds the pieces the system's unit counts give."))).toContain("outdoor = outdoor units - 1, indoor = indoor units - 1");
    expect(L.find((l) => l.startsWith("A row priced per Lot is not priced."))).toContain("'Lot', 'complete system', 'LS', 'Job', 'per HP' refuse with a red bar");
  });
  it("line 1's refused-unit example is no longer 'Set' (it prices) nor a Lot spelling (it has its own line); NEGATIVE: v57 keeps 'Set'", () => {
    expect(L[0]).toContain("unit 'Mtr' is not a VRF unit - VRF is priced per Nos, per Set or per Kg");
    expect(linesOf(base57() as RateCategoryConfig)[0]).toContain("unit 'Set' is not a VRF unit");
    expect(linesOf(base57() as RateCategoryConfig).some((l) => l.includes("per Set"))).toBe(false);
  });
});
