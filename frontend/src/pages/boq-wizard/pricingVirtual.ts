/**
 * pricingVirtual.ts -- PURE leaf helpers for the V1 virtualized pricing grid (windowed rendering).
 * Mirrors clipboard.ts / undoHistory.ts / rowMerge.ts (type-only imports, no React/DOM). These
 * pin the toggle render-path decision, the height-estimate seeding rule, the spacer math that
 * brackets the mounted window inside a <tbody>, and the top-visible-index used to re-anchor scroll
 * when the owner flips the A/B toggle. The virtualizer itself (@tanstack/react-virtual) owns the
 * actual window computation; these helpers are the small deterministic pieces around it, unit-tested
 * in pricingVirtual.test.ts.
 */
import type { PricedRow } from "./boqTypes";

export type RenderPath = "empty" | "twoPane" | "single";

/** The default per-row height estimate (px) used to seed the virtualizer before a row is measured.
 * Deliberately a modest single-line-ish value: too-small over-estimates the window (harmless), and
 * measureElement corrects it on mount. */
export const DEFAULT_ROW_ESTIMATE_PX = 34;

/** Overscan (rows rendered beyond the viewport each side). Owner starting point = 12. */
export const ROW_OVERSCAN = 12;

/**
 * The grid's render-path decision.
 * - rowCount 0 -> "empty" (both modes render the same empty state).
 * - VIRTUALIZED: the two-pane split is gated on `frozen` -- the freeze-measure-all pass is SKIPPED
 *   on the virtualized path, so `split` (which requires every row measured) would never commit.
 * - CLASSIC: gated on `split` (frozen AND every current row measured) exactly as today.
 */
export function selectRenderPath(args: {
  rowCount: number;
  virtualized: boolean;
  frozen: boolean;
  split: boolean;
}): RenderPath {
  if (args.rowCount <= 0) return "empty";
  const twoPane = args.virtualized ? args.frozen : args.split;
  return twoPane ? "twoPane" : "single";
}

/**
 * The row-height estimate seed: the row's APPLIED height (manual-drag-wins-else-freeze-measured)
 * when known and positive, else the default. A 0 / undefined / negative applied height is NOT a
 * valid measured height, so it falls back. (The virtualizer refines this via measureElement on mount.)
 */
export function seedEstimate(applied: number | undefined | null, fallback: number): number {
  return typeof applied === "number" && applied > 0 ? applied : fallback;
}

/**
 * The spacer heights that bracket the mounted window inside a <tbody>: a top spacer of the first
 * item's start offset and a bottom spacer of (totalSize - last item's end). An EMPTY window -> 0/0
 * (nothing mounted, no spacers). Both clamped to >= 0 (defensive against transient measurement drift).
 */
export function deriveSpacers(
  items: readonly { start: number; end: number }[],
  totalSize: number,
): { paddingTop: number; paddingBottom: number } {
  if (items.length === 0) return { paddingTop: 0, paddingBottom: 0 };
  const paddingTop = Math.max(0, items[0].start);
  const paddingBottom = Math.max(0, totalSize - items[items.length - 1].end);
  return { paddingTop, paddingBottom };
}

/**
 * The first (top) mounted row index -- captured BEFORE an A/B toggle flip so the other mode can
 * re-anchor to the same top visible row (scrollToIndex). null when nothing is mounted.
 */
export function topVisibleIndex(items: readonly { index: number }[]): number | null {
  return items.length ? items[0].index : null;
}

/**
 * Clamp a captured index into the current row set (defensive: the row set can shrink between capture
 * and re-anchor -- e.g. a collapse happened during the flip). Returns null for an empty set.
 */
export function clampIndex(index: number | null, rowCount: number): number | null {
  if (index == null || rowCount <= 0) return null;
  return Math.min(Math.max(0, index), rowCount - 1);
}

/** The column count for a pane's spacer <td> colSpan (so the spacer spans the whole pane cleanly). */
export function paneColSpan(
  pane: "frozen" | "scrolling" | undefined,
  anchorCount: number,
  descriptorCount: number,
): number {
  // scrolling pane = Category (1) + descriptors + Remarks (1); frozen pane = the anchors; single
  // table = anchors + Category + descriptors + Remarks.
  if (pane === "frozen") return anchorCount;
  if (pane === "scrolling") return 1 + descriptorCount + 1;
  return anchorCount + 1 + descriptorCount + 1;
}

export type { PricedRow };
