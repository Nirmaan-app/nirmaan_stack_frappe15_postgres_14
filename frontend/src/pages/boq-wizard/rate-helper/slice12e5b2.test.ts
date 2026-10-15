/**
 * SLICE 12e-5b2 Part 1 (owner, 2026-10-15, on the 12e-5b review) -- THE PRICER'S SHARE OF THE SEVEN FIXES.
 * No model is asked here. Every model answer is one a 12e-5b run stored (copied as stored, row named), or a
 * hand-built answer in the same shape, marked SYNTHETIC where it is used. Rules are tested from the PANEL'S ENTRY
 * POINT (`makePricingSheetHelper(...).compute`) and, where a figure is asserted, against the PURE pricer.
 *
 *   AC4  (R4) A thickness written with two values -- "6mm thk (9MM)", "6 mm / 9 mm", "6 or 9 mm", "13/19" -- takes
 *        the higher, on the one reader that declares `several: "highest"` (Insulation's thickness, which is also the
 *        reader of a Piping row's insulation section). A typed thickness keeps the 12d-6 rule: one number only.
 *   AC5  (R5, owner ruling in the run: "Option 2. C-R1 is the full ruleset") The composition chooser is UNCHANGED
 *        (fewest layers -> closest -> lowest material cost); a composed field shows the TOTAL ("24"), with the
 *        composition line under it, never one layer's ("9").
 *   AC6  (R6) A single layer's cladding is measured on the pipe size AS READ + 2 x its thickness, as a composition's
 *        outer layer already was; an exact match, a row without cladding and a catalogue row are unchanged.
 *
 * Priced against the v40 asset (live on dev); this slice's code needs no new config key.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, makePricingSheetHelper,
  type ItemBlockView, type ItemEditOp, type ItemListEditState, type ItemListSuggestion, type ItemListView, type SectionBlockView,
} from "./pricingSheetHelper";
import { TYPED_THICKNESS_MESSAGE, itemListPricingSpec, listSpecDefs, priceItemList, readNumber, type NumberReader } from "./itemListPricing";
import { composeSize } from "./ladderResolution";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const V40 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v40.json`, import.meta.url));
const ITEMS: RateMasterItem[] = V40.items.map((it) => ({ ...it, discipline: V40.discipline } as RateMasterItem));
const CONFIGS = new Map<string, RateCategoryConfig>(V40.category_configs.map((c) => [c.category_id, c]));
const INS = "hvac_insulation", PIP = "hvac_piping";
const KINDS = ["supply_rate", "install_rate", "combined_rate"] as const;
const NITRILE = "Nitrile Rubber Insulation";
const SEC = "insulation";
const INS_SPEC = itemListPricingSpec(CONFIGS.get(INS)!)!;
const THK = INS_SPEC.numbers.thickness_mm as NumberReader;

type Answer = Record<string, string | null>;
function stored(category: string, a: Answer): { attributes: ExtractionRow["attributes"]; section?: string } {
  const { section, ...given } = a;
  const own = section ? listSpecDefs(CONFIGS.get(INS)!) : listSpecDefs(CONFIGS.get(category)!);
  const attributes: Record<string, { value: string | null; confidence: number }> = {};
  for (const d of own) attributes[d.id] = { value: null, confidence: 0 };
  for (const [k, v] of Object.entries(given)) attributes[k] = { value: v, confidence: 0.9 };
  return { attributes: attributes as ExtractionRow["attributes"], ...(section ? { section } : {}) };
}
type Shown = { v: ItemListView; values: ItemListSuggestion["values"] };
/** The BoQ-ROW (panel) path: the stored answer through `extractionByRow`, the row's own unit, text and headings. */
function panel(category: string, answer: Answer[], unit: string, desc = "", headings: string[] = [], edits?: ItemListEditState): Shown {
  const row = { excelRow: 1, description: desc, attributes: {}, items: answer.map((a) => stored(category, a)) } as unknown as ExtractionRow;
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
  const ctx = { excelRow: 1, description: desc, nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS], unit, headings, ownNotes: [] } as RateHelperRowContext & { unit?: string };
  const r = h.compute(ctx, edits ? { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(edits) } : {});
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { v: s.itemList!, values: s.values };
}
/** The CALCULATOR path: no extraction; the whole edit state is the override; the unit is a pick. */
function calc(category: string, state: ItemListEditState, unit = "mts"): Shown {
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
  const ctx: RateHelperRowContext = { excelRow: 1, description: "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS] };
  const r = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: unit });
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { v: s.itemList!, values: s.values };
}
const field = (b: ItemBlockView, id: string) => b.fields.find((f) => f.id === id)!;
const fig = (values: Partial<Record<string, number>> | undefined): [number | undefined, number | undefined] => [values?.supply_rate, values?.install_rate];
const attached = (v: ItemListView, at = 0): SectionBlockView => v.items[at].sections![0];
const secBlock = (sv: SectionBlockView): ItemBlockView => sv.view.items[0];
const working = (b: ItemBlockView): string[] => b.working.map((w) => w.trim());

// =====================================================================================================
// AC4 -- two thickness values: the higher
// =====================================================================================================
describe("AC4 the reader: two thickness values take the higher (several: \"highest\" only)", () => {
  const FORMS: Array<[string, number]> = [
    ["6mm thk (9MM)", 9], ["6mm thk ... (9MM)", 9], ["6 mm / 9 mm", 9], ["6 or 9 mm", 9], ["13/19", 19], ["9 or 6", 9], ["19mm (13mm)", 19],
  ];
  it("the Insulation thickness reader is the one that declares several: highest", () => {
    expect(THK.several).toBe("highest");
  });
  for (const [t, hi] of FORMS) {
    it(`'${t}' -> ${hi}, with the 'states two values' line`, () => {
      expect(readNumber(t, THK)).toEqual({ value: hi, note: `'${t}' states two values -- the higher, ${hi}, is taken` });
    });
  }
  it("NEGATIVE a bracket of words is still a qualifier; an equal bracket is one value; three 'or' values still refuse", () => {
    expect(readNumber("9 mm (Class O)", THK)).toEqual({ value: 9 });
    expect(readNumber("19 (19mm)", THK)).toEqual({ value: 19 });
    expect(readNumber("13 or 19 or 25", THK)).toEqual({ blank: "several values stated for thickness ('13 or 19 or 25')" });
  });
  it("NEGATIVE a reader WITHOUT several: highest is byte-identical (the bracket dropped, 'or' refused)", () => {
    const plain: NumberReader = { from: ["x"], name: "thickness", unit: "mm" } as NumberReader;
    expect(readNumber("6mm thk (9MM)", plain)).toEqual({ value: 6 });
    expect(readNumber("6 or 9 mm", plain)).toEqual({ blank: "several values stated for thickness ('6 or 9 mm')" });
  });
});

// BOQ-26-00186 / HVAC WORKS row 74, AS STORED (12e-5b re-read): Thermal Nitrile per sq.m, thickness "6mm thk ... (9MM)".
const R74: Answer[] = [{ item: "Thermal Nitrile Insulation", cladding: "None", cladding_as_written: null, thickness_mm: "6mm thk ... (9MM)", pipe_size_mm: null, brand: null, material_as_written: "Class-1 nitrile rubber sheets" }];
const D74 = "THERMAL INSULATION - NITRILE RUBBER: Thermal Insulation using 6mm thk Class-1 nitrile rubber sheets for branch ducts. (9MM)";

describe("AC4 the sweep: Insulation row, Piping section, model-read and typed", () => {
  it("Insulation row (model): 00186 row 74 reads 9 with the line; 383 / 154", () => {
    const r = panel(INS, R74, "SQM", D74);
    const f = field(r.v.items[0], "thickness_mm");
    expect(f.value).toBe("9");
    expect(f.note).toBe("BoQ says 6mm thk ... (9MM) -> 9 mm (states two values -- the higher, 9, is taken)");
    expect(fig(r.values)).toEqual([383, 154]);
  });
  it("Piping section (model): 'or' and a bracket price the higher, the same as typing the higher", () => {
    // SYNTHETIC: a copper pipe with a nitrile section stating its thickness two ways
    const pipe = (thk: string): Answer[] => [
      { pipe_type: "Copper", pipe_type_as_written: "copper", size_mm: "12.7 mm", pipe_class: null, insulated: "Yes" },
      { section: SEC, item: NITRILE, cladding: "None", thickness_mm: thk, pipe_size_mm: "12.7 mm", brand: null, material_as_written: "nitrile rubber" }];
    const higher = panel(PIP, pipe("19 mm"), "Rmt");
    for (const t of ["13 or 19 mm", "13mm thk (19MM)", "13/19"]) {
      const r = panel(PIP, pipe(t), "Rmt");
      expect(secBlock(attached(r.v)).state).toBe("priced");
      expect(fig(r.values)).toEqual(fig(higher.values));
      expect(field(secBlock(attached(r.v)), "thickness_mm").note).toContain("states two values -- the higher, 19, is taken");
    }
  });
  it("NEGATIVE typed: the thickness box still takes ONE number (12d-6 U4) -- two values typed refuse with its message", () => {
    let st = panel(INS, R74, "SQM", D74).v.editState;
    for (const op of [{ op: "set_other", index: 0, id: "thickness_mm", on: true }, { op: "set_attr", index: 0, id: "thickness_mm", value: "6 or 9 mm" }] as ItemEditOp[]) st = applyItemEdit(st, op);
    const r = panel(INS, R74, "SQM", D74, [], st);
    expect(r.v.items[0].state).toBe("blank");
    expect(r.v.items[0].reason).toContain(TYPED_THICKNESS_MESSAGE);
  });
});

// =====================================================================================================
// AC5 -- a composed field shows the TOTAL; the chooser is unchanged (C-R1)
// =====================================================================================================
// BOQ-26-00231 / HVAC BOQ row 325, AS STORED: 25 mm acoustic nitrile per sq.m, composed above the stocked 19.
const R325: Answer[] = [{ item: "Acoustic Nitrile Insulation", cladding: "None", cladding_as_written: null, thickness_mm: "25 mm", pipe_size_mm: null, brand: null, material_as_written: "open cell nitrile rubber" }];

describe("AC5 composition: the field shows the total, the chooser stays C-R1", () => {
  it("00231 row 325: field 24 with the composition line; 9 + 15 at 2,330 / 308", () => {
    const r = panel(INS, R325, "Sq.m", "SITC of Acoustic lining ... 25 mm thick of open cell nitrile rubber", ["INSULATION"]);
    const f = field(r.v.items[0], "thickness_mm");
    expect(f.value).toBe("24");
    expect(f.note).toBe("BoQ says 25 mm -> priced as 9 + 15 mm (24 mm, -1) -- above the largest stocked size (19 mm)");
    expect(fig(r.values)).toEqual([2330, 308]);
  });
  it("C-R1 order, unchanged: of 9 + 15 (24), 13 + 13 (26) and 9 + 9 + 9 (27), fewest layers -> closest -> material cost picks 9 + 15", () => {
    const cost: Record<number, number> = { 9: 592, 13: 795, 15: 872, 19: 995 };
    const c = composeSize(25, [9, 13, 15, 19], { tolerance: 2, max_layers: 4, cost_key: "cost_insulation" }, (r) => cost[r] ?? null);
    expect(c).toEqual({ layers: [15, 9], delta: -1 });
    // closeness still beats cost: a cheaper 3-layer or a farther 2-layer never wins
    const far = composeSize(30, [13, 16, 19], { tolerance: 2, max_layers: 4 }, (r) => ({ 13: 1, 16: 100, 19: 1 } as Record<number, number>)[r]);
    expect(far).toEqual({ layers: [16, 13], delta: -1 });
  });
  it("00162 row 17 (a Piping section, 32 as 13 + 19): the section's thickness field shows 32", () => {
    const row: Answer[] = [
      { pipe_type: "MS", pipe_type_as_written: "MS", size_mm: "50mm. Dia", pipe_class: "Heavy class 'C'", insulated: "Yes" },
      { section: SEC, item: NITRILE, cladding: "24G Aluminium with Glass Cloth", thickness_mm: "32mm thick", pipe_size_mm: "50mm. Dia", brand: null, material_as_written: "nitrile rubber foam sheet" }];
    const r = panel(PIP, row, "Rmt.", "50mm. Dia", ["CHILLED WATER PIPING with INSULATION."]);
    const f = field(secBlock(attached(r.v)), "thickness_mm");
    expect(f.value).toBe("32");
    expect(fig(r.values)).toEqual([2109, 588]);
  });
  it("NEGATIVE a one-layer field keeps the layer it priced at, and no composition line", () => {
    const r = panel(INS, [{ ...R325[0], thickness_mm: "15 mm" }], "Sq.m");
    const f = field(r.v.items[0], "thickness_mm");
    expect(f.value).toBe("15");
    expect(f.note ?? "").not.toMatch(/priced as .* \+ /);
  });
});

// =====================================================================================================
// AC6 -- a single layer's cladding is measured on the pipe size as read
// =====================================================================================================
// BOQ-26-00137 / CHW pipes , Valves rows 39 and 42, AS STORED: nitrile 19 mm, 26G aluminium, on 50NB / 25NB.
const R137 = (pipe: string, cladding = "26G Aluminium"): Answer[] => [{ item: NITRILE, cladding, cladding_as_written: "26 G aluminium cladding", thickness_mm: "19mm thick - Single layer", pipe_size_mm: pipe, brand: null, material_as_written: "Class 1 Closed Cell Elastometric Nitrile rubber tubular insulation" }];
/** The girth the (only) priced item ran with, off the pure pricer's own pipeline results. */
function girthOf(answer: Answer[]): number | undefined {
  const r = priceItemList(INS_SPEC, ITEMS, "RMT", [{ attributes: stored(INS, answer[0]).attributes }] as never, "", "");
  return (r.items[0].pipelineResults ?? [])[0]?.steps.find((st) => st.produced?.key === "girth")?.produced?.value;
}

describe("AC6 a single layer's cladding: on the pipe size as read", () => {
  it("00137 row 39 (50NB priced at 53.98): girth 3.14 x (50 + 2 x 19) / 1000, the line names 50; 604 / 224", () => {
    expect(girthOf(R137("50NB"))).toBeCloseTo((3.14 * (50 + 2 * 19)) / 1000, 9);
    const r = panel(INS, R137("50NB"), "RMT", "50NB");
    expect(working(r.v.items[0])).toContain("cladding: measured on the pipe size as read 50 (not the 53.98 it was priced at) + 2 x 19 (the thickness) = 88 mm");
    expect(fig(r.values)).toEqual([604, 224]);
  });
  it("00137 row 42 (25NB priced at 28.58): 3.14 x (25 + 38) / 1000; 450 / 224", () => {
    expect(girthOf(R137("25NB"))).toBeCloseTo((3.14 * 63) / 1000, 9);
    expect(fig(panel(INS, R137("25NB"), "RMT", "25NB").values)).toEqual([450, 224]);
  });
  it("a Piping section (00341 VRV row 35, 31.8 priced at 34.93, Al. foil): the line names 31.8; 3,410 / 444", () => {
    const row: Answer[] = [
      { pipe_type: "Copper", pipe_type_as_written: "Refrigerant copper", size_mm: "31.8 mm dia", pipe_class: "hard drawn", insulated: "Yes" },
      { section: SEC, item: NITRILE, cladding: "Aluminium Foil", cladding_as_written: "Al. foil", thickness_mm: "19 mm", pipe_size_mm: "31.8 mm", brand: null, material_as_written: null }];
    const r = panel(PIP, row, "RMT", "31.8 mm dia (hard drawn)with 19 mm thick insulation", ["REFRIGERANT COPPER PIPING"]);
    expect(working(secBlock(attached(r.v)))).toContain("cladding: measured on the pipe size as read 31.8 (not the 34.93 it was priced at) + 2 x 19 (the thickness) = 69.8 mm");
    expect(fig(r.values)).toEqual([3410, 444]);
  });
  it("the calculator: a typed pipe size is the size as read", () => {
    const st = { items: [{ base: null, family: NITRILE, attrs: { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" } }] } as unknown as ItemListEditState;
    const r = calc(INS, st);
    expect(r.v.items.flatMap((b) => working(b))).toContain("cladding: measured on the pipe size as read 50 (not the 53.98 it was priced at) + 2 x 19 (the thickness) = 88 mm");
  });
  it("NEGATIVE an exact match (53.98) and a spelling-only match (12.7 for 1/2\") keep the config's own girth step and no line", () => {
    for (const pipe of ["53.98 mm", '1/2"']) {
      const r = panel(INS, R137(pipe), "RMT");
      expect(working(r.v.items[0]).some((w) => w.startsWith("cladding: measured"))).toBe(false);
    }
    const g = girthOf(R137("53.98 mm"));
    expect(g).toBeCloseTo((3.14 * (53.98 + 2 * 19)) / 1000, 9);
  });
  it("NEGATIVE no cladding ('No'): no line, the figure is the config's own", () => {
    const r = panel(INS, R137("50NB", "No"), "RMT");
    expect(working(r.v.items[0]).some((w) => w.startsWith("cladding: measured"))).toBe(false);
  });
  it("NEGATIVE a composition's outer layer keeps its own one-wrap line (12e-5b R7), unchanged", () => {
    const r = panel(INS, [{ ...R137("50NB")[0], thickness_mm: "32 mm" }], "RMT");
    const w = r.v.items.flatMap((b) => working(b));
    expect(w).toContain("cladding: ONE wrap over the outer surface -- pipe size as read 50 + 2 x 32 (the total thickness) = 114 mm");
    expect(w.some((x) => x.startsWith("cladding: measured"))).toBe(false);
  });
});
