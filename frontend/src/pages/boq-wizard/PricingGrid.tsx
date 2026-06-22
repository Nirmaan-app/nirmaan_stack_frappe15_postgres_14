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
import { Palette, MessageSquare } from "lucide-react";
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
import type {
  AmountFormulaSaveArgs,
  ColorSaveArgs,
  ColumnDescriptor,
  ColumnFormula,
  LockInfo,
  PricedRow,
  RateCellSaveArgs,
  RemarkSaveArgs,
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
}

/** Slice 3c: imperative handle the page holds (via a ref) to force-flush pending saves. */
export interface PricingGridHandle {
  /** Fire all pending debounced saves now + retry any remaining uncommitted draft. */
  flush: () => void;
  /** Slice 4a: scroll a row into view by its Excel row number (the review-list jump). */
  scrollToRow: (excelRow: number) => void;
}

export const PricingGrid = forwardRef<PricingGridHandle, PricingGridProps>(function PricingGrid(
  { rows, columnDescriptors, onSaveRate, onDirtyChange, override = false, onSaveRemark, onSaveColor, columnFormulas = [], onSaveFormula },
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
  };

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
  // Slice 4a.2: the trailing Remarks column is now the matrix's LAST column. Its colIndex is
  // FIXED_ANCHOR_COUNT + displayDescriptors.length (just past the descriptors), and colCount
  // includes it (+1). The +1 only widens nextCell's right/Tab boundary so arrows/Tab reach
  // the remarks cell; no other colIndex math reads colCount (descriptor cells use
  // FIXED_ANCHOR_COUNT + dIdx; anchors use 0..4).
  const remarksColIndex = FIXED_ANCHOR_COUNT + displayDescriptors.length;
  const colCount = remarksColIndex + 1;
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
                  className="px-2 py-2 text-right font-medium text-muted-foreground w-28 min-w-[112px] border-l border-border whitespace-nowrap sticky top-0 z-20 bg-muted align-top"
                >
                  <span>{label}</span>
                  {/* Formula Builder F3: the per-column `f = ...` label + click-to-edit builder,
                      on AMOUNT columns only. Read-only when onSaveFormula is withheld (locked).
                      The amount-cell VALUE render is UNCHANGED (F4 owns the compute swap). */}
                  {isAmountDescriptor(d) && (
                    <AmountFormulaBuilder
                      target={d}
                      columnLabel={label}
                      descriptors={columnDescriptors}
                      columnFormulas={columnFormulas}
                      onSave={onSaveFormula}
                    />
                  )}
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
                  // ── Slice 4a: per-cell color (the SEPARATE left-border channel) + the
                  //    picker trigger (editable only when onSaveColor is present). The applied
                  //    color is a left border so it never masks the system emerald/amber
                  //    priced background, the dot, or the blue inset focus ring -- all coexist.
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
                  // Slice 3e per-row priceability gate: editable ONLY on a priceable row
                  // (node_type Preamble / Line Item) UNLESS the per-sheet override is on. A
                  // non-priceable row with the override off falls through to the read-only
                  // render below (where its needs-review marker still shows).
                  if (
                    onSaveRate &&
                    isRateDescriptor(d) &&
                    (isPriceableType(row.node_type) || override)
                  ) {
                    const key = cellKey(row.row_index, d.col);
                    const priced = isCellPriced(row, d);
                    // A priced cell on a NON-priceable row is the "needs review" anomaly
                    // (override-priced) -> amber instead of emerald (lightweight 3e marker;
                    // the full review flag is 4b).
                    const needsReview = priced && !isPriceableType(row.node_type);
                    // Value precedence: user draft (highest) -> cross-area proposal
                    // (middle) -> saved/empty (lowest).
                    const draft = draftRates[key];
                    const proposed = proposedRates[key];
                    const value = draft ?? proposed ?? savedRateStr(row, d);
                    // A cell renders "proposed" (muted/italic) only when the displayed
                    // value is the proposal -- no user draft and not priced.
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
                          isActive(rowIdx, colIndex) &&
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
                                // Promotion: touching a proposed cell turns it into a real
                                // draft -> drop the proposal so it stops rendering proposed
                                // and the normal save path (auto-save + emerald-on-save)
                                // takes over.
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
                          "relative px-2 py-1.5 text-right align-top tabular-nums",
                          colorBorderClass,
                          cellNavClass(rowIdx, colIndex),
                        )}
                      >
                        {colorPicker}
                        {amountVal !== null
                          ? renderDescriptorCell(amountVal)
                          : renderDescriptorCell(resolveDescriptorValue(row, d))}
                      </td>
                    );
                  }

                  // ── Default read-only cell (qty / others; rate when no onSaveRate, OR a
                  //    non-priceable rate cell with the override off) ────────────────────
                  const val = resolveDescriptorValue(row, d);
                  const priced = isRateDescriptor(d) && isCellPriced(row, d);
                  // A priced non-priceable rate cell that lands here (override off) still
                  // shows the amber needs-review marker -- the anomaly stays visible.
                  const needsReview = priced && !isPriceableType(row.node_type);
                  return (
                    <td
                      key={d.col}
                      {...tdFocusProps(rowIdx, colIndex)}
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
                        cellNavClass(rowIdx, colIndex),
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
                {/* Slice 4a.2: trailing Remarks cell (per-row) -- now the matrix's LAST
                    column. The <td> is the nav focus target (arrows land here); Enter opens
                    the editor (handled in handleGridKeyDown), Esc/Save close + restore focus
                    here, Enter-in-editor saves + moves down. Open-state is grid-controlled. */}
                <td
                  {...tdFocusProps(rowIdx, remarksColIndex)}
                  className={cn(
                    "px-2 py-1.5 align-top border-l border-border w-48 min-w-[160px]",
                    cellNavClass(rowIdx, remarksColIndex),
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
                    open={openRemarkRowIdx === rowIdx}
                    onOpenChange={(o) => {
                      setOpenRemarkRowIdx(o ? rowIdx : null);
                      // On close (Esc / Save / outside-click) restore focus to this cell so
                      // arrow-nav continues. An Enter-save's onMoveDown runs AFTER and wins.
                      if (!o) focusCell(rowIdx, remarksColIndex);
                    }}
                    onMoveDown={() => {
                      const next = nextCell(
                        { rowIndex: rowIdx, colIndex: remarksColIndex },
                        "down",
                        rows.length,
                        colCount,
                      );
                      if (next) focusCell(next.rowIndex, next.colIndex);
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

PricingGrid.displayName = "PricingGrid";
