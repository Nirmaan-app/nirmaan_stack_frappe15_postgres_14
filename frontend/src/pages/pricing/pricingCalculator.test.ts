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
// SLICE 2 (2026-09-22): the HVAC asset -- ADP (data-only) + the four vendor-quote MESSAGE-ONLY configs.
import HVAC_ASSET_V3 from "../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v3.json";
// SLICE 3 (2026-09-22): HVAC v4 = v3 + the two ALIAS configs (hvac_cables -> wiring_cabling, hvac_raceway -> cabletray_raceway).
import HVAC_ASSET_V4 from "../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v4.json";
import type { RateCategoryConfig, RateMasterItem } from "./rate-master/rateMasterTypes";
import { RATE_MASTER_DISCIPLINES, rateMasterPageEntry } from "./rate-master/rateMasterRegistry";
import { RATE_MASTER_CONFIG_TARGETS } from "@/pages/boq-wizard/rate-helper/rateHelperPlumbing";
import { buildExtractionByRow, COMING_SOON_REASON, makePricingSheetHelper, resolveAliasConfig } from "@/pages/boq-wizard/rate-helper/pricingSheetHelper";
import { attrDisplayValue, isSuggestion, type ExtractionRow, type RateHelperRowContext } from "@/pages/boq-wizard/rate-helper/rateHelperTypes";
import {
  CALCULATOR_COL,
  CALCULATOR_KIND,
  CALCULATOR_WORKBOOKS,
  calculatorCtx,
  calculatorDisciplineForPath,
  calculatorRowFor,
  aliasTargetConfigs,
  aliasTargetDisciplines,
  mergeItemsByName,
  COLUMN_BANDS,
  WIDTH_COLUMN_CAPS,
  blockColumnsFor,
  calculatorBlockLabels,
  columnsFor,
  maxColumnsForFields,
  maxColumnsForWidth,
  visibleFieldIds,
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
    // 12 Electrical + 7 HVAC (`hvac_adp` slice 1b; four vendor-quote message-only categories slice 2;
    // the two ALIAS categories slice 3, 2026-09-22): the targets flatten EVERY registry discipline
    // INCLUDING `holds_items: false` entries (they must be FETCHED), so slice 3 moves this by exactly
    // two (17 -> 19). Re-pinned under owner ruling L7.
    expect(RATE_MASTER_CONFIG_TARGETS.length).toBe(19);
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
    // SLICE 2 (owner P-a, inverting the calculator-slice pin): HVAC has a rate master since slice 1b
    // and now gets the tab; ELV still has none and still gets no tab.
    expect(CALCULATOR_WORKBOOKS).toEqual({ "/electrical-pricing": "Electrical", "/hvac-pricing": "HVAC" });
    expect(calculatorDisciplineForPath("/electrical-pricing")).toBe("Electrical");
    expect(calculatorDisciplineForPath("/electrical-pricing/")).toBe("Electrical");
    expect(calculatorDisciplineForPath("/hvac-pricing")).toBe("HVAC");
    expect(calculatorDisciplineForPath("/hvac-pricing/")).toBe("HVAC");
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CALCULATOR LAYOUT SLICE (owner 2026-09-09) -- LAYOUT ONLY. The render cannot be tested here (no DOM);
// these pins hold the DATA the layout consumes: the block count known before pricing, the field order
// handed to the columns, the column bands, and the BoQ panel's untouched path.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("Calculator layout / the price blocks are known BEFORE any field is answered", () => {
  for (const c of ASSET.category_configs) {
    it(`${c.category_id}: the block labels from the config equal the priced section labels, golden by golden`, () => {
      const before = calculatorBlockLabels(c);
      expect(before.length).toBeGreaterThan(0);
      for (const g of c.goldens ?? []) {
        const A = inRunHelper(g.attrs ?? {}).compute(rowCtx(c.category_id));
        const V = picksShownBy(A);
        const R = calculatorHelper().compute(calculatorCtx(DISCIPLINE, c.category_id), V);
        if (!isSuggestion(R) || !R.workings.sections) continue; // a golden that refuses has no sections
        expect(R.workings.sections.map((s) => s.label)).toEqual(before);
      }
    });
  }
  it("one priced line renders ONE block; wiring renders TWO; the split categories two -- and the count is the non-BCS pipeline count", () => {
    const counts = Object.fromEntries(ASSET.category_configs.map((c) => [c.category_id, calculatorBlockLabels(c).length]));
    expect(counts).toEqual({
      cabletray_raceway: 2, conduit_piping: 1, db_switchgear: 2, earthing: 1, industrial_sockets: 2, junction_box_raceway: 1,
      lighting_mgmt_system: 1, miscellaneous: 1, point_wiring: 2, popup_boxes: 1, switches_sockets: 1, wiring_cabling: 2,
    });
    expect(calculatorBlockLabels(CONFIGS.get("wiring_cabling")!)).toEqual(["Cable — per Mtr", "Termination — per Set"]);
    // NEGATIVE: no live category has more than two blocks, so the wrap row cannot be shown on live data
    expect(Math.max(...Object.values(counts))).toBe(2);
  });
  it("⚠️ NEGATIVE: with NO picks the helper publishes NO sections -- the empty blocks come from the config, never from a computed result", () => {
    const r = calculatorHelper().compute(calculatorCtx(DISCIPLINE, "point_wiring"), {});
    if (!isSuggestion(r)) throw new Error("expected suggestion shape");
    expect(r.workings.sections).toBeUndefined();
    expect(calculatorBlockLabels(CONFIGS.get("point_wiring")!)).toEqual(["Point Wiring — Supply", "Point Wiring — Install"]);
  });
});

describe("Calculator layout / the field ORDER handed to the columns is the panel's own render order", () => {
  for (const c of ASSET.category_configs) {
    it(`${c.category_id}: visibleFieldIds == the ids the helper renders, in order (\"split as per order\")`, () => {
      const r = calculatorHelper().compute(calculatorCtx(DISCIPLINE, c.category_id), {});
      if (!isSuggestion(r)) throw new Error("expected suggestion shape");
      expect(visibleFieldIds(c)).toEqual(r.workings.attributes.map((a) => a.id));
    });
  }
  it("the measured visible field count per category (2026-09-09), the distribution the bands were chosen from", () => {
    const counts = Object.fromEntries(ASSET.category_configs.map((c) => [c.category_id, visibleFieldIds(c).length]));
    expect(counts).toEqual({
      cabletray_raceway: 8, conduit_piping: 2, db_switchgear: 14, earthing: 3, industrial_sockets: 5, junction_box_raceway: 1,
      lighting_mgmt_system: 2, miscellaneous: 1, point_wiring: 27, popup_boxes: 17, switches_sockets: 17, wiring_cabling: 8,
    });
    // NEGATIVE: hidden facts are NOT fields -- industrial_sockets carries 9 defs, 4 of them panel:false
    expect((CONFIGS.get("industrial_sockets")!.attribute_definitions ?? []).length).toBe(9);
  });
});

describe("Calculator layout / the column rule -- content sets the maximum, width may only reduce it", () => {
  it("the bands as a table, one case per band plus every boundary", () => {
    const wide = 1600;
    const table: Array<[number, 1 | 2 | 3]> = [
      [0, 1], [1, 1], [2, 1], [3, 1], [4, 1],      // <= 4 fields: one column
      [5, 2], [8, 2], [12, 2],                     // 5..12: two
      [13, 3], [14, 3], [17, 3], [27, 3], [99, 3], // >= 13: three
    ];
    for (const [n, cols] of table) expect(columnsFor(n, wide), `${n} fields`).toBe(cols);
    expect(COLUMN_BANDS.map((b) => [b.maxFields, b.columns])).toEqual([[4, 1], [12, 2], [Number.POSITIVE_INFINITY, 3]]);
  });
  it("the twelve live categories land in these bands: five at one column, three at two, four at three", () => {
    const at = (cols: number) => ASSET.category_configs.filter((c) => columnsFor(visibleFieldIds(c).length, 1600) === cols).map((c) => c.category_id).sort();
    expect(at(1)).toEqual(["conduit_piping", "earthing", "junction_box_raceway", "lighting_mgmt_system", "miscellaneous"]);
    expect(at(2)).toEqual(["cabletray_raceway", "industrial_sockets", "wiring_cabling"]);
    expect(at(3)).toEqual(["db_switchgear", "point_wiring", "popup_boxes", "switches_sockets"]);
  });
  it("⚠️ NEGATIVE: width can only REDUCE the column count, never raise it", () => {
    // a three-column category folds 3 -> 2 -> 1 as the width shrinks
    expect(columnsFor(27, 1600)).toBe(3);
    expect(columnsFor(27, 1024)).toBe(3);
    expect(columnsFor(27, 1023)).toBe(2);
    expect(columnsFor(27, 640)).toBe(2);
    expect(columnsFor(27, 639)).toBe(1);
    // a two-column category never becomes three, however wide
    for (const w of [640, 1024, 1600, 4000, Number.POSITIVE_INFINITY]) expect(columnsFor(8, w)).toBeLessThanOrEqual(2);
    for (const w of [0, 320, 639, 640, 1023, 1024, 1600, 4000]) expect(columnsFor(8, w)).toBe(Math.min(2, maxColumnsForWidth(w)));
    // the rule IS min(content, width)
    for (const n of [1, 5, 13]) for (const w of [0, 700, 1200]) expect(columnsFor(n, w)).toBe(Math.min(maxColumnsForFields(n), maxColumnsForWidth(w)));
  });
  it("⚠️ NEGATIVE: a one-field category gets one column at ANY width", () => {
    for (const w of [0, 320, 640, 1024, 1600, 4000, Number.POSITIVE_INFINITY]) expect(columnsFor(1, w)).toBe(1);
    expect(columnsFor(visibleFieldIds(CONFIGS.get("junction_box_raceway")!).length, 4000)).toBe(1);
  });
  it("the width caps are Tailwind's sm / lg edges, and the two-per-row blocks fold to one at the SAME width the fields fold to one column", () => {
    expect(WIDTH_COLUMN_CAPS.map((c) => [c.minWidth, c.columns])).toEqual([[1024, 3], [640, 2], [0, 1]]);
    for (const w of [640, 1024, 1600, 4000]) expect(blockColumnsFor(w)).toBe(2);
    for (const w of [0, 320, 639]) expect(blockColumnsFor(w)).toBe(1);
    // NEGATIVE: never more than two blocks per row, however wide (owner: "1*2 grid per row")
    expect(blockColumnsFor(Number.POSITIVE_INFINITY)).toBe(2);
    expect(strip(PANEL_SRC)).toContain("repeat(${Math.max(1, blockColumns ?? 2)}, minmax(0, 1fr))");
  });
});

describe("Calculator layout / the BoQ panel is UNCHANGED -- the layout lives behind the calculator variant", () => {
  const panel = strip(PANEL_SRC);
  it("the two new props are read only under isCalculator, and the BoQ page passes neither", () => {
    expect(panel).toContain("calculatorBlocks?: string[];");
    expect(panel).toContain("fieldColumns?: number;");
    expect(panel).toContain("blockColumns?: number;");
    expect(panel).toContain("if (isCalculator && calculatorBlocks && calculatorBlocks.length > 0) {");
    expect(panel).toContain("style={isCalculator ? { gridTemplateColumns:");
    expect(strip(BOQ_PAGE_SRC)).not.toMatch(/calculatorBlocks|fieldColumns|blockColumns/);
  });
  it("⚠️ NEGATIVE: every BoQ class string the layout touched is still present verbatim as the non-calculator branch", () => {
    for (const cls of [
      '"space-y-2 border-t px-3 py-2"',                        // the card body
      '"space-y-1.5"',                                          // the attributes list and the sections list
      '"flex items-center justify-between gap-2 text-xs"',      // label-left / box-right
      '"h-7 w-28 text-xs disabled:opacity-50"',                 // the number input
      '"flex items-center gap-1"',                              // the number span
      '"flex items-center gap-2 pt-1"',                         // the Use / Revert row
    ]) expect(panel, cls).toContain(cls);
    // and each calculator branch is a ternary on isCalculator, never an unconditional replacement
    expect((panel.match(/isCalculator \?/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });
  it("⚠️ NEGATIVE: ONE section renderer -- placeholder blocks reuse it; no second figure render anywhere", () => {
    expect(panel).toContain("const renderSection = (g: WorkingsGroup, gi: number) =>");
    expect((panel.match(/DISPLAY_RATE_KINDS\.map/g) ?? []).length).toBe(1);
    expect((panel.match(/<CopyFigureButton /g) ?? []).length).toBe(1);
    expect(panel).toContain("renderSection({ label, derivation: [], finals: {}, figures: {} }, gi)");
    expect(strip(CALC_SRC)).not.toMatch(/DISPLAY_RATE_KINDS\.map|CopyFigureButton|kindLabel\(/);
  });
  it("the helper output is untouched by the layout: the same picks give the same values (the engine did not move)", () => {
    const c = ASSET.category_configs.find((x) => x.category_id === "switches_sockets")!;
    const A = inRunHelper((c.goldens ?? [])[0].attrs ?? {}).compute(rowCtx("switches_sockets"));
    const B = calculatorHelper().compute(calculatorCtx(DISCIPLINE, "switches_sockets"), picksShownBy(A));
    if (!isSuggestion(A) || !isSuggestion(B)) throw new Error("expected suggestions");
    expect(B.values).toEqual(A.values);
    expect(figuresOf(B)).toEqual(figuresOf(A));
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 2 (2026-09-22) -- the HVAC calculator and the registry's fetch-but-do-not-list flag (owner
// rulings P-a / P-b / P-d, R1). The four vendor-quote categories are DATA: their message lives in
// the config (`helper_message`), the registry only says "no items" (`holds_items: false`).
describe("SLICE 2 / HVAC calculator: ADP coming soon, the four vendor-quote categories say what their config says", () => {
  const HVAC = HVAC_ASSET_V3 as unknown as { category_configs: RateCategoryConfig[]; items: RateMasterItem[] };
  const HVAC_CONFIGS = new Map<string, RateCategoryConfig>(HVAC.category_configs.map((c) => [c.category_id, c]));
  const hvacHelper = () => makePricingSheetHelper({ configsByCategory: HVAC_CONFIGS, items: HVAC.items, extractionByRow: new Map() });
  const hvacEntry = RATE_MASTER_DISCIPLINES.find((d) => d.discipline === "HVAC")!;
  // SLICE 3: the vendor-quote entries are the `holds_items: false` entries whose CONFIG carries a message
  // (the two alias entries are `holds_items: false` too, but their config carries `alias_of` instead).
  const noItems = hvacEntry.categories.filter((c) => c.holds_items === false).map((c) => c.category_id);
  const vendor = noItems.filter((id) => typeof HVAC_CONFIGS.get(id)?.helper_message === "string");

  it("the registry lists seven HVAC categories: ADP holds items, the four vendor-quote and the two alias ones do not", () => {
    expect(hvacEntry.categories.map((c) => c.category_id)).toEqual(["hvac_adp", ...noItems]);
    expect(noItems).toHaveLength(6);
    expect(vendor).toHaveLength(4);
    // every vendor entry's CONFIG carries the two messages -- the registry names no message
    for (const id of vendor) {
      const cfg = HVAC_CONFIGS.get(id)!;
      expect(typeof cfg.helper_message).toBe("string");
      expect(typeof cfg.pending_label).toBe("string");
      expect(Object.keys(cfg.pipelines)).toHaveLength(0);
      expect(cfg.attribute_definitions).toHaveLength(0);
    }
  });
  it("the four are FETCHED (in the config targets) so the helper can read their messages", () => {
    for (const id of vendor) expect(RATE_MASTER_CONFIG_TARGETS).toContainEqual({ discipline: "HVAC", categoryId: id });
  });
  it("⚠️ NEGATIVE: the Rate Master page's view of HVAC drops the four; Electrical's view is the SAME object", () => {
    const pageHvac = rateMasterPageEntry(hvacEntry);
    expect(pageHvac.categories.map((c) => c.category_id)).toEqual(["hvac_adp"]);
    const electrical = RATE_MASTER_DISCIPLINES[0];
    expect(electrical.discipline).toBe("Electrical");
    expect(rateMasterPageEntry(electrical)).toBe(electrical);        // reference-identical
    expect(electrical.categories).toHaveLength(12);                   // unchanged
    expect(electrical.categories.some((c) => c.holds_items === false)).toBe(false);
    expect(rateMasterPageEntry(undefined)).toBeUndefined();
  });
  it("(source) the Rate Master page reads the registry ONLY through rateMasterPageEntry; the calculator picker reads the full list", () => {
    const page = strip(readFileSync(join(__dirname, "rate-master", "RateMasterPage.tsx"), "utf8"));
    expect(page).toContain("rateMasterPageEntry(RATE_MASTER_DISCIPLINES.find((d) => d.discipline === disciplineId) ?? RATE_MASTER_DISCIPLINES[0])");
    expect(page.match(/RATE_MASTER_DISCIPLINES\.find\(/g) ?? []).toHaveLength(1);
    expect(strip(CALC_SRC)).toContain("(entry?.categories ?? []).map((c) => {");
    expect(strip(CALC_SRC)).not.toContain("rateMasterPageEntry");
  });
  it("the HVAC calculator: each vendor-quote category declines with ITS CONFIG's helper_message; ADP declines coming soon", () => {
    for (const id of vendor) {
      const r = hvacHelper().compute(calculatorCtx("HVAC", id));
      expect(r.kind).toBe("none");
      if (r.kind === "none") expect(r.reason).toBe(HVAC_CONFIGS.get(id)!.helper_message);
      expect(calculatorRowFor("HVAC", id)).toBeGreaterThan(0);        // a real sentinel row, not -1
    }
    const adp = hvacHelper().compute(calculatorCtx("HVAC", "hvac_adp"));
    expect(adp.kind).toBe("none");
    if (adp.kind === "none") expect(adp.reason).toBe(COMING_SOON_REASON);
    expect(calculatorBlockLabels(HVAC_CONFIGS.get("hvac_ahu")!)).toEqual([]);
    expect(visibleFieldIds(HVAC_CONFIGS.get("hvac_ahu")!)).toEqual([]);
  });
  it("⚠️ NEGATIVE: the Electrical calculator is untouched -- 34 goldens, 12 categories, no HVAC id in its entry", () => {
    const electrical = RATE_MASTER_DISCIPLINES[0];
    expect(electrical.categories.some((c) => c.category_id.startsWith("hvac_"))).toBe(false);
    let n = 0;
    for (const c of ASSET.category_configs) n += (c.goldens ?? []).length;
    expect(n).toBe(34);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 3 (2026-09-22, owner Q-a / Q-b / L6 / L7) -- HVAC Cables and Raceway are ALIASES of Electrical's
// wiring_cabling and cabletray_raceway: stored once, resolved at lookup, never copied. The calculator
// merges the alias TARGET discipline's items behind its own; the SAME picks give the SAME figures.
describe("SLICE 3 / HVAC Cables and Raceway price EXACTLY as Electrical wiring and tray", () => {
  const HVAC4 = HVAC_ASSET_V4 as unknown as { category_configs: RateCategoryConfig[]; items: RateMasterItem[] };
  // ONE config map, as the calculator's accumulate-once map holds it once every fetch has landed: the
  // HVAC configs (alias included) AND the Electrical ones (the alias targets), keyed by category id.
  const MERGED_CONFIGS = new Map<string, RateCategoryConfig>([
    ...ASSET.category_configs.map((c) => [c.category_id, c] as const),
    ...HVAC4.category_configs.map((c) => [c.category_id, c] as const),
  ]);
  const MERGED_ITEMS = mergeItemsByName(HVAC4.items, ITEMS);
  const mergedHelper = () => makePricingSheetHelper({ configsByCategory: MERGED_CONFIGS, items: MERGED_ITEMS, extractionByRow: new Map() });
  const ALIASES: Array<[string, string]> = HVAC4.category_configs
    .filter((c) => c.alias_of)
    .map((c) => [c.category_id, c.alias_of!.category_id]);

  it("the v4 asset carries exactly two alias configs, each pointing at an EXISTING Electrical category, with nothing of their own", () => {
    expect(ALIASES).toEqual([["hvac_cables", "wiring_cabling"], ["hvac_raceway", "cabletray_raceway"]]);
    for (const c of HVAC4.category_configs.filter((x) => x.alias_of)) {
      expect(c.alias_of!.discipline).toBe("Electrical");
      expect(ASSET.category_configs.some((e) => e.category_id === c.alias_of!.category_id)).toBe(true);
      expect(Object.keys(c.pipelines)).toHaveLength(0);
      expect(c.attribute_definitions).toHaveLength(0);
      expect(c.item_kinds).toEqual([]);
    }
    // the two are in the registry (fetched, calculator-listed) with holds_items: false
    const hvacEntry = RATE_MASTER_DISCIPLINES.find((d) => d.discipline === "HVAC")!;
    for (const [own] of ALIASES) {
      expect(hvacEntry.categories.find((c) => c.category_id === own)?.holds_items).toBe(false);
      expect(RATE_MASTER_CONFIG_TARGETS).toContainEqual({ discipline: "HVAC", categoryId: own });
    }
    expect(rateMasterPageEntry(hvacEntry).categories.map((c) => c.category_id)).toEqual(["hvac_adp"]);
  });

  for (const [own, target] of ALIASES) {
    const goldens = (ASSET.category_configs.find((c) => c.category_id === target)!.goldens ?? []) as Golden[];
    it(`${own} -> ${target}: the layout reads resolve to the TARGET config`, () => {
      expect(resolveAliasConfig(MERGED_CONFIGS, own)).toBe(MERGED_CONFIGS.get(target));
      expect(calculatorBlockLabels(resolveAliasConfig(MERGED_CONFIGS, own)!)).toEqual(calculatorBlockLabels(MERGED_CONFIGS.get(target)!));
      expect(visibleFieldIds(resolveAliasConfig(MERGED_CONFIGS, own)!)).toEqual(visibleFieldIds(MERGED_CONFIGS.get(target)!));
      expect(calculatorRowFor("HVAC", own)).toBeGreaterThan(0);
    });
    for (const golden of goldens) {
      it(`${own} / ${golden.id ?? "?"}: the SAME picks give the SAME values, headlines and figures as ${target} (asserted equal)`, () => {
        const E = mergedHelper().compute(calculatorCtx("Electrical", target), golden.attrs ? Object.fromEntries(Object.entries(golden.attrs).map(([k, v]) => [k, String(v)])) : {});
        const H = mergedHelper().compute(calculatorCtx("HVAC", own), golden.attrs ? Object.fromEntries(Object.entries(golden.attrs).map(([k, v]) => [k, String(v)])) : {});
        expect(H.kind).toBe(E.kind);
        if (!isSuggestion(E) || !isSuggestion(H)) throw new Error("expected suggestions on both sides");
        expect(Object.keys(E.values).length).toBeGreaterThan(0);   // a real price, not a refusal on both sides
        expect(H.values).toEqual(E.values);
        expect(headlinesOf(H)).toEqual(headlinesOf(E));
        expect(figuresOf(H)).toEqual(figuresOf(E));
        expect(H.workings.attributes.map((a) => a.id)).toEqual(E.workings.attributes.map((a) => a.id));
      });
    }
  }

  it("the calculator fetches each alias TARGET's CONFIG too -- its own map holds HVAC configs only, so without this the resolver finds no target (the M1 defect)", () => {
    const hvacOnlyMap = new Map<string, RateCategoryConfig>(HVAC4.category_configs.map((c) => [c.category_id, c]));
    expect(aliasTargetConfigs(hvacOnlyMap)).toEqual([
      { discipline: "Electrical", categoryId: "cabletray_raceway" },
      { discipline: "Electrical", categoryId: "wiring_cabling" },
    ]);
    expect(aliasTargetConfigs(CONFIGS)).toEqual([]);                         // Electrical aliases nowhere
    // NEGATIVE, the defect itself: with HVAC configs alone the alias cannot resolve and declines coming soon
    expect(resolveAliasConfig(hvacOnlyMap, "hvac_cables")).toBe(hvacOnlyMap.get("hvac_cables"));
    const r = makePricingSheetHelper({ configsByCategory: hvacOnlyMap, items: MERGED_ITEMS, extractionByRow: new Map() }).compute(calculatorCtx("HVAC", "hvac_cables"));
    expect(r).toEqual({ kind: "none", reason: COMING_SOON_REASON });
    // once the target config lands (the extra fetch), it resolves and prices
    hvacOnlyMap.set("wiring_cabling", CONFIGS.get("wiring_cabling")!);
    expect(resolveAliasConfig(hvacOnlyMap, "hvac_cables")).toBe(CONFIGS.get("wiring_cabling"));
    const src = strip(CALC_SRC);
    expect(src).toContain("const aliasConfigTargets = useMemo(() => aliasTargetConfigs(configsByCategory), [configsByCategory]);");
    expect(src).toContain("{aliasConfigTargets.map((t) => (");
    expect(src).toContain("key={`calc-alias-cfg-${t.discipline}-${t.categoryId}`}");
  });

  it("⚠️ NEGATIVE: an HVAC-only category sees only HVAC items, and a config map without aliases fetches no extra discipline", () => {
    expect(aliasTargetDisciplines(MERGED_CONFIGS, "HVAC")).toEqual(["Electrical"]);
    expect(aliasTargetDisciplines(MERGED_CONFIGS, "Electrical")).toEqual([]);       // Electrical aliases nowhere
    expect(aliasTargetDisciplines(CONFIGS, "Electrical")).toEqual([]);
    const hvacOnly = mergeItemsByName(HVAC4.items);
    // asset items carry no `discipline` (the loader stamps it); the KIND prefix is the discipline's mark
    expect(hvacOnly.every((i) => i.kind.startsWith("hvac_"))).toBe(true);
    expect(hvacOnly.some((i) => i.kind === "cable" || i.kind === "cable_tray")).toBe(false);
    expect(hvacOnly).toHaveLength(95);
    const adp = makePricingSheetHelper({ configsByCategory: MERGED_CONFIGS, items: hvacOnly, extractionByRow: new Map() }).compute(calculatorCtx("HVAC", "hvac_adp"));
    expect(adp.kind).toBe("none");   // ADP is still data-only: coming soon, whatever items are loaded
  });

  it("mergeItemsByName: own discipline first, then the targets, DEDUPED BY NAME -- first occurrence wins (pinned so a future collision is loud)", () => {
    const a: RateMasterItem = { name: "X-1", discipline: "HVAC", kind: "k", attributes: { a: 1 }, rates: { r: 1 } } as RateMasterItem;
    const b: RateMasterItem = { name: "X-1", discipline: "Electrical", kind: "k", attributes: { a: 2 }, rates: { r: 2 } } as RateMasterItem;
    const c: RateMasterItem = { name: "X-2", discipline: "Electrical", kind: "k", attributes: { a: 3 }, rates: { r: 3 } } as RateMasterItem;
    const merged = mergeItemsByName([a], [b, c]);
    expect(merged).toEqual([a, c]);             // b (same name as a) is DROPPED; a (own discipline) wins
    expect(mergeItemsByName([b, c], [a])).toEqual([b, c]);
    // nothing is dropped between the two assets (asset items carry no `name` -- the live endpoint's rows do --
    // so the fallback key discipline/kind/uid-or-attributes is what keeps them apart here)
    expect(MERGED_ITEMS).toHaveLength(HVAC4.items.length + ITEMS.length);
  });

  it("(source) the calculator resolves its layout config through resolveAliasConfig and mounts one items fetch per alias target discipline; plumbing untouched", () => {
    const src = strip(CALC_SRC);
    expect(src).toContain("const config = categoryId ? resolveAliasConfig(configsByCategory, categoryId) : null;");
    expect(src).toContain("aliasDisciplines.map((d) => (");
    expect(src).toContain("<RateItemsFetcher key={`calc-items-${d}`} discipline={d} onLoaded={onExtraItemsLoaded} />");
    expect(src).toContain("mergeItemsByName(ownItems, ...aliasDisciplines.map((d) => extraItems.get(d) ?? []))");
    expect(strip(PLUMBING_SRC)).not.toContain("alias");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 6 (2026-09-24, owner S5 / T6 / T7) -- the HVAC calculator prices ADP the same way as the panel, starting
// empty; ADP is live on the CURRENT asset (v8); Electrical is untouched.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
import HVAC_ASSET_V8 from "../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v8.json";
import HVAC_ASSET_V9 from "../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v9.json";
import { applyItemEdit, ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, type ItemListSuggestion } from "@/pages/boq-wizard/rate-helper/pricingSheetHelper";

describe("SLICE 6 / the HVAC calculator prices ADP (v8) -- one item block per added item, the same figures as the panel", () => {
  const HVAC8 = HVAC_ASSET_V8 as unknown as { category_configs: RateCategoryConfig[]; items: RateMasterItem[] };
  const CONFIGS8 = new Map<string, RateCategoryConfig>(HVAC8.category_configs.map((c) => [c.category_id, c]));
  const helper8 = () => makePricingSheetHelper({ configsByCategory: CONFIGS8, items: HVAC8.items, extractionByRow: new Map() });
  it("no placeholder block is announced for a list-mode category; the vendor and alias entries are as before", () => {
    expect(calculatorBlockLabels(CONFIGS8.get("hvac_adp")!)).toEqual([]);
    expect(calculatorBlockLabels(CONFIGS8.get("hvac_ahu")!)).toEqual([]);
    // NEGATIVE: an Electrical category still announces its blocks
    expect(calculatorBlockLabels(CONFIGS.get("switches_sockets")!).length).toBeGreaterThan(0);
  });
  it("ADP starts EMPTY ('Add an item to price'), the row unit is a pick, an added and filled item prices EXACTLY as the panel prices the same inputs", () => {
    const r0 = helper8().compute(calculatorCtx("HVAC", "hvac_adp"));
    if (!isSuggestion(r0)) throw new Error("expected a suggestion");
    const v0 = (r0 as ItemListSuggestion).itemList!;
    expect(r0.basis).toBe("Add an item to price");
    expect(v0.items).toEqual([]);
    expect(v0.unitPickable).toBe(true);
    // + Add item -> spigot 150 per number
    const s = applyItemEdit(applyItemEdit(v0.editState, { op: "add", family: "spigot" }), { op: "set_attr", index: 0, id: "dia_mm", value: "150" });
    const r1 = helper8().compute(calculatorCtx("HVAC", "hvac_adp"), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(s), [ROW_UNIT_OVERRIDE_KEY]: "nos" });
    if (!isSuggestion(r1)) throw new Error("expected a suggestion");
    expect(r1.values).toEqual({ supply_rate: 211, install_rate: 64, combined_rate: 275 });
    // THE PARITY: a BoQ row in a run with the same item gives the same figures
    const inRun = makePricingSheetHelper({
      configsByCategory: CONFIGS8, items: HVAC8.items,
      extractionByRow: buildExtractionByRow([{ excel_row: 40, attributes: {}, items: [{ attributes: { family: { value: "spigot", confidence: 0.9 }, dia_mm: { value: "150", confidence: 0.9 } } }] }]),
    }).compute({ excelRow: 40, description: "spigot", nodeType: "Line Item", category: "hvac_adp", discipline: "HVAC", rateKinds: ["supply_rate", "install_rate"], unit: "Nos" } as RateHelperRowContext);
    if (!isSuggestion(inRun)) throw new Error("expected a suggestion");
    expect(inRun.values).toEqual(r1.values);
  });
  it("NEGATIVE: the vendor-quote categories still decline with their message; the Electrical calculator's 34 goldens are untouched (the parity suite above)", () => {
    for (const id of ["hvac_ahu", "hvac_dx_unit", "hvac_panels", "hvac_pumps"]) {
      const r = helper8().compute(calculatorCtx("HVAC", id));
      expect(r).toEqual({ kind: "none", reason: CONFIGS8.get(id)!.helper_message });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 6b (2026-09-24, owner V1 / U5) -- the HVAC calculator gets the same controls as the panel (one shared
// view), the same options from the SKUs, and the same figures for the same picks under v9.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("SLICE 6b / the HVAC calculator under v9 -- dropdowns from the SKUs, the same figures as the panel", () => {
  const HVAC9 = HVAC_ASSET_V9 as unknown as { category_configs: RateCategoryConfig[]; items: RateMasterItem[] };
  const CONFIGS9 = new Map<string, RateCategoryConfig>(HVAC9.category_configs.map((c) => [c.category_id, c]));
  const helper9 = () => makePricingSheetHelper({ configsByCategory: CONFIGS9, items: HVAC9.items, extractionByRow: new Map() });
  it("an added disc valve shows Diameter as a DROPDOWN with the sheet's sizes; picking 150 prices 653 / 176 exactly as an in-run panel row", () => {
    const r0 = helper9().compute(calculatorCtx("HVAC", "hvac_adp"));
    const v0 = (r0 as ItemListSuggestion).itemList!;
    const s = applyItemEdit(v0.editState, { op: "add", family: "disc valve" });
    const r1 = helper9().compute(calculatorCtx("HVAC", "hvac_adp"), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(s), [ROW_UNIT_OVERRIDE_KEY]: "nos" });
    const v1 = (r1 as ItemListSuggestion).itemList!;
    expect(v1.items[0].fields.map((f) => [f.id, f.control, f.options])).toEqual([["dia_mm", "dropdown", ["100", "150"]]]);
    expect(v1.items[0]).toMatchObject({ state: "blank", reason: "no diameter stated" });
    const s2 = applyItemEdit(s, { op: "set_attr", index: 0, id: "dia_mm", value: "150" });
    const r2 = helper9().compute(calculatorCtx("HVAC", "hvac_adp"), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(s2), [ROW_UNIT_OVERRIDE_KEY]: "nos" });
    expect((r2 as ItemListSuggestion).values).toEqual({ supply_rate: 653, install_rate: 176, combined_rate: 829 });
    const inRun = makePricingSheetHelper({
      configsByCategory: CONFIGS9, items: HVAC9.items,
      extractionByRow: buildExtractionByRow([{ excel_row: 40, attributes: {}, items: [{ attributes: { family: { value: "disc valve", confidence: 0.9 }, dia_mm: { value: "150", confidence: 0.9 } } }] }]),
    }).compute({ excelRow: 40, description: "disc valve", nodeType: "Line Item", category: "hvac_adp", discipline: "HVAC", rateKinds: ["supply_rate", "install_rate"], unit: "Nos" } as RateHelperRowContext);
    expect((inRun as ItemListSuggestion).values).toEqual((r2 as ItemListSuggestion).values);
    expect((inRun as ItemListSuggestion).itemList!.items[0].fields[0].options).toEqual(["100", "150"]);
  });
  it("NEGATIVE: a BoQ measurement is text in the calculator too; the vendor-quote categories still decline; the Electrical calculator is untouched", () => {
    const s = applyItemEdit((helper9().compute(calculatorCtx("HVAC", "hvac_adp")) as ItemListSuggestion).itemList!.editState, { op: "add", family: "mixing box / LP plenum" });
    const r = helper9().compute(calculatorCtx("HVAC", "hvac_adp"), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(s), [ROW_UNIT_OVERRIDE_KEY]: "nos" });
    expect((r as ItemListSuggestion).itemList!.items[0].fields.map((f) => [f.id, f.control])).toEqual([["insulated", "dropdown"], ["face_w_mm", "text"], ["face_h_mm", "text"], ["depth_mm", "text"]]);
    for (const cid of ["hvac_ahu", "hvac_dx_unit", "hvac_panels", "hvac_pumps"]) {
      const d = helper9().compute(calculatorCtx("HVAC", cid));
      expect(isSuggestion(d)).toBe(false);
    }
  });
});
