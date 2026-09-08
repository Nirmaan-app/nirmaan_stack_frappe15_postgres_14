/**
 * SheetViewPage.tsx -- the READ-ONLY committed-sheet viewer.
 *
 * Route: /upload-boq/hub/:boqId/view/:sheetName
 *
 * WHAT THIS IS AND WHY IT IS NOT SheetPricingPage: the project BoQ tab's row click lands
 * someone who wants to LOOK at a committed sheet, not price it. SheetPricingPage is the
 * editor -- lock acquisition, two ribbons, the rate-helper panel, classify/freeze/BCS, the
 * carry dialog -- and every one of those is an editing affordance. This page renders what a
 * READER needs: the sheet TAB STRIP, the TABLE, and the VIEW controls over it (full screen,
 * Summary, collapse-all, description search, column-hide, the row-type toggles).
 *
 * ⚠️ READ-ONLY IS EXPRESSED BY WITHHOLDING THE SAVE CALLBACKS, which is the grid's OWN
 * convention (frontend/CLAUDE.md: "Read-only gating = PRESENCE of the save callback"). This
 * page passes NONE of them -- no onSaveRate / onBatchWrite / onSaveRemark / onSaveColor /
 * onSaveReconChoice / onSaveFormula / onSaveBcsRates / onCategoryClick -- so every edit gate
 * inside PricingGrid collapses to its read-only render with no new flag to maintain. Do NOT
 * add an `editable`-style boolean here; a second signal is exactly what that convention
 * exists to avoid. It also means this page NEVER acquires the pricing lock, so opening a
 * sheet here can never take it over from someone actually pricing it.
 *
 * ⚠️ EVERY CONTROL BELOW IS A VIEW CONCERN -- collapse, search, column visibility, row-type
 * toggles, the Summary rollup, full screen. None of them writes, and none of them may grow
 * into a write: an affordance added here that posts anything breaks the withheld-callback
 * guarantee above, which is the ONLY thing keeping this page off the lock.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FrappeConfig, FrappeContext, useFrappeGetCall } from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";
import {
  ArrowLeft,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronUp,
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  Search,
  Sigma,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PricingGrid,
  buildSearchHits,
  classificationVisible,
  hideableDescriptors,
  isAmountDescriptor,
  isGridOnlySheet,
  isRateDescriptor,
  orderCommittedSheets,
  shouldExitFullscreenOnEsc,
  stepHit,
  type PricingGridHandle,
} from "./PricingGrid";
import { SummaryPanel } from "./SummaryPanel";
import { buildAndDownloadViewerWorkbook, type ViewerWorkbookSheet } from "./exportViewerXlsx";
import { getFrappeError } from "@/utils/frappeErrors";
import { canSeeBoqCommercials } from "./boqAccess";
import { SheetDataGrid } from "./SheetDataGrid";
import {
  buildChildrenByParent,
  collapsedAncestors,
  collapsibleParents,
  isHiddenByCollapse,
  type CollapseRow,
} from "./collapse";
import { bcsLiveRateKinds, bcsToggleState, type BcsRateKind } from "./bcsColumns";
import { bcsRatesLoadState } from "./pricingLoadState";
import { resolvedToSheetCategoryRow } from "./sheetCategoryResolve";
import { ROLE_LABELS } from "./boqTypes";
import type {
  BcsRowRate,
  CategoryCatalogEntry,
  CommittedSheetGridResponse,
  GetBcsStateResponse,
  GetCommittedStateResponse,
  GetPricedRowsResponse,
  GetSheetBcsRatesResponse,
  GetSheetCategoriesResolvedResponse,
  PricedRow,
  ResolvedSheetCategory,
  SheetCategoryRow,
} from "./boqTypes";

// Module-level constants so an "off" render cannot mint a fresh identity per render and churn
// the memoized grid (the EMPTY_FILTER_SET precedent in SheetPricingPage).
const EMPTY_BCS_KINDS: BcsRateKind[] = [];
const EMPTY_BCS_RATES: Map<number, BcsRowRate> = new Map();

/**
 * ⚠️ ITS OWN KEY, deliberately NOT the editor's `nirmaan-fullscreen-top-collapsed`.
 *
 * The two blocks are not comparable. The editor's holds the version ribbon, both ribbons, every
 * banner and the summary/review panels -- collapsing it in full screen is routine. This page's
 * holds a title row, the tab strip and ONE toolbar. Sharing the key would hide this page's only
 * toolbar because someone collapsed the editor once, which reads as the controls having vanished.
 */
const VIEWER_TOP_COLLAPSED_KEY = "nirmaan-boq-viewer-top-collapsed";

/**
 * Fetch ONE discipline's category catalog and report it up -- rendered once per ran-discipline,
 * so the number of catalog fetches is dynamic yet hook-safe (each instance calls exactly one
 * hook). Renders no DOM. N-generic: `discipline` is data, never a hardcoded string.
 *
 * DELIBERATELY a local twin of SheetPricingPage's fetcher rather than an extraction: hoisting it
 * would mean editing the 5.5k-line editor for a 15-line helper this page only needs in order to
 * turn ids into labels. If a third caller appears, THAT is the moment to give it one home.
 */
function EngineCatalogFetcher({
  discipline,
  onLoaded,
}: {
  discipline: string;
  onLoaded: (discipline: string, categories: CategoryCatalogEntry[]) => void;
}) {
  const { data } = useFrappeGetCall<{
    message: { discipline: string; categories: CategoryCatalogEntry[] };
  }>(
    "nirmaan_stack.api.boq.wizard.classify.get_category_catalog",
    { discipline },
    `boq-catalog::${discipline}`,
  );
  const cats = data?.message?.categories;
  useEffect(() => {
    if (cats) onLoaded(discipline, cats);
  }, [cats, discipline, onLoaded]);
  return null;
}

export const SheetViewPage = () => {
  const navigate = useNavigate();
  // RR v6 auto-decodes path params; sheetName is then matched VERBATIM (#152) everywhere.
  const { boqId, sheetName } = useParams<{ boqId: string; sheetName: string }>();
  // Admin + estimation + billing see the commercial columns; everyone else gets the sheet
  // WITHOUT them. One predicate covers Rate, Amount and BCS together -- see its docblock for
  // why they cannot be split (a visible Amount beside a visible Quantity discloses the Rate).
  const { role, user_id } = useUserData();
  const showCommercials = canSeeBoqCommercials(role, user_id);

  // ── Reads ────────────────────────────────────────────────────────────────────
  // The committed rows + their saved prices. Same endpoint the editor reads; this page
  // simply never posts anything back.
  const { data: pricedData, error: pricedError } = useFrappeGetCall<{
    message: GetPricedRowsResponse;
  }>(
    "nirmaan_stack.api.boq.wizard.pricing.get_priced_rows",
    { boq_name: boqId ?? "", sheet_name: sheetName ?? "" },
    boqId && sheetName ? undefined : null,
  );

  // The sheet tab strip: this BoQ's committed sheets, in workbook order.
  const { data: committedStateData } = useFrappeGetCall<{ message: GetCommittedStateResponse }>(
    "nirmaan_stack.api.boq.wizard.commit_gate.get_committed_state",
    { boq_name: boqId ?? "" },
    boqId ? undefined : null,
  );

  // The Category column's verdicts (multi-engine resolved, HV-10). Read-only here: the
  // adapter drops telemetry exactly as it does in the editor, and no picker is wired.
  const { data: catData } = useFrappeGetCall<{ message: GetSheetCategoriesResolvedResponse }>(
    "nirmaan_stack.api.boq.wizard.classify.get_sheet_categories_resolved",
    { boq: boqId ?? "", sheet_name: sheetName ?? "" },
    boqId && sheetName ? undefined : null,
  );

  const committedSheets = useMemo(
    () => orderCommittedSheets(committedStateData?.message?.committed_state ?? []),
    [committedStateData],
  );

  // A GRID-ONLY (general-specs) sheet commits a faithful cell grid and ZERO nodes, so the
  // node-based get_priced_rows renders it empty. Same EXPLICIT disposition discriminator the
  // editor uses -- never inferred from "rows came back empty".
  const isGridOnly = isGridOnlySheet(
    committedStateData?.message?.committed_state ?? [],
    sheetName ?? "",
  );
  const commitVersion = pricedData?.message?.commit_version ?? null;

  // Per-sheet Work Packages -- carried onto the committed BoQ Sheet at commit time and returned
  // by get_priced_rows (work_packages: string[]). Read defensively: default [] when the payload
  // is missing/older, and drop any empty/whitespace entries so the header badge only renders real
  // assignments. SHEET-LEVEL only -- never threaded into the memoized PricingGrid rows.
  const workPackages = (pricedData?.message?.work_packages ?? []).filter(
    (wp): wp is string => typeof wp === "string" && wp.trim() !== "",
  );

  // ── The sheet payload's slices ───────────────────────────────────────────────
  // No identity-preserving merge is needed here (rowMerge): nothing on this page edits a row,
  // so the array only ever changes when the fetch does.
  //
  // V0/T2 memo shield: PricingGrid is React.memo'd, so every prop it receives must be
  // identity-stable. `?? []` mints a fresh array on each render while the fetch is in flight,
  // which would churn the props and stop the memo ever bailing -- hence the memos.
  const rows = useMemo(() => pricedData?.message?.rows ?? [], [pricedData]);
  const allColumnDescriptors = useMemo(
    () => pricedData?.message?.column_descriptors ?? [],
    [pricedData],
  );
  // ⚠️ WITHHELD FROM THE DESCRIPTOR LIST, NOT HIDDEN VIA `hiddenCols`. Two reasons, both
  // load-bearing: (1) `PricingGrid.isColumnVisible` forces every AMOUNT column visible even when
  // it is in `hiddenCols` -- that exclusion exists so a formula-status badge can never be hidden,
  // and it means hiddenCols simply CANNOT express this gate; (2) a permission gate should not put
  // the figure in the DOM at all. A column the grid was never handed cannot leak.
  const columnDescriptors = useMemo(
    () =>
      showCommercials
        ? allColumnDescriptors
        : allColumnDescriptors.filter((d) => !isRateDescriptor(d) && !isAmountDescriptor(d)),
    [showCommercials, allColumnDescriptors],
  );
  const columnFormulas = useMemo(() => pricedData?.message?.column_formulas ?? [], [pricedData]);
  const reconChoices = useMemo(
    () => pricedData?.message?.reconciliation_choices ?? [],
    [pricedData],
  );
  const { data: gridData } = useFrappeGetCall<{ message: CommittedSheetGridResponse }>(
    "nirmaan_stack.api.boq.wizard.pricing.get_committed_sheet_grid",
    {
      boq_name: boqId ?? "",
      sheet_name: sheetName ?? "", // VERBATIM (#152)
      committed_version: commitVersion ?? 0,
    },
    isGridOnly && boqId && sheetName && commitVersion !== null ? undefined : null,
  );

  // ── Category labels ──────────────────────────────────────────────────────────
  // The cell shows the human-readable LABEL, never the id -- so one catalog fetch per
  // discipline that actually ran, via the same hook-safe child-fetcher pattern the editor
  // uses. N-generic: no discipline is named here.
  const ranDisciplines = useMemo<string[]>(() => catData?.message?.disciplines ?? [], [catData]);
  const [catalogs, setCatalogs] = useState<Record<string, CategoryCatalogEntry[]>>({});
  const handleCatalogLoaded = useCallback((discipline: string, cats: CategoryCatalogEntry[]) => {
    setCatalogs((prev) => (prev[discipline] ? prev : { ...prev, [discipline]: cats }));
  }, []);
  const categoryLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const cats of Object.values(catalogs)) cats.forEach((c) => m.set(c.id, c.label));
    return m;
  }, [catalogs]);

  const categoriesByExcelRow = useMemo(() => {
    const m = new Map<number, SheetCategoryRow>();
    (catData?.message?.categories ?? []).forEach((c: ResolvedSheetCategory) =>
      m.set(c.excel_row, resolvedToSheetCategoryRow(c)),
    );
    return m;
  }, [catData]);

  // ── BCS: the INTERNAL cost block ─────────────────────────────────────────────
  // Shown here when the sheet has it switched on -- READ-ONLY, like everything else on this
  // page: `onSaveBcsRates` is withheld, so the cost boxes render as figures, not inputs.
  //
  // ⚠️ THE EXPORT-LEAK BOUNDARY IS NOT AT ISSUE HERE and must not be read as relaxed: that
  // rule governs the CLIENT WORKBOOK export, which this page does not offer. What is on
  // screen is the same internal cost the pricing editor already shows to whoever opens the
  // sheet; this page adds no new audience and writes nothing.
  const { data: bcsData, error: bcsFetchError } = useFrappeGetCall<{
    message: GetBcsStateResponse;
  }>(
    "nirmaan_stack.api.boq.wizard.bcs.get_bcs_state",
    {
      boq_name: boqId ?? "",
      sheet_name: sheetName ?? "", // VERBATIM (#152)
      committed_version: commitVersion ?? 0,
    },
    boqId && sheetName && commitVersion !== null ? undefined : null,
  );
  const { data: bcsRatesData, error: bcsRatesFetchError } = useFrappeGetCall<{
    message: GetSheetBcsRatesResponse;
  }>(
    "nirmaan_stack.api.boq.wizard.bcs.get_sheet_bcs_rates",
    {
      boq_name: boqId ?? "",
      sheet_name: sheetName ?? "", // VERBATIM (#152)
      committed_version: commitVersion ?? 0,
    },
    boqId && sheetName && commitVersion !== null ? undefined : null,
  );

  // THREE states, not two: `bcsToggleState` keeps "we have no payload" apart from "BCS is off",
  // so a failed read never renders an enabled sheet as OFF. Never re-derive `bcs_enabled` here.
  const bcsState = bcsData?.message ?? null;
  const bcsToggle = bcsToggleState({
    fetchFailed: !!bcsFetchError,
    enabled: bcsState?.bcs_enabled ?? null,
  });
  // Readiness IS enablement since BCS-S12 (the two column pickers are gone); `is_ready` is read
  // rather than re-derived so this page cannot disagree with the editor about the same sheet.
  const bcsReady = bcsState?.is_ready ?? false;
  const bcsRatesLoad = bcsRatesLoadState({ data: bcsRatesData, error: bcsRatesFetchError });
  // ⚠️ `isUsable`, NOT `!isFailed`: it is false while the first read is in flight too, so the
  // block never flashes empty-then-fills. An empty rate map is not silence -- it is the sentence
  // "nothing on this sheet has been costed", which on a fully costed sheet is a confident
  // falsehood. Absence of knowledge renders as NOTHING here, never as a blank that reads as zero.
  const bcsColumnsVisible =
    showCommercials &&
    bcsToggle === "on" &&
    bcsReady &&
    commitVersion !== null &&
    bcsRatesLoad.isUsable;
  const bcsKinds = useMemo(
    () => (bcsColumnsVisible ? bcsLiveRateKinds(allColumnDescriptors) : EMPTY_BCS_KINDS),
    [bcsColumnsVisible, allColumnDescriptors],
  );
  const bcsRatesByExcelRow = useMemo(() => {
    if (!bcsRatesLoad.isUsable) return EMPTY_BCS_RATES;
    const m = new Map<number, BcsRowRate>();
    // The `?? []` is live null-safety, not leftover defensiveness: a `{message: {}}` envelope
    // classifies as `ready`, and `for (const r of undefined)` would take the page down.
    for (const r of bcsRatesData?.message?.rows ?? []) m.set(r.excel_row, r);
    return m;
  }, [bcsRatesData, bcsRatesLoad]);
  const bcsQtySource = bcsState?.bcs_qty_source ?? null;
  const bcsAmountSource = bcsState?.bcs_amount_source ?? null;

  // ── View state ───────────────────────────────────────────────────────────────
  // Everything below is a VIEW concern: it narrows or re-arranges what is on screen and posts
  // nothing. Each piece is per-SHEET and is reset by the tab-switch effect further down.
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCurrentIdx, setSearchCurrentIdx] = useState(0);
  const [showSpacers, setShowSpacers] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [showSubtotals, setShowSubtotals] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const gridRef = useRef<PricingGridHandle>(null);

  // Full screen. Pure LAYOUT: it flips ONLY the root wrapper's className, so the ONE JSX tree
  // (and the grid's key={sheetName}) is untouched and nothing remounts. Mirrors the editor's
  // Slice 4c, and like it is NOT reset on a tab switch -- staying maximised across sheets is
  // the useful behaviour.
  const [expanded, setExpanded] = useState(false);
  // In FULL SCREEN the whole top block (title row + tab strip + toolbar) collapses so the grid
  // fills the viewport. Persisted -- see VIEWER_TOP_COLLAPSED_KEY for why it is not the editor's.
  const [topCollapsed, setTopCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(VIEWER_TOP_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEWER_TOP_COLLAPSED_KEY, topCollapsed ? "1" : "0");
    } catch {
      /* storage unavailable -- collapse state simply is not persisted */
    }
  }, [topCollapsed]);

  // ⚠️ THE TAB STRIP NAVIGATES A PARAM, IT DOES NOT REMOUNT THIS PAGE. Only the grid carries
  // key={sheetName}; SheetViewPage itself stays mounted across a sheet switch, so every piece of
  // per-sheet view state above would otherwise carry over. That is not cosmetic for `collapsed`:
  // it holds `row_index` values, which mean a DIFFERENT row on the next sheet, so sheet A's
  // collapse set folds arbitrary rows of sheet B. (Pre-existing for collapse; every control added
  // alongside it has the same shape.) The editor has the same effect for the same reason.
  useEffect(() => {
    setCollapsed(new Set());
    setHiddenCols(new Set());
    setSearchQuery("");
    setSearchCurrentIdx(0);
    setShowSpacers(true);
    setShowNotes(true);
    setShowSubtotals(true);
    setSummaryOpen(false);
  }, [sheetName]);

  // A fresh query starts at hit 1; the pointer is also clamped at render (safeSearchIdx), so a
  // query that shrinks the hit list can never leave the pointer past the end.
  useEffect(() => {
    setSearchCurrentIdx(0);
  }, [searchQuery]);

  // ── Row-type view filter ─────────────────────────────────────────────────────
  // ONE predicate, ANDed -- the composition rule from frontend/CLAUDE.md. This is the VIEWER'S
  // own three-clause version, deliberately NOT the editor's `passesViewFilter`: that one also
  // answers for the margin range, ticked rows, show-unpriced and check-category, none of which
  // exist on this page. A new view filter here becomes a clause in THIS function and a term in
  // `anyViewFilter` -- never a second filtering pass.
  const rowTypeToggles = useMemo(
    () => ({ showSpacers, showNotes, showSubtotals }),
    [showSpacers, showNotes, showSubtotals],
  );
  const anyViewFilter = !showSpacers || !showNotes || !showSubtotals;
  const filteredRows = useMemo(
    () =>
      anyViewFilter
        ? rows.filter((r) => classificationVisible(r.effective_classification, rowTypeToggles))
        : rows,
    [rows, anyViewFilter, rowTypeToggles],
  );

  // ── Collapse ─────────────────────────────────────────────────────────────────
  // byRowIndex / childrenByParent are built over the FULL row set so descendant + visibility
  // math is filter-independent (a collapsed parent hidden by a row-type filter must still hide
  // its children).
  const byRowIndex = useMemo(
    () => new Map<number, CollapseRow>(rows.map((r) => [r.row_index, r])),
    [rows],
  );
  const childrenByParent = useMemo(() => buildChildrenByParent(rows), [rows]);
  const toggleCollapse = useCallback((rowIndex: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }, []);
  const displayRows = useMemo(
    () =>
      collapsed.size === 0
        ? filteredRows
        : filteredRows.filter((r) => !isHiddenByCollapse(r, collapsed, byRowIndex)),
    [filteredRows, collapsed, byRowIndex],
  );

  // Reveal-then-scroll: expand a jump target's collapsed ANCESTORS so the scroll lands on a
  // visible row instead of silently no-opping. Returns TRUE iff it changed `collapsed` (the grid
  // then defers the scroll a tick). Reads refs, so the callback stays reference-stable -- it is a
  // PricingGrid prop and the memo shield requires it.
  const byExcelRow = useMemo(
    () => new Map<number, PricedRow>(rows.map((r) => [r.source_row_number, r])),
    [rows],
  );
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const byRowIndexRef = useRef(byRowIndex);
  byRowIndexRef.current = byRowIndex;
  const byExcelRowRef = useRef(byExcelRow);
  byExcelRowRef.current = byExcelRow;
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

  // ── Description search ───────────────────────────────────────────────────────
  // ⚠️ SEARCH PIERCES COLLAPSE. Hits are computed over `filteredRows` -- the row-type-filtered
  // set with collapse NOT applied -- so a match under a collapsed parent is still a hit;
  // stepping to it expands its ancestors through `revealRow` before the scroll. Searching
  // `displayRows` instead would make a match silently disappear the moment its parent is folded.
  const searchHits = useMemo(
    () => buildSearchHits(filteredRows, searchQuery),
    [filteredRows, searchQuery],
  );
  const safeSearchIdx =
    searchHits.length > 0 ? Math.min(searchCurrentIdx, searchHits.length - 1) : 0;
  const currentHitExcelRow = searchHits.length > 0 ? searchHits[safeSearchIdx] : null;
  const stepSearch = (dir: "prev" | "next") => {
    if (searchHits.length === 0) return;
    const ni = stepHit(safeSearchIdx, searchHits.length, dir);
    setSearchCurrentIdx(ni);
    gridRef.current?.scrollToRow(searchHits[ni]);
  };

  // ── Column hide ──────────────────────────────────────────────────────────────
  // ⚠️ RUNS ON `columnDescriptors`, THE COMMERCIALS-FILTERED LIST -- never `allColumnDescriptors`.
  // A reader without commercials never had the rate/amount descriptors handed to them, so those
  // columns must not appear in this popover either; pointing it at the raw list would name a
  // column the grid cannot show. `hideableDescriptors` separately excludes AMOUNT columns, which
  // `isColumnVisible` force-shows so their formula-status badge can never be hidden.
  const hideableCols = useMemo(() => hideableDescriptors(columnDescriptors), [columnDescriptors]);
  const toggleColHidden = (col: string) =>
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });

  // ── Summary ──────────────────────────────────────────────────────────────────
  // The cost axis rides the SAME `bcsColumnsVisible` gate as the grid's BCS block, so a reader
  // without commercials gets the panel with no cost/margin columns rather than one that leaks
  // them. MEMOISED because it is a `rollupByParent` argument -- a fresh object each render would
  // re-walk every row's tree.
  const summaryBcsInput = useMemo(
    () =>
      bcsColumnsVisible
        ? {
            ratesByExcelRow: bcsRatesByExcelRow,
            kinds: bcsKinds,
            qtySource: bcsQtySource,
            amountSource: bcsAmountSource,
          }
        : null,
    [bcsColumnsVisible, bcsRatesByExcelRow, bcsKinds, bcsQtySource, bcsAmountSource],
  );

  // ── Download: ONE .xlsx, one worksheet per committed sheet ───────────────────
  // The tab strip's `committedSheets` IS the sheet set, so the file covers the whole BoQ, not
  // just the sheet on screen. Each sheet's rows are fetched SEQUENTIALLY (never N parallel
  // calls -- a 33-sheet BoQ would hammer the web tier), and the CURRENT sheet is re-fetched
  // with the rest rather than special-cased from `pricedData`: one code path, and the loaded
  // payload may be older than the others by the time the loop runs.
  //
  // ⚠️ THE COMMERCIALS FILTER IS RE-APPLIED PER SHEET. `columnDescriptors` above is filtered
  // for the sheet on screen only; each fetched sheet carries its OWN descriptor list, and
  // handing the RAW list to the builder would write every rate and amount of the other sheets
  // into a file for a reader who cannot see them on screen. This one line is the whole gate.
  //
  // Grid-only (general-specs) sheets are SKIPPED: they commit a faithful cell grid and ZERO
  // nodes, so get_priced_rows returns nothing for them and their tab would be a header row
  // claiming the sheet is empty.
  const { call } = useContext(FrappeContext) as FrappeConfig;
  const [downloading, setDownloading] = useState<{ current: number; total: number } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const committedState = committedStateData?.message?.committed_state ?? [];
  const exportableSheets = committedSheets.filter(
    (s) => !isGridOnlySheet(committedState, s.sheet_name),
  );

  const handleDownload = async () => {
    if (!boqId || exportableSheets.length === 0 || downloading) return;
    setDownloadError(null);
    // Names the sheet a failure happened on, so the message can point at it.
    let failedSheet: string | null = null;
    try {
      const collected: ViewerWorkbookSheet[] = [];
      for (let i = 0; i < exportableSheets.length; i++) {
        const name = exportableSheets[i].sheet_name; // VERBATIM (#152)
        failedSheet = name;
        setDownloading({ current: i + 1, total: exportableSheets.length });
        const res = await call.get(
          "nirmaan_stack.api.boq.wizard.pricing.get_priced_rows",
          { boq_name: boqId, sheet_name: name },
        );
        const msg = (res?.message ?? {}) as GetPricedRowsResponse;
        const raw = msg.column_descriptors ?? [];
        collected.push({
          sheetName: name,
          rows: msg.rows ?? [],
          // The per-sheet gate -- see the block comment above.
          columnDescriptors: showCommercials
            ? raw
            : raw.filter((d) => !isRateDescriptor(d) && !isAmountDescriptor(d)),
          columnFormulas: msg.column_formulas ?? [],
          // Categories are fetched for the CURRENT sheet only; other tabs get a blank Category
          // column rather than N more round trips for a label. Deliberate v1 scope.
          categoriesByExcelRow: name === sheetName ? categoriesByExcelRow : undefined,
          categoryLabelById,
        });
      }
      failedSheet = null; // past the fetch loop -- any throw below is the build step
      await buildAndDownloadViewerWorkbook({ boqName: boqId, sheets: collected });
      setDownloading(null);
    } catch (e: unknown) {
      // Abort the WHOLE export -- a partial workbook that looks complete is worse than none.
      setDownloading(null);
      const where = failedSheet ? `"${failedSheet.trim() || failedSheet}"` : "the workbook";
      setDownloadError(
        `Could not export ${where}. ${getFrappeError(e) || "Please try again."} No file was downloaded.`,
      );
    }
  };

  const isLoading = !!boqId && !!sheetName && !pricedData && !pricedError;
  // "The sheet is on screen and can be acted on" -- the toolbar's disabled-state source.
  const sheetUsable = !pricedError && !isLoading;
  const displaySheetName = sheetName?.trim() || sheetName || "";

  // Esc in full screen. Mounted ONLY while expanded. `shouldExitFullscreenOnEsc` guards the two
  // collision cases: a Radix popover closing on its own Esc (defaultPrevented) and an input being
  // typed in -- so an Esc in the search box clears nothing here and never exits. TWO-STEP: while
  // the top block is collapsed the first Esc RE-EXPANDS it (the user is never trapped with the
  // controls hidden); a second Esc then exits full screen.
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!shouldExitFullscreenOnEsc(e, document.activeElement)) return;
      if (topCollapsed) setTopCollapsed(false);
      else setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, topCollapsed]);

  return (
    <div
      // ONE JSX tree -- only THIS wrapper's className flips between the embedded page and the
      // fixed inset-0 full-viewport overlay. FULL is `flex flex-col` so the grid slot below can
      // take flex-1 and fill the freed height. No remount -> all view state survives the toggle.
      className={cn(
        expanded
          ? "fixed inset-0 z-50 flex flex-col space-y-4 overflow-auto bg-background p-4"
          : "space-y-4 p-4",
      )}
    >
      {/* One catalog fetch per ran discipline. Renders no DOM. */}
      {ranDisciplines.map((d) => (
        <EngineCatalogFetcher key={d} discipline={d} onLoaded={handleCatalogLoaded} />
      ))}

      {/* ── TOP BLOCK: title row + tab strip + toolbar. Collapsible in full screen ONLY --
          `topCollapsed` bites only while `expanded`, so the embedded page never hides it. */}
      <div className={cn("space-y-4", expanded && topCollapsed && "hidden")}>
        {expanded && (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setTopCollapsed(true)}
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Collapse the toolbar area"
              aria-expanded={!topCollapsed}
            >
              <ChevronUp className="h-4 w-4" /> Collapse toolbars
            </button>
          </div>
        )}

        {/* Header: back to the project's BoQ list, the sheet identity, then the sheet-level
            badges + the two view actions, right-packed. */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold truncate leading-tight">{displaySheetName}</h1>
            <p className="text-xs text-muted-foreground truncate">
              {boqId}
              {commitVersion !== null && (
                <span className="text-muted-foreground/70"> &middot; committed v{commitVersion}</span>
              )}
            </p>
          </div>

          <div className="ml-auto shrink-0 flex flex-wrap items-center justify-end gap-2">
            {/* Per-sheet Work Packages badge -- the committed-version WP snapshot that rides
                get_priced_rows. IDENTICAL to the editor's and the Review screen's badge. */}
            {workPackages.length > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground max-w-[16rem]"
                title={`Work packages: ${workPackages.join(", ")}`}
              >
                <span className="text-primary font-medium">WP</span>
                <span className="truncate">{workPackages.join(" · ")}</span>
              </span>
            )}
            {/* Download: ONE .xlsx covering EVERY committed sheet of this BoQ, not just the
                one on screen. Disabled when the BoQ has no node-bearing sheet to write. The
                title states the two things a reader cannot see from the button: that it spans
                every sheet, and that it ignores the view filters. */}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={handleDownload}
              disabled={!!downloading || exportableSheets.length === 0}
              title={
                exportableSheets.length === 0
                  ? "This BoQ has no committed sheet with rows to export."
                  : `Download all ${exportableSheets.length} committed sheet${exportableSheets.length === 1 ? "" : "s"} as one .xlsx (the full sheets, not the filtered view).`
              }
            >
              {downloading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {downloading.current} of {downloading.total}…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Download
                </>
              )}
            </Button>
            {/* Summary is meaningless on a grid-only sheet (it rolls up the NODE tree, and a
                general-specs sheet commits zero nodes), so it is not offered there. */}
            {!isGridOnly && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                aria-pressed={summaryOpen}
                onClick={() => setSummaryOpen((o) => !o)}
                disabled={!sheetUsable || rows.length === 0}
                title="Toggle the parent-tree amount summary"
              >
                <Sigma className="h-4 w-4" />
                Summary
              </Button>
            )}
            {/* Full screen is ALWAYS rendered -- it is orthogonal to what the sheet contains, so
                a grid-only sheet gets it too (the editor's rule). */}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              aria-pressed={expanded}
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? "Exit full screen (Esc)" : "Expand the viewer to full screen"}
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              {expanded ? "Exit full screen" : "Full screen"}
            </Button>
          </div>
        </div>

        {/* Sheet tabs -- switching stays INSIDE the viewer (never hops to the editor). */}
        {committedSheets.length > 0 && (
          <Tabs
            value={sheetName}
            onValueChange={(val) => {
              if (val !== sheetName) {
                navigate(`/upload-boq/hub/${boqId ?? ""}/view/${encodeURIComponent(val)}`);
              }
            }}
          >
            <TabsList className="flex flex-wrap h-auto justify-start gap-1">
              {committedSheets.map((s) => (
                <TabsTrigger
                  key={s.sheet_name}
                  value={s.sheet_name}
                  className="max-w-[16rem] truncate"
                >
                  {s.sheet_name.trim() || s.sheet_name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {/* ── View toolbar. Every control here targets PricingGrid, which a GRID-ONLY sheet does
            not render (it goes to SheetDataGrid), so the whole strip is withheld for those --
            a live control that could not act on anything would be its own kind of lie. */}
        {!isGridOnly && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!sheetUsable || childrenByParent.size === 0}
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

            {/* Description search: input + N-of-M + prev/next cycle. Stepping jumps through the
                grid's scrollToRow handle; the current hit row is highlighted by the grid. */}
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search description…"
                  className="h-8 w-48 pl-7 pr-7 text-xs"
                  aria-label="Search descriptions"
                  disabled={!sheetUsable}
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

            {/* Column-hide. Lists ONLY non-amount descriptors (amount columns always stay
                visible so their formula-status badge can never be hidden). */}
            {hideableCols.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={!sheetUsable}>
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
                          htmlFor={`viewer-vis-col-${d.col}`}
                          className="flex items-center gap-2 py-0.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Checkbox
                            id={`viewer-vis-col-${d.col}`}
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

            {/* Row-type filters (view-only -- they narrow the rendered rows; the Summary rollup
                and the search universe read their own sets). */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Show:</span>
              <label
                htmlFor="viewer-show-spacers"
                className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
              >
                <Checkbox
                  id="viewer-show-spacers"
                  checked={showSpacers}
                  onCheckedChange={(c) => setShowSpacers(c === true)}
                />
                Spacers
              </label>
              <label
                htmlFor="viewer-show-notes"
                className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
              >
                <Checkbox
                  id="viewer-show-notes"
                  checked={showNotes}
                  onCheckedChange={(c) => setShowNotes(c === true)}
                />
                Notes
              </label>
              <label
                htmlFor="viewer-show-subtotals"
                className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
              >
                <Checkbox
                  id="viewer-show-subtotals"
                  checked={showSubtotals}
                  onCheckedChange={(c) => setShowSubtotals(c === true)}
                />
                Subtotals
              </label>
            </div>
          </div>
        )}
      </div>

      {/* A failed export names the sheet it stopped on and says plainly that NOTHING was
          downloaded -- the one thing a reader must not have to guess after a click that
          normally produces a file. */}
      {downloadError && (
        <p className="text-sm text-destructive" role="alert">
          {downloadError}
        </p>
      )}

      {/* SLIM re-expand rail -- shown only when the full-screen top block is collapsed. One click
          (or Escape) re-expands; carries the truncated sheet name so the identity is never lost,
          and a compact chip for any view filter that is currently narrowing the sheet, so
          collapsing the toolbar can never hide the fact that rows are being withheld. */}
      {expanded && topCollapsed && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1">
          <button
            type="button"
            onClick={() => setTopCollapsed(false)}
            className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Expand the toolbar area"
            aria-expanded={false}
          >
            <ChevronDown className="h-4 w-4" />
            <span className="max-w-[40vw] truncate">{displaySheetName || "Sheet"}</span>
          </button>
          {(anyViewFilter || hiddenCols.size > 0 || collapsed.size > 0) && (
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
              {anyViewFilter && (
                <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  Rows filtered
                </span>
              )}
              {hiddenCols.size > 0 && (
                <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  {hiddenCols.size} column{hiddenCols.size === 1 ? "" : "s"} hidden
                </span>
              )}
              {collapsed.size > 0 && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Collapsed
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary panel -- opens ABOVE the grid, computed page-side from the same rows +
          descriptors the grid renders (no new backend call). Reads the UNFILTERED `rows`: it is
          a rollup of the sheet, not of the current view, so hiding notes must not move a total. */}
      {!isGridOnly && summaryOpen && sheetUsable && rows.length > 0 && (
        <SummaryPanel
          rows={rows}
          columnDescriptors={columnDescriptors}
          columnFormulas={columnFormulas}
          reconChoices={reconChoices}
          bcs={summaryBcsInput}
          sheetName={displaySheetName}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      {/* The grid slot. In FULL SCREEN this wrapper MUST propagate the flex column so the grid's
          own container bounds to the viewport and becomes the internal scroller -- that is what
          keeps its sticky header visible and its horizontal scrollbar at the bottom of the
          screen. Embedded -> no class, layout byte-unchanged. */}
      <div className={cn(expanded && "flex min-h-0 flex-1 flex-col")}>
        {pricedError ? (
          <p className="text-sm text-destructive py-4">Failed to load this sheet.</p>
        ) : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isGridOnly ? (
          <SheetDataGrid
            rows={gridData?.message?.rows ?? []}
            hasMore={false}
            isInitLoading={!gridData}
            initError={null}
            isLoadingMore={false}
            loadMoreError={null}
            onLoadMore={() => {}}
            columnRoleMap={gridData?.message?.column_role_map ?? {}}
            headerRow={gridData?.message?.header_row ?? null}
            headerRowCount={(gridData?.message?.header_row_count ?? 1) as 1 | 2}
            areaList={gridData?.message?.area_dimensions ?? []}
          />
        ) : (
          <PricingGrid
            // Remount on a tab switch so the new sheet starts clean (the editor's convention).
            key={sheetName}
            ref={gridRef}
            rows={displayRows}
            columnDescriptors={columnDescriptors}
            // Amount columns still COMPUTE from their declared formulas -- the figures are what
            // a reader came for. Only the authoring callback (onSaveFormula) is withheld.
            columnFormulas={columnFormulas}
            reconChoices={reconChoices}
            categoriesByExcelRow={categoriesByExcelRow}
            categoryLabelById={categoryLabelById}
            hasRun={categoriesByExcelRow.size > 0}
            collapsed={collapsed}
            childrenByParent={childrenByParent}
            onToggleCollapse={toggleCollapse}
            onRevealRow={revealRow}
            hiddenCols={hiddenCols}
            currentHitExcelRow={currentHitExcelRow}
            // BCS cost block. `bcsKinds` EMPTY removes it entirely and every colIndex reverts,
            // so a sheet with BCS off is unchanged. `onSaveBcsRates` is withheld -> read-only.
            bcsKinds={bcsKinds}
            bcsRatesByExcelRow={bcsRatesByExcelRow}
            bcsQtySource={bcsQtySource}
            bcsAmountSource={bcsAmountSource}
            expanded={expanded}
            virtualized
          />
        )}
      </div>
    </div>
  );
};

export default SheetViewPage;
export { SheetViewPage as Component };
