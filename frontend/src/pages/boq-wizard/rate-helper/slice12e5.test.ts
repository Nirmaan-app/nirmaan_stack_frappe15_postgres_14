/**
 * SLICE 12e-5 Part 1 (owner, 2026-10-14, on the 12e-4d review: "ok. but does it capture the insulation related
 * fields if the model passes it. the attribute values should be captured else the user will have to enter
 * everything from scratch") -- THE ROW-108 CARRY-OVER CHECK AND ITS SMALL FIX. No model is asked here: every model
 * answer is one the 12e-4c run stored (BRSR-26-00393 .. 00396), copied as stored. Every rule is tested from the
 * PANEL'S ENTRY POINT (`makePricingSheetHelper(...).compute`) and every figure is checked against the PURE pricer
 * and Calculator -> Insulation over the same inputs.
 *
 *   AC0  BOQ-26-00186 / HVAC WORKS row 108 with ONLY a pipe size entered (the pipe's box, or the section's own):
 *        the insulation section fills itself from what the AI read and the defaults, and PRICES.
 *   AC1  A section refusing over its pipe's size (the pipe refused it, or stated none) keeps what the AI read:
 *        cladding "None" shows as "No" with its amber default line, as Insulation shows it on a priced row; a
 *        value with no dropdown word ("6mm") shows as before; no figure, no "priced as" line.
 *
 * What each block protects is said in its `describe`. Negative halves sit beside every positive.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, assembleItems, decodeItemEdits, makePricingSheetHelper,
  type ItemBlockView, type ItemEdit, type ItemEditOp, type ItemListEditState, type ItemListSuggestion, type ItemListView, type SectionBlockView,
} from "./pricingSheetHelper";
import { familyAttr, itemListPricingSpec, listSpecDefs, noUnitMessage, priceItemList } from "./itemListPricing";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const V38 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v38.json`, import.meta.url));
const CFG: Record<string, RateCategoryConfig> = Object.fromEntries(V38.category_configs.map((c) => [c.category_id, c]));
const CONFIGS = new Map<string, RateCategoryConfig>(Object.entries(CFG));
const ITEMS: RateMasterItem[] = V38.items.map((it) => ({ ...it, discipline: V38.discipline } as RateMasterItem));
const INS = "hvac_insulation", PIP = "hvac_piping";
const KINDS = ["supply_rate", "install_rate", "combined_rate"] as const;
const NITRILE = "Nitrile Rubber Insulation";
const SEC = "insulation";
/** Insulation's own ruled default for a cladding nobody mentioned, as the panel words it on a priced row. */
const CLADDING_RULE = "cladding not mentioned -> without cladding";

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
type Shown = { s: ItemListSuggestion; v: ItemListView; values: ItemListSuggestion["values"] };
/** The CALCULATOR path: an empty extraction map; the whole edit state is the override; the unit is a pick. */
function compute(category: string, state: ItemListEditState, unit = "mts"): Shown {
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
  const ctx: RateHelperRowContext = { excelRow: 1, description: "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS] };
  const r = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: unit });
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, values: s.values };
}
/** The BoQ-ROW (panel) path: the model's stored answer through `extractionByRow`, the row's own unit, text and
 * headings; `edits` is the pricer's session state on top, as the panel stores it. */
function panel(category: string, answer: Answer[], unit = "Rmt", desc = "", headings: string[] = [], edits?: ItemListEditState): Shown {
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
const ins = (attrs: Record<string, string>, other: string[] = [], family = NITRILE): ItemEdit => ({ base: null, family, attrs, ...(other.length ? { other } : {}) });
/** Every display string of a section: its reason, and each block's reason, SKU line, working and field notes. */
const sectionLines = (sv: SectionBlockView): string[] => [
  sv.view.reason ?? "", ...sv.view.items.flatMap((b) => [b.reason ?? "", b.skuLine ?? "", ...b.working, ...b.fields.map((f) => f.note ?? "")]),
].filter(Boolean);

// The 12e-4c run's stored answers for the rows this slice names -- copied AS STORED (calculatorPanelParity's 12e-4c
// fixture carries the same rows: the run's own words, text, unit and headings).
const H3 = ["LOW SIDE WORKS", "COPPER REFRIGERANT PIPING: Supply and Laying of copper refrigerant pipe with specified thickness of 13mm thick nitrile rubber insulation tubes and joints sealed with black cotton tape."];
const H4 = ["LOW SIDE WORKS", "DRAIN PIPE: Supply & installation of CPVC drain pipe with 6mm nitrile rubber insulation for condensate drain."];
const COPPER_NO_SIZE: Answer[] = [
  { pipe_type: "Copper", pipe_type_as_written: "copper", size_mm: null, pipe_class: null, insulated: "Yes" },
  { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "13mm", pipe_size_mm: null, brand: null, material_as_written: "nitrile rubber" }];
const REAL: Record<string, { unit: string; desc: string; h: string[]; items: Answer[] }> = {
  "00186/100": { unit: "RMT", desc: "Copper Refrigerant pipe for 10 TR DX UNITS", h: H3, items: COPPER_NO_SIZE },
  "00186/101": { unit: "RMT", desc: "Copper Refrigerant pipe for VRF UNITS", h: H3, items: COPPER_NO_SIZE },
  "00186/102": { unit: "RMT", desc: "Copper Refrigerant pipe for Server Room Split AC", h: H3, items: COPPER_NO_SIZE },
  "00186/107": { unit: "RMT", desc: "3/4 CPVC", h: H4, items: [
    { pipe_type: "CPVC", pipe_type_as_written: "CPVC", size_mm: "3/4", pipe_class: null, insulated: "Yes" },
    { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "6mm", pipe_size_mm: null, brand: null, material_as_written: "nitrile rubber" }] },
  "00186/108": { unit: "RMT", desc: "1 CPVC", h: H4, items: [
    { pipe_type: "CPVC", pipe_type_as_written: "CPVC", size_mm: "1", pipe_class: null, insulated: "Yes" },
    { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "6mm", pipe_size_mm: null, brand: null, material_as_written: "nitrile rubber" }] },
};
const real = (id: string, edits?: ItemListEditState) => { const r = REAL[id]; return panel(PIP, r.items, r.unit, r.desc, r.h, edits); };
/** The pricer's own operations on row 108 as the panel applies them: open a box's "Other...", type into it. */
function typed108(where: "pipe" | "section", size: string): Shown {
  const ops: ItemEditOp[] = where === "pipe"
    ? [{ op: "set_other", index: 0, id: "size_mm", on: true }, { op: "set_attr", index: 0, id: "size_mm", value: size }]
    : [{ op: "section", section: SEC, pipe: 0, index: 0, inner: { op: "set_other", index: 0, id: "pipe_size_mm", on: true } },
       { op: "section", section: SEC, pipe: 0, index: 0, inner: { op: "set_attr", index: 0, id: "pipe_size_mm", value: size } }];
  let st = real("00186/108").v.editState;
  for (const op of ops) st = applyItemEdit(st, op);
  return real("00186/108", st);
}

// =====================================================================================================
// AC0 -- END-TO-END FIRST: row 108 with only a pipe size entered
// =====================================================================================================
/**
 * THE FIGURE, FROM THE INPUTS (block 37). Nitrile, cladding No, thickness 6 mm -> 13 mm (the smallest stocked
 * thickness), pipe size 1 inch = 25.4 mm -> 28.58 mm (the next stocked size up) = SKU rmi-560e452197aa (Mts):
 * supply = ROUNDUP((material 131 + adhesive 30) x 1.05 wastage = 169.05 -> 170) x 1.4 markup = 238;
 * install = 10 x 1.4 = 14. In the pipe's box CPVC reads "1 inch" at 25 mm to the inch (25 mm, stocked), and the
 * section takes 25 -> 28.58 mm, the same rung: the same 238 / 14.
 */
describe("12e-5 AC0 -- row 108: a pipe size entered, and the insulation section fills itself and prices", () => {
  const CALC_INS = (size: string) => compute(INS, { items: [ins({ cladding: "No", thickness_mm: "6", pipe_size_mm: size }, ["pipe_size_mm", "thickness_mm"])] });

  it("the PIPE's box '1 inch': the pipe prices 240 / 28 at 25 mm, and the section fills -- Nitrile, cladding 'No' (amber, its rule), thickness from '6mm' with its line -- and prices 238 / 14", () => {
    const { v, values } = typed108("pipe", "1 inch");
    const p = v.items[0];
    expect({ state: p.state, figures: fig(p.figures), note: field(p, "size_mm").note })
      .toEqual({ state: "priced", figures: [240, 28], note: "You typed 1 inch -> 25.4 mm / 25 mm -> priced as 25 mm" });
    const sv = attached(v), sb = secBlock(sv);
    expect({ family: sb.family, priced: sv.view.rowPriced, totals: fig(sv.view.totals) }).toEqual({ family: NITRILE, priced: true, totals: [238, 14] });
    expect(field(sb, "cladding")).toMatchObject({ value: "No", defaulted: true, rule: CLADDING_RULE });
    expect(field(sb, "thickness_mm")).toMatchObject({ value: "13", typedValue: "6mm", otherMode: true, note: "BoQ says 6 mm -> priced as 13 mm (the smallest size)" });
    expect(field(sb, "pipe_size_mm")).toMatchObject({ value: "28.58", mirrorTag: "from pipe", note: "From pipe: 25 mm -> priced as 28.58 mm (next size up)" });
    expect(fig(values)).toEqual([478, 42]);
  });
  it("the SECTION's own box '1 inch' (and '25.4'): the section prices 238 / 14 while the pipe still refuses 'size 1 has no unit'", () => {
    for (const size of ["1 inch", "25.4"]) {
      const { v } = typed108("section", size);
      expect({ size, pipe: v.items[0].reason, row: v.rowPriced }).toEqual({ size, pipe: noUnitMessage("1"), row: false });
      const sv = attached(v), sb = secBlock(sv);
      expect({ size, priced: sv.view.rowPriced, totals: fig(sv.view.totals), cladding: field(sb, "cladding").value, thickness: field(sb, "thickness_mm").value, pipe: field(sb, "pipe_size_mm").value })
        .toEqual({ size, priced: true, totals: [238, 14], cladding: "No", thickness: "13", pipe: "28.58" });
    }
  });
  it("the figures equal Calculator -> Insulation and the PURE pricer for the same inputs (Nitrile, No, 6, 1 inch / 25.4)", () => {
    for (const size of ["1 inch", "25.4"]) {
      expect({ size, calc: fig(CALC_INS(size).values) }).toEqual({ size, calc: [238, 14] });
      expect({ size, pure: pure(INS, ins({ cladding: "No", thickness_mm: "6", pipe_size_mm: size }, ["pipe_size_mm", "thickness_mm"])) }).toEqual({ size, pure: [238, 14] });
    }
    expect(fig(attached(typed108("pipe", "1 inch").v).view.totals)).toEqual(fig(CALC_INS("1 inch").values));
  });
  it("NEGATIVE: '25.4' in the PIPE's box is 25.4 mm, not an inch -- CPVC prices at 32 mm (408 / 28); the section is still 238 / 14 at 28.58", () => {
    const { v } = typed108("pipe", "25.4");
    expect({ pipe: fig(v.items[0].figures), sec: fig(attached(v).view.totals), at: field(secBlock(attached(v)), "pipe_size_mm").value })
      .toEqual({ pipe: [408, 28], sec: [238, 14], at: "28.58" });
  });
});

// =====================================================================================================
// AC1 -- a section refusing over its pipe's size keeps what the AI read
// =====================================================================================================
describe("12e-5 AC1 -- a section refusing over its pipe's size shows every value the AI read, in its dropdown word; still no figure", () => {
  const noPricedAs = (sv: SectionBlockView) => expect(sectionLines(sv).filter((l) => l.includes("priced as"))).toEqual([]);

  it("row 108 (the pipe refused its size): cladding 'No' with its amber line, thickness '6mm' in its Other box as before, the size 'From pipe: <sentence>', no figure", () => {
    const { v, values } = real("00186/108");
    const sentence = noUnitMessage("1");
    const sv = attached(v), sb = secBlock(sv);
    expect({ priced: sv.view.rowPriced, reason: sv.view.reason, totals: sv.view.totals, state: sb.state, figures: sb.figures, sku: sb.skuLine })
      .toEqual({ priced: false, reason: sentence, totals: undefined, state: "blank", figures: {}, sku: undefined });
    expect(sb.family).toBe(NITRILE);
    expect(field(sb, "cladding")).toMatchObject({ value: "No", defaulted: true, rule: CLADDING_RULE, otherMode: false });
    expect(field(sb, "thickness_mm")).toMatchObject({ value: "6mm", typedValue: "6mm", otherMode: true, defaulted: false });
    expect(field(sb, "pipe_size_mm")).toMatchObject({ value: "", mirrorTag: "from pipe", note: `From pipe: ${sentence}` });
    noPricedAs(sv);
    expect(values).toEqual({});
  });
  it("rows 100-102 (the pipe stated no size): the section refuses 'no pipe size stated' with cladding 'No' (amber) and thickness 13 from '13mm'", () => {
    for (const id of ["00186/100", "00186/101", "00186/102"]) {
      const { v } = real(id);
      const sv = attached(v), sb = secBlock(sv);
      expect({ id, priced: sv.view.rowPriced, reason: sv.view.reason, figures: sb.figures }).toEqual({ id, priced: false, reason: "no pipe size stated", figures: {} });
      expect({ id, cladding: field(sb, "cladding") }).toMatchObject({ id, cladding: { value: "No", defaulted: true, rule: CLADDING_RULE } });
      expect({ id, thickness: field(sb, "thickness_mm") }).toMatchObject({ id, thickness: { value: "13", note: "BoQ says 13mm -> 13 mm (the sheet's own spelling of this value)" } });
      expect({ id, size: field(sb, "pipe_size_mm").value }).toEqual({ id, size: "" });
      noPricedAs(sv);
    }
  });
  it("NEGATIVE: a thickness the AI did NOT read stays blank -- the 9 mm rule default is not a value the AI read (BOQ-26-00292 / HVAC row 10, as stored)", () => {
    const { v } = panel(PIP, [
      { pipe_type: "Copper", pipe_type_as_written: "copper", size_mm: null, pipe_class: null, insulated: "Yes" },
      { section: SEC, item: NITRILE, cladding: "None", thickness_mm: null, pipe_size_mm: null, brand: null, material_as_written: "nitryl rubber" }],
      "mtr", "Supply and installation of Extra copper pipings covering with nitryl rubber and tape.");
    const sb = secBlock(attached(v));
    expect({ reason: attached(v).view.reason, cladding: field(sb, "cladding").value, thickness: field(sb, "thickness_mm").value, defaulted: field(sb, "thickness_mm").defaulted })
      .toEqual({ reason: "no pipe size stated", cladding: "No", thickness: "", defaulted: false });
  });
  it("on a refused section the cladding shows EXACTLY as Insulation shows it on a priced row (row 107: same value, flag, rule and options)", () => {
    const pick = (b: ItemBlockView) => { const f = field(b, "cladding"); return { value: f.value, defaulted: f.defaulted, rule: f.rule, options: f.options }; };
    const priced = secBlock(attached(real("00186/107").v));
    expect(priced.state).toBe("priced");
    expect(pick(secBlock(attached(real("00186/108").v)))).toEqual(pick(priced));
    expect(pick(secBlock(attached(real("00186/100").v)))).toEqual(pick(priced));
  });
  it("the pricer refusing at the size need HOLDS the cladding default it had read -- and never on `defaulted`", () => {
    const spec = itemListPricingSpec(CFG[INS])!;
    const one = (a: Answer) => priceItemList(spec, ITEMS, "mts", [stored(INS, a)] as never, "", "").items[0];
    const r = one({ item: NITRILE, cladding: "None", thickness_mm: "13mm", pipe_size_mm: null });
    expect({ state: r.state, reason: r.reason, defaulted: r.defaulted, held: r.heldDefaults }).toEqual({
      state: "blank", reason: "no pipe size stated", defaulted: [],
      held: { need: "pipe_size_mm", defaulted: [{ attr: "cladding", value: "No", rule: "R1 cladding not mentioned -> without cladding (owner 2026-10-07)" }] },
    });
    // NEGATIVE: nothing held where nothing was answered "None", nor on an item that prices
    expect(one({ item: NITRILE, cladding: "26G Aluminium", thickness_mm: "13", pipe_size_mm: null }).heldDefaults).toBeUndefined();
    const ok = one({ item: NITRILE, cladding: "None", thickness_mm: "13", pipe_size_mm: "28.58" });
    expect({ state: ok.state, held: ok.heldDefaults, defaulted: ok.defaulted.map((d) => d.attr) }).toEqual({ state: "priced", held: undefined, defaulted: ["cladding"] });
  });
  it("NEGATIVE: an Insulation row of its OWN refusing for no pipe size is unchanged -- its cladding still shows the 'None' it read", () => {
    const own = panel(INS, [{ item: NITRILE, cladding: "None", thickness_mm: "13mm", pipe_size_mm: null }], "RMT");
    const b = own.v.items[0];
    expect({ state: b.state, reason: b.reason, cladding: field(b, "cladding").value, defaulted: field(b, "cladding").defaulted }).toEqual({ state: "blank", reason: "no pipe size stated", cladding: "None", defaulted: false });
  });
  it("NEGATIVE: a section refusing at ANOTHER need (its thickness unreadable) keeps today's display -- the cladding stays 'None'", () => {
    const x = panel(PIP, [{ pipe_type: "Copper", size_mm: "15.9 mm O.D", insulated: "Yes" },
      { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "as per specification", pipe_size_mm: null }], "RMT");
    const sv = attached(x.v), sb = secBlock(sv);
    expect(sv.view.rowPriced).toBe(false);
    expect(sv.view.reason).toMatch(/thickness/);
    expect(field(sb, "cladding").value).toBe("None");
  });
  it("NEGATIVE: the calculator, where nothing is ever read as 'None' -- a section under a pipe refused on its size shows its cladding blank as before", () => {
    const x = compute(PIP, { items: [{ base: null, family: "CPVC", attrs: { size_mm: "1", insulated: "Yes" }, other: ["size_mm"], sections: { [SEC]: ins({ thickness_mm: "13" }) } }] });
    const sb = secBlock(attached(x.v));
    expect({ reason: attached(x.v).view.reason, cladding: field(sb, "cladding").value, defaulted: field(sb, "cladding").defaulted })
      .toEqual({ reason: noUnitMessage("1"), cladding: "", defaulted: false });
  });
});
