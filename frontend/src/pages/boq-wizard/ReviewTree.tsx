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
import { ChevronDown, ChevronRight, ChevronUp, SlidersHorizontal, Info, MessageSquare, Search, X, Filter, CheckCircle2, Sparkles, AlertTriangle, AlertOctagon } from "lucide-react";
import { useFrappePostCall } from "frappe-react-sdk";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";
import type { ReviewRow, ColumnDescriptor, AdvisoryFlag, StructuralBreak, SaveReviewEditResponse, EditLogEntry } from "./boqTypes";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RestructureModal } from "./RestructureModal";
// Shared review-render helpers, extracted to ./reviewRender (Slice 2) for reuse by the
// pricing grid. Byte-identical move -- behaviour unchanged. CLS_LABELS moved with the
// pill (it depends on it) and is re-imported here for ReviewTree's own label usages.
import {
  computeDepths,
  resolveDescriptorValue,
  renderDescriptorCell,
  ClassificationPill,
  CLS_LABELS,
} from "./reviewRender";
// DUAL-AI (ADR-0003 sec 8A): the Gemini provider column + detail-panel accept block. Visual
// clones of Nitesh's Claude "AI Rec" column + "AI suggestion" block, reading gemini_* + calling
// the gemini endpoints. Mounted ADDITIVELY beside the Claude pieces (Nitesh's stay untouched).
import {
  GeminiHeaderCell,
  GeminiBodyCell,
  geminiSuggestionInfo,
  geminiHasConfidence,
  type GeminiFilter,
} from "./GeminiSuggestionColumn";
import { GeminiAcceptBlock } from "./GeminiAcceptBlock";

// computeDepths + CLS_LABELS were extracted to ./reviewRender (Slice 2) and are
// imported at the top. Behaviour unchanged.

// A2 edit-log clarity (render-time): the stored edit_log `at` is a local
// "YYYY-MM-DD HH:MM:SS.ffffff" string (review_screen.py frappe.utils.now()).
// Slice to "YYYY-MM-DD HH:MM" -- drop seconds + microseconds. A plain string
// slice is the safest choice: no date library, no timezone reparse surprises.
function formatEditAt(at: unknown): string {
  return typeof at === "string" ? at.slice(0, 16) : "";
}

// A2 edit-log clarity: a described edit_log entry for render. `null` from
// describeEditEntry means "suppress this entry" (the #162 no-op reclassify).
interface DescribedEditEntry {
  verb: string;
  detail: string | null;
  showField: boolean;
}

// ClassificationPill + CLS_PILL_CLASSES + fmtNum were extracted to ./reviewRender
// (Slice 2). ClassificationPill is imported at the top; fmtNum is now module-private
// to reviewRender (its only caller, renderDescriptorCell, moved too). Behaviour unchanged.

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

// resolveDescriptorValue + renderDescriptorCell were extracted to ./reviewRender
// (Slice 2) and are imported at the top. Behaviour unchanged.

// ── Constants ─────────────────────────────────────────────────────────────────

const INDENT_PX = 20;
const VISIBILITY_HOP_CAP = 60; // max ancestor chain length for isVisible check

// Roles shown as fixed anchor columns; excluded from the descriptor-driven layer.
// Exported for reuse by exportReviewCsv (Slice D2) so the CSV's data columns dedupe
// sl_no/description identically (they are dedicated CSV columns). No behaviour change.
export const FIXED_ROLE_DEDUPE = new Set(["sl_no", "description"]);

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
// targets one area cell) AND its value_field is one of these. qty_by_area is flat
// one-hop; rate_by_area AND amount_by_area are nested two-hop (Slice 2b) -- the
// descriptor carries the inner kind in the generic rate_subkey slot (for amount it is
// the amount kind supply/install/total). These commit through the SAME confirm dialog as
// flat numeric edits; blank -> 0.0 (the area key stays). save_review_edit takes area
// (+ rate_subkey for the two nested fields).
const EDITABLE_AREA_FIELDS = new Set<string>(["qty_by_area", "amount_by_area", "rate_by_area"]);

// C-v2c: per-row human-only remark cap (mirrors backend _REMARK_MAX_LEN). Enforced
// here as a live counter + Save-disable; the backend hard-guards the same value.
const REMARK_MAX_LEN = 250;

// Slice 1b-beta: the 4 classifications a human may assign as a restructure TARGET
// (mirrors backend _ASSIGNABLE_CLASSIFICATIONS). subtotal_marker / header_repeat are
// parser-only DETECTIONS -- valid existing/FROM states but never offered as targets.
const ASSIGNABLE_CLASSIFICATIONS = ["line_item", "preamble", "note", "spacer"] as const;

// §9 #159: the 6 classification values offered in the Classification filter checklist --
// the full FROM/read vocab (CLS_LABELS keys), NOT ASSIGNABLE_CLASSIFICATIONS (the 4 write
// targets). A filter reads all 6 existing states (incl. subtotal_marker / header_repeat).
const CLASS_FILTER_VALUES = ["preamble", "line_item", "note", "spacer", "subtotal_marker", "header_repeat"] as const;

// §9 #159: Status filter option labels. AI-3a adds the third state "ai_accepted"
// (an AI suggestion was Accepted -- distinct provenance from a plain human edit).
type StatusFilter = "all" | "edited" | "original" | "ai_accepted";
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  edited: "Edited",
  original: "Original",
  ai_accepted: "AI Accepted",
};

// AI-3a: AI Rec column filter. "all" = no narrowing (show every row); "any" = rows with a
// pending AI suggestion; "high"/"medium"/"low" = rows whose suggestion carries that
// confidence in EITHER axis (a H+M row appears in both the High and Medium views).
type AiFilter = "all" | "any" | "high" | "medium" | "low";
const AI_FILTER_LABELS: Record<AiFilter, string> = {
  all: "Show all rows",
  any: "Any AI suggestion",
  high: "Has High",
  medium: "Has Medium",
  low: "Has Low",
};

// AI-3a: a row's pending-suggestion shape, used by the AI Rec cell + the AI filter.
// A suggestion only "counts" while ai_suggestion_status === "Pending" (Accepted/Rejected
// are resolved -> no badge, no tint). Parent suggestion = a real parent index OR a root flag.
interface AiSuggestionInfo {
  pending: boolean;
  hasClass: boolean;
  hasParent: boolean;
  classConf: "High" | "Medium" | "Low" | null;
  parentConf: "High" | "Medium" | "Low" | null;
}
function aiSuggestionInfo(row: ReviewRow): AiSuggestionInfo {
  const pending = row.ai_suggestion_status === "Pending";
  const hasClass = pending && row.ai_suggested_classification != null;
  const hasParent =
    pending &&
    ((row.ai_suggested_parent != null && row.ai_suggested_parent !== -1) ||
      row.ai_suggested_is_root === 1);
  return {
    pending,
    hasClass,
    hasParent,
    classConf: hasClass ? (row.ai_classification_confidence ?? null) : null,
    parentConf: hasParent ? (row.ai_parent_confidence ?? null) : null,
  };
}
// AI-3a: does a row carry a pending suggestion at the given confidence (either axis)?
function aiHasConfidence(info: AiSuggestionInfo, level: "High" | "Medium" | "Low"): boolean {
  return info.classConf === level || info.parentConf === level;
}
// AI-3a: confidence -> small-pill classes (mirror the Status/AI-Accepted pill idiom:
// High=green, Medium=amber, Low=gray). Null confidence on a present suggestion -> gray dot.
const AI_CONF_PILL: Record<"High" | "Medium" | "Low", string> = {
  High: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200",
  Medium: "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200",
  Low: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300",
};
function AiConfBadge({ conf, title }: { conf: "High" | "Medium" | "Low" | null; title: string }) {
  const label = conf ? conf[0] : "?"; // H / M / L (or ? when the model omitted confidence)
  const cls = conf ? AI_CONF_PILL[conf] : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";
  return (
    <span
      title={title}
      className={cn(
        "rounded-full py-0.5 px-1.5 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap",
        cls,
      )}
    >
      {label}
    </span>
  );
}

// R4: short per-category labels for the warnings panel (advisory flags). Mirrors the labels the
// SheetReviewPage count strip used (FLAG_LABELS) -- moved here when the strip evolved into the
// panel. FLAG_ORDER fixes the badge/rollup ordering.
const WARN_FLAG_LABELS: Record<string, string> = {
  zero_amount_line_item: "zero-amount",
  orphan: "orphan",
  parser: "needs-review",
  priced_preamble_no_children: "priced-preamble",
};
const WARN_FLAG_ORDER = ["zero_amount_line_item", "orphan", "parser", "priced_preamble_no_children"];
// R4: labels for the must-fix structural-break group (from check_structural_integrity).
const WARN_BREAK_LABELS: Record<string, string> = {
  orphan: "Orphan line item",
  line_item_as_parent: "Line item used as a parent",
  cycle: "Parent cycle",
};

// Slice 1b-beta: local response shape of save_review_restructure (Slice 1b-alpha
// backend). Defined here -- boqTypes.ts is out of scope for this slice.
interface SaveReviewRestructureResponse {
  ok: boolean;
  row_index: number;
  new_classification: string;
  children_moved: number;
  edited_at: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ReviewTreeProps {
  rows: ReviewRow[];
  columnDescriptors: ColumnDescriptor[];
  flags: AdvisoryFlag[];
  // R4: structural breaks (must-fix) for the warnings panel, fetched by SheetReviewPage via
  // get_structural_breaks. Defaults to [] (so existing callers that omit it render no break
  // group). The panel groups these distinctly above the softer advisory flags.
  breaks?: StructuralBreak[];
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
  // Slice 1b-beta: invoked after a successful restructure (reclassify + reparent) with
  // the returned edited_at. Wired to the SAME handler as onSaved (SheetReviewPage's
  // handleSaved) -- a restructure IS a real edit, so it advances the save anchor + mutates.
  onRestructured?: (editedAt: string) => void;
  // Slice D1: when true the sheet is "Parsed Check Done" (read-only freeze). ALL write
  // affordances (value/text/area edits, reclassify, change-parent, remarks, "Looks OK")
  // are gated OUT at their render sites; every view affordance (expand/collapse, detail
  // panel display, search, filters, column selector, scroll-to-parent) stays live. The
  // backend enforces the same freeze, so this is the UI line of defence, not the only one.
  readOnly?: boolean;
  // DUAL-AI (ADR-0003 sec 8A): gates the second provider ("Gemini") column + detail-panel accept
  // block. Sourced from get_review_rows.gemini_enabled (Document AI Settings.boq_ai_enabled). When
  // false/undefined the Gemini column + block are NOT mounted -- the layout is byte-identical to
  // the Claude-only tree (totalCols / colSpans stay 8-based). ADDITIVE: every existing caller that
  // omits this prop renders exactly as before.
  geminiEnabled?: boolean;
}

export function ReviewTree({ rows, columnDescriptors, flags, breaks = [], boqName, sheetName, onSaved, onRemarkSaved, onRestructured, readOnly = false, geminiEnabled = false }: ReviewTreeProps) {
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
  // R4: warnings-panel "Show dismissed" toggle. By default the panel hides rows whose flags
  // were acknowledged ("Looks OK", flags_dismissed=1) -- parity with the pricing strip. Toggling
  // on surfaces them again (dimmed). Structural BREAKS are NEVER hidden by this toggle (a break
  // is a must-fix; dismissal only acknowledges the softer advisory flags).
  const [showDismissedWarnings, setShowDismissedWarnings] = useState(false);
  // R4: the warnings panel is collapsible (header always visible with the rollup; the entry
  // list folds away). Defaults OPEN so the warnings are visible on load.
  const [warningsPanelOpen, setWarningsPanelOpen] = useState(true);
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
  // C-flag-dismissal: per-row "Looks OK" write -- a SEPARATE endpoint + loading flag.
  // Like a remark, a dismissal never touches edited_at / edit_log / the "Edited" surface
  // (the row stays "Original"); it acknowledges the row's advisory flags. Refresh runs
  // through onRemarkSaved (mutate only -- a dismissal is NOT an edit, so the sheet-level
  // save anchor is NOT advanced).
  const { call: dismissFlagsCall, loading: isDismissingFlags } = useFrappePostCall<{
    message: { flags_dismissed: number };
  }>("nirmaan_stack.api.boq.wizard.review_screen.dismiss_row_flags");
  // Dedicated inline error for the dismiss action (kept separate from saveError/remarkError).
  const [dismissError, setDismissError] = useState<string | null>(null);
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

  // Slice 1b-beta: restructure (reclassify + place children) surface.
  // restructureModal -> the heavy with-children modal; childlessConfirm -> the light path.
  const [restructureModal, setRestructureModal] = useState<{
    row: ReviewRow;
    newClassification: string;
    // AI-3b-2: when an accepted AI parent on a WITH-children row opens the modal, the
    // parent is pre-applied (children-only mode) + the status flips on Save (cancel-safe).
    presetRowParent?: number | null;
    presetParentMessage?: string;
    markAiAccepted?: boolean;
    // DUAL-AI (ADR-0003): the Gemini mirror of markAiAccepted. Set when a WITH-children Gemini
    // accept routes here (GeminiAcceptBlock -> onOpenRestructureGemini). Independent flag.
    markGeminiAccepted?: boolean;
  } | null>(null);
  const [childlessConfirm, setChildlessConfirm] = useState<{ row: ReviewRow; newClassification: string } | null>(null);
  // Inline error for the childless confirm dialog ONLY (the modal owns its own error state).
  const [restructureError, setRestructureError] = useState<string | null>(null);
  // The restructure write (reclassify one row + reparent its children in one atomic
  // commit). Used directly by the childless light path; the with-children modal owns
  // its OWN call to the same endpoint.
  const { call: restructureCall, loading: isRestructuring } = useFrappePostCall<{ message: SaveReviewRestructureResponse }>(
    "nirmaan_stack.api.boq.wizard.review_screen.save_review_restructure",
  );

  // Slice 1b-beta: a classification target was picked from the detail-panel pill menu.
  // Childless rows take the light 1-click confirm; rows with children open the staged modal.
  // children = review rows whose effective_parent_index === this row's row_index.
  const onPickClass = (row: ReviewRow, newClassification: string) => {
    setRestructureError(null);
    const childCount = rows.filter(r => r.effective_parent_index === row.row_index).length;
    if (childCount === 0) {
      setChildlessConfirm({ row, newClassification });
    } else {
      setRestructureModal({ row, newClassification });
    }
  };

  // Childless light path: reclassify ONLY (empty child_moves), one atomic call. On
  // failure the dialog stays open with an inline error (no AlertDialogAction auto-close).
  const confirmChildlessReclassify = async () => {
    if (!childlessConfirm) return;
    setRestructureError(null);
    try {
      const res = await restructureCall({
        boq_name: boqName,
        sheet_name: sheetName, // VERBATIM untrimmed -- #152 trailing-space guard
        row_index: childlessConfirm.row.row_index,
        new_classification: childlessConfirm.newClassification,
        child_moves: {},
      });
      onRestructured?.(res.message.edited_at);
      setChildlessConfirm(null);
    } catch (e: unknown) {
      // getFrappeError decodes the real frappe.throw text from _server_messages
      // (the SDK's plain-object .message is a hardcoded generic). House pattern.
      setRestructureError(getFrappeError(e) || "Reclassify failed. Please try again.");
    }
  };

  // AI-3b-1: per-field accept/reject of a PENDING AI suggestion (NON-MODAL scope --
  // classification + CHILDLESS parent + reject). Checkbox state is seeded when the
  // detail panel opens (see the seeding effect below); a parent change on a row WITH
  // children is the AI-3b-2 (modal) path and is disabled here.
  const [aiAcceptCls, setAiAcceptCls] = useState(false);
  const [aiAcceptParent, setAiAcceptParent] = useState(false);
  const [aiActionError, setAiActionError] = useState<string | null>(null);
  const { call: acceptAiCall, loading: isAcceptingAi } = useFrappePostCall<{
    message: { ok: boolean; edited_at: string | null };
  }>("nirmaan_stack.api.boq.wizard.ai_assist.accept_ai_suggestion");
  const { call: rejectAiCall, loading: isRejectingAi } = useFrappePostCall<{
    message: { ok: boolean };
  }>("nirmaan_stack.api.boq.wizard.ai_assist.reject_ai_suggestion");
  // R3a (ADR-0006): the UNIFIED "Revert to parser". One endpoint that restores the row + any
  // children a restructure moved to the PARSER BASELINE, regardless of whether the standing change
  // was an AI acceptance (either provider) or a manual human_* edit. Replaces the two former
  // provider-specific reverts (revert_ai_acceptance / revert_gemini_acceptance). Returns no
  // edited_at, so the refresh runs through onRemarkSaved (mutate-only full re-fetch) -- the row
  // re-renders clean (no override): badges/tint/accept blocks reset and AI Apply re-enables.
  const { call: revertToParserCall, loading: isRevertingToParser } = useFrappePostCall<{
    message: { ok: boolean; reverted_children: number[] };
  }>("nirmaan_stack.api.boq.wizard.review_screen.revert_to_parser");

  // Apply the checked AI suggestion(s). On success reuse onSaved -> mutate (the row
  // re-fetches with status "Accepted": badge clears, Status -> "AI Accepted").
  // AI-3b-2: a PARENT accept on a row WITH CHILDREN cannot apply directly (the children
  // need disposition) -> open the children-only RestructureModal with the AI parent
  // pre-applied + markAiAccepted (the status flips cancel-safely on the modal's Save).
  // Otherwise (classification-only, or a CHILDLESS parent) the AI-3b-1 accept endpoint
  // path runs unchanged.
  const handleApplyAi = async (row: ReviewRow) => {
    setAiActionError(null);
    const ai = aiSuggestionInfo(row);
    const clsIsChange = aiAcceptCls && ai.hasClass &&
      row.ai_suggested_classification !== row.effective_classification;
    const isRoot = row.ai_suggested_is_root === 1;
    const parentIsChange = ai.hasParent && (
      isRoot ? row.effective_parent_index !== null
             : row.ai_suggested_parent !== row.effective_parent_index
    );
    const parentAccept = aiAcceptParent && parentIsChange;
    // AI-3c-3: mirror the manual onPickClass rule -- ANY accepted change on a row WITH
    // children opens the child-disposition RestructureModal (a classification change to a
    // non-parent class, e.g. Preamble->note, would otherwise silently orphan the children
    // under a now-non-parent row; check_structural_integrity does not catch note-as-parent).
    // A classification-ONLY accept must NOT force a parent move: OMIT presetRowParent so the
    // modal defaults to "keep" the row's own parent (exactly what manual reclassify does).
    if (hasChildrenSet.has(row.row_index) && (clsIsChange || parentAccept)) {
      const presetRowParent = parentAccept
        ? (isRoot ? -1 : (row.ai_suggested_parent ?? -1))
        : undefined;
      const parentLabel = isRoot
        ? "Top level (root)"
        : (() => {
            const src = presetRowParent !== undefined
              ? byIdx.get(presetRowParent)?.source_row_number
              : undefined;
            return src !== undefined ? `row ${src}` : `#${presetRowParent}`;
          })();
      setRestructureModal({
        row,
        // Fold an accepted classification change into the SAME restructure call; else a
        // no-op reclassify (current effective class) -- exactly the #162 door's pattern.
        newClassification: clsIsChange
          ? (row.ai_suggested_classification as string)
          : (row.effective_classification as string),
        // Parent move only when a parent change is being accepted; omitted otherwise
        // (-> modal keeps the row's own parent, child-disposition only).
        ...(presetRowParent !== undefined
          ? {
              presetRowParent,
              presetParentMessage: `Parent set to ${parentLabel} per AI suggestion — choose what happens to this row's children below.`,
            }
          : {}),
        markAiAccepted: true,
      });
      return;
    }
    try {
      const res = await acceptAiCall({
        boq_name: boqName,
        sheet_name: sheetName, // VERBATIM untrimmed -- #152
        row_index: row.row_index,
        accept_classification: aiAcceptCls,
        accept_parent: aiAcceptParent,
      });
      onSaved?.(res.message.edited_at ?? "");
    } catch (e: unknown) {
      setAiActionError(getFrappeError(e) || "Could not apply the AI suggestion.");
    }
  };

  // Reject: status-only (not a data edit) -> mutate-only refresh via onRemarkSaved
  // (no edited_at to thread; the row stays "Original", the badge + tint clear).
  const handleRejectAi = async (row: ReviewRow) => {
    setAiActionError(null);
    try {
      await rejectAiCall({
        boq_name: boqName,
        sheet_name: sheetName, // VERBATIM untrimmed -- #152
        row_index: row.row_index,
      });
      onRemarkSaved?.();
    } catch (e: unknown) {
      setAiActionError(getFrappeError(e) || "Could not reject the AI suggestion.");
    }
  };

  // R3a (ADR-0006): the UNIFIED "Revert to parser" handler. Restores the row + any children a
  // restructure moved to the parser baseline -- regardless of whether the standing change was an
  // AI acceptance (either provider) or a manual edit. mutate-only refresh (no edited_at; the
  // re-fetch re-renders the row clean so the Revert button disappears and AI Apply re-enables).
  const handleRevertToParser = async (row: ReviewRow) => {
    setAiActionError(null);
    try {
      await revertToParserCall({
        boq_name: boqName,
        sheet_name: sheetName, // VERBATIM untrimmed -- #152
        row_index: row.row_index,
      });
      onRemarkSaved?.();
    } catch (e: unknown) {
      setAiActionError(getFrappeError(e) || "Could not revert this row to the parser baseline.");
    }
  };

  // DUAL-AI (ADR-0003): open the SHARED RestructureModal for a WITH-children Gemini accept.
  // Mirror of handleApplyAi's setRestructureModal route, with markGeminiAccepted set (so the
  // modal's Save flips gemini_suggestion_status="Accepted" cancel-safely). GeminiAcceptBlock owns
  // the accept-axis math + the preset-parent decision and calls this with the resolved args.
  const onOpenRestructureGemini = (args: {
    row: ReviewRow;
    newClassification: string;
    presetRowParent?: number | null;
    presetParentMessage?: string;
  }) => {
    setRestructureModal({
      row: args.row,
      newClassification: args.newClassification,
      ...(args.presetRowParent !== undefined
        ? { presetRowParent: args.presetRowParent, presetParentMessage: args.presetParentMessage }
        : {}),
      markGeminiAccepted: true,
    });
  };

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

  // A2 edit-log clarity (render-time): translate a stored parent value (internal
  // row_index, or null/-1 for root) to an Excel-row label. Matches the detail
  // panel's own parent-label copy (root / row N / raw-number fallback) for
  // in-panel consistency. Defensive: an index not in the current set falls back
  // to the raw number (no crash).
  const editParentLabel = (v: unknown): string => {
    if (v === null || v === undefined) return "root";
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) return "root";
    const src = byIdx.get(n)?.source_row_number;
    return src !== undefined ? `row ${src}` : String(n);
  };

  // A2 edit-log clarity: derive an honest verb + display detail per edit_log entry.
  // Returns null to SUPPRESS the entry entirely -- the #162 "Change parent" door
  // writes a no-op same-value human_classification entry alongside the real
  // human_parent move; rendering it would duplicate the move, so it is dropped.
  const describeEditEntry = (entry: EditLogEntry): DescribedEditEntry | null => {
    if (entry.field === "human_classification") {
      if (entry.from !== entry.to) {
        const f = CLS_LABELS[String(entry.from ?? "")] ?? String(entry.from ?? "—");
        const t = CLS_LABELS[String(entry.to ?? "")] ?? String(entry.to ?? "—");
        return { verb: "Reclassified", detail: `${f} → ${t}`, showField: false };
      }
      return null; // no-op reclassify (#162) -- suppress
    }
    if (entry.field === "human_parent") {
      return {
        verb: "Moved parent",
        detail: `${editParentLabel(entry.from)} → ${editParentLabel(entry.to)}`,
        showField: false,
      };
    }
    // value / text / per-area edits: keep the raw from->to + field name (and the
    // existing area / rate_subkey suffix at the render site) exactly as before.
    return {
      verb: "Edited",
      detail: `${String(entry.from ?? "—")} → ${String(entry.to ?? "—")}`,
      showField: true,
    };
  };

  // Descriptor processing: dedupe fixed-anchor roles, extract anchor letters, area map.
  const { displayDescriptors, appendDescriptors, slNoLetter, descriptionLetter, areaColorMap, editableDescriptors, editableTextDescriptors, editableAreaDescriptors } = useMemo(() => {
    const displayDescriptors = columnDescriptors.filter(d => !FIXED_ROLE_DEDUPE.has(d.role));
    // append-to-notes-as-columns: the mapped append-columns, already in Excel-letter
    // order (the backend :649 sort). These ALSO render in-position as ordinary
    // descriptor columns (they're in displayDescriptors); this subset additionally
    // feeds the combined "Append Notes" column pinned LAST. Independent of visibleCols
    // (the combined column always aggregates every append value).
    const appendDescriptors = displayDescriptors.filter(d => d.role === "append_to_notes");
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
      appendDescriptors,
      slNoLetter,
      descriptionLetter,
      areaColorMap: buildAreaColorMap(areas),
      editableDescriptors,
      editableTextDescriptors,
      editableAreaDescriptors,
    };
  }, [columnDescriptors]);

  // append-to-notes-as-columns: render the combined "Append Notes" column only when
  // the sheet actually maps append-columns (no empty trailing column otherwise).
  const hasAppendCombined = appendDescriptors.length > 0;

  // append-to-notes-as-columns: build the combined-cell string for one row -- every
  // non-empty append value, in Excel-letter order, as "<header-else-letter>: <value>"
  // joined by " | ". The prefix is the descriptor's value_key (= column_headers.get
  // (col, col), the SAME header-else-letter key the parser stored), so it reads
  // human-friendly when headers are mapped and falls back to the letter otherwise.
  // Numeric-looking note strings are NOT coerced. Empty -> "" (blank cell).
  const buildAppendCombined = (row: ReviewRow): string => {
    const parts: string[] = [];
    for (const d of appendDescriptors) {
      const v = resolveDescriptorValue(row, d);
      if (v === null || v === undefined) continue;
      const s = String(v);
      if (s.trim() === "") continue;
      parts.push(`${d.value_key ?? d.col}: ${s}`);
    }
    return parts.join(" | ");
  };

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

  // §9 #159: find & filter state (frontend-only, strict-hide + ring-highlighted search).
  // statusFilter: edit-provenance filter (predicate = the isEdited expression, see passesFilter).
  // classFilter: SHOW-set seeded with all 6 CLS_LABELS values; size === 6 => no narrowing,
  //   unchecking a type hides it (effective_classification membership). Empty set => show none.
  // searchQuery/searchCurrentIdx: description substring search + the cycling hit pointer.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // AI-3a: AI Rec column filter (default "all" = no narrowing).
  const [aiFilter, setAiFilter] = useState<AiFilter>("all");
  // DUAL-AI (ADR-0003): Gemini column filter -- mirror of aiFilter (default "all" = no narrowing).
  const [geminiFilter, setGeminiFilter] = useState<GeminiFilter>("all");
  const [classFilter, setClassFilter] = useState<Set<string>>(() => new Set(CLASS_FILTER_VALUES));
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCurrentIdx, setSearchCurrentIdx] = useState(0);

  const toggleCol = (col: string) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  };

  // §9 #159: toggle one classification value in the Classification filter SHOW-set.
  const toggleClassFilter = (cls: string) => {
    setClassFilter(prev => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls); else next.add(cls);
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
      setSaveError(getFrappeError(e) || "Save failed. Please try again.");
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
      setSaveError(getFrappeError(e) || "Save failed. Please try again.");
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
      setRemarkError(getFrappeError(e) || "Save failed. Please try again.");
    }
  };

  // C-flag-dismissal: per-row "Looks OK" dismissal of a row's advisory flags. Like a
  // remark, this does NOT flip the row to "Edited" (the backend writes only the
  // flags_dismissed fields, never edited_at / edit_log). Refresh via onRemarkSaved
  // (mutate only -- not a real edit, so the sheet edit anchor is not advanced).
  const dismissFlags = async (rowIndex: number, dismissed: boolean) => {
    setDismissError(null);
    try {
      await dismissFlagsCall({
        boq_name: boqName,
        sheet_name: sheetName, // VERBATIM untrimmed -- #152 trailing-space guard
        row_index: rowIndex,
        dismissed,
      });
      onRemarkSaved?.();
    } catch (e: unknown) {
      setDismissError(getFrappeError(e) || "Could not update. Please try again.");
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

  // R4: warnings-panel model. ONE entry PER ROW that carries a structural break and/or advisory
  // flag(s). Each entry tags whether the row is a must-fix (has a break) and whether it was
  // dismissed ("Looks OK"). The panel renders break-rows distinctly (above) from advisory-only
  // rows, and hides dismissed rows by default. Built off `breaks` + `flags` + rows.flags_dismissed.
  const warningRows = useMemo(() => {
    const dismissedIdx = new Set(rows.filter(r => !!r.flags_dismissed).map(r => r.row_index));
    const byIdxLocal = new Map<number, ReviewRow>(rows.map(r => [r.row_index, r]));
    const map = new Map<number, {
      rowIndex: number;
      excelRow: number | null;
      breaks: StructuralBreak[];
      flags: AdvisoryFlag[];
      dismissed: boolean;
    }>();
    const ensure = (rowIndex: number, srn: number | null) => {
      let e = map.get(rowIndex);
      if (!e) {
        e = {
          rowIndex,
          excelRow: srn ?? byIdxLocal.get(rowIndex)?.source_row_number ?? null,
          breaks: [],
          flags: [],
          // A break is a must-fix and NEVER counts as dismissed (dismissal acknowledges advisory
          // flags only); this flag drives the default hide of advisory-only dismissed rows.
          dismissed: dismissedIdx.has(rowIndex),
        };
        map.set(rowIndex, e);
      }
      return e;
    };
    for (const b of breaks) ensure(b.row_index, b.source_row_number).breaks.push(b);
    for (const f of flags) ensure(f.row_index, f.source_row_number).flags.push(f);
    // Sort breaks-first, then by Excel row for stable, scannable order.
    return Array.from(map.values()).sort((a, b) => {
      const aBreak = a.breaks.length > 0 ? 0 : 1;
      const bBreak = b.breaks.length > 0 ? 0 : 1;
      if (aBreak !== bBreak) return aBreak - bBreak;
      return (a.excelRow ?? 0) - (b.excelRow ?? 0);
    });
  }, [rows, breaks, flags]);

  // R4: the must-fix (break) vs advisory split, and the dismissed-hide gate.
  const breakWarnRows = warningRows.filter(w => w.breaks.length > 0);
  // Advisory-only rows (no break). A break row is always shown (never dismissible); an
  // advisory-only row is hidden by default once dismissed unless "Show dismissed" is on.
  const advisoryWarnRows = warningRows.filter(w => w.breaks.length === 0);
  const visibleAdvisoryWarnRows = showDismissedWarnings
    ? advisoryWarnRows
    : advisoryWarnRows.filter(w => !w.dismissed);
  const dismissedAdvisoryCount = advisoryWarnRows.filter(w => w.dismissed).length;
  const hasAnyWarning = warningRows.length > 0;

  // R4: per-category advisory rollup for the panel header (evolved from the SheetReviewPage
  // count strip). "N label – M cleared" where cleared = flags of that type on a dismissed row.
  const warnSummaryParts = useMemo(() => {
    const dismissedIdx = new Set(rows.filter(r => !!r.flags_dismissed).map(r => r.row_index));
    const counts: Record<string, number> = {};
    const cleared: Record<string, number> = {};
    for (const f of flags) {
      counts[f.type] = (counts[f.type] ?? 0) + 1;
      if (dismissedIdx.has(f.row_index)) cleared[f.type] = (cleared[f.type] ?? 0) + 1;
    }
    return WARN_FLAG_ORDER
      .filter(t => (counts[t] ?? 0) > 0)
      .map(t => {
        const c = cleared[t] ?? 0;
        const base = `${counts[t]} ${WARN_FLAG_LABELS[t]}`;
        return c > 0 ? `${base} – ${c} cleared` : base;
      });
  }, [rows, flags]);

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
      setAiAcceptCls(false);
      setAiAcceptParent(false);
      setAiActionError(null);
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
    // AI-3b-1: seed the accept checkboxes -- default checked when the AI suggests a REAL
    // change (different from the current effective value). A parent change on a row WITH
    // children is the AI-3b-2 path -> not auto-checked here (the checkbox is disabled).
    const ai = aiSuggestionInfo(r);
    const clsIsChange = ai.hasClass && r.ai_suggested_classification !== r.effective_classification;
    const parentIsChange = ai.hasParent && (
      r.ai_suggested_is_root === 1
        ? r.effective_parent_index !== null
        : r.ai_suggested_parent !== r.effective_parent_index
    );
    setAiAcceptCls(clsIsChange);
    // AI-3b-2: default-check a real parent change even on a with-children row (Apply then
    // routes through the children-only modal). The seed comment below still notes the route.
    setAiAcceptParent(parentIsChange);
    setAiActionError(null);
  }, [expandedDetailRow, byIdx, hasChildrenSet, editableDescriptors, editableTextDescriptors, editableAreaDescriptors]);

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

  // §9 #159: filter predicates (Status AND Classification). passesFilter is the
  // SHOWN-predicate used by BOTH the render gate and the searchHits memo (compose
  // interlock) -- so a search hit can never be a filtered-out row.
  const allClassesShown = classFilter.size === CLASS_FILTER_VALUES.length;
  const statusFilterActive = statusFilter !== "all";
  const classFilterActive = !allClassesShown;
  const aiFilterActive = aiFilter !== "all";
  // DUAL-AI (ADR-0003): the Gemini filter-active styling is derived inside GeminiHeaderCell
  // (from its geminiFilter prop), so no ReviewTree-level "active" flag is needed here.
  const passesFilter = (row: ReviewRow): boolean => {
    // Status predicate. AI-3a: "ai_accepted" keys on ai_suggestion_status; edited/original
    // use the isEdited expression (mirrors the inline at the render row; a remark-only row
    // is Original since save_review_remark never stamps edited_at/edit_log).
    if (statusFilter === "ai_accepted") {
      if (row.ai_suggestion_status !== "Accepted") return false;
    } else if (statusFilter !== "all") {
      const edited = row.edited_at !== null || (Array.isArray(row.edit_log) && row.edit_log.length > 0);
      if (statusFilter === "edited" ? !edited : edited) return false;
    }
    // Classification predicate -- effective_classification ∈ the SHOW-set (all-shown == pass).
    if (!allClassesShown) {
      const cls = row.effective_classification;
      if (cls === null || !classFilter.has(cls)) return false;
    }
    // AI-3a: AI Rec predicate. "any" = a pending suggestion exists; high/medium/low = a
    // pending suggestion at that confidence in either axis. "all" = no narrowing.
    if (aiFilter !== "all") {
      const info = aiSuggestionInfo(row);
      if (aiFilter === "any") {
        if (!(info.hasClass || info.hasParent)) return false;
      } else {
        const level = aiFilter === "high" ? "High" : aiFilter === "medium" ? "Medium" : "Low";
        if (!aiHasConfidence(info, level)) return false;
      }
    }
    // DUAL-AI (ADR-0003): Gemini predicate -- mirror of the AI predicate, gated on geminiEnabled
    // (the filter cannot narrow when the column is not mounted). "any" = a pending Gemini
    // suggestion exists; high/medium/low = a pending suggestion at that confidence in either axis.
    if (geminiEnabled && geminiFilter !== "all") {
      const info = geminiSuggestionInfo(row);
      if (geminiFilter === "any") {
        if (!(info.hasClass || info.hasParent)) return false;
      } else {
        const level = geminiFilter === "high" ? "High" : geminiFilter === "medium" ? "Medium" : "Low";
        if (!geminiHasConfidence(info, level)) return false;
      }
    }
    return true;
  };

  // §9 #159: search hit list -- ordered row_index of rows that pass the SAME shown-filter
  // (classificationVisible + passesFilter) AND whose description matches the query. Collapse
  // (isVisible) is DELIBERATELY excluded: a hit under a collapsed parent IS a hit, and
  // stepping to it auto-expands via revealAndScrollToRow. Empty query => no hits.
  const searchHits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q === "") return [];
    const out: number[] = [];
    for (const row of rows) {
      if (!classificationVisible(row)) continue;
      if (!passesFilter(row)) continue;
      const d = row.description;
      if (d && d.toLowerCase().includes(q)) out.push(row.row_index);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, searchQuery, statusFilter, classFilter, aiFilter, geminiFilter, geminiEnabled, showSpacers, showNotes, showSubtotals]);

  const searchHitSet = useMemo(() => new Set(searchHits), [searchHits]);
  // Reset the hit pointer whenever the hit set changes (mirror SheetSearchView :288-290).
  useEffect(() => { setSearchCurrentIdx(0); }, [searchHits]);
  const safeSearchIdx = searchHits.length > 0 ? Math.min(searchCurrentIdx, searchHits.length - 1) : 0;
  const currentHitRowIdx = searchHits.length > 0 ? searchHits[safeSearchIdx] : null;

  // Cycling steppers (modulo wrap, both directions). On step, reuse revealAndScrollToRow
  // so the new current hit auto-expands collapsed ancestors + scrolls + flashes.
  const stepSearchPrev = () => {
    if (searchHits.length === 0) return;
    const ni = (safeSearchIdx - 1 + searchHits.length) % searchHits.length;
    setSearchCurrentIdx(ni);
    revealAndScrollToRow(searchHits[ni]);
  };
  const stepSearchNext = () => {
    if (searchHits.length === 0) return;
    const ni = (safeSearchIdx + 1) % searchHits.length;
    setSearchCurrentIdx(ni);
    revealAndScrollToRow(searchHits[ni]);
  };

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">No rows found for this sheet.</p>
    );
  }

  const hiddenColCount = displayDescriptors.filter(d => !visibleCols.has(d.col)).length;

  return (
    <div className="space-y-3">
      {/* ── R4: Warnings panel ───────────────────────────────────────────────────
          A clickable list of rows needing attention, ONE entry per row. Structural BREAKS
          (must-fix: line_item_as_parent, cycle, orphan) group distinctly ABOVE the softer
          advisory flags. Clicking an entry reveals + scrolls to that row (revealAndScrollToRow:
          expand collapsed ancestors, smooth scroll block:'nearest', 1.5s amber pulse -- no focus).
          The count + "– N cleared" rollup (evolved from the SheetReviewPage strip) lives in the
          header. Dismissed advisory rows hide by default behind a "Show dismissed" toggle. */}
      {hasAnyWarning && (
        <div className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/15 overflow-hidden">
          {/* Header: collapse toggle + counts rollup + "Show dismissed" toggle. */}
          <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
            <button
              type="button"
              onClick={() => setWarningsPanelOpen(o => !o)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-200 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
              aria-expanded={warningsPanelOpen}
              aria-label={warningsPanelOpen ? "Collapse warnings" : "Expand warnings"}
            >
              {warningsPanelOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>
                Warnings
                {breakWarnRows.length > 0 && (
                  <span className="ml-1 text-red-700 dark:text-red-300">
                    · {breakWarnRows.length} must-fix
                  </span>
                )}
              </span>
            </button>
            {warnSummaryParts.length > 0 && (
              <span className="text-xs text-amber-700/90 dark:text-amber-300/90">
                {warnSummaryParts.join(" · ")}
              </span>
            )}
            {/* "Show dismissed" toggle -- only meaningful when there are dismissed advisory rows. */}
            {dismissedAdvisoryCount > 0 && (
              <button
                type="button"
                onClick={() => setShowDismissedWarnings(s => !s)}
                className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <CheckCircle2 className="h-3 w-3" />
                {showDismissedWarnings
                  ? `Hide dismissed (${dismissedAdvisoryCount})`
                  : `Show dismissed (${dismissedAdvisoryCount})`}
              </button>
            )}
          </div>

          {warningsPanelOpen && (
            <div className="border-t border-amber-200/60 dark:border-amber-900/40 px-2 py-2 space-y-2">
              {/* Must-fix structural breaks -- grouped distinctly above the advisories. */}
              {breakWarnRows.length > 0 && (
                <div className="space-y-1">
                  <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300 flex items-center gap-1">
                    <AlertOctagon className="h-3 w-3" /> Must fix
                  </p>
                  {breakWarnRows.map((w) => (
                    <button
                      key={`brk-${w.rowIndex}`}
                      type="button"
                      onClick={() => revealAndScrollToRow(w.rowIndex)}
                      className="w-full text-left flex items-start gap-2 rounded px-2 py-1.5 bg-red-50/70 dark:bg-red-950/25 border border-red-200/70 dark:border-red-900/40 hover:bg-red-100/70 dark:hover:bg-red-950/40 transition-colors"
                    >
                      <span className="shrink-0 mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {w.excelRow !== null ? `Row ${w.excelRow}` : `#${w.rowIndex}`}
                      </span>
                      <span className="flex flex-col gap-0.5 min-w-0">
                        <span className="flex flex-wrap gap-1">
                          {w.breaks.map((b, i) => (
                            <span
                              key={i}
                              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 whitespace-nowrap"
                            >
                              {WARN_BREAK_LABELS[b.type] ?? b.type}
                            </span>
                          ))}
                        </span>
                        <span className="text-[11px] text-red-700/90 dark:text-red-300/90 leading-snug">
                          {w.breaks.map(b => b.reason).join(" · ")}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Advisory flags -- one clickable entry per row (dismissed rows hidden by default). */}
              {visibleAdvisoryWarnRows.length > 0 && (
                <div className="space-y-1">
                  {breakWarnRows.length > 0 && (
                    <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Advisory
                    </p>
                  )}
                  {visibleAdvisoryWarnRows.map((w) => (
                    <button
                      key={`flg-${w.rowIndex}`}
                      type="button"
                      onClick={() => revealAndScrollToRow(w.rowIndex)}
                      className={cn(
                        "w-full text-left flex items-start gap-2 rounded px-2 py-1.5 border transition-colors",
                        w.dismissed
                          ? "bg-muted/30 border-border opacity-60 hover:opacity-90"
                          : "bg-amber-50/70 dark:bg-amber-950/20 border-amber-200/70 dark:border-amber-900/40 hover:bg-amber-100/70 dark:hover:bg-amber-950/35",
                      )}
                    >
                      <span className="shrink-0 mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {w.excelRow !== null ? `Row ${w.excelRow}` : `#${w.rowIndex}`}
                      </span>
                      <span className="flex flex-col gap-0.5 min-w-0">
                        <span className="flex flex-wrap items-center gap-1">
                          {w.flags.map((f, i) => (
                            <span
                              key={i}
                              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 whitespace-nowrap"
                            >
                              {WARN_FLAG_LABELS[f.type] ?? f.type}
                            </span>
                          ))}
                          {w.dismissed && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <CheckCircle2 className="h-3 w-3" /> Looks OK
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] text-amber-700/90 dark:text-amber-300/90 leading-snug">
                          {w.flags.map(f => f.reason).join(" · ")}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
        {/* §9 #159: description search box -- mirrors SheetSearchView's hit-stepper PATTERN
            (cycling + N-of-M counter), NOT imported. Stepping calls the existing
            revealAndScrollToRow so a hit under a collapsed parent auto-expands. */}
        <div className="flex items-center gap-1.5 ml-auto">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search description…"
              className="h-8 w-56 pl-7 pr-7 text-xs"
              aria-label="Search descriptions"
            />
            {searchQuery !== "" && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <span className="min-w-[52px] text-xs tabular-nums text-muted-foreground">
            {searchHits.length === 0 ? "0 of 0" : `${safeSearchIdx + 1} of ${searchHits.length}`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={searchHits.length === 0}
            onClick={stepSearchPrev}
            aria-label="Previous match"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={searchHits.length === 0}
            onClick={stepSearchNext}
            aria-label="Next match"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
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
              {/* Status (B2c): edit-provenance badge -- green "Edited" or blank. Not frozen-left.
                  §9 #159: header-cell Popover filter (Edited / Original / All) on statusFilter. */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-20 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
                <div className="flex items-center gap-1">
                  <span>Status</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          "inline-flex items-center justify-center h-4 w-4 rounded transition-colors",
                          statusFilterActive
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-muted-foreground/60 hover:text-foreground",
                        )}
                        aria-label="Filter by status"
                        title="Filter by status"
                      >
                        <Filter className="h-3 w-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto min-w-[140px] p-2">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Status</p>
                      <div className="space-y-0.5">
                        {(["all", "edited", "original", "ai_accepted"] as const).map(opt => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setStatusFilter(opt)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors",
                              statusFilter === opt
                                ? "bg-muted font-medium text-foreground"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                            )}
                          >
                            {STATUS_FILTER_LABELS[opt]}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </th>
              {/* AI Rec (AI-3a): confidence badges for a pending AI suggestion. Filter
                  Popover mirrors the Status/Classification filter pattern. */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-20 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
                <div className="flex items-center gap-1">
                  <span>AI Rec</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          "inline-flex items-center justify-center h-4 w-4 rounded transition-colors",
                          aiFilterActive
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-muted-foreground/60 hover:text-foreground",
                        )}
                        aria-label="Filter by AI suggestion"
                        title="Filter by AI suggestion"
                      >
                        <Filter className="h-3 w-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto min-w-[160px] p-2">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">AI suggestion</p>
                      <div className="space-y-0.5">
                        {(["all", "any", "high", "medium", "low"] as const).map(opt => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setAiFilter(opt)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors",
                              aiFilter === opt
                                ? "bg-muted font-medium text-foreground"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                            )}
                          >
                            {AI_FILTER_LABELS[opt]}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </th>
              {/* Gemini (DUAL-AI, ADR-0003): SECOND provider column -- mounted directly after the
                  Claude "AI Rec" header. Visual clone of the AI Rec <th>; only when geminiEnabled. */}
              {geminiEnabled && (
                <GeminiHeaderCell geminiFilter={geminiFilter} setGeminiFilter={setGeminiFilter} />
              )}
              {/* Sl.No: letter from the sl_no descriptor col, if mapped */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
                {slNoLetter ? `Sl.No (${slNoLetter})` : "Sl.No"}
              </th>
              {/* Parent (FIX 1): parent row's Excel row number -- derived, no mapped letter */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
                Parent
              </th>
              {/* Classification (B1.1b-iii): fixed anchor -- chevron + pill; no mapped letter.
                  §9 #159: header-cell Popover filter -- checklist of the 6 CLS_LABELS values
                  (effective_classification), NOT the 4 assignable write-targets. */}
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-36 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
                <div className="flex items-center gap-1">
                  <span>Classification</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          "inline-flex items-center justify-center h-4 w-4 rounded transition-colors",
                          classFilterActive
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-muted-foreground/60 hover:text-foreground",
                        )}
                        aria-label="Filter by classification"
                        title="Filter by classification"
                      >
                        <Filter className="h-3 w-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto min-w-[160px] p-2">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Classification</p>
                      <div className="space-y-1">
                        {CLASS_FILTER_VALUES.map(c => (
                          <label
                            key={c}
                            htmlFor={`cls-filter-${c}`}
                            className="flex items-center gap-2 py-0.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Checkbox
                              id={`cls-filter-${c}`}
                              checked={classFilter.has(c)}
                              onCheckedChange={() => toggleClassFilter(c)}
                            />
                            {CLS_LABELS[c] ?? c}
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
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
              {/* append-to-notes-as-columns: combined "Append Notes" column PINNED LAST.
                  A hand-written trailing anchor (NOT a descriptor -- forcing last via a
                  descriptor would fight the Excel-letter sort). Shown only when the sheet
                  maps append-columns. NOT in the column-subset selector. */}
              {hasAppendCombined && (
                <th className="px-2 py-2 text-left font-medium text-muted-foreground w-48 min-w-[180px] border-l border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
                  Append Notes
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              if (!isVisible(row)) return null;
              // B1.1b-ii FEAT B: classification-visibility gate (annotation rows only).
              // Children of a filtered row render independently at their original depth.
              if (!classificationVisible(row)) return null;
              // §9 #159: Status + Classification filter gate (strict hide). Combines with
              // the two gates above (AND); a non-matching row emits no <tr>. passesFilter is
              // the SAME predicate searchHits is computed over (compose interlock).
              if (!passesFilter(row)) return null;

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
              // C-flag-dismissal: row was acknowledged via "Looks OK". The flags STILL
              // compute (orthogonal); this only greys the marker + reads "Reviewed".
              // A dismissal is NOT an edit -- the row stays "Original" (isEdited untouched).
              const isDismissed = !!row.flags_dismissed;
              // B2a-fix OBS-1: reveal when show-all is on OR this row is the single open row.
              const flagsExpanded = hasFlags && (showAllFlags || expandedFlagRow === row.row_index);
              // C-v2c (polish): the remark marker is ALWAYS shown when the row carries a
              // non-empty remark -- a marker's job is to advertise the remark, so no toggle
              // or open-panel gating. Clicking the marker opens the detail panel (no reveal row).
              const hasRemark = typeof row.remarks === "string" && row.remarks.trim() !== "";
              const remarkMarkerShown = hasRemark;
              // B2c: colSpan for flag-reasons + detail panel rows -- 8 fixed anchors
              // (expander, Excel Row, Status, AI Rec [AI-3a], Sl.No, Parent, Classification,
              // Description). append-to-notes-as-columns: +1 when "Append Notes" is shown.
              // DUAL-AI (ADR-0003): +1 when the Gemini column is mounted (geminiEnabled) -- the
              // 9th fixed anchor sits between AI Rec and Sl.No. Drives EVERY colSpan below (the
              // flag-reasons row + the inline detail-panel row both span totalCols).
              const visibleDescriptorCount = displayDescriptors.filter(d => visibleCols.has(d.col)).length;
              const totalCols = 8 + (geminiEnabled ? 1 : 0) + visibleDescriptorCount + (hasAppendCombined ? 1 : 0);
              // B2c: edit-provenance rule -- edited_at set OR edit_log non-empty.
              const isEdited = row.edited_at !== null || (Array.isArray(row.edit_log) && row.edit_log.length > 0);
              // AI-3a: pending-suggestion shape for the AI Rec cell + the row tint.
              const aiInfo = aiSuggestionInfo(row);
              const hasPendingAi = aiInfo.hasClass || aiInfo.hasParent;
              // R1 (ADR-0006 sec 5): Gemini DIFFS-ONLY pending shape -- drives a VIOLET tint that
              // mirrors the Claude indigo one. geminiSuggestionInfo is now diffs-only (vs parser),
              // so this is true only when Gemini genuinely diverges. Gated on geminiEnabled so the
              // tint never appears when the Gemini column is not mounted.
              const geminiInfo = geminiEnabled ? geminiSuggestionInfo(row) : null;
              const hasPendingGemini = !!geminiInfo && (geminiInfo.hasClass || geminiInfo.hasParent);
              // Both-providers-disagree precedence: Claude keeps the full-row indigo tint; Gemini
              // then shows only as a VIOLET LEFT-EDGE ACCENT (a left border), so both signals stay
              // visible. Gemini gets the full-row violet tint only when Claude is NOT also pending.
              const geminiFullTint = hasPendingGemini && !hasPendingAi;
              const geminiEdgeAccent = hasPendingGemini && hasPendingAi;

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
              // Slice §9 #162: the standalone "Change parent" door is offered ONLY when the
              // row's CURRENT classification is one of the 4 assignable classes. The button
              // opens the modal via a no-op reclassify (newClassification = current class);
              // for subtotal_marker / header_repeat that no-op would be rejected by the
              // backend _ASSIGNABLE_CLASSIFICATIONS gate, so the door must not appear there.
              const canChangeParent =
                row.effective_classification != null &&
                (ASSIGNABLE_CLASSIFICATIONS as readonly string[]).includes(row.effective_classification);

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
                      // AI-3a: subtle indigo tint for a row carrying a PENDING AI suggestion.
                      // Placed BEFORE the edited-green tint so an edited row stays green
                      // (twMerge keeps the last conflicting bg-*), and BEFORE the amber flash
                      // so the scroll-highlight still wins on flash (existing tint ordering).
                      hasPendingAi && "bg-indigo-50/50 dark:bg-indigo-950/20",
                      // R1: full-row VIOLET tint when ONLY Gemini diverges (Claude not pending).
                      // Same ordering slot as the indigo tint (before green so an edited row stays
                      // green). When BOTH disagree, Claude's indigo above wins the full-row tint and
                      // Gemini falls back to the left-edge accent below.
                      geminiFullTint && "bg-violet-50/50 dark:bg-violet-950/20",
                      // R1 both-disagree: VIOLET left-edge accent so the Gemini signal stays visible
                      // alongside Claude's full-row indigo. A left border (not a bg-*) so it composes
                      // with the indigo tint instead of overwriting it.
                      geminiEdgeAccent && "border-l-2 border-l-violet-400 dark:border-l-violet-500",
                      isEdited && "bg-green-50 dark:bg-green-950/30",
                      // FIX 1: transient amber flash wins over green tint (placed after in cn())
                      highlightedIdx === row.row_index && "bg-amber-100 dark:bg-amber-900/40",
                      // §9 #159 search highlight -- RINGS (inset box-shadow), layered OVER the
                      // background tiers above so they never mask the edited-green / preamble
                      // tints (the collision rule). Soft ring = all hits; strong = current hit
                      // (mutually exclusive so the two ring widths can't conflict in Tailwind).
                      searchHitSet.has(row.row_index) && currentHitRowIdx !== row.row_index && "ring-1 ring-inset ring-blue-300 dark:ring-blue-700",
                      currentHitRowIdx === row.row_index && "ring-2 ring-inset ring-blue-500 dark:ring-blue-400",
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

                    {/* Status (B2c): edit-provenance badge -- not frozen-left.
                        AI-3a: an accepted suggestion (indigo/violet) takes precedence over Edited
                        -- an accepted suggestion writes to human_* and would otherwise read
                        "Edited", erasing the provenance.
                        DUAL-AI (ADR-0003): the badge is SOURCE-TAGGED. "Accepted · Claude" when the
                        Claude suggestion is Accepted (indigo, unchanged hue); "Accepted · Gemini"
                        when the Gemini suggestion is Accepted (violet). Only one can be Accepted at
                        a time (the backend enforces exactly-one-Source). Claude is checked FIRST so
                        its existing badge path is byte-identical to before for the Claude case. */}
                    <td className="px-2 py-1.5 align-top w-20 border-r border-border">
                      {row.ai_suggestion_status === "Accepted" ? (
                        <span className="rounded-full py-0.5 px-2 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200">
                          Accepted · Claude
                        </span>
                      ) : row.gemini_suggestion_status === "Accepted" ? (
                        <span className="rounded-full py-0.5 px-2 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap bg-violet-100 dark:bg-violet-900 text-violet-800 dark:text-violet-200">
                          Accepted · Gemini
                        </span>
                      ) : isEdited ? (
                        <span className="rounded-full py-0.5 px-2 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                          Edited
                        </span>
                      ) : (
                        <span className="rounded-full py-0.5 px-2 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                          Original
                        </span>
                      )}
                    </td>

                    {/* AI Rec (AI-3a): confidence badge(s) for a PENDING suggestion --
                        classification + parent each get one (H/M/L); both -> two side by
                        side; none / resolved -> blank. */}
                    <td className="px-2 py-1.5 align-top w-20 border-r border-border">
                      {(aiInfo.hasClass || aiInfo.hasParent) ? (
                        <div className="flex items-center gap-1">
                          {aiInfo.hasClass && (
                            <AiConfBadge
                              conf={aiInfo.classConf}
                              title={`AI suggests classification: ${row.ai_suggested_classification ?? "?"}${aiInfo.classConf ? ` (${aiInfo.classConf})` : ""}`}
                            />
                          )}
                          {aiInfo.hasParent && (
                            <AiConfBadge
                              conf={aiInfo.parentConf}
                              title={
                                row.ai_suggested_is_root === 1
                                  ? `AI suggests making this a top-level root${aiInfo.parentConf ? ` (${aiInfo.parentConf})` : ""}`
                                  : `AI suggests a new parent${aiInfo.parentConf ? ` (${aiInfo.parentConf})` : ""}`
                              }
                            />
                          )}
                        </div>
                      ) : null}
                    </td>

                    {/* Gemini (DUAL-AI, ADR-0003): SECOND provider cell -- mounted directly after
                        the Claude "AI Rec" cell. Visual clone reading gemini_*; only when enabled. */}
                    {geminiEnabled && <GeminiBodyCell row={row} />}

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
                                  // C-flag-dismissal: a NEW greyed/checked state -- the flags
                                  // still EXIST (acknowledged, not removed). NOT amber-active.
                                  isDismissed
                                    ? "text-muted-foreground/70 hover:text-muted-foreground"
                                    : flagsExpanded
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-amber-500/70 hover:text-amber-600 dark:text-amber-500/70 dark:hover:text-amber-400",
                                )}
                                aria-label={
                                  isDismissed
                                    ? (flagsExpanded ? "Hide flags (reviewed)" : "Show flags (reviewed)")
                                    : (flagsExpanded ? "Hide flags" : "Show flags")
                                }
                                title={
                                  isDismissed
                                    ? "Reviewed — looks OK"
                                    : (flagsExpanded ? "Hide flags" : "Show flags")
                                }
                              >
                                {isDismissed
                                  ? <CheckCircle2 className="h-3 w-3" />
                                  : <Info className="h-3 w-3" />}
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
                    {/* append-to-notes-as-columns: combined "Append Notes" cell (LAST).
                        Read-only text blob; left-aligned + wrapping (unlike the numeric
                        descriptor cells). Blank when the row has no append values. */}
                    {hasAppendCombined && (
                      <td className="px-2 py-1.5 align-top text-left border-l border-border text-muted-foreground break-words min-w-[180px]">
                        {buildAppendCombined(row)}
                      </td>
                    )}
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
                        {/* C-flag-dismissal: when acknowledged, the reasons stay readable
                            (the cover the flag-reason text provides) but are tagged reviewed. */}
                        {isDismissed && (
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3 shrink-0" />
                            Reviewed — looks OK
                            {row.flags_dismissed_by ? <span className="text-muted-foreground/70">· {row.flags_dismissed_by}{row.flags_dismissed_at ? ` · ${row.flags_dismissed_at}` : ""}</span> : null}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}

                  {/* B2b BUILD 1: inline read-only detail panel -- single-open (Option-B with flag accordion).
                      Interior clicks stopped from bubbling so reading inside the panel does NOT dismiss it. */}
                  {expandedDetailRow === row.row_index && (
                    <tr className="bg-muted/30">
                      <td colSpan={totalCols} className="px-3 py-3 border-b border-border">
                        {/* Detail-panel layout pass (FINDING B): a DISTINCT nested card.
                            INDIGO body tint (NOT the bg-muted/30 row-hover tint) + border +
                            rounded + subtle shadow + own padding insets it from the cell.
                            BRAND-RED left-accent stripe (border-l-primary = the rose/crimson
                            --primary token, hue 346.8, DISTINCT from --destructive's pure-red
                            hue 0) carries the brand color as an ACCENT, not a full red surface
                            -- a red surface would collide with the destructive/error red used
                            on this screen (re-parse warning, cycle rejection). */}
                        <div onClick={(e) => e.stopPropagation()} className="bg-indigo-50/40 dark:bg-indigo-950/20 border border-border border-l-4 border-l-primary rounded-md shadow-sm p-3">
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
                          {/* Original-vs-effective: classification + parent (read-only, edit-focused panel).
                              Obs 1: VERTICAL STACK (grid-cols-1) -- Classification row, then the
                              Parent + "Change parent" row below it; the prior grid-cols-2 pushed
                              Parent's right column off-screen on a wide row. */}
                          <div className="grid grid-cols-1 gap-y-1 text-xs mb-2">
                            <div className="flex items-center gap-2">
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
                              {/* Slice 1b-beta: reclassify trigger -- pill-styled DropdownMenu of the
                                  4 assignable target classes. Picking one routes via onPickClass:
                                  childless -> light confirm; has children -> the restructure modal.
                                  Lives in the detail panel (already stopPropagation-wrapped above);
                                  DropdownMenuContent portals to body so item clicks never dismiss it.
                                  Slice D1: hidden when readOnly (the classification text above stays). */}
                              {!readOnly && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 py-0.5 px-2 text-[10px] font-medium leading-none hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                                    >
                                      Change ▾
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="start">
                                    {ASSIGNABLE_CLASSIFICATIONS.map(c => (
                                      <DropdownMenuItem key={c} onClick={() => onPickClass(row, c)}>
                                        {CLS_LABELS[c] ?? c}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
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
                              {/* Slice §9 #162: standalone "Change parent" door -- a SECOND front
                                  door to the SAME RestructureModal, reached WITHOUT a reclassify.
                                  Mirrors the Classification cell's "Change ▾" control (left). Opens
                                  the modal via setRestructureModal DIRECTLY (not onPickClass) with
                                  newClassification = the row's CURRENT class (a no-op reclassify), so
                                  a childless row opens position-only and a with-children row STILL
                                  surfaces the five child-placement options (the children.length > 0
                                  gate is untouched -- the children's fate stays explicit, no silent
                                  reparent). A plain button, not a dropdown: there is no list to pick;
                                  the single action is "open the modal". Hidden on subtotal_marker /
                                  header_repeat via canChangeParent. Slice D1: also hidden when readOnly. */}
                              {canChangeParent && !readOnly && (
                                <button
                                  type="button"
                                  onClick={() => setRestructureModal({ row, newClassification: row.effective_classification as string })}
                                  className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 py-0.5 px-2 text-[10px] font-medium leading-none hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                                >
                                  Change parent
                                </button>
                              )}
                            </div>
                          </div>
                          {/* AI-3b-1/3b-2: per-field accept/reject of a PENDING AI suggestion.
                              Shown only when the row carries a pending suggestion + not readOnly.
                              Classification + parent each get a checkbox + confidence badge +
                              suggested value; one explanation line; Apply + Reject. AI-3b-2: a
                              parent accept on a row WITH children is allowed -- Apply opens the
                              children-only RestructureModal (handleApplyAi) instead of the accept
                              endpoint; the status flips cancel-safely on the modal's Save. */}
                          {!readOnly && (() => {
                            const ai = aiSuggestionInfo(row);
                            if (!(ai.hasClass || ai.hasParent)) return null;
                            const clsIsChange = ai.hasClass &&
                              row.ai_suggested_classification !== row.effective_classification;
                            const parentIsChange = ai.hasParent && (
                              row.ai_suggested_is_root === 1
                                ? row.effective_parent_index !== null
                                : row.ai_suggested_parent !== row.effective_parent_index
                            );
                            // AI-3b-2: a parent accept on a with-children row routes through the
                            // modal (child disposition) rather than applying directly.
                            const parentOpensModal = parentIsChange && hasChildrenSet.has(row.row_index);
                            const suggestedParentLabel = row.ai_suggested_is_root === 1
                              ? "Top level (root)"
                              : (() => {
                                  const p = row.ai_suggested_parent;
                                  if (p === null || p === undefined || p < 0) return "—";
                                  const src = byIdx.get(p)?.source_row_number;
                                  return src !== undefined ? `row ${src}` : `#${p}`;
                                })();
                            const canApply =
                              (aiAcceptCls && ai.hasClass && clsIsChange) ||
                              (aiAcceptParent && ai.hasParent && parentIsChange);
                            // R3a (ADR-0006): an AI apply must never silently overwrite a standing
                            // decision (the other provider's accepted suggestion OR a manual edit).
                            // Disable Apply while the row carries any override; the user must first
                            // "Revert to parser" (the unified affordance below).
                            const blockedByOverride = !!row.has_override;
                            return (
                              <div className="mb-2 rounded-md border border-indigo-200 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/20 p-2">
                                <p className="text-[10px] font-medium uppercase tracking-wide text-indigo-700 dark:text-indigo-300 mb-1.5 flex items-center gap-1">
                                  <Sparkles className="h-3 w-3" /> AI suggestion
                                </p>
                                {ai.hasClass && (
                                  <label className={cn(
                                    "flex items-center gap-2 text-xs mb-1",
                                    clsIsChange ? "cursor-pointer" : "cursor-not-allowed",
                                  )}>
                                    <Checkbox
                                      checked={aiAcceptCls}
                                      disabled={!clsIsChange}
                                      onCheckedChange={(c) => setAiAcceptCls(!!c)}
                                    />
                                    <AiConfBadge conf={row.ai_classification_confidence ?? null} title="AI classification confidence" />
                                    <span>
                                      Classification &rarr;{" "}
                                      <span className="font-medium">{CLS_LABELS[row.ai_suggested_classification ?? ""] ?? row.ai_suggested_classification}</span>
                                      {!clsIsChange && <span className="text-muted-foreground italic"> (no change)</span>}
                                    </span>
                                  </label>
                                )}
                                {ai.hasParent && (
                                  <label
                                    className={cn(
                                      "flex items-center gap-2 text-xs mb-1",
                                      parentIsChange ? "cursor-pointer" : "cursor-not-allowed",
                                    )}
                                    title={parentOpensModal
                                      ? "This row has children — applying opens the restructure step to choose where the children go."
                                      : undefined}
                                  >
                                    <Checkbox
                                      checked={aiAcceptParent}
                                      disabled={!parentIsChange}
                                      onCheckedChange={(c) => setAiAcceptParent(!!c)}
                                    />
                                    <AiConfBadge conf={row.ai_parent_confidence ?? null} title="AI parent confidence" />
                                    <span>
                                      Parent &rarr; <span className="font-medium">{suggestedParentLabel}</span>
                                      {!parentIsChange && <span className="text-muted-foreground italic"> (no change)</span>}
                                      {parentOpensModal && (
                                        <span className="text-muted-foreground italic"> (opens restructure)</span>
                                      )}
                                    </span>
                                  </label>
                                )}
                                {row.ai_explanation && (
                                  <p className="text-[11px] text-muted-foreground mb-1.5 leading-snug">{row.ai_explanation}</p>
                                )}
                                {aiActionError && <p className="text-xs text-destructive mb-1">{aiActionError}</p>}
                                {blockedByOverride && (
                                  <p className="text-[11px] text-muted-foreground italic mb-1.5 leading-snug">
                                    Revert this row to parser before applying an AI suggestion.
                                  </p>
                                )}
                                <div className="flex items-center gap-2">
                                  <span title={blockedByOverride
                                    ? "Revert this row to parser before applying an AI suggestion."
                                    : undefined}>
                                    <Button
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      disabled={!canApply || blockedByOverride || isAcceptingAi || isRejectingAi}
                                      onClick={() => { void handleApplyAi(row); }}
                                    >
                                      {isAcceptingAi ? "Applying…" : "Apply selected changes"}
                                    </Button>
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    disabled={isAcceptingAi || isRejectingAi}
                                    onClick={() => { void handleRejectAi(row); }}
                                  >
                                    {isRejectingAi ? "Rejecting…" : "Reject"}
                                  </Button>
                                </div>
                              </div>
                            );
                          })()}
                          {/* R3a (ADR-0006): the UNIFIED "Revert to parser". Shown whenever the
                              row carries any standing override (has_override) -- an accepted AI
                              suggestion (either provider) OR a manual edit. It restores the row +
                              any children a restructure moved to the parser baseline, regardless of
                              the override kind, after which AI Apply re-enables. Replaces the two
                              former provider-specific reverts ("Revert AI change" here + "Revert
                              Gemini change" in GeminiAcceptBlock). Disabled under readOnly (a
                              finalized sheet freezes the affordance). handleRevertToParser ->
                              onRemarkSaved (mutate-only re-fetch -> the row re-renders clean, the
                              accept blocks reappear Pending, this button disappears). */}
                          {row.has_override && (
                            <div className="mb-2 rounded-md border border-indigo-200 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/20 p-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs"
                                  disabled={readOnly || isRevertingToParser}
                                  onClick={() => { void handleRevertToParser(row); }}
                                >
                                  {isRevertingToParser ? "Reverting…" : "Revert to parser"}
                                </Button>
                                {readOnly ? (
                                  <span className="text-muted-foreground italic text-xs">
                                    Sheet is finalized — revert unavailable.
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground italic text-xs">
                                    Restores this row (and any moved children) to the parser baseline.
                                  </span>
                                )}
                              </div>
                              {aiActionError && <p className="text-xs text-destructive mt-1">{aiActionError}</p>}
                            </div>
                          )}
                          {/* DUAL-AI (ADR-0003 sec 8A): the Gemini accept/reject block, mounted
                              BENEATH the Claude block. Visual clone of the Claude block reading
                              gemini_* + calling the gemini endpoints. R3a (ADR-0006): the block now
                              owns ONLY the Pending accept/reject UI (gated on !readOnly) -- the
                              former "Revert Gemini change" affordance is gone, folded into the ONE
                              unified "Revert to parser" above (shown on any has_override row). With-
                              children accepts route to the SHARED RestructureModal via
                              onOpenRestructureGemini (markGeminiAccepted). Only mounted when
                              geminiEnabled. */}
                          {geminiEnabled && !readOnly && (
                            <GeminiAcceptBlock
                              row={row}
                              boqName={boqName}
                              sheetName={sheetName}
                              hasChildren={hasChildrenSet.has(row.row_index)}
                              parentLabel={(idx) => {
                                if (idx < 0) return "Top level (root)";
                                const src = byIdx.get(idx)?.source_row_number;
                                return src !== undefined ? `row ${src}` : `#${idx}`;
                              }}
                              readOnly={readOnly}
                              onOpenRestructure={onOpenRestructureGemini}
                              onChanged={() => { onRemarkSaved?.(); }}
                              onAccepted={(editedAt) => { onSaved?.(editedAt); }}
                            />
                          )}
                          {/* C-v2: editable value inputs -- the flat numeric fields this sheet
                              surfaces (per-area cells + text fields stay read-only here). Each
                              commits via an explicit Apply button that opens the confirm dialog.
                              Slice D1: the whole block is gated OUT when readOnly. */}
                          {!readOnly && editableDescriptors.length > 0 && (
                            <div className="mb-2">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Edit values</p>
                              {/* Fixed 4-per-row, content-sized, left-packed grid: the four
                                  fixed-width (w-36) fields sit close together then wrap to the next
                                  row of 4, with no equal-grid dead space spreading them apart. */}
                              <div className="grid grid-cols-[repeat(4,max-content)] gap-2 justify-start">
                                {editableDescriptors.map(d => {
                                  const stored = (row as unknown as Record<string, unknown>)[d.value_field];
                                  const storedStr = stored === null || stored === undefined ? "" : String(stored);
                                  const current = editInputs[d.value_field] ?? storedStr;
                                  const dirty = current !== storedStr;
                                  const fieldLabel = `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}`;
                                  return (
                                    <div key={d.value_field} className="flex flex-col gap-1">
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
                                          className="h-7 text-xs w-36"
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
                              the column (editableTextDescriptors gating). Slice D1: gated OUT when readOnly. */}
                          {!readOnly && editableTextDescriptors.length > 0 && (
                            <div className="mb-2">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Edit text</p>
                              {/* Fixed 4-per-row, content-sized, left-packed grid: the four
                                  fixed-width (w-36) fields sit close together then wrap to the next
                                  row of 4, with no equal-grid dead space spreading them apart. */}
                              <div className="grid grid-cols-[repeat(4,max-content)] gap-2 justify-start">
                                {editableTextDescriptors.map(d => {
                                  const stored = (row as unknown as Record<string, unknown>)[d.value_field];
                                  const storedStr = stored === null || stored === undefined ? "" : String(stored);
                                  const current = textInputs[d.value_field] ?? storedStr;
                                  const dirty = current !== storedStr;
                                  const fieldLabel = `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}`;
                                  return (
                                    <div key={d.value_field} className="flex flex-col gap-1">
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
                                          className="h-7 text-xs w-36"
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
                              maps per-area columns (editableAreaDescriptors gating). Slice D1: gated OUT when readOnly. */}
                          {!readOnly && editableAreaDescriptors.length > 0 && (
                            <div className="mb-2">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Edit per-area values</p>
                              {/* Fixed 4-per-row, content-sized, left-packed grid: the four
                                  fixed-width (w-36) fields sit close together then wrap to the next
                                  row of 4, with no equal-grid dead space spreading them apart. */}
                              <div className="grid grid-cols-[repeat(4,max-content)] gap-2 justify-start">
                                {editableAreaDescriptors.map(d => {
                                  const storedVal = resolveDescriptorValue(row, d);
                                  const storedStr = storedVal === null || storedVal === undefined ? "" : String(storedVal);
                                  const current = areaInputs[d.col] ?? storedStr;
                                  const dirty = current !== storedStr;
                                  // Label: "E — Rate Combined (per area) · Zone A" (+ rate kind for rate).
                                  const fieldLabel = `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}${d.area ? ` · ${d.area}` : ""}`;
                                  return (
                                    <div key={d.col} className="flex flex-col gap-1">
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
                                          className="h-7 text-xs w-36"
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
                            // Slice D1: a frozen sheet shows the stored remark read-only (or nothing
                            // when there is none) -- the Textarea + Save are gated out.
                            if (readOnly) {
                              if (!storedRemark) return null;
                              return (
                                <div className="mb-2 max-w-md">
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Remarks</p>
                                  <p className="text-xs text-foreground whitespace-pre-wrap">{storedRemark}</p>
                                </div>
                              );
                            }
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
                              <div className="flex items-center gap-2">
                                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Flags</p>
                                {/* C-flag-dismissal: per-row "Looks OK" -- acknowledges ALL of
                                    this row's flags at once. NOT an edit (the row stays
                                    "Original"). stopPropagation so the table-body click that
                                    dismisses the detail panel doesn't fire. When already
                                    dismissed, reads "Reviewed" (no separate un-dismiss ships;
                                    an edit re-opens / re-parse wipes). */}
                                {isDismissed ? (
                                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                                    <CheckCircle2 className="h-3 w-3" /> Reviewed — looks OK
                                  </span>
                                ) : !readOnly ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-[11px] shrink-0"
                                    disabled={isDismissingFlags}
                                    onClick={(e) => { e.stopPropagation(); void dismissFlags(row.row_index, true); }}
                                  >
                                    <CheckCircle2 className="h-3 w-3 mr-1" /> Looks OK
                                  </Button>
                                ) : null}
                              </div>
                              <ul className="mt-0.5 space-y-0.5">
                                {rowFlags.map((f, i) => (
                                  <li key={i} className="text-xs text-amber-700 dark:text-amber-300 leading-snug">{f.reason}</li>
                                ))}
                              </ul>
                              {isDismissed && row.flags_dismissed_by && (
                                <p className="mt-0.5 text-[10px] text-muted-foreground">
                                  Acknowledged by {row.flags_dismissed_by}
                                  {row.flags_dismissed_at ? ` · ${row.flags_dismissed_at}` : ""}
                                </p>
                              )}
                              {dismissError && <p className="text-xs text-destructive mt-1">{dismissError}</p>}
                            </div>
                          )}
                          {/* Edit history from edit_log */}
                          <div className="mb-1">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Edit history</p>
                            {(() => {
                              // A2 edit-log clarity (render-only): latest-first, describe each
                              // entry (honest verb + Excel-row parents + date+HH:MM), and DROP
                              // suppressed entries (#162 no-op reclassify) before rendering, so
                              // they never produce an <li>. "No edits yet." reflects the
                              // post-suppression list.
                              const described = (Array.isArray(row.edit_log) ? [...row.edit_log] : [])
                                .reverse()
                                .map((entry) => ({ entry, d: describeEditEntry(entry) }))
                                .filter((x): x is { entry: EditLogEntry; d: DescribedEditEntry } => x.d !== null);
                              return described.length > 0 ? (
                                <ul className="mt-0.5 space-y-0.5">
                                  {described.map(({ entry, d }, i) => (
                                    <li key={i} className="text-xs text-foreground">
                                      <span className="font-medium">{d.verb}</span>
                                      {/* Non-parent edits keep the field name for context. */}
                                      {d.showField ? (
                                        <span className="text-muted-foreground">{" "}{entry.field}</span>
                                      ) : null}
                                      {/* C-v2d: per-area target -- "(Zone A)" or "(Zone A / combined_rate)". */}
                                      {entry.area ? (
                                        <span className="text-muted-foreground">
                                          {" "}({entry.area}{entry.rate_subkey ? ` / ${entry.rate_subkey}` : ""})
                                        </span>
                                      ) : null}
                                      {d.detail ? (
                                        <>{": "}{d.detail}</>
                                      ) : null}
                                      {" — "}
                                      <span className="text-muted-foreground">{entry.by} · {formatEditAt(entry.at)}</span>
                                      {entry.reason ? (
                                        <span className="text-muted-foreground"> · reason: {entry.reason}</span>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-0.5 text-xs text-muted-foreground italic">No edits yet.</p>
                              );
                            })()}
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
      </div>{/* R4: close the table-card div opened above; the dialogs/modal below are siblings
              inside the outer space-y-3 wrapper. */}

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

      {/* Slice 1b-beta: childless reclassify -- the LIGHT path. A leaf row has no children,
          so changing its class reparents nothing (its own parent is untouched). A plain
          Button (not AlertDialogAction) is used so the dialog stays open on a backend error. */}
      <AlertDialog
        open={childlessConfirm !== null}
        onOpenChange={(o) => { if (!o) { setChildlessConfirm(null); setRestructureError(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change classification</AlertDialogTitle>
            <AlertDialogDescription>
              {childlessConfirm
                ? `Reclassify row ${childlessConfirm.row.source_row_number} from ${CLS_LABELS[childlessConfirm.row.effective_classification ?? ""] ?? childlessConfirm.row.effective_classification ?? "—"} to ${CLS_LABELS[childlessConfirm.newClassification] ?? childlessConfirm.newClassification}. Its parent stays the same; no rows are reparented.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* 1b-beta2b: row-position choice. (1) Keep current position (DEFAULT) -- Confirm
              reclassifies only, byte-for-byte as before (child_moves:{}, no row_new_parent).
              (2) Move under a new parent -- routes ON SELECT into the RestructureModal (the
              AlertDialog is too small to host the picker); the modal opens in "move" mode. */}
          <div className="space-y-1.5 py-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              This row&rsquo;s position
            </p>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="childless-row-position"
                className="mt-0.5"
                checked
                readOnly
              />
              <span>Keep current position</span>
            </label>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="childless-row-position"
                className="mt-0.5"
                checked={false}
                onChange={() => {
                  if (!childlessConfirm) return;
                  // Hand off to the staged modal (which renders slimmed for a childless
                  // row and opens with "move" active). Closing this dialog writes nothing.
                  setRestructureError(null);
                  setRestructureModal({
                    row: childlessConfirm.row,
                    newClassification: childlessConfirm.newClassification,
                  });
                  setChildlessConfirm(null);
                }}
              />
              <span>Move this row under a new parent</span>
            </label>
          </div>
          {restructureError && <p className="text-xs text-destructive">{restructureError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestructuring}>Cancel</AlertDialogCancel>
            <Button disabled={isRestructuring} onClick={() => { void confirmChildlessReclassify(); }}>
              {isRestructuring ? "Saving…" : "Confirm"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Slice 1b-beta: with-children restructure modal -- the HEAVY staged path. Mounted
          only while a target row+class is pending. Owns its own save_review_restructure
          call; on success it returns edited_at, we close + forward to onRestructured. */}
      {restructureModal && (
        <RestructureModal
          open={true}
          onClose={() => setRestructureModal(null)}
          boqName={boqName}
          sheetName={sheetName}
          row={restructureModal.row}
          newClassification={restructureModal.newClassification}
          rows={rows}
          presetRowParent={restructureModal.presetRowParent}
          presetParentMessage={restructureModal.presetParentMessage}
          markAiAccepted={restructureModal.markAiAccepted}
          markGeminiAccepted={restructureModal.markGeminiAccepted}
          onRestructured={(editedAt) => { onRestructured?.(editedAt); setRestructureModal(null); }}
        />
      )}
    </div>
  );
}
