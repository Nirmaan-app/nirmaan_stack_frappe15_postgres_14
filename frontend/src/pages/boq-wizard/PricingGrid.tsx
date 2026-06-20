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
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { debounce, type DebouncedFunc } from "lodash";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  ClassificationPill,
  computeDepths,
  renderDescriptorCell,
  resolveDescriptorValue,
} from "./reviewRender";
import { ROLE_LABELS } from "./boqTypes";
import type { ColumnDescriptor, PricedRow, RateCellSaveArgs } from "./boqTypes";

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

/** amount = qty x rate. Returns null if either operand is missing. Pure -- unit-tested. */
export function computeAmount(
  qty: number | null | undefined,
  rate: number | null | undefined,
): number | null {
  if (qty === null || qty === undefined || rate === null || rate === undefined) return null;
  return qty * rate;
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
   * RESERVED for the future single-editor-lock slice. INERT here -- the grid does NOT gate
   * editing on these (the lock is a later slice). NOT destructured.
   */
  editable?: boolean;
  lockInfo?: unknown;
}

/** Slice 3c: imperative handle the page holds (via a ref) to force-flush pending saves. */
export interface PricingGridHandle {
  /** Fire all pending debounced saves now + retry any remaining uncommitted draft. */
  flush: () => void;
}

export const PricingGrid = forwardRef<PricingGridHandle, PricingGridProps>(function PricingGrid(
  { rows, columnDescriptors, onSaveRate, onDirtyChange },
  ref,
) {
  // Optimistic per-rate-cell drafts (this session), keyed `${row_index}:${col}`. A draft
  // shows instantly (live amount) until the save's refetch lands, then it is dropped so the
  // cell falls back to the refetched saved rate.
  const [draftRates, setDraftRates] = useState<Record<string, string>>({});
  // Dedupe blur + Enter committing the SAME value (and an in-flight re-commit).
  const committedAttemptRef = useRef<Record<string, string>>({});

  // Slice 3b.2 -- spreadsheet keyboard nav. The active cell {rowIndex (array index into
  // rows), colIndex} is null until the user clicks / tabs in. Roving-tabindex: the active
  // cell (or (0,0) before any focus) is the single tab stop; arrows/Enter/Tab move it.
  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  // Per-cell focusable element, keyed `${rowIndex}:${colIndex}` -- the <input> for a rate
  // cell, the <td> for every other cell. Used to .focus() the target on a keyboard move.
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Slice 3c -- auto-save plumbing. Per-cell 1000ms debounced commit, keyed by cellKey.
  const debouncersRef = useRef<Map<string, DebouncedFunc<() => void>>>(new Map());
  // Latest draftRates + a latest-state "commit one cell" fn, so a debounced fire / flush
  // reads CURRENT state at fire time (a captured value would be stale). Synced each render.
  const draftRatesRef = useRef<Record<string, string>>({});
  const autoSaveCellRef = useRef<(rowIndexField: number, col: string) => void>(() => {});

  // row_index -> row, for resolving a parent's Excel row number.
  const byIdx = new Map<number, PricedRow>(rows.map((r) => [r.row_index, r]));
  // Effective depth per row (reused helper -- single source of truth with the review tree).
  const depths = computeDepths(rows);

  // Descriptor-driven columns: everything except the sl_no / description anchors.
  const displayDescriptors = columnDescriptors.filter((d) => !FIXED_ROLE_DEDUPE.has(d.role));
  const slNoLetter = columnDescriptors.find((d) => d.role === "sl_no")?.col ?? null;
  const descriptionLetter = columnDescriptors.find((d) => d.role === "description")?.col ?? null;

  // Precompute each amount column's paired rate descriptor (column-level, row-independent),
  // so a live amount can be derived from the paired rate's draft / saved value.
  const pairedRateByAmountCol = new Map<string, ColumnDescriptor>();
  for (const d of displayDescriptors) {
    if (isAmountDescriptor(d)) {
      const rateD = findPairedRateDescriptor(d, displayDescriptors);
      if (rateD) pairedRateByAmountCol.set(d.col, rateD);
    }
  }

  const cellKey = (rowIndex: number, col: string) => `${rowIndex}:${col}`;
  const savedRateStr = (row: PricedRow, d: ColumnDescriptor): string => {
    const v = resolveDescriptorValue(row, d);
    return v === null || v === undefined ? "" : String(v);
  };

  // Commit a rate cell (blur / Enter). No-op when unchanged or a duplicate of the last
  // attempt (blur+Enter). Blank/NaN -> 0 (the endpoint coerces blank -> 0.0, still priced).
  const commitRate = (row: PricedRow, d: ColumnDescriptor, rawValue: string) => {
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
      })
      .catch(() => {
        // Failure: keep the draft (the user sees what they typed; the page shows the error).
        // Clear the dedupe so a retry of the same value is allowed.
        delete committedAttemptRef.current[key];
      });
  };

  // Slice 3c: keep the latest-state commit closure + draft snapshot fresh for the
  // debounce/flush (refs avoid stale captures). Runs after every render.
  useEffect(() => {
    draftRatesRef.current = draftRates;
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
  const scheduleAutoSave = (row: PricedRow, d: ColumnDescriptor) => {
    if (!onSaveRate) return;
    const key = cellKey(row.row_index, d.col);
    let deb = debouncersRef.current.get(key);
    if (!deb) {
      deb = debounce(() => autoSaveCellRef.current(row.row_index, d.col), AUTOSAVE_MS);
      debouncersRef.current.set(key, deb);
    }
    deb();
  };

  // ── Slice 3b.2 nav model ───────────────────────────────────────────────────
  const colCount = FIXED_ANCHOR_COUNT + displayDescriptors.length;
  const navKey = (r: number, c: number) => `${r}:${c}`;

  const registerCell = (r: number, c: number, el: HTMLElement | null) => {
    if (el) cellRefs.current.set(navKey(r, c), el);
    else cellRefs.current.delete(navKey(r, c));
  };

  const isActive = (r: number, c: number) =>
    activeCell !== null && activeCell.rowIndex === r && activeCell.colIndex === c;
  // Roving tabindex: the active cell is the single tab stop; before any focus, (0,0) is the
  // entry point so the grid is reachable by Tab from the page.
  const isTabStop = (r: number, c: number) =>
    activeCell !== null ? isActive(r, c) : r === 0 && c === 0;

  // Shared per-cell nav className: focus ring on the active cell + a scroll-margin so a
  // cell scrolled to the top clears the sticky header (no frozen-left to handle).
  const cellNavClass = (r: number, c: number) =>
    cn("scroll-mt-9 outline-none", isActive(r, c) && "ring-2 ring-inset ring-blue-500 dark:ring-blue-400");
  // Focus props for a <td>-focusable cell (every cell except a rate input).
  const tdFocusProps = (r: number, c: number) => ({
    tabIndex: isTabStop(r, c) ? 0 : -1,
    onFocus: () => setActiveCell({ rowIndex: r, colIndex: c }),
    ref: (el: HTMLTableCellElement | null) => registerCell(r, c, el),
  });
  // Focus props for a rate cell's <input> (the focus target for an editable cell).
  const inputFocusProps = (r: number, c: number) => ({
    tabIndex: isTabStop(r, c) ? 0 : -1,
    onFocus: () => setActiveCell({ rowIndex: r, colIndex: c }),
    ref: (el: HTMLInputElement | null) => registerCell(r, c, el),
  });

  const focusCell = (r: number, c: number) => {
    const el = cellRefs.current.get(navKey(r, c));
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

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
    <div className="rounded-md border border-border overflow-auto max-h-[calc(100vh-14rem)]">
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
              return (
                <th
                  key={d.col}
                  className="px-2 py-2 text-right font-medium text-muted-foreground w-28 min-w-[112px] border-l border-border whitespace-nowrap sticky top-0 z-20 bg-muted"
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => {
            const depth = depths.get(row.row_index) ?? 0;
            const isPreamble = row.effective_classification === "preamble";
            const isLineItem = row.effective_classification === "line_item";
            const pIdx = row.effective_parent_index ?? -1;
            const parentExcelRow =
              pIdx >= 0 ? (byIdx.get(pIdx)?.source_row_number ?? null) : null;

            return (
              <tr key={row.row_index} className="border-b border-border hover:bg-muted/30">
                {/* Excel Row (col 0) */}
                <td
                  {...tdFocusProps(rowIdx, 0)}
                  className={cn(
                    "px-2 py-1.5 text-muted-foreground align-top w-16 border-r border-border tabular-nums",
                    cellNavClass(rowIdx, 0),
                  )}
                >
                  {row.source_row_number}
                </td>
                {/* Sl.No (col 1) */}
                <td
                  {...tdFocusProps(rowIdx, 1)}
                  className={cn(
                    "px-2 py-1.5 text-muted-foreground align-top w-16 border-r border-border",
                    cellNavClass(rowIdx, 1),
                  )}
                >
                  {row.sl_no_value ?? ""}
                </td>
                {/* Parent (col 2): parent's Excel row number (muted; read-only -- focus only). */}
                <td
                  {...tdFocusProps(rowIdx, 2)}
                  className={cn(
                    "px-2 py-1.5 align-top w-16 border-r border-border",
                    cellNavClass(rowIdx, 2),
                  )}
                >
                  {parentExcelRow !== null ? (
                    <span className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">
                      ↑ {parentExcelRow}
                    </span>
                  ) : null}
                </td>
                {/* Classification pill (col 3) (read-only -- no chevron / reclassify). */}
                <td
                  {...tdFocusProps(rowIdx, 3)}
                  className={cn(
                    "px-2 py-1.5 align-top w-36 border-r border-border",
                    cellNavClass(rowIdx, 3),
                  )}
                >
                  <ClassificationPill cls={row.effective_classification} />
                </td>
                {/* Description (col 4): depth indent + per-classification styling. */}
                <td
                  {...tdFocusProps(rowIdx, 4)}
                  className={cn("px-2 py-1.5 align-top", cellNavClass(rowIdx, 4))}
                >
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
                {/* Descriptor-driven data cells: editable rate inputs, live-amount cells,
                    and read-only qty/other cells. */}
                {displayDescriptors.map((d, dIdx) => {
                  const colIndex = FIXED_ANCHOR_COUNT + dIdx;
                  // ── RATE cell: editable <Input>; focus target = the input (col-uniform). ──
                  if (onSaveRate && isRateDescriptor(d)) {
                    const key = cellKey(row.row_index, d.col);
                    const value = draftRates[key] ?? savedRateStr(row, d);
                    const priced = isCellPriced(row, d);
                    return (
                      <td
                        key={d.col}
                        title={priced ? "Priced" : undefined}
                        className={cn(
                          "px-1 py-1 align-top border-l border-border",
                          priced && "bg-emerald-50 dark:bg-emerald-950/30",
                          isActive(rowIdx, colIndex) &&
                            "ring-2 ring-inset ring-blue-500 dark:ring-blue-400",
                        )}
                      >
                        <div className="flex items-center justify-end gap-1">
                          {priced && (
                            <span
                              aria-hidden
                              className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0"
                            />
                          )}
                          {/* type=text + inputMode=decimal: frees Arrow keys for cell nav
                              (a number input hijacks them). Decimal guard in onChange keeps
                              the value numeric. Nav keys (arrows/Enter/Tab) bubble to the
                              table's onKeyDown; onBlur stays as the commit safety net. */}
                          <Input
                            {...inputFocusProps(rowIdx, colIndex)}
                            type="text"
                            inputMode="decimal"
                            value={value}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (DECIMAL_IN_PROGRESS.test(v)) {
                                setDraftRates((prev) => ({ ...prev, [key]: v }));
                                scheduleAutoSave(row, d); // Slice 3c: debounced 1s auto-save
                              }
                            }}
                            onBlur={() => commitRate(row, d, value)}
                            className="h-7 text-xs w-20 text-right tabular-nums scroll-mt-9"
                          />
                        </div>
                      </td>
                    );
                  }

                  // ── AMOUNT cell: live qty x rate (display-only), else committed value ──
                  if (isAmountDescriptor(d)) {
                    const rateD = pairedRateByAmountCol.get(d.col);
                    let amountVal: number | null = null;
                    if (rateD) {
                      const area = d.value_field === PER_AREA_AMOUNT_FIELD ? d.value_key : null;
                      const qty =
                        area !== null && area !== undefined
                          ? (row.qty_by_area?.[area] ?? null)
                          : (row.qty_total ?? null);
                      const draft = draftRates[cellKey(row.row_index, rateD.col)];
                      let effRate: number | null = null;
                      if (draft !== undefined) {
                        // Editing now -> optimistic amount from the typed rate (blank -> 0).
                        const n = parseFloat(draft);
                        effRate = Number.isFinite(n) ? n : 0;
                      } else if (isCellPriced(row, rateD)) {
                        // Not editing but priced -> amount from the saved rate (no refetch flash).
                        const sv = resolveDescriptorValue(row, rateD);
                        effRate = typeof sv === "number" ? sv : null;
                      }
                      // else: un-priced + not editing -> leave amountVal null (committed value).
                      if (effRate !== null) amountVal = computeAmount(qty, effRate);
                    }
                    return (
                      <td
                        key={d.col}
                        {...tdFocusProps(rowIdx, colIndex)}
                        className={cn(
                          "px-2 py-1.5 text-right align-top border-l border-border tabular-nums",
                          cellNavClass(rowIdx, colIndex),
                        )}
                      >
                        {amountVal !== null
                          ? renderDescriptorCell(amountVal)
                          : renderDescriptorCell(resolveDescriptorValue(row, d))}
                      </td>
                    );
                  }

                  // ── Default read-only cell (qty / others; rate when no onSaveRate) ───
                  const val = resolveDescriptorValue(row, d);
                  const priced = isRateDescriptor(d) && isCellPriced(row, d);
                  return (
                    <td
                      key={d.col}
                      {...tdFocusProps(rowIdx, colIndex)}
                      title={priced ? "Priced" : undefined}
                      className={cn(
                        "px-2 py-1.5 text-right align-top border-l border-border tabular-nums",
                        priced && "bg-emerald-50 dark:bg-emerald-950/30",
                        cellNavClass(rowIdx, colIndex),
                      )}
                    >
                      {priced && (
                        <span
                          aria-hidden
                          className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle"
                        />
                      )}
                      {renderDescriptorCell(val)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

PricingGrid.displayName = "PricingGrid";
