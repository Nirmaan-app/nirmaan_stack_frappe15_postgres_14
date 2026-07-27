import { describe, it, expect } from "vitest";
import {
  RATE_HELPERS,
  previouslyPricedHelper,
  qtyBreakdownHelper,
  resolveRateHelpers,
  suggestionCountForKind,
} from "./rateHelperRegistry";
import { isSuggestion, type RateHelperRowContext } from "./rateHelperTypes";

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

describe("rate-helper registry", () => {
  it("registers exactly three helpers (stub + two dead)", () => {
    expect(RATE_HELPERS.map((h) => h.id)).toEqual([
      "stub_pricing_sheet",
      "previously_priced_boqs",
      "qty_breakdown_live",
    ]);
  });

  it("the two dead helpers ALWAYS decline with their honest reasons (N-generic proof)", () => {
    const p = previouslyPricedHelper.compute(ctx("earthing"));
    const q = qtyBreakdownHelper.compute(ctx("earthing"));
    expect(p).toEqual({ kind: "none", reason: "No priced corpus for this category yet" });
    expect(q).toEqual({ kind: "none", reason: "Helper not built -- planned" });
  });

  it("resolveRateHelpers runs every helper and returns one evaluation each", () => {
    const evals = resolveRateHelpers(ctx("earthing"));
    expect(evals.map((e) => e.helper.id)).toEqual([
      "stub_pricing_sheet",
      "previously_priced_boqs",
      "qty_breakdown_live",
    ]);
    expect(isSuggestion(evals[0].result)).toBe(true); // stub suggests
    expect(evals[1].result.kind).toBe("none");
    expect(evals[2].result.kind).toBe("none");
  });

  it("per-helper attribute overrides only re-run that helper", () => {
    const evals = resolveRateHelpers(ctx("earthing"), {
      stub_pricing_sheet: { size: "50x6" },
    });
    const stub = evals[0].result;
    expect(isSuggestion(stub) && stub.values.supply_rate).toBe(210);
  });

  it("suggestionCountForKind counts only helpers with a value for the kind", () => {
    expect(suggestionCountForKind(ctx("earthing"), "supply_rate")).toBe(1); // stub only
    expect(suggestionCountForKind(ctx("earthing"), "install_rate")).toBe(1);
    expect(suggestionCountForKind(ctx("wiring_cabling"), "supply_rate")).toBe(1);
    expect(suggestionCountForKind(ctx("wiring_cabling"), "install_rate")).toBe(0); // supply-only
    expect(suggestionCountForKind(ctx("panels"), "supply_rate")).toBe(0); // no table
    expect(suggestionCountForKind(ctx(null), "supply_rate")).toBe(0);
  });
});
