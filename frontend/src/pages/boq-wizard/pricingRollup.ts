/**
 * pricingRollup -- pure parent-tree amount-rollup helper for the pricing-editor
 * Summary panel (BoQ Phase 5).
 *
 * Excel-pivot-style rollup over the committed rows already on the pricing page:
 *   ROWS    = nodes in the parent tree (built by inverting effective_parent_index --
 *             the SAME field reviewRender.computeDepths walks).
 *   COLUMNS = each AMOUNT-bearing column descriptor the sheet carries -- the panel
 *             imposes NO shape of its own; it mirrors whatever amount descriptors the
 *             sheet has (single combined / per-area / supply-install-total split /
 *             asymmetric per-area / any combination).
 *   VALUES  = per-row amount summed over the node's descendants (self + transitive
 *             children), column-by-column. NO merging of per-area and scalar surfaces,
 *             NO derived totals -- each amount descriptor rolls up independently.
 *
 * The summing rule (locked):
 *   - Per-row amount = computeAmount(qty, pairedRate) using the EXISTING PricingGrid
 *     helpers (computeAmount / findPairedRateDescriptor) + the qty source (per-area
 *     qty_by_area[area]; scalar qty_total). The pairing is REUSED, never reinvented.
 *   - A row contributes its OWN amount selected by AMOUNT-PRESENCE: if its paired rate
 *     yields a number, that amount counts; a missing pairing / missing rate (an
 *     un-priced or non-priceable row -- note/spacer/unpriced preamble) yields null ->
 *     contributes nothing. (node_type is NOT on the delivered committed row, so the
 *     priceability gate is expressed as amount-presence, not a type check.)
 *   - A priced PREAMBLE carries an amount for ITS OWN ROW ONLY -- never a sum of its
 *     children. node.totals = node's own amount + the rolled totals of its children, so
 *     a preamble's own amount is added exactly once (no double-count). (design v1.3 Sec.6
 *     priceability; node shape Option A.)
 *
 * Cycle safety: a malformed effective_parent_index cycle must not hang. computeDepths
 * (reused) has its own memo+cycle guard; the rolled-total recursion uses an in-progress
 * guard and the tree build uses a DFS path-set guard, so the helper always terminates.
 *
 * PURE -- no React, no I/O, no backend call; computed entirely from data already fetched
 * for the grid (rows + columnDescriptors from get_priced_rows). Unit-tested in
 * pricingRollup.test.ts.
 */
import { computeAmount, findPairedRateDescriptor, isAmountDescriptor } from "./PricingGrid";
import { computeDepths, resolveDescriptorValue } from "./reviewRender";
import { ROLE_LABELS } from "./boqTypes";
import type { ColumnDescriptor, PricedRow } from "./boqTypes";

/** One amount column in the rollup -- mirrors one amount-bearing descriptor on the sheet. */
export interface RollupColumn {
  /** The amount descriptor's Excel column letter -- the stable per-column key. */
  col: string;
  /** Display label, mirroring the grid header (`${col} — ${role}${ · area}`). */
  label: string;
  /** The source amount descriptor. */
  descriptor: ColumnDescriptor;
}

/** One node in the rollup tree (one committed row + its rolled totals + children). */
export interface RollupNode {
  rowIndex: number;
  sourceRowNumber: number | null;
  description: string | null;
  /** effective_classification (taxonomy) -- display only; selection is amount-presence. */
  classification: string | null;
  /** Effective depth (from computeDepths) -- the indent / aggregation level. */
  depth: number;
  /** This row's OWN amount per column key (null = no amount on this row for that column). */
  ownAmounts: Record<string, number | null>;
  /** Rolled total per column key = this row's own + every descendant's own. */
  totals: Record<string, number>;
  /** Whether this node has at least one child (an expandable parent). */
  isParent: boolean;
  children: RollupNode[];
}

/** The full rollup: the mirrored amount columns + the forest of roots. */
export interface RollupResult {
  columns: RollupColumn[];
  roots: RollupNode[];
}

/** Mirror the grid header label for an amount descriptor. */
function columnLabel(d: ColumnDescriptor): string {
  return `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}${d.area ? ` · ${d.area}` : ""}`;
}

/**
 * One row's OWN amount for one amount descriptor, computed FROM SOURCE (qty x paired
 * rate). Returns null when the amount column has no paired rate descriptor on this sheet,
 * or the row carries no rate/qty -> the row contributes nothing for that column.
 *
 * Per-area amount descriptors carry value_key (the area); scalar amount descriptors have
 * value_key === null. qty source mirrors PricingGrid: qty_by_area[area] / qty_total.
 */
function rowOwnAmount(
  row: PricedRow,
  amountD: ColumnDescriptor,
  descriptors: ColumnDescriptor[],
): number | null {
  const rateD = findPairedRateDescriptor(amountD, descriptors);
  if (!rateD) return null; // no paired rate column on this sheet -> not recomputable
  const area = amountD.value_key; // non-null => per-area; null => scalar
  const qty =
    area !== null && area !== undefined
      ? (row.qty_by_area?.[area] ?? null)
      : (row.qty_total ?? null);
  const rateVal = resolveDescriptorValue(row, rateD);
  const rate = typeof rateVal === "number" ? rateVal : null;
  return computeAmount(qty, rate);
}

/**
 * Build the parent-tree amount rollup. Pure. Cycle-safe.
 *
 * @param rows committed rows (PricedRow[]) already fetched for the grid.
 * @param columnDescriptors the sheet's descriptors (Excel order) from get_priced_rows.
 * @returns { columns, roots } -- the mirrored amount columns + the rolled forest.
 */
export function rollupByParent(
  rows: PricedRow[],
  columnDescriptors: ColumnDescriptor[],
): RollupResult {
  const amountDescs = columnDescriptors.filter(isAmountDescriptor);
  const columns: RollupColumn[] = amountDescs.map((d) => ({
    col: d.col,
    label: columnLabel(d),
    descriptor: d,
  }));

  // Depth (reused -- single source of truth with the grid + its own cycle guard).
  const depths = computeDepths(rows);
  const byIdx = new Map<number, PricedRow>(rows.map((r) => [r.row_index, r]));

  // Invert effective_parent_index into a children map + the root set. A row is a ROOT
  // when its parent is null / negative / self / not present (mirrors the grid's
  // `pIdx >= 0 && byIdx.has(pIdx)` parent test) -- so no row is silently dropped.
  const childrenOf = new Map<number, number[]>();
  const rootIdxs: number[] = [];
  for (const r of rows) {
    const p = r.effective_parent_index;
    const isRoot =
      p === null || p === undefined || p < 0 || p === r.row_index || !byIdx.has(p);
    if (isRoot) {
      rootIdxs.push(r.row_index);
    } else {
      const arr = childrenOf.get(p as number);
      if (arr) arr.push(r.row_index);
      else childrenOf.set(p as number, [r.row_index]);
    }
  }

  // Each row's own amount per column (computed once).
  const ownByIdx = new Map<number, Record<string, number | null>>();
  for (const r of rows) {
    const m: Record<string, number | null> = {};
    for (const d of amountDescs) m[d.col] = rowOwnAmount(r, d, columnDescriptors);
    ownByIdx.set(r.row_index, m);
  }

  // Rolled total per node = own + sum of children's rolled totals (null own -> 0).
  // Memoized; an in-progress guard breaks any (unreachable-but-defensive) cycle.
  const totalsMemo = new Map<number, Record<string, number>>();
  const inProgress = new Set<number>();
  const rolled = (idx: number): Record<string, number> => {
    const cached = totalsMemo.get(idx);
    if (cached) return cached;
    const own = ownByIdx.get(idx) ?? {};
    const m: Record<string, number> = {};
    for (const d of amountDescs) m[d.col] = own[d.col] ?? 0;
    if (inProgress.has(idx)) return m; // cycle re-entry -> own-only, do not recurse
    inProgress.add(idx);
    for (const c of childrenOf.get(idx) ?? []) {
      const cr = rolled(c);
      for (const d of amountDescs) m[d.col] += cr[d.col];
    }
    inProgress.delete(idx);
    totalsMemo.set(idx, m);
    return m;
  };

  // Build the node tree from roots. A DFS path-set guard guarantees termination even if
  // a cycle were somehow reachable (a child already on the current path is skipped).
  const build = (idx: number, path: Set<number>): RollupNode => {
    path.add(idx);
    const r = byIdx.get(idx);
    const childIdxs = (childrenOf.get(idx) ?? []).filter((c) => !path.has(c));
    const children = childIdxs.map((c) => build(c, path));
    path.delete(idx);
    return {
      rowIndex: idx,
      sourceRowNumber: r?.source_row_number ?? null,
      description: r?.description ?? null,
      classification: r?.effective_classification ?? null,
      depth: depths.get(idx) ?? 0,
      ownAmounts: ownByIdx.get(idx) ?? {},
      totals: rolled(idx),
      isParent: (childrenOf.get(idx)?.length ?? 0) > 0,
      children,
    };
  };

  const roots = rootIdxs.map((idx) => build(idx, new Set<number>()));
  return { columns, roots };
}
