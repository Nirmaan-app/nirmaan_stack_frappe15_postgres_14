/**
 * collapse.ts -- the PURE hierarchy collapse/expand leaf for the pricing editor grid
 * (Phase 5 "collapse/expand" slice).
 *
 * The pricing grid is a FLAT row list; the parent->child edge is `effective_parent_index`
 * (a row_index; -1 / null = root). The grid had only a PARENT-direction resolver
 * (`parentExcelRowOf`) -- there was NO inverse children/descendant map in the grid (the
 * inverse `childrenByParent`/`hasChildrenSet` exists ONLY in ReviewTree, not shared). This
 * module builds the inverse map + the visibility/descendant logic the collapse feature needs.
 *
 * VISIBILITY SEMANTICS mirror ReviewTree.isVisible EXACTLY (the proven-correct model):
 *   - `isHiddenByCollapse` walks the parent chain starting from `row.effective_parent_index`
 *     (the PARENT, NOT the row itself), 60-hop cap, breaking on `cur < 0` (root sentinel) and
 *     `cur === row.row_index` (self-cycle guard). A row is hidden iff ANY ancestor is collapsed.
 *   - A collapsed parent stays VISIBLE; only its DESCENDANTS hide.
 *   - The loop does NOT start at `collapsed.has(row.row_index)` -- doing so reintroduces the
 *     "parent disappears" bug. This is an explicit known trap.
 *
 * PURE -- no React/DOM/Frappe. Operates on a minimal structural row shape so it is unit-tested
 * in collapse.test.ts without rendering. The grid passes the FULL (unfiltered) rows so the
 * computation is independent of the view filters, then composes with them page-side.
 */

/** The minimal row shape collapse logic needs (a structural subset of PricedRow). */
export interface CollapseRow {
  row_index: number;
  /** Parent's row_index; null OR a negative sentinel (-1) means root. */
  effective_parent_index: number | null;
}

/** Hop cap mirroring ReviewTree.isVisible (defends against a corrupt/cyclic parent chain). */
const HOP_CAP = 60;

/** True iff `p` denotes "no parent" (root): null/undefined or the -1 sentinel. */
function isRoot(p: number | null | undefined): boolean {
  return p === null || p === undefined || p < 0;
}

/**
 * Build the inverse map: parent row_index -> its DIRECT child row_index[] (document order).
 * Root rows (no parent) contribute nothing. This is the map the grid lacked.
 */
export function buildChildrenByParent(rows: CollapseRow[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const r of rows) {
    const p = r.effective_parent_index;
    if (isRoot(p)) continue;
    const arr = m.get(p as number);
    if (arr) arr.push(r.row_index);
    else m.set(p as number, [r.row_index]);
  }
  return m;
}

/** True iff this row has at least one direct child (i.e. it is a collapsible parent). */
export function rowHasDescendants(
  childrenByParent: Map<number, number[]>,
  rowIndex: number,
): boolean {
  const c = childrenByParent.get(rowIndex);
  return !!c && c.length > 0;
}

/**
 * The WHOLE-SUBTREE descendant count for a parent (children, grandchildren, ...). DERIVED live
 * from the structure -- never stored -- so the "+N hidden" badge is always correct (it updates
 * by construction when search/jump auto-expands a parent). Cycle-guarded (a visited set). 0 for
 * a leaf / unknown row.
 */
export function descendantCount(
  rowIndex: number,
  childrenByParent: Map<number, number[]>,
): number {
  let count = 0;
  const seen = new Set<number>([rowIndex]);
  const stack: number[] = [...(childrenByParent.get(rowIndex) ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    if (seen.has(cur)) continue;
    seen.add(cur);
    count += 1;
    const kids = childrenByParent.get(cur);
    if (kids) for (const k of kids) if (!seen.has(k)) stack.push(k);
  }
  return count;
}

/**
 * True iff `row` is hidden because an ANCESTOR is collapsed (the isVisible mirror). Walks the
 * parent chain from `row.effective_parent_index` (the PARENT) up to the root; 60-hop cap; breaks
 * on root sentinel and self-cycle. A collapsed parent itself is NOT hidden by this (the loop
 * starts at the parent, never at the row). `byRowIndex` maps row_index -> row over the FULL rows.
 */
export function isHiddenByCollapse(
  row: CollapseRow,
  collapsed: Set<number>,
  byRowIndex: Map<number, CollapseRow>,
): boolean {
  if (collapsed.size === 0) return false;
  let cur = row.effective_parent_index;
  let hops = 0;
  while (!isRoot(cur) && hops < HOP_CAP) {
    if (cur === row.row_index) break; // self-cycle guard
    if (collapsed.has(cur as number)) return true;
    const parent = byRowIndex.get(cur as number);
    if (!parent) break;
    cur = parent.effective_parent_index;
    hops += 1;
  }
  return false;
}

/**
 * The ancestors of `row` that are CURRENTLY collapsed (for reveal-then-scroll). Same chain walk
 * as `isHiddenByCollapse`; returns the collapsed ancestor row_indices (shallow-to-... order is
 * the walk order, child->root) so the caller can expand them. Empty when nothing on the chain is
 * collapsed (the jump is a plain scroll then).
 */
export function collapsedAncestors(
  row: CollapseRow,
  collapsed: Set<number>,
  byRowIndex: Map<number, CollapseRow>,
): number[] {
  const out: number[] = [];
  if (collapsed.size === 0) return out;
  let cur = row.effective_parent_index;
  let hops = 0;
  while (!isRoot(cur) && hops < HOP_CAP) {
    if (cur === row.row_index) break; // self-cycle guard
    if (collapsed.has(cur as number)) out.push(cur as number);
    const parent = byRowIndex.get(cur as number);
    if (!parent) break;
    cur = parent.effective_parent_index;
    hops += 1;
  }
  return out;
}
