/**
 * PricingGrid -- committed-pricing grid (BoQ Phase 5 Slice 3a read-only -> 3b rate editing
 * -> 3b.2 spreadsheet keyboard nav).
 *
 * Renders the committed rows of one sheet (from get_priced_rows) with their current saved
 * rates + a priced/un-priced marker. Mirrors ReviewTree's descriptor-render loop but REUSES
 * the extracted reviewRender helpers (design v1.3 Sec.4 path b) -- it does NOT import,
 * reuse, or retune the ReviewTree component.
 *
 * Slice 3b -- INLINE RATE EDITING + LIVE AMOUNT (rates only):
 *   - Each RATE cell (isRateDescriptor) renders a numeric <Input>; qty / amount / any
 *     non-rate descriptor stays read-only; classification + structure stay read-only (frozen).
 *   - Save on BLUR or ENTER (no Apply button, no confirm dialog -- the design's Excel feel).
 *     A cell calls up to the page-owned onSaveRate(cell, rate); the page does the
 *     save_cell_price POST + a mutate() refetch (which re-derives the priced_* markers
 *     authoritatively -- no client-side marker logic).
 *   - LIVE AMOUNT (display-only, NEVER persisted -- the pricing layer stores RATES only):
 *     an amount cell paired to a rate column (same area + kind) shows qty x rate, computed
 *     client-side from the optimistically-typed rate (instant) or, when not editing, the
 *     row's SAVED rate IF the cell is priced. An un-priced, not-editing amount cell keeps
 *     its committed value unchanged (no regression from 3a).
 *
 * Slice 3b.2 -- SPREADSHEET KEYBOARD NAVIGATION (design v1.3 Sec.11). The WHOLE grid is a
 * clean rectangular matrix (5 fixed anchors + N descriptor cells per row); a {rowIndex
 * (array index into rows), colIndex} active cell is driven by a roving-tabindex model + a
 * per-cell ref map (the <input> for a rate cell, the <td> for every other cell). Arrows
 * move one cell + STOP at edges (no wrap); Enter commits + moves down; Tab commits + moves
 * right and WRAPS to the next row (Shift-Tab reverse); Tab/Shift-Tab off the grid's last/
 * first cell STOPS (focus contained). Any move COMMITS the active rate cell first (the
 * existing commitRate; the committedAttemptRef dedupe absorbs the trailing onBlur). The
 * active cell shows a focus ring + scrolls into view (scroll-mt clears the sticky header).
 *
 * Slice 3c -- AUTO-SAVE + FORCE-SAVE. A per-cell 1000ms lodash debounce auto-commits a
 * typed-but-uncommitted rate (no blur/Enter/move needed) via the EXISTING commitRate; a
 * gesture commit cancels that cell's pending debounce (no same-cell race), and pending saves
 * flush on unmount (no loss on navigate-away). The grid is a forwardRef component exposing
 * an imperative flush() (the page's "Save now" button) + an onDirtyChange signal (the page's
 * "Unsaved changes" status). Save mechanism unchanged (still commitRate -> onSaveRate ->
 * save_cell_price -> mutate).
 *
 * Still OUT (later slices): subtotal roll-up (sum of children), the single-editor lock
 * (editable/lock_info stay INERT here), remarks + the review-flag layer (4a/4b), Excel
 * write-back (5), finalize/revert (6).
 */
import {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { debounce, type DebouncedFunc } from "lodash";
import { Palette, MessageSquare, AlertTriangle, Flag, Scale, ChevronRight, Check, CornerDownRight, Sparkles, ListChecks, ArrowUpDown, ArrowUpNarrowWide, ArrowDownWideNarrow, Filter, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  GridColumnFilter,
  type ColumnFilterOption,
} from "./GridColumnFilter";
import {
  ClassificationPill,
  ROW_TYPE_LABEL,
  computeDepths,
  renderDescriptorCell,
  resolveDescriptorValue,
  buildDescriptionColumns,
  descriptionCellValue,
  sheetHasDescriptionParts,
} from "./reviewRender";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DescriptionColumn } from "./reviewRender";
import { COLOR_TOKENS, columnChipLabel } from "./boqTypes";
import { descendantCount, rowHasDescendants } from "./collapse";
import {
  DEFAULT_ROW_ESTIMATE_PX,
  ROW_OVERSCAN,
  deriveSpacers,
  maxRowHeight,
  paneColSpan,
  resolveJumpAction,
  seedEstimate,
  selectRenderPath,
  shouldCloseOverlay,
} from "./pricingVirtual";

// V1-FIX: the NATURAL content height of a pane's row -- immune to the row's applied alignment
// height. Because every cell is `align-top`, the cell's content wrapper sits at the top and does
// NOT stretch when the <tr> is padded taller; so reading the tallest child's box height (+ the
// cell's own vertical padding/border) yields the true content height regardless of padding. This is
// what prevents the padded (short) pane from feeding its padding back into the max (no sticky-max).
function paneNaturalHeight(tr: Element | null | undefined): number {
  if (!tr) return 0;
  // V1-FIX-2: measure the <tr>'s TRUE rendered box height (row border INCLUDED) -- the SAME basis
  // classic uses (`ceil(single-table getBoundingClientRect().height)`). Because the box height is
  // `max(true content, applied height)`, this is always >= the pane's content; so `ceil(max(frozen
  // box, scroll box))` applied identically to BOTH panes makes NEITHER pane grow past it -> both pad
  // -> identical heights -> 0 drift at ANY DPR (classic's proven behaviour). It is SELF-CORRECTING
  // (content wins when content > applied) with a FIXPOINT (once applied = ceil(max) >= content, the
  // box = applied = the measure -> stable) -> NO runaway. This deliberately REPLACES the V1-FIX
  // content-wrapper sum, which omitted this row border (~1px short) and drove the per-row drift, and
  // it does NOT read the inner content wrapper (which stretches and caused the earlier runaway). The
  // sticky-on-in-place-shrink this introduces is cleared by rowVirtualizer.measure() on a column
  // resize (endResize / autofitColumn), matching classic's rowHeights reset.
  return Math.ceil((tr as HTMLElement).getBoundingClientRect().height);
}
import { AmountFormulaBuilder } from "./AmountFormulaBuilder";
import { MarginFormulaBuilder } from "./MarginFormulaBuilder";
// BCS-S13: the % Margin range filter's header control. The RULES it filters by live in the pure
// `marginView.ts`; this grid only renders the control and is handed rows already filtered.
import { MarginRangeFilter } from "./MarginRangeFilter";
// BCS-S14: the grid imports only the DIRECTION type. It renders the order and suppresses the tree
// claims a re-ordered row set can no longer support; it never computes an order.
import { describeMarginRange, type MarginSortDir } from "./marginView";
import { bindRef, evaluateAmountColumn, pickFormula, type OperandLookup } from "./amountFormula";
import {
  buildReconChoiceMap,
  reconChoiceKey,
  resolveDivergence,
  type ReconResolution,
} from "./reconcile";
import {
  classifyPasteTarget,
  foldBcsWrites,
  rectDims,
  rowSelectionRange,
  selectionRect,
  shapesMatch,
  type BatchOutcome,
  type BatchWrite,
  type CellKind,
  type ClipboardBlock,
  type ClipCell,
  type SelRect,
} from "./clipboard";
import {
  canRedo,
  canUndo,
  emptyHistory,
  invert,
  popRedo,
  popUndo,
  pushEntry,
  type BcsDelta,
  type HistoryEntry,
  type HistoryState,
  type RateDelta,
} from "./undoHistory";
// BCS-S3a: the cost layer's RULES all live in the pure bcsColumns (which mirrors
// services/boq_bcs/sources.py + api/boq/wizard/bcs.py). The grid renders them and owns no BCS
// rule of its own -- there is no second copy of the gather, the gate order, or the arithmetic.
import {
  BCS_MARGIN_COL_KEY,
  BCS_RATE_FIELD,
  BCS_RATE_FIELDS,
  BCS_RATE_LABEL,
  BCS_QTY_OPERAND_FIELD,
  BCS_TOTAL_COL_KEY,
  BCS_TOTAL_TARGET,
  bcsBlankReasonText,
  bcsColumnAt,
  bcsColumnKeys,
  bcsOperandLabel,
  pickBcsTotalFormula,
  pickBoqTotalFormula,
  pickMarginCostFormula,
  marginCostCell,
  marginCostOperandRefs,
  marginCostOperandLabel,
  defaultMarginCostFormula,
  MARGIN_COST_TARGET,
  defaultBoqTotalFormula,
  BOQ_TOTAL_TARGET,
  bcsOperandRefs,
  defaultBcsTotalFormula,
  bcsMarginPercent,
  boqTotalAmount,
  bcsRowQuantity,
  bcsTenderedAmountCell,
  bcsTotalCell,
  bcsUnitCost,
  bcsWidthKey,
  formatBcsMargin,
  gatherBcsRowRates,
  isBcsInputColumn,
  mergeBcsRowValues,
  type BcsComputedCell,
  type BcsComputedKind,
  type BcsRateKind,
} from "./bcsColumns";
import type {
  AmountFormulaNode,
  AmountFormulaRef,
  AmountFormulaSaveArgs,
  BcsRateField,
  BcsRowRate,
  BcsRowRates,
  BcsRowSaveArgs,
  BcsSource,
  ColorSaveArgs,
  ColumnDescriptor,
  ColumnFormula,
  LockInfo,
  PricedRow,
  RateCellSaveArgs,
  ReconChoice,
  ReconChoiceSaveArgs,
  ReconciliationChoiceRef,
  RemarkSaveArgs,
  RowReviewFlags,
  SheetCategoryRow,
} from "./boqTypes";
import { deriveVerdictState, isRowEditable, labelFor } from "./CategoryVerdictPicker";
import { categoryCellTitle } from "./sheetCategoryResolve";
import { type RowSuggestions, rowSuggestionsEqual } from "./rate-helper/rateHelperTypes";

// Depth indent step -- mirrors ReviewTree.INDENT_PX (kept in sync; the pricing grid does
// not import ReviewTree per design v1.3 Sec.4 path b).
const INDENT_PX = 20;

// Frozen-left Slice 1: the Description cell's vertical padding (py-1.5 = 6px top + 6px bottom).
// When a captured row height is applied, the description's inner wrapper is clipped to
// (rowHeight - this) so the cell box totals the captured height and cannot push the <tr> past
// its matching row in the other pane.
const DESC_CLIP_VPAD_PX = 12;

// The two roles rendered as fixed anchor columns (Sl.No, Description), excluded from the
// descriptor-driven column set. Mirrors ReviewTree.FIXED_ROLE_DEDUPE (kept in sync; the
// pricing grid does not import ReviewTree -- the locked no-ReviewTree-import design call).
const FIXED_ROLE_DEDUPE = new Set(["sl_no", "description"]);

// A rate cell is the ONLY editable cell. A column_descriptor identifies a rate cell by its
// value_field -- mirrors the backend overlay (pricing.py _PER_AREA_RATE_FIELD /
// _SCALAR_RATE_FIELDS). Amount / qty descriptors are never rate cells.
const PER_AREA_RATE_FIELD = "rate_by_area";
const PER_AREA_AMOUNT_FIELD = "amount_by_area";
const SCALAR_RATE_FIELDS = new Set(["rate_supply", "rate_install", "rate_combined"]);
const SCALAR_AMOUNT_FIELDS = new Set(["amount_total", "amount_supply", "amount_install"]);

// Pairing maps: an amount cell's kind/field -> its corresponding rate kind/field
// (amount = qty x rate). Per-area amount_by_area rate_subkey -> rate_by_area rate_subkey;
// scalar amount value_field -> scalar rate value_field.
const PER_AREA_AMOUNT_TO_RATE_KIND: Record<string, string> = {
  total: "combined_rate",
  supply: "supply_rate",
  install: "install_rate",
};
const SCALAR_AMOUNT_TO_RATE_FIELD: Record<string, string> = {
  amount_total: "rate_combined",
  amount_supply: "rate_supply",
  amount_install: "rate_install",
};
// Scalar rate value_field -> the descriptive rate_kind token (consistent with the per-area
// rate_subkey tokens). rate_kind is a guard field, NOT part of the cell identity key.
const SCALAR_RATE_FIELD_TO_KIND: Record<string, string> = {
  rate_supply: "supply_rate",
  rate_install: "install_rate",
  rate_combined: "combined_rate",
};

/** True iff this descriptor addresses a RATE cell (per-area or scalar). Pure. */
export function isRateDescriptor(d: ColumnDescriptor): boolean {
  return d.value_field === PER_AREA_RATE_FIELD || SCALAR_RATE_FIELDS.has(d.value_field);
}

/** True iff this descriptor addresses an AMOUNT cell (per-area or scalar). Pure. */
export function isAmountDescriptor(d: ColumnDescriptor): boolean {
  return d.value_field === PER_AREA_AMOUNT_FIELD || SCALAR_AMOUNT_FIELDS.has(d.value_field);
}

// ── Toolbar Part 1: pure helpers (search / row-type filter / column-hide) ────────
// SDK-free leaf logic so it is unit-tested in PricingToolbar.test.ts without rendering.
// The PAGE owns the controls + state; the grid consumes the derived signals (a per-GRID
// hiddenCols set + a per-row current-hit boolean). NONE of this enters the row memo except
// the single per-row current-hit boolean (added to pricingRowPropsAreEqual).

/**
 * SEARCH MATCHER: case-insensitive substring of the query in a row's description. An empty
 * (or whitespace-only) query matches NOTHING (no filtering/highlight at rest). A null/undefined
 * description never matches and never throws (negative path).
 */
export function searchMatches(description: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return false;
  if (!description) return false;
  return description.toLowerCase().includes(q);
}

/**
 * SEARCH HIT-LIST: the ordered Excel row numbers (source_row_number) of rows whose description
 * matches the query. Built over the ALREADY-RENDERED set (displayRows) so a hit is always a
 * visible, scroll-to-able row. Empty query -> [] (no hits).
 */
export function buildSearchHits(rows: PricedRow[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const out: number[] = [];
  for (const r of rows) {
    if (searchMatches(r.description, q)) out.push(r.source_row_number);
  }
  return out;
}

/** STEPPER: modulo-wrap the hit pointer in either direction (prev at 0 -> last; next at last
 *  -> 0). Returns 0 for an empty hit list. Pure. */
export function stepHit(idx: number, len: number, dir: "prev" | "next"): number {
  if (len <= 0) return 0;
  return dir === "next" ? (idx + 1) % len : (idx - 1 + len) % len;
}

/** CURRENT-HIT (per-row): true iff this row's Excel row IS the current hit. The ONE per-row
 *  search signal -- it is added to pricingRowPropsAreEqual so the highlight repaints on step. */
export function isCurrentHitRow(
  rowExcelRow: number,
  currentHitExcelRow: number | null | undefined,
): boolean {
  return currentHitExcelRow != null && rowExcelRow === currentHitExcelRow;
}

/** JUMP LANDING FLASH (per-row): true iff this row's Excel row is the current jump target.
 *  Mirrors isCurrentHitRow -- a per-row signal added to pricingRowPropsAreEqual so the blue
 *  landing flash paints/un-paints as flashExcelRow flips (set by jumpToRow, cleared after 3s). */
export function isJumpFlashRow(
  rowExcelRow: number,
  flashExcelRow: number | null | undefined,
): boolean {
  return flashExcelRow != null && rowExcelRow === flashExcelRow;
}

// ── Column width model (frozen-left + column-resize bundle) ────────────────────
// The grid switches to `table-fixed` + a `<colgroup>` so column widths are AUTHORITATIVE
// (auto-layout removed). Seeds mirror the pre-bundle Tailwind hints so day-one render is
// near-identical. Width state is GRID-LEVEL (a useState keyed by these stable keys), reset
// per sheet by the page's key={sheetName} remount (session-only, no persistence). The frozen
// anchor LEFT offsets derive from the SAME live widths, so a frozen-column resize stays aligned.
const COL_MIN_PX = 48; // small floor for any column
const RATE_COL_MIN_PX = 96; // rate columns: the w-20 (80px) input + dot + padding -- a drag must not clip it
// Frozen-left Slice 2 -- manual row-resize floor (px). A row can't be dragged below this. Set
// ABOVE the tallest irreducible single-line cell across BOTH panes (the scrolling pane's rate
// input is h-7=28px + py-1=8px ~= 36px) so a dragged-short row can actually REACH the target in
// the scrolling pane too -- otherwise the scrolling row would stay tall (content min) while the
// frozen pane clipped shorter, drifting the two panes out of alignment.
const ROW_MIN_PX = 40;
const ANCHOR_WIDTH_KEYS = ["a0", "a1", "a2", "a3", "a4"] as const; // Excel Row / Sl.No / Parent / Classification / Description
const REMARKS_WIDTH_KEY = "remarks";

/** Tailwind width hint -> px (a column's seed under table-fixed). Unknown hint -> a sane default. */
export function seedWidthPx(token: string): number {
  switch (token) {
    case "w-16":
      return 64;
    case "w-28":
      return 112;
    case "w-36":
      return 144;
    case "w-48":
      return 192;
    case "description":
      return 280;
    default:
      return 112;
  }
}

/** Stable width-state key for a column. Anchors key by FIXED index 0-4 (survives column-hide);
 *  descriptors key by their Excel col letter (survives a hide+reshow); Remarks is the literal key. */
export function columnWidthKey(
  kind: "anchor" | "descriptor" | "remarks",
  idOrCol: number | string,
): string {
  if (kind === "anchor") return `a${idOrCol}`;
  if (kind === "descriptor") return `d:${idOrCol}`;
  return REMARKS_WIDTH_KEY;
}

/** Seed px for a width-state key: a0/a1/a2 = w-16, a3 = w-36, a4 = Description (280), remarks =
 *  w-48, any descriptor (d:<col>) = w-28. Mirrors the old per-cell Tailwind hints. */
export function seedForWidthKey(key: string): number {
  if (key === "a0" || key === "a1" || key === "a2") return seedWidthPx("w-16");
  if (key === "a3") return seedWidthPx("w-36");
  if (key === "a4") return seedWidthPx("description");
  if (key === REMARKS_WIDTH_KEY) return seedWidthPx("w-48");
  // BCS-S3b seeded the two client-facing computed columns wider than the 112px default because
  // "Tendered Total Amount" is a long header. BCS-S8 removed that column; % Margin keeps the
  // wider seed on its own account (its figures are percentages, not unit rates). The cost boxes
  // + BCS Total keep the default; all stay user-resizable like any descriptor.
  if (key === BCS_MARGIN_COL_KEY) return seedWidthPx("w-36");
  return seedWidthPx("w-28");
}

// ── MC-5: faithful multi-column description in the frozen anchor pane ──────────
//
// The pricing grid's whole colIndex algebra is parametric over the anchor width-key
// list. In FAN-OUT mode the single Description anchor (`a4`) is replaced by one
// letter-keyed slot per mapped description column (`desc:<col>`); the 4 non-description
// anchors (a0..a3) are unchanged. In LEGACY mode (no row carries description_parts_raw)
// the list is exactly today's `[a0..a4]`, so effectiveAnchorCount = 5 and every derived
// index is byte-identical to before. effectiveAnchorCount === anchorWidthKeys.length.

/** Width-state key for one description fan-out column. Letter-keyed (survives a change
 *  to the mapped description set), distinct from descriptors' `d:<col>`. */
export function descriptionWidthKey(col: string): string {
  return `desc:${col}`;
}

/** The per-render anchor width-key list -- the single source of truth for the anchor
 *  count and every colIndex derived from it. Legacy -> the today [a0..a4] list. */
export function buildAnchorWidthKeys(
  descriptionColumns: readonly DescriptionColumn[],
  fanOut: boolean,
): string[] {
  // Legacy = today's [a0..a4]. Fan-out = the 4 non-description anchors (a0..a3) + one
  // letter-keyed slot per description column. ANCHOR_WIDTH_KEYS is the single legacy source.
  if (!fanOut) return [...ANCHOR_WIDTH_KEYS];
  return [
    ...ANCHOR_WIDTH_KEYS.slice(0, 4),
    ...descriptionColumns.map((c) => descriptionWidthKey(c.col)),
  ];
}

/** Split-the-budget seeds for the fan-out description columns: first 280 (the old
 *  Description width), extras 160 (matching MC-4). Keyed by `desc:<col>`; drag-resize
 *  covers user preference. Empty in legacy (the single `a4` seed = 280 is used instead). */
export function descriptionWidthSeeds(
  descriptionColumns: readonly DescriptionColumn[],
): Record<string, number> {
  const seeds: Record<string, number> = {};
  descriptionColumns.forEach((c, i) => {
    seeds[descriptionWidthKey(c.col)] = i === 0 ? seedWidthPx("description") : 160;
  });
  return seeds;
}

/** Resolve a clicked cell's grid colIndex from its data-colkey, PURE over the geometry.
 *  Anchor keys (a0..a3 + the fan-out desc:<col> slots) index into anchorWidthKeys;
 *  Remarks -> remarksColIndex; descriptor `d:<col>` keys -> descriptorColStart + position.
 *  BCS-S3a: the cost block's keys (`bcs:<kind>` + `bcs:total`) resolve off bcsColStart. Both
 *  BCS params are OPTIONAL and default to the empty block, so a caller from before the cost
 *  columns existed resolves byte-identically. */
export function colIndexFromColKeyPure(
  colkey: string | undefined,
  anchorWidthKeys: readonly string[],
  descWidthKeys: readonly string[],
  descriptorColStart: number,
  remarksColIndex: number,
  bcsColKeys: readonly string[] = [],
  bcsColStart = 0,
): number | null {
  if (!colkey) return null;
  const anchor = anchorWidthKeys.indexOf(colkey);
  if (anchor >= 0) return anchor;
  if (colkey === REMARKS_WIDTH_KEY) return remarksColIndex;
  const bcs = bcsColKeys.indexOf(colkey);
  if (bcs >= 0) return bcsColStart + bcs;
  const idx = descWidthKeys.indexOf(colkey);
  return idx >= 0 ? descriptorColStart + idx : null;
}

/** Clamp a dragged width up to the column's floor: rate columns can't go below the rate input's
 *  width (D7); every other column gets a small floor. A width above the floor passes through. */
export function clampColumnWidth(width: number, isRate: boolean): number {
  return Math.max(isRate ? RATE_COL_MIN_PX : COL_MIN_PX, Math.round(width));
}

/** Frozen-left Slice 2: clamp a dragged ROW height UP to ROW_MIN_PX (a row can't be dragged to
 *  0 / shorter than one usable line). A height above the floor passes through (rounded). Pure --
 *  unit-tested, mirrors clampColumnWidth. */
export function clampRowHeight(height: number): number {
  return Math.max(ROW_MIN_PX, Math.round(height));
}

/** The three row-TYPE visibility toggles (default all true). */
export interface RowTypeToggles {
  showSpacers: boolean;
  showNotes: boolean;
  showSubtotals: boolean;
}

/**
 * ROW-TYPE VISIBILITY: keys on `effective_classification` (NOT node_type, which collapses all
 * three of these into "Other" and cannot tell them apart). The three literal tokens mirror
 * ReviewTree.classificationVisible: "spacer" / "note" / "subtotal_marker". Any OTHER
 * classification (line_item / preamble / header_repeat / null) is NEVER hidden by these toggles.
 */
export function classificationVisible(
  cls: string | null | undefined,
  t: RowTypeToggles,
): boolean {
  if (cls === "spacer" && !t.showSpacers) return false;
  if (cls === "note" && !t.showNotes) return false;
  if (cls === "subtotal_marker" && !t.showSubtotals) return false;
  return true;
}

/**
 * HIDEABLE COLUMNS: the descriptor columns the "Columns" popover may offer -- the descriptor-
 * driven set (non fixed-anchor) MINUS amount columns. LOCKED DECISION: amount columns are NEVER
 * hideable, so their formula-status f badge can never be hidden (hiding it would hide the only
 * remedy for a gate-locked rate state). Reuses isAmountDescriptor -- one source of truth with
 * the badge / amber-pending-tint render path.
 */
export function hideableDescriptors(columnDescriptors: ColumnDescriptor[]): ColumnDescriptor[] {
  return columnDescriptors.filter((d) => !FIXED_ROLE_DEDUPE.has(d.role) && !isAmountDescriptor(d));
}

/**
 * COLUMN VISIBILITY guard. An AMOUNT column is ALWAYS visible (the locked exclusion above), even
 * if somehow present in hiddenCols. A non-amount column is visible unless it is in hiddenCols.
 * An absent/undefined hiddenCols (the default) => everything visible (back-compat).
 */
export function isColumnVisible(
  d: ColumnDescriptor,
  hiddenCols: Set<string> | undefined,
): boolean {
  if (isAmountDescriptor(d)) return true;
  return !hiddenCols || !hiddenCols.has(d.col);
}

/**
 * PRICEABILITY axis (Slice 3e): a rate cell is editable (and the server accepts a save
 * without the override) ONLY on a committed row whose node_type is "Preamble" or "Line Item"
 * (VERBATIM). Every other type ("Other" -- note/spacer/subtotal/header_repeat), as well as a
 * null/undefined node_type (old/absent payload), is non-priceable. Keys on the SAME field the
 * server guard uses (save_cell_price), so the two axes can never drift. Pure -- unit-tested.
 * Slice G2e: TRIMS node_type before matching -- the server's eligible-set filter strips node_type
 * (persist.blank_category_eligible_rows), so trimming here keeps the master set byte-identical on
 * both sides (Recon 6 Q3d: the client used to compare raw, the server stripped).
 */
export function isPriceableType(nodeType: string | null | undefined): boolean {
  const t = (nodeType ?? "").trim();
  return t === "Preamble" || t === "Line Item";
}

/**
 * Slice G2e -- the ONE shared "this row is in the MASTER SET and its category cell is EMPTY"
 * predicate. It drives BOTH the grid's amber Category-cell fill AND the page's Check-Category view
 * filter, so they can never drift apart (owner ruling 2026-07-25: the filter must show EXACTLY what
 * amber shows). Master set = isPriceableType(node_type) (Line Item / Preamble, trimmed);
 * EMPTY = deriveVerdictState(cat) === "unclassified" -- which covers a never-classified row
 * (cat === undefined), a classified-and-blank row, and a whitespace-only id (deriveVerdictState
 * trims, matching the server's strip). Needs the ROW (for node_type), not just the category.
 * Replaces the retired isNeedsReviewCategory, which returned FALSE for a never-classified row and so
 * could not surface rows the widened gate now counts (Recon 6 Q8). Pure -- unit-tested.
 */
export function isMasterSetBlank(
  row: Pick<PricedRow, "node_type">,
  cat: SheetCategoryRow | undefined,
): boolean {
  return isPriceableType(row.node_type) && deriveVerdictState(cat) === "unclassified";
}

/**
 * Slice G3a: the LIVE count of ELIGIBLE master-set rows whose category cell is EMPTY -- the number
 * the banner shows and what drives categoryGateOpen. Iterates the ROWS array, NEVER the categories
 * map: a never-classified row is ABSENT from the map but MUST be counted (isMasterSetBlank treats an
 * undefined cat as blank) -- keying off the map would miss it, the fail-open the backend already
 * guards. Uses the SAME isMasterSetBlank predicate as the amber fill + the Check-Category filter
 * (four surfaces, ONE predicate). Pure -- unit-tested.
 */
export function countMasterSetBlankRows(
  rows: readonly Pick<PricedRow, "node_type" | "source_row_number">[],
  categoriesByExcelRow: ReadonlyMap<number, SheetCategoryRow>,
): number {
  let n = 0;
  for (const r of rows) {
    if (isMasterSetBlank(r, categoriesByExcelRow.get(r.source_row_number))) n += 1;
  }
  return n;
}

/**
 * Slice G3a: the category gate OPENS when zero master-set rows are blank OR the admin override is
 * set. DELIBERATE asymmetry: the count keeps counting blanks under the override (an admin sees how
 * many remain), but the gate opens regardless. Pure -- unit-tested.
 */
export function isCategoryGateOpen(blankCount: number, override: boolean): boolean {
  return blankCount === 0 || override;
}

// ── SELECTED-ROW runs: pure selection helpers + the confirmation copy ────────────────

/**
 * Immutable toggle of one excel row in the selection set. Returns a NEW set (so the grid's
 * reference changes and renderRow re-derives the per-row booleans) but never mutates the old one.
 * Keyed on the DURABLE excel row, never an array index. Pure -- unit-tested.
 */
export function toggleRowSelection(
  selected: ReadonlySet<number>,
  excelRow: number,
): ReadonlySet<number> {
  const next = new Set(selected);
  if (next.has(excelRow)) next.delete(excelRow);
  else next.add(excelRow);
  return next;
}

/**
 * Drop any tick whose row is no longer run-eligible. Called after a refetch: a re-classify can
 * remove a row from the population while it sits ticked, and sending it would be REJECTED by the
 * server's validation (which refuses the whole request rather than silently narrowing it). Pruning
 * client-side keeps the confirmation's count honest. Returns the SAME reference when nothing
 * changes, so it cannot churn the grid. Pure -- unit-tested.
 */
export function pruneSelectionToEligible(
  selected: ReadonlySet<number>,
  eligible: ReadonlySet<number>,
): ReadonlySet<number> {
  let dropped = false;
  for (const er of selected) if (!eligible.has(er)) { dropped = true; break; }
  if (!dropped) return selected;
  const next = new Set<number>();
  for (const er of selected) if (eligible.has(er)) next.add(er);
  return next;
}

/**
 * SELROW filter -- PURE. Does this row pass the "show only ticked rows" toggle?
 *
 * ⚠️ It is a TOGGLE, not a value list. `GridColumnFilter` is built entirely around distinct-VALUE
 * lists (an options array, a Set<string> selection, a type-to-search box, membership matching), and
 * a thousand row numbers would be a useless list. Bending it into a toggle would put a search box
 * over two pseudo-options and express a boolean as a set of sentinels -- worse, not better. So the
 * Excel-row header carries a dedicated toggle instead, and this is its predicate.
 *
 * ⚠️ OFF, or NO ROWS TICKED, is a PASS-THROUGH -- the same composition law the value-list filters
 * obey ("an EMPTY selection never means hide everything"). A filter that empties the grid with no
 * explanation is the worse failure, so the toggle is additionally DISABLED while nothing is ticked.
 *
 * ⚠️ UNTICKING WHILE FILTERED makes the row vanish immediately (owner ruling) -- and that falls out
 * of reading the live selection here rather than snapshotting it. Do NOT special-case it.
 */
export function passesTickedFilter(
  showOnlyTicked: boolean,
  selected: ReadonlySet<number>,
  excelRow: number,
): boolean {
  if (!showOnlyTicked || selected.size === 0) return true;
  return selected.has(excelRow);
}

export interface SuggestConfirmCopy {
  title: string;
  body: string;
  /** The warning line. EMPTY on a selected-row run; the whole-sheet run always carries it. */
  warning: string;
  confirmLabel: string;
  /** True for the whole-sheet branch -- the caller styles that action as the destructive one. */
  wholeSheet: boolean;
}

/**
 * THE confirmation shown before ANY AI call. Two branches, and the WHOLE-SHEET WORDING IS THE
 * PRODUCT -- more than the count.
 *
 * A whole-sheet run re-extracts and OVERWRITES every row, including rows that are already correct.
 * That is how ten switch rows lost their `plate_item` during a diagnostic re-run, and it cost a day
 * chasing a prompt-attention theory for what turned out to be a gate bug. The warning names that
 * consequence in plain words, so it cannot be met by accident; the selected-row branch carries no
 * warning because it does not have that consequence.
 *
 * The whole-sheet branch is deliberately worded as the BIGGER action (it names the row count, says
 * "every row", and its confirm label says "Re-extract all" rather than a bare "Run"), and the
 * caller renders it destructively so a stray click cannot launch a full run. Pure -- unit-tested.
 */
export function suggestConfirmCopy(
  selectedCount: number,
  eligibleCount: number,
): SuggestConfirmCopy {
  if (selectedCount > 0) {
    const rowWord = selectedCount === 1 ? "row" : "rows";
    return {
      title: `Suggest rates for ${selectedCount} selected ${rowWord}?`,
      body:
        `${selectedCount} ${rowWord} will be re-extracted. Every other row keeps the attributes it ` +
        `already has -- they are carried forward unchanged.`,
      warning: "",
      confirmLabel: `Run ${selectedCount} ${rowWord}`,
      wholeSheet: false,
    };
  }
  return {
    title: `Re-extract the whole sheet (${eligibleCount} rows)?`,
    body:
      `No rows are selected, so all ${eligibleCount} eligible rows will be sent for extraction.`,
    warning:
      "This OVERWRITES the attributes on every row, including rows that are already correct. " +
      "To re-run just a few, tick them in the Excel-row column first.",
    confirmLabel: `Re-extract all ${eligibleCount} rows`,
    wholeSheet: true,
  };
}

/**
 * Slice G3a: build the optimistic SheetCategoryRow for a verdict PICK (`humanId` non-empty) or a
 * CLEAR (`humanId === ""`), folded onto the row's current resolved entry `base`. A pick sets a
 * NON-blank effective (isMasterSetBlank -> FALSE, the live count DROPS); a clear sets a BLANK
 * effective (isMasterSetBlank -> TRUE, the count RISES) so the sheet re-locks in the same
 * interaction rather than briefly appearing unlocked until the refetch. Pure -- unit-tested.
 */
export function buildOptimisticVerdict(
  base: SheetCategoryRow,
  humanId: string,
): SheetCategoryRow {
  return humanId
    ? {
        ...base,
        routing: "Auto-accepted",
        human_category_id: humanId,
        effective_category_id: humanId,
      }
    : {
        ...base,
        routing: "Needs review",
        human_category_id: "",
        final_category_id: "",
        effective_category_id: "",
      };
}

/**
 * A finite, non-zero number. SELF-CONTAINED copy of priceability.isNonZeroNum (semantics
 * IDENTICAL) so the rate-edit gate needs NOTHING from priceability -- preserving the one-way
 * dependency (priceability imports from PricingGrid, never the reverse; importing back would
 * be a cycle). 0 / null / undefined / non-number / a "0" STRING -> false; a finite non-zero
 * number, INCLUDING a negative qty -> true. Pure -- unit-tested.
 */
export function isNonZeroNum(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v !== 0;
}

/**
 * "qty anywhere" (owner-locked "Definition A") -- the row carries a non-zero, finite quantity
 * in ANY qty column: the scalar qty_total OR any per-area qty. DELIBERATELY SIMPLER + LOOSER
 * than priceability.isPriceableLine, which restricts qty-bearing to a RATE-COLUMN area. THIS
 * IS AN INTENTIONAL DIVERGENCE, NOT drift: this predicate answers "can I edit this ROW at
 * all?" (the edit gate), while isPriceableLine answers "does THIS AREA need a rate?" (the
 * flags / priced-count / rollup). They use different definitions ON PURPOSE -- do NOT align
 * them. Used ONLY for the Preamble branch of the gate. Pure -- unit-tested.
 */
export function isRowQtyBearing(row: PricedRow): boolean {
  if (isNonZeroNum(row.qty_total)) return true;
  const ba = row.qty_by_area;
  return ba != null && Object.values(ba).some(isNonZeroNum);
}

/**
 * The ASYMMETRIC rate-edit gate (owner-locked, row-level axis): a rate cell is editable iff
 *   override  OR  node_type === "Line Item"  OR  (node_type === "Preamble" AND isRowQtyBearing).
 * A LINE ITEM is ALWAYS editable (a zero-qty Line Item is a valid "rate-only" line -- do NOT
 * lock it). A PREAMBLE is editable only when qty-bearing (a zero-qty Preamble -- nearly all
 * Preambles -- is read-only). The "Price any row" override unlocks BOTH a zero-qty Preamble
 * AND any non-priceable type. Every other case (non-priceable type, or a zero-qty Preamble
 * without override) -> read-only. The Preamble/Line-Item asymmetry is a DELIBERATE owner-
 * locked rule -- do NOT "fix" it into uniformity. The descriptor's is-rate-cell test is
 * applied SEPARATELY at the call site (this is the ROW axis only). Pure -- unit-tested.
 */
export function isRateEditableRow(row: PricedRow, override: boolean): boolean {
  if (override) return true;
  if (row.node_type === "Line Item") return true;
  return row.node_type === "Preamble" && isRowQtyBearing(row);
}

/**
 * True iff this (row, descriptor) RATE cell carries a saved price -- driven SOLELY by the
 * overlay's priced_* markers (which the backend sets from the pricing layer's is_filled),
 * NEVER by a zero-check on the value (a committed 0.0 rate can be a valid priced value).
 * Returns false for non-rate descriptors. Pure -- unit-tested in PricingGrid.test.ts.
 */
export function isCellPriced(row: PricedRow, d: ColumnDescriptor): boolean {
  if (d.value_field === PER_AREA_RATE_FIELD) {
    if (d.value_key === null || d.rate_subkey === null) return false;
    return row.priced_by_area?.[d.value_key]?.[d.rate_subkey] === true;
  }
  if (SCALAR_RATE_FIELDS.has(d.value_field)) {
    // Marker field name: priced_<value_field> -> priced_rate_supply / _install / _combined.
    return (row as unknown as Record<string, unknown>)[`priced_${d.value_field}`] === true;
  }
  return false;
}

/**
 * The RATE descriptor an AMOUNT descriptor pairs with (same area + corresponding kind),
 * if such a rate column is mapped in this sheet; else null. Pure -- unit-tested.
 */
export function findPairedRateDescriptor(
  amountD: ColumnDescriptor,
  descriptors: ColumnDescriptor[],
): ColumnDescriptor | null {
  if (amountD.value_field === PER_AREA_AMOUNT_FIELD) {
    const rateKind = PER_AREA_AMOUNT_TO_RATE_KIND[amountD.rate_subkey ?? ""];
    if (!rateKind) return null;
    return (
      descriptors.find(
        (r) =>
          r.value_field === PER_AREA_RATE_FIELD &&
          r.value_key === amountD.value_key &&
          r.rate_subkey === rateKind,
      ) ?? null
    );
  }
  const rateField = SCALAR_AMOUNT_TO_RATE_FIELD[amountD.value_field];
  if (!rateField) return null;
  return descriptors.find((r) => r.value_field === rateField) ?? null;
}

/**
 * Phase-2 prefill correspondence: given a JUST-SAVED per-area rate descriptor, return
 * every OTHER-AREA rate descriptor that is the SAME logical column -- i.e. both are
 * value_field === "rate_by_area", the SAME rate_subkey (kind), and a DIFFERENT value_key
 * (area). Returns [] for a scalar / non-rate_by_area source, or a half-populated source
 * (null rate_subkey or value_key) -- fail-closed: only a clean per-area cell corresponds.
 * Scalar rate columns (area null) have no cross-area analog, so they never match.
 * Pure -- unit-tested in PricingGrid.test.ts.
 */
export function findCorrespondingRateDescriptors(
  sourceD: ColumnDescriptor,
  descriptors: ColumnDescriptor[],
): ColumnDescriptor[] {
  if (sourceD.value_field !== PER_AREA_RATE_FIELD) return [];
  if (sourceD.rate_subkey === null || sourceD.value_key === null) return [];
  return descriptors.filter(
    (c) =>
      c.value_field === PER_AREA_RATE_FIELD &&
      c.rate_subkey === sourceD.rate_subkey &&
      c.value_key !== null &&
      c.value_key !== sourceD.value_key,
  );
}

/** amount = qty x rate. Returns null if either operand is missing. Pure -- unit-tested. */
export function computeAmount(
  qty: number | null | undefined,
  rate: number | null | undefined,
): number | null {
  if (qty === null || qty === undefined || rate === null || rate === undefined) return null;
  return qty * rate;
}

// ── Formula Builder F4: the amount-cell value compute (formula-wins, else the pairing) ──
// The RATE value_fields whose operand reads are DRAFT-AWARE (the user edits rates -> live
// recompute). Mirrors the rate descriptor classes (PER_AREA_RATE_FIELD + SCALAR_RATE_FIELDS).
export const RATE_VALUE_FIELDS = new Set<string>([PER_AREA_RATE_FIELD, ...SCALAR_RATE_FIELDS]);

/**
 * The result of computing one amount cell's displayed value (F4). DISCRIMINATED so the cell
 * render is a pure map: `value` -> the number; `committed` -> fall back to the stored committed
 * amount (the no-formula / un-priced pairing case, byte-for-byte the pre-F4 behavior);
 * `blank` -> a formula APPLIES but can't resolve (not_yet = needs a rate; broken = check
 * formula / a cycle / a dangling ref) -> render BLANK, NEVER a stale/wrong number (the §0 core).
 */
export type AmountCellResult =
  | { kind: "value"; value: number }
  | { kind: "committed" }
  | { kind: "blank"; reason: "not_yet" | "broken" };

/**
 * Resolve one operand ref to its value for THIS row, mirroring resolveDescriptorValue's
 * absent-vs-zero contract (real 0 -> 0; a missing key -> undefined; NEVER 0-substituted). The
 * ref is already AREA-BOUND by F2. A qty / plain-amount operand reads its stored value.
 *
 * A RATE operand is DRAFT-AWARE + COMMITTED-AWARE: the optimistic draft if the user is editing
 * that rate cell -> else the saved rate when editor-priced (marker set; incl. a deliberate 0)
 * -> else the PREPOPULATED committed rate when it is a NON-ZERO finite value (a real tender-doc
 * rate, no marker -- the prepopulated-rate fix) -> else undefined (a 0.0/absent committed rate
 * -> the formula blanks, "needs a rate"). The non-zero gate is RATE-ONLY; qty/amount are not
 * marker-gated and are unchanged. This is the one place F4 reads MULTIPLE operands. Exported
 * for unit tests.
 */
export function lookupOperandValue(
  row: PricedRow,
  ref: AmountFormulaRef,
  columnDescriptors: ColumnDescriptor[],
  draftRates: Record<string, string>,
): number | undefined {
  const rd =
    columnDescriptors.find(
      (c) =>
        c.value_field === ref.value_field &&
        c.value_key === ref.value_key &&
        c.rate_subkey === ref.rate_subkey,
    ) ?? null;
  if (RATE_VALUE_FIELDS.has(ref.value_field)) {
    if (!rd) return undefined; // dangling -> caught by validateFormulaRefs; here it is absent
    const draft = draftRates[`${row.row_index}:${rd.col}`];
    if (draft !== undefined) {
      const n = parseFloat(draft);
      return Number.isFinite(n) ? n : 0; // editing -> live (blank/NaN -> 0, as the cell commits)
    }
    if (isCellPriced(row, rd)) {
      const sv = resolveDescriptorValue(row, rd);
      return typeof sv === "number" ? sv : undefined; // priced -> the saved value (incl. a deliberate 0)
    }
    // PREPOPULATED-RATE FIX: an UNMARKED committed rate is USABLE when its committed value is a
    // NON-ZERO finite number (a real tender-doc rate, e.g. 1120 on Alorica/VRF) -> the formula
    // computes from it instead of blanking. A 0.0 / absent committed rate stays undefined ->
    // not_yet ("needs a rate"). There are no NULLs in the committed tier (an unfilled rate coerces
    // to 0.0), so NON-ZERONESS is the distinguisher. Owner-accepted tradeoff: a genuinely-0 rate
    // that was never editor-priced blanks rather than computes 0 (the safer error -- price it 0
    // through the editor to set the marker -> usable). RATE branch ONLY; qty/amount unchanged.
    const committed = resolveDescriptorValue(row, rd);
    if (typeof committed === "number" && Number.isFinite(committed) && committed !== 0) {
      return committed;
    }
    return undefined; // 0.0 / absent committed rate, no marker -> not_yet ("needs a rate")
  }
  // qty / plain amount -> the stored value (resolveDescriptorValue handles the *_by_area walk).
  const v = resolveDescriptorValue(row, rd ?? (ref as unknown as ColumnDescriptor));
  return typeof v === "number" ? v : undefined;
}

/**
 * DANGLING-REF pre-validation (the upgrade F2 deferred to F4): every DIRECT leaf ref of a
 * formula tree, once area-bound, must match a live descriptor. A ref matching NO descriptor
 * (e.g. a formula orphaned by a re-commit that moved/removed columns) -> the cell is "broken"
 * ("check formula"), NOT a silent not_yet (F2 can't tell "no such column" from "absent value").
 * Pure -- unit-tested. Scope: the applicable formula's OWN direct operands (each amount column
 * pre-validates its own formula at its own cell, so a transitive dangling ref surfaces broken
 * at that column's cell).
 */
export function validateFormulaRefs(
  tree: AmountFormulaNode,
  bindArea: string | null,
  columnDescriptors: ColumnDescriptor[],
): boolean {
  const leaves: AmountFormulaRef[] = [];
  const walk = (n: AmountFormulaNode) => {
    if ("ref" in n) leaves.push(n.ref);
    else n.operands.forEach(walk);
  };
  walk(tree);
  return leaves.every((ref) => {
    const bound = bindRef(ref, bindArea);
    return columnDescriptors.some(
      (c) =>
        c.value_field === bound.value_field &&
        c.value_key === bound.value_key &&
        c.rate_subkey === bound.rate_subkey,
    );
  });
}

/**
 * Compute one amount cell's displayed value (F4 -- the swap). FORMULA-WINS-ELSE-PAIRING:
 *   - HAS an applicable formula (F2 pickFormula precedence: per-area override > area-wildcard
 *     default): pre-validate its operand refs (dangling -> broken), else
 *     evaluateAmountColumn(concreteCol, columnFormulas, lookup) bound to THIS area (F2 binds
 *     the wildcard default's operands itself -- F4 passes the concrete column, never pre-binds).
 *     ok -> value; not_yet/broken -> blank.
 *   - NO formula: the EXISTING findPairedRateDescriptor -> computeAmount path, byte-for-byte
 *     unchanged (rate via draft / saved-when-priced; else the committed value).
 * Pure (no React) -- unit-tested in PricingGrid.test.ts. This is the SINGLE source of truth for
 * the amount-cell value; the render is a thin map over AmountCellResult.
 */
export function evaluateAmountCell(
  d: ColumnDescriptor,
  row: PricedRow,
  columnDescriptors: ColumnDescriptor[],
  columnFormulas: ColumnFormula[],
  draftRates: Record<string, string>,
): AmountCellResult {
  const concreteCol: AmountFormulaRef = {
    value_field: d.value_field,
    value_key: d.value_key,
    rate_subkey: d.rate_subkey,
  };
  const applicable = pickFormula(concreteCol, columnFormulas);
  if (applicable && applicable.formula) {
    // dangling-ref gate (broken beats a silent not_yet).
    if (!validateFormulaRefs(applicable.formula, d.value_key, columnDescriptors)) {
      return { kind: "blank", reason: "broken" };
    }
    const lookup: OperandLookup = (ref) =>
      lookupOperandValue(row, ref, columnDescriptors, draftRates);
    const res = evaluateAmountColumn(concreteCol, columnFormulas, lookup);
    return res.ok ? { kind: "value", value: res.value } : { kind: "blank", reason: res.reason };
  }

  // ── FALLBACK: the existing single-paired-rate path, UNCHANGED (the no-formula case). ──
  const displayDescs = columnDescriptors.filter((c) => !FIXED_ROLE_DEDUPE.has(c.role));
  const rateD = findPairedRateDescriptor(d, displayDescs);
  if (!rateD) return { kind: "committed" };
  const area = d.value_field === PER_AREA_AMOUNT_FIELD ? d.value_key : null;
  const qty =
    area !== null && area !== undefined ? (row.qty_by_area?.[area] ?? null) : (row.qty_total ?? null);
  const draft = draftRates[`${row.row_index}:${rateD.col}`];
  let effRate: number | null = null;
  if (draft !== undefined) {
    const n = parseFloat(draft);
    effRate = Number.isFinite(n) ? n : 0;
  } else if (isCellPriced(row, rateD)) {
    const sv = resolveDescriptorValue(row, rateD);
    effRate = typeof sv === "number" ? sv : null;
  }
  if (effRate === null) return { kind: "committed" };
  const amt = computeAmount(qty, effRate);
  return amt !== null ? { kind: "value", value: amt } : { kind: "committed" };
}

/**
 * ★ BCS-S3b -- THE NUMBER AN AMOUNT CELL SHOWS. One decision, two readers.
 *
 * ⚠️ OWNER RULING: % Margin divides by THE FIGURE ON SCREEN. The BCS Tendered Total Amount
 * column sums this across the confirmed Amount columns and the margin divides by that sum, so
 * this and the amount `<td>` beside it MUST come from one place -- a denominator that differed
 * from the number printed next to it would be worse than no column at all.
 *
 * Until S3b this logic was inline in the amount cell's render, which is why extracting it was
 * the first thing this slice did rather than copying it: the RECONCILIATION arm is what makes
 * the duplication dangerous. On a diverging cell the screen shows the DOCUMENT amount by default
 * (D1), NOT the formula's, and a second copy that skipped `resolveDivergence` would compute a
 * margin the sheet visibly contradicts on exactly the rows a human already flagged.
 *
 *   value + no divergence -> the formula value        blank -> null (contributes nothing)
 *   value + divergence    -> resolveDivergence's pick committed -> the committed/document value
 *
 * Pure (no React) -- unit-tested in PricingGrid.test.ts.
 */
export function shownAmountValue(
  cell: AmountCellResult,
  documentVal: number | null,
  choice: ReconChoice | undefined,
): number | null {
  if (cell.kind === "committed") return documentVal;
  if (cell.kind !== "value") return null;
  const recon = resolveDivergence(documentVal, cell.value, choice);
  return recon.diverges ? recon.value : cell.value;
}

/**
 * Build the per-cell save args from a row + a RATE descriptor (the grid's half of the
 * onSaveRate contract; the page fills boq/sheet/version + the rate). Pure -- unit-tested.
 *   excelRow = row.source_row_number; colLetter = d.col;
 *   area = per-area d.value_key (scalar: omitted);
 *   rateKind = per-area d.rate_subkey verbatim / scalar derived token (guard field, not key);
 *   description = row.description (copy-forward MATCH GUARD -- always sent).
 */
export function buildRateCell(row: PricedRow, d: ColumnDescriptor): RateCellSaveArgs {
  const isPerArea = d.value_field === PER_AREA_RATE_FIELD;
  const rateKind = isPerArea
    ? (d.rate_subkey ?? "")
    : (SCALAR_RATE_FIELD_TO_KIND[d.value_field] ?? d.value_field);
  const args: RateCellSaveArgs = {
    excelRow: row.source_row_number,
    colLetter: d.col,
    rateKind,
    description: row.description ?? "",
  };
  if (isPerArea && d.value_key) args.area = d.value_key;
  return args;
}

// ── Slice 3b.2: spreadsheet keyboard navigation ─────────────────────────────────
// Number of fixed anchor columns rendered before the descriptor loop:
// 0=Excel Row, 1=Sl.No, 2=Parent, 3=Classification, 4=Description. Descriptor cells
// occupy colIndex FIXED_ANCHOR_COUNT .. (FIXED_ANCHOR_COUNT + displayDescriptors.length - 1).
export const FIXED_ANCHOR_COUNT = 5;

// CL-2: a read-only "Category" column is the FIRST right-pane (scrolling) column, at colIndex
// FIXED_ANCHOR_COUNT. It is NOT a 6th anchor -- the 5 anchors stay pinned; Category rides in the
// scrolling pane with the descriptors. Descriptor cells therefore start ONE column later. Every
// descriptor colIndex is derived from this constant so the +1 lives in exactly one place.
export const DESCRIPTOR_COL_START = FIXED_ANCHOR_COUNT + 1; // +1 for the leading read-only Category column
// The fixed width of the read-only Category column (px). Not user-resizable (no colWidths entry).
const CATEGORY_COL_WIDTH = 140;

export type NavDirection = "up" | "down" | "left" | "right" | "tab" | "shift-tab";
export interface CellCoord {
  rowIndex: number;
  colIndex: number;
}

/**
 * The next active cell for a nav key, or null when the move has nowhere to go. Pure
 * (unit-tested). Arrows STOP at edges (no wrap). Enter maps to "down". Tab moves right and
 * WRAPS at a row's end to the next row's first cell; Shift-Tab moves left and wraps to the
 * previous row's last cell; Tab off the very last cell (and Shift-Tab off the very first)
 * returns null (focus stays put -- contained in the grid). rowCount/colCount are the
 * rendered matrix dimensions (rowCount = rows.length; colCount = FIXED_ANCHOR_COUNT + N).
 */
export function nextCell(
  active: CellCoord,
  dir: NavDirection,
  rowCount: number,
  colCount: number,
): CellCoord | null {
  const { rowIndex: r, colIndex: c } = active;
  switch (dir) {
    case "up":
      return r > 0 ? { rowIndex: r - 1, colIndex: c } : null;
    case "down":
      return r < rowCount - 1 ? { rowIndex: r + 1, colIndex: c } : null;
    case "left":
      return c > 0 ? { rowIndex: r, colIndex: c - 1 } : null;
    case "right":
      return c < colCount - 1 ? { rowIndex: r, colIndex: c + 1 } : null;
    case "tab":
      if (c < colCount - 1) return { rowIndex: r, colIndex: c + 1 };
      if (r < rowCount - 1) return { rowIndex: r + 1, colIndex: 0 };
      return null; // last cell of last row -> stop (contain focus)
    case "shift-tab":
      if (c > 0) return { rowIndex: r, colIndex: c - 1 };
      if (r > 0) return { rowIndex: r - 1, colIndex: colCount - 1 };
      return null; // first cell of first row -> stop (contain focus)
    default:
      return null;
  }
}

// A decimal-in-progress: digits, at most one dot, optional leading minus, or empty/partial
// ("", "-", "1.", "."). Rejects letters / multiple dots so a rate input stays numeric.
// parseFloat (in commitRate) tolerates the partial forms ("-"/"." -> NaN -> 0).
const DECIMAL_IN_PROGRESS = /^-?\d*\.?\d*$/;

// Slice 3c -- auto-save debounce interval (ms): persist a typed-but-uncommitted rate this
// long after the last keystroke, with no blur/Enter/move gesture needed.
const AUTOSAVE_MS = 1000;

// Slice 3c -- the save-status chip state, derived purely from the page's save bookkeeping.
// Priority: a live error wins; then an in-flight save; then unsaved drafts; then a prior
// success; else idle. Pure -- unit-tested in PricingGrid.test.ts.
export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "failed";
export function deriveSaveStatus(s: {
  inFlight: number;
  hasUnsaved: boolean;
  hasSaved: boolean; // a save has succeeded at least once (lastSavedAt set)
  hasError: boolean;
}): SaveStatus {
  if (s.hasError) return "failed";
  if (s.inFlight > 0) return "saving";
  if (s.hasUnsaved) return "unsaved";
  if (s.hasSaved) return "saved";
  return "idle";
}

// Single-editor lock (slice B) -- the stable marker the backend prefixes onto a
// save_cell_price reject when the sheet is held FRESH by ANOTHER user (pricing_lock
// ._LOCK_HELD_MARKER). getFrappeError preserves the message verbatim, and multiple server
// messages are ", "-joined, so detect with `includes` (NOT startsWith). Pure -- unit-tested.
export const TAKEOVER_MARKER = "BOQ_PRICING_LOCKED";
export function isTakeoverError(msg: string): boolean {
  return typeof msg === "string" && msg.includes(TAKEOVER_MARKER);
}

// ── Slice 4c: full-screen editor -- Esc-to-exit predicate ──────────────────────
/**
 * Should an Escape keypress EXIT the full-screen pricing editor? PURE -- unit-tested in
 * PricingGrid.test.ts (the page wires it to a window keydown listener active only while
 * expanded). The two guards keep full-screen Esc from colliding with the grid's other Esc
 * consumers:
 *   - `e.defaultPrevented`: the RemarkCell + AmountFormulaBuilder Radix popovers
 *     preventDefault THEIR Escape-dismiss, so a popover-closing Esc never exits full-screen
 *     ("Esc closed a popover" vs "Esc should exit" is exactly this bit).
 *   - the active element being an <input>/<textarea>: a rate / remark being typed owns its
 *     own Esc (do not yank the user out of full-screen mid-edit).
 * Only a bare Escape on a non-input, not-already-handled, exits.
 */
export function shouldExitFullscreenOnEsc(
  e: { key: string; defaultPrevented: boolean },
  activeElement: Element | null,
): boolean {
  if (e.key !== "Escape") return false;
  if (e.defaultPrevented) return false;
  const tag = activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return false;
  return true;
}

// ── Slice 3d: in-editor sheet tabs ─────────────────────────────────────────────
/**
 * Committed sheets in WORKBOOK ORDER for the in-editor sheet-tab strip: sort by
 * sheet_order ascending; a null/undefined sheet_order sorts LAST (defensive -- in
 * practice every committed sheet carries one), tiebroken by sheet_name (#152 -- compared
 * VERBATIM, never trimmed) for a stable, deterministic order. Returns a NEW array (does
 * not mutate input). Pure -- unit-tested in PricingGrid.test.ts.
 */
export function orderCommittedSheets<
  T extends { sheet_name: string; sheet_order: number | null },
>(sheets: T[]): T[] {
  const byName = (a: T, b: T) => (a.sheet_name < b.sheet_name ? -1 : a.sheet_name > b.sheet_name ? 1 : 0);
  return [...sheets].sort((a, b) => {
    const ao = a.sheet_order;
    const bo = b.sheet_order;
    const aNull = ao === null || ao === undefined;
    const bNull = bo === null || bo === undefined;
    if (aNull || bNull) {
      if (aNull && bNull) return byName(a, b);
      return aNull ? 1 : -1; // a null-order sheet sorts AFTER a numbered one
    }
    return ao !== bo ? ao - bo : byName(a, b);
  });
}

/**
 * Is the active sheet a GRID-ONLY (general-specs) committed sheet? Looks the active
 * sheet up in the committed-state list by sheet_name (VERBATIM, #152 -- never trimmed)
 * and returns true ONLY when its sheet_disposition is explicitly "grid_only".
 *
 * Returns FALSE for: a data sheet ("grid_and_nodes") AND the indeterminate window (the
 * sheet not yet in the list while committed-state loads). The fail-to-false default is
 * load-bearing -- it guarantees a data sheet NEVER briefly renders as grid-only, and a
 * grid-only sheet only forks once its disposition is positively known. Pure -- unit-tested.
 */
export function isGridOnlySheet(
  committedSheets: { sheet_name: string; sheet_disposition?: string }[],
  sheetName: string,
): boolean {
  const match = committedSheets.find((s) => s.sheet_name === sheetName);
  return match?.sheet_disposition === "grid_only";
}

// ── Slice 4a: annotation (remarks + color) ──────────────────────────────────────
// Per-row remark cap -- mirrors the review-screen remark + the backend _REMARK_MAX_LEN.
const REMARK_MAX_LEN = 250;

// Token -> a LEFT-BORDER class (the user-color visual channel). DELIBERATELY a border,
// NOT a background: the system owns the cell BACKGROUND (emerald = priced / amber =
// priced-non-priceable) + a dot + the blue inset focus ring; a left border is a different
// CSS channel so a colored cell that is ALSO priced/active shows BOTH at once (the border,
// the emerald/amber fill, the dot, and the ring never mask each other). Literal strings so
// Tailwind's scanner keeps them. Unknown/absent token -> "" (fail-safe).
const _COLOR_BORDER: Record<string, string> = {
  red: "border-l-4 border-l-red-500",
  orange: "border-l-4 border-l-orange-500",
  yellow: "border-l-4 border-l-yellow-400",
  green: "border-l-4 border-l-green-500",
  blue: "border-l-4 border-l-blue-500",
  purple: "border-l-4 border-l-purple-500",
  pink: "border-l-4 border-l-pink-500",
  grey: "border-l-4 border-l-gray-400",
};
// Token -> a solid swatch background (for the palette buttons + the trigger chip).
const _COLOR_SWATCH: Record<string, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-400",
  green: "bg-green-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  pink: "bg-pink-500",
  grey: "bg-gray-400",
};

/** Token -> the left-border class for a colored cell; "" for unknown/absent. Pure -- tested. */
export function colorClassForToken(token: string | null | undefined): string {
  return token ? (_COLOR_BORDER[token] ?? "") : "";
}

/** Token -> a solid swatch bg class (palette + trigger); "" for unknown/absent. Pure -- tested. */
export function swatchClassForToken(token: string | null | undefined): string {
  return token ? (_COLOR_SWATCH[token] ?? "") : "";
}

/**
 * The cells an "apply to whole row" color targets = every descriptor (data) column's letter.
 * The 5 fixed anchors (Excel Row / Sl.No / Parent / Classification / Description) are
 * structural and not colorable, so the target set is descriptor-driven (row-independent).
 * Pure -- unit-tested. (Takes only displayDescriptors: the targets don't depend on the row.)
 */
export function rowColorCells(displayDescriptors: ColumnDescriptor[]): string[] {
  return displayDescriptors.map((d) => d.col);
}

/** A short single-line preview of a remark for the trailing cell / review-list. Pure -- tested. */
export function remarkPreview(remark: string | null | undefined, max = 60): string {
  if (!remark) return "";
  const t = remark.trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// V2-FIX (overscan-zone ghost): whether the grid is rendering VIRTUALIZED. In-row popovers
// (RemarkCell / ColorPicker / ReconcileBadge) read this to close on VISIBILITY loss -- a row
// scrolled into the mounted-but-off-screen overscan zone would otherwise leave its Radix popover
// collision-pinned into the viewport as a detached "ghost" (the mounted-set predicate can't see it).
// Context (not a row prop) so the memo shield is untouched; it flips only when the A/B toggle flips.
const VirtualizedContext = createContext(false);

/**
 * V2-FIX: close an in-row popover when its anchor scrolls OUT OF VIEW (not just on unmount).
 * VIRTUALIZED-only (classic never unmounts + must stay byte-identical): when `open`, observe the
 * trigger element with an IntersectionObserver (viewport root, threshold 0, the SAME pattern as the
 * page-owned CategoryVerdictPicker) and call `onClose` on `!isIntersecting`. Closing discards any
 * unsaved draft (owner-accepted). A no-op in classic mode or while closed.
 */
function useCloseWhenScrolledOut(
  triggerRef: RefObject<HTMLElement>,
  open: boolean,
  onClose: () => void,
): void {
  const virtualized = useContext(VirtualizedContext);
  useEffect(() => {
    if (!virtualized || !open) return;
    const el = triggerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => !e.isIntersecting)) onClose();
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualized, open]);
}

/**
 * The trailing per-row Remarks cell. Click-to-open a small Textarea editor (mirrors the
 * review-screen remark idiom: own draft/loading/error state, a 250 counter, mutate-only
 * refresh via the page's onSave). READ-ONLY when onSave is absent (locked/takeover) -> the
 * stored remark renders as plain text. NOT in the keyboard-nav matrix (click-only).
 */
function RemarkCell({
  remark,
  onSave,
  open,
  onOpenChange,
  onMoveDown,
}: {
  remark: string | null | undefined;
  onSave?: (remark: string) => Promise<void>;
  /** Slice 4a.2: CONTROLLED open-state (lifted to the grid so the keyboard can open it). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Slice 4a.2: after a successful Enter-in-editor save, advance focus DOWN one row. */
  onMoveDown?: () => void;
}) {
  const stored = remark ?? "";
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // V2-FIX: close (visibility-based) when the trigger scrolls off-view in virtualized mode, so the
  // open editor never dangles as an overscan-zone ghost. Discards the unsaved draft (owner-accepted).
  const triggerRef = useRef<HTMLButtonElement>(null);
  useCloseWhenScrolledOut(triggerRef, open, () => onOpenChange(false));

  // Seed the editor from the stored value whenever it OPENS. `open` is grid-controlled now,
  // so opening BY KEYBOARD (the grid sets its state directly, not via onOpenChange) still
  // seeds here. Keyed only on `open` (the open transition is the trigger).
  useEffect(() => {
    if (open) {
      setDraft(stored);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Read-only: show the stored remark (or nothing). No popover, no editor.
  if (!onSave) {
    return stored ? (
      <span
        className="text-[11px] text-foreground whitespace-pre-wrap break-words"
        title={stored}
      >
        {remarkPreview(stored, 80)}
      </span>
    ) : null;
  }

  const overCap = draft.length > REMARK_MAX_LEN;
  const dirty = draft !== stored;

  // commit(value, moveDown): save via the page; on success close the editor (the grid's
  // onOpenChange restores focus to THIS cell) then, if moveDown, advance focus DOWN one row
  // (onMoveDown runs AFTER and wins the focus). On error keep the editor open + show it.
  const commit = async (value: string, moveDown: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
      onOpenChange(false);
      if (moveDown) onMoveDown?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save the remark.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          tabIndex={-1} // NOT a matrix tab-stop; the <td> is the nav focus target
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted/50",
            stored ? "text-foreground" : "italic text-muted-foreground",
          )}
          title={stored || "Add a remark"}
        >
          <MessageSquare
            className={cn("h-3 w-3 shrink-0", stored ? "text-amber-600 dark:text-amber-400" : "opacity-50")}
          />
          <span className="truncate">{stored ? remarkPreview(stored, 40) : "Add note"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-2"
        onKeyDown={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => e.preventDefault()} // the grid governs focus on close
      >
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Remark
        </p>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter (no Shift) = save-and-move-down (Excel single-line feel); Shift+Enter =
            // a newline (the Textarea default). Esc = close back to grid nav.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              if (!overCap) void commit(draft.trim(), true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onOpenChange(false);
            }
          }}
          placeholder="Add a note for this row (optional)"
          rows={3}
          className="text-xs"
          autoFocus
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className={cn("text-[10px]", overCap ? "text-destructive" : "text-muted-foreground")}>
            {draft.length}/{REMARK_MAX_LEN}
          </span>
          <div className="flex items-center gap-1">
            {stored && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={saving}
                onClick={() => commit("", false)}
              >
                Clear
              </Button>
            )}
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={saving || overCap || !dirty}
              onClick={() => commit(draft.trim(), false)}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
        {error && <p className="mt-1 text-[10px] text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The per-cell color affordance: a tiny corner trigger (the cell's td is `relative`) opening
 * an 8-swatch palette + a "Clear color" + an "Apply to whole row" toggle. Picking a swatch
 * calls onApply(token, wholeRow); clear calls onApply("", wholeRow). The grid maps that to
 * one-or-N save_cell_color cells. Rendered only when editable (onSaveColor present).
 */
function ColorPicker({
  current,
  onApply,
}: {
  current?: string;
  onApply: (token: string, wholeRow: boolean) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  // Slice 4a.2: DECOUPLE selection from submission to kill the row-apply race. A swatch
  // click only ARMS a token; the checkbox only toggles wholeRow; NOTHING saves until the
  // explicit Apply (or Clear) button -- which reads {armed, wholeRow} TOGETHER at click
  // time, so there is never a moment a half-set intent is sent.
  const [armed, setArmed] = useState<string | null>(null);
  const [wholeRow, setWholeRow] = useState(false);
  // V2-FIX: close on visibility loss in virtualized mode (overscan-zone ghost, same as RemarkCell).
  const triggerRef = useRef<HTMLButtonElement>(null);
  useCloseWhenScrolledOut(triggerRef, open, () => setOpen(false));

  // submit reads wholeRow LIVE at Apply-time; token is passed explicitly (armed, or "").
  const submit = (token: string) => {
    void Promise.resolve(onApply(token, wholeRow)).finally(() => setOpen(false));
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          // Seed the armed swatch from the cell's current color; reset the row toggle.
          setArmed(current ?? null);
          setWholeRow(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          title="Highlight color"
          // RM-3a Defect 2 (owner option (a)): the colour picker is an ACTION, not status -- hidden at
          // rest, revealed on CELL hover (the parent <td> carries `group`) AND on keyboard focus
          // (focus-visible, so it is never a mouse-only trap). When a colour IS set the swatch still
          // shows the chosen colour once revealed.
          className="absolute left-0.5 top-0.5 z-[5] h-3 w-3 rounded-sm border border-border opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100"
        >
          {current ? (
            <span className={cn("block h-full w-full rounded-sm", swatchClassForToken(current))} />
          ) : (
            <Palette className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2" onKeyDown={(e) => e.stopPropagation()}>
        {/* Swatches only ARM a token (no save). The armed one shows a ring. */}
        <div className="grid grid-cols-4 gap-1">
          {COLOR_TOKENS.map((t) => (
            <button
              key={t}
              type="button"
              title={t}
              onClick={() => setArmed(t)}
              className={cn(
                "h-6 w-6 rounded-sm border border-border",
                swatchClassForToken(t),
                armed === t && "ring-2 ring-offset-1 ring-foreground",
              )}
            />
          ))}
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={wholeRow}
            onChange={(e) => setWholeRow(e.target.checked)}
          />
          Apply to whole row
        </label>
        {/* Apply / Clear are the ONLY things that save -- read {armed, wholeRow} together. */}
        <div className="mt-2 flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 flex-1 px-2 text-xs"
            onClick={() => submit("")}
          >
            Clear
          </Button>
          <Button
            size="sm"
            className="h-7 flex-1 px-2 text-xs"
            disabled={armed === null}
            onClick={() => submit(armed as string)}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Cluster B: the per-cell formula-vs-document reconciliation badge + chooser ───
/** Locale-group an amount for the chooser labels (display only -- not the stored value). */
const fmtReconAmount = (n: number): string =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * The STRONG divergence cue on a divergent amount cell (D2a) + its tiny chooser. The three
 * existing cell channels are taken (background = priced tint; left-border = color annotation;
 * gutter = review-flag marker), so this uses a DISTINCT channel: a solid VIOLET pill (high-
 * contrast, not in the priced/color palette) when UNRESOLVED, a MUTED grey pill when resolved
 * (still visible -- "was a divergence, now decided" -- without nagging). Read-only (onChoose
 * absent) -> a static pill, no popover. Clicking opens a two-option chooser labelled with the
 * document and formula numbers; a resolved cell also offers "Use default" (clear -> document).
 */
function ReconcileBadge({
  documentVal,
  formulaVal,
  resolved,
  onChoose,
}: {
  documentVal: number;
  formulaVal: number;
  resolved: ReconChoice | "unset";
  onChoose?: (choice: ReconChoice | null) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  // V2-FIX: close on visibility loss in virtualized mode (overscan-zone ghost, same as RemarkCell).
  const triggerRef = useRef<HTMLButtonElement>(null);
  useCloseWhenScrolledOut(triggerRef, open, () => setOpen(false));
  const isResolved = resolved !== "unset";
  const title = isResolved
    ? resolved === "take_formula"
      ? "Reconciled: using the formula amount"
      : "Reconciled: keeping the document amount"
    : "Document and formula amounts differ -- choose which value to use";

  const pill = (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1 py-0.5 leading-none",
        isResolved
          ? "bg-muted text-muted-foreground"
          : "bg-violet-600 text-white dark:bg-violet-500",
      )}
    >
      <Scale aria-hidden className="h-3 w-3" />
    </span>
  );

  // Read-only: a static pill (status always visible; no chooser).
  if (!onChoose) {
    return (
      <span className="absolute left-0.5 top-0.5 z-10" title={title} aria-label={title}>
        {pill}
      </span>
    );
  }

  const choose = (choice: ReconChoice | null) => {
    setOpen(false);
    void onChoose(choice);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          title={title}
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0.5 top-0.5 z-10 cursor-pointer"
        >
          {pill}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
        <p className="text-[11px] text-muted-foreground px-1">
          Document and formula amounts differ. Choose which value to use for this cell.
        </p>
        <Button
          type="button"
          variant={resolved === "keep_document" || resolved === "unset" ? "default" : "outline"}
          className="h-auto w-full justify-between py-1.5 text-xs"
          onClick={() => choose("keep_document")}
        >
          <span>Keep document</span>
          <span className="tabular-nums font-medium">{fmtReconAmount(documentVal)}</span>
        </Button>
        <Button
          type="button"
          variant={resolved === "take_formula" ? "default" : "outline"}
          className="h-auto w-full justify-between py-1.5 text-xs"
          onClick={() => choose("take_formula")}
        >
          <span>Use formula</span>
          <span className="tabular-nums font-medium">{fmtReconAmount(formulaVal)}</span>
        </Button>
        {isResolved && (
          <Button
            type="button"
            variant="ghost"
            className="h-auto w-full py-1 text-[11px] text-muted-foreground"
            onClick={() => choose(null)}
          >
            Use default (document)
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface PricingGridProps {
  /** Committed rows for the sheet, prices merged in (get_priced_rows). */
  rows: PricedRow[];
  /** Column descriptors (Excel-column order), passed through from get_priced_rows. */
  columnDescriptors: ColumnDescriptor[];
  /**
   * Slice 3b: save one rate cell. The grid supplies the cell identity (from row +
   * descriptor); the page fills boq/sheet/committed_version + does the POST + mutate
   * refetch. When ABSENT, rate cells render read-only (the 3a behavior). Returns a promise
   * the grid awaits to clear the optimistic draft on success / keep it on failure.
   */
  onSaveRate?: (cell: RateCellSaveArgs, rate: number) => Promise<void>;
  /**
   * Slice A (clipboard): the page-owned BATCH write path for a paste / cut / fill-down gesture
   * (the Q5 finding -- the per-cell save path fires one mutate() per cell, which would thrash on
   * an N-cell paste). The page fires each write through the SAME save_cell_price / save_row_remark
   * endpoints with the per-cell mutate SUPPRESSED, then does ONE trailing mutate() at the end.
   * ABSENT (locked / read-only) => paste/cut/fill no-op (copy still works -- it is internal). Kept
   * SEPARATE from onSaveRate so the inline single-cell edit contract is byte-for-byte unchanged.
   */
  onBatchWrite?: (writes: BatchWrite[]) => Promise<BatchOutcome>;
  /**
   * Slice 3c: surfaces "has uncommitted drafts" UP to the page (drives the "Unsaved
   * changes" status). Called whenever the unsaved-drafts state flips.
   */
  onDirtyChange?: (hasUnsaved: boolean) => void;
  /**
   * Slice B (undo/redo): surfaces the session history's {canUndo, canRedo} UP to the page so the
   * bottom-ribbon Undo/Redo buttons can render their disabled state reactively. Fired in an effect
   * whenever the history stacks change -- the SAME grid->page reactive pattern as onDirtyChange
   * (an imperative-handle method is not reactive). The undo/redo ACTIONS ride PricingGridHandle.
   */
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  /**
   * Priceability override (Slice 3e, per-sheet per-session). Default false. When false, a
   * rate cell is editable ONLY on a priceable row (node_type Preamble / Line Item); a
   * non-priceable row ("Other") renders read-only. When TRUE, the override unlocks editing on
   * non-priceable rows too (the page also sends allow_non_priceable to save_cell_price). A
   * rate saved onto a non-priceable row is marked amber ("needs review") regardless.
   */
  override?: boolean;
  /**
   * MANDATORY amount-formula gate (Phase 5, per-SHEET). When FALSE, NO rate cell is editable --
   * ANDed OUTSIDE isRateEditableRow, so the `override` (which lives INSIDE isRateEditableRow)
   * can NEVER reach past it: no declared formulas => nothing rate-editable, override or not.
   * Default TRUE (back-compat: a sheet with zero amount columns is trivially complete, and
   * existing callers/tests are unaffected). Computed page-side via priceability.areFormulasComplete
   * from columnDescriptors + columnFormulas (already in hand -- no new fetch). onSaveFormula is
   * DELIBERATELY NOT withheld by this gate (declaration must work while rates are locked).
   */
  formulasComplete?: boolean;
  /**
   * CATEGORY GATE (Slice G3a, per-SHEET boolean). When FALSE, NO rate cell is editable -- ANDed
   * OUTSIDE isRateEditableRow, exactly like formulasComplete, so the `override` (INSIDE
   * isRateEditableRow) can NEVER reach past it: an eligible row with a blank category locks the whole
   * sheet, override or not. The page derives it as (blank-count === 0 OR the admin category-gate
   * override is set) from the SAME isMasterSetBlank predicate the amber fill + Check-Category filter
   * use. Default TRUE (back-compat: absent => open, so existing callers/tests are unaffected). Only
   * this BOOLEAN reaches the grid -- NEVER the count (a count changes on every pick and would
   * re-render all rows; the boolean flips only when the gate actually flips, which IS when every
   * row's editability changes).
   */
  categoryGateOpen?: boolean;
  /**
   * Slice 4a: save one row's remark (save_row_remark + mutate). ABSENT => remarks render
   * read-only (the page withholds it when locked/taken-over, mirroring onSaveRate).
   */
  onSaveRemark?: (args: RemarkSaveArgs) => Promise<void>;
  /**
   * Slice 4a: save N color cells (save_cell_color x N + ONE mutate). The grid builds the
   * cell list (a single pick = 1 entry, an apply-to-row = N entries); the page owns the
   * POSTs + the single refetch. ABSENT => colors render read-only (gated like onSaveRate).
   */
  onSaveColor?: (args: ColorSaveArgs[]) => Promise<void>;
  /**
   * Formula Builder F3: the per-COLUMN amount formulas (get_priced_rows.column_formulas) the
   * amount-column header `f = ...` label reads + the builder hydrates from / cycle-checks
   * against. ABSENT/empty -> headers show the "set formula" affordance.
   */
  columnFormulas?: ColumnFormula[];
  /**
   * Formula Builder F3: save one amount-column formula (save_amount_formula + mutate); null
   * formula = clear. ABSENT => the header formula label renders READ-ONLY (the page withholds
   * it when locked/taken-over, mirroring onSaveRate). F3 only AUTHORS the formula -- it does
   * NOT change the amount-cell COMPUTE path (that is F4).
   */
  onSaveFormula?: (args: AmountFormulaSaveArgs) => Promise<void>;
  /**
   * Single-editor lock (slice B). The grid does NOT read these for gating -- the PAGE owns
   * the lock UX: it WITHHOLDS onSaveRate when locked (so all edit gates collapse to the
   * read-only render) and renders the holder banner. These are kept on the props for the
   * contract + are not destructured here (no per-cell editable check -- onSaveRate is the
   * single root gate).
   */
  editable?: boolean;
  lockInfo?: LockInfo | null;
  /**
   * Slice 4b-A: the computed review flags per row (keyed by row_index), built page-side by
   * priceability.computeRowFlags. The grid READS them to render an in-grid marker (a left
   * accent + icon in the Excel-Row gutter) -- it does NOT compute them (the page owns the
   * single shared derivation, also feeding the strip + the count). ABSENT/empty -> no markers.
   * Passed as a prop (NOT imported from priceability) so the grid never imports priceability,
   * which imports the grid -- that would be a cycle.
   */
  rowFlags?: Map<number, RowReviewFlags>;
  /**
   * Slice 4c: full-screen editor. When TRUE, the grid's OUTER scroll container relaxes its
   * `max-h-[calc(100vh-14rem)]` cap to `flex-1 min-h-0` so it fills the taller full-viewport
   * layout (the page's expanded root is `flex flex-col`). Default false (embedded layout,
   * back-compat). LAYOUT-ONLY: it touches ONLY the outer container class -- it is NOT a per-row
   * prop, never enters PricingGridRowProps / pricingRowPropsAreEqual, so the row memo is intact.
   */
  expanded?: boolean;
  /**
   * Cluster B: the current per-CELL formula-vs-document reconciliation choices
   * (get_priced_rows.reconciliation_choices). The grid builds an O(1) map keyed
   * "<excel_row>:<col_letter>" and reads it per amount cell to detect/resolve a divergence
   * (D1 document-default). ABSENT/empty -> every cell is "unset" (document wins on divergence).
   */
  reconChoices?: ReconciliationChoiceRef[];
  /**
   * CL-2: per-EXCEL-ROW category verdicts (get_sheet_categories), built page-side into a
   * reference-stable Map keyed by excel_row. The grid READS it to render the read-only Category
   * column (effective_category_id + a "needs review" amber cue). DISPLAY ONLY -- editing the
   * verdict is CL-3's concern (wired via onCategoryClick below). ABSENT/empty => blank Category cells.
   */
  categoriesByExcelRow?: Map<number, SheetCategoryRow>;
  /**
   * CL-6: whether the sheet has been classified at least once (any engine has run). Grid-LEVEL
   * (flips identically for all rows), page-computed as `categoriesByExcelRow.size > 0`. Gates
   * click-to-edit on a BLANK eligible cell: an eligible (Preamble/Line Item) blank cell is
   * clickable only once the sheet has run. NOT a per-row prop -> the row memo is untouched (it
   * only ever flips together with a categoriesByExcelRow reference change, which the comparator
   * already tracks). Default false (never-run sheet => no blank cell is clickable).
   */
  hasRun?: boolean;
  /**
   * CL-3: the page-owned open callback for the category verdict picker. The grid calls it with
   * the row's Excel row + the clicked cell element (the picker's virtual anchor); the PAGE owns
   * the picker + the write. Reference-stable (a page useCallback) -> memo-safe. ABSENT => the
   * Category cell is display-only (no click-to-edit). WITHHELD by the page when locked/taken-over.
   */
  onCategoryClick?: (excelRow: number, cellEl: HTMLElement) => void;
  /**
   * U1 rate-helper (dev): page-owned suggestion state per Excel row (built by pressing "Suggest
   * rates"). A reference-stable Map that changes only on a run / a "Use this value" (like
   * categoriesByExcelRow) -- NEVER on keystroke. Each row reads ONLY its own entry (by value in the
   * comparator), so a rebuild re-renders just the rows whose badges changed. ABSENT/empty => no badges.
   */
  rowSuggestionsByExcelRow?: Map<number, RowSuggestions>;
  /**
   * U1 rate-helper (dev): open the suggestion panel for a rate cell (Excel row + column letter +
   * the clicked cell element for scoping). Reference-stable (page useCallback) -> memo-safe. The
   * badge's own onClick calls it with stopPropagation, so a bare cell click still just places the
   * cursor. ABSENT => no badges are interactive (the feature is off).
   */
  onSuggestionBadgeClick?: (excelRow: number, col: string, cellEl: HTMLElement) => void;
  /**
   * SELECTED-ROW runs (grid-level). `tickableRows` is the SERVER's run-eligible excel-row set,
   * surfaced by get_active_suggestion_run -- never re-derived here, because FOUR definitions of
   * "eligible" live in this screen and they disagree by real numbers: the priceable master set
   * (Line Item / Preamble), priceability's priceable LINE (qty in a rate-column area), the
   * rate-editable set the badges render on, and the run's own population. On the reference sheet
   * those are 164 / 139 / 94. A client-side copy would be a FIFTH definition, free to drift, and
   * the drift would present as ticks the run silently ignores.
   *
   * ⚠️ Both arrive as SETS and are reduced to per-row BOOLEANS in renderRow. A COUNT must NEVER
   * reach the memoized row -- it changes on every tick and would re-render all ~1,093 rows. The
   * booleans flip only for the row actually ticked (the `openRemark` shape).
   */
  tickableRows?: ReadonlySet<number>;
  selectedRows?: ReadonlySet<number>;
  /** Reference-stable page callback; ABSENT => no tick column at all (no run yet / feature off). */
  onToggleTick?: (excelRow: number) => void;
  /**
   * SELROW filter (grid-level, header only). `showOnlyTicked` drives the header toggle's pressed
   * state; `onToggleTicked` flips it. BOTH stay OUT of `pricingRowPropsAreEqual` -- the FILTERING
   * itself happens page-side in `passesViewFilter` (the ONE place view filters compose), so the row
   * never learns about it and the memo is untouched. ABSENT => no toggle rendered.
   */
  showOnlyTicked?: boolean;
  onToggleTicked?: () => void;
  /**
   * CL-3: id -> label for the Category cell's DISPLAY (from classify.get_category_catalog). A
   * reference-stable Map (page-built, changes only on fetch, never on keystroke) -> memo-safe.
   * ABSENT/empty => the cell falls back to the raw category id (labelFor).
   */
  categoryLabelById?: Map<string, string>;
  /**
   * Cluster B: choose (keep_document/take_formula) or clear the reconciliation choice for one
   * divergent amount cell (save_cell_reconciliation_choice + mutate). ABSENT => the divergence
   * cue renders read-only (a static pill, no chooser) -- the page withholds it when
   * locked/taken-over, mirroring onSaveRate/onSaveColor.
   */
  onSaveReconChoice?: (args: ReconChoiceSaveArgs) => Promise<void>;
  /**
   * Toolbar Part 1 -- column-hide. The set of NON-AMOUNT descriptor `col` letters the user has
   * hidden (page-owned, per-session). The grid filters its render/nav descriptor set by it;
   * amount columns are NEVER hidden (isColumnVisible). ABSENT/empty => all columns visible
   * (default, back-compat). A per-GRID prop -- it changes displayDescriptors' reference for the
   * row, so a hide re-renders all rows ONCE (like formulasComplete); it is NOT a per-row prop.
   */
  /**
   * U1 -- the two header column filters (Row Type + Category). PER-GRID props, deliberately NOT
   * per-row: the SELECTION acts on the row SET upstream (SheetPricingPage.passesViewFilter), so the
   * grid only needs enough to render the funnel + its ticks. None of these enter
   * `pricingRowPropsAreEqual`; a keystroke in the popover's search box never reaches here at all
   * (that state is LOCAL to GridColumnFilter -- see the note in that file).
   *
   * The option lists are page-side useMemos computed ONCE per sheet; the selections are page-owned
   * Sets of stable IDS (never labels -- "filter on the label, match on the id"); the callbacks are
   * page useCallbacks. All identity-stable, so the PricingGrid React.memo shield holds.
   */
  rowTypeFilterOptions?: readonly ColumnFilterOption[];
  rowTypeFilter?: ReadonlySet<string>;
  onRowTypeFilterChange?: (next: ReadonlySet<string>) => void;
  categoryFilterOptions?: readonly ColumnFilterOption[];
  categoryFilter?: ReadonlySet<string>;
  onCategoryFilterChange?: (next: ReadonlySet<string>) => void;
  hiddenCols?: Set<string>;
  /**
   * Toolbar Part 1 -- description search. The Excel row number (source_row_number) of the
   * CURRENT search hit, or null when there is no active search/hit. The grid derives a per-row
   * `isCurrentHit` boolean from it (the ONE search signal that enters the row memo). The page
   * owns the query + hit-stepper + scrollToRow jump; the grid only paints the highlight.
   */
  currentHitExcelRow?: number | null;
  /**
   * Hierarchy collapse/expand (per-GRID; NEVER a per-row prop, so the row memo is untouched --
   * R6). `collapsed` = the set of collapsed parents' row_index (page-owned: it ALSO composes the
   * upstream displayRows filter, so the rows handed to the grid are already collapse-filtered).
   * `childrenByParent` is built over the FULL (unfiltered) rows so descendant/visibility math is
   * filter-independent. `onToggleCollapse` flips one parent. These feed CollapseContext -> the
   * chevrons; they are NOT in PricingGridRowProps / pricingRowPropsAreEqual. ABSENT => no chevrons
   * (back-compat: a caller that omits them gets the prior flat render).
   */
  collapsed?: Set<number>;
  childrenByParent?: Map<number, number[]>;
  onToggleCollapse?: (rowIndex: number) => void;
  /**
   * Reveal-then-scroll (R5): expand a target row's collapsed ANCESTORS before the jump scrolls,
   * so a jump into a collapsed parent no longer silently no-ops. The grid's `jumpToRow` (the ONE
   * jump path -- parent-click + search-step + review-strip all route through it) calls this FIRST;
   * the page expands the ancestors and returns TRUE iff it changed anything, so the grid defers
   * the scroll one tick (let the reveal re-render land) only when needed. ABSENT => plain scroll.
   */
  onRevealRow?: (excelRow: number) => boolean;
  /**
   * Frozen-left Slice 1: when true, render the grid as a TWO-PANE split -- the 5 anchor columns
   * (Excel row / Sl.No / Parent / Classification / Description) pinned in a non-horizontally-
   * scrolling FROZEN pane; the descriptor + Remarks columns in a SCROLLING pane that owns
   * overflow-x AND overflow-y and mirrors its vertical scroll to the frozen pane. Row heights are
   * MEASURED at the freeze transition and applied identically to both panes so the rows stay
   * aligned by construction. Default false = today's single table (byte-for-byte). The PAGE owns
   * the toggle and gates it OFF for grid-only sheets (which render via SheetDataGrid, not here).
   */
  frozen?: boolean;
  /** V1: windowed rendering (only visible rows + overscan mounted), via @tanstack/react-virtual.
   * The PAGE owns the A/B toggle (default true each open, session-scoped). false = the CLASSIC
   * render path, byte-identical to pre-V1. Stable boolean -> the V0 memo shield holds. */
  virtualized?: boolean;
  /**
   * BCS-S3a -- the cost boxes a sheet gets, from `bcsColumns.bcsLiveRateKinds` over the sheet's
   * own rate columns. Page-computed and useMemo'd (V0 memo shield). EMPTY (the default) = no BCS
   * block at all, so every colIndex below is byte-identical to pre-S3a: `bcsColStart ===
   * remarksColIndex` and the whole family of carve-outs collapses.
   *
   * The page passes [] not only for a sheet with no rate column but for one where BCS is off,
   * unconfirmed, or whose state could not be READ -- an unknown BCS state must never present as
   * an empty, editable cost cell (bcsToggleState, S2a finding F1).
   */
  bcsKinds?: BcsRateKind[];
  /**
   * BCS-S3a -- the CURRENT stored cost rows (`bcs.get_sheet_bcs_rates`), keyed by Excel row.
   * Page-fetched into a reference-stable Map that changes only on a fetch, exactly like
   * `categoriesByExcelRow`. Each row reads ONLY its own entry (P1: NEVER the whole Map through
   * the row memo). ABSENT/empty => every row is uncosted, and its Total Amount is blank.
   */
  bcsRatesByExcelRow?: Map<number, BcsRowRate>;
  /**
   * BCS-S3a -- the CONFIRMED Total Quantity columns (`bcs_qty_source`), the multiplicand of
   * Total Amount. Read through `bcsRowQuantity`, which sums the stored entries whatever the
   * mode. ABSENT => no quantity => a blank Total, never a 0.
   */
  bcsQtySource?: BcsSource | null;
  /**
   * BCS-S3b -- the CONFIRMED Amount columns (`bcs_amount_source`): what the client is charged
   * for the row. It fills the Tendered Total Amount column and is therefore % Margin's
   * DENOMINATOR. Read through `bcsRowAmount`, which sums the stored entries whatever the mode,
   * over the figure each amount cell is SHOWING (owner ruling -- reconciliation choice and all).
   * ABSENT => no amount => a blank Tendered column and a blank % Margin, never a 0.
   */
  bcsAmountSource?: BcsSource | null;
  /**
   * BCS-S3a -- save ONE row's cost rates (`save_row_bcs_rates`). ⚠️ WHOLE-ROW: the args always
   * carry all three stored fields (see `gatherBcsRowRates`).
   *
   * WITHHELD by the page when the sheet is locked / taken over / BCS is not ready -- that
   * absence IS the read-only gate, exactly as for onSaveRate and onSaveRemark. There is
   * deliberately no second per-cell `editable` signal.
   */
  onSaveBcsRates?: (args: BcsRowSaveArgs) => Promise<void>;
  /**
   * BCS-S3a -- why the cost boxes are read-only, from the pure `bcsCostEntryReason` (which
   * mirrors `save_row_bcs_rates`' OWN gate order, NOT the client rate gate). Rendered as the
   * cell title so a dead box always says why. null/absent when writable.
   */
  bcsReadOnlyReason?: string | null;
  /**
   * ── BCS-S13: the % Margin RANGE FILTER, opened from the % Margin column header ──────────────
   * The applied bounds AS TYPED (`""` = open on that side) and the matched row count, both
   * DISPLAY ONLY -- the grid renders them into the header control and never filters on them.
   * The page owns the bounds, owns the matched set, and has ALREADY applied it to the `rows` it
   * hands down, exactly as it does for the view filters and collapse.
   *
   * SCALARS on purpose. The V0 memo shield is React's DEFAULT shallow compare, so a
   * `{from, to}` object here would mint a fresh reference every render and kill it outright;
   * two strings and a number compare by value and cost nothing.
   */
  marginFrom?: string;
  marginTo?: string;
  marginRangeCount?: number | null;
  /**
   * ── BCS-S14: the % Margin IN-PLACE SORT ────────────────────────────────────────────────────
   * Which way the sheet is currently ordered by % Margin, or null for the sheet's own document
   * order (the default). DISPLAY + TREE-CLAIMS ONLY -- the grid NEVER sorts; `rows` arrives
   * already ordered by the page, exactly as it arrives already filtered and collapsed.
   *
   * What this scalar changes here is what the TREE affordances would otherwise CLAIM about a
   * margin-ordered row set, and it is the same pair the deleted margin view had to suppress:
   *   - DEPTH IS FORCED FLAT. Indentation asserts nesting under the row above it; after a sort
   *     that parent is hundreds of rows away, and `computeDepths` would not even reproduce the
   *     tree's own numbers, since a chain-walk over re-ordered rows is meaningless.
   *   - CHEVRONS GO (the page withholds `childrenByParent`), because a collapse would fold rows
   *     that are no longer underneath the parent offering to fold them.
   * It also drives the header arrow's glyph and the `aria-sort` announcement.
   */
  marginSortDir?: MarginSortDir | null;
  /**
   * ── The empty-result ESCAPE HATCH ──────────────────────────────────────────────────────────
   * TRUE when ANY view filter is narrowing the rows. Read ONLY by the `rows.length === 0` early
   * return, to tell "this sheet has nothing in it" apart from "your filters hid everything" --
   * two states that look identical on screen and call for opposite reactions.
   *
   * ⚠️ IT EXISTS BECAUSE A CONTROL CAN HIDE ITSELF. The % Margin funnel and sort arrow live in
   * the column header, so a filter that empties the grid removes the header AND the only way to
   * undo it. `onClearViewFilters` is that way back, and the page must reset EVERY view filter
   * from it -- clearing only the margin range would strand someone whose empty result came from
   * Show-unpriced instead.
   */
  viewFiltersActive?: boolean;
  /** Reset every view filter. Withheld => the empty state is a message only. */
  onClearViewFilters?: () => void;
  /**
   * BCS-S14 -- advance the sort (off -> asc -> desc -> off). Fired ONLY by the header arrow.
   *
   * ⚠️ NEVER CALL THIS FROM A RENDER, AN EFFECT OR A KEYSTROKE. `activeCell` is ARRAY-INDEX
   * addressed and clipboard selection is a contiguous array RANGE over the same indices, so a
   * re-order while a cell is focused slides a different row under the cursor and the next
   * character lands on it. Absent => no arrow renders.
   */
  onCycleMarginSort?: () => void;
  /**
   * BCS-S13 -- apply the range (two blanks = clear). Must be a `useCallback` on the page side
   * for the same memo-shield reason.
   *
   * ⚠️ ITS ABSENCE IS NOT A READ-ONLY SIGNAL, unlike every other callback on this interface.
   * The "gating = presence of the save callback" rule covers WRITES; filtering writes nothing,
   * and a locked or taken-over sheet is precisely when someone is reading rather than editing.
   * The page supplies it unconditionally; it is optional only so the grid's other callers (and
   * the tests) need not know about it.
   */
  onApplyMarginRange?: (from: string, to: string) => void;
}

/** Slice 3c: imperative handle the page holds (via a ref) to force-flush pending saves. */
export interface PricingGridHandle {
  /** Fire all pending debounced saves now + retry any remaining uncommitted draft. */
  flush: () => void;
  /**
   * BCS-S4 -- every given row's % Margin RIGHT NOW, keyed by row_index (null where the row has
   * none). BCS-S4 introduced it as the margin VIEW's sort key; with that view gone it is the
   * % Margin RANGE FILTER's membership test, and the reasons below transfer unchanged -- both
   * needed the same number the same way, which is why the handle survived the view it was built
   * for.
   *
   * ⚠️ IT LIVES ON THE HANDLE, NOT IN THE PAGE, BECAUSE THE DRAFTS DO. A margin depends on cost
   * and rate values typed but not yet saved, which exist only inside this component; a page-side
   * re-implementation would filter on the last SAVED figures and disagree with the % Margin
   * column a user is reading. Same number, one composition (`computeBcsRowCells`).
   *
   * ⚠️ IT TAKES THE ROWS TO MEASURE. The grid's own `rows` prop is the DISPLAYED set -- already
   * filtered and collapsed -- and the range must be decided over the WHOLE sheet, or the filter
   * would narrow itself every time it was re-applied.
   *
   * Imperative BY DESIGN: called on an explicit Apply and nowhere else, never subscribed to. A
   * reactive margin feed would make rows leave the grid while someone types into a cost box.
   */
  computeMargins: (rowsToMeasure: PricedRow[]) => Map<number, number | null>;
  /** Slice 4a: scroll a row into view by its Excel row number (the review-list jump). */
  scrollToRow: (excelRow: number) => void;
  /** Slice B: undo the most recent rate gesture (no-op when nothing to undo / read-only). */
  undo: () => void;
  /** Slice B: redo the most recently undone rate gesture (no-op when nothing to redo / read-only). */
  redo: () => void;
  /** U1 rate-helper: apply a value to a rate cell (excelRow + Excel column letter) through the SAME
   * commitRate path a typed value takes -- optimistic draft, undo history, in-flight/takeover,
   * autosave/refetch. No-op if the cell is not an editable rate cell (onSaveRate withheld => locked).
   * The ONE write the "Use this value" affordance calls; it adds no second save path. */
  applyRate: (excelRow: number, col: string, value: number) => void;
}

// ── Editor perf fix: PricingGrid row-level memoization (recon items 1+2) ─────────
// The cursor (`activeCell`) is grid-local state, so a cursor move (arrow key / click)
// re-renders PricingGrid. Without per-row memoization the WHOLE table re-renders --
// every row x every cell, re-running evaluateAmountCell at every amount cell -- work the
// changed cell does not need; on a 194-row sheet that is the felt lag. We extract the
// per-row <tr> into a React.memo'd PricingGridRow so a cursor move re-renders only the 2
// rows whose active-state flipped, and a keystroke only the 1 edited row. NO behaviour
// change -- same flags / markers / amounts / nav, computed fewer times.

// `${rowIndex}:${col}` -- the draftRates / proposedRates key (DATA row_index, NOT the array
// nav index). Module-level (pure) so commitRate's useCallback need not list it.
const cellKey = (rowIndex: number, col: string) => `${rowIndex}:${col}`;
// `${rowIndex}:${colIndex}` -- the cellRefs / nav-matrix key (ARRAY index + colIndex). A
// SEPARATE key space from cellKey (which uses the DATA row_index). Do not conflate them.
const navKey = (r: number, c: number) => `${r}:${c}`;
// Parent click-to-jump: resolve a row's PARENT Excel row number from the row's
// effective_parent_index + the row_index->row map (byIdx). A root row (effective_parent_index
// null or the -1 sentinel) -> null (no jump target); a parent not present in the rendered set's
// map -> null too (safe -- the click then no-ops). Pure -> module-level + unit-tested. Mirrors
// the inline resolution the row render and the imperative scrollToRow already use (one source).
export function parentExcelRowOf(
  row: PricedRow,
  byIdx: Map<number, PricedRow>,
): number | null {
  const pIdx = row.effective_parent_index ?? -1;
  if (pIdx < 0) return null;
  return byIdx.get(pIdx)?.source_row_number ?? null;
}
// A row's saved (committed/merged) rate as a string for the input value. Pure (only reads
// the row via resolveDescriptorValue) -> module-level so it is reference-stable.
const savedRateStr = (row: PricedRow, d: ColumnDescriptor): string => {
  const v = resolveDescriptorValue(row, d);
  return v === null || v === undefined ? "" : String(v);
};

// A stable empty slice for a row with no drafts/proposals -- a shared frozen reference so
// such rows never get a fresh `{}` per render (which would defeat the memo). Read-only by
// the row (lookups only; never mutated).
const EMPTY_SLICE: Record<string, string> = Object.freeze({});

// CL-2: a stable empty category map for the default (no categories fetched) case -- a shared
// reference so the row memo is never defeated by a fresh Map per render.
const EMPTY_CATEGORY_MAP: Map<number, SheetCategoryRow> = new Map();

// CL-3: a stable empty id->label map for the default (no catalog fetched) case -- a shared
// reference so the row memo is never defeated by a fresh Map per render.
// U1: module-level EMPTY defaults -- a fresh `new Set()` / `[]` in the destructuring default
// would mint a new identity on EVERY render and defeat the PricingGrid React.memo shield.
const EMPTY_FILTER_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_FILTER_OPTIONS: readonly ColumnFilterOption[] = [];
const EMPTY_CATEGORY_LABEL_MAP: Map<string, string> = new Map();
// U1 rate-helper: stable empty default so an absent prop never churns the memo.
const EMPTY_SUGGESTIONS_MAP: Map<number, RowSuggestions> = new Map();
// SELECTED-ROW runs: module-level empties so a destructuring DEFAULT cannot mint a new identity
// per render and defeat the PricingGrid memo (the EMPTY_FILTER_SET precedent).
const EMPTY_ROW_SET: ReadonlySet<number> = new Set<number>();
// BCS-S3a: stable empty defaults -- an absent cost block must not mint a fresh [] / Map per
// render, which would defeat the row memo AND the V0 grid-level memo shield.
// BCS-S9: the formula TARGET for the BCS Total Amount column, shaped as a ColumnDescriptor so
// AmountFormulaBuilder can address it exactly as it addresses an amount column.
//
// ⚠️ `col` IS DELIBERATELY EMPTY, and it must stay that way. A BCS formula has no Excel column
// -- that absence is what stops it being written into an exported workbook. The builder sends
// this straight through to save_amount_formula's target_col, and the server forces it null for
// a BCS target anyway; agreeing with the server here means the two can never argue about it.
const BCS_TOTAL_TARGET_DESCRIPTOR: ColumnDescriptor = {
  col: "",
  role: "bcs_total",
  area: null,
  value_field: BCS_TOTAL_TARGET,
  value_key: null,
  rate_subkey: null,
};

// BCS-S12b: `bcs_qty` was RETIRED from the palettes at S12 (the formula now names the sheet's
// real quantity column). Formulas stored before that still contain it, and a retired operand
// still needs a NAME -- without this entry such a formula hydrated showing a chip reading
// "bcs_qty". `hidden` keeps it out of the chip list while leaving it resolvable.
const LEGACY_QTY_LABEL_ENTRY = [
  {
    ref: { value_field: BCS_QTY_OPERAND_FIELD, value_key: null, rate_subkey: null } as AmountFormulaRef,
    label: "Total Quantity",
    group: "Quantity",
    hidden: true,
  },
];

const EMPTY_BCS_KINDS: BcsRateKind[] = [];
const EMPTY_BCS_RATES_MAP: Map<number, BcsRowRate> = new Map();
// BCS-S14: the flat depths a margin-SORTED sheet renders with. Module-level so the sorted branch
// hands the same Map reference on every render -- a fresh `new Map()` inside the memo would make
// `depths` churn and re-render every row on any unrelated re-render.
const FLAT_DEPTHS: Map<number, number> = new Map();
// The BCS draft key: `${row_index}:${field}`. A SEPARATE key space from cellKey's
// `${row_index}:${col}` because it lives in its OWN state map -- BCS values must never be
// merged into draftRates, which would churn every rate cell's slice on a cost keystroke and
// defeat shallowEqualStrMap for unrelated rate edits on the same row.
export const bcsCellKey = (rowIndex: number, field: BcsRateField) => `${rowIndex}:${field}`;

/**
 * ★ THE ONE TRANSLATOR BETWEEN THE TWO BCS KEY SPACES. Read this before touching a cost draft.
 *
 * `draftBcsRates` -- and every per-row slice `groupDraftsByRow` cuts out of it -- is keyed
 * `${row_index}:${field}`. `bcsColumns.mergeBcsRowValues` reads BARE `BcsRateField` keys. The two
 * are DIFFERENT KEY SPACES that share a type (`Record<string, string>`), so passing one where the
 * other is wanted type-checks perfectly and silently finds nothing.
 *
 * ⚠️ THAT IS NOT HYPOTHETICAL -- IT SHIPPED. BCS-S3a passed a raw slice into `mergeBcsRowValues`
 * behind an `as Partial<Record<BcsRateField, string>>` cast (the cast was the only reason `tsc`
 * stayed silent). Every lookup missed, so the cost `<Input>` -- CONTROLLED on the merged value --
 * re-rendered back to the stored value on every keystroke, and the 1 s debounce could commit a
 * number the user never typed. A data-corruption path, not a display bug.
 *
 * It hid because TWO PASSING TESTS pinned the two key spaces and never met: one pins that
 * `groupDraftsByRow` keeps FULL keys, the other pins that `mergeBcsRowValues` reads BARE ones.
 * The only place they met was a rendered component, and this repo has NO DOM test environment by
 * deliberate choice. So the translation is now a NAMED, EXPORTED, PURE function with exactly one
 * definition -- which is a place a test can stand.
 *
 * ⚠️ AND IT RETURNS A `Map`, WHICH IS LOAD-BEARING. Removing the cast was NOT enough on its own:
 * a `Record<string, string>` is structurally assignable to an all-optional
 * `Partial<Record<BcsRateField, string>>`, so the same mistake still compiled silently with no
 * cast at all (measured -- `tsc` reported nothing). A `Record` is NOT assignable to a `Map`, so
 * `mergeBcsRowValues` now takes a `ReadonlyMap` and the wrong key space is a COMPILE ERROR.
 *
 * It accepts BOTH the whole `draftBcsRates` map and one row's `groupDraftsByRow` slice, because a
 * slice keeps full keys. It iterates `BCS_RATE_FIELDS` (the canonical stored-field list) rather
 * than the KIND vocabulary, so a fourth stored rate with no live box would still be carried.
 */
export function bcsDraftsForRow(
  rowIndex: number,
  drafts: Record<string, string>,
): Map<BcsRateField, string> {
  const out = new Map<BcsRateField, string>();
  for (const f of BCS_RATE_FIELDS) {
    const v = drafts[bcsCellKey(rowIndex, f)];
    if (v !== undefined) out.set(f, v);
  }
  return out;
}

/**
 * ★ THE BCS COST BLOCK'S ARITHMETIC FOR ONE ROW. ONE COMPOSITION, TWO READERS (slice BCS-S4).
 *
 * Every number in the cost block -- the box values, Total Amount, Tendered Total Amount and
 * % Margin -- comes from here. It was inline in `PricingGridRow`'s render until BCS-S4 needed the
 * SAME margin outside a render: first to order the margin view, now (BCS-S13) to decide which
 * rows a % Margin range matches. The number the filter tests and the cell a user reads must be
 * the same number, and two compositions is how they stop being.
 *
 * ⚠️ IT IS THE COMPOSITION THAT LIVES HERE, NOT THE ARITHMETIC. Every operation is a `bcsColumns`
 * export (`mergeBcsRowValues` / `bcsUnitCost` / `bcsTotalAmountCell` / `bcsRowAmount` /
 * `bcsTenderedAmountCell` / `bcsMarginPercent`) and stays there -- that module is the owner of what
 * a margin IS, including the sign guard and the blank-with-a-reason discipline. This function only
 * says in what order they are applied and where the operands come from.
 *
 * ⚠️ IT READS THE ROW'S LIVE DRAFTS, and that is why the range filter can match on a cost typed
 * one second ago with nothing saved. `rowBcsDrafts` is FULL-KEY (`${row_index}:${field}`) and
 * `mergeBcsRowValues` reads BARE keys -- it goes through `bcsDraftsForRow`, NEVER a cast; that cast
 * is the BCS-S3a defect the type system now refuses.
 *
 * ⚠️ THE DENOMINATOR IS THE FIGURE ON SCREEN (owner ruling), reconciliation choice and all -- hence
 * `shownAmountValue` over `evaluateAmountCell`, not the raw committed value. A `BcsColumnEntry` IS
 * a `ColumnDescriptor` (identical six fields), so no cast: let the descriptor gain a seventh
 * required field and this breaks loudly, which is the point.
 */
export function computeBcsRowCells(input: {
  row: PricedRow;
  bcsRow: BcsRowRate | undefined;
  rowBcsDrafts: Record<string, string>;
  bcsKinds: readonly BcsRateKind[];
  bcsQty: number | null;
  bcsAmountSource: BcsSource | null | undefined;
  /** BCS-S9: this sheet's declared BCS Total formula, or null for the built-in rule. */
  bcsTotalFormula?: AmountFormulaNode | null;
  columnDescriptors: ColumnDescriptor[];
  columnFormulas: ColumnFormula[];
  rowDraftRates: Record<string, string>;
  reconChoiceMap: Map<string, ReconChoice>;
}): {
  merged: Record<BcsRateField, string | null>;
  unit: number | null;
  totalCell: BcsComputedCell;
  amountCell: BcsComputedCell;
  marginCell: BcsComputedCell;
} {
  const { row, bcsKinds, columnDescriptors, columnFormulas, rowDraftRates, reconChoiceMap } = input;
  // ONE merge per row, several readers: the boxes' displayed values, the Total's multiplicand and
  // (via gatherBcsRowRates at commit time) the saved payload. Sharing it is what stops the number
  // shown from differing from the number written.
  const merged = mergeBcsRowValues(input.bcsRow, bcsDraftsForRow(row.row_index, input.rowBcsDrafts));
  const unit = bcsUnitCost(merged, bcsKinds);
  // BCS-S9: through the SHARED `bcsTotalCell`, which pricingRollup also calls -- see its
  // docblock for why two copies of this rule stopped being survivable once it became data.
  // BCS-S12: a BCS formula may now name one of the SHEET's own columns (its real quantity
  // column). `resolveDescriptorValue` is the same reader the grid uses for that cell, so the
  // number the formula multiplies by is the number printed in that column.
  const resolveSheetColumn = (ref: AmountFormulaRef): number | null => {
    const raw = resolveDescriptorValue(row, ref as unknown as ColumnDescriptor);
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  };
  const totalCell = bcsTotalCell(
    input.bcsTotalFormula ?? pickBcsTotalFormula(columnFormulas),
    input.bcsQty,
    merged,
    bcsKinds,
    resolveSheetColumn,
  );
  // BCS-S10: the denominator through the SHARED `boqTotalAmount`, so an edited BOQ Total formula
  // moves the margin. The `evaluate` callback is UNCHANGED and still returns the figure that
  // would be on screen (formula + reconciliation resolved) -- that owner ruling did not move.
  const amountCell = bcsTenderedAmountCell(
    boqTotalAmount(pickBoqTotalFormula(columnFormulas), input.bcsAmountSource, (entry) => {
      const cell = evaluateAmountCell(entry, row, columnDescriptors, columnFormulas, rowDraftRates);
      const raw = resolveDescriptorValue(row, entry);
      return shownAmountValue(
        cell,
        typeof raw === "number" ? raw : null,
        reconChoiceMap.get(reconChoiceKey(row.source_row_number, entry.col)),
      );
    },
      // The S12e fallback: with no confirmed amount source the sheet's OWN amount columns are
      // the denominator. Without this the margin stayed blank while BCS Total computed fine.
      columnDescriptors,
    ),
  );
  // BCS-S11: the numerator may be re-pointed (BCS Total by default, or the raw cost boxes).
  // The RATIO's shape stays here, in code, so bcsMarginPercent's three guards -- zero, negative
  // and non-finite denominator -- run whatever either slot was configured to.
  const costCell = marginCostCell(
    pickMarginCostFormula(columnFormulas),
    totalCell,
    merged,
    input.bcsQty,
    resolveSheetColumn,
  );
  return { merged, unit, totalCell, amountCell, marginCell: bcsMarginPercent(costCell, amountCell) };
}

/**
 * Which optimistic draft layers a BATCH (paste / cut / fill-down) drops when its promise settles.
 * Pure policy, named so the ASYMMETRY is visible and testable rather than buried in a `.finally`.
 *
 * ⚠️ THE TWO LAYERS ARE NOT ALIKE, AND S3a TREATED THEM AS IF THEY WERE. `runBatch` dropped both
 * in a single `.finally()`, so a batch that POSTed successfully but whose trailing refetch then
 * REJECTED lost the drafts AND left the saved map stale. On a row with no prior stored record the
 * next inline edit gathers that stale map and writes 0.0 for the pasted sibling -- because
 * `save_row_bcs_rates` is a WHOLE-ROW SNAPSHOT WRITE. The pasted number is destroyed by an edit to
 * a different box.
 *
 *   * RATES drop on ANY settlement (unchanged, pre-S3a certified). `save_cell_price` is a PER-CELL
 *     write, so falling back to the last saved value is honest and cannot harm a neighbour.
 *   * COST drafts SURVIVE A REJECTION, matching what the inline path already guarantees
 *     (`commitBcsRate` keeps the draft in its `.catch` so the user still sees what they typed and
 *     the next gather reads the live value, not a stale one).
 *
 * A partial mid-batch failure still RESOLVES (`{written, failed}`) -- the refetch landed, so both
 * layers drop, exactly as before. Only a genuine rejection is treated differently.
 */
export function batchDraftsToDrop(settled: "fulfilled" | "rejected"): {
  rates: boolean;
  bcs: boolean;
} {
  return { rates: true, bcs: settled === "fulfilled" };
}

/** Shallow string-map equality (key set + values). Pure -- unit-tested. */
function shallowEqualStrMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Group a flat `${rowIndex}:${col}` -> value map into per-row sub-maps (FULL keys kept), so a
 * memoized row receives ONLY its own draft slice, never the shared draftRates object. The
 * sub-map of a row whose contents are unchanged is REUSED from `prev` (reference-stable), so a
 * keystroke in row X does not change row Y's slice identity -> only the edited row re-renders.
 * Pure (given prev) -- unit-tested. This is the load-bearing anti-defeat mechanism.
 */
export function groupDraftsByRow(
  drafts: Record<string, string>,
  prev: Map<number, Record<string, string>>,
): Map<number, Record<string, string>> {
  const grouped = new Map<number, Record<string, string>>();
  for (const key of Object.keys(drafts)) {
    const sep = key.indexOf(":");
    if (sep < 0) continue;
    const ri = Number(key.slice(0, sep));
    let g = grouped.get(ri);
    if (!g) {
      g = {};
      grouped.set(ri, g);
    }
    g[key] = drafts[key];
  }
  const out = new Map<number, Record<string, string>>();
  for (const [ri, slice] of grouped) {
    const old = prev.get(ri);
    out.set(ri, old && shallowEqualStrMap(old, slice) ? old : slice);
  }
  return out;
}

// ── Hierarchy collapse/expand (the "collapse/expand" slice) ──────────────────────
// The chevron + "+N hidden" badge live INSIDE the memoized PricingGridRow, but their state
// (which parents are collapsed + the live descendant count) is GRID-LEVEL and changes on a
// collapse toggle. To flip the toggled parent's chevron WITHOUT busting the row memo (R6:
// collapse adds NOTHING to pricingRowPropsAreEqual), the chevron is a SEPARATE component
// (`RowChevron`) that reads this CONTEXT. A context change re-renders ONLY the consumers
// (the chevrons) -- the memoized PricingGridRow (which does NOT read the context) is skipped,
// so a keystroke/cursor move is unaffected and a collapse toggle re-paints just the chevrons.
// This is the "derived, not carried on the row" rule: the chevron derives its state from the
// context, never from a per-row prop. The PAGE owns `collapsed` (it composes the upstream
// displayRows filter); the grid receives it + `childrenByParent` (built over the FULL rows) +
// `onToggleCollapse` as GRID-LEVEL props and exposes them here.
interface CollapseCtx {
  collapsed: Set<number>;
  childrenByParent: Map<number, number[]>;
  onToggle: (rowIndex: number) => void;
  /** False when the sheet has no hierarchy at all (flat sheet) -> render no chevrons/spacers. */
  anyParents: boolean;
}
const CollapseContext = createContext<CollapseCtx | null>(null);

/**
 * The per-row hierarchy chevron + "+N hidden" affordance, rendered at the Description indent.
 * Reads CollapseContext (NOT props) so it re-renders on a collapse toggle while the memoized
 * PricingGridRow is skipped. Renders:
 *   - nothing            when the sheet is flat (no hierarchy anywhere);
 *   - an invisible spacer for a leaf row on a hierarchical sheet (keeps description text aligned);
 *   - a chevron toggle   for a parent (down=expanded / right=collapsed), plus a muted "+N hidden"
 *     badge (N = whole-subtree descendant count, DERIVED live) when collapsed.
 * tabIndex={-1}: the chevron is mouse-operable and is DELIBERATELY out of the grid's roving-
 * tabindex matrix (it would add a second tab stop in the Description cell); nav is untouched.
 */
function RowChevron({ rowIndex }: { rowIndex: number }) {
  const ctx = useContext(CollapseContext);
  if (!ctx || !ctx.anyParents) return null;
  if (!rowHasDescendants(ctx.childrenByParent, rowIndex)) {
    return <span aria-hidden className="inline-block h-4 w-4 shrink-0" />;
  }
  const isCollapsed = ctx.collapsed.has(rowIndex);
  const hidden = isCollapsed ? descendantCount(rowIndex, ctx.childrenByParent) : 0;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        tabIndex={-1}
        aria-label={isCollapsed ? "Expand" : "Collapse"}
        aria-expanded={!isCollapsed}
        title={isCollapsed ? "Expand" : "Collapse"}
        onClick={(e) => {
          e.stopPropagation();
          ctx.onToggle(rowIndex);
        }}
        className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", !isCollapsed && "rotate-90")} />
      </button>
      {isCollapsed && hidden > 0 && (
        <span
          className="rounded bg-muted px-1 text-[10px] font-medium leading-none text-muted-foreground whitespace-nowrap"
          title={`${hidden} descendant row${hidden === 1 ? "" : "s"} hidden`}
        >
          +{hidden} hidden
        </span>
      )}
    </span>
  );
}

// MC-5: the shared inner of the Description ANCHOR cell (depth indent + collapse chevron +
// styled text + "(no description)" fallback + the frozen-pane row-height clip). Used by BOTH
// the LEGACY single anchor AND the FIRST fan-out description column, so the legacy render
// stays byte-identical (one source, no drifting copy -- the A10 compat mechanism). The extra
// fan-out columns render a simpler span (no indent, no chevron, no fallback) inline.
function DescriptionAnchorInner({
  text, depth, rowHeight, clipDescription = true, rowIndex, isPreamble, isLineItem,
}: {
  text: string | null;
  depth: number;
  rowHeight: number | null | undefined;
  // V1-FIX: clip the Description to rowHeight ONLY in classic + manual-drag rows. AUTO virtualized
  // rows pass false -> render NATURAL so the row measures true content and the max-of-both-panes
  // alignment (not a clip) keeps the panes level. Defaults true (classic / MC callers that don't pass it).
  clipDescription?: boolean;
  rowIndex: number;
  isPreamble: boolean;
  isLineItem: boolean;
}) {
  // ONE description span, whether or not a section line sits above it -- a second copy would drift
  // (this is the shared inner precisely so the legacy anchor and the MC-5 fan-out cannot).
  const description = (
    <span
      title={text ?? undefined}
      className={cn(
        "leading-snug break-words min-w-0",
        isPreamble && "font-medium text-foreground",
        isLineItem && "text-foreground",
        !isPreamble && !isLineItem && "text-muted-foreground italic text-[11px]",
      )}
    >
      {text || (
        <span className="not-italic text-muted-foreground">(no description)</span>
      )}
    </span>
  );
  return (
    <div
      style={{
        paddingLeft: `${depth * INDENT_PX}px`,
        ...(rowHeight != null && clipDescription
          ? { maxHeight: `${Math.max(0, rowHeight - DESC_CLIP_VPAD_PX)}px`, overflow: "hidden" }
          : {}),
      }}
      className="flex items-start gap-1 min-w-0"
    >
      <RowChevron rowIndex={rowIndex} />
      {/* BCS-S4 rendered an optional SECTION line above the description here, for the flat margin
          view's benefit -- a flat list has no position left to show a row's section with. The view
          is gone (owner ruling 2026-08-07, replaced by filtering in place), and with it the only
          caller that ever passed a section, so this is the bare description again -- which is what
          every sheet in the product was already getting. */}
      {description}
    </div>
  );
}

interface PricingGridRowProps {
  // ── per-row data (changes -> this row re-renders) ──
  row: PricedRow;
  /** ARRAY index into rows (the nav-matrix row coord), NOT row.row_index. */
  rowIndex: number;
  /** Frozen-left Slice 1: which pane this row instance renders. undefined = the single
   *  (unfrozen) table -> emits ALL cells (today's behaviour). "frozen" -> ONLY the 5 anchor
   *  cells; "scrolling" -> ONLY the descriptor + Remarks cells. Constant per instance, so the
   *  memo holds across a keystroke. */
  pane?: "frozen" | "scrolling";
  /** Frozen-left Slice 1: the captured px height for this row (measure-at-freeze). Applied to
   *  the <tr> in BOTH panes so the matching rows stay aligned; the Description inner wrapper is
   *  clipped to it. undefined when not frozen -> natural wrap-and-grow height (unchanged). A
   *  per-row SCALAR (like depth / isCurrentHit) -> memo-safe. */
  rowHeight?: number;
  /** V1 virtualization: the @tanstack/react-virtual measureElement callback, attached to this <tr>
   *  so the virtualizer learns the row's real height on mount. Set ONLY for the MEASURED pane
   *  (scrolling in two-pane, or the single table) in virtualized mode; undefined otherwise. It is
   *  reference-stable per virtualizer instance -> memo-safe (the comparator treats it as such). */
  measureRef?: (el: HTMLTableRowElement | null) => void;
  /** V1-FIX: whether to clip the Description to `rowHeight`. TRUE in classic mode + for manually-
   *  dragged virtualized rows (the applied height is authoritative -> clip to it). FALSE for AUTO
   *  virtualized rows -> Description renders NATURAL so the row measures true content and the
   *  max-of-both-panes alignment (not a clip) keeps the panes level. Stable per row -> memo-safe. */
  clipDescription?: boolean;
  depth: number;
  parentExcelRow: number | null;
  flags: RowReviewFlags | undefined;
  /** This row's draft slice (FULL `${row_index}:${col}` keys) -- NEVER the shared draftRates. */
  rowDraftRates: Record<string, string>;
  /** This row's proposal slice (FULL keys) -- NEVER the shared proposedRates. */
  rowProposedRates: Record<string, string>;
  /** The active COLUMN on this row, or null when no cell of this row is active (the lever:
   *  only the previously-active + newly-active rows see this change on a cursor move). */
  activeColIndex: number | null;
  /** Slice A (clipboard): this row's SELECTED column span (the multi-cell range highlight), as
   *  two memo-safe scalars derived from the grid-level (anchor, focus) rectangle EXACTLY like
   *  activeColIndex. null when the row is outside the selection (or the selection is a single
   *  cell -- that just shows the focus ring). NEVER the shared selection object (memo anti-defeat). */
  selLeftCol: number | null;
  selRightCol: number | null;
  /** Slice A (clipboard): a transient amber "skipped on paste/fill" flash for this row, as a CSV
   *  of colIndices (e.g. "6,8") or null. A memo-safe STRING scalar (compared by value), derived
   *  from a grid-level skip-flash map that self-clears after a few seconds. */
  skipColsCsv: string | null;
  /** Whether ANY cell in the grid is active (drives roving-tabindex's (0,0) entry fallback). */
  anyCellActive: boolean;
  /** Whether this row's remarks editor is open. */
  openRemark: boolean;
  /** Toolbar Part 1 -- search: whether this row is the CURRENT search hit (drives the row
   *  highlight). Per-row by nature -> it is in pricingRowPropsAreEqual so the highlight repaints
   *  as the user steps through hits (without it, memo'd rows would not re-render on step). */
  isCurrentHit: boolean;
  /** Parent-jump landing flash: whether this row is the CURRENT jump target (drives the 3s blue
   *  row tint). Per-row like isCurrentHit -> it is in pricingRowPropsAreEqual so the flash
   *  paints/un-paints as the grid-level flashExcelRow flips (set by jumpToRow, cleared after 3s). */
  isJumpFlash: boolean;
  // ── stable shared values/refs (reference-stable across a keystroke -> memo holds) ──
  displayDescriptors: ColumnDescriptor[];
  columnDescriptors: ColumnDescriptor[];
  columnFormulas: ColumnFormula[];
  /** Cluster B: per-cell reconciliation choice map (per-SHEET, reference-stable across a
   *  keystroke -- changes only on mutate, exactly like columnFormulas). */
  reconChoiceMap: Map<string, ReconChoice>;
  /** CL-2 / P1: THIS row's category verdict entry ONLY (per-row prop, NOT the whole map) -- so a
   *  verdict pick re-renders just the picked row, not all 870 rows. pricingRowPropsAreEqual compares
   *  it by reference; the page rebuilds only the changed row's entry (the optimistic override), so
   *  every other row's entry keeps its reference and is skipped. Read-only display in the Category cell. */
  category?: SheetCategoryRow;
  /** CL-6 / P1: sheet-has-run flag (grid-level; = categoriesByExcelRow.size > 0). Gates click-to-edit
   *  on a blank eligible cell. NOW compared explicitly in pricingRowPropsAreEqual (P1 removed the
   *  whole-map compare it used to piggyback on); it flips once, when the first classify lands. */
  hasRun: boolean;
  /** CL-3: id->label for the Category cell display (per-SHEET, reference-stable -- changes only on
   *  a catalog fetch, never on keystroke). */
  categoryLabelById: Map<string, string>;
  /** CL-3: open the verdict picker for a classified row's Category cell (page-owned, ref-stable).
   *  undefined => the cell is display-only (no click-to-edit). */
  onCategoryClick?: (excelRow: number, cellEl: HTMLElement) => void;
  /** U1 rate-helper: this row's OWN suggestion entry (from rowSuggestionsByExcelRow.get(excelRow)).
   *  Compared BY VALUE (rowSuggestionsEqual) in pricingRowPropsAreEqual, so a whole-Map rebuild only
   *  re-renders rows whose badge state changed. undefined => this row has no badges. */
  rowSuggestions?: RowSuggestions;
  /** U1 rate-helper: reference-stable page callback the badge calls (stopPropagation). undefined =>
   *  feature off. */
  onSuggestionBadgeClick?: (excelRow: number, col: string, cellEl: HTMLElement) => void;
  /** SELECTED-ROW runs: does this row get a tick box at all? Derived grid-side from the SERVER's
   *  run-eligible set -- a per-row BOOLEAN, never the set. */
  tickable: boolean;
  /** SELECTED-ROW runs: is this row currently ticked? A per-row BOOLEAN, never the selection Set
   *  and NEVER a count -- a count changes on every tick and would re-render all ~1,093 rows. */
  selected: boolean;
  /** SELECTED-ROW runs: reference-stable page callback (stopPropagation, like the badge).
   *  undefined => no tick column (no run to scope, or the feature is off). */
  onToggleTick?: (excelRow: number) => void;
  override: boolean;
  /** MANDATORY amount-formula gate (per-SHEET boolean -- flips identically for all rows). */
  formulasComplete: boolean;
  /** CATEGORY GATE (Slice G3a, per-SHEET boolean -- flips identically for all rows, like
   *  formulasComplete). FALSE => every rate cell read-only regardless of the override. */
  categoryGateOpen: boolean;
  onSaveRate?: (cell: RateCellSaveArgs, rate: number) => Promise<void>;
  onSaveColor?: (args: ColorSaveArgs[]) => Promise<void>;
  onSaveRemark?: (args: RemarkSaveArgs) => Promise<void>;
  onSaveReconChoice?: (args: ReconChoiceSaveArgs) => Promise<void>;
  colCount: number;
  rowCount: number;
  remarksColIndex: number;
  // MC-5: fan-out geometry (grid-level -- flip identically for all rows).
  effectiveAnchorCount: number;
  descriptorColStart: number;
  descriptionColumns: DescriptionColumn[];
  fanOut: boolean;
  // ── BCS-S3a: the cost block. Grid-level geometry + stable callbacks, plus THIS row's own
  //    values as per-row entries (P1: never the whole Map / the shared draft object). ALL
  //    OPTIONAL -- absent everywhere means no block, and every cell below renders as before.
  /** The live cost boxes, left to right. Grid-level, reference-stable (page useMemo). */
  bcsKinds?: BcsRateKind[];
  /** The colIndex of the FIRST cost box. Equals remarksColIndex when there is no block. */
  bcsColStart?: number;
  /** THIS row's stored cost record (`bcsRatesByExcelRow.get(excelRow)`), compared by reference. */
  bcsRow?: BcsRowRate;
  /** THIS row's cost-draft slice (FULL `${row_index}:${field}` keys) -- NEVER the shared map. */
  rowBcsDrafts?: Record<string, string>;
  /** THIS row's Total Quantity, resolved grid-side from the confirmed columns. A memo-safe
   *  SCALAR (number | null), like `depth` -- so the row never gets the qty source itself. */
  bcsQty?: number | null;
  /** BCS-S3b: the CONFIRMED Amount columns (`bcs_amount_source`) -- the Tendered column's
   *  operands, and so % Margin's denominator. Grid-level and reference-stable (it changes only
   *  when `get_bcs_state` refetches), compared by IDENTITY exactly like `reconChoiceMap`.
   *
   *  ⚠️ It arrives as the SOURCE, not as a resolved scalar the way `bcsQty` does, and that is
   *  deliberate: resolving it needs this row's live rate drafts (`rowDraftRates`), so it has to
   *  happen inside the row -- see the compute in the cost block below. */
  bcsAmountSource?: BcsSource | null;
  /** Present => the cost boxes are editable. Its ABSENCE is the read-only gate. */
  onSaveBcsRates?: (args: BcsRowSaveArgs) => Promise<void>;
  /** Why the boxes are read-only (grid-level string), rendered as the cell title. */
  bcsReadOnlyReason?: string | null;
  /** Commit ONE cost box (blur / Enter / the debounce firing). Gathers the whole row itself. */
  commitBcsRate?: (row: PricedRow, kind: BcsRateKind, rawValue: string) => void;
  /** Restart this box's 1s debounced auto-save (the onChange path). */
  scheduleBcsAutoSave?: (row: PricedRow, kind: BcsRateKind) => void;
  /** The optimistic cost-draft setter (mirrors setDraftRates). */
  setDraftBcsRates?: Dispatch<SetStateAction<Record<string, string>>>;
  commitRate: (row: PricedRow, d: ColumnDescriptor, rawValue: string) => void;
  scheduleAutoSave: (row: PricedRow, d: ColumnDescriptor) => void;
  onCellFocus: (r: number, c: number) => void;
  registerCell: (r: number, c: number, el: HTMLElement | null) => void;
  focusCell: (r: number, c: number) => void;
  setDraftRates: Dispatch<SetStateAction<Record<string, string>>>;
  setProposedRates: Dispatch<SetStateAction<Record<string, string>>>;
  setOpenRemark: (rowIndex: number, open: boolean) => void;
  /** Parent click-to-jump: scroll the grid to a row by its Excel row number. Reference-stable
   *  (a grid-level useCallback) -> memo-safe; still listed in pricingRowPropsAreEqual below. */
  onJumpToRow: (excelRow: number) => void;
  /** Frozen-left Slice 2 -- manual row-resize. The FROZEN pane row renders a bottom-edge drag
   *  handle (only when pane==="frozen") wired to these three STABLE (useCallback) handlers --
   *  reference-stable so the row memo holds (mirrors registerCell/focusCell). pointerDown captures
   *  (row_index, startHeight); move writes the dragged height into manualRowHeights; up releases. */
  onRowResizePointerDown: (rowIndexData: number, startHeight: number, e: ReactPointerEvent) => void;
  onRowResizePointerMove: (e: ReactPointerEvent) => void;
  onRowResizePointerUp: (e: ReactPointerEvent) => void;
}

/**
 * The memo comparator (the memo-WORKS proof's testable surface). Returns true (SKIP re-render)
 * iff EVERY prop is reference/value-equal -- exhaustive, so a changed prop NEVER yields a stale
 * row (correctness side of memoization). On a cursor move only `activeColIndex` changes (for the
 * 2 affected rows) so every other row is skipped; on a keystroke only the edited row's
 * `rowDraftRates` reference changes; on a save->mutate() the row's `row` / `flags` references
 * change so it re-renders fresh. Pure -- unit-tested in PricingGrid.test.ts.
 */
export function pricingRowPropsAreEqual(
  prev: PricingGridRowProps,
  next: PricingGridRowProps,
): boolean {
  return (
    prev.row === next.row &&
    prev.rowIndex === next.rowIndex &&
    prev.pane === next.pane &&
    prev.rowHeight === next.rowHeight &&
    prev.measureRef === next.measureRef && // stable per virtualizer instance -> never flips per render
    prev.clipDescription === next.clipDescription && // stable per row (classic true / auto-virt false)
    prev.depth === next.depth &&
    prev.parentExcelRow === next.parentExcelRow &&
    prev.flags === next.flags &&
    prev.rowDraftRates === next.rowDraftRates &&
    prev.rowProposedRates === next.rowProposedRates &&
    prev.activeColIndex === next.activeColIndex &&
    prev.selLeftCol === next.selLeftCol &&
    prev.selRightCol === next.selRightCol &&
    prev.skipColsCsv === next.skipColsCsv &&
    prev.anyCellActive === next.anyCellActive &&
    prev.openRemark === next.openRemark &&
    prev.isCurrentHit === next.isCurrentHit &&
    prev.isJumpFlash === next.isJumpFlash &&
    prev.displayDescriptors === next.displayDescriptors &&
    prev.columnDescriptors === next.columnDescriptors &&
    prev.columnFormulas === next.columnFormulas &&
    prev.reconChoiceMap === next.reconChoiceMap &&
    prev.category === next.category &&
    prev.hasRun === next.hasRun &&
    prev.categoryLabelById === next.categoryLabelById &&
    prev.onCategoryClick === next.onCategoryClick &&
    rowSuggestionsEqual(prev.rowSuggestions, next.rowSuggestions) &&
    prev.onSuggestionBadgeClick === next.onSuggestionBadgeClick &&
    // SELECTED-ROW runs: two per-row BOOLEANS + one stable callback. A tick flips exactly ONE
    // row's `selected`, so every other row bails here -- the same shape as `openRemark`.
    prev.tickable === next.tickable &&
    prev.selected === next.selected &&
    prev.onToggleTick === next.onToggleTick &&
    prev.override === next.override &&
    prev.formulasComplete === next.formulasComplete &&
    prev.categoryGateOpen === next.categoryGateOpen &&
    prev.onSaveRate === next.onSaveRate &&
    prev.onSaveColor === next.onSaveColor &&
    prev.onSaveRemark === next.onSaveRemark &&
    prev.onSaveReconChoice === next.onSaveReconChoice &&
    prev.colCount === next.colCount &&
    prev.rowCount === next.rowCount &&
    prev.remarksColIndex === next.remarksColIndex &&
    // MC-5: grid-level fan-out geometry (scalars by value, columns by identity -- the
    // memo is referentially stable per sheet, so this never defeats the row memo).
    prev.effectiveAnchorCount === next.effectiveAnchorCount &&
    prev.descriptorColStart === next.descriptorColStart &&
    prev.descriptionColumns === next.descriptionColumns &&
    prev.fanOut === next.fanOut &&
    // BCS-S3a: grid-level cost geometry (scalars/identities that flip for ALL rows together)
    // plus this row's OWN cost values. `rowBcsDrafts` is the keystroke lever -- it is a
    // groupDraftsByRow slice, so only the edited row's reference changes.
    prev.bcsKinds === next.bcsKinds &&
    prev.bcsColStart === next.bcsColStart &&
    prev.bcsRow === next.bcsRow &&
    prev.rowBcsDrafts === next.rowBcsDrafts &&
    prev.bcsQty === next.bcsQty &&
    prev.bcsAmountSource === next.bcsAmountSource &&
    prev.onSaveBcsRates === next.onSaveBcsRates &&
    prev.bcsReadOnlyReason === next.bcsReadOnlyReason &&
    prev.commitBcsRate === next.commitBcsRate &&
    prev.scheduleBcsAutoSave === next.scheduleBcsAutoSave &&
    prev.setDraftBcsRates === next.setDraftBcsRates &&
    prev.commitRate === next.commitRate &&
    prev.scheduleAutoSave === next.scheduleAutoSave &&
    prev.onCellFocus === next.onCellFocus &&
    prev.registerCell === next.registerCell &&
    prev.focusCell === next.focusCell &&
    prev.setDraftRates === next.setDraftRates &&
    prev.setProposedRates === next.setProposedRates &&
    prev.setOpenRemark === next.setOpenRemark &&
    prev.onJumpToRow === next.onJumpToRow &&
    prev.onRowResizePointerDown === next.onRowResizePointerDown &&
    prev.onRowResizePointerMove === next.onRowResizePointerMove &&
    prev.onRowResizePointerUp === next.onRowResizePointerUp
  );
}

/**
 * One committed-pricing ROW (the extracted, memoized `<tr>`). The render is byte-for-byte the
 * pre-extraction inline row -- same fixed anchors, descriptor cells (rate input / amount /
 * read-only), flag gutter, color border, priced tint, and trailing Remarks cell. The only
 * change is that the cursor/active state arrives as `activeColIndex` (the lever) and the row's
 * drafts arrive as its own `rowDraftRates`/`rowProposedRates` slices (never the shared maps).
 */
const PricingGridRow = memo(function PricingGridRow({
  row,
  rowIndex,
  pane,
  rowHeight,
  measureRef,
  clipDescription = true,
  depth,
  parentExcelRow,
  flags,
  rowDraftRates,
  rowProposedRates,
  activeColIndex,
  selLeftCol,
  selRightCol,
  skipColsCsv,
  anyCellActive,
  openRemark,
  isCurrentHit,
  isJumpFlash,
  displayDescriptors,
  columnDescriptors,
  columnFormulas,
  reconChoiceMap,
  category,
  hasRun,
  categoryLabelById,
  onCategoryClick,
  rowSuggestions,
  onSuggestionBadgeClick,
  tickable,
  selected,
  onToggleTick,
  override,
  formulasComplete,
  categoryGateOpen,
  onSaveRate,
  onSaveColor,
  onSaveRemark,
  onSaveReconChoice,
  colCount,
  rowCount,
  remarksColIndex,
  effectiveAnchorCount,
  descriptorColStart,
  descriptionColumns,
  fanOut,
  bcsKinds = EMPTY_BCS_KINDS,
  bcsColStart = 0,
  bcsRow,
  rowBcsDrafts = EMPTY_SLICE,
  bcsQty = null,
  bcsAmountSource = null,
  onSaveBcsRates,
  bcsReadOnlyReason = null,
  commitBcsRate,
  scheduleBcsAutoSave,
  setDraftBcsRates,
  commitRate,
  scheduleAutoSave,
  onCellFocus,
  registerCell,
  focusCell,
  setDraftRates,
  setProposedRates,
  setOpenRemark,
  onJumpToRow,
  onRowResizePointerDown,
  onRowResizePointerMove,
  onRowResizePointerUp,
}: PricingGridRowProps) {
  const isPreamble = row.effective_classification === "preamble";
  const isLineItem = row.effective_classification === "line_item";

  // Active-cell helpers, computed from this row's activeColIndex (the per-row lever) so a
  // cursor move re-renders only the rows whose active-state changed.
  const isActiveCol = (c: number) => activeColIndex === c;
  // Roving tabindex: the active cell is the single tab stop; before any focus, (0,0) is the
  // entry point so the grid is reachable by Tab from the page.
  const isTabStop = (c: number) =>
    anyCellActive ? activeColIndex === c : rowIndex === 0 && c === 0;
  // Slice A (clipboard): this row's selection span + the transient skip-flash columns, both
  // derived from the memo-safe scalars (NEVER the shared selection object). isSelected paints a
  // light range ring on non-active selected cells; isSkipFlash paints the amber paste-skip cue.
  const isSelected = (c: number) =>
    selLeftCol !== null && selRightCol !== null && c >= selLeftCol && c <= selRightCol;
  const skipFlashCols = skipColsCsv ? skipColsCsv.split(",").map(Number) : null;
  const isSkipFlash = (c: number) => !!skipFlashCols && skipFlashCols.includes(c);
  // The cell ring channel (does NOT mask the priced emerald/amber BACKGROUND -- a ring is a
  // separate channel, like the focus ring). Precedence: skip-flash (amber) > active (blue) >
  // range-selection (sky). Shared by every cell type (anchors via cellNavClass; the rate <td> +
  // parent button call it directly since they inline their own ring).
  const selectionRing = (c: number) =>
    cn(
      isSkipFlash(c) && "ring-2 ring-inset ring-amber-500 dark:ring-amber-400",
      !isSkipFlash(c) && isActiveCol(c) && "ring-2 ring-inset ring-blue-500 dark:ring-blue-400",
      !isSkipFlash(c) && !isActiveCol(c) && isSelected(c) && "ring-1 ring-inset ring-sky-400/70",
    );
  const cellNavClass = (c: number) => cn("scroll-mt-9 outline-none", selectionRing(c));
  const tdFocusProps = (c: number) => ({
    tabIndex: isTabStop(c) ? 0 : -1,
    onFocus: () => onCellFocus(rowIndex, c),
    ref: (el: HTMLTableCellElement | null) => registerCell(rowIndex, c, el),
  });
  const inputFocusProps = (c: number) => ({
    tabIndex: isTabStop(c) ? 0 : -1,
    onFocus: () => onCellFocus(rowIndex, c),
    ref: (el: HTMLInputElement | null) => registerCell(rowIndex, c, el),
  });

  // Slice 4b-A: the in-grid review marker (a left accent + Flag icon in the Excel-Row gutter).
  const flagCritical = !!flags && (flags.broken || flags.qtyAnomaly);
  const flagAttention = !!flags && !flagCritical && (flags.needsRate || flags.notYet);
  const hasFlag = flagCritical || flagAttention;
  const flagTitle = flags
    ? [
        flags.needsRate && "Needs a rate",
        flags.qtyAnomaly && "Quantity on a non-priceable row",
        flags.broken && "Formula won't resolve -- check the formula",
        flags.notYet && "Amount not computed yet (a rate is missing)",
      ]
        .filter(Boolean)
        .join("; ") || undefined
    : undefined;

  return (
    <tr
      ref={measureRef} // V1: measureElement on the measured pane's <tr> (undefined otherwise)
      data-index={rowIndex} // V1: @tanstack/react-virtual reads this to key its measurement cache
      className={cn(
        "border-b border-border",
        // Toolbar Part 1 -- search: the CURRENT hit row gets a solid yellow wash (a BACKGROUND,
        // not a ring: the table is border-collapse, where ring-inset on a <tr> is unreliable
        // [ReviewTree's documented caveat], and a ring would also collide with the blue
        // active-cell ring). It shows through the anchor cells incl. Description -- exactly where
        // the matched text is. Per-cell priced emerald/amber backgrounds on rate/amount <td>s
        // still win on those cells (a deliberate, harmless layering). Non-hit rows keep hover.
        // Parent-jump landing flash: a transient BLUE row wash (3s, self-clearing -- set by
        // jumpToRow, mirrors the yellow). It WINS over search-yellow for its 3s (the jump just
        // happened, so it's the more relevant cue); when it clears the row reverts to yellow if
        // still the search hit. Instant on/off (NO transition) -- the calmest option, inherently
        // reduced-motion-safe, and it leaves the hover/current-hit paint timing untouched (A2).
        // Per-cell priced emerald/amber tints still win on their own <td>s (same as the yellow).
        isJumpFlash
          ? "bg-blue-100 dark:bg-blue-900/40"
          : isCurrentHit
            ? "bg-yellow-100 dark:bg-yellow-900/40"
            : "hover:bg-muted/30",
      )}
      // Frozen-left Slice 1: the captured row height (both panes share it -> aligned). undefined
      // when not frozen -> no attribute -> natural height (byte-for-byte). data-rowidx tags the
      // SCROLLING pane's <tr> so the vertical-scroll retarget can find a row's counterpart.
      style={rowHeight != null ? { height: `${rowHeight}px` } : undefined}
      data-rowidx={pane === "scrolling" ? rowIndex : undefined}
      // Slice A (clipboard) context menu: the row's ARRAY index, on EVERY pane's <tr>, so the
      // grid-level onContextMenu can resolve which row was right-clicked (the column comes from
      // the cell's existing data-colkey). Distinct from data-rowidx (scrolling-pane-only, used by
      // the vertical-scroll retarget) so neither steps on the other.
      data-navr={rowIndex}
    >
      {/* Frozen-left Slice 1: anchors render in the single table (pane undefined) and the FROZEN
          pane; the data group (descriptors + Remarks) renders in the single table and the
          SCROLLING pane. A React fragment adds no DOM, so the unfrozen path is unchanged. */}
      {pane !== "scrolling" && (
        <>
      {/* Excel Row (col 0) -- also the 4b-A flag gutter (left accent + Flag icon). data-colkey
          backs the autofit measure. */}
      <td
        {...tdFocusProps(0)}
        data-colkey="a0"
        title={hasFlag ? flagTitle : undefined}
        className={cn(
          "relative px-2 py-1.5 text-muted-foreground align-top border-r border-border tabular-nums",
          flagCritical && "border-l-4 border-l-rose-500 dark:border-l-rose-600",
          flagAttention && "border-l-4 border-l-amber-500 dark:border-l-amber-600",
          cellNavClass(0),
        )}
      >
        <span className="inline-flex items-center gap-1">
          {/* SELECTED-ROW runs: the tick box, rendered ONLY on rows the SERVER's suggest run
              accepts (`tickable`). Deliberately NOT on the badge set -- that is a WIDER
              definition (rate-editable), and offering a tick the run would silently drop is
              exactly the class of failure this feature exists to remove. stopPropagation so a
              tick does not also move the cell cursor. */}
          {onToggleTick && tickable && (
            <input
              type="checkbox"
              className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
              checked={selected}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation();
                onToggleTick(row.source_row_number);
              }}
              aria-label={`Select row ${row.source_row_number} for the next suggestion run`}
              title={selected ? "Selected -- click to unselect" : "Select this row for the next suggestion run"}
            />
          )}
          {hasFlag && (
            <Flag
              aria-hidden
              className={cn(
                "h-3 w-3 shrink-0",
                flagCritical
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-amber-600 dark:text-amber-400",
              )}
            />
          )}
          {row.source_row_number}
        </span>
        {/* Frozen-left Slice 2 -- manual row-resize handle: a thin strip at the row's BOTTOM edge,
            on the Excel-row gutter (the spreadsheet row-resize idiom), in the FROZEN pane only.
            The td is `relative`; the handle is absolutely positioned at its bottom. Dragging writes
            the new height into manualRowHeights (applied to BOTH panes). The handlers are STABLE
            grid callbacks (memo-safe). rowHeight is the row's current applied height (the drag
            start point). */}
        {pane === "frozen" && rowHeight != null && (
          <div
            role="separator"
            aria-orientation="horizontal"
            title="Drag to resize row height"
            onPointerDown={(e) => onRowResizePointerDown(row.row_index, rowHeight, e)}
            onPointerMove={onRowResizePointerMove}
            onPointerUp={onRowResizePointerUp}
            className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-row-resize touch-none select-none hover:bg-blue-400/50"
          />
        )}
      </td>
      {/* Sl.No (col 1). */}
      <td
        {...tdFocusProps(1)}
        data-colkey="a1"
        className={cn(
          "px-2 py-1.5 text-muted-foreground align-top border-r border-border",
          cellNavClass(1),
        )}
      >
        {row.sl_no_value ?? ""}
      </td>
      {/* Parent (col 2): a CLICKABLE jump to the parent row (scrolls + focuses it). When a
          parent exists the BUTTON is col 2's roving nav target (carries the focus props +
          active ring, exactly like a rate <input> owns its cell) so there is no second tab
          stop; mouse-click + Space activate natively, Enter is handled in handleGridKeyDown.
          A ROOT row renders no button, so the <td> keeps the focus props (col 2 always has a
          nav target) -- backwards-compatible (the cell was a read-only span before). */}
      <td
        {...(parentExcelRow === null ? tdFocusProps(2) : {})}
        data-colkey="a2"
        className={cn(
          "px-2 py-1.5 align-top border-r border-border",
          parentExcelRow === null && cellNavClass(2),
        )}
      >
        {parentExcelRow !== null ? (
          <button
            type="button"
            tabIndex={isTabStop(2) ? 0 : -1}
            onFocus={() => onCellFocus(rowIndex, 2)}
            ref={(el) => registerCell(rowIndex, 2, el)}
            onClick={() => onJumpToRow(parentExcelRow)}
            aria-label={`Jump to parent row ${parentExcelRow}`}
            className={cn(
              "text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap outline-none rounded scroll-mt-9",
              selectionRing(2),
            )}
          >
            ↑ {parentExcelRow}
          </button>
        ) : null}
      </td>
      {/* Classification pill (col 3) (read-only -- no chevron / reclassify). */}
      <td
        {...tdFocusProps(3)}
        data-colkey="a3"
        className={cn(
          "px-2 py-1.5 align-top border-r border-border",
          cellNavClass(3),
        )}
      >
        <ClassificationPill cls={row.effective_classification} />
      </td>
      {/* MC-5: Description fan-out. FAN-OUT -> one read-only nav cell per mapped description
          column, all inside the frozen anchor pane; the FIRST is the wide anchor (depth indent +
          chevron + "(no description)" fallback via the shared inner), the rest are plain per-
          col_letter values (blank when the row has no triple), each with the row-height clip.
          LEGACY (no parts) -> the single a4 anchor via the SAME shared inner (byte-identical).
          Every description cell is READ-ONLY (colIndex < descriptorColStart -> excluded from the
          rate path); none get priced-tint or the remark-color border. */}
      {fanOut
        ? descriptionColumns.map((c, i) => {
            const isFirst = i === 0;
            const colIndex = 4 + i; // 4 non-description anchors precede the description columns
            const value = descriptionCellValue(row, c.col);
            return (
              <td
                key={c.col}
                {...tdFocusProps(colIndex)}
                data-colkey={descriptionWidthKey(c.col)}
                className={cn("px-2 py-1.5 align-top border-r border-border", cellNavClass(colIndex))}
              >
                {isFirst ? (
                  <DescriptionAnchorInner
                    text={value}
                    depth={depth}
                    rowHeight={rowHeight}
                    clipDescription={clipDescription}
                    rowIndex={row.row_index}
                    isPreamble={isPreamble}
                    isLineItem={isLineItem}
                  />
                ) : (
                  <div
                    style={
                      // V1-FIX: clip ONLY when clipDescription (classic + manual-drag rows). AUTO
                      // virtualized rows render NATURAL so the row measures true content (the
                      // max-of-both-panes height, not a clip, keeps the panes level).
                      rowHeight != null && clipDescription
                        ? { maxHeight: `${Math.max(0, rowHeight - DESC_CLIP_VPAD_PX)}px`, overflow: "hidden" }
                        : {}
                    }
                    className="min-w-0"
                  >
                    <span
                      title={value || undefined}
                      className={cn(
                        "leading-snug break-words min-w-0",
                        isPreamble && "font-medium text-foreground",
                        isLineItem && "text-foreground",
                        !isPreamble && !isLineItem && "text-muted-foreground italic text-[11px]",
                      )}
                    >
                      {value}
                    </span>
                  </div>
                )}
              </td>
            );
          })
        : (
          <td
            {...tdFocusProps(4)}
            data-colkey="a4"
            className={cn("px-2 py-1.5 align-top border-r border-border", cellNavClass(4))}
          >
            <DescriptionAnchorInner
              text={row.description}
              depth={depth}
              rowHeight={rowHeight}
              clipDescription={clipDescription}
              rowIndex={row.row_index}
              isPreamble={isPreamble}
              isLineItem={isLineItem}
            />
          </td>
        )}
        </>
      )}
      {pane !== "frozen" && (
        <>
      {/* CL-2/CL-3: the Category column -- the FIRST right-pane cell (colIndex FIXED_ANCHOR_COUNT).
          Displays the row's effective category verdict (labelled). Three visual states:
          "needs_review" = amber dot + amber text; "human" = emerald check + emerald text ("(your
          pick)"); "auto" = plain foreground; "unclassified" = blank. Uses the same read-only nav-cell
          wiring the anchor cells use (tdFocusProps / cellNavClass / registerCell), no input.
          CL-3: a CLASSIFIED row is click-to-edit -- onClick opens the page-owned verdict picker
          anchored to this cell (Enter on the focused cell does the same via handleGridKeyDown). */}
      {(() => {
        // MC-5: colIndex tracks the PARAMETRIC anchor count (Category is the first right-pane cell,
        // after the fan-out description columns). P1: `cat` is this row's OWN per-row prop, NOT a
        // whole-map lookup -- passing `categoriesByExcelRow` into the memoized row defeats the memo.
        const colIndex = effectiveAnchorCount;
        const cat = category;
        const effective = cat?.effective_category_id ?? "";
        const state = deriveVerdictState(cat);
        const label = labelFor(effective, categoryLabelById);
        const needsReview = state === "needs_review";
        const isHuman = state === "human";
        // Amendment E: the verdict arrived by the cross-BoQ carry -- machine or human (owner
        // ruling 2026-07-28: provenance is the axis, so EVERY inherited row is marked). Rendered
        // distinctly from `isHuman` because emerald + a tick reads as "your pick", which on a
        // carried row attributes to this reviewer a decision made on another BoQ entirely.
        const isCarried = state === "carried";
        // CL-6: eligibility (Preamble/Line Item) is the click + amber-fill axis. A non-eligible row
        // (node_type "Other" -- notes/subtotals) is never clickable and never amber.
        const eligible = isPriceableType(row.node_type);
        // Clickable when the page wired the picker AND (the cell is already classified OR it is an
        // eligible blank cell on a sheet that has been classified at least once). Nothing is
        // clickable on a never-run sheet; a non-eligible row is never clickable.
        const editable = !!onCategoryClick && (isRowEditable(cat) || (eligible && hasRun));
        // Amber "needs a category" FILL (Slice G2e): IS the shared master-set-blank predicate -- an
        // ELIGIBLE row whose category cell is EMPTY (unclassified: with OR without a record, incl.
        // no-record rows). This is the SAME predicate the page's Check-Category filter uses
        // (isMasterSetBlank), so amber and the filter can never drift. The old `|| needsReview`
        // disjunct is DROPPED: `needs_review` is unreachable from resolved data
        // (resolvedToSheetCategoryRow sets routing "Needs review" only when the effective is blank,
        // and deriveVerdictState short-circuits a blank effective to "unclassified" first -- Recon 6
        // Q8c), and the owner ruled amber == master-set-blank so a non-eligible needs_review row must
        // never be amber. (The needsReview var still drives the dot/text-colour below -- an
        // unreachable-but-harmless cell affordance, left untouched.) Clears automatically once a
        // category is set (effective goes non-blank -> state leaves "unclassified").
        const amberFill = isMasterSetBlank(row, cat)
          ? "bg-amber-50 dark:bg-amber-950/30"
          : undefined;
        // R3/R16: the whole tooltip lives in the pure categoryCellTitle, so its wording is pinned
        // by assertion instead of by comment (there is no DOM here to test a `title=` through).
        // The grid does NO comparison and gets no new prop: the SERVER decided whether the carry
        // crossed BoQs, which it must -- this grid is never told which BoQ it is rendering.
        const title = categoryCellTitle(label, state, cat);
        return (
          <td
            {...tdFocusProps(colIndex)}
            data-colkey="category"
            title={title}
            onClick={
              editable
                ? (e) => onCategoryClick?.(row.source_row_number, e.currentTarget as HTMLElement)
                : undefined
            }
            className={cn(
              "px-2 py-1.5 align-top border-l border-border",
              // needs-review now sits on the amber FILL -> high-contrast dark text (amber-on-amber
              // was illegible); human stays emerald; auto/unclassified stay foreground.
              needsReview
                ? "text-black dark:text-white"
                : isHuman
                  ? "text-emerald-700 dark:text-emerald-300"
                  : isCarried
                    ? "text-sky-700 dark:text-sky-300"
                    : "text-foreground",
              amberFill,
              editable && "cursor-pointer hover:bg-muted/40",
              cellNavClass(colIndex),
            )}
          >
            <span className="flex items-center gap-1 min-w-0">
              {needsReview && (
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400"
                />
              )}
              {isHuman && (
                <Check
                  aria-hidden
                  className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                />
              )}
              {isCarried && (
                <CornerDownRight
                  aria-hidden
                  className="h-3 w-3 shrink-0 text-sky-600 dark:text-sky-400"
                />
              )}
              <span className="truncate">{label}</span>
            </span>
          </td>
        );
      })()}
      {/* Descriptor-driven data cells: editable rate inputs, live-amount cells, and read-only
          qty/other cells. */}
      {displayDescriptors.map((d, dIdx) => {
        const colIndex = descriptorColStart + dIdx;
        // ── Slice 4a: per-cell color (the SEPARATE left-border channel) + the picker
        //    trigger (editable only when onSaveColor is present). ──
        const cellColor = row.color_by_cell?.[d.col];
        const colorBorderClass = cellColor
          ? colorClassForToken(cellColor)
          : "border-l border-border";
        const colorPicker = onSaveColor ? (
          <ColorPicker
            current={cellColor}
            onApply={(token, wholeRow) => {
              const cols = wholeRow ? rowColorCells(displayDescriptors) : [d.col];
              return onSaveColor(
                cols.map((col) => ({
                  excelRow: row.source_row_number,
                  colLetter: col,
                  color: token,
                  description: row.description ?? undefined,
                })),
              );
            }}
          />
        ) : null;
        // ── RATE cell: editable <Input>; focus target = the input (col-uniform). ──
        // MANDATORY formula gate (formulasComplete): ANDed OUTSIDE isRateEditableRow, so the
        // override (inside isRateEditableRow) can NEVER reach past it -- no declared formulas =>
        // NOTHING rate-editable, override or not. Then the asymmetric gate (isRateEditableRow):
        // Line Item always editable; Preamble editable only when qty-bearing; override unlocks
        // both. A non-editable rate cell falls through to the read-only render below (its
        // priced/anomaly marker still shows).
        if (
          onSaveRate &&
          formulasComplete &&
          categoryGateOpen &&
          isRateDescriptor(d) &&
          isRateEditableRow(row, override)
        ) {
          const key = cellKey(row.row_index, d.col);
          const priced = isCellPriced(row, d);
          const needsReview = priced && !isPriceableType(row.node_type);
          const draft = rowDraftRates[key];
          const proposed = rowProposedRates[key];
          const value = draft ?? proposed ?? savedRateStr(row, d);
          const isProposed = draft === undefined && proposed !== undefined && !priced;
          return (
            <td
              key={d.col}
              data-colkey={columnWidthKey("descriptor", d.col)}
              title={
                needsReview
                  ? "Priced on a non-priceable row -- flagged for review"
                  : priced
                    ? "Priced"
                    : undefined
              }
              className={cn(
                "group relative px-1 py-1 align-top",
                colorBorderClass,
                priced &&
                  (needsReview
                    ? "bg-amber-50 dark:bg-amber-950/30"
                    : "bg-emerald-50 dark:bg-emerald-950/30"),
                selectionRing(colIndex),
              )}
            >
              {colorPicker}
              {/* RM-3a Defect 2: priced dot + suggestion badge / used-check / sparkle opener stay
                  PERSISTENT, tightened into one compact right-aligned cluster (the colour picker is
                  the hover/focus-only action at top-left, above). */}
              <div className="flex items-center justify-end gap-0.5">
                {priced && (
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                      needsReview ? "bg-amber-500" : "bg-emerald-500",
                    )}
                  />
                )}
                {/* U1 rate-helper: the suggestion badge (a run produced N suggestions for this cell)
                    OR, when this rate-editable cell has NO badge, an always-on FAINT opener so the
                    pricer can bring up the helper and fill attributes by hand (owner request). Both
                    stopPropagation, so a bare click on the input beside it still places the cursor. */}
                {onSuggestionBadgeClick &&
                  (rowSuggestions?.byCol[d.col] ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSuggestionBadgeClick(
                          row.source_row_number,
                          d.col,
                          e.currentTarget as HTMLElement,
                        );
                      }}
                      className={cn(
                        "inline-flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
                        rowSuggestions.byCol[d.col].used
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-primary/15 text-primary hover:bg-primary/25",
                      )}
                      title={
                        rowSuggestions.byCol[d.col].used
                          ? "Suggested value used"
                          : `${rowSuggestions.byCol[d.col].count} rate suggestion(s)`
                      }
                      aria-label={
                        rowSuggestions.byCol[d.col].used
                          ? "Suggested value used"
                          : "Open rate suggestions"
                      }
                    >
                      {rowSuggestions.byCol[d.col].used ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        rowSuggestions.byCol[d.col].count
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSuggestionBadgeClick(
                          row.source_row_number,
                          d.col,
                          e.currentTarget as HTMLElement,
                        );
                      }}
                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/40 hover:bg-primary/10 hover:text-primary"
                      title="Fill attributes to price this row"
                      aria-label="Open rate helper"
                    >
                      <Sparkles className="h-3 w-3" />
                    </button>
                  ))}
                <Input
                  {...inputFocusProps(colIndex)}
                  type="text"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (DECIMAL_IN_PROGRESS.test(v)) {
                      setDraftRates((prev) => ({ ...prev, [key]: v }));
                      setProposedRates((prev) => {
                        if (prev[key] === undefined) return prev;
                        const next = { ...prev };
                        delete next[key];
                        return next;
                      });
                      scheduleAutoSave(row, d); // Slice 3c: debounced 1s auto-save
                    }
                  }}
                  onBlur={() => commitRate(row, d, value)}
                  className={cn(
                    "h-7 text-xs w-20 text-right tabular-nums scroll-mt-9",
                    isProposed && "text-muted-foreground italic",
                  )}
                />
              </div>
            </td>
          );
        }

        // ── AMOUNT cell (F4): formula-wins-else-pairing (uses this row's draft slice). ──
        if (isAmountDescriptor(d)) {
          const cell = evaluateAmountCell(d, row, columnDescriptors, columnFormulas, rowDraftRates);
          const isBroken = cell.kind === "blank" && cell.reason === "broken";
          const needsRate = cell.kind === "blank" && cell.reason === "not_yet";
          // ── Cluster B: divergence detection + resolution (D1). Only a real computed number
          //    (kind === "value") can diverge from the committed/document amount. The SHOWN value
          //    defaults to the DOCUMENT amount while unset/keep_document; take_formula shows the
          //    formula value. A non-diverging cell keeps today's behavior (the formula value).
          //    resolveDivergence + reconChoiceKey are pure leaf helpers (no priceability import).
          //
          //    BCS-S3b: the SHOWN value now comes from the shared `shownAmountValue` -- the same
          //    function the BCS Tendered column sums, so the margin's denominator and the number
          //    printed here are one decision. `recon` stays local because the BADGE needs the
          //    resolution shape (which choice, and whether to offer the chooser at all). ──
          const docRaw = resolveDescriptorValue(row, d);
          const docVal = typeof docRaw === "number" ? docRaw : null;
          const reconChoice = reconChoiceMap.get(reconChoiceKey(row.source_row_number, d.col));
          const recon: ReconResolution =
            cell.kind === "value"
              ? resolveDivergence(docVal, cell.value, reconChoice)
              : { diverges: false };
          const shownAmount = shownAmountValue(cell, docVal, reconChoice);
          const divergeTitle = recon.diverges
            ? recon.resolved === "unset"
              ? "Document and formula amounts differ -- choose which value to use"
              : `Reconciled (${recon.resolved === "take_formula" ? "formula" : "document"})`
            : undefined;
          return (
            <td
              key={d.col}
              {...tdFocusProps(colIndex)}
              data-colkey={columnWidthKey("descriptor", d.col)}
              title={
                divergeTitle ?? (isBroken ? "Check formula" : needsRate ? "Needs a rate" : undefined)
              }
              className={cn(
                "group relative px-2 py-1.5 text-right align-top tabular-nums",
                colorBorderClass,
                cellNavClass(colIndex),
              )}
            >
              {colorPicker}
              {recon.diverges && cell.kind === "value" && (
                <ReconcileBadge
                  documentVal={(() => {
                    const dv = resolveDescriptorValue(row, d);
                    return typeof dv === "number" ? dv : 0;
                  })()}
                  formulaVal={cell.value}
                  resolved={recon.resolved}
                  onChoose={
                    onSaveReconChoice
                      ? (choice) =>
                          onSaveReconChoice({
                            excelRow: row.source_row_number,
                            colLetter: d.col,
                            choice,
                            description: row.description ?? undefined,
                          })
                      : undefined
                  }
                />
              )}
              {/* BCS-S2e: BOTH arms render `shownAmount`. They used to differ -- the committed
                  arm re-read the RAW `resolveDescriptorValue`, while `shownAmountValue`'s own
                  committed arm returns the NUMBER-NORMALISED `docVal` -- so a non-numeric
                  committed value would have printed here and contributed nothing to the
                  denominator. Unreachable under the declared type, but `shownAmountValue`'s
                  docblock says it is the ONE decision this cell and the BCS Tendered column
                  share, and "one decision" has to be true structurally or it is just a claim.
                  Collapsed rather than merely corrected, so the two cannot drift apart again. */}
              {cell.kind === "value" || cell.kind === "committed" ? (
                renderDescriptorCell(shownAmount)
              ) : isBroken ? (
                <AlertTriangle className="inline-block h-3 w-3 text-destructive" aria-label="Check formula" />
              ) : null /* not_yet -> blank (the cell is empty; title = "Needs a rate") */}
            </td>
          );
        }

        // ── Default read-only cell (qty / others; rate when no onSaveRate, OR a
        //    non-priceable rate cell with the override off) ──
        const val = resolveDescriptorValue(row, d);
        const priced = isRateDescriptor(d) && isCellPriced(row, d);
        const needsReview = priced && !isPriceableType(row.node_type);
        return (
          <td
            key={d.col}
            {...tdFocusProps(colIndex)}
            data-colkey={columnWidthKey("descriptor", d.col)}
            title={
              needsReview
                ? "Priced on a non-priceable row -- flagged for review"
                : priced
                  ? "Priced"
                  : undefined
            }
            className={cn(
              "group relative px-2 py-1.5 text-right align-top tabular-nums",
              colorBorderClass,
              priced &&
                (needsReview
                  ? "bg-amber-50 dark:bg-amber-950/30"
                  : "bg-emerald-50 dark:bg-emerald-950/30"),
              cellNavClass(colIndex),
            )}
          >
            {colorPicker}
            {priced && (
              <span
                aria-hidden
                className={cn(
                  "mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle",
                  needsReview ? "bg-amber-500" : "bg-emerald-500",
                )}
              />
            )}
            {renderDescriptorCell(val)}
          </td>
        );
      })}
      {/* ── BCS-S3a/S3b: the cost block -- one editable box per live kind, then the three
             COMPUTED columns (Total Amount · Tendered Total Amount · % Margin). Placed AFTER the
             descriptors and BEFORE Remarks, which disturbs strictly less colIndex algebra than a
             Category-style placement would: descriptorColStart and every descriptor's own
             colIndex are untouched, and only the tail moves right.

             READ-ONLY IS THE ABSENCE OF onSaveBcsRates -- there is no second per-cell editable
             signal (the house rule). A read-only box still RENDERS its stored value, with
             bcsReadOnlyReason as the title, so a dead box always says why it is dead. ── */}
      {bcsKinds.length > 0 &&
        (() => {
          // ── BCS-S4: the composition moved to the module-level `computeBcsRowCells`, UNCHANGED.
          //    It has a SECOND reader now -- the imperative handle's `computeMargins`, which the
          //    % Margin range filter tests -- and that test must be the same number this cell shows.
          //
          //    It still runs HERE, per row, behind the row memo: it reads `rowDraftRates` (a rate
          //    typed but not yet saved must move % Margin in the same keystroke it moves the
          //    amount cell) and `rowBcsDrafts`, and keeping it behind the memo is what stops a
          //    cursor move elsewhere in the grid re-evaluating every row's formulas.
          // BCS-S8: `amountCell` is deliberately NOT destructured any more. It is still computed
          // inside `computeBcsRowCells` -- `marginCell` is derived from it there -- but with the
          // Tendered column gone there is nothing here left to render it into.
          const { merged, totalCell, marginCell } = computeBcsRowCells({
            row,
            bcsRow,
            rowBcsDrafts,
            bcsKinds,
            bcsQty,
            bcsAmountSource,
            columnDescriptors,
            columnFormulas,
            rowDraftRates,
            reconChoiceMap,
          });
          // One renderer for all three computed cells: the number, or nothing with the reason as
          // its title. A blank here NEVER renders 0 -- on a cost screen that reads as a claim.
          const computedCell = (
            key: string,
            colIndex: number,
            cell: BcsComputedCell,
            format: (v: number) => string,
            label: string,
          ) => (
            <td
              key={key}
              {...tdFocusProps(colIndex)}
              data-colkey={key}
              title={cell.kind === "blank" ? bcsBlankReasonText(cell.reason) : label}
              className={cn(
                "px-2 py-1.5 text-right align-top tabular-nums border-l border-border font-medium",
                cellNavClass(colIndex),
              )}
            >
              {cell.kind === "value" ? format(cell.value) : null}
            </td>
          );
          const editable = !!onSaveBcsRates && !!commitBcsRate && !!setDraftBcsRates;
          return (
            <>
              {bcsKinds.map((kind, i) => {
                const colIndex = bcsColStart + i;
                const field = BCS_RATE_FIELD[kind];
                const key = bcsCellKey(row.row_index, field);
                const value = merged[field] ?? "";
                const costed = bcsRow?.is_filled === 1;
                if (!editable) {
                  return (
                    <td
                      key={field}
                      {...tdFocusProps(colIndex)}
                      data-colkey={bcsWidthKey(kind)}
                      title={bcsReadOnlyReason ?? undefined}
                      className={cn(
                        "px-2 py-1.5 text-right align-top tabular-nums border-l border-border",
                        cellNavClass(colIndex),
                      )}
                    >
                      {renderDescriptorCell(value === "" ? null : Number(value))}
                    </td>
                  );
                }
                return (
                  <td
                    key={field}
                    data-colkey={bcsWidthKey(kind)}
                    title={costed ? "Cost entered" : undefined}
                    className={cn(
                      "relative px-1 py-1 align-top border-l border-border",
                      // The cost layer gets the SAME priced-emerald wash the rate cells use --
                      // one visual language for "this has been filled in", on both sides of the
                      // sheet. It is a BACKGROUND, so it never masks the colour or focus channels.
                      costed && "bg-emerald-50 dark:bg-emerald-950/30",
                      selectionRing(colIndex),
                    )}
                  >
                    <div className="flex items-center justify-end gap-0.5">
                      <Input
                        {...inputFocusProps(colIndex)}
                        type="text"
                        inputMode="decimal"
                        value={value}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (DECIMAL_IN_PROGRESS.test(v)) {
                            setDraftBcsRates((prev) => ({ ...prev, [key]: v }));
                            // Deferred, never a synchronous commit: the draft flips the sheet
                            // dirty, which fires the page's ensureLockAcquired BEFORE the save
                            // runs. save_row_bcs_rates takes acquire_or_refresh too, so a
                            // synchronous commit here would race lock acquisition exactly as it
                            // did for rates (bcs.py:498-501; bcsColumns' S2a finding F3 note).
                            scheduleBcsAutoSave?.(row, kind);
                          }
                        }}
                        onBlur={() => commitBcsRate(row, kind, value)}
                        className="h-7 w-20 text-right text-xs tabular-nums scroll-mt-9"
                      />
                    </div>
                  </td>
                );
              })}
              {/* The COMPUTED columns -- never stored (bcs.py's property 1: a stored copy could
                  disagree with the live sheet), never typeable, never a paste target. Each is
                  blank WITH A REASON rather than 0 -- a 0 is a claim, not an absence.

                  BCS-S8 (owner ruling 2026-08-07): Tendered Total Amount was REMOVED from the
                  block, which is why the margin now sits at `+ 1`. `amountCell` is still
                  computed above and still feeds `marginCell` -- the denominator did not go
                  away, only its column did. See BCS_COMPUTED_KINDS for what that costs. */}
              {computedCell(
                BCS_TOTAL_COL_KEY,
                bcsColStart + bcsKinds.length,
                totalCell,
                (v) => renderDescriptorCell(v),
                "BCS Total Amount — quantity x the cost entered",
              )}
              {/* % Margin needs its OWN formatter: renderDescriptorCell is the sheet's
                  money/quantity formatter and has no percent unit, so a margin rendered through
                  it would sit in the row looking like another amount. */}
              {computedCell(
                BCS_MARGIN_COL_KEY,
                bcsColStart + bcsKinds.length + 1,
                marginCell,
                formatBcsMargin,
                "% Margin — (amount charged − cost) / amount charged",
              )}
            </>
          );
        })()}
      {/* Slice 4a.2: trailing Remarks cell (per-row) -- the matrix's LAST column. */}
      <td
        {...tdFocusProps(remarksColIndex)}
        data-colkey="remarks"
        className={cn(
          "px-2 py-1.5 align-top border-l border-border",
          cellNavClass(remarksColIndex),
        )}
      >
        <RemarkCell
          remark={row.remark}
          onSave={
            onSaveRemark
              ? (remark) =>
                  onSaveRemark({
                    excelRow: row.source_row_number,
                    remark,
                    description: row.description ?? undefined,
                  })
              : undefined
          }
          open={openRemark}
          onOpenChange={(o) => {
            // V2: key the open-state by the DURABLE excel row (not the window array index).
            setOpenRemark(row.source_row_number, o);
            // On close (Esc / Save / outside-click) restore focus to this cell so arrow-nav
            // continues. An Enter-save's onMoveDown runs AFTER and wins. (focusCell still takes
            // the array index -- it targets cellRefs, which is index-keyed.)
            if (!o) focusCell(rowIndex, remarksColIndex);
          }}
          onMoveDown={() => {
            const next = nextCell(
              { rowIndex, colIndex: remarksColIndex },
              "down",
              rowCount,
              colCount,
            );
            if (next) focusCell(next.rowIndex, next.colIndex);
          }}
        />
      </td>
        </>
      )}
    </tr>
  );
}, pricingRowPropsAreEqual);
PricingGridRow.displayName = "PricingGridRow";

// V0/T2: React.memo shield. A page-level re-render with UNCHANGED grid props (e.g. the reconnect/
// poll/save-status churn) now bails here instead of re-executing the whole grid body + running
// pricingRowPropsAreEqual across every row. This is only sound because SheetPricingPage keeps ALL
// grid props identity-stable (the 12 useMemo/useCallback wraps -- esp. `rows`/`displayRows`); a
// future non-stable prop silently kills the shield (see frontend/CLAUDE.md).
export const PricingGrid = memo(forwardRef<PricingGridHandle, PricingGridProps>(function PricingGrid(
  { rows, columnDescriptors, onSaveRate, onBatchWrite, onDirtyChange, onHistoryChange, override = false, formulasComplete = true, categoryGateOpen = true, onSaveRemark, onSaveColor, columnFormulas = [], onSaveFormula, rowFlags, expanded = false, reconChoices = [], categoriesByExcelRow = EMPTY_CATEGORY_MAP, hasRun = false, rowTypeFilterOptions = EMPTY_FILTER_OPTIONS, rowTypeFilter = EMPTY_FILTER_SET, onRowTypeFilterChange, categoryFilterOptions = EMPTY_FILTER_OPTIONS, categoryFilter = EMPTY_FILTER_SET, onCategoryFilterChange, categoryLabelById = EMPTY_CATEGORY_LABEL_MAP, onCategoryClick, rowSuggestionsByExcelRow = EMPTY_SUGGESTIONS_MAP, onSuggestionBadgeClick, tickableRows = EMPTY_ROW_SET, selectedRows = EMPTY_ROW_SET, onToggleTick, showOnlyTicked = false, onToggleTicked, onSaveReconChoice, hiddenCols, currentHitExcelRow = null, collapsed, childrenByParent, onToggleCollapse, onRevealRow, frozen = false, virtualized = false, bcsKinds = EMPTY_BCS_KINDS, bcsRatesByExcelRow = EMPTY_BCS_RATES_MAP, bcsQtySource = null, bcsAmountSource = null, onSaveBcsRates, bcsReadOnlyReason = null, marginFrom = "", marginTo = "", marginRangeCount = null, onApplyMarginRange, marginSortDir = null, onCycleMarginSort, viewFiltersActive = false, onClearViewFilters },
  ref,
) {
  // Cluster B: per-cell reconciliation choice map (per-SHEET; reference-stable across a keystroke
  // -- it changes ONLY when reconChoices changes [on mutate], so the row memo holds, exactly like
  // columnFormulas). Keyed "<excel_row>:<col_letter>".
  const reconChoiceMap = useMemo(() => buildReconChoiceMap(reconChoices), [reconChoices]);
  // Optimistic per-rate-cell drafts (this session), keyed `${row_index}:${col}`. A draft
  // shows instantly (live amount) until the save's refetch lands, then it is dropped so the
  // cell falls back to the refetched saved rate.
  const [draftRates, setDraftRates] = useState<Record<string, string>>({});
  // BCS-S3a: the cost layer's OWN optimistic drafts, keyed `${row_index}:${field}`. Same
  // lifecycle as draftRates (shown instantly, dropped on save success, KEPT on failure so the
  // user still sees what they typed) but a SEPARATE map -- see bcsSlicesByRow.
  const [draftBcsRates, setDraftBcsRates] = useState<Record<string, string>>({});
  // Phase-2 prefill: cross-area PROPOSED rates -- displayed (muted/italic) but NOT
  // committed. Keyed by the SAME cellKey(row.row_index, d.col) as draftRates, but kept
  // STRICTLY SEPARATE: no save path (commitRate / commitActiveRate / scheduleAutoSave /
  // flush / unmount-flush) ever reads proposedRates, so a proposal is never sent to the
  // server until the user touches the cell (which promotes it into draftRates).
  const [proposedRates, setProposedRates] = useState<Record<string, string>>({});
  // Dedupe blur + Enter committing the SAME value (and an in-flight re-commit).
  const committedAttemptRef = useRef<Record<string, string>>({});

  // Slice 3b.2 -- spreadsheet keyboard nav. The active cell {rowIndex (array index into
  // rows), colIndex} is null until the user clicks / tabs in. Roving-tabindex: the active
  // cell (or (0,0) before any focus) is the single tab stop; arrows/Enter/Tab move it.
  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  // Slice A (clipboard): the SELECTION anchor. The selected rectangle is (anchor, activeCell);
  // a plain arrow / plain click COLLAPSES it (anchor follows activeCell), Shift+arrow / Shift+click
  // EXTENDS it (anchor held). `extendIntentRef` carries the "this focus should extend, not collapse"
  // bit from the gesture (keyboard sets it before the move; the table mousedown sets it for clicks)
  // into onCellFocus -- the single place both paths set the anchor. Cleared for free on remount.
  const [selectionAnchor, setSelectionAnchor] = useState<CellCoord | null>(null);
  const extendIntentRef = useRef(false);
  // Slice A (clipboard): the INTERNAL clipboard (a ref -- no re-render needed; a per-instance ref
  // is cleared for free by the page's key={sheetName::version} remount, NEVER navigator.clipboard).
  const clipboardRef = useRef<ClipboardBlock | null>(null);
  // Slice B (undo/redo): the session history (undo/redo stacks of rate-delta gestures). useState so
  // canUndo/canRedo can drive the onHistoryChange effect; a synced ref lets the imperative undo()/
  // redo() read the CURRENT stacks. Cleared for free by the page's key={sheetName::version} remount
  // (undoing into a different sheet/version is incoherent). isReplayingRef guards the capture path
  // from re-recording a replay's writes (a re-record loop).
  const [history, setHistory] = useState<HistoryState>(emptyHistory);
  const historyRef = useRef<HistoryState>(history);
  historyRef.current = history;
  const isReplayingRef = useRef(false);
  // Flip-gate for onHistoryChange: the last {canUndo, canRedo} emitted to the page, so the effect
  // fires only when a boolean actually changes (init {false,false} = the page default + empty start).
  const prevHistoryFlagsRef = useRef<{ canUndo: boolean; canRedo: boolean }>({
    canUndo: false,
    canRedo: false,
  });
  // The imperative handle is built once (deps [jumpToRow]); these refs let it call the LATEST
  // undo/redo closures (which close over the current rows/override) without rebuilding the handle.
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  // Slice A (clipboard) context menu: the controlled right-click menu's open-state + cursor anchor
  // (x,y) + the enabled flags SNAPSHOT computed at open-time (so the non-reactive clipboardRef is
  // read fresh for Paste, not via a stale render-time prop). Transient interaction state -- NOT a
  // lifted "hasClipboard" store; it exists only while the menu is open.
  const [menu, setMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    canCopy: boolean;
    canCut: boolean;
    canPaste: boolean;
    canFill: boolean;
  }>({ open: false, x: 0, y: 0, canCopy: false, canCut: false, canPaste: false, canFill: false });
  // Slice A (clipboard): a transient per-row map (array rowIdx -> CSV of skipped colIndices) for the
  // amber paste/fill skip flash, self-clearing after a few seconds; plus a short status message for
  // the paste summary / shape-mismatch reject. Both surface the copy-forward partial-outcome posture.
  const [skipFlash, setSkipFlash] = useState<Map<number, string>>(() => new Map());
  const skipFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clipboardMsg, setClipboardMsg] = useState<string | null>(null);
  const clipboardMsgTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-cell focusable element, keyed `${rowIndex}:${colIndex}` -- the <input> for a rate
  // cell, the <td> for every other cell. Used to .focus() the target on a keyboard move.
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());
  // Slice 4a.2: the remarks editor's open-state, LIFTED to the grid (was local to
  // RemarkCell) so the keyboard (Enter on the focused remarks cell) can open it, not just
  // a click. RemarkCell's draft/saving/error stay local; only open is controlled here.
  // V2: keyed by the row's DURABLE excel row (source_row_number), NOT the window array index --
  // under virtualized row recycling the array index N maps to a DIFFERENT row after a
  // collapse/filter reshuffle, so an index key mis-targets the popover; the excel row is stable.
  const [openRemarkExcelRow, setOpenRemarkExcelRow] = useState<number | null>(null);
  // Parent-jump landing flash: the Excel row currently flashed blue (null = none). Set by
  // jumpToRow, auto-cleared after 3s via flashTimeoutRef. Grid-level -- only the derived per-row
  // boolean (isJumpFlashRow) enters the row + the memo comparator. Resets for free on a
  // sheet-switch (the page remounts the grid key={sheetName}); also cleared on unmount below.
  const [flashExcelRow, setFlashExcelRow] = useState<number | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Frozen-left + column-resize: per-column width OVERRIDES (sparse -- absent => the seed). Width
  // is GRID-LEVEL (the colgroup + the frozen-offset CSS vars live on the table, NOT on a per-row
  // prop) so the row memo stays intact. Session-only: reset per sheet by the key={sheetName}
  // remount. resizeRef holds the in-flight drag; containerRef (below) backs the autofit measure.
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizeRef = useRef<{ key: string; startX: number; startWidth: number; isRate: boolean } | null>(null);
  // The OUTER container ref backs the double-click autofit measure. It is on the bordered wrapper
  // (NOT the <table>) so the [data-colkey] query spans BOTH panes when the grid is split.
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Frozen-left Slice 1 ("Fork A"): captured per-row heights (px), keyed by the stable
  // row.row_index. Populated by the measure-at-freeze layout-effect below; {} when unfrozen
  // (rows return to natural auto-height). Resets to {} for free on a sheet/version switch (the
  // grid remounts via key={sheetName::version}). frozenPaneRef/scrollPaneRef back the vertical-
  // scroll coupling (the scrolling pane drives; the frozen pane mirrors its scrollTop). splitRef
  // mirrors the render-time `split` so the stable focus/jump callbacks can read it at event time.
  const [rowHeights, setRowHeights] = useState<Record<number, number>>({});
  // Frozen-left Slice 2 -- manual row-resize (Option A, owner-locked). MANUALLY-dragged heights
  // live in a SEPARATE map (keyed by row.row_index). The two maps are distinct so the origin of a
  // height is unambiguous: the APPLIED height for a row = manualRowHeights[ri] ?? rowHeights[ri]
  // (manual wins). manualRowHeights SURVIVES unfreeze (only the captured `rowHeights` is cleared),
  // so a re-freeze keeps the user's dragged rows and re-measures only the rest; a column-resize
  // re-measure (below) refreshes captured rows WITHOUT touching manual. BOTH reset on the
  // sheet/version remount (key={sheetName::version}) -- session+sheet scoped, no backend persist.
  const [manualRowHeights, setManualRowHeights] = useState<Record<number, number>>({});
  // V1-FIX-2b: incremented at column drag-END / autofit ONLY (never streaming) to trigger the
  // post-commit re-measure layout-effect that folds a frozen-only Description re-wrap into the shared
  // virtualSize. A dedicated tick (not `colWidths`) keeps the re-measure off the per-stream-tick path.
  const [resizeSettleTick, setResizeSettleTick] = useState(0);
  const rowResizeRef = useRef<{ rowIndex: number; startY: number; startHeight: number } | null>(null);
  const frozenPaneRef = useRef<HTMLDivElement | null>(null);
  const scrollPaneRef = useRef<HTMLDivElement | null>(null);
  // RM-3b item 2: the always-visible embedded horizontal scrollbar is a SYNCED PROXY bar (a sticky
  // element pinned to the bottom of the visible grid area). This ref backs the two-way scrollLeft sync
  // with the real X-scroller (scrollPaneRef when split, else containerRef). Full-screen uses the native
  // bottom scrollbar (the flex chain bounds the container there), so the proxy is embedded-only.
  const hScrollProxyRef = useRef<HTMLDivElement | null>(null);
  const splitRef = useRef(false);
  // V1: mirrors `twoPane` (two-pane vs single) for the virtualizer's getScrollElement + the flip
  // re-anchor -- a ref so those closures always read the current mode without re-registering.
  const twoPaneRef = useRef(false);
  // V2 (nav/search to unmounted rows): focusCell / jumpToRow are defined BEFORE the virtualizer, so
  // they reach it through refs (assigned right after useVirtualizer, synced each render). virtualizedRef
  // mirrors the `virtualized` prop; scrollRowIntoWindowRef scrolls the window to a row index so an
  // OFF-window nav/jump target mounts before we focus it. Refs keep both closures reference-stable
  // (deps [] / [onRevealRow]) -> the row memo (focusCell / onJumpToRow props) is untouched.
  // align is "center" (NOT "auto"): with DYNAMIC row measurement, an unmeasured just-past-window row's
  // ESTIMATED offset reads as already-visible, so "auto" no-ops and the row never mounts (live-verified
  // arrow-nav stall at the window's bottom edge); "center" forces the scroll unconditionally -> mount.
  const virtualizedRef = useRef(false);
  const scrollRowIntoWindowRef = useRef<(idx: number) => void>(() => {});

  // Slice 3c -- auto-save plumbing. Per-cell 1000ms debounced commit, keyed by cellKey.
  const debouncersRef = useRef<Map<string, DebouncedFunc<() => void>>>(new Map());
  // Latest draftRates + a latest-state "commit one cell" fn, so a debounced fire / flush
  // reads CURRENT state at fire time (a captured value would be stale). Synced each render.
  const draftRatesRef = useRef<Record<string, string>>({});
  const autoSaveCellRef = useRef<(rowIndexField: number, col: string) => void>(() => {});
  // Latest rows snapshot (synced each render) -- the post-save propagation trigger reads
  // it to check a corresponding cell's CURRENT priced state at save-resolve time.
  const rowsRef = useRef<PricedRow[]>(rows);
  // BCS-S3a -- the cost layer's twin plumbing, kept in its OWN maps/refs throughout so a cost
  // edit can never disturb a rate edit's bookkeeping (and vice versa).
  const bcsDebouncersRef = useRef<Map<string, DebouncedFunc<() => void>>>(new Map());
  const draftBcsRatesRef = useRef<Record<string, string>>({});
  const bcsRatesRef = useRef<Map<number, BcsRowRate>>(EMPTY_BCS_RATES_MAP);
  const bcsKindsRef = useRef<BcsRateKind[]>(EMPTY_BCS_KINDS);
  const autoSaveBcsCellRef = useRef<(rowIndexField: number, field: BcsRateField) => void>(
    () => {},
  );
  // The blur+Enter dedupe for cost boxes -- its OWN map, keyed in the BCS key space.
  const bcsAttemptRef = useRef<Record<string, string>>({});

  // Editor perf fix (item 2): memoize the O(rows) / O(cols) grid derivations on their real
  // inputs so a cursor move (which changes only the grid-local activeCell, not rows /
  // columnDescriptors) does NOT rebuild them -- and so the memoized rows that reference
  // displayDescriptors keep a stable prop reference.
  // row_index -> row, for resolving a parent's Excel row number.
  const byIdx = useMemo(() => new Map<number, PricedRow>(rows.map((r) => [r.row_index, r])), [rows]);
  // Effective depth per row (reused helper -- single source of truth with the review tree).
  // BCS-S14: a MARGIN-SORTED sheet is FLAT -- an empty depth map makes every `depths.get(...) ?? 0`
  // return 0, so no row is indented. This is not cosmetic. Indentation asserts nesting under the
  // parent above it, and after a margin sort that parent is somewhere else entirely; worse,
  // `computeDepths` would not even reproduce the tree's own numbers, because its chain-walk reads
  // a row set whose order no longer follows the parent chain.
  //
  // The RANGE FILTER alone does NOT flatten (`marginSortDir === null` while filtering): it only
  // drops rows, and a surviving row's ancestry claim is still true. Only re-ordering breaks it.
  const depths = useMemo(
    () => (marginSortDir ? FLAT_DEPTHS : computeDepths(rows)),
    [rows, marginSortDir],
  );

  // Collapse/expand context value: stable across a keystroke (only `collapsed` / the page-built
  // `childrenByParent` / `onToggleCollapse` move it). The chevrons consume it; the memoized
  // PricingGridRow does NOT -- so a collapse toggle re-paints only the chevrons (R6). `anyParents`
  // is false on a flat sheet (childrenByParent empty) -> no chevrons/spacers render there.
  const emptyChildrenMap = useMemo(() => new Map<number, number[]>(), []);
  const collapseChildren = childrenByParent ?? emptyChildrenMap;
  const collapseCtxValue = useMemo<CollapseCtx>(
    () => ({
      collapsed: collapsed ?? new Set<number>(),
      childrenByParent: collapseChildren,
      onToggle: onToggleCollapse ?? (() => {}),
      anyParents: !!onToggleCollapse && collapseChildren.size > 0,
    }),
    [collapsed, collapseChildren, onToggleCollapse],
  );

  // Descriptor-driven columns: everything except the sl_no / description anchors. This is the
  // FULL set -- kept for the data-fanout concerns (commitRate's cross-area prefill, autoSave
  // lookup) so they operate over ALL columns regardless of what is hidden, AND so commitRate's
  // useCallback dep stays stable across a column-hide (a hide must not churn commitRate's
  // identity, which the row memo compares).
  const displayDescriptors = useMemo(
    () => columnDescriptors.filter((d) => !FIXED_ROLE_DEDUPE.has(d.role)),
    [columnDescriptors],
  );
  // Toolbar Part 1 -- column-hide: the RENDERED + NAV descriptor set = the full set MINUS the
  // user-hidden non-amount columns (amount columns are NEVER hidden -- isColumnVisible). Used for
  // the header <th> map, the per-row <td> map, and ALL nav dims (remarksColIndex / colCount), so
  // the colIndex matrix re-indexes uniformly over the visible set -- the cursor can never land on
  // a hidden column (the column analog of the displayRows row nav-skip). At default (nothing
  // hidden) this === displayDescriptors content, so behaviour is byte-identical.
  const visibleDescriptors = useMemo(
    () => displayDescriptors.filter((d) => isColumnVisible(d, hiddenCols)),
    [displayDescriptors, hiddenCols],
  );
  const slNoLetter = useMemo(
    () => columnDescriptors.find((d) => d.role === "sl_no")?.col ?? null,
    [columnDescriptors],
  );
  const descriptionLetter = useMemo(
    () => columnDescriptors.find((d) => d.role === "description")?.col ?? null,
    [columnDescriptors],
  );

  // MC-5: faithful multi-column description fan-out geometry. anchorWidthKeys is the
  // single source -- effectiveAnchorCount = its length, descriptorColStart = that + 1.
  // LEGACY (no row carries parts) -> anchorWidthKeys = [a0..a4] -> 5/6, byte-identical.
  const descriptionColumns = useMemo(
    () => buildDescriptionColumns(columnDescriptors, rows),
    [columnDescriptors, rows],
  );
  const fanOut = useMemo(() => sheetHasDescriptionParts(rows), [rows]);
  const anchorWidthKeys = useMemo(
    () => buildAnchorWidthKeys(descriptionColumns, fanOut),
    [descriptionColumns, fanOut],
  );
  const effectiveAnchorCount = anchorWidthKeys.length;
  const descriptorColStart = effectiveAnchorCount + 1; // +1 for the read-only Category column
  const descWidthSeeds = useMemo(
    () => descriptionWidthSeeds(descriptionColumns),
    [descriptionColumns],
  );

  // Editor perf fix (item 1, the load-bearing slice): per-row draft / proposal sub-maps (FULL
  // `${row_index}:${col}` keys), reference-reused via groupDraftsByRow so each memoized row
  // gets ONLY its own slice -- NEVER the shared draftRates/proposedRates object. The ref holds
  // the previous render's slices so an unchanged row's slice identity is stable; on a cursor
  // move draftRates is unchanged -> useMemo returns the cached structure -> no row re-renders.
  const draftSlicesRef = useRef<Map<number, Record<string, string>>>(new Map());
  const draftSlicesByRow = useMemo(() => {
    const next = groupDraftsByRow(draftRates, draftSlicesRef.current);
    draftSlicesRef.current = next;
    return next;
  }, [draftRates]);
  const proposedSlicesRef = useRef<Map<number, Record<string, string>>>(new Map());
  const proposedSlicesByRow = useMemo(() => {
    const next = groupDraftsByRow(proposedRates, proposedSlicesRef.current);
    proposedSlicesRef.current = next;
    return next;
  }, [proposedRates]);
  // BCS-S3a: the cost layer's OWN draft slices. `groupDraftsByRow` is generic over the
  // `${rowIndex}:${key}` shape and is reused VERBATIM -- but over a SEPARATE state map, which is
  // the load-bearing half: merging cost values into draftRates would give every rate cell of the
  // row a new slice on a cost keystroke, defeating shallowEqualStrMap for edits that have
  // nothing to do with each other.
  const bcsSlicesRef = useRef<Map<number, Record<string, string>>>(new Map());
  const bcsSlicesByRow = useMemo(() => {
    const next = groupDraftsByRow(draftBcsRates, bcsSlicesRef.current);
    bcsSlicesRef.current = next;
    return next;
  }, [draftBcsRates]);

  // Commit a rate cell (blur / Enter). No-op when unchanged or a duplicate of the last
  // attempt (blur+Enter). Blank/NaN -> 0 (the endpoint coerces blank -> 0.0, still priced).
  // useCallback so the memoized rows receive a STABLE reference (deps: onSaveRate +
  // displayDescriptors, both stable across a cursor move).
  const commitRate = useCallback((row: PricedRow, d: ColumnDescriptor, rawValue: string) => {
    if (!onSaveRate) return;
    const key = cellKey(row.row_index, d.col);
    // Slice 3c: a commit (gesture OR the debounce firing) cancels this cell's pending
    // auto-save so a later timer can't fire a different/stale value -> no same-cell race.
    debouncersRef.current.get(key)?.cancel();
    const saved = savedRateStr(row, d);
    if (rawValue === saved) return; // unchanged vs the saved value -> nothing to do
    if (committedAttemptRef.current[key] === rawValue) return; // dedupe blur+Enter same value
    committedAttemptRef.current[key] = rawValue;
    const num = parseFloat(rawValue);
    const rate = Number.isFinite(num) ? num : 0;
    // Slice B (undo/redo): the OLD numeric rate, captured BEFORE the write (past the
    // rawValue===saved early-return, so a no-op never makes an entry). Recorded as a 1-delta
    // gesture only on SUCCESS (.then), so a failed write -- which keeps the draft -- never enters
    // history. Skipped when this commit is itself a replay (the re-record guard).
    const oldNum = Number.isFinite(parseFloat(saved)) ? parseFloat(saved) : 0;
    const cellArgs = buildRateCell(row, d);
    void onSaveRate(cellArgs, rate)
      .then(() => {
        // Success: drop the optimistic draft so the cell shows the refetched saved rate.
        setDraftRates((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        delete committedAttemptRef.current[key];
        if (!isReplayingRef.current) {
          setHistory((h) =>
            pushEntry(h, { deltas: [{ cell: cellArgs, draftKey: key, oldRate: oldNum, newRate: rate }] }),
          );
        }
        // Phase-2 prefill: on a successful PER-AREA rate save, OFFER the same value as a
        // PROPOSED (display-only) rate in the corresponding rate column of the OTHER
        // area(s) for THIS row -- but only into EMPTY cells (not priced, no user draft).
        // Proposals live in proposedRates (NEVER draftRates), so no save path commits
        // them. Scalar saves propose nothing (findCorrespondingRateDescriptors -> []).
        if (d.value_field === PER_AREA_RATE_FIELD) {
          const corr = findCorrespondingRateDescriptors(d, displayDescriptors);
          if (corr.length > 0) {
            const freshRow = rowsRef.current.find((r) => r.row_index === row.row_index);
            setProposedRates((prev) => {
              const next = { ...prev };
              for (const c of corr) {
                const ck = cellKey(row.row_index, c.col);
                const alreadyPriced = freshRow ? isCellPriced(freshRow, c) : false;
                const hasDraft = draftRatesRef.current[ck] !== undefined;
                // Empty-only: never overwrite a priced or user-drafted cell. An older
                // untouched proposal MAY be overwritten -- newest saved value wins.
                if (!alreadyPriced && !hasDraft) next[ck] = String(rate);
              }
              return next;
            });
          }
        }
      })
      .catch(() => {
        // Failure: keep the draft (the user sees what they typed; the page shows the error).
        // Clear the dedupe so a retry of the same value is allowed.
        delete committedAttemptRef.current[key];
      });
  }, [onSaveRate, displayDescriptors]);

  // U1 rate-helper: apply a value to a rate cell (excelRow + Excel column letter) EXACTLY as a
  // typed value -- optimistic draft (cell shows it at once) + clear any proposal + the SAME 1s
  // debounced autosave the onChange handler schedules (inlined here because scheduleAutoSave is
  // declared below). Deferring the commit rather than committing synchronously is load-bearing: the
  // draft flips the sheet dirty, which fires the page's ensureLockAcquired BEFORE the save runs, so
  // "Use this value" never races lock acquisition (a synchronous commit did -> spurious takeover).
  // It inherits the identical bookkeeping typing has: undo history, mutate refetch, in-flight /
  // takeover, and the onSaveRate (locked) gate via autoSaveCellRef -> commitRate. No second save path.
  const applyRate = useCallback(
    (excelRow: number, col: string, value: number) => {
      if (!onSaveRate) return;
      const row = rowsRef.current.find((r) => r.source_row_number === excelRow);
      const d = displayDescriptors.find((dd) => dd.col === col);
      if (!row || !d || !isRateDescriptor(d)) return;
      const key = cellKey(row.row_index, d.col);
      const str = String(value);
      setDraftRates((prev) => ({ ...prev, [key]: str }));
      setProposedRates((prev) => {
        if (prev[key] === undefined) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      let deb = debouncersRef.current.get(key);
      if (!deb) {
        deb = debounce(() => autoSaveCellRef.current(row.row_index, d.col), AUTOSAVE_MS);
        debouncersRef.current.set(key, deb);
      }
      deb();
    },
    [onSaveRate, displayDescriptors],
  );
  const applyRateRef = useRef(applyRate);
  applyRateRef.current = applyRate;
  // BCS-S4: the % Margin reading the range filter tests. Same ref pattern as undo/redo/applyRate --
  // the handle delegates to the LATEST closure, so it need not rebuild when rows/descriptors/drafts
  // change, and a reading taken at any moment sees the values on screen at that moment. Assigned
  // below, after `bcsQtyFor` exists (it is declared beside renderRow).
  const computeMarginsRef = useRef<(rowsToMeasure: PricedRow[]) => Map<number, number | null>>(
    () => new Map(),
  );

  // Slice 3c: keep the latest-state commit closure + draft snapshot fresh for the
  // debounce/flush (refs avoid stale captures). Runs after every render.
  useEffect(() => {
    draftRatesRef.current = draftRates;
    rowsRef.current = rows;
    autoSaveCellRef.current = (rowIndexField, col) => {
      const r = rows.find((x) => x.row_index === rowIndexField);
      const dd = displayDescriptors.find((x) => x.col === col);
      if (!r || !dd) return;
      const draft = draftRates[cellKey(r.row_index, dd.col)];
      if (draft === undefined) return; // nothing pending for this cell
      commitRate(r, dd, draft);
    };
  });

  // Schedule (or restart) the per-cell 1000ms debounced auto-save. The fire reads the
  // latest draft via autoSaveCellRef; no-ops when the grid is read-only (no onSaveRate).
  // useCallback (dep: onSaveRate) so the memoized rows get a stable reference.
  const scheduleAutoSave = useCallback((row: PricedRow, d: ColumnDescriptor) => {
    if (!onSaveRate) return;
    const key = cellKey(row.row_index, d.col);
    let deb = debouncersRef.current.get(key);
    if (!deb) {
      deb = debounce(() => autoSaveCellRef.current(row.row_index, d.col), AUTOSAVE_MS);
      debouncersRef.current.set(key, deb);
    }
    deb();
  }, [onSaveRate]);

  // ── BCS-S3a: the cost save path ──────────────────────────────────────────────
  //
  // ★ THE ONE THING TO UNDERSTAND HERE. `save_row_bcs_rates` is a WHOLE-ROW SNAPSHOT WRITE: it
  // takes supply / install / combined together and writes 0.0 for any it is not given. A client
  // rate cell saves PER CELL, and porting that shape naively to three boxes would have zeroed
  // the untouched siblings on every keystroke debounce -- correct while typing, wrong the moment
  // you looked away. So every commit GATHERS the row's current draft-or-saved values for all
  // three, through the single pure `mergeBcsRowValues` -> `gatherBcsRowRates` pair. There is no
  // other way to build the payload.

  /** THIS row's live triple, from the LATEST drafts (ref, not render state -- a debounce fire
   *  must not gather a stale snapshot) plus the stored record. `extra` applies the value being
   *  committed right now, which may not have landed in state yet. */
  const gatherBcsForRow = useCallback(
    (row: PricedRow, extra?: { field: BcsRateField; value: string }): BcsRowRates => {
      const drafts = bcsDraftsForRow(row.row_index, draftBcsRatesRef.current);
      if (extra) drafts.set(extra.field, extra.value);
      return gatherBcsRowRates(
        mergeBcsRowValues(bcsRatesRef.current.get(row.source_row_number), drafts),
      );
    },
    [],
  );
  const gatherBcsForRowRef = useRef(gatherBcsForRow);
  gatherBcsForRowRef.current = gatherBcsForRow;

  // Commit ONE cost box. Mirrors commitRate exactly -- cancel this cell's debounce, no-op when
  // unchanged, dedupe blur+Enter, drop the draft on success, KEEP it on failure -- except that
  // the payload is the whole row. useCallback so the memoized rows get a stable reference.
  const commitBcsRate = useCallback(
    (row: PricedRow, kind: BcsRateKind, rawValue: string) => {
      if (!onSaveBcsRates) return;
      const field = BCS_RATE_FIELD[kind];
      const key = bcsCellKey(row.row_index, field);
      bcsDebouncersRef.current.get(key)?.cancel();
      const stored = bcsRatesRef.current.get(row.source_row_number);
      const saved = stored ? String(stored[field] ?? 0) : "";
      if (rawValue === saved) return; // unchanged vs the saved value -> nothing to do
      if (bcsAttemptRef.current[key] === rawValue) return; // dedupe blur+Enter same value
      bcsAttemptRef.current[key] = rawValue;
      const oldNum = (() => {
        const n = parseFloat(saved);
        return Number.isFinite(n) ? n : 0;
      })();
      const rates = gatherBcsForRowRef.current(row, { field, value: rawValue });
      void onSaveBcsRates({
        excelRow: row.source_row_number,
        rates,
        description: row.description ?? undefined,
      })
        .then(() => {
          setDraftBcsRates((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          delete bcsAttemptRef.current[key];
          if (!isReplayingRef.current) {
            setHistory((h) =>
              pushEntry(h, {
                deltas: [],
                bcsDeltas: [
                  {
                    excelRow: row.source_row_number,
                    field,
                    draftKey: key,
                    oldValue: oldNum,
                    newValue: rates[field],
                    description: row.description ?? undefined,
                  },
                ],
              }),
            );
          }
        })
        .catch(() => {
          // Keep the draft (the user sees what they typed); clear the dedupe so a retry works.
          delete bcsAttemptRef.current[key];
        });
    },
    [onSaveBcsRates],
  );

  // The debounced auto-save for one cost box, mirroring scheduleAutoSave.
  const scheduleBcsAutoSave = useCallback(
    (row: PricedRow, kind: BcsRateKind) => {
      if (!onSaveBcsRates) return;
      const field = BCS_RATE_FIELD[kind];
      const key = bcsCellKey(row.row_index, field);
      let deb = bcsDebouncersRef.current.get(key);
      if (!deb) {
        deb = debounce(() => autoSaveBcsCellRef.current(row.row_index, field), AUTOSAVE_MS);
        bcsDebouncersRef.current.set(key, deb);
      }
      deb();
    },
    [onSaveBcsRates],
  );

  // Keep the latest-state closures fresh for the BCS debounce / flush (refs avoid stale
  // captures), mirroring the rate path's effect above.
  useEffect(() => {
    draftBcsRatesRef.current = draftBcsRates;
    bcsRatesRef.current = bcsRatesByExcelRow;
    bcsKindsRef.current = bcsKinds;
    autoSaveBcsCellRef.current = (rowIndexField, field) => {
      const r = rowsRef.current.find((x) => x.row_index === rowIndexField);
      if (!r) return;
      const kind = (Object.keys(BCS_RATE_FIELD) as BcsRateKind[]).find(
        (k) => BCS_RATE_FIELD[k] === field,
      );
      if (!kind) return;
      const draft = draftBcsRates[bcsCellKey(r.row_index, field)];
      if (draft === undefined) return; // nothing pending for this box
      commitBcsRate(r, kind, draft);
    };
  });

  // ── Slice 3b.2 nav model ───────────────────────────────────────────────────
  // Slice 4a.2: the trailing Remarks column is now the matrix's LAST column. Its colIndex is
  // FIXED_ANCHOR_COUNT + displayDescriptors.length (just past the descriptors), and colCount
  // includes it (+1). The +1 only widens nextCell's right/Tab boundary so arrows/Tab reach
  // the remarks cell; no other colIndex math reads colCount (descriptor cells use
  // FIXED_ANCHOR_COUNT + dIdx; anchors use 0..4).
  // Nav dims over the VISIBLE descriptor set (column-hide aware) so the matrix stays consistent
  // with what is rendered -- a hidden column is absent from the matrix + the ref map.
  // BCS-S3a: the cost block sits BETWEEN the descriptors and Remarks. Its keys are the single
  // source for its width -- an EMPTY block gives bcsColStart === remarksColIndex, so every index
  // below is byte-identical to pre-S3a and `descriptorAt`'s carve-out collapses to its old form.
  const bcsColKeys = useMemo(() => bcsColumnKeys(bcsKinds), [bcsKinds]);
  const bcsColStart = descriptorColStart + visibleDescriptors.length;
  const remarksColIndex = bcsColStart + bcsColKeys.length;
  const colCount = remarksColIndex + 1;
  const anyCellActive = activeCell !== null;

  // Editor perf fix (item 1): the cell-level callbacks the memoized rows receive. ALL are
  // useCallback([]) -- they capture only stable refs / state setters, so their identity never
  // changes -> the memo holds across a cursor move (only the per-row activeColIndex changes).
  // The per-cell active/tabindex/className helpers now live INSIDE PricingGridRow (computed
  // from its activeColIndex prop -- the lever); the grid keeps only the focus-ref plumbing.
  const registerCell = useCallback((r: number, c: number, el: HTMLElement | null) => {
    if (el) cellRefs.current.set(navKey(r, c), el);
    else cellRefs.current.delete(navKey(r, c));
  }, []);

  const onCellFocus = useCallback((r: number, c: number) => {
    setActiveCell({ rowIndex: r, colIndex: c });
    // Slice A (clipboard): the focus IS the new selection FOCUS. extendIntentRef (set by the
    // gesture just before focus) decides whether the anchor is HELD (Shift+arrow / Shift+click ->
    // extend) or RESET to here (plain arrow / plain click -> collapse). Consumed once, then reset.
    if (extendIntentRef.current) {
      setSelectionAnchor((a) => a ?? { rowIndex: r, colIndex: c });
    } else {
      setSelectionAnchor({ rowIndex: r, colIndex: c });
    }
    extendIntentRef.current = false;
  }, []);

  // Slice A (clipboard): a Shift held at pointer-down means "extend the selection to the clicked
  // cell" -- record it for the imminent onCellFocus (mousedown precedes focus). Table-level so it
  // needs no per-cell prop (memo untouched); attached via onMouseDownCapture on each table.
  const onTableMouseDown = useCallback((e: ReactMouseEvent) => {
    extendIntentRef.current = e.shiftKey;
  }, []);

  const focusCell = useCallback((r: number, c: number) => {
    // V2: the focus itself, once the target <tr> is mounted (registered in cellRefs). Split-aware.
    const doFocus = () => {
      const el = cellRefs.current.get(navKey(r, c));
      if (!el) return;
      // Frozen-left Slice 1: when split, the SCROLLING pane owns vertical scroll (the frozen pane
      // mirrors it via onScroll). Focusing a frozen (anchor) cell must NOT auto-scroll the frozen
      // pane -- that would desync the two panes -- so focus with preventScroll and drive the scroll
      // through the scrolling pane: a data cell scrolls itself (it lives there); an anchor cell
      // scrolls its scrolling-pane counterpart <tr> (found by data-rowidx).
      // MC-5: the anchor/descriptor boundary is the PARAMETRIC effectiveAnchorCount (fan-out
      // description columns shift it), not the fixed constant.
      if (splitRef.current) {
        el.focus({ preventScroll: true });
        if (c >= effectiveAnchorCount) {
          el.scrollIntoView({ block: "nearest", inline: "nearest" });
        } else {
          scrollPaneRef.current
            ?.querySelector(`tr[data-rowidx="${r}"]`)
            ?.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      el.focus();
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    // V2: an UNMOUNTED target (virtualized, off-window) can't be focused yet. Scroll the window to
    // it (center it -- see scrollRowIntoWindowRef on why not "auto"), then focus after the mount
    // re-render commits (the same reveal-then-defer scaffold jumpToRow uses; 50ms). Single-step
    // arrow nav stays synchronous when the adjacent row is inside ROW_OVERSCAN (mounted -> "focus"
    // path); crossing the overscan edge takes the scroll-then-focus path. Classic mode never has an
    // unmounted target -> "noop".
    const action = resolveJumpAction(cellRefs.current.has(navKey(r, c)), virtualizedRef.current);
    if (action === "scroll-then-focus") {
      scrollRowIntoWindowRef.current(r);
      setTimeout(doFocus, 50);
    } else if (action === "focus") {
      doFocus();
    }
  }, []);

  // Parent click-to-jump: scroll the grid to a row by its Excel row number. Resolves
  // excelRow -> array index (rowsRef is synced each render), then focuses + centers that row's
  // col-0 cell (registered in cellRefs, a stable ref); a target not in the rendered set is a
  // safe no-op. Reference-stable (deps []: only refs are read) -> memo-safe as a row prop. The
  // imperative scrollToRow (search / review-strip) delegates here so there is ONE jump path.
  const jumpToRow = useCallback((excelRow: number) => {
    // Reveal-then-scroll (R5): if the target sits under collapsed parents, ask the page to
    // expand them FIRST. revealed === true means the page mutated `collapsed`, so the target is
    // not yet in the rendered rows -- defer the scroll one tick (50ms, mirroring ReviewTree) so
    // the reveal re-render lands (rowsRef + cellRefs update) before we resolve + scroll. Nothing
    // collapsed on the chain (the common case) -> revealed false -> scroll synchronously, exactly
    // as before (no behaviour change when collapse is unused).
    const revealed = onRevealRow ? onRevealRow(excelRow) : false;
    const doScroll = () => {
      const idx = rowsRef.current.findIndex((r) => r.source_row_number === excelRow);
      if (idx < 0) return;
      const focusEl = () => {
        const el = cellRefs.current.get(navKey(idx, 0));
        if (!el) return;
        if (splitRef.current) {
          // Split: col-0 lives in the frozen pane. Focus it WITHOUT auto-scroll (avoids desyncing
          // the panes), then scroll the SCROLLING pane's counterpart <tr> -- its onScroll mirrors
          // scrollTop back to the frozen pane so both land together.
          el.focus({ preventScroll: true });
          scrollPaneRef.current
            ?.querySelector(`tr[data-rowidx="${idx}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          el.focus();
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      };
      // V2: a jump/search target OUTSIDE the mounted window (virtualized) no longer no-ops -- scroll
      // the window to center it (see scrollRowIntoWindowRef), then focus once the mount re-render has
      // committed (reveal-then-defer scaffold, 50ms). A mounted target focuses synchronously exactly
      // as before; classic never has an unmounted target -> focusEl guards.
      const action = resolveJumpAction(cellRefs.current.has(navKey(idx, 0)), virtualizedRef.current);
      if (action === "scroll-then-focus") {
        scrollRowIntoWindowRef.current(idx);
        setTimeout(focusEl, 50);
      } else {
        focusEl();
      }
      // Landing flash: tint the WHOLE target row blue for 3s so the landing is obvious (focus
      // alone cues only col 0). A new jump RESETS the timer -- rapid jumps don't stack; the
      // latest jump's flash replaces the prior. setState updater + a timeout ref keep this
      // useCallback reference-stable, so the onJumpToRow row prop stays memo-safe.
      setFlashExcelRow(excelRow);
      if (flashTimeoutRef.current !== null) clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = setTimeout(() => {
        setFlashExcelRow(null);
        flashTimeoutRef.current = null;
      }, 3000);
    };
    if (revealed) setTimeout(doScroll, 50);
    else doScroll();
  }, [onRevealRow]);

  // Set THIS row's remarks editor open-state (stable, so the memoized row holds). The row
  // passes its own DURABLE excel row (source_row_number); open=true makes it the single open
  // editor, false closes it. V2: keyed by excel row (see openRemarkExcelRow above).
  const setOpenRemark = useCallback((excelRow: number, open: boolean) => {
    setOpenRemarkExcelRow(open ? excelRow : null);
  }, []);

  // ── Slice A: in-grid clipboard (copy / cut / paste / fill-down) ──────────────────
  // These read CURRENT render state (rows / visibleDescriptors / override / draftRates), so they
  // are plain render-scope fns (recreated each render, like handleGridKeyDown / commitActiveRate).
  // The WRITE side routes EXCLUSIVELY through onBatchWrite (ONE trailing mutate -- the Q5 finding) so
  // there is a SINGLE funnel a later Slice-B undo wrapper can tap; nothing here calls a save endpoint
  // directly. Internal clipboard only (clipboardRef), NEVER navigator.clipboard.

  // The descriptor at a grid colIndex (descriptor columns only), else null.
  // BCS-S3a: the upper bound is now bcsColStart -- the MIRROR-IMAGE carve-out of the leading
  // `>= descriptorColStart` one that the Category column forced. Without it every cost cell
  // would classify as the descriptor that happens to sit at its index minus the offset, and a
  // paste into a cost box would be read as a paste into a rate column. With an EMPTY cost block
  // bcsColStart === remarksColIndex, so this is byte-identical to the pre-S3a bound.
  const descriptorAt = (c: number): ColumnDescriptor | null =>
    c >= descriptorColStart && c < bcsColStart
      ? (visibleDescriptors[c - descriptorColStart] ?? null)
      : null;
  // Which BCS column (a cost box's kind, or one of the computed ones) sits at c -- null outside.
  const bcsAt = (c: number): BcsRateKind | BcsComputedKind | null =>
    bcsColumnAt(c, bcsColStart, bcsKinds);
  // A target cell's kind: remark (last col), a BCS cost box, rate (a rate descriptor), else
  // "other" (anchor / amount / qty -- AND every COMPUTED BCS column, which is never a target).
  //
  // ⚠️ BCS-S3b: the computed test is `isBcsInputColumn`, NEVER `b !== "total"`. Seven call sites
  // asked that literal question; a second computed token answers it "yes, editable" and becomes
  // a paste target on a column with no storage -- silently, with no type error. The guard is a
  // membership test over BCS_COMPUTED_KINDS, so a third computed column is excluded by adding it
  // to that list rather than by remembering seven edits.
  const cellKindAt = (c: number): CellKind => {
    if (c === remarksColIndex) return "remark";
    const b = bcsAt(c);
    if (b) return isBcsInputColumn(b) ? "bcs" : "other";
    const d = descriptorAt(c);
    return d && isRateDescriptor(d) ? "rate" : "other";
  };
  // Is the cost box at colIndex c writable? DELIBERATELY NOT rateWritableAt: save_row_bcs_rates
  // skips the formula, priceability and category gates on purpose (bcs.py:41-59), so cost entry
  // is available on rows -- a qty-less Preamble included -- where a rate is not. The whole gate
  // is the presence of the save callback, which the page withholds per bcsCostEntryReason.
  const bcsWritableAt = (c: number): boolean =>
    !!onSaveBcsRates && isBcsInputColumn(bcsAt(c));
  // One row's merged cost values (draft-or-stored) -- the SAME merge the cells render from.
  const bcsMergedFor = (row: PricedRow): Record<BcsRateField, string | null> =>
    mergeBcsRowValues(
      bcsRatesByExcelRow.get(row.source_row_number),
      bcsDraftsForRow(row.row_index, draftBcsRates),
    );
  // Is the rate cell at (row, c) actually writable? Mirrors the inline edit gate EXACTLY: the cell
  // axis (isRateDescriptor) + the sheet gates (formulasComplete + categoryGateOpen, both ANDed
  // OUTSIDE) + the row axis (isRateEditableRow incl. the override). A paste can no more bypass these
  // than a keystroke can.
  const rateWritableAt = (row: PricedRow, c: number): boolean => {
    const d = descriptorAt(c);
    return (
      !!d && isRateDescriptor(d) && formulasComplete && categoryGateOpen &&
      isRateEditableRow(row, override)
    );
  };
  // Read one cell's copyable value (the optimistic draft when present, else the saved value). Returns
  // a SKIP hole (null) for a non-copyable cell (anchor / amount / qty / out-of-range).
  const readCellForCopy = (rArr: number, c: number): ClipCell => {
    const row = rows[rArr];
    if (!row) return null;
    if (c === remarksColIndex) return { kind: "remark", value: row.remark ?? "" };
    const b = bcsAt(c);
    if (b) {
      // A COMPUTED column is not copyable -- it is a SKIP hole, like an amount cell.
      if (!isBcsInputColumn(b)) return null;
      return { kind: "bcs", value: bcsMergedFor(row)[BCS_RATE_FIELD[b]] ?? "" };
    }
    const d = descriptorAt(c);
    if (!d || !isRateDescriptor(d)) return null;
    const key = cellKey(row.row_index, d.col);
    return { kind: "rate", value: draftRates[key] ?? savedRateStr(row, d) };
  };
  // The active gesture's target rectangle = the live selection, else the single active cell (1x1).
  const activeRect = (): SelRect | null => {
    if (!activeCell) return null;
    if (selectionAnchor) return selectionRect(selectionAnchor, activeCell);
    return {
      top: activeCell.rowIndex,
      bottom: activeCell.rowIndex,
      left: activeCell.colIndex,
      right: activeCell.colIndex,
    };
  };
  // Build a clipboard block from a rectangle (copy / cut source).
  const blockFromRect = (rect: SelRect): ClipboardBlock => {
    const cells: ClipCell[][] = [];
    for (let r = rect.top; r <= rect.bottom; r++) {
      const rowCells: ClipCell[] = [];
      for (let c = rect.left; c <= rect.right; c++) rowCells.push(readCellForCopy(r, c));
      cells.push(rowCells);
    }
    const { rows: rr, cols: cc } = rectDims(rect);
    return { rows: rr, cols: cc, cells };
  };

  // Show a transient status line (paste summary / shape-mismatch reject), auto-clearing.
  const showClipboardMsg = (msg: string) => {
    setClipboardMsg(msg);
    if (clipboardMsgTimeoutRef.current) clearTimeout(clipboardMsgTimeoutRef.current);
    clipboardMsgTimeoutRef.current = setTimeout(() => {
      setClipboardMsg(null);
      clipboardMsgTimeoutRef.current = null;
    }, 4000);
  };
  // Flash the amber "skipped" ring on a set of (arrayRow, colIndex) cells, self-clearing (memo-safe
  // per-row CSV scalars, NOT a shared object handed to a row).
  const flashSkips = (skips: { r: number; c: number }[]) => {
    const byRow = new Map<number, number[]>();
    for (const s of skips) {
      const a = byRow.get(s.r) ?? [];
      a.push(s.c);
      byRow.set(s.r, a);
    }
    const csv = new Map<number, string>();
    for (const [r, cs] of byRow) csv.set(r, cs.sort((a, b) => a - b).join(","));
    setSkipFlash(csv);
    if (skipFlashTimeoutRef.current) clearTimeout(skipFlashTimeoutRef.current);
    skipFlashTimeoutRef.current = setTimeout(() => {
      setSkipFlash(new Map());
      skipFlashTimeoutRef.current = null;
    }, 2500);
  };
  // BCS-S3a: `notCostable` is its OWN count, never folded into `nonPriceable` -- a cost box is
  // refused by the BCS gates, which are deliberately independent of priceability, so borrowing
  // that word would send the reader to fix a rule that was never in force.
  const pasteSummary = (
    written: number,
    crossKind: number,
    nonPriceable: number,
    notCostable = 0,
  ): string => {
    const head = `Wrote ${written} cell${written === 1 ? "" : "s"}`;
    const bits: string[] = [];
    if (nonPriceable) bits.push(`${nonPriceable} not priceable`);
    if (notCostable) bits.push(`${notCostable} not costable`);
    if (crossKind) bits.push(`${crossKind} wrong type`);
    return bits.length ? `${head}; skipped ${bits.join(", ")}.` : `${head}.`;
  };

  // Apply resolved writes optimistically (rate drafts show instantly) + fire the ONE-mutate batch.
  // After the batch settles, drop the optimistic drafts so the cells fall back to the refetched
  // saved values (on a partial failure -- which still RESOLVES -- the dropped draft reverts to the
  // prior saved value: honest, no fake atomicity). Remarks have no draft layer -> they rely on the
  // mutate. ⚠️ Which layers drop is `batchDraftsToDrop`'s call, NOT a blanket `.finally()`: cost
  // drafts survive a REJECTION because the whole-row cost write would otherwise zero a sibling.
  // Returns the batch promise (resolves to BatchOutcome) so a caller can read outcome.written --
  // the LANDED count (handleBatchWrite applies sequentially + breaks on first failure, so the
  // first `written` entries of `writes` are exactly the successes). undefined when read-only / empty.
  const runBatch = (
    writes: BatchWrite[],
    optimisticDrafts: Record<string, string>,
    optimisticBcsDrafts: Record<string, string> = {},
  ): Promise<BatchOutcome> | undefined => {
    if (!onBatchWrite || writes.length === 0) return undefined;
    const draftKeys = Object.keys(optimisticDrafts);
    // BCS-S3a: the cost drafts ride the SAME show-then-drop lifecycle, in their own map.
    const bcsKeys = Object.keys(optimisticBcsDrafts);
    if (draftKeys.length > 0) {
      setDraftRates((prev) => ({ ...prev, ...optimisticDrafts }));
      setProposedRates((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const k of draftKeys)
          if (next[k] !== undefined) {
            delete next[k];
            changed = true;
          }
        return changed ? next : prev;
      });
    }
    if (bcsKeys.length > 0) setDraftBcsRates((prev) => ({ ...prev, ...optimisticBcsDrafts }));
    const dropRateDrafts = () => {
      if (draftKeys.length === 0) return;
      setDraftRates((prev) => {
        const next = { ...prev };
        for (const k of draftKeys) delete next[k];
        return next;
      });
    };
    const dropBcsDrafts = () => {
      if (bcsKeys.length === 0) return;
      setDraftBcsRates((prev) => {
        const next = { ...prev };
        for (const k of bcsKeys) delete next[k];
        return next;
      });
    };
    // ⚠️ SETTLE, NOT `finally` -- the two draft layers have DIFFERENT lifecycles and the S3a
    // `.finally()` gave them the same one. `batchDraftsToDrop` is the policy; see its comment for
    // why. Rejection re-throws, so every caller sees exactly the settlement it saw before.
    return onBatchWrite(writes).then(
      (outcome) => {
        const drop = batchDraftsToDrop("fulfilled");
        if (drop.rates) dropRateDrafts();
        if (drop.bcs) dropBcsDrafts();
        return outcome;
      },
      (err) => {
        const drop = batchDraftsToDrop("rejected");
        if (drop.rates) dropRateDrafts();
        if (drop.bcs) dropBcsDrafts();
        throw err;
      },
    );
  };

  // Slice B (undo/redo): record a batch gesture's LANDED rate deltas as ONE history entry. `deltas`
  // is aligned 1:1 with the `writes` array (null where a write was a remark -- not undoable);
  // `written` is the outcome's landed count, so only deltas[i] for i < written (and non-null) are
  // recorded. Skipped while replaying (the re-record guard) and when nothing landed.
  // BCS-S3a: `bcsGroups` is ALSO 1:1 with `writes` (null for a non-cost write). It has to be a
  // GROUP rather than a single delta because one cost write covers a whole row -- two boxes
  // edited in one gesture are two deltas behind one save (foldBcsWrites), and recording them
  // folded would lose which box the user actually touched, so an undo would overwrite a sibling
  // the gesture never wrote.
  const recordLandedBatch = (
    deltas: (RateDelta | null)[],
    written: number,
    bcsGroups: (BcsDelta[] | null)[] = [],
  ) => {
    if (isReplayingRef.current) return;
    const landed: RateDelta[] = [];
    const landedBcs: BcsDelta[] = [];
    for (let i = 0; i < written && i < deltas.length; i++) {
      const dlt = deltas[i];
      if (dlt) landed.push(dlt);
      const grp = bcsGroups[i];
      if (grp) landedBcs.push(...grp);
    }
    if (landed.length > 0 || landedBcs.length > 0) {
      setHistory((h) =>
        pushEntry(h, {
          deltas: landed,
          ...(landedBcs.length > 0 ? { bcsDeltas: landedBcs } : {}),
        }),
      );
    }
  };

  // Slice B (undo/redo): a target cell's current SAVED rate as a number (the "old" for a delta) --
  // mirrors commitRate's saved-value semantics (blank / non-number -> 0).
  const savedRateNum = (row: PricedRow, d: ColumnDescriptor): number => {
    const n = parseFloat(savedRateStr(row, d));
    return Number.isFinite(n) ? n : 0;
  };

  // ── BCS-S3a: one gesture's cost intents -> the FOLDED per-row writes ──────────────
  // ⚠️ THE ROW-VS-CELL SHAPE, and the place it bites hardest. A paste spanning two cost columns
  // must not fire save_row_bcs_rates twice for the same row: the second call is a whole-row
  // snapshot and would overwrite the first with a 0 for the column it had just written. So the
  // per-CELL intents are folded into ONE write per ROW (clipboard.foldBcsWrites), each starting
  // from that row's own current draft-or-saved triple so untouched siblings survive.
  interface BcsIntent {
    row: PricedRow;
    field: BcsRateField;
    raw: string;
  }
  const buildBcsBatch = (intents: BcsIntent[]) => {
    const drafts: Record<string, string> = {};
    const perRow = new Map<number, BcsDelta[]>();
    const folded: { excelRow: number; field: BcsRateField; value: number; description?: string }[] =
      [];
    for (const it of intents) {
      const n = parseFloat(it.raw);
      const value = Number.isFinite(n) ? n : 0;
      const savedStr = bcsRatesByExcelRow.get(it.row.source_row_number)?.[it.field];
      folded.push({
        excelRow: it.row.source_row_number,
        field: it.field,
        value,
        description: it.row.description ?? undefined,
      });
      drafts[bcsCellKey(it.row.row_index, it.field)] = it.raw;
      const group = perRow.get(it.row.source_row_number) ?? [];
      group.push({
        excelRow: it.row.source_row_number,
        field: it.field,
        draftKey: bcsCellKey(it.row.row_index, it.field),
        oldValue: typeof savedStr === "number" ? savedStr : 0,
        newValue: value,
        description: it.row.description ?? undefined,
      });
      perRow.set(it.row.source_row_number, group);
    }
    const writes = foldBcsWrites(folded, (excelRow) => {
      const row = rows.find((r) => r.source_row_number === excelRow);
      return row
        ? gatherBcsRowRates(bcsMergedFor(row))
        : { supply_rate: 0, install_rate: 0, combined_rate: 0 };
    });
    const groups = writes.map((w) => perRow.get(w.args.excelRow) ?? null);
    return { writes, groups, drafts };
  };
  // Append the folded cost writes to a gesture's arrays, keeping BOTH parallel arrays 1:1 with
  // `writes` (the rate/remark pushes above never touch bcsGroups, so it is padded here). The
  // cost drafts land in their OWN map -- runBatch keeps the two draft layers apart.
  const appendBcsWrites = (
    intents: BcsIntent[],
    writes: BatchWrite[],
    deltas: (RateDelta | null)[],
    bcsGroups: (BcsDelta[] | null)[],
    bcsDrafts: Record<string, string>,
  ) => {
    if (intents.length === 0) return;
    const built = buildBcsBatch(intents);
    while (bcsGroups.length < writes.length) bcsGroups.push(null);
    built.writes.forEach((w, i) => {
      writes.push(w);
      deltas.push(null);
      bcsGroups.push(built.groups[i]);
    });
    Object.assign(bcsDrafts, built.drafts);
  };

  const doCopy = () => {
    const rect = activeRect();
    if (!rect) return;
    const block = blockFromRect(rect);
    clipboardRef.current = block;
    const n = block.cells.reduce((s, row) => s + row.filter(Boolean).length, 0);
    showClipboardMsg(
      n > 0 ? `Copied ${n} cell${n === 1 ? "" : "s"}.` : "Nothing copyable in the selection.",
    );
  };

  const doCut = () => {
    const rect = activeRect();
    if (!rect) return;
    const block = blockFromRect(rect);
    clipboardRef.current = block;
    if (!onBatchWrite) {
      showClipboardMsg("Copied (sheet is read-only -- source not cleared).");
      return;
    }
    const writes: BatchWrite[] = [];
    const deltas: (RateDelta | null)[] = []; // Slice B: 1:1 with writes (null = remark, not undoable)
    const bcsGroups: (BcsDelta[] | null)[] = []; // BCS-S3a: also 1:1 with writes
    const drafts: Record<string, string> = {};
    const bcsDrafts: Record<string, string> = {};
    const bcsIntents: BcsIntent[] = [];
    const skips: { r: number; c: number }[] = [];
    for (let i = 0; i < block.rows; i++) {
      for (let j = 0; j < block.cols; j++) {
        const cell = block.cells[i][j];
        if (!cell) continue;
        const r = rect.top + i;
        const c = rect.left + j;
        const row = rows[r];
        if (!row) continue;
        if (cell.kind === "remark") {
          writes.push({
            kind: "remark",
            args: { excelRow: row.source_row_number, remark: "", description: row.description ?? undefined },
          });
          deltas.push(null);
        } else if (cell.kind === "bcs") {
          // A cut cost box clears to 0 -- collected, then folded into ONE write per row below.
          const b = bcsAt(c);
          if (isBcsInputColumn(b) && bcsWritableAt(c)) {
            bcsIntents.push({ row, field: BCS_RATE_FIELD[b], raw: "" });
          } else {
            skips.push({ r, c });
          }
        } else {
          const d = descriptorAt(c);
          if (d && rateWritableAt(row, c)) {
            const cellArgs = buildRateCell(row, d);
            const dk = cellKey(row.row_index, d.col);
            writes.push({ kind: "rate", cell: cellArgs, rate: 0 });
            deltas.push({ cell: cellArgs, draftKey: dk, oldRate: savedRateNum(row, d), newRate: 0 });
            drafts[dk] = "";
          } else {
            skips.push({ r, c });
          }
        }
      }
    }
    appendBcsWrites(bcsIntents, writes, deltas, bcsGroups, bcsDrafts);
    flashSkips(skips);
    void runBatch(writes, drafts, bcsDrafts)?.then((o) =>
      recordLandedBatch(deltas, o.written, bcsGroups),
    );
    // Count CELLS, not writes: the cost writes are folded per row, so writes.length would
    // under-report a cut spanning two cost columns.
    const cut = writes.length - (bcsGroups.filter(Boolean).length) + bcsIntents.length;
    showClipboardMsg(
      skips.length
        ? `Cut ${cut} cell${cut === 1 ? "" : "s"}; skipped ${skips.length} (not writable).`
        : `Cut ${cut} cell${cut === 1 ? "" : "s"}.`,
    );
  };

  const doPaste = () => {
    const block = clipboardRef.current;
    if (!block) {
      showClipboardMsg("Clipboard is empty -- copy cells first.");
      return;
    }
    if (!onBatchWrite) return; // locked / read-only: paste no-ops
    const rect = activeRect();
    if (!rect) return;
    const target = rectDims(rect);
    if (!shapesMatch({ rows: block.rows, cols: block.cols }, target)) {
      showClipboardMsg(
        `Paste cancelled: the copied ${block.rows}x${block.cols} block doesn't match the ${target.rows}x${target.cols} selection. Nothing was written.`,
      );
      return;
    }
    const writes: BatchWrite[] = [];
    const deltas: (RateDelta | null)[] = []; // Slice B: 1:1 with writes (null = remark, not undoable)
    const bcsGroups: (BcsDelta[] | null)[] = []; // BCS-S3a: also 1:1 with writes
    const drafts: Record<string, string> = {};
    const bcsDrafts: Record<string, string> = {};
    const bcsIntents: BcsIntent[] = [];
    const skips: { r: number; c: number }[] = [];
    let crossKind = 0;
    let nonPriceable = 0;
    let notCostable = 0;
    let cellsWritten = 0;
    for (let i = 0; i < block.rows; i++) {
      for (let j = 0; j < block.cols; j++) {
        const clip = block.cells[i][j];
        if (!clip) continue; // a SKIP hole pastes nothing
        const r = rect.top + i;
        const c = rect.left + j;
        const row = rows[r];
        if (!row) continue;
        const verdict = classifyPasteTarget(
          clip.kind,
          cellKindAt(c),
          (clip.kind === "rate" && rateWritableAt(row, c)) ||
            (clip.kind === "bcs" && bcsWritableAt(c)),
        );
        if (verdict === "WRITE") {
          if (clip.kind === "remark") {
            writes.push({
              kind: "remark",
              args: { excelRow: row.source_row_number, remark: clip.value, description: row.description ?? undefined },
            });
            deltas.push(null);
            cellsWritten++;
          } else if (clip.kind === "bcs") {
            const b = bcsAt(c);
            if (!isBcsInputColumn(b)) {
              skips.push({ r, c });
              continue;
            }
            bcsIntents.push({ row, field: BCS_RATE_FIELD[b], raw: clip.value });
            cellsWritten++;
          } else {
            const d = descriptorAt(c);
            if (!d) {
              skips.push({ r, c });
              continue;
            }
            const num = parseFloat(clip.value);
            const rate = Number.isFinite(num) ? num : 0;
            const cellArgs = buildRateCell(row, d);
            const dk = cellKey(row.row_index, d.col);
            writes.push({ kind: "rate", cell: cellArgs, rate });
            deltas.push({ cell: cellArgs, draftKey: dk, oldRate: savedRateNum(row, d), newRate: rate });
            drafts[dk] = clip.value;
            cellsWritten++;
          }
        } else {
          skips.push({ r, c });
          if (verdict === "SKIP_CROSS_KIND") crossKind++;
          else if (verdict === "SKIP_NOT_COSTABLE") notCostable++;
          else nonPriceable++;
        }
      }
    }
    appendBcsWrites(bcsIntents, writes, deltas, bcsGroups, bcsDrafts);
    flashSkips(skips);
    void runBatch(writes, drafts, bcsDrafts)?.then((o) =>
      recordLandedBatch(deltas, o.written, bcsGroups),
    );
    showClipboardMsg(pasteSummary(cellsWritten, crossKind, nonPriceable, notCostable));
  };

  const doFillDown = () => {
    if (!onBatchWrite) return; // locked / read-only: fill no-ops
    const rect = activeRect();
    if (!rect || rect.bottom === rect.top) {
      showClipboardMsg("Fill down needs a selection spanning more than one row.");
      return;
    }
    const writes: BatchWrite[] = [];
    const deltas: (RateDelta | null)[] = []; // Slice B: 1:1 with writes (null = remark, not undoable)
    const bcsGroups: (BcsDelta[] | null)[] = []; // BCS-S3a: also 1:1 with writes
    const drafts: Record<string, string> = {};
    const bcsDrafts: Record<string, string> = {};
    const bcsIntents: BcsIntent[] = [];
    const skips: { r: number; c: number }[] = [];
    let crossKind = 0;
    let nonPriceable = 0;
    let notCostable = 0;
    let cellsWritten = 0;
    for (let c = rect.left; c <= rect.right; c++) {
      const top = readCellForCopy(rect.top, c);
      if (!top) continue; // a non-copyable top cell -> skip the whole column silently
      for (let r = rect.top + 1; r <= rect.bottom; r++) {
        const row = rows[r];
        if (!row) continue;
        const verdict = classifyPasteTarget(
          top.kind,
          cellKindAt(c),
          (top.kind === "rate" && rateWritableAt(row, c)) ||
            (top.kind === "bcs" && bcsWritableAt(c)),
        );
        if (verdict === "WRITE") {
          if (top.kind === "remark") {
            writes.push({
              kind: "remark",
              args: { excelRow: row.source_row_number, remark: top.value, description: row.description ?? undefined },
            });
            deltas.push(null);
            cellsWritten++;
          } else if (top.kind === "bcs") {
            const b = bcsAt(c);
            if (!isBcsInputColumn(b)) {
              skips.push({ r, c });
              continue;
            }
            bcsIntents.push({ row, field: BCS_RATE_FIELD[b], raw: top.value });
            cellsWritten++;
          } else {
            const d = descriptorAt(c);
            if (!d) {
              skips.push({ r, c });
              continue;
            }
            const num = parseFloat(top.value);
            const rate = Number.isFinite(num) ? num : 0;
            const cellArgs = buildRateCell(row, d);
            const dk = cellKey(row.row_index, d.col);
            writes.push({ kind: "rate", cell: cellArgs, rate });
            deltas.push({ cell: cellArgs, draftKey: dk, oldRate: savedRateNum(row, d), newRate: rate });
            drafts[dk] = top.value;
            cellsWritten++;
          }
        } else {
          skips.push({ r, c });
          if (verdict === "SKIP_CROSS_KIND") crossKind++;
          else if (verdict === "SKIP_NOT_COSTABLE") notCostable++;
          else nonPriceable++;
        }
      }
    }
    appendBcsWrites(bcsIntents, writes, deltas, bcsGroups, bcsDrafts);
    flashSkips(skips);
    void runBatch(writes, drafts, bcsDrafts)?.then((o) =>
      recordLandedBatch(deltas, o.written, bcsGroups),
    );
    showClipboardMsg(pasteSummary(cellsWritten, crossKind, nonPriceable, notCostable));
  };

  // ── Slice B: undo / redo -- replay rate gestures through the EXISTING save path ────
  // A delta-based replay: build BatchWrite[] from the entry's deltas and fire the grid's OWN
  // runBatch -> onBatchWrite (ONE trailing mutate, server-consistent). isReplayingRef stops the
  // capture path from re-recording the replay. Per-delta the target is RE-GATED (a now non-priceable
  // row / hidden-irrelevant) via isDeltaWritable, mirroring the clipboard skip posture -- a replay
  // never forces a write past a gate. A locked / read-only sheet (no onBatchWrite) -> the whole
  // undo/redo no-ops, exactly like paste.

  // Is this delta's target still a writable rate cell NOW? Resolve the row by excel row + the
  // descriptor by col over the FULL set (column-hide must NOT block an undo), then apply the SAME
  // server-mirrored gate (rate descriptor + formulasComplete + categoryGateOpen + isRateEditableRow).
  const isDeltaWritable = (delta: RateDelta): boolean => {
    const row = rows.find((r) => r.source_row_number === delta.cell.excelRow);
    if (!row) return false;
    const dd = displayDescriptors.find((x) => x.col === delta.cell.colLetter);
    if (!dd || !isRateDescriptor(dd)) return false;
    return formulasComplete && categoryGateOpen && isRateEditableRow(row, override);
  };

  // Replay one entry: write each still-writable delta's newRate (undo passes invert(entry), so its
  // newRate is the OLD value). No history capture (runBatch is the low-level path; isReplayingRef is
  // the belt-and-suspenders guard). Skipped deltas are simply not written.
  // BCS-S3a: is this cost delta's target still writable NOW? The box's kind must still be live
  // on this sheet (a re-commit can change the sheet's rate columns under a session's history)
  // and the row must still be rendered. NO priceability / formula / category test -- the same
  // deliberate asymmetry the capture path has.
  const isBcsDeltaWritable = (d: BcsDelta): boolean => {
    if (!onSaveBcsRates) return false;
    if (!rows.some((r) => r.source_row_number === d.excelRow)) return false;
    return bcsKinds.some((k) => BCS_RATE_FIELD[k] === d.field);
  };

  const replayEntry = (entry: HistoryEntry) => {
    if (!onBatchWrite) return;
    const live = entry.deltas.filter(isDeltaWritable);
    const liveBcs = (entry.bcsDeltas ?? []).filter(isBcsDeltaWritable);
    if (live.length === 0 && liveBcs.length === 0) return;
    isReplayingRef.current = true;
    try {
      const writes: BatchWrite[] = live.map((d) => ({ kind: "rate", cell: d.cell, rate: d.newRate }));
      const drafts: Record<string, string> = {};
      for (const d of live) drafts[d.draftKey] = String(d.newRate);
      // The cost deltas re-fold into ONE write per row, off each row's CURRENT triple -- so a
      // replay that touches one box cannot zero the sibling it never wrote.
      const bcsDrafts: Record<string, string> = {};
      if (liveBcs.length > 0) {
        const folded = foldBcsWrites(
          liveBcs.map((d) => ({
            excelRow: d.excelRow,
            field: d.field,
            value: d.newValue,
            description: d.description,
          })),
          (excelRow) => {
            const row = rows.find((r) => r.source_row_number === excelRow);
            return row
              ? gatherBcsRowRates(bcsMergedFor(row))
              : { supply_rate: 0, install_rate: 0, combined_rate: 0 };
          },
        );
        writes.push(...folded);
        for (const d of liveBcs) bcsDrafts[d.draftKey] = String(d.newValue);
      }
      void runBatch(writes, drafts, bcsDrafts);
    } finally {
      isReplayingRef.current = false;
    }
  };

  const undo = () => {
    if (!onBatchWrite) return; // read-only / locked -> no-op
    const r = popUndo(historyRef.current);
    if (!r) return;
    setHistory({ undo: r.state.undo, redo: [...r.state.redo, r.entry] }); // move undo -> redo
    replayEntry(invert(r.entry)); // write the OLD rates
  };
  const redo = () => {
    if (!onBatchWrite) return;
    const r = popRedo(historyRef.current);
    if (!r) return;
    setHistory({ undo: [...r.state.undo, r.entry], redo: r.state.redo }); // move redo -> undo
    replayEntry(r.entry); // write the NEW rates again
  };
  // Keep refs to the latest closures so the (stable) imperative handle always calls the fresh
  // undo/redo (which close over the current rows/override/etc.) without rebuilding the handle.
  undoRef.current = undo;
  redoRef.current = redo;

  // ── Slice A: right-click CONTEXT MENU -- a SECOND trigger for the SAME doX fns ────
  // A pure alternate trigger: every item calls the EXISTING doCopy/doCut/doPaste/doFillDown, so a
  // menu action is byte-for-byte a keyboard action (same selection semantics, status strip, skip
  // flash). The menu is GRID-LEVEL (the onContextMenu is on the 3 <table>s, like onTableMouseDown
  // -- no per-row prop, memo untouched). It reuses the house DropdownMenu (no new dep) as a
  // CONTROLLED menu anchored to a 0-size cursor-positioned trigger; DropdownMenuContent portals to
  // <body>, so it is never clipped by a pane's overflow + gets Esc / click-away / focus for free.

  // Resolve a clicked cell's grid colIndex from its EXISTING data-colkey (every cell carries one:
  // a0..a3 + the fan-out desc:<col> anchors / "d:<col>" descriptors / "remarks"). MC-5: the pure
  // colIndexFromColKeyPure resolves the fan-out description keys via anchorWidthKeys.
  const colIndexFromColKey = (colkey: string | undefined): number | null =>
    colIndexFromColKeyPure(
      colkey,
      anchorWidthKeys,
      visibleDescriptors.map((d) => columnWidthKey("descriptor", d.col)),
      descriptorColStart,
      remarksColIndex,
      // BCS-S3a, corrected at BCS-S2e: one `bcs:<kind>` per live cost box plus ALL THREE
      // computed keys (`bcs:total`, `bcs:tendered`, `bcs:margin`); [] when there is no cost
      // block. This said "+ `bcs:total`" -- written when the Total was the only computed
      // column, and left behind when S3b added the other two. `bcsColumnKeys` derives the
      // list from `BCS_COMPUTED_KINDS`, so the code was right and only the sentence was stale.
      bcsColKeys,
      bcsColStart,
    );

  // Compute each menu item's enabled state for a target rect NOW (open-time), reading the
  // NON-reactive clipboardRef FRESH (a render-time disabled prop would read stale). Copy needs any
  // copyable cell; Cut needs onBatchWrite + any writable cell; Paste needs onBatchWrite + a
  // non-empty clipboard; Fill-down needs onBatchWrite + a >1-row rect. Reuses the SAME
  // blockFromRect / rateWritableAt the doX fns use -- no divergent logic.
  const computeMenuFlags = (rect: SelRect) => {
    const block = blockFromRect(rect);
    let copyable = false;
    let writable = false;
    for (let i = 0; i < block.rows; i++) {
      for (let j = 0; j < block.cols; j++) {
        const cell = block.cells[i][j];
        if (!cell) continue;
        copyable = true;
        const row = rows[rect.top + i];
        if (!row) continue;
        const c = rect.left + j;
        if (cell.kind === "remark" || rateWritableAt(row, c) || bcsWritableAt(c)) writable = true;
      }
    }
    return {
      canCopy: copyable,
      canCut: !!onBatchWrite && writable,
      canPaste: !!onBatchWrite && clipboardRef.current !== null,
      canFill: !!onBatchWrite && rect.bottom > rect.top,
    };
  };

  // Right-click a cell: suppress the native menu, ESTABLISH the target (inside the current
  // multi-cell selection -> PRESERVE it, operate on the whole range; outside / no selection ->
  // COLLAPSE to the clicked cell via focusCell, which onCellFocus reduces to a 1x1 selection),
  // then OPEN the menu at the cursor with open-time enabled flags. A non-cell target (header /
  // gutter -- no resolvable row) falls through to the native menu.
  const onCellContextMenu = (e: ReactMouseEvent) => {
    const target = e.target as HTMLElement;
    const trEl = target.closest<HTMLElement>("[data-navr]");
    const cellEl = target.closest<HTMLElement>("[data-colkey]");
    if (!trEl || !cellEl) return; // not a grid cell -> leave the native menu
    const r = Number(trEl.dataset.navr);
    const c = colIndexFromColKey(cellEl.dataset.colkey);
    if (!Number.isFinite(r) || c === null) return;
    e.preventDefault();
    const sel =
      selectionAnchor && activeCell ? selectionRect(selectionAnchor, activeCell) : null;
    const inside = !!sel && r >= sel.top && r <= sel.bottom && c >= sel.left && c <= sel.right;
    const rect: SelRect = inside ? sel : { top: r, bottom: r, left: c, right: c };
    if (!inside) {
      // Collapse to the clicked cell. extendIntentRef=false so onCellFocus (fired by focusCell)
      // reduces the selection to (r,c) -- never accidentally extends from a Shift+right-click.
      extendIntentRef.current = false;
      focusCell(r, c);
    }
    setMenu({ open: true, x: e.clientX, y: e.clientY, ...computeMenuFlags(rect) });
  };

  // Commit the active cell IF it is an editable rate cell (locked: explicit commit-on-move;
  // the committedAttemptRef dedupe absorbs the trailing onBlur -> no double-save).
  const commitActiveRate = (cell: CellCoord) => {
    if (!onSaveRate || cell.colIndex < descriptorColStart) return;
    // colIndex is over the VISIBLE descriptor set (column-hide aware) -- reverse-map through the
    // SAME visibleDescriptors the cells render from, else a hidden column would shift the lookup.
    const d = visibleDescriptors[cell.colIndex - descriptorColStart];
    if (!d || !isRateDescriptor(d)) return;
    const row = rows[cell.rowIndex];
    if (!row) return;
    const key = cellKey(row.row_index, d.col);
    commitRate(row, d, draftRates[key] ?? savedRateStr(row, d));
  };

  // BCS-S3a: the same commit-on-move for a cost box (arrow/Tab away persists the typed value).
  // A rate colIndex can never reach here and vice-versa -- `bcsAt` returns null outside the block.
  const commitActiveBcs = (cell: CellCoord) => {
    if (!onSaveBcsRates) return;
    const b = bcsAt(cell.colIndex);
    if (!isBcsInputColumn(b)) return;
    const row = rows[cell.rowIndex];
    if (!row) return;
    const field = BCS_RATE_FIELD[b];
    const draft = draftBcsRates[bcsCellKey(row.row_index, field)];
    if (draft === undefined) return; // nothing typed -> nothing to commit
    commitBcsRate(row, b, draft);
  };

  // The single grid keydown handler (on the <table>; cell/input keydowns bubble here).
  // Maps a nav key -> direction, commits the active rate cell, then moves focus. Always
  // preventDefaults a nav key while the grid is active so arrows never move the input caret
  // and Tab never escapes the grid (at an edge: commit + stay put).
  const handleGridKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (!activeCell) return;
    // Slice A (clipboard): Ctrl/Cmd + C/X/V/D act on the active cell or the selection. Checked
    // BEFORE the nav mapping; each preventDefaults. Undo/redo (Z/Y) are Slice B -- deliberately NOT
    // bound here; any OTHER modifier combo falls through untouched (Ctrl+A etc.), and plain typing /
    // the input's decimal guard are never reached (a modifier is held), so they stay intact.
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "c") {
        e.preventDefault();
        doCopy();
        return;
      }
      if (k === "x") {
        e.preventDefault();
        doCut();
        return;
      }
      if (k === "v") {
        e.preventDefault();
        doPaste();
        return;
      }
      if (k === "d") {
        e.preventDefault();
        doFillDown();
        return;
      }
      // Slice B (undo/redo): Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z = redo, Ctrl/Cmd+Y = redo
      // (Windows). preventDefault so a mid-edit rate <input> does NOT also do native text-undo
      // (keydown bubbles to the table; the input has no onKeyDown). e.shiftKey distinguishes redo.
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (k === "y") {
        e.preventDefault();
        redo();
        return;
      }
    }
    // Slice 4a.2: Enter on the focused REMARKS cell OPENS its editor (not move-down) --
    // but only when editable (onSaveRemark present). A read-only remarks cell has nothing
    // to open, so Enter falls through to the generic Enter->down below (matching every other
    // read-only cell). preventDefault stops the cell's native button/Enter side effects.
    if (activeCell.colIndex === remarksColIndex && e.key === "Enter" && onSaveRemark) {
      e.preventDefault();
      // V2: open by the row's DURABLE excel row (the active cell is a mounted array index -> resolve).
      setOpenRemarkExcelRow(rows[activeCell.rowIndex]?.source_row_number ?? null);
      return;
    }
    // Parent click-to-jump: Enter on the focused PARENT cell (col 2) jumps to the parent row
    // (mirrors the remarks Enter case; mouse-click + Space already activate the button). A ROOT
    // row has no parent -> fall through to the generic Enter->down so nav is unchanged there.
    if (activeCell.colIndex === 2 && e.key === "Enter") {
      const r = rows[activeCell.rowIndex];
      const parentExcel = r ? parentExcelRowOf(r, byIdx) : null;
      if (parentExcel !== null) {
        e.preventDefault();
        jumpToRow(parentExcel);
        return;
      }
    }
    // CL-3/CL-6: Enter on the focused CATEGORY cell (colIndex FIXED_ANCHOR_COUNT) OPENS the verdict
    // picker (mirrors the remarks + parent Enter cases; mouse-click already opens it). Editable when
    // the page wired onCategoryClick AND (the row is already classified OR it is an eligible blank
    // cell on a run sheet -- SAME gate as the click path); a non-editable / unwired cell falls
    // through to the generic Enter->down so nav is unchanged there.
    if (activeCell.colIndex === effectiveAnchorCount && e.key === "Enter" && onCategoryClick) {
      const r = rows[activeCell.rowIndex];
      const cat = r ? categoriesByExcelRow.get(r.source_row_number) : undefined;
      const el = cellRefs.current.get(navKey(activeCell.rowIndex, effectiveAnchorCount));
      if (r && (isRowEditable(cat) || (isPriceableType(r.node_type) && hasRun)) && el) {
        e.preventDefault();
        onCategoryClick(r.source_row_number, el as HTMLElement);
        return;
      }
    }
    let dir: NavDirection | null = null;
    if (e.key === "ArrowUp") dir = "up";
    else if (e.key === "ArrowDown") dir = "down";
    else if (e.key === "ArrowLeft") dir = "left";
    else if (e.key === "ArrowRight") dir = "right";
    else if (e.key === "Enter") dir = "down";
    else if (e.key === "Tab") dir = e.shiftKey ? "shift-tab" : "tab";
    if (!dir) return; // not a nav key -> let typing / the decimal guard handle it
    e.preventDefault(); // own the nav keys: no caret move, no tab-escape
    commitActiveRate(activeCell);
    commitActiveBcs(activeCell); // BCS-S3a: the cost boxes commit on move too
    const next = nextCell(activeCell, dir, rows.length, colCount);
    if (next) {
      // Slice A (clipboard): Shift+arrow EXTENDS the selection (hold the anchor, move the focus); a
      // plain arrow / Enter / Tab collapses it. extendIntentRef is read by onCellFocus after focus
      // lands. (Shift+Tab stays pure nav -- not a selection-extend gesture.) Set ONLY on a real move.
      extendIntentRef.current = e.key.startsWith("Arrow") && e.shiftKey;
      focusCell(next.rowIndex, next.colIndex);
    }
  };

  // ── Slice 3c: dirty signal + force-flush handle + flush-on-unmount ───────────
  // Surface "has uncommitted drafts" up to the page (drives the "Unsaved changes" status).
  // BCS-S3a: a pending COST draft counts as dirty too. This is load-bearing, not cosmetic --
  // the dirty signal is what fires the page's ensureLockAcquired, and save_row_bcs_rates takes
  // the single-editor lock (acquire_or_refresh) exactly as save_cell_price does. Without it the
  // very first cost keystroke would reach the server with no lock in hand.
  const hasUnsaved =
    Object.keys(draftRates).length > 0 || Object.keys(draftBcsRates).length > 0;
  useEffect(() => {
    onDirtyChange?.(hasUnsaved);
  }, [hasUnsaved, onDirtyChange]);

  // Slice B (undo/redo): surface {canUndo, canRedo} up to the page (drives the ribbon buttons'
  // disabled state) -- the SAME grid->page reactive pattern as onDirtyChange. FLIP-GATED (perf):
  // `history` gets a NEW object on every edit, so an un-gated effect fired a fresh literal each
  // keystroke-commit -> a redundant page render even when canUndo/canRedo were unchanged. We emit
  // ONLY when EITHER boolean actually flips (tracked in a ref, init {false,false} -- matching the
  // page default + the empty-history start, so observable button state is identical).
  useEffect(() => {
    const next = { canUndo: canUndo(history), canRedo: canRedo(history) };
    const prev = prevHistoryFlagsRef.current;
    if (next.canUndo !== prev.canUndo || next.canRedo !== prev.canRedo) {
      prevHistoryFlagsRef.current = next;
      onHistoryChange?.(next);
    }
  }, [history, onHistoryChange]);

  // Phase-2 prefill cleanup: when the refetched data shows a cell is now priced, drop any
  // stale proposal for it (a proposal must never linger on a now-priced cell). Keyed on
  // `rows` (the refetch trigger). Proposals are display-only -- this commits nothing.
  useEffect(() => {
    setProposedRates((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;
      let changed = false;
      const next = { ...prev };
      for (const ck of keys) {
        const sep = ck.indexOf(":");
        const ri = Number(ck.slice(0, sep));
        const col = ck.slice(sep + 1);
        const r = byIdx.get(ri);
        const dd = displayDescriptors.find((x) => x.col === col);
        if (r && dd && isCellPriced(r, dd)) {
          delete next[ck];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // byIdx + displayDescriptors are recomputed each render from rows/columnDescriptors;
    // we intentionally key only on `rows` (the refetch trigger).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Force-save flush (the page's "Save now" calls this via the ref): fire all pending
  // debounced saves now, then retry any remaining draft (e.g. a previously-failed one whose
  // debounce already fired). Reads current state via refs, so the [] deps are correct.
  useImperativeHandle(
    ref,
    () => ({
      flush: () => {
        debouncersRef.current.forEach((deb) => deb.flush());
        Object.keys(draftRatesRef.current).forEach((k) => {
          const sep = k.indexOf(":");
          autoSaveCellRef.current(Number(k.slice(0, sep)), k.slice(sep + 1));
        });
        // BCS-S3a: the cost drafts flush through their OWN debouncers + retry path, so "Save
        // now" (and the carry button's pre-open flush) persists a typed cost too.
        bcsDebouncersRef.current.forEach((deb) => deb.flush());
        Object.keys(draftBcsRatesRef.current).forEach((k) => {
          const sep = k.indexOf(":");
          autoSaveBcsCellRef.current(Number(k.slice(0, sep)), k.slice(sep + 1) as BcsRateField);
        });
      },
      // Slice 4a: the review-list jump. Delegates to the shared jumpToRow (parent click-to-jump
      // uses the same path) -- resolve Excel row -> array index, focus + center the row's col-0
      // cell; onFocus sets activeCell, giving a visible landing. Safe no-op if not rendered.
      scrollToRow: (excelRow) => jumpToRow(excelRow),
      // Slice B (undo/redo): the ribbon buttons call these; they delegate to the LATEST closures
      // via refs (synced each render), so the handle need not rebuild when rows/override change.
      undo: () => undoRef.current(),
      redo: () => redoRef.current(),
      // U1 rate-helper: delegate to the latest applyRate via a ref (like undo/redo) so the handle
      // need not rebuild when rows/descriptors change.
      applyRate: (excelRow, col, value) => applyRateRef.current(excelRow, col, value),
      // BCS-S4: every row's % Margin, taken at the moment it is asked for (BCS-S13: on an explicit
      // filter Apply). Delegates via a ref for the same reason undo/redo/applyRate do.
      computeMargins: (rowsToMeasure) => computeMarginsRef.current(rowsToMeasure),
    }),
    [jumpToRow],
  );

  // Flush-on-unmount: a typed-but-uncommitted value persists on navigate-away (not dropped).
  useEffect(() => {
    const debouncers = debouncersRef.current;
    const bcsDebouncers = bcsDebouncersRef.current; // BCS-S3a: same guarantee for a typed cost
    return () => {
      debouncers.forEach((deb) => deb.flush());
      bcsDebouncers.forEach((deb) => deb.flush());
    };
  }, []);

  // Parent-jump landing flash: clear any pending 3s clear-timer on unmount (a sheet-switch
  // remounts the grid key={sheetName}, so flash state resets for free; this guards a true unmount).
  // Slice A (clipboard): also clear the skip-flash + clipboard-message self-clear timers.
  useEffect(() => () => {
    if (flashTimeoutRef.current !== null) clearTimeout(flashTimeoutRef.current);
    if (skipFlashTimeoutRef.current !== null) clearTimeout(skipFlashTimeoutRef.current);
    if (clipboardMsgTimeoutRef.current !== null) clearTimeout(clipboardMsgTimeoutRef.current);
  }, []);

  // ── Frozen-left Slice 1: measure-at-freeze row heights ("Fork A") ────────────────
  // When freeze turns ON we must capture each row's NATURAL (single-table) height BEFORE the
  // two-pane split is committed, then apply the SAME captured height to the matching row in both
  // panes so they stay aligned by construction. The split is gated on rows.every(measured) (see
  // `split` below), so the render where `frozen` first flips true -- OR where `rows` changed under
  // freeze (collapse/filter/version) -- still paints the SINGLE table; THIS layout-effect then
  // runs post-layout / pre-paint, reads the live <tr> heights via the always-registered col-0
  // cell, and writes them -> the next (synchronous, pre-paint) render commits the split with
  // heights applied, so the user never sees an unmeasured split frame. Unfreeze clears the map
  // (rows return to natural auto-height). The grid remounts on sheet/version switch, so the map
  // resets to {} there for free -- no manual invalidation needed. Slice 2 closed the former
  // column-resize-while-frozen staleness limitation: a column resize / autofit clears the CAPTURED
  // map (endResize / autofitColumn below) so this effect re-reads true natural heights for the
  // non-manual rows -- MANUAL rows (manualRowHeights) are never re-measured here, so a column
  // resize cannot clobber a user's dragged height (Option A).
  useLayoutEffect(() => {
    // V1: the freeze-measure-ALL pass is SKIPPED on the virtualized path -- windowed rows measure on
    // mount via the virtualizer (measureElement). Classic path unchanged. When the toggle flips back
    // to classic (virtualized -> false) this effect re-runs (virtualized in deps) and measures.
    if (virtualized) return;
    if (!frozen) {
      // Unfreeze: clear ONLY the auto-CAPTURED heights; PRESERVE manualRowHeights so a re-freeze
      // keeps the user's dragged rows (Option A). Functional no-op when already empty (no loop).
      setRowHeights((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }
    // Applied height = manual (wins) else captured. Measure only rows that have NEITHER yet -- so a
    // manual row is never re-measured (its dragged height is authoritative) and an already-captured
    // row is left alone. A `rows` change under freeze, OR a column-resize clearing `rowHeights` (the
    // re-measure path), drops an applied height -> `split` goes false -> the single table re-renders
    // at NATURAL height -> this reads the true (re-wrapped) natural height here, flash-free
    // (post-layout / pre-paint, same as the freeze measure).
    if (
      rows.length > 0 &&
      rows.every((r) => (manualRowHeights[r.row_index] ?? rowHeights[r.row_index]) != null)
    )
      return;
    const next: Record<number, number> = { ...rowHeights };
    for (let i = 0; i < rows.length; i++) {
      const ri = rows[i].row_index;
      if (manualRowHeights[ri] != null || rowHeights[ri] != null) continue; // already has an applied height
      const tr = cellRefs.current.get(navKey(i, 0))?.closest("tr");
      if (tr) next[ri] = Math.ceil(tr.getBoundingClientRect().height);
    }
    setRowHeights(next);
  }, [virtualized, frozen, rows, rowHeights, manualRowHeights]);

  // ── Resize: live width derivations (recomputed each render from colWidths) ──
  // MC-5: a fan-out description column (desc:<col>) seeds from descWidthSeeds (first 280,
  // extras 160); a0..a4 / d:<col> / remarks seed from seedForWidthKey. A dragged width wins.
  const widthOf = (key: string): number => colWidths[key] ?? descWidthSeeds[key] ?? seedForWidthKey(key);
  const descWidthKeys = visibleDescriptors.map((d) => columnWidthKey("descriptor", d.col));
  // table-fixed needs an explicit total width (NOT w-full -- w-full would let table-fixed
  // redistribute slack and break the authoritative colgroup widths).
  // BCS-S3a: the cost block's columns are user-resizable like any descriptor (seedForWidthKey's
  // default 112px covers `bcs:*`), so they join the SAME colWidths map -- no second width state.
  const bcsWidthTotal = bcsColKeys.reduce((s, k) => s + widthOf(k), 0);
  const totalWidth =
    anchorWidthKeys.reduce((s, k) => s + widthOf(k), 0) +
    CATEGORY_COL_WIDTH + // CL-2: the read-only Category column (fixed width, no colWidths entry)
    descWidthKeys.reduce((s, k) => s + widthOf(k), 0) +
    bcsWidthTotal +
    widthOf(REMARKS_WIDTH_KEY);
  const tableStyle = { width: `${totalWidth}px` };

  // Frozen-left Slice 1: the split is COMMITTED only when freeze is on AND every current row has a
  // measured height (the measure-at-freeze layout-effect populates rowHeights). Until then -- the
  // render where freeze just turned on, or where `rows` changed under freeze -- we render the
  // SINGLE table so the effect can read true natural heights. splitRef mirrors it for the
  // event-time scroll retarget in focusCell / jumpToRow (they read a ref, not this render var).
  // Frozen-left Slice 2: the APPLIED height for a row = manual (wins) else captured. The split
  // commits only when every row has one; the same value is passed to both panes (-> aligned).
  const appliedRowHeight = (ri: number): number | undefined => manualRowHeights[ri] ?? rowHeights[ri];
  const split = frozen && rows.length > 0 && rows.every((r) => appliedRowHeight(r.row_index) != null);
  // V1: `twoPane` decides two-pane vs single for BOTH modes -- classic gates on `split` (all rows
  // measured), virtualized gates on `frozen` (the measure-all pass is skipped). splitRef mirrors
  // twoPane so focusCell / jumpToRow retarget the correct scroll pane in either mode.
  const twoPane =
    selectRenderPath({ rowCount: rows.length, virtualized, frozen, split }) === "twoPane";
  splitRef.current = twoPane;
  twoPaneRef.current = twoPane;
  // ONE virtualizer = the single row-window authority for BOTH panes (scrolling pane is the scroll
  // authority in two-pane; containerRef in single). estimateSize seeds from the applied (manual /
  // freeze-measured) height when known, else a default; measureElement refines it per mounted row.
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => (twoPaneRef.current ? scrollPaneRef.current : containerRef.current),
    estimateSize: (index) =>
      seedEstimate(appliedRowHeight(rows[index]?.row_index), DEFAULT_ROW_ESTIMATE_PX),
    overscan: ROW_OVERSCAN,
    // V1-FIX (max-of-both-panes): the virtualizer's size for a row = the MAX natural content height
    // across BOTH panes (frozen + scrolling) -- NOT just the measured pane. This is what keeps the
    // tall Description (frozen-left in this layout) from being padded down + truncated. Reads NATURAL
    // content (paneNaturalHeight, immune to the applied padding) so the padded pane never sticks the
    // max. Manual-drag precedence: a manually-sized row uses its explicit height (classic clip path).
    // The `el` passed is the OBSERVED (scrolling / single) pane's <tr>; we look up the frozen twin by
    // data-index. Frozen-only reflows (column resize / data change) are re-measured by the effect below.
    measureElement: (el) => {
      const iStr = (el as HTMLElement).dataset.index;
      if (iStr == null) return DEFAULT_ROW_ESTIMATE_PX;
      const idx = parseInt(iStr, 10);
      const ri = rows[idx]?.row_index;
      if (ri != null && manualRowHeights[ri] != null) return manualRowHeights[ri];
      const sel = `tr[data-index="${idx}"]`;
      const naturals = [
        paneNaturalHeight(frozenPaneRef.current?.querySelector(sel)),
        paneNaturalHeight(scrollPaneRef.current?.querySelector(sel)),
        paneNaturalHeight(containerRef.current?.querySelector(sel)),
      ];
      return maxRowHeight(naturals) || DEFAULT_ROW_ESTIMATE_PX;
    },
  });
  // V2: sync the refs the (earlier-defined) focusCell / jumpToRow read to reach the virtualizer for
  // an off-window nav/jump target. Assigned each render -- the virtualizer instance is stable, so
  // these never destabilize those useCallbacks (which read the refs, not these values).
  virtualizedRef.current = virtualized;
  scrollRowIntoWindowRef.current = (idx) =>
    rowVirtualizer.scrollToIndex(idx, { align: "center" });
  // V2 (overlay close-on-scroll-out): the remark popover lives INSIDE the row, so a scroll-out unmount
  // already tears down its Radix portal (no orphan) -- but the grid-level open-state would otherwise
  // linger and RE-OPEN on scroll-back. Clear it once the open row leaves the mounted window. Keyed on
  // the virtualizer's window range so it re-checks on scroll; a no-op unless a remark is open AND we
  // are virtualized. (The page-owned CategoryVerdictPicker has its own close-on-scroll-out in
  // SheetPricingPage; the reconciliation chooser uses local state and closes on unmount for free.)
  const windowStart = rowVirtualizer.range?.startIndex ?? null;
  const windowEnd = rowVirtualizer.range?.endIndex ?? null;
  useEffect(() => {
    if (!virtualized || openRemarkExcelRow == null) return;
    const mounted = new Set<number>();
    for (const vi of rowVirtualizer.getVirtualItems()) {
      const er = rows[vi.index]?.source_row_number;
      if (er != null) mounted.add(er);
    }
    if (shouldCloseOverlay(openRemarkExcelRow, mounted)) setOpenRemarkExcelRow(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualized, openRemarkExcelRow, windowStart, windowEnd]);
  // V1-FIX-2: frozen-pane (unobserved) reflows are handled WITHOUT a streaming effect --
  //   - scroll-mount + any scrolling-pane reflow: caught by the scrolling <tr>'s measureRef (the ONLY
  //     observed element per index; the frozen twin carries no measureRef, so there is no
  //     last-attached contention). The measureElement it fires reads BOTH panes' <tr> boxes.
  //   - a Description re-wrap from a COLUMN RESIZE (frozen-only, scrolling unchanged): the scrolling
  //     ResizeObserver stays silent, so the drag-end / autofit path calls the two-phase
  //     `remeasureVirtualRowsAfterResize` (below) -- clear sticky sizes, then re-invoke measureElement
  //     on the mounted rows next frame. `measure()` ALONE is NOT enough (it clears but never re-reads
  //     the frozen twin, and a shrunk row's <tr> min-height stays sticky) -- see that helper.
  // (The prior [colWidths, rows] effect re-invoked measureElement on every stream tick -- removed;
  //  its frozen-only-reflow coverage now lives in the drag-END helper, without the per-tick thrash.)
  // V1 flip re-anchor (mid-state toggle, case a): the scroll element is the SAME div across a flip
  // (only the <tbody> content changes), so scrollTop is preserved. When flipping TO virtualized,
  // re-sync the virtualizer to that scrollTop so the window lands at/near the same top visible row
  // (any estimate drift corrects itself as windowed rows measure). No data / draft / lock touch.
  useEffect(() => {
    if (!virtualized) return;
    const el = twoPaneRef.current ? scrollPaneRef.current : containerRef.current;
    if (el) rowVirtualizer.scrollToOffset(el.scrollTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualized]);
  // V1-FIX-2b: the post-commit re-measure for a column-resize / autofit re-wrap (phase 2 of the
  // two-phase in `remeasureVirtualRowsAfterResize`). `resizeSettleTick` bumps at drag-END only; by the
  // time THIS layout-effect runs, the `measure()`-cleared render has COMMITTED, so the DOM shows each
  // pane at its true (re-wrapped) natural height (frozen Description tall, scrolling short/estimate) --
  // a guarantee the prior rAF could NOT make (it fired before the estimate-collapse render committed,
  // so it re-measured stale/unmounted rows and the scrolling pane stuck at the 34px estimate). We now
  // re-invoke measureElement on every MOUNTED row: it reads max(frozen, scrolling) with the settled
  // DOM and writes the shared virtualSize -> the next render pads BOTH panes to it -> aligned. Skips
  // the first mount (tick 0) and the classic path. No `colWidths` dep -> no per-stream-tick thrash.
  useLayoutEffect(() => {
    if (!virtualized || resizeSettleTick === 0) return;
    const sp = scrollPaneRef.current;
    if (!sp) return;
    for (const vi of rowVirtualizer.getVirtualItems()) {
      const el = sp.querySelector(`tr[data-index="${vi.index}"]`);
      if (el) rowVirtualizer.measureElement(el as HTMLElement);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizeSettleTick]);
  // Pane widths from the SAME colWidths map (NO duplicate width state): frozen = the 5 anchors;
  // scrolling = the descriptors + Remarks. Their sum === totalWidth (the single-table width).
  const anchorPaneWidth = anchorWidthKeys.reduce((s, k) => s + widthOf(k), 0);
  const scrollPaneTableWidth =
    CATEGORY_COL_WIDTH + // CL-2: the read-only Category column leads the scrolling pane
    descWidthKeys.reduce((s, k) => s + widthOf(k), 0) +
    bcsWidthTotal + // BCS-S3a: the cost block rides the SCROLLING pane, never the frozen one
    widthOf(REMARKS_WIDTH_KEY);

  // RM-3b/RM-3c item A: the embedded horizontal-scrollbar PROXY is the SINGLE bar (the scroller's own
  // native H-bar is suppressed below -- boq-embed-hidehbar). Full-screen keeps its native bar (the
  // bounded container), so the proxy renders only when NOT expanded.
  const showHScrollProxy = !expanded;
  // RM-3c: LIVE-measured metrics of the ACTIVE X-scroller (single container OR the frozen scrolling
  // pane) via a ResizeObserver -- NOT a one-shot column-width sum. The proxy's visible width is set to
  // the scroller's clientWidth (kills the ~15px end clamp: the vertical-scrollbar width no longer leaks
  // into the proxy's range) and the spacer to the scroller's REAL scrollWidth (kills the frozen
  // short-scroll). Grid-level state -- re-renders only on a genuine size change (guarded no-op), never
  // per keystroke; no per-row prop, comparator + virtualizer math untouched.
  const [hScrollMetrics, setHScrollMetrics] = useState({ clientWidth: 0, scrollWidth: 0 });
  useEffect(() => {
    if (!showHScrollProxy) return;
    const scroller = twoPaneRef.current ? scrollPaneRef.current : containerRef.current;
    if (!scroller) return;
    const measure = () =>
      setHScrollMetrics((m) => {
        const clientWidth = scroller.clientWidth;
        const scrollWidth = scroller.scrollWidth;
        return m.clientWidth === clientWidth && m.scrollWidth === scrollWidth
          ? m
          : { clientWidth, scrollWidth };
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    const table = scroller.querySelector("table");
    if (table) ro.observe(table); // content-width changes (column resize / hide) move scrollWidth
    return () => ro.disconnect();
  }, [showHScrollProxy, twoPane, totalWidth, scrollPaneTableWidth]);
  // Two-way scrollLeft sync between the proxy bar and the REAL X-scroller (LAYOUT ONLY -- no data /
  // prop / virtualizer-math change). A re-entrancy latch stops the mirror from ping-ponging. Re-wired
  // when the mode, the active pane, or the content width changes.
  useEffect(() => {
    if (!showHScrollProxy) return;
    const proxy = hScrollProxyRef.current;
    const scroller = twoPaneRef.current ? scrollPaneRef.current : containerRef.current;
    if (!proxy || !scroller) return;
    let syncing = false;
    const fromProxy = () => {
      if (syncing) return;
      syncing = true;
      scroller.scrollLeft = proxy.scrollLeft;
      syncing = false;
    };
    const fromScroller = () => {
      if (syncing) return;
      syncing = true;
      proxy.scrollLeft = scroller.scrollLeft;
      syncing = false;
    };
    proxy.addEventListener("scroll", fromProxy, { passive: true });
    scroller.addEventListener("scroll", fromScroller, { passive: true });
    fromScroller(); // seed the proxy thumb to the current scroll position
    return () => {
      proxy.removeEventListener("scroll", fromProxy);
      scroller.removeEventListener("scroll", fromScroller);
    };
  }, [showHScrollProxy, twoPane, hScrollMetrics.scrollWidth]);

  // V1-FIX-2b: after a column resize / autofit re-wraps the FROZEN Description, the scrolling pane's
  // <tr> is UNCHANGED, so its ResizeObserver stays silent and the shared measureElement never
  // re-fires -> the virtualizer keeps stale sizes and the two panes drift (measured live: ~300px on
  // a 520->370 narrow, non-self-healing until a scroll forced a fresh window). `measure()` ALONE is
  // insufficient: it clears the cache but nothing re-reads the frozen twin's new height. Mirror
  // classic's two-phase reset instead -- (1) HERE: clear the sticky measured sizes so a SHRUNK row's
  // <tr> min-height releases and its box collapses to true (re-wrapped) content, then bump
  // `resizeSettleTick`; (2) the tick's post-commit `useLayoutEffect` (above) re-invokes measureElement
  // on every MOUNTED row once the cleared render has committed, reads max(frozen, scrolling) with the
  // settled DOM, and re-aligns both panes. Fired ONLY at drag-END / autofit (never streaming
  // moveResize) -> no thrash; the exact spot + timing classic clears its captured heights. This is the
  // last-attached-element (frozen-only-reflow) coverage the FIX-1 [colWidths, rows] effect provided,
  // restored WITHOUT the per-stream-tick thrash that got it removed.
  const remeasureVirtualRowsAfterResize = () => {
    if (!virtualized) return;
    rowVirtualizer.measure(); // drop sticky measured sizes -> shrunk rows collapse to true content
    setResizeSettleTick((t) => t + 1); // -> the post-commit layout-effect re-measures the mounted rows
  };
  // Resize: pointer-capture drag on a column's right-edge handle. Updates only colWidths (grid
  // state) -> the colgroup + the frozen-offset vars recompute; the memoized rows are skipped.
  const startResize = (key: string, isRate: boolean) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = { key, startX: e.clientX, startWidth: widthOf(key), isRate };
  };
  const moveResize = (e: ReactPointerEvent) => {
    const st = resizeRef.current;
    if (!st) return;
    const next = clampColumnWidth(st.startWidth + (e.clientX - st.startX), st.isRate);
    setColWidths((prev) => (prev[st.key] === next ? prev : { ...prev, [st.key]: next }));
  };
  const endResize = (e: ReactPointerEvent) => {
    if (!resizeRef.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    resizeRef.current = null;
    // Frozen-left Slice 2 -- column-resize re-measure: a column drag may have re-wrapped the
    // Description, so the CAPTURED heights are now stale. Clearing them (manual heights live in a
    // separate map, untouched) drops `split` to false for one render -> the single table re-renders
    // at natural height with the NEW column widths -> the measure layout-effect re-reads the true
    // natural heights -> split re-commits. All within a layout-effect cycle (pre-paint) -> no flash.
    // V1-FIX-2: virtualized mode has no captured rowHeights; instead clear the virtualizer's sticky
    // measured sizes so re-wrapped rows re-measure their NEW natural <tr> box (matches classic's reset
    // here). On drag-END (not streaming moveResize) -> no thrash.
    if (splitRef.current) {
      setRowHeights({});
      remeasureVirtualRowsAfterResize();
    }
  };
  // Double-click autofit (D6): measure the column's natural content width. Under table-fixed the
  // colgroup clamps a cell's CLIENT width, but scrollWidth still reports the full content extent
  // once we force single-line; we set whiteSpace:nowrap, read scrollWidth, and restore -- all
  // synchronously (no paint between), so there is no visible flash. data-colkey tags the cells.
  const autofitColumn = (key: string, isRate: boolean) => {
    const container = containerRef.current;
    if (!container) return;
    const cells = container.querySelectorAll<HTMLElement>(`[data-colkey="${CSS.escape(key)}"]`);
    let max = 0;
    cells.forEach((el) => {
      const prevWS = el.style.whiteSpace;
      el.style.whiteSpace = "nowrap";
      if (el.scrollWidth > max) max = el.scrollWidth;
      el.style.whiteSpace = prevWS;
    });
    if (max > 0) {
      setColWidths((prev) => ({ ...prev, [key]: clampColumnWidth(max + 24, isRate) }));
      // Slice 2: autofit can re-wrap the Description -> re-measure captured rows (see endResize).
      // V1-FIX-2: same virtualized reset as endResize.
      if (splitRef.current) {
        setRowHeights({});
        remeasureVirtualRowsAfterResize();
      }
    }
  };
  // The right-edge drag affordance rendered inside each header <th> (headers carry no other
  // handlers today). Edge-only (w-1.5, right-0) so on an amount <th> it never overlaps / steals
  // the ƒ formula-badge popover trigger's click (C4). stopPropagation keeps it off cell focus.
  const resizeHandle = (key: string, isRate: boolean) => (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize; double-click to autofit"
      onPointerDown={startResize(key, isRate)}
      onPointerMove={moveResize}
      onPointerUp={endResize}
      onDoubleClick={() => autofitColumn(key, isRate)}
      className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-blue-400/50"
    />
  );

  // Frozen-left Slice 2 -- manual row-resize handlers. STABLE (useCallback []) so the memoized row
  // holds (they only read refs / setters). Mirror the column-resize pointer-capture pattern but on
  // the Y axis, writing the dragged height into manualRowHeights (the Option-A source of truth that
  // survives unfreeze). The drag start height is the row's CURRENT applied height (passed in).
  const onRowResizePointerDown = useCallback(
    (rowIndexData: number, startHeight: number, e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      rowResizeRef.current = { rowIndex: rowIndexData, startY: e.clientY, startHeight };
    },
    [],
  );
  const onRowResizePointerMove = useCallback((e: ReactPointerEvent) => {
    const st = rowResizeRef.current;
    if (!st) return;
    const next = clampRowHeight(st.startHeight + (e.clientY - st.startY));
    setManualRowHeights((prev) => (prev[st.rowIndex] === next ? prev : { ...prev, [st.rowIndex]: next }));
  }, []);
  const onRowResizePointerUp = useCallback((e: ReactPointerEvent) => {
    if (!rowResizeRef.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    rowResizeRef.current = null;
  }, []);

  /**
   * ⚠️ THIS EARLY RETURN IS A TRAP DOOR, AND IT SHUT ON THE % MARGIN CONTROLS (owner report
   * 2026-08-07). It fires on the DISPLAYED rows, so any filter matching nothing lands here -- and
   * it returns BEFORE the header, which is where BCS-S13/S14 put the funnel and the sort arrow.
   * A range that matched no rows therefore removed the only control that could clear it: the grid
   * emptied, the header vanished, and the filter could not be reached again without switching
   * sheets. The other view filters escaped this because their toggles live in the toolbar, which
   * keeps rendering.
   *
   * Two things were wrong and both are fixed here:
   *   1. THE MESSAGE WAS FALSE. "This committed sheet has no rows to price" is a statement about
   *      the SHEET; the sheet was fine, the filter was hiding it. Reading it, the honest
   *      conclusion is that the data is missing -- the one thing that had not happened.
   *   2. THERE WAS NO WAY OUT. An empty result must carry its own undo.
   *
   * ⚠️ IT MUST STAY AN EARLY RETURN INSIDE THIS COMPONENT -- never lifted into the page as a
   * "render the panel instead of the grid" branch. That would UNMOUNT PricingGrid, and the
   * unsaved rate/cost drafts live in its state: type a cost, have the filter stop matching that
   * row, lose the keystrokes. Returning early keeps the component mounted and the drafts intact.
   */
  if (rows.length === 0) {
    // The two states are resolved ONCE, into plain data, rather than re-asking `viewFiltersActive`
    // at each of the four places it decides something. A per-branch ternary chain reads as four
    // independent choices that merely happen to agree; this reads as what it is -- one question,
    // asked once, with one answer.
    // ⚠️ NAME THE % MARGIN RANGE WHEN ONE IS SET, BUT DO NOT BLAME IT. Someone who filtered to
    // 10-25% and got nothing needs to see the range they are actually filtering by -- the funnel
    // that holds it is gone with the header, so the numbers exist nowhere else on screen.
    //
    // What this must NOT say is "nothing has a % Margin between 10% and 25%". Filters compose:
    // rows in that band may well exist and be hidden by Show-unpriced instead, and a confident
    // claim about the DATA that is really a claim about ONE OF SEVERAL filters is the exact class
    // of wrong this screen is careful about. It states what is applied, and lets the reader draw
    // the conclusion.
    //
    // An earlier cut appended "Rows with no % Margin yet are never included." -- dropped (owner
    // 2026-08-07). The rule is still stated where it is actually needed: in the filter dialog,
    // next to the boxes being filled in, BEFORE the range is applied. Repeating it here made the
    // one screen with nothing on it the wordiest, and taught the rule too late to act on.
    const rangePhrase = describeMarginRange(marginFrom, marginTo);
    const empty = viewFiltersActive
      ? {
          Icon: Filter,
          title: "No rows match your filters",
          body: rangePhrase
            ? `% Margin is filtered ${rangePhrase}.`
            : "Every row on this sheet is hidden. Clear the filters to bring it back.",
        }
      : {
          Icon: Inbox,
          title: "No rows to price",
          body: "This committed sheet has no priceable rows.",
        };
    return (
      // `role="status"` because this replaces the grid in response to an action the user just
      // took, and a screen-reader user gets no other signal that the rows went away.
      <div role="status" className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <empty.Icon className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{empty.title}</p>
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-muted-foreground">
            {empty.body}
          </p>
        </div>
        {viewFiltersActive && onClearViewFilters && (
          <Button size="sm" variant="outline" onClick={onClearViewFilters}>
            Clear filters
          </Button>
        )}
      </div>
    );
  }

  // ── Frozen-left Slice 1: shared colgroup / header fragments + the row factory. Rendered into
  //    ONE table when unfrozen, or split across the two panes when frozen -- the SAME <col>/<th>
  //    from the SAME colWidths map (never duplicated) and the SAME PricingGridRow props. ──
  const anchorCols = anchorWidthKeys.map((k) => (
    <col key={k} style={{ width: `${widthOf(k)}px` }} />
  ));
  const descriptorCols = visibleDescriptors.map((d) => (
    <col key={d.col} style={{ width: `${widthOf(columnWidthKey("descriptor", d.col))}px` }} />
  ));
  const remarksCol = <col style={{ width: `${widthOf(REMARKS_WIDTH_KEY)}px` }} />;
  // BCS-S3a: the cost block's <col>s -- between descriptorCols and remarksCol, in the SCROLLING
  // pane colgroup (never the frozen/anchor one). Empty array when there is no block.
  const bcsCols = bcsColKeys.map((k) => (
    <col key={k} style={{ width: `${widthOf(k)}px` }} />
  ));
  // CL-2: the read-only Category <col> -- leads the scrolling pane (before descriptorCols). Fixed
  // width; never in the frozen/anchor colgroup.
  const categoryCol = <col style={{ width: `${CATEGORY_COL_WIDTH}px` }} />;

  // Anchor headers: vertical sticky (top-0, z-20). Width comes from the colgroup; the label
  // truncates single-line (D4) with a title tooltip; the right-edge handle drag-resizes (D1).
  const anchorHeaderCells = (
    <>
      <th
        data-colkey="a0"
        title="Excel Row"
        className="px-2 py-2 text-left font-medium text-muted-foreground border-r border-border sticky top-0 z-20 bg-muted"
      >
        {/* SELROW filter: a dedicated TOGGLE, not a GridColumnFilter -- that component is built
            around distinct-VALUE lists and a thousand row numbers would be a useless list (see
            passesTickedFilter). Rendered only when the tick column itself is live.
            ⚠️ The h-4 + leading-none sizing is LOAD-BEARING, not styling: in FROZEN mode this
            header lives in the frozen table while Category lives in the scrolling one, and an
            affordance that changes this cell's height offsets the two panes against each other.
            It must stay height-neutral in BOTH states (on and off). */}
        <div className="flex items-center gap-1">
          <span className="block truncate">Excel Row</span>
          {onToggleTicked && (
            <button
              type="button"
              onClick={onToggleTicked}
              disabled={selectedRows.size === 0}
              aria-pressed={showOnlyTicked}
              title={
                selectedRows.size === 0
                  ? "Tick some rows first, then filter to just those"
                  : showOnlyTicked
                    ? "Showing only ticked rows -- click to show all rows"
                    : "Show only the ticked rows"
              }
              className={cn(
                "inline-flex h-4 shrink-0 items-center justify-center rounded leading-none",
                "disabled:cursor-default disabled:opacity-30",
                showOnlyTicked ? "text-primary" : "text-muted-foreground/70 hover:text-foreground",
              )}
            >
              <ListChecks className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {resizeHandle("a0", false)}
      </th>
      <th
        data-colkey="a1"
        title="Sl.No"
        className="px-2 py-2 text-left font-medium text-muted-foreground border-r border-border sticky top-0 z-20 bg-muted"
      >
        <span className="block truncate">{slNoLetter ? `Sl.No (${slNoLetter})` : "Sl.No"}</span>
        {resizeHandle("a1", false)}
      </th>
      <th
        data-colkey="a2"
        title="Parent"
        className="px-2 py-2 text-left font-medium text-muted-foreground border-r border-border sticky top-0 z-20 bg-muted"
      >
        <span className="block truncate">Parent</span>
        {resizeHandle("a2", false)}
      </th>
      <th
        data-colkey="a3"
        title={ROW_TYPE_LABEL}
        className="px-2 py-2 text-left font-medium text-muted-foreground border-r border-border sticky top-0 z-20 bg-muted"
      >
        {/* U3: the LABEL is "Row Type"; `data-colkey="a3"` is a stable selector used by the resize
            machinery and is deliberately NOT renamed. U1: the funnel filters this column. */}
        <div className="flex items-center gap-1">
          <span className="block truncate">{ROW_TYPE_LABEL}</span>
          <GridColumnFilter
            label={ROW_TYPE_LABEL}
            options={rowTypeFilterOptions}
            selected={rowTypeFilter}
            onChange={onRowTypeFilterChange ?? (() => {})}
          />
        </div>
        {resizeHandle("a3", false)}
      </th>
      {/* MC-5: Description header fan-out -- one <th> per mapped description column (fan-out),
          else the single legacy anchor (byte-identical). headerText = `Label (Col)` or the bare
          letter when no real label was captured; keys/resize by desc:<col> letter. */}
      {fanOut
        ? descriptionColumns.map((c) => (
            <th
              key={c.col}
              data-colkey={descriptionWidthKey(c.col)}
              title={c.headerText}
              className="px-2 py-2 text-left font-medium text-muted-foreground border-r border-border sticky top-0 z-20 bg-muted"
            >
              <span className="block truncate">{c.headerText}</span>
              {resizeHandle(descriptionWidthKey(c.col), false)}
            </th>
          ))
        : (
          <th
            data-colkey="a4"
            title="Description"
            className="px-2 py-2 text-left font-medium text-muted-foreground border-r border-border sticky top-0 z-20 bg-muted"
          >
            <span className="block truncate">
              {descriptionLetter ? `Description (${descriptionLetter})` : "Description"}
            </span>
            {resizeHandle("a4", false)}
          </th>
        )}
    </>
  );

  const descriptorHeaderCells = visibleDescriptors.map((d) => {
    const label = columnChipLabel(d);
    const isAmount = isAmountDescriptor(d);
    // PENDING TINT: a subtle amber wash on an amount column with NO covering formula so a wide
    // sheet is scannable; a covered amount column + every non-amount column keep bg-muted. The
    // coverage check is the SAME override>wildcard pickFormula the gate + badge use (inline here,
    // NOT priceability.isAmountColumnCovered -- importing priceability would reverse the one-way
    // dependency into a cycle). Amber tokens mirror the gate banner.
    const amountPending =
      isAmount &&
      !pickFormula(
        { value_field: d.value_field, value_key: d.value_key, rate_subkey: d.rate_subkey },
        columnFormulas,
      )?.formula;
    return (
      <th
        key={d.col}
        data-colkey={columnWidthKey("descriptor", d.col)}
        title={label}
        className={cn(
          "px-2 py-2 text-right font-medium text-muted-foreground border-l border-border sticky top-0 z-20 align-top",
          amountPending ? "bg-amber-50 dark:bg-amber-950/40" : "bg-muted",
        )}
      >
        {/* min-w-0 lets the label truncate (D4); the ƒ badge stays shrink-0 so the resize handle
            never overlaps / steals its popover-trigger click (C4). */}
        <span className="flex min-w-0 items-center justify-end gap-1">
          {/* Formula Builder: the LEADING amber/green ƒ status badge that IS the click-to-edit
              trigger, on AMOUNT columns only. Read-only (static glyph) when onSaveFormula is
              withheld (locked). The amount-cell VALUE render is UNCHANGED (F4 owns the swap). */}
          {isAmount && (
            <AmountFormulaBuilder
              target={d}
              columnLabel={label}
              descriptors={columnDescriptors}
              columnFormulas={columnFormulas}
              onSave={onSaveFormula}
            />
          )}
          <span className="truncate">{label}</span>
        </span>
        {resizeHandle(columnWidthKey("descriptor", d.col), isRateDescriptor(d))}
      </th>
    );
  });

  // CL-2: the read-only Category header -- leads the scrolling pane (before descriptorHeaderCells).
  // No resize handle (fixed-width column). data-colkey mirrors the body cell's "category" key.
  const categoryHeaderCell = (
    <th
      data-colkey="category"
      title="Category"
      className="px-2 py-2 text-left font-medium text-muted-foreground border-l border-border sticky top-0 z-20 bg-muted"
    >
      {/* U1: the funnel lists DISPLAY LABELS (matching what the cell renders via labelFor) but the
          selection it emits is a set of category IDS -- see GridColumnFilter's label/id note. */}
      <div className="flex items-center gap-1">
        <span className="block truncate">Category</span>
        <GridColumnFilter
          label="Category"
          options={categoryFilterOptions}
          selected={categoryFilter}
          onChange={onCategoryFilterChange ?? (() => {})}
        />
      </div>
    </th>
  );

  // BCS-S3a: the cost block's headers -- one per live box, then the computed tail.
  //
  // ⚠️ WHAT THE SKY TINT MARKS, CORRECTED AT BCS-S2e. It said the tint made "the INTERNAL cost
  // columns visually distinct from the client-facing ones beside them: this is what we pay, not
  // what we charge". That was true when S3a wrote it and the whole block was internal. BCS-S3b
  // then added Tendered Total Amount and % Margin -- both CLIENT-FACING, both sky-tinted -- so
  // the tint no longer separates what we pay from what we charge, and reading it as though it
  // still did would put the Tendered column on the wrong side of the very distinction the
  // sentence names.
  //
  // WHAT IT ACTUALLY MARKS NOW: the BCS BLOCK -- one contiguous, screen-only section that is
  // NOT part of the sheet's own columns and never reaches the client-facing export
  // (`bcs.py` property 3). That is still worth a tint, and it is the boundary a reader needs;
  // the internal-vs-client distinction lives in the per-column `title` text instead, which is
  // where it can be stated per column rather than per block.
  // BCS-S9: the builder's operand chips for THIS sheet -- its live cost boxes, then the
  // confirmed quantity. Derived from `bcsKinds`, so the palette can never offer a cost box the
  // sheet does not have (the same narrowing `bcsLiveRateKinds` enforces for the input boxes).
  // BCS-S11: the numerator's palette -- BCS Total (the default) plus the sheet's live cost
  // boxes, so the cost side can be re-pointed without touching the ratio.
  // BCS-S12: the sheet's REAL quantity columns, named like the amount ones (letter + role).
  // Before S12 this was a single abstract "Total Quantity" chip resolving through the BCS
  // dialog's Quantity confirmation; with that picker gone the formula names the column itself.
  const qtyOperandPalette = columnDescriptors
    .filter((d) => d.value_field === "qty_total" || d.value_field === "qty_by_area")
    .map((d) => ({
      ref: {
        value_field: d.value_field,
        value_key: d.value_key,
        rate_subkey: d.rate_subkey,
      } as AmountFormulaRef,
      label: columnChipLabel(d),
      group: "Quantity columns on this sheet",
    }));

  const marginCostPalette = [
    ...marginCostOperandRefs(bcsKinds)
      .filter((ref) => ref.value_field !== BCS_QTY_OPERAND_FIELD)
      .map((ref) => ({
        ref,
        label: marginCostOperandLabel(ref.value_field),
        // No column letter: these are screen-only figures with no Excel column, and that
        // absence is meaningful rather than missing information.
        group: "BCS columns (internal cost)",
      })),
    ...qtyOperandPalette,
    ...LEGACY_QTY_LABEL_ENTRY,
  ];

  // BCS-S10: the denominator's palette -- the sheet's own AMOUNT columns, and nothing from BCS
  // (cost inside the margin's denominator would be silently wrong, and the server refuses it).
  const boqOperandPalette = columnDescriptors
    .filter((d) => isAmountDescriptor(d))
    .map((d) => ({
      ref: {
        value_field: d.value_field,
        value_key: d.value_key,
        rate_subkey: d.rate_subkey,
      } as AmountFormulaRef,
      // The SHARED naming (boqTypes.columnChipLabel) -- the letter is on the chip on purpose,
      // and the header cell above renders through the same call, so the two can never disagree.
      label: columnChipLabel(d),
      group: "Amount columns on this sheet",
    }));

  const bcsOperandPalette = [
    ...bcsOperandRefs(bcsKinds)
      .filter((ref) => ref.value_field !== BCS_QTY_OPERAND_FIELD)
      .map((ref) => ({
        ref,
        label: bcsOperandLabel(ref.value_field),
        group: "BCS columns (internal cost)",
      })),
    ...qtyOperandPalette,
    ...LEGACY_QTY_LABEL_ENTRY,
  ];

  const bcsHeaderCells = bcsKinds.length > 0 && (
    <>
      {bcsKinds.map((kind) => (
        <th
          key={kind}
          data-colkey={bcsWidthKey(kind)}
          title={`${BCS_RATE_LABEL[kind]} — what this row costs us (internal)`}
          className="px-2 py-2 text-right font-medium text-sky-800 dark:text-sky-200 border-l border-border sticky top-0 z-20 align-top bg-sky-50 dark:bg-sky-950/40"
        >
          <span className="block truncate">{BCS_RATE_LABEL[kind]}</span>
          {resizeHandle(bcsWidthKey(kind), true)}
        </th>
      ))}
      {/* BCS-S7 (owner ruling 2026-08-03): "BCS Total Amount", not the bare "Total Amount" this
          shipped as. The prefix is the same one the two cost boxes now carry, and it is what
          stops this column reading as a total of the SHEET when it is a total of the COST. It
          also brings the grid into line with SummaryPanel, which has said "BCS Total Amount"
          since BCS-S5 -- those two headers disagreed until now, and the summary's own comment
          claimed they matched. */}
      <th
        data-colkey={BCS_TOTAL_COL_KEY}
        title="BCS Total Amount — the cost of this row (computed, never stored)"
        className="px-2 py-2 text-right font-medium text-sky-800 dark:text-sky-200 border-l border-border sticky top-0 z-20 align-top bg-sky-50 dark:bg-sky-950/40"
      >
        {/* BCS-S9: the same green f badge an amount column carries, so the rule that computes
            this column is visible from the header and editable per sheet. The palette is
            EXPLICIT (BCS operands are not sheet columns) and the builder opens seeded with the
            built-in rule, so "no stored formula" never reads as "no rule". */}
        <span className="flex min-w-0 items-center justify-end gap-1">
          {bcsKinds.length > 0 && (
            <AmountFormulaBuilder
              target={BCS_TOTAL_TARGET_DESCRIPTOR}
              columnLabel="BCS Total Amount"
              descriptors={columnDescriptors}
              columnFormulas={columnFormulas}
              onSave={onSaveFormula}
              operands={bcsOperandPalette}
              seedTokensFrom={defaultBcsTotalFormula(bcsKinds, columnDescriptors)}
            />
          )}
          <span className="truncate">BCS Total Amount</span>
        </span>
        {resizeHandle(BCS_TOTAL_COL_KEY, false)}
      </th>
      {/* BCS-S3b shipped a client-facing PAIR here -- Tendered Total Amount, then % Margin --
          described as "ALWAYS SHOWN (owner ruling)". BCS-S8 (owner ruling 2026-08-07) REVERSES
          the Tendered half of that: the block is now the cost boxes, BCS Total Amount and
          % Margin. The amount charged is still computed for every row (it is the margin's
          divisor); it simply no longer has a column of its own. */}
      {/* BCS-S13: this header carries TWO controls, and they are different kinds of thing --
          the ƒ badge configures how % Margin is COMPUTED (a stored, per-sheet formula everyone
          sees), the funnel filters which rows are SHOWN (a per-session view state only this
          reader has). They share a header because they are about the same number; they must
          never share an icon or a colour, or a filter would read as a saved setting.

          BCS-S4 put a SORT control here too, but as the header TEXT ITSELF, for the margin VIEW
          it belonged to. That view is gone (owner ruling 2026-08-07); the sort came back at
          BCS-S14 as an ARROW BESIDE the label rather than the label, so the column still reads
          as a column and the three controls line up as three controls. */}
      <th
        data-colkey={BCS_MARGIN_COL_KEY}
        data-has-formula-badge="1"
        title="% Margin — (amount charged − cost) / amount charged (computed, never stored)"
        // BCS-S14: announce the order to a screen reader. Absent (not "none") when unsorted, so
        // the column is not announced as sortable-but-unsorted while the sheet is in its own
        // document order -- which is a structure, not an unsorted state.
        aria-sort={
          marginSortDir === "asc" ? "ascending" : marginSortDir === "desc" ? "descending" : undefined
        }
        className="px-2 py-2 text-right font-medium text-sky-800 dark:text-sky-200 border-l border-border sticky top-0 z-20 align-top bg-sky-50 dark:bg-sky-950/40"
      >
        {/* BCS-S10: the f badge edits the DENOMINATOR ("BOQ Total"), never the margin's shape.
            `(1 - cost/amount) x 100` stays in bcsMarginPercent so its three guards -- zero
            denominator, non-finite, and above all NEGATIVE denominator (which would render a
            loss as a positive margin) -- cannot be written around. */}
        <span className="flex min-w-0 items-center justify-end gap-1">
          {bcsKinds.length > 0 && (
            /* ONE dialog, TWO slots. They are not two formulas -- they are the two halves of
               one ratio, and BCS-S11's first cut (a badge per half) made the rule itself
               invisible: you could edit a denominator without seeing what it was the
               denominator OF. The `(1 - c/a) x 100` wrapper is rendered but not editable; it
               needs numeric literals, which this builder structurally cannot express, and it
               carries the sign guard. */
            <MarginFormulaBuilder
              onSave={onSaveFormula}
              cost={{
                targetValueField: MARGIN_COST_TARGET,
                label: "Cost",
                operands: marginCostPalette,
                seed: defaultMarginCostFormula(),
                stored: pickMarginCostFormula(columnFormulas),
              }}
              amount={{
                targetValueField: BOQ_TOTAL_TARGET,
                label: "Amount (BOQ Total)",
                operands: boqOperandPalette,
                seed: defaultBoqTotalFormula(bcsAmountSource, columnDescriptors),
                stored: pickBoqTotalFormula(columnFormulas),
              }}
            />
          )}
          {/* ⭐ ORDER IS THE OWNER'S (2026-08-07): [ƒ]  % Margin  [arrow] [funnel].
              The ƒ leads because it configures what the number IS -- a stored, per-sheet formula
              everyone sees. The label then reads as the column's name rather than as a control.
              The two VIEW controls (mine only, this session only) group together after it, so a
              reader can tell at a glance which side of the header changes the data and which
              side changes only what they are looking at.

              The arrow sits BEFORE the funnel: it is the lighter action of the two (one click,
              instantly reversible, hides nothing), while the funnel opens a dialog and can empty
              the grid. Cheapest-first also puts the arrow nearer the label it orders. */}
          <span className="truncate">% Margin</span>
          {/* BCS-S14: the sort arrow. Gated on its callback alone, for the same reason as the
              funnel -- ordering is not a write, so a locked sheet still sorts. */}
          {onCycleMarginSort && (
            <button
              type="button"
              onClick={onCycleMarginSort}
              className={cn(
                "shrink-0 rounded border px-1 py-0.5 leading-none",
                marginSortDir
                  ? "border-sky-500 bg-sky-600 text-white dark:border-sky-400 dark:bg-sky-500"
                  : "border-sky-300 bg-white/70 text-sky-700 hover:bg-white dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-200",
              )}
              aria-label={
                marginSortDir === "asc"
                  ? "Sorted by % Margin, lowest first. Click for highest first."
                  : marginSortDir === "desc"
                    ? "Sorted by % Margin, highest first. Click to return to sheet order."
                    : "Sort by % Margin"
              }
              title={
                marginSortDir === "asc"
                  ? "Lowest % Margin first. Click for highest first. (Rows with no % Margin stay at the end either way.)"
                  : marginSortDir === "desc"
                    ? "Highest % Margin first. Click to return to the sheet's own order."
                    : "Sort by % Margin — lowest first, then highest, then back to sheet order."
              }
            >
              {/* THREE GLYPHS FOR THREE STATES. `ArrowUpDown` (the neutral both-ways arrow) is
                  what an UNSORTED sortable column looks like everywhere; the two directional
                  arrows carry the narrow-to-wide shape so the direction is readable without
                  reference to a legend. */}
              {marginSortDir === "asc" ? (
                <ArrowUpNarrowWide className="h-3 w-3" />
              ) : marginSortDir === "desc" ? (
                <ArrowDownWideNarrow className="h-3 w-3" />
              ) : (
                <ArrowUpDown className="h-3 w-3" />
              )}
            </button>
          )}
          {/* BCS-S13: the range filter. Gated on `onApplyMarginRange` ALONE -- never on the
              lock, never on `onSaveFormula` (see the prop's docblock: filtering is not a write,
              so the read-only rule does not reach it). */}
          {onApplyMarginRange && (
            <MarginRangeFilter
              from={marginFrom}
              to={marginTo}
              matchedCount={marginRangeCount}
              onApply={onApplyMarginRange}
            />
          )}
        </span>
        {resizeHandle(BCS_MARGIN_COL_KEY, false)}
      </th>
    </>
  );

  // Slice 4a: trailing Remarks column (per-row; click/Enter-to-open editor). NOT a descriptor;
  // Slice 4a.2 made it the matrix's last navigable column.
  const remarksHeaderCell = (
    <th
      data-colkey="remarks"
      title="Remarks"
      className="px-2 py-2 text-left font-medium text-muted-foreground border-l border-border sticky top-0 z-20 bg-muted"
    >
      <span className="block truncate">Remarks</span>
      {resizeHandle("remarks", false)}
    </th>
  );

  // Editor perf fix (item 1): the factory resolves ONLY the row's cheap, reference-stable inputs
  // and hands them to the memoized PricingGridRow; the heavy per-cell work lives inside the row
  // and is SKIPPED by React.memo for every unchanged row. `pane` selects which cells the row
  // emits (undefined = all; "frozen" = anchors; "scrolling" = descriptors + Remarks); `rowHeight`
  // is the captured scalar applied in both panes when split (undefined otherwise).
  // Slice A (clipboard): the live selection RECTANGLE = (anchor, focus=activeCell). Only when it
  // spans MORE than a single cell (a collapsed 1x1 selection just shows the focus ring, no extra
  // wash). Derived once per render; each row gets only its own memo-safe column span (two scalars).
  const selRect: SelRect | null =
    selectionAnchor &&
    activeCell &&
    (selectionAnchor.rowIndex !== activeCell.rowIndex ||
      selectionAnchor.colIndex !== activeCell.colIndex)
      ? selectionRect(selectionAnchor, activeCell)
      : null;
  // BCS-S3a: THIS row's Total Quantity, resolved from the CONFIRMED columns. Done here (once per
  // RENDERED row -- ~40 under virtualization) so the memoized row receives a plain number|null
  // scalar and never the qty source itself. `bcsRowQuantity` sums the stored entries whatever
  // the mode; the entry and a ColumnDescriptor are the same six fields, which is exactly what
  // resolveDescriptorValue walks.
  //
  // ⚠️ THE `as ColumnDescriptor` CAST WAS REMOVED AT BCS-S3a-fix and must not come back. The two
  // types ARE structurally identical today, so this compiles without it -- which means the cast
  // bought nothing and cost the only warning we would ever get. Let `ColumnDescriptor` gain a
  // seventh required field and the cast would silently hand `resolveDescriptorValue` an entry
  // missing it; without the cast that is a compile error, which is the whole point. Same defect
  // class as the draft key space this slice fixed: two shapes pinned separately, never jointly.
  const bcsQtyFor = (row: PricedRow): number | null =>
    bcsKinds.length === 0
      ? null
      // `columnDescriptors` is the S12b fallback: with no stored confirmation the sheet's OWN
      // quantity column is used. Without it every post-S12 sheet resolved quantity to null and
      // rendered a blank BCS Total. See bcsQuantityColumns.
      : bcsRowQuantity(bcsQtySource, (e) => resolveDescriptorValue(row, e), columnDescriptors);

  // ── BCS-S4: every row's % Margin, for the BCS-S13 range filter ────────────────
  // Every given row's % Margin RIGHT NOW, through the SAME `computeBcsRowCells` the cost cells
  // render from -- so the filter and the column can never disagree about a row's margin.
  //
  // It reads the drafts through their REFS, so a cost or rate typed a second ago and not yet saved
  // is in the reading. `lookupOperandValue` and `bcsDraftsForRow` both key on the FULL
  // `${row_index}:...` form, which is why the whole draft maps can be passed where the row render
  // passes one row's slice -- the slices exist for the memo, not for the lookup.
  //
  // ⚠️ IT TAKES THE ROWS. `rows` here is the DISPLAYED set -- already filtered and collapsed -- and
  // a range decided over that would narrow itself every time it was re-applied. The page passes
  // the whole sheet.
  //
  // ⚠️ THIS RUNS O(rows x amount columns) AND IS THEREFORE CALLED ON AN EXPLICIT FILTER APPLY AND
  // NOWHERE ELSE. Never from a render, an effect or a keystroke -- both for the cost and because
  // rows leaving the grid under a focused cell slides a different row beneath the cursor
  // (`activeCell` is array-index addressed).
  computeMarginsRef.current = (rowsToMeasure: PricedRow[]) => {
    const out = new Map<number, number | null>();
    if (bcsKinds.length === 0) return out; // no cost block on this sheet -> no margins at all
    for (const r of rowsToMeasure) {
      const { marginCell } = computeBcsRowCells({
        row: r,
        bcsRow: bcsRatesByExcelRow.get(r.source_row_number),
        rowBcsDrafts: draftBcsRatesRef.current,
        bcsKinds,
        bcsQty: bcsQtyFor(r),
        bcsAmountSource,
        columnDescriptors,
        columnFormulas,
        rowDraftRates: draftRatesRef.current,
        reconChoiceMap,
      });
      out.set(r.row_index, marginCell.kind === "value" ? marginCell.value : null);
    }
    return out;
  };

  const renderRow = (
    row: PricedRow,
    rowIdx: number,
    pane?: "frozen" | "scrolling",
    virtualSize?: number,
  ) => {
    const selRange = rowSelectionRange(selRect, rowIdx);
    // V1-FIX (max-of-both-panes): in virtualized mode BOTH panes render at the SAME size = the
    // virtualizer's per-row `virtualSize` (= max natural content across both panes). Since a <tr>
    // `height` is a table MINIMUM, the taller pane (Description, frozen-left here) reaches its
    // content exactly and the shorter pane pads to it -> aligned, no truncation, symmetric box model
    // (fixes the 1px drift). The Description clip is OFF for AUTO rows (so it renders natural and the
    // measurement reads true content); a MANUALLY-dragged row keeps its explicit height WITH the clip
    // (classic behaviour for that row). virtualSize undefined in classic mode -> the byte-identical
    // `split ? applied : undefined` path, clip ON.
    const ri = row.row_index;
    const isManualRow = manualRowHeights[ri] != null;
    const virt = virtualized && virtualSize != null;
    const heightForRow = virt ? virtualSize : split ? appliedRowHeight(ri) : undefined;
    const clipDescriptionForRow = virt ? isManualRow : true;
    const measureRefForRow =
      virt && pane !== "frozen" ? rowVirtualizer.measureElement : undefined;
    return (
    <PricingGridRow
      key={row.row_index}
      row={row}
      rowIndex={rowIdx}
      pane={pane}
      rowHeight={heightForRow}
      clipDescription={clipDescriptionForRow}
      measureRef={measureRefForRow}
      depth={depths.get(row.row_index) ?? 0}
      parentExcelRow={parentExcelRowOf(row, byIdx)}
      flags={rowFlags?.get(row.row_index)}
      rowDraftRates={draftSlicesByRow.get(row.row_index) ?? EMPTY_SLICE}
      rowProposedRates={proposedSlicesByRow.get(row.row_index) ?? EMPTY_SLICE}
      activeColIndex={activeCell?.rowIndex === rowIdx ? activeCell.colIndex : null}
      selLeftCol={selRange ? selRange.left : null}
      selRightCol={selRange ? selRange.right : null}
      skipColsCsv={skipFlash.get(rowIdx) ?? null}
      anyCellActive={anyCellActive}
      openRemark={openRemarkExcelRow === row.source_row_number}
      isCurrentHit={isCurrentHitRow(row.source_row_number, currentHitExcelRow)}
      isJumpFlash={isJumpFlashRow(row.source_row_number, flashExcelRow)}
      displayDescriptors={visibleDescriptors}
      columnDescriptors={columnDescriptors}
      columnFormulas={columnFormulas}
      reconChoiceMap={reconChoiceMap}
      category={categoriesByExcelRow.get(row.source_row_number)}
      hasRun={hasRun}
      categoryLabelById={categoryLabelById}
      onCategoryClick={onCategoryClick}
      rowSuggestions={rowSuggestionsByExcelRow.get(row.source_row_number)}
      onSuggestionBadgeClick={onSuggestionBadgeClick}
      // SELECTED-ROW runs: per-row BOOLEANS derived from the grid-level sets, keyed on the
      // DURABLE source_row_number (never the window array index -- under virtualized row
      // recycling a collapse/filter reshuffle makes array index N map to a different row).
      tickable={tickableRows.has(row.source_row_number)}
      selected={selectedRows.has(row.source_row_number)}
      onToggleTick={onToggleTick}
      override={override}
      formulasComplete={formulasComplete}
      categoryGateOpen={categoryGateOpen}
      onSaveRate={onSaveRate}
      onSaveColor={onSaveColor}
      onSaveRemark={onSaveRemark}
      onSaveReconChoice={onSaveReconChoice}
      colCount={colCount}
      rowCount={rows.length}
      remarksColIndex={remarksColIndex}
      effectiveAnchorCount={effectiveAnchorCount}
      descriptorColStart={descriptorColStart}
      descriptionColumns={descriptionColumns}
      fanOut={fanOut}
      bcsKinds={bcsKinds}
      bcsColStart={bcsColStart}
      bcsRow={bcsRatesByExcelRow.get(row.source_row_number)}
      rowBcsDrafts={bcsSlicesByRow.get(row.row_index) ?? EMPTY_SLICE}
      bcsQty={bcsQtyFor(row)}
      bcsAmountSource={bcsAmountSource}
      onSaveBcsRates={onSaveBcsRates}
      bcsReadOnlyReason={bcsReadOnlyReason}
      commitBcsRate={commitBcsRate}
      scheduleBcsAutoSave={scheduleBcsAutoSave}
      setDraftBcsRates={setDraftBcsRates}
      commitRate={commitRate}
      scheduleAutoSave={scheduleAutoSave}
      onCellFocus={onCellFocus}
      registerCell={registerCell}
      focusCell={focusCell}
      setDraftRates={setDraftRates}
      setProposedRates={setProposedRates}
      setOpenRemark={setOpenRemark}
      onJumpToRow={jumpToRow}
      onRowResizePointerDown={onRowResizePointerDown}
      onRowResizePointerMove={onRowResizePointerMove}
      onRowResizePointerUp={onRowResizePointerUp}
    />
    );
  };

  // V1: the <tbody> children for a pane. CLASSIC (virtualized off) = the full rows.map -- BYTE-
  // IDENTICAL to pre-V1. VIRTUALIZED = a top spacer <tr>, the mounted window (renderRow given the
  // virtualizer's per-row size), and a bottom spacer <tr>. BOTH panes call this with the SAME
  // virtualItems -> identical vertical structure + identical spacer heights -> pane rows stay aligned.
  const renderTbody = (pane?: "frozen" | "scrolling") => {
    if (!virtualized) return rows.map((row, rowIdx) => renderRow(row, rowIdx, pane));
    const items = rowVirtualizer.getVirtualItems();
    const { paddingTop, paddingBottom } = deriveSpacers(items, rowVirtualizer.getTotalSize());
    // MC-5: span the PARAMETRIC anchor count (fan-out description columns shift it), not the fixed
    // constant -- so the virtualizer spacer <tr> covers every frozen-pane column under fan-out.
    // BCS-S3a: the cost block widens the SCROLLING (and single-table) span. Added at the CALL
    // SITE rather than inside `paneColSpan` -- pricingVirtual.ts is out of this slice's scope,
    // and the addend is pure geometry the caller already holds. The frozen pane is unaffected
    // (the cost columns never sit there).
    const colSpan =
      paneColSpan(pane, effectiveAnchorCount, visibleDescriptors.length) +
      (pane === "frozen" ? 0 : bcsColKeys.length);
    return (
      <>
        {paddingTop > 0 && (
          <tr aria-hidden>
            <td colSpan={colSpan} style={{ height: paddingTop, padding: 0, border: 0 }} />
          </tr>
        )}
        {items.map((vi) => {
          const row = rows[vi.index];
          return row ? renderRow(row, vi.index, pane, vi.size) : null;
        })}
        {paddingBottom > 0 && (
          <tr aria-hidden>
            <td colSpan={colSpan} style={{ height: paddingBottom, padding: 0, border: 0 }} />
          </tr>
        )}
      </>
    );
  };

  // Slice A (clipboard): the transient status strip (paste summary / shape-mismatch reject /
  // copy count), rendered ABOVE the grid in both the split + single-table returns. Dismissible;
  // self-clears after a few seconds. Inline (no portal) so it rides the grid's own layout.
  const clipboardNotice = clipboardMsg ? (
    <div className="mb-2 flex items-center gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
      <span className="flex-1">{clipboardMsg}</span>
      <button
        type="button"
        onClick={() => setClipboardMsg(null)}
        aria-label="Dismiss"
        className="shrink-0 opacity-60 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  ) : null;

  // Slice A (clipboard): the right-click context menu -- the house DropdownMenu driven as a
  // CONTROLLED menu, anchored to a 0-size fixed element at the cursor (menu.x/menu.y). It portals
  // to <body> (never clipped by a pane's overflow) and gives Esc + click-away + focus for free.
  // Every item calls the EXISTING doX (same path as the keyboard shortcuts); the shortcut hint
  // teaches the binding. Disabled flags are the open-time SNAPSHOT (Paste read clipboardRef fresh).
  // Rendered in BOTH returns below (the portal makes its tree position irrelevant to layout).
  const contextMenu = (
    <DropdownMenu open={menu.open} onOpenChange={(o) => setMenu((m) => ({ ...m, open: o }))}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          style={{ position: "fixed", left: menu.x, top: menu.y, width: 0, height: 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-44"
        onCloseAutoFocus={(e) => e.preventDefault()} // don't yank focus back to the 0-size trigger
      >
        <DropdownMenuItem disabled={!menu.canCopy} onSelect={() => doCopy()}>
          Copy <DropdownMenuShortcut>Ctrl+C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!menu.canCut} onSelect={() => doCut()}>
          Cut <DropdownMenuShortcut>Ctrl+X</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!menu.canPaste} onSelect={() => doPaste()}>
          Paste <DropdownMenuShortcut>Ctrl+V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!menu.canFill} onSelect={() => doFillDown()}>
          Fill down <DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // RM-3b item 2: the embedded always-visible horizontal scrollbar. A thin `sticky bottom-0` bar
  // rendered as a SIBLING of the scroll container (so it is not clipped by the pane's overflow and it
  // pins to the bottom of the visible grid area / viewport while the grid is on screen). Its inner
  // spacer is the X-scroller's content width, so its thumb tracks the real scroll (synced by the effect
  // above, both ways). Rendered only embedded; full-screen uses the native bounded-container scrollbar.
  const hScrollProxy = showHScrollProxy ? (
    <>
      {/* RM-3c item A: suppress the scroller's OWN native horizontal scrollbar so the sticky proxy is
          the SINGLE bar. Scoped `::-webkit-scrollbar:horizontal` (Chrome/Edge/Safari = blink/webkit) --
          hides ONLY the H-bar, the vertical bar + native X scroll capability (wheel/trackpad) stay.
          Cross-browser shape: Firefox has no per-axis scrollbar control (`scrollbar-width` is
          all-or-nothing), so it retains a below-fold native H-bar with the proxy as the primary bar. */}
      <style>{".boq-embed-hidehbar::-webkit-scrollbar:horizontal{display:none;height:0}"}</style>
      <div
        ref={hScrollProxyRef}
        className="sticky bottom-0 z-30 overflow-x-auto overflow-y-hidden border-t border-border bg-background/95"
        // width = the scroller's clientWidth (so the proxy range == the real range, no V-bar clamp);
        // spacer = the scroller's real scrollWidth (full extent, both panes).
        style={{ height: 14, width: hScrollMetrics.clientWidth || undefined }}
        aria-hidden
      >
        <div style={{ width: `${hScrollMetrics.scrollWidth || totalWidth}px`, height: 1 }} />
      </div>
    </>
  ) : null;

  // ── Two-pane split. CLASSIC: freeze on AND heights captured (`split`). VIRTUALIZED: freeze on
  //    (`twoPane = frozen`), windowed. Same JSX; the <tbody> content routes through renderTbody. ──
  if (twoPane) {
    return (
      <VirtualizedContext.Provider value={virtualized}>
      {clipboardNotice}
      {contextMenu}
      <div
        ref={containerRef}
        className={cn(
          "rounded-md border border-border overflow-hidden",
          // Full-screen: fill the expanded flex-col root; the panes carry the height cap instead.
          expanded ? "flex flex-col flex-1 min-h-0" : "",
        )}
      >
        <CollapseContext.Provider value={collapseCtxValue}>
          <div className={cn("flex", expanded ? "flex-1 min-h-0" : "")}>
            {/* FROZEN pane: the 5 anchors only. overflow-x hidden (no horizontal scroll); its
                vertical scroll is DRIVEN by the scrolling pane (overflow-hidden still accepts a
                programmatic scrollTop). Width = the anchors' summed colWidths.
                Slice 2 PART 1 -- freeze-boundary border: the table's own right-edge (Description
                border-r) is CLIPPED away by this pane's overflow-hidden, so the boundary looked
                invisible once split. Draw it ONCE on the container border-box instead (border-r) --
                not clipped, no double-up (the clipped cell border can't show), one crisp line. */}
            <div
              ref={frozenPaneRef}
              className={cn(
                "overflow-hidden shrink-0 border-r border-border",
                expanded ? "min-h-0" : "max-h-[calc(100vh-14rem)]",
              )}
              style={{ width: `${anchorPaneWidth}px` }}
            >
              <table
                className="text-xs border-collapse table-fixed"
                style={{ width: `${anchorPaneWidth}px` }}
                onKeyDown={handleGridKeyDown}
                onMouseDownCapture={onTableMouseDown}
                onContextMenu={onCellContextMenu}
              >
                <colgroup>{anchorCols}</colgroup>
                <thead>
                  <tr>{anchorHeaderCells}</tr>
                </thead>
                <tbody>{renderTbody("frozen")}</tbody>
              </table>
            </div>
            {/* SCROLLING pane: descriptors + Remarks. Owns overflow-x AND overflow-y; mirrors its
                scrollTop to the frozen pane on every scroll so the matching rows stay aligned. */}
            <div
              ref={scrollPaneRef}
              onScroll={(e) => {
                if (frozenPaneRef.current) {
                  frozenPaneRef.current.scrollTop = e.currentTarget.scrollTop;
                }
              }}
              className={cn(
                "overflow-auto flex-1 min-w-0",
                expanded ? "min-h-0" : "max-h-[calc(100vh-14rem)] boq-embed-hidehbar",
              )}
            >
              <table
                className="text-xs border-collapse table-fixed"
                style={{ width: `${scrollPaneTableWidth}px` }}
                onKeyDown={handleGridKeyDown}
                onMouseDownCapture={onTableMouseDown}
                onContextMenu={onCellContextMenu}
              >
                <colgroup>
                  {categoryCol}
                  {descriptorCols}
                  {bcsCols}
                  {remarksCol}
                </colgroup>
                <thead>
                  <tr>
                    {categoryHeaderCell}
                    {descriptorHeaderCells}
                    {bcsHeaderCells}
                    {remarksHeaderCell}
                  </tr>
                </thead>
                <tbody>{renderTbody("scrolling")}</tbody>
              </table>
            </div>
          </div>
        </CollapseContext.Provider>
      </div>
      {hScrollProxy}
      </VirtualizedContext.Provider>
    );
  }

  // ── Unfrozen (default): today's SINGLE table -- same div > table > colgroup / thead / tbody and
  //    classes as before. The only inert differences: containerRef moved from the <table> to this
  //    wrapper (refs are not DOM) and the col/th/row JSX comes from the shared fragments above. ──
  return (
    <VirtualizedContext.Provider value={virtualized}>
    {clipboardNotice}
    {contextMenu}
    <div
      ref={containerRef}
      className={cn(
        "rounded-md border border-border overflow-auto",
        // Slice 4c: full-screen relaxes the viewport-rem cap to fill the expanded flex-col
        // root (the page gives this container's slot flex-1 min-h-0). Embedded keeps the cap.
        // RM-3c: embedded suppresses this container's native H-bar (the proxy is the single bar).
        expanded ? "flex-1 min-h-0" : "max-h-[calc(100vh-14rem)] boq-embed-hidehbar",
      )}
    >
      {/* Resize: table-fixed makes the <colgroup> widths AUTHORITATIVE; the explicit px total
          (not w-full) prevents table-fixed from redistributing slack. border-collapse is KEPT
          (the cells carry border-r). CollapseContext provides the per-row chevrons' state without
          a per-row prop (R6) -- it wraps the table so every RowChevron consumes it. */}
      <CollapseContext.Provider value={collapseCtxValue}>
      <table
        className="text-xs border-collapse table-fixed"
        style={tableStyle}
        onKeyDown={handleGridKeyDown}
        onMouseDownCapture={onTableMouseDown}
        onContextMenu={onCellContextMenu}
      >
        <colgroup>
          {anchorCols}
          {categoryCol}
          {descriptorCols}
          {bcsCols}
          {remarksCol}
        </colgroup>
        <thead>
          <tr>
            {anchorHeaderCells}
            {categoryHeaderCell}
            {descriptorHeaderCells}
            {bcsHeaderCells}
            {remarksHeaderCell}
          </tr>
        </thead>
        <tbody>{renderTbody()}</tbody>
      </table>
      </CollapseContext.Provider>
    </div>
    {hScrollProxy}
    </VirtualizedContext.Provider>
  );
}));

PricingGrid.displayName = "PricingGrid";
