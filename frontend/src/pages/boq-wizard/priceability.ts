/**
 * priceability -- THE single shared "qty-bearing priceable line" definition + the computed
 * review-flag derivation (BoQ Phase 5 Slice 4b-A, Cluster A).
 *
 * ONE locked owner rule, ONE place. Every consumer routes through THIS module -- the
 * needs-a-rate flag, the priced-count denominator + done-test, the incomplete-subtotal check,
 * AND the pricingRollup population alignment. Nothing re-derives priceability or
 * qty-bearing-ness ad hoc (the §6 one-shared-definition rule).
 *
 * LOCKED RULE (owner):
 *   A ROW is a PRICEABLE LINE iff BOTH:
 *     (1) isPriceableType(node_type)  [node_type in {Preamble, Line Item}], AND
 *     (2) it is QTY-BEARING: a non-blank, non-zero qty in AT LEAST ONE pricing area.
 *   A Preamble/Line-Item row that is zero-qty in every area is NOT a priceable line -- it
 *   drops out of the population (not counted, not flagged "needs a rate").
 *
 *   FILLED (never a bare zero-check): a rate cell is FILLED when it is editor-priced
 *   (isCellPriced -- a marker, incl. a deliberate 0) OR its committed value is a non-zero
 *   finite number (a prepopulated tender rate). That is EXACTLY
 *   lookupOperandValue(row, ref, descriptors, {}) !== undefined, so "filled" REUSES the
 *   editor's single source of truth (zero drift; the prepopulated-rate fix flows through).
 *
 *   FULLY PRICED (option-(i), owner-locked): for EVERY qty-bearing area, all that area's
 *   user-fillable rate cells are filled. A no-qty area is IGNORED.
 *
 * PURE -- no React/DOM/Frappe. Imports only the existing pure leaf helpers (PricingGrid's
 * exported predicates + evaluator). Unit-tested in priceability.test.ts.
 */
import {
  evaluateAmountCell,
  isAmountDescriptor,
  isPriceableType,
  isRateDescriptor,
  lookupOperandValue,
} from "./PricingGrid";
import { pickFormula } from "./amountFormula";
import type {
  AmountFormulaRef,
  AreaKey,
  ColumnDescriptor,
  ColumnFormula,
  DismissalRef,
  PricedLineCount,
  PricedRow,
  ReviewEntry,
  RowReviewFlags,
} from "./boqTypes";

// The SCALAR sentinel area key (a scalar rate/qty column has no area -> value_key null).
export const SCALAR_AREA: AreaKey = null;
const PER_AREA_RATE_FIELD = "rate_by_area";
const PER_AREA_AMOUNT_FIELD = "amount_by_area";

/** A non-blank, non-zero finite number (the qty / committed test -- NEVER a bare zero-check
 *  that would also reject null). A real 0 is NOT qty-bearing; a negative qty IS. */
function isNonZeroNum(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v !== 0;
}

/** The sheet's RATE descriptors (the user-fillable cells -- per-area + scalar). */
export function rateDescriptors(descriptors: ColumnDescriptor[]): ColumnDescriptor[] {
  return descriptors.filter(isRateDescriptor);
}

/**
 * The pricing AREA keys the sheet's rate columns target: each per-area rate column's value_key
 * + the SCALAR sentinel (null) when any scalar rate column exists. Deduped via a Set<AreaKey>
 * (which distinguishes null from every string), order-stable. An area with qty but NO rate
 * column is NOT here (it is not part of the priceable surface).
 */
export function pricingAreas(descriptors: ColumnDescriptor[]): AreaKey[] {
  const out: AreaKey[] = [];
  const seen = new Set<AreaKey>();
  for (const d of rateDescriptors(descriptors)) {
    const key: AreaKey = d.value_field === PER_AREA_RATE_FIELD ? d.value_key : SCALAR_AREA;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** The row's qty for one area: qty_total for the scalar sentinel (null), else qty_by_area[area].
 *  Compares against `null` directly so TS narrows AreaKey -> string for the index access. */
export function qtyForArea(row: PricedRow, area: AreaKey): number | null {
  if (area === null) return row.qty_total ?? null;
  return row.qty_by_area?.[area] ?? null;
}

/** Is THIS area on this row qty-bearing? (non-blank, non-zero qty in that area). */
export function isAreaQtyBearing(row: PricedRow, area: AreaKey): boolean {
  return isNonZeroNum(qtyForArea(row, area));
}

/** The rate descriptors that target one area (scalar sentinel -> the scalar rate fields). */
function rateDescriptorsForArea(descriptors: ColumnDescriptor[], area: AreaKey): ColumnDescriptor[] {
  return rateDescriptors(descriptors).filter((d) =>
    area === null
      ? d.value_field !== PER_AREA_RATE_FIELD
      : d.value_field === PER_AREA_RATE_FIELD && d.value_key === area,
  );
}

/**
 * Is this row's rate cell FILLED? REUSES lookupOperandValue with NO drafts (saved-state):
 * editor-priced (incl. a deliberate 0) -> defined; committed non-zero -> defined; unfilled 0 /
 * absent -> undefined. The single source of truth for "filled" -- never a bare zero-check.
 */
export function isRateFilled(
  row: PricedRow,
  rateDescriptor: ColumnDescriptor,
  descriptors: ColumnDescriptor[],
): boolean {
  const ref: AmountFormulaRef = {
    value_field: rateDescriptor.value_field,
    value_key: rateDescriptor.value_key,
    rate_subkey: rateDescriptor.rate_subkey,
  };
  return lookupOperandValue(row, ref, descriptors, {}) !== undefined;
}

/** Is one area FULLY priced on this row? = all its rate cells filled (a no-rate area -> false,
 *  but such an area never appears in qtyBearingAreas, so this is only asked of real areas). */
function isAreaFullyPriced(row: PricedRow, descriptors: ColumnDescriptor[], area: AreaKey): boolean {
  const rds = rateDescriptorsForArea(descriptors, area);
  if (rds.length === 0) return false;
  return rds.every((rd) => isRateFilled(row, rd, descriptors));
}

/** The areas (with rate columns) that are qty-bearing on this row. */
export function qtyBearingAreas(row: PricedRow, descriptors: ColumnDescriptor[]): AreaKey[] {
  return pricingAreas(descriptors).filter((a) => isAreaQtyBearing(row, a));
}

/** node_type in {Preamble, Line Item} AND qty-bearing in >=1 pricing area. THE population spine. */
export function isPriceableLine(row: PricedRow, descriptors: ColumnDescriptor[]): boolean {
  return isPriceableType(row.node_type) && qtyBearingAreas(row, descriptors).length > 0;
}

/** A priceable line whose EVERY qty-bearing area is fully priced (the strict done-test). */
export function isFullyPriced(row: PricedRow, descriptors: ColumnDescriptor[]): boolean {
  const areas = qtyBearingAreas(row, descriptors);
  if (areas.length === 0) return false; // not a priceable line -> not "fully priced"
  return areas.every((a) => isAreaFullyPriced(row, descriptors, a));
}

/** Does the row carry a non-zero qty ANYWHERE (scalar or any area)? Used by the qty-anomaly
 *  guardrail, where qty can be present even on a row with no rate columns. */
export function hasAnyQty(row: PricedRow): boolean {
  if (isNonZeroNum(row.qty_total)) return true;
  const ba = row.qty_by_area;
  if (ba) for (const k of Object.keys(ba)) if (isNonZeroNum(ba[k])) return true;
  return false;
}

/** A NON-priceable row type carrying a non-zero qty (the inverse guardrail). */
export function isQtyOnNonPriceable(row: PricedRow): boolean {
  return !isPriceableType(row.node_type) && hasAnyQty(row);
}

/**
 * The MANDATORY amount-formula gate (Phase 5) -- per-SHEET. A sheet's formulas are COMPLETE iff
 * EVERY amount column descriptor (isAmountDescriptor) is COVERED by a declared formula, where
 * "covered" is pickFormula's override>area-wildcard-default resolution -- so ONE wildcard
 * default (target_value_key null) covers ALL per-area amount columns sharing its (value_field,
 * rate_subkey). A sheet with ZERO amount columns is TRIVIALLY complete (rate editing NOT
 * blocked). REUSES the EXACT pickFormula resolution evaluateAmountCell uses, so completeness can
 * never drift from how amounts actually compute. A present-but-cleared record (null .formula)
 * does NOT count as covered. Pure -- unit-tested. The server (_sheet_formulas_complete) enforces
 * the SAME rule -- client = UX, server = the real boundary.
 */
export function areFormulasComplete(
  columnDescriptors: ColumnDescriptor[],
  columnFormulas: ColumnFormula[],
): boolean {
  return columnDescriptors
    .filter(isAmountDescriptor)
    .every((d) => isAmountColumnCovered(d, columnFormulas));
}

/**
 * Is THIS amount column covered by a declared formula? = pickFormula's override>area-wildcard-
 * default resolution resolves a formula with a non-null tree. The SINGLE per-column coverage
 * predicate: `areFormulasComplete` folds `.every()` over it (so a green badge on EVERY amount
 * column <=> the sheet is formula-complete <=> the rate gate is open, by construction), and the
 * header status badge / pending tint color on the SAME pickFormula resolution. A present-but-
 * cleared record (null .formula) is NOT covered. Pure -- unit-tested.
 */
export function isAmountColumnCovered(
  d: ColumnDescriptor,
  columnFormulas: ColumnFormula[],
): boolean {
  const f = pickFormula(
    { value_field: d.value_field, value_key: d.value_key, rate_subkey: d.rate_subkey },
    columnFormulas,
  );
  return !!(f && f.formula);
}

/**
 * Compute ALL of a row's review flags (Slice 4b-A). PURE -- saved-state only (the F4 amount
 * evaluation uses EMPTY draftRates so the strip/count are a consistent saved snapshot,
 * matching the rollup; the live grid keeps its own draft-aware broken marker).
 */
export function computeRowFlags(
  row: PricedRow,
  descriptors: ColumnDescriptor[],
  columnFormulas: ColumnFormula[],
): RowReviewFlags {
  const priceableLine = isPriceableLine(row, descriptors);

  // needs_rate: a qty-bearing area not fully filled (priceable line only). Per-area aware --
  // a row priced in area X but not the qty-bearing area Y still fires for Y.
  const needsRateAreas = priceableLine
    ? qtyBearingAreas(row, descriptors).filter((a) => !isAreaFullyPriced(row, descriptors, a))
    : [];

  // qty on a non-priceable row type.
  const qtyAnomaly = isQtyOnNonPriceable(row);

  // F4 not_yet / broken surfaced by READING evaluateAmountCell (no compute re-architecture).
  // GATED behind the priceability spine, SYMMETRIC with needs_rate (cert fix): they fire ONLY
  // on (1) a PRICEABLE LINE, and (2) an amount cell whose AREA is QTY-BEARING on this row
  // (option-(i), reusing the SAME isAreaQtyBearing the qtyBearingAreas set is built from -- no
  // new qty check). A note/header/non-priceable row never flags; a priceable multi-area row
  // qty-bearing in A1 but not A2 may flag for A1's amount cell, A2's is ignored.
  const brokenCols: string[] = [];
  const notYetCols: string[] = [];
  if (priceableLine) {
    for (const d of descriptors) {
      if (!isAmountDescriptor(d)) continue;
      // The amount cell's area: the per-area value_key, or the SCALAR sentinel for a scalar
      // amount column. A no-qty area is ignored (option-(i)). SAME key space as needsRateAreas
      // (both per-area columns of an area share value_key=area; scalar -> the SCALAR sentinel).
      const area: AreaKey = d.value_field === PER_AREA_AMOUNT_FIELD ? d.value_key : SCALAR_AREA;
      if (!isAreaQtyBearing(row, area)) continue;
      const res = evaluateAmountCell(d, row, descriptors, columnFormulas, {});
      if (res.kind === "blank") {
        if (res.reason === "broken") {
          brokenCols.push(d.col); // broken is NEVER suppressed -- a different, real problem.
        } else if (!needsRateAreas.includes(area)) {
          // not_yet DE-DUPE (cert fix): suppress it when this cell's AREA is already a
          // needs_rate area -- the amount-not-computed there is the SAME rate gap needs_rate
          // already reports (two messages for one problem = noise). not_yet STILL fires for a
          // non-needs_rate area whose formula blanks for a NON-rate cause (another uncomputed
          // operand). PER-AREA: A2's not_yet is suppressed while A1 is judged on its own.
          notYetCols.push(d.col);
        }
      }
    }
  }

  return {
    needsRate: needsRateAreas.length > 0,
    needsRateAreas,
    qtyAnomaly,
    broken: brokenCols.length > 0,
    brokenCols,
    notYet: notYetCols.length > 0,
    notYetCols,
  };
}

/** True iff a row carries at least one computed flag (drives the in-grid row marker). */
export function hasAnyFlag(f: RowReviewFlags): boolean {
  return f.needsRate || f.qtyAnomaly || f.broken || f.notYet;
}

/** Highest-severity flag class for the in-grid marker color: broken/qty_anomaly are
 *  "critical" (a structural / wrong-row problem); the rest are "attention". */
export function flagSeverity(f: RowReviewFlags): "critical" | "attention" | null {
  if (f.broken || f.qtyAnomaly) return "critical";
  if (f.needsRate || f.notYet) return "attention";
  return null;
}

/**
 * The live priced-count: M = priceable lines; N = those FULLY priced. Per-ROW (owner-locked),
 * strict done-test. Pure -- derived from the delivered rows + descriptors, no new fetch.
 */
export function computePricedCount(
  rows: PricedRow[],
  descriptors: ColumnDescriptor[],
): PricedLineCount {
  let total = 0;
  let priced = 0;
  for (const r of rows) {
    if (!isPriceableLine(r, descriptors)) continue;
    total++;
    if (isFullyPriced(r, descriptors)) priced++;
  }
  return { priced, total };
}

/**
 * Is a single row INCOMPLETE? -- a qty-bearing priceable row that is NOT fully priced OR whose
 * amount cell is not_yet/broken. The atom the incomplete-subtotal rollup ORs over descendants.
 * Zero-qty / non-priceable rows are NEVER incomplete (owner: only qty-bearing rows count).
 */
export function isRowIncomplete(
  row: PricedRow,
  descriptors: ColumnDescriptor[],
  columnFormulas: ColumnFormula[],
): boolean {
  if (!isPriceableLine(row, descriptors)) return false;
  if (!isFullyPriced(row, descriptors)) return true;
  // Same option-(i) gate as computeRowFlags' not_yet/broken loop: only a QTY-BEARING area's
  // amount cell can mark the row incomplete (a no-qty area's amount is ignored). Without this
  // the summary message would disagree with the grid -- a fully-priced row with a no-qty area
  // whose formula evaluates not_yet would falsely read incomplete.
  for (const d of descriptors) {
    if (!isAmountDescriptor(d)) continue;
    const area: AreaKey = d.value_field === PER_AREA_AMOUNT_FIELD ? d.value_key : SCALAR_AREA;
    if (!isAreaQtyBearing(row, area)) continue;
    if (evaluateAmountCell(d, row, descriptors, columnFormulas, {}).kind === "blank") return true;
  }
  return false;
}

// ── Review-strip entry builders (the strip extends 4a's feed in place) ────────────

const AREA_LABEL = (a: AreaKey): string => (a === null ? "rate" : `area "${a}"`);

/** Build the per-row computed-flag entries for the review strip (excludes 4a remarks +
 *  rollup incomplete_subtotal -- the page concatenates those). One entry per row per kind. */
export function buildFlagEntries(
  rows: PricedRow[],
  descriptors: ColumnDescriptor[],
  columnFormulas: ColumnFormula[],
): ReviewEntry[] {
  const out: ReviewEntry[] = [];
  for (const row of rows) {
    const f = computeRowFlags(row, descriptors, columnFormulas);
    const base = { excelRow: row.source_row_number, description: row.description ?? "" };
    if (f.needsRate) {
      out.push({
        ...base,
        kind: "needs_rate",
        text: `Needs a rate -- ${f.needsRateAreas.map(AREA_LABEL).join(", ")} not yet priced.`,
      });
    }
    if (f.qtyAnomaly) {
      out.push({
        ...base,
        kind: "qty_anomaly",
        text: "Quantity on a non-priceable row type -- check the classification.",
      });
    }
    if (f.broken) {
      out.push({
        ...base,
        kind: "broken",
        text: `Formula won't resolve (cols ${f.brokenCols.join(", ")}) -- check the formula.`,
      });
    }
    if (f.notYet) {
      out.push({
        ...base,
        kind: "not_yet",
        text: `Amount not computed yet (cols ${f.notYetCols.join(", ")}) -- a rate is missing.`,
      });
    }
  }
  return out;
}

// ── Acknowledge ("reviewed / looks OK") dismiss filter (Slice 4b-ACKNOWLEDGE) ─────
// PURE membership helpers. A dismissal HIDES a review-strip entry from the active view. The
// store key is (excel_row, flag_kind) -- the SAME identity a ReviewEntry carries -- so the
// composite "<kind>:<excelRow>" matches the strip's own list key `${e.kind}:${e.excelRow}`.

/** The dismissal membership key for an (excelRow, kind) pair. MUST equal the strip's list
 *  key `${kind}:${excelRow}` so a dismissal matches its entry exactly. */
export function dismissalKey(excelRow: number, kind: ReviewEntry["kind"]): string {
  return `${kind}:${excelRow}`;
}

/** The same key for a whole ReviewEntry (reuses dismissalKey -- one identity definition). */
export function reviewEntryKey(e: ReviewEntry): string {
  return dismissalKey(e.excelRow, e.kind);
}

/** Build the O(1) membership set from get_priced_rows.dismissals (a flat sheet-level list). */
export function buildDismissedKeySet(dismissals: DismissalRef[]): Set<string> {
  const set = new Set<string>();
  for (const d of dismissals) set.add(dismissalKey(d.excel_row, d.flag_kind));
  return set;
}

/** Is this entry dismissed? (membership test on its composite key). */
export function isEntryDismissed(e: ReviewEntry, dismissed: Set<string>): boolean {
  return dismissed.has(reviewEntryKey(e));
}

/** The ACTIVE (undismissed) entries -- ONE pass over the already-built list. The unfiltered
 *  list is retained by the caller for the "show all" toggle (nothing is ever lost). */
export function filterActiveReviewEntries(
  entries: ReviewEntry[],
  dismissed: Set<string>,
): ReviewEntry[] {
  return entries.filter((e) => !isEntryDismissed(e, dismissed));
}
