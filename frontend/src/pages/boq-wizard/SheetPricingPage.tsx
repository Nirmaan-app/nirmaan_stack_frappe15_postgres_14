/**
 * SheetPricingPage -- committed-pricing page for one BoQ sheet (Phase 5 Slice 3a -> 3b -> 3c).
 *
 * Shell mirrors SheetReviewPage:
 *   - useParams for boqId + sheetName (React Router v6 auto-decodes -> verbatim sheet_name).
 *   - useFrappeGetDoc for the BOQs header (boq_name, version).
 *   - useFrappeGetCall for get_priced_rows (committed rows + merged saved prices) + its mutate.
 *   - Full-page spinner while the BOQs doc loads; inline loading/error for the grid.
 *   - Back nav to /upload-boq/hub/:boqId (entity-id convention, never navigate(-1)).
 *
 * Slice 3b: owns onSaveRate -- the grid hands up a rate cell's identity, the page fills
 * boq/sheet/committed_version + the rate, POSTs save_cell_price, then mutate()-refetches
 * (priced_* markers re-derive authoritatively). RATES ONLY are editable; amounts are
 * display-only (qty x rate, never persisted).
 *
 * Slice 3c: onSaveRate also tracks an IN-FLIGHT count (drives "Saving...") + a client-clock
 * lastSavedAt ("Saved as of HH:MM"); the grid debounce-auto-saves (1s) + exposes an
 * imperative flush() the header "Save now" button calls, and an onDirtyChange signal driving
 * "Unsaved changes". The save MECHANISM is unchanged. The single-editor lock is a later slice
 * (editable / lock_info stay INERT -- read from the payload, threaded into the grid, no lock).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, ChevronUp, ClipboardList, Filter, Loader2, Lock, Maximize2, Minimize2, RefreshCw, Save, Search, Sigma, SlidersHorizontal, Unlock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";
import type {
  AmountFormulaSaveArgs,
  BOQsDoc,
  ColorSaveArgs,
  CommittedSheetGridResponse,
  DismissalSaveArgs,
  GetCommittedStateResponse,
  GetPricedRowsResponse,
  PricedRow,
  RateCellSaveArgs,
  ReconChoiceSaveArgs,
  RemarkSaveArgs,
  ReviewEntry,
  RowReviewFlags,
} from "./boqTypes";
import { ROLE_LABELS } from "./boqTypes";
import {
  PricingGrid,
  buildSearchHits,
  classificationVisible,
  deriveSaveStatus,
  hideableDescriptors,
  isGridOnlySheet,
  isTakeoverError,
  orderCommittedSheets,
  shouldExitFullscreenOnEsc,
  stepHit,
  type PricingGridHandle,
} from "./PricingGrid";
import {
  areFormulasComplete,
  buildDismissedKeySet,
  buildDivergenceEntries,
  buildFlagEntries,
  computePricedCount,
  computeRowFlags,
  filterActiveReviewEntries,
  isEntryDismissed,
  isFullyPriced,
  isPriceableLine,
} from "./priceability";
import { buildChildrenByParent, collapsedAncestors, collapsibleParents, isHiddenByCollapse, type CollapseRow } from "./collapse";
import { SheetDataGrid } from "./SheetDataGrid";
import { SummaryPanel } from "./SummaryPanel";

// Slice 3c: "saved as of" uses the CLIENT clock at save-success (save_cell_price returns no
// timestamp). HH:MM, mirroring SheetReviewPage's fmtSavedTime shape (client-clock seeded).
function fmtSavedTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Slice 4b-A: per-kind presentation for the unified review-list strip. `badge` is the small
// type tag's classes; `text` is the entry-text colour. Critical kinds (broken / qty-anomaly)
// read rose/destructive; the rest read amber; a remark reads neutral. Module-level (not
// rebuilt per render). Keyed by ReviewEntry["kind"].
const REVIEW_ENTRY_META: Record<
  ReviewEntry["kind"],
  { label: string; badge: string; text: string }
> = {
  remark: {
    label: "Note",
    badge: "bg-muted text-muted-foreground",
    text: "text-muted-foreground",
  },
  needs_rate: {
    label: "Needs rate",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
    text: "text-amber-700 dark:text-amber-400",
  },
  not_yet: {
    label: "Not computed",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
    text: "text-amber-700 dark:text-amber-400",
  },
  qty_anomaly: {
    label: "Qty anomaly",
    badge: "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200",
    text: "text-rose-700 dark:text-rose-400",
  },
  broken: {
    label: "Check formula",
    badge: "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200",
    text: "text-rose-700 dark:text-rose-400",
  },
  // Cluster B: an UNRESOLVED document-vs-formula divergence. Violet -- the SAME distinct family
  // as the in-grid cue (not amber/rose, which carry other meanings on this strip).
  divergence: {
    label: "Reconcile",
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
    text: "text-violet-700 dark:text-violet-400",
  },
};

const SheetPricingPage = () => {
  const { boqId, sheetName } = useParams<{ boqId: string; sheetName: string }>();
  const navigate = useNavigate();

  // BOQs doc: header info (boq_name, version). Third arg null disables until boqId is
  // present (useFrappeGetDoc swrKey gotcha).
  const { data: boq, isLoading } = useFrappeGetDoc<BOQsDoc>(
    "BOQs",
    boqId ?? "",
    boqId ? undefined : null,
  );

  // Priced rows: committed rows + merged saved prices for (boqId, sheetName).
  // GET-capable endpoint, SWR-managed. Loading: data === undefined. Error: data === null.
  // mutate() refetches after a rate save -> the priced_* markers re-derive authoritatively.
  const { data: pricedData, mutate } = useFrappeGetCall<{ message: GetPricedRowsResponse }>(
    "nirmaan_stack.api.boq.wizard.pricing.get_priced_rows",
    { boq_name: boqId ?? "", sheet_name: sheetName ?? "" },
    boqId && sheetName ? undefined : null,
  );

  // In-editor sheet tabs (slice 3d): the SAME BoQ's committed sheets for the tab strip.
  // Fetched in the page (a light single get_all read -- the SAME endpoint the hub uses);
  // disabled until boqId is present (swrKey gotcha). Ordered by sheet_order (workbook
  // order) below via the pure orderCommittedSheets helper.
  const { data: committedStateData } = useFrappeGetCall<{ message: GetCommittedStateResponse }>(
    "nirmaan_stack.api.boq.wizard.commit_gate.get_committed_state",
    { boq_name: boqId ?? "" },
    boqId ? undefined : null,
  );

  // General-specs faithful-grid fork: a GRID-ONLY (general-specs) committed sheet commits a
  // faithful grid with ZERO nodes, so the node-based get_priced_rows renders it empty. Detect
  // it via the EXPLICIT sheet_disposition discriminator (NOT by inferring "empty rows"). The
  // lookup fails to FALSE in the indeterminate (committed-state still loading) window, so a
  // data sheet never briefly renders as grid-only -- it stays on the normal pricing path until
  // the disposition is positively known.
  const isGridOnly = isGridOnlySheet(
    committedStateData?.message?.committed_state ?? [],
    sheetName ?? "",
  );
  // commit_version comes from get_priced_rows (it carries it for BOTH dispositions -- a
  // grid-only sheet still has a current committed BoQ Sheet). The faithful-grid fetch is
  // disabled until it's a known grid-only sheet WITH a version.
  const commitVersionForGrid = pricedData?.message?.commit_version ?? null;
  const { data: gridData } = useFrappeGetCall<{ message: CommittedSheetGridResponse }>(
    "nirmaan_stack.api.boq.wizard.pricing.get_committed_sheet_grid",
    {
      boq_name: boqId ?? "",
      sheet_name: sheetName ?? "", // VERBATIM (#152)
      committed_version: commitVersionForGrid ?? 0,
    },
    isGridOnly && boqId && sheetName && commitVersionForGrid !== null ? undefined : null,
  );

  // Slice 3b: save one rate cell (save_cell_price) + an inline save-error surface.
  const { call: saveCellPrice } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.save_cell_price",
  );
  // Slice 4a: the annotation saves (parallel to the rate save -- a separate write path).
  const { call: saveRowRemark } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.save_row_remark",
  );
  const { call: saveCellColor } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.save_cell_color",
  );
  // Slice 4b-ACKNOWLEDGE: dismiss / un-dismiss one review-strip entry (save_cell_dismissal).
  // A SEPARATE write path (parallel to rates/annotations); an acknowledgment, not an edit.
  const { call: saveCellDismissal } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.save_cell_dismissal",
  );
  // Formula Builder F3: save one amount-column formula (save_amount_formula). A SEPARATE
  // write path (parallel to rates/annotations); withheld when locked so headers render
  // read-only. Does NOT touch the amount-cell compute path (that is F4).
  const { call: saveAmountFormula } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.save_amount_formula",
  );
  // Cluster B: choose (keep_document/take_formula) or clear the per-cell reconciliation choice
  // (save_cell_reconciliation_choice). A SEPARATE write path (parallel to rates/annotations);
  // withheld when locked so the divergence cue renders a static read-only pill.
  const { call: saveCellReconChoice } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.save_cell_reconciliation_choice",
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  // Slice 4a: the minimal review-list strip (rows with a remark), opened above the grid.
  // Slice 4b-A extends its feed to ALL computed flags (a single list, no fork).
  const [reviewOpen, setReviewOpen] = useState(false);
  // Slice 4b-ACKNOWLEDGE: the strip default shows ACTIVE (undismissed) entries only; this
  // toggle reveals the dismissed ones too so nothing is ever lost. Per-sheet per-session.
  const [showDismissed, setShowDismissed] = useState(false);
  // Slice 4b-A: "show only unpriced" -- collapse the grid to priceable-but-not-fully-priced
  // rows. Per-sheet per-session (reset on a tab switch, like the override).
  const [showOnlyUnpriced, setShowOnlyUnpriced] = useState(false);

  // ── Toolbar Part 1 (per-sheet per-session; reset on a tab switch below) ──────────
  // Column-hide: the set of HIDDEN non-amount descriptor `col` letters. DEFAULT EMPTY = nothing
  // hidden (byte-identical to the prior grid). Stored as "hidden" (not "visible") so the default
  // needs no seeding from columnDescriptors -- which the page does not have until the fetch lands
  // (a visible-set lazy-init would flash all columns hidden for one paint on every sheet open).
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  // Description search: the query + the cycling hit pointer. Empty query = no filtering/highlight.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCurrentIdx, setSearchCurrentIdx] = useState(0);
  // Row-TYPE filters (default all true = nothing hidden). Key on effective_classification.
  const [showSpacers, setShowSpacers] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [showSubtotals, setShowSubtotals] = useState(true);

  // Slice 3c: force-save handle (the grid's flush), in-flight count (drives "Saving..."),
  // last-saved time (client clock), and the grid's "has unsaved drafts" signal.
  const gridRef = useRef<PricingGridHandle>(null);
  const [inFlight, setInFlight] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  // Summary panel (parent-tree amount rollups) -- pull-in, computed page-side.
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Priceability override (Slice 3e, per-sheet per-session). Default OFF: a rate cell is
  // editable ONLY on a priceable row (node_type Preamble / Line Item). When ON, it unlocks
  // editing on non-priceable rows for THIS sheet THIS session AND sends allow_non_priceable
  // to save_cell_price so the server accepts those writes. Resets per sheet (below).
  const [override, setOverride] = useState(false);
  // Single-editor lock (slice B): a mid-edit takeover (a save rejected with the
  // BOQ_PRICING_LOCKED marker -- another user acquired the lock) flips this true; the page
  // becomes read-only + shows the takeover banner until a fresh editable payload arrives.
  const [takenOver, setTakenOver] = useState(false);
  // Slice 4c: full-screen / maximize mode (per-session). When true the page root becomes a
  // fixed inset-0 full-viewport overlay (covering the app shell) so the dense grid gets the
  // whole screen. Pure LAYOUT: it toggles ONLY the root wrapper's className (one JSX tree,
  // same children + same PricingGrid key={sheetName}), so expand/collapse NEVER remounts the
  // grid -- draftRates / activeCell / debouncers / the gridRef handle / the single-editor lock
  // / all page state survive. NOT a Dialog / Sheet / portal (those remount), NOT the native
  // Fullscreen API. NOT reset on a tab switch (a deliberate choice -- staying maximized across
  // sheets is the useful behaviour; the per-sheet reset effect below leaves it alone).
  const [expanded, setExpanded] = useState(false);

  // Hierarchy collapse/expand (per-sheet per-session; reset on a tab switch below). `collapsed`
  // holds the row_index of every collapsed parent. It lives HERE (the page) because it composes
  // the upstream displayRows filter (R4) and the descendant/visibility math needs the FULL rows
  // (which the page has; the grid only gets the filtered displayRows). The grid receives it +
  // childrenByParent + the toggle as GRID-LEVEL props for the chevrons (NOT a row-memo prop, R6).
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // Refs synced each render (below) so the toggle + reveal callbacks stay reference-stable
  // (useCallback []) -- a stable onRevealRow keeps the grid's jumpToRow / onJumpToRow memo-safe.
  const collapsedRef = useRef(collapsed);
  const byRowIndexRef = useRef<Map<number, CollapseRow>>(new Map());
  const byExcelRowRef = useRef<Map<number, CollapseRow>>(new Map());
  // Toggle one parent's collapsed state (chevron click). Stable.
  const toggleCollapse = useCallback((rowIndex: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }, []);
  // Reveal-then-scroll (R5): expand a jump target's collapsed ANCESTORS so the scroll lands on a
  // visible row instead of silently no-opping. Returns TRUE iff it changed `collapsed` (the grid
  // then defers the scroll a tick). Reads refs -> stable (useCallback []).
  const revealRow = useCallback((excelRow: number): boolean => {
    const row = byExcelRowRef.current.get(excelRow);
    if (!row) return false;
    const anc = collapsedAncestors(row, collapsedRef.current, byRowIndexRef.current);
    if (anc.length === 0) return false;
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const a of anc) next.delete(a);
      return next;
    });
    return true;
  }, []);

  // Reset the takeover flag whenever a FRESH get_priced_rows payload reports the sheet
  // editable (a Reload re-read found it free / mine / stale). Keyed on the payload identity
  // so it fires on EVERY refetch -- an [editable] dep would miss a true->true no-change.
  useEffect(() => {
    if (pricedData?.message && (pricedData.message.editable ?? true)) {
      setTakenOver(false);
    }
  }, [pricedData]);

  // Slice 3d: page per-sheet state reset on a tab switch. The PAGE does NOT remount on a
  // pricing->pricing route change (same route element), so its sheet-specific state would
  // carry stale into the new sheet. Reset it when :sheetName changes. The grid itself is
  // key-remounted on sheetName (drafts flush-on-unmount to the OLD sheet, the new grid
  // starts clean), and hasUnsaved re-derives from the remounted grid's onDirtyChange.
  // inFlight is DELIBERATELY NOT reset: a flush-on-unmount save from the old grid
  // increments/decrements it in a pair, so a hard reset to 0 would underflow when that
  // in-flight save's finally runs (and "Saving..." on the new sheet during the flush is
  // honest -- a save IS in flight).
  useEffect(() => {
    setSaveError(null);
    setLastSavedAt(null);
    setTakenOver(false);
    setSummaryOpen(false);
    setOverride(false); // Slice 3e: the override is per-sheet per-session -- reset on switch
    setReviewOpen(false); // Slice 4a: the review-list strip is per-sheet
    setShowDismissed(false); // Slice 4b-ACKNOWLEDGE: the show-dismissed toggle is per-sheet
    setShowOnlyUnpriced(false); // Slice 4b-A: the unpriced filter is per-sheet
    // Toolbar Part 1: column-hide, search, and the three row-type filters are all per-sheet.
    setHiddenCols(new Set());
    setSearchQuery("");
    setSearchCurrentIdx(0);
    setShowSpacers(true);
    setShowNotes(true);
    setShowSubtotals(true);
    setCollapsed(new Set()); // collapse/expand is per-sheet -- a tab switch starts fully expanded
  }, [sheetName]);

  // Toolbar Part 1 -- search: reset the hit pointer to the first hit whenever the query changes
  // (a fresh search starts at hit 1). The pointer is also clamped at render (safeSearchIdx).
  useEffect(() => {
    setSearchCurrentIdx(0);
  }, [searchQuery]);

  // Slice 4c: Esc-to-exit full-screen. A window keydown listener mounted ONLY while expanded
  // (added on expand, removed on collapse / unmount). shouldExitFullscreenOnEsc guards the two
  // collision cases: e.defaultPrevented (a Radix popover -- RemarkCell / AmountFormulaBuilder --
  // closing on its OWN Esc preventDefaults, so a popover-Esc never exits) and an <input>/
  // <textarea> being typed. NOT attached to the grid <table> (it would miss Escs fired while
  // focus is in a portaled popover); the grid's own keydown handler is untouched.
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldExitFullscreenOnEsc(e, document.activeElement)) setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  // RR v6 auto-decodes path params -- sheetName is the verbatim DB-stored string.
  const decodedSheetName = sheetName ?? "";
  const displaySheetName = decodedSheetName.trim() || decodedSheetName;

  // Back nav: semantic entity-id route (survives hard refresh -- never navigate(-1)).
  const handleBack = () => navigate(`/upload-boq/hub/${boqId ?? ""}`);
  // Lock banners' Reload: re-read get_priced_rows IN PLACE (refreshes editable/lock_info +
  // resets takenOver via the effect above) -- preferred over a full window reload.
  const handleReload = () => {
    void mutate();
  };

  // ── Full-page spinner while the BOQs doc loads ──────────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Not-found state ─────────────────────────────────────────────────────────
  if (!boq) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
        <p className="font-medium text-foreground">BoQ not found</p>
        <p className="text-sm text-muted-foreground">
          No record found for &ldquo;{boqId}&rdquo;.
        </p>
        <Button variant="outline" className="mt-4" onClick={handleBack}>
          Back to hub
        </Button>
      </div>
    );
  }

  // ── Missing sheet name in URL (routing guarantees it, but be defensive) ─────
  if (!sheetName) {
    return <p className="p-6 text-sm text-destructive">Missing sheet identifier in URL.</p>;
  }

  // Slice 3d: the BoQ's committed sheets in workbook order (sheet_order), for the tab
  // strip. Empty while the list loads -> the strip renders nothing (the grid never waits
  // on it). The active tab is the current :sheetName (matched VERBATIM, #152).
  const committedSheets = orderCommittedSheets(committedStateData?.message?.committed_state ?? []);

  // Data derived from the priced-rows fetch.
  const rows = pricedData?.message?.rows ?? [];
  const columnDescriptors = pricedData?.message?.column_descriptors ?? [];
  const columnFormulas = pricedData?.message?.column_formulas ?? []; // F3: per-column amount formulas
  const dismissals = pricedData?.message?.dismissals ?? []; // 4b-ACKNOWLEDGE: current dismissals
  const reconChoices = pricedData?.message?.reconciliation_choices ?? []; // Cluster B: per-cell choices
  const commitVersion = pricedData?.message?.commit_version ?? null;
  // RESERVED for the future single-editor-lock slice (3b) -- inert in 3a. Threaded into the
  // grid so 3b can gate inline edit on them without reshaping the contract.
  const editable = pricedData?.message?.editable ?? true;
  const lockInfo = pricedData?.message?.lock_info ?? null;
  const pricedLoading = pricedData === undefined;
  const pricedError = pricedData === null;
  // HARD READ-ONLY when held FRESH by another user (backend editable===false) OR after a
  // mid-edit takeover. Withholding onSaveRate collapses ALL of the grid's edit gates (the
  // single onSaveRate root gate) to the read-only render -- no per-cell editable check.
  const locked = editable === false || takenOver;

  // Slice 3b: the page-owned save. The grid hands up the cell identity; the page fills
  // boq / sheet / committed_version + the rate, POSTs save_cell_price, then mutate()-refetches
  // so the priced_* markers re-derive (no client-side marker logic). On throw it surfaces the
  // error inline AND re-throws so the grid keeps the optimistic draft (the user's input).
  const handleSaveRate = async (cell: RateCellSaveArgs, rate: number) => {
    if (commitVersion === null) {
      setSaveError("This sheet has no committed version to price.");
      throw new Error("no committed version");
    }
    setSaveError(null);
    setInFlight((n) => n + 1); // Slice 3c: drives the "Saving..." status
    try {
      await saveCellPrice({
        boq_name: boqId, // VERBATIM
        sheet_name: sheetName, // VERBATIM -- trailing spaces intact (#152)
        excel_row: cell.excelRow,
        col_letter: cell.colLetter,
        committed_version: commitVersion,
        rate,
        area: cell.area, // omitted by the SDK when undefined (scalar path)
        rate_kind: cell.rateKind,
        description: cell.description, // copy-forward MATCH GUARD
        allow_non_priceable: override, // Slice 3e: the asserted per-sheet override
      });
      await mutate();
      setLastSavedAt(new Date()); // Slice 3c: client-clock "saved as of"
    } catch (e: unknown) {
      const msg = getFrappeError(e);
      if (isTakeoverError(msg)) {
        // Mid-edit takeover (next-save-only): another user acquired the lock. Flip to
        // read-only via the takeover banner (the grid keeps the draft -- it just can't be
        // saved). The banner is the surface, so we do NOT also raise the generic error strip.
        setTakenOver(true);
      } else {
        setSaveError(msg || "Could not save the rate. Please try again.");
      }
      throw e; // let the grid keep the optimistic draft
    } finally {
      setInFlight((n) => n - 1);
    }
  };

  // Slice 4a: save one row's remark (save_row_remark) -- a SEPARATE write path from rates,
  // mirroring handleSaveRate (in-flight count, takeover detection, mutate refresh). Blank
  // remark clears (backend). The grid renders read-only when this is withheld (locked).
  const handleSaveRemark = async (args: RemarkSaveArgs) => {
    if (commitVersion === null) {
      setSaveError("This sheet has no committed version to annotate.");
      throw new Error("no committed version");
    }
    setSaveError(null);
    setInFlight((n) => n + 1);
    try {
      await saveRowRemark({
        boq_name: boqId, // VERBATIM
        sheet_name: sheetName, // VERBATIM (#152)
        excel_row: args.excelRow,
        committed_version: commitVersion,
        remark: args.remark,
        description: args.description,
      });
      await mutate();
      setLastSavedAt(new Date());
    } catch (e: unknown) {
      const msg = getFrappeError(e);
      if (isTakeoverError(msg)) setTakenOver(true);
      else setSaveError(msg || "Could not save the remark. Please try again.");
      throw e;
    } finally {
      setInFlight((n) => n - 1);
    }
  };

  // Slice 4a: save N color cells (a single pick = 1, an apply-to-row = N) then ONE mutate.
  // The grid builds the cell list; the page owns the POSTs + the refetch. Blank color clears.
  const handleSaveColor = async (argsList: ColorSaveArgs[]) => {
    if (commitVersion === null) {
      setSaveError("This sheet has no committed version to annotate.");
      throw new Error("no committed version");
    }
    if (argsList.length === 0) return;
    setSaveError(null);
    setInFlight((n) => n + 1);
    try {
      for (const args of argsList) {
        await saveCellColor({
          boq_name: boqId, // VERBATIM
          sheet_name: sheetName, // VERBATIM (#152)
          excel_row: args.excelRow,
          col_letter: args.colLetter,
          committed_version: commitVersion,
          color: args.color,
          description: args.description,
        });
      }
      await mutate();
      setLastSavedAt(new Date());
    } catch (e: unknown) {
      const msg = getFrappeError(e);
      if (isTakeoverError(msg)) setTakenOver(true);
      else setSaveError(msg || "Could not save the color. Please try again.");
      throw e;
    } finally {
      setInFlight((n) => n - 1);
    }
  };

  // Slice 4b-ACKNOWLEDGE: dismiss / un-dismiss one review-strip entry (save_cell_dismissal)
  // then ONE mutate so the dismissals list refetches + the strip filter re-derives. Mirrors
  // handleSaveColor (in-flight, takeover, mutate). An acknowledgment, NOT an edit -- it never
  // touches a rate; the server's row-level re-arm clears it again on the next rate edit.
  const handleSaveDismiss = async (args: DismissalSaveArgs) => {
    if (commitVersion === null) {
      setSaveError("This sheet has no committed version to annotate.");
      throw new Error("no committed version");
    }
    setSaveError(null);
    setInFlight((n) => n + 1);
    try {
      await saveCellDismissal({
        boq_name: boqId, // VERBATIM
        sheet_name: sheetName, // VERBATIM (#152)
        excel_row: args.excelRow,
        committed_version: commitVersion,
        flag_kind: args.flagKind,
        dismissed: args.dismissed,
        description: args.description,
      });
      await mutate();
      setLastSavedAt(new Date());
    } catch (e: unknown) {
      const msg = getFrappeError(e);
      if (isTakeoverError(msg)) setTakenOver(true);
      else setSaveError(msg || "Could not update the review state. Please try again.");
      throw e;
    } finally {
      setInFlight((n) => n - 1);
    }
  };

  // Cluster B: choose / clear the per-cell formula-vs-document reconciliation choice
  // (save_cell_reconciliation_choice) then ONE mutate so reconciliation_choices refetches + the
  // grid cue, the strip, and the Summary totals re-derive. Mirrors handleSaveDismiss (in-flight,
  // takeover, mutate). `choice` null clears (revert to unset -> document default, D1).
  const handleSaveReconChoice = async (args: ReconChoiceSaveArgs) => {
    if (commitVersion === null) {
      setSaveError("This sheet has no committed version to annotate.");
      throw new Error("no committed version");
    }
    setSaveError(null);
    setInFlight((n) => n + 1);
    try {
      await saveCellReconChoice({
        boq_name: boqId, // VERBATIM
        sheet_name: sheetName, // VERBATIM (#152)
        excel_row: args.excelRow,
        col_letter: args.colLetter,
        committed_version: commitVersion,
        choice: args.choice ?? "", // "" clears (revert to unset -> document default)
        description: args.description,
      });
      await mutate();
      setLastSavedAt(new Date());
    } catch (e: unknown) {
      const msg = getFrappeError(e);
      if (isTakeoverError(msg)) setTakenOver(true);
      else setSaveError(msg || "Could not save the choice. Please try again.");
      throw e;
    } finally {
      setInFlight((n) => n - 1);
    }
  };

  // Formula Builder F3: save one amount-column formula (save_amount_formula) then mutate so
  // column_formulas refetches + the header label updates. Mirrors handleSaveColor (in-flight,
  // takeover, mutate). The tree is sent as a JSON string; a null formula -> "" (the F1 clear
  // path). Withheld when locked (the grid then renders the header label read-only).
  const handleSaveFormula = async (args: AmountFormulaSaveArgs) => {
    if (commitVersion === null) {
      setSaveError("This sheet has no committed version to add a formula to.");
      throw new Error("no committed version");
    }
    setSaveError(null);
    setInFlight((n) => n + 1);
    try {
      await saveAmountFormula({
        boq_name: boqId, // VERBATIM
        sheet_name: sheetName, // VERBATIM (#152)
        committed_version: commitVersion,
        target_value_field: args.targetValueField,
        target_value_key: args.targetValueKey, // null = the area-wildcard default / scalar
        target_rate_subkey: args.targetRateSubkey,
        formula: args.formula === null ? "" : JSON.stringify(args.formula), // "" = clear
        target_col: args.targetCol,
        description: args.description,
      });
      await mutate();
      setLastSavedAt(new Date());
    } catch (e: unknown) {
      const msg = getFrappeError(e);
      if (isTakeoverError(msg)) setTakenOver(true);
      else setSaveError(msg || "Could not save the formula. Please try again.");
      throw e;
    } finally {
      setInFlight((n) => n - 1);
    }
  };

  // ── Slice 4b-A: the computed review-flag layer (Cluster A) ──────────────────────
  // Everything routes through the ONE shared priceability helper -- the in-grid markers,
  // the strip, AND the priced count. Computed page-side from the rows already in hand (no
  // new fetch). Plain consts (not useMemo) because they sit AFTER the early-return guards
  // (hooks-after-return is illegal); the page re-renders infrequently (saves / toggles),
  // never per keystroke (rate drafts live in the grid), so the recompute is cheap.
  const rowFlags = new Map<number, RowReviewFlags>();
  for (const r of rows) {
    rowFlags.set(r.row_index, computeRowFlags(r, columnDescriptors, columnFormulas));
  }
  // MANDATORY amount-formula gate (Phase 5): per-SHEET completeness -- every amount column must
  // have a declared formula before ANY rate is editable. Plain derive from the data already in
  // hand (columnDescriptors + columnFormulas -- no new fetch). TRUE for a sheet with zero amount
  // columns (trivially complete). Passed to the grid as one boolean prop (ANDed OUTSIDE the
  // override) + drives the "declare formulas" banner.
  const formulasComplete = areFormulasComplete(columnDescriptors, columnFormulas);
  // Priced count: M = priceable lines; N = FULLY priced (every qty-bearing area filled).
  const pricedCount = computePricedCount(rows, columnDescriptors);
  const allPriced = pricedCount.total > 0 && pricedCount.priced === pricedCount.total;
  // "Show only unpriced": priceable-but-not-fully-priced rows (the same shared predicates).
  // Toolbar Part 1: AND-compose the row-TYPE filters (spacers/notes/subtotals) into the SAME
  // single displayRows pass -- VIEW-ONLY. The count (computePricedCount over `rows`), the Summary
  // (rows={rows}), and the review-flag/strip feed (built from `rows`) all read the UNFILTERED
  // `rows`, so hiding a row-type cannot move any total or the N-of-M priceable count. The
  // `=== rows` fast path (stable reference -> the grid's byIdx/depths memos hold) is preserved at
  // default (nothing hidden), byte-identical to the prior showOnlyUnpriced-only behaviour.
  const rowTypeToggles = { showSpacers, showNotes, showSubtotals };
  const noRowTypeHidden = showSpacers && showNotes && showSubtotals;

  // Collapse/expand: the FULL-rows maps + the inverse children map (built over UNFILTERED `rows`
  // so visibility/descendant math is filter-independent -- the canonical rule). Plain consts (not
  // useMemo) because they sit AFTER the early-return guards, matching the rowFlags pattern. Refs
  // are synced so the toggle/reveal callbacks (declared in the hook region) read current data.
  const byRowIndex = new Map<number, CollapseRow>(rows.map((r) => [r.row_index, r]));
  const byExcelRow = new Map<number, CollapseRow>(rows.map((r) => [r.source_row_number, r]));
  const childrenByParent = buildChildrenByParent(rows);
  collapsedRef.current = collapsed;
  byRowIndexRef.current = byRowIndex;
  byExcelRowRef.current = byExcelRow;
  const collapseActive = collapsed.size > 0;

  // The view-filter predicate (show-unpriced + row-type), WITHOUT collapse -- shared by the
  // search universe (R3: search ignores collapse) and folded into displayRows below.
  const passesViewFilter = (r: PricedRow) =>
    (!showOnlyUnpriced ||
      (isPriceableLine(r, columnDescriptors) && !isFullyPriced(r, columnDescriptors))) &&
    classificationVisible(r.effective_classification, rowTypeToggles);
  const anyViewFilter = showOnlyUnpriced || !noRowTypeHidden;
  // displayRows: the view filter AND collapse, composed in ONE page-side pass (R4). VIEW-ONLY --
  // the count (computePricedCount over `rows`), the Summary (rows={rows}), and the review/flag
  // feed all read the UNFILTERED `rows`, so neither hiding a row-type NOR collapsing a subtree
  // moves any total or the N-of-M priceable count. The `=== rows` fast path (stable reference ->
  // the grid's byIdx/depths memos hold) is preserved when nothing is filtered or collapsed.
  const displayRows =
    !anyViewFilter && !collapseActive
      ? rows
      : rows.filter(
          (r) =>
            passesViewFilter(r) &&
            (!collapseActive || !isHiddenByCollapse(r, collapsed, byRowIndex)),
        );

  // Toolbar Part 1 -- description search. Hits are the Excel row numbers of matching rows. R3:
  // search PIERCES collapse -- hits are computed over the view-filtered set IGNORING collapse, so
  // a match under a collapsed parent is still a hit; stepping to it auto-expands its ancestors
  // (revealRow -> the grid's reveal-then-scroll). When nothing is collapsed this IS displayRows
  // (reused, no extra pass); only an active collapse needs the separate non-collapse universe.
  const searchUniverse = !collapseActive
    ? displayRows
    : anyViewFilter
      ? rows.filter(passesViewFilter)
      : rows;
  const searchHits = buildSearchHits(searchUniverse, searchQuery);
  const safeSearchIdx = searchHits.length > 0 ? Math.min(searchCurrentIdx, searchHits.length - 1) : 0;
  const currentHitExcelRow = searchHits.length > 0 ? searchHits[safeSearchIdx] : null;
  const stepSearch = (dir: "prev" | "next") => {
    if (searchHits.length === 0) return;
    const ni = stepHit(safeSearchIdx, searchHits.length, dir);
    setSearchCurrentIdx(ni);
    gridRef.current?.scrollToRow(searchHits[ni]);
  };

  // Toolbar Part 1 -- column-hide: the hideable (non-amount) descriptor columns for the "Columns"
  // popover. Amount columns are excluded (their formula-status badge must never be hidden).
  const hideableCols = hideableDescriptors(columnDescriptors);
  const toggleColHidden = (col: string) =>
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });

  // The UNIFIED review-list feed (extends 4a's remark feed IN PLACE -- one list, no fork):
  //   4a remarks + the computed per-row flags. A GENERIC ReviewEntry shape; each entry
  //   click-jumps to its row via scrollToRow. (The incomplete-subtotal entries were removed
  //   as noise -- that signal now surfaces as ONE quiet message in the Summary tab.)
  const remarkEntries: ReviewEntry[] = rows
    .filter((r) => r.remark && r.remark.trim())
    .map((r) => ({
      kind: "remark" as const,
      excelRow: r.source_row_number,
      description: r.description ?? "",
      text: (r.remark as string).trim(),
    }));
  const flagEntries = buildFlagEntries(rows, columnDescriptors, columnFormulas);
  // Cluster B (D2b): UNRESOLVED document-vs-formula divergence entries (resolved cells drop out).
  // The choice IS the resolution -- a divergence entry is NOT a dismissal (its flag_kind is not a
  // dismissal token), so the dismissal filter below leaves it untouched.
  const divergenceEntries = buildDivergenceEntries(
    rows,
    columnDescriptors,
    columnFormulas,
    reconChoices,
  );
  // The FULL feed (every entry, dismissed or not) -- retained for the "show dismissed" view.
  const allReviewEntries: ReviewEntry[] = [...remarkEntries, ...flagEntries, ...divergenceEntries].sort(
    (a, b) => a.excelRow - b.excelRow,
  );
  // Slice 4b-ACKNOWLEDGE: the dismissed-key membership set (O(1)) + the ACTIVE feed (one pass).
  // The default strip view + the Review-count are ACTIVE-only; the toggle reveals the full list.
  const dismissedSet = buildDismissedKeySet(dismissals);
  const activeReviewEntries = filterActiveReviewEntries(allReviewEntries, dismissedSet);
  // Dismissed = those in the full feed but not active (a dismissal whose entry no longer
  // computes simply isn't in allReviewEntries -- so this counts only LIVE dismissed entries).
  const dismissedCount = allReviewEntries.length - activeReviewEntries.length;
  const reviewEntries = showDismissed ? allReviewEntries : activeReviewEntries;

  // Slice 3c: the save-status chip state (pure derive) + force-save flush.
  const saveStatus = deriveSaveStatus({
    inFlight,
    hasUnsaved,
    hasSaved: lastSavedAt !== null,
    hasError: saveError !== null,
  });

  return (
    <div
      // Slice 4c: ONE JSX tree -- only THIS wrapper's className flips between embedded and the
      // fixed inset-0 full-viewport overlay (covers the app shell, like the house Dialog/Sheet
      // overlay). FULL is `flex flex-col` so the grid slot below can take flex-1 and fill the
      // freed height. No remount -> all grid + page state survives expand/collapse.
      className={cn(
        expanded
          ? "fixed inset-0 z-50 flex flex-col space-y-4 overflow-auto bg-background p-4"
          : "flex-1 space-y-4 max-w-5xl mx-auto pt-6 pb-10 px-4",
      )}
    >
      {/* ── Header strip (Back + title + Slice-3c save status + Save now) ─────── */}
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5 text-muted-foreground mt-0.5"
          onClick={handleBack}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">
            {boq.boq_name} &middot; V{boq.version ?? 1} &middot; Pricing
            {commitVersion !== null && (
              <span className="text-muted-foreground/70"> &middot; committed v{commitVersion}</span>
            )}
          </p>
          <h1 className="text-lg font-semibold text-foreground truncate leading-tight">
            {displaySheetName}
          </h1>
        </div>

        {/* ── Slice 4c: full-screen toggle (ALWAYS rendered) + Slice-3c save-status
            chip / force-save (SUPPRESSED for a grid-only general-specs sheet -- it is
            read-only reference, nothing to save). The right-cluster wrapper now renders
            unconditionally so the maximize toggle is reachable on a read-only / grid-only
            sheet too -- full-screen is orthogonal to editability. */}
        <div className="ml-auto shrink-0 flex items-center gap-3 mt-0.5">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            aria-pressed={expanded}
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Exit full screen (Esc)" : "Expand the editor to full screen"}
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {expanded ? "Exit full screen" : "Full screen"}
          </Button>
          {!isGridOnly && (
          <>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setSummaryOpen((o) => !o)}
            disabled={pricedLoading || pricedError || rows.length === 0}
            title="Toggle the parent-tree amount summary"
          >
            <Sigma className="h-4 w-4" />
            Summary
          </Button>
          {/* Slice 4a/4b-A: the review-list toggle (remarks + all computed flags). */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setReviewOpen((o) => !o)}
            disabled={pricedLoading || pricedError}
            title="Rows flagged for review (remarks + computed flags)"
          >
            <ClipboardList className="h-4 w-4" />
            Review{activeReviewEntries.length > 0 ? ` (${activeReviewEntries.length})` : ""}
          </Button>
          {/* Slice 3e: the priceability OVERRIDE toggle (per-sheet, per-session). A loaded
              gun -- its ON state is loudly amber so the user always sees it is on. Default
              off. Suppressed for grid-only (handled by the !isGridOnly cluster gate). */}
          <Button
            size="sm"
            variant={override ? "default" : "outline"}
            className={cn(
              "gap-1.5",
              override &&
                "bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700",
            )}
            aria-pressed={override}
            onClick={() => setOverride((o) => !o)}
            title={
              override
                ? "Pricing any row is ON -- non-line-item cells are editable; priced ones are flagged for review. Click to turn off."
                : "Allow pricing rows that aren't line items (notes, spacers). Off by default."
            }
          >
            {override ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {override ? "Pricing any row" : "Price any row"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => gridRef.current?.flush()}
            title="Flush any pending edits and save now"
          >
            <Save className="h-4 w-4" />
            Save now
          </Button>
          {/* Status text (save-status chip + priced-count) -- pushed to the ribbon's right.
              Moved here from before the action buttons in the two-ribbon reorg; behavior
              (the saveStatus / pricedCount reads) is byte-identical. */}
          <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            {saveStatus === "saving" && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving&hellip;
              </span>
            )}
            {saveStatus === "saved" && lastSavedAt && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                Saved as of {fmtSavedTime(lastSavedAt)}
              </span>
            )}
            {saveStatus === "unsaved" && (
              <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                Unsaved changes
              </span>
            )}
            {saveStatus === "failed" && (
              <span className="flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Save failed
              </span>
            )}
            {saveStatus === "idle" && (
              <span className="text-muted-foreground">All changes saved</span>
            )}
          </div>
          {/* Slice 4b-A: live priced-count readout -- N of M priceable lines fully priced.
              When N === M, a calm "Ready to finalize" affordance text (no finalize logic --
              that is a later slice). Hidden when the sheet has no priceable lines. */}
          {pricedCount.total > 0 && (
            <span
              className={cn(
                "text-xs font-medium tabular-nums whitespace-nowrap",
                allPriced ? "text-green-700 dark:text-green-400" : "text-muted-foreground",
              )}
              title="Priceable lines that are fully priced (every qty-bearing area's rate filled)"
            >
              {allPriced ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" />
                  {pricedCount.priced} of {pricedCount.total} priced &middot; ready to finalize
                </span>
              ) : (
                <>
                  {pricedCount.priced} of {pricedCount.total} priceable lines priced
                </>
              )}
            </span>
          )}
          </div>
          </>
          )}
        </div>
      </div>

      {/* ── Single-editor lock banners (slice B) ──────────────────────────────
          Mid-edit takeover takes precedence over the load-time holder banner. A STALE
          lock returns editable===true -> NEITHER shows (silent auto-takeover on first
          save). The holder banner shows ONLY when editable===false (truly blocked).
          SUPPRESSED entirely for a grid-only sheet (no editing -> no lock). */}
      {isGridOnly ? null : takenOver ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <p className="text-amber-900 dark:text-amber-100 flex-1">
            This sheet was taken over by another user. Your latest change was not saved.
            Reload to continue.
          </p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleReload}>
            <RefreshCw className="h-3.5 w-3.5" /> Reload
          </Button>
          <Button size="sm" variant="ghost" onClick={handleBack}>
            Go to hub
          </Button>
        </div>
      ) : editable === false ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-sm">
          <Lock className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <p className="text-amber-900 dark:text-amber-100 flex-1">
            This sheet is being priced by{" "}
            <span className="font-medium">{lockInfo?.locked_by_name ?? "another user"}</span>.
            It is read-only until they finish.
          </p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleReload}>
            <RefreshCw className="h-3.5 w-3.5" /> Reload
          </Button>
          <Button size="sm" variant="ghost" onClick={handleBack}>
            Go to hub
          </Button>
        </div>
      ) : null}

      {/* ── In-editor sheet tabs (slice 3d) ───────────────────────────────────
          Switch to another COMMITTED sheet of the SAME BoQ without going out to the
          hub. Workbook order (sheet_order); active tab = the current :sheetName
          (VERBATIM, #152); label = the trimmed display name. A tab change navigates to
          that sheet's editor (the hub's exact nav target) -> the route re-runs + the
          key-remounted grid (below) flushes the old drafts and starts clean. The list
          loads independently -- the strip simply doesn't render until it arrives. */}
      {committedSheets.length > 0 && (
        <Tabs
          value={decodedSheetName}
          onValueChange={(val) => {
            if (val !== decodedSheetName) {
              navigate(`/upload-boq/hub/${boqId ?? ""}/pricing/${encodeURIComponent(val)}`);
            }
          }}
        >
          <TabsList className="flex flex-wrap h-auto justify-start gap-1">
            {committedSheets.map((s) => (
              <TabsTrigger key={s.sheet_name} value={s.sheet_name} className="max-w-[16rem] truncate">
                {s.sheet_name.trim() || s.sheet_name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* ── Bottom ribbon (toolbar two-ribbon reorg) ──────────────────────────
          Grid view-controls BELOW the tab strip: Show unpriced, the description search
          group, Columns, and the Show: row-type toggles. Wrapped in the SAME {!isGridOnly}
          gate that held these controls in the old single toolbar row -- so a grid-only
          general-specs sheet renders NO bottom ribbon (nothing to filter/search), exactly
          as before. Every control is moved VERBATIM: handlers / state / disabled gates are
          byte-identical -- this is a pure relocation, not a behavior change. */}
      {!isGridOnly && (
        <div className="flex items-center gap-3 flex-wrap">
          {/* Slice 4b-A: show-only-unpriced filter (priceable-but-not-fully-priced rows). */}
          <Button
            size="sm"
            variant={showOnlyUnpriced ? "default" : "outline"}
            className="gap-1.5"
            aria-pressed={showOnlyUnpriced}
            onClick={() => setShowOnlyUnpriced((o) => !o)}
            disabled={pricedLoading || pricedError || pricedCount.total === 0}
            title={
              showOnlyUnpriced
                ? "Showing only unpriced lines. Click to show all rows."
                : "Show only priceable lines that aren't fully priced yet."
            }
          >
            <Filter className="h-4 w-4" />
            {showOnlyUnpriced ? "Unpriced only" : "Show unpriced"}
          </Button>

          {/* ── Collapse/expand ALL (slice 2): one state-aware toggle for the WHOLE hierarchy.
              Option A -- "Collapse all" folds EVERY collapsible parent (collapsibleParents =
              new Set(childrenByParent.keys())) so only top-level roots remain; "Expand all" =
              setCollapsed(new Set()). The size===0 rule: nothing collapsed -> offer "Collapse all";
              ANYTHING collapsed (incl. a partially hand-collapsed sheet) -> offer "Expand all" (the
              button returns the sheet to clean). It writes the SAME page `collapsed` set the
              per-parent chevrons read via CollapseContext, so the chevrons + "+N hidden" reflect a
              bulk collapse with ZERO new wiring (no new state, no memo touch). DISABLED on a flat
              sheet (no collapsible parents -- nothing to fold). ── */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={pricedLoading || pricedError || childrenByParent.size === 0}
            aria-label={collapsed.size === 0 ? "Collapse all rows" : "Expand all rows"}
            title={
              childrenByParent.size === 0
                ? "This sheet has no hierarchy to collapse."
                : collapsed.size === 0
                ? "Collapse every parent (only top-level rows stay visible)."
                : "Expand every collapsed row."
            }
            onClick={() =>
              setCollapsed(collapsed.size === 0 ? collapsibleParents(childrenByParent) : new Set())
            }
          >
            {collapsed.size === 0 ? (
              <ChevronsDownUp className="h-4 w-4" />
            ) : (
              <ChevronsUpDown className="h-4 w-4" />
            )}
            {collapsed.size === 0 ? "Collapse all" : "Expand all"}
          </Button>

          {/* ── Toolbar Part 1: description search (input + N-of-M + prev/next cycle). Stepping
              jumps via the grid's existing scrollToRow; the current hit row is highlighted. ── */}
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search description…"
                className="h-8 w-48 pl-7 pr-7 text-xs"
                aria-label="Search descriptions"
                disabled={pricedLoading || pricedError}
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
            <span className="min-w-[48px] text-xs tabular-nums text-muted-foreground">
              {searchQuery.trim() === ""
                ? ""
                : searchHits.length === 0
                ? "0 of 0"
                : `${safeSearchIdx + 1} of ${searchHits.length}`}
            </span>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              disabled={searchHits.length === 0}
              onClick={() => stepSearch("prev")}
              aria-label="Previous match"
              title="Previous match"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              disabled={searchHits.length === 0}
              onClick={() => stepSearch("next")}
              aria-label="Next match"
              title="Next match"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>

          {/* ── Toolbar Part 1: column-hide. Lists ONLY non-amount descriptors (amount columns
              always stay visible so their formula-status badge can never be hidden). ── */}
          {hideableCols.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={pricedLoading || pricedError}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Columns
                  {hiddenCols.size > 0 && (
                    <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      ({hiddenCols.size} hidden)
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto min-w-[220px] p-2">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Data columns
                </p>
                <p className="text-[10px] text-muted-foreground mb-2">
                  Amount columns always stay visible.
                </p>
                <div className="space-y-1">
                  {hideableCols.map((d) => {
                    const colLabel = `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}${d.area ? ` · ${d.area}` : ""}`;
                    return (
                      <label
                        key={d.col}
                        htmlFor={`pricing-vis-col-${d.col}`}
                        className="flex items-center gap-2 py-0.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Checkbox
                          id={`pricing-vis-col-${d.col}`}
                          checked={!hiddenCols.has(d.col)}
                          onCheckedChange={() => toggleColHidden(d.col)}
                        />
                        {colLabel}
                      </label>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* ── Toolbar Part 1: row-type filters (view-only -- only the rendered displayRows is
              narrowed; counts/Summary/flags read the unfiltered rows). ── */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Show:</span>
            <label
              htmlFor="pricing-show-spacers"
              className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
            >
              <Checkbox
                id="pricing-show-spacers"
                checked={showSpacers}
                onCheckedChange={(c) => setShowSpacers(c === true)}
              />
              Spacers
            </label>
            <label
              htmlFor="pricing-show-notes"
              className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
            >
              <Checkbox
                id="pricing-show-notes"
                checked={showNotes}
                onCheckedChange={(c) => setShowNotes(c === true)}
              />
              Notes
            </label>
            <label
              htmlFor="pricing-show-subtotals"
              className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
            >
              <Checkbox
                id="pricing-show-subtotals"
                checked={showSubtotals}
                onCheckedChange={(c) => setShowSubtotals(c === true)}
              />
              Subtotals
            </label>
          </div>
        </div>
      )}

      {/* ── Editor note ───────────────────────────────────────────────────────
          Muted-strip convention (mirrors the review screen). For a grid-only
          general-specs sheet it is a read-only reference note; otherwise the Slice-3b
          rate-editing note. */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border border-border text-xs text-muted-foreground flex-wrap">
        {isGridOnly ? (
          <span>
            This is a general-specifications sheet -- read-only reference. There is nothing to
            price here.
          </span>
        ) : (
          <span>
            Enter a rate in any rate cell. It auto-saves a second after you stop typing (or on
            Enter / click away / arrow-move) -- or press &ldquo;Save now&rdquo;. Amounts shown
            are qty x rate (display-only); priced cells are marked. Rates only are editable.
          </span>
        )}
      </div>

      {/* ── Slice 3e: override-on banner (loud, amber -- the override is a loaded gun). */}
      {!isGridOnly && override && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-100 flex-wrap">
          <Unlock className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
          <span>
            Pricing any row is on: non-line-item rows (notes / spacers) are editable. A rate
            saved on one is flagged amber for review.
          </span>
        </div>
      )}

      {/* ── MANDATORY amount-formula gate banner (Phase 5) ──────────────────────
          Shown when the sheet has amount columns that aren't all covered by a declared
          formula (areFormulasComplete false) AND the sheet is otherwise editable (not
          grid-only, not lock-blocked, loaded OK). Rate cells are read-only until every amount
          column has a formula; the formula builder on each amount column header stays usable
          (declaration works under the gate). A trivially-complete sheet (zero amount columns)
          never shows it (areFormulasComplete is true). Amber-note styling (mirrors the
          override / unmapped-column notes). */}
      {!isGridOnly && !locked && !pricedLoading && !pricedError && !formulasComplete && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-100 flex-wrap">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
          <span>Declare amount formulas to enable rate entry.</span>
        </div>
      )}

      {/* ── Inline save error (a save throw surfaces here; the cell keeps your input). */}
      {!isGridOnly && saveError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-destructive/40 bg-destructive/10 text-xs text-destructive flex-wrap">
          <span>{saveError}</span>
        </div>
      )}

      {/* ── Summary panel (top-down, grid-aligned, fixed-height, internal scroll) ──
          Opens ABOVE the grid; computed page-side from the same rows + descriptors the
          grid renders (no new backend call). The grid stays usable below. */}
      {!isGridOnly && summaryOpen && !pricedLoading && !pricedError && (
        <SummaryPanel
          rows={rows}
          columnDescriptors={columnDescriptors}
          columnFormulas={columnFormulas}
          reconChoices={reconChoices}
          sheetName={displaySheetName}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      {/* ── Slice 4a/4b-A/4b-ACKNOWLEDGE: unified review-list strip ──────────────
          Opened ABOVE the grid (mirrors the Summary panel mount). ONE feed: 4a remarks +
          the 4b-A computed flags (needs-rate / qty-anomaly / broken / not-yet). Each entry
          click-jumps to its row via the grid's scrollToRow handle, and carries a per-entry
          "Looks OK" dismiss (4b-ACKNOWLEDGE) that HIDES it from the active view (toggle
          "Show dismissed" to reveal + restore). The default view is ACTIVE-only. */}
      {!isGridOnly && reviewOpen && !pricedLoading && !pricedError && (
        <div className="rounded-md border border-border bg-muted/20">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-medium text-foreground">
              Review list &middot; remarks &amp; flags ({reviewEntries.length})
            </p>
            <div className="flex items-center gap-1">
              {/* Slice 4b-ACKNOWLEDGE: reveal dismissed entries so nothing is ever lost. */}
              {dismissedCount > 0 && (
                <Button
                  variant={showDismissed ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2"
                  aria-pressed={showDismissed}
                  onClick={() => setShowDismissed((s) => !s)}
                  title={
                    showDismissed
                      ? "Hide dismissed entries (show active only)."
                      : "Show dismissed (reviewed / looks OK) entries too."
                  }
                >
                  {showDismissed ? "Hide dismissed" : `Show dismissed (${dismissedCount})`}
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setReviewOpen(false)}>
                Close
              </Button>
            </div>
          </div>
          {reviewEntries.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {dismissedCount > 0
                ? `Nothing active. ${dismissedCount} dismissed -- click "Show dismissed" to review them.`
                : "Nothing flagged. Priceable lines look fully priced; add a note on any row to flag it."}
            </p>
          ) : (
            <ul className="max-h-[30vh] divide-y divide-border overflow-auto">
              {reviewEntries.map((e) => {
                const meta = REVIEW_ENTRY_META[e.kind];
                const entryDismissed = isEntryDismissed(e, dismissedSet);
                return (
                  <li key={`${e.kind}:${e.excelRow}`} className="flex items-stretch">
                    <button
                      type="button"
                      onClick={() => gridRef.current?.scrollToRow(e.excelRow)}
                      className={cn(
                        "flex-1 px-3 py-2 text-left hover:bg-muted/40",
                        entryDismissed && "opacity-60",
                      )}
                    >
                      <span className="mr-2 font-mono text-xs text-muted-foreground">
                        Row {e.excelRow}
                      </span>
                      <span
                        className={cn(
                          "mr-2 rounded px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                          meta.badge,
                        )}
                      >
                        {meta.label}
                      </span>
                      {entryDismissed && (
                        <span className="mr-2 inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          <Check className="h-3 w-3" /> Looks OK
                        </span>
                      )}
                      <span className="text-xs text-foreground">
                        {e.description || "(no description)"}
                      </span>
                      <span className={cn("mt-0.5 block truncate text-[11px]", meta.text)}>{e.text}</span>
                    </button>
                    {/* Per-entry dismiss / restore. Withheld when locked (read-only sheet) AND
                        for a "divergence" entry -- a divergence is resolved by the in-grid
                        chooser (keep/take), NOT by an acknowledge dismiss (its kind is not a
                        dismissal token; the backend would reject it). */}
                    {!locked && e.kind !== "divergence" && (
                      <div className="flex shrink-0 items-center pr-2">
                        {entryDismissed ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground"
                            title="Show this entry again (un-dismiss)."
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void handleSaveDismiss({
                                excelRow: e.excelRow,
                                flagKind: e.kind,
                                dismissed: false,
                                description: e.description || undefined,
                              });
                            }}
                          >
                            Restore
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            title="Reviewed -- looks OK. Hide this entry from the active list."
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void handleSaveDismiss({
                                excelRow: e.excelRow,
                                flagKind: e.kind,
                                dismissed: true,
                                description: e.description || undefined,
                              });
                            }}
                          >
                            <Check className="h-3.5 w-3.5" /> Looks OK
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── Grid ──────────────────────────────────────────────────────────────── */}
      {pricedLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {pricedError && (
        <p className="text-sm text-destructive">
          Failed to load pricing rows. Check that this sheet has been committed and try again.
        </p>
      )}

      {/* ── Render fork: grid-only -> faithful read-only grid; else the pricing grid.
          We wait for pricedData (it carries commit_version, which the faithful-grid fetch
          needs) before either render. Slice 4c: the grid SLOT takes flex-1 min-h-0 when
          expanded (the root is flex-col) so the grid fills the freed full-screen height; the
          grid's own container relaxes its rem-cap (its `expanded` prop). Embedded -> no class
          (the grid keeps its own viewport-rem cap, byte-for-byte the prior behaviour). */}
      {!pricedLoading && !pricedError && (
        <div className={cn(expanded && "flex min-h-0 flex-1 flex-col")}>
        {isGridOnly ? (
          <SheetDataGrid
            // Faithful committed grid (general specs) -- READ-ONLY reference, all rows at
            // once (pagination stubbed). Reuses SheetDataGrid as-is; falls back to raw Excel
            // column letters when the config maps are empty (a general-specs sheet has none).
            rows={gridData?.message?.rows ?? []}
            hasMore={false}
            isInitLoading={gridData === undefined}
            initError={gridData === null ? "Failed to load the sheet grid." : null}
            isLoadingMore={false}
            loadMoreError={null}
            onLoadMore={() => {}}
            columnRoleMap={gridData?.message?.column_role_map ?? {}}
            headerRow={gridData?.message?.header_row ?? null}
            headerRowCount={(gridData?.message?.header_row_count ?? 1) as 1 | 2}
            areaList={gridData?.message?.area_dimensions ?? []}
            expanded={expanded} // Slice 4c: relax the height cap in full-screen
          />
        ) : (
          <PricingGrid
            // Slice 3d: key on the VERBATIM sheetName so a tab switch UNMOUNTS+REMOUNTS the
            // grid -- the existing flush-on-unmount commits the OLD sheet's pending drafts to
            // the OLD sheet, and the NEW sheet gets a clean grid (empty draftRates/proposed).
            key={sheetName}
            ref={gridRef}
            // Slice 4b-A: "show only unpriced" filters the RENDERED rows to
            // priceable-but-not-fully-priced. Filtering page-side keeps the grid's nav/byIdx
            // consistent over the rendered set; depth degrades gracefully for an orphaned
            // child in the filtered view. draftRates (keyed by row_index) persist across the
            // toggle (the grid is keyed on sheetName only, so it does not remount).
            rows={displayRows}
            columnDescriptors={columnDescriptors}
            // Slice 4b-A: the page-computed review flags (keyed by row_index, over the FULL
            // rows) drive the grid's in-grid markers. The grid reads them; it never computes
            // priceability (the single shared derivation lives in priceability.ts).
            rowFlags={rowFlags}
            // Hard read-only: withhold the save fn when locked -> every grid edit gate (the
            // single onSaveRate root gate) collapses to the read-only render.
            onSaveRate={locked ? undefined : handleSaveRate}
            // Slice 4a: annotation saves gated on the SAME editability signal as rates --
            // withheld when locked/taken-over so the grid renders remarks/colors read-only.
            onSaveRemark={locked ? undefined : handleSaveRemark}
            onSaveColor={locked ? undefined : handleSaveColor}
            // Cluster B: the per-cell reconciliation choices drive the divergence cue + the
            // document-default; onSaveReconChoice is withheld when locked (cue renders a static
            // read-only pill, mirroring onSaveColor/onSaveRate).
            reconChoices={reconChoices}
            onSaveReconChoice={locked ? undefined : handleSaveReconChoice}
            // F3: the amount-column formula header label + builder. columnFormulas drives the
            // `f = ...` label; onSaveFormula is withheld when locked (header renders read-only).
            columnFormulas={columnFormulas}
            onSaveFormula={locked ? undefined : handleSaveFormula}
            onDirtyChange={setHasUnsaved}
            override={override}
            // MANDATORY amount-formula gate (per-sheet): when false the grid renders ALL rate
            // cells read-only (ANDed OUTSIDE the override -- override can't bypass it). Default
            // TRUE for a trivially-complete sheet. onSaveFormula stays live so the holder can
            // declare formulas while rates are locked.
            formulasComplete={formulasComplete}
            editable={editable}
            lockInfo={lockInfo}
            // Slice 4c: relax the grid's height cap to fill the full-screen slot. LAYOUT-ONLY --
            // a per-grid prop, NOT a per-row prop, so the row memo is untouched.
            expanded={expanded}
            // Toolbar Part 1: column-hide (per-GRID; never enters the row memo -- it changes the
            // visible descriptor reference, re-rendering all rows once like formulasComplete) +
            // the current search hit (the grid derives the per-row highlight boolean from it).
            hiddenCols={hiddenCols}
            currentHitExcelRow={currentHitExcelRow}
            // Collapse/expand: page-owned `collapsed` (also composes displayRows above) +
            // childrenByParent (over FULL rows) + the toggle drive the grid's chevrons; onRevealRow
            // powers reveal-then-scroll. GRID-LEVEL props -- NONE enter the row memo (R6).
            collapsed={collapsed}
            childrenByParent={childrenByParent}
            onToggleCollapse={toggleCollapse}
            onRevealRow={revealRow}
          />
        )}
        </div>
      )}
    </div>
  );
};

export default SheetPricingPage;
export { SheetPricingPage as Component };
