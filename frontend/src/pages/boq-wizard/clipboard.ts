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
import type { RateCellSaveArgs, RemarkSaveArgs } from "./boqTypes";

// ── Kinds ────────────────────────────────────────────────────────────────────────
/** The two copyable cell kinds. A clipboard cell is always one of these (or a SKIP hole). */
export type ClipKind = "rate" | "remark";
/** A target cell's kind. "other" = an anchor / amount / qty cell (never a clipboard target). */
export type CellKind = "rate" | "remark" | "other";

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
export type PasteVerdict = "WRITE" | "SKIP_CROSS_KIND" | "SKIP_NON_PRICEABLE";

/**
 * Classify a single paste/fill target. PURE -- the caller resolves `isRateWritable` from the
 * concrete (row, descriptor, override) via the existing `isRateDescriptor(d) &&
 * isRateEditableRow(row, override)` (kept in PricingGrid so this module stays a type-only leaf).
 *   - kind mismatch (rate clipboard onto a non-rate target, or vice-versa) -> SKIP_CROSS_KIND;
 *   - rate -> rate but the target is not editable (non-priceable / formula gate) -> SKIP_NON_PRICEABLE;
 *   - otherwise -> WRITE. Remark -> remark is always WRITE (remark editability is the presence
 *     of the save callback, gated upstream by the caller before any write fires).
 */
export function classifyPasteTarget(
  clipKind: ClipKind,
  targetKind: CellKind,
  isRateWritable: boolean,
): PasteVerdict {
  if (clipKind !== targetKind) return "SKIP_CROSS_KIND";
  if (clipKind === "rate") return isRateWritable ? "WRITE" : "SKIP_NON_PRICEABLE";
  return "WRITE";
}

// ── Batch write contract (the Q5 finding -- ONE trailing mutate) ───────────────────────
/**
 * One write in a clipboard batch. DELIBERATELY delta-friendly (carries the resolved cell
 * identity + the new value) so a later Slice-B undo wrapper can record {cell, kind, old, new}
 * by routing through the SAME single place -- not by scattering raw save calls.
 */
export type BatchWrite =
  | { kind: "rate"; cell: RateCellSaveArgs; rate: number }
  | { kind: "remark"; args: RemarkSaveArgs };

/** The result of a clipboard batch: how many writes landed + how many failed (mixed outcome
 *  is valid -- the page does ONE trailing mutate() regardless, never fakes atomicity). */
export interface BatchOutcome {
  written: number;
  failed: number;
}
