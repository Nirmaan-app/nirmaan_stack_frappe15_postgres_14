/**
 * SLICE 12e-2b (owner rulings 2026-10-10: the two-way ruling, D1 (a), D2, D3 + Decision 1 "option a" + Decision 2
 * "a colon form", D4 (a), the ladder-on-picks ruling; the 12e-2 cert findings 2, 6, 7) -- every rule tested from
 * the PANEL'S ENTRY POINT (`makePricingSheetHelper(...).compute`) on the LIVE v36 asset, read at runtime.
 *
 *   AC1   the end-to-end proof: a fresh ADP fire damper offers UL listed "yes" AND "no"; "yes" prices the UL 555 SKU
 *         21,750 / 1,920 with "UL stated, so the UL 555 SKU is used" -- and the model path gives the same.
 *   AC2   TWO-WAY: a choice whose list for the family has exactly two values offers both, in the definition's order,
 *         and is never narrowed or cleared. The 15 combinations the recon found hiding a value, by name.
 *   AC3   D2 "UL wins" on both paths, through the ONE override (slice 8 M-b), not a copy.
 *   AC4   D3: every HVAC item-list unstocked-combination refusal reads "No SKU for <family>: <facts> - price this
 *         row by hand", built in `plainEnglish.ts` from existing labels.
 *   AC5   D4 (a): slot diffuser per sq.m / per number keeps "damper not mentioned -> without" and refuses by name.
 *   AC6   a slash on the Piping size axis is an inch fraction only when it can be one; "40/50" refuses on both paths.
 *   AC7   Derivation: line 10 names the families, never "{family}"; Piping never reads "per square metre".
 *   AC13  a PICK on a LADDER field that another answer unstocks is laddered exactly as the same value typed; a
 *         choice field (no ladder) is still cleared and never refilled.
 *
 * What each block protects is said in its `describe`. Negative halves sit beside every positive.
 */
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
import { noSkuSentence, plainFact, plainPricerText } from "@/pages/pricing/rate-master/plainEnglish";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, type ItemBlockView, type ItemListSuggestion,
} from "./pricingSheetHelper";
import {
  INCH_DENOMINATORS, ONE_SIZE_MESSAGE, fieldOptionsFromSkus, isOneSizeEntry, itemFieldDefs, itemListPricingSpec, listSpecDefs,
  priceItemList, severalSizesMessage, slashSizes, twoWayValues, type ItemListPricingSpec,
} from "./itemListPricing";

const ASSET = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
  new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v36.json", import.meta.url),
);
const CFG: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET.category_configs.map((c) => [c.category_id, c]));
const CONFIGS = new Map<string, RateCategoryConfig>(Object.entries(CFG));
const ITEMS: RateMasterItem[] = ASSET.items.map((it) => ({ ...it, discipline: ASSET.discipline } as RateMasterItem));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const ITEM_LIST = [INS, ADP, PIP] as const;
const SPEC: Record<string, ItemListPricingSpec> = Object.fromEntries(ITEM_LIST.map((c) => [c, itemListPricingSpec(CFG[c])!]));
const KINDS = ["supply_rate", "install_rate", "combined_rate"] as const;
// INVERTED at 12e-3b (block 38, AC3). BEFORE: "UL stated, so the UL 555 SKU is used (R-M-b)" -- the config's rule text
// with its tag, as the panel printed it. The tag is stripped at the plain-English step; the config keeps it.
const UL_LINE = "UL stated, so the UL 555 SKU is used";
const UL_LINE_BEFORE = "UL stated, so the UL 555 SKU is used (R-M-b)";

type Edit = { base: number | null; family: string | null; attrs: Record<string, string>; other?: string[] };
const cells = (a: Record<string, string>): ExtractionRow["attributes"] =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));

/** The CALCULATOR path: an empty extraction map, every value an override (a PICK unless its id is in `other`). */
function calc(category: string, family: string, attrs: Record<string, string>, unit: string, other: string[] = []) {
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
  const edits: { items: Edit[] } = { items: [{ base: null, family, attrs, other }] };
  const ctx: RateHelperRowContext = { excelRow: 1, description: "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS] };
  const r = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(edits), [ROW_UNIT_OVERRIDE_KEY]: unit });
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, b: s.itemList!.items[0] as ItemBlockView, values: s.values };
}
/** The PANEL path: the model's stored answer through `extractionByRow`, the row's own unit. */
function panel(category: string, answer: Record<string, string>, unit: string) {
  const row = { excelRow: 1, description: "", attributes: {}, items: [{ attributes: cells(answer) }] } as ExtractionRow;
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
  const ctx: RateHelperRowContext & { unit?: string } = { excelRow: 1, description: "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS], unit };
  const r = h.compute(ctx, {});
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, b: s.itemList!.items[0] as ItemBlockView, values: s.values };
}
const field = (b: ItemBlockView, id: string) => b.fields.find((f) => f.id === id)!;
const fig = (values: Partial<Record<string, number>>) => [values.supply_rate, values.install_rate];

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-2b AC1 -- the end-to-end proof: fire damper, UL listed shows both; 'yes' prices the UL 555 SKU on both paths", () => {
  it("calculator, a FRESH per-sq.m fire damper: UL listed offers 'yes' AND 'no' (BEFORE: 'no' alone), the value used is the ruled default 'no'", () => {
    const { b, values } = calc(ADP, "fire damper", {}, "sqm");
    expect(field(b, "ul").options).toEqual(["yes", "no"]);
    expect(field(b, "ul").value).toBe("no");
    expect(field(b, "ul").defaulted).toBe(true);
    expect(fig(values)).toEqual([14138, 1920]);                     // unchanged: the non-UL without-sleeve SKU
  });
  it("picking 'yes' prices the UL 555 SKU at 21,750 / 1,920 with the 'UL stated' line", () => {
    const { b, values } = calc(ADP, "fire damper", { ul: "yes" }, "sqm");
    expect(fig(values)).toEqual([21750, 1920]);
    expect(b.working).toContain(UL_LINE);
    expect(b.skuLine).toBe("Fire damper / UL 555 Rated (SQM)");
    expect(field(b, "variant").value).toBe("UL");
    expect(field(b, "variant").note).toBe(UL_LINE);
    expect(b.working).not.toContain(UL_LINE_BEFORE);                 // 12e-3b: the tag never reaches the screen
    expect(JSON.stringify(CFG[ADP])).toContain(UL_LINE_BEFORE);      // ... and the config still carries it
  });
  it("the SAME row through the BoQ-panel path (the model supplying ul = yes) gives the same figure and the same line", () => {
    const viaModel = panel(ADP, { family: "fire damper", ul: "yes", variant: "None" }, "sqm");
    const viaPick = calc(ADP, "fire damper", { ul: "yes" }, "sqm");
    expect(viaModel.values).toEqual({ supply_rate: 21750, install_rate: 1920, combined_rate: 23670 });
    expect(viaModel.values).toEqual(viaPick.values);
    expect(viaModel.b.working).toEqual(viaPick.b.working);
    expect(viaModel.b.working).toContain(UL_LINE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * The 15 pick-combinations the recon (12x-R1, section R4) found hiding one of a two-way field's values, BY NAME:
 * family x unit x the other pick. `hidden` is the value that was not offered before this slice.
 */
const FIFTEEN: Array<{ n: number; family: string; unit: string; attr: string; other: Record<string, string>; hidden: string; label: string;
  /** the answers as the block RESOLVED them, where that differs from the pick (3.5 ladders to the non-UL 6 under the UL default) */
  resolved?: Record<string, string> }> = [
  { n: 1, family: "fire damper", unit: "sqm", attr: "ul", other: {}, hidden: "yes", label: "nothing picked (ruled defaults only)" },
  { n: 2, family: "fire damper", unit: "sqm", attr: "ul", other: { variant: "without sleeve" }, hidden: "yes", label: "Variant = without sleeve" },
  { n: 3, family: "fire damper", unit: "sqm", attr: "ul", other: { variant: "UL" }, hidden: "no", label: "Variant = UL" },
  { n: 4, family: "fire damper", unit: "sqm", attr: "ul", other: { variant: "motorised" }, hidden: "yes", label: "Variant = motorised" },
  { n: 5, family: "fire damper", unit: "sqm", attr: "ul", other: { variant: "with sleeve" }, hidden: "yes", label: "Variant = with sleeve" },
  { n: 6, family: "fire damper", unit: "nos", attr: "ul", other: { size_mm: "600x600" }, hidden: "yes", label: "nothing picked, size 600x600" },
  { n: 7, family: "fire damper", unit: "nos", attr: "ul", other: { variant: "without sleeve", size_mm: "600x600" }, hidden: "yes", label: "Variant = without sleeve, size 600x600" },
  { n: 8, family: "fire damper", unit: "nos", attr: "ul", other: { variant: "UL", size_mm: "600x600" }, hidden: "no", label: "Variant = UL, size 600x600" },
  { n: 9, family: "fire damper", unit: "nos", attr: "ul", other: { variant: "motorised", size_mm: "600x600" }, hidden: "yes", label: "Variant = motorised, size 600x600" },
  { n: 10, family: "fire damper", unit: "nos", attr: "ul", other: { variant: "with sleeve", size_mm: "600x600" }, hidden: "yes", label: "Variant = with sleeve, size 600x600" },
  { n: 11, family: "actuator", unit: "nos", attr: "ul", other: { torque: "3.5" }, hidden: "yes", label: "Torque = 3.5", resolved: { torque_nm: "6" } },
  { n: 12, family: "actuator", unit: "nos", attr: "ul", other: { torque: "6" }, hidden: "yes", label: "Torque = 6" },
  { n: 13, family: "actuator", unit: "nos", attr: "ul", other: { torque: "10" }, hidden: "yes", label: "Torque = 10" },
  { n: 14, family: "slot diffuser", unit: "sqm", attr: "damper", other: {}, hidden: "without", label: "nothing picked (ruled defaults only)" },
  { n: 15, family: "slot diffuser", unit: "nos", attr: "damper", other: { size_mm: "600x600" }, hidden: "without", label: "nothing picked, size 600x600" },
];

describe("12e-2b AC2 -- TWO-WAY: a choice whose list for the family has exactly two values offers BOTH and is never narrowed", () => {
  it("what is two-way is worked out from the LIST, per family: exactly UL listed, Damper and Insulated on ADP; nothing on Insulation or Piping", () => {
    const found: string[] = [];
    for (const cat of ITEM_LIST) {
      for (const d of listSpecDefs(CFG[cat])) {
        const fams = Object.keys(SPEC[cat].families).filter((f) => twoWayValues(SPEC[cat], d.id, f) !== null);
        if (fams.length) found.push(`${cat}.${d.id}: ${fams.length} of ${Object.keys(SPEC[cat].families).length} families`);
      }
    }
    expect(found).toEqual(["hvac_adp.damper: 25 of 25 families", "hvac_adp.insulated: 25 of 25 families", "hvac_adp.ul: 25 of 25 families"]);
    expect(twoWayValues(SPEC[ADP], "ul", "fire damper")).toEqual(["yes", "no"]);              // the definition's order
    expect(twoWayValues(SPEC[ADP], "damper", "slot diffuser")).toEqual(["with", "without"]);
    // NEGATIVE: a list of four (fire damper's variants) and of eight (Insulation's claddings) is not two-way
    expect(twoWayValues(SPEC[ADP], "variant", "fire damper")).toBeNull();
    expect(twoWayValues(SPEC[INS], "cladding", "Thermal Nitrile Insulation")).toBeNull();
    expect(twoWayValues(SPEC[PIP], "pipe_type", "Copper")).toBeNull();
  });

  it.each(FIFTEEN.map((c) => [`#${c.n} ${c.family} per ${c.unit}, ${c.label}`, c] as const))("%s: both values shown", (_, c) => {
    const both = twoWayValues(SPEC[ADP], c.attr, c.family)!;
    const { b } = calc(ADP, c.family, c.other, c.unit);
    // POSITIVE: the field offers both values, in the definition's order
    expect({ n: c.n, options: field(b, c.attr).options }).toEqual({ n: c.n, options: both });
    expect(both).toContain(c.hidden);
    // and the value that used to be hidden can be PICKED without being cleared as stale
    const picked = calc(ADP, c.family, { ...c.other, [c.attr]: c.hidden }, c.unit);
    expect({ n: c.n, value: field(picked.b, c.attr).value }).toEqual({ n: c.n, value: c.hidden });
    expect(field(picked.b, c.attr).note ?? "").not.toMatch(/choose again/);
    expect(picked.v.reason ?? "").not.toMatch(new RegExp(`choose again: .*${c.attr === "ul" ? "UL listed" : "damper"}`));
    // NEGATIVE: the SKUs themselves still stock only one side under these answers -- it is the FIELD that shows both
    const cls = c.unit === "sqm" ? "area" : "count";
    const answers: Record<string, string> = c.resolved ?? Object.fromEntries(Object.entries(c.other).filter(([k]) => k !== "size_mm").map(([k, v]) => [k === "torque" ? "torque_nm" : k, v]));
    if (c.attr === "ul" && c.family === "fire damper" && !("variant" in answers)) answers.variant = "without sleeve";   // the ruled default acts as a pick
    const stocked = fieldOptionsFromSkus(SPEC[ADP], ITEMS, c.family, cls, c.attr, answers);
    expect({ n: c.n, stockedHidesIt: !stocked.includes(c.hidden) }).toEqual({ n: c.n, stockedHidesIt: true });
  });

  it("NEGATIVE: every OTHER field keeps narrowing (owner S1) -- torque under UL, variant under UL, Insulation thickness under pipe size", () => {
    expect(field(calc(ADP, "actuator", { ul: "yes" }, "nos").b, "torque").options).toEqual(["3.5", "8", "20"]);
    expect(field(calc(ADP, "actuator", { ul: "no" }, "nos").b, "torque").options).toEqual(["6", "8", "10", "20"]);
    expect(field(calc(ADP, "fire damper", { ul: "no" }, "sqm").b, "variant").options).toEqual(["without sleeve", "motorised", "with sleeve"]);
    expect(field(calc(INS, "Tubular Puf Insulation", { cladding: "No", pipe_size_mm: "100" }, "mts").b, "thickness_mm").options).toEqual(["65"]);
  });

  it("the two sites that read the SKU list directly agree with the field (recon anomaly 7): a model 'yes' on a per-number fire damper is matched, shown and priced", () => {
    const { b, values, v } = panel(ADP, { family: "fire damper", ul: "yes", variant: "motorised", size_mm: "600x600" }, "nos");
    expect(v.rowPriced).toBe(true);
    expect(fig(values)).toEqual([7830, 692]);
    expect(field(b, "ul").value).toBe("yes");
    expect(v.reason ?? "").not.toMatch(/is not one of the options/);
  });

  it("the definition's `itemFieldDefs` and the panel's field carry the SAME list (one function)", () => {
    const defs = itemFieldDefs(SPEC[ADP], listSpecDefs(CFG[ADP]), "slot diffuser", "area", { items: ITEMS, answers: { damper: "without" } });
    expect(defs.find((f) => f.id === "damper")!.options).toEqual(["with", "without"]);
    expect(defs.find((f) => f.id === "damper")!.optionSource).toBe("catalogue");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-2b AC3 -- D2 'UL wins' on both paths: a hand-picked UL 'yes' beats every variant, through the ONE override", () => {
  const VARIANTS = ["without sleeve", "motorised", "with sleeve"];
  it.each(VARIANTS)("per sq.m, Variant = %s + UL yes PICKED: the UL 555 SKU 21,750 / 1,920 with the line -- identical to the model path", (variant) => {
    const pick = calc(ADP, "fire damper", { variant, ul: "yes" }, "sqm");
    const model = panel(ADP, { family: "fire damper", variant, ul: "yes" }, "sqm");
    expect(fig(pick.values)).toEqual([21750, 1920]);
    expect(pick.values).toEqual(model.values);
    expect(pick.b.working).toEqual(model.b.working);
    expect(pick.b.working).toContain(UL_LINE);
    // the variant field shows what PRICED on both paths: the catalogue's word, the rule beneath
    for (const x of [pick, model]) {
      expect(field(x.b, "variant").value).toBe("UL");
      expect(field(x.b, "variant").optionLabels).toEqual({ UL: "UL 555" });
      expect(field(x.b, "variant").note).toBe(UL_LINE);
    }
    expect(pick.v.reason ?? "").not.toMatch(/choose again/);
  });
  it.each(VARIANTS)("per number (600 x 600), Variant = %s + UL yes PICKED: 7,830 / 692 with the line -- identical to the model path", (variant) => {
    const pick = calc(ADP, "fire damper", { variant, ul: "yes", size_mm: "600x600" }, "nos");
    const model = panel(ADP, { family: "fire damper", variant, ul: "yes", size_mm: "600x600" }, "nos");
    expect(fig(pick.values)).toEqual([7830, 692]);
    expect(pick.values).toEqual(model.values);
    expect(pick.b.working).toContain(UL_LINE);
  });
  it("it is the override that prices it, not a copy: the pure pricer over the same two answers gives the same figure and names the same rule", () => {
    const pure = priceItemList(SPEC[ADP], ITEMS, "sqm", [{ attributes: cells({ family: "fire damper", variant: "motorised", ul: "yes" }) }]);
    expect([pure.supply, pure.install]).toEqual([21750, 1920]);
    expect(pure.items[0].overrides.map((o) => [o.attr, o.value, o.display])).toEqual([["variant", "UL", "UL 555"]]);
    expect(SPEC[ADP].override_when).toHaveLength(1);
  });
  it("NEGATIVE: Variant = UL + UL 'no' REFUSES in the D3 wording -- no such SKU, per sq.m and per number", () => {
    const sqm = calc(ADP, "fire damper", { variant: "UL", ul: "no" }, "sqm");
    expect(sqm.values).toEqual({});
    expect(sqm.v.reason).toBe("No SKU for fire damper: UL listed no, variant UL - price this row by hand");
    const nos = calc(ADP, "fire damper", { variant: "UL", ul: "no", size_mm: "600x600" }, "nos");
    expect(nos.values).toEqual({});
    expect(nos.v.reason).toBe("No SKU for fire damper: UL listed no, variant UL, width 600, height 600 - price this row by hand");
    // and the model path says the same sentence
    expect(panel(ADP, { family: "fire damper", variant: "UL", ul: "no" }, "sqm").v.reason).toBe(sqm.v.reason);
  });
  it("NEGATIVE: UL 'no' with a non-UL variant is untouched -- the motorised SKU, no 'UL stated' line", () => {
    const { b, values } = calc(ADP, "fire damper", { variant: "motorised", ul: "no" }, "sqm");
    expect(fig(values)).toEqual([12470, 1920]);
    expect(b.working).not.toContain(UL_LINE);
    expect(field(b, "variant").value).toBe("motorised");
  });
  it("NEGATIVE: a pick the list still offers stays the pricer's own beside an override (a picked foil keeps showing foil; the value map prices 26G with its line)", () => {
    const { b, v } = calc(INS, "Nitrile Rubber Insulation", { cladding: "Aluminium Foil", thickness_mm: "19", pipe_size_mm: "53.98" }, "mts");
    expect(v.rowPriced).toBe(true);
    expect(field(b, "cladding").value).toBe("Aluminium Foil");
    expect(b.working.join(" | ")).toContain("foil on a pipe is priced as 26G cladding");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-2b AC4 -- D3: the unstocked-combination refusal, built in plainEnglish.ts from existing labels", () => {
  it("one fact in words: with / without before its label; every other value after it; the label lowered unless its first word is all capitals", () => {
    expect(plainFact({ label: "Damper", value: "without" })).toBe("without damper");
    expect(plainFact({ label: "Damper", value: "with" })).toBe("with damper");
    expect(plainFact({ label: "Insulated", value: "without" })).toBe("without insulated");
    expect(plainFact({ label: "UL listed", value: "no" })).toBe("UL listed no");
    expect(plainFact({ label: "Variant", value: "UL" })).toBe("variant UL");
    expect(plainFact({ label: "Cladding", value: "GI Framework with perforated Al sheet" })).toBe("cladding GI Framework with perforated Al sheet");
    expect(plainFact({ label: "width", value: 600 })).toBe("width 600");
    // NEGATIVE: only the two VALUE words are tested -- a value that merely starts with one is an ordinary value
    expect(plainFact({ label: "Variant", value: "with sleeve" })).toBe("variant with sleeve");
    expect(plainFact({ label: "Variant", value: "without sleeve" })).toBe("variant without sleeve");
  });
  it("the sentence: colon form, two-way facts first, the rest in order, comma-joined; no facts -> no colon", () => {
    expect(noSkuSentence("slot diffuser", [{ label: "Damper", value: "without", twoWay: true }, { label: "width", value: 600 }, { label: "height", value: 600 }]))
      .toBe("No SKU for slot diffuser: without damper, width 600, height 600 - price this row by hand");
    expect(noSkuSentence("fire damper", [{ label: "Variant", value: "UL" }, { label: "UL listed", value: "no", twoWay: true }]))
      .toBe("No SKU for fire damper: UL listed no, variant UL - price this row by hand");
    expect(noSkuSentence("Acoustic Nitrile Insulation", [{ label: "Cladding", value: "GI Framework with perforated Al sheet" }]))
      .toBe("No SKU for Acoustic Nitrile Insulation: cladding GI Framework with perforated Al sheet - price this row by hand");
    expect(noSkuSentence("cross-talk", [])).toBe("No SKU for cross-talk - price this row by hand");
    // a family written with a leading space (the catalogue's own spelling) reads as one sentence
    expect(noSkuSentence(" Fiberglass Rigid Board Insulation, Density 48Kg/m3", [{ label: "Cladding", value: "26G Aluminium" }]))
      .toBe("No SKU for Fiberglass Rigid Board Insulation, Density 48Kg/m3: cladding 26G Aluminium - price this row by hand");
  });
  it("the one plain-English function leaves the sentence alone (it is already plain): idempotent", () => {
    for (const s of ["No SKU for fire damper: UL listed no, variant UL - price this row by hand",
                     "No SKU for slot diffuser: without damper, width 600, height 600 - price this row by hand"]) {
      expect(plainPricerText(s, ITEMS)).toBe(s);
    }
  });

  /** Every refusal of this kind the recon's R4 table produced, plus the size-only and Insulation ones, from the entry point. */
  const REFUSALS: Array<[string, () => string | undefined, string]> = [
    ["fire damper per sq.m, Variant UL + UL no", () => calc(ADP, "fire damper", { variant: "UL", ul: "no" }, "sqm").v.reason,
      "No SKU for fire damper: UL listed no, variant UL - price this row by hand"],
    ["fire damper per number 600x600, Variant UL + UL no", () => calc(ADP, "fire damper", { variant: "UL", ul: "no", size_mm: "600x600" }, "nos").v.reason,
      "No SKU for fire damper: UL listed no, variant UL, width 600, height 600 - price this row by hand"],
    ["slot diffuser per sq.m, damper never stated", () => calc(ADP, "slot diffuser", {}, "sqm").v.reason,
      "No SKU for slot diffuser: without damper - price this row by hand"],
    ["slot diffuser per number 600x600, damper never stated", () => calc(ADP, "slot diffuser", { size_mm: "600x600" }, "nos").v.reason,
      "No SKU for slot diffuser: without damper, width 600, height 600 - price this row by hand"],
    ["slot diffuser per metre, without damper, 4 slots (model)", () => panel(ADP, { family: "slot diffuser", damper: "without", slot_count: "4 slot" }, "Rmt").v.reason,
      "No SKU for slot diffuser: without damper, slot count 4 - price this row by hand"],
    ["cross-talk per number 400 x 300 (model; a size the sheet does not derive)", () => panel(ADP, { family: "cross-talk", size_mm: "400x300" }, "Nos").v.reason,
      "No SKU for cross-talk: width 400, height 300 - price this row by hand"],
    ["round diffuser, a damper value outside the list (model)", () => panel(ADP, { family: "round diffuser", damper: "yes", dia_mm: "200" }, "nos").v.reason,
      "No SKU for round diffuser: damper yes - price this row by hand"],
    ["Thermal Nitrile sheet + glass cloth is refused by its OWN ruled sentence, not this one (D9b unchanged)", () => panel(INS, { item: "Thermal Nitrile Insulation", cladding: "Glass Cloth with paint", thickness_mm: "19" }, "sqm").v.reason,
      "glass cloth is not offered on sheet insulation - price this row by hand"],
  ];
  it.each(REFUSALS)("%s", (_, run, want) => {
    expect(run()).toBe(want);
  });
  it("Insulation is reworded too (Decision 1 'option a'): the pure pricer on a cladding the family does not stock", () => {
    const r = priceItemList(SPEC[INS], ITEMS, "Rmt", [{ attributes: cells({ item: "Tubular Puf Insulation", cladding: "Glass Cloth with paint", thickness_mm: "50", pipe_size_mm: "50" }) }]);
    expect(r.priced).toBe(false);
    expect(r.items[0].reason).toBe("No SKU for Tubular Puf Insulation: cladding Glass Cloth with paint - price this row by hand");
  });
  it("NEGATIVE: the old bracket wording is gone from every refusal above, and Piping's own refusals are untouched", () => {
    for (const [, run] of REFUSALS) expect(run() ?? "").not.toMatch(/no SKU for this combination/);
    expect(calc(PIP, "MS", { size_mm: "350" }, "mts", ["size_mm"]).v.reason).toBe("pipe size 350 is above the largest size on the sheet (300)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-2b AC5 -- D4 (a): slot diffuser per sq.m / per number keeps 'damper not mentioned -> without' and refuses by name", () => {
  it.each([["sqm", {} as Record<string, string>, "No SKU for slot diffuser: without damper - price this row by hand"],
           ["nos", { size_mm: "600x600" }, "No SKU for slot diffuser: without damper, width 600, height 600 - price this row by hand"]] as const)(
    "per %s, a fresh block: Damper shows with / without, the value used is 'without' (amber), the row refuses naming the pair", (unit, attrs, want) => {
      const { b, v, values } = calc(ADP, "slot diffuser", { ...attrs }, unit);
      expect(field(b, "damper").options).toEqual(["with", "without"]);
      expect(field(b, "damper").value).toBe("without");
      expect(field(b, "damper").defaulted).toBe(true);
      // INVERTED at 12e-4b (owner G2: no working line repeats itself). BEFORE:
      //   expect(b.working).toContain("damper not mentioned -> without (damper not mentioned (or not answered) = without)");
      expect(b.working).toContain("damper not mentioned -> without");
      expect(b.working.some((w) => w.includes("(damper not mentioned"))).toBe(false);
      expect(values).toEqual({});
      expect(v.reason).toBe(want);
      // picking "with" prices
      const withDamper = calc(ADP, "slot diffuser", { ...attrs, damper: "with" }, unit);
      expect(withDamper.v.rowPriced).toBe(true);
      // picking "without" by hand refuses with the SAME sentence -- the calculator / panel divergence is gone
      const picked = calc(ADP, "slot diffuser", { ...attrs, damper: "without" }, unit);
      expect(picked.v.reason).toBe(want);
      expect(field(picked.b, "damper").value).toBe("without");
    });
  it("per sq.m with damper: 12,992 / 2,864 (the one stocked SKU at that unit)", () => {
    expect(fig(calc(ADP, "slot diffuser", { damper: "with" }, "sqm").values)).toEqual([12992, 2864]);
  });
  it("NEGATIVE: per METRE both are stocked and nothing changed -- without damper, 2 slots prices", () => {
    expect(calc(ADP, "slot diffuser", { damper: "without", slot_count: "2" }, "rmt").v.rowPriced).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-2b AC6 -- on the Piping size axis a slash is an inch fraction only when it can be one", () => {
  // INVERTED at 12e-3b (owner 2026-10-11 "yes for both": an inch fraction = top number <= 16 AND bottom in the list) for
  // "63/64" ONLY. BEFORE: "63/64" sat in the `ok` list below (sizes null) and `isOneSizeEntry("63/64")` was true -- the
  // 12e-2b test was "a smaller numerator". Its top number is above 16, so it is now two sizes.
  it("the rule: denominators 2, 4, 8, 16, 32, 64 with a top number of 16 or less (12e-3b; BEFORE: a smaller numerator), with or without a whole number", () => {
    expect(INCH_DENOMINATORS).toEqual([2, 4, 8, 16, 32, 64]);
    for (const ok of ["7/8", "1-1/4", "1 1/4", "5/8\"", "3/4 inch", "15/16", "1/2"]) expect({ ok, sizes: slashSizes(ok) }).toEqual({ ok, sizes: null });
    expect(slashSizes("63/64")).toEqual(["63", "64"]);
    expect(slashSizes("40/50")).toEqual(["40", "50"]);
    expect(slashSizes("50/65")).toEqual(["50", "65"]);
    expect(slashSizes("40 / 50 / 65")).toEqual(["40", "50", "65"]);
    expect(slashSizes("8/7")).toEqual(["8", "7"]);                  // numerator not smaller
    expect(slashSizes("3/5")).toEqual(["3", "5"]);                  // 5 is not an inch denominator
    expect(slashSizes("50")).toBeNull();                            // no slash: not this rule's business
    expect(slashSizes("as per spec")).toBeNull();
    expect(severalSizesMessage("pipe size", ["40", "50"])).toBe("pipe size states two sizes (40 / 50) - pick one");
    expect(severalSizesMessage("pipe size", ["40", "50", "65"])).toBe("pipe size states several sizes (40 / 50 / 65) - pick one");
    expect(isOneSizeEntry("63/64")).toBe(false);                    // 12e-3b: BEFORE true (see the note above the test)
    expect(isOneSizeEntry("15/16")).toBe(true);
    expect(isOneSizeEntry("40/50")).toBe(false);
  });
  // INVERTED at 12e-3b (owner 2026-10-11; REPLACES "40/50 refuses"). BEFORE, on both paths: values {}; reason
  // `pipe size states two sizes (<sizes>) - pick one`; notes `You typed <text>: <reason>` / `BoQ says <text>: <reason>`.
  it.each([["40/50", "40 / 50", "50"], ["50/65", "50 / 65", "65"]])("'%s' prices the higher on BOTH paths with 'states two sizes (%s) - the higher, %s, is taken' (BEFORE: refused '- pick one')", (text, sizes, higher) => {
    const taken = `states two sizes (${sizes}) - the higher, ${higher}, is taken`;
    const typed = calc(PIP, "MS", { size_mm: text }, "mts", ["size_mm"]);
    const model = panel(PIP, { pipe_type: "MS", size_mm: text }, "Rmt");
    const alone = calc(PIP, "MS", { size_mm: higher }, "mts", ["size_mm"]);
    expect(alone.v.rowPriced).toBe(true);
    for (const x of [typed, model]) {
      expect(x.v.rowPriced).toBe(true);
      expect(x.values).toEqual(alone.values);                       // the higher size's own price, nothing else
      expect(x.b.working).toContain(`pipe size ${taken}`);
      expect(x.v.reason).toBeUndefined();
    }
    expect(field(typed.b, "size_mm").note).toBe(`You typed ${text}: ${taken}`);
    expect(field(model.b, "size_mm").note).toBe(`BoQ says ${text}: ${taken}`);
    expect(field(typed.b, "size_mm").note).not.toContain("pick one");
  });
  it.each([["7/8\"", "Copper", 1814, 220, "22.2"], ["7/8", "Copper", 1814, 220, "22.2"], ["1-1/4", "Copper", 2925, 220, "31.7"], ["1 1/4", "Copper", 2925, 220, "31.7"]] as const)(
    "NEGATIVE: a real inch form still converts on both paths: %s on %s -> %s / %s", (text, fam, supply, install, rung) => {
      const typed = calc(PIP, fam, { size_mm: text }, "mts", ["size_mm"]);
      const model = panel(PIP, { pipe_type: fam, size_mm: text }, "Rmt");
      expect(fig(typed.values)).toEqual([supply, install]);
      expect(fig(model.values)).toEqual([supply, install]);
      expect(field(typed.b, "size_mm").value).toBe(rung);
    });
  it("NEGATIVE: every other typed refusal keeps the one-size message ('two inch', '40-50', 'as per spec')", () => {
    for (const text of ["two inch", "40-50", "as per spec"]) expect(calc(PIP, "MS", { size_mm: text }, "mts", ["size_mm"]).v.reason).toBe(ONE_SIZE_MESSAGE);
  });
  it("NEGATIVE: Insulation's pipe-size reader shares `readNumber` and is untouched -- it declares no `typed_entry`, so the slash rule never reaches it", () => {
    expect(SPEC[INS].numbers.pipe_size_mm.typed_entry).toBeUndefined();
    expect(SPEC[PIP].numbers.size_mm.typed_entry).toBe("one_size");
    for (const cat of [INS, ADP]) for (const [, reader] of Object.entries(SPEC[cat].numbers)) expect(reader.typed_entry).toBeUndefined();
    // the reading Insulation has always had for a slash pair on its inch axis is unchanged by this slice
    const r = priceItemList(SPEC[INS], ITEMS, "Rmt", [{ attributes: cells({ item: "Nitrile Rubber Insulation", cladding: "No", thickness_mm: "19", pipe_size_mm: "7/8" }) }]);
    expect(r.priced).toBe(true);
    expect(r.items[0].reason ?? "").not.toMatch(/states two sizes/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-2b AC7 -- the Derivation tab: the family is named, and Piping never reads 'per square metre'", () => {
  const lines = (cat: string) => itemListRuleOrder(CFG[cat], ITEMS);
  const text = (cat: string) => lines(cat).map((l) => `${l.title} | ${l.detail ?? ""}`);
  it("Piping line 10 prints the families the line serves, never the literal '{family}'", () => {
    const l10 = lines(PIP)[9];
    expect(l10.n).toBe(10);
    expect(l10.detail).toBe("'<the stated figure> stated -> priced at the one Copper / MS / PVC / CPVC rate (the sheet has no class rates)'");
    for (const cat of ITEM_LIST) expect(text(cat).join("\n")).not.toMatch(/\{family\}|\{match\}/);
  });
  it("Piping's unit line is written from its own unit class: per metre, one rule -- no 'square metre' anywhere on the tab", () => {
    expect(lines(PIP)[5]).toEqual({ n: 6, title: "That kind's rule for that unit", detail: "a kind is priced per metre and has one rule for it" });
    expect(text(PIP).join("\n")).not.toMatch(/square metre|sq\.m/i);
  });
  // INVERTED at 12e-3b (owner 2026-10-11). BEFORE: line 9's detail ended "...; a slash that is not an inch fraction
  // ('40/50') refuses naming the two sizes, typed or read from the BoQ", and a typed "40/50" gave the reason
  // "pipe size states two sizes (40 / 50) - pick one". The line now says two or more sizes take the higher, and the row prices.
  it("Piping line 9 says what the size box does now: the one-size message for 'two inch', and two or more sizes taking the higher (12e-3b; BEFORE: a slash 'refuses naming the two sizes')", () => {
    const l9 = lines(PIP)[8];
    expect(l9.title).toBe("A typed pipe size is one size, in mm or inches");
    expect(l9.detail).toBe("a number (an NB number is mm) or an inch size (5/8\", 1-1/4\", 2 inch); 'two inch' and '40-50' refuse: Type one pipe size, in mm or inches; two or more sizes written with a slash take the higher ('25/32' prices 32, '25/32/40' prices 40, 1\"/2\" prices 2\"), typed or read from the BoQ, with a line saying so; a slash is an inch fraction only when its top number is 16 or less and its bottom is 2, 4, 8, 16, 32 or 64");
    expect(l9.detail).not.toContain("refuses naming the two sizes");
    // the line and the product agree: both are what the entry point gives
    expect(calc(PIP, "MS", { size_mm: "40-50" }, "mts", ["size_mm"]).v.reason).toBe(ONE_SIZE_MESSAGE);
    expect(calc(PIP, "MS", { size_mm: "40/50" }, "mts", ["size_mm"]).v.reason).toBeUndefined();
    expect(calc(PIP, "MS", { size_mm: "40/50" }, "mts", ["size_mm"]).v.rowPriced).toBe(true);
  });
  it("NEGATIVE: Insulation's and ADP's unit line is byte-identical, and the three counts are unchanged (24 / 18 / 14)", () => {
    for (const cat of [INS, ADP]) {
      const l = lines(cat).find((x) => x.title === "That kind's rule for that unit")!;
      expect(l.detail).toBe("a kind priced per metre and per square metre has a rule for each");
    }
    // INVERTED at 12e-4b (owner F-3): Piping's tab gains the no-unit line. BEFORE: `toEqual([24, 18, 14])`.
    // The negative half is kept: Insulation and ADP are still 24 and 18.
    // INVERTED at 12e-6c (owner U2 / R, 2026-10-18) by mechanical authority: BEFORE `toEqual([24, 18, 15])` and Insulation
    // listed beside ADP as never saying the no-unit line. F-3 now follows `inches` (U2), so Insulation's pipe size says it;
    // the RPUF line (R) is Insulation's too. Without those two Insulation is still 24; ADP is 18 and never says it.
    const NEW_12E6C = ["A pipe size written as a bare number that could be inches refuses", "RPUF with no material answered prices as Tubular Puf Insulation"];
    expect([lines(INS).length, lines(ADP).length, lines(PIP).length]).toEqual([26, 18, 15]);
    expect(lines(INS).filter((l) => !NEW_12E6C.includes(l.title))).toHaveLength(24);
    expect(lines(PIP).map((l) => l.title)).toContain("A pipe size written as a bare number that could be inches refuses");
    expect(lines(INS).map((l) => l.title)).toContain("A pipe size written as a bare number that could be inches refuses");
    expect(lines(ADP).map((l) => l.title)).not.toContain("A pipe size written as a bare number that could be inches refuses");
  });
  it("NEGATIVE (vacuity): a config with two unit classes keeps the old sentence even if it is Piping-shaped", () => {
    const two = structuredClone(CFG[PIP]) as RateCategoryConfig & { list_spec: { pricing: { unit_classes: Record<string, string[]> } } };
    two.list_spec.pricing.unit_classes.area = ["sqm"];
    const l = itemListRuleOrder(two, ITEMS).find((x) => x.title === "That kind's rule for that unit")!;
    expect(l.detail).toBe("a kind priced per metre and per square metre has a rule for each");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * AC13. The fields that HAVE A LADDER, enumerated from the configs (`list_spec.pricing.ladders`), with the control the
 * panel draws for each. A pick is only possible on a dropdown, so those are the fields the ruling can reach.
 */
const LADDER_FIELDS: Record<string, string[]> = {
  hvac_insulation: ["pipe_size_mm (pipe size, dropdown_or_other)", "thickness_mm (thickness, dropdown_or_other)"],
  hvac_adp: ["dia_mm (diameter, dropdown)", "neck_mm (neck size, dropdown)", "torque_nm (torque, dropdown)", "panel_ratio (panel ratio, dropdown)", "thickness_mm (plenum thickness, dropdown)"],
  hvac_piping: ["size_mm (pipe size, dropdown_or_other)"],
};

describe("12e-2b AC13 -- a PICK on a LADDER field that another answer unstocks follows the ladder, exactly as the same value typed", () => {
  it("the ladder fields, from the configs", () => {
    for (const cat of ITEM_LIST) {
      const got = SPEC[cat].ladders.map((a) => `${a} (${SPEC[cat].numbers[a].name}, ${SPEC[cat].panel_controls?.[a] ?? "text"})`);
      expect({ cat, fields: got }).toEqual({ cat, fields: LADDER_FIELDS[cat] });
    }
  });

  it("ADP actuator: torque 6 PICKED, then UL yes -> the UL 8 NM SKU, 23,925 / 800; the field shows 8; the line names the pick and the other answer", () => {
    const { b, values, v } = calc(ADP, "actuator", { torque: "6", ul: "yes" }, "nos");
    expect(v.rowPriced).toBe(true);
    expect(fig(values)).toEqual([23925, 800]);
    expect(field(b, "torque").value).toBe("8");
    expect(field(b, "torque").options).toEqual(["3.5", "8", "20"]);                      // torque still narrows under UL
    // INVERTED at 12e-3b (owner Q13, the unit-spelling table). BEFORE: "6 nm is not stocked with UL listed yes -> priced as 8 nm (next size up)"
    expect(field(b, "torque").note).toBe("6 Nm is not stocked with UL listed yes -> priced as 8 Nm (next size up)");
    expect(field(b, "torque").note).not.toMatch(/\d nm\b/);
    expect(field(b, "torque").otherMode).toBe(false);
    expect(b.skuLine).toBe("Fire Damper Actuator - UL 555 Rated / 8 NM (Nos)");
    // the same value TYPED through "Other..." -- same price, the typed wording
    const typed = calc(ADP, "actuator", { torque: "6", ul: "yes" }, "nos", ["torque"]);
    expect(typed.values).toEqual(values);
    expect(field(typed.b, "torque").note).toBe("You typed 6 Nm -> priced as 8 Nm (next size up)");   // 12e-3b; BEFORE "... 6 nm -> priced as 8 nm ..."
    // and the model path
    expect(panel(ADP, { family: "actuator", torque: "6", ul: "yes" }, "nos").values).toEqual(values);
  });
  it("ADP actuator: torque 10 PICKED, then UL yes -> 20 NM UL, 26,100 / 800", () => {
    const { b, values } = calc(ADP, "actuator", { torque: "10", ul: "yes" }, "nos");
    expect(fig(values)).toEqual([26100, 800]);
    expect(field(b, "torque").note).toBe("10 Nm is not stocked with UL listed yes -> priced as 20 Nm (next size up)");   // 12e-3b; BEFORE "10 nm ... 20 nm"
  });
  it("owner: 'let it remain as it is' -- torque 3.5 with UL untouched still prices the non-UL 6 NM by the ladder (8,410 / 800), no change", () => {
    const { b, values } = calc(ADP, "actuator", { torque: "3.5" }, "nos");
    expect(fig(values)).toEqual([8410, 800]);
    expect(field(b, "torque").value).toBe("6");
  });
  it("Insulation, Tubular PUF: thickness 25 PICKED, then pipe size 100 (which stocks 65) -> 65, 412 / 14, with the line (next size up)", () => {
    const { b, values } = calc(INS, "Tubular Puf Insulation", { cladding: "No", pipe_size_mm: "100", thickness_mm: "25" }, "mts");
    expect(fig(values)).toEqual([412, 14]);
    expect(field(b, "thickness_mm").value).toBe("65");
    // INVERTED at 12e-4d (AC3: below the smallest stocked size both lines say "the smallest size"). BEFORE
    // "25 mm is not stocked with pipe size 100 -> priced as 65 mm (next size up)"
    expect(field(b, "thickness_mm").note).toBe("25 mm is not stocked with pipe size 100 -> priced as 65 mm (the smallest size)");
    expect(calc(INS, "Tubular Puf Insulation", { cladding: "No", pipe_size_mm: "100", thickness_mm: "25" }, "mts", ["thickness_mm"]).values).toEqual(values);
  });
  it("Insulation, Nitrile Rubber: thickness 25 PICKED, then pipe size 6.35 (stocks 13 / 19) -> COMPOSED 13 + 13, 466 / 238, the line on the field AND heading the working", () => {
    const { b, values } = calc(INS, "Nitrile Rubber Insulation", { cladding: "26G Aluminium", pipe_size_mm: "6.35", thickness_mm: "25" }, "mts");
    const line = "25 mm is not stocked with pipe size 6.35 -> priced as 13 + 13 mm (26 mm, +1) -- above the largest stocked size (19 mm)";
    expect(fig(values)).toEqual([466, 238]);
    expect(field(b, "thickness_mm").note).toBe(line);
    expect(b.working[0]).toBe(line);
    expect(b.working.join("\n")).not.toMatch(/You typed/);
    expect(calc(INS, "Nitrile Rubber Insulation", { cladding: "26G Aluminium", pipe_size_mm: "6.35", thickness_mm: "25" }, "mts", ["thickness_mm"]).values).toEqual(values);
  });
  it("NEGATIVE: a field WITHOUT a ladder keeps the 12c-S / 12d-8 R1 rule -- a picked cladding the family does not stock is cleared, 'choose again', never refilled by the default", () => {
    const { b, values, v } = calc(INS, "Acoustic Nitrile Insulation", { cladding: "Aluminium Foil", thickness_mm: "19" }, "sqm");
    expect(values).toEqual({});
    expect(field(b, "cladding").value).toBe("");
    expect(field(b, "cladding").note).toBe("Aluminium Foil is not stocked with the other answers on this item -- choose again");
    expect(v.reason).toBe("choose again: cladding -- the value picked is not stocked with the other answers on this item");
    expect(b.working.join("\n")).not.toMatch(/cladding not mentioned/);
  });
  it("NEGATIVE: a ladder pick the other answers DO stock carries no such line (nothing moved)", () => {
    const { b } = calc(ADP, "actuator", { torque: "8", ul: "yes" }, "nos");
    expect(field(b, "torque").note).toBeUndefined();
    expect(field(b, "torque").value).toBe("8");
  });
  it("Piping has ONE ladder field and no other answer in the block: no pick can be unstocked by another pick, so the rule has no in-block case there (a family change still starts the block blank -- owner S1, kept)", () => {
    for (const fam of Object.keys(SPEC[PIP].families)) {
      const defs = itemFieldDefs(SPEC[PIP], listSpecDefs(CFG[PIP]), fam, "length", { items: ITEMS });
      expect(defs.filter((f) => (f.options ?? []).length > 0).map((f) => f.id)).toEqual(["size_mm"]);
    }
  });

  /**
   * THE STOP CONDITION, SWEPT: "STOP if any ladder field's laddered pick would price differently from the same value
   * typed." For every item-list category, family and unit class: every (other field's option) x (a ladder field's
   * option that answer takes off the list) -- priced once as a PICK and once TYPED through "Other...". The figures, the
   * state and the row reason must be identical; only the field's line differs.
   */
  it("SWEEP: every ladder pick another answer unstocks prices exactly as the same value typed", () => {
    const found: Record<string, number> = {};
    const bad: string[] = [];
    const idOf = (spec: ItemListPricingSpec, skuAttr: string) => spec.numbers[skuAttr]?.from[0] ?? skuAttr;
    for (const cat of ITEM_LIST) {
      const spec = SPEC[cat];
      const defs = listSpecDefs(CFG[cat]);
      for (const family of Object.keys(spec.families)) {
        const fam = spec.families[family];
        for (const cls of [...Object.keys(fam.units), ...Object.keys(fam.convert ?? {})]) {
          const unit = spec.unit_classes[cls][0];
          const base = itemFieldDefs(spec, defs, family, cls, { items: ITEMS });
          for (const lf of base.filter((f) => spec.ladders.includes(f.skuAttr) && (f.options ?? []).length > 1)) {
            for (const of of base.filter((f) => f.skuAttr !== lf.skuAttr && (f.options ?? []).length > 0)) {
              // the stale-pick rule judges down the ladders' order: the other answer must be settled BEFORE this field
              const rank = (a: string) => spec.ladders.indexOf(a);
              if (rank(of.skuAttr) > rank(lf.skuAttr)) continue;
              for (const ov of of.options ?? []) {
                if (ov === "None") continue;
                const under = itemFieldDefs(spec, defs, family, cls, { items: ITEMS, answers: { [of.skuAttr]: ov } }).find((f) => f.id === lf.id)?.options ?? [];
                for (const pick of (lf.options ?? []).filter((o) => !under.includes(o))) {
                  const attrs = { [idOf(spec, of.skuAttr)]: ov, [idOf(spec, lf.skuAttr)]: pick };
                  const p = calc(cat, family, attrs, unit);
                  const t = calc(cat, family, attrs, unit, [idOf(spec, lf.skuAttr)]);
                  const key = `${cat}.${lf.skuAttr} unstocked by ${of.skuAttr}`;
                  found[key] = (found[key] ?? 0) + 1;
                  const same = JSON.stringify([p.values, p.b.state, p.v.reason ?? null, field(p.b, lf.id).value]) === JSON.stringify([t.values, t.b.state, t.v.reason ?? null, field(t.b, lf.id).value]);
                  if (!same) bad.push(`${key}: ${family} per ${unit} ${JSON.stringify(attrs)} pick ${JSON.stringify(p.values)} / ${p.v.reason} vs typed ${JSON.stringify(t.values)} / ${t.v.reason}`);
                  // never cleared, never "choose again" on a ladder field
                  if (/choose again/.test(`${field(p.b, lf.id).note ?? ""} ${p.v.reason ?? ""}`)) bad.push(`${key}: ${family} ${JSON.stringify(attrs)} still says choose again`);
                  // a pick that PRICED says what happened to it, in the pick's words
                  if (p.v.rowPriced && !/ is not stocked with .* -> priced as /.test(field(p.b, lf.id).note ?? "")) bad.push(`${key}: ${family} ${JSON.stringify(attrs)} priced without the line: ${field(p.b, lf.id).note}`);
                }
              }
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
    expect(found).toEqual(SWEEP_COUNTS);
  }, 120000);
});

/** The sweep's reach, by ladder field and the answer that unstocks it (measured on v36; a mint that adds SKUs moves it loudly). */
const SWEEP_COUNTS: Record<string, number> = {
  "hvac_adp.torque_nm unstocked by ul": 3,
  "hvac_insulation.thickness_mm unstocked by pipe_size_mm": 38,
};
