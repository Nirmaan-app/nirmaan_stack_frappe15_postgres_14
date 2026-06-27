/**
 * rowMerge.ts -- PURE leaf for the autosave-lag fix #1(c) (BoQ Phase 5 perf). Mirrors
 * clipboard.ts / undoHistory.ts (type-only imports).
 *
 * THE PROBLEM: every rate save does an inline `await mutate()` full-sheet refetch; the fresh
 * `rows` array gives EVERY row a new object reference, defeating the grid's row memo
 * (`prev.row === next.row`) -> all ~200 rows re-render on every keystroke-commit.
 *
 * THE FIX: after the refetch, REUSE the prior row OBJECT for any row the save provably did not
 * change, so the memo holds and only the edited row re-renders. The merge returns a NEW array
 * (the cheap O(rows) page maps recompute -- fine) but reuses unchanged row OBJECTS.
 *
 * CORRECTNESS RESTS ON (verified STEP 0, pricing.py): the backend is CAPTURE-ONLY -- a save writes
 * ONLY the edited cell's pricing record; `get_priced_rows._merge_overlays` overlays onto the
 * IMMUTABLE committed base ONLY these per-row fields: rate_by_area / priced_by_area, the scalar
 * rate_supply|install|combined + priced_rate_*, remark, and color_by_cell. Parent rollups are
 * CLIENT-derived (SummaryPanel/buildChildrenByParent from the full rows), never folded per-row.
 * So the committed base cannot change within a (boq, sheet, version), and equality on the OVERLAY
 * fields => the row's displayed content is identical -> safe to reuse the prior object.
 *
 * THE FIELD-COMPARE IS A FALLBACK GUARD: even if a save changed a field this list missed, the row
 * would FAIL the compare and correctly re-render. KEEP THIS LIST IN SYNC WITH pricing.py
 * `_merge_overlays` (STEP 0).
 */
import type { PricedRow } from "./boqTypes";

// The scalar rate value_fields (+ their priced_<field> markers) the overlay can stamp. Mirrors
// PricingGrid.SCALAR_RATE_FIELDS / pricing.py _SCALAR_RATE_FIELDS.
const SCALAR_RATE_FIELDS = ["rate_supply", "rate_install", "rate_combined"] as const;

/** Structural equality for the small nested overlay maps (rate_by_area / priced_by_area /
 *  color_by_cell). The backend builds them in a deterministic descriptor order, so a JSON compare
 *  is stable; absent (undefined) on both sides is equal. Pure. */
function structEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false; // one present, one absent -> changed
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * True iff two rows have IDENTICAL overlay-mutable content (rate fields + priced markers + remark +
 * color). The committed base is immutable within a version (STEP 0), so this is sufficient for "the
 * displayed row did not change". Pure -- unit-tested. If this returns true the caller may reuse the
 * prior object; if false, the row genuinely changed and must re-render.
 */
export function rowOverlayEqual(a: PricedRow, b: PricedRow): boolean {
  const ar = a as unknown as Record<string, unknown>;
  const br = b as unknown as Record<string, unknown>;
  if (!structEq(ar.rate_by_area, br.rate_by_area)) return false;
  if (!structEq(ar.priced_by_area, br.priced_by_area)) return false;
  for (const f of SCALAR_RATE_FIELDS) {
    if (ar[f] !== br[f]) return false; // scalar rate (number) -- absent vs absent === true
    if (ar["priced_" + f] !== br["priced_" + f]) return false; // scalar priced marker (bool)
  }
  if (ar.remark !== br.remark) return false; // remark save path also refetches
  if (!structEq(ar.color_by_cell, br.color_by_cell)) return false; // color save path also refetches
  return true;
}

/**
 * Merge a refetched `next` against the prior `prev`, REUSING the prior row OBJECT for any row whose
 * row_index matches AND whose overlay content is unchanged (rowOverlayEqual). row_index is the
 * STABLE per-row identity (the same key the grid/draft layer uses -- NOT array position). A new
 * row_index -> the new object; a removed row_index -> absent (just not in `next`). Returns a NEW
 * array unless nothing could be reused (then `next` as-is). Pure -- unit-tested; the SAME-reference
 * return for an unchanged row is the load-bearing property (it is what holds the grid memo).
 */
export function mergeRowsPreservingIdentity(prev: PricedRow[], next: PricedRow[]): PricedRow[] {
  if (prev.length === 0 || next.length === 0) return next;
  const prevByIdx = new Map<number, PricedRow>();
  for (const p of prev) prevByIdx.set(p.row_index, p);
  let anyReused = false;
  const merged = next.map((n) => {
    const p = prevByIdx.get(n.row_index);
    if (p && rowOverlayEqual(p, n)) {
      anyReused = true;
      return p; // SAME reference -> the grid memo holds for this row
    }
    return n;
  });
  return anyReused ? merged : next;
}
