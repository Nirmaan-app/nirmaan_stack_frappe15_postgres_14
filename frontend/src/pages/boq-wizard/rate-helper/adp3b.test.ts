/**
 * ADP-3b (owner B1; fixes (2) / (3) 2026-10-20 21:57; D1-D4 2026-10-20 22:25 "ok to all") -- the face size in its own
 * Width / Height boxes, on v48 + the ADP-3b config (`applyAdp3b`, pinned EQUAL to v49 at the asset commit), beside v48
 * itself: every price is v48's except the one ruled move (D2). Each rule has a positive case and a near miss.
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { itemListRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { itemListPricingSpec, readFaceSides, unitClassOf } from "./itemListPricing";
import { mergeItemsByName } from "./rateHelperPlumbing";
import { isSuggestion, type ExtractionRow, type HelperResult } from "./rateHelperTypes";
import { applyAdp3b } from "./adp3b.harness";
import { CONFIGS as LIVE_CONFIGS, ITEMS as LIVE_ITEMS, calculator as calc48 } from "./adp3a.harness";

type Asset = { discipline: string; items: Array<RateMasterItem & { brand?: string }>; category_configs: RateCategoryConfig[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const V48 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v48.json")));
const V49 = applyAdp3b(V48 as any) as unknown as Asset;
const ADP = "hvac_adp";
const CFG48 = new Map<string, RateCategoryConfig>(LIVE_CONFIGS);
const CFG49 = new Map<string, RateCategoryConfig>(LIVE_CONFIGS);
CFG49.set(ADP, V49.category_configs.find((c) => c.category_id === ADP)!);
const ITEMS: RateMasterItem[] = mergeItemsByName(LIVE_ITEMS);
const SPEC49 = itemListPricingSpec(CFG49.get(ADP)!)!;
const RK = ["supply_rate", "install_rate", "combined_rate"];

const must = (r: HelperResult): ItemListSuggestion => { if (!isSuggestion(r)) throw new Error("expected a suggestion"); return r as ItemListSuggestion; };
const cells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
function panel(cfg: Map<string, RateCategoryConfig>, unit: string, item: Record<string, string>, desc = ""): ItemListSuggestion {
  const ext = new Map<number, ExtractionRow>([[1, { excelRow: 1, description: desc, attributes: {}, items: [{ attributes: cells(item) }] } as unknown as ExtractionRow]]);
  return must(makePricingSheetHelper({ configsByCategory: cfg, items: ITEMS, extractionByRow: ext })
    .compute({ excelRow: 1, description: desc, nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: RK, headings: [], ownNotes: [], unit } as never, {}));
}
function calculator(cfg: Map<string, RateCategoryConfig>, unit: string, family: string, attrs: Record<string, string>): ItemListSuggestion {
  return must(makePricingSheetHelper({ configsByCategory: cfg, items: ITEMS, extractionByRow: new Map() })
    .compute({ excelRow: 1, description: "", nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: RK } as never,
      { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family, attrs, other: Object.keys(attrs) }] }), [ROW_UNIT_OVERRIDE_KEY]: unit }));
}
const fields = (s: ItemListSuggestion) => s.itemList!.items[0].fields.map((f) => ({ id: f.id, label: f.label, value: f.value, required: !!f.required, group: (f.group as string) ?? null, blank: f.blank, note: f.note ?? null }));
const field = (s: ItemListSuggestion, id: string) => fields(s).find((f) => f.id === id);
const figures = (s: ItemListSuggestion) => [s.itemList!.rowPriced, s.values];

// ── readFaceSides: the reader, pure ────────────────────────────────────────────────────────────────────────────────
describe("readFaceSides -- the face's two sides as written (B1, D1)", () => {
  it("POSITIVE: two parts by position; a label decides between the two; a lone number is the width", () => {
    expect(readFaceSides("550X300")).toEqual({ width: { part: "550", how: "by position" }, height: { part: "300", how: "by position" }, notUsed: [], parts: 2 });
    expect(readFaceSides("400 mm High x 600")).toMatchObject({ width: { part: "600" }, height: { part: "400 mm High", how: "as written" } });
    expect(readFaceSides("600")).toMatchObject({ width: { part: "600" }, notUsed: [], parts: 1 });
    expect(readFaceSides("150 mm High")).toMatchObject({ height: { part: "150 mm High" }, parts: 1 });
  });
  it("D1: a third part never displaces the face; a length or depth is named and not used", () => {
    expect(readFaceSides("300 x 300 x 450 mm Height")).toEqual({ width: { part: "300", how: "by position" }, height: { part: "300", how: "by position" },
      notUsed: ["450 mm Height (the third part) - not used as the face"], parts: 3 });
    expect(readFaceSides("600(L)X150mm width")).toEqual({ width: { part: "150mm width", how: "as written" }, notUsed: ["600(L) named as a length - not used"], parts: 2 });
  });
  it("NEGATIVE: not a size (a list, four parts, two widths) is null -- the caller reads the whole text as the width, as before", () => {
    expect(readFaceSides("100/150/200 mm")).toBeNull();
    expect(readFaceSides("1 x 2 x 3 x 4")).toBeNull();
    expect(readFaceSides("600 W x 300 wide")).toBeNull();
    expect(readFaceSides("")).toBeNull();
  });
});

// ── AC1: every face-reading pair ───────────────────────────────────────────────────────────────────────────────────
/** The 18 pairs ADP-R3b measured, by (family, unit class, sides). The sweep below NAMES them and pins them EQUAL to the
 * pairs the v49 config generates. */
const PAIRS: Array<[string, string, "WH" | "H"]> = [
  ["VCD", "count", "WH"], ["fire damper", "count", "WH"], ["linear grille", "count", "WH"], ["curved grille", "count", "WH"],
  ["floor grille", "count", "WH"], ["door grille", "count", "WH"], ["intake louvre", "count", "WH"], ["NRD", "count", "WH"],
  ["collar damper", "count", "WH"], ["sound attenuator", "count", "WH"], ["double-skin plenum", "count", "WH"], ["cross-talk", "count", "WH"],
  ["access door", "count", "WH"], ["square diffuser", "count", "WH"],
  ["linear grille", "length", "H"], ["curved grille", "length", "H"], ["floor grille", "length", "H"], ["door grille", "length", "H"],
];
const UNIT: Record<string, string> = { count: "nos", length: "rmt" };
const SIZE: Record<string, string> = { "access door": "450x450", "cross-talk": "500 x 250", "square diffuser": "600 x 600" };

describe("AC1 -- the 18 pairs: boxes shown, filled, lined, grouped or starred; the price is v48's", () => {
  it("the pairs named here EQUAL the pairs the v49 config generates (needs, conversions, SKU faces, second_key)", () => {
    const got: string[] = [];
    for (const [fam, f] of Object.entries(SPEC49.families)) {
      for (const cls of new Set([...Object.keys(f.units), ...Object.keys(f.convert ?? {})])) {
        const u = f.units[cls];
        const needs = new Set([...f.needs, ...(u?.needs ?? []), ...(u ? [] : (f.convert?.[cls] ?? []).flatMap((o) => o.needs))]);
        const sku = ITEMS.some((it) => (it.attributes as Record<string, unknown>).family === fam && (it.attributes as Record<string, unknown>).face_w_mm !== undefined && unitClassOf(SPEC49, it.unit) === cls);
        const sk = (SPEC49.second_key ?? []).some((k) => k.families.includes(fam) && needs.has(k.primary));
        const w = needs.has("face_w_mm") || sku || sk, h = needs.has("face_h_mm") || sku || sk;
        if (w || h) got.push(`${fam}|${cls}|${w ? "W" : ""}${h ? "H" : ""}`);
      }
    }
    expect(got.sort()).toEqual(PAIRS.map(([f, c, s]) => `${f}|${c}|${s}`).sort());
  });
  it.each(PAIRS)("%s per %s (%s)", (fam, cls, sides) => {
    const size = SIZE[fam] ?? "600 x 300";
    const item = { family: fam, size_mm: size };
    const s49 = panel(CFG49, UNIT[cls], item), s48 = panel(CFG48, UNIT[cls], item);
    expect(figures(s49)).toEqual(figures(s48));                              // price unchanged
    const ids = fields(s49).map((f) => f.id);
    expect(ids).not.toContain("size_mm");                                     // no "Size (as written)" box
    const [w, h] = size.split(/\s*x\s*/i);
    if (sides === "H") {
      expect(ids).not.toContain("face_w_mm");
      expect(field(s49, "face_h_mm")).toMatchObject({ label: "Height (mm)", value: h, required: true, group: null, note: `BoQ says ${size} -> height ${h} mm` });
    } else {
      const outer = fam === "square diffuser";
      expect(field(s49, "face_w_mm")).toMatchObject({ label: outer ? "Outer width (mm)" : "Width (mm)", value: w, note: `BoQ says ${size} -> width ${w} mm` });
      expect(field(s49, "face_h_mm")).toMatchObject({ label: outer ? "Outer height (mm)" : "Height (mm)", value: h, note: `BoQ says ${size} -> height ${h} mm` });
      const g = field(s49, "face_w_mm")!.group;
      if (outer) expect(g).toBe("Neck size, or Outer size");
      else if (fam === "cross-talk" || fam === "access door") expect([g, field(s49, "face_w_mm")!.required]).toEqual([null, true]);
      else expect([g, field(s49, "face_w_mm")!.required]).toEqual(["Width + Height, or Area band", false]);
    }
  });
});

// ── AC2: D1-D4 ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("AC2 -- D1 to D4", () => {
  it("D1 POSITIVE: a three-part size keeps its first two as the face and names the third; NEGATIVE: two parts name nothing", () => {
    const s = panel(CFG49, "nos", { family: "square diffuser", damper: "with", size_mm: "300 x 300 x 450 mm Height" });
    expect(field(s, "face_w_mm")).toMatchObject({ value: "300", note: "BoQ says 300 x 300 x 450 mm Height -> width 300 mm; 450 mm Height (the third part) - not used as the face" });
    expect(field(s, "face_h_mm")!.value).toBe("300");
    expect(field(panel(CFG49, "nos", { family: "VCD", variant: "GI rectangular", size_mm: "550X300" }), "face_w_mm")!.note).toBe("BoQ says 550X300 -> width 550 mm");
  });
  it("D2 POSITIVE: a per-metre grille sized by one WIDTH takes it as its height -- the ruled move, 725 / 132 / 857", () => {
    const s = panel(CFG49, "rmt", { family: "linear grille", size_mm: "150mm width" });
    expect(field(s, "face_h_mm")).toMatchObject({ value: "150", note: "BoQ says 150mm width -> height 150 mm (the grille's narrow dimension)" });
    expect(s.values).toEqual({ supply_rate: 725, install_rate: 132, combined_rate: 857 });
    // INVERTED by the ruling itself: v48 refused this row
    expect(panel(CFG48, "rmt", { family: "linear grille", size_mm: "150mm width" }).itemList!.reason).toBe("per-metre row: no height stated to convert the per-sq.m rate");
  });
  it("D2 NEGATIVE: an unlabelled single number stays the width (still refuses); a per-number grille's width stays its width", () => {
    expect(panel(CFG49, "rmt", { family: "linear grille", size_mm: "150 mm" }).itemList!.reason).toBe("per-metre row: no height stated to convert the per-sq.m rate");
    const pn = panel(CFG49, "nos", { family: "linear grille", size_mm: "150mm width" });
    expect([field(pn, "face_w_mm")!.value, field(pn, "face_h_mm")!.value]).toEqual(["150", ""]);
  });
  it("D3 POSITIVE: the square diffuser's outer size is two boxes in the 'Neck size, or Outer size' group; NEGATIVE: per sq.m it shows neither", () => {
    const s = panel(CFG49, "nos", { family: "square diffuser", damper: "with", size_mm: "595x595" });
    expect(fields(s).filter((f) => f.group === "Neck size, or Outer size").map((f) => f.label)).toEqual(["Neck size (as written)", "Outer width (mm)", "Outer height (mm)"]);
    expect(figures(s)).toEqual(figures(panel(CFG48, "nos", { family: "square diffuser", damper: "with", size_mm: "595x595" })));
    expect(fields(panel(CFG49, "sqm", { family: "square diffuser", damper: "with", size_mm: "595x595" })).map((f) => f.id)).not.toContain("face_w_mm");
  });
  it("D4 POSITIVE: v49 has no depth axis; NEGATIVE: v48 had one, read by nothing (every face price above is v48's)", () => {
    expect(Object.keys(SPEC49.numbers)).not.toContain("depth_mm");
    expect(SPEC49.match_attrs).not.toContain("depth_mm");
    expect(Object.keys(SPEC49.panel_controls ?? {})).not.toContain("depth_mm");
    expect(JSON.stringify(SPEC49.panel_notes ?? {})).not.toContain("depth");
    expect(Object.keys(itemListPricingSpec(CFG48.get(ADP)!)!.numbers)).toContain("depth_mm");
  });
});

// ── U3: a part named but not used, said on the box ─────────────────────────────────────────────────────────────────
describe("U3 -- a part the face does not use is said so", () => {
  it("POSITIVE: a length is named on the width's line and the refusal names the missing Height", () => {
    // INVERTED at ADP-3c (owner 2026-10-21 01:31 / 01:55: on a Width + Height item a two-part size is the face whatever
    // its parts are called) by mechanical authority -- this is the declared row 00302 Sheet1 r67. BEFORE: the width note
    // "BoQ says 600(L)X150mm width -> width 150 mm; 600(L) named as a length - not used", the reason "curved grille needs
    // Width + Height, or Area band - Height not stated - price this row by hand", and face_h_mm blank. The length is
    // still named and not used where the item reads the height alone (a per-metre grille), below.
    const s = panel(CFG49, "nos", { family: "curved grille", size_mm: "600(L)X150mm width" });
    expect(field(s, "face_w_mm")!.note).toBe("BoQ says 600(L)X150mm width -> width 150 mm");
    expect(field(s, "face_h_mm")!.note).toBe("BoQ says 600(L)X150mm width -> height 600 mm (the other part of a two-part size)");
    expect(s.itemList!.reason ?? null).toBeNull();
    expect(field(s, "face_h_mm")!.blank).toBe(false);
    const g = panel(CFG49, "rmt", { family: "linear grille", size_mm: "600(L) x 150 mm (H)" });
    expect(field(g, "face_h_mm")!.note).toBe("BoQ says 600(L) x 150 mm (H) -> height 150 mm; 600(L) named as a length - not used");
  });
  it("POSITIVE: a size that gives no face side at all is named by that size; NEGATIVE: a clean size names nothing", () => {
    expect(panel(CFG49, "nos", { family: "VCD", variant: "GI rectangular", size_mm: "1500 mm long" }).itemList!.reason)
      .toBe("VCD needs Width + Height, or Area band - Size '1500 mm long' gives no width or height (1500 mm long named as a length - not used) - price this row by hand");
    expect(field(panel(CFG49, "nos", { family: "VCD", variant: "GI rectangular", size_mm: "600 x 300" }), "face_w_mm")!.note).not.toMatch(/not used/);
  });
});

// ── AC3: the two small fixes ───────────────────────────────────────────────────────────────────────────────────────
describe("AC3 -- fix (2) the plenum outline, fix (3) the circuit-wire marker; wording only", () => {
  const MIX = "mixing box / LP plenum";
  it("fix (2) POSITIVE: nothing stated -> 'neither stated', Area outlined with Length / Width / Height", () => {
    for (const cfg of [CFG48, CFG49]) {
      const s = panel(cfg, "nos", { family: MIX, insulated: "with" });
      expect(s.itemList!.reason).toBe("mixing box / LP plenum needs an area, or length + width + height - neither stated - price this row by hand");
      expect(fields(s).filter((f) => f.blank).map((f) => f.id)).toEqual(["plenum_area_sqm", "plenum_length_mm", "plenum_width_mm", "plenum_height_mm"]);
    }
  });
  it("fix (2) NEGATIVE: something stated keeps the nearest way's gaps, the Area box not outlined", () => {
    const s = panel(CFG49, "nos", { family: MIX, insulated: "with", size_mm: "3000 mm Length" });
    expect(s.itemList!.reason).toBe("mixing box / LP plenum needs an area, or length + width + height - width and height not stated - price this row by hand");
    expect(fields(s).find((f) => f.id === "plenum_area_sqm")!.blank).toBe(false);
  });
  it("fix (3) POSITIVE: circuit wiring No -> no '*' on any circuit-wire field; NEGATIVE: Yes -> every one starred", () => {
    const req = (v: string) => calc48("point_wiring", { circuit_wire_included: v }).workings.attributes.filter((a) => /^circuit_wire\d/.test(a.id)).map((a) => [a.id, !!a.required]);
    expect(req("No").filter(([, r]) => r)).toEqual([]);
    expect(req("Yes").every(([, r]) => r)).toBe(true);
  });
});

// ── calculator = panel ─────────────────────────────────────────────────────────────────────────────────────────────
describe("calculator = panel on the same input", () => {
  it.each([["VCD", "nos", { variant: "GI rectangular" }], ["linear grille", "rmt", {}], ["cross-talk", "nos", {}], ["access door", "nos", {}]] as const)(
    "%s per %s: typed boxes price as the panel's filled ones", (fam, unit, extra) => {
      const h = fam === "access door" ? "450" : "300", w = fam === "access door" ? "450" : fam === "cross-talk" ? "500" : "600";
      const typed: Record<string, string> = { ...extra, face_h_mm: fam === "cross-talk" ? "250" : h, ...(unit === "nos" ? { face_w_mm: w } : {}) };
      const c = calculator(CFG49, unit, fam, typed);
      const p = panel(CFG49, unit, { family: fam, ...extra, size_mm: unit === "nos" ? `${w} x ${typed.face_h_mm}` : `${typed.face_h_mm} mm High` });
      expect(c.values).toEqual(p.values);
    });
});

// ── U6: the Derivation lines ───────────────────────────────────────────────────────────────────────────────────────
describe("U6 -- the ADP Derivation lines (generated from face_side), LAST", () => {
  const titles = (cfg: Map<string, RateCategoryConfig>) => itemListRuleOrder(cfg.get(ADP)!, ITEMS).map((l) => l.title);
  const NEW = ["The width and height are typed in their own boxes, else read from the size", "A third part of a size never displaces the face",
    "A kind that reads only the height, sized by one dimension written as a width, takes it as the height"];
  it("POSITIVE: v49 ends with the three lines; NEGATIVE: v48 carries none of them, and its lines are v49's first ones", () => {
    // INVERTED at ADP-3c (U2: its one line is added LAST, after these three) by mechanical authority. BEFORE:
    // `titles(CFG49).slice(-3)` and `titles(CFG49).slice(0, -3)`.
    expect(titles(CFG49).slice(-4, -1)).toEqual(NEW);
    for (const t of NEW) expect(titles(CFG48)).not.toContain(t);
    const t48 = titles(CFG48), t49 = titles(CFG49).slice(0, -4);
    // the one line whose words follow the group label (ADP-3a's either-or line) reads "Width + Height" on v49
    expect(t49.map((t) => t.replace("Width + Height", "Size (W x H)"))).toEqual(t48);
  });
});

// =====================================================================================================================
describe("ADP-3b AC5 -- the minted HVAC v49 IS v48 + applyAdp3b (the harness every test above runs on cannot drift from the asset)", () => {
  const V49_FILE = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v49.json")));
  it("every config is deep-equal, in the same order; only ADP's differs from v48", () => {
    expect(V49_FILE.category_configs.map((c) => c.category_id)).toEqual(V49.category_configs.map((c) => c.category_id));
    for (const c of V49_FILE.category_configs) expect({ id: c.category_id, cfg: c }).toEqual({ id: c.category_id, cfg: V49.category_configs.find((x) => x.category_id === c.category_id) });
    const changed = V49_FILE.category_configs.filter((c) => JSON.stringify(c) !== JSON.stringify(V48.category_configs.find((x) => x.category_id === c.category_id))).map((c) => c.category_id);
    expect(changed).toEqual([ADP]);
  });
  it("the catalogue is v48's, item for item (ADP-3b changes no item)", () => {
    expect(V49_FILE.items).toEqual(V48.items);
  });
});
