/**
 * U1 rate-helper REGISTRY (guardrail G3: N-generic). The page evaluates EVERY registered helper over
 * a row and the panel renders one card per helper from the contract alone -- so adding a helper is a
 * registry edit, never a panel change. Two of the three registered helpers always decline; they
 * exist to PROVE the panel renders the contract generically (dead cards look like live ones).
 */
import type { HelperResult, RateHelper, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { stubRateHelper } from "./stubRateHelper";

/** "Previously priced BoQs" -- the priced-corpus helper (U2+). Always declines in U1. */
export const previouslyPricedHelper: RateHelper = {
  id: "previously_priced_boqs",
  label: "Previously priced BoQs",
  compute: () => ({ kind: "none", reason: "No priced corpus for this category yet" }),
};

/** "Qty breakdown + live data" -- the live-data helper (planned). Always declines in U1. */
export const qtyBreakdownHelper: RateHelper = {
  id: "qty_breakdown_live",
  label: "Qty breakdown + live data",
  compute: () => ({ kind: "none", reason: "Helper not built -- planned" }),
};

/** The ordered registry. The stub is first (the only live one in U1). */
export const RATE_HELPERS: RateHelper[] = [
  stubRateHelper,
  previouslyPricedHelper,
  qtyBreakdownHelper,
];

export interface HelperEvaluation {
  helper: RateHelper;
  result: HelperResult;
}

/** Run every helper over a row context. Pure. `attrOverridesByHelper` lets a single helper be
 * re-run with edited attributes (panel live recompute) while the others stay at their defaults. */
export function resolveRateHelpers(
  ctx: RateHelperRowContext,
  attrOverridesByHelper?: Record<string, Record<string, string>>,
  helpers: RateHelper[] = RATE_HELPERS,
): HelperEvaluation[] {
  return helpers.map((helper) => ({
    helper,
    result: helper.compute(ctx, attrOverridesByHelper?.[helper.id]),
  }));
}

/** The count of helpers that suggest a value for `kind` on this row -- drives the badge count chip.
 * A helper counts only when it returns a Suggestion whose `values[kind]` is a number. */
export function suggestionCountForKind(
  ctx: RateHelperRowContext,
  kind: string,
  helpers: RateHelper[] = RATE_HELPERS,
): number {
  let n = 0;
  for (const { result } of resolveRateHelpers(ctx, undefined, helpers)) {
    if (isSuggestion(result) && typeof result.values[kind] === "number") n += 1;
  }
  return n;
}
