// Unit tests for collapse.ts -- the PURE hierarchy collapse/expand leaf (pricing grid).
import { describe, it, expect } from "vitest";
import {
  buildChildrenByParent,
  rowHasDescendants,
  descendantCount,
  isHiddenByCollapse,
  collapsedAncestors,
  type CollapseRow,
} from "./collapse";

// Helper: a row with row_index `i` whose parent is `p` (null/-1 = root).
const r = (i: number, p: number | null): CollapseRow => ({ row_index: i, effective_parent_index: p });

// A small tree:
//   0 (root) -> 1, 2
//     1 -> 3
//       3 -> 4
//   5 (root, leaf)
// Depth: 0 has children {1,2}; 1 has {3}; 3 has {4}; 2,4,5 are leaves.
const tree: CollapseRow[] = [r(0, null), r(1, 0), r(2, 0), r(3, 1), r(4, 3), r(5, -1)];
const byIdx = new Map(tree.map((x) => [x.row_index, x]));

describe("buildChildrenByParent", () => {
  it("builds the inverse map; root rows (null/-1) contribute no edge", () => {
    const m = buildChildrenByParent(tree);
    expect(m.get(0)).toEqual([1, 2]);
    expect(m.get(1)).toEqual([3]);
    expect(m.get(3)).toEqual([4]);
    expect(m.has(2)).toBe(false); // leaf
    expect(m.has(4)).toBe(false); // leaf
    expect(m.has(5)).toBe(false); // root leaf (-1 sentinel)
  });

  it("a flat sheet (all roots) yields an EMPTY map -- nothing to collapse", () => {
    const flat = [r(0, null), r(1, null), r(2, -1)];
    expect(buildChildrenByParent(flat).size).toBe(0);
  });
});

describe("rowHasDescendants", () => {
  const m = buildChildrenByParent(tree);
  it("true for parents (incl. a single-child parent), false for leaves", () => {
    expect(rowHasDescendants(m, 0)).toBe(true);
    expect(rowHasDescendants(m, 1)).toBe(true); // single child (3) -- still collapsible
    expect(rowHasDescendants(m, 3)).toBe(true); // single child (4)
    expect(rowHasDescendants(m, 2)).toBe(false);
    expect(rowHasDescendants(m, 4)).toBe(false);
    expect(rowHasDescendants(m, 5)).toBe(false);
    expect(rowHasDescendants(m, 999)).toBe(false); // unknown row
  });
});

describe("descendantCount (whole subtree, derived live)", () => {
  const m = buildChildrenByParent(tree);
  it("counts the ENTIRE subtree (children + grandchildren + ...)", () => {
    expect(descendantCount(0, m)).toBe(4); // 1,2,3,4
    expect(descendantCount(1, m)).toBe(2); // 3,4 (grandchild included -- R1 whole subtree)
    expect(descendantCount(3, m)).toBe(1); // 4 (single child)
    expect(descendantCount(2, m)).toBe(0); // leaf
    expect(descendantCount(5, m)).toBe(0); // root leaf
  });

  it("is cycle-guarded: a 1<->2 parent cycle terminates and does not double-count", () => {
    const cyc = buildChildrenByParent([r(1, 2), r(2, 1)]);
    // From 1: child 2; from 2: child 1 (already seen) -> stop. Count = 1.
    expect(descendantCount(1, cyc)).toBe(1);
    expect(descendantCount(2, cyc)).toBe(1);
  });
});

describe("isHiddenByCollapse (mirrors ReviewTree.isVisible semantics)", () => {
  it("nothing collapsed -> nothing hidden", () => {
    const collapsed = new Set<number>();
    for (const row of tree) expect(isHiddenByCollapse(row, collapsed, byIdx)).toBe(false);
  });

  it("collapsing a parent keeps IT visible and hides its WHOLE subtree", () => {
    const collapsed = new Set<number>([1]); // collapse row 1
    expect(isHiddenByCollapse(r(1, 0), collapsed, byIdx)).toBe(false); // the parent STAYS visible
    expect(isHiddenByCollapse(r(3, 1), collapsed, byIdx)).toBe(true); // direct child hidden
    expect(isHiddenByCollapse(r(4, 3), collapsed, byIdx)).toBe(true); // grandchild hidden (whole subtree)
    expect(isHiddenByCollapse(r(2, 0), collapsed, byIdx)).toBe(false); // a sibling subtree unaffected
    expect(isHiddenByCollapse(r(0, null), collapsed, byIdx)).toBe(false); // ancestor unaffected
  });

  it("collapsing the root hides every descendant but not the root", () => {
    const collapsed = new Set<number>([0]);
    expect(isHiddenByCollapse(r(0, null), collapsed, byIdx)).toBe(false);
    expect(isHiddenByCollapse(r(1, 0), collapsed, byIdx)).toBe(true);
    expect(isHiddenByCollapse(r(4, 3), collapsed, byIdx)).toBe(true);
    expect(isHiddenByCollapse(r(5, -1), collapsed, byIdx)).toBe(false); // a different root subtree
  });

  it("a single-child parent collapses (its lone child hides)", () => {
    const collapsed = new Set<number>([3]);
    expect(isHiddenByCollapse(r(3, 1), collapsed, byIdx)).toBe(false);
    expect(isHiddenByCollapse(r(4, 3), collapsed, byIdx)).toBe(true);
  });

  it("self-cycle guard: a row whose parent is itself is never hidden by its own collapse", () => {
    const self = r(7, 7);
    const m = new Map<number, CollapseRow>([[7, self]]);
    expect(isHiddenByCollapse(self, new Set([7]), m)).toBe(false);
  });

  it("a parent-chain cycle terminates (hop cap / self-guard) without looping forever", () => {
    // 8 -> 9 -> 8 ... ; collapse a node NOT on the chain -> not hidden, and it returns.
    const cyc = [r(8, 9), r(9, 8)];
    const m = new Map(cyc.map((x) => [x.row_index, x]));
    expect(isHiddenByCollapse(r(8, 9), new Set([999]), m)).toBe(false);
  });
});

describe("collapsedAncestors (reveal-then-scroll source)", () => {
  it("returns the collapsed ancestors on the chain (empty when none collapsed)", () => {
    expect(collapsedAncestors(r(4, 3), new Set<number>(), byIdx)).toEqual([]);
    // collapse both 1 and 3 (ancestors of 4): chain 4->3->1->0; collapsed {1,3} -> [3,1] (walk order).
    expect(collapsedAncestors(r(4, 3), new Set([1, 3]), byIdx)).toEqual([3, 1]);
    // collapse only 1 (a 2-as well, but 2 is not an ancestor of 4): only 1 is returned.
    expect(collapsedAncestors(r(4, 3), new Set([1, 2]), byIdx)).toEqual([1]);
  });

  it("a root row has no ancestors -> empty", () => {
    expect(collapsedAncestors(r(0, null), new Set([0]), byIdx)).toEqual([]);
  });
});
