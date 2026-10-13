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
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, makePricingSheetHelper, type ItemBlockView, type ItemListEditState, type ItemListSuggestion, type ItemListView } from "@/pages/boq-wizard/rate-helper/pricingSheetHelper";
import {
  AWAITING_CORPUS_DIVERGENCES,
  AWAITING_SWEEP_DIVERGENCES,
  STATUS_BY_CAUSE,
} from "./calculatorPanelParity.awaiting";
import {
  calculatorHelper,
  classifyDivergence,
  emptyCaseFor,
  extractionRowFor,
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
const items = mergeItemsByName(
  master.items.Electrical ?? [],
  master.items.HVAC ?? [],
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
    expect(items).toHaveLength(1781);   // 1,402 + 379 (12e-1: 1,777)
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
    expect(tally.get("D_reason_only")).toEqual({ classes: 8, rows: 8 });
    expect([...tally.keys()].sort()).toEqual(["A_wiring_primary", "C_unit_not_offered", "D_reason_only"]);
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
    expect(perCat.get("hvac_adp")).toBe(11); // 12c-F: 24 -> 13; 12c-U: the no-unit and R/O rows closed, 13 -> 11
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
        ? "No SKU for slot diffuser: without damper, width 600, height 600 - price this row by hand"
        : "No SKU for slot diffuser: without damper - price this row by hand";
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
    expect(total).toBe(1933);
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
    expect(cases).toHaveLength(120);
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
  const UNIT = { excludedBy: "C_unit_not_offered: the calculator's picker offers only the classes the family prices in, so the two surfaces are fed different units by design", what: "item unit class" };
  /** Tab lines that are NOT panel-path rules (a catalogue rule the pricer never reads), by name. */
  const NOT_PANEL_RULES = ["A catalogue cell derived from another row's cell follows its base"];
  const INCH = "1-1/4" + '"';

  const CASES: RuleCase[] = [
    ins("I1", "The row's unit decides which kind of rate applies", "sqft", THMI),
    ins("I2", "The item's own kind decides which products can price it", "RMT", NIT),
    ins("I3", "A row that names no material takes the kind its row implies", "RMT", { ...NIT, item: "None" }),
    ins("I4", "A material the model could not match to any kind refuses", "RMT", { ...NIT, item: "none of these", material_as_written: "XLPE foam" }),
    ins("I5", "A material the catalogue does not stock refuses by name, whatever kind was picked", "RMT", { ...NIT, material_as_written: "EPDM closed cell" }),
    ins("I6", "That kind's rule for that unit", "sqm", NIT, UNIT),
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
    adp("A1", "The row's unit decides which kind of rate applies", "nos", { family: "VCD", variant: "GI rectangular", size_mm: "600x600" }),
    adp("A2", "The item's own kind decides which products can price it", "nos", { family: "grille, type not stated", damper: "with", size_mm: "600x150" }),
    adp("A3", "A material the model could not match to any kind refuses", "nos", { family: "none of these", damper: "with", dia_mm: "200" }),
    adp("A4", "That kind's rule for that unit", "rmt", { family: "spigot", dia_mm: "200" }, UNIT),
    adp("A5", "A kind the catalogue does not price in the row's unit", "nos", { family: "double-skin plenum", thickness_mm: "25", size_mm: "600x600" }, UNIT),
    adp("A6", "The facts that rule needs before it can price", "nos", { family: "actuator", ul: "no" }),
    adp("A7", "A fact the row does not mention takes its ruled value", "nos", { family: "round diffuser", damper: "None", dia_mm: "200" }),
    adp("A8", "A ruling that replaces a value the row DID state", "nos", { family: "fire damper", variant: "motorised", ul: "yes", size_mm: "600x600" }),
    adp("A9", "Fitting the stated diameter to the catalogue", "nos", { family: "round diffuser", damper: "with", dia_mm: "220" }),
    adp("A10", "Fitting the stated neck size to the catalogue", "nos", { family: "square diffuser", damper: "with", neck_mm: "320" }),
    adp("A10b", "A stated outer size is matched beside the neck size on square diffuser", "nos", { family: "square diffuser", damper: "with", size_mm: "595x595" }),
    adp("A11", "Fitting the stated torque to the catalogue", "nos", { family: "actuator", ul: "no", torque: "12" }),
    adp("A12", "Fitting the stated panel ratio to the catalogue", "nos", { family: "control panel", panel_ratio: "5" }),
    adp("A13", "Fitting the stated plenum thickness to the catalogue", "sqm", { family: "double-skin plenum", thickness_mm: "30" }),
    adp("A14", "Then the priced steps below, in their own order", "nos", { family: "round diffuser", damper: "with", dia_mm: "200" }),
    adp("A16", "The rate converts to the unit the row is written in", "sqft", { family: "VCD", variant: "GI rectangular" }),
    adp("A17", "Multiplied by how many of the item one unit of the row pays for", "nos", { family: "round diffuser", damper: "with", dia_mm: "200", qty_per_row_unit: "2" }),
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

  it("the exclusions are exactly the seven named ones", () => {
    expect(CASES.filter((r) => r.expect !== "agree").map((r) => r.id)).toEqual(["I6", "I8", "I13", "I14", "I15", "A4", "A5"]);
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
