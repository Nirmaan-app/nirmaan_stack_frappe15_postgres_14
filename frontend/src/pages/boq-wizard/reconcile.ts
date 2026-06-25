/**
 * reconcile -- the PURE formula-vs-document reconciliation leaf (BoQ Phase 5, Cluster B).
 *
 * When a committed (document) amount and the formula-computed amount DIVERGE for the same
 * amount cell, the user chooses per cell which value wins. This module is the ONE place the
 * comparison tolerance + the divergence/resolution logic live, so the grid cell, the review
 * strip, AND the rollup all agree by construction.
 *
 * The float tolerance is the SAME max(ABS, REL * max(|a|,|b|)) the Summary's Option-1-vs-Option-2
 * reconciliation guard uses -- pricingRollup.ts imports `amountsEqual` from HERE (one tolerance,
 * never duplicated).
 *
 * PURE -- no React/DOM/Frappe; imports only types. A LEAF: it imports nothing from PricingGrid /
 * priceability / pricingRollup, so any of them may import it without a cycle (PricingGrid can NOT
 * import pricingRollup -- that is a cycle -- which is exactly why this lives in its own leaf).
 * Unit-tested in reconcile.test.ts.
 */
import type { ReconChoice, ReconciliationChoiceRef } from "./boqTypes";

// The reconciliation tolerance (the SINGLE source -- pricingRollup.ts reuses amountsEqual). A
// small ABSOLUTE currency floor + a RELATIVE term so float-accumulation dust never false-fires a
// divergence while a real whole-rupee difference does.
export const RECON_EPSILON_ABS = 0.01;
export const RECON_EPSILON_REL = 1e-9;

/** Are two finite amounts EQUAL within the shared tolerance? (the one comparison primitive). */
export function amountsEqual(a: number, b: number): boolean {
  const tol = Math.max(RECON_EPSILON_ABS, RECON_EPSILON_REL * Math.max(Math.abs(a), Math.abs(b)));
  return Math.abs(a - b) <= tol;
}

/**
 * Do the document and formula amounts DIVERGE? -- true iff BOTH are real finite numbers AND they
 * differ beyond the shared tolerance. A null / undefined / NaN on EITHER side => NOT a divergence
 * (there is no comparable computed number -- the not_yet / broken / no-formula states never flag).
 */
export function amountsDiffer(
  documentVal: number | null | undefined,
  formulaVal: number | null | undefined,
): boolean {
  if (typeof documentVal !== "number" || !Number.isFinite(documentVal)) return false;
  if (typeof formulaVal !== "number" || !Number.isFinite(formulaVal)) return false;
  return !amountsEqual(documentVal, formulaVal);
}

/** The O(1) membership key for a reconciliation choice -- `${excelRow}:${colLetter}`. */
export function reconChoiceKey(excelRow: number, colLetter: string): string {
  return `${excelRow}:${colLetter}`;
}

/** Build the per-cell choice map from get_priced_rows.reconciliation_choices. */
export function buildReconChoiceMap(
  choices: ReconciliationChoiceRef[],
): Map<string, ReconChoice> {
  const m = new Map<string, ReconChoice>();
  for (const c of choices) m.set(reconChoiceKey(c.excel_row, c.col_letter), c.choice);
  return m;
}

/** The resolution of one amount cell's divergence (or its absence). When `diverges`, `value` is
 *  the SHOWN/USED number per D1 and `resolved` says how it was decided. */
export type ReconResolution =
  | { diverges: false }
  | { diverges: true; resolved: ReconChoice | "unset"; value: number };

/**
 * THE single divergence + resolution rule (D1), reused by the grid cell, the review strip, AND
 * the rollup. Given the document amount, the formula amount, and the stored choice (or undefined
 * for unset):
 *   - no divergence (equal, or either side has no number) -> { diverges: false } (caller keeps
 *     its own non-divergence behavior -- the formula value);
 *   - diverges + choice "take_formula" -> the FORMULA value;
 *   - diverges + unset / "keep_document" -> the DOCUMENT value (the D1 default -- document wins
 *     until the user explicitly takes the formula).
 */
export function resolveDivergence(
  documentVal: number | null | undefined,
  formulaVal: number | null | undefined,
  choice: ReconChoice | undefined,
): ReconResolution {
  if (!amountsDiffer(documentVal, formulaVal)) return { diverges: false };
  // amountsDiffer guarantees both are finite numbers here.
  if (choice === "take_formula") {
    return { diverges: true, resolved: "take_formula", value: formulaVal as number };
  }
  return { diverges: true, resolved: choice ?? "unset", value: documentVal as number };
}
