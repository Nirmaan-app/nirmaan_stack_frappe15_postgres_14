/**
 * ReviewTree -- nesting-tree renderer for parsed BoQ Review Rows (Slice B1).
 *
 * B1.1b-i: column layer replaced with config-driven columns from column_descriptors
 * (B1.1a backend, feat 58d2ed44). Tree mechanic preserved verbatim from B1.
 *
 * B1.1b-fix-B: four display fixes --
 *   FIX 1: Parent column (after Sl.No) -- shows parent's Excel row number; clicking
 *           expands collapsed ancestors, scrolls to the parent row, 1.5s highlight.
 *   FIX 2: Classification pill label no-truncation (aided by FIX 4's layout).
 *   FIX 3: isVisible ancestor-only -- collapsed row stays visible; only descendants hide.
 *   FIX 4: Description cell -- pill on its own line (top), description text below.
 *
 * B2b: five additions --
 *   BUILD 1: Left-gutter expander column (frozen-left, w-8) + inline read-only detail
 *            panel (a new <tr> beneath the data row). Option-B: detail panel and flag
 *            accordion are mutually exclusive (opening one closes the other).
 *   BUILD 2: totalCols 5->6 (new leftmost column).
 *   BUILD 3: Sticky-header fix -- moved from <tr> to individual <th> cells (solid bg,
 *            no bleed-through). Corner cell (expander) gets top+left sticky at z-30.
 *   BUILD 4: ClassificationPill restyle -- soft per-type opaque fill (rounded-full),
 *            left-border accent dropped. CLS_PILL_CLASSES map replaces inline style.
 *   BUILD 5: aria-label "advisory notes" -> "flags".
 *
 * B2c: edit-provenance surfacing (read-only infra) --
 *   BUILD 1: "Status" fixed anchor column after Excel Row -- green "Edited" badge when
 *            edited_at is set or edit_log is non-empty; blank cell otherwise.
 *   BUILD 2: Green row tint (bg-green-50 dark:bg-green-950/30) on edited rows.
 *            Highlight flash (amber) placed after tint in cn() so it wins.
 *   BUILD 3: totalCols 6->7 (new Status column).
 *   BUILD 4: Detail panel edit-focused reshape -- value-field block (qty/rate/amount)
 *            removed; provenance badge colour amber->green; grid simplified to 2-col.
 *   NOTE: all rows render ORIGINAL/blank until Slice C creates edits.
 *
 * Fixed anchor columns (always shown):
 *   Expander      -- caret to open/close inline detail panel (B2b). Frozen-left.
 *   Excel Row      -- source_row_number. Positional; no mapped letter.
 *   Status (B2c)  -- edit-provenance: green "Edited" when edited_at set or edit_log
 *                    non-empty; blank for unedited rows. Not frozen-left.
 *   Sl.No (X)      -- sl_no_value. X = col letter from the sl_no descriptor, if mapped.
 *   Parent         -- parent row's source_row_number (Excel row). Derived; no mapped letter.
 *                     Clickable: expands collapsed ancestors + scrolls to parent row.
 *   Classification -- collapse chevron + ClassificationPill. Flat-left (no depth indent).
 *                     Fixed anchor; not in the column-subset selector. (B1.1b-iii)
 *   Description (Y) -- text only; depth-based indent (paddingLeft = depth * INDENT_PX).
 *                      Y = col letter from the description descriptor, if mapped.
 *
 * Descriptor columns: one per ColumnDescriptor (after FIXED_ROLE_DEDUPE), headed by
 *   "{col} -- {ROLE_LABELS[role]}{ * area}". Descriptors with role "sl_no" or
 *   "description" are excluded (they render as fixed anchors instead).
 *
 * Value resolution per descriptor:
 *   row[value_field]                         -- singleton roles
 *   row[value_field][value_key]              -- qty/amount by area
 *   row[value_field][value_key][rate_subkey] -- rate_*_by_area
 *
 * Absent-vs-zero: undefined/null -> blank cell; 0 -> "0".
 *
 * B1.1b-ii: view-filter controls bar above the table --
 *   FEAT A: Column-subset selector -- Popover + Checkbox per displayDescriptor col.
 *     Fixed anchors (Expander, Excel Row, Sl.No, Parent, Classification, Description) always render.
 *     visibleCols: Set<string> of col letters initialized to all descriptor cols;
 *     synced via useEffect when displayDescriptors changes (new sheet/descriptors).
 *   FEAT B: Three independent annotation-row visibility toggles -- spacer, note,
 *     subtotal_marker -- each boolean, default true (all shown).
 *     classificationVisible(row) composes with isVisible(row): a row renders only
 *     when BOTH pass. Children of hidden annotation rows render at original depth
 *     because computeDepths pre-runs over all rows and classificationVisible never
 *     touches the collapsed Set. View-filter only -- no data edit.
 *
 * B1.1b-iii: Description cell split into Classification + Description columns --
 *   Classification (new fixed anchor, between Parent and Description): holds the
 *     collapse chevron + ClassificationPill side by side, flat-left (no depth indent).
 *     Not in the column-subset selector.
 *   Description (text-only): holds only the description text + fallback; depth-based
 *     indent (paddingLeft = depth * INDENT_PX) applied here. Chevron + pill removed.
 *   Chevron click/collapse/aria/invisible-on-leaf behavior unchanged verbatim.
 */
import { useMemo, useRef, useEffect, useState, Fragment } from "react";
import { ChevronDown, ChevronRight, SlidersHorizontal, Info, MessageSquare } from "lucide-react";
import { useFrappePostCall } from "frappe-react-sdk";
import { cn } from "@/lib/utils";
import type { ReviewRow, ColumnDescriptor, AdvisoryFlag, SaveReviewEditResponse } from "./boqTypes";
import { ROLE_LABELS } from "./boqTypes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ── Depth computation (verbatim from B1) ──────────────────────────────────────
//
// Builds a Map<row_index, depth> for all rows. Root rows (effective_parent_index
// null) get depth 0. Each child is one deeper than its parent.
//
// Algorithm: iterative chain-walk per row, memoized. For each row we walk up
// through effective_parent_index until we hit null (root), a pre-computed depth,
// or a cycle (visited set). Cycle members receive depth 0.
//
// Time: O(n) amortised -- each node is visited once via memoisation.

function computeDepths(rows: ReviewRow[]): Map<number, number> {
  const byIdx = new Map<number, ReviewRow>(rows.map(r => [r.row_index, r]));
  const depths = new Map<number, number>();

  const depthOf = (startIdx: number): number => {
    if (depths.has(startIdx)) return depths.get(startIdx)!;

    // Build the upward chain from startIdx toward the root.
    // chain[0] = startIdx, chain[1] = startIdx's parent, ..., chain[last] = root.
    const chain: number[] = [];
    const seen = new Set<number>();
    let cur: number | null = startIdx;

    while (cur !== null) {
      if (depths.has(cur)) {
        // We hit a node whose depth is already known.
        // Fill the chain in reverse: chain is [startIdx, ..., childOfCur].
        // childOfCur is depth(cur)+1, ..., startIdx is depth(cur)+chain.length.
        let d = depths.get(cur)!;
        for (let i = chain.length - 1; i >= 0; i--) {
          d += 1;
          depths.set(chain[i], d);
        }
        return depths.get(startIdx)!;
      }
      if (seen.has(cur)) {
        // Cycle detected -- assign 0 to all chain members.
        for (const c of chain) depths.set(c, 0);
        return 0;
      }
      seen.add(cur);
      chain.push(cur);
      const row = byIdx.get(cur);
      cur = row ? (row.effective_parent_index ?? null) : null;
    }

    // Reached root (cur === null).
    // chain = [startIdx, ..., root]. root = chain[chain.length-1].
    // root gets depth 0, startIdx gets depth chain.length-1.
    for (let i = 0; i < chain.length; i++) {
      depths.set(chain[i], chain.length - 1 - i);
    }
    return depths.get(startIdx)!;
  };

  for (const row of rows) depthOf(row.row_index);
  return depths;
}

// ── Classification pill (B2b restyle) ────────────────────────────────────────
// Soft per-type opaque fill -- rounded-full lozenge; left-border accent dropped.
// Each entry: paired bg (light/dark) + text (light/dark) Tailwind classes.
// Fully opaque (no /opacity suffix) so sticky-header and row backgrounds don't bleed.

const CLS_LABELS: Record<string, string> = {
  preamble:        "Preamble",
  line_item:       "Item",
  note:            "Note",
  spacer:          "Spacer",
  subtotal_marker: "Subtotal",
  header_repeat:   "Header",
};

const CLS_PILL_CLASSES: Record<string, { bg: string; text: string }> = {
  preamble:        { bg: "bg-gray-200 dark:bg-gray-700",       text: "text-gray-700 dark:text-gray-200" },
  line_item:       { bg: "bg-blue-100 dark:bg-blue-900",       text: "text-blue-800 dark:text-blue-200" },
  note:            { bg: "bg-amber-100 dark:bg-amber-900",     text: "text-amber-800 dark:text-amber-200" },
  subtotal_marker: { bg: "bg-emerald-100 dark:bg-emerald-900", text: "text-emerald-800 dark:text-emerald-200" },
  spacer:          { bg: "bg-gray-100 dark:bg-gray-800",       text: "text-gray-500 dark:text-gray-400" },
  header_repeat:   { bg: "bg-slate-100 dark:bg-slate-800",     text: "text-slate-700 dark:text-slate-300" },
};

function ClassificationPill({ cls }: { cls: string | null }) {
  if (!cls) return null;
  const label = CLS_LABELS[cls] ?? cls;
  const { bg, text } = CLS_PILL_CLASSES[cls] ?? { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-700 dark:text-slate-300" };
  return (
    <span className={cn("rounded-full py-0.5 px-2 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap", bg, text)}>
      {label}
    </span>
  );
}

// ── Number formatter (verbatim from B1) ───────────────────────────────────────

function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  // Up to 2 decimal places, trailing zeros stripped.
  return v % 1 === 0 ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
}

// ── Area colour palette (local mirror of SheetDataGrid -- not exported there) ─

const AREA_COLORS = [
  "bg-blue-100 dark:bg-blue-900",
  "bg-emerald-100 dark:bg-emerald-900",
  "bg-amber-100 dark:bg-amber-900",
  "bg-rose-100 dark:bg-rose-900",
  "bg-violet-100 dark:bg-violet-900",
  "bg-teal-100 dark:bg-teal-900",
] as const;

function buildAreaColorMap(areas: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  areas.forEach((area, i) => { map[area] = AREA_COLORS[i % AREA_COLORS.length]; });
  return map;
}

// ── Descriptor value resolution ───────────────────────────────────────────────

function resolveDescriptorValue(row: ReviewRow, d: ColumnDescriptor): unknown {
  const top = (row as unknown as Record<string, unknown>)[d.value_field];
  if (top === null || top === undefined) return undefined;
  if (d.value_key === null) return top;
  const dict = top as Record<string, unknown>;
  if (!(d.value_key in dict)) return undefined;
  const mid = dict[d.value_key];
  if (mid === null || mid === undefined) return undefined;
  if (d.rate_subkey === null) return mid;
  return (mid as Record<string, unknown>)[d.rate_subkey];
}

// Absent-vs-zero rule: undefined/null -> blank; 0 -> "0"; numbers -> formatted.
function renderDescriptorCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number") return fmtNum(val);
  return String(val);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INDENT_PX = 20;
const VISIBILITY_HOP_CAP = 60; // max ancestor chain length for isVisible check

// Roles shown as fixed anchor columns; excluded from the descriptor-driven layer.
const FIXED_ROLE_DEDUPE = new Set(["sl_no", "description"]);

// C-v2: the 7 flat numeric value fields editable inline (mirrors backend
// review_screen._VALUE_FIELDS). A descriptor is editable iff value_key === null
// (a flat singleton column, NOT a per-area cell) AND its value_field is one of
// these. Per-area cells (value_key !== null) and text fields are read-only here.
const EDITABLE_VALUE_FIELDS = new Set<string>([
  "qty_total", "rate_supply", "rate_install", "rate_combined",
  "amount_total", "amount_supply", "amount_install",
]);

// C-v2b: the 2 flat text value fields editable inline (mirrors backend
// review_screen._TEXT_FIELDS). Same descriptor-gating as EDITABLE_VALUE_FIELDS
// (value_key === null && this Set has value_field). Unlike numeric edits, the
// text Apply saves DIRECTLY with no confirm dialog (silent save) and the value
// is a string (backend stores it verbatim, no float coercion). description and
// row_notes stay read-only -- they are NOT here.
const EDITABLE_TEXT_FIELDS = new Set<string>(["unit", "make_model"]);

// C-v2d: the 3 per-area JSON value fields editable inline (mirrors backend
// _AREA_JSON_FIELDS). A descriptor is per-area-editable iff value_key !== null (it
// targets one area cell) AND its value_field is one of these. qty_by_area /
// amount_by_area are flat one-hop; rate_by_area is nested (descriptor carries the
// rate_subkey). These commit through the SAME confirm dialog as flat numeric edits;
// blank -> 0.0 (the area key stays). save_review_edit takes area (+ rate_subkey).
const EDITABLE_AREA_FIELDS = new Set<string>(["qty_by_area", "amount_by_area", "rate_by_area"]);

// C-v2c: per-row human-only remark cap (mirrors backend _REMARK_MAX_LEN). Enforced
// here as a live counter + Save-disable; the backend hard-guards the same value.
const REMARK_MAX_LEN = 250;

// ── Component ─────────────────────────────────────────────────────────────────

interface ReviewTreeProps {
  rows: ReviewRow[];
  columnDescriptors: ColumnDescriptor[];
  flags: AdvisoryFlag[];
  // C-v2: identifiers for the save_review_edit POST. sheetName MUST be the
  // verbatim, untrimmed DB string (the #152 trailing-space guard) -- never the
  // display-trimmed name.
  boqName: string;
  sheetName: string;
  // C-v2: invoked after a resolved save with the returned edited_at; the parent
  // (SheetReviewPage) refreshes get_review_rows + advances the save-status anchor.
  onSaved?: (editedAt: string) => void;
  // C-v2c: invoked after a remark save. DELIBERATELY separate from onSaved -- a
  // remark is not an edit, so it refreshes the grid (mutate) WITHOUT advancing the
  // sheet-level "All changes saved" edit anchor. Keeps remarks off the edit surface.
  onRemarkSaved?: () => void;
}

export function ReviewTree({ rows, columnDescriptors, flags, boqName, sheetName, onSaved, onRemarkSaved }: ReviewTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // FIX 1: transient highlight for scroll-to-parent affordance (~1.5s flash)
  const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null);
  // FIX 1: row DOM element refs for scrollIntoView
  const rowRefs = useRef<Map<number, HTMLElement>>(new Map());
  // B2a-fix OBS-1: single-open accordion -- only one row's flag reasons shown at a time.
  // expandedFlagRow holds the row_index of the currently open row, or null if none.
  const [expandedFlagRow, setExpandedFlagRow] = useState<number | null>(null);
  // B2a-fix OBS-1: master show-all toggle. When true, all flagged rows reveal reasons,
  // overriding the single-open model. Toggling off clears expandedFlagRow to null.
  const [showAllFlags, setShowAllFlags] = useState(false);
  // B2b BUILD 1: per-row inline detail panel state (single-open, Option-B with flag accordion).
  const [expandedDetailRow, setExpandedDetailRow] = useState<number | null>(null);

  // C-v2: inline value-editing for the 7 flat numeric fields (save_review_edit).
  const { call: saveCall, loading: isSaving } = useFrappePostCall<{ message: SaveReviewEditResponse }>(
    "nirmaan_stack.api.boq.wizard.review_screen.save_review_edit",
  );
  // C-v2c: per-row remark write -- a SEPARATE endpoint + separate loading flag from
  // the edit path (a remark never touches edited_at / edit_log / the "Edited" surface).
  const { call: saveRemarkCall, loading: isSavingRemark } = useFrappePostCall<{
    message: { ok: boolean; row_index: number; remarks: string | null };
  }>("nirmaan_stack.api.boq.wizard.review_screen.save_review_remark");
  // C-v2c: the remark Textarea input for the currently-expanded detail row.
  const [remarkInput, setRemarkInput] = useState("");
  // C-v2c: dedicated inline error for the remark Save block ONLY -- kept separate
  // from saveError (numeric/text edits) so the two surfaces never cross-display.
  const [remarkError, setRemarkError] = useState<string | null>(null);
  // Editable-value inputs for the currently-expanded detail row (value_field -> string).
  const [editInputs, setEditInputs] = useState<Record<string, string>>({});
  // C-v2b: editable text inputs (unit / make_model) for the expanded detail row.
  const [textInputs, setTextInputs] = useState<Record<string, string>>({});
  // C-v2d: per-area numeric inputs for the expanded detail row, keyed by descriptor
  // col letter (value_field repeats across areas, so col is the unique key).
  const [areaInputs, setAreaInputs] = useState<Record<string, string>>({});
  // Pending value edit awaiting confirmation (single-open, mirrors expandedDetailRow).
  // C-v2d: area / rateSubkey are present only for per-area edits (undefined for flat).
  const [pendingEdit, setPendingEdit] = useState<{
    rowIndex: number;
    field: string;
    col: string;
    role: string;
    excelRow: number;
    from: string;
    to: string;
    area?: string;
    rateSubkey?: string;
  } | null>(null);
  // Optional free-text reason captured in the confirm dialog (blank -> backend None).
  const [pendingReason, setPendingReason] = useState("");
  // Inline save error surfaced in the still-open detail panel (no toasts -- wizard convention).
  const [saveError, setSaveError] = useState<string | null>(null);

  const { depths, hasChildrenSet, byIdx } = useMemo(() => {
    const depths = computeDepths(rows);
    const hasChildrenSet = new Set<number>();
    const byIdx = new Map<number, ReviewRow>(rows.map(r => [r.row_index, r]));
    for (const row of rows) {
      const p = row.effective_parent_index;
      if (p !== null && p !== undefined) hasChildrenSet.add(p);
    }
    return { depths, hasChildrenSet, byIdx };
  }, [rows]);

  // Descriptor processing: dedupe fixed-anchor roles, extract anchor letters, area map.
  const { displayDescriptors, slNoLetter, descriptionLetter, areaColorMap, editableDescriptors, editableTextDescriptors, editableAreaDescriptors } = useMemo(() => {
    const displayDescriptors = columnDescriptors.filter(d => !FIXED_ROLE_DEDUPE.has(d.role));
    const slNoLetter = columnDescriptors.find(d => d.role === "sl_no")?.col ?? null;
    const descriptionLetter = columnDescriptors.find(d => d.role === "description")?.col ?? null;
    const areas = [
      ...new Set(displayDescriptors.filter(d => d.area !== null).map(d => d.area as string)),
    ];
    // C-v2: descriptors whose value is a flat editable numeric field. A sheet
    // whose value columns are ALL per-area surfaces zero editable inputs -- expected.
    const editableDescriptors = displayDescriptors.filter(
      d => d.value_key === null && EDITABLE_VALUE_FIELDS.has(d.value_field),
    );
    // C-v2b: descriptors whose value is a flat editable text field (unit / make_model).
    // Gated identically to editableDescriptors so a text input shows only when the
    // sheet actually maps that column. Empty list -> no text inputs rendered.
    const editableTextDescriptors = displayDescriptors.filter(
      d => d.value_key === null && EDITABLE_TEXT_FIELDS.has(d.value_field),
    );
    // C-v2d: per-area editable descriptors (one per area cell the sheet maps).
    // value_key !== null distinguishes a per-area surface from a flat column.
    const editableAreaDescriptors = displayDescriptors.filter(
      d => d.value_key !== null && EDITABLE_AREA_FIELDS.has(d.value_field),
    );
    return {
      displayDescriptors,
      slNoLetter,
      descriptionLetter,
      areaColorMap: buildAreaColorMap(areas),
      editableDescriptors,
      editableTextDescriptors,
      editableAreaDescriptors,
    };
  }, [columnDescriptors]);

  // B1.1b-ii FEAT A: visible descriptor columns.
  // Lazy-initialized to all descriptor cols on mount; re-synced via useEffect when
  // displayDescriptors changes (e.g., navigating to a different sheet).
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    () => new Set(columnDescriptors.filter(d => !FIXED_ROLE_DEDUPE.has(d.role)).map(d => d.col))
  );
  // B1.1b-ii FEAT B: annotation-row visibility toggles (independent).
  const [showSpacers, setShowSpacers] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [showSubtotals, setShowSubtotals] = useState(true);

  const toggleCol = (col: string) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  };

  const toggleCollapse = (rowIdx: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx); else next.add(rowIdx);
      return next;
    });
  };

  // B2a-fix OBS-1: toggle single-open accordion for advisory flag reasons.
  // If the clicked row is already open, close it (set null); otherwise open it.
  // B2b Option-B: also clears the detail panel (mutually exclusive with detail).
  const toggleFlagRow = (rowIdx: number) => {
    setExpandedFlagRow(prev => prev === rowIdx ? null : rowIdx);
    setExpandedDetailRow(null);
  };

  // B2b BUILD 1: toggle inline detail panel. Option-B: closes any open flag-reason row.
  const toggleDetailRow = (idx: number) => {
    setExpandedDetailRow(prev => prev === idx ? null : idx);
    setExpandedFlagRow(null);
  };

  // C-v2: open the per-edit confirm dialog for one editable value field.
  const openValueConfirm = (row: ReviewRow, d: ColumnDescriptor, fromStr: string, toStr: string) => {
    setPendingEdit({
      rowIndex: row.row_index,
      field: d.value_field,
      col: d.col,
      role: ROLE_LABELS[d.role] ?? d.role,
      excelRow: row.source_row_number,
      from: fromStr,
      to: toStr,
    });
    setPendingReason("");
    setSaveError(null);
  };

  // C-v2d: open the same confirm dialog for a per-area cell. Carries area
  // (+ rate_subkey for rate_by_area) so confirmValueSave can target the cell.
  const openAreaConfirm = (row: ReviewRow, d: ColumnDescriptor, fromStr: string, toStr: string) => {
    setPendingEdit({
      rowIndex: row.row_index,
      field: d.value_field,
      col: d.col,
      role: ROLE_LABELS[d.role] ?? d.role,
      excelRow: row.source_row_number,
      from: fromStr,
      to: toStr,
      area: d.area ?? undefined,
      rateSubkey: d.rate_subkey ?? undefined,
    });
    setPendingReason("");
    setSaveError(null);
  };

  // C-v2: fire the save_review_edit POST. The dialog auto-closes on confirm
  // (AlertDialogAction). Success advances the anchor + refreshes via onSaved;
  // failure (the endpoint REJECTS) surfaces inline in the still-open detail panel.
  const confirmValueSave = async () => {
    if (!pendingEdit) return;
    const { rowIndex, field, to, area, rateSubkey } = pendingEdit;
    setSaveError(null);
    try {
      const res = await saveCall({
        boq_name: boqName,
        sheet_name: sheetName, // VERBATIM untrimmed -- #152 trailing-space guard
        row_index: rowIndex,
        field,
        value: to,
        reason: pendingReason, // blank/whitespace normalized to None by the backend
        // C-v2d: present only for per-area edits; undefined keys are omitted by the SDK
        // so the flat path is unchanged.
        area,
        rate_subkey: rateSubkey,
      });
      setPendingEdit(null);
      onSaved?.(res.message.edited_at);
    } catch (e: unknown) {
      setPendingEdit(null);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
          ? String((e as { message: unknown }).message)
          : "Save failed. Please try again.";
      setSaveError(msg);
    }
  };

  // C-v2b: save a text field (unit / make_model) DIRECTLY -- no confirm dialog
  // (silent save), value is a string (backend stores verbatim, no float coercion).
  // On success advances the anchor + refreshes via onSaved (row flips to "Edited"
  // exactly like a numeric edit); failure surfaces inline in the still-open panel.
  const saveTextField = async (rowIndex: number, field: string, value: string) => {
    setSaveError(null);
    try {
      const res = await saveCall({
        boq_name: boqName,
        sheet_name: sheetName, // VERBATIM untrimmed -- #152 trailing-space guard
        row_index: rowIndex,
        field,
        value,
      });
      onSaved?.(res.message.edited_at);
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
          ? String((e as { message: unknown }).message)
          : "Save failed. Please try again.";
      setSaveError(msg);
    }
  };

  // C-v2c: save a per-row remark via the SEPARATE endpoint. Does NOT flip the row
  // to "Edited" (the backend writes only `remarks`, never edited_at / edit_log).
  // Refresh runs through onRemarkSaved (mutate only -- the sheet edit anchor is NOT
  // advanced). The 250-cap is also guarded backend-side; the button disables past it.
  const saveRemark = async (rowIndex: number, value: string) => {
    setRemarkError(null);
    try {
      await saveRemarkCall({
        boq_name: boqName,
        sheet_name: sheetName, // VERBATIM untrimmed -- #152 trailing-space guard
        row_index: rowIndex,
        remark: value,
      });
      onRemarkSaved?.();
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
          ? String((e as { message: unknown }).message)
          : "Save failed. Please try again.";
      setRemarkError(msg);
    }
  };

  // B2a-fix OBS-1: master show-all / hide-all toggle.
  // Toggling hide-all (showAllFlags -> false) also clears expandedFlagRow to null.
  const toggleShowAllFlags = () => {
    if (showAllFlags) {
      setShowAllFlags(false);
      setExpandedFlagRow(null);
    } else {
      setShowAllFlags(true);
    }
  };

  const flagsByRowIdx = useMemo(() => {
    const m = new Map<number, AdvisoryFlag[]>();
    for (const f of flags) { const a = m.get(f.row_index) ?? []; a.push(f); m.set(f.row_index, a); }
    return m;
  }, [flags]);

  // Whether any flags exist at all -- used to conditionally render the master toggle.
  const hasFlagsAny = flags.length > 0;

  // FIX 1: clear highlight after 1.5s
  useEffect(() => {
    if (highlightedIdx === null) return;
    const timer = setTimeout(() => setHighlightedIdx(null), 1500);
    return () => clearTimeout(timer);
  }, [highlightedIdx]);

  // B1.1b-ii: sync visibleCols to all descriptor cols when descriptors change.
  // Fires on mount (harmless redundancy with lazy init) and on prop changes.
  useEffect(() => {
    setVisibleCols(new Set(displayDescriptors.map(d => d.col)));
  }, [displayDescriptors]);

  // C-v2: seed editable-value inputs when the detail panel opens or row data
  // changes (e.g. after a save -> mutate() refreshes rows; the inputs re-seed to
  // the freshly stored values so the just-edited field reads non-dirty).
  useEffect(() => {
    if (expandedDetailRow === null) {
      setEditInputs({});
      setTextInputs({});
      setAreaInputs({});
      setRemarkInput("");
      setSaveError(null);
      setRemarkError(null);
      return;
    }
    const r = byIdx.get(expandedDetailRow);
    if (!r) {
      setEditInputs({});
      setTextInputs({});
      setAreaInputs({});
      setRemarkInput("");
      return;
    }
    const seed: Record<string, string> = {};
    for (const d of editableDescriptors) {
      const v = (r as unknown as Record<string, unknown>)[d.value_field];
      seed[d.value_field] = v === null || v === undefined ? "" : String(v);
    }
    setEditInputs(seed);
    // C-v2b: seed text inputs from the row's stored unit / make_model.
    const textSeed: Record<string, string> = {};
    for (const d of editableTextDescriptors) {
      const v = (r as unknown as Record<string, unknown>)[d.value_field];
      textSeed[d.value_field] = v === null || v === undefined ? "" : String(v);
    }
    setTextInputs(textSeed);
    // C-v2d: seed per-area inputs (keyed by col -- value_field repeats per area).
    const areaSeed: Record<string, string> = {};
    for (const d of editableAreaDescriptors) {
      const v = resolveDescriptorValue(r, d);
      areaSeed[d.col] = v === null || v === undefined ? "" : String(v);
    }
    setAreaInputs(areaSeed);
    // C-v2c: seed the remark Textarea from the row's stored remark (read+edit in panel).
    setRemarkInput(r.remarks ?? "");
    setSaveError(null);
    setRemarkError(null);
  }, [expandedDetailRow, byIdx, editableDescriptors, editableTextDescriptors, editableAreaDescriptors]);

  // FIX 1: expand any collapsed ancestors of targetRowIdx, then scroll + highlight.
  // Uses setTimeout(50ms) to wait for React to commit the expand re-render.
  const revealAndScrollToRow = (targetRowIdx: number) => {
    const toExpand: number[] = [];
    let cur: number | null | undefined = byIdx.get(targetRowIdx)?.effective_parent_index ?? null;
    let hops = 0;
    while (cur !== null && cur !== undefined && cur >= 0 && hops < VISIBILITY_HOP_CAP) {
      if (collapsed.has(cur)) toExpand.push(cur);
      const ancestor = byIdx.get(cur);
      cur = ancestor ? (ancestor.effective_parent_index ?? null) : null;
      hops++;
    }
    if (toExpand.length > 0) {
      setCollapsed(prev => {
        const next = new Set(prev);
        for (const idx of toExpand) next.delete(idx);
        return next;
      });
    }
    setTimeout(() => {
      rowRefs.current.get(targetRowIdx)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setHighlightedIdx(targetRowIdx);
    }, 50);
  };

  // FIX 3: a row is hidden only if an ANCESTOR is collapsed, never itself.
  // Collapsing row R hides R's descendants; R stays visible as the expand affordance.
  //
  // Guards added vs the B1.1b-i version:
  //   cur < 0  -- treats -1 sentinel (pre-fix-A rows have parent_index=0, not -1; this
  //               guard stops any stale -1 value from being looked up in collapsed).
  //   cur === row.row_index  -- self-reference guard; prevents a cyclic row from being
  //               hidden when it is itself collapsed.
  const isVisible = (row: ReviewRow): boolean => {
    let cur: number | null | undefined = row.effective_parent_index;
    let hops = 0;
    while (cur !== null && cur !== undefined && hops < VISIBILITY_HOP_CAP) {
      if (cur < 0) break;                  // -1 sentinel treated as root
      if (cur === row.row_index) break;    // self-reference guard
      if (collapsed.has(cur)) return false;
      const parent = byIdx.get(cur);
      cur = parent ? (parent.effective_parent_index ?? null) : null;
      hops++;
    }
    return true;
  };

  // B1.1b-ii FEAT B: classification-visibility gate.
  // Composes WITH isVisible (collapse): render only when BOTH pass.
  // Never adds rows to `collapsed` -- children of a hidden annotation row render
  // independently at their original computeDepths depth.
  const classificationVisible = (row: ReviewRow): boolean => {
    const cls = row.effective_classification;
    if (cls === "spacer" && !showSpacers) return false;
    if (cls === "note" && !showNotes) return false;
    if (cls === "subtotal_marker" && !showSubtotals) return false;
    return true;
  };

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">No rows found for this sheet.</p>
    );
  }

  const hiddenColCount = displayDescriptors.filter(d => !visibleCols.has(d.col)).length;

  return (
    <div className="rounded-md border border-border overflow-hidden">
      {/* B1.1b-ii: controls bar -- column-subset selector + classification toggles */}
      <div className="flex items-center gap-4 px-3 py-2 border-b border-border bg-muted/20 flex-wrap">
        {/* Feature 1: column-subset selector (only when descriptor columns exist) */}
        {displayDescriptors.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border border-border",
                  "bg-background hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors",
                  hiddenColCount > 0 && "border-primary text-foreground",
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Columns
                {hiddenColCount > 0 && (
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    ({hiddenColCount} hidden)
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto min-w-[200px] p-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Data columns
              </p>
              <div className="space-y-1">
                {displayDescriptors.map(d => {
                  const colLabel = `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}${d.area ? ` · ${d.area}` : ""}`;
                  return (
                    <label
                      key={d.col}
                      htmlFor={`vis-col-${d.col}`}
                      className="flex items-center gap-2 py-0.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Checkbox
                        id={`vis-col-${d.col}`}
                        checked={visibleCols.has(d.col)}
                        onCheckedChange={() => toggleCol(d.col)}
                      />
                      {colLabel}
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {/* B2a-fix OBS-1: master show-all / hide-all flags toggle */}
        {hasFlagsAny && (
          <button
            type="button"
            onClick={toggleShowAllFlags}
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border border-border",
              "bg-background hover:bg-muted/50 transition-colors",
              showAllFlags
                ? "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Info className="h-3.5 w-3.5" />
            {showAllFlags ? "Hide all flags" : "Show all flags"}
          </button>
        )}
        {/* Feature 2: three independent annotation-row visibility toggles */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Show:</span>
          <label
            htmlFor="cls-spacers"
            className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
          >
            <Checkbox
              id="cls-spacers"
              checked={showSpacers}
              onCheckedChange={(c) => setShowSpacers(c === true)}
            />
            Spacers
          </label>
          <label
            htmlFor="cls-notes"
            className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
          >
            <Checkbox
              id="cls-notes"
              checked={showNotes}
              onCheckedChange={(c) => setShowNotes(c === true)}
            />
            Notes
          </label>
          <label
            htmlFor="cls-subtotals"
            className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
          >
            <Checkbox
              id="cls-subtotals"
              checked={showSubtotals}
              onCheckedChange={(c) => setShowSubtotals(c === true)}
            />
            Subtotals
          </label>
        </div>
      </div>
      {/* Table scroll area -- max-h adjusted to account for controls bar height */}
      <div className="overflow-auto max-h-[calc(100vh-16rem)]">
        {/* B2a-fix OBS-1: clicking anywhere in the table body dismisses the single-open
            accordion (sets expandedFlagRow null). The Info button's stopPropagation
            prevents the opening click from immediately triggering this handler.
            B2b: also clears expandedDetailRow (Option-B mutual exclusivity).
            Scoped to the <table> so the controls bar above is not affected. */}
        <table
          className="w-full text-xs border-collapse"
          onClick={() => { setExpandedFlagRow(null); setExpandedDetailRow(null); }}
        >
          <thead>
            {/* B2b BUILD 3: sticky moved from <tr> to individual <th> cells (solid bg, no bleed-through).
                Corner cell (expander) gets both-axis sticky at z-30. Other <th> get top-only at z-20. */}
            <tr className="border-b border-border">
              {/* Expander column (B2b): corner -- both axes sticky, solid bg. Empty header. */}
              <th className="px-1 py-2 w-8 border-r border-border sticky top-0 left-0 z-30 bg-muted" />
              {/* Excel Row: positional anchor -- source_row_number, no mapped letter */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-10 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
                Excel Row
              </th>
              {/* Status (B2c): edit-provenance badge -- green "Edited" or blank. Not frozen-left. */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-20 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
                Status
              </th>
              {/* Sl.No: letter from the sl_no descriptor col, if mapped */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
                {slNoLetter ? `Sl.No (${slNoLetter})` : "Sl.No"}
              </th>
              {/* Parent (FIX 1): parent row's Excel row number -- derived, no mapped letter */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
                Parent
              </th>
              {/* Classification (B1.1b-iii): fixed anchor -- chevron + pill; no mapped letter */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-36 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
                Classification
              </th>
              {/* Description: letter from the description descriptor col, if mapped */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground min-w-[280px] whitespace-nowrap sticky top-0 z-20 bg-muted">
                {descriptionLetter ? `Description (${descriptionLetter})` : "Description"}
              </th>
              {/* Descriptor-driven columns: only rendered when col is in visibleCols */}
              {displayDescriptors.map(d => {
                if (!visibleCols.has(d.col)) return null;
                const label = `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}${d.area ? ` · ${d.area}` : ""}`;
                return (
                  <th
                    key={d.col}
                    className={cn(
                      "px-2 py-2 text-right font-medium text-muted-foreground",
                      "w-28 min-w-[112px] border-l border-border whitespace-nowrap",
                      "sticky top-0 z-20",
                      d.area ? (areaColorMap[d.area] ?? "bg-muted") : "bg-muted",
                    )}
                  >
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              if (!isVisible(row)) return null;
              // B1.1b-ii FEAT B: classification-visibility gate (annotation rows only).
              // Children of a filtered row render independently at their original depth.
              if (!classificationVisible(row)) return null;

              const depth = depths.get(row.row_index) ?? 0;
              const hasChildren = hasChildrenSet.has(row.row_index);
              const isCollapsed = collapsed.has(row.row_index);
              const isPreamble = row.effective_classification === "preamble";
              const isLineItem = row.effective_classification === "line_item";

              // FIX 1: resolve parent's Excel row number (null for roots / invalid parent)
              const pIdx = row.effective_parent_index ?? -1;
              const parentExcelRow = pIdx >= 0 ? (byIdx.get(pIdx)?.source_row_number ?? null) : null;

              // B2a: advisory flags for this row
              const rowFlags = flagsByRowIdx.get(row.row_index) ?? [];
              const hasFlags = rowFlags.length > 0;
              // B2a-fix OBS-1: reveal when show-all is on OR this row is the single open row.
              const flagsExpanded = hasFlags && (showAllFlags || expandedFlagRow === row.row_index);
              // C-v2c (polish): the remark marker is ALWAYS shown when the row carries a
              // non-empty remark -- a marker's job is to advertise the remark, so no toggle
              // or open-panel gating. Clicking the marker opens the detail panel (no reveal row).
              const hasRemark = typeof row.remarks === "string" && row.remarks.trim() !== "";
              const remarkMarkerShown = hasRemark;
              // B2c: colSpan for flag-reasons + detail panel rows -- 7 fixed anchors (incl. expander, Status).
              const visibleDescriptorCount = displayDescriptors.filter(d => visibleCols.has(d.col)).length;
              const totalCols = 7 + visibleDescriptorCount;
              // B2c: edit-provenance rule -- edited_at set OR edit_log non-empty.
              const isEdited = row.edited_at !== null || (Array.isArray(row.edit_log) && row.edit_log.length > 0);

              // B2b: parent label resolution for detail panel (Excel row numbers where resolvable).
              const origParentLabel = (() => {
                const pi = row.parent_index;
                if (pi === null || pi < 0) return "root";
                const n = byIdx.get(pi)?.source_row_number;
                return n !== undefined ? `row ${n}` : `#${pi}`;
              })();
              const effParentLabel = (() => {
                const ep = row.effective_parent_index;
                if (ep === null || ep < 0) return "root";
                const n = byIdx.get(ep)?.source_row_number;
                return n !== undefined ? `row ${n}` : `#${ep}`;
              })();
              // Slice 1b-alpha: a human-rooted row (human_is_root=1, human_parent=-1) is
              // ALSO a parent override -- the detail panel must show "row N -> root".
              const parentOverridden =
                (row.human_parent !== null && row.human_parent >= 0) || row.human_is_root === 1;
              const clsOverridden = row.human_classification !== null;

              return (
                // Fragment lets us emit optional sibling <tr>s (flag-reasons, detail panel).
                <Fragment key={row.row_index}>
                  <tr
                    ref={(el) => {
                      if (el) rowRefs.current.set(row.row_index, el);
                      else rowRefs.current.delete(row.row_index);
                    }}
                    className={cn(
                      "border-b border-border hover:bg-muted/30 transition-colors",
                      isPreamble && "bg-muted/20",
                      isEdited && "bg-green-50 dark:bg-green-950/30",
                      // FIX 1: transient amber flash wins over green tint (placed after in cn())
                      highlightedIdx === row.row_index && "bg-amber-100 dark:bg-amber-900/40",
                    )}
                  >
                    {/* Expander column (B2b BUILD 1): frozen-left sticky -- always visible on horizontal scroll.
                        stopPropagation is mandatory (prevents table-dismiss from firing on the same click). */}
                    <td className="px-1 py-1.5 align-top w-8 border-r border-border sticky left-0 z-10 bg-background">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleDetailRow(row.row_index); }}
                        aria-label={expandedDetailRow === row.row_index ? "Hide row detail" : "Show row detail"}
                        className="h-4 w-4 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {expandedDetailRow === row.row_index
                          ? <ChevronDown className="h-3 w-3" />
                          : <ChevronRight className="h-3 w-3" />}
                      </button>
                    </td>

                    {/* Excel Row */}
                    <td className="px-2 py-1.5 text-muted-foreground font-mono align-top w-10 border-r border-border">
                      {row.source_row_number}
                    </td>

                    {/* Status (B2c): edit-provenance badge -- not frozen-left */}
                    <td className="px-2 py-1.5 align-top w-20 border-r border-border">
                      {isEdited ? (
                        <span className="rounded-full py-0.5 px-2 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                          Edited
                        </span>
                      ) : (
                        <span className="rounded-full py-0.5 px-2 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                          Original
                        </span>
                      )}
                    </td>

                    {/* Sl.No */}
                    <td className="px-2 py-1.5 text-muted-foreground align-top w-16 border-r border-border">
                      {row.sl_no_value ?? ""}
                    </td>

                    {/* Parent (FIX 1): clickable "↑ N" link to parent's Excel row; blank for roots */}
                    <td className="px-2 py-1.5 align-top w-16 border-r border-border">
                      {parentExcelRow !== null ? (
                        <button
                          type="button"
                          onClick={() => revealAndScrollToRow(pIdx)}
                          className="text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                        >
                          ↑ {parentExcelRow}
                        </button>
                      ) : null}
                    </td>

                    {/* Classification (B1.1b-iii): chevron + pill + optional flag marker.
                        Flag marker (B2a): neutral amber Info icon; click-to-reveal reasons.
                        stopPropagation prevents bubbling to chevron/parent-link handlers. */}
                    <td className="px-2 py-1.5 align-top w-36 border-r border-border">
                      <div className="flex items-start gap-1.5">
                        {/* Expand/collapse toggle -- invisible (not hidden) on leaf rows
                            so the layout stays stable and descriptions align. */}
                        <button
                          type="button"
                          className={cn(
                            "mt-0.5 shrink-0 h-4 w-4 flex items-center justify-center rounded",
                            "text-muted-foreground hover:text-foreground transition-colors",
                            !hasChildren && "invisible pointer-events-none",
                          )}
                          onClick={() => { if (hasChildren) toggleCollapse(row.row_index); }}
                          aria-label={isCollapsed ? "Expand" : "Collapse"}
                          tabIndex={hasChildren ? 0 : -1}
                        >
                          {isCollapsed
                            ? <ChevronRight className="h-3 w-3" />
                            : <ChevronDown className="h-3 w-3" />}
                        </button>
                        <ClassificationPill cls={row.effective_classification} />
                        {/* Right-aligned marker group (remark + flag). Both sit inside one
                            ml-auto wrapper so each stays right-aligned independently
                            (either, both, or neither present). Markers live INSIDE the
                            Classification cell -- no extra column, no totalCols change. */}
                        {(remarkMarkerShown || hasFlags) && (
                          <div className="mt-0.5 ml-auto flex items-center gap-0.5 shrink-0">
                            {/* C-v2c: remark marker (blue, distinct from amber flags).
                                Click opens the detail panel (read+edit the remark there).
                                stopPropagation prevents the table dismiss-onClick firing. */}
                            {remarkMarkerShown && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleDetailRow(row.row_index); }}
                                className="shrink-0 h-4 w-4 flex items-center justify-center rounded text-blue-500/80 hover:text-blue-600 dark:text-blue-400/80 dark:hover:text-blue-300 transition-colors"
                                aria-label="Show remark"
                                title="Remark"
                              >
                                <MessageSquare className="h-3 w-3" />
                              </button>
                            )}
                            {/* B2a: advisory flag marker -- one unified indicator per flagged row.
                                stopPropagation prevents the table's dismiss-onClick from firing
                                on the same click that opens/closes this row's reason reveal.
                                B2b BUILD 5: aria-label "advisory notes" -> "flags". */}
                            {hasFlags && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleFlagRow(row.row_index); }}
                                className={cn(
                                  "shrink-0 h-4 w-4 flex items-center justify-center rounded",
                                  "transition-colors",
                                  flagsExpanded
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-amber-500/70 hover:text-amber-600 dark:text-amber-500/70 dark:hover:text-amber-400",
                                )}
                                aria-label={flagsExpanded ? "Hide flags" : "Show flags"}
                                title={flagsExpanded ? "Hide flags" : "Show flags"}
                              >
                                <Info className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Description (B1.1b-iii): text only; depth indent moved here.
                        paddingLeft = depth * INDENT_PX applied to the content wrapper. */}
                    <td className="px-2 py-1.5 align-top">
                      <div style={{ paddingLeft: `${depth * INDENT_PX}px` }}>
                        <span className={cn(
                          "leading-snug break-words min-w-0",
                          isPreamble && "font-medium text-foreground",
                          isLineItem && "text-foreground",
                          !isPreamble && !isLineItem && "text-muted-foreground italic text-[11px]",
                        )}>
                          {row.description || (
                            <span className="not-italic text-muted-foreground">(no description)</span>
                          )}
                        </span>
                      </div>
                    </td>

                    {/* Descriptor-driven data columns: only rendered when col is in visibleCols */}
                    {displayDescriptors.map(d => {
                      if (!visibleCols.has(d.col)) return null;
                      const val = resolveDescriptorValue(row, d);
                      return (
                        <td
                          key={d.col}
                          className="px-2 py-1.5 text-right align-top border-l border-border tabular-nums"
                        >
                          {renderDescriptorCell(val)}
                        </td>
                      );
                    })}
                  </tr>

                  {/* B2a-fix OBS-1: flag-reasons reveal row -- single-open or show-all */}
                  {flagsExpanded && (
                    <tr className="bg-amber-50/60 dark:bg-amber-950/20">
                      <td
                        colSpan={totalCols}
                        className="px-3 py-2 border-b border-amber-100 dark:border-amber-900/30"
                      >
                        <ul className="space-y-0.5">
                          {rowFlags.map((f, i) => (
                            <li
                              key={i}
                              className="text-xs text-amber-700 dark:text-amber-300 leading-snug"
                            >
                              {f.reason}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}

                  {/* B2b BUILD 1: inline read-only detail panel -- single-open (Option-B with flag accordion).
                      Interior clicks stopped from bubbling so reading inside the panel does NOT dismiss it. */}
                  {expandedDetailRow === row.row_index && (
                    <tr className="bg-muted/30">
                      <td colSpan={totalCols} className="px-3 py-3 border-b border-border">
                        <div onClick={(e) => e.stopPropagation()}>
                          {/* Header: Excel row number + provenance badge */}
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-medium text-foreground">
                              Row detail — Excel row {row.source_row_number}
                            </span>
                            {(row.edited_at !== null || (Array.isArray(row.edit_log) && row.edit_log.length > 0))
                              ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-medium">edited</span>
                              : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">original</span>
                            }
                          </div>
                          {/* Original-vs-effective: classification + parent (read-only, edit-focused panel) */}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
                            <div>
                              <span className="text-muted-foreground">Classification: </span>
                              {clsOverridden ? (
                                <>
                                  <span className="line-through text-muted-foreground">{row.classification ?? "—"}</span>
                                  {" → "}
                                  <span className="text-foreground font-medium">{row.effective_classification ?? "—"}</span>
                                </>
                              ) : (
                                <span className="text-foreground">{row.classification ?? "—"}</span>
                              )}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Parent: </span>
                              {parentOverridden ? (
                                <>
                                  <span className="line-through text-muted-foreground">{origParentLabel}</span>
                                  {" → "}
                                  <span className="text-foreground font-medium">{effParentLabel}</span>
                                </>
                              ) : (
                                <span className="text-foreground">{origParentLabel}</span>
                              )}
                            </div>
                          </div>
                          {/* C-v2: editable value inputs -- the flat numeric fields this sheet
                              surfaces (per-area cells + text fields stay read-only here). Each
                              commits via an explicit Apply button that opens the confirm dialog. */}
                          {editableDescriptors.length > 0 && (
                            <div className="mb-2">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Edit values</p>
                              <div className="flex flex-wrap gap-2">
                                {editableDescriptors.map(d => {
                                  const stored = (row as unknown as Record<string, unknown>)[d.value_field];
                                  const storedStr = stored === null || stored === undefined ? "" : String(stored);
                                  const current = editInputs[d.value_field] ?? storedStr;
                                  const dirty = current !== storedStr;
                                  const fieldLabel = `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}`;
                                  return (
                                    <div key={d.value_field} className="flex flex-col gap-1 w-52">
                                      <label
                                        htmlFor={`edit-${row.row_index}-${d.value_field}`}
                                        className="text-[10px] text-muted-foreground"
                                      >
                                        {fieldLabel}
                                      </label>
                                      <div className="flex items-center gap-1">
                                        <Input
                                          id={`edit-${row.row_index}-${d.value_field}`}
                                          type="number"
                                          value={current}
                                          onChange={(e) =>
                                            setEditInputs(prev => ({ ...prev, [d.value_field]: e.target.value }))
                                          }
                                          className="h-7 text-xs"
                                        />
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          className="h-7 px-2 text-xs shrink-0"
                                          disabled={!dirty || isSaving}
                                          onClick={() => openValueConfirm(row, d, storedStr, current)}
                                        >
                                          Apply
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {/* C-v2b: editable TEXT inputs (unit / make_model) -- a separate
                              block from the numeric one. Apply saves DIRECTLY (no confirm
                              dialog); the value is a string. Shown only when the sheet maps
                              the column (editableTextDescriptors gating). */}
                          {editableTextDescriptors.length > 0 && (
                            <div className="mb-2">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Edit text</p>
                              <div className="flex flex-wrap gap-2">
                                {editableTextDescriptors.map(d => {
                                  const stored = (row as unknown as Record<string, unknown>)[d.value_field];
                                  const storedStr = stored === null || stored === undefined ? "" : String(stored);
                                  const current = textInputs[d.value_field] ?? storedStr;
                                  const dirty = current !== storedStr;
                                  const fieldLabel = `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}`;
                                  return (
                                    <div key={d.value_field} className="flex flex-col gap-1 w-52">
                                      <label
                                        htmlFor={`edit-text-${row.row_index}-${d.value_field}`}
                                        className="text-[10px] text-muted-foreground"
                                      >
                                        {fieldLabel}
                                      </label>
                                      <div className="flex items-center gap-1">
                                        <Input
                                          id={`edit-text-${row.row_index}-${d.value_field}`}
                                          type="text"
                                          value={current}
                                          onChange={(e) =>
                                            setTextInputs(prev => ({ ...prev, [d.value_field]: e.target.value }))
                                          }
                                          className="h-7 text-xs"
                                        />
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          className="h-7 px-2 text-xs shrink-0"
                                          disabled={!dirty || isSaving}
                                          onClick={() => { void saveTextField(row.row_index, d.value_field, current); }}
                                        >
                                          Apply
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {/* C-v2d: editable PER-AREA values -- one input per area cell
                              the sheet maps (qty/amount/rate by area). Each commits via
                              the SAME confirm dialog as flat numeric edits (openAreaConfirm).
                              Blank -> 0.0 (the area key stays). Shown only when the sheet
                              maps per-area columns (editableAreaDescriptors gating). */}
                          {editableAreaDescriptors.length > 0 && (
                            <div className="mb-2">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Edit per-area values</p>
                              <div className="flex flex-wrap gap-2">
                                {editableAreaDescriptors.map(d => {
                                  const storedVal = resolveDescriptorValue(row, d);
                                  const storedStr = storedVal === null || storedVal === undefined ? "" : String(storedVal);
                                  const current = areaInputs[d.col] ?? storedStr;
                                  const dirty = current !== storedStr;
                                  // Label: "E — Rate Combined (per area) · Zone A" (+ rate kind for rate).
                                  const fieldLabel = `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}${d.area ? ` · ${d.area}` : ""}`;
                                  return (
                                    <div key={d.col} className="flex flex-col gap-1 w-52">
                                      <label
                                        htmlFor={`edit-area-${row.row_index}-${d.col}`}
                                        className="text-[10px] text-muted-foreground"
                                      >
                                        {fieldLabel}
                                      </label>
                                      <div className="flex items-center gap-1">
                                        <Input
                                          id={`edit-area-${row.row_index}-${d.col}`}
                                          type="number"
                                          value={current}
                                          onChange={(e) =>
                                            setAreaInputs(prev => ({ ...prev, [d.col]: e.target.value }))
                                          }
                                          className="h-7 text-xs"
                                        />
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          className="h-7 px-2 text-xs shrink-0"
                                          disabled={!dirty || isSaving}
                                          onClick={() => openAreaConfirm(row, d, storedStr, current)}
                                        >
                                          Apply
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {/* Shared inline save error (numeric + text + per-area edits) */}
                          {saveError && <p className="text-xs text-destructive mb-2">{saveError}</p>}
                          {/* C-v2c: per-row Remarks -- human-only annotation. SEPARATE write
                              path (save_review_remark): saving a remark does NOT mark the row
                              "Edited". Read + edit here in the panel (no inline reveal row).
                              Dedicated remarkError (not the shared saveError) keeps the two
                              surfaces from cross-displaying. */}
                          {(() => {
                            const storedRemark = row.remarks ?? "";
                            const remarkOverCap = remarkInput.length > REMARK_MAX_LEN;
                            const remarkDirty = remarkInput !== storedRemark;
                            return (
                              <div className="mb-2 max-w-md">
                                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Remarks</p>
                                <Textarea
                                  value={remarkInput}
                                  onChange={(e) => setRemarkInput(e.target.value)}
                                  placeholder="Add a note for this row (optional)"
                                  rows={2}
                                  className="text-xs"
                                />
                                <div className="flex items-center justify-between gap-2 mt-1">
                                  <span
                                    className={cn(
                                      "text-[10px]",
                                      remarkOverCap ? "text-destructive" : "text-muted-foreground",
                                    )}
                                  >
                                    {remarkInput.length}/{REMARK_MAX_LEN}
                                    {remarkOverCap && <span className="ml-1">max {REMARK_MAX_LEN} characters</span>}
                                  </span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs shrink-0"
                                    disabled={!remarkDirty || remarkOverCap || isSavingRemark}
                                    onClick={() => { void saveRemark(row.row_index, remarkInput); }}
                                  >
                                    Save remark
                                  </Button>
                                </div>
                                {remarkError && <p className="text-xs text-destructive mt-1">{remarkError}</p>}
                              </div>
                            );
                          })()}
                          {/* Advisory flags for this row (reuses flagsByRowIdx already computed above) */}
                          {rowFlags.length > 0 && (
                            <div className="mb-2">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Flags</p>
                              <ul className="mt-0.5 space-y-0.5">
                                {rowFlags.map((f, i) => (
                                  <li key={i} className="text-xs text-amber-700 dark:text-amber-300 leading-snug">{f.reason}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {/* Edit history from edit_log */}
                          <div className="mb-1">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Edit history</p>
                            {Array.isArray(row.edit_log) && row.edit_log.length > 0 ? (
                              <ul className="mt-0.5 space-y-0.5">
                                {/* Obs A: latest-first -- newest edit at the top (reverse a copy). */}
                                {[...row.edit_log].reverse().map((entry, i) => (
                                  <li key={i} className="text-xs text-foreground">
                                    <span className="font-medium">{entry.field}</span>
                                    {/* C-v2d: per-area target -- "(Zone A)" or "(Zone A / combined_rate)". */}
                                    {entry.area ? (
                                      <span className="text-muted-foreground">
                                        {" "}({entry.area}{entry.rate_subkey ? ` / ${entry.rate_subkey}` : ""})
                                      </span>
                                    ) : null}
                                    {": "}
                                    {String(entry.from ?? "—")}
                                    {" → "}
                                    {String(entry.to ?? "—")}
                                    {" — "}
                                    <span className="text-muted-foreground">{entry.by} · {entry.at}</span>
                                    {entry.reason ? (
                                      <span className="text-muted-foreground"> · reason: {entry.reason}</span>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-0.5 text-xs text-muted-foreground italic">No edits yet.</p>
                            )}
                          </div>
                          {/* Reason slot -- laid out but empty; pending Slice C's 6th edit_log key */}
                          <p className="text-[11px] text-muted-foreground italic">Reason — (added in a later step)</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* C-v2: per-edit confirm dialog -- lightweight one-line summary + optional
          reason. Value edits have no structural fallout, so this is a single-line
          confirm (not the heavy children-fate confirm). Mounted once outside the
          table; open state derived from pendingEdit. AlertDialogAction auto-closes
          on confirm; success/failure feedback surfaces via the anchor / inline panel. */}
      <AlertDialog open={pendingEdit !== null} onOpenChange={(o) => { if (!o) setPendingEdit(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm value change</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingEdit
                ? `Row ${pendingEdit.excelRow} ${pendingEdit.col} — ${pendingEdit.role}${pendingEdit.area ? ` · ${pendingEdit.area}${pendingEdit.rateSubkey ? ` / ${pendingEdit.rateSubkey}` : ""}` : ""}: ${pendingEdit.from === "" ? "(blank)" : pendingEdit.from} → ${pendingEdit.to === "" ? "(blank)" : pendingEdit.to}. Confirm?`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-1">
            <Input
              type="text"
              value={pendingReason}
              onChange={(e) => setPendingReason(e.target.value)}
              placeholder="Reason (optional)"
              className="h-8 text-xs"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={isSaving} onClick={() => { void confirmValueSave(); }}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
