/**
 * SLICE 12e-4c (owner rulings on the 12e-4b findings, 2026-10-13) -- THREE SMALL FIXES. No model is asked here: a
 * model answer is a stored item written by hand. Every rule is tested from the PANEL'S ENTRY POINT
 * (`makePricingSheetHelper(...).compute`) and every figure is checked against the PURE pricer over the same inputs.
 *
 *   AC1  A full stop after a gauge mark no longer hides it. ADP has no gauge reader: the text lands on the
 *        PLENUM-THICKNESS reader, which refuses "26G" as "a gauge, not a thickness" -- and read "26G." as a
 *        26 mm thickness. Ruled in the run: "26G." refuses, like "26G".
 *   AC2  On Insulation's pipe size a slash pair that cannot be an inch fraction is TWO SIZES and takes the
 *        higher, with Piping's own line; a real inch fraction ("3/4") stays inches.
 *   AC3  A pipe type the PRICER typed reads "You typed uPVC -> priced as PVC"; one the model read keeps
 *        "BoQ says ...".
 *
 * What each block protects is said in its `describe`. Negative halves sit beside every positive.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, assembleItems, decodeItemEdits, makePricingSheetHelper,
  type ItemBlockView, type ItemEdit, type ItemListEditState, type ItemListSuggestion, type ItemListView, type SectionBlockView,
} from "./pricingSheetHelper";
import { familyAttr, itemListPricingSpec, listSpecDefs, priceItemList, readNumber, slashSizes, typedFamilyLine } from "./itemListPricing";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const V38 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v38.json`, import.meta.url));
const CFG: Record<string, RateCategoryConfig> = Object.fromEntries(V38.category_configs.map((c) => [c.category_id, c]));
const CONFIGS = new Map<string, RateCategoryConfig>(Object.entries(CFG));
const ITEMS: RateMasterItem[] = V38.items.map((it) => ({ ...it, discipline: V38.discipline } as RateMasterItem));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const ITEM_LIST = [INS, ADP, PIP] as const;
const KINDS = ["supply_rate", "install_rate", "combined_rate"] as const;
const NITRILE = "Nitrile Rubber Insulation";
const SEC = "insulation";
const INCH = '"';
const MARKS = [".", ",", ";", ":", " .", ".."];

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
/** The BoQ-ROW (panel) path: the model's stored answer through `extractionByRow`, the row's own unit. */
function panel(category: string, answer: Answer[], unit = "Rmt") {
  const row = { excelRow: 1, description: "", attributes: {}, items: answer.map((a) => stored(category, a)) } as unknown as ExtractionRow;
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
  const ctx = { excelRow: 1, description: "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS], unit, headings: [], ownNotes: [] } as RateHelperRowContext & { unit?: string };
  const r = h.compute(ctx, {});
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
const typedType = (word: string, size: string): ItemEdit => ({ base: null, family: word, attrs: { size_mm: size }, other: ["pipe_type", "size_mm"] });
const ins = (attrs: Record<string, string>, other: string[] = []): ItemEdit => ({ base: null, family: NITRILE, attrs, ...(other.length ? { other } : {}) });
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

// =====================================================================================================
// AC1 -- a full stop after a gauge mark no longer hides the gauge
// =====================================================================================================
describe("12e-4c AC1 -- a trailing mark never changes what a number reader reads ('26G.' is the gauge '26G', not a 26 mm thickness)", () => {
  const PLENUM = itemListPricingSpec(CFG[ADP])!.numbers.thickness_mm;
  const GAUGE = (raw: string) => ({ blank: `plenum thickness stated as '${raw}' -- a gauge, not a thickness` });

  it("the premise: ADP declares no gauge reader -- a gauge can only land on the plenum-thickness reader, which rejects the gauge words", () => {
    const numbers = itemListPricingSpec(CFG[ADP])!.numbers;
    expect(Object.keys(numbers).filter((k) => /gauge|swg/i.test(k) || /gauge/i.test(numbers[k].name))).toEqual([]);
    expect(PLENUM.reject_tokens).toEqual(["g", "gauge", "guage", "swg", "gi", "gss"]);
    expect(PLENUM.from).toEqual(["insulation_thickness_mm", "thickness_mm"]);
  });
  it("'26G.' and '24 G,' refuse as a gauge exactly as '26G' and '24 G' do -- BEFORE this slice '26G.' read as { value: 26 }", () => {
    expect(readNumber("26G", PLENUM)).toEqual(GAUGE("26G"));
    expect(readNumber("26G.", PLENUM)).toEqual(GAUGE("26G."));
    expect(readNumber("24 G", PLENUM)).toEqual(GAUGE("24 G"));
    expect(readNumber("24 G,", PLENUM)).toEqual(GAUGE("24 G,"));
  });
  it("every gauge word x every mark, glued to its number and apart from it (named: g, gauge, guage, swg, gi, gss x . , ; : ' .' '..')", () => {
    const WORDS = ["g", "gauge", "guage", "swg", "gi", "gss"];
    let n = 0;
    for (const w of WORDS) for (const mk of MARKS) for (const text of [`26${w}${mk}`, `26 ${w}${mk}`, `${w.toUpperCase()}${mk} 26`]) {
      n++;
      expect({ text, read: readNumber(text, PLENUM) }).toEqual({ text, read: GAUGE(text) });
    }
    expect(n).toBe(WORDS.length * MARKS.length * 3);
  });
  it("NEGATIVE: a real thickness keeps reading with a mark after it, and a decimal is not broken by the fix", () => {
    for (const mk of ["", ...MARKS]) {
      expect(readNumber(`25 mm${mk}`, PLENUM)).toEqual({ value: 25 });
      expect(readNumber(`25${mk}`, PLENUM)).toEqual({ value: 25 });
      expect(readNumber(`12.5 mm${mk}`, PLENUM)).toEqual({ value: 12.5 });
    }
    // a 0.8 mm sheet is still refused for being below 5 mm -- by the OTHER rule, with its own sentence
    expect(readNumber("0.8 mm.", PLENUM)).toEqual({ blank: "plenum thickness stated as '0.8 mm.' -- below 5 mm, a sheet gauge, not a thickness" });
    // a word that merely STARTS with a gauge letter is not a gauge: "25 mm glasswool." reads 25
    expect(readNumber("25 mm glasswool.", PLENUM)).toEqual({ value: 25 });
  });
  it("SWEEP: for every number reader of Insulation, ADP and Piping, a text and the same text with a trailing mark read alike (the quoted text aside)", () => {
    const FORMS = ["25 mm", "25", "12.5", "26G", "24 G", "20 SWG", `5/8${INCH}`, `1-1/4${INCH}`, "2 inch", "50 NB", "0.8", "19/25 mm", "19 / 25 / 32 mm", "10-12", "1:6", "600 x 600", "4 sqm", "10 Nm", "abc"];
    const covered: string[] = [];
    let n = 0;
    for (const cat of ITEM_LIST) for (const [attr, reader] of Object.entries(itemListPricingSpec(CFG[cat])!.numbers)) {
      covered.push(`${cat}.${attr}`);
      for (const f of FORMS) for (const mk of MARKS) {
        n++;
        const plain = JSON.stringify(readNumber(f, reader));
        const marked = JSON.stringify(readNumber(f + mk, reader)).split(JSON.stringify(f + mk).slice(1, -1)).join(JSON.stringify(f).slice(1, -1));
        expect({ cat, attr, f, mk, read: marked }).toEqual({ cat, attr, f, mk, read: plain });
      }
    }
    expect(covered).toEqual([
      "hvac_insulation.thickness_mm", "hvac_insulation.pipe_size_mm",
      "hvac_adp.dia_mm", "hvac_adp.neck_mm", "hvac_adp.face_w_mm", "hvac_adp.face_h_mm", "hvac_adp.depth_mm", "hvac_adp.slot_count", "hvac_adp.torque_nm",
      "hvac_adp.panel_ratio", "hvac_adp.thickness_mm", "hvac_adp.area_sqm",
      "hvac_piping.size_mm",
    ]);
    expect(n).toBe(covered.length * FORMS.length * MARKS.length);
  });
  it("MODEL path, from the panel: a double-skin plenum whose thickness the model copied as '26G.' refuses by name, as '26G' does; '25 mm.' prices", () => {
    const row = (t: string) => panel(ADP, [{ family: "double-skin plenum", thickness_mm: t }], "Sqm");
    const dot = row("26G."), plain = row("26G"), good = row("25 mm.");
    expect(plain.v.rowPriced).toBe(false);
    expect(dot.v.rowPriced).toBe(false);
    expect(dot.values).toEqual({});
    expect(shown(dot.v).join("\n")).toContain("plenum thickness stated as '26G.' -- a gauge, not a thickness");
    expect(shown(plain.v).join("\n")).toContain("plenum thickness stated as '26G' -- a gauge, not a thickness");
    expect(good.v.rowPriced).toBe(true);
    expect(good.values).toEqual(row("25 mm").values);
  });
  it("the TYPED path does not exist for this field: the calculator offers the plenum thickness as a dropdown, so nothing can be typed into it", () => {
    expect((CFG[ADP].list_spec as { pricing: { panel_controls: Record<string, string> } }).pricing.panel_controls.thickness_mm).toBe("dropdown");
  });
});

// =====================================================================================================
// AC2 -- Insulation's pipe size: a slash pair that is not an inch fraction is two sizes, the higher taken
// =====================================================================================================
describe("12e-4c AC2 -- Insulation's pipe size written as two sizes takes the higher, with Piping's own line; a real inch fraction stays inches", () => {
  const typed = (text: string) => compute(INS, { items: [ins({ cladding: "No", thickness_mm: "19", pipe_size_mm: text }, ["pipe_size_mm"])] });
  const model = (text: string) => panel(INS, [{ item: NITRILE, cladding: "None", thickness_mm: "19 mm", pipe_size_mm: text }]);
  const want = (size: string) => pure(INS, ins({ cladding: "No", thickness_mm: "19", pipe_size_mm: size }));

  it("'19/25' -> the higher, 25 -> 28.58 (next size up), 286 / 14, typed and read. BEFORE: 19/25 of an inch (19.3 mm) -> 22.23, 265 / 14", () => {
    expect(want("25")).toEqual([286, 14]);
    expect(want("22.23")).toEqual([265, 14]);
    for (const x of [typed("19/25"), model("19/25")]) {
      expect(x.v.rowPriced).toBe(true);
      expect(fig(x.values)).toEqual(want("25"));
      expect(field(x.v.items[0], "pipe_size_mm").value).toBe("28.58");
      // INVERTED at ADP-4a (owner D5 / AC3: the reading stated ONCE, on its field -- the notes below) by mechanical authority.
      // BEFORE: `expect(x.v.items[0].working).toContain("pipe size states two sizes (19 / 25) - the higher, 25, is taken")`.
      expect(x.v.items[0].working).not.toContain("pipe size states two sizes (19 / 25) - the higher, 25, is taken");
    }
    expect(field(typed("19/25").v.items[0], "pipe_size_mm").note).toBe("You typed 19/25: states two sizes (19 / 25) - the higher, 25, is taken -> priced as 28.58 mm (next size up)");
    expect(field(model("19/25").v.items[0], "pipe_size_mm").note).toBe("BoQ says 19/25: states two sizes (19 / 25) - the higher, 25, is taken -> priced as 28.58 mm (next size up)");
  });
  it("the pairs and lists a BoQ writes, each at the price of its higher / highest size alone (named)", () => {
    const CASES: Array<[string, string]> = [["19/25", "25"], ["19/25 mm", "25"], ["19/25 mm.", "25"], ["25/32", "32"], ["40/50", "50"], ["32/40mm.", "40"], ["19/ 25 / 32 mm", "32"], ["15/20", "20"]];
    for (const [text, taken] of CASES) {
      for (const x of [typed(text), model(text)]) expect({ text, values: fig(x.values) }).toEqual({ text, values: want(taken) });
      // INVERTED at ADP-4a (owner D5 / AC3) by mechanical authority. BEFORE: the working's line
      //   `toMatch(new RegExp(\`pipe size states (two|several) sizes .* - the high(er|est), ${taken}, is taken\`))`
      expect(String(field(model(text).v.items[0], "pipe_size_mm").note)).toMatch(new RegExp(`states (two|several) sizes .* - the high(er|est), ${taken}, is taken`));
      expect(shown(model(text).v).join("\n")).not.toMatch(/pipe size states (two|several) sizes/);
    }
  });
  it("NEGATIVE: a real inch fraction is ONE size and reads as inches as before -- 3/4, 7/8, 1-1/4, 1 1/4, with or without the inch mark", () => {
    const FRACTIONS: Array<[string, number]> = [["3/4", 19.05], [`3/4${INCH}`, 19.05], ["7/8", 22.225], ["1-1/4", 31.75], [`1 1/4${INCH}`, 31.75], ["5/8", 15.875]];
    const reader = itemListPricingSpec(CFG[INS])!.numbers.pipe_size_mm;
    for (const [text, mm] of FRACTIONS) {
      expect(slashSizes(text)).toBeNull();
      const read = readNumber(text, reader);
      expect(read && "value" in read ? read.value : null).toBeCloseTo(mm, 6);
      for (const x of [typed(text), model(text)]) {
        expect({ text, priced: x.v.rowPriced }).toEqual({ text, priced: true });
        expect(shown(x.v).join("\n")).not.toMatch(/states (two|several) sizes/);
        expect({ text, values: fig(x.values) }).toEqual({ text, values: want(String(mm)) });
      }
    }
  });
  it("NEGATIVE: one size is one size -- '25', '25 mm', '22.3' say nothing about two sizes and price as before (22.3 still lands on 22.23 within 0.1 mm)", () => {
    for (const text of ["25", "25 mm", "22.3", "50 NB"]) expect(shown(model(text).v).join("\n")).not.toMatch(/states (two|several) sizes/);
    expect(fig(model("22.3").values)).toEqual([265, 14]);
    expect(model("22.3").v.items[0].working).toContain("pipe size 22.3 is 22.23 on the sheet (within 0.1 mm)");
  });
  it("NEGATIVE: a form the ruling does not cover keeps a refusal that names the sizes ('25 x 3 / 32 x 3' -> pick one)", () => {
    const x = model("25 x 3 / 32 x 3");
    expect(x.v.rowPriced).toBe(false);
    expect(shown(x.v).join("\n")).toContain("pipe size states several sizes (25 / 3 / 32 / 3) - pick one");
  });
  it("NEGATIVE: the rule rides on `inches: true` -- only Insulation's pipe size and Piping's size declare it; ADP's neck '100/150' is read by its own reader as before", () => {
    const declaring: string[] = [];
    for (const cat of ITEM_LIST) for (const [attr, r] of Object.entries(itemListPricingSpec(CFG[cat])!.numbers)) if (r.inches === true) declaring.push(`${cat}.${attr}`);
    expect(declaring).toEqual(["hvac_insulation.pipe_size_mm", "hvac_piping.size_mm"]);
    expect(readNumber("100/150", itemListPricingSpec(CFG[ADP])!.numbers.neck_mm)).toEqual({ value: 150, note: "'100/150' states two values -- the higher, 150, is taken" });
    // and Insulation's THICKNESS (no `inches`) keeps its own wording for a pair
    expect(readNumber("13/19 mm", itemListPricingSpec(CFG[INS])!.numbers.thickness_mm)).toEqual({ value: 19, note: "'13/19 mm' states two values -- the higher, 19, is taken" });
  });
  it("the Piping section alike: a pipe size TYPED in the section as '19/25' takes 25; on the model path the section's size is the pipe's own ('from pipe')", () => {
    const sec = (text: string) => compute(PIP, { items: [pipe("MS", "50", { insulated: "Yes" }, { [SEC]: ins({ cladding: "No", thickness_mm: "19", pipe_size_mm: text }, ["pipe_size_mm"]) })] });
    const a = sec("19/25"), b = sec("25");
    expect(attached(a.v).view.totals).toEqual(attached(b.v).view.totals);
    // INVERTED at ADP-4a (owner D5 / AC3; an Insulation block reads the same in a Piping section) by mechanical authority.
    // BEFORE: `expect(secBlock(attached(a.v)).working).toContain("pipe size states two sizes (19 / 25) - the higher, 25, is taken")`.
    expect(String(field(secBlock(attached(a.v)), "pipe_size_mm").note)).toContain("states two sizes (19 / 25) - the higher, 25, is taken");
    expect(secBlock(attached(a.v)).working).not.toContain("pipe size states two sizes (19 / 25) - the higher, 25, is taken");
    expect(fig(a.values)).toEqual(fig(b.values));
    const m = panel(PIP, [{ pipe_type: "MS", size_mm: "50 mm", insulated: "Yes" }, { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "19", pipe_size_mm: "19/25" }]);
    const mPlain = panel(PIP, [{ pipe_type: "MS", size_mm: "50 mm", insulated: "Yes" }, { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "19", pipe_size_mm: "25" }]);
    // On the MODEL path the section's pipe size is never the model's own answer: it is mirrored "from pipe" (12e-3a,
    // F-1) -- so a pair written there is not read at all, and the two rows are the same row.
    expect(fig(m.values)).toEqual(fig(mPlain.values));
    const f = field(secBlock(attached(m.v)), "pipe_size_mm");
    expect({ tag: f.mirrorTag, typed: f.typedValue }).toEqual({ tag: "from pipe", typed: "50" });
    expect(JSON.stringify(secBlock(attached(m.v)).working)).not.toMatch(/states two sizes/);
  });
  it("NEGATIVE: Piping's own two-sizes rule is unchanged by sharing the branch -- MS '25/32' still prices 32, with the same line and field note", () => {
    const x = compute(PIP, { items: [pipe("MS", "25/32")] });
    expect(fig(x.values)).toEqual(pure(PIP, pipe("MS", "32")));
    expect(field(x.v.items[0], "size_mm").note).toBe("You typed 25/32: states two sizes (25 / 32) - the higher, 32, is taken");
  });
});

// =====================================================================================================
// AC3 -- a typed pipe type says "You typed", never "BoQ says"
// =====================================================================================================
describe("12e-4c AC3 -- 'BoQ says' only where a BoQ said it: a pipe type the pricer typed reads 'You typed uPVC -> priced as PVC'", () => {
  const typed = (word: string, size = "25") => compute(PIP, { items: [typedType(word, size)] });
  const asWritten = (word: string, size = "25") => panel(PIP, [{ pipe_type_as_written: word, size_mm: size }]);

  it("typed uPVC, GI, HDPE and 'MS / GI': the line opens 'You typed', on the block and in its working; the price is the mapped type's", () => {
    const CASES: Array<[string, string, string]> = [["uPVC", "PVC", "You typed uPVC -> priced as PVC"], ["GI", "MS", "You typed GI -> priced as MS"], ["HDPE", "PVC", "You typed HDPE -> priced as PVC"], ["MS / GI", "MS", "You typed MS / GI -> priced as MS"]];
    for (const [word, family, line] of CASES) {
      const x = typed(word);
      expect({ word, family: x.v.items[0].family, line: x.v.items[0].familyLine }).toEqual({ word, family, line });
      expect(x.v.items[0].working).toContain(line);
      expect(shown(x.v).filter((l) => /^BoQ (says|names) /.test(l))).toEqual([]);
      expect(fig(x.values)).toEqual(pure(PIP, pipe(family, "25")));
    }
    expect(fig(typed("uPVC").values)).toEqual([120, 28]);
  });
  it("NEGATIVE: the same words READ BY THE MODEL keep 'BoQ says' / 'BoQ names' -- as written, and as the pipe-type answer itself", () => {
    expect(asWritten("uPVC").v.items[0].familyLine).toBe("BoQ says uPVC -> priced as PVC");
    expect(asWritten("GI").v.items[0].familyLine).toBe("BoQ says GI -> priced as MS");
    expect(asWritten("MS / GI").v.items[0].familyLine).toBe("BoQ names MS / GI -> priced as MS");
    expect(panel(PIP, [{ pipe_type: "GI", size_mm: "25" }]).v.items[0].familyLine).toBe("BoQ says GI -> priced as MS");
    // the price is the same whoever said it
    expect(fig(asWritten("uPVC").values)).toEqual(fig(typed("uPVC").values));
  });
  it("NEGATIVE: a stocked type typed or picked carries no line at all, and a refused word keeps its own sentence (no 'You typed' is invented)", () => {
    expect(typed("PVC").v.items[0].familyLine).toBeUndefined();
    expect(compute(PIP, { items: [pipe("PVC", "25")] }).v.items[0].familyLine).toBeUndefined();
    const ss = typed("SS");
    expect(ss.v.rowPriced).toBe(false);
    expect(ss.v.items[0].reason).toBe("No SKU in the catalogue for SS pipe - price this row by hand");
  });
  it("`typedFamilyLine` re-opens only the two family leads and nothing else", () => {
    expect(typedFamilyLine("BoQ says uPVC -> priced as PVC (owner rule)")).toBe("You typed uPVC -> priced as PVC (owner rule)");
    expect(typedFamilyLine("BoQ names MS / GI -> priced as MS")).toBe("You typed MS / GI -> priced as MS");
    expect(typedFamilyLine("pipe size 25 is not on the sheet")).toBe("pipe size 25 is not on the sheet");
    expect(typedFamilyLine("the BoQ says nothing")).toBe("the BoQ says nothing");
  });
  it("SWEEP (named): every field a pricer can type in the three calculators -- nothing typed is ever introduced with 'BoQ says' or 'BoQ names'", () => {
    const CASES: Array<[string, string, ItemListEditState, string]> = [
      ["Piping: a mapped type + a typed size that ladders", PIP, { items: [{ base: null, family: "uPVC", attrs: { size_mm: "110" }, other: ["pipe_type", "size_mm"] }] }, "mts"],
      ["Piping: a typed inch size", PIP, { items: [pipe("Copper", `5/8${INCH}`)] }, "mts"],
      ["Piping: a typed pair", PIP, { items: [pipe("MS", "25/32 mm")] }, "mts"],
      ["Piping: a typed class", PIP, { items: [pipe("MS", "50", { pipe_class: "C class" })] }, "mts"],
      ["Piping: a typed section (thickness, cladding, its own pipe size)", PIP, { items: [pipe("MS", "50", { insulated: "Yes" }, { [SEC]: ins({ cladding: "No", thickness_mm: "20", pipe_size_mm: "19/25" }, ["thickness_mm", "pipe_size_mm"]) })] }, "mts"],
      ["Insulation: a typed thickness that ladders + a typed pipe size", INS, { items: [ins({ cladding: "No", thickness_mm: "20", pipe_size_mm: "22.3" }, ["thickness_mm", "pipe_size_mm"])] }, "mts"],
      ["Insulation: a typed pair of pipe sizes", INS, { items: [ins({ cladding: "No", thickness_mm: "19", pipe_size_mm: "19/25" }, ["pipe_size_mm"])] }, "mts"],
      ["ADP: typed face sizes", ADP, { items: [{ base: null, family: "fire damper", attrs: { ul: "yes", face_w_mm: "600", face_h_mm: "600" } }] }, "nos"],
    ];
    const covered: string[] = [];
    for (const [label, cat, state, unit] of CASES) {
      const { v } = compute(cat, state, unit);
      covered.push(label);
      expect({ label, boq: shown(v).filter((l) => /\bBoQ (says|names)\b/.test(l)) }).toEqual({ label, boq: [] });
    }
    expect(covered).toHaveLength(8);
  });
});
