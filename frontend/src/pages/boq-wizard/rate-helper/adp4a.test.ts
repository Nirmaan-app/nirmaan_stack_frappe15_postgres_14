/**
 * ADP-4a (owner rulings 2026-10-21 14:41: D1-D6, D10, D11; scope rulings the same day) -- THE ADP WORDING CLEAN-UP, on HVAC
 * v50 as minted. Every rule here moves WORDS only: each figure is pinned beside its words, and Insulation / Piping keep
 * their text except the lines the owner ruled (U6 on the Derivation tab; AC3 on Insulation's working).
 *
 *   AC1  the ADP Derivation tab: a reason on every line (a ruling quoted with its date, or "reason not recorded"), the
 *        line defects fixed, the rules that ran with no line given one, the repeated lines merged (D2 / D3);
 *   AC2  no internal text on the panel / calculator: no pipeline id, no ROUNDUP, no H-code, no "(as written)", the
 *        plenum's "Plenum thickness (mm)", no "None" air choice (a stored None reads "not stated"), the sentinel families
 *        by their display names, "10^6" / "(factor)" / "sum components" / "SQM row" in words;
 *   AC3  each default and each size reading stated ONCE, on its field -- the working keeps the arithmetic;
 *   AC4  diameter, torque, panel ratio, thickness and slot count are "dropdown or Other..." exactly as the neck size;
 *   v50  = v49 + exactly those five panel controls and their five notes; the model's question is unchanged.
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture, runParity } from "@/pages/pricing/calculatorPanelParity.harness";
import { DERIVATION_RULINGS, itemListRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import { plainPricerText, plainSentence } from "@/pages/pricing/rate-master/plainEnglish";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { FAMILY_DISPLAY, plainItemListWording, plainWorking, itemListPricingSpec } from "./itemListPricing";
import { mergeItemsByName } from "./rateHelperPlumbing";
import { isSuggestion, type ExtractionRow, type HelperResult } from "./rateHelperTypes";
import { CONFIGS as LIVE_CONFIGS } from "./adp3a.harness";

type Asset = { discipline: string; items: Array<RateMasterItem & { brand?: string }>; category_configs: RateCategoryConfig[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const V49 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v49.json")));
const V50 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v50.json")));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const cfgOf = (a: Asset, id: string) => a.category_configs.find((c) => c.category_id === id)!;
const CFG = new Map<string, RateCategoryConfig>(LIVE_CONFIGS);
for (const id of [ADP, INS, PIP]) CFG.set(id, cfgOf(V50, id));
const ITEMS: RateMasterItem[] = mergeItemsByName(V50.items.map((it) => ({ ...it, discipline: V50.discipline } as RateMasterItem)));
const RK = ["supply_rate", "install_rate", "combined_rate"];
const OTHER5 = ["dia_mm", "torque_nm", "panel_ratio", "thickness_mm", "slot_count"];

const must = (r: HelperResult): ItemListSuggestion => { if (!isSuggestion(r)) throw new Error("expected a suggestion"); return r as ItemListSuggestion; };
const cells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
function panel(cat: string, unit: string, items: Array<Record<string, string>>, description = ""): ItemListSuggestion {
  const ext = new Map<number, ExtractionRow>([[1, { excelRow: 1, description, attributes: {}, items: items.map((a) => ({ attributes: cells(a) })) } as unknown as ExtractionRow]]);
  return must(makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS, extractionByRow: ext })
    .compute({ excelRow: 1, description, nodeType: "Line Item", category: cat, discipline: "HVAC", rateKinds: RK, headings: [], ownNotes: [], unit } as never, {}));
}
function calculator(cat: string, unit: string, family: string, attrs: Record<string, string>, other: string[] = []): ItemListSuggestion {
  return must(makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS, extractionByRow: new Map() })
    .compute({ excelRow: 1, description: "", nodeType: "Line Item", category: cat, discipline: "HVAC", rateKinds: RK } as never,
      { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family, attrs, other }] }), [ROW_UNIT_OVERRIDE_KEY]: unit }));
}
const block = (s: ItemListSuggestion) => s.itemList!.items[0];
const field = (s: ItemListSuggestion, id: string) => block(s).fields.find((f) => f.id === id);
const shown = (s: ItemListSuggestion): string => JSON.stringify(s.itemList);
// the r49 row: BOQ-26-00096 / HVAC / r49 -- a square diffuser, neck 225 (laddered to 300), 600 x 600 outer, supply air
const R49 = { family: "square diffuser", neck_mm: "225", size_mm: "600 x 600 MM", air: "supply" };

// ── v50: the asset ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("v50 = v49 + the five 'Other...' controls and their notes, nothing else", () => {
  it("POSITIVE: hvac_adp's panel_controls make the five fields dropdown_or_other, each with a note; the items are v49's", () => {
    const pr = (cfgOf(V50, ADP) as any).list_spec.pricing;
    for (const a of OTHER5) {
      expect({ a, control: pr.panel_controls[a] }).toEqual({ a, control: "dropdown_or_other" });
      expect(pr.panel_notes[a]?.[0]?.text).toMatch(/^Type the /);
    }
    expect(pr.panel_controls.neck_mm).toBe("dropdown_or_other");
    expect(V50.items).toEqual(V49.items);
  });
  it("NEGATIVE: everything else in v50 is v49 byte for byte -- every other config whole, ADP outside the two keys", () => {
    for (const c of V49.category_configs) if (c.category_id !== ADP) expect(cfgOf(V50, c.category_id)).toEqual(c);
    const strip = (c: any) => ({ ...c, list_spec: { ...c.list_spec, pricing: Object.fromEntries(Object.entries(c.list_spec.pricing).filter(([k]) => k !== "panel_controls" && k !== "panel_notes")) } });
    expect(strip(cfgOf(V50, ADP))).toEqual(strip(cfgOf(V49, ADP)));
    const pc49 = (cfgOf(V49, ADP) as any).list_spec.pricing.panel_controls, pc50 = (cfgOf(V50, ADP) as any).list_spec.pricing.panel_controls;
    expect(Object.keys(pc50).filter((k) => pc50[k] !== pc49[k]).sort()).toEqual([...OTHER5].sort());
    // the model's question reads list_spec.attribute_definitions only -- identical
    expect((cfgOf(V50, ADP) as any).list_spec.attribute_definitions).toEqual((cfgOf(V49, ADP) as any).list_spec.attribute_definitions);
  });
});

// ── AC1: the Derivation tab ────────────────────────────────────────────────────────────────────────────────────────
describe("AC1 -- ADP's Derivation tab: each rule once, in plain English, with its reason", () => {
  const lines = itemListRuleOrder(cfgOf(V50, ADP), ITEMS);
  const titles = lines.map((l) => l.title);
  const byTitle = (t: string | RegExp) => lines.find((l) => (typeof t === "string" ? l.title === t : t.test(l.title)));
  it("POSITIVE: every line carries a reason -- a ruling with its date, or 'reason not recorded' -- at the end of its detail", () => {
    expect(lines).toHaveLength(38);
    for (const l of lines) {
      expect({ n: l.n, reason: typeof l.reason === "string" && l.reason.length > 0 }).toEqual({ n: l.n, reason: true });
      expect({ n: l.n, tail: l.detail!.endsWith(`why: ${l.reason}`) }).toEqual({ n: l.n, tail: true });
      expect({ n: l.n, dated: l.reason === "reason not recorded" || /\(owner, (20\d\d-\d\d-\d\d|standing ADP ruling)\)|\(owner ruling on row links\)|reason not recorded/.test(l.reason!) }).toEqual({ n: l.n, dated: true });
    }
    // 20 of 38 lines carry a ruling (the D1 mapping table in the ADP-4a report); 18 say so where none exists
    // INVERTED at ADP-4b (owner AC6: line 6 now carries its 2026-10-19 ruling) by mechanical authority: BEFORE toBe(18)
    expect(lines.filter((l) => l.reason === "reason not recorded").length).toBe(17);
    expect(byTitle("A per-number slot diffuser is priced from the per-metre rate")!.reason).toMatch(/\(owner, 2026-10-19\)$/);
  });
  it("POSITIVE: every reason is one the rulings table holds, keyed by the catalogue's item kind -- never written from the code", () => {
    const table = Object.values(DERIVATION_RULINGS.hvac_adp_item);
    for (const l of lines) if (l.reason !== "reason not recorded") expect({ n: l.n, known: table.includes(l.reason!) }).toEqual({ n: l.n, known: true });
  });
  it("POSITIVE: the R1 defects are fixed -- full lists, 'item', per number, real refusals, a capital, the inputs' values, line 30's units", () => {
    const all = JSON.stringify(lines);
    expect(all).not.toMatch(/and \d+ more/);
    expect(all).not.toContain("<the missing ones>");
    expect(all).not.toContain("grey 'derived'");
    expect(byTitle(/derived from another row's cell/)!.detail).toContain("(the amber 'derived' cells)");
    expect(byTitle("An item the model could not match to any kind refuses")!.detail).toContain("'Not in the catalogue'");
    expect(byTitle("That kind's rule for that unit")!.detail).toMatch(/^a kind priced per number, per sq\.m or per metre has a rule for each/);
    expect(byTitle(/without slot count refuses/)!.detail).toMatch(/^'per-number row: no slot count stated to convert the per-metre rate'/);
    expect(byTitle(/without an area, or length \+ width \+ height refuses/)!.detail).toMatch(/^'mixing box \/ LP plenum needs an area, or length \+ width \+ height - neither stated - price this row by hand'/);
    expect(titles).toContain("Without as the damper on a per-sq.m row of slot diffuser refuses");
    expect(byTitle("Then the priced steps below, in their own order")!.detail)
      .toContain("Cross-talk assumed depth 300 mm, Flexible duct length per piece 2.5 m per piece, Mixing box supply adder 150 Rs per number");
    expect(byTitle("The rate converts to the unit the row is written in")!.detail).toMatch(/^a row in sq\.ft \(sqft, sq ft, sq\.ft, sft\) takes the per-sq\.m rate x 0\.0929, rounded up to the rupee/);
    const needs = byTitle("The facts that rule needs before it can price")!.detail!;
    for (const w of ["area", "piece length", "slot count", "length", "width", "height"]) expect(needs).toContain(w);
  });
  it("POSITIVE: the rules that ran with no line have one -- the conversions, the gauge check, the square-feet and ratio readings, m / cm", () => {
    for (const t of ["Per-number row: per-sq.m rate x W x H", "Area band: per-sq.m rate x the band's maximum area", "Per-metre grille: per-sq.m rate x height in metres",
      "Per piece: per-metre rate x the flexible duct length per piece", "A per-number cross-talk is priced by its own formula",
      "A plenum thickness below 5 mm is a sheet gauge, not a thickness, and refuses", "An area written in square feet refuses",
      "A panel ratio is read from '1:N' as N", "A size written in metres or centimetres is read in millimetres"]) expect(titles).toContain(t);
  });
  it("POSITIVE: the merges -- one damper / defaults line, one fitting line naming each value, one size line; no H-code anywhere", () => {
    expect(titles.filter((t) => /damper not mentioned is decided/.test(t))).toEqual([]);
    expect(byTitle("A fact the row does not mention takes its ruled value")!.detail).toMatch(/^damper not mentioned is decided by the air stream on .*; no air stream stated, and on every other kind -> without; .*insulated not mentioned -> with/);
    expect(titles.filter((t) => t.startsWith("Fitting the stated"))).toEqual(["Fitting the stated diameter, neck size, torque, panel ratio or plenum thickness to the catalogue"]);
    expect(byTitle(/^Fitting the stated/)!.detail).toContain("neck size 300, 375, 450");
    expect(titles.filter((t) => /typed in their own boxes/.test(t))).toEqual(["The sizes are typed in their own boxes, else read from the size as written"]);
    expect(titles).not.toContain("A two-part size on a Width + Height item is the face, whatever its parts are called");
    expect(titles).not.toContain("A kind the catalogue does not price in the row's unit");
    expect(titles).not.toContain("A neck size the catalogue does not stock can be typed in 'Other...'");
    expect(byTitle(/^A kind not stocked in the row's unit refuses/)!.detail).toContain("double-skin plenum is not offered per number");
    expect(JSON.stringify(lines)).not.toMatch(/\bH\d\b|\(S7/);
  });
  it("POSITIVE: the one size line says a length / depth part is 'not used' ONLY where it cannot be the face (old 35 vs 38)", () => {
    const d = byTitle(/^The sizes are typed/)!.detail!;
    expect(d).toContain("a two-part size fills both sides whatever its parts are called ('600(L)X150mm width' -> width 150, height 600");
    expect(d).toContain("is named and not used only where it cannot be the face");
    expect(d).toContain("on a box a D / deep / depth label is the height");
    expect(d).not.toContain("('600(L)') is named and not used;");
  });
  it("NEGATIVE: Insulation and Piping keep every line but the seven the owner ruled (U6), and carry no reason", () => {
    const old = (id: string) => itemListRuleOrder(cfgOf(V49, id), ITEMS);
    for (const id of [INS, PIP]) {
      const now = itemListRuleOrder(cfgOf(V50, id), ITEMS);
      expect(now.every((l) => l.reason === undefined)).toBe(true);
      expect(now.length).toBe(old(id).length);
      const changed = now.filter((l, i) => l.title !== old(id)[i].title || l.detail !== old(id)[i].detail).map((l) => l.n);
      // v49 and v50 run the same code here, so the generic fixes are measured against the ADP-R4 recon's lines below
      expect({ id, changed }).toEqual({ id, changed: [] });
    }
    const ins = itemListRuleOrder(cfgOf(V50, INS), ITEMS), pip = itemListRuleOrder(cfgOf(V50, PIP), ITEMS);
    expect([ins.length, pip.length]).toEqual([43, 25]);
    expect(JSON.stringify([ins, pip])).not.toMatch(/and \d+ more|grey 'derived'/);
    expect(ins[38].detail).toContain("(the amber 'derived' cells)");
    expect(ins[39].detail).toMatch(/^a row in sq\.ft \(sqft, sq ft, sq\.ft, sft\) takes the per-sq\.m rate x 0\.0929, rounded up to the rupee$/);
    expect(pip[12].title).toMatch(/^A Copper, MS, PVC, CPVC row stating its own figure/);
    expect(ins[1].title).toBe("The item's own kind decides which products can price it");
    expect(ins.find((l) => /could not match/.test(l.title))!.title).toBe("A material the model could not match to any kind refuses");
  });
});

// ── AC2: the panel's and the calculator's words ────────────────────────────────────────────────────────────────────
describe("AC2 -- no internal text on ADP's panel or calculator", () => {
  it("POSITIVE: r49 -- 1972 / 576 / 2548, the working names each rate and says the rounding once, in words", () => {
    const s = panel(ADP, "Nos", [R49]);
    expect(s.values).toEqual({ supply_rate: 1972, install_rate: 576, combined_rate: 2548 });
    expect(block(s).working).toEqual([
      "the outer size 600x600 is the sheet's 595x595",
      "supply: cost x (1 + the SKU's supply markup) = 1972, rounded up to the rupee",
      "install: cost x (1 + the SKU's install markup) = 576, rounded up to the rupee",
    ]);
    const t = shown(s);
    for (const bad of ["item supply:", "item install:", "supply: supply:", "ROUNDUP", "(as written)"]) expect({ bad, hit: t.includes(bad) }).toEqual({ bad, hit: false });
  });
  it("POSITIVE: the calculator, same answers -> the same figures and the same working", () => {
    const c = calculator(ADP, "nos", "square diffuser", { neck_mm: "225", face_w_mm: "600", face_h_mm: "600", air: "supply" }, ["neck_mm"]);
    expect(c.values).toEqual({ supply_rate: 1972, install_rate: 576, combined_rate: 2548 });
    expect(block(c).working.filter((w) => /rounded up to the rupee/.test(w))).toEqual([
      "supply: cost x (1 + the SKU's supply markup) = 1972, rounded up to the rupee",
      "install: cost x (1 + the SKU's install markup) = 576, rounded up to the rupee",
    ]);
  });
  it("POSITIVE: an H4 plenum's working has no code, no 10^6, no kind tag, and the rounding folded into its line", () => {
    const s = panel(ADP, "nos", [{ family: "mixing box / LP plenum", size_mm: "900x200x350mm Ht." }]);
    expect(s.values).toEqual({ supply_rate: 2233, install_rate: 0, combined_rate: 2233 });
    const w = block(s).working;
    // INVERTED at ADP-4b (owner AC6: the fields are Length / Width / Height) by mechanical authority: BEFORE
    // "... 2 x (L x B + B x H + L x H) / 1,000,000 ..."
    expect(w[0]).toBe("per-number mixing box / LP plenum: per-sq.m cost x 2 x (L x W + W x H + L x H) / 1,000,000 (sq.mm to sq.m), + the mixing-box supply adder on supply only, rounded up, then the markup");
    expect(w).toContain("supply: pricing input: Mixing box supply adder = 150");
    expect(w).toContain("supply: 1230 x 2 x (900 x 200 + 200 x 350 + 900 x 350) / 1,000,000 + 150 = 1539.9, rounded up to the rupee: 1540");
    expect(JSON.stringify(w)).not.toMatch(/\bH\d\b|\(S7|10\^6|\(amount\)|ROUNDUP/);
  });
  it("POSITIVE: labels read without '(as written)'; the double-skin plenum reads 'Plenum thickness (mm)' (owner 2026-10-21)", () => {
    const s = panel(ADP, "sqm", [{ family: "double-skin plenum", insulation_thickness_mm: "25" }]);
    expect(field(s, "insulation_thickness_mm")?.label).toBe("Plenum thickness (mm)");
    expect(field(panel(ADP, "Nos", [R49]), "neck_mm")?.label).toBe("Neck size");
    expect(field(panel(ADP, "nos", [{ family: "round diffuser", dia_mm: "250" }]), "dia_mm")?.label).toBe("Diameter");
  });
  it("POSITIVE: the air stream offers no 'None' (B5); a stored None shows the empty choice worded 'not stated' and prices as not stated", () => {
    const s = panel(ADP, "nos", [{ family: "square diffuser", neck_mm: "300", air: "None" }]);
    const air = field(s, "air")!;
    expect(air.options).toEqual(["supply", "return", "exhaust", "fresh"]);
    expect([air.value, air.placeholder]).toEqual(["", "not stated"]);
    expect(s.values).toEqual(panel(ADP, "nos", [{ family: "square diffuser", neck_mm: "300" }]).values);
  });
  it("NEGATIVE: U5 is the air stream -- a stored None on a field a ruled default maps (UL, damper, insulated) keeps its display", () => {
    // the BOQ-26-00100 r101 shape: an actuator with UL "None" and no torque refuses before any default fires
    const s = panel(ADP, "nos", [{ family: "actuator", ul: "None" }]);
    const ul = field(s, "ul")!;
    expect(ul.options).toEqual(["yes", "no"]);
    expect([ul.value, ul.placeholder]).toEqual(["None", undefined]);
    // the BOQ-26-00186 r90 shape: the damper keeps "None", the air beside it reads "not stated"
    const d = panel(ADP, "nos", [{ family: "round diffuser", damper: "None", air: "None" }]);
    expect([field(d, "damper")!.value, field(d, "damper")!.placeholder]).toEqual(["None", undefined]);
    expect([field(d, "air")!.value, field(d, "air")!.placeholder]).toEqual(["", "not stated"]);
  });
  it("POSITIVE: the sentinel families by their display names (the heading, the BoQ-says line); the value is unchanged", () => {
    const s = panel(ADP, "nos", [{ family: "none of these" }]);
    expect([block(s).family, block(s).familyLabel]).toEqual(["none of these", "Not in the catalogue"]);
    const g = panel(ADP, "rmt", [{ family: "grille, type not stated", size_mm: "150" }]);
    expect([block(g).familyRaw, block(g).familyRawLabel]).toEqual(["grille, type not stated", "Grille (type not stated)"]);
    expect(FAMILY_DISPLAY).toEqual({ "none of these": "Not in the catalogue", "grille, type not stated": "Grille (type not stated)" });
    // the family picker lists the STOCKED families only -- neither sentinel is ever in it, so it needs no display name
    expect(s.itemList!.families.map((f) => f.family).filter((f) => f in FAMILY_DISPLAY)).toEqual([]);
  });
  it("NEGATIVE: a family that is not a sentinel carries no display name; Insulation's 'none of these' heading is unchanged", () => {
    expect(block(panel(ADP, "nos", [{ family: "VCD", size_mm: "600x300" }])).familyLabel).toBeUndefined();
    expect(block(panel(INS, "Mtrs", [{ item: "none of these", pipe_size_mm: "50", thickness_mm: "19", cladding: "No" }])).familyLabel).toBeUndefined();
  });
  it("NEGATIVE: Insulation and Piping keep their working words -- ROUNDUP, kind tags and pipeline leads -- and their labels", () => {
    for (const id of [INS, PIP]) expect(plainItemListWording(itemListPricingSpec(cfgOf(V50, id))!)).toBe(false);
    expect(plainItemListWording(itemListPricingSpec(cfgOf(V50, ADP))!)).toBe(true);
    const p = panel(PIP, "Mtrs", [{ pipe_type: "Copper", size_mm: "6.4" }]);
    expect(block(p).working).toContain("supply: ROUNDUP(supply, 0) = 390");
    expect(block(p).working.some((w) => /\(factor\) = /.test(w))).toBe(true);
    const i = panel(INS, "Sqm", [{ item: "Acoustic Nitrile Insulation", cladding: "No", thickness_mm: "15" }]);
    expect(block(i).working).toContain("supply: ROUNDUP(supply, 0) = 1371");
    expect(block(i).working).toContain("supply: sum components = 932");
  });
});

// ── the pure helpers ───────────────────────────────────────────────────────────────────────────────────────────────
describe("plainWorking / plainSentence -- the words, pure", () => {
  it("POSITIVE: a pipeline lead, a doubled lead, a ROUNDUP that moved the figure and one that did not", () => {
    expect(plainWorking(["item supply: supply: cost x (1 + m) = 1971.2", "item supply: ROUNDUP(supply, 0) = 1972"]))
      .toEqual(["supply: cost x (1 + m) = 1971.2, rounded up to the rupee: 1972"]);
    expect(plainWorking(["install: install: cost x (1 + m) = 576", "install: ROUNDUP(install, 0) = 576"]))
      .toEqual(["install: cost x (1 + m) = 576, rounded up to the rupee"]);
    expect(plainWorking(["supply: ROUNDUP(cost, -1) = 1980"])).toEqual(["supply: rounded up to the next 10 rupees = 1980"]);
    expect(plainWorking(["supply: pricing input: X (factor) = 2.5", "supply: sum components = 9", "supply: the base cost of the family's SQM row = 5"]))
      .toEqual(["supply: pricing input: X = 2.5", "supply: the parts added together = 9", "supply: the base cost of the family's per-sq.m catalogue row = 5"]);
  });
  it("NEGATIVE: a line of any other shape, and every figure, unchanged; idempotent", () => {
    const keep = ["the outer size 600x600 is the sheet's 595x595", "per sq.ft: sq.m rate x 0.0929 (supply 12470 -> 1159)", "x 2 per row unit"];
    expect(plainWorking(keep)).toEqual(keep);
    const once = plainWorking(["item supply: supply: cost x (1 + m) = 1971.2", "item supply: ROUNDUP(supply, 0) = 1972"]);
    expect(plainWorking(once)).toEqual(once);
  });
  it("POSITIVE / NEGATIVE: H-codes and comma-joined tags go; a bracket that is not a tag stays", () => {
    expect(plainSentence("H4 per-number mixing box: cost x 2 (S7, H4)")).toBe("per-number mixing box: cost x 2");
    expect(plainPricerText("supply: per-metre supply cost x the piece length in metres (H3) = 12")).toBe("supply: per-metre supply cost x the piece length in metres = 12");
    expect(plainSentence("height in metres (H / 1000)")).toBe("height in metres (H / 1000)");
    expect(plainSentence("a size (W x H)")).toBe("a size (W x H)");
  });
});

// ── AC3: each default once, on its field ───────────────────────────────────────────────────────────────────────────
describe("AC3 -- each default and each size reading stated once, on its field", () => {
  it("POSITIVE: r49 -- the damper default, the neck's ladder and both face readings are on their fields, not in the working", () => {
    const s = panel(ADP, "Nos", [R49]);
    expect(field(s, "damper")?.rule).toBe("supply air, damper not mentioned -> with damper");
    expect(field(s, "neck_mm")?.note).toBe("BoQ says 225 mm -> priced as 300 mm (the smallest size)");
    expect(field(s, "face_w_mm")?.note).toBe("BoQ says 600 x 600 MM -> width 600 mm");
    const w = block(s).working.join("\n");
    for (const gone of ["damper not mentioned", "neck size 225 is not on the sheet", "width: BoQ says", "height: BoQ says"]) expect({ gone, hit: w.includes(gone) }).toEqual({ gone, hit: false });
  });
  it("POSITIVE: Insulation (the 00261 r38 shape) -- the thickness, cladding and material defaults and the size hop once, on their fields", () => {
    const s = panel(INS, "Mtrs", [{ item: "None", cladding: "None", thickness_mm: "None", pipe_size_mm: "50" }]);
    expect(s.values).toEqual({ supply_rate: 348, install_rate: 14, combined_rate: 362 });
    expect(field(s, "thickness_mm")?.note).toBe("Default 9 mm -> priced as 13 mm (the smallest size)");
    expect(block(s).familyDefaulted?.value).toBe("Nitrile Rubber Insulation");
    expect(block(s).working.filter((w) => /not mentioned|is not on the sheet/.test(w))).toEqual([]);
  });
  it("NEGATIVE: a fact no field states stays in the working; Piping, which rules no defaults, keeps its own ladder hop", () => {
    // r49's outer size: the outer boxes say what width and height were READ, not that 600x600 is the sheet's 595x595
    expect(block(panel(ADP, "Nos", [R49])).working[0]).toBe("the outer size 600x600 is the sheet's 595x595");
    const p = panel(PIP, "Mtrs", [{ pipe_type: "Copper", size_mm: "34.3" }]);
    expect(block(p).working).toContain("pipe size 34.3 is not on the sheet -> 34.9 (next size up)");
  });
});

// ── AC4: "Other..." on the five fields ─────────────────────────────────────────────────────────────────────────────
describe("AC4 -- diameter, torque, panel ratio, thickness and slot count offer 'Other...' exactly as the neck size", () => {
  const cases: Array<[string, string, Record<string, string>, string]> = [
    ["dia_mm", "round diffuser", { family: "round diffuser", dia_mm: "250" }, "nos"],
    ["torque", "actuator", { family: "actuator", torque: "6", ul: "no" }, "nos"],
    ["panel_ratio", "control panel", { family: "control panel", panel_ratio: "1:6" }, "nos"],
    ["insulation_thickness_mm", "double-skin plenum", { family: "double-skin plenum", insulation_thickness_mm: "25" }, "sqm"],
    ["slot_count", "slot diffuser", { family: "slot diffuser", slot_count: "2", damper: "with" }, "rmt"],
  ];
  it.each(cases)("POSITIVE: %s on a %s -- allowOther, a note saying what to type, 'How is this matched?' from the catalogue", (id, _f, item, unit) => {
    const f = field(panel(ADP, unit, [item]), id)!;
    expect(f.allowOther).toBe(true);
    expect(f.typedNote).toMatch(/^Type the /);
    expect(Array.isArray(f.options) && f.options.length > 0).toBe(true);
  });
  it("POSITIVE: a typed diameter between stocked sizes ladders up, with its line; above the largest it refuses by name", () => {
    const up = calculator(ADP, "nos", "round diffuser", { dia_mm: "330" }, ["dia_mm"]);
    // the round diffuser stocks 300 and 400 around it (the field's own live options), so 330 takes 400
    expect(field(up, "dia_mm")?.options).toEqual(expect.arrayContaining(["300", "400"]));
    expect(field(up, "dia_mm")?.options).not.toContain("350");
    expect(field(up, "dia_mm")?.note).toBe("You typed 330 mm -> priced as 400 mm (next size up)");
    expect(up.itemList!.rowPriced).toBe(true);
    const over = calculator(ADP, "nos", "round diffuser", { dia_mm: "450" }, ["dia_mm"]);
    expect(over.itemList!.rowPriced).toBe(false);
    expect(block(over).reason).toBe("diameter 450 is above the largest size on the sheet (400)");
  });
  it("POSITIVE: the panel and the calculator say the same sentence for a BoQ diameter above the largest (one of the 21)", () => {
    const p = panel(ADP, "nos", [{ family: "round diffuser", dia_mm: "450" }]);
    const c = calculator(ADP, "nos", "round diffuser", { dia_mm: "450" }, ["dia_mm"]);
    expect(block(c).reason).toBe(block(p).reason);
  });
  it("NEGATIVE: a field the owner did not name keeps its control -- damper and variant stay plain dropdowns", () => {
    const s = panel(ADP, "nos", [{ family: "VCD", size_mm: "600x300" }]);
    expect(field(s, "damper")?.allowOther).toBeUndefined();
    expect(field(s, "variant")?.allowOther).toBeUndefined();
  });
  // the parity test's A27 (the cross-talk's own formula) is excluded on v33 only, where the two surfaces measurably differ;
  // on v50 the same case agrees -- pinned here, every spelling the probe measured, so the exclusion cannot hide a v50 drift
  it("POSITIVE: on v50 a per-number cross-talk prices identically on the panel and the calculator, whatever the size spelling", () => {
    for (const size of ["500x250", "500 x 250", "500(W) x 250(H)", "250(L) x 500(W)"]) {
      const r = runParity(CFG, ITEMS, { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: "cross-talk", size_mm: size }] } as never, "full");
      expect({ size, divergences: r.divergences }).toEqual({ size, divergences: [] });
    }
    const p = panel(ADP, "nos", [{ family: "cross-talk", size_mm: "500x250" }]);
    expect([p.values.supply_rate, p.values.install_rate]).toEqual([1044, 360]);
  });
});
