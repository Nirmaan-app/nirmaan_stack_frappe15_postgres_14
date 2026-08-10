/**
 * undoHistory.ts -- PURE leaf for the pricing-grid session undo/redo (BoQ Phase 5, Slice B).
 *
 * A delta-based, session-only, bounded ring buffer (mirrors clipboard.ts -- imports ONLY types,
 * so no runtime cycle even though PricingGrid imports these values back). The React side supplies
 * the concrete cells; this module owns the stack arithmetic (push / pop / cap / invert) and the
 * ONE-GESTURE-ONE-ENTRY invariant: a fill-down of 80 rows is ONE undo entry, not 80.
 *
 * SCOPE: RATE and BCS COST deltas (remark / colour / reconciliation / lock / version-switch are
 * NOT undoable -- a mixed gesture records only those two). Session-only, in-memory; the grid
 * clears history for free on the sheet/version remount.
 *
 * BCS-S3a widened the scope by owner ruling (2026-08-02): "a cost box you cannot paste into or
 * undo, one column from a rate box where both work, is the asymmetry people trip over". One
 * gesture can touch both layers, so ONE entry carries both lists and inverts them together --
 * splitting them into two stacks would let a single Ctrl+Z undo half of one action.
 */
import type { BcsRateField, RateCellSaveArgs } from "./boqTypes";

/** Depth of the undo ring buffer (oldest entries drop past this on a new push). */
export const HISTORY_MAX = 50;

/**
 * One rate change inside a gesture. `cell` is the resolved save-args (replayable VERBATIM through
 * the same save_cell_price path); `draftKey` is cellKey(row.row_index, d.col) for the optimistic
 * draft layer; oldRate/newRate are the numeric rates BEFORE/AFTER the gesture (replay writes one
 * or the other depending on direction).
 */
export interface RateDelta {
  cell: RateCellSaveArgs;
  draftKey: string;
  oldRate: number;
  newRate: number;
}

/**
 * One BCS cost change inside a gesture (BCS-S3a). Addressed by the row's EXCEL row + the stored
 * FIELD, because BCS identity is per-row with no col_letter at all; `draftKey` is the grid's
 * optimistic key for that box. old/new are the numeric values BEFORE/AFTER.
 *
 * ⚠️ A delta is still per-FIELD, not per-row, even though the WRITE is per-row: two boxes of one
 * row changed in one gesture are two deltas that the replay folds back into one save
 * (`clipboard.foldBcsWrites`). Recording them folded would lose which box the user actually
 * touched, and an undo would then overwrite a sibling the gesture never wrote.
 */
export interface BcsDelta {
  excelRow: number;
  field: BcsRateField;
  draftKey: string;
  oldValue: number;
  newValue: number;
  /** row.description -- carried so a replay can send the same save args (optional). */
  description?: string;
}

/** One user gesture = its rate deltas and/or its BCS cost deltas (single-cell edit = 1;
 *  paste/fill/cut = N). `bcsDeltas` is ABSENT on a rate-only gesture -- never an empty array --
 *  so a pre-S3a entry's shape is byte-unchanged. */
export interface HistoryEntry {
  deltas: RateDelta[];
  bcsDeltas?: BcsDelta[];
}

/** The two stacks. `undo` is past gestures (newest last); `redo` is undone gestures. */
export interface HistoryState {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

/** A fresh empty history. */
export function emptyHistory(): HistoryState {
  return { undo: [], redo: [] };
}

export function canUndo(state: HistoryState): boolean {
  return state.undo.length > 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.redo.length > 0;
}

/**
 * Push a NEW gesture entry: append to `undo` (drop the oldest past `max`), and CLEAR `redo`
 * (a fresh edit invalidates the redo branch -- the standard editor model). An entry with NO
 * deltas (a gesture that wrote nothing / fully failed) is a no-op: the state is returned
 * unchanged so an empty gesture never occupies a slot. Pure -- returns a NEW state.
 */
export function pushEntry(state: HistoryState, entry: HistoryEntry, max = HISTORY_MAX): HistoryState {
  // "Wrote nothing" now means BOTH lists are empty -- a cost-only gesture is a real gesture.
  if (entry.deltas.length === 0 && (entry.bcsDeltas?.length ?? 0) === 0) return state;
  const undo = [...state.undo, entry];
  if (undo.length > max) undo.splice(0, undo.length - max); // drop oldest to fit the ring
  return { undo, redo: [] };
}

/**
 * Remove the top of `undo` (the most recent gesture) without touching `redo`. Returns the popped
 * entry + the reduced state, or null when `undo` is empty. The caller replays it (inverted) and
 * cross-pushes it onto `redo`. Pure.
 */
export function popUndo(state: HistoryState): { entry: HistoryEntry; state: HistoryState } | null {
  if (state.undo.length === 0) return null;
  return {
    entry: state.undo[state.undo.length - 1],
    state: { undo: state.undo.slice(0, -1), redo: state.redo },
  };
}

/**
 * Remove the top of `redo` without touching `undo`. Returns the popped entry + reduced state, or
 * null when `redo` is empty. The caller replays it as-is and cross-pushes it back onto `undo`. Pure.
 */
export function popRedo(state: HistoryState): { entry: HistoryEntry; state: HistoryState } | null {
  if (state.redo.length === 0) return null;
  return {
    entry: state.redo[state.redo.length - 1],
    state: { undo: state.undo, redo: state.redo.slice(0, -1) },
  };
}

/**
 * Swap old<->new on every delta -- the replay direction for an UNDO (write the OLD rate). Returns
 * a NEW entry (input untouched), so the canonical {old,new} entry can still be re-pushed for redo.
 * Pure -- unit-tested.
 */
export function invert(entry: HistoryEntry): HistoryEntry {
  const out: HistoryEntry = {
    deltas: entry.deltas.map((d) => ({ ...d, oldRate: d.newRate, newRate: d.oldRate })),
  };
  // Only when there ARE cost deltas -- a rate-only entry must not grow an empty array, or
  // invert(invert(e)) would stop round-tripping by value.
  if (entry.bcsDeltas) {
    out.bcsDeltas = entry.bcsDeltas.map((d) => ({
      ...d,
      oldValue: d.newValue,
      newValue: d.oldValue,
    }));
  }
  return out;
}
