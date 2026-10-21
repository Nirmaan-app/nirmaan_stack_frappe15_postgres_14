/**
 * ADP-3c (owner 2026-10-21 00:47; 01:31 "proceed", 01:55 "ok to both") -- TWO FACE SIZES UNDER ANY NAMES, on HVAC v49 as
 * minted (no config change). On an item that reads BOTH Width and Height, a size of EXACTLY two parts is the face whatever
 * its parts are called: a width / height label decides that side, the other part takes the other; with no such label,
 * or both naming the same side (ruling (2)), first = width, second = height. Each rule has a positive case and a near miss.
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { itemListRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { readFaceSides } from "./itemListPricing";
import { mergeItemsByName } from "./rateHelperPlumbing";
import { isSuggestion, type ExtractionRow, type HelperResult } from "./rateHelperTypes";
import { CONFIGS as LIVE_CONFIGS } from "./adp3a.harness";

type Asset = { discipline: string; items: Array<RateMasterItem & { brand?: string }>; category_configs: RateCategoryConfig[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const V49 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v49.json")));
const ADP = "hvac_adp";
const CFG = new Map<string, RateCategoryConfig>(LIVE_CONFIGS);
CFG.set(ADP, V49.category_configs.find((c) => c.category_id === ADP)!);
const ITEMS: RateMasterItem[] = mergeItemsByName(V49.items.map((it) => ({ ...it, discipline: V49.discipline } as RateMasterItem)));
const RK = ["supply_rate", "install_rate", "combined_rate"];

const must = (r: HelperResult): ItemListSuggestion => { if (!isSuggestion(r)) throw new Error("expected a suggestion"); return r as ItemListSuggestion; };
const cells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
function panel(unit: string, item: Record<string, string>): ItemListSuggestion {
  const ext = new Map<number, ExtractionRow>([[1, { excelRow: 1, description: "", attributes: {}, items: [{ attributes: cells(item) }] } as unknown as ExtractionRow]]);
  return must(makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS, extractionByRow: ext })
    .compute({ excelRow: 1, description: "", nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: RK, headings: [], ownNotes: [], unit } as never, {}));
}
function calculator(unit: string, family: string, attrs: Record<string, string>): ItemListSuggestion {
  return must(makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS, extractionByRow: new Map() })
    .compute({ excelRow: 1, description: "", nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: RK } as never,
      { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family, attrs, other: Object.keys(attrs) }] }), [ROW_UNIT_OVERRIDE_KEY]: unit }));
}
const field = (s: ItemListSuggestion, id: string) => s.itemList!.items[0].fields.find((f) => f.id === id);
const face = (s: ItemListSuggestion) => [field(s, "face_w_mm")?.value ?? null, field(s, "face_h_mm")?.value ?? null];
const notes = (s: ItemListSuggestion) => [field(s, "face_w_mm")?.note ?? null, field(s, "face_h_mm")?.note ?? null];
const VCD = { family: "VCD", variant: "GI rectangular" };

// ── the reader, pure ──────────────────────────────────────────────────────────────────────────────────────────────
describe("readFaceSides { pair } -- a two-part size is the face whatever its parts are called", () => {
  it("POSITIVE: a width / height label decides its side, the other part takes the other side", () => {
    expect(readFaceSides("600(L)X150mm width", { pair: true })).toEqual({ width: { part: "150mm width", how: "as written" },
      height: { part: "600(L)", how: "by position", line: "the other part of a two-part size" }, notUsed: [], parts: 2 });
    expect(readFaceSides("900mm(L)x150mm (H)", { pair: true })).toEqual({ width: { part: "900mm(L)", how: "by position", line: "the other part of a two-part size" },
      height: { part: "150mm (H)", how: "as written" }, notUsed: [], parts: 2 });
  });
  it("POSITIVE: no width / height label, or both naming the same side -> first = width, second = height (ruling (2))", () => {
    expect(readFaceSides("600(L) x 300(D)", { pair: true })).toMatchObject({ width: { part: "600(L)", line: "the first part of a two-part size" }, height: { part: "300(D)", line: "the second part of a two-part size" } });
    expect(readFaceSides("600 W x 300 W", { pair: true })).toEqual({ width: { part: "600 W", how: "as written" },
      height: { part: "300 W", how: "by position", line: "the second part of a two-part size" }, notUsed: [], parts: 2 });
  });
  it("NEGATIVE: without the pair, and on one or three parts, the reader is ADP-3b's to the byte", () => {
    // without the pair: ADP-3b's reading (a length named and not used; two widths are not a face)
    expect(readFaceSides("600(L)X150mm width")).toEqual({ width: { part: "150mm width", how: "as written" }, notUsed: ["600(L) named as a length - not used"], parts: 2 });
    expect(readFaceSides("600 W x 300 W")).toBeNull();
    expect(readFaceSides("600(L)X150mm width", { pair: false })).toEqual(readFaceSides("600(L)X150mm width"));
    for (const t of ["1500 mm long", "300 x 300 x 450 mm Height", "100/150/200 mm", "1 x 2 x 3 x 4", "150 mm High", ""]) expect(readFaceSides(t, { pair: true })).toEqual(readFaceSides(t));
    // an unlabelled or width / height labelled two-part size reads exactly as before, with no line
    for (const t of ["550X300", "400 mm High x 600", "600 W x 400 H"]) expect(readFaceSides(t, { pair: true })).toEqual(readFaceSides(t));
  });
});

// ── AC1: the rule on the panel, every case named by the ruling ──────────────────────────────────────────────────────
describe("AC1 -- the rule, through the panel's entry point (v49)", () => {
  it("L + H POSITIVE: 900mm(L)x150mm (H) -> 900 x 150, priced (the 00245 r126 row: 1204 / 378 / 1582)", () => {
    const s = panel("nos", { family: "door grille", size_mm: "900mm(L)x150mm (H)" });
    expect(face(s)).toEqual(["900", "150"]);
    expect(notes(s)).toEqual(["BoQ says 900mm(L)x150mm (H) -> width 900 mm (the other part of a two-part size)", "BoQ says 900mm(L)x150mm (H) -> height 150 mm"]);
    expect(s.values).toEqual({ supply_rate: 1204, install_rate: 378, combined_rate: 1582 });
  });
  it("L + width POSITIVE: 600(L)X150mm width -> width 150, height 600, priced (the 00302 r67 row: 496 / 80 / 576); the 'not used' line is gone", () => {
    const s = panel("nos", { family: "curved grille", size_mm: "600(L)X150mm width" });
    expect(face(s)).toEqual(["150", "600"]);
    expect(notes(s)).toEqual(["BoQ says 600(L)X150mm width -> width 150 mm", "BoQ says 600(L)X150mm width -> height 600 mm (the other part of a two-part size)"]);
    expect(JSON.stringify(s.itemList)).not.toContain("not used");
    expect(s.values).toEqual({ supply_rate: 496, install_rate: 80, combined_rate: 576 });
  });
  it("width + depth POSITIVE: 600 mm wide x 300 deep -> 600 x 300, the same price as 600 x 300", () => {
    const s = panel("nos", { ...VCD, size_mm: "600 mm wide x 300 deep" });
    expect(face(s)).toEqual(["600", "300"]);
    expect(notes(s)[1]).toBe("BoQ says 600 mm wide x 300 deep -> height 300 mm (the other part of a two-part size)");
    expect(s.values).toEqual(panel("nos", { ...VCD, size_mm: "600 x 300" }).values);
  });
  it("unlabelled NEGATIVE: 550X300 reads as before, with no new line (1292 / 317)", () => {
    const s = panel("nos", { ...VCD, size_mm: "550X300" });
    expect(notes(s)).toEqual(["BoQ says 550X300 -> width 550 mm", "BoQ says 550X300 -> height 300 mm"]);
    expect(s.values).toEqual({ supply_rate: 1292, install_rate: 317, combined_rate: 1609 });
  });
  it("both labelled the same side POSITIVE (ruling (2)): 600 W x 300 W -> by position; 600 H x 300 H likewise", () => {
    for (const t of ["600 W x 300 W", "600 H x 300 H"]) {
      const s = panel("nos", { ...VCD, size_mm: t });
      expect({ t, face: face(s), values: s.values }).toEqual({ t, face: ["600", "300"], values: panel("nos", { ...VCD, size_mm: "600 x 300" }).values });
    }
  });
  it("three parts NEGATIVE (D1 unchanged): the first two are the face, the third named", () => {
    const s = panel("nos", { family: "square diffuser", damper: "with", size_mm: "300 x 300 x 450 mm Height" });
    expect(face(s)).toEqual(["300", "300"]);
    expect(notes(s)[0]).toBe("BoQ says 300 x 300 x 450 mm Height -> width 300 mm; 450 mm Height (the third part) - not used as the face");
  });
  it("one part NEGATIVE: '1500 mm long' stays named as a length, and refuses", () => {
    expect(panel("nos", { ...VCD, size_mm: "1500 mm long" }).itemList!.reason)
      .toBe("VCD needs Width + Height, or Area band - Size '1500 mm long' gives no width or height (1500 mm long named as a length - not used) - price this row by hand");
  });
  it("per-metre grille NEGATIVE (reads the height alone, not a pair): a length stays named; a two-part width still refuses", () => {
    const s = panel("rmt", { family: "linear grille", size_mm: "600(L) x 150 mm (H)" });
    expect(field(s, "face_h_mm")!.note).toBe("BoQ says 600(L) x 150 mm (H) -> height 150 mm; 600(L) named as a length - not used");
    expect(s.values).toEqual({ supply_rate: 725, install_rate: 132, combined_rate: 857 });
    expect(panel("rmt", { family: "linear grille", size_mm: "600(L)X150mm width" }).itemList!.reason).toBe("per-metre row: no height stated to convert the per-sq.m rate");
  });
  it("plenum NEGATIVE: its Length / Width / Height boxes read as before (width not stated)", () => {
    const s = panel("nos", { family: "mixing box / LP plenum", insulated: "with", size_mm: "800mm(L)x300mm (H)" });
    expect(s.itemList!.reason).toBe("mixing box / LP plenum needs an area, or length + width + height - width not stated - price this row by hand");
    expect([field(s, "plenum_length_mm")!.value, field(s, "plenum_width_mm")!.value, field(s, "plenum_height_mm")!.value]).toEqual(["800", "", "300"]);
  });
  it("inches / lists / ranges NEGATIVE: unreadable as today", () => {
    expect(panel("nos", { family: "linear grille", size_mm: '24" x 6" - Oval' }).itemList!.reason).toBe("width stated in inches ('24\"')");
    expect(panel("nos", { ...VCD, size_mm: "300-400 x 200" }).itemList!.reason).toBe("several values stated for width ('300-400 x 200')");
    expect(panel("nos", { family: "square diffuser", damper: "with", size_mm: '12"x12" & 24"x24"' }).itemList!.reason)
      .toBe("square diffuser needs Neck size, or Outer size - outer size '12\"x12\" & 24\"x24\"' could not be used and no neck size stated - price this row by hand");
  });
});

// ── AC2: order, on the face-matched families (no stored row) ──────────────────────────────────────────────────────────
describe("AC2 -- ORDER on face-matched SKUs: the label decides, else position; calculator = panel", () => {
  it("cross-talk POSITIVE: '500(W) x 250(L)' and '250(L) x 500(W)' both match the 500 x 250 SKU; '500(L) x 250(H)' / '250(H) x 500(L)' too", () => {
    for (const t of ["500(W) x 250(L)", "250(L) x 500(W)", "500(L) x 250(H)", "250(H) x 500(L)"]) {
      const s = panel("nos", { family: "cross-talk", size_mm: t });
      expect({ t, face: face(s), values: s.values }).toEqual({ t, face: ["500", "250"], values: { supply_rate: 1044, install_rate: 360, combined_rate: 1404 } });
    }
  });
  it("cross-talk NEGATIVE: unlabelled, position decides -- '250 x 500' is width 250 and finds no SKU", () => {
    expect(panel("nos", { family: "cross-talk", size_mm: "250 x 500" }).itemList!.reason).toBe("No SKU for cross-talk: width 250, height 500 - price this row by hand");
  });
  it("access door POSITIVE: '450(L) x 450(H)' -> 450 x 450, priced as '450 x 450'", () => {
    const s = panel("nos", { family: "access door", size_mm: "450(L) x 450(H)" });
    expect(face(s)).toEqual(["450", "450"]);
    expect(s.values).toEqual(panel("nos", { family: "access door", size_mm: "450 x 450" }).values);
  });
  it("square diffuser outer size POSITIVE: '300(L) x 1200(W)' -> outer 1200 x 300 (the SKU); NEGATIVE: unlabelled '300 x 1200' does not match", () => {
    const s = panel("nos", { family: "square diffuser", damper: "with", size_mm: "300(L) x 1200(W)" });
    expect(face(s)).toEqual(["1200", "300"]);
    expect(s.values).toEqual({ supply_rate: 2755, install_rate: 576, combined_rate: 3331 });
    expect(panel("nos", { family: "square diffuser", damper: "with", size_mm: "300 x 1200" }).values).toEqual({});
  });
  it.each([
    ["cross-talk", {}, "250(L) x 500(W)", "500", "250"], ["cross-talk", {}, "250 x 500", "250", "500"],
    ["access door", {}, "450(L) x 450(H)", "450", "450"], ["square diffuser", { damper: "with" }, "300(L) x 1200(W)", "1200", "300"],
  ] as const)("calculator = panel: %s '%s'", (fam, extra, size, w, h) => {
    const p = panel("nos", { family: fam, ...extra, size_mm: size });
    expect(calculator("nos", fam, { ...extra, size_mm: size }).values).toEqual(p.values);        // the same size, typed
    expect(calculator("nos", fam, { ...extra, face_w_mm: w, face_h_mm: h }).values).toEqual(p.values);   // the boxes it fills, typed
  });
});

// ── U2 / AC3: the Derivation line ─────────────────────────────────────────────────────────────────────────────────────
describe("U2 -- the ADP Derivation line, LAST", () => {
  const LINE = "A two-part size on a Width + Height item is the face, whatever its parts are called";
  it("POSITIVE: v49 ends with it, worded as ruled", () => {
    const tab = itemListRuleOrder(CFG.get(ADP)!, ITEMS);
    // INVERTED at ADP-4a (owner D3, 2026-10-21 "Lines 35 and 38 become one line" - "Yes"; wording from ADP-R4 R10) by
    // mechanical authority. BEFORE: `expect(tab.at(-1)!.title).toBe(LINE)` and its detail containing "a width or height label
    // decides that side, else first = width, second = height". The ruling is now said in THE size line, in full.
    expect(tab.map((l) => l.title)).not.toContain(LINE);
    const sizes = tab.find((l) => l.title === "The sizes are typed in their own boxes, else read from the size as written")!;
    expect(sizes.detail).toContain("a two-part size fills both sides whatever its parts are called ('600(L)X150mm width' -> width 150, height 600; with no width or height label, first = width, second = height)");
    expect(sizes.reason).toContain("a two-part size on a Width + Height item is the face, whatever its parts are called (owner, 2026-10-21)");
  });
  it("NEGATIVE: a config without both face sides (v48, Insulation, Piping) does not carry it", () => {
    const v48 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v48.json")));
    expect(itemListRuleOrder(v48.category_configs.find((c) => c.category_id === ADP)!, ITEMS).map((l) => l.title)).not.toContain(LINE);
    for (const cat of ["hvac_insulation", "hvac_piping"]) expect(itemListRuleOrder(CFG.get(cat)!, ITEMS).map((l) => l.title)).not.toContain(LINE);
  });
});
