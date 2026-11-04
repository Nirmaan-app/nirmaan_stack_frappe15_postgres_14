/**
 * VRF-3a K1 (owner R-SPLIT (a) + (b) 2026-11-01 11:59, R-SPLIT-RULE 12:02, D-1 / D-2 / D-3 / D-8 15:03, SHAPE Q2 "Make 3 lines" /
 * Q3 "Hidden tag" 2026-11-04 14:56, boards 6-8 / 10 18:52 "yes proceed").
 *
 * FIXTURE ONLY: v57's VRF config with the 3a split keys added IN THIS FILE (`withVrf3a`) and `calculator_only` projected
 * out. The asset that ships them (v58) is proved by test_vrf_v58 and the parity / R-39 blocks; this file proves the CODE --
 * the airflow range, `compose.above_only`, the helper split with its hidden tag, the stated split and D-3, each positive
 * AND negative, and that a config without the keys is untouched.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { itemListPricingSpec, priceItemList, readCapacity, readNumber, readStatedSplit, type ExtractedListItem } from "./itemListPricing";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";
import { composeSize } from "./ladderResolution";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, decodeItemEdits, makePricingSheetHelper,
  type ItemEditOp, type ItemListEditState, type ItemListSuggestion, type ItemListView,
} from "./pricingSheetHelper";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { readFileSync } from "node:fs";

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
export const VRF3A_CONDITIONS = {
  words: [
    "at least\\s+\\d+(?:\\.\\d+)?\\s*(?:hp|tr)\\s*each",
    "single\\s+module",
    "single\\s+odu",
    "(?:module selection\\s+)?as per site conditions?",
  ],
  line: "The row says \"{said}\": the helper split it by the team rule anyway (fewest units, then the cheapest) - check this is what the row asks for.",
};
/** The VRF-3a keys, added to a copy of v57's VRF config (the mint adds the same; test_vrf_v58 pins the asset). */
function withVrf3a(cfg: Record<string, any>, drop: string[] = []): RateCategoryConfig {
  const c = structuredClone(cfg);
  const pr = c.list_spec.pricing;
  if (!drop.includes("compose")) pr.compose = { attr: "capacity", tolerance: 34, max_layers: 6, cost_key: "cost_supply", ...(drop.includes("above_only") ? {} : { above_only: true }) };
  if (!drop.includes("split")) pr.split = { families: ["Outdoor Unit"], ...(drop.includes("stated") ? {} : { stated: true }), ...(drop.includes("conditions") ? {} : { conditions: VRF3A_CONDITIONS }) };
  return c as RateCategoryConfig;
}
const CFG = withVrf3a(base57());
const SPEC = itemListPricingSpec(CFG)!;
const configsOf = (cfg: RateCategoryConfig) => new Map<string, RateCategoryConfig>(v57.category_configs.map((c) => [c.category_id, c.category_id === VRF ? cfg : c]));

const calcOf = (cfg: RateCategoryConfig = CFG) => makePricingSheetHelper({ configsByCategory: configsOf(cfg), items: ITEMS, extractionByRow: new Map(), calculatorSurface: true });
const CALC = calcOf();
const runState = (state: ItemListEditState, unit = "Nos", calc = CALC): ItemListView =>
  (calc.compute(calculatorCtx("HVAC", VRF), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: unit }) as unknown as ItemListSuggestion).itemList!;
const runBlocks = (blocks: Array<Record<string, unknown>>, unit = "Nos", calc = CALC) => runState({ items: blocks as any }, unit, calc);
const outdoor = (capacity: string, more: Record<string, string> = {}) => ({ base: null, family: "Outdoor Unit", attrs: { capacity, ...more }, other: ["capacity"] });
const edit = (v: ItemListView, op: ItemEditOp) => runState(applyItemEdit(v.editState, op));
const tot = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];
const lines = (v: ItemListView) => v.items.map((b) => [b.fields.find((f) => f.id === "capacity")?.value, b.figures.supply_rate, b.figures.install_rate]);

describe("VRF-3a R1 -- an airflow RANGE is one airflow (board 10)", () => {
  const rd = SPEC.numbers.capacity;
  const ctx = (familyUnit: string) => ({ familyUnit, factorOf: (id: string) => (id === "vrf_hp_per_tr" ? 1.25 : id === "vrf_kw_per_tr" ? 3.517 : null), family: null });
  it("'1700-1800cfm' refuses with the airflow sentence naming '1700-1800 CFM' (never 1700 TR)", () => {
    expect(readCapacity("1700-1800cfm", rd, ctx("TR"))).toEqual({ blank: "capacity is stated only as an airflow (1700-1800 CFM) - an airflow is not converted to HP / TR - price this row by hand" });
    expect(readCapacity("1700 to 1800 CFM", rd, ctx("TR"))).toEqual({ blank: "capacity is stated only as an airflow (1700-1800 CFM) - an airflow is not converted to HP / TR - price this row by hand" });
    expect(readCapacity("1700 – 1800 cfm", rd, ctx("TR"))).toEqual({ blank: "capacity is stated only as an airflow (1700-1800 CFM) - an airflow is not converted to HP / TR - price this row by hand" });
  });
  it("a capacity beside an airflow range is read, the range set aside with one line", () => {
    expect(readCapacity("4 TR / 1700-1800 CFM", rd, ctx("TR"))).toEqual({ value: 4, note: "1700-1800 CFM is an airflow - not read" });
  });
  it("NEGATIVE: a capacity range keeps R6's top value; a bare range in the family's unit; a single airflow as before", () => {
    expect(readCapacity("10-12 TR", rd, ctx("TR"))).toMatchObject({ value: 12 });
    expect(readCapacity("10-12", rd, ctx("TR"))).toMatchObject({ value: 12 });
    expect(readCapacity("1800cfm", rd, ctx("TR"))).toEqual({ blank: "capacity is stated only as an airflow (1800 CFM) - an airflow is not converted to HP / TR - price this row by hand" });
    expect(readCapacity("4.0 TR -1200 cfm", rd, ctx("TR"))).toEqual({ value: 4, note: "1200 CFM is an airflow - not read" });
  });
  it("NEGATIVE (BEFORE): a reader WITHOUT `units` reads '1700-1800cfm' exactly as readNumber does (top of the range)", () => {
    const { units: _u, ...plain } = rd;
    expect(readCapacity("1700-1800cfm", plain, ctx("TR"))).toEqual(readNumber("1700-1800cfm", plain));
  });
});

describe("VRF-3a -- compose.above_only (R-SPLIT-RULE: never below the total)", () => {
  const ladder = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28];
  it("60 on the Blue Star Top ladder: two-sided gives 28 + 28 (4 BELOW); above_only gives three units adding up exactly", () => {
    expect(composeSize(60, ladder, { tolerance: 28, max_layers: 6 })).toEqual({ layers: [28, 28], delta: -4 });
    const c = composeSize(60, ladder, { tolerance: 28, max_layers: 6, above_only: true })!;
    expect(c.layers.length).toBe(3);
    expect(c.delta).toBe(0);
  });
  it("NEGATIVE: above_only absent or false is the two-sided search (Insulation byte-identical)", () => {
    expect(composeSize(57, ladder, { tolerance: 2, max_layers: 4 })).toEqual(composeSize(57, ladder, { tolerance: 2, max_layers: 4, above_only: false }));
    expect(composeSize(57, ladder, { tolerance: 2, max_layers: 4 })?.delta).toBe(-1);
    const up = composeSize(57, ladder, { tolerance: 2, max_layers: 4, above_only: true })!;
    expect(up.delta).toBe(1);
    expect(up.layers.length).toBe(3);
  });
});

describe("VRF-3a -- the helper split (R-SPLIT (b), R-SPLIT-RULE, D-1, boards 6-7)", () => {
  it("AC0 / C1: 54 HP, no brand -> two lines 28 + 26 = 568,920 + 547,440 / 28,000 + 26,000 (combined 1,170,360)", () => {
    const v = runBlocks([outdoor("54")]);
    expect(lines(v)).toEqual([["28", 568920, 28000], ["26", 547440, 26000]]);
    expect(tot(v)).toEqual([1116360, 54000]);
    expect(v.totals?.combined_rate).toBe(1170360);
    expect(v.rowPriced).toBe(true);
    expect(v.items.map((b) => b.source)).toEqual(["helper", "helper"]);
    expect(v.items.map((b) => b.helperLine)).toEqual(["From the helper's split of 54 HP -> 28 HP", "From the helper's split of 54 HP -> 26 HP"]);
    expect(v.split?.note).toBe("54 HP is bigger than the largest unit (28 HP), so the helper split it: 28 + 26 HP (fewest units that add up exactly; the cheapest of the equal splits). Each unit is its own item below: change, add or remove them.");
    expect(v.split?.changed).toBeUndefined();
    expect(v.items.every((b) => !b.changedByYou)).toBe(true);
  });
  it("C2: 60 HP -> 24 + 24 + 12 = 1,335,600 / 60,000; C3: 66 HP -> 28 + 26 + 12 = 1,428,840 / 66,000 (never below)", () => {
    const v60 = runBlocks([outdoor("60")]);
    expect(lines(v60).map((l) => l[0])).toEqual(["24", "24", "12"]);
    expect(tot(v60)).toEqual([1335600, 60000]);
    const v66 = runBlocks([outdoor("66")]);
    expect(lines(v66).map((l) => l[0])).toEqual(["28", "26", "12"]);
    expect(tot(v66)).toEqual([1428840, 66000]);
    for (const t of [57, 58, 62]) {
      const v = runBlocks([outdoor(String(t))]);
      const sum = v.items.reduce((a, b) => a + Number(b.fields.find((f) => f.id === "capacity")?.value), 0);
      expect(sum).toBeGreaterThanOrEqual(t);
    }
  });
  it("C5 / board 5: 43.2 TR on an Outdoor Unit is converted first (54 HP) and split; the note carries the conversion line", () => {
    const v = runBlocks([outdoor("43.2 TR")]);
    expect(lines(v).map((l) => l[0])).toEqual(["28", "26"]);
    expect(v.split?.note.startsWith("43.2 TR x 1.25 (HP per TR, Pricing Inputs) = 54 HP. 54 HP is bigger than the largest unit (28 HP)")).toBe(true);
  });
  it("every line keeps the row's brand and variant: Blue Star Side 20 HP -> 12 + 8 (largest Side 16); Daikin Top 22 HP -> 16 + 6", () => {
    const side = runBlocks([outdoor("20", { discharge: "Side" })]);
    expect(lines(side).map((l) => l[0])).toEqual(["12", "8"]);
    expect(side.split?.note.startsWith("20 HP is bigger than the largest unit (16 HP)")).toBe(true);
    const dk = runBlocks([outdoor("22", { brand: "Daikin" })]);
    expect(lines(dk).map((l) => l[0])).toEqual(["16", "6"]);
    expect(dk.items.every((b) => b.fields.find((f) => f.id === "brand")?.value === "Daikin")).toBe(true);
  });
  it("NEGATIVE: at or under the largest is never split (28 HP one line); a Ductable above 8 TR still refuses (DUCTABLE: no splitting)", () => {
    const one = runBlocks([outdoor("28")]);
    expect(one.items.length).toBe(1);
    expect(one.split).toBeUndefined();
    const duct = runBlocks([{ base: null, family: "Ductable", attrs: { capacity: "12" }, other: ["capacity"] }]);
    expect(duct.items.length).toBe(1);
    expect(duct.items[0].reason).toBe("capacity 12 is above the largest size on the sheet (8)");
  });
  it("NEGATIVE (BEFORE): without `split`, `compose` alone is Insulation's ONE block of layers (no lines, no tag); v57 refuses", () => {
    const v = runBlocks([outdoor("54")], "Nos", calcOf(withVrf3a(base57(), ["split"])));
    expect(v.items.length).toBe(1);
    expect(v.split).toBeUndefined();
    expect(v.editState.items.some((e) => e.helper)).toBe(false);
    const v57only = runBlocks([outdoor("54")], "Nos", calcOf(withVrf3a(base57(), ["split", "compose"])));
    expect(v57only.items[0].reason).toBe("capacity 54 is above the largest size on the sheet (28)");
  });
  it("NEGATIVE: the pure pricer never prices a split request (state blank) -- only the panel helper makes the lines", () => {
    const r = priceItemList(SPEC, ITEMS, "Nos", [{ attributes: { item: { value: "Outdoor Unit" }, capacity: { value: "54" } }, splitAllowed: true } as ExtractedListItem]);
    expect(r.priced).toBe(false);
    expect(r.items[0].splitInto).toMatchObject({ total: 54, layers: [28, 26], exact: true, top: 28, unit: "HP" });
    const r2 = priceItemList(SPEC, ITEMS, "Nos", [{ attributes: { item: { value: "Outdoor Unit" }, capacity: { value: "54" } } }]);
    expect(r2.items[0].splitInto).toBeUndefined();
    expect(r2.items[0].reason).toBe("capacity 54 is above the largest size on the sheet (28)");
  });
});

describe("VRF-3a -- the hidden tag (Q3): an edit never re-splits; changed by you; reset (board 7)", () => {
  it("the tag survives encode / decode and a re-compute from the returned state makes the same two lines (no re-split)", () => {
    const v = runBlocks([outdoor("54")]);
    expect(v.editState.items.every((e) => e.helper)).toBe(true);
    const round = decodeItemEdits(JSON.stringify(v.editState), 0);
    expect(round.items.map((e) => e.helper?.size)).toEqual(["28", "26"]);
    const again = runState(v.editState);
    expect(lines(again)).toEqual(lines(v));
    expect(again.split?.changed).toBeUndefined();
  });
  it("C2: line 3 to 14 HP -> 'changed by you', the amber box, 1,428,360 / 62,000 and the 62-vs-60 note, no re-split", () => {
    const v = runBlocks([outdoor("60")]);
    const e = edit(v, { op: "set_attr", index: 2, id: "capacity", value: "14" });
    expect(e.items.length).toBe(3);
    expect(e.items.map((b) => !!b.changedByYou)).toEqual([false, false, true]);
    expect(tot(e)).toEqual([1428360, 62000]);
    expect(e.split?.changed).toBe("You changed the helper's split. The helper will not split this row again: the lines below stay as you set them. The row total is the sum of the lines.");
    expect(e.split?.linesNote).toBe("The lines add up to 62 HP; the BoQ says 60 HP. The row is still priced as you set it: check this is what you meant.");
    expect(e.split?.resetLabel).toBe("Reset to the helper's split");
  });
  it("C2: remove line 3 -> 1,023,120 / 48,000 (the box shows; no re-split); Reset -> 24 + 24 + 12 again", () => {
    const v = runBlocks([outdoor("60")]);
    const r = edit(v, { op: "remove", index: 2 });
    expect(r.items.length).toBe(2);
    expect(tot(r)).toEqual([1023120, 48000]);
    expect(r.split?.changed).toBeDefined();
    // found in the cert: the row note still says the helper's split, not the lines left
    expect(r.split?.note).toContain("so the helper split it: 24 + 24 + 12 HP");
    const back = edit(r, { op: "reset_split" });
    expect(lines(back).map((l) => l[0])).toEqual(["24", "24", "12"]);
    expect(tot(back)).toEqual([1335600, 60000]);
    expect(back.split?.changed).toBeUndefined();
  });
  it("adding an item after the split counts as a change; a 54 HP typed into the new line is NOT split (the row is the pricer's)", () => {
    const v = runBlocks([outdoor("54")]);
    const a = edit(v, { op: "add", family: "Outdoor Unit" });
    expect(a.split?.changed).toBeDefined();
    const t = edit(a, { op: "set_attr", index: 2, id: "capacity", value: "54" });
    expect(t.items.length).toBe(3);
    expect(t.items[2].reason).toBe("capacity 54 is above the largest size on the sheet (28)");
  });
  it("NEGATIVE: the calculator's re-run of the seam with no tags (the parity feed's shape) never double-splits a line", () => {
    const v = runBlocks([outdoor("54")]);
    const fed = v.items.map((b) => ({ base: null, family: b.family, attrs: { capacity: b.fields.find((f) => f.id === "capacity")!.value }, qty: b.qty }));
    const re = runBlocks(fed);
    expect(lines(re)).toEqual(lines(v));
  });
});

describe("VRF-3a -- the stated split (R-SPLIT (a), Q2 'Make 3 lines', D-2, board 8)", () => {
  const rd = SPEC.numbers.capacity;
  it("the reader: the four written forms and the bare chain", () => {
    expect(readStatedSplit("60 HP (18+18+24)", rd)).toEqual({ modules: [18, 18, 24], total: 60, unit: "HP", written: "18+18+24" });
    expect(readStatedSplit("26(14+12)HP", rd)).toEqual({ modules: [14, 12], total: 26, unit: "HP", written: "14+12" });
    expect(readStatedSplit("20+18 HP", rd)).toEqual({ modules: [20, 18], total: null, unit: "HP", written: "20+18HP" });
    expect(readStatedSplit("18HP+16HP", rd)).toEqual({ modules: [18, 16], total: null, unit: "HP", written: "18HP+16HP" });
    expect(readStatedSplit("38 HP - Out door unit (14HP+24HP)", rd)).toEqual({ modules: [14, 24], total: 38, unit: "HP", written: "14HP+24HP" });
    expect(readStatedSplit("18+18+24", rd)).toEqual({ modules: [18, 18, 24], total: null, unit: null, written: "18+18+24" });
  });
  it("NEGATIVE: no chain, a W+S count, two chains or two units are not a stated split", () => {
    expect(readStatedSplit("54 HP", rd)).toBeNull();
    expect(readStatedSplit("2# 12 HP", rd)).toBeNull();
    expect(readStatedSplit("10+10 HP and 8+8 HP", rd)).toBeNull();
    expect(readStatedSplit("10 TR+12 HP", rd)).toBeNull();
    const { units: _u, ...plain } = rd;
    expect(readStatedSplit("60 HP (18+18+24)", plain)).toBeNull();
  });
  it("C4: typed '60 HP (18+18+24)' -> 3 lines 452,040 + 452,040 + 511,560 = 1,415,640 / 60,000, with the read note", () => {
    const v = runBlocks([outdoor("60 HP (18+18+24)")]);
    expect(lines(v)).toEqual([["18", 452040, 18000], ["18", 452040, 18000], ["24", 511560, 24000]]);
    expect(tot(v)).toEqual([1415640, 60000]);
    expect(v.split?.note).toBe("You typed a split: 18 + 18 + 24 HP (total 60 HP) -> one line per module, each priced on its own.");
    expect(v.split?.sumNote).toBeUndefined();
  });
  it("C4: '26(14+12)HP' -> 717,720 / 26,000 (14 + 12), NOT one 26 HP unit (the silent single-unit price is gone)", () => {
    const v = runBlocks([outdoor("26(14+12)HP")]);
    expect(lines(v).map((l) => l[0])).toEqual(["14", "12"]);
    expect(tot(v)).toEqual([717720, 26000]);
  });
  it("C4 / D-2: '60 HP (30+30)' refuses the row, naming the module", () => {
    const v = runBlocks([outdoor("60 HP (30+30)")]);
    expect(v.items.length).toBe(1);
    expect(v.rowPriced).toBe(false);
    expect(v.items[0].reason).toBe("Module 30 HP is above the largest size on the sheet (28 HP) - this row is not priced; price it by hand");
  });
  it("a sum unlike the total gets the amber note; a module between rungs takes the next size up on the variant", () => {
    const v = runBlocks([outdoor("50 HP (18+18+18)")]);
    expect(v.split?.sumNote).toBe("The modules add up to 54 HP, not the 50 HP the split states. Each module is priced as written: check this is what you meant.");
    const side = runBlocks([outdoor("26 HP (13+13)", { discharge: "Side" })]);
    expect(side.items.map((b) => b.fields.find((f) => f.id === "capacity")?.value)).toEqual(["14", "14"]);
    expect(side.rowPriced).toBe(true);
  });
  it("the stated split beats the helper (00175 r17: stated 18 + 18 + 24, not the helper's 24 + 24 + 12)", () => {
    const v = runBlocks([outdoor("60 HP (18+18+24)")]);
    expect(tot(v)[0]).toBe(1415640);
  });
  it("NEGATIVE: '2# 12 HP' stays one unit (W+S is VRF-4's); without `split.stated` the bracket is dropped as in v57", () => {
    const ws = runBlocks([outdoor("2# 12 HP")]);
    expect(ws.items.length).toBe(1);
    expect(ws.split).toBeUndefined();
    const off = runBlocks([outdoor("26(14+12)HP")], "Nos", calcOf(withVrf3a(base57(), ["stated"])));
    expect(off.items.length).toBe(1);
    expect(tot(off)).toEqual([547440, 26000]);
  });
});

describe("VRF-3a D-3 -- a condition the row states is quoted in an amber note; the split still follows the rule", () => {
  it("'20 HP (Single module)' at Side splits 12 + 8 with the note quoting 'Single module'", () => {
    const v = runBlocks([outdoor("20 HP (Single module)", { discharge: "Side" })]);
    expect(lines(v).map((l) => l[0])).toEqual(["12", "8"]);
    expect(v.split?.condition).toBe("The row says \"Single module\": the helper split it by the team rule anyway (fewest units, then the cheapest) - check this is what the row asks for.");
  });
  it("NEGATIVE: no condition words -> no note; without `conditions` -> no note", () => {
    expect(runBlocks([outdoor("54")]).split?.condition).toBeUndefined();
    const off = runBlocks([outdoor("20 HP (Single module)", { discharge: "Side" })], "Nos", calcOf(withVrf3a(base57(), ["conditions"])));
    expect(off.split?.condition).toBeUndefined();
    expect(off.items.length).toBe(2);
  });
});

describe("VRF-3a -- the Derivation lines (U8)", () => {
  const linesOf = (cfg: RateCategoryConfig) => itemListRuleOrder(cfg, ITEMS as never).map((l) => `${l.title}. ${l.detail ?? ""}`);
  const L = linesOf(CFG);
  const L57 = linesOf(base57() as RateCategoryConfig);
  it("the capacity ladder line says the helper's split on the Outdoor Unit, every other family refusing above the largest", () => {
    const fit = L.find((l) => l.startsWith("Fitting the stated capacity to the catalogue."))!;
    expect(fit).toContain("an Outdoor Unit is split by the helper into 6 or fewer separate units -- the fewest units, adding up exactly, else the smallest total above, then the cheapest");
    expect(fit).toContain("every other item above the largest refuses, naming the size");
    expect(L.some((l) => l.includes("the model writes as layers"))).toBe(false);
  });
  it("the conversion line gains the airflow range; the three split lines are added last", () => {
    expect(L.find((l) => l.startsWith("A capacity in TR, HP or kW"))).toContain("an airflow range ('1700-1800 CFM') is one airflow");
    expect(L.some((l) => l.startsWith("A split the row writes is priced as one Outdoor Unit per module."))).toBe(true);
    expect(L.some((l) => l.startsWith("A condition the row states about the split is quoted in an amber note."))).toBe(true);
    expect(L.some((l) => l.startsWith("A split the pricer has changed is never split again."))).toBe(true);
  });
  it("NEGATIVE: v57's lines carry none of it (no split, no range clause)", () => {
    expect(L57.some((l) => l.includes("split"))).toBe(false);
    expect(L57.some((l) => l.includes("airflow range"))).toBe(false);
    expect(L.length).toBe(L57.length + 3);
  });
});

describe("VRF-3a -- the split family's size box commits on leaving the box (found in the cert)", () => {
  it("the Outdoor Unit's capacity field carries splitOnCommit; NEGATIVE: an indoor family, a Ductable and a config without `split` do not", () => {
    const fieldOf = (v: ItemListView) => v.items[0].fields.find((f) => f.id === "capacity")!;
    expect(fieldOf(runBlocks([outdoor("16")])).splitOnCommit).toBe(true);
    expect(fieldOf(runBlocks([{ base: null, family: "Cassette", attrs: { capacity: "2" }, other: ["capacity"] }])).splitOnCommit).toBeUndefined();
    expect(fieldOf(runBlocks([{ base: null, family: "Ductable", attrs: { capacity: "4" }, other: ["capacity"] }])).splitOnCommit).toBeUndefined();
    expect(fieldOf(runBlocks([outdoor("16")], "Nos", calcOf(withVrf3a(base57(), ["split"])))).splitOnCommit).toBeUndefined();
  });
  it("(source) the panel draws that box as a CommitInput handing the value over on blur and Enter, and every other typed box as before", () => {
    const panel = readFileSync(new URL("./RateHelperPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain("{f.allowOther && otherMode(f) && f.splitOnCommit && (");
    expect(panel).toContain("onBlur={commit}");
    expect(panel).toContain('onKeyDown={(e) => { if (e.key === "Enter") commit(); }}');
    expect(panel).toContain("{f.allowOther && otherMode(f) && !f.splitOnCommit && (");
    expect(panel).toContain('onChange={(e) => onEdit({ op: "set_attr", index: i, id: f.id, value: e.target.value })}');
  });
});
