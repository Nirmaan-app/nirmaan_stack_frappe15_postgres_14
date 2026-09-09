// Calculator slice 2 (2026-09-09) -- the parity guarantee the design rests on, and the pins that keep
// the plumbing single, the tab honest, and the calculator write-free.
//
// ⚠️ WHAT THIS FILE CANNOT COVER: the RENDER. There is no DOM environment here (frontend/CLAUDE.md), so
// nothing below mounts `RateHelperPanel` or `PricingCalculator`. That is exactly why the calculator
// reuses the ONE panel component rather than drawing its own figures: the parity below proves the DATA
// (`values`, `headlines`, every section's `figures`) is identical for identical picks; the browser cert
// is what proves the two surfaces draw it identically. A second render of a figure would sit outside
// both proofs, which is why the source pins forbid one.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import LIVE_ASSET_V59 from "../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v59.json";
import type { RateCategoryConfig, RateMasterItem } from "./rate-master/rateMasterTypes";
import { RATE_MASTER_DISCIPLINES } from "./rate-master/rateMasterRegistry";
import { RATE_MASTER_CONFIG_TARGETS } from "@/pages/boq-wizard/rate-helper/rateHelperPlumbing";
import { buildExtractionByRow, makePricingSheetHelper } from "@/pages/boq-wizard/rate-helper/pricingSheetHelper";
import { attrDisplayValue, isSuggestion, type ExtractionRow, type RateHelperRowContext } from "@/pages/boq-wizard/rate-helper/rateHelperTypes";
import {
  CALCULATOR_COL,
  CALCULATOR_KIND,
  CALCULATOR_WORKBOOKS,
  calculatorCtx,
  calculatorDisciplineForPath,
  calculatorRowFor,
} from "./PricingCalculator";

// ── the live asset, as the frontend sees it ─────────────────────────────────────────────────────
type Golden = { id?: string; attrs?: Record<string, string | number>; expect?: Record<string, Record<string, number>> };
const ASSET = LIVE_ASSET_V59 as unknown as {
  category_configs: Array<RateCategoryConfig & { goldens?: Golden[] }>;
  items: Array<RateMasterItem & { brand?: string }>;
};
// the endpoint projects `brand` into attributes at read time (extraction.PROJECTED_ITEM_COLUMNS)
const ITEMS: RateMasterItem[] = ASSET.items.map((i) => ({
  ...i,
  attributes: { ...i.attributes, ...(i.brand ? { brand: i.brand } : {}) },
}));
const CONFIGS = new Map<string, RateCategoryConfig>(ASSET.category_configs.map((c) => [c.category_id, c]));
const DISCIPLINE = "Electrical";

function ext(attrs: Record<string, string | number>): ExtractionRow["attributes"] {
  const out: ExtractionRow["attributes"] = {};
  for (const [k, v] of Object.entries(attrs)) out[k] = { value: v, confidence: 0.9 };
  return out;
}
const rowCtx = (category: string, excelRow = 1, description = ""): RateHelperRowContext => ({
  excelRow, description, nodeType: "Line Item", category, discipline: DISCIPLINE, rateKinds: ["supply_rate", "install_rate", "combined_rate"],
});
const inRunHelper = (attrs: Record<string, string | number>, excelRow = 1) =>
  makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: buildExtractionByRow([{ excel_row: excelRow, attributes: ext(attrs) }]) });
// THE CALCULATOR'S CONSTRUCTION, verbatim from PricingCalculator.tsx: the same factory, an EMPTY map.
const calculatorHelper = () => makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
const figuresOf = (r: ReturnType<ReturnType<typeof calculatorHelper>["compute"]>) =>
  isSuggestion(r) ? (r.workings.sections ?? []).map((s) => s.figures ?? null) : null;
const headlinesOf = (r: ReturnType<ReturnType<typeof calculatorHelper>["compute"]>) =>
  isSuggestion(r) ? (r.headlines ?? []).map((h) => h.values) : null;
/** The picks a user would make to reproduce what the in-run panel SHOWS: every field's DISPLAYED value
 *  (`attrDisplayValue` -- the row's own value, or the pipeline's computed one where the panel shows
 *  that), skipping blanks and read-only fields (a fully superseded quantity has no control to pick).
 *  ⚠️ DISPLAYED, not extracted: `industrial_sockets` derives its paired MCB from hidden `panel: false`
 *  facts (`mcb_present`, `mcb_amp_a`) that only an extraction carries, but the panel SHOWS the fitted
 *  MCB in the visible `paired_mcb` field -- and that visible pick is what a calculator user makes. */
const picksShownBy = (r: ReturnType<ReturnType<typeof calculatorHelper>["compute"]>): Record<string, string> => {
  if (!isSuggestion(r)) return {};
  return Object.fromEntries(
    r.workings.attributes
      .filter((a) => !a.readOnly && !a.disabled)
      .map((a) => [a.id, attrDisplayValue(a)] as const)
      .filter(([, v]) => v !== ""),
  );
};

const CALC_SRC = readFileSync(join(__dirname, "PricingCalculator.tsx"), "utf8");
const PAGE_SRC = readFileSync(join(__dirname, "PricingWorkbookPage.tsx"), "utf8");
const BOQ_PAGE_SRC = readFileSync(join(__dirname, "../boq-wizard/SheetPricingPage.tsx"), "utf8");
const PLUMBING_SRC = readFileSync(join(__dirname, "../boq-wizard/rate-helper/rateHelperPlumbing.tsx"), "utf8");
const PANEL_SRC = readFileSync(join(__dirname, "../boq-wizard/rate-helper/RateHelperPanel.tsx"), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("Calculator slice 2 / THE PARITY TEST -- an in-run row and an empty-map calculator give the SAME figures for the SAME picks, every golden", () => {
  const cases: Array<{ category: string; golden: Golden }> = [];
  for (const c of ASSET.category_configs) for (const g of c.goldens ?? []) cases.push({ category: c.category_id, golden: g });

  it("the corpus: every category carries at least one golden, 34 in all", () => {
    expect(cases.length).toBe(34);
    for (const c of ASSET.category_configs) expect((c.goldens ?? []).length, c.category_id).toBeGreaterThan(0);
  });

  for (const { category, golden } of cases) {
    it(`${category} / ${golden.id ?? "?"}: values, headlines and every section's figures are DEEP-EQUAL`, () => {
      const A = inRunHelper(golden.attrs ?? {}).compute(rowCtx(category));
      // V = what the in-run panel SHOWS (extracted values plus any never-asked default), fed back as picks.
      const V = picksShownBy(A);
      const B = calculatorHelper().compute(rowCtx(category), V);
      expect(B.kind).toBe(A.kind);
      if (!isSuggestion(A) || !isSuggestion(B)) return;
      expect(B.values).toEqual(A.values);
      expect(headlinesOf(B)).toEqual(headlinesOf(A));
      expect(figuresOf(B)).toEqual(figuresOf(A));
      // The basis line is NOT compared for equality: it lists the attributes the row STATED, and a
      // calculator user states values the in-run row derived (a fitted paired MCB, a computed circuit
      // length), so the calculator's list is longer. Same label, same shape, same figures.
      expect(B.basis.split(" @ ")[0]).toBe(A.basis.split(" @ ")[0]);
      // and through the CALCULATOR'S OWN ctx (its sentinel row, no text): identical again
      const C = calculatorHelper().compute(calculatorCtx(DISCIPLINE, category), V);
      if (!isSuggestion(C)) throw new Error("expected suggestion");
      expect(C.values).toEqual(A.values);
      expect(headlinesOf(C)).toEqual(headlinesOf(A));
      expect(figuresOf(C)).toEqual(figuresOf(A));
    });
  }

  it("the parity population PRICES: at least 25 of the 34 goldens produce a value on both sides (a refusal on both is parity too, but not the point)", () => {
    let priced = 0;
    for (const { category, golden } of cases) {
      const A = inRunHelper(golden.attrs ?? {}).compute(rowCtx(category));
      if (isSuggestion(A) && Object.keys(A.values).length > 0) priced += 1;
    }
    expect(priced).toBeGreaterThanOrEqual(25);
  });

  it("⚠️ THE GAP, stated: `values` (the header / Use figure) follows the ROW'S TEXT on wiring; the calculator has no text, so it is cable-primary -- headlines and figures are still identical", () => {
    const wiring = ASSET.category_configs.find((c) => c.category_id === "wiring_cabling")!;
    const g = (wiring.goldens ?? [])[0];
    const A = inRunHelper(g.attrs ?? {}).compute(rowCtx("wiring_cabling", 1, "Cable end termination gland + lug"));
    const V = picksShownBy(A);
    const C = calculatorHelper().compute(calculatorCtx(DISCIPLINE, "wiring_cabling"), V);
    if (!isSuggestion(A) || !isSuggestion(C)) throw new Error("expected suggestions");
    expect(headlinesOf(C)).toEqual(headlinesOf(A));   // both blocks, both surfaces
    expect(figuresOf(C)).toEqual(figuresOf(A));       // both sections' three figures
    expect(A.values.supply_rate).toBe(A.headlines![1].values.supply_rate); // the row's text made termination primary
    expect(C.values.supply_rate).toBe(C.headlines![0].values.supply_rate); // the calculator has no text: cable primary
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("Calculator slice 2 / the plumbing is defined ONCE and the BoQ page imports it back", () => {
  it("the shared module exports what the page held privately, and the targets equal the registry", () => {
    expect(RATE_MASTER_CONFIG_TARGETS).toEqual(
      RATE_MASTER_DISCIPLINES.flatMap((d) => d.categories.map((c) => ({ discipline: d.discipline, categoryId: c.category_id }))),
    );
    expect(RATE_MASTER_CONFIG_TARGETS.length).toBe(12);
    for (const name of ["export const RATE_MASTER_CONFIG_TARGETS", "export function RateConfigFetcher", "export function useConfigsByCategory", "export function useRateMasterItems"]) {
      expect(PLUMBING_SRC).toContain(name);
    }
  });
  it("⚠️ NEGATIVE: the BoQ page no longer DEFINES any of the three -- it imports them", () => {
    const src = strip(BOQ_PAGE_SRC);
    expect(src).toContain('from "./rate-helper/rateHelperPlumbing"');
    expect(src).not.toMatch(/function RateConfigFetcher\(/);
    expect(src).not.toMatch(/const RATE_MASTER_CONFIG_TARGETS\s*[:=]/);
    expect(src).not.toContain("nirmaan_stack.api.boq.rate_master.get_rate_master_items");
    expect(src).not.toContain("nirmaan_stack.api.boq.rate_master.get_rate_category_config");
    // and the calculator imports the SAME module, not a copy
    expect(strip(CALC_SRC)).toContain('from "@/pages/boq-wizard/rate-helper/rateHelperPlumbing"');
    expect(strip(CALC_SRC)).not.toMatch(/const RATE_MASTER_CONFIG_TARGETS\s*[:=]/);
  });
  it("the BoQ page's behaviour is unchanged by the move: same methods, same arguments, same SWR keys, same accumulate-once logic, same render", () => {
    const p = strip(PLUMBING_SRC);
    expect(p).toContain('"nirmaan_stack.api.boq.rate_master.get_rate_category_config"');
    expect(p).toContain("{ discipline, category_id: categoryId }");
    expect(p).toContain("`boq-rm-config::${discipline}::${categoryId}`");
    expect(p).toContain('"nirmaan_stack.api.boq.rate_master.get_rate_master_items"');
    expect(p).toContain('discipline: string = "Electrical"');
    expect(p).toContain("enabled ? `boq-rm-items-${discipline.toLowerCase()}` : null"); // "boq-rm-items-electrical" for the default
    expect(p).toContain("if (prev.has(categoryId)) return prev;");                       // load-once per category
    const page = strip(BOQ_PAGE_SRC);
    expect(page).toContain("useRateMasterItems(RATE_HELPER_ENABLED)");
    expect(page).toContain("const { configsByCategory, onConfigLoaded: handleRateConfigLoaded } = useConfigsByCategory();");
    expect(page).toContain("RATE_MASTER_CONFIG_TARGETS.map((t) => (");
    expect(page).toContain("onLoaded={handleRateConfigLoaded}");
    expect(page).toContain("makePricingSheetHelper({ configsByCategory, items: rmItems, extractionByRow })");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("Calculator slice 2 / a blank withholds the price; None prices", () => {
  const swsock = ASSET.category_configs.find((c) => c.category_id === "switches_sockets")!;
  const full = picksShownBy(inRunHelper((swsock.goldens ?? [])[0].attrs ?? {}).compute(rowCtx("switches_sockets")));
  it("POSITIVE: every field picked -> a price (with the sockets picked as None, a real answer)", () => {
    expect(full.socket2_item).toBe("None");
    const r = calculatorHelper().compute(calculatorCtx(DISCIPLINE, "switches_sockets"), full);
    if (!isSuggestion(r)) throw new Error("expected suggestion");
    expect(Object.keys(r.values).length).toBeGreaterThan(0);
    expect(r.workings.sections![0].figures).toEqual({ supply_rate: r.values.supply_rate, install_rate: r.values.install_rate, combined_rate: r.values.combined_rate });
  });
  it("⚠️ NEGATIVE: one genuine field left blank -> NO price, the shared refusal sentences, nothing invented", () => {
    const { colour: _omit, ...withoutColour } = full;
    const r = calculatorHelper().compute(calculatorCtx(DISCIPLINE, "switches_sockets"), withoutColour);
    if (!isSuggestion(r)) throw new Error("expected suggestion shape");
    expect(r.values).toEqual({});
    expect(r.basis).toBe("Fill the attributes to price");
    expect(r.workings.derivation).toEqual(["No extracted attributes -- fill them to compute a rate."]);
    expect(r.workings.sections).toBeUndefined();
    expect(r.workings.attributes.find((a) => a.id === "colour")!.value).toBe("");
  });
  it("⚠️ NEGATIVE: with NO picks at all every visible field is blank and the price is withheld", () => {
    const r = calculatorHelper().compute(calculatorCtx(DISCIPLINE, "switches_sockets"), {});
    if (!isSuggestion(r)) throw new Error("expected suggestion shape");
    expect(r.values).toEqual({});
    expect(r.workings.attributes.every((a) => a.value === "")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("Calculator slice 2 / the calculator constructs the helper with an EMPTY map and computes NOTHING itself", () => {
  const src = strip(CALC_SRC);
  it("the construction, verbatim", () => {
    expect(src).toContain("makePricingSheetHelper({ configsByCategory, items, extractionByRow: new Map() })");
    expect(src).toContain('variant="calculator"');
    expect(src).toContain("<RateHelperPanel");
  });
  it("⚠️ NEGATIVE: no second arithmetic -- no interpreter import, no figure read, no kind mapped, no number formatted", () => {
    expect(src).not.toContain("ratePipelineInterpreter");
    expect(src).not.toMatch(/runPipeline|groupFigures|kindForOutput|\.figures|\.values\[|toLocaleString|Intl\.NumberFormat/);
  });
  it("⚠️ NEGATIVE: it writes nothing -- no POST hook, no Use, no event, no lock, no BoQ read", () => {
    expect(src).not.toMatch(/useFrappePostCall|onUse=|record_rate_suggestion_event|acquire_pricing_lock|lock_sheet|save_cell_price|get_priced_rows|get_active_suggestion_run|useFrappeGetDoc/);
    // the panel's calculator variant renders no final-value field and no "Use this value"
    expect(strip(PANEL_SRC)).toContain("{!isCalculator && onUse && (");
    expect(strip(PANEL_SRC)).toContain('aria-label={isCalculator ? "Pricing calculator" : "Rate suggestions"}');
  });
  it("the sentinel row is DISTINCT per category (the panel's row-scoped edit state must not carry a pick across categories), and the ctx carries no text", () => {
    const rows = RATE_MASTER_DISCIPLINES[0].categories.map((c) => calculatorRowFor(DISCIPLINE, c.category_id));
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows.every((r) => r > 0)).toBe(true);
    expect(calculatorRowFor(DISCIPLINE, "no_such_category")).toBe(-1);
    const ctx = calculatorCtx(DISCIPLINE, "wiring_cabling");
    expect(ctx.description).toBe("");
    expect(ctx.category).toBe("wiring_cabling");
    expect(ctx.rateKinds).toEqual(["supply_rate", "install_rate", "combined_rate"]);
    expect(CALCULATOR_COL).toBe("calculator");
    expect(CALCULATOR_KIND).toBe("supply_rate");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("Calculator slice 2 / the PARKED split-pipeline shape is REPRODUCED, not fixed", () => {
  // PARKED BY RULING, owner 2026-09-09: "let it be for now. we will change this latr if it becomes
  // too much of an irritant... we will fix both calvulator and helper later together". The owner's
  // corrected intent is ONE line per THING PRICED (cable and termination are two things; a category's
  // supply and install halves are one thing). Until both surfaces move together, the calculator must
  // show what the panel shows: on point_wiring / cabletray_raceway / industrial_sockets two blocks
  // each carrying ONE figure and two em dashes. THE DAY THIS IS FIXED, THIS PIN MOVES WITH IT.
  for (const category of ["cabletray_raceway", "point_wiring", "industrial_sockets"]) {
    it(`${category}: two sections, each with exactly ONE figure -- identical on the in-run row and on the calculator`, () => {
      const c = ASSET.category_configs.find((x) => x.category_id === category)!;
      const g = (c.goldens ?? [])[0];
      const A = inRunHelper(g.attrs ?? {}).compute(rowCtx(category));
      const B = calculatorHelper().compute(calculatorCtx(DISCIPLINE, category), picksShownBy(A));
      if (!isSuggestion(A) || !isSuggestion(B)) throw new Error("expected suggestions");
      expect(Object.keys(A.values).length).toBeGreaterThan(0); // the golden prices
      const fa = figuresOf(A)!, fb = figuresOf(B)!;
      expect(fa).toHaveLength(2);
      expect(fb).toEqual(fa);
      for (const f of fb) expect(Object.keys(f ?? {}).length).toBe(1); // one figure, two dashes -- PARKED
      expect(Object.keys(fb[0]!)).toEqual(["supply_rate"]);
      expect(Object.keys(fb[1]!)).toEqual(["install_rate"]);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("Calculator slice 2 / the tab", () => {
  it("the tab exists only on the workbook page that has a calculator discipline", () => {
    expect(CALCULATOR_WORKBOOKS).toEqual({ "/electrical-pricing": "Electrical" });
    expect(calculatorDisciplineForPath("/electrical-pricing")).toBe("Electrical");
    expect(calculatorDisciplineForPath("/electrical-pricing/")).toBe("Electrical");
    expect(calculatorDisciplineForPath("/hvac-pricing")).toBeNull();
    expect(calculatorDisciplineForPath("/elv-pricing")).toBeNull();
    expect(calculatorDisciplineForPath("")).toBeNull();
  });
  it("(source) switching UNMOUNTS the sheet by conditional render -- its existing unmount cleanup releases the lock -- with NO warning and no new release path", () => {
    const src = strip(PAGE_SRC);
    expect(src).toMatch(/tab === "sheet" \? \(\s*<PricingWorkbookSheet inTabs \/>\s*\) : \(\s*<PricingCalculator discipline=\{calculatorDiscipline\} \/>\s*\)/);
    expect(src).toContain("onClick={() => setTab(t.id)}");        // the switch is the click, nothing in between
    expect(src).not.toMatch(/confirm\(/);                            // no browser confirm on the switch
    expect(src).toContain("if (!calculatorDiscipline) return <PricingWorkbookSheet />;"); // HVAC / ELV untouched
    // the release path is the ORIGINAL unmount cleanup, untouched
    expect(src).toContain("releaseBeacon();");
    expect(src).toContain("destroySheet();");
    expect((src.match(/\.release`/g) ?? []).length).toBe(2);         // the SDK hook + the beacon, as before -- no third
  });
});
