/**
 * marginView.ts -- the margin view's row set, its order, and the section context a flattened row
 * loses (slice BCS-S4).
 *
 * WHAT THE VIEW IS. A separate FLAT, line-items-only presentation of a committed sheet, ordered by
 * % Margin, with an ascending/descending toggle, each row showing its section as context.
 *
 * WHY FLAT RATHER THAN SORTING THE GRID (owner ruling 2026-08-02). The grid is an N-deep hierarchy
 * with collapse/expand. Re-ordering it by margin keeps the tree's affordances over a set that is no
 * longer a tree: collapsing a section would hide rows from scattered places on screen, and the
 * indentation would imply nesting under a parent that is nowhere near. The owner chose a distinct
 * view over an incoherent tree, so this module produces a LIST, and the grid renders it with the
 * tree affordances suppressed.
 *
 * ⚠️ SORT TIMING IS LOAD-BEARING, AND THAT IS WHY THE ORDER IS A SNAPSHOT. The two functions here
 * are deliberately split: `buildMarginOrder` decides the order ONCE (on open, and on a header
 * click) and the caller holds the result in state; `marginViewRows` applies that held order to
 * whatever rows are current. Nothing re-sorts while someone is typing.
 *
 * That is not tidiness. Inside `PricingGrid` the cursor (`activeCell`) is ARRAY-INDEX addressed --
 * `{rowIndex, colIndex}` where rowIndex indexes the `rows` prop -- so a re-order performed while a
 * cell is focused slides a DIFFERENT row under the cursor mid-keystroke, and the next character
 * lands on it. Clipboard multi-row selection is a contiguous array RANGE over the same indices and
 * carries the same exposure across a paste. Splitting "decide the order" from "apply the order" is
 * what makes the values live while the positions stay still.
 *
 * ⚠️ BLANKS SORT LAST IN BOTH DIRECTIONS -- see `compareByMargin`. This is the part the obvious
 * implementation gets wrong.
 *
 * PURE LEAF. Type-only structural inputs, no React, no imports from the grid -- the same discipline
 * `reconcile.ts` keeps, and for the same reason: `PricingGrid` consumes this module, so anything
 * this module imported back from the grid would be a cycle. The MARGIN NUMBER itself is NOT
 * computed here; it is `bcsColumns.bcsMarginPercent` composed over a row's live drafts, which only
 * the grid holds. The caller passes it in.
 */

/** Ascending = worst margin first (the review order); descending = best first. */
export type MarginSortDir = "asc" | "desc";

/** Flip the sort direction. The header click and the ribbon control share this one rule. */
export function flipMarginSortDir(dir: MarginSortDir): MarginSortDir {
  return dir === "asc" ? "desc" : "asc";
}

/**
 * The structural shape this module reads off a `PricedRow`. Declared here rather than imported so
 * the module stays a pure leaf; `PricedRow` satisfies it, and the exported functions are generic
 * over `T extends MarginViewRowLike` so a caller gets its OWN row type back, not this one.
 */
export interface MarginViewRowLike {
  row_index: number;
  effective_parent_index: number | null;
  description: string | null;
  /** "Preamble" | "Line Item" | "Other" | null on a real PricedRow. */
  node_type?: string | null;
}

/** One row's sort key: its row_index and the % Margin it showed when the snapshot was taken. */
export interface MarginEntry {
  rowIndex: number;
  /** The row's % Margin, or null when it has none (uncosted, no quantity, no amount, ...). */
  margin: number | null;
}

/**
 * LINE ITEMS ONLY.
 *
 * A Preamble can be qty-bearing and therefore costable, so it is not excluded for being
 * unpriceable -- it is excluded for being a HEADING. In a flat list ordered by margin a heading
 * would sit among the lines it introduces, next to rows from a different section entirely, and
 * mean nothing there. "Other" rows (spacers, notes, subtotals) have no margin to sort by at all.
 *
 * TRIMS `node_type`, exactly as `PricingGrid.isPriceableType` does, so the client's membership test
 * and the server's stripped comparison cannot disagree.
 */
export function isMarginViewRow(row: MarginViewRowLike): boolean {
  return (row.node_type ?? "").trim() === "Line Item";
}

/**
 * ★ THE COMPARATOR. BLANKS LAST IN BOTH DIRECTIONS.
 *
 * ⚠️ THE BLANK TEST SITS OUTSIDE THE DIRECTION FLIP, AND THAT IS THE WHOLE POINT. The idiom this
 * repo already uses elsewhere -- substitute a low sentinel for a missing value (`InventoryReport`
 * uses `?? -2` beneath its `-1` "unknown") and let the comparator do the rest -- gives you
 * blanks-last for free in ONE direction and blanks-FIRST in the other. Descending is the direction
 * that breaks, and it is the worse one to break: most rows on a real sheet have no margin until
 * someone costs them, so a descending view whose blanks float to the top opens on a screenful of
 * nothing, exactly where the best margins are supposed to be.
 *
 * There is no sentinel value that fixes this, because "sorts below every number" and "sorts above
 * every number" are contradictory requirements for one substitute. The absence has to be handled
 * as an absence.
 *
 * A 0% margin and a NEGATIVE margin are REAL VALUES, never blanks: "this row makes nothing" and
 * "this row loses money" are the findings the view exists to surface, and folding either in with
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
 * Decide the view's order ONCE: the row_index sequence, line items only, sorted by margin.
 *
 * Called on OPEN and on a HEADER CLICK, never on a render or a keystroke -- the caller holds the
 * returned array in state. See the module header for why that split is load-bearing.
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
  const entries: MarginEntry[] = [];
  for (const r of rows) {
    if (isMarginViewRow(r)) entries.push({ rowIndex: r.row_index, margin: marginOf(r) });
  }
  entries.sort((x, y) => compareByMargin(x.margin, y.margin, dir));
  return entries.map((e) => e.rowIndex);
}

/**
 * Apply a held order to the CURRENT rows.
 *
 * The row objects are returned BY REFERENCE, unchanged -- `PricingGrid`'s row memo compares several
 * per-row props by identity, so producing copies here would re-render every row on every refetch.
 *
 * ⚠️ A LINE ITEM ABSENT FROM THE SNAPSHOT IS APPENDED, IN DOCUMENT ORDER, NEVER DROPPED. A refetch
 * can introduce a row the snapshot predates. Omitting it would render a row that exists as absent,
 * which is the same class of falsehood as the empty-cost-block defect this slice's other half
 * closes -- and here it would be invisible, because a margin view is not a place anyone counts
 * rows. Its position is honest: unsorted, at the end, until the next explicit sort.
 *
 * Stale entries (a row_index that is gone, or that is no longer a line item) are dropped, and a
 * duplicated entry renders once.
 */
export function marginViewRows<T extends MarginViewRowLike>(
  rows: readonly T[],
  order: readonly number[],
): T[] {
  const byIndex = new Map<number, T>();
  for (const r of rows) if (isMarginViewRow(r)) byIndex.set(r.row_index, r);

  const out: T[] = [];
  const placed = new Set<number>();
  for (const idx of order) {
    if (placed.has(idx)) continue;
    const r = byIndex.get(idx);
    if (!r) continue;
    placed.add(idx);
    out.push(r);
  }
  // Anything the snapshot did not name, in document order.
  for (const r of rows) {
    if (isMarginViewRow(r) && !placed.has(r.row_index)) out.push(r);
  }
  return out;
}

/**
 * The section each row belongs to -- the context flattening destroys.
 *
 * THE LABEL IS THE NEAREST ANCESTOR WITH A DESCRIPTION, walking `effective_parent_index` (the
 * EFFECTIVE chain, the same one `computeDepths` walks and the same one human re-parenting writes;
 * the stored `level` diverges after an edit and must never be used for hierarchy).
 *
 * NEAREST rather than root is a decision, not an accident: in a BoQ the immediate preamble is what
 * identifies a line ("1.1 kV XLPE cabling"), while the root is usually the whole discipline and
 * would be the same string on every row in the view -- context that distinguishes nothing. If the
 * owner would rather see the top-level section, the change is the direction of the walk and
 * nothing else.
 *
 * An ancestor whose description is blank or whitespace is SKIPPED rather than shown as an empty
 * section. A row with no described ancestor gets no entry -- absent, so the caller renders nothing,
 * rather than a placeholder that reads like a real section name.
 *
 * Cycle-guarded. A cycle cannot come from the parser, but `human_parent` writes this chain and an
 * unguarded walk would freeze the tab -- the same hazard `computeDepths` guards against.
 */
export function buildSectionLabels(rows: readonly MarginViewRowLike[]): Map<number, string> {
  const byIndex = new Map<number, MarginViewRowLike>();
  for (const r of rows) byIndex.set(r.row_index, r);

  const labels = new Map<number, string>();
  for (const r of rows) {
    const seen = new Set<number>([r.row_index]);
    let cur = r.effective_parent_index;
    while (cur !== null && cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      const anc = byIndex.get(cur);
      if (!anc) break;
      const text = (anc.description ?? "").trim();
      if (text !== "") {
        labels.set(r.row_index, text);
        break;
      }
      cur = anc.effective_parent_index;
    }
  }
  return labels;
}
