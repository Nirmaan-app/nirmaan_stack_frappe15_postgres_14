/**
 * ADP-4b (owner rulings 2026-10-21: D8, D9 option A, D7, fixes (a) and (b), cause E, AC6 wording; PA1-R, FIXB-1, the
 * AC3 / AC5 / AC7 answers) -- THE DERIVATION TAB IS THE RULES LISTING, THE PIPELINES TAB IS GONE, AND FOUR ADP FIXES.
 * On HVAC v50 and Electrical v66 as loaded.
 *
 *   AC1  (rendered) -- in `adp4b.dom.test.ts`: a DOM file is opted in by its FILENAME (vitest.config.ts), and a jsdom
 *        docblock in a `*.test.ts` file loses the worker-start race in the full run and is DROPPED, never run;
 *   AC2  the Pipelines tab and its editor-only helpers are gone; the shared helpers and the server endpoint stay;
 *   AC4  a per-sq.m slot diffuser whose blank damper defaults to "without" (which refuses) stars the Damper field;
 *   AC5  the double-skin plenum per number refuses naming "stocked per sq.m" on panel and calculator, is not offered
 *        per number, and no Derivation line names it as priced per number;
 *   AC6  the box formula reads "2 x (L x W + W x H + L x H)" on the line and in the working; lines 6 and 19 carry reasons;
 *   AC7  panel and calculator quote a set-aside outer size as READ ("outer size 450 x 450"); a size that gave no sides
 *        keeps its words as written.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { DERIVATION_RULINGS, itemListRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import * as STRUCTURE from "@/pages/pricing/rate-master/rateMasterStructure";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, unitChoicesOf, type ItemListSuggestion } from "./pricingSheetHelper";
import { familyUnitClasses, itemListPricingSpec, plainBoxSurface, plainWorking, priceItemList, stockedUnitsWords } from "./itemListPricing";
import { mergeItemsByName } from "./rateHelperPlumbing";
import { isSuggestion, type ExtractionRow, type HelperResult } from "./rateHelperTypes";
import { CONFIGS as LIVE_CONFIGS } from "./adp3a.harness";

type Asset = { discipline: string; items: Array<RateMasterItem & { brand?: string }>; category_configs: RateCategoryConfig[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const V50 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v50.json")));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const cfgOf = (a: Asset, id: string) => a.category_configs.find((c) => c.category_id === id)!;
const CFG = new Map<string, RateCategoryConfig>(LIVE_CONFIGS);
for (const id of [ADP, INS, PIP]) CFG.set(id, cfgOf(V50, id));
const ITEMS: RateMasterItem[] = mergeItemsByName(V50.items.map((it) => ({ ...it, discipline: V50.discipline } as RateMasterItem)));
const RK = ["supply_rate", "install_rate", "combined_rate"];
const SPEC = itemListPricingSpec(cfgOf(V50, ADP))!;

const must = (r: HelperResult): ItemListSuggestion => { if (!isSuggestion(r)) throw new Error("expected a suggestion"); return r as ItemListSuggestion; };
const cells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
function panel(cat: string, unit: string, items: Array<Record<string, string>>): ItemListSuggestion {
  const ext = new Map<number, ExtractionRow>([[1, { excelRow: 1, description: "", attributes: {}, items: items.map((a) => ({ attributes: cells(a) })) } as unknown as ExtractionRow]]);
  return must(makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS, extractionByRow: ext })
    .compute({ excelRow: 1, description: "", nodeType: "Line Item", category: cat, discipline: "HVAC", rateKinds: RK, headings: [], ownNotes: [], unit } as never, {}));
}
function calculator(cat: string, unit: string, family: string, attrs: Record<string, string>, other: string[] = []): ItemListSuggestion {
  return must(makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS, extractionByRow: new Map() })
    .compute({ excelRow: 1, description: "", nodeType: "Line Item", category: cat, discipline: "HVAC", rateKinds: RK } as never,
      { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family, attrs, other }] }), [ROW_UNIT_OVERRIDE_KEY]: unit }));
}
const block = (s: ItemListSuggestion) => s.itemList!.items[0];
const field = (s: ItemListSuggestion, id: string) => block(s).fields.find((f) => f.id === id);

// ── AC2: the Pipelines tab and its editor-only code are gone ───────────────────────────────────────────────────────
describe("AC2 -- the Pipelines tab is removed for every category (owner D9, option A)", () => {
  const RM = path.resolve(__dirname, "../../pricing/rate-master");
  const page = fs.readFileSync(path.join(RM, "RateMasterPage.tsx"), "utf-8");
  it("POSITIVE: the page has two tabs -- Data Viewer and Derivation -- and no Pipelines tab, import or write", () => {
    expect(page.match(/<TabsTrigger value="/g)?.length).toBe(2);
    expect(page).toContain('<TabsTrigger value="viewer">Data Viewer</TabsTrigger>');
    expect(page).toContain('<TabsTrigger value="derivation">Derivation</TabsTrigger>');
    for (const gone of ['value="pipelines"', "RateMasterPipelines", '"nirmaan_stack.api.boq.rate_master.update_rate_config"', '"nirmaan_stack.api.boq.rate_master.update_rate_config_param"', "onSaveConfig", "onSaveParam"]) {
      expect({ gone, present: page.includes(gone) }).toEqual({ gone, present: false });
    }
    expect(fs.existsSync(path.join(RM, "RateMasterPipelines.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(RM, "RateMasterPipelines.test.ts"))).toBe(false);
  });
  it("NEGATIVE: the editor-only helpers are gone; the shared ones stay", () => {
    const exported = Object.keys(STRUCTURE);
    for (const gone of ["cloneConfig", "evaluateGoldens", "goldenDeltas", "referencedAttrIds", "blankPipeline", "blankAttributeDefinition"]) {
      expect({ gone, exported: exported.includes(gone) }).toEqual({ gone, exported: false });
    }
    for (const kept of ["blankStep", "STEP_VOCABULARY", "categoryItemKinds", "isDropdownAttributeType", "isNumericAttributeType", "coerceForMatch", "derivedAttrIds", "derivedQtyAttrs"]) {
      expect({ kept, exported: exported.includes(kept) }).toEqual({ kept, exported: true });
    }
  });
  // INVERTED at ADP-5a (owner D9, 2026-10-21: "kept one slice, then removed") by mechanical authority. BEFORE:
  //   it("NEGATIVE (option A): the server keeps update_rate_config one more slice -- it is only uncalled", ...)
  //   expect(api).toContain("def update_rate_config("); expect(api).toContain("def update_rate_config_param(");
  it("NEGATIVE (option A, the slice after): the server endpoints update_rate_config and update_rate_config_param are removed", () => {
    const api = fs.readFileSync(path.resolve(__dirname, "../../../../../nirmaan_stack/api/boq/rate_master.py"), "utf-8");
    expect(api).not.toContain("def update_rate_config(");
    expect(api).not.toContain("def update_rate_config_param(");
    // the validator they wrapped stays importable through the api module (the loader is its product caller)
    expect(api).toContain("    _validate_config,\n");
  });
});

// ── AC4: fix (a) -- the slot diffuser's Damper "*" ─────────────────────────────────────────────────────────────────
describe("AC4 -- a per-sq.m slot diffuser whose blank damper defaults to 'without' (refused) stars the Damper field", () => {
  const SD = { family: "slot diffuser", slot_count: "2" };
  it("POSITIVE: per sq.m, damper blank -> the Damper field is needed (*); the refusal is unchanged", () => {
    const s = panel(ADP, "SQM", [SD]);
    expect(field(s, "damper")?.required).toBe(true);
    expect(block(s).reason).toBe("No SKU for a slot diffuser per sq.m without damper - price this row by hand");
    const c = calculator(ADP, "sqm", "slot diffuser", { slot_count: "2" });
    expect(field(c, "damper")?.required).toBe(true);
  });
  it("POSITIVE: a stated 'with' still prices per sq.m (the star asks; the field filled answers)", () => {
    const s = panel(ADP, "SQM", [{ ...SD, damper: "with" }]);
    expect(block(s).state).toBe("priced");
  });
  it("NEGATIVE: per metre the same blank damper defaults to 'without' and prices -- no star; VCD's damper is never starred", () => {
    const m = panel(ADP, "RMT", [{ ...SD, size_mm: "1000 x 150" }]);
    expect(field(m, "damper")?.required ?? false).toBe(false);
    const v = panel(ADP, "SQM", [{ family: "VCD" }]);
    expect(field(v, "damper")?.required ?? false).toBe(false);
  });
});

// ── AC5: fix (b) -- the double-skin plenum per number ──────────────────────────────────────────────────────────────
describe("AC5 -- the double-skin plenum per number refuses naming 'stocked per sq.m'; same rule everywhere (owner FIXB-1)", () => {
  const REFUSAL = "double-skin plenum is not stocked per number (stocked per sq.m) - price this row by hand";
  it("POSITIVE: the panel refuses per number; the calculator cannot be put on per number at all; per sq.m prices", () => {
    const p = panel(ADP, "Nos", [{ family: "double-skin plenum", insulation_thickness_mm: "25", size_mm: "600 x 600 x 300" }]);
    expect([block(p).state, block(p).reason]).toEqual(["blank", REFUSAL]);
    // the calculator's unit is a pick, and per number is not offered: a 'nos' pick is not honoured -- it prices per sq.m
    const c = calculator(ADP, "nos", "double-skin plenum", { insulation_thickness_mm: "25" });
    expect(c.itemList!.unit).toBe("sqm");
    expect(block(c).state).toBe("priced");
    const sq = panel(ADP, "SQM", [{ family: "double-skin plenum", insulation_thickness_mm: "25" }]);
    expect(block(sq).state).toBe("priced");
  });
  it("POSITIVE: not offered per number -- the picker and the stocked words say sq.m only", () => {
    expect(familyUnitClasses(SPEC, "double-skin plenum")).toEqual(["area"]);
    expect(stockedUnitsWords(SPEC, "double-skin plenum")).toBe("per sq.m");
    expect(unitChoicesOf(SPEC, ["double-skin plenum"])).not.toContain("nos");
    const c = calculator(ADP, "", "double-skin plenum", {});
    expect(c.itemList!.unitChoices).not.toContain("nos");
    expect(c.itemList!.unitChoices).toContain("sqm");
  });
  it("POSITIVE: no Derivation line names it as priced per number; line 34 says 'stocked per sq.m'", () => {
    const lines = itemListRuleOrder(cfgOf(V50, ADP), ITEMS);
    const perNumber = lines.filter((l) => /^Per-number row: per-sq\.m rate x W x H|^Area band:|^A per-number item needs/.test(l.title));
    expect(perNumber.length).toBe(3);
    for (const l of perNumber) expect({ t: l.title, names: l.detail!.includes("double-skin plenum") }).toEqual({ t: l.title, names: false });
    const unit = lines.find((l) => /^A kind not stocked in the row's unit refuses/.test(l.title))!;
    expect(unit.detail).toContain("double-skin plenum (stocked per sq.m)");
    expect(unit.detail).not.toContain("double-skin plenum (stocked per number or per sq.m)");
  });
  it("NEGATIVE: every other family keeps its per-number conversion -- VCD still named, still priced per number", () => {
    const lines = itemListRuleOrder(cfgOf(V50, ADP), ITEMS);
    expect(lines.find((l) => /^Per-number row: per-sq\.m rate x W x H/.test(l.title))!.detail).toContain("VCD");
    expect(stockedUnitsWords(SPEC, "VCD")).toBe("per number or per sq.m");
    const r = priceItemList(SPEC, ITEMS, "Nos", [{ attributes: { family: { value: "VCD" }, size_mm: { value: "600 x 300" } } }]);
    expect(r.priced).toBe(true);
  });
});

// ── AC6: the wording ───────────────────────────────────────────────────────────────────────────────────────────────
describe("AC6 -- the box formula in one wording; two reasons recorded", () => {
  const lines = itemListRuleOrder(cfgOf(V50, ADP), ITEMS);
  it("POSITIVE: the mixing-box line and its working read 2 x (L x W + W x H + L x H)", () => {
    const l = lines.find((x) => x.title === "A per-number mixing box / LP plenum is priced from the per-sq.m rate")!;
    expect(l.detail).toContain("2 x (L x W + W x H + L x H)");
    const s = panel(ADP, "nos", [{ family: "mixing box / LP plenum", size_mm: "900x200x350mm Ht." }]);
    expect(s.values).toEqual({ supply_rate: 2233, install_rate: 0, combined_rate: 2233 });   // figures unchanged
    const w = JSON.stringify(block(s).working);
    expect(w).toContain("2 x (L x W + W x H + L x H)");
    for (const old of ["L x B", "B x H", "H x D", "W x D"]) expect({ old, hit: w.includes(old) || JSON.stringify(l).includes(old) }).toEqual({ old, hit: false });
  });
  it("NEGATIVE: the rewrite touches only the two box formulas -- any other text is byte-identical", () => {
    for (const t of ["supply: 1230 x 2 x (900 x 200 + 200 x 350 + 900 x 350) / 1,000,000 + 150 = 1539.9", "2 x (W + H) x depth", "(L x B)"]) {
      expect(plainBoxSurface(t)).toBe(t);
    }
    expect(plainWorking(["x 2 x (W x H + H x D + W x D) y"])).toEqual(["x 2 x (L x W + W x H + L x H) y"]);
  });
  it("POSITIVE: line 6 and line 19's box sides carry the owner's 2026-10-19 rulings; the rest unchanged", () => {
    expect(lines[5].title).toBe("A per-number slot diffuser without slot count refuses, naming what is missing");
    expect(lines[5].reason).toBe("when priced in numbers, the SKU is matched on its slots and damper (owner, 2026-10-19)");
    expect(lines[18].reason).toContain("the box sides -- either the area is read, or the length, width and height, and the formula is applied; with neither the row refuses (owner, 2026-10-19)");
    expect(lines[18].reason).not.toContain("reason not recorded");
    const table = Object.values(DERIVATION_RULINGS.hvac_adp_item);
    expect(table).toContain(lines[5].reason);
    expect(lines.filter((l) => l.reason === "reason not recorded").length).toBe(17);
  });
});

// ── AC7: cause E ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("AC7 -- panel and calculator quote a set-aside outer size as read (owner: 'Both quote the read sides')", () => {
  const SENT = "square diffuser needs Neck size, or Outer size - outer size 450 x 450 could not be used and no neck size stated - price this row by hand";
  it("POSITIVE: the BoQ's words and the typed boxes give the same sentence", () => {
    const p = panel(ADP, "Nos", [{ family: "square diffuser", size_mm: "450 mm x 450 mm", air: "supply" }]);
    const c = calculator(ADP, "nos", "square diffuser", { face_w_mm: "450", face_h_mm: "450", air: "supply" });
    expect(block(p).reason).toBe(SENT);
    expect(block(c).reason).toBe(SENT);
  });
  it("NEGATIVE: a size that gives no sides keeps its words as written", () => {
    const p = panel(ADP, "Nos", [{ family: "square diffuser", size_mm: "Out to Out Size of 12\"x12\" & 24\"x24\"", air: "supply" }]);
    expect(block(p).reason).toContain("outer size 'Out to Out Size of 12\"x12\" & 24\"x24\"' could not be used");
  });
  it("NEGATIVE: an outer size the catalogue stocks still prices (r49's 600 x 600) -- nothing set aside", () => {
    const p = panel(ADP, "Nos", [{ family: "square diffuser", neck_mm: "225", size_mm: "600 x 600 MM", air: "supply" }]);
    expect(p.values).toEqual({ supply_rate: 1972, install_rate: 576, combined_rate: 2548 });
  });
});
