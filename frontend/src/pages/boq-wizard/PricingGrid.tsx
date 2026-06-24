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
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
import { debounce, type DebouncedFunc } from "lodash";
import { Palette, MessageSquare, AlertTriangle, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ClassificationPill,
  computeDepths,
  renderDescriptorCell,
  resolveDescriptorValue,
} from "./reviewRender";
import { COLOR_TOKENS, ROLE_LABELS } from "./boqTypes";
import { AmountFormulaBuilder } from "./AmountFormulaBuilder";
import { bindRef, evaluateAmountColumn, pickFormula, type OperandLookup } from "./amountFormula";
import type {
  AmountFormulaNode,
  AmountFormulaRef,
  AmountFormulaSaveArgs,
  ColorSaveArgs,
  ColumnDescriptor,
  ColumnFormula,
  LockInfo,
  PricedRow,
  RateCellSaveArgs,
  RemarkSaveArgs,
  RowReviewFlags,
} from "./boqTypes";

// Depth indent step -- mirrors ReviewTree.INDENT_PX (kept in sync; the pricing grid does
// not import ReviewTree per design v1.3 Sec.4 path b).
const INDENT_PX = 20;

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

/**
 * PRICEABILITY axis (Slice 3e): a rate cell is editable (and the server accepts a save
 * without the override) ONLY on a committed row whose node_type is "Preamble" or "Line Item"
 * (VERBATIM). Every other type ("Other" -- note/spacer/subtotal/header_repeat), as well as a
 * null/undefined node_type (old/absent payload), is non-priceable. Keys on the SAME field the
 * server guard uses (save_cell_price), so the two axes can never drift. Pure -- unit-tested.
 */
export function isPriceableType(nodeType: string | null | undefined): boolean {
  return nodeType === "Preamble" || nodeType === "Line Item";
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
const RATE_VALUE_FIELDS = new Set<string>([PER_AREA_RATE_FIELD, ...SCALAR_RATE_FIELDS]);

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
          type="button"
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          title="Highlight color"
          className="absolute left-0.5 top-0.5 z-[5] h-3 w-3 rounded-sm border border-border opacity-40 hover:opacity-100"
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
   * Slice 3c: surfaces "has uncommitted drafts" UP to the page (drives the "Unsaved
   * changes" status). Called whenever the unsaved-drafts state flips.
   */
  onDirtyChange?: (hasUnsaved: boolean) => void;
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
}

/** Slice 3c: imperative handle the page holds (via a ref) to force-flush pending saves. */
export interface PricingGridHandle {
  /** Fire all pending debounced saves now + retry any remaining uncommitted draft. */
  flush: () => void;
  /** Slice 4a: scroll a row into view by its Excel row number (the review-list jump). */
  scrollToRow: (excelRow: number) => void;
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

interface PricingGridRowProps {
  // ── per-row data (changes -> this row re-renders) ──
  row: PricedRow;
  /** ARRAY index into rows (the nav-matrix row coord), NOT row.row_index. */
  rowIndex: number;
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
  /** Whether ANY cell in the grid is active (drives roving-tabindex's (0,0) entry fallback). */
  anyCellActive: boolean;
  /** Whether this row's remarks editor is open. */
  openRemark: boolean;
  // ── stable shared values/refs (reference-stable across a keystroke -> memo holds) ──
  displayDescriptors: ColumnDescriptor[];
  columnDescriptors: ColumnDescriptor[];
  columnFormulas: ColumnFormula[];
  override: boolean;
  /** MANDATORY amount-formula gate (per-SHEET boolean -- flips identically for all rows). */
  formulasComplete: boolean;
  onSaveRate?: (cell: RateCellSaveArgs, rate: number) => Promise<void>;
  onSaveColor?: (args: ColorSaveArgs[]) => Promise<void>;
  onSaveRemark?: (args: RemarkSaveArgs) => Promise<void>;
  colCount: number;
  rowCount: number;
  remarksColIndex: number;
  commitRate: (row: PricedRow, d: ColumnDescriptor, rawValue: string) => void;
  scheduleAutoSave: (row: PricedRow, d: ColumnDescriptor) => void;
  onCellFocus: (r: number, c: number) => void;
  registerCell: (r: number, c: number, el: HTMLElement | null) => void;
  focusCell: (r: number, c: number) => void;
  setDraftRates: Dispatch<SetStateAction<Record<string, string>>>;
  setProposedRates: Dispatch<SetStateAction<Record<string, string>>>;
  setOpenRemark: (rowIndex: number, open: boolean) => void;
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
    prev.depth === next.depth &&
    prev.parentExcelRow === next.parentExcelRow &&
    prev.flags === next.flags &&
    prev.rowDraftRates === next.rowDraftRates &&
    prev.rowProposedRates === next.rowProposedRates &&
    prev.activeColIndex === next.activeColIndex &&
    prev.anyCellActive === next.anyCellActive &&
    prev.openRemark === next.openRemark &&
    prev.displayDescriptors === next.displayDescriptors &&
    prev.columnDescriptors === next.columnDescriptors &&
    prev.columnFormulas === next.columnFormulas &&
    prev.override === next.override &&
    prev.formulasComplete === next.formulasComplete &&
    prev.onSaveRate === next.onSaveRate &&
    prev.onSaveColor === next.onSaveColor &&
    prev.onSaveRemark === next.onSaveRemark &&
    prev.colCount === next.colCount &&
    prev.rowCount === next.rowCount &&
    prev.remarksColIndex === next.remarksColIndex &&
    prev.commitRate === next.commitRate &&
    prev.scheduleAutoSave === next.scheduleAutoSave &&
    prev.onCellFocus === next.onCellFocus &&
    prev.registerCell === next.registerCell &&
    prev.focusCell === next.focusCell &&
    prev.setDraftRates === next.setDraftRates &&
    prev.setProposedRates === next.setProposedRates &&
    prev.setOpenRemark === next.setOpenRemark
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
  depth,
  parentExcelRow,
  flags,
  rowDraftRates,
  rowProposedRates,
  activeColIndex,
  anyCellActive,
  openRemark,
  displayDescriptors,
  columnDescriptors,
  columnFormulas,
  override,
  formulasComplete,
  onSaveRate,
  onSaveColor,
  onSaveRemark,
  colCount,
  rowCount,
  remarksColIndex,
  commitRate,
  scheduleAutoSave,
  onCellFocus,
  registerCell,
  focusCell,
  setDraftRates,
  setProposedRates,
  setOpenRemark,
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
  const cellNavClass = (c: number) =>
    cn("scroll-mt-9 outline-none", isActiveCol(c) && "ring-2 ring-inset ring-blue-500 dark:ring-blue-400");
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
    <tr className="border-b border-border hover:bg-muted/30">
      {/* Excel Row (col 0) -- also the 4b-A flag gutter (left accent + Flag icon). */}
      <td
        {...tdFocusProps(0)}
        title={hasFlag ? flagTitle : undefined}
        className={cn(
          "px-2 py-1.5 text-muted-foreground align-top w-16 border-r border-border tabular-nums",
          flagCritical && "border-l-4 border-l-rose-500 dark:border-l-rose-600",
          flagAttention && "border-l-4 border-l-amber-500 dark:border-l-amber-600",
          cellNavClass(0),
        )}
      >
        <span className="inline-flex items-center gap-1">
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
      </td>
      {/* Sl.No (col 1) */}
      <td
        {...tdFocusProps(1)}
        className={cn(
          "px-2 py-1.5 text-muted-foreground align-top w-16 border-r border-border",
          cellNavClass(1),
        )}
      >
        {row.sl_no_value ?? ""}
      </td>
      {/* Parent (col 2): parent's Excel row number (muted; read-only -- focus only). */}
      <td
        {...tdFocusProps(2)}
        className={cn("px-2 py-1.5 align-top w-16 border-r border-border", cellNavClass(2))}
      >
        {parentExcelRow !== null ? (
          <span className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">
            ↑ {parentExcelRow}
          </span>
        ) : null}
      </td>
      {/* Classification pill (col 3) (read-only -- no chevron / reclassify). */}
      <td
        {...tdFocusProps(3)}
        className={cn("px-2 py-1.5 align-top w-36 border-r border-border", cellNavClass(3))}
      >
        <ClassificationPill cls={row.effective_classification} />
      </td>
      {/* Description (col 4): depth indent + per-classification styling. */}
      <td {...tdFocusProps(4)} className={cn("px-2 py-1.5 align-top", cellNavClass(4))}>
        <div style={{ paddingLeft: `${depth * INDENT_PX}px` }}>
          <span
            className={cn(
              "leading-snug break-words min-w-0",
              isPreamble && "font-medium text-foreground",
              isLineItem && "text-foreground",
              !isPreamble && !isLineItem && "text-muted-foreground italic text-[11px]",
            )}
          >
            {row.description || (
              <span className="not-italic text-muted-foreground">(no description)</span>
            )}
          </span>
        </div>
      </td>
      {/* Descriptor-driven data cells: editable rate inputs, live-amount cells, and read-only
          qty/other cells. */}
      {displayDescriptors.map((d, dIdx) => {
        const colIndex = FIXED_ANCHOR_COUNT + dIdx;
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
              title={
                needsReview
                  ? "Priced on a non-priceable row -- flagged for review"
                  : priced
                    ? "Priced"
                    : undefined
              }
              className={cn(
                "relative px-1 py-1 align-top",
                colorBorderClass,
                priced &&
                  (needsReview
                    ? "bg-amber-50 dark:bg-amber-950/30"
                    : "bg-emerald-50 dark:bg-emerald-950/30"),
                isActiveCol(colIndex) &&
                  "ring-2 ring-inset ring-blue-500 dark:ring-blue-400",
              )}
            >
              {colorPicker}
              <div className="flex items-center justify-end gap-1">
                {priced && (
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                      needsReview ? "bg-amber-500" : "bg-emerald-500",
                    )}
                  />
                )}
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
          return (
            <td
              key={d.col}
              {...tdFocusProps(colIndex)}
              title={isBroken ? "Check formula" : needsRate ? "Needs a rate" : undefined}
              className={cn(
                "relative px-2 py-1.5 text-right align-top tabular-nums",
                colorBorderClass,
                cellNavClass(colIndex),
              )}
            >
              {colorPicker}
              {cell.kind === "value" ? (
                renderDescriptorCell(cell.value)
              ) : cell.kind === "committed" ? (
                renderDescriptorCell(resolveDescriptorValue(row, d))
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
            title={
              needsReview
                ? "Priced on a non-priceable row -- flagged for review"
                : priced
                  ? "Priced"
                  : undefined
            }
            className={cn(
              "relative px-2 py-1.5 text-right align-top tabular-nums",
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
      {/* Slice 4a.2: trailing Remarks cell (per-row) -- the matrix's LAST column. */}
      <td
        {...tdFocusProps(remarksColIndex)}
        className={cn(
          "px-2 py-1.5 align-top border-l border-border w-48 min-w-[160px]",
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
            setOpenRemark(rowIndex, o);
            // On close (Esc / Save / outside-click) restore focus to this cell so arrow-nav
            // continues. An Enter-save's onMoveDown runs AFTER and wins.
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
    </tr>
  );
}, pricingRowPropsAreEqual);
PricingGridRow.displayName = "PricingGridRow";

export const PricingGrid = forwardRef<PricingGridHandle, PricingGridProps>(function PricingGrid(
  { rows, columnDescriptors, onSaveRate, onDirtyChange, override = false, formulasComplete = true, onSaveRemark, onSaveColor, columnFormulas = [], onSaveFormula, rowFlags, expanded = false },
  ref,
) {
  // Optimistic per-rate-cell drafts (this session), keyed `${row_index}:${col}`. A draft
  // shows instantly (live amount) until the save's refetch lands, then it is dropped so the
  // cell falls back to the refetched saved rate.
  const [draftRates, setDraftRates] = useState<Record<string, string>>({});
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
  // Per-cell focusable element, keyed `${rowIndex}:${colIndex}` -- the <input> for a rate
  // cell, the <td> for every other cell. Used to .focus() the target on a keyboard move.
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());
  // Slice 4a.2: the remarks editor's open-state, LIFTED to the grid (was local to
  // RemarkCell) so the keyboard (Enter on the focused remarks cell) can open it, not just
  // a click. Holds the ARRAY index (rowIdx) of the open row, or null. RemarkCell's
  // draft/saving/error stay local; only open is controlled here.
  const [openRemarkRowIdx, setOpenRemarkRowIdx] = useState<number | null>(null);

  // Slice 3c -- auto-save plumbing. Per-cell 1000ms debounced commit, keyed by cellKey.
  const debouncersRef = useRef<Map<string, DebouncedFunc<() => void>>>(new Map());
  // Latest draftRates + a latest-state "commit one cell" fn, so a debounced fire / flush
  // reads CURRENT state at fire time (a captured value would be stale). Synced each render.
  const draftRatesRef = useRef<Record<string, string>>({});
  const autoSaveCellRef = useRef<(rowIndexField: number, col: string) => void>(() => {});
  // Latest rows snapshot (synced each render) -- the post-save propagation trigger reads
  // it to check a corresponding cell's CURRENT priced state at save-resolve time.
  const rowsRef = useRef<PricedRow[]>(rows);

  // Editor perf fix (item 2): memoize the O(rows) / O(cols) grid derivations on their real
  // inputs so a cursor move (which changes only the grid-local activeCell, not rows /
  // columnDescriptors) does NOT rebuild them -- and so the memoized rows that reference
  // displayDescriptors keep a stable prop reference.
  // row_index -> row, for resolving a parent's Excel row number.
  const byIdx = useMemo(() => new Map<number, PricedRow>(rows.map((r) => [r.row_index, r])), [rows]);
  // Effective depth per row (reused helper -- single source of truth with the review tree).
  const depths = useMemo(() => computeDepths(rows), [rows]);

  // Descriptor-driven columns: everything except the sl_no / description anchors.
  const displayDescriptors = useMemo(
    () => columnDescriptors.filter((d) => !FIXED_ROLE_DEDUPE.has(d.role)),
    [columnDescriptors],
  );
  const slNoLetter = useMemo(
    () => columnDescriptors.find((d) => d.role === "sl_no")?.col ?? null,
    [columnDescriptors],
  );
  const descriptionLetter = useMemo(
    () => columnDescriptors.find((d) => d.role === "description")?.col ?? null,
    [columnDescriptors],
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
    void onSaveRate(buildRateCell(row, d), rate)
      .then(() => {
        // Success: drop the optimistic draft so the cell shows the refetched saved rate.
        setDraftRates((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        delete committedAttemptRef.current[key];
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

  // ── Slice 3b.2 nav model ───────────────────────────────────────────────────
  // Slice 4a.2: the trailing Remarks column is now the matrix's LAST column. Its colIndex is
  // FIXED_ANCHOR_COUNT + displayDescriptors.length (just past the descriptors), and colCount
  // includes it (+1). The +1 only widens nextCell's right/Tab boundary so arrows/Tab reach
  // the remarks cell; no other colIndex math reads colCount (descriptor cells use
  // FIXED_ANCHOR_COUNT + dIdx; anchors use 0..4).
  const remarksColIndex = FIXED_ANCHOR_COUNT + displayDescriptors.length;
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
  }, []);

  const focusCell = useCallback((r: number, c: number) => {
    const el = cellRefs.current.get(navKey(r, c));
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, []);

  // Set THIS row's remarks editor open-state (stable, so the memoized row holds). The row
  // passes its own array index; open=true makes it the single open editor, false closes it.
  const setOpenRemark = useCallback((rowIndexArg: number, open: boolean) => {
    setOpenRemarkRowIdx(open ? rowIndexArg : null);
  }, []);

  // Commit the active cell IF it is an editable rate cell (locked: explicit commit-on-move;
  // the committedAttemptRef dedupe absorbs the trailing onBlur -> no double-save).
  const commitActiveRate = (cell: CellCoord) => {
    if (!onSaveRate || cell.colIndex < FIXED_ANCHOR_COUNT) return;
    const d = displayDescriptors[cell.colIndex - FIXED_ANCHOR_COUNT];
    if (!d || !isRateDescriptor(d)) return;
    const row = rows[cell.rowIndex];
    if (!row) return;
    const key = cellKey(row.row_index, d.col);
    commitRate(row, d, draftRates[key] ?? savedRateStr(row, d));
  };

  // The single grid keydown handler (on the <table>; cell/input keydowns bubble here).
  // Maps a nav key -> direction, commits the active rate cell, then moves focus. Always
  // preventDefaults a nav key while the grid is active so arrows never move the input caret
  // and Tab never escapes the grid (at an edge: commit + stay put).
  const handleGridKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (!activeCell) return;
    // Slice 4a.2: Enter on the focused REMARKS cell OPENS its editor (not move-down) --
    // but only when editable (onSaveRemark present). A read-only remarks cell has nothing
    // to open, so Enter falls through to the generic Enter->down below (matching every other
    // read-only cell). preventDefault stops the cell's native button/Enter side effects.
    if (activeCell.colIndex === remarksColIndex && e.key === "Enter" && onSaveRemark) {
      e.preventDefault();
      setOpenRemarkRowIdx(activeCell.rowIndex);
      return;
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
    const next = nextCell(activeCell, dir, rows.length, colCount);
    if (next) focusCell(next.rowIndex, next.colIndex);
  };

  // ── Slice 3c: dirty signal + force-flush handle + flush-on-unmount ───────────
  // Surface "has uncommitted drafts" up to the page (drives the "Unsaved changes" status).
  const hasUnsaved = Object.keys(draftRates).length > 0;
  useEffect(() => {
    onDirtyChange?.(hasUnsaved);
  }, [hasUnsaved, onDirtyChange]);

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
      },
      // Slice 4a: the review-list jump. Resolve the Excel row -> array index (rowsRef is
      // synced each render), then focus + center the row's first cell (col 0 is registered
      // in cellRefs, a stable ref) -- onFocus sets activeCell, giving a visible landing.
      scrollToRow: (excelRow) => {
        const idx = rowsRef.current.findIndex((r) => r.source_row_number === excelRow);
        if (idx < 0) return;
        const el = cellRefs.current.get(`${idx}:0`);
        if (el) {
          el.focus();
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      },
    }),
    [],
  );

  // Flush-on-unmount: a typed-but-uncommitted value persists on navigate-away (not dropped).
  useEffect(() => {
    const debouncers = debouncersRef.current;
    return () => {
      debouncers.forEach((deb) => deb.flush());
    };
  }, []);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        This committed sheet has no rows to price.
      </p>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border border-border overflow-auto",
        // Slice 4c: full-screen relaxes the viewport-rem cap to fill the expanded flex-col
        // root (the page gives this container's slot flex-1 min-h-0). Embedded keeps the cap.
        expanded ? "flex-1 min-h-0" : "max-h-[calc(100vh-14rem)]",
      )}
    >
      <table className="w-full text-xs border-collapse" onKeyDown={handleGridKeyDown}>
        <thead>
          <tr>
            <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
              Excel Row
            </th>
            <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
              {slNoLetter ? `Sl.No (${slNoLetter})` : "Sl.No"}
            </th>
            <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
              Parent
            </th>
            <th className="px-2 py-2 text-left font-medium text-muted-foreground w-36 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
              Classification
            </th>
            <th className="px-2 py-2 text-left font-medium text-muted-foreground min-w-[280px] whitespace-nowrap sticky top-0 z-20 bg-muted">
              {descriptionLetter ? `Description (${descriptionLetter})` : "Description"}
            </th>
            {displayDescriptors.map((d) => {
              const label = `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}${d.area ? ` · ${d.area}` : ""}`;
              const isAmount = isAmountDescriptor(d);
              // PENDING TINT: a subtle amber wash on an amount column with NO covering formula, so
              // a wide sheet (VRF 9 cols) is scannable at a glance; a covered amount column + every
              // non-amount column keep the neutral bg-muted. The coverage check is pickFormula
              // (already imported -- amountFormula.ts) inline, NOT priceability.isAmountColumnCovered:
              // importing priceability here would reverse the one-way dependency (priceability
              // imports PricingGrid) into a cycle -- same reason isNonZeroNum is a self-contained
              // copy above. It is the SAME override>wildcard pickFormula resolution the gate +
              // badge use, so the tint can never drift from them. (Amber tokens mirror the gate banner.)
              const amountPending =
                isAmount &&
                !pickFormula(
                  { value_field: d.value_field, value_key: d.value_key, rate_subkey: d.rate_subkey },
                  columnFormulas,
                )?.formula;
              return (
                <th
                  key={d.col}
                  className={cn(
                    "px-2 py-2 text-right font-medium text-muted-foreground w-28 min-w-[112px] border-l border-border whitespace-nowrap sticky top-0 z-20 align-top",
                    amountPending ? "bg-amber-50 dark:bg-amber-950/40" : "bg-muted",
                  )}
                >
                  <span className="inline-flex items-center justify-end gap-1">
                    {/* Formula Builder: the LEADING amber/green ƒ status badge that IS the
                        click-to-edit trigger (status + action merged), on AMOUNT columns only.
                        Read-only (static glyph) when onSaveFormula is withheld (locked). The
                        amount-cell VALUE render is UNCHANGED (F4 owns the compute swap). */}
                    {isAmount && (
                      <AmountFormulaBuilder
                        target={d}
                        columnLabel={label}
                        descriptors={columnDescriptors}
                        columnFormulas={columnFormulas}
                        onSave={onSaveFormula}
                      />
                    )}
                    <span>{label}</span>
                  </span>
                </th>
              );
            })}
            {/* Slice 4a: trailing Remarks column (per-row; click/Enter-to-open editor). NOT a
                descriptor; Slice 4a.2 made it the matrix's last navigable column. */}
            <th className="px-2 py-2 text-left font-medium text-muted-foreground w-48 min-w-[160px] border-l border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
              Remarks
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => {
            // Editor perf fix (item 1): the parent resolves ONLY the row's cheap, reference-
            // stable inputs (depth, parent Excel row, its flags, its draft/proposal slices, and
            // its activeColIndex lever) and hands them to the memoized PricingGridRow. The heavy
            // per-cell work (evaluateAmountCell, the descriptor map, the RemarkCell) lives inside
            // the row and is SKIPPED by React.memo for every row whose props are unchanged -- so
            // a cursor move re-renders only the 2 rows whose active-state flipped, and a keystroke
            // only the 1 edited row (its slice reference changed; everyone else's is reused).
            const pIdx = row.effective_parent_index ?? -1;
            const parentExcelRow = pIdx >= 0 ? (byIdx.get(pIdx)?.source_row_number ?? null) : null;
            return (
              <PricingGridRow
                key={row.row_index}
                row={row}
                rowIndex={rowIdx}
                depth={depths.get(row.row_index) ?? 0}
                parentExcelRow={parentExcelRow}
                flags={rowFlags?.get(row.row_index)}
                rowDraftRates={draftSlicesByRow.get(row.row_index) ?? EMPTY_SLICE}
                rowProposedRates={proposedSlicesByRow.get(row.row_index) ?? EMPTY_SLICE}
                activeColIndex={activeCell?.rowIndex === rowIdx ? activeCell.colIndex : null}
                anyCellActive={anyCellActive}
                openRemark={openRemarkRowIdx === rowIdx}
                displayDescriptors={displayDescriptors}
                columnDescriptors={columnDescriptors}
                columnFormulas={columnFormulas}
                override={override}
                formulasComplete={formulasComplete}
                onSaveRate={onSaveRate}
                onSaveColor={onSaveColor}
                onSaveRemark={onSaveRemark}
                colCount={colCount}
                rowCount={rows.length}
                remarksColIndex={remarksColIndex}
                commitRate={commitRate}
                scheduleAutoSave={scheduleAutoSave}
                onCellFocus={onCellFocus}
                registerCell={registerCell}
                focusCell={focusCell}
                setDraftRates={setDraftRates}
                setProposedRates={setProposedRates}
                setOpenRemark={setOpenRemark}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

PricingGrid.displayName = "PricingGrid";
