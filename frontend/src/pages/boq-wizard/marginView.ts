/**
 * marginView.ts -- the pure % Margin RANGE FILTER and IN-PLACE SORT, both driven from the
 * % Margin column header (BCS-S13 / BCS-S14).
 *
 * ⚠️ THE MARGIN VIEW THIS MODULE WAS NAMED FOR IS GONE (owner ruling 2026-08-07). BCS-S4 shipped
 * a flat "every line item, worst margin first, with its section" VIEW with its own toolbar
 * button. The owner replaced it with two controls on the % Margin header itself -- a funnel
 * (filter to a band) and an arrow (order by margin) -- so the sheet answers margin questions in
 * place and every other control keeps meaning what it meant a moment ago.
 *
 * ⚠️ THE SORT HALF IS THE VIEW'S OWN SORT, RELOCATED -- NOT A REWRITE. `compareByMargin` and the
 * decide-once/apply-later split come back verbatim, because their two hard-won properties are
 * unchanged by where the control lives (blanks last in BOTH directions; positions frozen between
 * explicit sorts). What DID change is membership, twice, and both changes are load-bearing:
 *
 *   1. `isMarginViewRow` (LINE ITEMS ONLY) IS GONE FROM BOTH HALVES. It was a curation rule for a
 *      list -- "a heading means nothing among the lines it introduces". Sorting the sheet IN
 *      PLACE is not curation: a row the order omits is a row that VANISHES FROM THE GRID. See
 *      `marginSortRows`.
 *   2. The filter's membership is the MARGIN, not the row type, for the matching reason -- see
 *      `marginRangeRowSet`.
 *
 * `buildSectionLabels` did NOT come back and should not: it existed because flattening destroyed
 * the section context a tree shows by POSITION, and an in-place sort that keeps every row can
 * simply be turned off to get that context back.
 *
 * The FILE NAME is the last trace of the view. Left alone deliberately: renaming it would touch
 * every import for no behavioural gain, and this docblock is what a reader lands on.
 *
 * Pure -- no React, no DOM. Unit-tested in marginView.test.ts.
 */

/** The row shape this module needs. A real `PricedRow` satisfies it. */
export interface MarginViewRowLike {
  row_index: number;
}

// ── BCS-S14: the % Margin IN-PLACE SORT ──────────────────────────────────────

/** Ascending = worst margin first (the review order); descending = best first. */
export type MarginSortDir = "asc" | "desc";

/**
 * The arrow's THREE-STATE cycle: off -> asc -> desc -> off.
 *
 * ⚠️ OFF IS REACHABLE, AND THAT IS NOT A CONVENIENCE. A margin order is not the sheet's own
 * order: the BoQ's document order IS its structure (sections, the lines under them, the sequence
 * a reader and the client both know it by). A two-state asc/desc arrow would let someone reorder
 * the sheet and have no way back short of switching sheets, and because the sort suppresses the
 * indent and the chevrons while it is on, "no way back" means the hierarchy is simply unavailable.
 *
 * ASC FIRST because the first question is always "what is losing money" -- the same reasoning
 * that made the deleted view open ascending. Opening on the best margins puts the answer at the
 * far end of the sheet.
 */
export function nextMarginSort(dir: MarginSortDir | null): MarginSortDir | null {
  if (dir === null) return "asc";
  return dir === "asc" ? "desc" : null;
}

/** One row's sort key: its row_index and the % Margin it showed when the snapshot was taken. */
export interface MarginEntry {
  rowIndex: number;
  /** The row's % Margin, or null when it has none (uncosted, no quantity, no amount, ...). */
  margin: number | null;
}

/**
 * ★ THE COMPARATOR. BLANKS LAST IN BOTH DIRECTIONS.
 *
 * ⚠️ THE BLANK TEST SITS OUTSIDE THE DIRECTION FLIP, AND THAT IS THE WHOLE POINT. The idiom this
 * repo uses elsewhere -- substitute a low sentinel for a missing value and let the comparator do
 * the rest -- gives you blanks-last for free in ONE direction and blanks-FIRST in the other.
 * Descending is the direction that breaks, and it is the worse one to break: most rows on a real
 * sheet have no margin until someone costs them, so a descending sort whose blanks float to the
 * top opens on a screenful of nothing, exactly where the best margins are supposed to be.
 *
 * There is no sentinel that fixes this, because "sorts below every number" and "sorts above every
 * number" are contradictory requirements for one substitute. The absence has to be handled as an
 * absence.
 *
 * A 0% margin and a NEGATIVE margin are REAL VALUES, never blanks: "this row makes nothing" and
 * "this row loses money" are the findings the sort exists to surface, and folding either in with
 * "not costed yet" would bury them. NaN and Infinity ARE treated as blanks -- `bcsMarginPercent`
 * already refuses both, but a NaN reaching a comparator makes every comparison false and the
 * resulting order depend on input order, which is a silent, unreproducible sort.
 *
 * Returns 0 for a tie, so the caller's (stable, ES2019-guaranteed) sort leaves equal rows in
 * document order.
 */
export function compareByMargin(
  a: number | null,
  b: number | null,
  dir: MarginSortDir,
): number {
  const aBlank = a === null || !Number.isFinite(a);
  const bBlank = b === null || !Number.isFinite(b);
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1; // ...whatever `dir` says
  if (bBlank) return -1; // ...whatever `dir` says
  return dir === "asc" ? (a as number) - (b as number) : (b as number) - (a as number);
}

/**
 * Decide the order ONCE: every row's row_index, ranked by margin.
 *
 * ⚠️ THE SPLIT BETWEEN THIS AND `marginSortRows` IS LOAD-BEARING, NOT TIDINESS. This decides the
 * order on an explicit arrow click and the caller holds the result in state; `marginSortRows`
 * applies that held order to whatever rows are current. Inside `PricingGrid` the cursor
 * (`activeCell`) is ARRAY-INDEX addressed -- `{rowIndex, colIndex}` indexing the `rows` prop -- so
 * a re-order performed while a cell is focused slides a DIFFERENT row under the cursor and the
 * next character lands on it. Clipboard multi-row selection is a contiguous array RANGE over the
 * same indices and carries the same exposure across a paste. Deciding once and applying later is
 * what keeps the VALUES live while the POSITIONS stay still.
 *
 * ⚠️ RANKS EVERY ROW, including ones with no margin (they land at the end, in document order).
 * The deleted view ranked line items only; that is now a defect rather than a curation -- see
 * `marginSortRows`.
 *
 * ⚠️ THE CALLER MUST PASS THE WHOLE SHEET, not the displayed rows. A rank built over a filtered
 * subset would be re-derived every time the filter changed, and rows arriving back into view
 * would have no position. The ranking is global; `marginSortRows` projects it onto whatever is
 * on screen.
 *
 * `marginOf` is supplied by the caller because the margin is `bcsMarginPercent` composed over a
 * row's live cost/rate drafts, and only the grid holds those. Keeping it a callback is what lets
 * the sort see a cost typed one second ago without this module knowing anything about drafts.
 */
export function buildMarginOrder<T extends MarginViewRowLike>(
  rows: readonly T[],
  marginOf: (row: T) => number | null,
  dir: MarginSortDir,
): number[] {
  const entries: MarginEntry[] = rows.map((r) => ({
    rowIndex: r.row_index,
    margin: marginOf(r),
  }));
  entries.sort((x, y) => compareByMargin(x.margin, y.margin, dir));
  return entries.map((e) => e.rowIndex);
}

/**
 * Apply a held ranking to the CURRENT rows.
 *
 * The row objects are returned BY REFERENCE, unchanged -- `PricingGrid`'s row memo compares
 * several per-row props by identity, so producing copies here would re-render every row on every
 * refetch.
 *
 * ⚠️ EVERY GIVEN ROW COMES BACK. A row the ranking does not name keeps document order at the END,
 * never dropped. The deleted `marginViewRows` DROPPED anything that was not a line item, which
 * was correct for a curated list and would be data loss here: this output IS the grid's row set,
 * so an omitted row is a row that silently disappears from the sheet -- and a sorted sheet is not
 * a place anyone counts rows, so nobody would catch it.
 *
 * ⚠️ `Infinity - Infinity` IS `NaN`, WHICH IS WHY THE COMPARATOR BRANCHES INSTEAD OF SUBTRACTING.
 * Two unranked rows both score `Infinity`; a subtracting comparator returns NaN for that pair,
 * `sort` treats NaN as "leave it", and the result depends on the engine's internal ordering --
 * a sort that is stable on one input and not on another.
 */
export function marginSortRows<T extends MarginViewRowLike>(
  rows: readonly T[],
  order: readonly number[],
): T[] {
  const pos = new Map<number, number>();
  order.forEach((idx, i) => {
    if (!pos.has(idx)) pos.set(idx, i); // a duplicated entry ranks at its FIRST appearance
  });
  return [...rows].sort((a, b) => {
    const pa = pos.get(a.row_index) ?? Number.POSITIVE_INFINITY;
    const pb = pos.get(b.row_index) ?? Number.POSITIVE_INFINITY;
    if (pa === pb) return 0; // both unranked -> stable sort keeps document order
    return pa < pb ? -1 : 1;
  });
}

// ── BCS-S13: the % Margin RANGE filter ───────────────────────────────────────
//
// "Show me every line between -10% and 15%." A row predicate over the margin the screen is
// already showing, so it composes with the other view filters exactly as they compose with each
// other.
//
// ⚠️ IT IS A SNAPSHOT, NOT A LIVE DERIVATION, and that mirrors the SORT deliberately. A row's
// margin moves on every keystroke in a cost box; a live filter would make rows vanish from under
// the cursor mid-edit -- you would type 9, the row would leave the view, and the next keystroke
// would land somewhere else. `marginOrder` took a snapshot for the same reason. The set is
// recomputed when the bounds change, never per render.

/** Parse one bound. Blank / unparseable -> null, meaning "open on this side". */
export function parseMarginBound(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).trim();
  if (t === "" || t === "-" || t === "+") return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/** Is this range active at all? Both bounds open = no filtering (never an empty grid). */
export function marginRangeActive(from: number | null, to: number | null): boolean {
  return from !== null || to !== null;
}

/**
 * The applied range as a PHRASE, for any surface that has to say what is filtering.
 *
 * ⚠️ IT LIVES HERE SO THE WORDINGS CANNOT DRIFT. Two places say this out loud -- the funnel's
 * tooltip and the grid's empty state -- and they are in different files, reached at different
 * moments, describing the same numbers. Two hand-written phrasings would eventually disagree
 * about a range that had only one meaning, and the empty state is exactly where someone reads
 * carefully because the grid just went blank.
 *
 * ⚠️ IT READS AS A CONTINUATION OF "a % Margin ...", never as a standalone sentence, so both
 * callers can embed it without re-shaping the grammar ("Filtering % Margin between 10% and 25%",
 * "No rows with a % Margin of 10% or more").
 *
 * REVERSED BOUNDS ARE NORMALISED, matching `marginInRange` -- someone who filled the second box
 * first is describing the same interval, and the phrase must state the interval that is actually
 * being applied rather than the order it was typed in.
 */
export function describeMarginRange(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  const lo = parseMarginBound(from);
  const hi = parseMarginBound(to);
  if (lo !== null && hi !== null) {
    return `between ${Math.min(lo, hi)}% and ${Math.max(lo, hi)}%`;
  }
  if (lo !== null) return `of ${lo}% or more`;
  if (hi !== null) return `of ${hi}% or less`;
  return "";
}

/**
 * Does one row's margin fall in [from, to]? INCLUSIVE at both ends -- a user typing 0 to 10
 * means to include exactly 0 and exactly 10.
 *
 * ⚠️ A ROW WITH NO MARGIN IS EXCLUDED while the filter is active, and that is the honest
 * reading: it is not "between -10 and 15", it is unknown. Keeping unknowns visible would make a
 * range that matches nothing still show a full grid, which reads as a broken filter.
 *
 * ⚠️ REVERSED BOUNDS ARE ACCEPTED, NOT REFUSED (from 15, to -10 behaves as -10..15). Someone
 * filling the second box first is describing the same interval, and an empty grid would be a
 * worse answer than the obvious one.
 */
export function marginInRange(
  pct: number | null | undefined,
  from: number | null,
  to: number | null,
): boolean {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return false;
  const lo = from !== null && to !== null ? Math.min(from, to) : from;
  const hi = from !== null && to !== null ? Math.max(from, to) : to;
  if (lo !== null && pct < lo) return false;
  if (hi !== null && pct > hi) return false;
  return true;
}

/**
 * The row_index set matching the range -- the snapshot the grid filters on. `marginOf` is the
 * caller's per-row margin (the grid's `computeMargins`), so the filter and the number on screen
 * come from ONE computation.
 *
 * ⚠️ MEMBERSHIP IS DECIDED BY THE MARGIN ALONE -- there is deliberately no `node_type` test.
 * An earlier cut restricted this to LINE ITEMS, inherited from the flat margin VIEW this filter
 * replaced, where line-items-only was a presentational choice about what belonged on a review
 * list. As a FILTER it is simply wrong: the grid renders % Margin on every row that has one, and
 * a qty-bearing Preamble genuinely does have a cost and a margin (see the priceability gate's
 * Preamble asymmetry) -- so a Preamble displaying 15% would vanish from a 10-25% filter, on
 * screen, next to line items that stayed. A filter whose result contradicts the column it filters
 * is the one thing this must not be.
 *
 * Nothing was lost by dropping it: a spacer, a note or an uncosted preamble has NO margin, and
 * `marginInRange` already excludes an absent one. The node_type test was redundant where it was
 * right and harmful where it was not.
 */
export function marginRangeRowSet<T extends MarginViewRowLike>(
  rows: readonly T[],
  marginOf: (row: T) => number | null,
  from: number | null,
  to: number | null,
): Set<number> {
  const out = new Set<number>();
  for (const r of rows) {
    if (marginInRange(marginOf(r), from, to)) out.add(r.row_index);
  }
  return out;
}
