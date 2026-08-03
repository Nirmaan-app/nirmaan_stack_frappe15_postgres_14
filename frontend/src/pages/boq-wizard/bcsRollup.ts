/**
 * bcsRollup.ts -- BCS cost, Tendered amount and % Profit PER BoQ SECTION (slice BCS-S5).
 *
 * WHAT THIS IS. The summary panel already rolls each amount column up the parent tree. This adds
 * the cost side of the same tree and the margin between them, so a pricer can see which SECTION is
 * thin rather than only which line is -- the section being the BoQ's own parent grouping (owner
 * confirmed 2026-08-03), NOT a classification category.
 *
 * ★ THE RATIO RULE -- THE SINGLE MOST IMPORTANT THING IN THIS MODULE.
 *
 * A section's % Profit is RECOMPUTED from its SUMMED cost and its SUMMED tendered amount. It is
 * never the average of its lines' percentages, and never their sum.
 *
 * An average weights a Rs.10 line at 90% exactly as heavily as a Rs.10 lakh line at 2%. On a real
 * BoQ that is not a small error, it is an unrelated number -- and it is the worst shape of wrong,
 * because it lands in a plausible range and moves in a plausible direction while meaning nothing.
 * `bcsRollup.test.ts` T1 pins this with a fixture whose weighted answer (~2.0%) is nowhere near
 * either the mean (46%) or the sum (92%) of its two lines, so a later "simplification" to either
 * fails loudly instead of shipping.
 *
 * ★ THE CONSISTENCY RULE. The tendered figure is READ FROM `pricingRollup`'s own rolled numbers --
 * `node.totals[col]` per section and `grandTotals[col]` for the project -- never re-derived here.
 * A second derivation would drift from the grid on formula resolution, on the document-vs-formula
 * reconciliation choice and on draft state, and the Tendered column exists PRECISELY so the two
 * are comparable on screen. A summary that disagrees with the grid about the same section is worse
 * than no summary at all.
 *
 * ⚠️ BOTH SIDES ARE SAVED-ONLY, AND THEY HAVE TO BE. `pricingRollup.rowOwnAmount` reads saved
 * values with an EMPTY draft map (the panel is a save-time view, Option A), so the cost side is
 * fed the same way -- stored BCS rates, no live cost drafts. Mixing a drafted numerator with a
 * saved denominator would produce a margin that belongs to neither moment.
 *
 * ⚠️ ABSENT IS NOT ZERO, ON EITHER SIDE. A section nobody has costed reports `cost: null`, not 0,
 * and its margin is a BLANK CARRYING A REASON rather than a number. Folding the two together would
 * render an uncosted section as "0" cost and a 100% margin -- a confident claim of pure profit
 * over a section about which nothing is known. This mirrors the rule `bcsRowAmount` and
 * `bcsRowQuantity` already keep one level down ("a row where NOTHING resolves is genuinely
 * amount-less and returns null, not 0").
 *
 * THE ARITHMETIC IS NOT RE-IMPLEMENTED HERE. `sectionMarginPercent` wraps `bcsColumns`'
 * `bcsMarginPercent`, so the owner-settled DIRECTION ((amount - cost) / amount, never
 * cost-over-amount and never a markup on cost) and its zero / negative / non-finite denominator
 * guards have exactly ONE home and apply identically to a line and to a section. In particular a
 * section whose amounts sum NEGATIVE is refused rather than shown as a profit -- the sign
 * inversion `bcsMarginPercent` documents at length is reachable by summation, not just by typing.
 *
 * PURE. No React, no I/O. Structural inputs only (`BcsRollupNodeLike` is declared here rather than
 * imported so this module never depends on `pricingRollup`; `RollupNode` satisfies it), plus the
 * one import of the shared BCS arithmetic. Unit-tested in bcsRollup.test.ts.
 */
import { bcsMarginPercent, type BcsComputedCell } from "./bcsColumns";

/**
 * The structural shape this module reads off a rollup node. `pricingRollup.RollupNode` satisfies
 * it; declaring it here keeps the dependency one-way (pricingRollup -> bcsRollup), so composing
 * the BCS axis into `RollupResult` cannot create a cycle.
 *
 * `totals` is the node's ROLLED amount per column -- the consistency rule's source. `ownAmounts` is
 * the node's OWN amount per column and is read ONLY for PRESENCE: `totals` cannot distinguish "no
 * amount anywhere on this branch" from "the amounts here sum to zero", and those are different
 * findings that must not share a cell.
 */
export interface BcsRollupNodeLike {
  rowIndex: number;
  totals: Record<string, number>;
  ownAmounts: Record<string, number | null>;
  children: BcsRollupNodeLike[];
}

/** One section's three figures. `cost`/`tendered` are null when ABSENT (never costed / nothing
 *  charged), which is a different fact from zero and renders as an empty cell, not a 0. */
export interface BcsSectionTotals {
  cost: number | null;
  tendered: number | null;
  /** % Profit, or a blank that KNOWS WHY -- the same discriminated cell the grid's column uses. */
  margin: BcsComputedCell;
}

/** The parallel BCS structure hung off `RollupResult`. Deliberately NOT folded into
 *  `RollupResult.columns`: those entries each carry a real `ColumnDescriptor`, and there is no
 *  descriptor behind a computed cost or a percentage. The panel renders these three OUTSIDE its
 *  `columns.map` loop. */
export interface BcsRollupResult {
  /** Every node in the forest, at every depth, keyed by `row_index`. */
  byRowIndex: Map<number, BcsSectionTotals>;
  /** The project row, whose tendered comes from `grandTotals` (the consistency rule). */
  grand: BcsSectionTotals;
}

/**
 * ★ The ratio, in one place. Takes the two SUMS and hands them to the shared `bcsMarginPercent`,
 * so a section is measured exactly as a line is.
 *
 * The null -> blank-reason mapping is what lets a section explain an empty % Profit: `no_cost`
 * when nothing on the branch has been costed (the ordinary state of a fresh sheet, and the reason
 * checked FIRST because typing a cost is the fix), `no_amount` when nothing on it charges anything.
 */
export function sectionMarginPercent(
  cost: number | null,
  tendered: number | null,
): BcsComputedCell {
  return bcsMarginPercent(
    cost === null ? { kind: "blank", reason: "no_cost" } : { kind: "value", value: cost },
    tendered === null ? { kind: "blank", reason: "no_amount" } : { kind: "value", value: tendered },
  );
}

/** A finite number, or null. Guards the fold against a NaN/Infinity reaching a running sum, where
 *  it would silently destroy the whole section's total rather than just its own row's. */
function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** What one subtree contributed: the cost sum, whether ANY cost was present, and whether any
 *  amount was present. The two booleans are what keep absent apart from zero. */
interface SubtreeAgg {
  costSum: number;
  costPresent: boolean;
  amountPresent: boolean;
}

/**
 * Roll the BCS cost up the SAME forest the amounts roll up, and pair each node with its tendered
 * total and recomputed margin.
 *
 * @param roots         the rollup forest (pricingRollup's `roots`).
 * @param ownCost       one row's OWN saved BCS cost by `row_index`; null = never costed. A priced
 *                      preamble carries its own row's cost only -- exactly as its own amount does,
 *                      so nothing is double-counted against its children.
 * @param tenderedCols  the BCS-CONFIRMED amount column letters. Deduplicated here: a column stored
 *                      twice must not double the denominator and quietly halve every margin.
 * @param grandTotals   pricingRollup's per-column project totals -- the grand row's tendered.
 *
 * Cycle-safe by a DFS path set (a child already on the current path is skipped), the same guard
 * `pricingRollup.build` uses. The parent tree is a true tree, so this is defensive; an unguarded
 * walk would hang the tab, which is a worse failure than a wrong number.
 */
export function rollBcsSections(
  roots: readonly BcsRollupNodeLike[],
  ownCost: (rowIndex: number) => number | null,
  tenderedCols: readonly string[],
  grandTotals: Record<string, number>,
): BcsRollupResult {
  const cols = [...new Set(tenderedCols)];
  const byRowIndex = new Map<number, BcsSectionTotals>();

  /** Does this node itself carry a resolved amount in any confirmed column? A column absent from
   *  the sheet (a stored confirmation stranded by a re-commit) is not present, so it can never
   *  make a branch look like a genuine zero-amount section. */
  const ownAmountPresent = (n: BcsRollupNodeLike): boolean =>
    cols.some((c) => finiteOrNull(n.ownAmounts?.[c]) !== null);

  /** The node's tendered total, read from the ROLLED totals -- the consistency rule. */
  const rolledTendered = (n: BcsRollupNodeLike): number =>
    cols.reduce((s, c) => s + (finiteOrNull(n.totals?.[c]) ?? 0), 0);

  const walk = (n: BcsRollupNodeLike, path: Set<number>): SubtreeAgg => {
    path.add(n.rowIndex);

    const own = finiteOrNull(ownCost(n.rowIndex));
    let costSum = own ?? 0;
    let costPresent = own !== null;
    let amountPresent = ownAmountPresent(n);

    for (const child of n.children ?? []) {
      if (path.has(child.rowIndex)) continue; // cycle guard
      const agg = walk(child, path);
      costSum += agg.costSum;
      costPresent = costPresent || agg.costPresent;
      amountPresent = amountPresent || agg.amountPresent;
    }

    path.delete(n.rowIndex);

    const cost = costPresent ? costSum : null;
    const tendered = amountPresent ? rolledTendered(n) : null;
    byRowIndex.set(n.rowIndex, { cost, tendered, margin: sectionMarginPercent(cost, tendered) });

    return { costSum, costPresent, amountPresent };
  };

  let grandCostSum = 0;
  let grandCostPresent = false;
  let grandAmountPresent = false;
  for (const r of roots) {
    const agg = walk(r, new Set<number>());
    grandCostSum += agg.costSum;
    grandCostPresent = grandCostPresent || agg.costPresent;
    grandAmountPresent = grandAmountPresent || agg.amountPresent;
  }

  const grandCost = grandCostPresent ? grandCostSum : null;
  // The project's tendered comes from `grandTotals`, not from re-adding the roots. They are equal
  // by construction (grandTotals IS the sum of the top-level rolled totals) -- taking it from the
  // published number is what guarantees the grand row and the panel's amount columns agree.
  const grandTendered = grandAmountPresent
    ? cols.reduce((s, c) => s + (finiteOrNull(grandTotals?.[c]) ?? 0), 0)
    : null;

  return {
    byRowIndex,
    grand: {
      cost: grandCost,
      tendered: grandTendered,
      margin: sectionMarginPercent(grandCost, grandTendered),
    },
  };
}
