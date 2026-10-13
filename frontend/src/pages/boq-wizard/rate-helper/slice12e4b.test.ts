/**
 * SLICE 12e-4b (owner rulings D-1 / D-2 / D-3, F-1 / F-2 / F-3, decisions 1-4 and 6-9, G1-G3; 2026-10-13) --
 * PIPING: THE SECTION MARKER, "PIPE TYPE AS WRITTEN", THE SIZE FIXES AND THE WORDING FIXES. No model is asked
 * anywhere here: a model answer is a stored item written by hand. Every rule is tested from the PANEL'S ENTRY
 * POINT (`makePricingSheetHelper(...).compute`), and every figure is checked against the PURE pricer over the
 * same inputs.
 *
 *   AC3 (D-2)   an item belongs to a section when its `section` equals the section's id -- nothing else.
 *   AC4 (D-3)   "Pipe type as written" prices or refuses exactly as the same word typed in the "Other..." box;
 *               an answered pipe type wins; the line shows only where it differs from the type priced.
 *   AC5 (F-1)   Insulation's pipe size takes a stocked size within 0.1 mm, with its line -- the Insulation
 *               category and the Piping section alike; its thickness ladder is untouched.
 *   AC6 (F-2)   a trailing full stop, comma, semicolon or colon never stops a size from reading.
 *   AC7 (F-3)   a bare number below the smallest stocked size that could be an inch size refuses; the size
 *               taken from a unit-less pair goes through the same check (both ruled in the run).
 *   AC8 (G1-G3) a default is named as the default, no working line repeats itself, a field reads by its label.
 *   AC11        the Derivation tab says the new rules, generated from the config.
 *
 * What each block protects is said in its `describe`. Negative halves sit beside every positive.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { itemListRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import { onceOnly, plainPricerText } from "@/pages/pricing/rate-master/plainEnglish";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, assembleItems, decodeItemEdits, makePricingSheetHelper, unitChoicesOf,
  type ItemBlockView, type ItemEdit, type ItemFieldView, type ItemListEditState, type ItemListSuggestion, type ItemListView,
  type SectionBlockView,
} from "./pricingSheetHelper";
import {
  BARE_NUMBER_RE, TYPED_THICKNESS_MESSAGE, familyAttr, isOneSizeEntry, itemListPricingSpec, listSpecDefs, noUnitMessage, priceItemList,
  readFamilyWord, readNumber, severalSizesPick, withoutTrailingPunctuation,
} from "./itemListPricing";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const V37 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v37.json`, import.meta.url));
const CFG37: Record<string, RateCategoryConfig> = Object.fromEntries(V37.category_configs.map((c) => [c.category_id, c]));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const AS_WRITTEN = "pipe_type_as_written";
const SS_SENTENCE = "No SKU in the catalogue for SS pipe - price this row by hand";

/**
 * WHAT THIS SLICE ADDS TO THE TWO CONFIGS, as far as the frontend reads them (the model notes are the asset's
 * and are not read here): the as-written definition after Pipe type, where the pricer reads it, the read-only
 * line, "Stainless steel" in the refuse list, the second opinion on -- and Insulation's one key. Applied to v37
 * in memory; the mint (`scripts/_instruments/mint_hvac_v34_piping.py questions`) writes the same keys.
 */
function withSliceKeys(base: Record<string, RateCategoryConfig>): Record<string, RateCategoryConfig> {
  const out = structuredClone(base) as Record<string, any>;
  const ls = out[PIP].list_spec;
  const at = ls.attribute_definitions.findIndex((d: { id: string }) => d.id === "pipe_type");
  ls.attribute_definitions.splice(at + 1, 0, { id: AS_WRITTEN, label: "Pipe type as written", type: "text" });
  ls.second_opinion = true;
  ls.pricing.family_text.refuse.push({ from: "Stainless steel", refuse: SS_SENTENCE, rule: "Q16 SS refuses (owner 2026-10-10); 'Stainless steel' spelled out joins it (owner 2026-10-13)" });
  ls.pricing.family_text.from_attr = AS_WRITTEN;
  ls.pricing.panel_readonly = [AS_WRITTEN];
  out[INS].list_spec.pricing.numbers.pipe_size_mm.near = 0.1;
  return out as Record<string, RateCategoryConfig>;
}
const CFG: Record<string, RateCategoryConfig> = withSliceKeys(CFG37);
const CONFIGS = new Map<string, RateCategoryConfig>(Object.entries(CFG));
const CONFIGS37 = new Map<string, RateCategoryConfig>(Object.entries(CFG37));
const ITEMS: RateMasterItem[] = V37.items.map((it) => ({ ...it, discipline: V37.discipline } as RateMasterItem));
const ITEM_LIST = [INS, ADP, PIP] as const;
const KINDS = ["supply_rate", "install_rate", "combined_rate"] as const;
const NITRILE = "Nitrile Rubber Insulation", PUF = "Tubular Puf Insulation";
const SEC = "insulation";
const INCH = '"';

type Answer = Record<string, string | null>;
type World = { configs?: Map<string, RateCategoryConfig>; description?: string; headings?: string[]; ownNotes?: string[] };
/** A model answer AS THE RUN STORES IT: every definition of the item's own kind present (a value or null), and
 * the `section` marker on the ITEM, beside its attributes, for an item answered from a section's questions. */
function stored(configs: Map<string, RateCategoryConfig>, category: string, a: Answer): { attributes: ExtractionRow["attributes"]; section?: string } {
  const { section, ...given } = a;
  const own = section ? listSpecDefs(configs.get((itemListPricingSpec(configs.get(category)!)!.sections ?? []).find((s) => s.id === section)?.category_id ?? "")!) : listSpecDefs(configs.get(category)!);
  const attributes: Record<string, { value: string | null; confidence: number }> = {};
  for (const d of own) attributes[d.id] = { value: null, confidence: 0 };
  for (const [k, v] of Object.entries(given)) attributes[k] = { value: v, confidence: 0.9 };
  return { attributes: attributes as ExtractionRow["attributes"], ...(section ? { section } : {}) };
}
/** The CALCULATOR path: an empty extraction map; the whole edit state is the override; the unit is a pick. */
function compute(category: string, state: ItemListEditState, unit = "mts", configs = CONFIGS) {
  const h = makePricingSheetHelper({ configsByCategory: configs, items: ITEMS, extractionByRow: new Map() });
  const ctx: RateHelperRowContext = { excelRow: 1, description: "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS] };
  const r = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: unit });
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, values: s.values };
}
/** The BoQ-ROW (panel) path: the model's stored answer through `extractionByRow`, the row's own unit and words. */
function panel(category: string, answer: Answer[], state?: ItemListEditState, unit = "Rmt", w: World = {}) {
  const configs = w.configs ?? CONFIGS;
  const row = { excelRow: 1, description: w.description ?? "", attributes: {}, items: answer.map((a) => stored(configs, category, a)) } as unknown as ExtractionRow;
  const h = makePricingSheetHelper({ configsByCategory: configs, items: ITEMS, extractionByRow: new Map([[1, row]]) });
  const ctx = { excelRow: 1, description: w.description ?? "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS], unit,
                headings: w.headings ?? [], ownNotes: w.ownNotes ?? [] } as RateHelperRowContext & { unit?: string };
  const r = h.compute(ctx, state ? { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state) } : {});
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, values: s.values };
}
/** The PURE pricer over ONE hand-entered item of a category: what the figure must equal, whatever the screen. */
function pure(category: string, edit: ItemEdit, unit = "mts", cfgs = CFG): [number | undefined, number | undefined] {
  const spec = itemListPricingSpec(cfgs[category])!;
  const assembled = assembleItems(decodeItemEdits(JSON.stringify({ items: [edit] }), 0), [], familyAttr(spec));
  const r = priceItemList(spec, ITEMS, unit, assembled, "", "");
  return [r.supply ?? undefined, r.install ?? undefined];
}
const field = (b: ItemBlockView, id: string) => b.fields.find((f) => f.id === id)!;
const fig = (values: Partial<Record<string, number>> | undefined): [number | undefined, number | undefined] => [values?.supply_rate, values?.install_rate];
const attached = (v: ItemListView, at = 0): SectionBlockView => v.items[at].sections![0];
const secBlock = (sv: SectionBlockView): ItemBlockView => sv.view.items[0];
const pipe = (family: string, size: string, more: Record<string, string> = {}, sections?: Record<string, ItemEdit>, qty?: string): ItemEdit =>
  ({ base: null, family, attrs: { size_mm: size, ...more }, other: ["size_mm"], ...(sections ? { sections } : {}), ...(qty !== undefined ? { qty } : {}) });
/** A pipe type TYPED through the family field's "Other..." box (the family id rides in `other`, as a size field's does). */
const typedType = (word: string, size: string): ItemEdit => ({ base: null, family: word, attrs: { size_mm: size }, other: ["pipe_type", "size_mm"] });
const ins = (family: string | null, attrs: Record<string, string> = {}, other: string[] = []): ItemEdit => ({ base: null, family, attrs, ...(other.length ? { other } : {}) });
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
/** What a field's control puts on screen: the select's matching option, the "Other..." box, or the plain box. */
function onScreen(f: ItemFieldView): string {
  if (!f.options) return f.value;
  if (f.allowOther && f.otherMode) return f.typedValue;
  return f.options.includes(f.value) ? f.value : "";
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-4b AC3 (D-2) -- an item belongs to a section when its `section` equals the section's id", () => {
  const COPPER = { pipe_type: "Copper", size_mm: `5/8${INCH}` };
  const NIT13 = { section: SEC, item: NITRILE, cladding: "26G Aluminium", thickness_mm: "13" };
  it("a MARKED item, in the shape the parser stores (Insulation's six ids, the marker on the item), opens under its pipe and prices by Insulation's rules", () => {
    const { v, values } = panel(PIP, [COPPER, NIT13]);
    expect(v.items).toHaveLength(1);                                         // the insulation item is NOT drawn as a pipe
    expect(field(v.items[0], "insulated").value).toBe("Yes");                // facts present -> Yes
    const sb = secBlock(attached(v));
    expect(sb.family).toBe(NITRILE);
    expect(fig(sb.figures)).toEqual(pure(INS, ins(NITRILE, { cladding: "26G Aluminium", thickness_mm: "13", pipe_size_mm: "15.875" }, ["pipe_size_mm"])));
    expect(fig(sb.figures)).toEqual([324, 224]);
    expect(fig(values)).toEqual([1298 + 324, 220 + 224]);
    expect(field(sb, "pipe_size_mm").mirrorTag).toBe("from pipe");           // the mirror is unchanged
    expect(sb.qtyMirrorTag).toBe("from pipe");                               // and so is the quantity link
  });
  it("NEGATIVE: the same facts with NO marker are not a section -- the item is a second, blank pipe block and the row needs a person (BEFORE 12e-4b it was sorted by lacking pipe_type)", () => {
    const unmarked = { attributes: Object.fromEntries(Object.entries({ item: NITRILE, cladding: "26G Aluminium", thickness_mm: "13" }).map(([k, x]) => [k, { value: x, confidence: 0.9 }])) };
    const row = { excelRow: 1, description: "", attributes: {}, items: [stored(CONFIGS, PIP, COPPER), unmarked] } as unknown as ExtractionRow;
    const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
    const r = h.compute({ excelRow: 1, description: "", nodeType: "Line Item", category: PIP, discipline: "HVAC", rateKinds: [...KINDS], unit: "Rmt" } as RateHelperRowContext, {}) as ItemListSuggestion;
    const v = r.itemList!;
    expect(v.items).toHaveLength(2);
    expect(v.items[0].sections).toBeUndefined();
    expect(field(v.items[0], "insulated").value).toBe("No");
    expect(v.items[1].reason).toBe("no pipe type could be told for this item");
    expect(v.rowPriced).toBe(false);
  });
  it("NEGATIVE (decision 6): a marker naming NO declared section is a main item -- kept visible as a blank block, never dropped, never guessed into a section", () => {
    // the item is built by hand, exactly as a marker the config does not declare would arrive
    const row = { excelRow: 1, description: "", attributes: {}, items: [stored(CONFIGS, PIP, COPPER), { section: "lagging", attributes: { item: { value: NITRILE, confidence: 0.9 } } }] } as unknown as ExtractionRow;
    const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
    const r = h.compute({ excelRow: 1, description: "", nodeType: "Line Item", category: PIP, discipline: "HVAC", rateKinds: [...KINDS], unit: "Rmt" } as RateHelperRowContext, {}) as ItemListSuggestion;
    expect(r.itemList!.items).toHaveLength(2);
    expect(r.itemList!.items[0].sections).toBeUndefined();
    expect(r.itemList!.items[1].state).toBe("blank");
    expect(r.itemList!.sections!.independent).toHaveLength(0);
  });
  it("the k-th marked item goes under the k-th pipe, wherever it sits in the list; an extra one is independent; with no pipe it is independent", () => {
    const P1 = { pipe_type: "Copper", size_mm: "15.9 mm O.D" }, P2 = { pipe_type: "Copper", size_mm: "22.3 mm O.D" };
    const I1 = { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "13" }, I2 = { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "19" };
    for (const order of [[P1, P2, I1, I2], [P1, I1, P2, I2]]) {
      const { v, values } = panel(PIP, order);
      expect(v.items).toHaveLength(2);
      expect(field(secBlock(attached(v, 0)), "thickness_mm").value).toBe("13");
      expect(field(secBlock(attached(v, 1)), "thickness_mm").value).toBe("19");
      const lines = [fig(v.items[0].figures), fig(secBlock(attached(v, 0)).figures), fig(v.items[1].figures), fig(secBlock(attached(v, 1)).figures)];
      expect(lines).toEqual([[1298, 220], pure(INS, ins(NITRILE, { cladding: "No", thickness_mm: "13", pipe_size_mm: "15.9" }, ["pipe_size_mm"])),
                             [1814, 220], pure(INS, ins(NITRILE, { cladding: "No", thickness_mm: "19", pipe_size_mm: "22.3" }, ["pipe_size_mm"]))]);
      expect(fig(values)).toEqual([lines.reduce((n, l) => n + l[0]!, 0), lines.reduce((n, l) => n + l[1]!, 0)]);
    }
    const extra = panel(PIP, [P1, I1, { section: SEC, item: PUF, cladding: "No", thickness_mm: "25", pipe_size_mm: "40" }]);
    expect(extra.v.sections!.independent).toHaveLength(1);
    expect(secBlock(extra.v.sections!.independent[0]).family).toBe(PUF);
    const alone = panel(PIP, [{ section: SEC, item: NITRILE, cladding: "No", thickness_mm: "13", pipe_size_mm: "15.88" }]);
    expect(alone.v.items).toHaveLength(0);
    expect(alone.v.sections!.independent).toHaveLength(1);
    expect(fig(alone.values)).toEqual([216, 14]);
  });
  it("NEGATIVE: a category that declares no section never reads the marker -- a marked Insulation or ADP item prices exactly as the unmarked one", () => {
    for (const [cat, a, unit] of [[INS, { item: NITRILE, cladding: "No", thickness_mm: "13", pipe_size_mm: "15.88" }, "Rmt"],
                                  [ADP, { family: "round diffuser", damper: "None", dia_mm: "200" }, "nos"]] as const) {
      const plain = panel(cat, [a as Answer], undefined, unit);
      const row = { excelRow: 1, description: "", attributes: {}, items: [{ ...stored(CONFIGS, cat, a as Answer), section: SEC }] } as unknown as ExtractionRow;
      const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
      const marked = h.compute({ excelRow: 1, description: "", nodeType: "Line Item", category: cat, discipline: "HVAC", rateKinds: [...KINDS], unit } as RateHelperRowContext, {}) as ItemListSuggestion;
      expect(marked.values).toEqual(plain.values);
      expect(marked.itemList!.items.map((b) => b.working)).toEqual(plain.v.items.map((b) => b.working));
      expect(plain.v.rowPriced).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-4b AC4 (D-3) -- 'Pipe type as written' is read by the ONE reader a typed word goes through", () => {
  const asWritten = (word: string, size = "25", more: Answer = {}, w: World = {}) => panel(PIP, [{ [AS_WRITTEN]: word, size_mm: size, ...more }], undefined, "Rmt", w);
  const typed = (word: string, size = "25") => compute(PIP, { items: [typedType(word, size)] });
  const readOnly = (v: ItemListView) => v.items[0].readOnly;

  it("uPVC with no pipe type answered -> priced as PVC, with the config's line, at PVC's own price; the word is shown read-only", () => {
    const { v, values } = asWritten("uPVC", "25 mm dia");
    expect(v.items[0].family).toBe("PVC");
    expect(v.items[0].familyLine).toBe("BoQ says uPVC -> priced as PVC");
    expect(fig(values)).toEqual(pure(PIP, pipe("PVC", "25")));
    expect(fig(values)).toEqual([120, 28]);
    expect(readOnly(v)).toEqual([{ id: AS_WRITTEN, label: "Pipe type as written", value: "uPVC" }]);
    // the as-written word is never a field a pricer types into, and never a dropdown
    expect(v.items[0].fields.map((f) => f.id)).not.toContain(AS_WRITTEN);
  });
  it("decision 3: an ANSWERED pipe type wins over a disagreeing word -- MS + 'SS' prices MS; the word is still shown because it differs", () => {
    const { v, values } = panel(PIP, [{ pipe_type: "MS", [AS_WRITTEN]: "SS", size_mm: "50" }]);
    expect(v.items[0].family).toBe("MS");
    expect(fig(values)).toEqual(pure(PIP, pipe("MS", "50")));
    expect(v.items[0].familyLine).toBeUndefined();
    expect(readOnly(v)).toEqual([{ id: AS_WRITTEN, label: "Pipe type as written", value: "SS" }]);
  });
  it("decision 2: the word is shown ONLY where it differs from the type priced -- 'copper' beside Copper, 'MS' beside MS and 'cpvc' beside CPVC show nothing", () => {
    for (const [type, word, size] of [["Copper", "copper", "15.9"], ["MS", "MS", "50"], ["CPVC", " cpvc ", "25"]] as const) {
      const { v } = panel(PIP, [{ pipe_type: type, [AS_WRITTEN]: word, size_mm: size }]);
      expect({ type, readOnly: readOnly(v), priced: v.rowPriced }).toEqual({ type, readOnly: [], priced: true });
    }
    // ... and a word that resolves to the same type with nothing answered ("copper" alone) shows nothing either
    const alone = asWritten("copper", "15.9");
    expect(alone.v.items[0].family).toBe("Copper");
    expect(readOnly(alone.v)).toEqual([]);
    expect(alone.v.items[0].familyLine).toBeUndefined();
  });
  it("the order: the row's OWN words are read before the as-written word (the existing rule, unmoved)", () => {
    const { v, values } = asWritten("uPVC", "50", {}, { description: "GI B class pipe 50 mm" });
    expect(v.items[0].family).toBe("MS");
    expect(v.items[0].familyLine).toBe("BoQ names GI -> priced as MS");
    expect(fig(values)).toEqual(pure(PIP, pipe("MS", "50")));
    // a HEADING never does that -- only the row's own text -- so under a GI heading the as-written word decides
    const heading = asWritten("uPVC", "50", {}, { description: "50 mm dia", headings: ["GI piping"] });
    expect(heading.v.items[0].family).toBe("PVC");
  });
  it("SS, 'Stainless steel' (decision 4) and a refused word inside a longer text all refuse with the SS sentence; any other word refuses by name; nothing at all -> the old sentence", () => {
    for (const word of ["SS", "ss", "Stainless steel", "STAINLESS STEEL", "SS 304", "stainless steel pipe"]) {
      const { v } = asWritten(word);
      expect({ word, priced: v.rowPriced, reason: v.items[0].reason }).toEqual({ word, priced: false, reason: SS_SENTENCE });
    }
    expect(asWritten("ABS").v.items[0].reason).toBe("no SKU in the catalogue for 'ABS' -- the user decides");
    expect(panel(PIP, [{ size_mm: "25" }]).v.items[0].reason).toBe("no pipe type could be told for this item");
    expect(panel(PIP, [{ [AS_WRITTEN]: "None", size_mm: "25" }]).v.items[0].reason).toBe("no pipe type could be told for this item");
    expect(panel(PIP, [{ [AS_WRITTEN]: "   ", size_mm: "25" }]).v.items[0].reason).toBe("no pipe type could be told for this item");
  });
  it("a word holding several names: all on one type price as it ('MS / GI' -> MS); two different types refuse naming them ('uPVC/ CPVC')", () => {
    const one = asWritten("MS / GI", "50");
    expect(one.v.items[0].family).toBe("MS");
    expect(one.v.items[0].familyLine).toBe("BoQ names MS / GI -> priced as MS");
    expect(fig(one.values)).toEqual(pure(PIP, pipe("MS", "50")));
    const two = asWritten("uPVC/ CPVC");
    expect(two.v.rowPriced).toBe(false);
    expect(two.v.items[0].reason).toBe("two pipe types are named in this row (CPVC, uPVC) - pick the type");
  });

  const PARITY = ["GI", "uPVC", "HDPE", "SS", "Stainless steel", "MS / GI", "uPVC/ CPVC"];
  it.each(PARITY.map((w) => [w] as const))("PARITY: '%s' as written == the same word typed in the calculator's Other... box -- type, line, refusal, figures and working", (word) => {
    const a = asWritten(word, "50", {}, {});
    const t = typed(word, "50");
    // the type PRICED (a refused row prices none: there the typed word heads the block because it sits in the
    // type box, while the as-written word sits on its read-only line -- the one named difference, checked below)
    const facts = (x: { v: ItemListView; values: ItemListSuggestion["values"] }) => ({
      priced: x.v.rowPriced, values: x.values, family: x.v.rowPriced ? x.v.items[0].family : null, familyLine: x.v.items[0].familyLine ?? null,
      reason: x.v.items[0].reason ?? null, working: x.v.items[0].working, size: field(x.v.items[0], "size_mm")?.value ?? null,
    });
    expect(facts(a)).toEqual(facts(t));
    if (!a.v.rowPriced) {
      expect({ typedHeads: t.v.items[0].family, asWrittenHeads: a.v.items[0].family, shown: a.v.items[0].readOnly.map((r) => r.value) })
        .toEqual({ typedHeads: word, asWrittenHeads: null, shown: [word] });
    }
    // and both equal the pure reader's verdict on the bare word
    const verdict = readFamilyWord(itemListPricingSpec(CFG[PIP])!, word);
    if (verdict && "refuse" in verdict) expect(a.v.items[0].reason).toBe(verdict.refuse);
    else expect(a.v.items[0].family).toBe(verdict!.family);
  });
  it("the parity set is named, and it is not vacuous: four of the seven price, three refuse, and the priced ones are not all one type", () => {
    const outcomes = Object.fromEntries(PARITY.map((w) => { const { v } = asWritten(w, "50"); return [w, v.rowPriced ? v.items[0].family : "refuses"]; }));
    expect(outcomes).toEqual({ GI: "MS", uPVC: "PVC", HDPE: "PVC", SS: "refuses", "Stainless steel": "refuses", "MS / GI": "MS", "uPVC/ CPVC": "refuses" });
  });
  it("NEGATIVE: a config that does not name the attribute (v37) reads nothing from it -- the row keeps 'no pipe type could be told'; the typed word is unchanged there", () => {
    const row = { excelRow: 1, description: "", attributes: {}, items: [{ attributes: { pipe_type: { value: null, confidence: 0 }, [AS_WRITTEN]: { value: "uPVC", confidence: 0.9 }, size_mm: { value: "25", confidence: 0.9 } } }] } as unknown as ExtractionRow;
    const h = makePricingSheetHelper({ configsByCategory: CONFIGS37, items: ITEMS, extractionByRow: new Map([[1, row]]) });
    const r = h.compute({ excelRow: 1, description: "", nodeType: "Line Item", category: PIP, discipline: "HVAC", rateKinds: [...KINDS], unit: "Rmt" } as RateHelperRowContext, {}) as ItemListSuggestion;
    expect(r.itemList!.items[0].reason).toBe("no pipe type could be told for this item");
    expect(r.itemList!.items[0].readOnly).toEqual([]);
    expect(fig(compute(PIP, { items: [typedType("uPVC", "25")] }, "mts", CONFIGS37).values)).toEqual([120, 28]);
    // v37's refuse list holds SS alone: "Stainless steel" spelled out is this slice's config key, not code
    expect(compute(PIP, { items: [typedType("Stainless steel", "25")] }, "mts", CONFIGS37).v.items[0].reason).toBe("no SKU in the catalogue for 'Stainless steel' -- the user decides");
  });
  it("the pure reader, step by step: exact first, then several names, then a refused word inside a text, then nothing", () => {
    const spec = itemListPricingSpec(CFG[PIP])!;
    expect(readFamilyWord(spec, "cpvc")).toEqual({ family: "CPVC" });
    expect(readFamilyWord(spec, "HDPE")).toMatchObject({ family: "PVC", line: "BoQ says HDPE -> priced as PVC (owner rule)" });
    expect(readFamilyWord(spec, "MS / GI")).toMatchObject({ family: "MS", line: "BoQ names MS / GI -> priced as MS" });
    expect(readFamilyWord(spec, "SS 316L seamless")).toMatchObject({ refuse: SS_SENTENCE });
    expect(readFamilyWord(spec, "ABS")).toBeNull();
    expect(readFamilyWord(spec, "")).toBeNull();
    expect(readFamilyWord(spec, null)).toBeNull();
    // NEGATIVE: "pressure" and "class" hold "ss" but not at a word start -- never the SS sentence
    expect(readFamilyWord(spec, "pressure class 6")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-4b AC5 (F-1) -- Insulation's pipe size takes a stocked size within 0.1 mm, with its line", () => {
  const LINE = "pipe size 22.3 is 22.23 on the sheet (within 0.1 mm)";
  const nitrile = (size: string, thickness = "19", cladding = "No") => ins(NITRILE, { cladding, thickness_mm: thickness, pipe_size_mm: size }, ["pipe_size_mm"]);
  it("Calculator -> Insulation: Nitrile, cladding No, thickness 19, pipe Other 22.3 -> the 22.23 SKU, 265 / 14, with the line; BEFORE it bought the next size up (28.58, 286 / 14)", () => {
    const { v, values } = compute(INS, { items: [nitrile("22.3")] });
    expect(fig(values)).toEqual([265, 14]);
    expect(fig(values)).toEqual(pure(INS, nitrile("22.23")));
    expect(v.items[0].working).toContain(LINE);
    const f = field(v.items[0], "pipe_size_mm");
    expect(f.value).toBe("22.23");
    expect(f.typedValue).toBe("22.3");
    expect(f.note).toBe("You typed 22.3 mm -> priced as 22.23 mm (the sheet's own spelling of this size)");
    // BEFORE (the v37 config, the same code): no key, no match -- the next size up
    const before = compute(INS, { items: [nitrile("22.3")] }, "mts", CONFIGS37);
    expect(fig(before.values)).toEqual([286, 14]);
    expect(field(before.v.items[0], "pipe_size_mm").value).toBe("28.58");
    expect(before.v.items[0].working.join(" | ")).not.toContain("within 0.1");
  });
  it("on a BoQ row the model's 22.3 reads the same way: 'BoQ says', the same line, the same figure", () => {
    const { v, values } = panel(INS, [{ item: NITRILE, cladding: "None", thickness_mm: "19", pipe_size_mm: "22.3 mm" }]);
    expect(fig(values)).toEqual([265, 14]);
    expect(v.items[0].working).toContain(LINE);
    expect(field(v.items[0], "pipe_size_mm").note).toContain("-> priced as 22.23 mm");
  });
  it("the Piping section: Copper 22.3 prices the 22.2 pipe (1,814 / 220); the section is handed 22.3 'from pipe' -- the size as read -- and Insulation's own rule lands it on 22.23 (265 / 14); the row is the sum", () => {
    const state: ItemListEditState = { items: [pipe("Copper", "22.3", { insulated: "Yes" }, { [SEC]: ins(NITRILE, { cladding: "No", thickness_mm: "19" }) })] };
    const { v, values } = compute(PIP, state);
    expect(fig(v.items[0].figures)).toEqual([1814, 220]);
    expect(field(v.items[0], "size_mm").value).toBe("22.2");
    const sb = secBlock(attached(v));
    const f = field(sb, "pipe_size_mm");
    expect({ typed: f.typedValue, value: f.value, tag: f.mirrorTag }).toEqual({ typed: "22.3", value: "22.23", tag: "from pipe" });
    expect(f.note).toBe("From pipe: 22.3 mm -> priced as 22.23 mm (the sheet's own spelling of this size)");
    expect(sb.working).toContain(LINE);
    expect(fig(sb.figures)).toEqual([265, 14]);
    expect(fig(values)).toEqual([1814 + 265, 220 + 14]);
    // the section's figure, lines and field are Calculator -> Insulation's for the same entries (the mirrored lead apart)
    const own = compute(INS, { items: [nitrile("22.3")] });
    expect(fig(sb.figures)).toEqual(fig(own.values));
    expect(sb.working).toEqual(own.v.items[0].working);
  });
  it("the same row as a MODEL answer (pipe + marked insulation): identical figures", () => {
    const { v, values } = panel(PIP, [{ pipe_type: "Copper", size_mm: "22.3 mm O.D", insulated: "Yes" }, { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "13/19 mm" }]);
    expect(fig(v.items[0].figures)).toEqual([1814, 220]);
    expect(fig(secBlock(attached(v)).figures)).toEqual([265, 14]);
    expect(secBlock(attached(v)).working).toContain(LINE);
    expect(fig(values)).toEqual([2079, 234]);
  });
  it("the edge, both sides: 0.1 away matches, 0.11 away takes the next size up; exactly on the sheet says nothing", () => {
    expect(fig(compute(INS, { items: [nitrile("22.33")] }).values)).toEqual(pure(INS, nitrile("22.23")));
    expect(fig(compute(INS, { items: [nitrile("22.13")] }).values)).toEqual(pure(INS, nitrile("22.23")));
    const far = compute(INS, { items: [nitrile("22.34")] });
    expect(field(far.v.items[0], "pipe_size_mm").value).toBe("28.58");
    expect(far.v.items[0].working.join(" | ")).not.toContain("within 0.1");
    const exact = compute(INS, { items: [nitrile("22.23")] });
    expect(exact.v.items[0].working.join(" | ")).not.toContain("on the sheet (within");
    expect(field(exact.v.items[0], "pipe_size_mm").note).toBeUndefined();
  });
  it("SWEEP, named: every Nitrile Rubber pipe size on the sheet, stated 0.06 above -- each lands on its own SKU, with the line where the two-decimal and one-decimal reads did not already", () => {
    const spec = itemListPricingSpec(CFG[INS])!;
    const rungs = [...new Set(ITEMS.filter((it) => it.kind === spec.kind && it.attributes.item === NITRILE && typeof it.attributes.pipe_size_mm === "number").map((it) => Number(it.attributes.pipe_size_mm)))].sort((a, b) => a - b);
    expect(rungs).toEqual([6.35, 9.52, 12.7, 15.88, 19.05, 22.23, 28.58, 34.93, 41.28, 53.98]);
    let byNear = 0;
    for (const r of rungs) {
      const statedSize = (r + 0.06).toFixed(2);
      const x = compute(INS, { items: [nitrile(statedSize, "13")] });
      expect({ r, landed: field(x.v.items[0], "pipe_size_mm").value }).toEqual({ r, landed: String(r) });
      expect(fig(x.values)).toEqual(pure(INS, nitrile(String(r), "13")));
      if (x.v.items[0].working.some((w) => w.endsWith("(within 0.1 mm)"))) byNear++;
    }
    expect(byNear).toBeGreaterThan(0);
  });
  it("NEGATIVE: the key is on ONE axis -- the thickness ladder is untouched (13.05 still takes the next size up, 19), and ADP and Piping declare no such key", () => {
    const thk = compute(INS, { items: [ins(NITRILE, { cladding: "No", thickness_mm: "13.05", pipe_size_mm: "22.23" }, ["thickness_mm"])] });
    expect(field(thk.v.items[0], "thickness_mm").value).toBe("19");
    expect(fig(thk.values)).toEqual(pure(INS, nitrile("22.23", "19")));
    const withNear = (cat: string) => Object.entries(itemListPricingSpec(CFG[cat])!.numbers).filter(([, rd]) => typeof rd.near === "number").map(([k]) => k);
    expect({ ins: withNear(INS), adp: withNear(ADP), pip: withNear(PIP) }).toEqual({ ins: ["pipe_size_mm"], adp: [], pip: [] });
    // Piping's own pipe line keeps its words: its match is the category-wide key and says nothing new
    expect(compute(PIP, { items: [pipe("Copper", "31.75")] }).v.items[0].working).toContain("pipe size 31.75 is 31.7 on the sheet");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-4b AC6 (F-2) -- a trailing full stop, comma, semicolon or colon never stops a size from reading", () => {
  const MARKS = [".", ",", ";", ":", " .", ".."];
  it("Piping, typed and read: '19/25 mm.' -> the higher, 25; '32/40mm.' -> 40; '25 mm,' -> 25 -- each at the price of the same text without the mark", () => {
    for (const [text, plain, size] of [["19/25 mm.", "19/25 mm", "25"], ["32/40mm.", "32/40mm", "40"], ["25 mm,", "25 mm", "25"]] as const) {
      const typed = compute(PIP, { items: [pipe("MS", text)] });
      const model = panel(PIP, [{ pipe_type: "MS", size_mm: text }]);
      const want = compute(PIP, { items: [pipe("MS", plain)] });
      for (const x of [typed, model]) {
        expect({ text, priced: x.v.rowPriced, values: x.values, size: field(x.v.items[0], "size_mm").value }).toEqual({ text, priced: true, values: want.values, size });
      }
      expect(fig(typed.values)).toEqual(pure(PIP, pipe("MS", size)));
    }
    expect(compute(PIP, { items: [pipe("MS", "19/25 mm.")] }).v.items[0].working).toContain("pipe size states two sizes (19 / 25) - the higher, 25, is taken");
    // the text as written is still what the line quotes
    expect(field(compute(PIP, { items: [pipe("MS", "19/25 mm.")] }).v.items[0], "size_mm").note!.startsWith("You typed 19/25 mm.: states two sizes (19 / 25)")).toBe(true);
  });
  it("NEGATIVE (what was wrong): without the fix '19/25 mm.' is no list of sizes at all -- the last part does not end in a size", () => {
    const READER = itemListPricingSpec(CFG[PIP])!.numbers.size_mm;
    expect(severalSizesPick("19/25 mm.", READER)).toMatchObject({ sizes: ["19", "25"], chosen: "25" });
    expect(severalSizesPick("19/25 mm", READER)).toMatchObject({ sizes: ["19", "25"], chosen: "25" });
    expect(withoutTrailingPunctuation("19/25 mm.")).toBe("19/25 mm");
    // only the END, and only those four marks: an inch mark, a bracket and a decimal point are untouched
    expect(withoutTrailingPunctuation(`5/8${INCH}`)).toBe(`5/8${INCH}`);
    expect(withoutTrailingPunctuation("22.3 mm O.D")).toBe("22.3 mm O.D");
    expect(withoutTrailingPunctuation("25 (NB)")).toBe("25 (NB)");
    expect(withoutTrailingPunctuation("19.25")).toBe("19.25");
    expect(withoutTrailingPunctuation("1.5, 2.5 .")).toBe("1.5, 2.5");
  });
  it("SWEEP, named: on Piping's size axis every form x every mark is one size exactly when the same form without the mark is, and reads the same number", () => {
    const READER = itemListPricingSpec(CFG[PIP])!.numbers.size_mm;
    const FORMS = ["25 mm", "25", `5/8${INCH}`, `1-1/4${INCH}`, "2 inch", "50 NB", "25 mm dia", "0.8", "19/25 mm", "32/40mm", "19 / 25 / 32 mm", "13/19 mm"];
    let n = 0;
    for (const f of FORMS) for (const mk of MARKS) {
      n++;
      expect({ f, mk, one: isOneSizeEntry(f + mk) }).toEqual({ f, mk, one: isOneSizeEntry(f) });
      expect({ f, mk, pick: severalSizesPick(f + mk, READER)?.chosen ?? null }).toEqual({ f, mk, pick: severalSizesPick(f, READER)?.chosen ?? null });
      const a = readNumber(f + mk, READER), b = readNumber(f, READER);
      expect({ f, mk, read: a && "value" in a ? a.value : null }).toEqual({ f, mk, read: b && "value" in b ? b.value : null });
      const withMark = compute(PIP, { items: [pipe("MS", f + mk)] }), without = compute(PIP, { items: [pipe("MS", f)] });
      expect({ f, mk, values: withMark.values, reason: withMark.v.items[0].reason ?? null }).toEqual({ f, mk, values: without.values, reason: without.v.items[0].reason ?? null });
    }
    expect(n).toBe(FORMS.length * MARKS.length);
  });
  it("Insulation: a read thickness '19/25 mm.' is 25; a TYPED thickness '19 mm.' is 19 (it used to refuse as not a single number); a pipe size '25 mm,' is 25", () => {
    const read = panel(INS, [{ item: PUF, cladding: "No", thickness_mm: "19/25 mm.", pipe_size_mm: "25 mm," }]);
    const plain = panel(INS, [{ item: PUF, cladding: "No", thickness_mm: "19/25 mm", pipe_size_mm: "25 mm" }]);
    expect(read.v.rowPriced).toBe(true);
    expect(read.values).toEqual(plain.values);
    for (const mk of MARKS) {
      const typed = compute(INS, { items: [ins(NITRILE, { cladding: "No", thickness_mm: `19 mm${mk}`, pipe_size_mm: "22.23" }, ["thickness_mm"])] });
      expect({ mk, reason: typed.v.items[0].reason ?? null, values: fig(typed.values) }).toEqual({ mk, reason: null, values: [265, 14] });
    }
    // NEGATIVE: what the typed box refuses is still refused -- the mark is not a licence
    const bad = compute(INS, { items: [ins(NITRILE, { cladding: "No", thickness_mm: "13+13.", pipe_size_mm: "22.23" }, ["thickness_mm"])] });
    expect(bad.v.items[0].reason).toBe(TYPED_THICKNESS_MESSAGE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-4b AC7 (F-3) -- a bare number below the smallest stocked size that could be an inch size refuses", () => {
  const typed = (type: string, text: string) => compute(PIP, { items: [pipe(type, text)] });
  const model = (type: string, text: string) => panel(PIP, [{ pipe_type: type, size_mm: text }]);
  /** "refuse", or the stocked size the row priced as. */
  const outcome = (x: { v: ItemListView }) => (x.v.rowPriced ? field(x.v.items[0], "size_mm").value : (x.v.items[0].reason ?? "?"));
  const R = (n: number | string) => noUnitMessage(String(n));

  /** THE TABLE THE OWNER ASKED FOR: every bare whole number 1-12 per type. A number at or above the smallest
   * size prices by the ladder as it always did; below it, it refuses when x 25.4 or x 25 falls inside the
   * type's stocked range and takes the smallest size otherwise. */
  const TABLE: Record<string, { range: [number, number]; refuses: number[]; pricesAs: Record<number, string> }> = {
    Copper: { range: [6.4, 47.6], refuses: [1], pricesAs: { 2: "6.4", 3: "6.4", 4: "6.4", 5: "6.4", 6: "6.4", 7: "9.5", 8: "9.5", 9: "9.5", 10: "12.7", 11: "12.7", 12: "12.7" } },
    MS: { range: [19, 300], refuses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], pricesAs: {} },
    PVC: { range: [25, 150], refuses: [1, 2, 3, 4, 5, 6], pricesAs: { 7: "25", 8: "25", 9: "25", 10: "25", 11: "25", 12: "25" } },
    CPVC: { range: [25, 75], refuses: [1, 2, 3], pricesAs: { 4: "25", 5: "25", 6: "25", 7: "25", 8: "25", 9: "25", 10: "25", 11: "25", 12: "25" } },
  };
  it.each(Object.keys(TABLE).map((t) => [t] as const))("%s: every bare whole number 1-12, typed and read alike", (type) => {
    const row = TABLE[type];
    const rungs = ITEMS.filter((it) => it.kind === "hvac_piping_item" && it.attributes.pipe_type === type).map((it) => Number(it.attributes.size_mm)).sort((a, b) => a - b);
    expect([rungs[0], rungs[rungs.length - 1]]).toEqual(row.range);
    for (let n = 1; n <= 12; n++) {
      const want = row.refuses.includes(n) ? R(n) : row.pricesAs[n];
      expect({ type, n, typed: outcome(typed(type, String(n))), read: outcome(model(type, String(n))) }).toEqual({ type, n, typed: want, read: want });
      // the rule itself, from the numbers: below the smallest AND an inch reading inside the range
      const couldBeInches = [n * 25.4, n * 25].some((mm) => mm >= row.range[0] && mm <= row.range[1]);
      expect({ type, n, refuses: row.refuses.includes(n) }).toEqual({ type, n, refuses: n < row.range[0] && couldBeInches });
      if (!row.refuses.includes(n)) expect(fig(typed(type, String(n)).values)).toEqual(pure(PIP, pipe(type, row.pricesAs[n])));
    }
    expect(Object.keys(row.pricesAs).length + row.refuses.length).toBe(12);
  });
  it("the owner's own example: PVC 6 refuses on the SECOND conversion (150 at x 25; 152.4 at x 25.4 is above the largest), and CPVC 3 the same (75 / 76.2)", () => {
    expect(outcome(typed("PVC", "6"))).toBe(R(6));
    expect(outcome(typed("CPVC", "3"))).toBe(R(3));
    expect(outcome(typed("PVC", "7"))).toBe("25");
  });
  it("the pairs the owner named: '8/7', '3/4', '25/32', '40/50' -- per type, typed and read alike", () => {
    const PAIRS: Record<string, Record<string, string>> = {
      "8/7": { Copper: "9.5", MS: R(8), PVC: "25", CPVC: "25" },                 // no unit: the size taken, 8, goes through the same check
      "3/4": { Copper: "19.1", MS: "19", PVC: "25", CPVC: "25" },                // an inch fraction -- already inches (19.05 mm), never a bare number
      "25/32": { Copper: "34.9", MS: "32", PVC: "32", CPVC: "32" },              // the higher, 32: at or above every smallest size
      "40/50": { Copper: "pipe size 50 is above the largest size on the sheet (47.6)", MS: "50", PVC: "50", CPVC: "50" },
    };
    for (const [text, byType] of Object.entries(PAIRS)) for (const [type, want] of Object.entries(byType)) {
      expect({ text, type, typed: outcome(typed(type, text)), read: outcome(model(type, text)) }).toEqual({ text, type, typed: want, read: want });
    }
  });
  it("the number WITH its unit prices: '1 inch' -> 25.4 mm / 25 mm -> 25; '1 mm' and '1 NB' -> the smallest size; a decimal that could be inches ('1.5') refuses", () => {
    const inch = typed("CPVC", "1 inch");
    expect(fig(inch.values)).toEqual(pure(PIP, pipe("CPVC", "25")));
    expect(field(inch.v.items[0], "size_mm").note).toBe("You typed 1 inch -> 25.4 mm / 25 mm -> priced as 25 mm");
    for (const text of ["1 mm", "1 NB", `1${INCH}`, "1 mm."]) expect({ text, priced: typed("CPVC", text).v.rowPriced }).toEqual({ text, priced: true });
    expect(field(typed("CPVC", "1 mm").v.items[0], "size_mm").note).toBe("You typed 1 mm -> 1 mm -> priced as 25 mm (the smallest size)");
    expect(outcome(typed("CPVC", "1.5"))).toBe(R(1.5));
    expect(outcome(typed("CPVC", "1."))).toBe(R(1));                           // a trailing full stop is not a unit
    expect(BARE_NUMBER_RE.test("1")).toBe(true);
    expect(BARE_NUMBER_RE.test("1 mm")).toBe(false);
  });
  it("NO PRICE PIN MOVES: MS 15 still takes the smallest size, 19 mm, 456 / 112 (15 inches is 381 / 375 mm, above MS's largest)", () => {
    for (const x of [typed("MS", "15"), model("MS", "15")]) {
      expect({ priced: x.v.rowPriced, values: fig(x.values), size: field(x.v.items[0], "size_mm").value }).toEqual({ priced: true, values: [456, 112], size: "19" });
    }
    expect(field(typed("MS", "15").v.items[0], "size_mm").note).toBe("You typed 15 -> priced as 19 mm (the smallest size)");
  });
  it("the test is the ANSWER, never the row around it: a heading full of 'mm' and 'inch' does not make a bare 1 priceable (BOQ-26-00186 row 108, '1 CPVC')", () => {
    const { v } = panel(PIP, [{ pipe_type: "CPVC", size_mm: "1" }], undefined, "RMT",
      { description: "1 CPVC", headings: ["DRAIN PIPE: Supply & installation of CPVC drain pipe with 6mm nitrile rubber insulation for condensate drain. 1 inch"] });
    expect(v.items[0].reason).toBe(R(1));
    // with the unit in the ANSWER it prices
    expect(panel(PIP, [{ pipe_type: "CPVC", size_mm: "1 inch" }], undefined, "RMT", { description: "1 CPVC" }).v.rowPriced).toBe(true);
  });
  it("NEGATIVE: the rule rides on the two keys Piping's size axis declares -- Insulation's pipe size and ADP's sizes never say it", () => {
    const one = compute(INS, { items: [ins(NITRILE, { cladding: "No", thickness_mm: "13", pipe_size_mm: "1" }, ["pipe_size_mm"])] });
    expect(one.v.rowPriced).toBe(true);
    expect(field(one.v.items[0], "pipe_size_mm").value).toBe("6.35");
    for (const cat of ITEM_LIST) {
      const spec = itemListPricingSpec(CFG[cat])!;
      const declares = Object.values(spec.numbers).some((rd) => typeof rd.inch_mm_alt === "number") && spec.size_match?.below_smallest === "smallest";
      expect({ cat, declares }).toEqual({ cat, declares: cat === PIP });
    }
    // remove either key from a copy and the bare 1 prices as the smallest size again
    for (const drop of ["inch_mm_alt", "below_smallest"] as const) {
      const c = structuredClone(CFG) as Record<string, any>;
      if (drop === "inch_mm_alt") delete c[PIP].list_spec.pricing.numbers.size_mm.inch_mm_alt; else delete c[PIP].list_spec.pricing.size_match.below_smallest;
      const x = compute(PIP, { items: [pipe("CPVC", "1")] }, "mts", new Map(Object.entries(c as Record<string, RateCategoryConfig>)));
      expect({ drop, priced: x.v.rowPriced, size: field(x.v.items[0], "size_mm").value }).toEqual({ drop, priced: true, size: "25" });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-4b AC8 (G1 / G2 / G3) -- a default is named as the default, no line repeats itself, a field reads by its label", () => {
  const G1_NOTE = "Default 9 mm -> priced as 13 mm (next size up)";
  it("G1: in the calculator the defaulted thickness's note names the default -- never 'BoQ says' -- and the figure is unmoved (556 / 224 / 780)", () => {
    const { v, values, s } = compute(INS, { items: [ins(NITRILE, { cladding: "26G Aluminium", pipe_size_mm: "50" }, ["pipe_size_mm"])] });
    expect(values).toEqual({ supply_rate: 556, install_rate: 224, combined_rate: 780 });
    const t = field(v.items[0], "thickness_mm");
    expect({ defaulted: t.defaulted, note: t.note }).toEqual({ defaulted: true, note: G1_NOTE });
    expect(shown(v, s).filter((l) => l.includes("BoQ says"))).toEqual([]);
  });
  it("G1 on a BoQ row: a thickness the BoQ did NOT state is the default there too; one it DID state keeps 'BoQ says'", () => {
    const silent = panel(INS, [{ item: NITRILE, cladding: "26G Aluminium", pipe_size_mm: "50" }]);
    expect(field(silent.v.items[0], "thickness_mm").note).toBe(G1_NOTE);
    expect(fig(silent.values)).toEqual([556, 224]);
    const said = panel(INS, [{ item: NITRILE, cladding: "26G Aluminium", thickness_mm: "9 mm", pipe_size_mm: "50" }]);
    expect(field(said.v.items[0], "thickness_mm").note).toContain("BoQ says 9 mm");
    expect(field(said.v.items[0], "thickness_mm").note).not.toContain("Default");
    expect(fig(said.values)).toEqual([556, 224]);
    // a value the PRICER typed still says so
    const typed = compute(INS, { items: [ins(NITRILE, { cladding: "26G Aluminium", pipe_size_mm: "50", thickness_mm: "9" }, ["pipe_size_mm", "thickness_mm"])] });
    expect(field(typed.v.items[0], "thickness_mm").note).toBe("You typed 9 mm -> priced as 13 mm (next size up)");
  });
  it("G2: the default's working line says its rule ONCE", () => {
    const { v } = compute(INS, { items: [ins(NITRILE, { cladding: "26G Aluminium", pipe_size_mm: "50" }, ["pipe_size_mm"])] });
    expect(v.items[0].working.filter((w) => w.includes("not mentioned"))).toEqual(["thickness not mentioned -> 9 mm, then the ladder"]);
    const adp = compute(ADP, { items: [{ base: null, family: "round diffuser", attrs: { dia_mm: "200" } }] }, "nos");
    expect(adp.v.items[0].working.filter((w) => w.includes("not mentioned"))).toEqual(["damper not mentioned -> without"]);
  });
  it("G2, the function: only what the rule ADDS is kept; a rule that is no such statement, and every other line, is untouched; idempotent", () => {
    const cases: Array<[string, string]> = [
      ["thickness not mentioned -> 9 (thickness not mentioned -> 9 mm, then the ladder)", "thickness not mentioned -> 9 mm, then the ladder"],
      ["damper not mentioned -> without (damper not mentioned (or not answered) = without)", "damper not mentioned -> without"],
      ["cladding not mentioned -> No (cladding not mentioned -> without cladding)", "cladding not mentioned -> No (without cladding)"],
      ["UL listed not mentioned -> no (UL not mentioned (or not answered) = non-UL)", "UL listed not mentioned -> no (non-UL)"],
      ["insulated not mentioned -> with (insulation not mentioned (or not answered) = insulated)", "insulated not mentioned -> with (insulated)"],
      ["thickness not mentioned -> 9 (thickness not mentioned -> 90 mm)", "thickness not mentioned -> 9 (90 mm)"],
    ];
    for (const [before, after] of cases) {
      expect(onceOnly(before)).toBe(after);
      expect(onceOnly(after)).toBe(after);
    }
    for (const same of ["variant not mentioned -> without sleeve (VCD = GI rectangular; fire damper = without sleeve)", "pipe size 50 is not on the sheet -> 53.98 (next size up)",
                        "insulation not mentioned -> No", "supply: ROUNDUP(supply, 0) = 984", ""]) expect(onceOnly(same)).toBe(same);
  });
  it("G3: 'item not mentioned -> ...' reads by the field's label; on ADP 'ul' reads 'UL listed'; the pure pricer still writes the id (the label is applied where the view is built)", () => {
    const row = panel(INS, [{ item: "None", cladding: "26G Aluminium", thickness_mm: "13", pipe_size_mm: "50" }]);
    const line = row.v.items[0].working.find((w) => w.includes("not mentioned"))!;
    expect(line).toBe("insulation material not mentioned -> Nitrile Rubber Insulation (Nitrile by row kind: per metre = pipe, per sq.m = sheet, acoustic / lining in the row or its headings = acoustic)");
    const act = panel(ADP, [{ family: "actuator", torque: "10" }], undefined, "nos");
    expect(act.v.items[0].working).toContain("UL listed not mentioned -> no (non-UL)");
    const spec = itemListPricingSpec(CFG[INS])!;
    const raw = priceItemList(spec, ITEMS, "Rmt", [{ attributes: { item: { value: "None" }, cladding: { value: "26G Aluminium" }, thickness_mm: { value: "13" }, pipe_size_mm: { value: "50" } } }], "", "");
    expect(raw.items[0].working.join(" | ")).toContain("item not mentioned -> Nitrile Rubber Insulation (R2 material not mentioned");
    // the function: the id only at the START of a default's line, and only with its label in hand
    expect(plainPricerText("ul not mentioned -> no (R14 / S6 UL not mentioned (or not answered) = non-UL)", [], { ul: "UL listed" })).toBe("UL listed not mentioned -> no (non-UL)");
    expect(plainPricerText("ul not mentioned -> no", [], {})).toBe("ul not mentioned -> no");
    expect(plainPricerText("the ul not mentioned -> no", [], { ul: "UL listed" })).toBe("the ul not mentioned -> no");
  });
  it("THE SWEEP, named: every kind of Insulation, ADP and Piping in every unit its picker offers, in the calculator and on a BoQ row, nothing filled and every default firing -- no line says a thing twice, none opens with a field id, and no default's note says 'BoQ says'", () => {
    const twice: string[] = [], ids: string[] = [], boqSays: string[] = [];
    const covered: string[] = [];
    let lines = 0;
    for (const cat of ITEM_LIST) {
      const spec = itemListPricingSpec(CFG[cat])!;
      const fam = familyAttr(spec);
      const labels = Object.fromEntries(listSpecDefs(CFG[cat]).map((d) => [d.id, String(d.label ?? d.id)]));
      const idLead = new RegExp(`^(${Object.keys(labels).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}) not mentioned -> `);
      for (const family of Object.keys(spec.families)) {
        for (const unit of unitChoicesOf(spec, [family])) {
          const views: Array<{ where: string; v: ItemListView; s: ItemListSuggestion }> = [];
          const c = compute(cat, { items: [{ base: null, family, attrs: {} }] }, unit);
          views.push({ where: "calculator", v: c.v, s: c.s });
          const answer: Answer = { [fam]: family };
          for (const d of listSpecDefs(CFG[cat])) if ((d as { allow_none?: boolean }).allow_none && d.id !== fam) answer[d.id] = "None";
          const p = panel(cat, [answer], undefined, unit);
          views.push({ where: "row", v: p.v, s: p.s });
          covered.push(`${cat} / ${family} / ${unit}`);
          for (const x of views) {
            for (const l of shown(x.v, x.s)) {
              lines++;
              if (l.split("not mentioned").length > 2) twice.push(`${cat} ${family} ${unit} ${x.where}: ${l}`);
              // an id that IS its own label word ("damper", "variant") is not an id on screen; only one that differs is
              const m = l.match(idLead);
              if (m && m[1] !== labels[m[1]] && m[1].toLowerCase() !== String(labels[m[1]]).replace(/\s*\(.*\)\s*$/, "").toLowerCase()) ids.push(`${cat} ${family} ${unit} ${x.where}: ${l}`);
            }
            const all = [...x.v.items, ...x.v.items.flatMap((b) => (b.sections ?? []).flatMap((sv) => sv.view.items))];
            for (const b of all) for (const f of b.fields) if (f.defaulted && f.note && f.note.startsWith("BoQ says")) boqSays.push(`${cat} ${family} ${unit} ${x.where}: ${f.label}: ${f.note}`);
          }
        }
      }
    }
    expect(twice).toEqual([]);
    expect(ids).toEqual([]);
    expect(boqSays).toEqual([]);
    expect(new Set(covered.map((c) => c.split(" / ")[0]))).toEqual(new Set(ITEM_LIST));
    expect(covered.length).toBe(ITEM_LIST.reduce((n, cat) => n + Object.keys(itemListPricingSpec(CFG[cat])!.families).reduce((m, f) => m + unitChoicesOf(itemListPricingSpec(CFG[cat])!, [f]).length, 0), 0));
    expect(covered.length).toBeGreaterThan(30);
    expect(lines).toBeGreaterThan(500);
  });
  it("what a pricer sees in the thickness box is unchanged: the default still shows its value (13, the size it priced as)", () => {
    const { v } = compute(INS, { items: [ins(NITRILE, { cladding: "26G Aluminium", pipe_size_mm: "50" }, ["pipe_size_mm"])] });
    expect(onScreen(field(v.items[0], "thickness_mm"))).toBe("13");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-4b AC11 -- the Derivation tab says the new rules, generated from the config", () => {
  const lines = (cfg: RateCategoryConfig) => itemListRuleOrder(cfg, ITEMS);
  const AS_WRITTEN_TITLE = "A pipe type left unanswered is read from 'Pipe type as written'";
  const NO_UNIT_TITLE = "A pipe size written as a bare number that could be inches refuses";
  const NEAR_TITLE = "A pipe size within 0.1 mm of a stocked size counts as that size";
  it("Piping: 21 lines -- the as-written rule after the row-words rule, the no-unit refusal after the size fit; word for word", () => {
    const all = lines(CFG[PIP]);
    expect(all).toHaveLength(21);
    expect(all[5]).toEqual({ n: 6, title: AS_WRITTEN_TITLE,
      detail: "the BoQ's own word, from the row or else its headings, read exactly as the same word typed in the pipe type box; a word naming several kinds prices as the one they all mean and refuses when they differ; an answered pipe type always wins over it; shown read-only, and only where it differs from the kind priced" });
    expect(all[4].title).toBe("A row naming one pipe type prices as it; two different ones with none chosen refuse");
    expect(all[12]).toEqual({ n: 13, title: NO_UNIT_TITLE,
      detail: "a number with no unit, below the smallest stocked size, whose reading in inches (at 25.4 or 25 mm to the inch) falls within the stocked sizes: 'size <number> has no unit - price this row by hand'; the same number written with its unit ('1 inch', '1 mm') prices; a bare number that cannot be an inch size takes the smallest size, as before" });
    expect(all[11].title).toBe("Fitting the stated pipe size to the catalogue");
    // decision 4 reaches the tab through the refuse list it is generated from
    expect(all[3].detail).toContain(`SS: ${SS_SENTENCE}; Stainless steel: ${SS_SENTENCE}`);
  });
  it("Insulation: 25 lines -- the 0.1 mm rule directly after the pipe-size fit; ADP: 18, unchanged", () => {
    const all = lines(CFG[INS]);
    expect(all).toHaveLength(25);
    const at = all.findIndex((l) => l.title === NEAR_TITLE);
    expect(all[at - 1].title).toBe("Fitting the stated pipe size to the catalogue");
    expect(all[at].detail).toBe("with a line saying so: 'pipe size <stated> is <stocked> on the sheet (within 0.1 mm)'; a size further away takes the next size the catalogue stocks, as before");
    expect(all.filter((l) => l.title.includes("within 0.1"))).toHaveLength(1);       // the thickness fit has no such line
    expect(lines(CFG[ADP])).toHaveLength(18);
    expect(lines(CFG[ADP])).toEqual(lines(CFG37[ADP]));
  });
  it("NEGATIVE: each line follows its key -- v37 (no `from_attr`, no axis `near`) reads Piping 20 and Insulation 24; removing a key from a copy removes exactly its line", () => {
    expect(lines(CFG37[PIP]).map((l) => l.title)).not.toContain(AS_WRITTEN_TITLE);
    expect(lines(CFG37[PIP])).toHaveLength(20);
    expect(lines(CFG37[INS])).toHaveLength(24);
    expect(lines(CFG37[INS]).map((l) => l.title)).not.toContain(NEAR_TITLE);
    const without = (mut: (c: Record<string, any>) => void, cat: string) => { const c = structuredClone(CFG) as Record<string, any>; mut(c); return lines(c[cat] as RateCategoryConfig).map((l) => l.title); };
    expect(without((c) => delete c[PIP].list_spec.pricing.family_text.from_attr, PIP)).toEqual(lines(CFG[PIP]).map((l) => l.title).filter((t) => t !== AS_WRITTEN_TITLE));
    expect(without((c) => delete c[PIP].list_spec.pricing.numbers.size_mm.inch_mm_alt, PIP)).not.toContain(NO_UNIT_TITLE);
    expect(without((c) => delete c[PIP].list_spec.pricing.size_match.below_smallest, PIP)).not.toContain(NO_UNIT_TITLE);
    expect(without((c) => delete c[INS].list_spec.pricing.numbers.pipe_size_mm.near, INS)).toEqual(lines(CFG37[INS]).map((l) => l.title));
  });
  it("no internal id, tag or code on any new line", () => {
    const text = [...lines(CFG[PIP]), ...lines(CFG[INS])].filter((l) => [AS_WRITTEN_TITLE, NO_UNIT_TITLE, NEAR_TITLE].includes(l.title)).map((l) => `${l.title} | ${l.detail ?? ""}`).join("\n");
    expect(text).not.toMatch(/\b[a-z0-9]+_[a-z0-9_]+\b/i);
    expect(text).not.toMatch(/\(owner/i);
    expect(text).not.toMatch(/\b[RDTSQF]-?\d{1,2}[a-z]?\b/);
  });
});
