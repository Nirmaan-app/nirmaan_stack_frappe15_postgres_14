import { describe, it, expect } from "vitest";
import {
  RATE_HELPERS,
  buildHelperList,
  previouslyPricedHelper,
  qtyBreakdownHelper,
  resolveRateHelpers,
  suggestionCountForKind,
} from "./rateHelperRegistry";
import { isSuggestion, type HelperResult, type RateHelper, type RateHelperRowContext } from "./rateHelperTypes";

function ctx(category: string | null): RateHelperRowContext {
  return {
    excelRow: 7,
    description: "d",
    nodeType: "Line Item",
    category,
    discipline: null,
    rateKinds: ["supply_rate", "install_rate"],
  };
}

// A mock "real" helper (stands in for the page-built pricing-sheet helper): suggests supply only.
const mockHelper: RateHelper = {
  id: "pricing_sheet",
  label: "Pricing sheet",
  compute: (c: RateHelperRowContext): HelperResult =>
    c.category === "wiring_cabling"
      ? { kind: "suggestion", values: { supply_rate: 120 }, basis: "b",
          workings: { attributes: [], matchedRows: [], derivation: [], finalValues: { supply_rate: 120 } } }
      : { kind: "none", reason: "no table" },
};

describe("rate-helper registry", () => {
  it("the STATIC registry is the two always-declining helpers (the stub is gone)", () => {
    expect(RATE_HELPERS.map((h) => h.id)).toEqual([
      "previously_priced_boqs",
      "qty_breakdown_live",
    ]);
  });

  it("buildHelperList prepends the page-built helper, else returns the static two", () => {
    expect(buildHelperList(mockHelper).map((h) => h.id)).toEqual([
      "pricing_sheet",
      "previously_priced_boqs",
      "qty_breakdown_live",
    ]);
    expect(buildHelperList(null).map((h) => h.id)).toEqual([
      "previously_priced_boqs",
      "qty_breakdown_live",
    ]);
  });

  it("the two dead helpers ALWAYS decline with their honest reasons (N-generic proof)", () => {
    expect(previouslyPricedHelper.compute(ctx("earthing"))).toEqual({
      kind: "none",
      reason: "No priced corpus for this category yet",
    });
    expect(qtyBreakdownHelper.compute(ctx("earthing"))).toEqual({
      kind: "none",
      reason: "Helper not built -- planned",
    });
  });

  it("resolveRateHelpers runs every helper (incl. a passed real helper) -> one eval each", () => {
    const evals = resolveRateHelpers(ctx("wiring_cabling"), undefined, buildHelperList(mockHelper));
    expect(evals.map((e) => e.helper.id)).toEqual([
      "pricing_sheet",
      "previously_priced_boqs",
      "qty_breakdown_live",
    ]);
    expect(isSuggestion(evals[0].result)).toBe(true); // the real helper suggests
    expect(evals[1].result.kind).toBe("none");
    expect(evals[2].result.kind).toBe("none");
  });

  it("suggestionCountForKind counts only helpers with a value for the kind (with a passed list)", () => {
    const helpers = buildHelperList(mockHelper);
    expect(suggestionCountForKind(ctx("wiring_cabling"), "supply_rate", helpers)).toBe(1);
    expect(suggestionCountForKind(ctx("wiring_cabling"), "install_rate", helpers)).toBe(0); // supply-only
    expect(suggestionCountForKind(ctx("panels"), "supply_rate", helpers)).toBe(0); // declines
    expect(suggestionCountForKind(ctx(null), "supply_rate", helpers)).toBe(0);
    // default list (no real helper) -> the two dead ones never suggest
    expect(suggestionCountForKind(ctx("wiring_cabling"), "supply_rate")).toBe(0);
  });
});
