/**
 * SLICE 12e-2 (owner option "1", 2026-10-10 10:58; rulings "option b, yes" / Q14 / Q14a / Q17 / Q11 / Q16 / Q15
 * / Q10 / Q19 / Q18 / Q2 / Q12; amendment 10:29 "Other..." pipe type) -- PIPING PRICES IN THE CALCULATOR AND ON
 * A BoQ ROW, every rule tested from the PANEL'S ENTRY POINT (`makePricingSheetHelper(...).compute`) on the
 * committed v36 asset, read at runtime.
 *
 *   P1  pipe type: the stocked families; GI -> MS, uPVC / HDPE -> PVC with the "priced as" line; SS refuses with
 *       its own sentence; any other spelling refuses by name; typed through the family field's "Other..." box
 *       (the calculator) or read off the row's own words (Q15, a synthetic row).
 *   P2  pipe size: the ladder -- mm at 2 dp -> 1 dp -> inch x 25.4 at 2 dp -> 1 dp -> inch x 25 at 2 dp -> 1 dp
 *       -> the nearest stocked size within 0.1 mm -> below the smallest -> the smallest -> between -> the next
 *       size up -> above the largest -> refuse naming it; a typed entry is ONE size.
 *   P3  class / wall thickness: an optional box; the read-note line; never a figure.
 *   P4  unit: the length family prices; no unit and R/O price per metre with the note; any other unit refuses.
 *   P5  price: ROUNDUP(ROUNDUP(BCS pipe x (1 + accessories input)) x (1 + supply markup)); install likewise; x qty.
 *   AC1 the E2E: the copper accessories input 0.30 -> 0.40 moves copper 15.9 from 1298 to 1397 on the
 *       calculator path AND on the impact panel's own path (`priceSkuExactItemList`), to the rupee.
 *   AC8 the 40 figures through the entry point equal the sheet's BoQ Supply / BoQ Installation (K / L),
 *       one assertion per row, named by family and size, on BOTH paths.
 *   Insulation and ADP: no family control, no family line, the 12d-8 lines byte-identical.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { readJsonFixture, runParity, type ParityCase } from "@/pages/pricing/calculatorPanelParity.harness";
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
import { itemsWithInput, priceSkuExactItemList } from "@/pages/pricing/rate-master/pricingInputExact";
import { computePricingInputReach } from "@/pages/pricing/rate-master/pricingInputReach";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, initialItemEdits, makePricingSheetHelper,
  type ItemBlockView, type ItemListSuggestion,
} from "./pricingSheetHelper";
import {
  ONE_SIZE_MESSAGE, familyFromRowText, isOneSizeEntry, itemListPricingSpec, readFamilyText, readNumber,
} from "./itemListPricing";
import { nearestRung } from "./ladderResolution";

const ASSET = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
  new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v36.json", import.meta.url),
);
const CFG: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET.category_configs.map((c) => [c.category_id, c]));
const CONFIGS = new Map<string, RateCategoryConfig>(Object.entries(CFG));
const ITEMS: RateMasterItem[] = ASSET.items.map((it) => ({ ...it, discipline: ASSET.discipline } as RateMasterItem));
const PIP = "hvac_piping";
const SPEC = itemListPricingSpec(CFG[PIP])!;
const KINDS = ["supply_rate", "install_rate", "combined_rate"] as const;
const FAM = "pipe_type";
const INCH = '"';

/** The sheet's own figures (rows 2-41 of "Piping"): family, size as the sheet spells it, BoQ Supply (K), BoQ Installation (L). */
const SHEET: Array<[string, string, number, number]> = [
  ["Copper", "47.6", 4680, 220], ["Copper", "41.3", 4193, 220], ["Copper", "38.1", 3881, 220], ["Copper", "34.9", 3573, 220],
  ["Copper", "31.7", 2925, 220], ["Copper", "28.6", 2438, 220], ["Copper", "25.4", 2243, 220], ["Copper", "22.2", 1814, 220],
  ["Copper", "19.1", 1590, 220], ["Copper", "15.9", 1298, 220], ["Copper", "12.7", 936, 220], ["Copper", "9.5", 429, 220],
  ["Copper", "6.4", 390, 220],
  ["MS", "300", 6720, 1680], ["MS", "250", 5616, 1400], ["MS", "200", 4800, 1120], ["MS", "150", 3360, 840], ["MS", "125", 3120, 700],
  ["MS", "100", 2256, 560], ["MS", "80", 1440, 420], ["MS", "65", 1200, 350], ["MS", "50", 984, 280], ["MS", "40", 720, 210],
  ["MS", "32", 600, 175], ["MS", "25", 480, 140], ["MS", "19", 456, 112],
  ["PVC", "150", 1212, 168], ["PVC", "100", 528, 140], ["PVC", "75", 300, 112], ["PVC", "65", 264, 84], ["PVC", "50", 252, 56],
  ["PVC", "40", 216, 42], ["PVC", "32", 168, 28], ["PVC", "25", 120, 28],
  ["CPVC", "75", 768, 112], ["CPVC", "65", 672, 84], ["CPVC", "50", 576, 56], ["CPVC", "40", 504, 42], ["CPVC", "32", 408, 28],
  ["CPVC", "25", 240, 28],
];

type Edit = { base: number | null; family: string | null; attrs: Record<string, string>; other?: string[]; qty?: string };
const cells = (a: Record<string, string>): ExtractionRow["attributes"] =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));

/** The CALCULATOR path: an empty extraction map, every value an override. */
function calc(edits: Edit[], unit = "mts", items: RateMasterItem[] = ITEMS, configs = CONFIGS) {
  const h = makePricingSheetHelper({ configsByCategory: configs, items, extractionByRow: new Map() });
  const ctx: RateHelperRowContext = { excelRow: 7, description: "", nodeType: "", category: PIP, discipline: "HVAC", rateKinds: [...KINDS] };
  const r = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: edits }), [ROW_UNIT_OVERRIDE_KEY]: unit });
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, b: s.itemList!.items[0] as ItemBlockView | undefined, values: s.values };
}
/** The PANEL path: a stored answer through `extractionByRow`, the row's own unit and text. */
function panel(answer: Record<string, string>, unit: string | undefined, text: { description?: string; ownNotes?: string[]; headings?: string[] } = {}, edits?: Edit[]) {
  const row = { excelRow: 1, description: text.description ?? "", attributes: {}, items: [{ attributes: cells(answer) }] } as ExtractionRow;
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
  const ctx: RateHelperRowContext & { unit?: string } = {
    excelRow: 1, description: text.description ?? "", nodeType: "Line Item", category: PIP, discipline: "HVAC", rateKinds: [...KINDS],
    headings: text.headings ?? [], ownNotes: text.ownNotes ?? [], ...(unit !== undefined ? { unit } : {}),
  };
  const r = h.compute(ctx, edits ? { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: edits }) } : {});
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, b: s.itemList!.items[0] as ItemBlockView, values: s.values };
}
const typedType = (text: string, attrs: Record<string, string>, other: string[] = []): Edit[] =>
  [{ base: null, family: text, attrs, other: [FAM, ...other] }];
const picked = (family: string, attrs: Record<string, string>, other: string[] = [], qty?: string): Edit[] =>
  [{ base: null, family, attrs, other, ...(qty !== undefined ? { qty } : {}) }];
const size = (b: ItemBlockView | undefined) => b?.fields.find((f) => f.id === "size_mm");
const fig = (values: Record<string, number>) => [values.supply_rate, values.install_rate];

describe("12e-2 AC8 -- the 40 figures through the entry point equal the sheet's BoQ Supply / BoQ Installation (K / L)", () => {
  it.each(SHEET)("%s %s mm -> %s / %s on the CALCULATOR path", (fam, sz, k, l) => {
    const { s, b } = calc(picked(fam, { size_mm: sz }));
    expect({ fam, sz, figures: fig(s.values) }).toEqual({ fam, sz, figures: [k, l] });
    expect(b?.state).toBe("priced");
    // an exact stocked size carries no "priced as" line (the value used is the value entered)
    expect(size(b)?.note).toBeUndefined();
    expect(size(b)?.value).toBe(sz);
  });
  it.each(SHEET)("%s %s mm -> %s / %s on the PANEL path (a model answer)", (fam, sz, k, l) => {
    const { s } = panel({ pipe_type: fam, size_mm: sz }, "Rmt");
    expect({ fam, sz, figures: fig(s.values) }).toEqual({ fam, sz, figures: [k, l] });
  });
  it("the two paths agree on every one of the 40 SKUs (the harness drives both real branches)", () => {
    const bad: string[] = [];
    for (const [fam, sz] of SHEET) {
      const c: ParityCase = { cat: PIP, unit: "mts", desc: "", attrs: {}, items: [{ [FAM]: fam, size_mm: sz }] };
      const r = runParity(CONFIGS, ITEMS, c, "full");
      if (r.divergences.length) bad.push(`${fam} ${sz}: ${r.divergences.map((d) => `${d.what} P[${d.panel}] C[${d.calculator}]`).join(" | ")}`);
    }
    expect(bad).toEqual([]);
  });
  it("P5 -- the working names every input: the accessories input by its label, BCS pipe, the two ROUNDUPs, the install markup", () => {
    const { b } = calc(picked("Copper", { size_mm: "15.9" }));
    const w = b!.working.join("\n");
    expect(w).toContain("supply: pricing input: Piping accessories - Copper (factor) = 0.3");
    expect(w).toContain("supply: BCS pipe = 665");
    expect(w).toContain("supply: BCS pipe x (1 + the accessories share) = 864.5");
    expect(w).toContain("supply: ROUNDUP(BCS supply, 0) = 865");
    expect(w).toContain("supply: BCS supply x (1 + the SKU's supply markup) = 1297.5");
    expect(w).toContain("supply: ROUNDUP(supply, 0) = 1298");
    expect(w).toContain("install: BCS install = 110");
    expect(w).toContain("install: BCS install x (1 + the SKU's install markup) = 220");
    expect(w).not.toMatch(/\b[a-z0-9]+_[a-z0-9_]+\b/i);   // no internal id on screen (12d-5)
    // NEGATIVE: an MS row reads ITS input (0.6) and never copper's
    const ms = calc(picked("MS", { size_mm: "50" })).b!.working.join("\n");
    expect(ms).toContain("supply: pricing input: Piping accessories - MS (factor) = 0.6");
    expect(ms).not.toContain("Copper");
    expect(ms).toContain("supply: BCS pipe x (1 + the accessories share) = 656");
  });
  it("M2 -- the quantity is 'how many in one row unit', default 1 marked, a typed 2 doubles the row and says so", () => {
    const one = calc(picked("Copper", { size_mm: "15.9" }));
    expect(one.b!.qtyDefaulted).toBe(true);
    expect(fig(one.values)).toEqual([1298, 220]);
    const two = calc(picked("Copper", { size_mm: "15.9" }, [], "2"));
    expect(two.b!.qtyDefaulted).toBe(false);
    expect(fig(two.values)).toEqual([2596, 440]);
    expect(two.b!.working.join("\n")).toContain("x 2 per row unit");
    // NEGATIVE: a non-positive quantity refuses
    const zero = calc(picked("Copper", { size_mm: "15.9" }, [], "0"));
    expect(zero.v.rowPriced).toBe(false);
    expect(zero.b!.reason).toContain("quantity per row unit '0' is not a positive number");
  });
});

describe("12e-2 P2 -- the pipe-size ladder, every typed form (the cert's table)", () => {
  const LADDER: Array<{ id: string; fam: string; typed: string; rung: string; figures: [number, number]; line: string }> = [
    { id: "5/8 inch (1 dp match)", fam: "Copper", typed: `5/8${INCH}`, rung: "15.9", figures: [1298, 220], line: `You typed 5/8${INCH} -> 15.875 mm -> priced as 15.9 mm (the sheet's own spelling of this size)` },
    { id: "1-1/4 inch (the 0.1 mm rung)", fam: "Copper", typed: `1-1/4${INCH}`, rung: "31.7", figures: [2925, 220], line: `You typed 1-1/4${INCH} -> 31.75 mm -> priced as 31.7 mm (the sheet's own spelling of this size)` },
    { id: "1 1/4 inch (space)", fam: "Copper", typed: `1 1/4${INCH}`, rung: "31.7", figures: [2925, 220], line: `You typed 1 1/4${INCH} -> 31.75 mm -> priced as 31.7 mm (the sheet's own spelling of this size)` },
    { id: "1¼ inch (unicode)", fam: "Copper", typed: `1¼${INCH}`, rung: "31.7", figures: [2925, 220], line: `You typed 1¼${INCH} -> 31.75 mm -> priced as 31.7 mm (the sheet's own spelling of this size)` },
    { id: "4 inch (the x 25 conversion)", fam: "MS", typed: "4 inch", rung: "100", figures: [2256, 560], line: "You typed 4 inch -> 101.6 mm / 100 mm -> priced as 100 mm" },
    { id: "2 inch (the x 25 conversion)", fam: "MS", typed: `2${INCH}`, rung: "50", figures: [984, 280], line: `You typed 2${INCH} -> 50.8 mm / 50 mm -> priced as 50 mm` },
    { id: "1 inch copper (x 25.4 exact)", fam: "Copper", typed: "1 inch", rung: "25.4", figures: [2243, 220], line: "You typed 1 inch -> 25.4 mm -> priced as 25.4 mm" },
    { id: "15.88 (2 dp -> 1 dp)", fam: "Copper", typed: "15.88", rung: "15.9", figures: [1298, 220], line: "You typed 15.88 -> priced as 15.9 mm (the sheet's own spelling of this size)" },
    { id: "15 (below the smallest MS)", fam: "MS", typed: "15", rung: "19", figures: [456, 112], line: "You typed 15 -> priced as 19 mm (the smallest size)" },
    { id: "110 (between: next size up)", fam: "PVC", typed: "110", rung: "150", figures: [1212, 168], line: "You typed 110 -> priced as 150 mm (next size up)" },
    { id: "50 NB (an NB number is mm)", fam: "CPVC", typed: "50 NB", rung: "50", figures: [576, 56], line: "You typed 50 NB -> 50 mm -> priced as 50 mm" },
  ];
  it.each(LADDER.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const { s, b, v } = calc(picked(c.fam, { size_mm: c.typed }, ["size_mm"]));
    expect({ id: c.id, priced: v.rowPriced, figures: fig(s.values) }).toEqual({ id: c.id, priced: true, figures: c.figures });
    const f = size(b)!;
    expect({ id: c.id, value: f.value, typed: f.typedValue, other: f.otherMode }).toEqual({ id: c.id, value: c.rung, typed: c.typed, other: true });
    expect({ id: c.id, note: f.note }).toEqual({ id: c.id, note: c.line });
  });
  it("above the largest refuses naming it (MS 350 -> 300); the field keeps the typed text and no price", () => {
    const { s, b, v } = calc(picked("MS", { size_mm: "350" }, ["size_mm"]));
    expect(v.rowPriced).toBe(false);
    expect(s.values).toEqual({});
    expect(b!.reason).toBe("pipe size 350 is above the largest size on the sheet (300)");
    expect(size(b)!.value).toBe("");
    expect(size(b)!.note).toContain("You typed 350 mm: pipe size 350 is above the largest size on the sheet (300)");
    // and copper's largest is its own (47.6), not MS's
    expect(calc(picked("Copper", { size_mm: "50" }, ["size_mm"])).b!.reason).toBe("pipe size 50 is above the largest size on the sheet (47.6)");
  });
  // INVERTED at 12e-2b (AC6) for "40/50" ONLY: BEFORE it sat in the list below and refused with ONE_SIZE_MESSAGE. A slash
  // that cannot be an inch fraction now states two sizes, on the typed path and the model path alike.
  // INVERTED AGAIN at 12e-3b (owner 2026-10-11, "use the higher size"; REPLACES 12e-2b's "40/50 refuses"). BEFORE:
  //   rowPriced false; reason "pipe size states two sizes (40 / 50) - pick one";
  //   note "You typed 40/50: pipe size states two sizes (40 / 50) - pick one".
  it("12e-3b AC2: a typed '40/50' prices the higher, MS 50 at 984 / 280, with 'states two sizes (40 / 50) - the higher, 50, is taken' (BEFORE: refused '- pick one')", () => {
    const { s, b, v } = calc(picked("MS", { size_mm: "40/50" }, ["size_mm"]));
    expect(v.rowPriced).toBe(true);
    expect([s.values.supply_rate, s.values.install_rate]).toEqual([984, 280]);
    expect(size(b)!.value).toBe("50");
    expect(size(b)!.note).toBe("You typed 40/50: states two sizes (40 / 50) - the higher, 50, is taken");
    expect(b!.working).toContain("pipe size states two sizes (40 / 50) - the higher, 50, is taken");
    // the negative half kept: it is still never the one-size message, and never "- pick one"
    expect(b!.reason).not.toBe(ONE_SIZE_MESSAGE);
    expect(size(b)!.note).not.toContain(ONE_SIZE_MESSAGE);
    expect(size(b)!.note).not.toContain("pick one");
  });
  it.each([["two inch"], ["40-50"], ["as per spec"], ["13+13"]])("a typed entry that is not one size refuses: %s", (typed) => {
    const { b, v } = calc(picked("MS", { size_mm: typed }, ["size_mm"]));
    expect(v.rowPriced).toBe(false);
    expect(b!.reason).toBe(ONE_SIZE_MESSAGE);
    expect(size(b)!.note).toContain(ONE_SIZE_MESSAGE);
  });
  /**
   * INVERTED at 12e-2b (AC6; 12e-2 cert finding 7). BEFORE: "the one-size rule is TYPED-only -- a MODEL answer '40/50' is
   * read as before (... 0.8 inch = 20.32 -> 25)": rowPriced TRUE, working containing "pipe size 20.32 is not on the sheet
   * -> 25 (next size up", note "BoQ says 40/50 -> 20.32 mm -> priced as 25 mm (next size up)". That row priced a 25 mm
   * pipe from a BoQ that said 40 or 50. It now refuses naming the two sizes; the ONE_SIZE_MESSAGE half stays typed-only.
   */
  it("12e-2b AC6: a MODEL answer '40/50' REFUSES naming the two sizes (never 0.8 of an inch); the typed-only message is still never said of a model cell", () => {
    // INVERTED AGAIN at 12e-3b (owner 2026-10-11: "if the model can determine the specific size for the row use it else
    // use the higher size"). BEFORE: rowPriced false; values {}; reason "pipe size states two sizes (40 / 50) - pick one";
    // note "BoQ says 40/50: pipe size states two sizes (40 / 50) - pick one". AFTER: the higher, MS 50, 984 / 280.
    const { b, v, values } = panel({ pipe_type: "MS", size_mm: "40/50" }, "Rmt");
    expect(v.rowPriced).toBe(true);
    expect([values.supply_rate, values.install_rate]).toEqual([984, 280]);
    expect(size(b)!.note).toBe("BoQ says 40/50: states two sizes (40 / 50) - the higher, 50, is taken");
    expect(b.working).toContain("pipe size states two sizes (40 / 50) - the higher, 50, is taken");
    expect(size(b)!.note).not.toContain("pick one");
    expect(b.working.join("\n")).not.toContain("20.32");
    expect(b.reason).not.toBe(ONE_SIZE_MESSAGE);
    expect(isOneSizeEntry("40/50")).toBe(false);
    expect(isOneSizeEntry("5/8")).toBe(true);
    expect(isOneSizeEntry("1-1/4\"")).toBe(true);
    expect(isOneSizeEntry("2 inch")).toBe(true);
    expect(isOneSizeEntry("two inch")).toBe(false);
  });
  it("the reader: the second conversion rides beside the exact one only where the reader declares it", () => {
    const r = readNumber("4 inch", SPEC.numbers.size_mm);
    expect(r).toEqual({ value: 101.6, alt: 100, raw: "4 inch" });
    const ins = itemListPricingSpec(CFG.hvac_insulation)!.numbers.pipe_size_mm;
    expect(readNumber("4 inch", ins)).toEqual({ value: 101.6 });
    expect(nearestRung(31.75, [25.4, 28.6, 31.7, 34.9], 0.1)).toBe(31.7);
    expect(nearestRung(31.9, [25.4, 28.6, 31.7, 34.9], 0.1)).toBeNull();
  });
  it("the 'How is this matched?' help is generated from the stocked sizes and names the two conversions and the 0.1 mm rung", () => {
    const f = size(calc(picked("MS", { size_mm: "50" })).b)!;
    const help = (f.matchHelp ?? []).join("\n");
    expect(help).toContain("A size the sheet stocks is used as it stands (19 mm)");
    // the example is the FIRST whole inch that lands at 25 and not at 25.4 on THIS family's stocked sizes (MS: 1" -> 25)
    expect(help).toContain(`is also tried at 25 mm to the inch: 1${INCH} is 25.4 / 25 and matches 25 mm`);
    expect(help).toContain("A size within 0.1 mm of a stocked size is that size");
    expect(help).toContain("A size below the smallest stocked size (19 mm) is priced as the smallest");
    expect(help).toContain("Larger than the largest stocked size (300 mm) is not priced");
    expect(help).not.toMatch(/\b[a-z0-9]+_[a-z0-9_]+\b/i);
    // NEGATIVE: Insulation's help is byte-identical (no new line on an axis that declares none)
    const insHelp = itemListPricingSpec(CFG.hvac_insulation)!;
    expect(insHelp.numbers.pipe_size_mm.inch_mm_alt).toBeUndefined();
  });
});

describe("12e-2 P1 -- the pipe type: stocked, mapped, refused, read off the row (Q16 / Q18 / Q15)", () => {
  it("typed GI -> priced as MS with the amber line; MS 50's figures; the family USED heads the block", () => {
    const { s, b, v } = calc(typedType("GI", { size_mm: "50" }));
    expect(v.rowPriced).toBe(true);
    expect(fig(s.values)).toEqual([984, 280]);
    expect(b!.family).toBe("MS");
    // INVERTED 12e-4c (owner 2026-10-13, the G1 principle: "BoQ says" only where a BoQ said it). BEFORE: "BoQ says GI -> priced as MS"
    expect(b!.familyLine).toBe("You typed GI -> priced as MS");
    expect(b!.familyControl).toMatchObject({ id: FAM, label: "Pipe type", options: ["Copper", "MS", "PVC", "CPVC"], otherMode: true, typedValue: "GI", note: "Pipe type as the BoQ writes it" });
    expect(b!.working.join("\n")).toContain("You typed GI -> priced as MS");
    expect(b!.working.join("\n")).not.toContain("BoQ says");
  });
  it("typed uPVC 110 -> priced as PVC AND the next-size-up line; typed HDPE 50 -> PVC 50", () => {
    const u = calc(typedType("uPVC", { size_mm: "110" }, ["size_mm"]));
    expect(fig(u.values)).toEqual([1212, 168]);
    expect(u.b!.family).toBe("PVC");
    // INVERTED 12e-4c (owner 2026-10-13, the G1 principle: "BoQ says" only where a BoQ said it). BEFORE: "BoQ says uPVC -> priced as PVC"
    expect(u.b!.familyLine).toBe("You typed uPVC -> priced as PVC");
    expect(size(u.b)!.note).toBe("You typed 110 -> priced as 150 mm (next size up)");
    const h = calc(typedType("HDPE", { size_mm: "50" }));
    expect(fig(h.values)).toEqual([252, 56]);
    // INVERTED 12e-4c (owner 2026-10-13, the G1 principle: "BoQ says" only where a BoQ said it). BEFORE: "BoQ says HDPE -> priced as PVC"
    expect(h.b!.familyLine).toBe("You typed HDPE -> priced as PVC");
  });
  it("typed SS refuses with its own sentence and no price; typed ABC refuses by name (Q18)", () => {
    const ss = calc(typedType("SS", { size_mm: "50" }));
    expect(ss.v.rowPriced).toBe(false);
    expect(ss.s.values).toEqual({});
    expect(ss.b!.reason).toBe("No SKU in the catalogue for SS pipe - price this row by hand");
    expect(ss.b!.familyControl?.typedValue).toBe("SS");
    expect(ss.b!.family).toBe("SS");
    const abc = calc(typedType("ABC", { size_mm: "50" }));
    expect(abc.v.rowPriced).toBe(false);
    expect(abc.b!.reason).toBe("no SKU in the catalogue for 'ABC' -- the user decides");
  });
  it("a stocked spelling in any case prices as that family with NO line; a picked family has no line and a closed box", () => {
    const lower = calc(typedType("ms", { size_mm: "50" }));
    expect(fig(lower.values)).toEqual([984, 280]);
    expect(lower.b!.familyLine).toBeUndefined();
    expect(lower.b!.family).toBe("MS");
    const pick = calc(picked("MS", { size_mm: "50" }));
    expect(pick.b!.familyLine).toBeUndefined();
    expect(pick.b!.familyControl).toMatchObject({ otherMode: false, typedValue: "MS" });
    expect(pick.b!.familyRaw).toBeNull();
  });
  it("no pipe type at all: no price, the type field blank (Q2)", () => {
    const { b, v, s } = calc([{ base: null, family: "", attrs: { size_mm: "50" }, other: [FAM] }]);
    expect(v.rowPriced).toBe(false);
    expect(s.values).toEqual({});
    expect(b!.reason).toBe("no pipe type could be told for this item");
    expect(b!.familyControl?.typedValue).toBe("");
  });
  it("the ONE reader, the model path will reuse (12e-4): readFamilyText", () => {
    expect(readFamilyText(SPEC, "GI")).toEqual({ family: "MS", line: "BoQ says GI -> priced as MS (owner rule)", rule: "Q16 GI is priced as MS (owner 2026-10-10)" });
    expect(readFamilyText(SPEC, " upvc ")).toMatchObject({ family: "PVC" });
    expect(readFamilyText(SPEC, "hdpe")).toMatchObject({ family: "PVC" });
    expect(readFamilyText(SPEC, "SS")).toEqual({ refuse: "No SKU in the catalogue for SS pipe - price this row by hand", rule: "Q16 SS refuses (owner 2026-10-10)" });
    expect(readFamilyText(SPEC, "copper")).toEqual({ family: "Copper" });
    expect(readFamilyText(SPEC, "ABC")).toBeNull();
    expect(readFamilyText(SPEC, "None")).toBeNull();
    // NEGATIVE: Insulation declares no family_text, so only a stocked spelling resolves
    const ins = itemListPricingSpec(CFG.hvac_insulation)!;
    expect(readFamilyText(ins, "Nitrile Rubber Insulation")).toEqual({ family: "Nitrile Rubber Insulation" });
    expect(readFamilyText(ins, "GI")).toBeNull();
  });
  it("Q15 on the PANEL path (a synthetic row, no model type): names that all land on one type price as it; two different types refuse; none -> no type", () => {
    const one = panel({ pipe_type: "None", size_mm: "50" }, "Rmt", { description: "MS / GI pipe 50 mm dia with fittings" });
    expect(one.v.rowPriced).toBe(true);
    expect(fig(one.values)).toEqual([984, 280]);
    expect(one.b.family).toBe("MS");
    expect(one.b.familyLine).toBe("BoQ names MS / GI -> priced as MS");
    const two = panel({ pipe_type: "None", size_mm: "50" }, "Rmt", { description: "copper or PVC drain pipe 50 mm" });
    // 12e-6 R2 INVERTED by mechanical authority (owner 2026-10-16: two stocked types -> the lower cost; CPVC with PVC -> CPVC).
    // BEFORE: rowPriced false, reason "two pipe types are named in this row (Copper, PVC) - pick the type".
    expect(two.v.rowPriced).toBe(true);
    expect(two.b.familyLine).toBe("BoQ allows Copper or PVC -> priced as PVC, the lower cost");
    expect(two.b.family).toBe("PVC");
    const none = panel({ pipe_type: "None", size_mm: "50" }, "Rmt", { description: "pipe 50 mm dia" });
    expect(none.v.rowPriced).toBe(false);
    expect(none.b.reason).toBe("no pipe type could be told for this item");
    // a HEADING never triggers it (the row's OWN text only), and the calculator has no text at all
    const heading = panel({ pipe_type: "None", size_mm: "50" }, "Rmt", { description: "pipe 50 mm", headings: ["MS piping"] });
    expect(heading.b.reason).toBe("no pipe type could be told for this item");
    expect(familyFromRowText(SPEC, "")).toBeNull();
    expect(familyFromRowText(SPEC, "MS / GI pipe")).toMatchObject({ family: "MS", named: ["MS", "GI"] });
  });
  it("a MODEL answer written as GI prices as MS on the panel path with the line, and the control shows the box with GI", () => {
    const { s, b, v } = panel({ pipe_type: "GI", size_mm: "50" }, "Rmt");
    expect(v.rowPriced).toBe(true);
    expect(fig(s.values)).toEqual([984, 280]);
    expect(b.familyLine).toBe("BoQ says GI -> priced as MS");
    expect(b.familyControl).toMatchObject({ otherMode: true, typedValue: "GI" });
    // the panel's built-in alias sentence is replaced by the config's line (the block carries both facts)
    expect(b.familyRaw).toBe("GI");
    expect(b.family).toBe("MS");
  });
});

describe("12e-2 P3 / P4 -- the class box and the unit", () => {
  it("P3: a typed class carries the read-note line and never moves the figure; blank class, no line", () => {
    const c = calc(picked("MS", { size_mm: "50", pipe_class: "Class C" }));
    expect(fig(c.values)).toEqual([984, 280]);
    expect(c.b!.working.join("\n")).toContain("Class C stated -> priced at the one MS rate (the sheet has no class rates)");
    const cls = c.b!.fields.find((f) => f.id === "pipe_class")!;
    expect(cls).toMatchObject({ control: "text", optional: true, value: "Class C", label: "Class / wall thickness" });
    expect(cls.readOnly).toBeUndefined();   // the calculator's box is typeable
    const blank = calc(picked("MS", { size_mm: "50" }));
    expect(blank.b!.working.join("\n")).not.toContain("stated -> priced at the one");
    expect(blank.b!.fields.map((f) => f.id)).toEqual(["size_mm", "pipe_class"]);   // item_name is never a panel field
    // the class names the family it is drawn for
    expect(calc(picked("Copper", { size_mm: "15.9", pipe_class: "seamless" })).b!.working.join("\n")).toContain("seamless stated -> priced at the one Copper rate");
    // on the PANEL path a model-read class is read-only text
    const p = panel({ pipe_type: "MS", size_mm: "50", pipe_class: "Class B" }, "Rmt");
    expect(p.b.fields.find((f) => f.id === "pipe_class")).toMatchObject({ value: "Class B", readOnly: true });
    expect(p.b.working.join("\n")).toContain("Class B stated -> priced at the one MS rate");
  });
  it("P4: metre spellings price; no unit and R/O price per metre with the note; 'nos' refuses in the config's words", () => {
    for (const u of ["mts", "Rmt", "RMT", "m", "running metre"]) expect(calc(picked("MS", { size_mm: "50" }), u).v.rowPriced).toBe(true);
    const noUnit = panel({ pipe_type: "MS", size_mm: "50" }, "");
    expect(noUnit.v.rowPriced).toBe(true);
    expect(noUnit.v.unitNote).toBe("No unit on the BoQ row -> priced per metre, the catalogue's unit for this item");
    const ro = panel({ pipe_type: "MS", size_mm: "50" }, "R/O");
    expect(ro.v.unitNote).toBe("BoQ says R/O (rate only) -> priced per metre, the catalogue's unit for this item");
    const nos = panel({ pipe_type: "MS", size_mm: "50" }, "nos");
    expect(nos.v.rowPriced).toBe(false);
    expect(nos.v.reason).toBe("unit 'nos' is not a length unit");
    expect(nos.s.values).toEqual({});
    // NEGATIVE: Insulation keeps the R12 sentence byte-for-byte
    const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, { excelRow: 1, description: "", attributes: {}, items: [{ attributes: cells({ item: "Nitrile Rubber Insulation", cladding: "No", thickness_mm: "19", pipe_size_mm: "50" }) }] } as ExtractionRow]]) });
    const r = h.compute({ excelRow: 1, description: "", nodeType: "Line Item", category: "hvac_insulation", discipline: "HVAC", rateKinds: [...KINDS], unit: "nos" } as RateHelperRowContext & { unit: string }, {});
    expect((r as ItemListSuggestion).itemList!.reason).toBe("unit 'nos' is not a count, area or length unit");
    // the calculator's picker offers the length class's first spelling only
    expect(calc(picked("MS", { size_mm: "50" })).v.unitChoices).toEqual(["mts"]);
  });
});

describe("12e-2 AC1 -- the E2E: the copper accessories input 0.30 -> 0.40 moves copper 15.9 to 1397 on both paths", () => {
  const COPPER = "piping_accessories_copper";
  const patched = itemsWithInput(ITEMS, COPPER, { factor: 0.4 });
  it("the calculator path: 1298 / 220 -> 1397 / 220 -> back to 1298 / 220", () => {
    expect(fig(calc(picked("Copper", { size_mm: `5/8${INCH}` }, ["size_mm"])).values)).toEqual([1298, 220]);
    const moved = calc(picked("Copper", { size_mm: `5/8${INCH}` }, ["size_mm"]), "mts", patched);
    expect(fig(moved.values)).toEqual([1397, 220]);
    expect(moved.b!.working.join("\n")).toContain("supply: pricing input: Piping accessories - Copper (factor) = 0.4");
    expect(moved.b!.working.join("\n")).toContain("supply: BCS pipe x (1 + the accessories share) = 931");
    expect(fig(calc(picked("Copper", { size_mm: `5/8${INCH}` }, ["size_mm"]), "mts", itemsWithInput(patched, COPPER, { factor: 0.3 })).values)).toEqual([1298, 220]);
    // NEGATIVE: an MS row does not move with copper's input
    expect(fig(calc(picked("MS", { size_mm: "50" }), "mts", patched).values)).toEqual([984, 280]);
  });
  it("the impact panel's own path (priceSkuExactItemList over the patched catalogue) agrees to the rupee, and the input reaches exactly the 13 copper SKUs", () => {
    const sku = ITEMS.find((it) => it.kind === "hvac_piping_item" && it.attributes.pipe_type === "Copper" && Number(it.attributes.size_mm) === 15.9)!;
    const ex = priceSkuExactItemList(sku, CFG[PIP], ITEMS, patched);
    expect(ex.ok).toBe(true);
    expect(Object.fromEntries(ex.legs.map((l) => [l.output, [l.now, l.becomes, l.moved]]))).toEqual({ supply: [1298, 1397, true], install: [220, 220, false] });
    // the panel's REACH walk sees the input through the nested (family / unit / id) pipeline key -- Piping's
    // Copper supply pipeline and no other family's -- which is what routes the panel to the exact pricer above
    const reach = computePricingInputReach(CFG, ITEMS);
    expect(reach[COPPER].readByCategories).toEqual([PIP]);
    const read = reach[COPPER].pipelines.map((p) => `${p.category}:${p.pipelineId}`);
    expect(read.length).toBe(1);
    expect(read[0]).toMatch(/^hvac_piping:Copper\//);
    expect(computePricingInputReach(CFG, ITEMS)["piping_accessories_ms"].pipelines.map((p) => p.pipelineId).join()).toMatch(/^MS\//);
    const copperUids = new Set(ITEMS.filter((it) => it.kind === "hvac_piping_item" && it.attributes.pipe_type === "Copper").map((it) => String(it.item_uid)));
    expect(copperUids.size).toBe(13);
    // every copper SKU moves by the same rule and no other SKU does
    let movers = 0;
    for (const it of ITEMS.filter((i) => i.kind === "hvac_piping_item")) {
      const r = priceSkuExactItemList(it, CFG[PIP], ITEMS, patched);
      expect(r.ok).toBe(true);
      if (r.legs.some((l) => l.moved)) movers++;
    }
    expect(movers).toBe(13);
  });
});

describe("12e-2 AC6 -- the Derivation tab lists P1-P5 from the config, no internal name", () => {
  const titles = () => itemListRuleOrder(CFG[PIP], ITEMS).map((l) => l.title);
  const text = (cfg: unknown = CFG[PIP]) => itemListRuleOrder(cfg, ITEMS).map((l) => `${l.title} -- ${l.detail ?? ""}`).join("\n");
  it("the lines, in run order", () => {
    expect(titles()).toEqual([
      "The row's unit decides which kind of rate applies",
      "The item's own kind decides which products can price it",
      "A pipe type written as GI, uPVC, HDPE is priced as the kind it means",
      "A pipe type the catalogue does not stock refuses by name",
      "A row naming one pipe type prices as it; two different ones with none chosen refuse",
      "That kind's rule for that unit",
      "The facts that rule needs before it can price",
      "A pipe size written in inches is converted to millimetres",
      "A typed pipe size is one size, in mm or inches",
      "A Copper, MS and 2 more row stating its own figure in the class / wall thickness carries a line saying what was priced",
      "Fitting the stated pipe size to the catalogue",
      // INVERTED at 12e-4b (owner F-3, 2026-10-13): one line more, generated from keys this config already
      // carries (the second inch conversion + the below-the-smallest ruling). BEFORE: 14 titles, without it.
      "A pipe size written as a bare number that could be inches refuses",
      "Then the priced steps below, in their own order",
      "A catalogue cell derived from another row's cell follows its base",
      "Multiplied by how many of the item one unit of the row pays for",
    ]);
    const t = text();
    expect(t).toContain("any other unit refuses: unit 'nos' is not a length unit");
    expect(t).toContain("GI -> MS, uPVC -> PVC, HDPE -> PVC -- with a line saying so");
    expect(t).toContain("SS: No SKU in the catalogue for SS pipe - price this row by hand");
    expect(t).toContain("converted at 25.4 mm to the inch, then at 25 where the first lands on no stocked size");
    expect(t).toContain("a size within 0.1 mm of a stocked size counts as that size; below the smallest stocked size takes the smallest; above the largest stocked size refuses, naming the size");
    expect(t).toContain("the pricing inputs are read first (Piping accessories - CPVC, Piping accessories - Copper, Piping accessories - MS, Piping accessories - PVC)");
    expect(t).toContain("4 cells on 2 rows (the grey 'derived' cells)");
    expect(t).not.toMatch(/\b[a-z0-9]+_[a-z0-9_]+\b/i);
    expect(t).not.toMatch(/\(owner/i);
    expect(t).not.toMatch(/\b[RDTSQ]-?\d{1,2}[a-z]?\b/);
  });
  it("VACUITY, structural: each 12e-2 key removed from a copy drops its own line", () => {
    const without = (mut: (pr: any) => void) => { const c = structuredClone(CFG[PIP]) as any; mut(c.list_spec.pricing); return text(c); };
    expect(without((pr) => delete pr.family_text)).not.toContain("is priced as the kind it means");
    expect(without((pr) => delete pr.family_text)).not.toContain("does not stock refuses by name");
    expect(without((pr) => delete pr.family_text.from_row)).not.toContain("two different ones with none chosen refuse");
    expect(without((pr) => delete pr.unit_refusal)).not.toContain("any other unit refuses");
    expect(without((pr) => delete pr.numbers.size_mm.inch_mm_alt)).not.toContain("then at 25");
    expect(without((pr) => delete pr.numbers.size_mm.typed_entry)).not.toContain("A typed pipe size is one size");
    expect(without((pr) => delete pr.size_match.near)).not.toContain("within 0.1 mm");
    // INVERTED at 12e-6c (owner U2, 2026-10-18: F-3 follows `inches`; "re-point the vacuity check to inches") by mechanical
    // authority. BEFORE: `expect(without((pr) => delete pr.size_match.below_smallest)).not.toContain("takes the smallest")` --
    // the F-3 line rode on `below_smallest` and its detail says "takes the smallest size, as before". The key still drops
    // its own bit of the fit line; the F-3 line now drops with `inches`.
    expect(without((pr) => delete pr.size_match.below_smallest)).not.toContain("below the smallest stocked size takes the smallest");
    expect(without((pr) => delete pr.numbers.size_mm.inches)).not.toContain("written as a bare number that could be inches refuses");
    expect(text(CFG[PIP])).toContain("written as a bare number that could be inches refuses");
    expect(without((pr) => delete pr.read_notes)).not.toContain("carries a line saying what was priced");
  });
  it("NEGATIVE: Insulation's and ADP's tabs are byte-identical to their 12d-8 counts (24 and 18) and carry none of the Piping lines", () => {
    // INVERTED at 12e-6c (owner U2 / R, 2026-10-18) by mechanical authority: BEFORE `expect(itemListRuleOrder(CFG.hvac_insulation,
    // ITEMS)).toHaveLength(24)` and the Piping words checked on Insulation's whole tab. Insulation gains the F-3 line (U2:
    // every inches axis) and the RPUF line (R); WITHOUT those two its tab is still 24 and carries none of the Piping lines.
    // INVERTED at ADP-1 (owner F4, 2026-10-19) by mechanical authority: BEFORE `expect(itemListRuleOrder(CFG.hvac_insulation, ITEMS)).toHaveLength(26)`. The F4 line (RPUF on a per-sq.m row)
    // generates wherever the RPUF line does; without it the count below it is unchanged.
    const NEW_12E6C = ["A pipe size written as a bare number that could be inches refuses", "RPUF with no material answered prices as Tubular Puf Insulation", "RPUF on a per-sq.m row refuses by name"];
    expect(itemListRuleOrder(CFG.hvac_insulation, ITEMS)).toHaveLength(27);
    expect(itemListRuleOrder(CFG.hvac_insulation, ITEMS).filter((l) => !NEW_12E6C.includes(l.title))).toHaveLength(24);
    expect(itemListRuleOrder(CFG.hvac_adp, ITEMS)).toHaveLength(18);
    for (const cid of ["hvac_insulation", "hvac_adp"]) {
      const t = itemListRuleOrder(CFG[cid], ITEMS).filter((l) => !NEW_12E6C.includes(l.title)).map((l) => `${l.title} -- ${l.detail ?? ""}`).join("\n");
      if (cid === "hvac_adp") expect(t).toBe(text(CFG[cid]));
      for (const not of ["pipe type", "one size", "then at 25", "within 0.1", "takes the smallest", "any other unit refuses"]) expect(t, `${cid}: ${not}`).not.toContain(not);
    }
  });
});

describe("12e-2 -- Insulation and ADP are untouched on the panel (the 12d-8 lines, no family control, no family line)", () => {
  it("Insulation Nitrile, typed 1-1/4 inch keeps its line; no familyControl; the 12d-8 figure 556 / 224", () => {
    const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
    const ctx: RateHelperRowContext = { excelRow: 2, description: "", nodeType: "", category: "hvac_insulation", discipline: "HVAC", rateKinds: [...KINDS] };
    const r = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "Nitrile Rubber Insulation", attrs: { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: `1-1/4${INCH}` }, other: ["pipe_size_mm"] }] }), [ROW_UNIT_OVERRIDE_KEY]: "mts" }) as ItemListSuggestion;
    const b = r.itemList!.items[0];
    expect(b.familyControl).toBeUndefined();
    expect(b.familyLine).toBeUndefined();
    // INVERTED at 12e-4d (AC5: a typed size is echoed as typed). BEFORE "You typed 31.75 mm -> priced as 34.93 mm (next size up)"
    expect(b.fields.find((f) => f.id === "pipe_size_mm")!.note).toBe(`You typed 1-1/4${INCH} -> 31.75 mm -> priced as 34.93 mm (next size up)`);
    expect(b.fields.map((f) => f.id)).toEqual(["cladding", "thickness_mm", "pipe_size_mm"]);
    const d8 = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "Nitrile Rubber Insulation", attrs: { cladding: "26G Aluminium", pipe_size_mm: "50" }, other: ["pipe_size_mm"] }] }), [ROW_UNIT_OVERRIDE_KEY]: "mts" }) as ItemListSuggestion;
    expect([d8.values.supply_rate, d8.values.install_rate, d8.values.combined_rate]).toEqual([556, 224, 780]);
  });
  it("ADP fire damper UL yes / UL / 600 x 600 / nos keeps 7830 / 692", () => {
    const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
    const ctx: RateHelperRowContext = { excelRow: 3, description: "", nodeType: "", category: "hvac_adp", discipline: "HVAC", rateKinds: [...KINDS] };
    const r = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "fire damper", attrs: { ul: "yes", variant: "UL", size_mm: "600x600" }, other: [] }] }), [ROW_UNIT_OVERRIDE_KEY]: "nos" }) as ItemListSuggestion;
    expect([r.values.supply_rate, r.values.install_rate]).toEqual([7830, 692]);
    expect(r.itemList!.items[0].familyControl).toBeUndefined();
  });
  it("the two new edit operations: opening the family box blanks the block with the box open; typing keeps it open; picking a stocked family closes it", () => {
    let st = initialItemEdits(0);
    st = applyItemEdit(st, { op: "add", family: "MS" });
    st = applyItemEdit(st, { op: "set_attr", index: 0, id: "size_mm", value: "50" });
    st = applyItemEdit(st, { op: "set_family_other", index: 0, id: FAM });
    expect(st.items[0]).toEqual({ base: null, family: "", attrs: {}, other: [FAM] });
    st = applyItemEdit(st, { op: "set_family_text", index: 0, id: FAM, text: "GI" });
    expect(st.items[0]).toEqual({ base: null, family: "GI", attrs: {}, other: [FAM] });
    st = applyItemEdit(st, { op: "change_family", index: 0, family: "MS" });
    expect(st.items[0]).toEqual({ base: null, family: "MS", attrs: {} });
    expect(applyItemEdit(st, { op: "set_family_text", index: 5, id: FAM, text: "x" })).toBe(st);
  });
});
