/**
 * SLICE 12e-3a (owner rulings D1 / D1a / D3 / D3a / D3b / D4 / Q2a / Q3 / Q4 / Q6 / 13:40 / 13:42, 2026-10-08 .. 11)
 * -- THE INSULATION SECTION ON PIPING, PRICED. Every rule is tested from the PANEL'S ENTRY POINT
 * (`makePricingSheetHelper(...).compute`) on the v37 asset, read at runtime.
 *
 *   AC1  the end-to-end proof: Copper 5/8", Insulated = Yes, 26G Aluminium, 13 -> the attached section shows the
 *        figures and working lines Calculator -> Insulation shows (324 / 224); row total 1622 / 444; a Pricing Input
 *        moves both by the same amount and leaves the cladding-No section alone.
 *   AC2  v37 is v36 plus exactly two additions to the Piping config.
 *   AC5  sections in the helper: attached and independent, the toggle and its two default renderings, the model
 *        path's attachment rules; the section is priced with the delegated category's own config OBJECT.
 *   AC6  the mirror: what is mirrored, "From pipe: ...", "you chose X (pipe is Y)", a hand edit kept.
 *   AC7  totals and the add buttons; Insulation and ADP carry no section and keep "+ Add item".
 *   AC8  parity: every Nitrile Rubber / Tubular Puf SKU x three pipe sizes, section == Calculator -> Insulation.
 *
 * What each block protects is said in its `describe`. Negative halves sit beside every positive.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { mirroredLead } from "@/pages/pricing/rate-master/plainEnglish";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, decodeItemEdits, itemsOnScreen, makePricingSheetHelper, mirroredNumber,
  rowTotals, type ItemBlockView, type ItemEdit, type ItemEditOp, type ItemListEditState, type ItemListSuggestion, type ItemListView,
  type SectionBlockView,
} from "./pricingSheetHelper";
import { delegatedSections, itemFieldDefs, itemListPricingSpec, listSpecDefs, noUnitMessage, type ItemPriceResult } from "./itemListPricing";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const ASSET = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v37.json`, import.meta.url));
const V36 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v36.json`, import.meta.url));
const CFG: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET.category_configs.map((c) => [c.category_id, c]));
const CONFIGS = new Map<string, RateCategoryConfig>(Object.entries(CFG));
const ITEMS: RateMasterItem[] = ASSET.items.map((it) => ({ ...it, discipline: ASSET.discipline } as RateMasterItem));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const KINDS = ["supply_rate", "install_rate", "combined_rate"] as const;
const NITRILE = "Nitrile Rubber Insulation", PUF = "Tubular Puf Insulation";
const HEADING = "Insulation - priced by Insulation's rules";
const SEC = "insulation";

const cells = (a: Record<string, string>): ExtractionRow["attributes"] =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
type World = { configs?: Map<string, RateCategoryConfig>; items?: RateMasterItem[] };

/** The CALCULATOR path: an empty extraction map; the whole edit state is the override. */
function compute(category: string, state: ItemListEditState, w: World = {}, unit = "mts") {
  const h = makePricingSheetHelper({ configsByCategory: w.configs ?? CONFIGS, items: w.items ?? ITEMS, extractionByRow: new Map() });
  const ctx: RateHelperRowContext = { excelRow: 1, description: "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS] };
  const r = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: unit });
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, values: s.values };
}
/** The PANEL path: the model's stored answer (a LIST of items) through `extractionByRow`, the row's own unit. */
function panel(answer: Array<Record<string, string>>, state?: ItemListEditState, unit = "Rmt", w: World = {}) {
  const row = { excelRow: 1, description: "", attributes: {}, items: answer.map(({ section, ...a }) => ({ attributes: cells(a), ...(section ? { section } : {}) })) } as ExtractionRow;   // 12e-4b (owner D-2): an insulation answer carries the marker the run stores, on the ITEM
  const h = makePricingSheetHelper({ configsByCategory: w.configs ?? CONFIGS, items: w.items ?? ITEMS, extractionByRow: new Map([[1, row]]) });
  const ctx: RateHelperRowContext & { unit?: string } = { excelRow: 1, description: "", nodeType: "Line Item", category: PIP, discipline: "HVAC", rateKinds: [...KINDS], unit };
  const r = h.compute(ctx, state ? { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state) } : {});
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, values: s.values };
}
const field = (b: ItemBlockView, id: string) => b.fields.find((f) => f.id === id)!;
const fig = (values: Partial<Record<string, number>> | undefined) => [values?.supply_rate, values?.install_rate];
const attached = (v: ItemListView, pipe = 0): SectionBlockView => v.items[pipe].sections![0];
const secBlock = (sv: SectionBlockView): ItemBlockView => sv.view.items[0];

/** A pipe as the calculator's pricer enters it: the type picked, the size typed through "Other...". */
const pipe = (family: string, size: string, more: Record<string, string> = {}, sections?: Record<string, ItemEdit>): ItemEdit =>
  ({ base: null, family, attrs: { size_mm: size, ...more }, other: ["size_mm"], ...(sections ? { sections } : {}) });
/** A section's edit: the family picked (null = the delegated category's own default), its picks. */
const ins = (family: string | null, attrs: Record<string, string> = {}, other: string[] = []): ItemEdit =>
  ({ base: null, family, attrs, ...(other.length ? { other } : {}) });
/** Calculator -> Insulation, one item, pipe size typed through "Other...". */
const insCalc = (family: string, attrs: Record<string, string>, w: World = {}, other: string[] = ["pipe_size_mm"]) =>
  compute(INS, { items: [{ base: null, family, attrs, other }] }, w);
/** One pipe with Insulated = Yes and the given section picks. */
const insulated = (family: string, size: string, section: ItemEdit): ItemListEditState =>
  ({ items: [pipe(family, size, { insulated: "Yes" }, { [SEC]: section })] });
/** Drive the state the way the panel does: each operation applied to the edit state the view returned. */
function drive(ops: ItemEditOp[], start: ItemListEditState = { items: [] }, w: World = {}) {
  let r = compute(PIP, start, w);
  for (const op of ops) r = compute(PIP, applyItemEdit(r.v.editState, op), w);
  return r;
}
const inSection = (inner: ItemEditOp, pipeIndex: number | null = 0, index = 0): ItemEditOp => ({ op: "section", section: SEC, pipe: pipeIndex, index, inner });

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3a AC1 -- the end-to-end proof: Copper 5/8\", Insulated = Yes, 26G Aluminium, 13", () => {
  const e2e = () => drive([
    { op: "add", family: "Copper" },
    { op: "set_other", index: 0, id: "size_mm", on: true },
    { op: "set_attr", index: 0, id: "size_mm", value: '5/8"' },
    { op: "set_attr", index: 0, id: "insulated", value: "Yes" },
    // 12e-3b (owner D1b): in the calculator the section opens on the material list with nothing picked -- the
    // pricer picks it. BEFORE this step did not exist: the section opened on Insulation's default material.
    inSection({ op: "change_family", index: 0, family: NITRILE }),
    inSection({ op: "set_attr", index: 0, id: "cladding", value: "26G Aluminium" }),
    inSection({ op: "set_attr", index: 0, id: "thickness_mm", value: "13" }),
  ]);
  it("the pipe prices 1298 / 220 and the attached section 324 / 224, under the header and directly under its pipe", () => {
    const { v } = e2e();
    expect(fig(v.items[0].figures)).toEqual([1298, 220]);
    expect(v.items[0].sections).toHaveLength(1);
    const sv = attached(v);
    expect(sv.heading).toBe(HEADING);
    expect(sv.pipe).toBe(0);
    expect(fig(sv.view.totals)).toEqual([324, 224]);
    expect(secBlock(sv).family).toBe(NITRILE);
    // INVERTED at 12e-3b (owner D1b): the material is the pricer's PICK in the calculator, never a default.
    // BEFORE: `expect(secBlock(sv).familyDefaulted).toBeDefined()` -- Insulation's "material not mentioned" default.
    expect(secBlock(sv).familyDefaulted).toBeUndefined();
  });
  it("the section's figures AND working lines are Calculator -> Insulation's for Nitrile, 26G, 13, pipe size Other 15.875", () => {
    const sv = attached(e2e().v);
    const own = insCalc(NITRILE, { cladding: "26G Aluminium", thickness_mm: "13", pipe_size_mm: "15.875" });
    expect(own.values).toEqual({ supply_rate: 324, install_rate: 224, combined_rate: 548 });
    expect(sv.view.totals).toEqual(own.v.totals);
    expect(secBlock(sv).figures).toEqual(own.v.items[0].figures);
    expect(secBlock(sv).skuLine).toBe(own.v.items[0].skuLine);
    // INVERTED at 12e-3b (owner D1b): the material IS picked in the section, so the section carries NO "not
    // mentioned" line and its working is the calculator's, line for line. BEFORE: the section was unpicked,
    // `working` contained DEFAULT_LINE and equalled the calculator's only with that line filtered out.
    // INVERTED at 12e-4b (owner G2 / G3: the field's label, and nothing said twice). BEFORE:
    //   "item not mentioned -> Nitrile Rubber Insulation (material not mentioned -> Nitrile by row kind: per metre = pipe, per sq.m = sheet, acoustic / lining in the row or its headings = acoustic)"
    const DEFAULT_LINE = "insulation material not mentioned -> Nitrile Rubber Insulation (Nitrile by row kind: per metre = pipe, per sq.m = sheet, acoustic / lining in the row or its headings = acoustic)";
    expect(secBlock(sv).working).not.toContain(DEFAULT_LINE);
    expect(secBlock(sv).working).toEqual(own.v.items[0].working);
    // with the material picked in the section too, the working lines are identical, line for line
    const picked = attached(compute(PIP, insulated("Copper", '5/8"', ins(NITRILE, { cladding: "26G Aluminium", thickness_mm: "13" }))).v);
    expect(secBlock(picked).working).toEqual(own.v.items[0].working);
    // Insulation's OWN behaviour is unchanged: an Insulation item whose material is not picked still carries its
    // default line (BEFORE 12e-3b the calculator section read exactly as this item; it now reads as the picked one)
    const unpicked = compute(INS, { items: [{ base: null, family: null, attrs: { cladding: "26G Aluminium", thickness_mm: "13", pipe_size_mm: "15.875" }, other: ["pipe_size_mm"] }] });
    expect(unpicked.v.items[0].working).toContain(DEFAULT_LINE);
    expect(unpicked.v.items[0].working.filter((w) => w !== DEFAULT_LINE)).toEqual(secBlock(sv).working);
  });
  it("the row total is the sum of the two lines: 1622 / 444 / 2066, and the row is usable", () => {
    const { v, values, s } = e2e();
    expect(values).toEqual({ supply_rate: 1622, install_rate: 444, combined_rate: 2066 });
    expect(v.rowPriced).toBe(true);
    expect(rowTotals(v)).toEqual({ supply_rate: 1622, install_rate: 444, combined_rate: 2066 });
    expect(v.sections).toMatchObject({ lines: 2, bad: 0 });
    expect(s.basis).toBe("Rate master: Piping · 2 items");
    expect(s.workings.derivation).toEqual(["Row total per 1 mts: supply 1622 + install 444"]);
  });
  it("NEGATIVE: with Insulated = No the same pipe is the row -- 1298 / 220, no section", () => {
    const { v, values } = compute(PIP, { items: [pipe("Copper", '5/8"', { insulated: "No" })] });
    expect(values).toEqual({ supply_rate: 1298, install_rate: 220, combined_rate: 1518 });
    expect(v.items[0].sections).toBeUndefined();
    expect(v.sections).toMatchObject({ lines: 1, bad: 0 });
  });

  /** "Aluminium sheet 26G" moved 450 -> 600: the SAME items array feeds the Piping row and the Insulation calculator. */
  const bumped: RateMasterItem[] = ITEMS.map((it) =>
    it.kind === "hvac_pricing_input" && it.attributes?.item === "alu_sheet_26g" ? ({ ...it, rates: { ...it.rates, rate: 600 } } as RateMasterItem) : it);
  it("a Pricing Input ('Aluminium sheet 26G' 450 -> 600) moves the Piping section and Calculator -> Insulation by the SAME amount", () => {
    const clad = ins(NITRILE, { cladding: "26G Aluminium", thickness_mm: "13" });
    const before = attached(compute(PIP, insulated("Copper", '5/8"', clad)).v).view.totals!;
    const after = attached(compute(PIP, insulated("Copper", '5/8"', clad), { items: bumped }).v).view.totals!;
    const ownBefore = insCalc(NITRILE, { cladding: "26G Aluminium", thickness_mm: "13", pipe_size_mm: "15.875" }).values;
    const ownAfter = insCalc(NITRILE, { cladding: "26G Aluminium", thickness_mm: "13", pipe_size_mm: "15.875" }, { items: bumped }).values;
    expect(before).toEqual({ supply_rate: 324, install_rate: 224, combined_rate: 548 });
    expect(after.supply_rate! - before.supply_rate!).toBeGreaterThan(0);
    expect(after.supply_rate! - before.supply_rate!).toBe(ownAfter.supply_rate! - ownBefore.supply_rate!);
    expect(after).toEqual({ supply_rate: ownAfter.supply_rate, install_rate: ownAfter.install_rate, combined_rate: ownAfter.combined_rate });
  });
  it("NEGATIVE: the cladding-No section (216 / 14) does not move with that input, and neither does the pipe", () => {
    const bare = ins(NITRILE, { cladding: "No", thickness_mm: "13" });
    const a = compute(PIP, insulated("Copper", '5/8"', bare));
    const b = compute(PIP, insulated("Copper", '5/8"', bare), { items: bumped });
    expect(fig(attached(a.v).view.totals)).toEqual([216, 14]);
    expect(attached(b.v).view.totals).toEqual(attached(a.v).view.totals);
    expect(b.v.items[0].figures).toEqual(a.v.items[0].figures);
    expect(a.values).toEqual({ supply_rate: 1514, install_rate: 234, combined_rate: 1748 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3a AC2 -- v37 is v36 plus exactly two additions to the Piping config", () => {
  it("every item is unchanged and in the same order", () => {
    expect(ASSET.items).toEqual(V36.items);
  });
  it("every config other than Piping is unchanged; Piping differs only by the `insulated` definition and `list_spec.sections`", () => {
    const byId = (a: Asset) => Object.fromEntries(a.category_configs.map((c) => [c.category_id, c]));
    const now = byId(ASSET), was = byId(V36);
    expect(ASSET.category_configs.map((c) => c.category_id)).toEqual(V36.category_configs.map((c) => c.category_id));
    for (const id of Object.keys(was)) if (id !== PIP) expect(now[id]).toEqual(was[id]);
    const p = structuredClone(now[PIP]) as unknown as { list_spec: { attribute_definitions: Array<{ id: string }>; sections?: unknown } };
    expect(p.list_spec.attribute_definitions.map((d) => d.id)).toEqual(["pipe_type", "size_mm", "pipe_class", "insulated"]);
    p.list_spec.attribute_definitions = p.list_spec.attribute_definitions.filter((d) => d.id !== "insulated");
    delete p.list_spec.sections;
    expect(p).toEqual(was[PIP]);
  });
  it("the section declares the two ruled families, the toggle, the value when nothing was read, and the mirror", () => {
    const spec = itemListPricingSpec(CFG[PIP])!;
    expect(spec.sections).toEqual([
      { id: "pipe", label: "Pipe", add_label: "Add pipe" },
      { id: "insulation", label: "Insulation", add_label: "Add insulation", category_id: INS, unit_class: "length",
        families: [NITRILE, PUF], include_when: { attr: "insulated", equals: "Yes" },
        absent: { value: "No", line: "insulation not mentioned -> No" },
        mirror: { from: "size_mm", to: "pipe_size_mm", tag: "from pipe", line: "you chose {chosen} (pipe is {pipe})" } },
    ]);
    expect(delegatedSections(spec).map((s) => s.id)).toEqual(["insulation"]);
  });
  it("NEGATIVE: Insulation and ADP declare no section; Cladding Only is not offered although it is stocked per metre", () => {
    expect(itemListPricingSpec(CFG[INS])!.sections).toBeUndefined();
    expect(itemListPricingSpec(CFG[ADP])!.sections).toBeUndefined();
    expect(ITEMS.filter((it) => it.kind === "hvac_insulation_item" && it.attributes?.item === "Cladding Only" && it.unit === "Mts")).toHaveLength(5);
    expect(compute(PIP, { items: [] }).v.sections!.adds[0].families.map((f) => f.family)).toEqual([NITRILE, PUF]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3a AC5 -- the 'Insulated' toggle: a per-pipe Yes / No the pricing never reads", () => {
  it("every pipe block carries the field, last, offering Yes AND No whatever else is picked", () => {
    for (const fam of ["Copper", "MS", "PVC", "CPVC"]) {
      const { v } = compute(PIP, { items: [{ base: null, family: fam, attrs: {} }] });
      const f = v.items[0].fields[v.items[0].fields.length - 1];
      expect(f.id).toBe("insulated");
      expect(f.label).toBe("Insulated");
      expect(f.options).toEqual(["Yes", "No"]);
      expect(f.gate).toEqual({ section: "insulation", equals: "Yes" });
    }
  });
  // INVERTED at 12e-3c (owner F12 "fix": "'Insulated: No' ... shows 'No' without the amber default tag") for the
  // CALCULATOR. BEFORE: "a pipe the PRICER adds starts 'No' plainly: not amber, no line" -- `f.defaulted` false and
  // `f.rule` undefined on the calculator path. The plain "No" is kept where it was ruled for: a pipe the pricer adds
  // ON A BoQ ROW (the negative half, below).
  it("12e-3c F12: in the calculator a pipe's 'No' nobody picked is amber with its line (BEFORE: plain, no line); a pipe the pricer adds ON A BoQ ROW still starts 'No' plainly", () => {
    const f = field(compute(PIP, { items: [pipe("Copper", '5/8"')] }).v.items[0], "insulated");
    expect(f.value).toBe("No");
    expect(f.defaulted).toBe(true);
    expect(f.rule).toBe("insulation not mentioned -> No");
    const first = panel([{ pipe_type: "Copper", size_mm: '5/8"' }]);
    const added = panel([{ pipe_type: "Copper", size_mm: '5/8"' }], applyItemEdit(first.v.editState, { op: "add", family: "MS" }));
    const g = field(added.v.items[1], "insulated");
    expect(g.value).toBe("No");
    expect(g.defaulted).toBe(false);
    expect(g.rule).toBeUndefined();
  });
  it("a BoQ row the MODEL read with no insulation facts shows 'No' amber with 'insulation not mentioned -> No'", () => {
    const { v, values } = panel([{ pipe_type: "Copper", size_mm: '5/8"' }]);
    const f = field(v.items[0], "insulated");
    expect(f.value).toBe("No");
    expect(f.defaulted).toBe(true);
    expect(f.rule).toBe("insulation not mentioned -> No");
    expect(v.items[0].sections).toBeUndefined();
    expect(values).toEqual({ supply_rate: 1298, install_rate: 220, combined_rate: 1518 });
  });
  it("NEGATIVE: the toggle changes no pipe figure and no pipe field -- Yes and No price the pipe identically", () => {
    const no = compute(PIP, { items: [pipe("Copper", '5/8"', { insulated: "No" })] }).v.items[0];
    const yes = compute(PIP, { items: [pipe("Copper", '5/8"', { insulated: "Yes" })] }).v.items[0];
    expect(yes.figures).toEqual(no.figures);
    expect(yes.working).toEqual(no.working);
    expect(field(yes, "size_mm")).toEqual(field(no, "size_mm"));
    expect(field(yes, "size_mm").options).toEqual(["6.4", "9.5", "12.7", "15.9", "19.1", "22.2", "25.4", "28.6", "31.7", "34.9", "38.1", "41.3", "47.6"]);
  });
  it("NEGATIVE: `insulated` is in no needs list and no match list, so the pure pricer never sees it", () => {
    const spec = itemListPricingSpec(CFG[PIP])!;
    expect(spec.match_attrs).not.toContain("insulated");
    expect(spec.choice_attrs).not.toContain("insulated");
    for (const fam of Object.values(spec.families)) {
      expect(fam.needs).not.toContain("insulated");
      for (const u of Object.values(fam.units)) expect(u.needs ?? []).not.toContain("insulated");
    }
    // and a config that declares no section gets no such field
    expect(itemFieldDefs(itemListPricingSpec(CFG[INS])!, listSpecDefs(CFG[INS]), NITRILE, "length", { items: ITEMS }).some((f) => f.gate)).toBe(false);
  });
  it("Yes opens THAT pipe's section; 'No' removes it and the section's edits with it (one operation)", () => {
    const open = drive([{ op: "set_attr", index: 0, id: "insulated", value: "Yes" },
                        inSection({ op: "change_family", index: 0, family: NITRILE }),     // 12e-3b (D1b): the pricer picks the material
                        inSection({ op: "set_attr", index: 0, id: "cladding", value: "No" })], { items: [pipe("Copper", '5/8"')] });
    expect(open.v.items[0].sections).toHaveLength(1);
    expect(open.v.editState.items[0].sections![SEC].attrs).toEqual({ cladding: "No" });
    const closed = compute(PIP, applyItemEdit(open.v.editState, { op: "set_attr", index: 0, id: "insulated", value: "No", dropSection: SEC }));
    expect(closed.v.items[0].sections).toBeUndefined();
    expect(closed.v.editState.items[0].sections).toBeUndefined();
    // re-opening starts a fresh section, not the old picks
    const again = compute(PIP, applyItemEdit(closed.v.editState, { op: "set_attr", index: 0, id: "insulated", value: "Yes" }));
    // INVERTED at 12e-3b (owner D1b). BEFORE: `expect(field(secBlock(attached(again.v)), "cladding").value).toBe("")` -- a
    // fresh section on the default material. It is now a fresh section with NOTHING picked: the material list.
    expect(attached(again.v).view.pickFamily).toBe(true);
    expect(attached(again.v).view.items).toEqual([]);
    expect(again.v.editState.items[0].sections![SEC]).toEqual({ base: null, family: null, attrs: {} });
  });
  it("a changed pipe type starts BLANK (owner S1): the toggle and its section go with it", () => {
    const open = compute(PIP, insulated("Copper", '5/8"', ins(NITRILE, { cladding: "No", thickness_mm: "13" })));
    const changed = compute(PIP, applyItemEdit(open.v.editState, { op: "change_family", index: 0, family: "MS" }));
    expect(field(changed.v.items[0], "insulated").value).toBe("No");
    expect(changed.v.items[0].sections).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3a AC5 -- the section is priced by the delegated category's OWN config object, items and function", () => {
  it("the Insulation config object in the helper's map is the one read to price the Piping section (a Proxy on it sees the reads)", () => {
    const reads: string[] = [];
    const proxied = new Proxy(CFG[INS], { get: (t, k, r) => { reads.push(String(k)); return Reflect.get(t, k, r); } });
    const configs = new Map(CONFIGS); configs.set(INS, proxied);
    const state = insulated("Copper", '5/8"', ins(NITRILE, { cladding: "26G Aluminium", thickness_mm: "13" }));
    reads.length = 0;
    const { v } = compute(PIP, state, { configs });
    expect(fig(attached(v).view.totals)).toEqual([324, 224]);
    expect(reads).toContain("list_spec");
    // NEGATIVE: a helper whose map holds a DIFFERENT Insulation object never touches this one
    reads.length = 0;
    compute(PIP, state);
    expect(reads).toEqual([]);
  });
  it("a change to the Insulation config moves the Piping section and Calculator -> Insulation alike (no copy anywhere)", () => {
    const edited = structuredClone(CFG[INS]) as unknown as { list_spec: { pricing: { number_defaults: { thickness_mm: { value: number } } } } };
    edited.list_spec.pricing.number_defaults.thickness_mm.value = 19;        // T1 default 9 -> 19
    const configs = new Map(CONFIGS); configs.set(INS, edited as unknown as RateCategoryConfig);
    const state = insulated("Copper", '5/8"', ins(NITRILE, { cladding: "No" }));   // thickness not stated
    const sv = attached(compute(PIP, state, { configs }).v);
    const own = compute(INS, { items: [{ base: null, family: null, attrs: { cladding: "No", pipe_size_mm: "15.875" }, other: ["pipe_size_mm"] }] }, { configs });
    expect(sv.view.rowPriced).toBe(true);
    expect(sv.view.totals).toEqual(own.v.totals);
    expect(field(secBlock(sv), "thickness_mm").value).toBe("19");
    // and with the live config the same section reads Insulation's 9 mm default, laddered by Insulation's own rule
    const live = attached(compute(PIP, state).v);
    expect(secBlock(live).working.join(" | ")).toContain("9");
    expect(live.view.totals).not.toEqual(sv.view.totals);
  });
  it("NEGATIVE: a helper that cannot resolve the Insulation category refuses the section and never prices it by other rules", () => {
    const configs = new Map(CONFIGS); configs.delete(INS);
    const { v, values } = compute(PIP, insulated("Copper", '5/8"', ins(NITRILE, { cladding: "No", thickness_mm: "13" })), { configs });
    const sv = attached(v);
    expect(sv.view.rowPriced).toBe(false);
    expect(sv.view.reason).toBe("Insulation cannot be priced here - its rules are not loaded; price it by hand");
    expect(sv.view.items).toEqual([]);
    expect(values).toEqual({});
    expect(fig(v.items[0].figures)).toEqual([1298, 220]);     // the pipe keeps its figures
    expect(v.sections!.adds).toEqual([]);                     // and nothing offers to add what cannot be priced
  });
  it("the section behaves as Insulation: its own quantity box, 'Change item' list of the two families, cladding default line", () => {
    const { v } = compute(PIP, insulated("Copper", '5/8"', ins(NITRILE, { thickness_mm: "13" })));
    const sv = attached(v);
    expect(sv.view.families.map((f) => f.family)).toEqual([NITRILE, PUF]);
    expect(secBlock(sv).qty).toBe("1");
    // INVERTED at 12e-3c (owner F10: the section under a pipe takes the pipe's quantity). BEFORE:
    //   expect(secBlock(sv).qtyDefaulted).toBe(true);   -- the section's own amber 1, not linked to the pipe
    expect(secBlock(sv).qtyDefaulted).toBe(false);
    expect(secBlock(sv).qtyMirrorTag).toBe("from pipe");
    const own = insCalc(NITRILE, { thickness_mm: "13", pipe_size_mm: "15.875" });
    expect(field(secBlock(sv), "cladding")).toEqual(field(own.v.items[0], "cladding"));
    expect(secBlock(sv).state).toBe(own.v.items[0].state);
    expect(secBlock(sv).reason).toBe(own.v.items[0].reason);
    // a quantity typed in the section is Insulation's own quantity rule
    const two = compute(PIP, insulated("Copper", '5/8"', { ...ins(NITRILE, { cladding: "No", thickness_mm: "13" }), qty: "2" }));
    expect(fig(attached(two.v).view.totals)).toEqual([432, 28]);
    expect(two.values).toEqual({ supply_rate: 1730, install_rate: 248, combined_rate: 1978 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3a AC5 -- the model path (owner Q3 / Q4): insulation arrives as a second item of the row's list", () => {
  const PIPE1 = { pipe_type: "Copper", size_mm: '5/8"' }, PIPE2 = { pipe_type: "Copper", size_mm: '3/8"' };
  // 12e-4b (owner D-2): the model's insulation items carry `section: "insulation"` (BEFORE: no marker; told apart by lacking pipe_type)
  const INS1 = { section: SEC, item: NITRILE, cladding: "26G Aluminium", thickness_mm: "13" };
  const INS2 = { section: SEC, item: NITRILE, cladding: "No", thickness_mm: "13" };
  it("insulation facts present -> the pipe reads Insulated = Yes and its section holds those values", () => {
    const { v, values } = panel([{ ...PIPE1, insulated: "Yes" }, INS1]);
    expect(v.items).toHaveLength(1);                                  // the insulation item is NOT drawn as a pipe
    expect(field(v.items[0], "insulated")).toMatchObject({ value: "Yes", defaulted: false, userEdited: false });
    const b = secBlock(attached(v));
    expect(b.source).toBe("model");
    expect(b.family).toBe(NITRILE);
    expect(field(b, "cladding").value).toBe("26G Aluminium");
    expect(field(b, "thickness_mm").value).toBe("13");
    expect(values).toEqual({ supply_rate: 1622, install_rate: 444, combined_rate: 2066 });
  });
  it("facts present -> Yes even where the model answered No (owner Q4)", () => {
    const { v } = panel([{ ...PIPE1, insulated: "No" }, INS1]);
    expect(field(v.items[0], "insulated").value).toBe("Yes");
    expect(v.items[0].sections).toHaveLength(1);
  });
  it("Yes with no facts -> an empty section that refuses until filled; the pipe keeps its figures; no row total", () => {
    const { v, values } = panel([{ ...PIPE1, insulated: "Yes" }]);
    const sv = attached(v);
    // 12e-6 AC3 INVERTED by mechanical authority (owner D1b / D5b: the model path's defaults). BEFORE: the section refused
    // (rowPriced false, source "user"), values {}, the row unpriced, sections { lines: 2, bad: 1 }. AFTER: the section opens
    // on Insulation's own "not mentioned" defaults -- each amber -- and the row prices; the pipe keeps its figures.
    expect(sv.view.rowPriced).toBe(true);
    const sb = secBlock(sv);
    expect(sb.familyDefaulted?.value).toBe(NITRILE);
    expect(field(sb, "cladding")).toMatchObject({ value: "No", defaulted: true });
    expect(field(sb, "thickness_mm").defaulted).toBe(true);
    expect(sb.reason).toBeUndefined();
    expect(v.rowPriced).toBe(true);
    expect(fig(v.items[0].figures)).toEqual([1298, 220]);
    expect(values.supply_rate).toBe(1298 + (sb.figures.supply_rate ?? NaN));
    expect(v.sections).toMatchObject({ lines: 2, bad: 0 });
  });
  it("the k-th insulation item attaches to the k-th pipe; an extra one is independent", () => {
    const { v } = panel([PIPE1, PIPE2, INS1, INS2, { section: SEC, item: PUF, cladding: "No", thickness_mm: "25", pipe_size_mm: "40" }]);
    expect(v.items).toHaveLength(2);
    expect(field(secBlock(attached(v, 0)), "cladding").value).toBe("26G Aluminium");
    expect(field(secBlock(attached(v, 1)), "cladding").value).toBe("No");
    expect(v.sections!.independent).toHaveLength(1);
    expect(secBlock(v.sections!.independent[0]).family).toBe(PUF);
    expect(v.sections!.independent[0].pipe).toBeNull();
    expect(v.sections!.lines).toBe(5);
  });
  it("model insulation with NO pipe item is an independent section, and prices on its own", () => {
    const { v, values } = panel([{ section: SEC, item: NITRILE, cladding: "No", thickness_mm: "13", pipe_size_mm: "15.88" }]);
    expect(v.items).toHaveLength(0);
    expect(v.sections!.independent).toHaveLength(1);
    expect(values).toEqual({ supply_rate: 216, install_rate: 14, combined_rate: 230 });
  });
  it("the mirror wins over a size the model put on the insulation while the pipe has a readable size", () => {
    const { v } = panel([PIPE1, { ...INS2, pipe_size_mm: "41.28" }]);
    const f = field(secBlock(attached(v)), "pipe_size_mm");
    expect(f.value).toBe("15.88");
    expect(f.mirrorTag).toBe("from pipe");
    // NEGATIVE: with no readable pipe size the model's own size stands, untagged
    const lone = panel([{ pipe_type: "Copper", insulated: "Yes" }, { ...INS2, pipe_size_mm: "41.28" }]);
    const g = field(secBlock(attached(lone.v)), "pipe_size_mm");
    expect(g.value).toBe("41.28");
    expect(g.mirrorTag).toBeUndefined();
  });
  it("the pricer can overrule the model's reading: picking No closes the section the facts opened", () => {
    const first = panel([PIPE1, INS1]);
    const state = applyItemEdit(first.v.editState, { op: "set_attr", index: 0, id: "insulated", value: "No", dropSection: SEC });
    const { v, values } = panel([PIPE1, INS1], state);
    expect(field(v.items[0], "insulated")).toMatchObject({ value: "No", userEdited: true, defaulted: false });
    expect(v.items[0].sections).toBeUndefined();
    expect(values).toEqual({ supply_rate: 1298, install_rate: 220, combined_rate: 1518 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3a AC6 -- the mirror (owner D3 / D3a / D3b / Q6)", () => {
  const PICKS = { cladding: "26G Aluminium", thickness_mm: "13" };
  it("5/8\" -> the section's Pipe size is pre-filled 15.875, tagged 'from pipe', and Insulation's own ladder lands it on 15.88", () => {
    const f = field(secBlock(attached(compute(PIP, insulated("Copper", '5/8"', ins(NITRILE, PICKS))).v)), "pipe_size_mm");
    expect(f.typedValue).toBe("15.875");
    expect(f.value).toBe("15.88");
    expect(f.mirrorTag).toBe("from pipe");
    expect(f.note).toBe("From pipe: 15.875 mm -> priced as 15.88 mm (the sheet's own spelling of this size)");
    expect(f.userEdited).toBe(false);                 // nothing to undo: the pricer typed nothing here
    expect(f.mirrorLine).toBeUndefined();
  });
  it("the line is Insulation's own with ONLY the lead changed (never 'You typed')", () => {
    const f = field(secBlock(attached(compute(PIP, insulated("Copper", '5/8"', ins(NITRILE, PICKS))).v)), "pipe_size_mm");
    const own = field(insCalc(NITRILE, { ...PICKS, pipe_size_mm: "15.875" }).v.items[0], "pipe_size_mm");
    expect(own.note).toBe("You typed 15.875 mm -> priced as 15.88 mm (the sheet's own spelling of this size)");
    expect(f.note).toBe(mirroredLead(own.note!, "from pipe"));
    expect(mirroredLead("BoQ says 15.875 mm -> priced as 15.88 mm", "from pipe")).toBe("BoQ says 15.875 mm -> priced as 15.88 mm");
  });
  it("1-1/4\" (31.75 mm) -> Insulation's own resolution of 31.75, the same rung and line as its calculator gives", () => {
    const f = field(secBlock(attached(compute(PIP, insulated("Copper", '1-1/4"', ins(NITRILE, PICKS))).v)), "pipe_size_mm");
    const own = field(insCalc(NITRILE, { ...PICKS, pipe_size_mm: "31.75" }).v.items[0], "pipe_size_mm");
    expect(f.typedValue).toBe("31.75");
    expect(f.value).toBe(own.value);
    expect(f.value).toBe("34.93");
    expect(f.note).toBe(mirroredLead(own.note!, "from pipe"));
  });
  it("owner D3b: the size the pipe PRICED AS is mirrored -- MS 100 -> 100; MS '4 inch' (read 101.6, priced on the x 25 read) -> 100", () => {
    const res = (hops: ItemPriceResult["ladderHops"], readValues: Record<string, number> = {}) => ({ ladderHops: hops, readValues } as unknown as ItemPriceResult);
    expect(mirroredNumber(res([{ attr: "size_mm", name: "pipe size", requested: 101.6, fitted: 100, exact: true, how: "alt", alt: 100 }]), "size_mm")).toBe("100");
    expect(mirroredNumber(res([{ attr: "size_mm", name: "pipe size", requested: 15.875, fitted: 15.9, exact: true, how: "precision" }]), "size_mm")).toBe("15.875");
    expect(mirroredNumber(res([], { size_mm: 400 }), "size_mm")).toBe("400");
    expect(mirroredNumber(res([]), "size_mm")).toBeUndefined();
    expect(mirroredNumber(undefined, "size_mm")).toBeUndefined();
    const four = compute(PIP, insulated("MS", "4 inch", ins(PUF, { cladding: "No", thickness_mm: "65" })));
    expect(field(four.v.items[0], "size_mm").value).toBe("100");
    expect(field(secBlock(attached(four.v)), "pipe_size_mm").typedValue).toBe("100");
    const hundred = compute(PIP, insulated("MS", "100", ins(PUF, { cladding: "No", thickness_mm: "65" })));
    expect(field(secBlock(attached(hundred.v)), "pipe_size_mm").typedValue).toBe("100");
    expect(attached(four.v).view.totals).toEqual(attached(hundred.v).view.totals);
  });
  it("MS 100 + Nitrile refuses with Insulation's own sentence; the pipe keeps 2256 / 560; no row total", () => {
    const { v, values } = compute(PIP, insulated("MS", "100", ins(NITRILE, { cladding: "26G Aluminium", thickness_mm: "32" })));
    expect(fig(v.items[0].figures)).toEqual([2256, 560]);
    const sv = attached(v);
    expect(sv.view.rowPriced).toBe(false);
    expect(secBlock(sv).reason).toBe("pipe size 100 is above the largest size on the sheet (53.98)");
    expect(values).toEqual({});
    expect(v.rowPriced).toBe(false);
    expect(v.totals).toBeUndefined();
    expect(v.sections).toMatchObject({ lines: 2, bad: 1 });
  });
  it("then the pricer picks 53.98 in the section: it prices, the tag goes, the line reads 'you chose 53.98 (pipe is 100)'", () => {
    const { v, values } = compute(PIP, insulated("MS", "100", ins(NITRILE, { cladding: "26G Aluminium", thickness_mm: "32", pipe_size_mm: "53.98" })));
    const sv = attached(v);
    const f = field(secBlock(sv), "pipe_size_mm");
    expect(sv.view.rowPriced).toBe(true);
    expect(f.value).toBe("53.98");
    expect(f.mirrorTag).toBeUndefined();
    expect(f.mirrorLine).toBe("you chose 53.98 (pipe is 100)");
    expect(f.userEdited).toBe(true);
    const own = insCalc(NITRILE, { cladding: "26G Aluminium", thickness_mm: "32", pipe_size_mm: "53.98" }, {}, []);
    expect(sv.view.totals).toEqual(own.v.totals);
    expect(values.supply_rate).toBe(2256 + own.values.supply_rate!);
    expect(values.install_rate).toBe(560 + own.values.install_rate!);
    expect(fig(v.items[0].figures)).toEqual([2256, 560]);           // changing the section never changes the pipe
  });
  it("a hand edit is KEPT when the pipe size later changes; undoing it brings the mirror back", () => {
    const edited = compute(PIP, insulated("Copper", '5/8"', ins(NITRILE, { ...PICKS, pipe_size_mm: "19.05" })));
    expect(field(secBlock(attached(edited.v)), "pipe_size_mm")).toMatchObject({ value: "19.05", mirrorLine: "you chose 19.05 (pipe is 15.875)" });
    expect(field(edited.v.items[0], "size_mm").value).toBe("15.9");
    const moved = compute(PIP, applyItemEdit(edited.v.editState, { op: "set_attr", index: 0, id: "size_mm", value: '7/8"' }));
    expect(field(moved.v.items[0], "size_mm").value).toBe("22.2");
    const f = field(secBlock(attached(moved.v)), "pipe_size_mm");
    expect(f.value).toBe("19.05");
    expect(f.mirrorTag).toBeUndefined();
    expect(f.mirrorLine).toBe("you chose 19.05 (pipe is 22.225)");
    const undone = compute(PIP, applyItemEdit(moved.v.editState, inSection({ op: "undo_attr", index: 0, id: "pipe_size_mm" })));
    expect(field(secBlock(attached(undone.v)), "pipe_size_mm")).toMatchObject({ typedValue: "22.225", value: "22.23", mirrorTag: "from pipe" });
  });
  it("NEGATIVE: while NOT hand-edited the section follows the pipe; a chosen size equal to the pipe's draws no line", () => {
    const a = compute(PIP, insulated("Copper", '5/8"', ins(NITRILE, PICKS)));
    const b = compute(PIP, applyItemEdit(a.v.editState, { op: "set_attr", index: 0, id: "size_mm", value: '7/8"' }));
    expect(field(secBlock(attached(b.v)), "pipe_size_mm")).toMatchObject({ typedValue: "22.225", value: "22.23", mirrorTag: "from pipe" });
    const same = compute(PIP, insulated("Copper", "12.7", ins(NITRILE, { ...PICKS, pipe_size_mm: "12.7" })));
    expect(field(secBlock(attached(same.v)), "pipe_size_mm").mirrorLine).toBeUndefined();
  });
  it("an INDEPENDENT section mirrors the FIRST pipe with a readable size; with no pipe it is blank", () => {
    const state: ItemListEditState = { items: [{ base: null, family: "Copper", attrs: {} }, pipe("Copper", '3/8"'), pipe("Copper", '5/8"')],
                                       sections: { [SEC]: [ins(NITRILE, { cladding: "No", thickness_mm: "13" })] } };
    const { v } = compute(PIP, state);
    const f = field(secBlock(v.sections!.independent[0]), "pipe_size_mm");
    expect(f.typedValue).toBe("9.525");
    expect(f.mirrorTag).toBe("from pipe");
    const none = compute(PIP, { items: [], sections: { [SEC]: [ins(NITRILE, { cladding: "No", thickness_mm: "13" })] } });
    const g = field(secBlock(none.v.sections!.independent[0]), "pipe_size_mm");
    expect(g.typedValue).toBe("");
    expect(g.mirrorTag).toBeUndefined();
    expect(none.v.rowPriced).toBe(false);
  });
  it("the same cases through the BoQ-panel path (the model's pipe): 5/8\" mirrors 15.875 and prices as the calculator does", () => {
    const viaModel = panel([{ pipe_type: "Copper", size_mm: '5/8"' }, { section: SEC, item: NITRILE, cladding: "26G Aluminium", thickness_mm: "13" }]);
    const viaCalc = compute(PIP, insulated("Copper", '5/8"', ins(NITRILE, PICKS)));
    const f = field(secBlock(attached(viaModel.v)), "pipe_size_mm");
    expect(f).toMatchObject({ typedValue: "15.875", value: "15.88", mirrorTag: "from pipe",
                              note: "From pipe: 15.875 mm -> priced as 15.88 mm (the sheet's own spelling of this size)" });
    expect(viaModel.values).toEqual(viaCalc.values);
    expect(secBlock(attached(viaModel.v)).working).toEqual(secBlock(attached(viaCalc.v)).working);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3a AC7 -- totals (owner D4 / Q2a / M5) and the add buttons (D5a / 13:42)", () => {
  const BARE = { cladding: "No", thickness_mm: "13" };
  it("two pipes, copper 3/8\" and 5/8\", both Insulated = Yes: each section mirrors ITS OWN pipe; the total is the four lines", () => {
    const state: ItemListEditState = { items: [pipe("Copper", '3/8"', { insulated: "Yes" }, { [SEC]: ins(NITRILE, BARE) }),
                                               pipe("Copper", '5/8"', { insulated: "Yes" }, { [SEC]: ins(NITRILE, BARE) })] };
    const { v, values } = compute(PIP, state);
    expect(field(secBlock(attached(v, 0)), "pipe_size_mm").typedValue).toBe("9.525");
    expect(field(secBlock(attached(v, 1)), "pipe_size_mm").typedValue).toBe("15.875");
    const lines = [v.items[0].figures, attached(v, 0).view.totals!, v.items[1].figures, attached(v, 1).view.totals!];
    expect(lines.every((l) => typeof l.supply_rate === "number" && typeof l.install_rate === "number")).toBe(true);
    expect(values.supply_rate).toBe(lines.reduce((a, l) => a + l.supply_rate!, 0));
    expect(values.install_rate).toBe(lines.reduce((a, l) => a + l.install_rate!, 0));
    expect(values.combined_rate).toBe(values.supply_rate! + values.install_rate!);
    expect(v.sections).toMatchObject({ lines: 4, bad: 0 });
    // each line is rounded on its own: the row adds whole rupees and never re-rounds
    expect(lines.every((l) => Number.isInteger(l.supply_rate) && Number.isInteger(l.install_rate))).toBe(true);
  });
  it("any refused line -> no row total, the count of lines that need a person, priced lines keep their figures", () => {
    const state: ItemListEditState = { items: [pipe("Copper", '3/8"', { insulated: "Yes" }, { [SEC]: ins(NITRILE, BARE) }),
                                               pipe("Copper", '5/8"', { insulated: "Yes" }, { [SEC]: ins(NITRILE, { cladding: "No", thickness_mm: "abc" }, ["thickness_mm"]) })] };
    const { v, values, s } = compute(PIP, state);
    expect(values).toEqual({});
    expect(v.rowPriced).toBe(false);
    expect(v.totals).toBeUndefined();
    expect(v.sections).toMatchObject({ lines: 4, bad: 1 });
    expect(fig(v.items[0].figures)).toEqual([429, 220]);          // copper 3/8"
    expect(fig(v.items[1].figures)).toEqual([1298, 220]);         // copper 5/8"
    expect(attached(v, 0).view.rowPriced).toBe(true);
    expect(v.reason).toBe(attached(v, 1).view.reason);
    expect(s.basis).toBe("Complete the missing attributes to price");
  });
  it("an attached section prices ON ITS OWN even where its pipe refuses; the row still has no total", () => {
    const { v, values } = compute(PIP, insulated("Copper", "abc", ins(NITRILE, { ...BARE, pipe_size_mm: "15.88" })));
    expect(v.items[0].state).toBe("blank");
    expect(fig(attached(v).view.totals)).toEqual([216, 14]);
    expect(values).toEqual({});
    expect(v.sections).toMatchObject({ lines: 2, bad: 1 });
  });
  it("a row with NO pipe and a priced independent insulation totals the insulation (owner: 'Total = the insulation')", () => {
    const { v, values, s } = compute(PIP, { items: [], sections: { [SEC]: [ins(NITRILE, { ...BARE, pipe_size_mm: "15.88" })] } });
    expect(values).toEqual({ supply_rate: 216, install_rate: 14, combined_rate: 230 });
    expect(v.rowPriced).toBe(true);
    expect(v.sections).toMatchObject({ lines: 1, bad: 0 });
    expect(s.basis).toBe("Rate master: Piping · 1 item");
  });
  it("NEGATIVE: an empty Piping row is not priced and says so, exactly as before", () => {
    const { v, values, s } = compute(PIP, { items: [] });
    expect(values).toEqual({});
    expect(v.rowPriced).toBe(false);
    expect(v.sections).toMatchObject({ lines: 0, bad: 0, independent: [] });
    expect(s.basis).toBe("Add an item to price");
  });
  it("'+ Add insulation' adds an INDEPENDENT section after the pipes; no toggle adds or removes it; its x removes it", () => {
    const one = drive([{ op: "add_section", section: SEC, family: NITRILE }], { items: [pipe("Copper", '5/8"', { insulated: "No" })] });
    expect(one.v.items[0].sections).toBeUndefined();
    expect(one.v.sections!.independent).toHaveLength(1);
    expect(one.v.sections!.independent[0]).toMatchObject({ pipe: null, index: 0, heading: HEADING });
    expect(field(secBlock(one.v.sections!.independent[0]), "pipe_size_mm")).toMatchObject({ typedValue: "15.875", mirrorTag: "from pipe" });
    const yes = compute(PIP, applyItemEdit(one.v.editState, { op: "set_attr", index: 0, id: "insulated", value: "Yes" }));
    expect(yes.v.items[0].sections).toHaveLength(1);                 // an attached section appears
    expect(yes.v.sections!.independent).toHaveLength(1);             // and the independent one stays
    const no = compute(PIP, applyItemEdit(yes.v.editState, { op: "set_attr", index: 0, id: "insulated", value: "No", dropSection: SEC }));
    expect(no.v.items[0].sections).toBeUndefined();
    expect(no.v.sections!.independent).toHaveLength(1);
    const gone = compute(PIP, applyItemEdit(no.v.editState, { op: "remove_section", section: SEC, index: 0 }));
    expect(gone.v.sections!.independent).toHaveLength(0);
  });
  it("removing the pipe leaves the independent insulation alone on the row, priced, as the total", () => {
    const state: ItemListEditState = { items: [pipe("Copper", '5/8"')], sections: { [SEC]: [ins(NITRILE, { ...BARE, pipe_size_mm: "15.88" })] } };
    const r = compute(PIP, applyItemEdit(compute(PIP, state).v.editState, { op: "remove", index: 0 }));
    expect(r.v.items).toHaveLength(0);
    expect(r.values).toEqual({ supply_rate: 216, install_rate: 14, combined_rate: 230 });
  });
  it("the buttons: Piping names 'Add pipe' and offers 'Add insulation' with the two families, on every state", () => {
    const states: ItemListEditState[] = [
      { items: [] },
      { items: [pipe("Copper", '5/8"')] },
      insulated("Copper", '5/8"', ins(NITRILE, BARE)),
      insulated("MS", "100", ins(NITRILE, { cladding: "26G Aluminium", thickness_mm: "32" })),
    ];
    for (const st of states) {
      const { v } = compute(PIP, st);
      expect(v.sections!.addLabel).toBe("Add pipe");
      expect(v.sections!.adds).toEqual([{ id: "insulation", addLabel: "Add insulation",
        families: [{ family: NITRILE, units: "per metre" }, { family: PUF, units: "per metre" }] }]);
    }
  });
  it("NEGATIVE: Insulation and ADP views carry no `sections`, so the panel draws their '+ Add item' and their own total as before", () => {
    const insView = insCalc(NITRILE, { cladding: "No", thickness_mm: "13", pipe_size_mm: "15.875" }).v;
    const adpView = compute(ADP, { items: [{ base: null, family: "fire damper", attrs: {} }] }, {}, "sqm").v;
    for (const v of [insView, adpView]) {
      expect("sections" in v).toBe(false);
      expect(v.items.every((b) => !("sections" in b))).toBe(true);
      expect(v.items.every((b) => b.fields.every((f) => f.gate === undefined && f.mirrorTag === undefined && f.mirrorLine === undefined))).toBe(true);
      expect("sections" in v.editState).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3a -- the edit state: section edits ride with their pipe, old states decode unchanged", () => {
  it("a state written before sections existed decodes exactly as it did", () => {
    const raw = JSON.stringify({ items: [{ base: null, family: "Copper", attrs: { size_mm: "15.9" } }] });
    expect(decodeItemEdits(raw, 0)).toEqual({ items: [{ base: null, family: "Copper", attrs: { size_mm: "15.9" } }] });
    expect(decodeItemEdits(undefined, 2)).toEqual({ items: [{ base: 0, family: null, attrs: {} }, { base: 1, family: null, attrs: {} }] });
  });
  it("attached and independent section edits survive a round trip; a section edit's `base` is checked against ITS model items", () => {
    const st: ItemListEditState = { items: [pipe("Copper", '5/8"', { insulated: "Yes" }, { [SEC]: { base: 1, family: null, attrs: { cladding: "No" }, other: ["pipe_size_mm"] } })],
                                    sections: { [SEC]: [{ base: null, family: NITRILE, attrs: {}, qty: "2" }] } };
    expect(decodeItemEdits(JSON.stringify(st), 0, { [SEC]: 2 })).toEqual(st);
    expect(decodeItemEdits(JSON.stringify(st), 0, { [SEC]: 1 }).items[0].sections![SEC].base).toBeNull();
  });
  it("every item operation keeps the independent sections; a section operation touches that one section only", () => {
    const st: ItemListEditState = { items: [pipe("Copper", '5/8"', { insulated: "Yes" }, { [SEC]: ins(null) }), pipe("MS", "100")],
                                    sections: { [SEC]: [ins(NITRILE), ins(PUF)] } };
    for (const op of [{ op: "set_qty", index: 1, qty: "2" }, { op: "add", family: "PVC" }, { op: "remove", index: 1 },
                      { op: "set_attr", index: 1, id: "size_mm", value: "80" }, { op: "undo_attr", index: 1, id: "size_mm" }] as ItemEditOp[]) {
      expect(applyItemEdit(st, op).sections).toEqual(st.sections);
    }
    const a = applyItemEdit(st, inSection({ op: "set_attr", index: 0, id: "cladding", value: "No" }, null, 1));
    expect(a.sections![SEC]).toEqual([ins(NITRILE), ins(PUF, { cladding: "No" })]);
    expect(a.items).toEqual(st.items);
    const b = applyItemEdit(st, inSection({ op: "change_family", index: 0, family: PUF }));
    expect(b.items[0].sections![SEC]).toEqual({ base: null, family: PUF, attrs: {} });
    expect(b.sections).toEqual(st.sections);
    // NEGATIVE: an operation aimed at a section that does not exist changes nothing
    expect(applyItemEdit(st, inSection({ op: "set_qty", index: 0, qty: "3" }, 1))).toBe(st);
    expect(applyItemEdit(st, { op: "remove_section", section: SEC, index: 5 })).toBe(st);
  });
  it("what is on screen at Use records every line: the pipe, its section, then the independent ones", () => {
    const state: ItemListEditState = { ...insulated("Copper", '5/8"', ins(NITRILE, { cladding: "No", thickness_mm: "13" })),
                                       sections: { [SEC]: [ins(PUF, { cladding: "No", thickness_mm: "25", pipe_size_mm: "25" })] } };
    const rec = itemsOnScreen(compute(PIP, state).v);
    expect(rec.map((r) => r.family)).toEqual(["Copper", NITRILE, PUF]);
    expect(rec[0].attributes.insulated).toBe("Yes");
    expect(rec[1].attributes.pipe_size_mm).toBe("15.88");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * AC8 PARITY -- EVERY Nitrile Rubber / Tubular Puf SKU of the asset x THREE pipe sizes, named in each test:
 *   exact     the SKU's own pipe size;
 *   laddered  a size just below it (Insulation's own ladder / precision match decides where it lands);
 *   refused   a size above the family's largest.
 * The pipe is an MS pipe typed that size (it may itself refuse -- the section prices on its own); the section is
 * compared with Calculator -> Insulation for the same material, cladding, thickness and that pipe size typed:
 * figures, state, reason, the SKU line, every working line and every field -- the mirrored field's lead excepted,
 * BY NAME: `userEdited`, `mirrorTag` and the "From pipe:" lead of its note / working line.
 *
 * INVERTED at 12e-4d (owner, 2026-10-14: "fix"; AC2) for ONE named case: the MS pipe REFUSES ON ITS SIZE -- a bare
 * number below MS's smallest size that could be inches ("6.35", "5.95": "size 6.35 has no unit - price this row by
 * hand"). BEFORE: the section priced the bare number as millimetres, exactly as Calculator -> Insulation does (the
 * comparison below). AFTER: the section refuses with the pipe's own sentence and shows no figure -- and the SAME size
 * typed in the section's own box prices exactly as Calculator -> Insulation (owner: "the user can change it"). Every
 * other comparison is unchanged; both halves are counted.
 */
const SECTION_SKUS = ITEMS.filter((it) => it.kind === "hvac_insulation_item" && [NITRILE, PUF].includes(String(it.attributes?.item)));
const LARGEST: Record<string, number> = Object.fromEntries([NITRILE, PUF].map((fam) =>
  [fam, Math.max(...SECTION_SKUS.filter((it) => it.attributes?.item === fam).map((it) => Number(it.attributes?.pipe_size_mm)))]));
const num = (n: number) => String(Number(n.toFixed(4)));
/** 12e-4d (AC2): how many of the 612 comparisons type an MS pipe size that refuses on its unit (measured, pinned). */
const REFUSED_BY_PIPE_12E4D = 48;

describe("12e-3a AC8 -- parity: the Piping section == Calculator -> Insulation, every pipe-insulation SKU x three pipe sizes", () => {
  it("the sweep covers every Nitrile Rubber (168) and Tubular Puf (36) SKU of v37 -- 204 SKUs, 612 comparisons", () => {
    expect(SECTION_SKUS.filter((it) => it.attributes?.item === NITRILE)).toHaveLength(168);
    expect(SECTION_SKUS.filter((it) => it.attributes?.item === PUF)).toHaveLength(36);
    expect(LARGEST).toEqual({ [NITRILE]: 53.98, [PUF]: 300 });
  });
  let compared = 0;
  let refusedByPipe = 0;
  for (const sku of SECTION_SKUS) {
    const fam = String(sku.attributes!.item), cladding = String(sku.attributes!.cladding);
    const thickness = num(Number(sku.attributes!.thickness_mm)), size = Number(sku.attributes!.pipe_size_mm);
    const sizes = { exact: num(size), laddered: num(size - 0.4), refused: num(LARGEST[fam] + 50) };
    it(`${fam} | ${cladding} | ${thickness} mm | pipe ${sizes.exact} (exact), ${sizes.laddered} (laddered), ${sizes.refused} (refused)`, () => {
      for (const [kind, typed] of Object.entries(sizes)) {
        const picks = { cladding, thickness_mm: thickness };
        const whole = compute(PIP, insulated("MS", typed, ins(fam, picks))).v;
        const sv = attached(whole);
        const own = insCalc(fam, { ...picks, pipe_size_mm: typed });
        // 12e-6 AC9 b INVERTED by mechanical authority: BEFORE only the no-unit refusal (12e-4d AC2) took this branch; an MS
        // pipe ABOVE ITS LARGEST size (the 350 of the PUF sweep) now joins it -- the section repeats the pipe's sentence
        const pipeSaid = whole.items[0].reason;
        if (pipeSaid === noUnitMessage(typed) || (pipeSaid ?? "").startsWith(`pipe size ${typed} is above the largest size on the sheet`)) {
          // the AC2 half: the section refuses with the pipe's sentence, no figure anywhere on it
          const a = secBlock(sv);
          expect({ kind, priced: sv.view.rowPriced, reason: sv.view.reason, totals: sv.view.totals, state: a.state, blockReason: a.reason, figures: a.figures })
            .toEqual({ kind, priced: false, reason: pipeSaid, totals: undefined, state: "blank", blockReason: pipeSaid, figures: {} });
          expect(field(a, "pipe_size_mm"), kind).toMatchObject({ mirrorTag: "from pipe", value: "", note: `From pipe: ${pipeSaid}` });
          // ... and the pricer's own size in the section's box prices it exactly as Calculator -> Insulation
          const typedHere = attached(compute(PIP, insulated("MS", typed, ins(fam, { ...picks, pipe_size_mm: typed }, ["pipe_size_mm"]))).v);
          expect([typedHere.view.rowPriced, typedHere.view.totals], kind).toEqual([own.v.rowPriced, own.v.totals]);
          refusedByPipe++;
          compared++;
          continue;
        }
        const a = secBlock(sv), b = own.v.items[0];
        expect(field(a, "pipe_size_mm").mirrorTag, kind).toBe("from pipe");
        expect(sv.view.rowPriced, kind).toBe(own.v.rowPriced);
        expect(sv.view.totals, kind).toEqual(own.v.totals);
        expect(sv.view.reason, kind).toBe(own.v.reason);
        expect([a.state, a.reason, a.skuLine, a.figures, a.family, a.qty], kind).toEqual([b.state, b.reason, b.skuLine, b.figures, b.family, b.qty]);
        // the named exception: the mirrored field's lead
        expect(a.working, kind).toEqual(b.working.map((w) => mirroredLead(w, "from pipe")));
        expect(a.fields.map((f) => f.id), kind).toEqual(b.fields.map((f) => f.id));
        for (const f of b.fields) {
          const g = field(a, f.id);
          if (f.id !== "pipe_size_mm") { expect(g, `${kind} ${f.id}`).toEqual(f); continue; }
          const { userEdited: _u, mirrorTag: _t, note: gNote, ...gRest } = g;
          const { userEdited: _v, note: fNote, ...fRest } = f;
          expect(gRest, `${kind} pipe size`).toEqual(fRest);
          expect(gNote, `${kind} pipe size line`).toBe(fNote === undefined ? undefined : mirroredLead(fNote, "from pipe"));
        }
        if (kind === "exact") expect(own.v.rowPriced, "the SKU's own size prices").toBe(true);
        if (kind === "refused") expect(a.reason, kind).toBe(`pipe size ${typed} is above the largest size on the sheet (${num(LARGEST[fam])})`);
        compared++;
      }
    });
  }
  it("the count: 612 comparisons ran, none skipped", () => {
    expect(compared).toBe(SECTION_SKUS.length * 3);
    expect(compared).toBe(612);
    // 12e-4d (AC2): the comparisons where the MS pipe refused on its size, named above, and counted
    // 12e-6 AC9 b: BEFORE `toBe(REFUSED_BY_PIPE_12E4D)` (48); the 36 Tubular PUF "refused" sizes (an MS pipe above its largest) join it
    expect(refusedByPipe).toBe(REFUSED_BY_PIPE_12E4D + 36);
  });
});
