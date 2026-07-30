/**
 * U1 rate-helper REGISTRY (guardrail G3: N-generic). The page evaluates EVERY registered helper over
 * a row and the panel renders one card per helper from the contract alone -- so adding a helper is a
 * registry edit, never a panel change. Two of the three registered helpers always decline; they
 * exist to PROVE the panel renders the contract generically (dead cards look like live ones).
 */
import type { HelperResult, RateHelper, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";

/** "Previously priced BoQs" -- the priced-corpus helper (later). Always declines today. */
export const previouslyPricedHelper: RateHelper = {
  id: "previously_priced_boqs",
  label: "Previously priced BoQs",
  compute: () => ({ kind: "none", reason: "No priced corpus for this category yet" }),
};

/** "Qty breakdown + live data" -- the live-data helper (planned). Always declines today. */
export const qtyBreakdownHelper: RateHelper = {
  id: "qty_breakdown_live",
  label: "Qty breakdown + live data",
  compute: () => ({ kind: "none", reason: "Helper not built -- planned" }),
};

/** The STATIC registry -- the two always-declining helpers that prove the panel renders the
 * contract generically. The REAL "Pricing sheet" helper is page-built (a closure over the run's
 * extraction + the RM-1 config/master) and PREPENDED via buildHelperList (RM-3 -- the U1 stub is
 * gone). */
export const RATE_HELPERS: RateHelper[] = [previouslyPricedHelper, qtyBreakdownHelper];

/** The live helper list for the page: the real pricing-sheet helper first (when a run is loaded),
 * then the static declining ones. Pass this to buildSuggestions + the panel. */
export function buildHelperList(pricingSheetHelper?: RateHelper | null): RateHelper[] {
  return pricingSheetHelper ? [pricingSheetHelper, ...RATE_HELPERS] : RATE_HELPERS;
}

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
    // Badge a kind if the helper has a COMPUTED value for it OR declares it producible (a partial
    // extraction still badges so the pricer can open the panel to complete it -- RM-3).
    if (
      isSuggestion(result) &&
      (typeof result.values[kind] === "number" || (result.producibleKinds?.includes(kind) ?? false))
    ) {
      n += 1;
    }
  }
  return n;
}
