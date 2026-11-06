/**
 * SLICE 12c-P (2026-10-06) -- CALCULATOR = RATE HELPER PANEL, ALWAYS. THE PERMANENT PROOF.
 *
 * Owner (standing, P1, verbatim): "we need to do comrpensive browser certs to verify if both calculator
 * and proicing helper giove same price for same inpiuts. they must always do so. any case of divergence
 * is failure. we need to check this for both ADP and Insyulation now and other categories as theyu get
 * buily in future."
 *
 * ⚠️ THIS DRIVES BOTH REAL PATHS AND NEVER ONE PATH TWICE. The `how` is documented at length on
 * `calculatorPanelParity.harness.ts`; in one line: the PANEL path computes through `compute(ctx)` with a
 * populated `extractionByRow` (the `ext` branch -- never-asked defaults, stored cells, the model's
 * items), the CALCULATOR path through `PricingCalculator`'s own construction (empty map,
 * `admitCalculatorOnly`) with the panel's final answers arriving as `overrides` (the branch where none of
 * that runs). Slice 12c found a wiring divergence between exactly those two branches -- a family written
 * to one key and read from another -- that no arithmetic test could see.
 *
 * ⚠️ WHAT IT COVERS, BY NAME (asserted, not described):
 *   - EVERY row of EVERY stored `BoQ Rate Suggestion Run`: 96 runs, 10,460 rows, over 15 categories
 *     across Electrical and HVAC. Rows are grouped into 4,695 DISTINCT INPUT CLASSES and one
 *     representative of each is computed -- `compute` is pure, so identical inputs give identical
 *     outputs on both paths and the class stands for its members exactly. The fixture carries every
 *     member's `run#row`, so the coverage claim is checkable from the file.
 *   - EVERY active SKU of every row-level category (1,929 cases incl. one all-blank refusal per
 *     category), and every family x unit class x ladder path of both item-list categories.
 *   - The resolution paths each sweep reached, named one by one.
 *
 * ⚠️ DIVERGENCES ARE LISTED, NOT TOLERATED. Owner item 7 (amended 2026-10-06): a divergence does not
 * stop the run; it is recorded in full and named in `calculatorPanelParity.awaiting.ts` as awaiting the
 * owner's ruling. These tests pass only if EXACTLY those differ -- a new one fails, and a listed one
 * that stops differing fails too, so nobody can quietly fix or mask one before the owner has ruled.
 *
 * NO PRODUCT FILE CHANGED IN THIS SLICE.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "./rate-master/rateMasterTypes";
import { mergeItemsByName } from "@/pages/boq-wizard/rate-helper/rateHelperPlumbing";
import { itemListPricingSpec } from "@/pages/boq-wizard/rate-helper/itemListPricing";
import { isSuggestion, type ExtractionRow } from "@/pages/boq-wizard/rate-helper/rateHelperTypes";
import { COMING_SOON_REASON, ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, makePricingSheetHelper, type ItemBlockView, type ItemListEditState, type ItemListSuggestion, type ItemListView } from "@/pages/boq-wizard/rate-helper/pricingSheetHelper";
import {
  AWAITING_CORPUS_DIVERGENCES,
  AWAITING_SWEEP_DIVERGENCES,
  STATUS_BY_CAUSE,
} from "./calculatorPanelParity.awaiting";
import {
  calculatorHelper,
  classifyDivergence,
  compareResults,
  emptyCaseFor,
  extractionRowFor,
  feedFromPanel,
  hasPrice,
  itemListCasesForCategory,
  panelCtx,
  panelHelper,
  readJsonFixture,
  resolutionPaths,
  runParity,
  skuCasesForCategory,
  type ParityCase,
} from "./calculatorPanelParity.harness";
import { calculatorCtx } from "./PricingCalculator";
import { itemListRuleOrder } from "./rate-master/itemListRuleOrder";
import { applyAdp1 } from "@/pages/boq-wizard/rate-helper/adp1.harness";
import { applyAdp2 } from "@/pages/boq-wizard/rate-helper/adp2.harness";
import { applyAdp3b } from "@/pages/boq-wizard/rate-helper/adp3b.harness";

// ── the fixtures, as snapshotted from the live site on 2026-10-06 ───────────────────────────────

/**
 * ⚠️ THE FIXTURES ARE READ AT RUNTIME, NOT IMPORTED. A `import x from "./big.json"` makes `tsc` infer a
 * structural type for the WHOLE file: these two are 1.9 MB and 1.0 MB, and `tsc --noEmit` died with
 * "Ineffective mark-compacts near heap limit" on a 2 GB heap -- it would have broken the project's type
 * gate for everyone. Read as text and typed explicitly, they cost `tsc` nothing. (The 423 KB
 * `convertedCorpus.json` that `pricingPipeline.test.ts` imports is below that cliff; do not take it as
 * a precedent for a file this size.)
 */
interface ParityCorpusFile {
  total_rows: number;
  rows_with_no_committed_unit: number;
  rows_in_version_stale_runs: number;
  runs: Array<{ name: string; boq: string; sheet: string; cv: number; run_id: string; active: number; status: string; rows: number; version_current: boolean }>;
  classes: Array<{ case: ParityCase; members: string[] }>;
}
interface ParityMasterFile {
  configs: Record<string, RateCategoryConfig | null>;
  items: Record<string, RateMasterItem[]>;
}
function readFixture<T>(name: string): T {
  return readJsonFixture<T>(new URL(`./__fixtures__/${name}`, import.meta.url));
}
const corpus = readFixture<ParityCorpusFile>("parityCorpus.json");
const master = readFixture<ParityMasterFile>("parityMaster.json");

const configs = new Map<string, RateCategoryConfig>(
  Object.entries(master.configs).filter(([, v]) => !!v) as Array<[string, RateCategoryConfig]>,
);
/**
 * ADP-4a (owner D6 / C7, AC4: "the parity fixture moves to v49 (or the new v50)"). THE ADP PART OF THE SNAPSHOT IS HVAC v50 --
 * its `hvac_adp` config, its ADP items and the three Pricing Inputs ADP reads (ADP-1, after the 2026-10-06 snapshot).
 * Every other category -- Electrical, Insulation, the aliases -- and every stored row stay the frozen snapshot, byte for
 * byte. BEFORE: the snapshot's own ADP config and items (2026-10-06, pre-ADP-1). The 21 wording-only ADP divergences the
 * owner ruled closed in ADP-4 ("fixed in ADP-4 so both say the same thing") are closed by v50's "Other..." on the five
 * number fields, and leave the awaiting list.
 */
const V50 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
  new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v50.json", import.meta.url),
);
const isAdpItem = (it: { kind?: string; attributes?: Record<string, unknown> }) =>
  it.kind === "hvac_adp_item" || (it.kind === "hvac_pricing_input" && (it.attributes as { shared_by?: unknown } | undefined)?.shared_by === "adp");
configs.set("hvac_adp", V50.category_configs.find((c) => c.category_id === "hvac_adp")!);
const items = mergeItemsByName(
  master.items.Electrical ?? [],
  [...(master.items.HVAC ?? []).filter((it) => !isAdpItem(it)),
   ...V50.items.filter(isAdpItem).map((it) => ({ ...it, discipline: V50.discipline } as RateMasterItem))],
);
const CLASSES = corpus.classes;
const RUNS = corpus.runs;

/** Every corpus class, run once through both paths. Computed ONCE for the whole file. */
const CORPUS_RESULTS = CLASSES.map((k) => {
  const run = runParity(configs, items, k.case, "full");
  return { k, run, cause: run.divergences.length ? classifyDivergence(run, k.case) : null };
});

describe("the fixture names exactly what this test covers", () => {
  it("96 stored runs, 10,460 rows, 4,695 distinct input classes", () => {
    expect(RUNS).toHaveLength(96);
    expect(corpus.total_rows).toBe(10460);
    expect(CLASSES).toHaveLength(4695);
    // every class's members are real `run#row` names, and together they account for every row
    const members = CLASSES.reduce((n, k) => n + k.members.length, 0);
    expect(members).toBe(corpus.total_rows);
    const runNames = new Set(RUNS.map((r) => r.name));
    for (const k of CLASSES) for (const m of k.members) expect(runNames.has(m.split("#")[0])).toBe(true);
  });

  it("every run is at its sheet's CURRENT committed version, so every row is one the page would adopt", () => {
    // `isRunForVersion` gates adoption on run.committed_version === the sheet's current version; a
    // stale run never reaches a screen, so parity over it would prove nothing about the product.
    expect(corpus.rows_in_version_stale_runs).toBe(0);
    expect(RUNS.every((r) => r.version_current)).toBe(true);
  });

  it("the catalogue snapshot is the live one: 23 configs, 1,402 Electrical + 379 HVAC active items (335 + the 40 Piping rows of 12e-1 + the 4 Piping accessories inputs of 12e-2)", () => {
    expect(configs.size).toBe(23);        // 12e-1: + hvac_piping (data-only); 12e-2: the same config, now item-list
    expect(master.items.Electrical).toHaveLength(1402);
    expect(master.items.HVAC).toHaveLength(379);   // 12e-1: 335 + 40; 12e-2: + 4 inputs
    // INVERTED at ADP-4a (owner AC4: the fixture's ADP part comes from v50) by mechanical authority: BEFORE toHaveLength(1781).
    // The snapshot's 95 ADP items leave and v50's 93 ADP items + its 3 ADP-shared pricing inputs join: 1,781 - 95 + 96.
    expect(items).toHaveLength(1782);
  });

  it("the 15 categories the corpus exercises", () => {
    const cats = [...new Set(CLASSES.map((k) => k.case.cat))].sort();
    expect(cats).toEqual([
      "cabletray_raceway", "conduit_piping", "db_switchgear", "earthing", "hvac_adp", "hvac_cables",
      "hvac_raceway", "industrial_sockets", "junction_box_raceway", "lighting_mgmt_system",
      "miscellaneous", "point_wiring", "popup_boxes", "switches_sockets", "wiring_cabling",
    ]);
  });
});

describe("the two paths are genuinely different code", () => {
  /**
   * The guard against the failure the owner's rule exists to catch: a parity test that drives ONE path
   * twice. These assertions read a signal that is set ONLY on the `ext` branch, so if the calculator
   * path ever started reading an extraction (or the panel stopped), they go red.
   */
  it("the panel path takes the extraction branch; the calculator path does not", () => {
    const c = CLASSES.find((k) => k.case.cat === "wiring_cabling" && Object.keys(k.case.attrs).length > 0)!.case;
    const panel = panelHelper(configs, items, c).compute(panelCtx(c));
    const calc = calculatorHelper(configs, items).compute(calculatorCtx("Electrical", c.cat), {});
    expect(isSuggestion(panel)).toBe(true);
    expect(isSuggestion(calc)).toBe(true);
    // `producibleKinds` is emitted only when `ext` was found -- i.e. only on the panel's branch.
    expect((panel as { producibleKinds?: string[] }).producibleKinds).toBeDefined();
    expect((calc as { producibleKinds?: string[] }).producibleKinds).toBeUndefined();
  });

  it("INVERTED by 12d-2 (owner S1): there is NO calculator-only admission any more -- the BoQ-shaped panel helper prices Insulation through the one generic predicate", () => {
    // 12c-P pinned the asymmetry (the BoQ-shaped helper declined Insulation, the calculator-shaped one
    // priced it) as a second proof the paths differ. 12d-2 retired the admission: the snapshot's
    // Insulation config (still carrying the retired key in the frozen fixture) is eligible by
    // `hasRunnablePricingRules`, so BOTH constructions price it, and the proof that the two paths
    // differ rests on the `producibleKinds` signal above alone.
    const c: ParityCase = { cat: "hvac_insulation", unit: "sqm", desc: "", attrs: {}, items: [{ item: "Cladding Only" }] };
    const boqPanel = panelHelper(configs, items, c).compute(panelCtx(c));
    const calc = calculatorHelper(configs, items).compute(calculatorCtx("HVAC", c.cat), {});
    expect(boqPanel.kind).toBe("suggestion");
    expect(calc.kind).toBe("suggestion");
    expect((configs.get("hvac_insulation") as { calculator_only?: unknown }).calculator_only).toBe(true);  // the frozen snapshot, never edited
  });
});

describe("every stored extracted row -- the panel's figures and the calculator's", () => {
  it("nothing diverges for a reason outside the four declared causes", () => {
    const unclassified = CORPUS_RESULTS
      .filter((x) => x.cause === "Z_UNCLASSIFIED")
      .map((x) => `${x.k.members[0]} (${x.k.case.cat}): ` + x.run.divergences.map((d) => `${d.what} P[${d.panel}] C[${d.calculator}]`).join(" | "));
    expect(unclassified).toEqual([]);
  }, 60000);

  it("EXACTLY the divergences awaiting owner review differ -- no more, and no fewer", () => {
    const found = CORPUS_RESULTS
      .filter((x) => x.cause !== null)
      .map((x) => ({ id: x.k.members[0], cat: x.k.case.cat, cause: x.cause!, rows: x.k.members.length }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const listed = [...AWAITING_CORPUS_DIVERGENCES].sort((a, b) => a.id.localeCompare(b.id));
    expect(found).toEqual(listed);
  }, 60000);

  it("the awaiting list's per-cause totals are the measured ones", () => {
    const tally = new Map<string, { classes: number; rows: number }>();
    for (const d of AWAITING_CORPUS_DIVERGENCES) {
      const e = tally.get(d.cause) ?? { classes: 0, rows: 0 };
      e.classes += 1; e.rows += d.rows; tally.set(d.cause, e);
    }
    /**
     * SLICE 12c-F: B is GONE -- fix B matched every model-read value to the option it means, so no row
     * prices from a value its field cannot show any more. The three B rows that were never value
     * problems moved to C, where they belong; the three sq.ft rows left C under fix C.
     */
    expect(tally.get("A_wiring_primary")).toEqual({ classes: 73, rows: 188 });
    expect(tally.get("B_stale_pick")).toBeUndefined();
    // SLICE 12c-U: 5 -> 3. The two rows whose BoQ said NO unit (or "rate only") now resolve to the
    // catalogue's unit for their item and AGREE on both surfaces, so they left the list. The three
    // that remain are the ones whose BoQ SAID a unit the item cannot take -- owner U1, refusing is
    // correct. INVERTED, not deleted: the count is still pinned exactly.
    expect(tally.get("C_unit_not_offered")).toEqual({ classes: 3, rows: 3 });
    // INVERTED at ADP-4a (owner AC4 + 2026-10-21 "list the 7, fix later") by mechanical authority: BEFORE
    // `D_reason_only` { classes: 8, rows: 8 } and keys [A, C, D]. On v50 the 8 D rows agree; cause E's 7 are listed.
    expect(tally.get("D_reason_only")).toBeUndefined();
    // INVERTED at ADP-4b (owner AC7 "Both quote the read sides") by mechanical authority: BEFORE
    // `E_outer_size_quote` { classes: 7, rows: 7 } and keys [A, C, E]. Both surfaces now quote the outer size as read.
    expect(tally.get("E_outer_size_quote")).toBeUndefined();
    expect([...tally.keys()].sort()).toEqual(["A_wiring_primary", "C_unit_not_offered"]);
  });

  it("the thirteen Electrical categories and the two HVAC alias categories agree on EVERY row except wiring's offered figure", () => {
    const perCat = new Map<string, number>();
    for (const x of CORPUS_RESULTS) {
      if (x.cause === null) continue;
      perCat.set(x.k.case.cat, (perCat.get(x.k.case.cat) ?? 0) + x.k.members.length);
    }
    // the ONLY two categories with any divergence at all
    expect([...perCat.keys()].sort()).toEqual(["hvac_adp", "wiring_cabling"]);
    expect(perCat.get("wiring_cabling")).toBe(188);
    // 12c-F: 24 -> 13; 12c-U: the no-unit and R/O rows closed, 13 -> 11; INVERTED at ADP-4a by mechanical authority:
    // BEFORE toBe(11) -- 3 C + 8 D; AFTER 3 C + 7 E (the 8 D closed on v50, the 7 E exposed by the fixture move)
    // INVERTED at ADP-4b (owner AC7) by mechanical authority: BEFORE toBe(10) -- 3 C + 7 E. AFTER 0 ADP divergences
    // beside the 3 accepted C rows, count asserted
    expect(perCat.get("hvac_adp")).toBe(3);
    expect(CORPUS_RESULTS.filter((x) => x.cause !== null && x.k.case.cat === "hvac_adp" && x.cause !== "C_unit_not_offered")).toEqual([]);
  });

  it("THE HEADLINE: no ITEM-LIST row ever produces a figure on both surfaces that disagree", () => {
    /**
     * Read this one first, and read it exactly. On an item-list category (HVAC ADP) there is NOT ONE
     * stored row where both surfaces produce a figure and the two differ: a divergence is always one
     * surface WITHHOLDING a figure (cause B, 8 rows) or a refusal SENTENCE. No ADP arithmetic disagrees.
     *
     * The claim is deliberately NOT made about `values` across the board, because on wiring it is
     * FALSE and the first draft of this test asserted it and went red on 44 rows: wiring's `values` is
     * whichever block the ROW TEXT makes primary, so the panel can legitimately offer the termination
     * figure where the calculator offers the cable one. BOTH figures are computed identically on both
     * surfaces -- which is what the next test pins.
     */
    const bad = CORPUS_RESULTS.filter((x) => {
      if (!itemListPricingSpec(configs.get(x.k.case.cat) ?? null)) return false;
      return hasPrice(x.run.panel) && hasPrice(x.run.calculator)
        && JSON.stringify((x.run.panel as { values: unknown }).values)
           !== JSON.stringify((x.run.calculator as { values: unknown }).values);
    });
    expect(bad.map((x) => x.k.members[0])).toEqual([]);
  }, 60000);

  it("on a ROW-LEVEL category no BLOCK's figures ever differ -- only which block is offered", () => {
    /**
     * The row-level counterpart of the headline. Every row-level divergence in the corpus is confined
     * to `values` / `finalValues`; the comparator independently compares each labelled BLOCK's figures
     * (by label, so wiring's reordering cannot hide anything) and each stacked HEADLINE, and neither
     * ever differs. So on 10,079 Electrical + alias rows the two surfaces compute every figure
     * identically, and the only thing in dispute is which one "Use this value" would apply.
     */
    for (const x of CORPUS_RESULTS) {
      if (x.cause === null) continue;
      if (itemListPricingSpec(configs.get(x.k.case.cat) ?? null)) continue;
      const whats = [...new Set(x.run.divergences.map((d) => d.what))].sort();
      expect(whats).toEqual(["finalValues", "values"]);
    }
  }, 60000);

  it("where a figure is WITHHELD on one surface, which cause and how many -- measured", () => {
    /**
     * MEASURED, AND THE FIRST READING WAS WRONG TWICE. "B is the only cause where one surface prices
     * and the other does not" is false in both directions: 9 of the 73 wiring classes have no matching
     * rate row in the OTHER pipeline (so the offered figure is absent on one side), 3 of the 11 B
     * classes refuse on BOTH surfaces, and 3 of the 5 C classes have one surface pricing. The numbers
     * are therefore recorded, rather than a rule asserted over them.
     */
    const tally = new Map<string, { classes: number; rows: number }>();
    for (const x of CORPUS_RESULTS) {
      if (x.cause === null) continue;
      if (hasPrice(x.run.panel) === hasPrice(x.run.calculator)) continue;
      const e = tally.get(x.cause) ?? { classes: 0, rows: 0 };
      e.classes += 1; e.rows += x.k.members.length; tally.set(x.cause, e);
    }
    expect([...tally.keys()].sort()).toEqual(["A_wiring_primary", "C_unit_not_offered"]);
    expect(tally.get("A_wiring_primary")).toEqual({ classes: 9, rows: 10 });
    expect(tally.get("B_stale_pick")).toBeUndefined();
    // SLICE 12c-U: 3 -> 2. The R/O row now prices on BOTH surfaces, so it no longer withholds a
    // figure on one; the no-unit row refuses on both and never did. INVERTED, not deleted.
    expect(tally.get("C_unit_not_offered")).toEqual({ classes: 2, rows: 2 });
    // D is DEFINED as "both refuse", so it can never appear here
    expect(tally.get("D_reason_only")).toBeUndefined();
  }, 60000);

  it("which causes have the panel pricing an ITEM-LIST row the calculator refuses -- measured", () => {
    const panelOnly = CORPUS_RESULTS.filter((x) =>
      x.cause !== null && hasPrice(x.run.panel) && !hasPrice(x.run.calculator)
      && !!itemListPricingSpec(configs.get(x.k.case.cat) ?? null));
    const byCause = new Map<string, number>();
    for (const x of panelOnly) byCause.set(x.cause!, (byCause.get(x.cause!) ?? 0) + 1);
    // SLICE 12c-F: B is gone, so only the unit-shaped cause withholds a figure on an item-list row.
    // ⚠️ MEASURED, NOT ASSUMED. Cause C does it too, on all 3 of its pricedness-differing rows: a row
    // whose unit the picker cannot offer falls back to the first OFFERED class, and in that class the
    // family has no SKU -- so the calculator refuses a row the panel priced, for the unit rather than
    // for the stale pick. B is 8 of the 11.
    /**
     * SLICE 12c-F: this set is now EMPTY, and the direction is the point. Before the slice the panel
     * priced 8 rows the calculator refused (cause B -- it was pricing from a value no control could
     * show). Fix B closed every one. What is left runs the OTHER way: on 3 rows the PANEL refuses,
     * because the BoQ's unit is one that family cannot be priced in at all, while the calculator
     * prices in a unit it can offer. That is cause C, it is listed, and it is the owner's to rule on.
     */
    expect([...byCause.entries()].sort()).toEqual([]);
    const calcOnly = CORPUS_RESULTS.filter((x) =>
      x.cause !== null && !hasPrice(x.run.panel) && hasPrice(x.run.calculator)
      && !!itemListPricingSpec(configs.get(x.k.case.cat) ?? null));
    // SLICE 12c-U: 3 -> 2. The R/O row left this set by being priced on both surfaces.
    expect(calcOnly).toHaveLength(2);
    expect(new Set(calcOnly.map((x) => x.cause))).toEqual(new Set(["C_unit_not_offered"]));
  }, 60000);

  it("A_wiring_primary never changes a BLOCK's figures -- only which block is offered", () => {
    for (const x of CORPUS_RESULTS) {
      if (x.cause !== "A_wiring_primary") continue;
      // the comparator compares both `sections` (by label) and `headlines` (by label); a divergence
      // confined to `values`/`finalValues` therefore means every block agreed
      const whats = new Set(x.run.divergences.map((d) => d.what));
      expect([...whats].sort()).toEqual(["finalValues", "values"]);
    }
  }, 60000);
});

describe("the owner's ruling on each cause (12c-F)", () => {
  it("A and D are ACCEPTED; what is left awaiting is the unit-shaped cause alone", () => {
    expect(STATUS_BY_CAUSE.A_wiring_primary).toBe("accepted by owner");   // owner R-A
    expect(STATUS_BY_CAUSE.D_reason_only).toBe("accepted by owner");      // owner R-D
    const awaiting = new Set(
      AWAITING_CORPUS_DIVERGENCES.filter((d) => STATUS_BY_CAUSE[d.cause] === "awaiting owner review").map((d) => d.cause),
    );
    // SLICE 12c-U: the owner ruled on C too (U1 -- "all theseshould refuse pricing"), so NOTHING in
    // this corpus is awaiting a ruling. INVERTED, not deleted: the set is still pinned exactly, and
    // a NEW divergence would make it non-empty and fail here.
    expect(STATUS_BY_CAUSE.C_unit_not_offered).toBe("accepted by owner");   // owner U1
    // INVERTED at ADP-4a (owner 2026-10-21 "list the 7, fix later") by mechanical authority: BEFORE toEqual([]).
    expect(STATUS_BY_CAUSE.E_outer_size_quote).toBe("awaiting owner review");
    // INVERTED back at ADP-4b (owner AC7, the 7 fixed): BEFORE toEqual(["E_outer_size_quote"])
    expect([...awaiting]).toEqual([]);
  });

  it("no listed divergence carries cause B any more -- fix B closed every one; INVERTED at 12d-8 (owner R1): exactly ONE sweep entry carries it, by name", () => {
    expect(AWAITING_CORPUS_DIVERGENCES.filter((d) => d.cause === "B_stale_pick")).toEqual([]);
    // BEFORE 12d-8: `toEqual([])`. AFTER: a cleared pick stays blank and refuses (R1), so the sweep's
    // per-sq.m slot diffuser -- whose damper the panel DEFAULTS and the calculator therefore PICKS and
    // clears -- now refuses with a different sentence on each surface. Both refuse; no price moves.
    // INVERTED AGAIN at 12e-2b (owner D1 (a) + D4 (a)): BEFORE `toEqual([{ cat: "hvac_adp", unit: "sqm", item: { family:
    // "slot diffuser" }, cause: "B_stale_pick" }])`. Damper is two-way, the calculator's "without" is kept, and the two
    // surfaces now refuse with the same sentence -- so NO sweep entry carries cause B, and parity is asserted below.
    expect(AWAITING_SWEEP_DIVERGENCES.filter((d) => d.cause === "B_stale_pick")).toEqual([]);
  });

  it("12e-2b D4 (a): the per-sq.m and per-number slot diffuser, damper never stated -- calculator = panel, both refuse naming the pair, no price", () => {
    for (const unit of ["sqm", "nos"]) {
      const item: Record<string, string> = unit === "nos" ? { family: "slot diffuser", size_mm: "600x600" } : { family: "slot diffuser" };
      const r = runParity(configs, items, { cat: "hvac_adp", unit, desc: "", attrs: {}, items: [item] }, "full");
      expect({ unit, divergences: r.divergences }).toEqual({ unit, divergences: [] });
      expect(hasPrice(r.panel)).toBe(false);
      expect(hasPrice(r.calculator)).toBe(false);
      const want = unit === "nos"
        // INVERTED at ADP-3a (owner B6, 13:32: a no-SKU sentence lists only the facts the kind's SKUs vary on) by mechanical authority: BEFORE "..., width 600, height 600 - ..." (the per-metre SKU carries no width or height)
        // INVERTED AGAIN at ADP-4a (owner AC4: on v50 a per-number slot diffuser converts from the per-metre rate by its slot
        // count, ADP-1, and this row states none) by mechanical authority: BEFORE "No SKU for slot diffuser: without damper - price this row by hand"
        ? "per-number row: no slot count stated to convert the per-metre rate"
        // INVERTED at ADP-4a (owner AC4: the fixture's ADP part is v50, whose per-sq.m slot diffuser refuses by its own
        // ADP-1 unit rule) by mechanical authority: BEFORE "No SKU for slot diffuser: without damper - price this row by hand"
        : "No SKU for a slot diffuser per sq.m without damper - price this row by hand";
      expect((r.panel as ItemListSuggestion).itemList!.items[0].reason).toBe(want);
      expect((r.calculator as ItemListSuggestion).itemList!.items[0].reason).toBe(want);
    }
  });

  it("the eleven rows fix B was ruled for are gone from the list BY NAME", () => {
    const closed = ["BRSR-26-01308#88", "BRSR-26-01310#276", "BRSR-26-01311#93", "BRSR-26-01311#94",
      "BRSR-26-01313#54", "BRSR-26-01313#55", "BRSR-26-01315#82", "BRSR-26-01371#88"];
    const listed = new Set(AWAITING_CORPUS_DIVERGENCES.map((d) => d.id));
    for (const id of closed) expect(listed.has(id)).toBe(false);
  });

  it("the three sq.ft rows fix C was ruled for are gone from the list BY NAME", () => {
    const listed = new Set(AWAITING_CORPUS_DIVERGENCES.map((d) => d.id));
    for (const id of ["BRSR-26-01370#80", "BRSR-26-01370#83", "BRSR-26-01370#84"]) {
      expect(listed.has(id)).toBe(false);
    }
  });

  /**
   * INVERTED 2026-10-07 (slice 12c-U), NOT deleted. This named the FIVE rows awaiting a ruling. The
   * owner has now ruled on all five, in two opposite directions, so the list is EMPTY -- and what the
   * pin protects is kept by naming the three that remain listed-but-accepted instead. A new
   * divergence, or one of these three silently closing, still fails here.
   */
  it("nothing is awaiting a ruling; the three that remain are the owner's accepted refusals", () => {
    const awaiting = AWAITING_CORPUS_DIVERGENCES.filter((d) => STATUS_BY_CAUSE[d.cause] === "awaiting owner review");
    // INVERTED at ADP-4a (owner 2026-10-21 "list the 7, fix later") by mechanical authority: BEFORE toEqual([]).
    // INVERTED back at ADP-4b (owner AC7): BEFORE the 7 ids BRSR-26-01369#32, BRSR-26-01370#46 / 47 / 48 / 50 / 51 / 52
    expect(awaiting.map((d) => d.id).sort()).toEqual([]);
    // owner U1: the BoQ SAID a unit and it was wrong for the item -- the panel refusing is correct
    const unitShaped = AWAITING_CORPUS_DIVERGENCES.filter((d) => d.cause === "C_unit_not_offered");
    expect(unitShaped.map((d) => d.id).sort()).toEqual([
      "BRSR-26-01311#25", "BRSR-26-01311#27", "BRSR-26-01311#52",
    ]);
    // NEGATIVE: the two rows the owner's U2 / U3 ruling closed are GONE from the list entirely
    const ids = new Set(AWAITING_CORPUS_DIVERGENCES.map((d) => d.id));
    expect(ids.has("BRSR-26-01312#51")).toBe(false);
    expect(ids.has("BRSR-26-01369#43")).toBe(false);
  });
});

describe("every active SKU of every row-level category", () => {
  const rowLevel = [...configs.entries()].filter(([, cfg]) => !itemListPricingSpec(cfg)).sort();

  it("1,929 cases, and not one divergence", () => {
    let total = 0;
    const bad: string[] = [];
    for (const [cid, cfg] of rowLevel) {
      const cases = [...skuCasesForCategory(cfg, items), emptyCaseFor(cfg)];
      total += cases.length;
      for (const c of cases) {
        const r = runParity(configs, items, c, "full");
        if (r.divergences.length) {
          bad.push(`${cid} ${JSON.stringify(c.attrs)}: ` + r.divergences.map((d) => `${d.what} P[${d.panel}] C[${d.calculator}]`).join(" | "));
        }
      }
    }
    expect(bad).toEqual([]);
    // 12e-1: 1,929 + the 40 Piping SKUs + its empty case (every one declined on both paths);
    // 12e-2: 1,933 -- Piping is an ITEM-LIST category now and its 40 SKUs are swept below by the item-list driver, so its
    // 41 leave; the FOUR Piping accessories inputs are rows of the (row-level, data-only) Pricing Inputs category and join
    // it, each declining on both paths exactly as the seven Insulation inputs always have
    // INVERTED at ADP-4a (owner AC4) by mechanical authority: BEFORE toBe(1933). v50's 3 ADP-shared pricing inputs are
    // rows of the row-level Pricing Inputs category, each declining on both paths
    expect(total).toBe(1936);
  }, 180000);

  it("the resolution paths this sweep reached, named", () => {
    const paths = new Set<string>();
    for (const [, cfg] of rowLevel) {
      for (const c of [...skuCasesForCategory(cfg, items), emptyCaseFor(cfg)]) {
        for (const p of resolutionPaths(runParity(configs, items, c, "full").panel)) paths.add(p);
      }
    }
    for (const p of [
      "row priced", "row incomplete", "declined", "default fired", "derived attribute",
      "disabled by None", "multi-block row", "no match", "note:rating_up",
    ]) expect([...paths]).toContain(p);
  }, 180000);
});

describe("HVAC ADP -- every family x unit class x ladder path", () => {
  const cfg = configs.get("hvac_adp")!;
  const cases = itemListCasesForCategory(cfg, items);

  it("120 cases over all 25 families", () => {
    // INVERTED at ADP-4a (owner AC4: the sweep runs on the v50 config) by mechanical authority: BEFORE toHaveLength(120)
    expect(cases).toHaveLength(122);
    const fams = new Set(cases.map((c) => c.items?.[0]?.family as string));
    expect(fams.size).toBe(25);
  });

  it("EXACTLY the sweep divergences awaiting owner review differ, and none of them moves a price", () => {
    const found: Array<{ cat: string; unit: string; item: unknown; cause: string }> = [];
    for (const c of cases) {
      const r = runParity(configs, items, c, "full");
      if (!r.divergences.length) continue;
      found.push({ cat: c.cat, unit: c.unit, item: c.items?.[0] ?? null, cause: classifyDivergence(r, c) });
      expect(hasPrice(r.panel)).toBe(hasPrice(r.calculator));
    }
    expect(found).toEqual(AWAITING_SWEEP_DIVERGENCES.filter((d) => d.cat === "hvac_adp"));
    // ADP-4a AC4: on v50 not one ADP sweep case diverges (BEFORE: 13, all D_reason_only)
    expect(found).toHaveLength(0);
  }, 60000);

  it("the resolution paths this sweep reached, named", () => {
    const paths = new Set<string>();
    for (const c of cases) for (const p of resolutionPaths(runParity(configs, items, c, "full").panel)) paths.add(p);
    for (const p of ["item-list priced", "item-list refused", "item refused", "default fired", "ladder size-up"]) {
      expect([...paths]).toContain(p);
    }
  }, 60000);

  it("the corpus reached the paths this sweep cannot synthesize", () => {
    const paths = new Set<string>();
    for (const x of CORPUS_RESULTS) {
      if (x.k.case.cat !== "hvac_adp") continue;
      for (const p of resolutionPaths(x.run.panel)) paths.add(p);
    }
    for (const p of ["area conversion", "multi-item row"]) expect([...paths]).toContain(p);
  });
});

describe("HVAC Insulation -- every family x unit class x ladder path", () => {
  // At the 2026-10-06 snapshot Insulation was `calculator_only`, so there was no BoQ row and no stored
  // run to read; 12d-2 made it eligible through the generic predicate, and the snapshot's config (the
  // frozen fixture) reads eligible by that predicate too. Both paths are exercised: the panel's `ext`
  // branch (a synthesized extraction row, which is exactly what a run produces) against the
  // calculator's override branch -- never one branch twice.
  const cfg = configs.get("hvac_insulation")!;
  const cases = itemListCasesForCategory(cfg, items);

  // INVERTED at 12e-3c (owner F4: "In the calculator it should say 'pick a cladding'" - "ok"; a model-read BoQ row keeps
  // "could not tell cladding"). BEFORE: "24 cases over all 6 families, and not one divergence" -- `bad` empty with no
  // exception. The two surfaces now WORD one refusal differently by ruling; it is the ONE named difference, counted,
  // and it is wording only: a divergence is forgiven only if it becomes EQUAL once the panel's sentence is read as the
  // calculator's. Any figure, status or other sentence that differs still fails here.
  it("24 cases over all 6 families: not one divergence except the calculator's own sentence for an unfilled cladding (8 cases, wording only) -- 12e-3c F4", () => {
    expect(cases).toHaveLength(24);
    expect(new Set(cases.map((c) => c.items?.[0]?.item as string)).size).toBe(6);
    const bad: string[] = [];
    const worded: string[] = [];
    for (const c of cases) {
      const r = runParity(configs, items, c, "full");
      if (!r.divergences.length) continue;
      const onlyWording = r.divergences.every((d) => ["item row reason", "item blocks"].includes(d.what)
        && d.panel.includes("could not tell cladding") && d.panel.split("could not tell cladding").join("pick a cladding") === d.calculator);
      if (onlyWording) { worded.push(`${c.unit} ${JSON.stringify(c.items)}`); continue; }
      bad.push(`${c.unit} ${JSON.stringify(c.items)}: ` + r.divergences.map((d) => `${d.what} P[${d.panel}] C[${d.calculator}]`).join(" | "));
    }
    expect(bad).toEqual([]);
    expect(worded).toHaveLength(8);
    // every one of the eight is a row with NO cladding answered -- never a row that priced
    for (const c of cases) {
      const r = runParity(configs, items, c, "full");
      if (r.divergences.length) { expect(hasPrice(r.panel)).toBe(false); expect(hasPrice(r.calculator)).toBe(false); }
    }
    expect(AWAITING_SWEEP_DIVERGENCES.filter((d) => d.cat === "hvac_insulation")).toEqual([]);
  }, 60000);

  it("the resolution paths this sweep reached, named", () => {
    const paths = new Set<string>();
    for (const c of cases) for (const p of resolutionPaths(runParity(configs, items, c, "full").panel)) paths.add(p);
    for (const p of ["item-list priced", "item-list refused", "item refused", "ladder size-up", "typed (Other)"]) {
      expect([...paths]).toContain(p);
    }
  }, 60000);
});

describe("HVAC Piping -- every family x unit class x ladder path, every SKU, every resolution path (SLICE 12e-2, owner option 1)", () => {
  // The committed v36 asset by name (the configs the live site serves since the 12e-2 load), not the served fixture:
  // the fixture's configs are a dated snapshot by design; its ITEMS are re-snapshotted and equal the asset's.
  const live = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v36.json", import.meta.url),
  );
  const cfg36 = new Map<string, RateCategoryConfig>(live.category_configs.map((c) => [c.category_id, c]));
  const items36: RateMasterItem[] = live.items.map((it) => ({ ...it, discipline: live.discipline } as RateMasterItem));
  const PIP = "hvac_piping";
  const cfg = cfg36.get(PIP)!;
  const cases = itemListCasesForCategory(cfg, items36);
  const INCH = '"';
  const pc = (family: string, size: string, extra: Partial<ParityCase> = {}): ParityCase =>
    ({ cat: PIP, unit: "mts", desc: "", attrs: {}, items: [{ pipe_type: family, size_mm: size }], ...extra });

  it("the generated sweep: 4 families x 1 unit class x (filled, above the largest, between, nothing) = 16 cases, not one divergence", () => {
    expect(cases).toHaveLength(16);
    expect(new Set(cases.map((c) => c.items?.[0]?.pipe_type as string))).toEqual(new Set(["Copper", "MS", "PVC", "CPVC"]));
    const bad: string[] = [];
    for (const c of cases) {
      const r = runParity(cfg36, items36, c, "full");
      if (r.divergences.length) bad.push(`${c.unit} ${JSON.stringify(c.items)}: ` + r.divergences.map((d) => `${d.what} P[${d.panel}] C[${d.calculator}]`).join(" | "));
    }
    expect(bad).toEqual([]);
  }, 60000);

  it("every one of the 40 SKUs agrees on both surfaces and prices (40 cases, named by family and size)", () => {
    const skus = items36.filter((it) => it.kind === "hvac_piping_item");
    expect(skus).toHaveLength(40);
    const bad: string[] = [];
    let priced = 0;
    for (const sku of skus) {
      const c = pc(String(sku.attributes.pipe_type), String(sku.attributes.size_mm));
      const r = runParity(cfg36, items36, c, "full");
      if (r.divergences.length) bad.push(`${sku.attributes.pipe_type} ${sku.attributes.size_mm}: ` + r.divergences.map((d) => d.what).join(" | "));
      if (hasPrice(r.panel) && hasPrice(r.calculator)) priced++;
    }
    expect(bad).toEqual([]);
    expect(priced).toBe(40);
  }, 60000);

  it("every resolution path, named: both inch conversions, the 0.1 mm rung, below the smallest, the next size up, above the largest, each value map, SS, the class line -- all agree", () => {
    const named: Array<[string, ParityCase]> = [
      ["5/8 inch -> 15.9 (x 25.4, 1 dp)", pc("Copper", `5/8${INCH}`)],
      ["4 inch -> 100 (x 25)", pc("MS", "4 inch")],
      ["1-1/4 inch -> 31.7 (the 0.1 mm rung)", pc("Copper", `1-1/4${INCH}`)],
      ["15 -> 19 (below the smallest)", pc("MS", "15")],
      ["110 -> 150 (next size up)", pc("PVC", "110")],
      ["350 refuses (above the largest)", pc("MS", "350")],
      ["GI -> MS (value map)", pc("GI", "50")],
      ["uPVC -> PVC (value map)", pc("uPVC", "110")],
      ["HDPE -> PVC (value map)", pc("HDPE", "50")],
      ["SS refuses", pc("SS", "50")],
      ["ABC refuses by name", pc("ABC", "50")],
      ["Class C: the class line, no figure moves", { ...pc("MS", "50"), items: [{ pipe_type: "MS", size_mm: "50", pipe_class: "Class C" }] }],
    ];
    const bad: string[] = [];
    const reached = new Set<string>();
    for (const [label, c] of named) {
      const r = runParity(cfg36, items36, c, "full");
      for (const p of resolutionPaths(r.panel)) reached.add(p);
      if (r.divergences.length) bad.push(`${label}: ` + r.divergences.map((d) => `${d.what} P[${d.panel}] C[${d.calculator}]`).join(" | "));
    }
    expect(bad).toEqual([]);
    for (const p of ["item-list priced", "item-list refused", "item refused", "ladder size-up"]) expect([...reached]).toContain(p);
  }, 60000);

  /**
   * INVERTED at 12e-2b (AC6; 12e-2 cert finding 7). BEFORE this was a named EXCLUSION: "a MODEL '40/50' is read by the
   * inch reader as a fraction (0.8\" = 20.32 -> 25) and prices on the panel, while the same text TYPED on the calculator
   * is not one size and refuses -- the two surfaces MUST differ here" (divergences > 0, panel priced, calculator
   * "Type one pipe size, in mm or inches"). A slash that cannot be an inch fraction now states two sizes on BOTH
   * paths, so the exclusion is gone and parity is asserted instead; the inch forms still agree and still price.
   */
  // INVERTED AGAIN at 12e-3b (owner 2026-10-11, "use the higher size"; REPLACES "40/50 refuses"). BEFORE, for "40/50" and
  // "50/65": hasPrice false on both surfaces and both reasons `pipe size states two sizes (<sizes>) - pick one`; and
  // "63/64" sat in the inch list below and priced (its top number is above 16, so it is now the two sizes 63 and 64).
  it("12e-3b AC2: '40/50' and '50/65' price the HIGHER on BOTH surfaces with one line -- no exclusion; a real inch fraction still agrees and prices (BEFORE: both refused '- pick one')", () => {
    for (const [typed, sizes, higher] of [["40/50", "40 / 50", "50"], ["50/65", "50 / 65", "65"]] as const) {
      const r = runParity(cfg36, items36, pc("MS", typed), "full");
      expect({ typed, divergences: r.divergences }).toEqual({ typed, divergences: [] });
      expect(hasPrice(r.panel)).toBe(true);
      expect(hasPrice(r.calculator)).toBe(true);
      const line = `pipe size states two sizes (${sizes}) - the higher, ${higher}, is taken`;
      expect((r.panel as ItemListSuggestion).itemList!.items[0].working).toContain(line);
      expect((r.calculator as ItemListSuggestion).itemList!.items[0].working).toContain(line);
      // the figure is the higher size's own
      const alone = runParity(cfg36, items36, pc("MS", higher), "full");
      expect((r.panel as ItemListSuggestion).values).toEqual((alone.panel as ItemListSuggestion).values);
      expect((r.panel as ItemListSuggestion).itemList!.items[0].reason ?? "").not.toContain("pick one");
    }
    for (const typed of ["7/8", "1-1/4", "1 1/4", "15/16"]) {
      const r = runParity(cfg36, items36, pc("Copper", typed), "full");
      expect({ typed, divergences: r.divergences }).toEqual({ typed, divergences: [] });
      expect(hasPrice(r.panel)).toBe(true);
    }
    // "63/64" is two sizes now: the higher, 64, is above copper's largest size, and both surfaces refuse alike
    const r = runParity(cfg36, items36, pc("Copper", "63/64"), "full");
    expect(r.divergences).toEqual([]);
    expect(hasPrice(r.panel)).toBe(false);
  });

  it("the ONE unit exclusion, by name: a row unit the picker does not offer ('nos') diverges by cause C and never produces a figure on either side (owner R12 / 12c-F)", () => {
    const r = runParity(cfg36, items36, pc("MS", "50", { unit: "nos" }), "full");
    expect(r.divergences.length).toBeGreaterThan(0);
    expect(classifyDivergence(r, pc("MS", "50", { unit: "nos" }))).toBe("C_unit_not_offered");
    expect(hasPrice(r.panel)).toBe(false);
  });

  it("VACUITY: handing the calculator a different size diverges (the comparison can see a Piping difference)", () => {
    const c = pc("MS", "50");
    const agree = runParity(cfg36, items36, c, "full");
    expect(agree.divergences).toEqual([]);
    const panelOnly = panelHelper(cfg36, items36, c);
    const calcH = calculatorHelper(cfg36, items36);
    const pr = panelOnly.compute(panelCtx(c), {});
    const cr = calcH.compute(calculatorCtx("HVAC", PIP), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "MS", attrs: { size_mm: "65" }, other: [] }] }), [ROW_UNIT_OVERRIDE_KEY]: "mts" });
    expect((pr as ItemListSuggestion).values.supply_rate).toBe(984);
    expect((cr as ItemListSuggestion).values.supply_rate).toBe(1200);
  });
});

describe("db_switchgear BY NAME (owner P3: the 12c-S partial is covered here)", () => {
  it("every stored db_switchgear row agrees, and so does every active db_switchgear SKU", () => {
    const rows = CORPUS_RESULTS.filter((x) => x.k.case.cat === "db_switchgear");
    expect(rows.length).toBe(512);
    expect(rows.reduce((n, x) => n + x.k.members.length, 0)).toBe(1098);
    expect(rows.filter((x) => x.cause !== null)).toEqual([]);

    const cfg = configs.get("db_switchgear")!;
    const skuCases = skuCasesForCategory(cfg, items);
    expect(skuCases.length).toBe(163);
    for (const c of skuCases) expect(runParity(configs, items, c, "full").divergences).toEqual([]);
  }, 60000);

  it("and at least one of them is a row that actually priced", () => {
    const priced = CORPUS_RESULTS.filter((x) => x.k.case.cat === "db_switchgear" && hasPrice(x.run.panel));
    expect(priced.length).toBeGreaterThan(0);
    for (const x of priced) {
      expect(hasPrice(x.run.calculator)).toBe(true);
      expect((x.run.panel as { values: Record<string, number> }).values)
        .toEqual((x.run.calculator as { values: Record<string, number> }).values);
    }
  });
});

describe("vacuity -- the comparison can actually see a difference", () => {
  /**
   * A parity suite that cannot fail proves nothing. These perturb ONE path's input by one answer and
   * require the comparator to report it, per discipline and per shape -- so the green above is a
   * statement about the product, not about a comparator that always agrees.
   */
  it("a row-level category: dropping one answered attribute from the calculator's feed diverges", () => {
    const x = CORPUS_RESULTS.find((r) => r.k.case.cat === "db_switchgear" && hasPrice(r.run.panel))!;
    const full = x.run;
    expect(full.divergences).toEqual([]);
    const keys = Object.keys(full.feed.overrides);
    expect(keys.length).toBeGreaterThan(0);
    const starved = { ...full.feed.overrides };
    delete starved[keys[0]];
    const calc = calculatorHelper(configs, items).compute(calculatorCtx("Electrical", x.k.case.cat), starved);
    expect(JSON.stringify((calc as { values?: unknown }).values))
      .not.toBe(JSON.stringify((full.panel as { values?: unknown }).values));
  });

  it("an item-list category: handing the calculator NO items diverges", () => {
    /**
     * THE PERTURBATION HAS TO BITE. Emptying one item's ANSWERS does not: several ADP families price
     * from the family alone, their remaining facts coming from ruled defaults -- so the row still
     * priced and the "vacuity proof" proved nothing. Removing the items themselves cannot be absorbed
     * by any default.
     */
    const x = CORPUS_RESULTS.find((r) => r.k.case.cat === "hvac_adp" && hasPrice(r.run.panel) && r.cause === null)!;
    expect(x.run.divergences).toEqual([]);
    const calc = calculatorHelper(configs, items)
      .compute(calculatorCtx("HVAC", "hvac_adp"), { ...x.run.feed.overrides, __items__: JSON.stringify({ items: [] }) });
    expect(hasPrice(calc)).toBe(false);
    expect(hasPrice(x.run.panel)).toBe(true);
  });

  it("the unit is an input: one family priced in its two offered classes gives two answers", () => {
    /**
     * IT MUST BE A CLASS THE PICKER OFFERS FOR THAT FAMILY, or the perturbation is a no-op BY DESIGN:
     * a stored pick the picker no longer lists is not honoured (12c-S), so feeding "sqm" to a
     * count-only family silently falls back to the first surviving choice and nothing changes -- a
     * vacuity test that would then fail for the wrong reason.
     */
    const cases = itemListCasesForCategory(configs.get("hvac_adp")!, items);
    const byFamily = new Map<string, Map<string, number>>();
    for (const c of cases) {
      const fam = c.items?.[0]?.family as string;
      const r = runParity(configs, items, c, "full");
      if (!hasPrice(r.calculator)) continue;
      const supply = (r.calculator as { values: Record<string, number> }).values.supply_rate;
      const m = byFamily.get(fam) ?? new Map<string, number>();
      if (!m.has(c.unit)) m.set(c.unit, supply);
      byFamily.set(fam, m);
    }
    const twoClass = [...byFamily.entries()].filter(([, m]) => m.size > 1 && new Set(m.values()).size > 1);
    expect(twoClass.length).toBeGreaterThan(0);
  }, 60000);
});

/**
 * SLICE 12d-6 (owner ruling (a) + U4, 2026-10-09) -- A LAYERED ANSWER ON BOTH SURFACES.
 *
 * 12e-0b found the panel handing the pricer the dropdown option "19" for a MODEL-read "Double layer of 19mm
 * thick" (one layer, 615 / 224) while the pure pricer composed two (991 / 238). The pin below is written on the
 * MODEL-READ answer, as the owner ruled: the panel path composes it, and the calculator -- where the same text
 * can only be TYPED -- refuses it by U4 ("several values stated"), because a pricer's typed entry is never
 * parsed as layers (T6) and the typed box takes a single number only. The two surfaces therefore differ on this input BY RULING, and the divergence is
 * named here rather than listed as a defect: the calculator's figure for the layered row comes from typing the
 * composition's own numbers ("13+13"-style entries are T6's business, not this slice's).
 */
describe("SLICE 12d-6 -- a layered thickness on both surfaces (owner (a) + U4)", () => {
  const NR = "Nitrile Rubber Insulation";
  const layered: ParityCase = {
    cat: "hvac_insulation", unit: "RMT", desc: "50 mm", attrs: {},
    items: [{ item: NR, cladding: "26G Aluminium", thickness_mm: "Double layer of 19 mm thick", pipe_size_mm: "50 mm" }],
  };

  it("PANEL: the model-read layered answer composes two layers -- 991 / 238, the figure of the pure pricer", () => {
    const panel = panelHelper(configs, items, layered).compute(panelCtx(layered));
    expect(isSuggestion(panel)).toBe(true);
    expect((panel as { values?: Record<string, number> }).values).toEqual({ supply_rate: 991, install_rate: 238, combined_rate: 1229 });
    const view = (panel as ItemListSuggestion).itemList!;
    expect(view.items[0].working.some((w) => w === "BoQ says Double layer of 19 mm thick -> priced as two layers, 19 + 19 mm (38 mm); cladding on the outer layer only")).toBe(true);
  });

  it("CALCULATOR: the same text can only be TYPED, and the typed thickness box takes a single number only (U4) -- never one layer", () => {
    const edits = { items: [{ base: null, family: NR, attrs: { pipe_size_mm: "50", thickness_mm: "Double layer of 19 mm thick", cladding: "26G Aluminium" }, other: ["pipe_size_mm", "thickness_mm"] }] };
    const calc = calculatorHelper(configs, items).compute(calculatorCtx("HVAC", "hvac_insulation"), {
      [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(edits), [ROW_UNIT_OVERRIDE_KEY]: "mts",
    });
    expect(isSuggestion(calc)).toBe(true);
    expect((calc as { values?: Record<string, number> }).values).toEqual({});
    const view = (calc as ItemListSuggestion).itemList!;
    expect(view.items[0].reason).toBe("Type the thickness as a single number in mm");
  });

  it("the two surfaces AGREE on a plain thickness -- typed or model-read \"19 mm\" is 615 / 224 on both", () => {
    const plain: ParityCase = { ...layered, items: [{ ...layered.items![0], thickness_mm: "19 mm" }] };
    const panel = panelHelper(configs, items, plain).compute(panelCtx(plain));
    const edits = { items: [{ base: null, family: NR, attrs: { pipe_size_mm: "50", thickness_mm: "19 mm", cladding: "26G Aluminium" }, other: ["pipe_size_mm", "thickness_mm"] }] };
    const calc = calculatorHelper(configs, items).compute(calculatorCtx("HVAC", "hvac_insulation"), {
      [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(edits), [ROW_UNIT_OVERRIDE_KEY]: "mts",
    });
    expect((panel as { values?: Record<string, number> }).values).toEqual({ supply_rate: 615, install_rate: 224, combined_rate: 839 });
    expect((calc as { values?: Record<string, number> }).values).toEqual({ supply_rate: 615, install_rate: 224, combined_rate: 839 });
  });
});

/**
 * SLICE 12d-8 / T2 (owner standing rule 1, approved 2026-10-08) -- EVERY DERIVATION-TAB RULE HAS A PARITY CASE.
 *
 * The 12d-7 sweep found that a rule can fire on the panel and silently NOT fire on the calculator (F-1: the
 * stale-pick clearing let a ruled default re-price a cleared pick; F-2: the option match discarded the reader's
 * note; F-3: a size typed into a model-opened box was cleared). So each rule the Derivation tab lists for
 * Insulation and ADP is run here through BOTH paths on the LIVE v33 asset (read at runtime, never the dated
 * `parityMaster.json` snapshot -- these are rules, and the rules are the asset's), and the two must agree
 * unless an owner ruling says they cannot, BY NAME:
 *
 *   T6 / U4   a layered thickness can only be TYPED on the calculator, and the typed box takes a single
 *             number -- the calculator refuses where the panel prices (12d-1b / 12d-6).
 *   R4        a cladding the family does not offer (foil on Acoustic, glass cloth on sheet insulation) is NOT a
 *             dropdown option on the calculator, so the pick is cleared under R1 and the row refuses with the
 *             "choose again" sentence where the panel refuses with the rule's own (12d-8, owner R4 option b).
 *   F_row_text_not_an_input   the calculator has no row text, so `named_in_row` / `refuse_on_unit_class.words`
 *             cannot fire there (12d-4a, accepted by owner).
 *   C_unit_not_offered   a BoQ row may arrive in a unit the family has NO rule for (the panel refuses "no SKU per
 *             sq.m ...") or one the picker hides (`units_not_offered`, owner S10) -- the calculator's picker offers only
 *             the classes the family prices in, so the two surfaces are fed different units BY DESIGN and the
 *             divergence is the unit class itself, never a figure computed from the same inputs.
 *
 * The covered set is pinned EQUAL to the set `itemListRuleOrder` generates (the same guard as
 * `ruleReachability.test.ts`), so a new rule with no parity case fails here too. A listed exclusion that
 * STOPS differing fails too -- a stale exclusion hides a rule that now reaches the calculator.
 */
describe("SLICE 12d-8 / T2 -- one parity case per Derivation-tab rule, on the live v33 asset", () => {
  const live = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v33.json", import.meta.url),
  );
  const cfg33 = new Map<string, RateCategoryConfig>(live.category_configs.map((c) => [c.category_id, c]));
  const items33: RateMasterItem[] = live.items.map((it) => ({ ...it, discipline: live.discipline } as RateMasterItem));
  const INS = "hvac_insulation", ADP = "hvac_adp";
  const NR = "Nitrile Rubber Insulation", THM = "Thermal Nitrile Insulation",
    ACO = "Acoustic Nitrile Insulation", FGB = " Fiberglass Rigid Board Insulation, Density 48Kg/m3", CLO = "Cladding Only";
  const NIT = { item: NR, cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" };
  const THMI = { item: THM, cladding: "No", thickness_mm: "19" };
  type Expect = "agree" | { excludedBy: string; what?: string };
  interface RuleCase { id: string; rule: string; c: ParityCase; expect: Expect }
  const mk = (cat: string) => (id: string, rule: string, unit: string, item: Record<string, string>, expect: Expect = "agree", extra: Partial<ParityCase> = {}): RuleCase =>
    ({ id, rule, c: { cat, unit, desc: "", attrs: {}, items: [item], ...extra }, expect });
  const ins = mk(INS), adp = mk(ADP);
  const T6U4 = { excludedBy: "T6 (12d-1b) + U4 (12d-6): a typed thickness is a single number; the calculator refuses what the panel composes" };
  const R4 = { excludedBy: "owner R4 option (b), 12d-8: the cladding is not offered on this family, so the calculator clears it under R1 and refuses with its own sentence" };
  const ROWTEXT = { excludedBy: "F_row_text_not_an_input (12d-4a, accepted by owner): the calculator has no row text, so the word rule cannot fire there" };
  // ADP-3a: an unstocked combination reaches the calculator only as a stale pick -- its options are the stocked ones
  const STALE = { excludedBy: "12c-S stale-pick clearing (12d-7 F-1): the calculator offers only stocked combinations, so one it is handed is cleared ('choose again') where the panel names the unstocked fact; neither side prices" };
  const UNIT = { excludedBy: "C_unit_not_offered: the calculator's picker offers only the classes the family prices in, so the two surfaces are fed different units by design", what: "item unit class" };
  /** Tab lines that are NOT panel-path rules (a catalogue rule the pricer never reads), by name. */
  const NOT_PANEL_RULES = ["A catalogue cell derived from another row's cell follows its base"];
  // ADP-4a (owner D2): the one line fitting every laddered value to the catalogue, on ADP's tab
  const FIT = "Fitting the stated diameter, neck size, torque, panel ratio or plenum thickness to the catalogue";
  // ADP-4a (AC1 c), MEASURED, not ruled: on v33 a per-number cross-talk's size reaches the calculator as one box its two
  // component readers do not split, so the calculator refuses "no height stated" where the panel prices 1044 / 360 -- on
  // v33 only. v49's face boxes (ADP-3b) closed it: the same row agrees on v49 and v50 (the ADP-3c case R2 here, and
  // adp4a.test.ts's v50 case). Reported as a finding in the ADP-4a report; no price moves.
  const V33_CROSSTALK = { excludedBy: "ADP-4a finding (measured, pre-existing on v33 only): the v33 calculator's one size box is not split into the cross-talk's width and height, so it refuses where the panel prices; v49 / v50 agree" };
  const INCH = "1-1/4" + '"';

  const CASES: RuleCase[] = [
    ins("I1", "The row's unit decides which kind of rate applies", "sqft", THMI),
    ins("I2", "The item's own kind decides which products can price it", "RMT", NIT),
    ins("I3", "A row that names no material takes the kind its row implies", "RMT", { ...NIT, item: "None" }),
    ins("I4", "A material the model could not match to any kind refuses", "RMT", { ...NIT, item: "none of these", material_as_written: "XLPE foam" }),
    ins("I5", "A material the catalogue does not stock refuses by name, whatever kind was picked", "RMT", { ...NIT, material_as_written: "EPDM closed cell" }),
    // 12e-6 AC5 INVERTED by mechanical authority: BEFORE `ins("I6", ..., "sqm", NIT, UNIT)` -- Nitrile Rubber on a per-sq.m row now
    // prices as Thermal Nitrile (I29 below); a kind outside the row-kind pair keeps the unit-class exclusion
    ins("I6", "That kind's rule for that unit", "sqm", { item: "Tubular Puf Insulation", cladding: "No", thickness_mm: "25", pipe_size_mm: "100" }, UNIT),
    ins("I7", "The facts that rule needs before it can price", "RMT", { item: NR, cladding: "26G Aluminium", thickness_mm: "19" }),
    ins("I8", "A thickness the model writes as layers is priced as those layers", "RMT", { ...NIT, thickness_mm: "Double layer of 19mm thick" }, T6U4),
    ins("I9", "Several thickness values stated take the highest", "RMT", { ...NIT, thickness_mm: "13 / 19 / 25" }),
    ins("I10", "A pipe size written in inches is converted to millimetres", "RMT", { ...NIT, pipe_size_mm: INCH }),
    ins("I11", "A fact the row does not mention takes its ruled value", "RMT", { ...NIT, cladding: "None" }),
    ins("I12", "Aluminium Foil as the cladding on Nitrile Rubber Insulation, Tubular Puf Insulation is priced as 26G Aluminium", "RMT", { ...NIT, cladding: "Aluminium Foil" }),
    ins("I13", "Aluminium Foil as the cladding on Acoustic Nitrile Insulation refuses", "sqm", { item: ACO, cladding: "Aluminium Foil", thickness_mm: "19" }, R4),
    ins("I14", "Glass Cloth as the cladding on a per-sq.m row of Thermal Nitrile Insulation, Acoustic Nitrile Insulation, Fiberglass Rigid Board Insulation, Density 48Kg/m3 refuses", "sqm", { ...THMI, cladding: "Glass Cloth with paint" }, R4),
    ins("I15", "A cladding named in the row's own text but read as not mentioned refuses", "RMT", { ...NIT, cladding: "None" }, ROWTEXT, { desc: "Nitrile insulation with 26G aluminium cladding" }),
    ins("I16", "A Fiberglass Rigid Board Insulation, Density 48Kg/m3 row stating its own figure in the insulation material as written carries a line saying what was priced", "sqm", { item: FGB, cladding: "No", thickness_mm: "25", material_as_written: "Fiberglass rigid board 32 kg/m3" }),
    ins("I17", "Fitting the stated pipe size to the catalogue", "RMT", NIT),
    ins("I18", "Fitting the stated thickness to the catalogue", "RMT", { ...NIT, pipe_size_mm: "19.05", thickness_mm: "30" }),
    ins("I19", "Then the priced steps below, in their own order", "RMT", NIT),
    ins("I20", "A rate read live from another catalogue row", "sqm", { item: CLO, cladding: "26G Aluminium" }),
    ins("I21", "A cost the rules compute from the Pricing Inputs and the row's own geometry is shown greyed, never typed", "RMT", NIT),
    ins("I23", "The rate converts to the unit the row is written in", "sqft", THMI),
    ins("I24", "Multiplied by how many of the item one unit of the row pays for", "RMT", NIT),
    // ── SLICE 12e-6 (AC14 / U9): the lines this slice adds to the v33-generated tab, one parity case each ──
    ins("I26", "A 'none of these' answer where the BoQ names no material takes the kind its row implies", "RMT", { ...NIT, item: "none of these" }),
    ins("I27", "A material written with an alternative prices the stocked one", "RMT", { ...NIT, material_as_written: "nitrile rubber/XLPE" }),
    ins("I28", "Cross-linked polyethylene, XPE, FR-XPE and a co-extruded jacket or covering are XLPE and refuse by name", "RMT", { ...NIT, item: "none of these", material_as_written: "cross-linked polyethylene" }),
    ins("I29", "A row-kind material on the other row kind prices as the one for the row's unit", "sqm", { item: NR, cladding: "No", thickness_mm: "19" }),
    ins("I30", "A thickness range takes the higher value", "RMT", { ...NIT, thickness_mm: "13-19 mm" }),
    ins("I31", "Fixings and duct material in the row are not a cladding", "RMT", { ...NIT, cladding: "None" }, "agree", { desc: "Nitrile insulation fixed with GI strip on a GI duct" }),
    // ── SLICE 12e-6c (owner U2 / R, 2026-10-18): the two lines this slice adds to the v33-generated tab, one parity case each ──
    ins("I32", "A pipe size written as a bare number that could be inches refuses", "RMT", { ...NIT, pipe_size_mm: "1" }),
    ins("I33", "RPUF with no material answered prices as Tubular Puf Insulation", "RMT", { item: "none of these", cladding: "No", thickness_mm: "40", pipe_size_mm: "100", material_as_written: "RPUF" }),
    // ── ADP-1 (owner F4, 2026-10-19): the one line it adds to the v33-generated tab, one parity case ──
    ins("I34", "RPUF on a per-sq.m row refuses by name", "sqm", { item: "none of these", cladding: "No", thickness_mm: "50", material_as_written: "RPUF" }),
    adp("A1", "The row's unit decides which kind of rate applies", "nos", { family: "VCD", variant: "GI rectangular", size_mm: "600x600" }),
    adp("A2", "The item's own kind decides which products can price it", "nos", { family: "grille, type not stated", damper: "with", size_mm: "600x150" }),
    // INVERTED at ADP-4a (owner AC1 b, R1 line 3: on an item catalogue the thing not matched is an ITEM) by mechanical
    // authority. BEFORE: rule "A material the model could not match to any kind refuses". The case is unchanged.
    adp("A3", "An item the model could not match to any kind refuses", "nos", { family: "none of these", damper: "with", dia_mm: "200" }),
    adp("A4", "That kind's rule for that unit", "rmt", { family: "spigot", dia_mm: "200" }, UNIT),
    // INVERTED at ADP-4a (owner D2 "5 + 32": the not-offered unit is said in the stocked-units line) by mechanical authority.
    // BEFORE: rule "A kind the catalogue does not price in the row's unit". The case and its exclusion are unchanged.
    adp("A5", "A kind not stocked in the row's unit refuses, naming the units it is stocked in", "nos", { family: "double-skin plenum", thickness_mm: "25", size_mm: "600x600" }, UNIT),
    adp("A6", "The facts that rule needs before it can price", "nos", { family: "actuator", ul: "no" }),
    adp("A7", "A fact the row does not mention takes its ruled value", "nos", { family: "round diffuser", damper: "None", dia_mm: "200" }),
    adp("A8", "A ruling that replaces a value the row DID state", "nos", { family: "fire damper", variant: "motorised", ul: "yes", size_mm: "600x600" }),
    // INVERTED at ADP-4a (owner D2 "23-27 into one 'fitting to the catalogue' line naming each attribute") by mechanical
    // authority. BEFORE: A9-A13 each named its own "Fitting the stated <value> to the catalogue" line. The five cases are unchanged.
    adp("A9", FIT, "nos", { family: "round diffuser", damper: "with", dia_mm: "220" }),
    adp("A10", FIT, "nos", { family: "square diffuser", damper: "with", neck_mm: "320" }),
    adp("A10b", "A stated outer size is matched beside the neck size on square diffuser", "nos", { family: "square diffuser", damper: "with", size_mm: "595x595" }),
    adp("A11", FIT, "nos", { family: "actuator", ul: "no", torque: "12" }),
    adp("A12", FIT, "nos", { family: "control panel", panel_ratio: "5" }),
    adp("A13", FIT, "sqm", { family: "double-skin plenum", thickness_mm: "30" }),
    adp("A14", "Then the priced steps below, in their own order", "nos", { family: "round diffuser", damper: "with", dia_mm: "200" }),
    adp("A16", "The rate converts to the unit the row is written in", "sqft", { family: "VCD", variant: "GI rectangular" }),
    adp("A17", "Multiplied by how many of the item one unit of the row pays for", "nos", { family: "round diffuser", damper: "with", dia_mm: "200", qty_per_row_unit: "2" }),
    // ── ADP-2 H5 fix (a) (owner 2026-10-20): v33's R13 reads the air stream, so the both-streams line is generated here too ──
    adp("A18", "A row naming supply and return air leaves the damper as read", "nos", { family: "linear grille", air: "supply", damper: "None", size_mm: "600x150" }, "agree", { desc: "Supply / Return air linear grille" }),
    // ── ADP-3a (owner 13:35 / B6 / H2; AC6): the lines it adds to the v33-generated tab (LAST), one parity case each per tab ──
    ins("I35", "A kind not stocked in the row's unit refuses, naming the units it is stocked in", "nos", NIT, UNIT),
    ins("I36", "An unstocked combination names only the facts the kind's products vary on", "RMT", { item: "Tubular Puf Insulation", cladding: "Glass Cloth", thickness_mm: "25", pipe_size_mm: "100" }, STALE),
    adp("A19", "A kind not stocked in the row's unit refuses, naming the units it is stocked in", "rmt", { family: "actuator", ul: "no", torque: "10" }, UNIT),
    adp("A20", "An unstocked combination names only the facts the kind's products vary on", "nos", { family: "fire damper", variant: "UL", ul: "no", size_mm: "600x600" }),
    adp("A21", "A per-number item needs Size (W x H), or Area band; with neither stated it refuses, naming both", "nos", { family: "VCD", variant: "GI rectangular" }),
    // ── ADP-4a (owner AC1 c; standing block 39: each rule keeps one named case): the rules that ran with no line, now each with
    // a line on v33's tab (its own conversion rule texts), one parity case each ──
    adp("A22", "Per-number row: per-sq.m rate x W x H", "nos", { family: "VCD", variant: "GI rectangular", size_mm: "600x300" }),
    adp("A23", "Area band: per-sq.m rate x the band's maximum area", "nos", { family: "VCD", variant: "GI rectangular", area_band: "up to 0.5 sqm" }),
    adp("A24", "Per-metre grille: per-sq.m rate x height in metres", "rmt", { family: "linear grille", damper: "with", size_mm: "1000x150" }),
    adp("A25", "Per piece: per-metre rate x 2.5 m standard length", "nos", { family: "flexible duct", insulated: "with", dia_mm: "200" }),
    adp("A26", "Per-number mixing box at any size: per-sq.m cost x 2(WH + HD + WD) + 150, rounded up, then the markup", "nos", { family: "mixing box / LP plenum", insulated: "with", size_mm: "450x450x350" }),
    adp("A27", "A per-number cross-talk is priced by its own formula", "nos", { family: "cross-talk", size_mm: "500x250" }, V33_CROSSTALK),
    adp("A28", "A panel ratio is read from '1:N' as N", "nos", { family: "control panel", panel_ratio: "1:6" }),
    adp("A29", "A plenum thickness below 5 mm is a sheet gauge, not a thickness, and refuses", "sqm", { family: "double-skin plenum", thickness_mm: "1.0 mm" }),
    adp("A30", "An area written in square feet refuses", "nos", { family: "VCD", variant: "GI rectangular", area_band: "up to 5 sq.ft" }),
    adp("A31", "A size written in metres or centimetres is read in millimetres", "nos", { family: "round diffuser", damper: "with", dia_mm: "20 cm" }),
  ];

  it("THE GUARD: the rules these cases name EQUAL the rules the live config generates (Insulation 24, ADP 18)", () => {
    for (const cat of [INS, ADP]) {
      const generated = itemListRuleOrder(cfg33.get(cat)!, items33).map((l) => l.title);
      const named = new Set([...CASES.filter((r) => r.c.cat === cat).map((r) => r.rule), ...NOT_PANEL_RULES]);
      expect({ cat, uncovered: generated.filter((t) => !named.has(t)), dead: [...named].filter((t) => !generated.includes(t) && !NOT_PANEL_RULES.includes(t)) })
        .toEqual({ cat, uncovered: [], dead: [] });
    }
    for (const t of NOT_PANEL_RULES) expect(itemListRuleOrder(cfg33.get(INS)!, items33).some((l) => l.title === t)).toBe(true);
  });

  it.each(CASES.map((r) => [r.id, r] as const))("%s", (_, r) => {
    const run = runParity(cfg33, items33, r.c, "full");
    if (r.expect === "agree") {
      expect({ id: r.id, rule: r.rule, divergences: run.divergences }).toEqual({ id: r.id, rule: r.rule, divergences: [] });
    } else {
      // EXCLUDED by name: the two paths MUST differ (a listed exclusion that stops differing is a stale exclusion) ...
      expect({ id: r.id, excludedBy: r.expect.excludedBy, diverges: run.divergences.length > 0 }).toEqual({ id: r.id, excludedBy: r.expect.excludedBy, diverges: true });
      if (r.expect.what) {
        // ... on the named axis (the unit class: the two were fed different units, so any figure difference is the unit's)
        expect({ id: r.id, what: run.divergences.map((d) => d.what) }).toMatchObject({ id: r.id, what: expect.arrayContaining([r.expect.what]) });
      } else {
        // ... and never on a FIGURE both sides produced -- a divergence is always one side withholding
        expect({ id: r.id, bothPriced: hasPrice(run.panel) && hasPrice(run.calculator) }).toEqual({ id: r.id, bothPriced: false });
      }
    }
  });

  // INVERTED at ADP-3a (AC6: a parity case for each line it adds) by mechanical authority: BEFORE "exactly the seven named ones",
  // `toEqual(["I6", "I8", "I13", "I14", "I15", "A4", "A5"])`. The unit line's cases take the existing C_unit_not_offered
  // exclusion (the picker never offers an unstocked unit), and Insulation's unstocked combination the stale-pick one
  it("the exclusions are exactly the eleven named ones", () => {
    // ADP-4a: + A27, the cross-talk formula line's case on v33 (V33_CROSSTALK above; a NEW case, not an inversion -- the line
    // is new). BEFORE: the ten named ones.
    expect(CASES.filter((r) => r.expect !== "agree").map((r) => r.id)).toEqual(["I6", "I8", "I13", "I14", "I15", "A4", "A5", "I35", "I36", "A19", "A27"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// ADP-1 (owner rulings 2026-10-19; AC8: each new rule keeps one permanent calculator = panel parity case) -- every line
// the slice adds, through BOTH surfaces on v46 + ADP-1 (= v47; `applyAdp1`, pinned equal to the asset in its commit)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("ADP-1 parity -- one case per new rule (slot diffuser H3, plenum H4, F1 / F3 / F4), on v46 + ADP-1", () => {
  const v46 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v46.json", import.meta.url),
  );
  const a = applyAdp1(v46 as any) as typeof v46;
  const cfgA = new Map<string, RateCategoryConfig>(a.category_configs.map((c) => [c.category_id, c]));
  const itemsA: RateMasterItem[] = a.items.map((it) => ({ ...it, discipline: a.discipline } as RateMasterItem));
  const INS = "hvac_insulation", ADP = "hvac_adp";
  const NIT = { item: "Nitrile Rubber Insulation", cladding: "26G Aluminium", thickness_mm: "19" };
  const SLOT = "slot diffuser", MIX = "mixing box / LP plenum";
  const CASES_ADP1: Array<{ id: string; rule: string; c: ParityCase; excludedBy?: string }> = [
    { id: "N1", rule: "A per-number slot diffuser is priced from the per-metre rate", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: SLOT, damper: "with", slot_count: "3", size_mm: "1000x150" }] } },
    { id: "N2", rule: "A per-number slot diffuser without slot count refuses, naming what is missing", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: SLOT, damper: "with" }] } },
    { id: "N3", rule: "A per-number mixing box / LP plenum is priced from the per-sq.m rate", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: MIX, insulated: "with", size_mm: "450x450x350" }] } },
    { id: "N4", rule: "A per-number mixing box / LP plenum without width, height, depth refuses, naming what is missing", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: MIX, insulated: "with", size_mm: "2200 mm Length" }] } },
    { id: "N5", rule: "A slot count the catalogue does not stock refuses", c: { cat: ADP, unit: "rmt", desc: "", attrs: {}, items: [{ family: SLOT, damper: "with", slot_count: "4" }] },
      excludedBy: "not offered by design (the R4 shape): the calculator's Slots dropdown stocks 2 and 3 only, so a 4 cannot be picked -- it is cleared (R1) and refuses 'choose again' where the panel names the 4-slot" },
    { id: "N6", rule: "A piece length is typed in 'Piece length (m)', else read from the size", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: SLOT, damper: "without", slot_count: "2", size_mm: "600x150" }] } },
    // INVERTED at ADP-4a (owner AC1 b, R1 line 21: a title opens with a capital) by mechanical authority. BEFORE: "without as ...".
    { id: "N7", rule: "Without as the damper on a per-sq.m row of slot diffuser refuses", c: { cat: ADP, unit: "sqm", desc: "", attrs: {}, items: [{ family: SLOT, damper: "without" }] } },
    { id: "N8", rule: "A pipe size written as a bare number whose inch reading is above the largest refuses", c: { cat: INS, unit: "RMT", desc: "", attrs: {}, items: [{ ...NIT, pipe_size_mm: "4" }] } },
    { id: "N9", rule: "A GI frame or framework with perforated aluminium sheet, with no cladding answered, prices as GI Framework with perforated Al sheet", c: { cat: INS, unit: "sqm", desc: "", attrs: {}, items: [{ item: "Acoustic Nitrile Insulation", cladding: "None", thickness_mm: "19", cladding_as_written: "GI frame with perforated Al sheet" }] } },
    { id: "N10", rule: "RPUF on a per-sq.m row refuses by name", c: { cat: INS, unit: "sqm", desc: "", attrs: {}, items: [{ item: "none of these", cladding: "No", thickness_mm: "50", material_as_written: "RPUF" }] } },
  ];
  it("the cases name every new line of the ADP-1 config, and only those", () => {
    const t = (cat: string) => itemListRuleOrder(cfgA.get(cat)!, itemsA).map((l) => l.title);
    for (const r of CASES_ADP1) expect({ id: r.id, onTab: t(r.c.cat).includes(r.rule) }).toEqual({ id: r.id, onTab: true });
    expect(new Set(CASES_ADP1.map((r) => r.rule)).size).toBe(CASES_ADP1.length);
  });
  it.each(CASES_ADP1.map((r) => [r.id, r] as const))("%s: the calculator and the panel agree", (_, r) => {
    const run = runParity(cfgA, itemsA, r.c, "full");
    if (r.excludedBy) {
      // EXCLUDED by name: the two must differ (a stale exclusion fails) and neither may price
      expect({ id: r.id, diverges: run.divergences.length > 0, bothPriced: hasPrice(run.panel) || hasPrice(run.calculator) }).toEqual({ id: r.id, diverges: true, bothPriced: false });
      return;
    }
    expect({ id: r.id, rule: r.rule, divergences: run.divergences }).toEqual({ id: r.id, rule: r.rule, divergences: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// ADP-2 (owner rulings H5 / H7 / B3; AC6: each new rule keeps one permanent calculator = panel parity case) -- every line
// the slice adds, through BOTH surfaces on v46 + ADP-1 + ADP-2 (= v48; `applyAdp2`, pinned equal to the asset in its commit)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("ADP-2 parity -- one case per new rule (air stream H5, plenum H7, neck B3), on the ADP-1 config + ADP-2", () => {
  const v46 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v46.json", import.meta.url),
  );
  const a = applyAdp2(applyAdp1(v46 as any)) as typeof v46;
  const cfgA = new Map<string, RateCategoryConfig>(a.category_configs.map((c) => [c.category_id, c]));
  const itemsA: RateMasterItem[] = a.items.map((it) => ({ ...it, discipline: a.discipline } as RateMasterItem));
  const ADP = "hvac_adp", MIX = "mixing box / LP plenum", SQ = "square diffuser";
  const CASES_ADP2: Array<{ id: string; rule: string; c: ParityCase }> = [
    // INVERTED at ADP-4a (owner D2 "17 + 19": the air-stream rule is said in the defaults line) by mechanical authority.
    // BEFORE: rule "A damper not mentioned is decided by the air stream" (P1), "The length, width and height are typed in their
    // own boxes, else read from the size" (P4), "A neck size the catalogue does not stock can be typed in 'Other...'" (P6;
    // D2 "13 + 24"). The cases are unchanged; each names the merged line that now says its rule.
    { id: "P1", rule: "A fact the row does not mention takes its ruled value", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: SQ, air: "supply", damper: "None", neck_mm: "450 x 450" }] } },
    { id: "P2", rule: "A per-number mixing box / LP plenum with an area is priced from the per-sq.m rate", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: MIX, insulated: "with", area_band: "up to 0.5 sqm" }] } },
    { id: "P3", rule: "A per-number mixing box / LP plenum without an area, or length + width + height refuses, naming what is missing", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: MIX, insulated: "with", size_mm: "3000 mm Length" }] } },
    { id: "P4", rule: "The sizes are typed in their own boxes, else read from the size as written", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: MIX, insulated: "with", size_mm: "900x200x350mm Ht." }] } },
    { id: "P5", rule: "An area is typed in 'Area (sq.m)', else read from the area band, at its largest value", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: MIX, insulated: "without", area_band: "1.1 to 2.0 sqm" }] } },
    { id: "P6", rule: "Fitting the stated diameter, neck size, torque, panel ratio or plenum thickness to the catalogue", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: SQ, damper: "without", neck_mm: "225 x 225" }] } },
    // H5 fix (a) (owner 2026-10-20): the row names ONE stream under a heading naming both -> the row wins, the two agree
    { id: "P7", rule: "A row naming supply and return air leaves the damper as read", c: { cat: ADP, unit: "nos", desc: "Aluminium powder coated supply air diffuser 450x450", headings: ["Supply & return air diffusers"], attrs: {}, items: [{ family: SQ, air: "supply", damper: "None", neck_mm: "450 x 450" }] } },
  ];
  it("the cases name every new line of the ADP-2 config, and only those", () => {
    const t = (cat: string) => itemListRuleOrder(cfgA.get(cat)!, itemsA).map((l) => l.title);
    for (const r of CASES_ADP2) expect({ id: r.id, onTab: t(r.c.cat).includes(r.rule) }).toEqual({ id: r.id, onTab: true });
    expect(new Set(CASES_ADP2.map((r) => r.rule)).size).toBe(CASES_ADP2.length);
  });
  it.each(CASES_ADP2.map((r) => [r.id, r] as const))("%s: the calculator and the panel agree", (_, r) => {
    const run = runParity(cfgA, itemsA, r.c, "full");
    expect({ id: r.id, rule: r.rule, divergences: run.divergences }).toEqual({ id: r.id, rule: r.rule, divergences: [] });
  });
  // H5 fix (a): a row naming BOTH streams -- the panel keeps the damper as read ("without"), and the calculator, fed the
  // panel's fields, prices that same "without": the two agree (the calculator has no row text, but it needs none here)
  it("P7x: a row naming supply AND return air -- the calculator, fed the panel's damper, agrees", () => {
    const c: ParityCase = { cat: ADP, unit: "nos", desc: "Aluminium powder coated Supply / Return air diffuser of 450x450 mm neck size", attrs: {}, items: [{ family: SQ, air: "supply", damper: "None", neck_mm: "450 x 450" }] };
    const run = runParity(cfgA, itemsA, c, "full");
    expect({ divergences: run.divergences, bothPriced: hasPrice(run.panel) && hasPrice(run.calculator) }).toEqual({ divergences: [], bothPriced: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// ADP-3b (owner B1; D1 / D2; AC4: each new rule keeps one permanent calculator = panel parity case) -- every line the
// slice adds (and ADP-3a's either-or line, re-worded by the new group), through BOTH surfaces on v46 + ADP-1 + ADP-2 +
// ADP-3b (= v49; `applyAdp3b`, pinned equal to the asset in its commit)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("ADP-3b parity -- one case per new rule (face boxes B1, third part D1, width as height D2), on the ADP-2 config + ADP-3b", () => {
  const v46 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v46.json", import.meta.url),
  );
  const a = applyAdp3b(applyAdp2(applyAdp1(v46 as any))) as typeof v46;
  const cfgB = new Map<string, RateCategoryConfig>(a.category_configs.map((c) => [c.category_id, c]));
  const itemsB: RateMasterItem[] = a.items.map((it) => ({ ...it, discipline: a.discipline } as RateMasterItem));
  const ADP = "hvac_adp";
  const CASES_ADP3B: Array<{ id: string; rule: string; c: ParityCase }> = [
    // INVERTED at ADP-4a (owner D2 "16 + 35") by mechanical authority. BEFORE: rule "The width and height are typed in their own
    // boxes, else read from the size". The case is unchanged.
    { id: "Q1", rule: "The sizes are typed in their own boxes, else read from the size as written", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: "VCD", variant: "GI rectangular", size_mm: "550X300" }] } },
    { id: "Q2", rule: "A third part of a size never displaces the face", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: "sound attenuator", size_mm: "600 x 300 x 900 mm long" }] } },
    { id: "Q3", rule: "A kind that reads only the height, sized by one dimension written as a width, takes it as the height", c: { cat: ADP, unit: "rmt", desc: "", attrs: {}, items: [{ family: "linear grille", size_mm: "150mm width" }] } },
    { id: "Q4", rule: "A per-number item needs Width + Height, or Area band; with neither stated it refuses, naming both", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: "VCD", variant: "GI rectangular" }] } },
  ];
  it("the cases name every new line of the ADP-3b config, and only those", () => {
    const t = (cat: string) => itemListRuleOrder(cfgB.get(cat)!, itemsB).map((l) => l.title);
    for (const r of CASES_ADP3B) expect({ id: r.id, onTab: t(r.c.cat).includes(r.rule) }).toEqual({ id: r.id, onTab: true });
    expect(new Set(CASES_ADP3B.map((r) => r.rule)).size).toBe(CASES_ADP3B.length);
  });
  it.each(CASES_ADP3B.map((r) => [r.id, r] as const))("%s: the calculator and the panel agree", (_, r) => {
    const run = runParity(cfgB, itemsB, r.c, "full");
    expect({ id: r.id, rule: r.rule, divergences: run.divergences }).toEqual({ id: r.id, rule: r.rule, divergences: [] });
  });

  // ADP-3c (owner 2026-10-21 01:31 / 01:55; AC3): its one line keeps permanent parity cases on the same config (= v49; no
  // config change) -- a length beside a labelled width (the 00302 r67 shape), and the face-matched cross-talk whose SKU
  // is found only when the label, not the position, decides
  const CASES_ADP3C: Array<{ id: string; rule: string; c: ParityCase }> = [
    // INVERTED at ADP-4a (owner D3 "35 + 38": the ruling is said in THE size line) by mechanical authority. BEFORE: R1 and R2
    // named "A two-part size on a Width + Height item is the face, whatever its parts are called". The cases are unchanged.
    { id: "R1", rule: "The sizes are typed in their own boxes, else read from the size as written", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: "curved grille", size_mm: "600(L)X150mm width" }] } },
    { id: "R2", rule: "The sizes are typed in their own boxes, else read from the size as written", c: { cat: ADP, unit: "nos", desc: "", attrs: {}, items: [{ family: "cross-talk", size_mm: "250(L) x 500(W)" }] } },
  ];
  it("ADP-3c: the cases name the new line, and it is on the tab", () => {
    const t = itemListRuleOrder(cfgB.get(ADP)!, itemsB).map((l) => l.title);
    // INVERTED at ADP-4a (owner D3) by mechanical authority. BEFORE: `{ onTab: true, last: true }` -- the line was LAST; the size
    // line it is now said in sits with the other reading rules. The ruling's own words are pinned in adp3c.test.ts.
    for (const r of CASES_ADP3C) expect({ id: r.id, onTab: t.includes(r.rule) }).toEqual({ id: r.id, onTab: true });
  });
  it.each(CASES_ADP3C.map((r) => [r.id, r] as const))("ADP-3c %s: the calculator and the panel agree, and both price", (_, r) => {
    const run = runParity(cfgB, itemsB, r.c, "full");
    expect({ id: r.id, divergences: run.divergences, bothPriced: hasPrice(run.panel) && hasPrice(run.calculator) }).toEqual({ id: r.id, divergences: [], bothPriced: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 12e-3c (AC8; standing block 39: each rule keeps one permanent parity case) -- ONE CASE PER NEW BEHAVIOUR,
// each through BOTH surfaces on the v37 asset: the BoQ row (a stored model answer, the row's own unit) and the
// calculator (the same answers entered by hand). A Piping row's sections are not part of the generated feed (it
// carries a block's fields, not the sections under it), so each case states both entries explicitly.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("12e-3c parity -- the quantity link, the calculator's 'pick' sentence, the shown default, the Insulated default (v37)", () => {
  const v37 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v37.json", import.meta.url),
  );
  const cfg37 = new Map<string, RateCategoryConfig>(v37.category_configs.map((c) => [c.category_id, c]));
  const items37: RateMasterItem[] = v37.items.map((it) => ({ ...it, discipline: v37.discipline } as RateMasterItem));
  const PIP = "hvac_piping", NITRILE = "Nitrile Rubber Insulation", SEC = "insulation";

  /** One case: the model's answer + what the pricer then does on the row, and the same thing entered on the calculator. */
  interface Case12e3c {
    id: string;
    rule: "AC0 quantity link" | "AC1 pick a cladding" | "AC4 a default shows its value" | "AC5 Insulated default";
    row: Array<Record<string, string>>;
    rowEdit?: (state: ItemListEditState) => ItemListEditState;
    calculator: ItemListEditState;
  }
  const CASES_12E3C: Case12e3c[] = [
    { id: "Q1", rule: "AC0 quantity link",
      row: [{ pipe_type: "MS", size_mm: "32" }, { section: SEC, item: NITRILE, cladding: "26G Aluminium", thickness_mm: "13" }],
      rowEdit: (st) => applyItemEdit(st, { op: "set_qty", index: 0, qty: "2" }),
      calculator: { items: [{ base: null, family: "MS", attrs: { size_mm: "32", insulated: "Yes" }, other: ["size_mm"], qty: "2",
                              sections: { [SEC]: { base: null, family: NITRILE, attrs: { cladding: "26G Aluminium", thickness_mm: "13" } } } }] } },
    { id: "W1", rule: "AC1 pick a cladding",
      row: [{ pipe_type: "MS", size_mm: "32" }, { section: SEC, item: NITRILE, thickness_mm: "13" }],
      calculator: { items: [{ base: null, family: "MS", attrs: { size_mm: "32", insulated: "Yes" }, other: ["size_mm"],
                              sections: { [SEC]: { base: null, family: NITRILE, attrs: { thickness_mm: "13" } } } }] } },
    { id: "D1", rule: "AC4 a default shows its value",
      row: [{ pipe_type: "MS", size_mm: "100" }, { section: SEC, item: NITRILE, cladding: "26G Aluminium" }],
      calculator: { items: [{ base: null, family: "MS", attrs: { size_mm: "100", insulated: "Yes" }, other: ["size_mm"],
                              sections: { [SEC]: { base: null, family: NITRILE, attrs: { cladding: "26G Aluminium" } } } }] } },
    { id: "T1", rule: "AC5 Insulated default",
      row: [{ pipe_type: "MS", size_mm: "32" }],
      calculator: { items: [{ base: null, family: "MS", attrs: { size_mm: "32" }, other: ["size_mm"] }] } },
  ];
  const list = (r: unknown): { s: ItemListSuggestion; v: ItemListView } => {
    if (!isSuggestion(r as never)) throw new Error("expected a suggestion");
    return { s: r as ItemListSuggestion, v: (r as ItemListSuggestion).itemList! };
  };
  function both(c: Case12e3c) {
    // 12e-4b (owner D-2): an insulation answer carries the marker the run stores -- `section`, on the ITEM beside
    // its attributes (BEFORE: `items: c.row`, no marker; the item was told apart by lacking pipe_type)
    const pc: ParityCase = { cat: PIP, unit: "mts", desc: "", attrs: {}, items: c.row.map(({ section: _s, ...a }) => a) };
    const stored = extractionRowFor(pc) as ExtractionRow & { items: Array<{ attributes: unknown; section?: string }> };
    c.row.forEach((a, i) => { if (a.section) stored.items[i].section = a.section; });
    const ph = makePricingSheetHelper({ configsByCategory: cfg37, items: items37, extractionByRow: new Map([[stored.excelRow, stored]]) });
    let row = list(ph.compute(panelCtx(pc)));
    if (c.rowEdit) row = list(ph.compute(panelCtx(pc), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(c.rowEdit(row.v.editState)) }));
    const calc = list(calculatorHelper(cfg37, items37).compute(calculatorCtx("HVAC", PIP),
      { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(c.calculator), [ROW_UNIT_OVERRIDE_KEY]: "mts" }));
    return { row, calc };
  }
  const sec = (v: ItemListView): ItemBlockView | undefined => v.items[0].sections?.[0]?.view.items[0];
  const fieldOf = (b: ItemBlockView | undefined, id: string) => b?.fields.find((f) => f.id === id);
  /** What both surfaces must agree on, read off the view each one drew. */
  const facts = (x: { s: ItemListSuggestion; v: ItemListView }) => {
    const b = sec(x.v);
    const t = fieldOf(b, "thickness_mm"), ins = fieldOf(x.v.items[0], "insulated");
    return {
      values: x.s.values, rowPriced: x.v.rowPriced, pipe: [x.v.items[0].figures, x.v.items[0].qty],
      section: b ? { state: b.state, figures: b.figures, qty: b.qty, qtyTag: b.qtyMirrorTag ?? null, qtyAmber: b.qtyDefaulted } : null,
      thickness: t ? { defaulted: t.defaulted, rule: t.rule ?? null, box: t.otherMode ? t.typedValue : t.value } : null,
      insulated: ins ? { value: ins.value } : null,
    };
  };

  it("exactly one case per new behaviour -- four, named", () => {
    expect(CASES_12E3C.map((c) => `${c.id} ${c.rule}`)).toEqual(["Q1 AC0 quantity link", "W1 AC1 pick a cladding", "D1 AC4 a default shows its value", "T1 AC5 Insulated default"]);
  });
  it.each(CASES_12E3C.map((c) => [c.id, c] as const))("%s: the BoQ row and the calculator agree on every figure, quantity, tag and shown value", (_, c) => {
    const { row, calc } = both(c);
    expect(facts(row)).toEqual(facts(calc));
  });
  it("Q1 (AC0): both show the section's quantity 2 tagged 'from pipe', and price pipe and insulation at 2", () => {
    const { row, calc } = both(CASES_12E3C[0]);
    for (const x of [row, calc]) {
      expect({ qty: sec(x.v)!.qty, tag: sec(x.v)!.qtyMirrorTag, amber: sec(x.v)!.qtyDefaulted }).toEqual({ qty: "2", tag: "from pipe", amber: false });
      expect(x.v.rowPriced).toBe(true);
      expect(x.v.items[0].figures).toMatchObject({ supply_rate: 1200, install_rate: 350 });     // MS 32 at 2: 2 x 600 / 175
    }
  });
  it("W1 (AC1): the ONE named wording difference -- the row says 'could not tell cladding', the calculator 'pick a cladding'; nothing else differs", () => {
    const { row, calc } = both(CASES_12E3C[1]);
    expect(sec(row.v)!.reason).toBe("could not tell cladding");
    expect(sec(calc.v)!.reason).toBe("pick a cladding");
    expect(row.v.reason!.split("could not tell cladding").join("pick a cladding")).toBe(calc.v.reason);
  });
  it("D1 (AC4): both show the ruled 9 in the thickness box beside its amber line, and both refuse on pipe size 100", () => {
    const { row, calc } = both(CASES_12E3C[2]);
    for (const x of [row, calc]) {
      const t = fieldOf(sec(x.v), "thickness_mm")!;
      expect({ defaulted: t.defaulted, box: t.typedValue, other: t.otherMode, rule: t.rule }).toEqual({ defaulted: true, box: "9", other: true, rule: "thickness not mentioned -> 9 mm, then the ladder" });
      expect(sec(x.v)!.reason).toBe("pipe size 100 is above the largest size on the sheet (53.98)");
    }
  });
  it("T1 (AC5): both show Insulated 'No' amber with its line -- the row because the model read no insulation, the calculator because nobody picked", () => {
    const { row, calc } = both(CASES_12E3C[3]);
    for (const x of [row, calc]) {
      const f = fieldOf(x.v.items[0], "insulated")!;
      expect({ value: f.value, defaulted: f.defaulted, rule: f.rule }).toEqual({ value: "No", defaulted: true, rule: "insulation not mentioned -> No" });
      expect(x.s.values).toEqual({ supply_rate: 600, install_rate: 175, combined_rate: 775 });
    }
  });
});

// =====================================================================================================
// SLICE 12e-4c AC8 -- THE 29 REAL PIPING ROWS THE CAPPED RUN READ, calculator = panel
// =====================================================================================================
/**
 * The run of 2026-10-13 (whole-sheet Suggest on four sheets; run documents BRSR-26-00393 .. BRSR-26-00396) read 29
 * Piping rows through the real route with `claude-opus-4-8` on HVAC v38. Each row below is the model's answer AS THE
 * RUN STORED IT (every definition present, a value or null; the `section` marker on the item), with the row's own
 * text, unit and headings -- nothing here was written by hand except the `want` figures, which are what the panel
 * showed and were checked row by row against the row's own words (the report's AC6).
 *
 * The CALCULATOR is fed the panel's own final answers, block by block and section by section, the way a pricer
 * would enter them: a select or a box is bound to the value shown, an "Other..." box to the text typed; a field
 * the panel MIRRORS from its pipe ("from pipe") is not entered -- it mirrors in the calculator too.
 */
describe("12e-4c AC8 -- the 29 real Piping rows the capped run read (BRSR-26-00393 .. 00396): calculator = panel", () => {
  const v38 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v38.json", import.meta.url),
  );
  const cfg38 = new Map<string, RateCategoryConfig>(v38.category_configs.map((c) => [c.category_id, c]));
  const items38: RateMasterItem[] = v38.items.map((it) => ({ ...it, discipline: v38.discipline } as RateMasterItem));
  const PIP = "hvac_piping";

  interface RealRow {
    id: string;
    unit: string;
    desc: string;
    h: string;
    items: Array<{ a: Record<string, string | null>; s?: string }>;
    /** What the panel showed: [supply, install], or the sentence it refused with. */
    want: [number, number] | string;
  }
  const HEADINGS: Record<string, string[]> = {
    "H1": ["VRF SYSTEM", "Supplying, Installing, testing and commissioning of interconnecting Liquid / Gas refrigerant copper piping duly insulated with Close cell elastomeric Nitrile rubber Class \u2018O\u2019 tubular insulation of thickness 13 or 19 mm as mentioned below with minimum 45 Kg/ m2 density, thermal conductivity 0.037 W/MK or better at 20 deg mean temperature. The exposed to sun refrigerant pipe insulation shall be cover with UL certified UV protective coating with 7 mill fiber glass cloth applied by suitable adhesive. All the copper piping shall be eddy current test certified. All piping inside & outside the building shall run inside and propoerly supported using cable trays. Notes: 1. This items shall include cost of refrigerant filling for required lenghth of pipe. 2. The piping upto 15.1 mm will be soft drawn and higher sizes will be hard drawn. 3. Insulation thickness to be 13mm for liquid line and 19mm for suction line 4. The cost of cable trays has been has been considered elsewhere in the tender. 5. The cost of UL certified UV protective coating has been has been considered elsewhere in the tender."],
    "H2": ["VRF SYSTEM", "Supply, installation, testing and commissioning Rigid heavy class (10KG) uPVC Condensate Drain piping of following sizes with minimum 6/9 mm nitrile rubber insulation over the pipes, complete with fittings, supports, U trap arrangement, clean plug and accessories for units as per specifications and technical specification."],
    "H3": ["LOW SIDE WORKS", "COPPER REFRIGERANT PIPING: Supply and Laying of copper refrigerant pipe with specified thickness of 13mm thick nitrile rubber insulation tubes and joints sealed with black cotton tape."],
    "H4": ["LOW SIDE WORKS", "DRAIN PIPE: Supply & installation of CPVC drain pipe with 6mm nitrile rubber insulation for condensate drain."],
    "H5": [],
    "H6": ["Approved Makes - Air conditioners - Blue Star , Voltas , Carrier Voltage Stabiliser- V Guard", "AIRCONDITIONING FOR SOUTH INDIAN BANK RO TRIVANDRUM"],
    "H7": ["Approved Makes - Air conditioners - Blue Star , Voltas , Carrier Voltage Stabiliser- V Guard"],
    "H8": ["FOR HUB ROOM", "COPPER REFRIGERANT PIPING"],
    "H9": ["FOR HUB ROOM", "CPVC and SDR 11 grade drain piping with 9 mm thk closed cell elastomeric nitrile rubber insulation with clams and proper supports. U Trap has to be provided near all the units."],
  };
  const ROWS: RealRow[] = [
    {"id": "BOQ-26-00073/HVAC/53", "unit": "Metre", "desc": "22.3 mm O.D (wall Thickness-1.0 mm) (insulation : 13/19 mm)", "h": "H1", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "22.3 mm O.D", "pipe_class": "wall Thickness-1.0 mm", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "13/19 mm", "pipe_size_mm": "22.3 mm O.D", "brand": null, "material_as_written": "Close cell elastomeric Nitrile rubber Class 'O' tubular insulation"}, "s": "insulation"}], "want": [2079, 234]},
    {"id": "BOQ-26-00073/HVAC/54", "unit": "Metre", "desc": "19.1 mm O.D (wall Thickness-1.0 mm) (insulation : 13/19 mm)", "h": "H1", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "19.1 mm O.D", "pipe_class": "wall Thickness-1.0 mm", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "13/19 mm", "pipe_size_mm": "19.1 mm O.D", "brand": null, "material_as_written": "Close cell elastomeric Nitrile rubber Class 'O' tubular insulation"}, "s": "insulation"}], "want": [1845, 234]},
    {"id": "BOQ-26-00073/HVAC/55", "unit": "Metre", "desc": "15.9 mm O.D (wall Thickness-1.0 mm) (insulation : 13/19 mm)", "h": "H1", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "15.9 mm O.D", "pipe_class": "wall Thickness-1.0 mm", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "13/19 mm", "pipe_size_mm": "15.9 mm O.D", "brand": null, "material_as_written": "Close cell elastomeric Nitrile rubber Class 'O' tubular insulation"}, "s": "insulation"}], "want": [1546, 234]},
    {"id": "BOQ-26-00073/HVAC/56", "unit": "Metre", "desc": "12.7 mm O.D (wall Thickness-1.0 mm) (insulation : 13/19 mm)", "h": "H1", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "12.7 mm O.D", "pipe_class": "wall Thickness-1.0 mm", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "13/19 mm", "pipe_size_mm": "12.7 mm O.D", "brand": null, "material_as_written": "Close cell elastomeric Nitrile rubber Class 'O' tubular insulation"}, "s": "insulation"}], "want": [1174, 234]},
    {"id": "BOQ-26-00073/HVAC/57", "unit": "Metre", "desc": "9.5 mm O.D (wall Thickness-0.8 mm) (insulation : 13/19 mm)", "h": "H1", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "9.5 mm O.D", "pipe_class": "wall Thickness-0.8 mm", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "13/19 mm", "pipe_size_mm": "9.5 mm O.D", "brand": null, "material_as_written": "Close cell elastomeric Nitrile rubber Class 'O' tubular insulation"}, "s": "insulation"}], "want": [651, 234]},
    {"id": "BOQ-26-00073/HVAC/58", "unit": "Metre", "desc": "6.4 mm O.D (wall Thickness-0.8 mm) (insulation : 13/19 mm)", "h": "H1", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "6.4 mm O.D", "pipe_class": "wall Thickness-0.8 mm", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "13/19 mm", "pipe_size_mm": "6.4 mm O.D", "brand": null, "material_as_written": "Close cell elastomeric Nitrile rubber Class 'O' tubular insulation"}, "s": "insulation"}], "want": [602, 234]},
    {"id": "BOQ-26-00073/HVAC/60", "unit": "Metre", "desc": "25 mm dia", "h": "H2", "items": [{"a": {"pipe_type": "PVC", "pipe_type_as_written": "uPVC", "size_mm": "25 mm dia", "pipe_class": "Rigid heavy class (10KG)", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "6/9 mm", "pipe_size_mm": "25 mm dia", "brand": null, "material_as_written": "nitrile rubber"}, "s": "insulation"}], "want": [358, 42]},
    {"id": "BOQ-26-00186/HVAC WORKS/100", "unit": "RMT", "desc": "Copper Refrigerant pipe for 10 TR DX UNITS", "h": "H3", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": null, "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "13mm", "pipe_size_mm": null, "brand": null, "material_as_written": "nitrile rubber"}, "s": "insulation"}], "want": "no pipe size stated"},
    {"id": "BOQ-26-00186/HVAC WORKS/101", "unit": "RMT", "desc": "Copper Refrigerant pipe for VRF UNITS", "h": "H3", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": null, "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "13mm", "pipe_size_mm": null, "brand": null, "material_as_written": "nitrile rubber"}, "s": "insulation"}], "want": "no pipe size stated"},
    {"id": "BOQ-26-00186/HVAC WORKS/102", "unit": "RMT", "desc": "Copper Refrigerant pipe for Server Room Split AC", "h": "H3", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": null, "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "13mm", "pipe_size_mm": null, "brand": null, "material_as_written": "nitrile rubber"}, "s": "insulation"}], "want": "no pipe size stated"},
    {"id": "BOQ-26-00186/HVAC WORKS/106", "unit": "RMT", "desc": "3/4 PVC With 9 MM Insulation foam", "h": "H4", "items": [{"a": {"pipe_type": "PVC", "pipe_type_as_written": "PVC", "size_mm": "3/4", "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "9 MM", "pipe_size_mm": null, "brand": null, "material_as_written": "foam"}, "s": "insulation"}], "want": [339, 42]},
    {"id": "BOQ-26-00186/HVAC WORKS/107", "unit": "RMT", "desc": "3/4 CPVC", "h": "H4", "items": [{"a": {"pipe_type": "CPVC", "pipe_type_as_written": "CPVC", "size_mm": "3/4", "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "6mm", "pipe_size_mm": null, "brand": null, "material_as_written": "nitrile rubber"}, "s": "insulation"}], "want": [459, 42]},
    {"id": "BOQ-26-00186/HVAC WORKS/108", "unit": "RMT", "desc": "1 CPVC", "h": "H4", "items": [{"a": {"pipe_type": "CPVC", "pipe_type_as_written": "CPVC", "size_mm": "1", "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "6mm", "pipe_size_mm": null, "brand": null, "material_as_written": "nitrile rubber"}, "s": "insulation"}], "want": "size 1 has no unit - price this row by hand"},
    {"id": "BOQ-26-00292/HVAC/10", "unit": "mtr", "desc": "Supply and installation of Extra copper pipings covering with nitryl rubber and tape.", "h": "H5", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": null, "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": null, "pipe_size_mm": null, "brand": null, "material_as_written": "nitryl rubber"}, "s": "insulation"}], "want": "no pipe size stated"},
    {"id": "BOQ-26-00292/HVAC/11", "unit": "Mtr", "desc": "S.I.T.C. of 19/25 mm. PVC conduit pipe to be used as a drain water pipe. Through holes as made above.", "h": "H5", "items": [{"a": {"pipe_type": "PVC", "pipe_type_as_written": "PVC", "size_mm": "19/25 mm", "pipe_class": null, "insulated": null}}], "want": [120, 28]},
    {"id": "BOQ-26-00292/HVAC/12", "unit": "Mtr", "desc": "S.I.T.C. of 32/40mm. PVC conduit pipe to be used as a drain water pipe. Through holes as made above.", "h": "H5", "items": [{"a": {"pipe_type": "PVC", "pipe_type_as_written": "PVC", "size_mm": "32/40mm", "pipe_class": null, "insulated": null}}], "want": [216, 42]},
    {"id": "BOQ-26-00292/HVAC/31", "unit": "mtr", "desc": "Supply and installation of Extra copper pipings covering with nitryl rubber and tape.", "h": "H5", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": null, "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": null, "pipe_size_mm": null, "brand": null, "material_as_written": "nitryl rubber"}, "s": "insulation"}], "want": "no pipe size stated"},
    {"id": "BOQ-26-00292/HVAC/32", "unit": "Mtr", "desc": "S.I.T.C. of 19/25 mm. PVC conduit pipe to be used as a drain water pipe. Through holes as made above.", "h": "H5", "items": [{"a": {"pipe_type": "PVC", "pipe_type_as_written": "PVC", "size_mm": "19/25 mm", "pipe_class": null, "insulated": null}}], "want": [120, 28]},
    {"id": "BOQ-26-00292/HVAC/33", "unit": "Mtr", "desc": "S.I.T.C. of 32/40mm. PVC conduit pipe to be used as a drain water pipe. Through holes as made above.", "h": "H5", "items": [{"a": {"pipe_type": "PVC", "pipe_type_as_written": "PVC", "size_mm": "32/40mm", "pipe_class": null, "insulated": null}}], "want": [216, 42]},
    {"id": "BOQ-26-00292/HVAC/58", "unit": "mtr", "desc": "Supply and installation of Extra copper pipings covering with nitryl rubber and tape.", "h": "H6", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": null, "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": null, "pipe_size_mm": null, "brand": null, "material_as_written": "nitryl rubber"}, "s": "insulation"}], "want": "no pipe size stated"},
    {"id": "BOQ-26-00292/HVAC/69", "unit": "Kg", "desc": "Supply & Labour charges for Fabricated MS frame for maintenance of Acs by using 32x6mm Angles &25x6mmMS strips with proper base frame supported in wall . Provide hand rail arrangements by using 40MM B class MS pipe incuding painted by using 2 coat Zinc chromate primer & Black enamel paint", "h": "H7", "items": [], "want": "unit 'Kg' is not a length unit"},
    {"id": "BOQ-26-00315/PAC WORKS/17", "unit": "RM", "desc": "5/8 \" dia hard drawn", "h": "H8", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "5/8 \" dia", "pipe_class": "16 gauge", "insulated": null}}], "want": [1298, 220]},
    {"id": "BOQ-26-00315/PAC WORKS/19", "unit": "RM", "desc": "7/8\" dia hard drawn", "h": "H8", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "7/8\" dia", "pipe_class": "16 gauge", "insulated": null}}], "want": [1814, 220]},
    {"id": "BOQ-26-00315/PAC WORKS/21", "unit": "RM", "desc": "1 1/8\" dia hard drawn", "h": "H8", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "1 1/8\" dia", "pipe_class": "16 gauge", "insulated": null}}], "want": [2438, 220]},
    {"id": "BOQ-26-00315/PAC WORKS/23", "unit": "RM", "desc": "3/4 \" dia hard drawn", "h": "H8", "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "3/4 \" dia", "pipe_class": "16 gauge", "insulated": null}}], "want": [1590, 220]},
    {"id": "BOQ-26-00315/PAC WORKS/26", "unit": "RM", "desc": "50mm dia", "h": "H9", "items": [{"a": {"pipe_type": "CPVC", "pipe_type_as_written": "CPVC", "size_mm": "50mm dia", "pipe_class": "SDR 11", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "9 mm", "pipe_size_mm": "50mm", "brand": null, "material_as_written": "closed cell elastomeric nitrile rubber"}, "s": "insulation"}], "want": [924, 70]},
    {"id": "BOQ-26-00315/PAC WORKS/28", "unit": "RM", "desc": "40mm dia", "h": "H9", "items": [{"a": {"pipe_type": "CPVC", "pipe_type_as_written": "CPVC", "size_mm": "40mm dia", "pipe_class": "SDR 11", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "9 mm", "pipe_size_mm": "40mm", "brand": null, "material_as_written": "closed cell elastomeric nitrile rubber"}, "s": "insulation"}], "want": [772, 56]},
    {"id": "BOQ-26-00315/PAC WORKS/30", "unit": "RM", "desc": "32 mm dia", "h": "H9", "items": [{"a": {"pipe_type": "CPVC", "pipe_type_as_written": "CPVC", "size_mm": "32 mm dia", "pipe_class": "SDR 11", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "9 mm", "pipe_size_mm": "32 mm", "brand": null, "material_as_written": "closed cell elastomeric nitrile rubber"}, "s": "insulation"}], "want": [658, 42]},
    {"id": "BOQ-26-00315/PAC WORKS/32", "unit": "RM", "desc": "GI B class pipe of 25 mm dia for humidifier connection", "h": "H9", "items": [{"a": {"pipe_type": null, "pipe_type_as_written": "GI", "size_mm": "25 mm dia", "pipe_class": "B class", "insulated": null}}], "want": [480, 140]},
  ];

  type Shown = { s: ItemListSuggestion; v: ItemListView };
  const list = (r: unknown): Shown => {
    if (!isSuggestion(r as never)) throw new Error("expected a suggestion");
    return { s: r as ItemListSuggestion, v: (r as ItemListSuggestion).itemList! };
  };
  function panelOf(r: RealRow): Shown {
    const pc: ParityCase = { cat: PIP, unit: r.unit, desc: r.desc, attrs: {}, items: r.items.map((i) => i.a), headings: HEADINGS[r.h] };
    const stored = extractionRowFor(pc) as ExtractionRow & { items: Array<{ attributes: unknown; section?: string }> };
    r.items.forEach((i, n) => { if (i.s) stored.items[n].section = i.s; });
    const ph = makePricingSheetHelper({ configsByCategory: cfg38, items: items38, extractionByRow: new Map([[stored.excelRow, stored]]) });
    return list(ph.compute(panelCtx(pc)));
  }
  /** One block as a pricer would enter it. `rewrite` replaces a text the typed box does not accept, by field id
   * (a section's field as "<section id>.<field id>"). */
  type Edit = ItemListEditState["items"][number];
  function editOf(b: ItemBlockView, rewrite: Record<string, string>, prefix = ""): Edit {
    const attrs: Record<string, string> = {};
    const other: string[] = [];
    for (const f of b.fields) {
      if (f.readOnly || f.mirrorTag) continue;
      const v = rewrite[prefix + f.id] ?? (f.otherMode ? f.typedValue : f.value);
      if (v !== "") attrs[f.id] = v;
      if (f.otherMode) other.push(f.id);
    }
    const sections: Record<string, Edit> = {};
    for (const sv of b.sections ?? []) {
      const sb = sv.view.items[0];
      if (!sb) continue;
      const e = editOf(sb, rewrite, `${sv.sectionId}.`);
      if (sb.qtyMirrorTag) delete e.qty;
      sections[sv.sectionId] = e;
    }
    return { base: null, family: b.family, attrs, qty: b.qty, ...(other.length ? { other } : {}), ...(Object.keys(sections).length ? { sections } : {}) } as Edit;
  }
  function calcOf(panel: Shown, rewrite: Record<string, string> = {}, unit = "mts"): Shown {
    const state = { items: panel.v.items.map((b) => editOf(b, rewrite)) };
    return list(calculatorHelper(cfg38, items38).compute(calculatorCtx("HVAC", PIP), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: unit }));
  }
  /** What both surfaces must agree on: every figure, every refusal, every block and its section. */
  const blockFacts = (b: ItemBlockView): unknown => ({
    family: b.family, state: b.state, reason: b.reason ?? null, figures: b.figures, qty: b.qty,
    sections: (b.sections ?? []).map((sv) => ({ id: sv.sectionId, priced: sv.view.rowPriced, reason: sv.view.reason ?? null, totals: sv.view.totals ?? null, items: sv.view.items.map(blockFacts) })),
  });
  const facts = (x: Shown) => ({ values: x.s.values, rowPriced: x.v.rowPriced, reason: x.v.reason ?? null, unitClass: x.v.unitClass, items: x.v.items.map(blockFacts) });
  const fig = (x: Shown): [number, number] | string => (x.v.rowPriced ? [x.s.values.supply_rate as number, x.s.values.install_rate as number] : (x.v.reason ?? "?"));

  /**
   * THE TYPED BOX IS STRICTER THAN THE MODEL PATH, BY RULING, and six real rows show it: the model copies the size
   * "as the row writes it" ('22.3 mm O.D', '5/8 " dia') and the panel reads it; the calculator's box takes ONE size
   * in mm or inches (owner P2) and a thickness as a single number (owner U4), so the same words typed there refuse.
   * A pricer types the size itself -- and then the two surfaces agree on every figure. Named, with what is typed.
   */
  const TYPED_BOX: Record<string, { rewrite: Record<string, string>; refusal: string }> = {
    "BOQ-26-00073/HVAC/53": { rewrite: { size_mm: "22.3" }, refusal: "Type one pipe size, in mm or inches" },
    "BOQ-26-00073/HVAC/60": { rewrite: { "insulation.thickness_mm": "9" }, refusal: "Type the thickness as a single number in mm" },
    "BOQ-26-00315/PAC WORKS/17": { rewrite: { size_mm: '5/8"' }, refusal: "Type one pipe size, in mm or inches" },
    "BOQ-26-00315/PAC WORKS/19": { rewrite: { size_mm: '7/8"' }, refusal: "Type one pipe size, in mm or inches" },
    "BOQ-26-00315/PAC WORKS/21": { rewrite: { size_mm: '1 1/8"' }, refusal: "Type one pipe size, in mm or inches" },
    "BOQ-26-00315/PAC WORKS/23": { rewrite: { size_mm: '3/4"' }, refusal: "Type one pipe size, in mm or inches" },
  };
  /** The one row whose unit the calculator's picker does not offer (cause C, owner R12): a fabricated frame in Kg. */
  const UNIT_NOT_OFFERED = "BOQ-26-00292/HVAC/69";
  const OUTRIGHT = ROWS.filter((r) => !(r.id in TYPED_BOX) && r.id !== UNIT_NOT_OFFERED);

  it("the fixture names exactly what it covers: 29 rows on four sheets -- 19 a pipe with its insulation, 9 a pipe alone, 1 with no item read", () => {
    expect(ROWS).toHaveLength(29);
    const bySheet: Record<string, number[]> = {};
    for (const r of ROWS) { const [boq, sheet, row] = r.id.split("/"); (bySheet[`${boq}/${sheet}`] ??= []).push(Number(row)); }
    expect(bySheet).toEqual({
      "BOQ-26-00073/HVAC": [53, 54, 55, 56, 57, 58, 60],
      "BOQ-26-00186/HVAC WORKS": [100, 101, 102, 106, 107, 108],
      "BOQ-26-00292/HVAC": [10, 11, 12, 31, 32, 33, 58, 69],
      "BOQ-26-00315/PAC WORKS": [17, 19, 21, 23, 26, 28, 30, 32],
    });
    const shape = (r: RealRow) => `${r.items.filter((i) => !i.s).length} pipe + ${r.items.filter((i) => i.s === "insulation").length} insulation`;
    const shapes: Record<string, number> = {};
    for (const r of ROWS) shapes[shape(r)] = (shapes[shape(r)] ?? 0) + 1;
    expect(shapes).toEqual({ "1 pipe + 1 insulation": 19, "1 pipe + 0 insulation": 9, "0 pipe + 0 insulation": 1 });
    // every stored item's marker is a section the Piping config declares, or none
    const declared = (itemListPricingSpec(cfg38.get(PIP))!.sections ?? []).map((s) => s.id);
    for (const r of ROWS) for (const i of r.items) if (i.s) expect(declared).toContain(i.s);
  });
  it("THE PANEL, row by row: 21 rows price at the figure recorded in the run, 8 refuse with the sentence recorded -- every one pinned", () => {
    const got = Object.fromEntries(ROWS.map((r) => [r.id, fig(panelOf(r))]));
    expect(got).toEqual(Object.fromEntries(ROWS.map((r) => [r.id, r.want])));
    const refusals: Record<string, number> = {};
    for (const r of ROWS) if (typeof r.want === "string") refusals[r.want] = (refusals[r.want] ?? 0) + 1;
    expect(refusals).toEqual({ "no pipe size stated": 6, "size 1 has no unit - price this row by hand": 1, "unit 'Kg' is not a length unit": 1 });
    expect(ROWS.filter((r) => typeof r.want !== "string")).toHaveLength(21);
  });
  it("22 rows agree OUTRIGHT -- the calculator, fed the panel's own answers, shows the same blocks, sections, figures and refusals (named)", () => {
    expect(OUTRIGHT).toHaveLength(22);
    for (const r of OUTRIGHT) {
      const p = panelOf(r);
      expect({ id: r.id, facts: facts(calcOf(p)) }).toEqual({ id: r.id, facts: facts(p) });
    }
    // and the rows are not all one shape: priced with a section, priced alone, refused for no size, refused for no unit
    const kinds = new Set(OUTRIGHT.map((r) => `${typeof r.want === "string" ? r.want : "priced"} | ${r.items.some((i) => i.s) ? "section" : "alone"}`));
    expect([...kinds].sort()).toEqual([
      "no pipe size stated | section", "priced | alone", "priced | section", "size 1 has no unit - price this row by hand | section",
    ]);
  });
  it.each(Object.entries(TYPED_BOX))("%s: the BoQ's own wording typed in the calculator refuses (the typed box takes one size / one number); the size typed plainly agrees on everything", (id, t) => {
    const r = ROWS.find((x) => x.id === id)!;
    const p = panelOf(r);
    expect(p.v.rowPriced).toBe(true);
    const asWritten = calcOf(p);
    expect(asWritten.v.rowPriced).toBe(false);
    expect(asWritten.v.reason).toBe(t.refusal);
    expect(facts(calcOf(p, t.rewrite))).toEqual(facts(p));
  });
  it("the one unit the picker does not offer: the Kg row refuses on the panel by its unit, reads no item, and no surface shows a figure", () => {
    const r = ROWS.find((x) => x.id === UNIT_NOT_OFFERED)!;
    const p = panelOf(r);
    expect(r.items).toEqual([]);
    expect({ priced: p.v.rowPriced, reason: p.v.reason, values: p.s.values }).toEqual({ priced: false, reason: "unit 'Kg' is not a length unit", values: {} });
    expect(p.v.unitChoices).not.toContain("Kg");
    const c = calcOf(p);
    expect({ priced: c.v.rowPriced, values: c.s.values }).toEqual({ priced: false, values: {} });
  });
  it("the three groups are the whole fixture: 22 outright + 6 typed-box + 1 unit = 29, no row in two groups", () => {
    const ids = [...OUTRIGHT.map((r) => r.id), ...Object.keys(TYPED_BOX), UNIT_NOT_OFFERED];
    expect(new Set(ids).size).toBe(29);
    expect([...ids].sort()).toEqual(ROWS.map((r) => r.id).sort());
  });
  it("VACUITY: handing the calculator a different size, or dropping the section, diverges -- the comparison can see a real-row difference", () => {
    const r = ROWS.find((x) => x.id === "BOQ-26-00315/PAC WORKS/26")!;
    const p = panelOf(r);
    expect(facts(calcOf(p, { size_mm: "40" }))).not.toEqual(facts(p));
    expect(facts(calcOf(p, { "insulation.thickness_mm": "19" }))).not.toEqual(facts(p));
    expect(facts(calcOf(p, { insulated: "No" }))).not.toEqual(facts(p));
  });
});

// =====================================================================================================
// SLICE 12e-5 AC10 -- ONE REAL STAGE A ROW PER ROW TYPE, calculator = panel
// =====================================================================================================
/**
 * The 12e-5 Stage A audit (2026-10-14) read 217 Piping rows through the real Suggest route (runs BRSR-26-00447 ..
 * 00465) with `claude-opus-4-8` on HVAC v38. ONE row per row type is pinned here (owner: "one row per stratum, not
 * every row") -- the type named on each row. Each row is the model's answer AS THE RUN STORED IT, with the row's
 * own text, unit, headings and own notes; `want` is what the panel showed, checked by hand against the row's words
 * in the audit (its report, AC7). Three types exist on dev only among 12e-4c's 29 rows above (the rows 53-58 shape,
 * uPVC in a heading, two sizes) and are covered by that block.
 *
 * `parity` names how the calculator, fed the panel's own answers (the 12e-4c method), agrees:
 *   outright    -- the same blocks, sections, figures and refusals;
 *   typed       -- the same once the typed box gets the number the BoQ states ("32mm thick" -> 32: the box takes one
 *                  number, owner U4);
 *   pick        -- the same refusal in the calculator's own wording ("pick a cladding" for "could not tell cladding",
 *                  owner F4, 12e-3c);
 *   both refuse -- neither surface shows a figure; the sentence differs by a known class: a unit the picker does
 *                  not offer (owner R12), a material named as written on the panel and "none of these" in the
 *                  calculator, several sizes for several unit counts.
 *   finding     -- a DIVERGENCE the audit found, pinned as it is for the owner. No row carries it now: 12e-5 pinned
 *                  BOQ-26-00119 / HVAC row 20 here (the panel refused '1/2" (12.7mm)' as several sizes while its size
 *                  box showed 12.7, and the calculator, handed that box, priced 936 / 220). INVERTED at 12e-5b (AC1 /
 *                  AC10, owner R6: the inch-with-mm form is one size): the row is "outright" -- both price 936 / 220.
 * BOQ-26-00162 / Water Side row 17 pins TODAY's figure: owner finding (12e-5, for 12e-5b) -- the cladding of a
 * layered thickness should be measured on the pipe + 2 x the TOTAL thickness, so this figure is expected to move.
 */
describe("12e-5 AC10 -- one real Stage A row per row type (runs BRSR-26-00447 .. 00465): calculator = panel", () => {
  const v38 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v38.json", import.meta.url),
  );
  const cfg38 = new Map<string, RateCategoryConfig>(v38.category_configs.map((c) => [c.category_id, c]));
  const items38: RateMasterItem[] = v38.items.map((it) => ({ ...it, discipline: v38.discipline } as RateMasterItem));
  const PIP = "hvac_piping";
  interface TypeRow {
    type: string;
    id: string;
    unit: string | null;
    desc: string;
    h: string[];
    notes: string[];
    items: Array<{ a: Record<string, string | null>; s?: string }>;
    want: [number, number] | string;
    parity: "outright" | "typed" | "pick" | "both refuse" | "finding";
    /** "finding" only: the calculator's figure, pinned AS IT IS for the owner (a divergence this audit found). */
    calc?: [number, number] | string;
    rewrite?: Record<string, string>;
  }
  const ROWS: TypeRow[] = [
    {"type": "Copper O.D., insulation thickness in the row", "id": "BOQ-26-00273/247 - VRF System/30", "unit": "Rmt", "desc": "41.3 mm OD (Insulation = 19mm thick)", "h": ["Refrigerant Piping"], "notes": [], "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "41.3 mm OD", "pipe_class": "18G", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "19mm", "pipe_size_mm": "41.3 mm OD", "brand": null, "material_as_written": "closed cell elastomeric nitrile rubber insulation, class-o"}, "s": "insulation"}], "want": [4522, 234], "parity": "outright"},
    {"type": "Copper inch fraction, type and insulation from the heading", "id": "BOQ-26-00231/HVAC BOQ/139", "unit": "Rmt", "desc": "2/8 inch dia.-21SWG", "h": ["VRF SYSTEM", "SITC of copper refrigerant piping of various sizes with soft / hard drawn copper piping necessary supports, fittings and clamps, insulation with 19 mm thk class 'O' nitrile rubber insulation with FM approval. Copper piping shall be of VRF grade with 100% eddy current testing. All wall crossings with proper PVC sleeve. Low / nil VOC adhesive shall be used. Arrow mark stickers with circuit numbers shall be provided on copper piping at every 3 mt distance. Soft copper piping shall be used for unit connections and balance piping shall be hard drawn copper piping. Insulation shall have silver clad with minimum 250 micron thickness for copper piping on the balcony for UV protection. Copper piping shall be clamped at every 1.5 mt. with PVC sleeve."], "notes": [], "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "2/8 inch", "pipe_class": "21SWG", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "19 mm", "pipe_size_mm": "2/8 inch", "brand": null, "material_as_written": "class 'O' nitrile rubber insulation"}, "s": "insulation"}], "want": [602, 234], "parity": "outright"},
    {"type": "Copper mm dia, thickness in the row, 19 mm", "id": "BOQ-26-00215/VRV WORKS/47", "unit": "RMT", "desc": "41.3 mm dia with 19 mm thick insulation", "h": ["VRV SYSTEM", "Supply & installation of Refrigerant copper piping insulated with the specified thickness of closed cell elastomeric nitrile rubber insulation in a tubular form and joints sealed with black cotton tape. All the copper pipe should be hard drawn pipe should be considered except the unit connection."], "notes": [], "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "41.3 mm dia", "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "19 mm", "pipe_size_mm": "41.3 mm", "brand": null, "material_as_written": "closed cell elastomeric nitrile rubber insulation"}, "s": "insulation"}], "want": [4522, 234], "parity": "outright"},
    {"type": "CPVC drain, insulation from the heading (13 mm)", "id": "BOQ-26-00231/HVAC BOQ/31", "unit": "Rmt", "desc": "25 mm dia", "h": ["Preambles:", "CHILLED WATER CEILING SUSPENDED AHU", "SITC of SDR 13.5 CPVC drain ping with supports, clamps and insulation with 13 mm thk class 'O' nitrile rubber insulation of the following sizes. Insulation shall be FM Approved. Low / nil VOC adhesive shall be used."], "notes": [], "items": [{"a": {"pipe_type": "CPVC", "pipe_type_as_written": "CPVC", "size_mm": "25 mm dia", "pipe_class": "SDR 13.5", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "13 mm", "pipe_size_mm": "25 mm", "brand": null, "material_as_written": "class 'O' nitrile rubber insulation"}, "s": "insulation"}], "want": [478, 42], "parity": "outright"},
    {"type": "CPVC below its smallest size (18 -> 25), thickness not stated (ruled default)", "id": "BOQ-26-00098/VRF/90", "unit": "M", "desc": "18 mm dia", "h": ["DRAIN PIPING"], "notes": [], "items": [{"a": {"pipe_type": "CPVC", "pipe_type_as_written": "CPVC", "size_mm": "18 mm dia", "pipe_class": "medium class", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": null, "pipe_size_mm": "18 mm", "brand": null, "material_as_written": "nitrile rubber"}, "s": "insulation"}], "want": [459, 42], "parity": "outright"},
    {"type": "MS NB with wall thickness in the class (chilled water)", "id": "BOQ-26-00137/CHW pipes , Valves/17", "unit": "RMT", "desc": "250 NB - 5.4mm Thick (min)", "h": ["Supply, Installation, Testing & Commissioning & Handing over of the following:", "CHILLED WATER PIPING with Coupled fittings: Supply & erection of the following factory rolled MS 'C' class pipes as per IS 1239 / IS 3589 with specified wall thickness cut to required lengths and installed with all welded joints, Providing and fixing in position necessary grooved fittings like bends, elbows, tees, reducers, mating flange joints etc, Puff saddles, clamps and hardware etc as required at site. All Nut bolts to be of GI only. Necessary approval shall be taken for the sizes along with submittal. Fittings and Nipples for the BAS system to be incorporated. Note: CHW water pipes thickness shall be as per IS 1239 part-1 for pipes up to 150 mm and as per IS 3589 for pipes above 150mm dia.HVAC vendor shall do the opening in walls as required for HVAC work and make it good after installation. Negative tolerance is not accepted wherever the thickness is specified in the Tender / BOQ."], "notes": [], "items": [{"a": {"pipe_type": "MS", "pipe_type_as_written": "MS", "size_mm": "250 NB", "pipe_class": "'C' class, 5.4mm Thick (min)", "insulated": null}}], "want": [5616, 1400], "parity": "outright"},
    {"type": "MS mm dia, class C, no insulation", "id": "BOQ-26-00231/HVAC BOQ/42", "unit": "Rmt", "desc": "80 mm dia", "h": ["CHILLED WATER PIPING AND ACCESSORIES", "Supply, Installation, Testing and Commissioning of MS chilled water pipe with supports, fittings, flanges, etc. MS class 'C' up to 150 mm dia as per IS1239 and above 150 mm dia as per IS 3589."], "notes": [], "items": [{"a": {"pipe_type": "MS", "pipe_type_as_written": "MS", "size_mm": "80 mm dia", "pipe_class": "class 'C'", "insulated": null}}], "want": [1440, 420], "parity": "outright"},
    {"type": "PVC in the row text, insulation from the row", "id": "BOQ-26-00119/HVAC/34", "unit": "RMTS", "desc": "Supplying, laying/ fixing, testing and commissioning of 25mm Dia sizes of PVC Drain Piping using pipe with all necessary fittings with insulation as above but using 9mm thick Nitrile rubber sleeve. VRV (APPROX )", "h": ["AIR CONDITIONING EQUIPMENT", "ANCILARY WORKS FOR VRV/VRF SYSTEM"], "notes": [], "items": [{"a": {"pipe_type": "PVC", "pipe_type_as_written": "PVC", "size_mm": "25mm Dia", "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "9mm", "pipe_size_mm": "25mm", "brand": null, "material_as_written": "Nitrile rubber"}, "s": "insulation"}], "want": [358, 42], "parity": "outright"},
    {"type": "PVC NB with a kg class, no heading", "id": "BOQ-26-00088/HVAC/63", "unit": "M", "desc": "DRAIN PVC PIPE 32 NB 6 KG CLASS", "h": [], "notes": [], "items": [{"a": {"pipe_type": "PVC", "pipe_type_as_written": "PVC", "size_mm": "32 NB", "pipe_class": "6 KG CLASS", "insulated": null}}], "want": [168, 28], "parity": "outright"},
    {"type": "MS + insulation with aluminium cladding and glass cloth (note schedule)", "id": "BOQ-26-00162/Water Side/19", "unit": "Rmt.", "desc": "32mm Dia", "h": ["CHILLED WATER PIPING with INSULATION."], "notes": [], "items": [{"a": {"pipe_type": "MS", "pipe_type_as_written": "MS", "size_mm": "32mm Dia", "pipe_class": "Heavy class 'C'", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "24G Aluminium with Glass Cloth", "thickness_mm": "25 mm thick", "pipe_size_mm": "32mm Dia", "brand": null, "material_as_written": "nitrile rubber foam sheet of density 50+/-2 kg/m3"}, "s": "insulation"}], "want": [1223, 469], "parity": "outright"},
    {"type": "Layered thickness: 32 mm above the largest stocked (13 + 19)", "id": "BOQ-26-00162/Water Side/17", "unit": "Rmt.", "desc": "50mm. Dia", "h": ["CHILLED WATER PIPING with INSULATION."], "notes": [], "items": [{"a": {"pipe_type": "MS", "pipe_type_as_written": "MS", "size_mm": "50mm. Dia", "pipe_class": "Heavy class 'C'", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "24G Aluminium with Glass Cloth", "thickness_mm": "32mm thick", "pipe_size_mm": "50mm. Dia", "brand": null, "material_as_written": "nitrile rubber foam sheet of density 50+/-2 kg/m3"}, "s": "insulation"}], "want": [2031, 588], "parity": "typed", "rewrite": {"insulation.thickness_mm": "32"}},
    {"type": "Insulated pipe above the insulation sheet (53.98): refuses", "id": "BOQ-26-00294/CHW PIPE BOQ/22", "unit": "Rmt", "desc": "150mm dia.", "h": ["AIR HANDLING UNITS (AHU )", "Chilled Water pipe"], "notes": [], "items": [{"a": {"pipe_type": "MS", "pipe_type_as_written": "MS", "size_mm": "150mm dia.", "pipe_class": "class C", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "25 mm", "pipe_size_mm": "150mm", "brand": null, "material_as_written": "Nitrile Rubber"}, "s": "insulation"}], "want": "pipe size 150 is above the largest size on the sheet (53.98)", "parity": "outright"},
    {"type": "CPVC above its largest size (80 > 75): refuses", "id": "BOQ-26-00098/VRF/85", "unit": "M", "desc": "80 mm dia", "h": ["DRAIN PIPING"], "notes": [], "items": [{"a": {"pipe_type": "CPVC", "pipe_type_as_written": "CPVC", "size_mm": "80 mm dia", "pipe_class": "medium class", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": null, "pipe_size_mm": "80 mm", "brand": null, "material_as_written": "nitrile rubber"}, "s": "insulation"}], "want": "pipe size 80 is above the largest size on the sheet (75)", "parity": "outright"},
    {"type": "Inch size with mm in brackets: one size (12e-5b R6)", "id": "BOQ-26-00119/HVAC/20", "unit": "RMTS", "desc": "1/2\" (12.7mm)", "h": ["AIR CONDITIONING EQUIPMENT", "Supply, laying / fixing, testing and commissioning of following nominal sizes of Copper piping inside the building (with necessary clamps and fittings etc.)", "PIPE SIZE HD"], "notes": [], "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "Copper", "size_mm": "1/2\" (12.7mm)", "pipe_class": null, "insulated": null}}], "want": [936, 220], "parity": "outright"},
    {"type": "Cladding left out by the model: could not tell cladding", "id": "BOQ-26-00341/VRV/33", "unit": "RMT", "desc": "41.3 mm dia(hard drawn) with 19 mm thick insulation", "h": ["REFRIGERANT COPPER PIPING"], "notes": [], "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": "41.3 mm dia", "pipe_class": "hard drawn", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": null, "thickness_mm": "19 mm", "pipe_size_mm": "41.3 mm", "brand": null, "material_as_written": null}, "s": "insulation"}], "want": "could not tell cladding", "parity": "pick"},
    // INVERTED at 12e-6c (owner R, 2026-10-18: RPUF -> Tubular PUF in code too) by mechanical authority. BEFORE: type "Unstocked
    // material (RPUF) refused by name", want "No SKU in the catalogue for RPUF - price this row by hand", parity "both refuse".
    // AFTER: the panel prices 9,459 / 1,904 -- the stored row's own figure where the model picked Tubular PUF itself.
    // The calculator, fed the panel's answers, types the model's "50 mm thick" into the thickness box and refuses by U4 (12d-6: a
    // typed thickness is one number) -- the existing ruled divergence, pinned as it is; RPUF itself cannot be typed there (a dropdown).
    {"type": "RPUF as written with none of these: priced as Tubular PUF (12e-6c R)", "id": "BOQ-26-00321/PIPING & VALVES/15", "unit": "Rmt", "desc": "300 mm dia", "h": ["Note: The contractor should read the specifications thoroughly and quote the price for each item. The BOQ should read in-conjunction with specification, drawing & equipment schedule. The cost shall include the cost of the material, transportation, taxes, duties, lifting, shifting, storing, handling, installation, testing and commissioning.", "CHILLED WATER PIPING AND RELATED VALVES", "MS C Class Pipes (factory rolled) as per IS 1239 / IS 3589 with specified wall thickness cut to required lengths and installed with all welded joints. All necessary fittings like bends, elbows, tees, reducers, mating flange joints etc., steel fabricated and machined flanges, structural supports, Puff saddles, clamps and hardware etc as requred at site to be considered. All Nut bolts to be of GI only and not MS. Fittings and Nipples for providing any BMS sensors as per BMS vendor requirement to be considered. Entire CHW system shall be PN16"], "notes": [], "items": [{"a": {"pipe_type": "MS", "pipe_type_as_written": "MS", "size_mm": "300 mm dia", "pipe_class": "C Class", "insulated": "Yes"}}, {"a": {"item": "none of these", "cladding": "26G Aluminium", "thickness_mm": "50 mm thick", "pipe_size_mm": "300 mm dia", "brand": null, "material_as_written": "RPUF"}, "s": "insulation"}], "want": [9459, 1904], "calc": "Type the thickness as a single number in mm", "parity": "finding"},
    {"type": "Unstocked material (closed cell polyethylene) refused by name", "id": "BOQ-26-00273/247 - VRF System/61", "unit": "Rmt", "desc": "20 mm dia.", "h": ["CPVC Pipes with 6mm thick Closed Cell Polyethylene"], "notes": [], "items": [{"a": {"pipe_type": "CPVC", "pipe_type_as_written": "CPVC", "size_mm": "20 mm dia.", "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "none of these", "cladding": "None", "thickness_mm": "6 mm", "pipe_size_mm": "20 mm dia.", "brand": null, "material_as_written": "6 mm thick closed cell polyethylene"}, "s": "insulation"}], "want": "No SKU in the catalogue for 6 mm thick closed cell polyethylene - price this row by hand", "parity": "both refuse"},
    {"type": "UPVC as written, type left out (as-written decides)", "id": "BOQ-26-00162/Water Side/75", "unit": "Rmt.", "desc": "40mm. Dia", "h": ["CONDENSATE DRAIN PIPE FOR AHU'S."], "notes": [], "items": [{"a": {"pipe_type": null, "pipe_type_as_written": "UPVC", "size_mm": "40mm. Dia", "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": null, "thickness_mm": "9mm", "pipe_size_mm": "40mm. Dia", "brand": null, "material_as_written": "nitrile rubber"}, "s": "insulation"}], "want": "could not tell cladding", "parity": "both refuse"},
    {"type": "Several sizes for several unit counts: refuses", "id": "BOQ-26-00294/CHW PIPE BOQ/62", "unit": "Rmt", "desc": "supply, installation, testing and commissioning of AC drain pipe. Drain Piping shall be Hard PVC.25mm dia for single unit, 40mm dia for two units and 50mm dia for 3 units. Drain Piping shall be insulated with 13mm nitrile rubber insulation", "h": ["AIR HANDLING UNITS (AHU )", "Pressure Guage/Thermometer"], "notes": [], "items": [{"a": {"pipe_type": "PVC", "pipe_type_as_written": "Hard PVC", "size_mm": "25mm dia for single unit, 40mm dia for two units and 50mm dia for 3 units", "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "None", "thickness_mm": "13mm", "pipe_size_mm": "25mm dia for single unit, 40mm dia for two units and 50mm dia for 3 units", "brand": null, "material_as_written": "nitrile rubber"}, "s": "insulation"}], "want": "several values stated for pipe size ('25mm dia for single unit, 40mm dia for two units and 50mm dia for 3 units')", "parity": "both refuse"},
    // INVERTED at ADP-3a (owner 13:35, U5: a unit the kind is not stocked in names the unit and the stocked ones) by mechanical authority: BEFORE want "unit 'Nos' is not a length unit"
    {"type": "Unit Nos: refuses on the unit", "id": "BOQ-26-00321/PIPING & VALVES/78", "unit": "Nos", "desc": "50 mm dia", "h": ["Note: The contractor should read the specifications thoroughly and quote the price for each item. The BOQ should read in-conjunction with specification, drawing & equipment schedule. The cost shall include the cost of the material, transportation, taxes, duties, lifting, shifting, storing, handling, installation, testing and commissioning.", "CHILLED WATER PIPING AND RELATED VALVES", "CPVC Condensate Drain piping (Schedule 40) cut to required lengths, duly insulated with 9 mm thick tubular Nitrile rubber as per specifications. and installed with all screwed joints. Providing and fixing in position the necessary elbows, tees and reducers as per specifications required U trap door to be provided with proper supporting arrangement."], "notes": [], "items": [{"a": {"pipe_type": "CPVC", "pipe_type_as_written": "CPVC", "size_mm": "50 mm dia", "pipe_class": "Schedule 40", "insulated": "Yes"}}, {"a": {"item": "Tubular Puf Insulation", "cladding": "None", "thickness_mm": "9 mm thick", "pipe_size_mm": "50 mm dia", "brand": null, "material_as_written": "tubular Nitrile rubber"}, "s": "insulation"}], "want": "CPVC is not stocked per 'Nos' (stocked per metre) - price this row by hand", "parity": "both refuse"},
    // INVERTED at ADP-3a (owner 13:35, U5: a unit the kind is not stocked in names the unit and the stocked ones) by mechanical authority: BEFORE want "unit 'Set' is not a length unit"
    {"type": "Unit Set: refuses on the unit", "id": "BOQ-26-00162/Water Side/78", "unit": "Set", "desc": "Interconnection of MS piping for Air Handling Unit (AHU)", "h": ["CHILLED WATER PIPING with INSULATION."], "notes": [], "items": [{"a": {"pipe_type": "MS", "pipe_type_as_written": "MS", "size_mm": null, "pipe_class": "Heavy class 'C'", "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "24G Aluminium with Glass Cloth", "thickness_mm": null, "pipe_size_mm": null, "brand": null, "material_as_written": "nitrile rubber foam sheet of density 50+/-2 kg/m3"}, "s": "insulation"}], "want": "MS is not stocked per 'Set' (stocked per metre) - price this row by hand", "parity": "both refuse"},
    {"type": "No size and no unit (TR-rated lump row)", "id": "BOQ-26-00088/HVAC/34", "unit": null, "desc": "17.0 TR REFERIG COPPER PIPING&FLX COPPER CABLING", "h": ["11 TR DUCTABLE SPLIT", "REFRIDGERENT PIPING & CABLING"], "notes": [], "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "copper", "size_mm": null, "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "No", "thickness_mm": "6mm", "pipe_size_mm": null, "brand": null, "material_as_written": "nitrile foam"}, "s": "insulation"}], "want": "no pipe size stated", "parity": "outright"},
  ];

  type Shown = { s: ItemListSuggestion; v: ItemListView };
  const list = (r: unknown): Shown => {
    if (!isSuggestion(r as never)) throw new Error("expected a suggestion");
    return { s: r as ItemListSuggestion, v: (r as ItemListSuggestion).itemList! };
  };
  function panelOf(r: TypeRow): Shown {
    const pc: ParityCase = { cat: PIP, unit: r.unit ?? "", desc: r.desc, attrs: {}, items: r.items.map((i) => i.a), headings: r.h, ownNotes: r.notes };
    const stored = extractionRowFor(pc) as ExtractionRow & { items: Array<{ attributes: unknown; section?: string }> };
    r.items.forEach((i, n) => { if (i.s) stored.items[n].section = i.s; });
    const ctx = { ...panelCtx(pc), unit: r.unit };
    return list(makePricingSheetHelper({ configsByCategory: cfg38, items: items38, extractionByRow: new Map([[stored.excelRow, stored]]) }).compute(ctx));
  }
  type Edit = ItemListEditState["items"][number];
  function editOf(b: ItemBlockView, rewrite: Record<string, string>, prefix = ""): Edit {
    const attrs: Record<string, string> = {};
    const other: string[] = [];
    for (const f of b.fields) {
      if (f.readOnly || f.mirrorTag) continue;
      const v = rewrite[prefix + f.id] ?? (f.otherMode ? f.typedValue : f.value);
      if (v !== "") attrs[f.id] = v;
      if (f.otherMode) other.push(f.id);
    }
    const sections: Record<string, Edit> = {};
    for (const sv of b.sections ?? []) {
      const sb = sv.view.items[0];
      if (!sb) continue;
      const e = editOf(sb, rewrite, `${sv.sectionId}.`);
      if (sb.qtyMirrorTag) delete e.qty;
      sections[sv.sectionId] = e;
    }
    return { base: null, family: b.family, attrs, qty: b.qty, ...(other.length ? { other } : {}), ...(Object.keys(sections).length ? { sections } : {}) } as Edit;
  }
  function calcOf(panel: Shown, rewrite: Record<string, string> = {}): Shown {
    const state = { items: panel.v.items.map((b) => editOf(b, rewrite)) };
    return list(calculatorHelper(cfg38, items38).compute(calculatorCtx("HVAC", PIP), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: "mts" }));
  }
  const blockFacts = (b: ItemBlockView): unknown => ({
    family: b.family, state: b.state, reason: b.reason ?? null, figures: b.figures, qty: b.qty,
    sections: (b.sections ?? []).map((sv) => ({ id: sv.sectionId, priced: sv.view.rowPriced, reason: sv.view.reason ?? null, totals: sv.view.totals ?? null, items: sv.view.items.map(blockFacts) })),
  });
  const facts = (x: Shown) => ({ values: x.s.values, rowPriced: x.v.rowPriced, reason: x.v.reason ?? null, unitClass: x.v.unitClass, items: x.v.items.map(blockFacts) });
  /** The calculator's own wording for a choice not made yet (owner F4, 12e-3c), read back as the BoQ row's. */
  const calcWording = (x: unknown): unknown =>
    typeof x === "string" ? x.replace(/pick an? ([a-z ]+)$/g, "could not tell $1")
      : Array.isArray(x) ? x.map(calcWording)
        : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, calcWording(v)])) : x;
  const fig = (x: Shown): [number, number] | string => (x.v.rowPriced ? [x.s.values.supply_rate as number, x.s.values.install_rate as number] : (x.v.reason ?? "?"));

  it("the fixture names exactly what it covers: 22 row types, one real row each, on 11 sheets of the Stage A runs", () => {
    expect(ROWS).toHaveLength(22);
    expect(new Set(ROWS.map((r) => r.type)).size).toBe(22);
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(22);
    expect(ROWS.map((r) => r.type)).toEqual([
      "Copper O.D., insulation thickness in the row", "Copper inch fraction, type and insulation from the heading", "Copper mm dia, thickness in the row, 19 mm",
      "CPVC drain, insulation from the heading (13 mm)", "CPVC below its smallest size (18 -> 25), thickness not stated (ruled default)",
      "MS NB with wall thickness in the class (chilled water)", "MS mm dia, class C, no insulation", "PVC in the row text, insulation from the row",
      "PVC NB with a kg class, no heading", "MS + insulation with aluminium cladding and glass cloth (note schedule)", "Layered thickness: 32 mm above the largest stocked (13 + 19)",
      "Insulated pipe above the insulation sheet (53.98): refuses", "CPVC above its largest size (80 > 75): refuses", "Inch size with mm in brackets: one size (12e-5b R6)",
      "Cladding left out by the model: could not tell cladding", "RPUF as written with none of these: priced as Tubular PUF (12e-6c R)", "Unstocked material (closed cell polyethylene) refused by name",
      "UPVC as written, type left out (as-written decides)", "Several sizes for several unit counts: refuses", "Unit Nos: refuses on the unit", "Unit Set: refuses on the unit",
      "No size and no unit (TR-rated lump row)",
    ]);
    expect(new Set(ROWS.map((r) => r.id.split("/").slice(0, 2).join("/"))).size).toBe(11);
    const byParity: Record<string, number> = {};
    for (const r of ROWS) byParity[r.parity] = (byParity[r.parity] ?? 0) + 1;
    // INVERTED at 12e-6c (owner R): BEFORE `{ outright: 14, typed: 1, pick: 1, "both refuse": 6 }` -- the RPUF row now prices on the panel
    expect(byParity).toEqual({ outright: 14, typed: 1, pick: 1, "both refuse": 5, finding: 1 });
  });
  it("THE PANEL, row by row: 12 rows price at the figure the audit recorded, 10 refuse with the sentence it recorded", () => {
    expect(Object.fromEntries(ROWS.map((r) => [r.id, fig(panelOf(r))]))).toEqual(Object.fromEntries(ROWS.map((r) => [r.id, r.want])));
    // INVERTED at 12e-6c (owner R): BEFORE `toHaveLength(12)` (12 priced, 10 refused) -- the RPUF row prices: 13 priced, 9 refused
    expect(ROWS.filter((r) => typeof r.want !== "string")).toHaveLength(13);
  });
  it.each(ROWS.map((r) => [r.id, r] as const))("%s: the calculator, fed the panel's own answers, agrees", (_id, r) => {
    const p = panelOf(r);
    const c = calcOf(p, r.rewrite ?? {});
    if (r.parity === "outright" || r.parity === "typed") expect(facts(c)).toEqual(facts(p));
    else if (r.parity === "pick") expect(calcWording(facts(c))).toEqual(facts(p));
    else if (r.parity === "finding") expect({ panel: fig(p), calc: fig(c) }).toEqual({ panel: r.want, calc: r.calc });
    else {
      expect({ panel: p.v.rowPriced, calc: c.v.rowPriced, panelValues: p.s.values, calcValues: c.s.values }).toEqual({ panel: false, calc: false, panelValues: {}, calcValues: {} });
    }
  });
  it("the 'typed' row: the BoQ's own wording typed in the calculator refuses, the number typed plainly agrees on everything", () => {
    const r = ROWS.find((x) => x.parity === "typed")!;
    const p = panelOf(r);
    expect(calcOf(p).v.rowPriced).toBe(false);
    expect(facts(calcOf(p, r.rewrite))).toEqual(facts(p));
  });
  it("VACUITY: a different size or thickness handed to the calculator diverges on a real Stage A row", () => {
    const r = ROWS.find((x) => x.id === "BOQ-26-00231/HVAC BOQ/31")!;
    const p = panelOf(r);
    expect(facts(calcOf(p))).toEqual(facts(p));
    expect(facts(calcOf(p, { size_mm: "40" }))).not.toEqual(facts(p));
    expect(facts(calcOf(p, { "insulation.thickness_mm": "19" }))).not.toEqual(facts(p));
  });
});

// =====================================================================================================
// SLICE 12e-5c AC13 -- ONE ROW PER NEW SHAPE FOUND IN THE STAGE B READ, calculator vs panel, PINNED AS IT IS
// =====================================================================================================
/**
 * The 12e-5c Stage B read (2026-10-15 / 16, runs BRSR-26-00718 .. 00805, HVAC v42) put all 1,349 stored Piping rows
 * through the existing parity method (the 12e-5 block above: the calculator fed the panel's own answers). 1,330
 * agree (outright 1,083, typed 184, pick 18, both refuse 45). The rest are TWO SHAPES this test did not hold, both
 * pre-existing (they occur on Stage A / 12e-5b rows too) and neither in `calculatorPanelParity.awaiting.ts`. ONE real
 * Stage B row of each is pinned here (owner AC13: "one row per new shape, not every row"), AS IT IS, for the owner:
 *
 *   as-written refusal -- the panel refuses a STOCKED family by the material the BoQ writes ("nitrile rubber/XLPE":
 *                         `no_sku_named_by: material_as_written`); the calculator has no as-written box, so the same
 *                         family handed to it prices. 8 Stage B rows (BOQ-26-00086 High side 98-101, 104-107).
 *   below smallest     -- a pipe below its smallest stocked size ladders UP (CPVC 20 -> 25); the panel puts the
 *                         insulation on the pipe size AS READ (20 -> 22.23, 12e-5b2 R6), the calculator's insulation
 *                         pipe size mirrors the pipe box (25 -> 28.58). 11 rows (Stage A, 12e-5b and Stage B).
 *
 * `want` is the panel, `calc` the calculator; a ruling that removes either shape flips its pin.
 */
describe("12e-5c AC13 -- one Stage B row per new shape (runs BRSR-26-00718 .. 00805, v42): calculator vs panel, pinned", () => {
  const v42 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v42.json", import.meta.url),
  );
  const cfg42 = new Map<string, RateCategoryConfig>(v42.category_configs.map((c) => [c.category_id, c]));
  const items42: RateMasterItem[] = v42.items.map((it) => ({ ...it, discipline: v42.discipline } as RateMasterItem));
  const PIP = "hvac_piping";
  interface ShapeRow {
    shape: "as-written refusal" | "below smallest";
    id: string;
    unit: string;
    desc: string;
    h: string[];
    items: Array<{ a: Record<string, string | null>; s?: string }>;
    want: [number, number] | string;
    calc: [number, number];
  }
  const ROWS: ShapeRow[] = [
    {"shape": "as-written refusal", "id": "BOQ-26-00086/High side/98", "unit": "RM", "desc": "15.9 mm O.D. (with 19mm insulation)", "h": ["The quoted price should include lifting, shifting, positioning at site of all the equipment fittings, remote controls, vibration isolators, ancilliary materials as specified and all such item required to fullfill the intent and purpose as laid down in specifications and drawings.", "COPPER REFRIGERANT PIPING"], "items": [{"a": {"pipe_type": "Copper", "pipe_type_as_written": "COPPER", "size_mm": "15.9 mm O.D.", "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "Nitrile Rubber Insulation", "cladding": "Glass Cloth with paint", "cladding_as_written": "two coats of 500 micron (0.5 mm) WFT Flame Retardant coating", "thickness_mm": "19mm", "pipe_size_mm": "15.9 mm O.D.", "brand": null, "material_as_written": "closed cell elastomeric nitrile rubber/XLPE tubular insulation"}, "s": "insulation"}], "want": [1595, 304], "calc": [1595, 304]},
    {"shape": "below smallest", "id": "BOQ-26-00300/VRF System/71", "unit": "Rmt", "desc": "20 mm dia.", "h": ["CPVC Pipes with 6mm thick Closed Cell Polyethylene"], "items": [{"a": {"pipe_type": "CPVC", "pipe_type_as_written": "CPVC", "size_mm": "20 mm dia.", "pipe_class": null, "insulated": "Yes"}}, {"a": {"item": "none of these", "cladding": "None", "cladding_as_written": null, "thickness_mm": "6 mm thick", "pipe_size_mm": "20 mm dia.", "brand": null, "material_as_written": "closed cell polyethylene"}, "s": "insulation"}], "want": [466, 42], "calc": [478, 42]},
  ];
  type Shown = { s: ItemListSuggestion; v: ItemListView };
  const list = (r: unknown): Shown => {
    if (!isSuggestion(r as never)) throw new Error("expected a suggestion");
    return { s: r as ItemListSuggestion, v: (r as ItemListSuggestion).itemList! };
  };
  function panelOf(r: ShapeRow): Shown {
    const pc: ParityCase = { cat: PIP, unit: r.unit, desc: r.desc, attrs: {}, items: r.items.map((i) => i.a), headings: r.h, ownNotes: [] };
    const stored = extractionRowFor(pc) as ExtractionRow & { items: Array<{ attributes: unknown; section?: string }> };
    r.items.forEach((i, n) => { if (i.s) stored.items[n].section = i.s; });
    const ctx = { ...panelCtx(pc), unit: r.unit };
    return list(makePricingSheetHelper({ configsByCategory: cfg42, items: items42, extractionByRow: new Map([[stored.excelRow, stored]]) }).compute(ctx));
  }
  type Edit = ItemListEditState["items"][number];
  /** The 12e-5 block's feed, with the typed box given the number the panel itself resolved (owner U4: one number). */
  function editOf(b: ItemBlockView): Edit {
    const attrs: Record<string, string> = {};
    const other: string[] = [];
    for (const f of b.fields) {
      if (f.readOnly || f.mirrorTag) continue;
      const v = f.otherMode ? (f.value || f.typedValue) : f.value;
      if (v !== "") attrs[f.id] = v;
      if (f.otherMode && !f.value) other.push(f.id);
    }
    const sections: Record<string, Edit> = {};
    for (const sv of b.sections ?? []) {
      const sb = sv.view.items[0];
      if (!sb) continue;
      const e = editOf(sb);
      if (sb.qtyMirrorTag) delete e.qty;
      sections[sv.sectionId] = e;
    }
    return { base: null, family: b.family, attrs, qty: b.qty, ...(other.length ? { other } : {}), ...(Object.keys(sections).length ? { sections } : {}) } as Edit;
  }
  function calcOf(panel: Shown): Shown {
    const state = { items: panel.v.items.map((b) => editOf(b)) };
    return list(calculatorHelper(cfg42, items42).compute(calculatorCtx("HVAC", PIP), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: "mts" }));
  }
  const fig = (x: Shown): [number, number] | string => (x.v.rowPriced ? [x.s.values.supply_rate as number, x.s.values.install_rate as number] : (x.v.reason ?? "?"));

  it("the fixture names exactly what it covers: 2 new shapes, one real Stage B row each", () => {
    expect(ROWS).toHaveLength(2);
    expect(ROWS.map((r) => r.shape)).toEqual(["as-written refusal", "below smallest"]);
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(2);
  });
  it.each(ROWS.map((r) => [r.id, r] as const))("%s: the panel and the calculator, fed the panel's own answers, AS THEY ARE today", (_id, r) => {
    const p = panelOf(r);
    const c = calcOf(p);
    expect({ panel: fig(p), calc: fig(c) }).toEqual({ panel: r.want, calc: r.calc });
  });
  // 12e-6 AC6 a INVERTED by mechanical authority (owner R1: "nitrile rubber/XLPE" offers a stocked alternative). BEFORE: the
  // panel refused with the material AS WRITTEN ("No SKU in the catalogue for closed cell elastomeric nitrile rubber/XLPE
  // tubular insulation - price this row by hand") while the calculator priced 1,595 / 304; the section now prices and the two agree.
  it("as-written refusal: the panel's refusal is the material AS WRITTEN; its pipe item still prices (only the section refuses)", () => {
    const p = panelOf(ROWS[0]);
    expect(p.v.items[0].state).toBe("priced");
    expect(p.v.items[0].sections?.[0].view.rowPriced).toBe(true);
    expect(p.v.items[0].sections?.[0].view.items[0].familyLine).toBe("BoQ says closed cell elastomeric nitrile rubber/XLPE tubular insulation -> priced as Nitrile Rubber Insulation");
  });
  it("below smallest: the PIPE agrees on both surfaces (CPVC 25); only the insulation's pipe size differs (22.23 vs the mirrored 25)", () => {
    const p = panelOf(ROWS[1]);
    const c = calcOf(p);
    expect(p.v.items[0].figures).toEqual(c.v.items[0].figures);
    const ins = (x: Shown) => x.v.items[0].sections?.[0].view.items[0].fields.find((f) => f.id === "pipe_size_mm")?.value;
    expect(ins(p)).toBe("22.23");
    expect(ins(p)).not.toBe(ins(c));
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * VRF-2a (owner 2026-11-03; PARITY ruling 12:15 "check automatically that calculator and panel give the same answer
 * on every item") -- HVAC v56: VRF PRICES IN THE CALCULATOR, both surfaces compared on every item.
 *
 * TWO CONFIGS, AND WHY. The live v56 `hvac_vrf` carries `calculator_only` (owner Q1 A, temporary, removed at VRF-4): the
 * BoQ panel declines it and only the calculator (`calculatorSurface`) prices it. Parity is therefore asserted on the
 * config WITH THE KEY PROJECTED OUT -- exactly what both surfaces will run at VRF-4 -- and two further pins tie that
 * projection to what ships today: (1) the live config + the calculator's flag computes BYTE-IDENTICAL results to the
 * projected config, on every SKU and every named case; (2) the live config WITHOUT the flag (the BoQ panel) declines
 * with today's coming-soon text. The harness (`calculatorPanelParity.harness.ts`) is not changed: its calculator
 * helper is one flag short of `PricingCalculator` until VRF-4 removes the key, and pin (1) is what makes that safe.
 *
 * THE SHEET, INDEPENDENTLY: `VRF_SHEET` below is the R-SRC workbook's VRF sheet ("HVAC_BOQ_BCS PRICING_ Nitesh Edits - 2 nov
 * 2026.xlsx", sha256 30588ddb...), read cell by cell (openpyxl, cached values) in VRF-2a, never from either mint: row,
 * BRAND, Model, BOQ SUPPLY rounded up (R-ROUND), BOQ INSTALLATION. Rows 105 / 106 are the two retired ductables.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
const VRF_SHEET: ReadonlyArray<readonly [number, string, string, number, number]> = [
  [2, "BLUE STAR", "IVRFB-28TCN", 568920, 28000],
  [3, "BLUE STAR", "IVRFB-26TCN", 547440, 26000],
  [4, "BLUE STAR", "IVRFB-24TCN", 511560, 24000],
  [5, "BLUE STAR", "IVRFB-22TC / TCN", 486120, 22000],
  [6, "BLUE STAR", "IVRFB-20TC / TCN", 476040, 20000],
  [7, "BLUE STAR", "IVRFB-18TC / TCN", 452040, 18000],
  [8, "BLUE STAR", "IVRFB-16TCN", 381600, 16000],
  [9, "BLUE STAR", "IVRFB-16TC", 436920, 16000],
  [10, "BLUE STAR", "IVRFB-14TCN", 363360, 14000],
  [11, "BLUE STAR", "IVRFB-14TC", 405240, 14000],
  [12, "BLUE STAR", "IVRFB-12TC / TCN", 312480, 12000],
  [13, "BLUE STAR", "IVRFB-10TC / TCN", 301560, 10000],
  [14, "BLUE STAR", "IVRFB-08TC / TCN", 289800, 8000],
  [15, "BLUE STAR", "IVRFB-07TC", 264240, 7000],
  [16, "BLUE STAR", "IVRFB-28THN", 591600, 28000],
  [17, "BLUE STAR", "IVRFB-26THN", 567360, 26000],
  [18, "BLUE STAR", "IVRFB-24THN", 537000, 24000],
  [19, "BLUE STAR", "IVRFB-22TH / THN", 509640, 22000],
  [20, "BLUE STAR", "IVRFB-20TH / THN", 502440, 20000],
  [21, "BLUE STAR", "IVRFB-18TH / THN", 483600, 18000],
  [22, "BLUE STAR", "IVRFB-16THN", 401400, 16000],
  [23, "BLUE STAR", "IVRFB-16TH", 453120, 16000],
  [24, "BLUE STAR", "IVRFB-14THN", 381600, 14000],
  [25, "BLUE STAR", "IVRFB-14TH", 423480, 14000],
  [26, "BLUE STAR", "IVRFB-12TH / THN", 324000, 12000],
  [27, "BLUE STAR", "IVRFB-10TH / THN", 308640, 10000],
  [28, "BLUE STAR", "IVRFB-08TH / THN", 305280, 8000],
  [29, "BLUE STAR", "IVRFB-07TH", 286080, 7000],
  [30, "BLUE STAR", "IVRFB-04SC", 114120, 4000],
  [31, "BLUE STAR", "IVRFB-05SC", 125664, 5000],
  [32, "BLUE STAR", "IVRFB-06SC", 152724, 6000],
  [33, "BLUE STAR", "IVRFB-08SC", 185988, 8000],
  [34, "BLUE STAR", "IVRFB-10SC", 209616, 10000],
  [35, "BLUE STAR", "IVRFB-12SC", 225060, 12000],
  [36, "BLUE STAR", "IVRFB-14SC", 298464, 14000],
  [37, "BLUE STAR", "IVRFB-16SC", 305316, 16000],
  [38, "BLUE STAR", "IVRFB-04SH", 125796, 4000],
  [39, "BLUE STAR", "IVRFB-05SH", 135960, 5000],
  [40, "BLUE STAR", "IVRFB-06SH", 151800, 6000],
  [41, "BLUE STAR", "IVRFB-08SH", 196548, 8000],
  [42, "BLUE STAR", "IVRFB-10SH", 222000, 10000],
  [43, "BLUE STAR", "IVRFB-12SH", 244224, 12000],
  [44, "BLUE STAR", "IVRFB-14SH", 313104, 14000],
  [45, "BLUE STAR", "IVRFB-16SH", 322200, 16000],
  [46, "BLUE STAR", "VHW-10A", 18240, 1800],
  [47, "BLUE STAR", "VHW-12A", 18360, 1800],
  [48, "BLUE STAR", "VHW-16A", 20640, 1800],
  [49, "BLUE STAR", "VHW-18A", 20760, 1800],
  [50, "BLUE STAR", "VHW-20A", 23160, 1800],
  [51, "BLUE STAR", "VHW-24A", 23520, 1800],
  [52, "BLUE STAR", "VHW-30", 30840, 1800],
  [53, "BLUE STAR", "VHW-34", 31920, 1800],
  [54, "BLUE STAR", "VLC-12", 36960, 3500],
  [55, "BLUE STAR", "VLC-16", 37080, 3500],
  [56, "BLUE STAR", "VLC-18", 37320, 3500],
  [57, "BLUE STAR", "VLC-20", 38400, 3500],
  [58, "BLUE STAR", "VLC-24", 39360, 3500],
  [59, "BLUE STAR", "VLC-27", 39960, 3500],
  [60, "BLUE STAR", "VLC-34", 43200, 3500],
  [61, "BLUE STAR", "VLC-38", 43680, 3500],
  [62, "BLUE STAR", "VLC-48", 44040, 3500],
  [63, "BLUE STAR", "VLC-60A", 61680, 3500],
  [64, "BLUE STAR", "VCC-08", 30480, 3500],
  [65, "BLUE STAR", "VCC-10", 30960, 3500],
  [66, "BLUE STAR", "VCC-12", 31320, 3500],
  [67, "BLUE STAR", "VCC-16", 32400, 3500],
  [68, "BLUE STAR", "VCC-18", 32880, 3500],
  [69, "BLUE STAR", "VOC-08", 48960, 3500],
  [70, "BLUE STAR", "VOC-10", 50280, 3500],
  [71, "BLUE STAR", "VOC-12", 51480, 3500],
  [72, "BLUE STAR", "VOC-16", 66720, 3500],
  [73, "BLUE STAR", "VOC-19", 69120, 3500],
  [74, "BLUE STAR", "VOC-24", 75600, 3500],
  [75, "BLUE STAR", "VTC-08", 46440, 3500],
  [76, "BLUE STAR", "VTC-10", 47760, 3500],
  [77, "BLUE STAR", "VTC-12", 48480, 3500],
  [78, "BLUE STAR", "VTC-16", 56400, 3500],
  [79, "BLUE STAR", "VTC-18", 57720, 3500],
  [80, "BLUE STAR", "VTC-20", 59160, 3500],
  [81, "BLUE STAR", "VTC-24", 78000, 3500],
  [82, "BLUE STAR", "VFC-18", 42000, 3500],
  [83, "BLUE STAR", "VFC-24", 43560, 3500],
  [84, "BLUE STAR", "VFC-36", 48480, 3500],
  [85, "BLUE STAR", "VFC-48", 52080, 3500],
  [86, "BLUE STAR", "VFC-60", 54360, 3500],
  [87, "BLUE STAR", "VVC-24B", 41040, 3500],
  [88, "BLUE STAR", "VVC-27B", 41880, 3500],
  [89, "BLUE STAR", "VVC-34B", 49560, 3500],
  [90, "BLUE STAR", "VVC-38B", 51000, 3500],
  [91, "BLUE STAR", "VVC-48B", 51240, 3500],
  [92, "BLUE STAR", "DCS-10", 23640, 1800],
  [93, "BLUE STAR", "DCS-12", 24720, 1800],
  [94, "BLUE STAR", "DCS-16", 25080, 1800],
  [95, "BLUE STAR", "DCS-18", 25440, 1800],
  [96, "BLUE STAR", "DCS-24", 26880, 1800],
  [97, "BLUE STAR", "DSD-18", 24840, 5500],
  [98, "BLUE STAR", "DSD-24", 25680, 5500],
  [99, "BLUE STAR", "DSD-30", 31560, 5500],
  [100, "BLUE STAR", "DSD-36", 34920, 5500],
  [101, "BLUE STAR", "DSD-48", 40560, 5500],
  [102, "BLUE STAR", "DSD-60", 55200, 7500],
  [103, "BLUE STAR", "DSD-72", 58080, 7500],
  [104, "BLUE STAR", "DSD-96", 62280, 7500],
  [105, "BLUE STAR", "VFM-264A", 146400, 7500],
  [106, "BLUE STAR", "VFM-216A", 126120, 7500],
  [107, "BLUE STAR", "DFM-60", 73800, 7500],
  [108, "BLUE STAR", "DFM-96", 94680, 7500],
  [109, "BLUE STAR", "DFM-120", 99960, 11000],
  [110, "BLUE STAR", "DTFA-42", 49560, 7500],
  [111, "BLUE STAR", "DTFA-66", 60840, 7500],
  [112, "BLUE STAR", "DTFA-82", 71760, 7500],
  [113, "BLUE STAR", "NA", 4200, 800],
  [114, "BLUE STAR", "DAEKIT-050", 40920, 1000],
  [115, "BLUE STAR", "DAEKIT-065", 42120, 1000],
  [116, "BLUE STAR", "DAEKIT-080", 43320, 1000],
  [117, "BLUE STAR", "DAEKIT-100", 43920, 1000],
  [118, "BLUE STAR", "DAEKIT-150", 44040, 1000],
  [119, "BLUE STAR", "DAEKIT-200", 45240, 1000],
  [120, "BLUE STAR", "DAEKIT-300", 51480, 1000],
  [121, "BLUE STAR", "CDCO-D171-00", 1200, 200],
  [122, "BLUE STAR", "CDCO-D170-00", 2880, 200],
  [123, "BLUE STAR", "", 42000, 1500],
  [124, "DAIKIN", "RXQ20BRY16", 425685, 32000],
  [125, "DAIKIN", "RXQ16BRY16", 351728, 25600],
  [126, "DAIKIN", "RXQ12BRY16", 264230, 19200],
  [127, "DAIKIN", "RXQ6BRY16", 199460, 9600],
  [128, "DAIKIN", "18HP+16HP", 943316, 54400],
  [129, "DAIKIN", "RXYQ20BRY11", 536804, 32000],
  [130, "DAIKIN", "RXYQ8BRY16", 253743, 12800],
  [131, "DAIKIN", "RXYQ6BRY16", 239030, 9600],
  [132, "DAIKIN", "NA", 125890, 8000],
  [133, "DAIKIN", "NA", 141609, 9600],
  [134, "DAIKIN", "NA", 66360, 7500],
  [135, "DAIKIN", "NA", 101640, 7500],
  [136, "DAIKIN", "NA", 107160, 7500],
  [137, "DAIKIN", "NA", 45728, 3500],
  [138, "DAIKIN", "NA", 48600, 3500],
  [139, "DAIKIN", "NA", 50640, 3500],
  [140, "DAIKIN", "NA", 57360, 3500],
  [141, "DAIKIN", "NA", 58440, 3500],
  [142, "DAIKIN", "NA", 66956, 3500],
  [143, "DAIKIN", "NA", 51120, 3500],
  [144, "DAIKIN", "NA", 54720, 3500],
  [145, "DAIKIN", "NA", 56640, 3500],
  [146, "DAIKIN", "NA", 59760, 3500],
  [147, "DAIKIN", "NA", 62040, 3500],
  [148, "DAIKIN", "NA", 28200, 1800],
  [149, "DAIKIN", "NA", 31560, 1800],
  [150, "DAIKIN", "NA", 32760, 1800],
  [151, "DAIKIN", "NA", 4200, 800],
  [152, "DAIKIN", "NA", 2160, 200],
  [153, "DAIKIN", "NA", 3360, 200],
];

describe("HVAC VRF (VRF-2a, v56) -- the calculator prices every VRF SKU at the sheet's figure; panel = calculator on every item; the BoQ panel stays off", () => {
  const v56 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v56.json", import.meta.url),
  );
  const VRF = "hvac_vrf";
  // brand is an ITEM column, projected into the attributes at read time (extraction.PROJECTED_ITEM_COLUMNS / the API)
  const items56: RateMasterItem[] = v56.items.map((it) => ({
    ...it, discipline: v56.discipline,
    attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes },
  } as RateMasterItem));
  const live = new Map<string, RateCategoryConfig>(v56.category_configs.map((c) => [c.category_id, c]));
  const projected = new Map<string, RateCategoryConfig>([...live].map(([k, c]) => {
    if (k !== VRF) return [k, c];
    const { calculator_only: _off, ...rest } = c as RateCategoryConfig & { calculator_only?: unknown };
    return [k, rest as RateCategoryConfig];
  }));
  const calcFlag = makePricingSheetHelper({ configsByCategory: live, items: items56, extractionByRow: new Map() });
  const vc = (unit: string, a: Record<string, string>): ParityCase => ({ cat: VRF, unit, desc: "", attrs: {}, items: [a] });
  /** One case through both surfaces on the projected config, plus the two ties to what ships today. */
  const run = (c: ParityCase) => {
    const r = runParity(projected, items56, c, "full");
    const flag = calcFlag.compute(calculatorCtx("HVAC", VRF), r.feed.overrides);
    const boq = panelHelper(live, items56, c).compute(panelCtx(c));
    return { ...r, flagSame: JSON.stringify(flag) === JSON.stringify(r.calculator), boq };
  };
  const view = (x: unknown) => (x as ItemListSuggestion).itemList!;
  const figs = (x: unknown): [number, number] | string => {
    const v = view(x);
    return v.rowPriced ? [v.totals!.supply_rate as number, v.totals!.install_rate as number] : (v.reason ?? "?");
  };
  const skus = items56.filter((it) => it.kind === "hvac_vrf_item");

  it("the fixture: v56 holds 150 VRF SKUs, the two ductables gone, and the sheet table is 152 rows (rows 2..153)", () => {
    expect(skus).toHaveLength(150);
    expect(VRF_SHEET).toHaveLength(152);
    expect(VRF_SHEET.map((r) => r[0])).toEqual(Array.from({ length: 152 }, (_, i) => i + 2));
    expect(skus.map((s) => s.attributes.model)).not.toContain("VFM-216A");
    expect(skus.map((s) => s.attributes.model)).not.toContain("VFM-264A");
    expect((live.get(VRF) as { calculator_only?: unknown }).calculator_only).toBe(true);
    expect((projected.get(VRF) as { calculator_only?: unknown }).calculator_only).toBeUndefined();
  });

  it("every one of the 150 SKUs: the calculator's price = the sheet (BOQ SUPPLY rounded up, BOQ INSTALLATION); panel = calculator; the live calculator = the projection; the live BoQ panel declines", () => {
    const sheet = new Map(VRF_SHEET.map((r) => [r[0], r]));
    const bad: string[] = [];
    let priced = 0, equal = 0, flagSame = 0, declined = 0;
    for (const sku of skus) {
      const a = sku.attributes as Record<string, unknown>;
      const attrs: Record<string, string> = { item: String(a.item), brand: String(a.brand) };
      for (const k of ["cooling", "discharge", "compressor", "way", "remote_type"]) if (a[k] !== undefined) attrs[k] = String(a[k]);
      if (a.capacity !== undefined) attrs.capacity = String(a.capacity);
      const row = (sku as { source?: { row?: number } }).source?.row as number;
      const sh = sheet.get(row)!;
      const r = run(vc("Nos", attrs));
      const want: [number, number] = [sh[3], sh[4]];
      const got = figs(r.calculator);
      if (r.divergences.length) bad.push(`row ${row} ${a.model}: ` + r.divergences.map((d) => d.what).join(" | "));
      if (hasPrice(r.calculator)) priced++;
      if (JSON.stringify(got) === JSON.stringify(want)) equal++; else bad.push(`row ${row} ${a.model}: calculator ${JSON.stringify(got)} vs sheet ${JSON.stringify(want)}`);
      if (String(sh[1]).toUpperCase() !== String(a.brand).toUpperCase()) bad.push(`row ${row}: brand ${a.brand} vs sheet ${sh[1]}`);
      if (a.model !== undefined && sh[2] !== a.model) bad.push(`row ${row}: model ${a.model} vs sheet ${sh[2]}`);
      if (r.flagSame) flagSame++;
      if (r.boq.kind === "none" && (r.boq as { reason?: string }).reason === COMING_SOON_REASON) declined++;
    }
    expect(bad).toEqual([]);
    // INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; D-10) by mechanical authority: BEFORE the live (frozen, `calculator_only`) BoQ panel DECLINED
    // every case (`declined` = the case count; "did not decline" was a defect). The key is read by nothing now: the BoQ panel declines none
    expect({ priced, equal, flagSame, declined }).toEqual({ priced: 150, equal: 150, flagSame: 150, declined: 0 });
  }, 120000);

  it("the generated sweep: 13 families x 1 unit class x (filled, above the largest, between, nothing) = 46 cases, not one divergence", () => {
    const cases = itemListCasesForCategory(projected.get(VRF)!, items56);
    expect(cases).toHaveLength(46);
    expect(new Set(cases.map((c) => c.items?.[0]?.item as string)).size).toBe(13);
    expect(new Set(cases.map((c) => c.unit))).toEqual(new Set(["Nos"]));
    const bad: string[] = [];
    for (const c of cases) {
      const r = run(c);
      if (r.divergences.length) bad.push(`${JSON.stringify(c.items)}: ` + r.divergences.map((d) => `${d.what} P[${d.panel}] C[${d.calculator}]`).join(" | "));
      if (!r.flagSame) bad.push(`${JSON.stringify(c.items)}: the live calculator differs from the projection`);
    }
    expect(bad).toEqual([]);
  }, 120000);

  // Every rule, by name: [label, unit, the item's answers, the expected figures or refusal (identical on both surfaces)]
  const NAMED: Array<[string, string, Record<string, string>, [number, number] | string]> = [
    ["brand not stated -> Blue Star (C1, IVRFB-16TC)", "Nos", { item: "Outdoor Unit", capacity: "16" }, [436920, 16000]],
    ["Daikin stated, Heat Pump, 8 HP (C2, RXYQ8BRY16)", "Nos", { item: "Outdoor Unit", brand: "Daikin", cooling: "Heat Pump", capacity: "8" }, [253743, 12800]],
    ["Heat Pump stated -> the heat-pump SKU (IVRFB-16TH)", "Nos", { item: "Outdoor Unit", cooling: "Heat Pump", capacity: "16" }, [453120, 16000]],
    ["Single Compressor stated (Blue Star 16, IVRFB-16TCN)", "Nos", { item: "Outdoor Unit", compressor: "Single Compressor", capacity: "16" }, [381600, 16000]],
    ["cassette way not stated -> FOUR-WAY, 1.5 TR (C3)", "Nos", { item: "Cassette", capacity: "1.5" }, [37320, 3500]],
    ["remote type not stated -> Wired (C5)", "Nos", { item: "Remote Controller" }, [2880, 200]],
    ["remote Cordless stated", "Nos", { item: "Remote Controller", remote_type: "Cordless" }, [1200, 200]],
    ["central controller, Daikin -> Blue Star (C5)", "Nos", { item: "Touch Screen Central Controller", brand: "Daikin" }, [42000, 1500]],
    ["central controller, no brand", "Nos", { item: "Touch Screen Central Controller" }, [42000, 1500]],
    ["refnet, Blue Star: one flat price", "Nos", { item: "Refnet/Y-Joint", brand: "Blue Star" }, [4200, 800]],
    ["refnet, Daikin: one flat price", "Nos", { item: "Refnet/Y-Joint", brand: "Daikin" }, [4200, 800]],
    ["15 HP -> 16 (next size up)", "Nos", { item: "Outdoor Unit", capacity: "15" }, [436920, 16000]],
    ["2 HP -> 7 (below the smallest)", "Nos", { item: "Outdoor Unit", capacity: "2" }, [264240, 7000]],
    ["40 HP refuses (above the largest)", "Nos", { item: "Outdoor Unit", capacity: "40" }, "capacity 40 is above the largest size on the sheet (28)"],
    ["ductable 8 TR, Blue Star: the largest left (DSD-96)", "Nos", { item: "Ductable", brand: "Blue Star", capacity: "8" }, [62280, 7500]],
    ["ductable 11 TR, Blue Star, refuses (R-RETIRE; C4)", "Nos", { item: "Ductable", brand: "Blue Star", capacity: "11" }, "capacity 11 is above the largest size on the sheet (8)"],
    ["ductable 18 TR, Blue Star, refuses (VFM-216A retired)", "Nos", { item: "Ductable", brand: "Blue Star", capacity: "18" }, "capacity 18 is above the largest size on the sheet (8)"],
    ["ductable 22 TR, Blue Star, refuses (VFM-264A retired)", "Nos", { item: "Ductable", brand: "Blue Star", capacity: "22" }, "capacity 22 is above the largest size on the sheet (8)"],
    ["ductable 11 TR, Daikin, refuses", "Nos", { item: "Ductable", brand: "Daikin", capacity: "11" }, "capacity 11 is above the largest size on the sheet (8)"],
    ["indoor type not stated refuses (C6)", "Nos", { item: "None", capacity: "2" }, "no item could be told for this item"],
    ["'none of these' refuses for a person", "Nos", { item: "none of these" }, "no SKU in the catalogue for 'none of these' -- the user decides"],
    ["Daikin on Verticool refuses by name (D-7; C6)", "Nos", { item: "Verticool", brand: "Daikin", capacity: "2" }, "No SKU for Verticool: brand Daikin - price this row by hand"],
    ["Daikin Side discharge Heat Pump refuses by name", "Nos", { item: "Outdoor Unit", brand: "Daikin", cooling: "Heat Pump", discharge: "Side", capacity: "8" },
      "No SKU for Outdoor Unit: brand Daikin, cool / heat Heat Pump, discharge Side, compressor Standard - price this row by hand"],
    ["no capacity stated refuses", "Nos", { item: "Outdoor Unit" }, "no capacity stated"],
    ["unit 'nos'", "nos", { item: "Outdoor Unit", capacity: "16" }, [436920, 16000]],
    ["unit 'No.'", "No.", { item: "Outdoor Unit", capacity: "16" }, [436920, 16000]],
    ["unit 'No.s'", "No.s", { item: "Outdoor Unit", capacity: "16" }, [436920, 16000]],
    ["unit 'EACH'", "EACH", { item: "Outdoor Unit", capacity: "16" }, [436920, 16000]],
    ["unit 'Nos/Ro' counts as Nos (QR-2 A)", "Nos/Ro", { item: "Outdoor Unit", capacity: "16" }, [436920, 16000]],
    ["no unit: priced in the item's own unit", "", { item: "Outdoor Unit", capacity: "16" }, [436920, 16000]],
  ];

  it(`every rule, by name (${NAMED.length} cases): the figure or the refusal, identical on both surfaces; the live calculator = the projection; the BoQ panel declines`, () => {
    expect(NAMED).toHaveLength(30);
    const bad: string[] = [];
    const reached = new Set<string>();
    for (const [label, unit, a, want] of NAMED) {
      const r = run(vc(unit, a));
      for (const p of resolutionPaths(r.panel)) reached.add(p);
      if (r.divergences.length) bad.push(`${label}: ` + r.divergences.map((d) => `${d.what} P[${d.panel}] C[${d.calculator}]`).join(" | "));
      if (JSON.stringify(figs(r.calculator)) !== JSON.stringify(want)) bad.push(`${label}: calculator ${JSON.stringify(figs(r.calculator))} vs ${JSON.stringify(want)}`);
      if (!r.flagSame) bad.push(`${label}: the live calculator differs from the projection`);
      // INVERTED at VRF-4 (Q1 A; D-10) by mechanical authority: BEFORE a live BoQ panel that did NOT decline was the defect; now one that declines is
      if (r.boq.kind === "none") bad.push(`${label}: the live BoQ panel declined`);
    }
    expect(bad).toEqual([]);
    for (const p of ["item-list priced", "item-list refused", "item refused", "default fired", "ladder size-up"]) expect([...reached]).toContain(p);
  }, 120000);

  it("the defaults are AMBER with their own rule lines on both surfaces (brand, cool / heat, discharge, compressor, way, remote type)", () => {
    const fieldsOf = (x: unknown) => view(x).items[0].fields;
    const cases: Array<[Record<string, string>, Record<string, [string, string]>]> = [
      [{ item: "Outdoor Unit", capacity: "16" }, {
        brand: ["Blue Star", "no brand stated - priced as Blue Star"],
        cooling: ["Cool Only", "cooling not stated - priced as Cool Only (team default: heat pump only when the BoQ mentions it)"],
        discharge: ["Top", "discharge not stated - priced as Top discharge (team default)"],
        compressor: ["Standard", "compressor not stated - priced as Standard (team default)"] }],
      [{ item: "Cassette", capacity: "1.5" }, { way: ["FOUR-WAY", "cassette way not stated - priced as 4-way (team default)"] }],
      [{ item: "Remote Controller" }, { remote_type: ["Wired", "remote type not stated - priced as Wired (R-SMALL)"] }],
    ];
    for (const [a, want] of cases) {
      const r = run(vc("Nos", a));
      for (const surface of [r.panel] as unknown[]) {
        const fs = fieldsOf(surface);
        for (const [id, [value, rule]] of Object.entries(want)) {
          const f = fs.find((x) => x.id === id)!;
          expect({ id, value: f.value, defaulted: f.defaulted, rule: f.rule }).toEqual({ id, value, defaulted: true, rule });
        }
      }
      // a STATED value is never amber: Daikin stated on the outdoor unit is the pick, not a default
      if (a.item === "Outdoor Unit") {
        const d = run(vc("Nos", { ...a, brand: "Daikin", capacity: "8" }));
        expect(fieldsOf(d.panel).find((x) => x.id === "brand")!.defaulted).toBe(false);
      }
    }
  });

  it("the controller map has its own line: a Daikin pick on the central controller is priced as Blue Star and says so", () => {
    const r = run(vc("Nos", { item: "Touch Screen Central Controller", brand: "Daikin" }));
    const b = view(r.panel).items[0];
    const lines = [...b.working, ...b.fields.map((f) => f.note ?? ""), ...b.fields.map((f) => f.rule ?? "")].join(" | ");
    expect(lines).toContain("the central controller is Blue Star only on the sheet - a Daikin pick is priced as Blue Star (R-SMALL)");
  });

  it("the unit exclusions, by name: Kg, Set, Sets, Lot, per HP, RMT -- the panel refuses each by name, never a figure; the calculator's picker does not offer them (cause C)", () => {
    const want: Record<string, string> = {
      Kg: "Outdoor Unit is not stocked per 'Kg' (stocked per Nos) - price this row by hand",   // QR-3 A: no weight class until VRF-2c
      Set: "Outdoor Unit is not stocked per 'Set' (stocked per Nos) - price this row by hand",
      Sets: "Outdoor Unit is not stocked per 'Sets' (stocked per Nos) - price this row by hand",
      Lot: "Outdoor Unit is not stocked per 'Lot' (stocked per Nos) - price this row by hand",
      "per HP": "Outdoor Unit is not stocked per 'per HP' (stocked per Nos) - price this row by hand",
      RMT: "Outdoor Unit is not stocked per 'RMT' (stocked per Nos) - price this row by hand",
    };
    for (const [unit, reason] of Object.entries(want)) {
      const c = vc(unit, { item: "Outdoor Unit", capacity: "16" });
      const r = run(c);
      expect({ unit, panel: figs(r.panel) }).toEqual({ unit, panel: reason });
      expect(hasPrice(r.panel)).toBe(false);
      expect(r.divergences.length).toBeGreaterThan(0);
      expect(classifyDivergence(r, c)).toBe("C_unit_not_offered");
    }
  });

  it("KNOWN DIVERGENCE, NAMED until VRF-2c (VRF-R2 R11): an off-sheet brand ('Toshiba') -- both surfaces refuse, in different words, no figure on either", () => {
    const r = run(vc("Nos", { item: "Outdoor Unit", brand: "Toshiba", capacity: "16" }));
    expect(r.divergences.length).toBe(2);
    expect(hasPrice(r.panel)).toBe(false);
    expect(hasPrice(r.calculator)).toBe(false);
    expect(figs(r.calculator)).toBe("choose again: brand -- the value picked is not stocked with the other answers on this item");
    expect(String(figs(r.panel))).toContain("Toshiba");
  });

  it("VACUITY: handing the calculator a different size diverges (the comparison can see a VRF difference)", () => {
    const c = vc("Nos", { item: "Outdoor Unit", capacity: "16" });
    expect(run(c).divergences).toEqual([]);
    const pr = panelHelper(projected, items56, c).compute(panelCtx(c), {});
    const cr = calcFlag.compute(calculatorCtx("HVAC", VRF), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "Outdoor Unit", attrs: { capacity: "18" }, other: [] }] }), [ROW_UNIT_OVERRIDE_KEY]: "Nos" });
    expect((pr as ItemListSuggestion).values.supply_rate).toBe(436920);
    expect((cr as ItemListSuggestion).values.supply_rate).toBe(452040);
  });
});

/**
 * VRF-2b (owner 2026-11-03: R-CONV, CFM "Refuse, named", RECON Q2, QR-2 A, QR-3 A, R-BRAND (a); PARITY 12:15 "check
 * automatically that calculator and panel give the same answer on every item") -- THE v57 VRF BLOCK. The asset that
 * switches VRF-2b on: every VRF and Misc SKU at the sheet's figure, panel = calculator on every case (brand projected,
 * `calculator_only` projected out = VRF-4's state; the live calculator with its flag = that projection; the live BoQ panel
 * still declines). VRF-2a's v56 block above is kept as it was -- its named "Toshiba" divergence pins v56; on v57 the
 * divergence is GONE (the brand note), asserted below.
 */
describe("HVAC VRF (VRF-2b, v57) -- HP / TR / kW read and converted, the Misc four, the notes; panel = calculator on every case", () => {
  const v57 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v57.json", import.meta.url),
  );
  const VRF = "hvac_vrf";
  const items57: RateMasterItem[] = v57.items.map((it) => ({
    ...it, discipline: v57.discipline,
    attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes },
  } as RateMasterItem));
  const live = new Map<string, RateCategoryConfig>(v57.category_configs.map((c) => [c.category_id, c]));
  const projected = new Map<string, RateCategoryConfig>([...live].map(([k, c]) => {
    if (k !== VRF) return [k, c];
    const { calculator_only: _off, ...rest } = c as RateCategoryConfig & { calculator_only?: unknown };
    return [k, rest as RateCategoryConfig];
  }));
  const calcFlag = makePricingSheetHelper({ configsByCategory: live, items: items57, extractionByRow: new Map() });
  const vc = (unit: string, a: Record<string, string>): ParityCase => ({ cat: VRF, unit, desc: "", attrs: {}, items: [a] });
  const run = (c: ParityCase) => {
    const r = runParity(projected, items57, c, "full");
    const flag = calcFlag.compute(calculatorCtx("HVAC", VRF), r.feed.overrides);
    const boq = panelHelper(live, items57, c).compute(panelCtx(c));
    return { ...r, flagSame: JSON.stringify(flag) === JSON.stringify(r.calculator), boq };
  };
  const view = (x: unknown) => (x as ItemListSuggestion).itemList!;
  const figs = (x: unknown): [number, number] | string => {
    const v = view(x);
    return v.rowPriced ? [v.totals!.supply_rate as number, v.totals!.install_rate as number] : (v.reason ?? "?");
  };
  const lines = (x: unknown) => { const b = view(x).items[0]; return [...(b?.working ?? []), ...(b?.fields ?? []).flatMap((f) => [f.note ?? "", f.rule ?? ""]), view(x).unitNote ?? ""].join(" | "); };
  const skus = items57.filter((it) => it.kind === "hvac_vrf_item");
  const MISC: Array<[string, string, [number, number]]> = [
    ["Drain Pump", "Nos", [3500, 750]], ["BACnet Integration Controller for VRF Units", "Nos", [50000, 4500]],
    ["Refrigerant Gas Filling (R-410)", "Kg", [1020, 350]], ["MS Angle Base Frame Structure", "Kg", [140, 40]],
  ];

  it("the fixture: v57 = 150 VRF SKUs + 4 Misc, the switch still on; the projection takes it off", () => {
    expect(skus).toHaveLength(150);
    expect(items57.filter((it) => it.kind === "hvac_misc_item")).toHaveLength(4);
    expect((live.get(VRF) as { calculator_only?: unknown }).calculator_only).toBe(true);
    expect((projected.get(VRF) as { calculator_only?: unknown }).calculator_only).toBeUndefined();
  });

  it("every one of the 150 VRF SKUs and the 4 Misc: calculator = the sheet; panel = calculator; live calculator = the projection; the live BoQ panel declines", () => {
    const sheet = new Map(VRF_SHEET.map((r) => [r[0], r]));
    const bad: string[] = [];
    let equal = 0, flagSame = 0, declined = 0, parity = 0;
    const tally = (label: string, r: ReturnType<typeof run>, want: [number, number]) => {
      if (r.divergences.length) bad.push(`${label}: ` + r.divergences.map((d) => d.what).join(" | ")); else parity++;
      if (JSON.stringify(figs(r.calculator)) === JSON.stringify(want)) equal++; else bad.push(`${label}: calculator ${JSON.stringify(figs(r.calculator))} vs ${JSON.stringify(want)}`);
      if (r.flagSame) flagSame++;
      if (r.boq.kind === "none" && (r.boq as { reason?: string }).reason === COMING_SOON_REASON) declined++;
    };
    for (const sku of skus) {
      const a = sku.attributes as Record<string, unknown>;
      const attrs: Record<string, string> = { item: String(a.item), brand: String(a.brand) };
      for (const k of ["cooling", "discharge", "compressor", "way", "remote_type"]) if (a[k] !== undefined) attrs[k] = String(a[k]);
      if (a.capacity !== undefined) attrs.capacity = String(a.capacity);
      const row = (sku as { source?: { row?: number } }).source?.row as number;
      const sh = sheet.get(row)!;
      tally(`row ${row} ${a.model}`, run(vc("Nos", attrs)), [sh[3], sh[4]]);
    }
    for (const [fam, unit, want] of MISC) tally(fam, run(vc(unit, { item: fam })), want);
    expect(bad).toEqual([]);
    // INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; D-10) by mechanical authority: BEFORE the live (frozen, `calculator_only`) BoQ panel DECLINED
    // every case (`declined` = the case count; "did not decline" was a defect). The key is read by nothing now: the BoQ panel declines none
    expect({ equal, parity, flagSame, declined }).toEqual({ equal: 154, parity: 154, flagSame: 154, declined: 0 });
  }, 180000);

  it("the generated sweep (13 VRF families + the Misc four, each in its own unit): not one divergence", () => {
    const cases = itemListCasesForCategory(projected.get(VRF)!, items57);
    expect(new Set(cases.map((c) => c.items?.[0]?.item as string)).size).toBe(17);
    const bad: string[] = [];
    for (const c of cases) {
      const r = run(c);
      if (r.divergences.length) bad.push(`${JSON.stringify(c.items)} ${c.unit}: ` + r.divergences.map((d) => `${d.what} P[${d.panel}] C[${d.calculator}]`).join(" | "));
      if (!r.flagSame) bad.push(`${JSON.stringify(c.items)}: the live calculator differs from the projection`);
    }
    expect(bad).toEqual([]);
    expect(cases.length).toBeGreaterThan(46);
  }, 180000);

  // [label, unit, answers, the expected figures or refusal, a line that must be said (or "" for none)]
  const NAMED: Array<[string, string, Record<string, string>, [number, number] | string, string]> = [
    ["C1: 16 TR on an Outdoor Unit -> 20 HP (IVRFB-20TC)", "Nos", { item: "Outdoor Unit", capacity: "16 TR" }, [476040, 20000], "16 TR x 1.25 (HP per TR, Pricing Inputs) = 20 HP"],
    ["C2: 4 HP on a Cassette -> 3.2 TR (VLC-38)", "Nos", { item: "Cassette", capacity: "4 HP" }, [43680, 3500], "4 HP / 1.25 (HP per TR, Pricing Inputs) = 3.2 TR"],
    ["C3: 5 kW on a Hi-Wall -> 1.42 -> 1.5 TR (VHW-18A)", "Nos", { item: "Hi-Wall", brand: "Blue Star", capacity: "5 kW" }, [20760, 1800], "5 kW / 3.517 (kW per TR, Pricing Inputs) = 1.42 TR"],
    ["kW on an HP family: 45 kW -> 15.99 -> 16 HP", "Nos", { item: "Outdoor Unit", capacity: "45 kW" }, [436920, 16000], "45 kW / 3.517 (kW per TR, Pricing Inputs) x 1.25 (HP per TR, Pricing Inputs) = 15.99 HP"],
    ["TR on an HP family, TR -> HP (12 TR -> 15 -> 16 HP)", "Nos", { item: "Outdoor Unit", capacity: "12 TR" }, [436920, 16000], "12 TR x 1.25 (HP per TR, Pricing Inputs) = 15 HP"],
    ["the family's own unit stated: no conversion line", "Nos", { item: "Outdoor Unit", capacity: "16 HP" }, [436920, 16000], ""],
    ["both units -> the family's ('22.5 TR / 18 HP' -> 18 HP)", "Nos", { item: "Outdoor Unit", capacity: "22.5 TR / 18 HP" }, [452040, 18000], "the row states 18 HP and 22.5 TR - 18 HP is used (Outdoor Unit is stocked in HP); 22.5 TR is not read"],
    ["CFM only refuses, named (C5)", "Nos", { item: "Concealed Split", capacity: "670 CFM" }, "capacity is stated only as an airflow (670 CFM) - an airflow is not converted to HP / TR - price this row by hand", ""],
    ["a capacity beside an airflow is read ('1.0 TR / 459 CFM')", "Nos", { item: "Cassette", capacity: "1.0 TR / 459 CFM" }, [36960, 3500], "459 CFM is an airflow - not read"],
    ["K5: an airflow-only text reads the bracketed capacity ('670Cfm Wall Mounted Type (2.0 TR)' -> VHW-24A)", "Nos", { item: "Hi-Wall", brand: "Blue Star", capacity: "670Cfm Wall Mounted Type (2.0 TR)" }, [23520, 1800], "670 CFM is an airflow - not read; (2.0 TR) in brackets is read -> 2 TR"],
    ["K5 (QR-K5a B): the bracket wins over a stray number outside ('459Cfm 4- Way Cassette Type (1.02TR)' -> 1 TR, not 4)", "Nos", { item: "Cassette", capacity: "459Cfm 4- Way Cassette Type (1.02TR)- High Static" }, [36960, 3500], "459 CFM is an airflow - not read; 4 outside the brackets is not read; (1.02TR) in brackets is read -> 1.02 TR -> priced as 1 TR (the sheet's own spelling of this size)"],
    ["K5: two bracketed capacities refuse as several values", "Nos", { item: "Hi-Wall", brand: "Blue Star", capacity: "670 CFM (2.0 TR) (2.5 TR)" }, "several values stated for capacity ('670 CFM (2.0 TR) (2.5 TR)')", ""],
    ["several values refuse as today", "Nos", { item: "Outdoor Unit", capacity: "20+18 HP" }, "several values stated for capacity ('20+18 HP')", ""],
    ["brand off the sheet ('Toshiba') -> Blue Star, named", "Nos", { item: "Outdoor Unit", brand: "Toshiba", capacity: "16" }, [436920, 16000], "brand Toshiba is not on the sheet - priced as Blue Star"],
    ["several brands -> Blue Star, named", "Nos", { item: "Outdoor Unit", brand: "Daikin / Blue Star", capacity: "16" }, [436920, 16000], "several brands stated (Daikin / Blue Star) - priced as Blue Star"],
    ["one sheet brand read as stated (Daikin 8 HP heat pump)", "Nos", { item: "Outdoor Unit", brand: "Daikin", cooling: "Heat Pump", capacity: "8" }, [253743, 12800], ""],
    ["no brand -> Blue Star (as v56)", "Nos", { item: "Outdoor Unit", capacity: "16" }, [436920, 16000], "no brand stated - priced as Blue Star"],
    ["'Nos/Ro' read as Nos, with its line (QR-2 A)", "Nos/Ro", { item: "Outdoor Unit", capacity: "16" }, [436920, 16000], "unit 'Nos/Ro' read as Nos"],
    ["the gas per 'kgs'", "kgs", { item: "Refrigerant Gas Filling (R-410)" }, [1020, 350], ""],
  ];

  it(`every 2b rule, by name (${NAMED.length} cases): the figure or the refusal and the line, identical on both surfaces; the live calculator = the projection; the BoQ panel declines`, () => {
    expect(NAMED).toHaveLength(19);   // + K5's three
    const bad: string[] = [];
    for (const [label, unit, a, want, line] of NAMED) {
      const r = run(vc(unit, a));
      if (r.divergences.length) bad.push(`${label}: ` + r.divergences.map((d) => `${d.what} P[${d.panel}] C[${d.calculator}]`).join(" | "));
      if (JSON.stringify(figs(r.calculator)) !== JSON.stringify(want)) bad.push(`${label}: calculator ${JSON.stringify(figs(r.calculator))} vs ${JSON.stringify(want)}`);
      if (JSON.stringify(figs(r.panel)) !== JSON.stringify(want)) bad.push(`${label}: panel ${JSON.stringify(figs(r.panel))} vs ${JSON.stringify(want)}`);
      if (line && !lines(r.panel).includes(line)) bad.push(`${label}: the panel does not say '${line}'`);
      if (line === "" && /Pricing Inputs/.test(lines(r.panel)) && /16 HP|own unit/.test(label)) bad.push(`${label}: a conversion line where none is due`);
      if (!r.flagSame) bad.push(`${label}: the live calculator differs from the projection`);
      // INVERTED at VRF-4 (Q1 A; D-10) by mechanical authority: BEFORE a live BoQ panel that did NOT decline was the defect; now one that declines is
      if (r.boq.kind === "none") bad.push(`${label}: the live BoQ panel declined`);
    }
    expect(bad).toEqual([]);
  }, 180000);

  it("the unit exclusions, by name: Kg on a Nos item, a Kg Misc on a Nos row, a Nos Misc on a Kg row, Set -- the panel refuses each by name, never a figure; the calculator's picker does not offer the unit (cause C)", () => {
    const want: Array<[string, Record<string, string>, string]> = [
      ["Kg", { item: "Outdoor Unit", capacity: "16" }, "Outdoor Unit is not stocked per Kg (stocked per Nos) - price this row by hand"],
      ["Nos", { item: "MS Angle Base Frame Structure" }, "MS Angle Base Frame Structure is not stocked per Nos (stocked per Kg) - price this row by hand"],
      ["Kg", { item: "Drain Pump" }, "Drain Pump is not stocked per Kg (stocked per Nos) - price this row by hand"],
      ["Set", { item: "Outdoor Unit", capacity: "16" }, "Outdoor Unit is not stocked per 'Set' (stocked per Nos) - price this row by hand"],
    ];
    for (const [unit, a, reason] of want) {
      const c = vc(unit, a);
      const r = run(c);
      expect({ unit, item: a.item, panel: figs(r.panel) }).toEqual({ unit, item: a.item, panel: reason });
      expect(hasPrice(r.panel)).toBe(false);
      expect(classifyDivergence(r, c)).toBe("C_unit_not_offered");
    }
  });

  it("the 'Toshiba' known divergence of v56 is GONE on v57: 0 divergences, both surfaces price as Blue Star with the note", () => {
    const r = run(vc("Nos", { item: "Outdoor Unit", brand: "Toshiba", capacity: "16" }));
    expect(r.divergences).toEqual([]);
    expect(figs(r.calculator)).toEqual([436920, 16000]);
    expect(figs(r.panel)).toEqual([436920, 16000]);
  });

  it("the rewriter: a model '12 TR' on an Outdoor Unit shows the size priced (16), never the option '12'", () => {
    const r = run(vc("Nos", { item: "Outdoor Unit", capacity: "12 TR" }));
    const f = view(r.panel).items[0].fields.find((x) => x.id === "capacity")!;
    expect(f.value).toBe("16");
    expect(f.optionLabels?.["16"]).toBe("16HP");
  });

  it("the picker on the calculator: a bare 16 with TR picked = '16 TR' typed = 20 HP; the panel has no picker value to read", () => {
    const cr = calcFlag.compute(calculatorCtx("HVAC", VRF), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "Outdoor Unit", attrs: { capacity: "16", capacity__unit: "TR" }, other: ["capacity"] }] }), [ROW_UNIT_OVERRIDE_KEY]: "Nos" });
    const typed = calcFlag.compute(calculatorCtx("HVAC", VRF), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "Outdoor Unit", attrs: { capacity: "16 TR" }, other: ["capacity"] }] }), [ROW_UNIT_OVERRIDE_KEY]: "Nos" });
    expect(figs(cr)).toEqual([476040, 20000]);
    expect(figs(typed)).toEqual([476040, 20000]);
  });

  it("VACUITY: handing the calculator a different capacity unit diverges (the comparison can see a 2b difference)", () => {
    const c = vc("Nos", { item: "Outdoor Unit", capacity: "16 TR" });
    expect(run(c).divergences).toEqual([]);
    const pr = panelHelper(projected, items57, c).compute(panelCtx(c), {});
    const cr = calcFlag.compute(calculatorCtx("HVAC", VRF), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "Outdoor Unit", attrs: { capacity: "16 HP" }, other: ["capacity"] }] }), [ROW_UNIT_OVERRIDE_KEY]: "Nos" });
    expect((pr as ItemListSuggestion).values.supply_rate).toBe(476040);
    expect((cr as ItemListSuggestion).values.supply_rate).toBe(436920);
  });

  /**
   * THE 22 ROWS (VRF-R2 R4: "an HP number on an indoor family is priced as TR" -- 22 rows, 19 groups, its own definition: a
   * phrase naming TR on the outdoor family or HP on any other that priced on v56). [family, way, phrase, rows, v56's size,
   * v57's size] -- the sizes recorded from the B5 probe (Lists.xlsx "22 rows"); the conversion arithmetic is checked here
   * independently: every HP-stated group now carries "<n> HP / 1.25 (HP per TR, Pricing Inputs) = <n / 1.25> TR".
   */
  const ROWS22: Array<[string, string | null, string, number, string, string]> = [["Cassette", "FOUR-WAY", "4 HP", 1, "4", "3.2"], ["Cassette", "FOUR-WAY", "2.5 HP", 1, "2.8", "2"], ["Cassette", "FOUR-WAY", "2 HP", 1, "2", "1.7"], ["Cassette", "FOUR-WAY", "1.3 HP", 1, "1.3", "1"], ["Hi-Wall", null, "2 HP", 1, "2", "1.7"], ["Hi-Wall", null, "1.3 HP", 1, "1.3", "1"], ["Hi-Wall", null, "1 HP", 1, "1", "0.8"], ["AHU Expansion Kit", null, "20HP", 1, "20", "20"], ["AHU Expansion Kit", null, "14HP", 1, "15", "15"], ["AHU Expansion Kit", null, "10HP", 1, "10", "8"], ["Hi-Wall", null, "2.0 HP (1.6 TR)", 1, "2", "1.7"], ["Hi-Wall", null, "2.5 HP (2.0 TR)", 1, "2.5", "2"], ["Cassette", null, "1.6 HP (1.3 TR)", 2, "1.7", "1.3"], ["Cassette", null, "1.9 HP (1.5 TR)", 3, "2", "1.5"], ["Cassette", null, "2.13 HP (1.7 TR)", 1, "2.3", "1.7"], ["Cassette", null, "2.9 HP (2.3 TR)", 1, "3.2", "2.3"], ["Cassette", null, "4.0 HP (3.2 TR)", 1, "4", "3.2"], ["Cassette", "ONE-WAY", "1.28 TR(1.6 HP)", 1, "1.3", "1.3"], ["Outdoor Unit", null, "3 TR", 1, "7", "7"]];
  it("THE 22 ROWS now read in the right unit: 19 groups / 22 rows, each HP group converted with its line, each at its v57 size, 0 divergences", () => {
    expect(ROWS22).toHaveLength(19);
    expect(ROWS22.reduce((a, r) => a + r[3], 0)).toBe(22);
    const bad: string[] = [];
    for (const [fam, way, phrase, , , want] of ROWS22) {
      const a: Record<string, string> = { item: fam, capacity: phrase };
      if (way) a.way = way;
      const r = run(vc("Nos", a));
      const f = view(r.panel).items[0]?.fields.find((x) => x.id === "capacity");
      if (r.divergences.length) bad.push(`${fam} ${phrase}: divergences`);
      if (f?.value !== want) bad.push(`${fam} ${phrase}: size ${f?.value} vs ${want}`);
      const hp = /^\s*([\d.]+)\s*HP/i.exec(phrase);
      if (hp && fam !== "Outdoor Unit") {
        const tr = Math.round((Number(hp[1]) / 1.25) * 100 + 1e-9) / 100;
        const line = `${Number(hp[1])} HP / 1.25 (HP per TR, Pricing Inputs) = ${tr} TR`;
        if (!lines(r.panel).includes(line)) bad.push(`${fam} ${phrase}: no line '${line}'`);
      }
    }
    expect(bad).toEqual([]);
  }, 120000);
});

/**
 * VRF-3a (owner R-SPLIT (a) / (b), R-SPLIT-RULE, D-1 / D-2 / D-3 / D-8, SHAPE Q2 / Q3, SET / LOT, QR-1 (a); PARITY "calculator =
 * panel") -- HVAC v58. The same projection as the VRF-2a / 2b blocks (`calculator_only` off: VRF-4's state). The cases:
 * VRF-R3's 65 qualifying outdoor rows (47 helper splits, 15 stated, 3 W+S not split; `__fixtures__/vrf3aSplitRows.json`, read
 * off VRF-R3's probe), boards 1 / 2 / 4 / 5, never below (57-66), edit / remove / add / reset / the seam re-run, Daikin, Side,
 * D-3, every refnet case, Set per family, the Lot spellings and VRF-R3's 104 Set / Lot / per HP rows.
 */
describe("HVAC VRF (VRF-3a, v58) -- the outdoor split, the stated split, Set / refnet / Lot; panel = calculator on every case", () => {
  const v58 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v58.json", import.meta.url),
  );
  type SplitRow = { id: string; how: string; unit: string; qty: number | null; text: string; brand: string; variant: string; item: Record<string, string>;
    lines: number[] | null; totals: { supply_rate: number; install_rate: number } | null; condition: string | null };
  type SetLotRow = { id: string; unit: string; qty: number | null; unit_class: string | null; kind: string; family: string | null; v57_reason: string };
  const FIX = readJsonFixture<{ split_rows: SplitRow[]; set_lot_rows: SetLotRow[] }>(new URL("./__fixtures__/vrf3aSplitRows.json", import.meta.url));
  const VRF = "hvac_vrf";
  const items58: RateMasterItem[] = v58.items.map((it) => ({
    ...it, discipline: v58.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes },
  } as RateMasterItem));
  const live = new Map<string, RateCategoryConfig>(v58.category_configs.map((c) => [c.category_id, c]));
  const projected = new Map<string, RateCategoryConfig>([...live].map(([k, c]) => {
    if (k !== VRF) return [k, c];
    const { calculator_only: _off, ...rest } = c as RateCategoryConfig & { calculator_only?: unknown };
    return [k, rest as RateCategoryConfig];
  }));
  const calcFlag = makePricingSheetHelper({ configsByCategory: live, items: items58, extractionByRow: new Map() });
  const run = (c: ParityCase) => {
    const r = runParity(projected, items58, c, "full");
    const flag = calcFlag.compute(calculatorCtx("HVAC", VRF), r.feed.overrides);
    const boq = panelHelper(live, items58, c).compute(panelCtx(c));
    return { ...r, flagSame: JSON.stringify(flag) === JSON.stringify(r.calculator), boq };
  };
  const view = (x: unknown) => (x as ItemListSuggestion).itemList!;
  const figs = (x: unknown): [number, number] | string => {
    const v = view(x);
    return v.rowPriced ? [v.totals!.supply_rate as number, v.totals!.install_rate as number] : (v.reason ?? v.items.find((b) => b.reason)?.reason ?? "?");
  };
  const caps = (x: unknown) => view(x).items.map((b) => Number(b.fields.find((f) => f.id === "capacity")?.value));
  const vc = (unit: string, a: Record<string, string>, extra: Partial<ParityCase> = {}): ParityCase => ({ cat: VRF, unit, desc: "", attrs: {}, items: [a], ...extra });
  // the owner's rule, independently (VRF-R3's enumerator): fewest units -> exact else smallest total above -> cheapest
  const outdoor = items58.filter((it) => it.kind === "hvac_vrf_item" && (it.attributes as Record<string, unknown>).item === "Outdoor Unit");
  const ownerRule = (total: number, brand: string, cooling: string, discharge: string, compressor: string): number[] => {
    const vr = outdoor.filter((x) => (x.attributes as Record<string, unknown>).brand === brand && (x.attributes as Record<string, unknown>).cooling === cooling
      && (x.attributes as Record<string, unknown>).discharge === discharge && (x.attributes as Record<string, unknown>).compressor === compressor);
    const sizes = [...new Set(vr.map((x) => Number((x.attributes as Record<string, unknown>).capacity)))].sort((a, b) => b - a);
    const cost = (s: number) => Number((vr.find((x) => Number((x.attributes as Record<string, unknown>).capacity) === s)!.rates as Record<string, number>).cost_supply);
    for (let n = Math.max(2, Math.ceil(total / sizes[0] - 1e-9)); n <= 8; n++) {
      const cands: number[][] = [];
      const walk = (start: number, chosen: number[]) => {
        if (chosen.length === n) { if (chosen.reduce((a, b) => a + b, 0) >= total - 1e-9) cands.push([...chosen]); return; }
        for (let i = start; i < sizes.length; i++) { chosen.push(sizes[i]); walk(i, chosen); chosen.pop(); }
      };
      walk(0, []);
      if (!cands.length) continue;
      const over = (c: number[]) => c.reduce((a, b) => a + b, 0) - total;
      const m = Math.min(...cands.map(over));
      return cands.filter((c) => Math.abs(over(c) - m) < 1e-9).sort((a, b) => a.reduce((s, x) => s + cost(x), 0) - b.reduce((s, x) => s + cost(x), 0))[0];
    }
    return [];
  };

  it("the fixture: v58's hvac_vrf carries the split, Set and Lot keys, the switch still on; 65 split rows (47 / 15 / 3) and 104 Set / Lot rows", () => {
    const pr = (live.get(VRF) as unknown as { list_spec: { pricing: Record<string, unknown> } }).list_spec.pricing;
    expect(Object.keys(pr)).toEqual(expect.arrayContaining(["compose", "split", "per_set", "lot_units"]));
    expect((live.get(VRF) as { calculator_only?: unknown }).calculator_only).toBe(true);
    expect(FIX.split_rows).toHaveLength(65);
    expect(FIX.split_rows.filter((r) => r.how === "helper split")).toHaveLength(47);
    expect(FIX.split_rows.filter((r) => r.how === "stated split")).toHaveLength(15);
    expect(FIX.split_rows.filter((r) => r.how === "W+S #")).toHaveLength(3);
    expect(FIX.set_lot_rows).toHaveLength(104);
  });

  it("VRF-R3's 65 rows: each helper row splits by the owner's rule, each stated row into its modules, each W+S row stays one unit; the figures are VRF-R3's; panel = calculator; the BoQ panel declines", () => {
    const bad: string[] = [];
    let helper = 0, stated = 0, ws = 0, parity = 0, declined = 0, flagSame = 0, conds = 0;
    for (const row of FIX.split_rows) {
      const c = vc(row.unit, row.item, { desc: row.text });
      const r = run(c);
      if (r.divergences.length) bad.push(`${row.id}: ` + r.divergences.map((d) => `${d.what} P[${d.panel}] C[${d.calculator}]`).join(" | ")); else parity++;
      if (r.flagSame) flagSame++;
      if (r.boq.kind === "none" && (r.boq as { reason?: string }).reason === COMING_SOON_REASON) declined++;
      const v = view(r.panel);
      const got = caps(r.panel);
      if (row.how === "W+S #") {
        if (v.items.length === 1 && !v.split) ws++; else bad.push(`${row.id}: W+S split ${JSON.stringify(got)}`);
      } else if (row.how === "stated split") {
        const ok = got.length === row.lines!.length && v.split?.note.includes("states a split");
        if (ok) stated++; else bad.push(`${row.id}: stated ${JSON.stringify(got)} vs ${JSON.stringify(row.lines)}`);
      } else {
        const [b, co, di, cm] = row.variant.split("/").map((s) => s.trim());
        const want = ownerRule(Number(row.item.capacity.replace(/[^\d.]/g, "")), b, co, di, cm);
        if (JSON.stringify(got) === JSON.stringify(row.lines) && JSON.stringify(got) === JSON.stringify(want)) helper++;
        else bad.push(`${row.id}: helper ${JSON.stringify(got)} vs fixture ${JSON.stringify(row.lines)} vs rule ${JSON.stringify(want)}`);
      }
      if (row.totals && JSON.stringify(figs(r.panel)) !== JSON.stringify([row.totals.supply_rate, row.totals.install_rate])) bad.push(`${row.id}: figures ${JSON.stringify(figs(r.panel))} vs VRF-R3 ${row.totals.supply_rate} / ${row.totals.install_rate}`);
      if (row.condition && row.how !== "W+S #") { if (v.split?.condition) conds++; else bad.push(`${row.id}: no D-3 note for '${row.condition}'`); }
    }
    expect(bad).toEqual([]);
    // INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; D-10) by mechanical authority: BEFORE the live (frozen, `calculator_only`) BoQ panel DECLINED
    // every case (`declined` = the case count; "did not decline" was a defect). The key is read by nothing now: the BoQ panel declines none
    expect({ helper, stated, ws, parity, declined, flagSame, conds }).toEqual({ helper: 47, stated: 15, ws: 3, parity: 65, declined: 0, flagSame: 65, conds: 7 });
  }, 240000);

  it("boards 1 / 2 / 4 / 5 on both surfaces: 54 -> 28 + 26; stated 18 + 18 + 24 with three brands -> Blue Star, 1,415,640 / 60,000; a module above the largest refuses; 43.2 TR -> 54 HP -> 28 + 26", () => {
    const b1 = run(vc("Nos", { item: "Outdoor Unit", capacity: "54 HP" }));
    expect([caps(b1.panel), figs(b1.panel), b1.divergences]).toEqual([[28, 26], [1116360, 54000], []]);
    const b2 = run(vc("Nos", { item: "Outdoor Unit", capacity: "60 HP (18+18+24)", brand: "Daikin / Hitachi / Toshiba" }));
    expect([caps(b2.panel), figs(b2.panel), b2.divergences]).toEqual([[18, 18, 24], [1415640, 60000], []]);
    expect(view(b2.panel).items.every((b) => b.fields.find((f) => f.id === "brand")?.rule === "several brands stated (Daikin / Hitachi / Toshiba) - priced as Blue Star")).toBe(true);
    const b4 = run(vc("Nos", { item: "Outdoor Unit", capacity: "60 HP (30+30)" }));
    expect([figs(b4.panel), b4.divergences]).toEqual(["Module 30 HP is above the largest size on the sheet (28 HP) - this row is not priced; price it by hand", []]);
    const b5 = run(vc("Nos", { item: "Outdoor Unit", capacity: "43.2 TR" }));
    expect([caps(b5.panel), figs(b5.panel), b5.divergences]).toEqual([[28, 26], [1116360, 54000], []]);
    expect(view(b5.panel).split?.note.startsWith("43.2 TR x 1.25 (HP per TR, Pricing Inputs) = 54 HP.")).toBe(true);
  });

  it("never below: 57 .. 66 HP each split at or above the total, by the owner's rule, on both surfaces", () => {
    const bad: string[] = [];
    for (let t = 57; t <= 66; t++) {
      const r = run(vc("Nos", { item: "Outdoor Unit", capacity: `${t} HP` }));
      const got = caps(r.panel);
      const want = ownerRule(t, "Blue Star", "Cool Only", "Top", "Standard");
      if (got.reduce((a, b) => a + b, 0) < t || JSON.stringify(got) !== JSON.stringify(want) || r.divergences.length) bad.push(`${t}: ${JSON.stringify(got)} vs ${JSON.stringify(want)} ${r.divergences.length}`);
    }
    expect(bad).toEqual([]);
  });

  it("edit / remove / add / reset, then the seam re-run: the panel's lines after each, fed to the calculator, price the same; no re-split", () => {
    const c = vc("Nos", { item: "Outdoor Unit", capacity: "60 HP" });
    const ph = panelHelper(projected, items58, c);
    const p0 = ph.compute(panelCtx(c));
    const cfg = projected.get(VRF)!;
    const ops: Array<[string, (s: ItemListEditState) => ItemListEditState, [number, number] | null]> = [
      ["edit line 3 -> 14", (s) => applyItemEdit(s, { op: "set_attr", index: 2, id: "capacity", value: "14" }), [1428360, 62000]],
      ["remove line 3", (s) => applyItemEdit(s, { op: "remove", index: 2 }), [1023120, 48000]],
      ["add a Remote Controller", (s) => applyItemEdit(applyItemEdit(s, { op: "add", family: "Remote Controller" }), { op: "set_attr", index: 3, id: "remote_type", value: "Wired" }), null],
      ["reset after remove", (s) => applyItemEdit(applyItemEdit(s, { op: "remove", index: 2 }), { op: "reset_split" }), [1335600, 60000]],
    ];
    for (const [name, op, want] of ops) {
      const st = op(view(p0).editState);
      const p = ph.compute(panelCtx(c), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(st) });
      const feed = feedFromPanel(p, cfg, c, "full");
      const cr = calculatorHelper(projected, items58).compute(calculatorCtx("HVAC", VRF), feed.overrides);
      expect({ name, div: compareResults(p, cr) }).toEqual({ name, div: [] });
      if (want) expect({ name, figs: figs(p) }).toEqual({ name, figs: want });
      expect({ name, lines: view(p).items.length }).toEqual({ name, lines: name.startsWith("remove") ? 2 : name.startsWith("add") ? 4 : 3 });
    }
  });

  it("Set per family: every VRF family on a Set row prices one piece (= its Nos figure) with the orange bar, on both surfaces; Set / Sets / set / sets", () => {
    const bad: string[] = [];
    let n = 0;
    const cases = itemListCasesForCategory(projected.get(VRF)!, items58).filter((c) => (c.unit ?? "") === "Nos");
    for (const c of cases) {
      const fam = c.items?.[0]?.item as string;
      if (fam === "Refnet/Y-Joint") continue;
      for (const u of ["Set", "Sets", "set", "sets"]) {
        const r = run({ ...c, unit: u });
        const nos = run(c);
        if (r.divergences.length || JSON.stringify(figs(r.panel)) !== JSON.stringify(figs(nos.panel)) || (view(r.panel).rowPriced && view(r.panel).unitBar?.tone !== "orange")) {
          bad.push(`${fam} ${u}: ${JSON.stringify(figs(r.panel))} vs Nos ${JSON.stringify(figs(nos.panel))} div ${r.divergences.length}`);
        } else n++;
      }
    }
    expect(bad).toEqual([]);
    expect(n).toBeGreaterThan(40);
  }, 240000);

  it("every refnet case (QR-1 (a): the panel reads the row's quantity, the calculator its field): 25 / 13 rounded / 1 / withheld / counts missing / quantity missing / typed; panel = calculator", () => {
    const W = "Whole system (indoor + outdoor)";
    const ref = (o: string, i: string, covers = W) => ({ item: "Refnet/Y-Joint", set_covers: covers, set_odu: o, set_idu: i });
    const CASES: Array<[string, ParityCase, [number, number] | string]> = [
      ["3 + 24, qty 1", vc("Set", ref("3", "24"), { qty: 1 }), [105000, 20000]],
      ["3 + 24, qty 2 (rounded up to 13)", vc("Set", ref("3", "24"), { qty: 2 }), [54600, 10400]],
      ["4 + 50, qty 52", vc("Set", ref("4", "50"), { qty: 52 }), [4200, 800]],
      ["3 + 24, qty 20 (withheld)", vc("Set", ref("3", "24"), { qty: 20 }), "The BoQ quantity (20) does not fit the 25 refnets expected - not priced: type the pieces in one Set."],
      ["indoor side only, 24, qty 23", vc("Set", ref("", "24", "Indoor side only"), { qty: 23 }), [4200, 800]],
      ["counts missing", vc("Sets", ref("", "24"), { qty: 2 }), "Not priced: say what the row covers and how many outdoor and indoor units the system has - or type the pieces in one Set."],
      ["quantity missing", vc("Set", ref("3", "24")), "Not priced: type the BoQ quantity of this row - or type the pieces in one Set."],
    ];
    for (const [name, c, want] of CASES) {
      const r = run(c);
      expect({ name, div: r.divergences, panel: figs(r.panel), calc: figs(r.calculator) }).toEqual({ name, div: [], panel: want, calc: want });
    }
  });

  it("Lot: every spelling refuses on the panel with the red bar and the line naming the unit; the calculator cannot state Lot (cause C, by name)", () => {
    for (const u of ["Lot", "LOT", "lot", "LS", "Job", "per HP", "complete system"]) {
      const c = vc(u, { item: "Outdoor Unit", capacity: "16" });
      const r = run(c);
      expect({ u, panel: figs(r.panel) }).toEqual({ u, panel: `Unit "${u}" is not a VRF unit: VRF is priced per Nos, per Set or per Kg. What a Lot holds is read at VRF-4. Price this row by hand.` });
      expect(view(r.panel).unitBar).toMatchObject({ tone: "red", title: "PRICED PER LOT - NOT PRICED. PRICE THIS ROW BY HAND." });
      expect(hasPrice(r.panel)).toBe(false);
      // INVERTED at VRF-3b (owner 2026-11-05 01:15 "Lot in the calculator's Row unit", calculator = panel) by mechanical
      // authority: BEFORE every spelling was not offered and diverged as cause C. The calculator now offers "Lot" (one
      // spelling per unit, as every class), so a row spelled exactly "Lot" is stated there and agrees -- the red bar on both;
      // every other spelling (LOT, lot, LS, Job, per HP, complete system) is still not offered (cause C, by name), the negative half kept
      if (u === "Lot") {
        expect(view(r.calculator).unitChoices).toContain("Lot");
        expect({ u, div: r.divergences }).toEqual({ u, div: [] });
        expect(view(r.calculator).unitBar).toMatchObject({ tone: "red", title: "PRICED PER LOT - NOT PRICED. PRICE THIS ROW BY HAND." });
      } else {
        expect(view(r.calculator).unitChoices).not.toContain(u);
        expect(classifyDivergence(r, c)).toBe("C_unit_not_offered");
      }
    }
  });

  it("VRF-R3's 104 Set / Lot / per HP rows (the review list): no row refuses for its unit 'Set' any more; every Lot / per HP row refuses with the Lot line; counted", () => {
    const tally: Record<string, number> = {};
    const bad: string[] = [];
    let diverged = 0;
    for (const row of FIX.set_lot_rows) {
      const a: Record<string, string> = row.family ? { item: row.family } : {};
      const c = vc(row.unit, a, row.qty !== null ? { qty: row.qty } : {});
      const r = run(c);
      // a divergence is only ever the calculator not offering the row's unit (cause C, by name): a Lot spelling, or Set on a
      // kind stocked per Kg only (the MS angle frame) -- never a figure
      if (r.divergences.length) { diverged++; if (classifyDivergence(r, c) !== "C_unit_not_offered") bad.push(`${row.id}: ${classifyDivergence(r, c)}`); }
      const f = figs(r.panel);
      const key = typeof f !== "string" ? "priced"
        : f.startsWith("Unit \"") ? "lot line"
        : / is not stocked per '/.test(f) ? "unit refusal"
        : "refused for a fact";
      tally[`${row.unit_class ?? "ok-unit"}: ${key}`] = (tally[`${row.unit_class ?? "ok-unit"}: ${key}`] ?? 0) + 1;
      if ((row.unit_class === "Set") && key === "unit refusal") bad.push(`${row.id} ${row.unit}: ${f}`);
      if ((row.unit_class === "Lot" || row.unit_class === "per HP") && key !== "lot line") bad.push(`${row.id} ${row.unit}: ${f}`);
    }
    expect(bad).toEqual([]);
    if (process.env.VRF3A_PRINT) console.log("VRF3A_TALLY " + JSON.stringify(tally));
    // the family alone is fed (VRF-R3's tag; no capacity / no refnet counts), so a Set row prices where the family needs
    // nothing more and otherwise refuses for that fact -- never for its unit; every Lot / per HP row gets the Lot line
    // INVERTED at VRF-3b (owner 01:15, Lot in the calculator) by mechanical authority: BEFORE `toBe(32)` (29 Lot + 1 per HP +
    // 2 MS angle frames per Set). The 27 rows spelled exactly "Lot" are now stated in the calculator and agree; what diverges
    // is still only the calculator not offering the row's unit (cause C, by name -- `bad` above), never a figure
    if (process.env.VRF3B_PRINT) console.log("VRF3B_DIVERGED " + diverged);
    expect(diverged).toBe(5);
    expect(tally).toEqual({ "Set: priced": 16, "Set: refused for a fact": 44, "Lot: lot line": 29, "per HP: lot line": 1, "(unit ok; whole-price words): refused for a fact": 14 });
  }, 240000);
});


describe("HVAC VRF (VRF-3b, v59) -- the extras from Piping / Insulation / Electrical; panel = calculator on every case", () => {
  type A = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
  const rd = (n: string) => readJsonFixture<A>(new URL(`../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
  const A59 = rd("rate_master_hvac_all_v59.json");
  const E72 = rd("rate_master_electrical_all_v72.json");
  const asItems = (a: A) => a.items.map((it, i) => ({ ...it, name: `${a.discipline}-${i}`, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const ITEMS59 = [...asItems(A59), ...asItems(E72)];
  // VRF-4's state on BOTH paths (calculator_only projected out, as the VRF-2b / 3a blocks do); Electrical's configs ride along
  const CFG59 = new Map<string, RateCategoryConfig>([...A59.category_configs, ...E72.category_configs].map((c) => {
    if (c.category_id !== "hvac_vrf") return [c.category_id, c];
    const { calculator_only: _off, ...rest } = c as RateCategoryConfig & { calculator_only?: unknown };
    return [c.category_id, rest as RateCategoryConfig];
  }));
  const ALL = "copper,insulation,power,comm";
  const xc = (unit: string, item: Record<string, string>, includes = ALL, more: Partial<ParityCase> = {}): ParityCase =>
    ({ cat: "hvac_vrf", unit, desc: "", attrs: {}, items: [item], includes, ...more });
  const xrun = (c: ParityCase) => runParity(CFG59, ITEMS59, c, "full");
  const xview = (r: ReturnType<typeof xrun>) => (r.panel as ItemListSuggestion).itemList!;
  const xtot = (r: ReturnType<typeof xrun>) => [xview(r).totals?.supply_rate, xview(r).totals?.install_rate];
  const od = (cap: string, brand = "Blue Star") => ({ item: "Outdoor Unit", brand, capacity: cap });
  const ind = (fam: string, cap: string) => ({ item: fam, brand: "Blue Star", capacity: cap });
  const CASES: Array<[string, ParityCase]> = [
    // C1 / C2 / C3 of the cert
    ["C1 10 HP all four", xc("Nos", od("10"))],
    ["C2 Hi-Wall 1.5 TR all four", xc("Nos", ind("Hi-Wall", "1.5"))],
    ["C3 54 HP split, per module", xc("Nos", od("54"))],
    // every band edge
    ...["4", "8", "10", "12", "14", "16", "20", "22", "28"].map((h) => [`outdoor ${h} HP`, xc("Nos", od(h))] as [string, ParityCase]),
    ...[["Ductable", "4"], ["Ductable", "4.1"], ["Ductable", "8"], ["Packaged Unit", "10"], ["Cassette", "4"], ["Single Skin Treated Fresh Air", "3.8"]]
      .map(([f, c]) => [`indoor ${f} ${c} TR`, xc("Nos", ind(f, c))] as [string, ParityCase]),
    ["outdoor 8 TR (converted to 10 HP)", xc("Nos", od("8 TR"))],
    // each brand
    ["Daikin outdoor 10 HP", xc("Nos", od("10", "Daikin"))],
    ["Daikin outdoor 16 HP", xc("Nos", od("16", "Daikin"))],
    // removal + put back (the pricer's edits on the panel, fed as the same edits)
    ["removed copper supply", xc("Nos", od("10"), ALL, { panelEdits: { items: [{ base: 0, family: null, attrs: {}, extras: { removed: ["copper_supply"] } }] } })],
    ["removed power + comm", xc("Nos", od("10"), ALL, { panelEdits: { items: [{ base: 0, family: null, attrs: {}, extras: { removed: ["power", "comm"] } }] } })],
    ["put back (nothing removed)", xc("Nos", od("10"), ALL, { panelEdits: { items: [{ base: 0, family: null, attrs: {} }] } })],
    // typed sizes / values from the BoQ (VRF-4's path, a fixture now)
    ["typed 1.125 inch on the supply copper", xc("Nos", { ...od("10"), extra_copper_supply_size: "1.125 inch" })],
    ["typed 15 mm on the return copper", xc("Nos", { ...od("10"), extra_copper_return_size: "15 mm" })],
    ["BoQ length 25 m", xc("Nos", { ...od("10"), extra_copper_supply_length: "25" })],
    ["BoQ count 2 on the power cable", xc("Nos", { ...od("10"), extra_power_count: "2" })],
    // blank defaults / not stocked
    ["unreadable size", xc("Nos", { ...od("10"), extra_copper_supply_size: "big" })],
    ["unstocked spec", xc("Nos", { ...od("10"), extra_power_spec: "3C x 400" })],
    // each cable spec
    ...["3C x 1.5", "3C x 2.5", "4C x 6", "4C x 10", "4C x 16", "2C x 1.5"].map((sp) => [`power spec ${sp}`, xc("Nos", { ...od("10"), extra_power_spec: sp }, "power")] as [string, ParityCase]),
    // the switches
    ["copper + power", xc("Nos", od("10"), "copper,power")],
    ["insulation without copper", xc("Nos", od("10"), "insulation,comm")],
    ["nothing ticked", xc("Nos", od("10"), "")],
    // Lot (the calculator now states it) and Set (a per-Set row carries the extras too)
    ["Lot", xc("Lot", od("10"))],
    ["Set", xc("Set", od("10"))],
    // K1b (owner ANSWER 2): one case each -- a non-default copper size, an insulation with cladding, an armoured cable,
    // a pipe changed to MS (Change item), an aluminium cable
    ["non-default copper size 28.6", xc("Nos", { ...od("10"), extra_copper_supply_size: "28.6" }, "copper")],
    ["insulation with 24G Aluminium cladding", xc("Nos", { ...od("10"), extra_ins_supply_cladding: "24G Aluminium" }, "copper,insulation")],
    ["armoured power cable", xc("Nos", { ...od("10"), extra_power_armour: "ARMOURED" }, "power")],
    ["copper line changed to MS 25", xc("Nos", { ...od("10"), extra_copper_supply_family: "MS", extra_copper_supply_size: "25" }, "copper")],
    ["aluminium armoured 4C x 16 power cable", xc("Nos", { ...od("10"), extra_power_conductor: "ALUMINIUM", extra_power_armour: "ARMOURED", extra_power_cores: "4", extra_power_sqmm: "16" }, "power")],
  ];

  it("every case: 0 divergences (figures, lines, reasons, removed lines, the row) -- the count asserted", () => {
    const out = CASES.map(([name, c]) => ({ name, div: xrun(c).divergences }));
    // INVERTED at VRF-4 K2 (owner BORROWED 2026-11-05 22:18 "option a": a borrowed field is priced by its SOURCE's own rules) by mechanical authority: BEFORE `expect(out.filter((o) => o.div.length)).toEqual([])`. ONE named divergence, WORDING ONLY: an unreadable
    // size goes to Piping, which words a BoQ value ("no number in 'big' for pipe size") and a typed one ("Type one pipe size,
    // in mm or inches") differently -- Piping's own two sentences. Both refuse the line; every figure and line is equal.
    const named = out.filter((o) => o.div.length);
    expect(named.map((o) => o.name)).toEqual(["unreadable size"]);
    const BOQ = "no number in 'big' for pipe size", TYPED = "Type one pipe size, in mm or inches";
    for (const d of named[0].div) expect(String(d.panel).split(BOQ).join(TYPED)).toEqual(String(d.calculator));
    expect(CASES).toHaveLength(46);
  }, 240000);

  it("C1 / C2 / C3: the cert's figures on both paths", () => {
    const c1 = xrun(CASES[0][1]);
    expect(xtot(c1)).toEqual([441210, 25960]);
    expect(xview(c1).lineCount).toEqual({ lines: 7, bad: 0 });
    expect(xtot(xrun(CASES[1][1]))).toEqual([80040, 17280]);
    const c3 = xview(xrun(CASES[2][1]));
    expect(c3.items.map((b) => b.extras?.lines.length)).toEqual([6, 6]);
    expect(c3.lineCount).toEqual({ lines: 14, bad: 0 });
  });

  it("removal, typed sizes, blanks, Lot: what each case shows (panel = calculator above)", () => {
    const get = (n: string) => xview(xrun(CASES.find(([k]) => k === n)![1]));
    expect(get("removed copper supply").items[0].extras?.lines.map((l) => l.id)).toEqual(["copper_return", "ins_return", "power", "comm"]);
    expect(get("typed 1.125 inch on the supply copper").items[0].extras?.lines[0].fields.find((f) => f.id === "size")?.value).toBe("28.6");
    expect(get("typed 15 mm on the return copper").items[0].extras?.lines[1].fields.find((f) => f.id === "size")?.value).toBe("15.9");
    expect(get("unreadable size").rowPriced).toBe(false);
    expect(get("unstocked spec").rowPriced).toBe(false);
    expect(get("indoor Packaged Unit 10 TR").items[0].extras?.lines.find((l) => l.id === "power")?.reason).toBe("No default for this size (10 TR) - pick a cable spec.");
    expect(get("Lot").unitBar?.tone).toBe("red");
    expect(get("Lot").items[0].extras).toBeUndefined();
    expect(get("Set").items[0].extras?.lines).toHaveLength(6);
    expect(get("nothing ticked").items[0].extras).toBeUndefined();
  });

  it("NEGATIVE: Insulation, Piping and ADP rows are untouched by v59 (their configs are v58's byte for byte; the extras are VRF's only)", () => {
    for (const id of ["hvac_insulation", "hvac_piping", "hvac_adp"]) {
      const cfg = CFG59.get(id) as unknown as { list_spec?: { pricing?: { extras?: unknown } } };
      expect(cfg.list_spec?.pricing?.extras).toBeUndefined();
    }
  });
});


// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// VRF-3b K3b (owner ANSWER 3, 2026-11-05 19:01 / 19:03 "yes") -- THE EXHAUSTIVE EXTRAS SWEEP. Test-only: every case priced the
// panel's way and the calculator's way through the parity harness; any difference is red with the case NAMED; counts asserted.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** K3b: the sweep's counts, MEASURED (VRF3B_SWEEP_PRINT=1 prints them) and pinned. */
const SWEEP_COUNTS = { a: 136, a_priced: 135, a_lines: 816, c: 186, c_priced: 186, d: 584, d_priced: 522, e_priced: 35 };

describe("VRF-3b K3b (v59) -- the exhaustive extras sweep; panel = calculator on every case, the count asserted", () => {
  type A = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
  const rd = (n: string) => readJsonFixture<A>(new URL(`../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
  const S59 = rd("rate_master_hvac_all_v59.json");
  const SE72 = rd("rate_master_electrical_all_v72.json");
  const asIt = (a: A) => a.items.map((it, i) => ({ ...it, name: `${a.discipline}-${i}`, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const ITEMS = [...asIt(S59), ...asIt(SE72)];
  const CFG = new Map<string, RateCategoryConfig>([...S59.category_configs, ...SE72.category_configs].map((c) => {
    if (c.category_id !== "hvac_vrf") return [c.category_id, c];
    const { calculator_only: _off, ...rest } = c as RateCategoryConfig & { calculator_only?: unknown };
    return [c.category_id, rest as RateCategoryConfig];
  }));
  const VRFC = CFG.get("hvac_vrf") as unknown as { list_spec: { attribute_definitions: Array<{ id: string }>; pricing: { extras: { roles: Record<string, string> } } } };
  const ROLES = VRFC.list_spec.pricing.extras.roles;
  const DEFS = new Set(VRFC.list_spec.attribute_definitions.map((d) => d.id));
  const ALL = "copper,insulation,power,comm";
  const sweep = (cases: Array<[string, ParityCase]>) => {
    const bad: string[] = [];
    let priced = 0; let lines = 0;
    for (const [name, c] of cases) {
      const r = runParity(CFG, ITEMS, c, "full");
      if (r.divergences.length) bad.push(`${name}: ${JSON.stringify(r.divergences).slice(0, 300)}`);
      const v = (r.panel as ItemListSuggestion).itemList;
      if (v?.rowPriced) priced++;
      lines += (v?.items ?? []).reduce((n, b) => n + (b.extras?.lines.length ?? 0), 0);
    }
    if (process.env.VRF3B_SWEEP_PRINT) console.log("VRF3B_SWEEP " + JSON.stringify({ n: cases.length, priced, lines }));
    return { bad, priced, lines };
  };
  const unit = (fam: string, cap: string, more: Record<string, string> = {}) => ({ item: fam, brand: "Blue Star", capacity: cap, ...more });
  const xc = (item: Record<string, string>, includes = ALL, unitWord = "Nos", more: Partial<ParityCase> = {}): ParityCase =>
    ({ cat: "hvac_vrf", unit: unitWord, desc: "", attrs: {}, items: [item], includes, ...more });

  it("(a) every active VRF indoor / outdoor unit SKU (both brands, every variant) with all four extras at their defaults", () => {
    const skus = ITEMS.filter((it) => it.kind === "hvac_vrf_item" && ROLES[String(it.attributes?.item ?? "")]);
    const cases = skus.map((it): [string, ParityCase] => {
      const a = it.attributes as Record<string, unknown>;
      const item: Record<string, string> = {};
      for (const [k, v] of Object.entries(a)) if (DEFS.has(k) && v !== null && v !== undefined && v !== "") item[k] = String(v);
      if (a.capacity !== undefined && a.capacity_unit) item.capacity = `${String(a.capacity)} ${String(a.capacity_unit)}`;
      return [`${String(it.item_uid)} ${item.item} ${item.brand} ${item.capacity}`, xc(item)];
    });
    const r = sweep(cases);
    expect(r.bad).toEqual([]);
    expect(cases).toHaveLength(SWEEP_COUNTS.a);
    expect(r.priced).toBe(SWEEP_COUNTS.a_priced);
    expect(r.lines).toBe(SWEEP_COUNTS.a_lines);
  }, 600000);

  it("(b) every Piping Refrigerant / Copper size as a copper line, on one indoor and one outdoor unit", () => {
    const sizes = [...new Set(ITEMS.filter((it) => it.kind === "hvac_piping_item" && it.attributes?.pipe_type === "Copper").map((it) => Number(it.attributes?.size_mm)))].sort((x, y) => x - y);
    const cases: Array<[string, ParityCase]> = [];
    for (const s of sizes) for (const u of [unit("Hi-Wall", "1.5"), unit("Outdoor Unit", "10")]) {
      cases.push([`copper ${s} on ${u.item}`, xc({ ...u, extra_copper_supply_size: String(s), extra_copper_return_size: String(s) }, "copper,insulation")]);
    }
    const r = sweep(cases);
    expect(r.bad).toEqual([]);
    expect(cases).toHaveLength(26);
    expect(r.priced).toBe(26);
  }, 600000);

  it("(c) every pipe-insulation choice Insulation stocks (type / cladding / thickness) on every pipe size it fits", () => {
    const ins = ITEMS.filter((it) => it.kind === "hvac_insulation_item" && Number.isFinite(Number(it.attributes?.pipe_size_mm)) && it.attributes?.pipe_size_mm !== null);
    const insSizes = [...new Set(ins.map((it) => Number(it.attributes?.pipe_size_mm)))].sort((x, y) => x - y);
    const closest = (v: number, xs: number[]) => xs.reduce((b, s) => (Math.abs(s - v) < Math.abs(b - v) - 1e-9 || (Math.abs(Math.abs(s - v) - Math.abs(b - v)) <= 1e-9 && s > b) ? s : b), xs[0]);
    // a pipe Piping stocks whose closest insulation size is this one: Copper first, else any pipe (the line's Change item)
    const pipes = ITEMS.filter((it) => it.kind === "hvac_piping_item").map((it) => ({ fam: String(it.attributes?.pipe_type), size: Number(it.attributes?.size_mm) }))
      .sort((p, q) => (p.fam === "Copper" ? 0 : 1) - (q.fam === "Copper" ? 0 : 1));
    const cases: Array<[string, ParityCase]> = [];
    const unreachable: number[] = [];
    for (const it of ins) {
      const a = it.attributes as Record<string, unknown>;
      const size = Number(a.pipe_size_mm);
      const pipe = pipes.find((p) => closest(p.size, insSizes) === size);
      if (!pipe) { if (!unreachable.includes(size)) unreachable.push(size); continue; }
      cases.push([`${String(it.item_uid)} ${String(a.item)} / ${String(a.cladding)} / ${String(a.thickness_mm)} mm on ${size} (pipe ${pipe.fam} ${pipe.size})`,
        xc({ ...unit("Outdoor Unit", "10"), extra_copper_supply_family: pipe.fam, extra_copper_supply_size: String(pipe.size),
             extra_ins_supply_family: String(a.item), extra_ins_supply_cladding: String(a.cladding), extra_ins_supply_thickness: String(a.thickness_mm) }, "copper,insulation")]);
    }
    const r = sweep(cases);
    expect(r.bad).toEqual([]);
    // GAP (named in the coverage map): no Piping pipe's closest Insulation size is 53.98 mm (Copper tops at 47.6 -> 41.28), so the
    // 18 Insulation SKUs on 53.98 cannot be reached from an extra line -- pinned so a catalogue change that reaches them is seen
    expect(unreachable).toEqual([53.98]);
    expect(cases).toHaveLength(ins.length - ins.filter((it) => Number(it.attributes?.pipe_size_mm) === 53.98).length);
    expect(cases).toHaveLength(SWEEP_COUNTS.c);
    expect(r.priced).toBe(SWEEP_COUNTS.c_priced);
  }, 600000);

  it("(d) every per-Mtr wiring_cabling cable (conductor / armour / cores / size) as the power cable and as the communication cable", () => {
    const cables = ITEMS.filter((it) => it.kind === "cable" && String(it.unit ?? "").toLowerCase() === "mtr");
    const cases: Array<[string, ParityCase]> = [];
    for (const it of cables) {
      const a = it.attributes as Record<string, unknown>;
      for (const line of ["power", "comm"]) {
        cases.push([`${String(it.item_uid)} ${String(a.material)} ${String(a.insulation)} ${String(a.core)}C x ${String(a.thickness_sqmm)} as ${line}`,
          xc({ ...unit("Outdoor Unit", "10"), [`extra_${line}_conductor`]: String(a.material), [`extra_${line}_armour`]: String(a.insulation),
               [`extra_${line}_cores`]: String(a.core), [`extra_${line}_sqmm`]: String(a.thickness_sqmm) }, line)]);
      }
    }
    const r = sweep(cases);
    expect(r.bad).toEqual([]);
    expect(cases).toHaveLength(cables.length * 2);
    expect(cases).toHaveLength(SWEEP_COUNTS.d);
    expect(r.priced).toBe(SWEEP_COUNTS.d_priced);
  }, 600000);

  it("(e) every band edge both sides, every split total into modules (per-module extras), removal of each extra kind", () => {
    const cases: Array<[string, ParityCase]> = [];
    for (const h of ["8", "8.5", "12", "13", "14", "15", "20", "21", "22"]) cases.push([`outdoor ${h} HP`, xc(unit("Outdoor Unit", h))]);
    for (const [f, t] of [["Ductable", "4"], ["Ductable", "4.1"], ["Ductable", "5"], ["Ductable", "8"], ["Packaged Unit", "8"], ["Packaged Unit", "10"], ["Cassette", "3.9"], ["Cassette", "4"], ["Cassette", "4.5"]]) {
      cases.push([`indoor ${f} ${t} TR`, xc(unit(f, t))]);
    }
    for (const total of [30, 34, 40, 44, 50, 54, 56, 60, 66, 80, 100, 112]) cases.push([`split ${total} HP`, xc(unit("Outdoor Unit", String(total)))]);
    for (const line of ["copper_supply", "copper_return", "ins_supply", "ins_return", "power", "comm"]) {
      cases.push([`removed ${line}`, xc(unit("Outdoor Unit", "10"), ALL, "Nos", { panelEdits: { items: [{ base: 0, family: null, attrs: {}, extras: { removed: [line] } }] } })]);
    }
    const r = sweep(cases);
    expect(r.bad).toEqual([]);
    expect(cases).toHaveLength(36);
    expect(r.priced).toBe(SWEEP_COUNTS.e_priced);
  }, 600000);

});


// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// VRF-4 (owner PARITY "add the BoQ-row browser check from VRF-4 onward"; COVERAGE "we will need to ensure full coverage even in vrf 4
// 3 layer test"; q1 / q2 / q3; BORROWED "option a"; R-WS) -- LAYER 1 ON v60 (the live asset, calculator_only GONE): the panel
// (a BoQ row whose MODEL ITEM answers the v60 questions) = the calculator (the same values typed / ticked) on every case; the
// count asserted. Cases: every VRF + Misc SKU; each include and all four per role; every R5 (d) stated size through the SOURCE's
// resolver (copper next size up / no unit / above the largest / inch; insulation next size up / layers; cable words / unstocked);
// a stated split; W+S words (the bar is the panel's alone -- its figures equal); the refnet counts (typed); brand copies.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("HVAC VRF (VRF-4, v60) -- the model's per-item answers on a BoQ row; panel = calculator on every case, the count asserted", () => {
  type A = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
  const rd = (n: string) => readJsonFixture<A>(new URL(`../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
  const A60 = rd("rate_master_hvac_all_v60.json");
  const E72 = rd("rate_master_electrical_all_v72.json");
  const asItems = (a: A) => a.items.map((it, i) => ({ ...it, name: `${a.discipline}-${i}`, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const ITEMS60 = [...asItems(A60), ...asItems(E72)];
  const CFG60 = new Map<string, RateCategoryConfig>([...A60.category_configs, ...E72.category_configs].map((c) => [c.category_id, c]));
  const VRFCFG = CFG60.get("hvac_vrf") as unknown as { calculator_only?: unknown; list_spec: { pricing: { extras: { roles: Record<string, string> } } } };
  const ROLES = VRFCFG.list_spec.pricing.extras.roles;
  const run = (c: ParityCase) => runParity(CFG60, ITEMS60, c, "full");
  const vc = (unit: string, item: Record<string, string>, more: Partial<ParityCase> = {}): ParityCase => ({ cat: "hvac_vrf", unit, desc: "", attrs: {}, items: [item], ...more });
  const od = (cap: string, more: Record<string, string> = {}) => ({ item: "Outdoor Unit", brand: "Blue Star", capacity: cap, ...more });
  const ALL = { includes_copper: "Yes", includes_insulation: "Yes", includes_power: "Yes", includes_comm: "Yes" };
  const vrfSkus = A60.items.filter((it) => it.kind === "hvac_vrf_item" || it.kind === "hvac_misc_item");
  const skuCases: Array<[string, ParityCase]> = vrfSkus.map((sku) => {
    const a = sku.attributes as Record<string, unknown>;
    const item: Record<string, string> = { item: String(a.item) };
    if (sku.brand) item.brand = String(sku.brand);
    for (const k of ["cooling", "discharge", "compressor", "way", "remote_type"]) if (a[k] !== undefined) item[k] = String(a[k]);
    if (a.capacity !== undefined) item.capacity = `${String(a.capacity)} ${String(a.capacity_unit ?? "")}`.trim();
    const unit = String(sku.unit ?? "Nos").toLowerCase().startsWith("kg") ? "Kg" : "Nos";
    return [`SKU ${sku.item_uid} ${String(a.item)} ${item.capacity ?? ""}`, vc(unit, ROLES[String(a.item)] ? { ...item, ...ALL } : item)];
  });
  const R5 = ["1.125 inch", "12 mm", "15.8 mm", "14 mm", "15 mm", "7/8\"", "1-1/4\"", "54 mm", "1", "28.6", "41.3 mm OD"];
  const named: Array<[string, ParityCase]> = [
    ...(["copper", "insulation", "power", "comm"] as const).map((inc) => [`outdoor 10 HP includes_${inc} only`, vc("Nos", od("10 HP", { [`includes_${inc}`]: "Yes" }))] as [string, ParityCase]),
    ["outdoor 24 HP all four", vc("Nos", od("24 HP", ALL))],
    ["hi-wall 1.5 TR all four", vc("Nos", { item: "Hi-Wall", brand: "Blue Star", capacity: "1.5 TR", ...ALL })],
    ["cassette 4 TR all four", vc("Nos", { item: "Cassette", brand: "Blue Star", capacity: "4 TR", way: "FOUR-WAY", ...ALL })],
    ["stated split 38HP (20+18) power", vc("Nos", od("38HP (20+18)", { includes_power: "Yes" }), { desc: "System-1 38HP (20+18)" })],
    ...R5.map((s) => [`copper '${s}' from the BoQ`, vc("Nos", od("10 HP", { includes_copper: "Yes", extra_copper_size_as_written: s }))] as [string, ParityCase]),
    ["copper pair '12.7 / 6.4'", vc("Nos", od("10 HP", { includes_copper: "Yes", extra_copper_size_as_written: "12.7 / 6.4" }))],
    ...["20", "32", "19 mm"].map((t) => [`insulation thickness '${t}'`, vc("Nos", od("10 HP", { includes_copper: "Yes", includes_insulation: "Yes", extra_insulation_thickness_as_written: t }))] as [string, ParityCase]),
    ...["25.4", "47.6"].map((cu) => [`insulation on copper ${cu}`, vc("Nos", od("10 HP", { includes_copper: "Yes", includes_insulation: "Yes", extra_copper_size_as_written: cu }))] as [string, ParityCase]),
    ...["4 core x 10 sqmm", "2C x 1.5 Sqmm", "4C x 400", "control cable 2C x 1.5"].map((sp) => [`cable '${sp}'`, vc("Nos", od("10 HP", { includes_power: "Yes", includes_comm: "Yes", extra_cable_spec_as_written: sp }))] as [string, ParityCase]),
    ["length 'up to 15 m'", vc("Nos", od("10 HP", { includes_copper: "Yes", includes_power: "Yes", extra_length_as_written: "up to 15 m" }))],
    ["W+S words (1W+1S)", vc("Nos", od("12 HP", { working_standby_as_written: "1W+1S" }), { qty: 2 })],
    ["standby only", vc("Nos", od("14 HP", { working_standby_as_written: "(Standby)" }))],
    ["refnet Set typed counts", vc("Set", { item: "Refnet/Y-Joint", brand: "Blue Star", set_covers: "Whole system (indoor + outdoor)", set_odu: "3", set_idu: "24" }, { qty: 25 })],
    ["brand copy 'Daikin / Toshiba'", vc("Nos", od("10 HP", { brand_as_written: "Daikin / Toshiba" }))],
    ["brand copy 'Toshiba'", vc("Nos", { item: "Outdoor Unit", capacity: "10 HP", brand_as_written: "Toshiba" })],
    ["Daikin 16 HP all four", vc("Nos", od("16 HP", { brand: "Daikin", ...ALL }))],
    ["Lot", vc("Lot", od("10 HP", ALL))],
    ["Set outdoor all four", vc("Set", od("10 HP", ALL))],
  ];
  const CASES = [...skuCases, ...named];

  it("v60 is the switch-off: the live VRF config carries no calculator_only", () => {
    expect(VRFCFG.calculator_only).toBeUndefined();
  });

  it("every case: 0 divergences except the NAMED wording-only ones (Piping's own BoQ vs typed sentence) -- the count asserted", () => {
    const out = CASES.map(([name, c]) => ({ name, div: run(c).divergences }));
    const diverged = out.filter((o) => o.div.length);
    // a divergence is allowed ONLY where both paths refuse in the source's own words and differ in nothing else
    for (const o of diverged) {
      for (const d of o.div) {
        const norm = (x: unknown) => String(x).replace(/no number in '[^']*' for pipe size|Type one pipe size, in mm or inches|size [^ ]+ has no unit - price this row by hand|BoQ says|You typed/g, "<source sentence>");
        expect({ name: o.name, what: d.what, panel: norm(d.panel) }).toEqual({ name: o.name, what: d.what, panel: norm(d.calculator) });
      }
    }
    expect(diverged.map((o) => o.name)).toEqual(PARITY_V60_WORDING_ONLY);
    expect(skuCases).toHaveLength(154);
    expect(named).toHaveLength(38);
    expect(CASES).toHaveLength(192);
  }, 600000);

  it("the figures the cert reads (C1 / C2 / C5 / C6 on both paths)", () => {
    const t = (c: ParityCase) => { const v = (run(c).panel as ItemListSuggestion).itemList!; return [v.totals?.supply_rate, v.totals?.install_rate]; };
    expect(t(vc("Nos", od("10 HP", ALL)))).toEqual([441210, 25960]);
    const c5 = (run(vc("Nos", od("10 HP", { includes_copper: "Yes", extra_copper_size_as_written: "14 mm" }))).panel as ItemListSuggestion).itemList!;
    expect(c5.items[0].extras?.lines[0].fields.find((f) => f.id === "size")?.value).toBe("15.9");
    const c6 = (run(vc("Nos", od("10 HP", { includes_power: "Yes", extra_cable_spec_as_written: "4 core x 10 sqmm" }))).panel as ItemListSuggestion).itemList!;
    expect(c6.items[0].extras?.lines[0].fields.find((f) => f.id === "spec")?.value).toBe("4C x 10");
  });
});

/** VRF-4: the v60 parity cases whose ONLY difference is the source's own wording for a BoQ value vs a typed one (both refuse). */
const PARITY_V60_WORDING_ONLY: string[] = [];
