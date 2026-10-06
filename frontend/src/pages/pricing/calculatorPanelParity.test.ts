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
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "./rate-master/rateMasterTypes";
import { mergeItemsByName } from "@/pages/boq-wizard/rate-helper/rateHelperPlumbing";
import { itemListPricingSpec } from "@/pages/boq-wizard/rate-helper/itemListPricing";
import { isSuggestion } from "@/pages/boq-wizard/rate-helper/rateHelperTypes";
import {
  AWAITING_CORPUS_DIVERGENCES,
  AWAITING_SWEEP_DIVERGENCES,
  STATUS_BY_CAUSE,
} from "./calculatorPanelParity.awaiting";
import {
  calculatorHelper,
  classifyDivergence,
  emptyCaseFor,
  hasPrice,
  itemListCasesForCategory,
  panelCtx,
  panelHelper,
  resolutionPaths,
  runParity,
  skuCasesForCategory,
  type ParityCase,
} from "./calculatorPanelParity.harness";
import { calculatorCtx } from "./PricingCalculator";

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
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf-8")) as T;
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

  it("the catalogue snapshot is the live one: 22 configs, 1,402 Electrical + 331 HVAC active items", () => {
    expect(configs.size).toBe(22);
    expect(master.items.Electrical).toHaveLength(1402);
    expect(master.items.HVAC).toHaveLength(331);
    expect(items).toHaveLength(1733);
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

  it("the calculator helper declares the calculator-only admission; the BoQ panel helper does not", () => {
    // HVAC Insulation is `calculator_only`, so the BoQ-shaped helper must decline it and the
    // calculator-shaped one must price it. That asymmetry is the second proof the two differ.
    const c: ParityCase = { cat: "hvac_insulation", unit: "sqm", desc: "", attrs: {}, items: [{ item: "Cladding Only" }] };
    const boqPanel = panelHelper(configs, items, c, false).compute(panelCtx(c));
    const calcShaped = panelHelper(configs, items, c, true).compute(panelCtx(c));
    expect(boqPanel.kind).toBe("none");
    expect(calcShaped.kind).toBe("suggestion");
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
    expect(tally.get("C_unit_not_offered")).toEqual({ classes: 5, rows: 5 });
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
    expect(perCat.get("hvac_adp")).toBe(13); // 12c-F: was 24; fix B closed 8, fix C closed 3
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
    expect(tally.get("C_unit_not_offered")).toEqual({ classes: 3, rows: 3 });
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
    expect(calcOnly).toHaveLength(3);
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
    expect([...awaiting]).toEqual(["C_unit_not_offered"]);
  });

  it("no listed divergence carries cause B any more -- fix B closed every one", () => {
    expect(AWAITING_CORPUS_DIVERGENCES.filter((d) => d.cause === "B_stale_pick")).toEqual([]);
    expect(AWAITING_SWEEP_DIVERGENCES.filter((d) => d.cause === "B_stale_pick")).toEqual([]);
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

  it("the five rows still awaiting are named, and none of them is a value problem", () => {
    const awaiting = AWAITING_CORPUS_DIVERGENCES.filter((d) => STATUS_BY_CAUSE[d.cause] === "awaiting owner review");
    expect(awaiting.map((d) => d.id).sort()).toEqual([
      "BRSR-26-01311#25", "BRSR-26-01311#27", "BRSR-26-01311#52", "BRSR-26-01312#51", "BRSR-26-01369#43",
    ]);
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
        const r = runParity(configs, items, c, "full", true);
        if (r.divergences.length) {
          bad.push(`${cid} ${JSON.stringify(c.attrs)}: ` + r.divergences.map((d) => `${d.what} P[${d.panel}] C[${d.calculator}]`).join(" | "));
        }
      }
    }
    expect(bad).toEqual([]);
    expect(total).toBe(1929);
  }, 180000);

  it("the resolution paths this sweep reached, named", () => {
    const paths = new Set<string>();
    for (const [, cfg] of rowLevel) {
      for (const c of [...skuCasesForCategory(cfg, items), emptyCaseFor(cfg)]) {
        for (const p of resolutionPaths(runParity(configs, items, c, "full", true).panel)) paths.add(p);
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
      const r = runParity(configs, items, c, "full", true);
      if (!r.divergences.length) continue;
      found.push({ cat: c.cat, unit: c.unit, item: c.items?.[0] ?? null, cause: classifyDivergence(r, c) });
      expect(hasPrice(r.panel)).toBe(hasPrice(r.calculator));
    }
    expect(found).toEqual(AWAITING_SWEEP_DIVERGENCES.filter((d) => d.cat === "hvac_adp"));
  }, 60000);

  it("the resolution paths this sweep reached, named", () => {
    const paths = new Set<string>();
    for (const c of cases) for (const p of resolutionPaths(runParity(configs, items, c, "full", true).panel)) paths.add(p);
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
  // Insulation is `calculator_only`, so there is no BoQ row and no stored run to read. Both paths are
  // still exercised: the panel's `ext` branch (a synthesized extraction row, which is exactly what a run
  // produces) against the calculator's override branch -- never one branch twice.
  const cfg = configs.get("hvac_insulation")!;
  const cases = itemListCasesForCategory(cfg, items);

  it("24 cases over all 6 families, and not one divergence", () => {
    expect(cases).toHaveLength(24);
    expect(new Set(cases.map((c) => c.items?.[0]?.item as string)).size).toBe(6);
    const bad: string[] = [];
    for (const c of cases) {
      const r = runParity(configs, items, c, "full", true);
      if (r.divergences.length) {
        bad.push(`${c.unit} ${JSON.stringify(c.items)}: ` + r.divergences.map((d) => `${d.what} P[${d.panel}] C[${d.calculator}]`).join(" | "));
      }
    }
    expect(bad).toEqual([]);
    expect(AWAITING_SWEEP_DIVERGENCES.filter((d) => d.cat === "hvac_insulation")).toEqual([]);
  }, 60000);

  it("the resolution paths this sweep reached, named", () => {
    const paths = new Set<string>();
    for (const c of cases) for (const p of resolutionPaths(runParity(configs, items, c, "full", true).panel)) paths.add(p);
    for (const p of ["item-list priced", "item-list refused", "item refused", "ladder size-up", "typed (Other)"]) {
      expect([...paths]).toContain(p);
    }
  }, 60000);
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
    for (const c of skuCases) expect(runParity(configs, items, c, "full", true).divergences).toEqual([]);
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
      const r = runParity(configs, items, c, "full", true);
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
