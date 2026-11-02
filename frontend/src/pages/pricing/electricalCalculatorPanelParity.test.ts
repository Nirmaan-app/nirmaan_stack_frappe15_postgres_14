/**
 * ELR-4c (owner R-39 (3), standing block 39, 2026-10-08) -- ONE PERMANENT CALCULATOR = PANEL CASE PER ELECTRICAL LINE.
 * The Electrical twin of `calculatorPanelParity.test.ts`, driven by the same harness (`runParity`: the PANEL path through
 * `compute(ctx)` with a populated extraction map, the CALCULATOR path through `PricingCalculator`'s own construction fed
 * the panel's final answers as overrides) over every case of `electricalRuleCases.ts` -- the same items, the same price,
 * the same refusal reason.
 *
 * ⚠️ ONE DECLARED DIFFERENCE, ACCEPTED BY THE OWNER: `A_wiring_primary` (owner R-A, 2026-10-06, "A is ok - nothin gto be
 * done"). Which wiring block a row OFFERS is chosen by its description, and the calculator has no description; every
 * BLOCK's figures still agree. Anything else fails.
 */
import { describe, expect, it } from "vitest";
import { isSuggestion } from "@/pages/boq-wizard/rate-helper/rateHelperTypes";
import { STATUS_BY_CAUSE } from "./calculatorPanelParity.awaiting";
import { calculatorHelper, classifyDivergence, compareResults, feedFromPanel, panelCtx, panelHelper, runParity } from "./calculatorPanelParity.harness";
import { calculatorCtx } from "./PricingCalculator";
import {
  ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS, ELECTRICAL_RULE_CASES, electricalGeneratedLines, parityCaseOf,
} from "./electricalRuleCases";

const RUNS = ELECTRICAL_RULE_CASES.map((c) => {
  const pc = parityCaseOf(c);
  const run = runParity(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS, pc, "full");
  return { c, pc, run, cause: run.divergences.length ? classifyDivergence(run, pc) : null };
});

describe("calculator = panel, one case per Electrical Derivation line (the live asset)", () => {
  // ELR-4d: WAS 169 cases; NOW 171 (PW2t, W11v). ELR-5: WAS 171; NOW 174 (SS5z, SS5y, SS5x)
  it("174 cases, and every one of the 77 generated lines has at least one", () => {
    expect(RUNS).toHaveLength(174);
    const generated = Object.entries(electricalGeneratedLines()).flatMap(([cat, ls]) => ls.map((l) => `${cat} / ${l}`));
    expect(generated).toHaveLength(77);
    const covered = new Set(ELECTRICAL_RULE_CASES.map((c) => `${c.cat} / ${c.line}`));
    expect(generated.filter((l) => !covered.has(l))).toEqual([]);
  });

  it.each(RUNS.map((x) => [`${x.c.id} ${x.c.cat} / ${x.c.line}`, x] as const))("%s", (_name, x) => {
    if (x.cause === null) {
      expect(x.run.divergences).toEqual([]);
      return;
    }
    // the one accepted cause: the OFFERED wiring figure differs, every block's figures agree
    expect(x.cause).toBe("A_wiring_primary");
    expect(STATUS_BY_CAUSE[x.cause]).toBe("accepted by owner");
    expect(x.run.divergences.map((d) => d.what).filter((w) => w !== "values" && w !== "finalValues")).toEqual([]);
  });

  it("the accepted wiring cause is carried by the termination rows only, and their block figures agree", () => {
    const a = RUNS.filter((x) => x.cause !== null);
    expect(a.map((x) => x.c.id)).toEqual(["W1+", "W14+", "W14-", "W15+", "W15-"]);
    for (const x of a) expect(compareResults(x.run.panel, x.run.calculator).some((d) => d.what === "blocks")).toBe(false);
  });
});

describe("the two paths are genuinely different code, and a broken feed is caught", () => {
  it("the panel path takes the extraction branch; the calculator path does not", () => {
    const pc = parityCaseOf(ELECTRICAL_RULE_CASES.find((c) => c.id === "DB1+")!);
    const panel = panelHelper(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS, pc).compute(panelCtx(pc));
    const calc = calculatorHelper(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS).compute(calculatorCtx("Electrical", pc.cat), {});
    expect(isSuggestion(panel) && (panel as { producibleKinds?: string[] }).producibleKinds).toBeTruthy();
    expect(isSuggestion(calc) && (calc as { producibleKinds?: string[] }).producibleKinds).toBeFalsy();
  });

  it("VACUITY: dropping one answer from the calculator's feed makes the case diverge", () => {
    const pc = parityCaseOf(ELECTRICAL_RULE_CASES.find((c) => c.id === "DB8+")!);
    const panel = panelHelper(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS, pc).compute(panelCtx(pc));
    const feed = feedFromPanel(panel, ELECTRICAL_CONFIGS.get(pc.cat) ?? null, pc, "full");
    const { mcb2_qty: _dropped, ...broken } = feed.overrides;
    const calc = calculatorHelper(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS).compute(calculatorCtx("Electrical", pc.cat), broken);
    expect(compareResults(panel, calc).length).toBeGreaterThan(0);
  });
});
