/**
 * qtyNav -- PURE cell-to-cell navigation for the template review screen's quantity columns.
 *
 * The template review phase's ONLY editable surface is quantity (single-area = one Total cell
 * per row; multi-area = the per-area cells, whose Total is a read-only running sum). This
 * module is the movement rule for walking that surface from the keyboard, modelled on
 * PricingGrid's `nextCell` and unit-tested the same way (ADR-0010 F4).
 *
 * TWO DELIBERATE DIFFERENCES from PricingGrid's version:
 *
 *   1. NO left/right. A quantity cell is a numeric <input>; ArrowLeft/ArrowRight belong to the
 *      caret, and hijacking them would break in-cell editing. Horizontal movement is Tab's job.
 *   2. RAGGED rows. PricingGrid navigates a rectangular matrix (rowCount x colCount); here a
 *      row's cell count is whatever that row actually rendered (column-visibility differences),
 *      so vertical moves CLAMP into the target row rather than assuming a uniform width.
 *
 * Coordinates are indices INTO the matrix, never DOM or data identities -- the caller resolves
 * a coordinate back to an element through its own registry. Edges STOP (no wrap) for arrows;
 * Tab wraps across rows and returns null at the very ends so focus stays inside the grid.
 */

/** One navigable row: its ReviewRow.row_index plus the ordered column letters it rendered a
 *  quantity input for. A row with no editable qty cell is simply absent from the matrix. */
export interface QtyNavRow {
  rowIndex: number;
  cols: string[];
}

export type QtyNavMatrix = QtyNavRow[];

/** A position in the matrix: `row` indexes the matrix, `col` indexes that row's `cols`. */
export interface QtyNavCoord {
  row: number;
  col: number;
}

export type QtyNavDirection = "up" | "down" | "tab" | "shift-tab";

/** Map a keyboard event to a direction, or null when the key is not ours to handle.
 *  Enter maps to "down" (commit-and-advance, the spreadsheet convention). */
export function qtyNavDirectionFor(
  e: { key: string; shiftKey?: boolean },
): QtyNavDirection | null {
  if (e.key === "ArrowUp") return "up";
  if (e.key === "ArrowDown" || e.key === "Enter") return "down";
  if (e.key === "Tab") return e.shiftKey ? "shift-tab" : "tab";
  return null;
}

/** Clamp a column index into a row that may be narrower than the one we came from. */
function clampCol(matrix: QtyNavMatrix, row: number, col: number): number {
  const width = matrix[row].cols.length;
  return Math.min(col, width - 1);
}

/**
 * The next cell for a nav direction, or null when the move has nowhere to go (arrows at an
 * edge, Tab off the last cell, Shift-Tab off the first) -- the caller then leaves focus put,
 * which is what keeps Tab from escaping the grid entirely.
 *
 * Rows with zero cols are skipped on vertical moves rather than swallowing the keystroke.
 */
export function nextQtyCell(
  active: QtyNavCoord,
  dir: QtyNavDirection,
  matrix: QtyNavMatrix,
): QtyNavCoord | null {
  const { row, col } = active;
  if (row < 0 || row >= matrix.length) return null;

  switch (dir) {
    case "up": {
      for (let r = row - 1; r >= 0; r--) {
        if (matrix[r].cols.length > 0) return { row: r, col: clampCol(matrix, r, col) };
      }
      return null;
    }
    case "down": {
      for (let r = row + 1; r < matrix.length; r++) {
        if (matrix[r].cols.length > 0) return { row: r, col: clampCol(matrix, r, col) };
      }
      return null;
    }
    case "tab": {
      if (col < matrix[row].cols.length - 1) return { row, col: col + 1 };
      for (let r = row + 1; r < matrix.length; r++) {
        if (matrix[r].cols.length > 0) return { row: r, col: 0 };
      }
      return null; // last cell of the last row -> stop (contain focus)
    }
    case "shift-tab": {
      if (col > 0) return { row, col: col - 1 };
      for (let r = row - 1; r >= 0; r--) {
        if (matrix[r].cols.length > 0) return { row: r, col: matrix[r].cols.length - 1 };
      }
      return null; // first cell of the first row -> stop (contain focus)
    }
    default:
      return null;
  }
}

/** The registry key for one quantity input. Mirrors PricingGrid's `cellKey` shape so the two
 *  grids read alike; the row half is the DURABLE ReviewRow.row_index, never an array position
 *  (collapse / filter reshuffles the rendered order, and an index key would then mis-target). */
export function qtyCellKey(rowIndex: number, col: string): string {
  return `${rowIndex}:${col}`;
}

/** Resolve a matrix coordinate to its registry key, or null if out of range. */
export function qtyCellKeyAt(matrix: QtyNavMatrix, coord: QtyNavCoord): string | null {
  const r = matrix[coord.row];
  if (!r) return null;
  const col = r.cols[coord.col];
  if (col === undefined) return null;
  return qtyCellKey(r.rowIndex, col);
}

/** Locate a (row_index, col) pair in the matrix -- the inverse of qtyCellKeyAt, used to turn
 *  the focused input's own identity back into a coordinate. Null when it is not navigable. */
export function findQtyCoord(
  matrix: QtyNavMatrix,
  rowIndex: number,
  col: string,
): QtyNavCoord | null {
  for (let r = 0; r < matrix.length; r++) {
    if (matrix[r].rowIndex !== rowIndex) continue;
    const c = matrix[r].cols.indexOf(col);
    return c === -1 ? null : { row: r, col: c };
  }
  return null;
}
