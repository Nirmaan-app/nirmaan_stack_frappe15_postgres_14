/**
 * clipboard.ts -- PURE leaf helpers for the pricing-grid in-grid clipboard (BoQ Phase 5,
 * Slice A: copy / cut / paste / fill-down).
 *
 * This module is a PURE LEAF (mirrors reconcile.ts): it imports ONLY types (erased at
 * compile, so there is no runtime cycle even though PricingGrid imports these values back).
 * It holds the geometry + classification logic that decides WHAT a clipboard gesture does;
 * the React orchestration (reading cell values, firing the batch write) lives in PricingGrid.
 *
 * SCOPE BOUNDARY (Slice A): rates + remarks only; internal clipboard (NOT navigator.clipboard);
 * Shift+arrow / Shift+click range only (no drag-select); no undo/redo (Slice B). The batch
 * write shape ({cell, kind, value}) is deliberately delta-friendly so a later undo wrapper can
 * record old/new without reshaping this module.
 */
import type { CellCoord } from "./PricingGrid";
import type {
  BcsRateField,
  BcsRowRates,
  BcsRowSaveArgs,
  RateCellSaveArgs,
  RemarkSaveArgs,
} from "./boqTypes";

// ── Kinds ────────────────────────────────────────────────────────────────────────
/** The copyable cell kinds. A clipboard cell is always one of these (or a SKIP hole).
 *  BCS-S3a added "bcs" -- the per-row COST boxes (owner ruling: a cost box you cannot paste
 *  into or undo, one column from a rate box where both work, is the asymmetry people trip over). */
export type ClipKind = "rate" | "remark" | "bcs";
/** A target cell's kind. "other" = an anchor / amount / qty cell -- and the computed BCS Total
 *  Amount column, which is never a paste target. */
export type CellKind = "rate" | "remark" | "bcs" | "other";

// ── Clipboard payload ──────────────────────────────────────────────────────────────
/** One copied cell: its kind + verbatim string value. `null` = a SKIP hole (a non-copyable
 *  cell that fell inside a range copy -- anchor / amount / qty). */
export type ClipCell = { kind: ClipKind; value: string } | null;

/** A copied rectangular block (1x1 for a single cell). `cells[i][j]` is row-major over the
 *  copied rectangle; `rows`/`cols` are its dimensions (used for the paste shape-match). */
export interface ClipboardBlock {
  rows: number;
  cols: number;
  cells: ClipCell[][];
}

// ── Selection geometry ──────────────────────────────────────────────────────────────
/** A normalized selection rectangle (inclusive bounds), array-index space for rows + the
 *  grid colIndex space for cols. */
export interface SelRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Normalize an (anchor, focus) pair into an inclusive rectangle (order-independent). Pure. */
export function selectionRect(anchor: CellCoord, focus: CellCoord): SelRect {
  return {
    top: Math.min(anchor.rowIndex, focus.rowIndex),
    bottom: Math.max(anchor.rowIndex, focus.rowIndex),
    left: Math.min(anchor.colIndex, focus.colIndex),
    right: Math.max(anchor.colIndex, focus.colIndex),
  };
}

/** A single row's selected column span, or null when the row is outside the rectangle (or
 *  there is no rectangle). The per-row scalar surfaced to the memoized row (as two numbers)
 *  WITHOUT handing it the shared selection object -- the activeColIndex anti-defeat pattern. Pure. */
export function rowSelectionRange(
  rect: SelRect | null,
  rowIndex: number,
): { left: number; right: number } | null {
  if (!rect) return null;
  if (rowIndex < rect.top || rowIndex > rect.bottom) return null;
  return { left: rect.left, right: rect.right };
}

/** Inclusive width/height of a rectangle (cell counts). Pure. */
export function rectDims(rect: SelRect): { rows: number; cols: number } {
  return { rows: rect.bottom - rect.top + 1, cols: rect.right - rect.left + 1 };
}

// ── Shape match ──────────────────────────────────────────────────────────────────────
/** True iff a clipboard block and a target range have IDENTICAL dimensions. No Excel-style
 *  tiling: a mismatch rejects the whole paste (the caller writes nothing). Pure. */
export function shapesMatch(
  a: { rows: number; cols: number },
  b: { rows: number; cols: number },
): boolean {
  return a.rows === b.rows && a.cols === b.cols;
}

// ── Paste/fill target classification ─────────────────────────────────────────────────
/** The verdict for writing one clipboard cell into one target cell. */
export type PasteVerdict =
  | "WRITE"
  | "SKIP_CROSS_KIND"
  | "SKIP_NON_PRICEABLE"
  | "SKIP_NOT_COSTABLE";

/**
 * Classify a single paste/fill target. PURE -- the caller resolves `isWritable` from the
 * concrete (row, descriptor, override) via the existing `isRateDescriptor(d) &&
 * isRateEditableRow(row, override)` (kept in PricingGrid so this module stays a type-only leaf).
 *   - kind mismatch (rate clipboard onto a non-rate target, or vice-versa) -> SKIP_CROSS_KIND;
 *   - rate -> rate but the target is not editable (non-priceable / formula gate) -> SKIP_NON_PRICEABLE;
 *   - bcs -> bcs but the target cannot be costed (locked / BCS not set up) -> SKIP_NOT_COSTABLE;
 *   - otherwise -> WRITE. Remark -> remark is always WRITE (remark editability is the presence
 *     of the save callback, gated upstream by the caller before any write fires).
 *
 * ⚠️ THE TWO SKIPS ARE NOT INTERCHANGEABLE. A cost box is refused by the BCS gates, which
 * `bcs.py:41-59` keeps DELIBERATELY independent of priceability -- so reporting a skipped cost
 * cell as "not priceable" would name a gate that had nothing to do with it, and send the reader
 * to fix a rule that is not in force.
 */
export function classifyPasteTarget(
  clipKind: ClipKind,
  targetKind: CellKind,
  isWritable: boolean,
): PasteVerdict {
  if (clipKind !== targetKind) return "SKIP_CROSS_KIND";
  if (clipKind === "rate") return isWritable ? "WRITE" : "SKIP_NON_PRICEABLE";
  if (clipKind === "bcs") return isWritable ? "WRITE" : "SKIP_NOT_COSTABLE";
  return "WRITE";
}

/**
 * ★ N COST CELLS -> ONE WHOLE-ROW SAVE PER ROW.
 *
 * `save_row_bcs_rates` is a whole-row snapshot write that zeroes any rate it is not given, so a
 * paste spanning two cost columns must NOT fire twice for the same row -- the second call would
 * overwrite the first with a 0 for the column the first had just written. This folds a gesture's
 * per-CELL intents into one write per ROW, each starting from that row's own current
 * draft-or-saved triple (`baseline`, supplied by the caller as `gatherBcsRowRates` over its live
 * state) so untouched siblings survive.
 *
 * Order is FIRST-TOUCHED, and a later entry for the same field wins -- so a fill-down that
 * passes over its own source row still ends on the intended value.
 */
export function foldBcsWrites(
  entries: readonly {
    excelRow: number;
    field: BcsRateField;
    value: number;
    description?: string;
  }[],
  baseline: (excelRow: number) => BcsRowRates,
): { kind: "bcs"; args: BcsRowSaveArgs }[] {
  const byRow = new Map<number, BcsRowSaveArgs>();
  for (const e of entries) {
    let args = byRow.get(e.excelRow);
    if (!args) {
      args = { excelRow: e.excelRow, rates: { ...baseline(e.excelRow) } };
      if (e.description !== undefined) args.description = e.description;
      byRow.set(e.excelRow, args);
    }
    args.rates[e.field] = e.value;
  }
  return [...byRow.values()].map((args) => ({ kind: "bcs" as const, args }));
}

// ── Batch write contract (the Q5 finding -- ONE trailing mutate) ───────────────────────
/**
 * One write in a clipboard batch. DELIBERATELY delta-friendly (carries the resolved cell
 * identity + the new value) so a later Slice-B undo wrapper can record {cell, kind, old, new}
 * by routing through the SAME single place -- not by scattering raw save calls.
 */
export type BatchWrite =
  | { kind: "rate"; cell: RateCellSaveArgs; rate: number }
  | { kind: "remark"; args: RemarkSaveArgs }
  // BCS-S3a: ONE per ROW (never per cell) -- see foldBcsWrites on why that is load-bearing.
  | { kind: "bcs"; args: BcsRowSaveArgs };

/** The result of a clipboard batch: how many writes landed + how many failed (mixed outcome
 *  is valid -- the page does ONE trailing mutate() regardless, never fakes atomicity). */
export interface BatchOutcome {
  written: number;
  failed: number;
}
