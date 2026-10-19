/**
 * SLICE 12e-3c (owner rulings F4 / F7 / F10 / F11 / F12, 2026-10-12) -- PIPING CLEANUP. No asset and no config
 * changes. Every rule is tested from the PANEL'S ENTRY POINT (`makePricingSheetHelper(...).compute`) on the v37
 * asset, read at runtime, and every figure is checked against the PURE pricer over the same inputs.
 *
 *   AC0 (F10)  an insulation section under a pipe takes the pipe's quantity, tagged "from pipe", and follows it
 *              until the pricer types their own; a section that belongs to no pipe keeps its own box.
 *   AC1 (F4)   in the calculator a choice the pricer has not made says "pick a cladding"; a BoQ row keeps
 *              "could not tell cladding".
 *   AC2 (F7)   no field id written with an underscore reaches a line a pricer reads.
 *   AC4 (F11)  a field marked "default" always shows its value.
 *   AC5 (F12)  the calculator's "Insulated: No" nobody picked carries the amber default tag.
 *   AC6        the Derivation tab says the quantity rule, generated from the config.
 *
 * What each block protects is said in its `describe`. Negative halves sit beside every positive.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { itemListRuleOrder as itemListRuleOrderLive } from "@/pages/pricing/rate-master/itemListRuleOrder";
// SLICE 12e-6 (AC14 / U9) INVERTED by mechanical authority: BEFORE every tab read below called `itemListRuleOrder` directly.
// 12e-6 ADDS ten lines (owner 2026-10-16 14:49, condition (a): every existing line keeps its words and order); this file's
// pins read the tab WITHOUT them, renumbered -- so each pin still proves the old lines unchanged. The new lines are pinned
// in ruleReachability.test.ts and slice12e6.test.ts.
const ADDED_12E6: readonly RegExp[] = [
  /^A '.*' answer where the BoQ names no material takes the kind its row implies$/, /^A material written with an alternative prices the stocked one$/,
  /^Cross-linked polyethylene, XPE, FR-XPE and a co-extruded jacket or covering are XLPE and refuse by name$/,
  /^A row-kind material on the other row kind prices as the one for the row's unit$/, / range takes the higher value$/,
  / in mm or NB is one size: the cladding is measured on the matched size$/, /^Fixings and duct material in the row are not a /,
  / written as a coating with no glass cloth refuses by name$/, / written as two stocked kinds prices one of them$/,
  / with no .* facts opens the .* section on .*'s defaults$/,
];
const itemListRuleOrder = (...a: Parameters<typeof itemListRuleOrderLive>) =>
  itemListRuleOrderLive(...a).filter((l) => !ADDED_12E6.some((re) => re.test(l.title))).map((l, i) => ({ ...l, n: i + 1 }));
import { labelAsWord, plainPricerText } from "@/pages/pricing/rate-master/plainEnglish";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, assembleItems, decodeItemEdits, makePricingSheetHelper, unitChoicesOf,
  type ItemBlockView, type ItemEdit, type ItemEditOp, type ItemFieldView, type ItemListEditState, type ItemListSuggestion, type ItemListView,
  type SectionBlockView,
} from "./pricingSheetHelper";
import { familyAttr, itemListPricingSpec, listSpecDefs, priceItemList } from "./itemListPricing";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const ASSET = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v37.json`, import.meta.url));
const CFG: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET.category_configs.map((c) => [c.category_id, c]));
const CONFIGS = new Map<string, RateCategoryConfig>(Object.entries(CFG));
const ITEMS: RateMasterItem[] = ASSET.items.map((it) => ({ ...it, discipline: ASSET.discipline } as RateMasterItem));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const ITEM_LIST = [INS, ADP, PIP] as const;
const KINDS = ["supply_rate", "install_rate", "combined_rate"] as const;
const NITRILE = "Nitrile Rubber Insulation", PUF = "Tubular Puf Insulation";
const SEC = "insulation";

const cells = (a: Record<string, string>): ExtractionRow["attributes"] =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));

/** The CALCULATOR path: an empty extraction map; the whole edit state is the override; the unit is a pick. */
function compute(category: string, state: ItemListEditState, unit = "mts") {
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
  const ctx: RateHelperRowContext = { excelRow: 1, description: "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS] };
  const r = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: unit });
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, values: s.values };
}
/** The BoQ-ROW (panel) path: the model's stored answer through `extractionByRow`, the row's own unit. */
function panel(category: string, answer: Array<Record<string, string>>, state?: ItemListEditState, unit = "Rmt") {
  const row = { excelRow: 1, description: "", attributes: {}, items: answer.map(({ section, ...a }) => ({ attributes: cells(a), ...(section ? { section } : {}) })) } as ExtractionRow;   // 12e-4b (owner D-2): an insulation answer carries the marker the run stores, on the ITEM
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
  const ctx: RateHelperRowContext & { unit?: string } = { excelRow: 1, description: "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS], unit };
  const r = h.compute(ctx, state ? { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state) } : {});
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
const attached = (v: ItemListView, pipe = 0): SectionBlockView => v.items[pipe].sections![0];
const secBlock = (sv: SectionBlockView): ItemBlockView => sv.view.items[0];
const pipe = (family: string, size: string, more: Record<string, string> = {}, sections?: Record<string, ItemEdit>, qty?: string): ItemEdit =>
  ({ base: null, family, attrs: { size_mm: size, ...more }, other: ["size_mm"], ...(sections ? { sections } : {}), ...(qty !== undefined ? { qty } : {}) });
const ins = (family: string | null, attrs: Record<string, string> = {}, qty?: string): ItemEdit => ({ base: null, family, attrs, ...(qty !== undefined ? { qty } : {}) });
const inSection = (inner: ItemEditOp, pipeIndex: number | null = 0, index = 0): ItemEditOp => ({ op: "section", section: SEC, pipe: pipeIndex, index, inner });
/** Every display string of a view, sections included: reasons, lines, notes, rules. */
function shown(v: ItemListView, s?: ItemListSuggestion): string[] {
  const out: string[] = [];
  if (v.reason) out.push(v.reason);
  if (v.unitNote) out.push(v.unitNote);
  if (s) out.push(...(s.workings.derivation ?? []), s.basis ?? "");
  const blockOf = (b: ItemBlockView) => {
    if (b.reason) out.push(b.reason);
    if (b.skuLine) out.push(b.skuLine);
    if (b.familyDefaulted) out.push(b.familyDefaulted.rule);
    if (b.familyLine) out.push(b.familyLine);
    out.push(...b.working);
    for (const f of b.fields) { if (f.rule) out.push(f.rule); if (f.note) out.push(f.note); if (f.mirrorLine) out.push(f.mirrorLine); out.push(...(f.matchHelp ?? [])); }
    for (const sv of b.sections ?? []) { if (sv.view.reason) out.push(sv.view.reason); sv.view.items.forEach(blockOf); }
  };
  v.items.forEach(blockOf);
  for (const sv of v.sections?.independent ?? []) { if (sv.view.reason) out.push(sv.view.reason); sv.view.items.forEach(blockOf); }
  return out;
}
/** Every block of a view, sections included. */
function blocks(v: ItemListView): ItemBlockView[] {
  return [...v.items.flatMap((b) => [b, ...(b.sections ?? []).flatMap((sv) => sv.view.items)]), ...(v.sections?.independent ?? []).flatMap((sv) => sv.view.items)];
}
/** What a field's control puts on screen: the select's matching option, the "Other..." box, or the plain box. */
function onScreen(f: ItemFieldView): string {
  if (!f.options) return f.value;
  if (f.allowOther && f.otherMode) return f.typedValue;
  return f.options.includes(f.value) ? f.value : "";
}
const SNAKE = /(?<![A-Za-z0-9_])[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+(?![A-Za-z0-9_])/;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3c AC0 (F10) -- an insulation section under a pipe takes the pipe's quantity and follows it until typed", () => {
  const SECTION = ins(NITRILE, { cladding: "26G Aluminium", thickness_mm: "13" });
  const start = (pipeQty: string | undefined, sectionQty?: string): ItemListEditState =>
    ({ items: [pipe("MS", "32", { insulated: "Yes" }, { [SEC]: { ...SECTION, ...(sectionQty !== undefined ? { qty: sectionQty } : {}) } }, pipeQty)] });
  const INS_AT = (qty: string): ItemEdit => ({ base: null, family: NITRILE, attrs: { cladding: "26G Aluminium", thickness_mm: "13", pipe_size_mm: "32" }, other: ["pipe_size_mm"], qty });
  const PIPE_AT = (qty: string): ItemEdit => ({ base: null, family: "MS", attrs: { size_mm: "32" }, other: ["size_mm"], qty });

  it("the owner's walk: pipe 2 -> section 2 'from pipe'; pipe 3 -> section 3; type 1 in the section -> tag gone; pipe 4 -> section stays 1; total = pipe at 4 + insulation at 1, each the pure pricer's", () => {
    let r = compute(PIP, start("2"));
    let b = secBlock(attached(r.v));
    expect({ qty: b.qty, tag: b.qtyMirrorTag, amber: b.qtyDefaulted }).toEqual({ qty: "2", tag: "from pipe", amber: false });
    expect(fig(b.figures)).toEqual(pure(INS, INS_AT("2")));
    expect(fig(r.v.items[0].figures)).toEqual(pure(PIP, PIPE_AT("2")));

    r = compute(PIP, applyItemEdit(r.v.editState, { op: "set_qty", index: 0, qty: "3" }));
    b = secBlock(attached(r.v));
    expect({ qty: b.qty, tag: b.qtyMirrorTag }).toEqual({ qty: "3", tag: "from pipe" });
    expect(fig(b.figures)).toEqual(pure(INS, INS_AT("3")));

    r = compute(PIP, applyItemEdit(r.v.editState, inSection({ op: "set_qty", index: 0, qty: "1" })));
    b = secBlock(attached(r.v));
    expect({ qty: b.qty, tag: b.qtyMirrorTag, amber: b.qtyDefaulted }).toEqual({ qty: "1", tag: undefined, amber: false });

    r = compute(PIP, applyItemEdit(r.v.editState, { op: "set_qty", index: 0, qty: "4" }));
    b = secBlock(attached(r.v));
    expect({ pipeQty: r.v.items[0].qty, sectionQty: b.qty, tag: b.qtyMirrorTag }).toEqual({ pipeQty: "4", sectionQty: "1", tag: undefined });
    const p = pure(PIP, PIPE_AT("4")), i = pure(INS, INS_AT("1"));
    expect(fig(r.v.items[0].figures)).toEqual(p);
    expect(fig(b.figures)).toEqual(i);
    expect(r.v.rowPriced).toBe(true);
    expect(r.values).toEqual({ supply_rate: p[0]! + i[0]!, install_rate: p[1]! + i[1]!, combined_rate: p[0]! + i[0]! + p[1]! + i[1]! });
    // each line is rounded by its own rules: the pipe at 4 is not 4 x the pipe at 1 by accident of the test
    expect(p).not.toEqual(pure(PIP, PIPE_AT("1")));
  });
  it("the figures of the walk, by number: MS 32 is 600 / 175 per metre, so 2 400 / 700 at 4; the insulation at 1 is its own calculator's", () => {
    expect(pure(PIP, PIPE_AT("1"))).toEqual([600, 175]);
    expect(pure(PIP, PIPE_AT("4"))).toEqual([2400, 700]);
    const own = compute(INS, { items: [INS_AT("1")] });
    expect(fig(own.values)).toEqual(pure(INS, INS_AT("1")));
  });
  it("the pipe's quantity nobody typed (the amber 1) is followed too: the section shows 1, tagged 'from pipe', and is NOT amber", () => {
    const { v } = compute(PIP, start(undefined));
    expect({ qty: v.items[0].qty, amber: v.items[0].qtyDefaulted }).toEqual({ qty: "1", amber: true });
    const b = secBlock(attached(v));
    expect({ qty: b.qty, tag: b.qtyMirrorTag, amber: b.qtyDefaulted }).toEqual({ qty: "1", tag: "from pipe", amber: false });
  });
  it("the section's own value stays even when it equals the pipe's later, and the link is the quantity it enters Insulation with", () => {
    const typed = compute(PIP, start("3", "3"));
    expect(secBlock(attached(typed.v)).qtyMirrorTag).toBeUndefined();
    const linked = compute(PIP, start("3"));
    expect(fig(secBlock(attached(linked.v)).figures)).toEqual(fig(secBlock(attached(typed.v)).figures));
    expect(secBlock(attached(linked.v)).working).toEqual(secBlock(attached(typed.v)).working);
  });
  it("ON THE BoQ-ROW PATH the same link: the pricer's pipe quantity reaches the model's insulation; a count the MODEL read on the insulation item does not break it (owner: 'The pipe's')", () => {
    const answer: Array<Record<string, string>> = [{ pipe_type: "MS", size_mm: "32" }, { section: SEC, item: NITRILE, cladding: "26G Aluminium", thickness_mm: "13", qty_per_row_unit: "5" }];
    const first = panel(PIP, answer);
    let b = secBlock(attached(first.v));
    expect({ qty: b.qty, tag: b.qtyMirrorTag }).toEqual({ qty: "1", tag: "from pipe" });
    const two = panel(PIP, answer, applyItemEdit(first.v.editState, { op: "set_qty", index: 0, qty: "2" }));
    b = secBlock(attached(two.v));
    expect({ qty: b.qty, tag: b.qtyMirrorTag }).toEqual({ qty: "2", tag: "from pipe" });
    expect(fig(b.figures)).toEqual(pure(INS, INS_AT("2"), "Rmt"));
    const own = panel(PIP, answer, applyItemEdit(two.v.editState, inSection({ op: "set_qty", index: 0, qty: "1" })));
    b = secBlock(attached(own.v));
    expect({ qty: b.qty, tag: b.qtyMirrorTag }).toEqual({ qty: "1", tag: undefined });
    const p = pure(PIP, PIPE_AT("2"), "Rmt"), i = pure(INS, INS_AT("1"), "Rmt");
    expect(own.values).toEqual({ supply_rate: p[0]! + i[0]!, install_rate: p[1]! + i[1]!, combined_rate: p[0]! + i[0]! + p[1]! + i[1]! });
  });
  it("NEGATIVE: a section that belongs to NO pipe keeps its own box -- 1, amber, no tag -- and does not move with the pipe", () => {
    const state: ItemListEditState = { items: [pipe("MS", "32", {}, undefined, "3")], sections: { [SEC]: [ins(PUF, { cladding: "No", thickness_mm: "25" })] } };
    const { v } = compute(PIP, state);
    const b = secBlock(v.sections!.independent[0]);
    expect({ qty: b.qty, tag: b.qtyMirrorTag, amber: b.qtyDefaulted }).toEqual({ qty: "1", tag: undefined, amber: true });
    const moved = compute(PIP, applyItemEdit(v.editState, { op: "set_qty", index: 0, qty: "7" }));
    expect(secBlock(moved.v.sections!.independent[0]).qty).toBe("1");
  });
  it("NEGATIVE: each pipe's section follows ITS OWN pipe; Calculator -> Insulation and ADP carry no such tag", () => {
    const state: ItemListEditState = { items: [pipe("MS", "32", { insulated: "Yes" }, { [SEC]: SECTION }, "2"), pipe("MS", "50", { insulated: "Yes" }, { [SEC]: SECTION }, "5")] };
    const { v } = compute(PIP, state);
    expect([secBlock(attached(v, 0)).qty, secBlock(attached(v, 1)).qty]).toEqual(["2", "5"]);
    expect(compute(INS, { items: [INS_AT("2")] }).v.items[0].qtyMirrorTag).toBeUndefined();
    expect(compute(ADP, { items: [{ base: null, family: "fire damper", attrs: { size_mm: "600x600" } }] }, "nos").v.items[0].qtyMirrorTag).toBeUndefined();
  });
  it("NEGATIVE: a pipe quantity that cannot price is followed as it stands -- the section refuses for the quantity, never a silent 1", () => {
    const { v } = compute(PIP, start("0"));
    expect(secBlock(attached(v)).qty).toBe("0");
    expect(secBlock(attached(v)).state).toBe("blank");
    expect(v.rowPriced).toBe(false);
  });
  it("the panel draws the tag from the view, beside the box's label", () => {
    const src = readFileSync(join(__dirname, "RateHelperPanel.tsx"), "utf-8");
    expect(src).toContain('data-testid="item-qty-mirror-tag"');
    expect(src).toContain("{b.qtyMirrorTag}");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3c AC1 (F4) -- in the calculator an unfilled choice says 'pick a cladding'; a BoQ row keeps 'could not tell cladding'", () => {
  it("Calculator -> Piping, Insulated Yes, Nitrile, cladding left blank: the section says 'pick a cladding'", () => {
    const { v } = compute(PIP, { items: [pipe("MS", "32", { insulated: "Yes" }, { [SEC]: ins(NITRILE) })] });
    const sv = attached(v);
    expect(secBlock(sv).reason).toBe("pick a cladding");
    expect(sv.view.reason).toBe("pick a cladding");
    expect(v.reason).toBe("pick a cladding");
    expect(shown(v).join("\n")).not.toContain("could not tell");
  });
  it("Calculator -> Insulation, Nitrile, cladding left blank: the same sentence", () => {
    const { v, s } = compute(INS, { items: [{ base: null, family: NITRILE, attrs: {} }] });
    expect(v.items[0].reason).toBe("pick a cladding");
    expect(v.reason).toBe("pick a cladding");
    expect(s.workings.derivation).toEqual(["pick a cladding"]);
  });
  it("the sentence sits where its neighbours sit: lower case, no full stop, after 'Not priced -' on screen, like 'no pipe size stated'", () => {
    const noSize = compute(PIP, { items: [{ base: null, family: "MS", attrs: {} }] }).v.items[0].reason;
    expect(noSize).toBe("no pipe size stated");
    expect("pick a cladding").toMatch(/^[a-z][a-z ]+[a-z]$/);
  });
  it("NEGATIVE: a MODEL-READ BoQ row keeps the existing wording, on Insulation and in a Piping section", () => {
    const own = panel(INS, [{ item: NITRILE, thickness_mm: "13", pipe_size_mm: "50" }]);
    expect(own.v.items[0].reason).toBe("could not tell cladding");
    const sec = panel(PIP, [{ pipe_type: "MS", size_mm: "32" }, { section: SEC, item: NITRILE, thickness_mm: "13" }]);
    expect(secBlock(attached(sec.v)).reason).toBe("could not tell cladding");
    expect(shown(sec.v).join("\n")).not.toContain("pick a");
  });
  it("NEGATIVE: an item the pricer adds on a BoQ row keeps the BoQ row's wording (the ruling is about the calculator)", () => {
    const first = panel(INS, [{ item: NITRILE, cladding: "No", thickness_mm: "13", pipe_size_mm: "50" }]);
    const added = panel(INS, [{ item: NITRILE, cladding: "No", thickness_mm: "13", pipe_size_mm: "50" }], applyItemEdit(first.v.editState, { op: "add", family: PUF }));
    expect(added.v.items[1].reason).toBe("could not tell cladding");
  });
  it("THE SWEEP, named: every kind of Insulation, ADP and Piping, added in the calculator with nothing filled, in every unit its picker offers -- the only 'pick' sentence is cladding's and no 'could not tell' is left", () => {
    const picks = new Map<string, Set<string>>();
    const tells: string[] = [];
    const covered: string[] = [];
    for (const cat of ITEM_LIST) {
      const spec = itemListPricingSpec(CFG[cat])!;
      for (const family of Object.keys(spec.families)) {
        for (const unit of unitChoicesOf(spec, [family])) {
          covered.push(`${cat} / ${family.trim()} / ${unit}`);
          const { v, s } = compute(cat, { items: [{ base: null, family, attrs: {} }] }, unit);
          for (const line of shown(v, s)) {
            if (/could not tell/.test(line)) tells.push(`${cat} / ${family} / ${unit}: ${line}`);
            const m = line.match(/\bpick an? [a-z][a-z ]*/i);
            if (m) { if (!picks.has(m[0])) picks.set(m[0], new Set()); picks.get(m[0])!.add(cat); }
          }
        }
      }
    }
    expect(tells).toEqual([]);
    expect([...picks.keys()]).toEqual(["pick a cladding"]);
    expect([...picks.get("pick a cladding")!]).toEqual([INS]);
    // what was covered, by name: every kind of the three categories
    expect(new Set(covered.map((c) => c.split(" / ")[0]))).toEqual(new Set(ITEM_LIST));
    expect(covered.length).toBe(ITEM_LIST.reduce((n, cat) => n + Object.keys(itemListPricingSpec(CFG[cat])!.families).reduce((m, f) => m + unitChoicesOf(itemListPricingSpec(CFG[cat])!, [f]).length, 0), 0));
    expect(covered.length).toBeGreaterThan(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3c AC2 (F7) -- no field id written with an underscore reaches a line a pricer reads", () => {
  it("the cause, fixed: Insulation's default line reads 'thickness not mentioned -> 9 (...)', never 'thickness_mm ...'", () => {
    const { v } = compute(INS, { items: [{ base: null, family: NITRILE, attrs: { cladding: "26G Aluminium", pipe_size_mm: "50" }, other: ["pipe_size_mm"] }] });
    expect(fig(v.totals)).toEqual([556, 224]);
    // INVERTED at 12e-4b (owner G2: no working line repeats itself). BEFORE:
    //   expect(v.items[0].working).toContain("thickness not mentioned -> 9 (thickness not mentioned -> 9 mm, then the ladder)");
    expect(v.items[0].working).toContain("thickness not mentioned -> 9 mm, then the ladder");
    expect(v.items[0].working.filter((w) => w.split("not mentioned").length > 2)).toEqual([]);
    expect(v.items[0].working.join("\n")).not.toContain("thickness_mm");
  });
  it("the word is the field's OWN label from the config, never a word list: a relabelled field reads by its new label", () => {
    expect(plainPricerText("thickness_mm not mentioned -> 9", [], { thickness_mm: "Thickness (mm)" })).toBe("thickness not mentioned -> 9");
    expect(plainPricerText("thickness_mm not mentioned -> 9", [], { thickness_mm: "Wall (mm)" })).toBe("wall not mentioned -> 9");
    expect(plainPricerText("insulation_thickness_mm 25 and thickness_mm 9", [], { thickness_mm: "Thickness (mm)", insulation_thickness_mm: "Insulation thickness (mm)" }))
      .toBe("insulation thickness 25 and thickness 9");
    expect(labelAsWord("UL listed")).toBe("UL listed");
    expect(labelAsWord("Pipe size (mm)")).toBe("pipe size");
    const defs = Object.fromEntries(listSpecDefs(CFG[INS]).map((d) => [d.id, String(d.label)]));
    expect(labelAsWord(defs.thickness_mm)).toBe("thickness");
  });
  it("NEGATIVE: with no labels the line is untouched; an id with no underscore is a word and is left; a longer token is not cut", () => {
    expect(plainPricerText("thickness_mm not mentioned -> 9")).toBe("thickness_mm not mentioned -> 9");
    // INVERTED at 12e-4b (owner G3: "item" at the START of a default's line is the field, and reads as its label).
    // BEFORE: expect(plainPricerText("item not mentioned -> Nitrile", [], { item: "Insulation material" })).toBe("item not mentioned -> Nitrile");
    expect(plainPricerText("item not mentioned -> Nitrile", [], { item: "Insulation material" })).toBe("insulation material not mentioned -> Nitrile");
    // NEGATIVE HALF KEPT: anywhere else an id with no underscore is a word and is left
    expect(plainPricerText("this item not mentioned -> Nitrile", [], { item: "Insulation material" })).toBe("this item not mentioned -> Nitrile");
    expect(plainPricerText("item mentioned twice", [], { item: "Insulation material" })).toBe("item mentioned twice");
    expect(plainPricerText("my_thickness_mm_x stays", [], { thickness_mm: "Thickness (mm)" })).toBe("my_thickness_mm_x stays");
    expect(plainPricerText("item supply: ROUNDUP(supply, 0)", [], { thickness_mm: "Thickness (mm)" })).toBe("item supply: ROUNDUP(supply, 0)");
  });
  it("THE SWEEP, named: every kind of Insulation, ADP and Piping in every unit, in the calculator and on a BoQ row, nothing filled and with every default firing -- no line holds an underscore token", () => {
    const hits: string[] = [];
    let lines = 0;
    for (const cat of ITEM_LIST) {
      const spec = itemListPricingSpec(CFG[cat])!;
      const fam = familyAttr(spec);
      for (const family of Object.keys(spec.families)) {
        for (const unit of unitChoicesOf(spec, [family])) {
          const runs = [
            compute(cat, { items: [{ base: null, family, attrs: {} }] }, unit),
            panel(cat, [{ [fam]: family }], undefined, unit),
            panel(cat, [{ [fam]: family, ...Object.fromEntries(listSpecDefs(CFG[cat]).filter((d) => d.id !== fam).map((d) => [d.id, "None"])) }], undefined, unit),
          ];
          for (const r of runs) for (const line of shown(r.v, r.s)) { lines++; if (SNAKE.test(line)) hits.push(`${cat} / ${family} / ${unit}: ${line}`); }
        }
      }
    }
    expect(hits).toEqual([]);
    expect(lines).toBeGreaterThan(1000);
  });
  it("the Piping section's lines are Insulation's, cleaned by Insulation's own labels", () => {
    const { v } = compute(PIP, { items: [pipe("MS", "32", { insulated: "Yes" }, { [SEC]: ins(NITRILE, { cladding: "26G Aluminium" }) })] });
    const w = secBlock(attached(v)).working;
    // INVERTED at 12e-4b (owner G2). BEFORE: expect(w).toContain("thickness not mentioned -> 9 (thickness not mentioned -> 9 mm, then the ladder)");
    expect(w).toContain("thickness not mentioned -> 9 mm, then the ladder");
    expect(shown(v).filter((l) => SNAKE.test(l))).toEqual([]);
  });
  it("NEGATIVE: the PURE pricer still writes the id (the label is applied where the view is built, by the one function)", () => {
    const spec = itemListPricingSpec(CFG[INS])!;
    const r = priceItemList(spec, ITEMS, "mts", [{ attributes: cells({ item: NITRILE, cladding: "26G Aluminium", pipe_size_mm: "50" }) }], "", "");
    expect(r.items[0].working.join("\n")).toContain("thickness_mm not mentioned -> 9");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3c AC4 (F11) -- a field marked 'default' always shows its value", () => {
  it("Piping, MS 100, Insulated Yes, Nitrile, 26G, thickness blank: the box shows the ruled 9 in 'Other...' beside its amber line; the row still refuses on the pipe size", () => {
    const { v } = compute(PIP, { items: [pipe("MS", "100", { insulated: "Yes" }, { [SEC]: ins(NITRILE, { cladding: "26G Aluminium" }) })] });
    const b = secBlock(attached(v));
    const f = field(b, "thickness_mm");
    expect({ defaulted: f.defaulted, rule: f.rule, other: f.otherMode, box: f.typedValue, onScreen: onScreen(f) })
      .toEqual({ defaulted: true, rule: "thickness not mentioned -> 9 mm, then the ladder", other: true, box: "9", onScreen: "9" });
    expect(f.userEdited).toBe(false);
    expect(b.reason).toBe("pipe size 100 is above the largest size on the sheet (53.98)");
    expect(fig(v.items[0].figures)).toEqual([2256, 560]);
    expect(v.rowPriced).toBe(false);
  });
  it("where the ladder CAN run the box shows the laddered size, as before: Insulation, Nitrile, 26G, pipe 50 -> 13, 556 / 224 / 780", () => {
    const { v, values } = compute(INS, { items: [{ base: null, family: NITRILE, attrs: { cladding: "26G Aluminium", pipe_size_mm: "50" }, other: ["pipe_size_mm"] }] });
    const f = field(v.items[0], "thickness_mm");
    expect({ defaulted: f.defaulted, value: f.value, other: f.otherMode, onScreen: onScreen(f) }).toEqual({ defaulted: true, value: "13", other: false, onScreen: "13" });
    expect(values).toEqual({ supply_rate: 556, install_rate: 224, combined_rate: 780 });
  });
  it("the shown default is not an entry: the pricer's own value replaces it and the tag goes; the figure never read the box", () => {
    const state: ItemListEditState = { items: [pipe("MS", "100", { insulated: "Yes" }, { [SEC]: ins(NITRILE, { cladding: "26G Aluminium" }) })] };
    const before = compute(PIP, state);
    expect(before.v.editState.items[0].sections![SEC].attrs).toEqual({ cladding: "26G Aluminium" });          // nothing was written for thickness
    const typed = compute(PIP, applyItemEdit(before.v.editState, inSection({ op: "set_attr", index: 0, id: "thickness_mm", value: "19" })));
    const f = field(secBlock(attached(typed.v)), "thickness_mm");
    expect({ defaulted: f.defaulted, userEdited: f.userEdited, rule: f.rule }).toEqual({ defaulted: false, userEdited: true, rule: undefined });
  });
  it("THE SWEEP, named: every kind of Insulation, ADP and Piping (and every Piping section) in every unit, calculator and BoQ row, nothing filled / every default firing -- no amber tag sits beside an empty control", () => {
    const empty: string[] = [];
    let amber = 0;
    const check = (where: string, v: ItemListView) => {
      for (const b of blocks(v)) for (const f of b.fields) {
        if (!f.defaulted) continue;
        amber++;
        if (onScreen(f) === "") empty.push(`${where} / ${b.family} / ${f.id}: value '${f.value}' options ${JSON.stringify(f.options ?? null)}`);
      }
    };
    for (const cat of ITEM_LIST) {
      const spec = itemListPricingSpec(CFG[cat])!;
      const fam = familyAttr(spec);
      for (const family of Object.keys(spec.families)) {
        for (const unit of unitChoicesOf(spec, [family])) {
          check(`calc ${cat} ${unit}`, compute(cat, { items: [{ base: null, family, attrs: {} }] }, unit).v);
          check(`row ${cat} ${unit}`, panel(cat, [{ [fam]: family }], undefined, unit).v);
          check(`row-none ${cat} ${unit}`, panel(cat, [{ [fam]: family, ...Object.fromEntries(listSpecDefs(CFG[cat]).filter((d) => d.id !== fam).map((d) => [d.id, "None"])) }], undefined, unit).v);
        }
      }
    }
    // the Piping sections: each offered material under a pipe the section cannot follow (100) and one it can (32)
    for (const material of [NITRILE, PUF]) for (const size of ["100", "32"]) for (const cladding of ["26G Aluminium", "No"]) {
      check(`calc section ${material} ${size}`, compute(PIP, { items: [pipe("MS", size, { insulated: "Yes" }, { [SEC]: ins(material, { cladding }) })] }).v);
      check(`row section ${material} ${size}`, panel(PIP, [{ pipe_type: "MS", size_mm: size }, { section: SEC, item: material, cladding, thickness_mm: "None" }]).v);
    }
    expect(empty).toEqual([]);
    expect(amber).toBeGreaterThan(100);
  });
  it("a plain dropdown lists its ruled default when the catalogue does not stock it: Cladding Only per sq.m on a BoQ row, cladding not mentioned -> No shown, amber; the row's refusal and options are otherwise the same", () => {
    const { v } = panel(INS, [{ item: "Cladding Only", cladding: "None", thickness_mm: "None", pipe_size_mm: "None", brand: "None", material_as_written: "None" }], undefined, "sqm");
    const f = field(v.items[0], "cladding");
    expect({ defaulted: f.defaulted, value: f.value, allowOther: !!f.allowOther, onScreen: onScreen(f) }).toEqual({ defaulted: true, value: "No", allowOther: false, onScreen: "No" });
    expect(f.options).toEqual(["24G Aluminium", "24G Aluminium with Glass Cloth", "26G Aluminium", "26G Aluminium with Glass Cloth", "Glass Cloth with paint", "No"]);
    // NEGATIVE: once the pricer picks, the list is the stocked one again
    const picked = panel(INS, [{ item: "Cladding Only", cladding: "None" }], applyItemEdit(v.editState, { op: "set_attr", index: 0, id: "cladding", value: "26G Aluminium" }), "sqm");
    expect(field(picked.v.items[0], "cladding").options).not.toContain("No");
  });
  it("NEGATIVE: a field that is not a default is untouched -- a blank dropdown stays '- select -' with no tag, and a typed 'Other...' value keeps its own box", () => {
    const { v } = compute(INS, { items: [{ base: null, family: NITRILE, attrs: {} }] });
    const c = field(v.items[0], "cladding");
    expect({ defaulted: c.defaulted, onScreen: onScreen(c), other: c.otherMode }).toEqual({ defaulted: false, onScreen: "", other: false });
    const typed = compute(INS, { items: [{ base: null, family: NITRILE, attrs: { cladding: "No", pipe_size_mm: "50", thickness_mm: "9" }, other: ["pipe_size_mm", "thickness_mm"] }] });
    const t = field(typed.v.items[0], "thickness_mm");
    expect({ defaulted: t.defaulted, box: t.typedValue, other: t.otherMode }).toEqual({ defaulted: false, box: "9", other: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3c AC5 (F12) -- the calculator's 'Insulated: No' nobody picked carries the amber default tag", () => {
  it("Calculator -> Piping, MS 32: Insulated shows No, amber, with its line", () => {
    const { v } = compute(PIP, { items: [pipe("MS", "32")] });
    const f = field(v.items[0], "insulated");
    expect({ value: f.value, defaulted: f.defaulted, rule: f.rule }).toEqual({ value: "No", defaulted: true, rule: "insulation not mentioned -> No" });
    expect(v.items[0].sections).toBeUndefined();
    expect(fig(v.totals)).toEqual([600, 175]);
  });
  it("the pricer's own pick -- No or Yes -- carries no tag", () => {
    for (const pick of ["No", "Yes"]) {
      const { v } = compute(PIP, { items: [pipe("MS", "32", { insulated: pick })] });
      const f = field(v.items[0], "insulated");
      expect({ pick, value: f.value, defaulted: f.defaulted, rule: f.rule }).toEqual({ pick, value: pick, defaulted: false, rule: undefined });
    }
  });
  it("NEGATIVE: BoQ-row behaviour is unchanged -- a model-read pipe with no insulation facts is amber (as before), a pipe the pricer ADDS on a BoQ row stays plain", () => {
    const first = panel(PIP, [{ pipe_type: "MS", size_mm: "32" }]);
    expect(field(first.v.items[0], "insulated")).toMatchObject({ value: "No", defaulted: true, rule: "insulation not mentioned -> No" });
    const added = panel(PIP, [{ pipe_type: "MS", size_mm: "32" }], applyItemEdit(first.v.editState, { op: "add", family: "Copper" }));
    const f = field(added.v.items[1], "insulated");
    expect({ value: f.value, defaulted: f.defaulted, rule: f.rule }).toEqual({ value: "No", defaulted: false, rule: undefined });
  });
  it("NEGATIVE: the tag changes no figure and opens no section", () => {
    const a = compute(PIP, { items: [pipe("MS", "32")] });
    const b = compute(PIP, { items: [pipe("MS", "32", { insulated: "No" })] });
    expect(a.values).toEqual(b.values);
    expect(a.v.sections).toMatchObject({ lines: 1, bad: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3c AC6 -- the Derivation tab says the quantity rule, generated from the config", () => {
  const lines = (cfg: RateCategoryConfig) => itemListRuleOrder(cfg, ITEMS);
  it("Piping has 19 lines; line 18 is the quantity rule, word for word, between the mirror and the total", () => {
    const all = lines(CFG[PIP]);
    // INVERTED at 12e-4b (owner F-3: the no-unit line sits above, so every later line moves down one). BEFORE:
    // `toHaveLength(19)`, `all[16]`, `all[17]` with `n: 18`, `all[18]`. The words are unchanged.
    expect(all).toHaveLength(20);
    expect(all[17].title).toBe("The insulation section takes the pipe size its pipe priced as");
    expect(all[18]).toEqual({ n: 19, title: "The insulation section's quantity is its pipe's until the pricer types their own",
      detail: "shown 'from pipe' and following the pipe's box; a quantity typed in the section is kept; a section that belongs to no pipe keeps its own, 1 unless typed" });
    expect(all[19].title).toBe("The row total adds every pipe and every section");
  });
  it("it comes from the config: a section with no toggle (never under an item) has no quantity line; another label and tag change the words", () => {
    const noToggle = structuredClone(CFG[PIP]) as unknown as { list_spec: { sections: Array<Record<string, any>> } };
    delete noToggle.list_spec.sections[1].include_when;
    expect(lines(noToggle as unknown as RateCategoryConfig).map((l) => l.title).join("\n")).not.toMatch(/quantity is its/);
    const relabelled = structuredClone(CFG[PIP]) as unknown as { list_spec: { sections: Array<Record<string, any>> } };
    relabelled.list_spec.sections[1].label = "Lagging";
    relabelled.list_spec.sections[1].mirror.tag = "as the pipe";
    const l = lines(relabelled as unknown as RateCategoryConfig).find((x) => /quantity is its/.test(x.title))!;
    expect(l.title).toBe("The lagging section's quantity is its pipe's until the pricer types their own");
    expect(l.detail).toContain("shown 'as the pipe'");
  });
  it("NEGATIVE: Insulation 24 and ADP 18 are unchanged, and neither says anything about a section", () => {
    // INVERTED at 12e-6c (owner U2 / R, 2026-10-18) by mechanical authority: BEFORE `expect(lines(CFG[INS])).toHaveLength(24)`.
    // The F-3 line and the RPUF line generate on Insulation; without them it is still 24.
    // INVERTED at ADP-1 (owner F4, 2026-10-19) by mechanical authority: BEFORE `expect(lines(CFG[INS])).toHaveLength(26)`. The F4 line (RPUF on a per-sq.m row)
    // generates wherever the RPUF line does; without it the count below it is unchanged.
    expect(lines(CFG[INS])).toHaveLength(27);
    expect(lines(CFG[INS]).filter((l) => !["A pipe size written as a bare number that could be inches refuses", "RPUF with no material answered prices as Tubular Puf Insulation", "RPUF on a per-sq.m row refuses by name"].includes(l.title))).toHaveLength(24);
    // INVERTED at ADP-2 H5 fix (a) (owner 2026-10-20) by mechanical authority: BEFORE `expect(lines(CFG[ADP])).toHaveLength(18)`. R13 reads the air
    // stream, so the both-streams line generates on this config too; without it the count is unchanged.
    expect(lines(CFG[ADP])).toHaveLength(19);
    expect(lines(CFG[ADP]).filter((l) => l.title !== "A row naming supply and return air leaves the damper as read")).toHaveLength(18);
    for (const cat of [INS, ADP]) expect(lines(CFG[cat]).map((l) => l.title).join("\n")).not.toMatch(/section/i);
  });
});
