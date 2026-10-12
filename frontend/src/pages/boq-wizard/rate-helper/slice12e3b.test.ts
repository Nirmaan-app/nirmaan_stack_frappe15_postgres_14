/**
 * SLICE 12e-3b (owner rulings D1b, "two sizes" 2026-10-11, D3b, block 38, Q11 / Q12 / Q13, "Strip them too" 2026-10-12)
 * -- PIPING CLEANUP. No asset and no config changes: every rule is tested from the PANEL'S ENTRY POINT
 * (`makePricingSheetHelper(...).compute`) on the v37 asset, read at runtime.
 *
 *   AC1  D1b: in the CALCULATOR a section the toggle opens shows the material list with nothing picked and no
 *        default line; on a BoQ row the delegated category's own default stays; figures equal Calculator ->
 *        Insulation once picked.
 *   AC2  a Piping size written as two or more sizes prices the higher / highest, typed and model-read, with its
 *        line; the inch-fraction rule (top <= 16, bottom 2 .. 64); Insulation's reader is untouched; the section
 *        mirrors the size the pipe PRICED as.
 *   AC3  no rule tag reaches the screen ("(R-M-b)", "(R-M-c)", "(A-4)", "(A-5)"); the config and the pure pricer
 *        keep theirs; a bracket that is not a tag is kept; Electrical's strings are untouched by the two new rules.
 *   AC4  "Nm" from the unit-spelling table.
 *   AC5  a kind's ruled defaults show on a per-number row that is still waiting for its size.
 *   AC6  the Derivation tab lists the section's lines, generated from the config.
 *   AC8  "1 of 1 item needs a person".
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
import { itemListRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import { HYPHEN_TAG, UNIT_SPELLINGS, plainPricerText, plainSentence, unitSpellings } from "@/pages/pricing/rate-master/plainEnglish";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, makePricingSheetHelper, needPersonSentence,
  type ItemBlockView, type ItemEdit, type ItemEditOp, type ItemListEditState, type ItemListSuggestion, type ItemListView,
  type SectionBlockView,
} from "./pricingSheetHelper";
import {
  INCH_NUMERATOR_MAX, isInchFraction, isOneSizeEntry, itemListPricingSpec, priceItemList, readNumber, severalSizesMessage,
  severalSizesPick, severalSizesTaken, slashSizes,
} from "./itemListPricing";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const ASSET = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v37.json`, import.meta.url));
const V36 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v36.json`, import.meta.url));
const ELECTRICAL = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v66.json`, import.meta.url));
const CFG: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET.category_configs.map((c) => [c.category_id, c]));
const CONFIGS = new Map<string, RateCategoryConfig>(Object.entries(CFG));
const ITEMS: RateMasterItem[] = ASSET.items.map((it) => ({ ...it, discipline: ASSET.discipline } as RateMasterItem));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const KINDS = ["supply_rate", "install_rate", "combined_rate"] as const;
const NITRILE = "Nitrile Rubber Insulation", PUF = "Tubular Puf Insulation";
const HEADING = "Insulation - priced by Insulation's rules";
const SEC = "insulation";
const INCH = '"';

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
/** The PANEL path: the model's stored answer (a LIST of items) through `extractionByRow`, the row's own unit. */
function panel(category: string, answer: Array<Record<string, string>>, state?: ItemListEditState, unit = "Rmt") {
  const row = { excelRow: 1, description: "", attributes: {}, items: answer.map((a) => ({ attributes: cells(a) })) } as ExtractionRow;
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
  const ctx: RateHelperRowContext & { unit?: string } = { excelRow: 1, description: "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS], unit };
  const r = h.compute(ctx, state ? { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state) } : {});
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, values: s.values };
}
const field = (b: ItemBlockView, id: string) => b.fields.find((f) => f.id === id)!;
const fig = (values: Partial<Record<string, number>> | undefined) => [values?.supply_rate, values?.install_rate];
const attached = (v: ItemListView, pipe = 0): SectionBlockView => v.items[pipe].sections![0];
const secBlock = (sv: SectionBlockView): ItemBlockView => sv.view.items[0];
const pipe = (family: string, size: string, more: Record<string, string> = {}, sections?: Record<string, ItemEdit>): ItemEdit =>
  ({ base: null, family, attrs: { size_mm: size, ...more }, other: ["size_mm"], ...(sections ? { sections } : {}) });
const ins = (family: string | null, attrs: Record<string, string> = {}): ItemEdit => ({ base: null, family, attrs });
function drive(ops: ItemEditOp[], start: ItemListEditState = { items: [] }) {
  let r = compute(PIP, start);
  for (const op of ops) r = compute(PIP, applyItemEdit(r.v.editState, op));
  return r;
}
const inSection = (inner: ItemEditOp, pipeIndex: number | null = 0, index = 0): ItemEditOp => ({ op: "section", section: SEC, pipe: pipeIndex, index, inner });
/** Every string anywhere inside a value (a config, a view). */
function strings(o: unknown, out: string[] = []): string[] {
  if (typeof o === "string") out.push(o);
  else if (Array.isArray(o)) for (const v of o) strings(v, out);
  else if (o && typeof o === "object") for (const v of Object.values(o as Record<string, unknown>)) strings(v, out);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3b AC1 -- D1b: in the calculator a section opens on the material list with NOTHING picked", () => {
  const OPEN: ItemEditOp[] = [
    { op: "add", family: "Copper" },
    { op: "set_other", index: 0, id: "size_mm", on: true },
    { op: "set_attr", index: 0, id: "size_mm", value: `5/8${INCH}` },
    { op: "set_attr", index: 0, id: "insulated", value: "Yes" },
  ];
  it("Copper, Other 5/8\", Insulated = Yes: the section is the heading and the two materials, nothing picked, no 'not mentioned' line anywhere", () => {
    const { v, values } = drive(OPEN);
    const sv = attached(v);
    expect(sv.heading).toBe(HEADING);
    expect(sv.view.pickFamily).toBe(true);
    expect(sv.view.items).toEqual([]);
    expect(sv.view.families.map((f) => f.family)).toEqual([NITRILE, PUF]);
    expect(sv.view.reason).toBe("Choose the insulation material");
    expect(sv.view.rowPriced).toBe(false);
    // no material is assumed, so no default line is written anywhere on the row
    const all = strings(v).join("\n");
    expect(all).not.toMatch(/not mentioned -> Nitrile|Not mentioned on the BoQ/i);
    // the pipe keeps its own price; the row waits for the pick and says one of the two lines needs a person
    expect(fig(v.items[0].figures)).toEqual([1298, 220]);
    expect(v.rowPriced).toBe(false);
    expect(values).toEqual({});
    expect(v.sections).toMatchObject({ lines: 2, bad: 1 });
    expect(needPersonSentence(v.sections!.bad, v.sections!.lines)).toBe("1 of 2 items need a person before the row can price.");
  });
  it("the list is the SAME one '+ Add insulation' opens", () => {
    const { v } = drive(OPEN);
    expect(attached(v).view.families).toEqual(v.sections!.adds[0].families);
  });
  it("picking Nitrile, then 26G Aluminium and 13: 324 / 224, row total 1622 / 444 -- as 12e-3a", () => {
    const { v, values } = drive([...OPEN,
      inSection({ op: "change_family", index: 0, family: NITRILE }),
      inSection({ op: "set_attr", index: 0, id: "cladding", value: "26G Aluminium" }),
      inSection({ op: "set_attr", index: 0, id: "thickness_mm", value: "13" })]);
    const sv = attached(v);
    expect(sv.view.pickFamily).toBeUndefined();
    expect(secBlock(sv).family).toBe(NITRILE);
    expect(secBlock(sv).familyDefaulted).toBeUndefined();
    expect(fig(sv.view.totals)).toEqual([324, 224]);
    expect(values).toEqual({ supply_rate: 1622, install_rate: 444, combined_rate: 2066 });
    // parity with Calculator -> Insulation for the same picks: figures and working, line for line
    const own = compute(INS, { items: [{ base: null, family: NITRILE, attrs: { cladding: "26G Aluminium", thickness_mm: "13", pipe_size_mm: "15.875" }, other: ["pipe_size_mm"] }] });
    expect(sv.view.totals).toEqual(own.v.totals);
    expect(secBlock(sv).working).toEqual(own.v.items[0].working);
  });
  it("just picked, nothing else: the other fields keep their ruled amber defaults (thickness 9 mm, cladding No, 'How many' 1)", () => {
    const { v } = drive([...OPEN, inSection({ op: "change_family", index: 0, family: NITRILE })]);
    const b = secBlock(attached(v));
    const own = compute(INS, { items: [{ base: null, family: NITRILE, attrs: { pipe_size_mm: "15.875" }, other: ["pipe_size_mm"] }] }).v.items[0];
    for (const id of ["cladding", "thickness_mm"]) {
      expect({ id, value: field(b, id).value, defaulted: field(b, id).defaulted, rule: field(b, id).rule })
        .toEqual({ id, value: field(own, id).value, defaulted: field(own, id).defaulted, rule: field(own, id).rule });
    }
    expect(b.qty).toBe(own.qty);
    expect(b.figures).toEqual(own.figures);
  });
  it("'+ Add insulation' is unchanged: the section is added with the picked material, blank, and mirrors the pipe", () => {
    const { v } = drive([...OPEN.slice(0, 3), { op: "add_section", section: SEC, family: PUF }]);
    expect(v.sections!.independent).toHaveLength(1);
    expect(v.sections!.independent[0].view.pickFamily).toBeUndefined();
    expect(secBlock(v.sections!.independent[0]).family).toBe(PUF);
  });
  it("Calculator -> Insulation is unchanged: its own item with no material still takes its own default, with its own line", () => {
    const { v } = compute(INS, { items: [{ base: null, family: null, attrs: { cladding: "26G Aluminium", thickness_mm: "13", pipe_size_mm: "15.875" }, other: ["pipe_size_mm"] }] });
    expect(v.items[0].family).toBe(NITRILE);
    expect(v.items[0].familyDefaulted).toBeDefined();
    expect(v.items[0].working.join("\n")).toContain("item not mentioned -> Nitrile Rubber Insulation");
    expect((v as ItemListView).pickFamily).toBeUndefined();
  });
  it("ON A BoQ ROW the model-path default stays: insulated Yes with no material -> Nitrile, amber, Insulation's own line; no picker", () => {
    const { v } = panel(PIP, [{ pipe_type: "Copper", size_mm: `5/8${INCH}`, insulated: "Yes" }]);
    const sv = attached(v);
    expect(sv.view.pickFamily).toBeUndefined();
    expect(secBlock(sv).family).toBe(NITRILE);
    expect(secBlock(sv).familyDefaulted).toEqual({ value: NITRILE, rule: "material not mentioned -> Nitrile by row kind: per metre = pipe, per sq.m = sheet, acoustic / lining in the row or its headings = acoustic" });
    // the rule is Insulation's own: the same words its own panel row shows for a material the model did not name
    const own = panel(INS, [{ item: "None", cladding: "No", thickness_mm: "13", pipe_size_mm: "15.88" }]);
    expect(own.v.items[0].familyDefaulted).toEqual(secBlock(sv).familyDefaulted);
  });
  it("ON A BoQ ROW a section the PRICER opens by hand also keeps the default (the ruling is about the calculator only)", () => {
    const first = panel(PIP, [{ pipe_type: "Copper", size_mm: `5/8${INCH}` }]);
    expect(first.v.items[0].sections).toBeUndefined();
    const opened = panel(PIP, [{ pipe_type: "Copper", size_mm: `5/8${INCH}` }], applyItemEdit(first.v.editState, { op: "set_attr", index: 0, id: "insulated", value: "Yes" }));
    expect(attached(opened.v).view.pickFamily).toBeUndefined();
    expect(secBlock(attached(opened.v)).family).toBe(NITRILE);
    expect(secBlock(attached(opened.v)).familyDefaulted).toBeDefined();
  });
  it("NEGATIVE: a calculator section whose material IS picked never shows the list; Insulated = No shows no section at all", () => {
    const picked = compute(PIP, { items: [pipe("Copper", `5/8${INCH}`, { insulated: "Yes" }, { [SEC]: ins(PUF) })] });
    expect(attached(picked.v).view.pickFamily).toBeUndefined();
    const none = compute(PIP, { items: [pipe("Copper", `5/8${INCH}`, { insulated: "No" })] });
    expect(none.v.items[0].sections).toBeUndefined();
    expect(none.v.rowPriced).toBe(true);
  });
  it("the panel draws the list from the view: the frame is keyed on `pickFamily`, and a pick is the section's own 'change item' operation", () => {
    const src = readFileSync(join(__dirname, "RateHelperPanel.tsx"), "utf-8");
    expect(src).toContain("section && view.items.length === 0 && view.pickFamily");
    expect(src).toContain('data-testid="item-section-family-picker"');
    expect(src).toContain('onEdit({ op: "change_family", index: 0, family: f.family })');
    // the unresolvable-category frame is still there, for a section that is NOT a pick
    expect(src).toContain("section && view.items.length === 0 && !view.pickFamily");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3b AC2 -- a Piping size written as two or more sizes prices the higher / highest (REPLACES '40/50 refuses')", () => {
  const READER = itemListPricingSpec(CFG[PIP])!.numbers.size_mm;
  /** One row of the size table: the text, the pipe type, what it IS, the size taken (as the line names it), the sizes named. */
  type Row = { text: string; fam: string; kind: "pair" | "list"; sizes: string; taken: string };
  const TABLE: Row[] = [
    { text: "25/32", fam: "MS", kind: "pair", sizes: "25 / 32", taken: "32" },
    { text: "32/25", fam: "MS", kind: "pair", sizes: "32 / 25", taken: "32" },
    { text: "40/50", fam: "MS", kind: "pair", sizes: "40 / 50", taken: "50" },
    { text: "50/65", fam: "MS", kind: "pair", sizes: "50 / 65", taken: "65" },
    { text: "25/32 mm", fam: "MS", kind: "pair", sizes: "25 / 32", taken: "32" },
    { text: "20/25 NB", fam: "MS", kind: "pair", sizes: "20 / 25", taken: "25" },
    { text: "15/20", fam: "MS", kind: "pair", sizes: "15 / 20", taken: "20" },          // top <= 16 but 20 is no inch denominator
    { text: "17/32", fam: "MS", kind: "pair", sizes: "17 / 32", taken: "32" },          // bottom 32 but top above 16
    { text: "8/7", fam: "MS", kind: "pair", sizes: "8 / 7", taken: "8" },
    { text: `1${INCH}/2${INCH}`, fam: "MS", kind: "pair", sizes: `1${INCH} / 2${INCH}`, taken: `2${INCH}` },   // owner Q11
    { text: "1 inch / 2 inch", fam: "MS", kind: "pair", sizes: `1${INCH} / 2${INCH}`, taken: `2${INCH}` },
    // a unit written once at the end is the unit of the bare part before it: 4 inch and 3 inch, never 4 mm and 3 inch
    { text: `4/3${INCH}`, fam: "MS", kind: "pair", sizes: `4${INCH} / 3${INCH}`, taken: `4${INCH}` },
    { text: "25/32/40", fam: "MS", kind: "list", sizes: "25 / 32 / 40", taken: "40" },
    { text: "19/ 25 / 32 mm", fam: "MS", kind: "list", sizes: "19 / 25 / 32", taken: "32" },
    { text: "40 / 50 / 65", fam: "MS", kind: "list", sizes: "40 / 50 / 65", taken: "65" },
    { text: `1${INCH}/2${INCH}/4${INCH}`, fam: "MS", kind: "list", sizes: `1${INCH} / 2${INCH} / 4${INCH}`, taken: `4${INCH}` },
  ];
  const lineOf = (c: Row) => (c.kind === "pair" ? `states two sizes (${c.sizes}) - the higher, ${c.taken}, is taken` : `states several sizes (${c.sizes}) - the highest, ${c.taken}, is taken`);

  it.each(TABLE.map((c) => [c.text, c] as const))("'%s' -> the higher / highest, on the typed path and the model path alike, at that size's own price", (_, c) => {
    const typed = compute(PIP, { items: [pipe(c.fam, c.text)] });
    const model = panel(PIP, [{ pipe_type: c.fam, size_mm: c.text }]);
    const alone = compute(PIP, { items: [pipe(c.fam, c.taken)] });
    expect({ text: c.text, alone: alone.v.rowPriced }).toEqual({ text: c.text, alone: true });
    for (const x of [typed, model]) {
      expect({ text: c.text, priced: x.v.rowPriced, values: x.values }).toEqual({ text: c.text, priced: true, values: alone.values });
      expect(x.v.items[0].working).toContain(`pipe size ${lineOf(c)}`);
      expect(field(x.v.items[0], "size_mm").value).toBe(field(alone.v.items[0], "size_mm").value);
    }
    expect(field(typed.v.items[0], "size_mm").note!.startsWith(`You typed ${c.text}: ${lineOf(c)}`)).toBe(true);
    expect(field(model.v.items[0], "size_mm").note!.startsWith(`BoQ says ${c.text}: ${lineOf(c)}`)).toBe(true);
    expect(severalSizesPick(c.text, READER)).toMatchObject({ chosen: c.taken });
  });
  it("the two lines, word for word", () => {
    expect(severalSizesTaken(["25", "32"], "32")).toBe("states two sizes (25 / 32) - the higher, 32, is taken");
    expect(severalSizesTaken(["25", "32", "40"], "40")).toBe("states several sizes (25 / 32 / 40) - the highest, 40, is taken");
    expect(field(compute(PIP, { items: [pipe("MS", "25/32")] }).v.items[0], "size_mm").note).toBe("You typed 25/32: states two sizes (25 / 32) - the higher, 32, is taken");
    expect(field(compute(PIP, { items: [pipe("MS", "25/32/40")] }).v.items[0], "size_mm").note).toBe("You typed 25/32/40: states several sizes (25 / 32 / 40) - the highest, 40, is taken");
  });
  it(`owner Q11: 1"/2" is a pair and takes 2" -- the line then shows the taken size's own read (50.8 mm / 50 mm -> MS 50)`, () => {
    const { v, values } = compute(PIP, { items: [pipe("MS", `1${INCH}/2${INCH}`)] });
    expect(values).toEqual(compute(PIP, { items: [pipe("MS", `2${INCH}`)] }).values);
    expect(field(v.items[0], "size_mm").value).toBe("50");
    expect(field(v.items[0], "size_mm").note).toBe(`You typed 1${INCH}/2${INCH}: states two sizes (1${INCH} / 2${INCH}) - the higher, 2${INCH}, is taken -> 50.8 mm / 50 mm -> priced as 50 mm`);
  });
  it("a taken size the ladder still has to move says so after the line (25/32 on PVC, 63/64 on copper refusing above its largest)", () => {
    const up = compute(PIP, { items: [pipe("PVC", "90/110")] });
    expect(field(up.v.items[0], "size_mm").note).toBe("You typed 90/110: states two sizes (90 / 110) - the higher, 110, is taken -> priced as 150 mm (next size up)");
    expect(up.values).toEqual(compute(PIP, { items: [pipe("PVC", "110")] }).values);
    const over = compute(PIP, { items: [pipe("Copper", "63/64")] });
    expect(over.v.rowPriced).toBe(false);
    expect(over.v.items[0].reason).toBe("pipe size 64 is above the largest size on the sheet (47.6)");
  });

  // ── the inch-fraction rule: top number <= 16 AND bottom in {2, 4, 8, 16, 32, 64} ──
  const FRACTIONS: Array<[string, string]> = [["7/8", "Copper"], ["15/16", "Copper"], ["1-1/4", "Copper"], ["1 1/4", "Copper"], ["3/4", "Copper"],
    [`5/8${INCH}`, "Copper"], ["1/2", "Copper"], ["3/4 inch", "Copper"], ["1¼", "Copper"]];
  it.each(FRACTIONS)("a real inch fraction stays inches: '%s' (%s)", (text, fam) => {
    expect(slashSizes(text)).toBeNull();
    expect(severalSizesPick(text, READER)).toBeNull();
    expect(isOneSizeEntry(text)).toBe(true);
    const typed = compute(PIP, { items: [pipe(fam, text)] });
    const model = panel(PIP, [{ pipe_type: fam, size_mm: text }]);
    expect(typed.v.rowPriced).toBe(true);
    expect(model.values).toEqual(typed.values);
    expect(field(typed.v.items[0], "size_mm").note ?? "").not.toMatch(/states (two|several) sizes/);
    // the read is the inch value x 25.4, never a list
    const r = readNumber(text, READER);
    expect(r && "value" in r && r.value > 0 && r.value < 50).toBe(true);
  });
  it("the rule itself, each edge named: top 16 is the last inch numerator; 3/2 and 16/32 are inches; 17/32, 25/32, 63/64 and 15/20 are two sizes", () => {
    expect(INCH_NUMERATOR_MAX).toBe(16);
    for (const [n, d, want] of [[7, 8, true], [15, 16, true], [16, 32, true], [3, 2, true], [16, 2, true], [17, 32, false], [25, 32, false], [63, 64, false],
      [15, 20, false], [3, 5, false], [8, 7, false], [0, 8, false]] as Array<[number, number, boolean]>) {
      expect({ n, d, inch: isInchFraction(n, d) }).toEqual({ n, d, inch: want });
    }
    expect(slashSizes("25/32")).toEqual(["25", "32"]);          // BEFORE 12e-3b: null -- it read as 25/32 of an inch
    expect(slashSizes("3/2")).toBeNull();                        // BEFORE 12e-3b: ["3", "2"] (the numerator was not smaller)
    expect(slashSizes(`1${INCH}/2${INCH}`)).toEqual(["1", "2"]); // owner Q11: BEFORE null -- it read as half an inch
    expect(slashSizes("1/2")).toBeNull();
  });
  it("NOT RULED, SO NOT GUESSED: a list holding an inch fraction, and a part that is not one size, still refuse 'pick one'", () => {
    for (const [text, sizes] of [[`3/4${INCH} / 1${INCH}`, "3 / 4 / 1"], ["25 x 3 / 32 x 3", "25 / 3 / 32 / 3"]] as const) {
      expect(severalSizesPick(text, READER)).toBeNull();
      const typed = compute(PIP, { items: [pipe("MS", text)] });
      const model = panel(PIP, [{ pipe_type: "MS", size_mm: text }]);
      for (const x of [typed, model]) {
        expect(x.v.rowPriced).toBe(false);
        expect(x.v.reason).toBe(severalSizesMessage("pipe size", sizes.split(" / ")));
      }
    }
  });
  it("NEGATIVE: one size is one size -- no line, the price it always had ('50', '50 NB', '2 inch', '110')", () => {
    for (const [fam, text] of [["MS", "50"], ["CPVC", "50 NB"], ["MS", "2 inch"], ["PVC", "110"]] as const) {
      const { v } = compute(PIP, { items: [pipe(fam, text)] });
      expect(v.rowPriced).toBe(true);
      expect(v.items[0].working.join("\n")).not.toMatch(/states (two|several) sizes/);
      expect(severalSizesPick(text, READER)).toBeNull();
    }
  });
  it("NEGATIVE: every other typed refusal keeps the one-size message ('two inch', '40-50', 'as per spec')", () => {
    for (const text of ["two inch", "40-50", "as per spec"]) expect(compute(PIP, { items: [pipe("MS", text)] }).v.reason).toBe("Type one pipe size, in mm or inches");
  });
  it("NEGATIVE: Insulation's reader is untouched -- it declares no `typed_entry`, and reads '25/32' and '40/50' exactly as before this slice", () => {
    const ir = itemListPricingSpec(CFG[INS])!.numbers.pipe_size_mm;
    expect(ir.typed_entry).toBeUndefined();
    expect(readNumber("25/32", ir)).toEqual({ value: (25 / 32) * 25.4 });
    expect(readNumber("40/50", ir)).toEqual({ value: (40 / 50) * 25.4 });
    expect(readNumber("19/ 25 / 32 mm", itemListPricingSpec(CFG[INS])!.numbers.thickness_mm)).toMatchObject({ value: 32 });
    for (const cat of [INS, ADP]) for (const reader of Object.values(itemListPricingSpec(CFG[cat])!.numbers)) expect(reader.typed_entry).toBeUndefined();
    // and through its own panel row: nothing says "states two sizes"
    const r = priceItemList(itemListPricingSpec(CFG[INS])!, ITEMS, "Rmt", [{ attributes: cells({ item: NITRILE, cladding: "No", thickness_mm: "19", pipe_size_mm: "25/32" }) }]);
    expect(JSON.stringify(r)).not.toMatch(/states two sizes/);
  });
  it("owner D3b: the section mirrors the size the pipe PRICED as -- MS '25/32' prices 32, so the insulation takes 32 'from pipe'", () => {
    const { v } = compute(PIP, { items: [pipe("MS", "25/32", { insulated: "Yes" }, { [SEC]: ins(NITRILE, { cladding: "No", thickness_mm: "13" }) })] });
    expect(field(v.items[0], "size_mm").value).toBe("32");
    const f = field(secBlock(attached(v)), "pipe_size_mm");
    expect(f.typedValue).toBe("32");
    expect(f.mirrorTag).toBe("from pipe");
    // the same section as one whose pipe was typed "32"
    const plain = compute(PIP, { items: [pipe("MS", "32", { insulated: "Yes" }, { [SEC]: ins(NITRILE, { cladding: "No", thickness_mm: "13" }) })] });
    expect(attached(v).view.totals).toEqual(attached(plain.v).view.totals);
    expect(secBlock(attached(v)).working).toEqual(secBlock(attached(plain.v)).working);
    // and on the model path
    const m = panel(PIP, [{ pipe_type: "MS", size_mm: "25/32" }, { item: NITRILE, cladding: "No", thickness_mm: "13" }]);
    expect(field(secBlock(attached(m.v)), "pipe_size_mm").typedValue).toBe("32");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3b AC3 -- no rule tag reaches a pricer's screen; the config and the pure pricer keep theirs", () => {
  /** Every tag spelling this slice strips, with a sentence that carries it and what the pricer reads. */
  const TAGS: Array<[string, string, string]> = [
    ["(R-M-b)", "UL stated, so the UL 555 SKU is used (R-M-b)", "UL stated, so the UL 555 SKU is used"],
    ["(R-M-c)", "per piece: per-metre rate x 2.5 m standard length (R-M-c)", "per piece: per-metre rate x 2.5 m standard length"],
    ["(A-4)", "the outer size 300x300 did not match the catalogue -- matched on the neck size instead (A-4)", "the outer size 300x300 did not match the catalogue -- matched on the neck size instead"],
    ["(A-5)", "the outer size 600x600 is the sheet's 595x595 (A-5)", "the outer size 600x600 is the sheet's 595x595"],
    ["(A-4) mid-line", "matched on the outer size 595x595 (damper taken from that SKU) (A-4)", "matched on the outer size 595x595 (damper taken from that SKU)"],
    ["(R-c)", "a rule (R-c)", "a rule"],
    ["(S-d)", "a rule (S-d)", "a rule"],
    ["(Q-a)", "a rule (Q-a)", "a rule"],
  ];
  it.each(TAGS)("%s is stripped: one function, both entry points", (_tag, before, after) => {
    expect(plainPricerText(before)).toBe(after);
    expect(plainSentence(before)).toBe(after);
    expect(plainPricerText(after)).toBe(after);     // idempotent
  });
  it("the numbered tags the function always dropped still go ('(R15)', '(R4 / S6)', '(D9b)', '(owner 2026-10-07)')", () => {
    expect(plainPricerText("ROUNDUP(supply, 0) (R15)")).toBe("ROUNDUP(supply, 0)");
    expect(plainPricerText("a rule (R4 / S6)")).toBe("a rule");
    expect(plainPricerText("a rule (D9b)")).toBe("a rule");
    expect(plainPricerText("a rule (owner 2026-10-07)")).toBe("a rule");
  });
  it("NEGATIVE: a bracket that is not a tag is kept -- a product code, a bolt size, a formula, a unit, an axis label", () => {
    for (const keep of ["Fire damper (UL-555)", "anchor bolt (M-10)", "face area (W x H / 10^6 sq.m)", "depth (H / 1000)", "Torque (NM)",
      "1100(W) X 250(D) X 400(H)", "(next size up)", "unit (QRO)", "class (A-class)", "type (A-10B)", "cable (R-Y-B phase)"]) {
      expect({ keep, got: plainPricerText(keep) }).toEqual({ keep, got: keep });
    }
  });
  it("EVERY tag pattern in the HVAC v37 configs: found by a wide search, each one gone after the plain-English step, and the list of spellings is the one named here", () => {
    const WIDE = /\((?:[A-Z]{1,2})(?:-?\d+[a-z]?|(?:-[A-Za-z0-9]{1,2}){1,2})(?:\s*\/\s*[A-Z]{1,2}-?[A-Za-z0-9-]+)*\)/g;
    const found = new Map<string, number>();
    const left = new Set<string>();
    for (const cfg of ASSET.category_configs) {
      for (const text of strings(cfg)) {
        for (const m of text.match(WIDE) ?? []) found.set(m, (found.get(m) ?? 0) + 1);
        for (const m of plainPricerText(text).match(WIDE) ?? []) left.add(m);
      }
    }
    expect([...left]).toEqual([]);
    // the hyphenated spellings, which were the ones that used to reach the screen
    expect([...found.keys()].filter((t) => t.includes("-")).sort()).toEqual(["(R-M-b)", "(R-M-c)", "(R-c)", "(R-f)", "(S-d)"]);
    expect(found.get("(R-M-b)")).toBe(1);
    expect(found.get("(R-M-c)")).toBe(3);
    // the numbered ones, already dropped before this slice, are still all dropped (counted so a new spelling shows)
    expect([...found.keys()].filter((t) => !t.includes("-")).sort()).toEqual(
      ["(D)", "(H)", "(L)", "(W)"].filter((t) => found.has(t)).concat([...found.keys()].filter((t) => /^\((?:R|D|T|S|Q)\d+[a-z]?(?:\s*\/.*)?\)$/.test(t))).sort());
  });
  it("on the PANEL: the UL line, the outer-size lines and the flexible-duct line carry no tag", () => {
    const ul = compute(ADP, { items: [{ base: null, family: "fire damper", attrs: { variant: "motorised", ul: "yes", size_mm: "600x600" } }] }, "nos");
    expect(ul.values).toEqual({ supply_rate: 7830, install_rate: 692, combined_rate: 8522 });
    expect(ul.v.items[0].working).toContain("UL stated, so the UL 555 SKU is used");
    expect(field(ul.v.items[0], "variant").note).toBe("UL stated, so the UL 555 SKU is used");
    const outer = panel(ADP, [{ family: "square diffuser", damper: "without", size_mm: "600 x 600" }], undefined, "Nos");
    expect(outer.v.items[0].working).toContain("the outer size 600x600 is the sheet's 595x595");
    const flex = panel(ADP, [{ family: "flexible duct", insulated: "with", dia_mm: "350" }], undefined, "Nos");
    expect(flex.v.rowPriced).toBe(true);
    for (const x of [ul, outer, flex]) expect(strings(x.v).join("\n")).not.toMatch(/\((?:R|A)-[A-Za-z0-9-]+\)/);
    expect(strings(flex.v).join("\n")).toContain("per piece: per-metre");
  });
  it("NEGATIVE: the CONFIG keeps its tags, and the PURE pricer's own text keeps them (the strip is at the view boundary only)", () => {
    expect(strings(CFG[ADP]).filter((t) => t.includes("(R-M-b)"))).toHaveLength(1);
    const spec = itemListPricingSpec(CFG[ADP])!;
    const pure = priceItemList(spec, ITEMS, "nos", [{ attributes: cells({ family: "fire damper", variant: "motorised", ul: "yes", size_mm: "600x600" }) }]);
    expect(pure.items[0].working.join("\n")).toContain("UL stated, so the UL 555 SKU is used (R-M-b)");
    const outer = priceItemList(spec, ITEMS, "Nos", [{ attributes: cells({ family: "square diffuser", damper: "without", size_mm: "600 x 600" }) }]);
    expect(outer.items[0].working.join("\n")).toMatch(/\(A-5\)/);
    expect(outer.items[0].working.join("\n")).toMatch(/\(A-4\)/);
  });
  it("NEGATIVE: Electrical -- neither new rule would change one string of any Electrical v66 config", () => {
    let n = 0;
    for (const cfg of ELECTRICAL.category_configs) {
      for (const text of strings(cfg)) {
        n++;
        expect({ text, tag: text.replace(HYPHEN_TAG, "") }).toEqual({ text, tag: text });
        expect({ text, unit: unitSpellings(text) }).toEqual({ text, unit: text });
      }
    }
    expect(n).toBeGreaterThan(1000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3b AC4 -- 'Nm': a unit key reads as the unit, from a table that names no category", () => {
  it("the table: nm -> Nm; mm and kg are already standard", () => {
    expect(UNIT_SPELLINGS).toEqual({ nm: "Nm", mm: "mm", kg: "kg" });
  });
  it.each([
    ["You typed 6 nm -> priced as 8 nm (next size up)", "You typed 6 Nm -> priced as 8 Nm (next size up)"],
    ["BoQ says 9 nm -> priced as 20 nm (next size up)", "BoQ says 9 Nm -> priced as 20 Nm (next size up)"],
    ["BoQ says 10 NM -> 10 nm (the sheet's own spelling of this value)", "BoQ says 10 NM -> 10 Nm (the sheet's own spelling of this value)"],
    ["BoQ says min.10 N.m -> 10 nm (the sheet's own spelling of this value)", "BoQ says min.10 N.m -> 10 Nm (the sheet's own spelling of this value)"],
    ["BoQ says 4-6 NM -> 6 nm (range '4-6 NM' -> its top value 6)", "BoQ says 4-6 NM -> 6 Nm (range '4-6 NM' -> its top value 6)"],
    ["6 nm is not stocked with UL listed yes -> priced as 8 nm (next size up)", "6 Nm is not stocked with UL listed yes -> priced as 8 Nm (next size up)"],
    ["torque 20nm", "torque 20Nm"],
  ])("'%s' -> '%s'", (before, after) => {
    expect(plainPricerText(before)).toBe(after);
    expect(plainPricerText(after)).toBe(after);
  });
  it("NEGATIVE: every other unit and every non-unit is untouched -- mm, sq.m, kg, the BoQ's own capitals, a word that merely ends in nm", () => {
    for (const keep of ["19 mm -> priced as 25 mm", "per sq.ft: sq.m rate x 0.0929", "density 48 kg", "BoQ says 10 NM", "N.m", "600 mm x 600 mm",
      "the unit nm", "3 nmx", "2.5 m standard length", "x 2 per row unit", "5 nos", "ROUNDUP(supply, 0) = 984"]) {
      expect({ keep, got: plainPricerText(keep) }).toEqual({ keep, got: keep });
    }
  });
  it("on the PANEL: actuator, torque 6 typed, then UL yes -- the line reads '6 Nm ... 8 Nm', the figure is the one it always was", () => {
    const typed = compute(ADP, { items: [{ base: null, family: "actuator", attrs: { torque: "6", ul: "yes" }, other: ["torque"] }] }, "nos");
    expect(fig(typed.values)).toEqual([23925, 800]);
    expect(field(typed.v.items[0], "torque").note).toBe("You typed 6 Nm -> priced as 8 Nm (next size up)");
    expect(strings(typed.v).join("\n")).not.toMatch(/\d ?nm\b/);
    // the config still says "nm": nothing was changed there
    expect(itemListPricingSpec(CFG[ADP])!.numbers.torque_nm.unit).toBe("nm");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3b AC5 -- a per-number row still waiting for its size shows the kind's ruled defaults (Variant, UL listed)", () => {
  const damper = (unit: string, attrs: Record<string, string> = {}) => compute(ADP, { items: [{ base: null, family: "fire damper", attrs }] }, unit).v;
  it("fire damper per number, no size: Variant and UL listed show their ruled defaults, amber, with the rule -- as per sq.m does", () => {
    const nos = damper("nos"), sqm = damper("sqm");
    expect(nos.rowPriced).toBe(false);
    expect(nos.items[0].reason).toMatch(/^per-number row: no .* stated to convert the per-sq\.m rate$/);
    for (const id of ["variant", "ul"]) {
      const a = field(nos.items[0], id), b = field(sqm.items[0], id);
      expect({ id, value: a.value, defaulted: a.defaulted, rule: a.rule }).toEqual({ id, value: b.value, defaulted: true, rule: b.rule });
      expect(a.value).not.toBe("");
    }
    expect(field(nos.items[0], "variant").value).toBe("without sleeve");
    expect(field(nos.items[0], "ul").value).toBe("no");
  });
  it("the size typed next prices the row on those same defaults -- nothing jumps", () => {
    const before = damper("nos"), after = damper("nos", { size_mm: "600x600" });
    expect(after.rowPriced).toBe(true);
    for (const id of ["variant", "ul"]) expect(field(after.items[0], id).value).toBe(field(before.items[0], id).value);
  });
  it("NEGATIVE: a value the pricer picked is theirs (not replaced by the default); the refusal sentence and every figure are unchanged", () => {
    const picked = damper("nos", { variant: "motorised" });
    expect(field(picked.items[0], "variant").value).toBe("motorised");
    expect(field(picked.items[0], "variant").defaulted).toBe(false);
    expect(picked.items[0].reason).toBe(damper("nos").items[0].reason);
    expect(damper("nos").items[0].figures).toEqual({});
    // the priced cases 12e-3a certified are the same
    expect(compute(ADP, { items: [{ base: null, family: "fire damper", attrs: { variant: "motorised", ul: "yes", size_mm: "600x600" } }] }, "nos").values)
      .toEqual({ supply_rate: 7830, install_rate: 692, combined_rate: 8522 });
  });
  it("the pure pricer: the refusal carries ONLY the kind's own needs as defaults, never a conversion's (no size is invented)", () => {
    const spec = itemListPricingSpec(CFG[ADP])!;
    const r = priceItemList(spec, ITEMS, "nos", [{ attributes: cells({ family: "fire damper" }) }]).items[0];
    expect(r.state).toBe("blank");
    expect(r.defaulted.map((d) => d.attr).sort()).toEqual(["ul", "variant"]);
    expect(r.working.join("\n")).not.toMatch(/not mentioned ->/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3b AC6 -- the Derivation tab lists the insulation section's lines on Piping, generated from the v37 config", () => {
  const lines = (cfg: RateCategoryConfig) => itemListRuleOrder(cfg, ITEMS);
  // INVERTED at 12e-3c (owner F10 / U6: the quantity rule has its own line, 18). BEFORE: `toHaveLength(18)` and
  // `all.slice(14)` equal to the four lines below with the row total numbered 18. The four lines' words are unchanged.
  it("the four lines, word for word, after the 14 Piping had (12e-3c: a fifth, the quantity line, sits before the total, which is now line 19)", () => {
    const all = lines(CFG[PIP]);
    expect(all).toHaveLength(19);
    expect(all[17].title).toBe("The insulation section's quantity is its pipe's until the pricer types their own");
    expect([...all.slice(14, 17), { ...all[18], n: 18 }]).toEqual([
      { n: 15, title: "Each pipe says whether it has insulation: Insulated Yes opens the insulation section under that pipe",
        detail: "insulation not mentioned -> No, shown as assumed on a BoQ row; any other answer removes only that section; 'Add insulation' adds a section that belongs to no pipe; in the calculator a section opens with nothing picked" },
      { n: 16, title: "The insulation section is priced by Insulation's rules",
        detail: "its own catalogue, pricing inputs, defaults, ladders and refusals -- no rule of it is copied here; the kinds offered: Nitrile Rubber Insulation, Tubular Puf Insulation" },
      { n: 17, title: "The insulation section takes the pipe size its pipe priced as",
        detail: "shown 'from pipe'; a pipe written as two sizes gives the one it priced; a size chosen in the section is kept and says so: 'you chose <chosen> (pipe is <pipe>)'; a section that belongs to no pipe takes the first pipe's" },
      { n: 18, title: "The row total adds every pipe and every section",
        detail: "each line rounded by its own rules; one line that cannot price stops the row, and the count of lines that need a person is shown" },
    ]);
  });
  it("every word comes from the config: a different label, family list and tag change the lines", () => {
    const edited = structuredClone(CFG[PIP]) as unknown as { list_spec: { sections: Array<Record<string, any>> } };
    edited.list_spec.sections[1].label = "Lagging";
    edited.list_spec.sections[1].families = ["Tubular Puf Insulation"];
    edited.list_spec.sections[1].mirror.tag = "as the pipe";
    const all = lines(edited as unknown as RateCategoryConfig).slice(14);
    expect(all[0].title).toBe("Each pipe says whether it has lagging: Insulated Yes opens the lagging section under that pipe");
    expect(all[1].title).toBe("The lagging section is priced by Lagging's rules");
    expect(all[1].detail).toContain("the kinds offered: Tubular Puf Insulation");
    expect(all[2].detail).toContain("shown 'as the pipe'");
  });
  it("NEGATIVE: a config that declares no delegated section adds nothing -- Insulation 24, ADP 18, v36 Piping 14, and no internal id or tag on any line", () => {
    expect(lines(CFG[INS])).toHaveLength(24);
    expect(lines(CFG[ADP])).toHaveLength(18);
    const v36pip = V36.category_configs.find((c) => c.category_id === PIP)!;
    expect(lines(v36pip)).toHaveLength(14);
    expect(lines(CFG[PIP]).slice(0, 14).map((l) => l.title)).toEqual(lines(v36pip).map((l) => l.title));
    for (const cat of [INS, ADP]) expect(lines(CFG[cat]).map((l) => l.title).join("\n")).not.toMatch(/section/i);
    const text = lines(CFG[PIP]).map((l) => `${l.title} | ${l.detail ?? ""}`).join("\n");
    expect(text).not.toMatch(/hvac_insulation|pipe_size_mm|size_mm|include_when|\{chosen\}|\{pipe\}/);
  });
  it("the line the size box changed: two or more sizes take the higher (BEFORE: 'refuses naming the two sizes')", () => {
    const l9 = lines(CFG[PIP])[8];
    expect(l9.title).toBe("A typed pipe size is one size, in mm or inches");
    expect(l9.detail).toContain("two or more sizes written with a slash take the higher ('25/32' prices 32, '25/32/40' prices 40");
    expect(l9.detail).toContain("a slash is an inch fraction only when its top number is 16 or less and its bottom is 2, 4, 8, 16, 32 or 64");
    expect(l9.detail).not.toContain("refuses naming");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3b AC8 -- '1 of 1 item needs a person': the verb follows the number of lines", () => {
  it.each([[1, 1, "1 of 1 item needs a person before the row can price."], [1, 2, "1 of 2 items need a person before the row can price."],
    [2, 2, "2 of 2 items need a person before the row can price."], [3, 5, "3 of 5 items need a person before the row can price."]] as const)(
    "%i of %i", (bad, n, want) => { expect(needPersonSentence(bad, n)).toBe(want); });
  it("the ONE site: the row-total box calls the function, and no other file under the two folders builds the sentence", () => {
    const panelSrc = readFileSync(join(__dirname, "RateHelperPanel.tsx"), "utf-8");
    expect(panelSrc).toContain('{n === 0 ? "No items yet." : needPersonSentence(bad, n)}');
    expect(panelSrc).not.toMatch(/need a person before the row can price/);
    const helperSrc = readFileSync(join(__dirname, "pricingSheetHelper.ts"), "utf-8");
    expect(helperSrc.match(/a person before the row can price\./g)).toHaveLength(1);
  });
  it("on the row: a single refused pipe reads 'needs'; a pipe with a refused section reads 'need'", () => {
    const one = compute(PIP, { items: [pipe("MS", "350")] }).v;
    expect(needPersonSentence(one.sections!.bad, one.sections!.lines)).toBe("1 of 1 item needs a person before the row can price.");
    const two = compute(PIP, { items: [pipe("MS", "100", { insulated: "Yes" }, { [SEC]: ins(NITRILE, { cladding: "26G Aluminium", thickness_mm: "32" }) })] }).v;
    expect(needPersonSentence(two.sections!.bad, two.sections!.lines)).toBe("1 of 2 items need a person before the row can price.");
  });
});
