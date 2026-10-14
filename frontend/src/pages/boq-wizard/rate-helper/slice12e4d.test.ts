/**
 * SLICE 12e-4d (owner rulings on the 12e-4c findings, 2026-10-14) -- FIVE SMALL FIXES. No model is asked here: a
 * model answer is a stored item written by hand, or one the 12e-4c run stored (BRSR-26-00393 .. 00396), copied
 * as stored. Every rule is tested from the PANEL'S ENTRY POINT (`makePricingSheetHelper(...).compute`) and every
 * figure is checked against the PURE pricer over the same inputs.
 *
 *   AC0  The stored rows the findings came from, on the panel: BOQ-26-00073 / HVAC row 60, BOQ-26-00186 /
 *        HVAC WORKS rows 106, 107 and 108.
 *   AC1  The model answered the pipe type itself AND copied a different word as written that reads as the SAME
 *        type (uPVC -> PVC): "BoQ says uPVC -> priced as PVC" shows. The CONFLICT case is pinned as it is.
 *   AC2  A pipe refused on its SIZE reading: its insulation section refuses with the pipe's sentence and shows no
 *        figure; a size typed in the section's own box still prices. A pipe refused for anything else: unchanged.
 *   AC3  The field's line and the working line name the same size step in the same words.
 *   AC5  A size typed in the calculator is quoted as typed: "You typed 3/4 -> 19.05 mm -> ...".
 *   (AC4 is the Python text check; its tests sit beside `extraction.py`.)
 *
 * What each block protects is said in its `describe`. Negative halves sit beside every positive.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, assembleItems, decodeItemEdits, hopLandedWords, makePricingSheetHelper, typedSizeEcho,
  type ItemBlockView, type ItemEdit, type ItemListEditState, type ItemListSuggestion, type ItemListView, type SectionBlockView,
} from "./pricingSheetHelper";
import { ONE_SIZE_MESSAGE, familyAttr, itemListPricingSpec, listSpecDefs, noUnitMessage, priceItemList, type LadderHop } from "./itemListPricing";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const V38 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v38.json`, import.meta.url));
const CFG: Record<string, RateCategoryConfig> = Object.fromEntries(V38.category_configs.map((c) => [c.category_id, c]));
const CONFIGS = new Map<string, RateCategoryConfig>(Object.entries(CFG));
const ITEMS: RateMasterItem[] = V38.items.map((it) => ({ ...it, discipline: V38.discipline } as RateMasterItem));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const KINDS = ["supply_rate", "install_rate", "combined_rate"] as const;
const NITRILE = "Nitrile Rubber Insulation";
const SEC = "insulation";
const INCH = '"';

type Answer = Record<string, string | null>;
/** A model answer AS THE RUN STORES IT: every definition of the item's own kind present (a value or null), and
 * the `section` marker on the ITEM for an item answered from a section's questions. */
function stored(category: string, a: Answer): { attributes: ExtractionRow["attributes"]; section?: string } {
  const { section, ...given } = a;
  const own = section ? listSpecDefs(CONFIGS.get((itemListPricingSpec(CONFIGS.get(category)!)!.sections ?? []).find((s) => s.id === section)?.category_id ?? "")!) : listSpecDefs(CONFIGS.get(category)!);
  const attributes: Record<string, { value: string | null; confidence: number }> = {};
  for (const d of own) attributes[d.id] = { value: null, confidence: 0 };
  for (const [k, v] of Object.entries(given)) attributes[k] = { value: v, confidence: 0.9 };
  return { attributes: attributes as ExtractionRow["attributes"], ...(section ? { section } : {}) };
}
/** The CALCULATOR path: an empty extraction map; the whole edit state is the override; the unit is a pick. */
function compute(category: string, state: ItemListEditState, unit = "mts") {
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
  const ctx: RateHelperRowContext = { excelRow: 1, description: "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS] };
  const r = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: unit });
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, values: s.values };
}
/** The BoQ-ROW (panel) path: the model's stored answer through `extractionByRow`, the row's own unit, text and
 * headings; `edits` is the pricer's session state on top, as the panel stores it. */
function panel(category: string, answer: Answer[], unit = "Rmt", desc = "", headings: string[] = [], edits?: ItemListEditState) {
  const row = { excelRow: 1, description: desc, attributes: {}, items: answer.map((a) => stored(category, a)) } as unknown as ExtractionRow;
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
  const ctx = { excelRow: 1, description: desc, nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS], unit, headings, ownNotes: [] } as RateHelperRowContext & { unit?: string };
  const r = h.compute(ctx, edits ? { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(edits) } : {});
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, values: s.values };
}
/** The PURE pricer over ONE hand-entered item of a category: what the figure must equal, whatever the screen. */
function pure(category: string, edit: ItemEdit, unit = "mts"): [number | undefined, number | undefined] {
  const spec = itemListPricingSpec(CFG[category])!;
  const assembled = assembleItems(decodeItemEdits(JSON.stringify({ items: [edit] }), 0), [], familyAttr(spec));
  const r = priceItemList(spec, ITEMS, unit, assembled, "", "");
  return [r.supply ?? undefined, r.install ?? undefined];
}
const field = (b: ItemBlockView, id: string) => b.fields.find((f) => f.id === id)!;
const fig = (values: Partial<Record<string, number>> | undefined): [number | undefined, number | undefined] => [values?.supply_rate, values?.install_rate];
const attached = (v: ItemListView, at = 0): SectionBlockView => v.items[at].sections![0];
const secBlock = (sv: SectionBlockView): ItemBlockView => sv.view.items[0];
const pipe = (family: string, size: string, more: Record<string, string> = {}, sections?: Record<string, ItemEdit>): ItemEdit =>
  ({ base: null, family, attrs: { size_mm: size, ...more }, other: ["size_mm"], ...(sections ? { sections } : {}) });
const ins = (attrs: Record<string, string>, other: string[] = [], family = NITRILE): ItemEdit => ({ base: null, family, attrs, ...(other.length ? { other } : {}) });
/** Every display string of a view, sections included. */
function shown(v: ItemListView): string[] {
  const out: string[] = [];
  if (v.reason) out.push(v.reason);
  const blockOf = (b: ItemBlockView) => {
    if (b.reason) out.push(b.reason);
    if (b.familyLine) out.push(b.familyLine);
    out.push(...b.working);
    for (const f of b.fields) { if (f.note) out.push(f.note); if (f.mirrorLine) out.push(f.mirrorLine); }
    for (const sv of b.sections ?? []) { if (sv.view.reason) out.push(sv.view.reason); sv.view.items.forEach(blockOf); }
  };
  v.items.forEach(blockOf);
  return out;
}

// The 12e-4c run's stored answers for the four rows the findings name -- copied AS STORED (calculatorPanelParity's
// 12e-4c fixture carries the same 29 rows; these are the run's own words, text, unit and headings).
const H2 = ["VRF SYSTEM", "Supply, installation, testing and commissioning Rigid heavy class (10KG) uPVC Condensate Drain piping of following sizes with minimum 6/9 mm nitrile rubber insulation over the pipes, complete with fittings, supports, U trap arrangement, clean plug and accessories for units as per specifications and technical specification."];
const H4 = ["LOW SIDE WORKS", "DRAIN PIPE: Supply & installation of CPVC drain pipe with 6mm nitrile rubber insulation for condensate drain."];
const REAL: Record<string, { unit: string; desc: string; h: string[]; items: Answer[] }> = {
  "00073/60": { unit: "Metre", desc: "25 mm dia", h: H2, items: [
    { pipe_type: "PVC", pipe_type_as_written: "uPVC", size_mm: "25 mm dia", pipe_class: "Rigid heavy class (10KG)", insulated: "Yes" },
    { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "6/9 mm", pipe_size_mm: "25 mm dia", brand: null, material_as_written: "nitrile rubber" }] },
  "00186/106": { unit: "RMT", desc: "3/4 PVC With 9 MM Insulation foam", h: H4, items: [
    { pipe_type: "PVC", pipe_type_as_written: "PVC", size_mm: "3/4", pipe_class: null, insulated: "Yes" },
    { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "9 MM", pipe_size_mm: null, brand: null, material_as_written: "foam" }] },
  "00186/107": { unit: "RMT", desc: "3/4 CPVC", h: H4, items: [
    { pipe_type: "CPVC", pipe_type_as_written: "CPVC", size_mm: "3/4", pipe_class: null, insulated: "Yes" },
    { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "6mm", pipe_size_mm: null, brand: null, material_as_written: "nitrile rubber" }] },
  "00186/108": { unit: "RMT", desc: "1 CPVC", h: H4, items: [
    { pipe_type: "CPVC", pipe_type_as_written: "CPVC", size_mm: "1", pipe_class: null, insulated: "Yes" },
    { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "6mm", pipe_size_mm: null, brand: null, material_as_written: "nitrile rubber" }] },
};
const real = (id: string) => { const r = REAL[id]; return panel(PIP, r.items, r.unit, r.desc, r.h); };
/** The bracket that closes a size-step line: "(the smallest size)", "(next size up)", "(the sheet's own ...)". */
const stepOf = (line: string | undefined): string | null => (line?.match(/\((the smallest size|next size up|the sheet's own spelling of this size)(?:, R6)?\)\s*$/)?.[1] ?? null);

// =====================================================================================================
// AC0 -- END-TO-END FIRST: the stored rows of 12e-4c, on the panel, with no model call
// =====================================================================================================
describe("12e-4d AC0 -- the 12e-4c stored rows the findings came from, on the panel", () => {
  it("BOQ-26-00073 / HVAC row 60: PVC with the amber 'BoQ says uPVC -> priced as PVC', 'Pipe type as written: uPVC' shown, still 358 / 42", () => {
    const { v, values } = real("00073/60");
    const p = v.items[0];
    expect({ family: p.family, line: p.familyLine, figures: fig(p.figures) }).toEqual({ family: "PVC", line: "BoQ says uPVC -> priced as PVC", figures: [120, 28] });
    expect(p.working[0]).toBe("BoQ says uPVC -> priced as PVC");
    expect(p.readOnly).toEqual([{ id: "pipe_type_as_written", label: "Pipe type as written", value: "uPVC" }]);
    expect(values).toEqual({ supply_rate: 358, install_rate: 42, combined_rate: 400 });
    expect(fig(p.figures)).toEqual(pure(PIP, pipe("PVC", "25")));
  });
  it("BOQ-26-00186 / HVAC WORKS row 108: the pipe refuses 'size 1 has no unit' AND its insulation section refuses with the same sentence -- no 191 / 14, no section figure", () => {
    const { v, values } = real("00186/108");
    const sentence = "size 1 has no unit - price this row by hand";
    expect(v.items[0].reason).toBe(sentence);
    const sv = attached(v), sb = secBlock(sv);
    expect({ priced: sv.view.rowPriced, reason: sv.view.reason, totals: sv.view.totals }).toEqual({ priced: false, reason: sentence, totals: undefined });
    expect({ state: sb.state, reason: sb.reason, figures: sb.figures, sku: sb.skuLine }).toEqual({ state: "blank", reason: sentence, figures: {}, sku: undefined });
    expect(field(sb, "pipe_size_mm")).toMatchObject({ value: "", typedValue: "", mirrorTag: "from pipe", note: `From pipe: ${sentence}`, userEdited: false });
    expect(v.rowPriced).toBe(false);
    expect(values).toEqual({});
    expect(JSON.stringify(sv)).not.toMatch(/\b191\b/);
  });
  it("rows 106 and 107: the field's line and the working say the SAME size step ('the smallest size'), 339 / 42 and 459 / 42 unchanged", () => {
    for (const [id, want] of [["00186/106", [339, 42]], ["00186/107", [459, 42]]] as const) {
      const { v, values } = real(id);
      const p = v.items[0];
      expect({ id, note: field(p, "size_mm").note }).toEqual({ id, note: "BoQ says 3/4 -> 19.05 mm -> priced as 25 mm (the smallest size)" });
      expect({ id, working: p.working[0] }).toEqual({ id, working: "pipe size 19.05 is not on the sheet -> 25 (the smallest size)" });
      // and the section's thickness: both its lines name the same step too
      const sb = secBlock(attached(v));
      expect({ id, field: stepOf(field(sb, "thickness_mm").note), working: stepOf(sb.working.find((w) => w.startsWith("thickness "))) }).toEqual({ id, field: "the smallest size", working: "the smallest size" });
      expect(fig(values)).toEqual(want);
    }
  });
});

// =====================================================================================================
// AC1 -- the model answered the type; a different word as written that reads as the SAME type gets its line
// =====================================================================================================
describe("12e-4d AC1 -- 'BoQ says <as written> -> priced as <type>' where the model answered the type and the word maps to it", () => {
  const row = (type: string | null, written: string | null, size = "25 mm") => panel(PIP, [{ pipe_type: type, pipe_type_as_written: written, size_mm: size }]);

  it("the maps the config declares, each with the line the as-written word gets when it decides (named: uPVC, GI, HDPE, 'MS / GI')", () => {
    const CASES: Array<[string, string, string]> = [["PVC", "uPVC", "BoQ says uPVC -> priced as PVC"], ["MS", "GI", "BoQ says GI -> priced as MS"], ["PVC", "HDPE", "BoQ says HDPE -> priced as PVC"], ["MS", "MS / GI", "BoQ names MS / GI -> priced as MS"]];
    for (const [type, written, line] of CASES) {
      const answered = row(type, written), decided = row(null, written);
      expect({ written, line: answered.v.items[0].familyLine }).toEqual({ written, line });
      expect({ written, same: answered.v.items[0].familyLine }).toEqual({ written, same: decided.v.items[0].familyLine });
      expect(answered.v.items[0].working).toContain(line);
      // figures unchanged: the same as the type answered with no word beside it, and the pure pricer's
      expect({ written, fig: fig(answered.values) }).toEqual({ written, fig: fig(row(type, null).values) });
      expect({ written, fig: fig(answered.values) }).toEqual({ written, fig: pure(PIP, pipe(type, "25")) });
    }
  });
  it("NEGATIVE: a word that IS the answered type (any case) adds no line -- 'copper' beside Copper (rows 53-58), 'PVC' beside PVC (row 106)", () => {
    expect(row("Copper", "copper", "22.3 mm").v.items[0].familyLine).toBeUndefined();
    expect(row("PVC", "PVC").v.items[0].familyLine).toBeUndefined();
    expect(row("CPVC", " cpvc ").v.items[0].familyLine).toBeUndefined();
    expect(row("PVC", null).v.items[0].familyLine).toBeUndefined();
  });
  it("CONFLICT (pinned as it is; for the owner): a word that reads as ANOTHER type, refuses, or reads as nothing adds no line and changes no figure -- the answered type prices", () => {
    const CONFLICTS: Array<[string, string]> = [["MS", "SS"], ["MS", "Stainless steel"], ["PVC", "Copper"], ["MS", "uPVC"], ["CPVC", "uPVC/ CPVC"], ["MS", "Hume pipe"]];
    for (const [type, written] of CONFLICTS) {
      const x = row(type, written);
      expect({ written, family: x.v.items[0].family, line: x.v.items[0].familyLine, priced: x.v.rowPriced }).toEqual({ written, family: type, line: undefined, priced: true });
      expect({ written, fig: fig(x.values) }).toEqual({ written, fig: fig(row(type, null).values) });
    }
  });
  it("NEGATIVE: a type PICKED in the dropdown keeps today's lines -- the block starts from the pick alone, so no word as written is read", () => {
    const picked = panel(PIP, [{ pipe_type: "MS", pipe_type_as_written: "GI", size_mm: "25 mm" }], "Rmt", "", [], { items: [{ base: null, family: "PVC", attrs: { size_mm: "25" }, other: ["size_mm"] }] });
    expect(picked.v.items[0].family).toBe("PVC");
    expect(picked.v.items[0].familyLine).toBeUndefined();
    // and a type the pricer TYPED keeps "You typed" (12e-4c)
    const typed = panel(PIP, [{ pipe_type: "PVC", pipe_type_as_written: "uPVC", size_mm: "25 mm" }], "Rmt", "", [], { items: [{ base: null, family: "uPVC", attrs: { size_mm: "25" }, other: ["pipe_type", "size_mm"] }] });
    expect(typed.v.items[0].familyLine).toBe("You typed uPVC -> priced as PVC");
  });
  it("NEGATIVE: a category without `family_text` is untouched -- an Insulation material and an ADP kind carry no family line", () => {
    expect(panel(INS, [{ item: NITRILE, cladding: "None", thickness_mm: "19", pipe_size_mm: "25", material_as_written: "elastomeric foam" }]).v.items[0].familyLine).toBeUndefined();
    expect(panel(ADP, [{ family: "fire damper", ul: "yes", size_mm: "600 x 600" }], "Nos").v.items[0].familyLine).toBeUndefined();
  });
});

// =====================================================================================================
// AC2 -- a pipe refused on its SIZE: the section linked to it refuses with the pipe's sentence
// =====================================================================================================
describe("12e-4d AC2 -- an insulation section never prices a size its pipe refused to read; a size typed in its own box still prices", () => {
  const SECTION: Answer = { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "13 mm", pipe_size_mm: "22.3 mm" };
  const model = (type: string | null, size: string | null, written: string | null = null) =>
    panel(PIP, [{ pipe_type: type, pipe_type_as_written: written, size_mm: size, insulated: "Yes" }, SECTION]);
  const calc = (type: string, size: string, section: ItemEdit = ins({ cladding: "No", thickness_mm: "13" })) =>
    compute(PIP, { items: [pipe(type, size, { insulated: "Yes" }, { [SEC]: section })] });
  const refusedLikeThePipe = (x: ReturnType<typeof compute>, sentence: string) => {
    expect(x.v.items[0].reason).toBe(sentence);
    const sv = attached(x.v), sb = secBlock(sv);
    expect({ priced: sv.view.rowPriced, reason: sv.view.reason, totals: sv.view.totals, state: sb.state, blockReason: sb.reason, figures: sb.figures })
      .toEqual({ priced: false, reason: sentence, totals: undefined, state: "blank", blockReason: sentence, figures: {} });
    expect(field(sb, "pipe_size_mm")).toMatchObject({ value: "", mirrorTag: "from pipe", note: `From pipe: ${sentence}` });
  };

  it("every size-reading refusal, named, on the model path and the calculator: no unit, several sizes, no number, not one size", () => {
    const CASES: Array<[string, () => ReturnType<typeof compute>, string]> = [
      ["no unit (model, CPVC '1')", () => model("CPVC", "1"), noUnitMessage("1")],
      ["no unit (model, MS '2')", () => model("MS", "2"), noUnitMessage("2")],
      ["no unit (calculator, MS '1')", () => calc("MS", "1"), noUnitMessage("1")],
      ["several sizes (model)", () => model("MS", "25 x 3 / 32 x 3"), "pipe size states several sizes (25 / 3 / 32 / 3) - pick one"],
      ["several sizes (calculator)", () => calc("MS", "25 x 3 / 32 x 3"), "pipe size states several sizes (25 / 3 / 32 / 3) - pick one"],
      ["no number (model)", () => model("MS", "two inch"), "no number in 'two inch' for pipe size"],
      ["not one size (calculator)", () => calc("MS", "two inch"), ONE_SIZE_MESSAGE],
    ];
    for (const [label, run, sentence] of CASES) {
      const x = run();
      expect({ label, row: x.v.rowPriced, values: x.values }).toEqual({ label, row: false, values: {} });
      refusedLikeThePipe(x, sentence);
    }
    expect(CASES).toHaveLength(7);
  });
  it("BEFORE, measured: on 'size 1 has no unit' the section priced 191 / 14 from the bare 1 read as millimetres -- that figure is what is gone", () => {
    expect(pure(INS, ins({ cladding: "No", thickness_mm: "6", pipe_size_mm: "1" }, ["pipe_size_mm"]))).toEqual([191, 14]);
    expect(JSON.stringify(attached(model("CPVC", "1").v))).not.toMatch(/"supply_rate":191/);
  });
  it("a size the pricer TYPES in the section's own box prices the section exactly as Calculator -> Insulation does (owner: 'the user can change it')", () => {
    for (const size of ["25", "22.3", `3/4${INCH}`]) {
      const x = calc("CPVC", "1", ins({ cladding: "No", thickness_mm: "13", pipe_size_mm: size }, ["pipe_size_mm"]));
      const sv = attached(x.v);
      expect({ size, priced: sv.view.rowPriced, fig: fig(sv.view.totals) }).toEqual({ size, priced: true, fig: pure(INS, ins({ cladding: "No", thickness_mm: "13", pipe_size_mm: size }, ["pipe_size_mm"])) });
      expect(field(secBlock(sv), "pipe_size_mm").mirrorTag).toBeUndefined();
      // the pipe still refuses, so the row does too -- nothing is priced on the pipe's behalf
      expect(x.v.rowPriced).toBe(false);
    }
    // on the panel too: the pricer's edit to the model row's section box
    const edited = panel(PIP, REAL["00186/108"].items, "RMT", "1 CPVC", H4,
      { items: [{ base: 0, family: null, attrs: {}, sections: { [SEC]: { base: 0, family: null, attrs: { pipe_size_mm: "25" }, other: ["pipe_size_mm"] } } }] });
    expect(attached(edited.v).view.rowPriced).toBe(true);
  });
  it("NEGATIVE (pinned as it is): a pipe refused for anything but its size -- SS, an unknown type, a size above the largest -- does not change the section", () => {
    // SS / an unknown type refuse before any size is read: nothing is mirrored and the section reads its own cell, as before
    for (const [label, x] of [["SS as written", model(null, "50 mm", "SS")], ["unknown type", model("Hume", "50 mm")]] as const) {
      const sv = attached(x.v);
      expect({ label, pipe: x.v.items[0].state, sec: sv.view.rowPriced, fig: fig(sv.view.totals), mirrored: field(secBlock(sv), "pipe_size_mm").mirrorTag ?? null })
        .toEqual({ label, pipe: "blank", sec: true, fig: [226, 14], mirrored: null });
    }
    // above the largest MS size: the size WAS read, so it is mirrored and the section refuses with ITS OWN sentence, as before
    const big = model("MS", "400");
    expect(big.v.items[0].reason).toBe("pipe size 400 is above the largest size on the sheet (300)");
    expect(attached(big.v).view.reason).toBe("pipe size 400 is above the largest size on the sheet (53.98)");
    // a pipe that prices keeps mirroring its read size, as before
    const ok = model("Copper", `5/8${INCH}`);
    expect(field(secBlock(attached(ok.v)), "pipe_size_mm").note).toBe("From pipe: 15.875 mm -> priced as 15.88 mm (the sheet's own spelling of this size)");
    expect(fig(attached(ok.v).view.totals)).toEqual([216, 14]);
  });
  it("NEGATIVE: an item with no section and an Insulation row of its own are untouched by the rule", () => {
    const alone = panel(PIP, [{ pipe_type: "CPVC", size_mm: "1", insulated: null }]);
    expect(alone.v.items[0].sections).toBeUndefined();
    expect(alone.v.items[0].reason).toBe(noUnitMessage("1"));
    const own = panel(INS, [{ item: NITRILE, cladding: "None", thickness_mm: "13", pipe_size_mm: "1" }]);
    expect(fig(own.values)).toEqual(pure(INS, ins({ cladding: "No", thickness_mm: "13", pipe_size_mm: "1" }, ["pipe_size_mm"])));
  });
});

// =====================================================================================================
// AC3 -- one wording for the size step, on the field's line and the working line
// =====================================================================================================
describe("12e-4d AC3 -- below the smallest stocked size both lines say '(the smallest size)'; between two both say '(next size up)'", () => {
  type Case = { label: string; run: () => ReturnType<typeof compute>; block: (v: ItemListView) => ItemBlockView; field: string; working: string; step: string };
  const pipeB = (v: ItemListView) => v.items[0];
  const secB = (v: ItemListView) => secBlock(attached(v));
  const CASES: Case[] = [
    { label: "Piping pipe size, below (CPVC 3/4 -> 25)", run: () => compute(PIP, { items: [pipe("CPVC", "3/4")] }), block: pipeB, field: "size_mm", working: "pipe size ", step: "the smallest size" },
    { label: "Piping pipe size, between (Copper 25 -> 25.4)", run: () => compute(PIP, { items: [pipe("Copper", "25")] }), block: pipeB, field: "size_mm", working: "pipe size ", step: "next size up" },
    { label: "Insulation thickness, below (9 -> 13)", run: () => compute(INS, { items: [ins({ cladding: "No", thickness_mm: "9", pipe_size_mm: "25" }, ["thickness_mm", "pipe_size_mm"])] }), block: pipeB, field: "thickness_mm", working: "thickness ", step: "the smallest size" },
    { label: "Insulation thickness, between (16 -> 19)", run: () => compute(INS, { items: [ins({ cladding: "No", thickness_mm: "16", pipe_size_mm: "25" }, ["thickness_mm", "pipe_size_mm"])] }), block: pipeB, field: "thickness_mm", working: "thickness ", step: "next size up" },
    { label: "Insulation pipe size, below (5 -> 6.35)", run: () => compute(INS, { items: [ins({ cladding: "No", thickness_mm: "13", pipe_size_mm: "5" }, ["pipe_size_mm"])] }), block: pipeB, field: "pipe_size_mm", working: "pipe size ", step: "the smallest size" },
    { label: "Insulation pipe size, between (25 -> 28.58)", run: () => compute(INS, { items: [ins({ cladding: "No", thickness_mm: "13", pipe_size_mm: "25" }, ["pipe_size_mm"])] }), block: pipeB, field: "pipe_size_mm", working: "pipe size ", step: "next size up" },
    { label: "Piping section thickness, below (model 9 mm -> 13)", run: () => panel(PIP, [{ pipe_type: "CPVC", size_mm: "50 mm", insulated: "Yes" }, { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "9 mm" }]), block: secB, field: "thickness_mm", working: "thickness ", step: "the smallest size" },
    { label: "Piping section pipe size, between (from pipe 25 -> 28.58)", run: () => panel(PIP, [{ pipe_type: "PVC", size_mm: "25 mm", insulated: "Yes" }, { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "13 mm" }]), block: secB, field: "pipe_size_mm", working: "pipe size ", step: "next size up" },
    { label: "ADP diameter, below (model 150 -> 200)", run: () => panel(ADP, [{ family: "round diffuser", dia_mm: "150 mm" }], "Nos"), block: pipeB, field: "dia_mm", working: "diameter ", step: "the smallest size" },
    { label: "ADP diameter, between (model 315 -> 400)", run: () => panel(ADP, [{ family: "round diffuser", dia_mm: "315 mm" }], "Nos"), block: pipeB, field: "dia_mm", working: "diameter ", step: "next size up" },
  ];
  it.each(CASES.map((c) => [c.label, c] as const))("%s", (_, c) => {
    const x = c.run();
    const b = c.block(x.v);
    const w = b.working.find((l) => l.startsWith(c.working) && l.includes("is not on the sheet"));
    expect({ field: stepOf(field(b, c.field).note), working: stepOf(w) }).toEqual({ field: c.step, working: c.step });
  });
  it("the sweep names what it covers: Piping (pipe size, its section's thickness and pipe size), Insulation (thickness, pipe size), ADP (diameter) -- each below and between", () => {
    expect(CASES.map((c) => c.label)).toHaveLength(10);
    expect(CASES.filter((c) => c.step === "the smallest size")).toHaveLength(5);
  });
  it("NEGATIVE: wording only -- a below-the-smallest step prices the same rung as before (the pure pricer)", () => {
    expect(fig(compute(PIP, { items: [pipe("CPVC", "3/4")] }).values)).toEqual(pure(PIP, pipe("CPVC", "25")));
    expect(fig(compute(INS, { items: [ins({ cladding: "No", thickness_mm: "9", pipe_size_mm: "25" }, ["thickness_mm", "pipe_size_mm"])] }).values))
      .toEqual(pure(INS, ins({ cladding: "No", thickness_mm: "13", pipe_size_mm: "25" }, ["pipe_size_mm"])));
  });
  it("`hopLandedWords`: the sheet's spelling, the smallest size, the next size up -- and nothing else", () => {
    const hop = (h: Partial<LadderHop>): LadderHop => ({ attr: "a", name: "a", requested: 1, fitted: 2, exact: false, ...h });
    expect(hopLandedWords(hop({ exact: true }))).toBe("(the sheet's own spelling of this size)");
    expect(hopLandedWords(hop({ belowSmallest: true }))).toBe("(the smallest size)");
    expect(hopLandedWords(hop({}))).toBe("(next size up)");
  });
});

// =====================================================================================================
// AC5 -- a size typed in the calculator is quoted as typed
// =====================================================================================================
describe("12e-4d AC5 -- 'You typed 3/4 -> 19.05 mm -> priced as ...', never 'You typed 19.05 mm'", () => {
  const FORMS = ["3/4", `3/4${INCH}`, `1 1/8${INCH}`, "25", "25 mm", "19/25"];
  type Box = { label: string; cat: string; attr: string; edit: (form: string) => ItemEdit; unit: string };
  const BOXES: Box[] = [
    { label: "Piping pipe size", cat: PIP, attr: "size_mm", edit: (f) => pipe("CPVC", f), unit: "mts" },
    { label: "Insulation pipe size", cat: INS, attr: "pipe_size_mm", edit: (f) => ins({ cladding: "No", thickness_mm: "13", pipe_size_mm: f }, ["pipe_size_mm"]), unit: "mts" },
    { label: "Insulation thickness", cat: INS, attr: "thickness_mm", edit: (f) => ins({ cladding: "No", thickness_mm: f, pipe_size_mm: "19.05" }, ["thickness_mm"]), unit: "mts" },
    { label: "ADP neck", cat: ADP, attr: "neck_mm", edit: (f) => ({ base: null, family: "square diffuser", attrs: { neck_mm: f }, other: ["neck_mm"] }), unit: "nos" },
    { label: "ADP diameter", cat: ADP, attr: "dia_mm", edit: (f) => ({ base: null, family: "round diffuser", attrs: { dia_mm: f }, other: ["dia_mm"] }), unit: "nos" },
    { label: "ADP torque", cat: ADP, attr: "torque", edit: (f) => ({ base: null, family: "actuator", attrs: { torque: f }, other: ["torque"] }), unit: "nos" },
  ];
  // The lines, as typed, AFTER (12e-4d); a form the box refuses or that lands exactly says nothing new and is left out
  const WANT: Record<string, string> = {
    "Insulation pipe size | 3/4": "You typed 3/4 -> 19.05 mm -> priced as 19.05 mm (the sheet's own spelling of this size)",
    [`Insulation pipe size | 3/4${INCH}`]: `You typed 3/4${INCH} -> 19.05 mm -> priced as 19.05 mm (the sheet's own spelling of this size)`,
    [`Insulation pipe size | 1 1/8${INCH}`]: `You typed 1 1/8${INCH} -> 28.575 mm -> priced as 28.58 mm (the sheet's own spelling of this size)`,
    "Insulation pipe size | 25": "You typed 25 mm -> priced as 28.58 mm (next size up)",
    "Insulation pipe size | 25 mm": "You typed 25 mm -> priced as 28.58 mm (next size up)",
    "Insulation pipe size | 19/25": "You typed 19/25: states two sizes (19 / 25) - the higher, 25, is taken -> priced as 28.58 mm (next size up)",
    "ADP neck | 3/4": "You typed 3/4 -> 4 mm -> priced as 300 mm (the smallest size)",
    "ADP neck | 19/25": "You typed 19/25 -> 25 mm -> priced as 300 mm (the smallest size)",
    "ADP neck | 25": "You typed 25 mm -> priced as 300 mm (the smallest size)",
    "ADP diameter | 3/4": "You typed 3/4 -> 4 mm -> priced as 200 mm (the smallest size)",
    "ADP diameter | 19/25": "You typed 19/25 -> 25 mm -> priced as 200 mm (the smallest size)",
    "ADP torque | 3/4": "You typed 3/4 -> 4 Nm -> priced as 6 Nm (the smallest size)",
    "Piping pipe size | 3/4": "You typed 3/4 -> 19.05 mm -> priced as 25 mm (the smallest size)",
    [`Piping pipe size | 1 1/8${INCH}`]: `You typed 1 1/8${INCH} -> 28.575 mm -> priced as 32 mm (next size up)`,
  };
  it("SWEEP (named): every typed size / thickness box of the Piping, Insulation and ADP calculators x six forms -- a 'You typed' line always opens with the text as typed", () => {
    let lines = 0;
    const seen: string[] = [];
    for (const box of BOXES) for (const form of FORMS) {
      const x = compute(box.cat, { items: [box.edit(form)] }, box.unit);
      const note = field(x.v.items[0], box.attr)?.note;
      const key = `${box.label} | ${form}`;
      if (WANT[key] !== undefined) { expect({ key, note }).toEqual({ key, note: WANT[key] }); seen.push(key); }
      if (note?.startsWith("You typed ")) {
        lines++;
        expect({ key, opensAsTyped: note.startsWith(`You typed ${form}`) || (/^\d+$/.test(form) && note.startsWith(`You typed ${form} mm`)) || (/^\d+$/.test(form) && note.startsWith(`You typed ${form} Nm`)) })
          .toEqual({ key, opensAsTyped: true });
      }
    }
    expect(seen.sort()).toEqual(Object.keys(WANT).sort());
    expect(BOXES.length * FORMS.length).toBe(36);
    expect(lines).toBeGreaterThanOrEqual(Object.keys(WANT).length);
  });
  it("C5's case: Calculator -> Insulation, pipe size '3/4' -> 'You typed 3/4 -> 19.05 mm -> ...'; '19/25' still 286 / 14 at thickness 19", () => {
    const a = compute(INS, { items: [ins({ cladding: "No", thickness_mm: "19", pipe_size_mm: "3/4" }, ["pipe_size_mm"])] });
    expect(field(a.v.items[0], "pipe_size_mm").note).toMatch(/^You typed 3\/4 -> 19\.05 mm -> priced as /);
    expect(field(a.v.items[0], "pipe_size_mm").note).not.toMatch(/You typed 19\.05/);
    const b = compute(INS, { items: [ins({ cladding: "No", thickness_mm: "19", pipe_size_mm: "19/25" }, ["pipe_size_mm"])] });
    expect(fig(b.values)).toEqual([286, 14]);
  });
  it("NEGATIVE: the figures are the pure pricer's for every form (wording only), and a value the BoQ stated keeps its line as before", () => {
    for (const box of BOXES) for (const form of FORMS) {
      const x = compute(box.cat, { items: [box.edit(form)] }, box.unit);
      if (x.v.rowPriced) expect({ box: box.label, form, fig: fig(x.values) }).toEqual({ box: box.label, form, fig: pure(box.cat, box.edit(form), box.unit) });
    }
    // the BoQ's own words are untouched: an ADP neck the model read as "150 mm" keeps "BoQ says 150 mm -> ..."
    expect(field(panel(ADP, [{ family: "square diffuser", neck_mm: "250 mm" }], "Nos").v.items[0], "neck_mm").note).toBe("BoQ says 250 mm -> priced as 300 mm (the smallest size)");
    // a size mirrored from a pipe is quoted as before ("From pipe: 22.3 mm -> ...")
    expect(field(secBlock(attached(panel(PIP, [{ pipe_type: "Copper", size_mm: "22.3 mm", insulated: "Yes" }, { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "19 mm" }]).v)), "pipe_size_mm").note)
      .toBe("From pipe: 22.3 mm -> priced as 22.23 mm (the sheet's own spelling of this size)");
  });
  it("`typedSizeEcho`: the text as typed and the number read, unless they are the same thing written alike", () => {
    expect(typedSizeEcho("3/4", 19.05, " mm")).toBe("3/4 -> 19.05 mm");
    expect(typedSizeEcho(`1-1/4${INCH}`, 31.75, " mm")).toBe(`1-1/4${INCH} -> 31.75 mm`);
    expect(typedSizeEcho("19/25", 25, " mm")).toBe("19/25 -> 25 mm");
    expect(typedSizeEcho("25", 25, " mm")).toBe("25 mm");
    expect(typedSizeEcho("25 mm", 25, " mm")).toBe("25 mm");
    expect(typedSizeEcho("25  MM", 25, " mm")).toBe("25 mm");
    expect(typedSizeEcho("22.3", 22.3, " mm")).toBe("22.3 mm");
  });
});
