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
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDoc, useFrappePostCall, FrappeContext, type FrappeConfig } from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";
import { BoqPresence } from "./BoqPresence";
import { AlertTriangle, ArrowDownToLine, ArrowLeft, Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, ChevronUp, ClipboardList, Filter, Loader2, Lock, Maximize2, Minimize2, Pin, PinOff, Redo2, RefreshCw, Save, Search, ShieldCheck, ShieldOff, Sigma, SlidersHorizontal, Snowflake, Sparkles, Undo2, Unlock, X } from "lucide-react";
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
import { formatDate } from "@/utils/FormatDate";
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
  CategoryCatalogEntry,
  ClassifySummary,
  ColorSaveArgs,
  CommittedSheetGridResponse,
  DismissalSaveArgs,
  EngineCatalog,
  EngineOption,
  ApplyCopyForwardResponse,
  GetCommittedStateResponse,
  GetCrossBoqCarryPlanResponse,
  GetPricedRowsResponse,
  GetSheetCategoriesResolvedResponse,
  GetSheetVersionsResponse,
  PricedRow,
  RateCellSaveArgs,
  ReconChoiceSaveArgs,
  RemarkSaveArgs,
  ResolvedSheetCategory,
  ReviewEntry,
  RowReviewFlags,
  SheetCategoryRow,
} from "./boqTypes";
import { ROLE_LABELS } from "./boqTypes";
import { VersionRibbon } from "./VersionRibbon";
import { CopyForwardDialog } from "./CopyForwardDialog";
import {
  CROSS_BOQ_CARRY_PLAN_METHOD,
  CrossBoqCarryDialog,
  carryButtonState,
  summarizeSheetCarry,
} from "./CrossBoqCarryDialog";
import { CategoryVerdictPicker, buildEngineGroups } from "./CategoryVerdictPicker";
import {
  acceptClassifyEvent,
  addRunningDisciplines,
  buildSheetEngineCatalogs,
  removeRunningDiscipline,
  resolvedToSheetCategoryRow,
  summariseResolvedOutcome,
  unionScopes,
  type ScopeUnion,
} from "./sheetCategoryResolve";
import { ClassifyProgressModal, aiStatusWarning } from "./ClassifyProgressModal";
import {
  ClassifySheetDialog,
  reduceProgress,
  skipRollupText,
} from "./ClassifySheetDialog";
import {
  PricingGrid,
  buildOptimisticVerdict,
  buildSearchHits,
  classificationVisible,
  countMasterSetBlankRows,
  deriveSaveStatus,
  hideableDescriptors,
  isCategoryGateOpen,
  isGridOnlySheet,
  isMasterSetBlank,
  isRateDescriptor,
  isTakeoverError,
  orderCommittedSheets,
  shouldExitFullscreenOnEsc,
  stepHit,
  type PricingGridHandle,
} from "./PricingGrid";
import type { BatchOutcome, BatchWrite } from "./clipboard";
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
import { mergeRowsPreservingIdentity } from "./rowMerge";
import { SheetDataGrid } from "./SheetDataGrid";
import { SummaryPanel } from "./SummaryPanel";
// Rate-helper (DEV ONLY -- guardrail G1). RM-3: the helper is REAL (server extraction + the RM-2
// interpreter client-side) with a persisted, version-keyed run; the U1 stub is gone.
import { RATE_HELPER_ENABLED } from "./rate-helper/rateHelperFlag";
import type { ExtractionRow, RowSuggestions } from "./rate-helper/rateHelperTypes";
import {
  buildRowContext,
  buildSuggestions,
  markSuggestionUsed,
  rateKindOfDescriptor,
  rateKindsOf,
} from "./rate-helper/rateSuggestionModel";
import { RateHelperPanel, type UseMeta } from "./rate-helper/RateHelperPanel";
import { buildHelperList } from "./rate-helper/rateHelperRegistry";
import {
  buildExtractionByRow,
  isRunForVersion,
  makePricingSheetHelper,
} from "./rate-helper/pricingSheetHelper";
import { RateSuggestProgressModal } from "./rate-helper/RateSuggestProgressModal";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";

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

// CL-2: the classify-sheet realtime payloads + the get_classify_status poll shape. The done event
// carries the full ClassifySummary plus the run identity (boq_name / sheet_name / discipline).
interface ClassifyProgressPayload {
  boq: string;
  sheet_name: string;
  discipline: string;
  done: number;
  total: number;
}
interface ClassifyDonePayload extends ClassifySummary {
  status: string;
  boq_name: string;
  sheet_name: string;
  discipline: string;
}
interface ClassifyStatusResponse {
  state: string; // "running" | "done" | ... (backend-authoritative)
  done?: number;
  total?: number;
  status?: string;
  total_in_range?: number;
  eligible_classified?: number;
  needs_review?: number;
  auto_accepted?: number;
  skipped_total?: number;
  skipped_by_reason?: Record<string, number>;
  committed_version?: number | null;
  sheet_warnings?: string[];
}
// HV-10: a stable empty catalog record for the default (no catalogs fetched) case.
const EMPTY_CATALOGS: Record<string, EngineCatalog> = {};

/**
 * HV-10: fetch ONE discipline's category catalog and report it up. Rendered once per ran-discipline
 * so the number of catalog fetches is dynamic yet hook-safe (each instance calls exactly one hook).
 * Renders no DOM. N-generic -- `discipline` is data.
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

/**
 * HV-10: poll ONE discipline's classify status. Rendered once per (ran UNION running) discipline.
 * `running` gates the 3s refresh; a non-running instance still fetches ONCE on mount (the recovery
 * read). Reports every status up via the stable `onStatus`. Renders no DOM. N-generic.
 */
function ClassifyStatusPoller({
  boq,
  sheetName,
  discipline,
  running,
  onStatus,
}: {
  boq: string;
  sheetName: string;
  discipline: string;
  running: boolean;
  onStatus: (discipline: string, msg: ClassifyStatusResponse) => void;
}) {
  const { data } = useFrappeGetCall<{ message: ClassifyStatusResponse }>(
    "nirmaan_stack.api.boq.wizard.classify.get_classify_status",
    { boq, sheet_name: sheetName, discipline },
    `boq-classify-status::${boq}::${sheetName}::${discipline}`,
    { refreshInterval: running ? 3000 : 0 },
  );
  const msg = data?.message;
  useEffect(() => {
    if (msg) onStatus(discipline, msg);
  }, [msg, discipline, onStatus]);
  return null;
}

// RM-3: the suggest-run status shape (get_suggest_status), mirroring the classify poll.
interface SuggestRunResultRow {
  excel_row: number;
  description?: string;
  attributes: Record<string, { value: string | number | null; confidence: number; corroborated?: boolean }>;
}
interface SuggestStatusResponse {
  state: "running" | "done" | "idle";
  done?: number;
  total?: number;
  status?: string;
  ai_status?: string;
  run_id?: string;
  committed_version?: number;
  results?: SuggestRunResultRow[];
}

/** RM-3: poll the suggest-run status for one sheet (cloned from ClassifyStatusPoller). `running`
 * gates the 3s refresh; a non-running instance fetches once on mount (recovery). Renders no DOM. */
function SuggestStatusPoller({
  boq,
  sheetName,
  running,
  onStatus,
}: {
  boq: string;
  sheetName: string;
  running: boolean;
  onStatus: (msg: SuggestStatusResponse) => void;
}) {
  const { data } = useFrappeGetCall<{ message: SuggestStatusResponse }>(
    "nirmaan_stack.api.boq.rate_master.get_suggest_status",
    { boq, sheet_name: sheetName },
    `boq-suggest-status::${boq}::${sheetName}`,
    { refreshInterval: running ? 3000 : 0 },
  );
  const msg = data?.message;
  useEffect(() => {
    if (msg) onStatus(msg);
  }, [msg, onStatus]);
  return null;
}

// T1 reconnect-gate: the editor's socket self-heal refetches (get_priced_rows + get_sheet_categories)
// must fire ONLY on a GENUINE reconnect (a connect that followed a disconnect), never on the initial
// mount connect (the page's normal SWR fetch already ran), and at most once per debounce window even
// if a flapping dev socket reconnects faster. Pure so it is unit-tested in reconnectGate.test.ts.
export const RECONNECT_REFETCH_DEBOUNCE_MS = 30_000;

export function shouldRefetchOnConnect(
  state: { sawDisconnect: boolean; lastRefetchAt: number },
  now: number,
): boolean {
  return state.sawDisconnect && now - state.lastRefetchAt >= RECONNECT_REFETCH_DEBOUNCE_MS;
}

// Slice G3b: client mirror of the server's _CATEGORY_OVERRIDE_REASON_MAX_LEN (pricing.py). The server
// caps it too -- BOTH, not either. Delete with the override control.
export const CATEGORY_OVERRIDE_REASON_MAX_LEN = 250;

/**
 * Slice G3b: may the current user SEE the admin override control? True iff the role has RESOLVED
 * (not the "Loading" sentinel -- so the control never flashes in before disappearing) AND the user is
 * an admin, MIRRORING the server's _is_nirmaan_admin (Administrator OR role_profile "Nirmaan Admin
 * Profile"; useUserData maps Administrator -> "Nirmaan Admin Profile"). CONVENIENCE ONLY -- the server
 * (set/clear_category_override) is authoritative. Pure -- unit-tested. Delete with the override.
 */
export function canAdminOverride(role: string, userId: string): boolean {
  if (role === "Loading") return false;
  return userId === "Administrator" || role === "Nirmaan Admin Profile";
}

/**
 * Slice G3b: normalise the OPTIONAL reason for submission -- client-cap to the max length (belt to the
 * input's maxLength suspenders; the server caps too), trim, and map blank to null (a blank reason is
 * VALID; the server stores NULL). Pure -- unit-tested. Delete with the override.
 */
export function normalizeOverrideReason(raw: string): string | null {
  const trimmed = raw.slice(0, CATEGORY_OVERRIDE_REASON_MAX_LEN).trim();
  return trimmed || null;
}

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

  // ── AMENDMENT C / C3: cross-BOQ carry eligibility ─────────────────────────────
  // A revision sheet only (origin=="revision" + source_boq): off a revision there is no original,
  // so the action does not exist and the button is HIDDEN, not disabled. Scoped to THIS sheet via
  // sheet_names, and the dialog fetches with the identical args -- SWR serves both from one
  // request, so opening the dialog is instant. Disabled (swrKey null) off a revision, which is the
  // common case: an upload/template BoQ pays nothing for this.
  const isRevisionSheet = boq?.origin === "revision" && !!boq?.source_boq;
  const { data: carryPlanData } = useFrappeGetCall<{ message: GetCrossBoqCarryPlanResponse }>(
    CROSS_BOQ_CARRY_PLAN_METHOD,
    {
      dest_boq: boqId ?? "",
      source_boq: boq?.source_boq ?? "",
      sheet_names: JSON.stringify([sheetName ?? ""]),
    },
    isRevisionSheet && boqId && sheetName ? undefined : null,
  );

  // ── Version-view (read-only history browser) ──────────────────────────────────
  // selectedVersion: null = the CURRENT/live version (today's editable behaviour, unchanged); a
  // number = an EARLIER committed version shown read-only with its OWN pricing. Reset on a sheet
  // switch (the [sheetName] effect below) so a new sheet always opens on its live version.
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  // Copy-forward (version-view slice 2): the review-before-apply dialog launched from history mode,
  // and a transient summary line after a successful apply. Both reset on a sheet switch (below).
  const [copyForwardOpen, setCopyForwardOpen] = useState(false);
  const [copyForwardMsg, setCopyForwardMsg] = useState<string | null>(null);
  // AMENDMENT C / C3: the per-sheet cross-BOQ carry (the hub's whole-BoQ button is removed at C6).
  // Same shape as copy-forward above -- a dialog flag + a transient summary line -- because it is
  // the same act, cross-BOQ instead of cross-version.
  const [carryOpen, setCarryOpen] = useState(false);
  const [carryMsg, setCarryMsg] = useState<string | null>(null);
  // The live read's committed version -- the single source of "which version is live".
  const liveCommitVersion = pricedData?.message?.commit_version ?? null;
  // Per-sheet Work Packages -- carried onto the committed BoQ Sheet at commit time and returned
  // by get_priced_rows (work_packages: string[]). Read defensively: default [] when the payload
  // is missing/older, and drop any empty/whitespace entries so the header badge only renders real
  // assignments. SHEET-LEVEL only -- never threaded into the memoized PricingGrid rows.
  const workPackages = (pricedData?.message?.work_packages ?? []).filter(
    (wp): wp is string => typeof wp === "string" && wp.trim() !== "",
  );
  // History mode iff an EARLIER version than the live one is selected.
  const isViewingHistory = selectedVersion !== null && selectedVersion !== liveCommitVersion;

  // The committed versions of THIS sheet, for the version dropdown. Source-of-truth = the committed
  // grid tier (get_sheet_versions), the existing "what versions exist" authority (covers grid-only
  // sheets + versions the node tier may lack). Disabled until boqId + sheetName are present.
  const { data: versionsData } = useFrappeGetCall<{ message: GetSheetVersionsResponse }>(
    "nirmaan_stack.api.boq.wizard.commit_gate.get_sheet_versions",
    { boq_name: boqId ?? "", sheet_name: sheetName ?? "" },
    boqId && sheetName ? undefined : null,
  );

  // HV-10: the per-row MULTI-ENGINE resolved verdicts for THIS sheet (get_sheet_categories_resolved).
  // ONE index-covered read across every discipline; the server applies the resolution ladder per
  // row. mutateCategories refetches after a classify run / verdict write so the grid repaints.
  // get_sheet_categories (single-discipline) is UNTOUCHED -- freeze + summary still call it.
  const { data: catData, mutate: mutateCategories } = useFrappeGetCall<{
    message: GetSheetCategoriesResolvedResponse;
  }>(
    "nirmaan_stack.api.boq.wizard.classify.get_sheet_categories_resolved",
    { boq: boqId ?? "", sheet_name: sheetName ?? "" },
    boqId && sheetName ? undefined : null,
  );
  // HV-10: the disciplines that actually ran on this sheet (the picker's group set). N-generic --
  // a future engine appears here the moment it has current rows, with zero code change.
  const ranDisciplines = useMemo<string[]>(
    () => catData?.message?.disciplines ?? [],
    [catData],
  );
  // HV-10: the engine registry (labels for the picker groups). One stable fetch; N-generic.
  const { data: enginesData } = useFrappeGetCall<{ message: EngineOption[] }>(
    "nirmaan_stack.api.boq.wizard.classify.list_engines",
    {},
    boqId && sheetName ? "boq-classify-engines" : null,
  );

  // ── RM-3 rate-helper data (DEV-gated fetches; all null-keyed off when the flag/ids are absent) ──
  // The RM-1 config + master (once per page, SWR-cached) feed the RM-2 interpreter CLIENT-SIDE.
  const rmEnabled = RATE_HELPER_ENABLED && !!boqId && !!sheetName;
  const { data: rmConfigData } = useFrappeGetCall<{ message: { config: RateCategoryConfig | null } }>(
    "nirmaan_stack.api.boq.rate_master.get_rate_category_config",
    { discipline: "Electrical", category_id: "wiring_cabling" },
    RATE_HELPER_ENABLED ? "boq-rm-config-electrical-wiring" : null,
  );
  const { data: rmItemsData } = useFrappeGetCall<{ message: { items: RateMasterItem[] } }>(
    "nirmaan_stack.api.boq.rate_master.get_rate_master_items",
    { discipline: "Electrical" },
    RATE_HELPER_ENABLED ? "boq-rm-items-electrical" : null,
  );
  // The ACTIVE suggestion run for this sheet (persistence -- version-keyed on load).
  const { data: activeRunData, mutate: mutateActiveRun } = useFrappeGetCall<{
    message: { run: { run_id: string; committed_version: number; ai_status: string; results: SuggestRunResultRow[]; run_at?: string } | null };
  }>(
    "nirmaan_stack.api.boq.rate_master.get_active_suggestion_run",
    { boq: boqId ?? "", sheet_name: sheetName ?? "" },
    rmEnabled ? undefined : null,
  );
  // This sheet's Use events (used-state restore).
  const { data: suggestEventsData, mutate: mutateSuggestEvents } = useFrappeGetCall<{
    message: { events: Array<{ excel_row: number; col: string; kind: string; run_id: string }> };
  }>(
    "nirmaan_stack.api.boq.rate_master.get_suggestion_events",
    { boq: boqId ?? "", sheet_name: sheetName ?? "" },
    rmEnabled ? undefined : null,
  );
  const { call: startSuggestCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.rate_master.start_suggest",
  );
  const { call: recordSuggestEventCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.rate_master.record_rate_suggestion_event",
  );
  const engineLabelByDiscipline = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    (enginesData?.message ?? []).forEach((e) => (m[e.discipline] = e.label));
    return m;
  }, [enginesData]);
  // HV-10: one category catalog per ran-discipline, accumulated from child EngineCatalogFetchers
  // (hook-safe N-dynamic fetch pattern). Each discipline's catalog lands once and is memoized.
  const [catalogsByDiscipline, setCatalogsByDiscipline] =
    useState<Record<string, EngineCatalog>>(EMPTY_CATALOGS);
  const handleCatalogLoaded = useCallback(
    (discipline: string, categories: CategoryCatalogEntry[]) => {
      setCatalogsByDiscipline((prev) =>
        prev[discipline]
          ? prev
          : { ...prev, [discipline]: { discipline, label: discipline, categories } },
      );
    },
    [],
  );
  // CL-3: id -> label for the Category cell display (reference-stable per fetch -> memo-safe).
  // Merged across every ran-discipline's catalog (ids are disjoint across engines).
  const categoryLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const cat of Object.values(catalogsByDiscipline)) {
      cat.categories.forEach((c) => m.set(c.id, c.label));
    }
    return m;
  }, [catalogsByDiscipline]);
  // HV-10: the picker's engine-scoped groups -- ONE per ran-discipline, labelled from the registry.
  const engineCatalogs = useMemo<EngineCatalog[]>(
    () => buildSheetEngineCatalogs(ranDisciplines, catalogsByDiscipline, engineLabelByDiscipline),
    [ranDisciplines, catalogsByDiscipline, engineLabelByDiscipline],
  );
  // CL-3: optimistic per-row verdict overrides (this session), keyed by excel_row. An override
  // shows the picked verdict instantly; it is dropped once the set_row_category refetch
  // (mutateCategories) lands (or on an error revert). Reset per-sheet (below).
  const [categoryOverrides, setCategoryOverrides] = useState<Map<number, SheetCategoryRow>>(
    () => new Map(),
  );
  // A reference-stable (per fetch / per override) Map keyed by excel_row -> the grid reads it for
  // the Category cell; rebuilt only when catData or the overrides change (never on a keystroke),
  // so the row memo is never defeated by a per-render Map. Overrides merge LAST (optimistic wins).
  const categoriesByExcelRow = useMemo(() => {
    const m = new Map<number, SheetCategoryRow>();
    // HV-10: adapt each server-resolved row onto the grid's SheetCategoryRow shape so PricingGrid
    // + deriveVerdictState + isNeedsReviewCategory render UNCHANGED. Telemetry (conflict, votes,
    // review_priority) is dropped by the adapter and never reaches the grid.
    (catData?.message?.categories ?? []).forEach((c: ResolvedSheetCategory) =>
      m.set(c.excel_row, resolvedToSheetCategoryRow(c)),
    );
    categoryOverrides.forEach((c, k) => m.set(k, c));
    return m;
  }, [catData, categoryOverrides]);
  // HV-10: the resolved row detail keyed by excel_row -- the page reads `human_discipline` here to
  // clear the right engine's verdict (the grid never sees this; it stays telemetry-free).
  const resolvedByExcelRow = useMemo(() => {
    const m = new Map<number, ResolvedSheetCategory>();
    (catData?.message?.categories ?? []).forEach((c) => m.set(c.excel_row, c));
    return m;
  }, [catData]);

  // The selected EARLIER version's read-only rows + its OWN pricing (ADDITIVE endpoint; the live
  // get_priced_rows hot path above is byte-for-byte untouched). Disabled unless viewing history.
  const { data: historyData } = useFrappeGetCall<{ message: GetPricedRowsResponse }>(
    "nirmaan_stack.api.boq.wizard.pricing.get_version_priced_rows",
    {
      boq_name: boqId ?? "",
      sheet_name: sheetName ?? "", // VERBATIM (#152)
      committed_version: selectedVersion ?? 0,
    },
    isViewingHistory ? undefined : null,
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
  // In history mode the faithful grid (grid-only sheets) must read the SELECTED version; else the
  // live current version. Both are version-parameterized reads, so this just swaps the version arg.
  const commitVersionForGrid = isViewingHistory
    ? selectedVersion
    : pricedData?.message?.commit_version ?? null;
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
  // The deliberate per-sheet lock/unlock (this slice). Toggled from the top ribbon; the editor
  // re-reads is_locked from get_priced_rows via mutate() after the POST.
  const { call: lockSheetCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.lock_sheet",
  );
  const { call: unlockSheetCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.unlock_sheet",
  );
  // CL-3: set / clear one row's human category verdict (set_row_category). A SEPARATE write path
  // (parallel to rates/annotations); "" clears to the machine verdict. Optimistic (categoryOverrides)
  // then mutateCategories()-refetches so the effective verdict re-derives authoritatively.
  const { call: setRowCategory } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.classify.set_row_category",
  );
  // Slice G3b: the admin category-gate override set/clear endpoints (server enforces admin via
  // _is_nirmaan_admin; the client role check is convenience only). Delete with the override.
  const { call: setCategoryOverrideCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.set_category_override",
  );
  const { call: clearCategoryOverrideCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.clear_category_override",
  );
  // In-flight guard for the lock toggle (disables it during the POST).
  const [lockToggling, setLockToggling] = useState(false);

  // ── Classification freeze (SEPARATE from the pricing lock) ────────────────────────
  // Freeze banks a permanent truth snapshot + stamps effective categories into human_category_id
  // + locks category editing (picker + re-classify), while PRICING stays live. Toggled here; the
  // editor re-reads classification_frozen from get_priced_rows via mutate() after each POST.
  const { call: freezeClassificationCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.classify.freeze_classification",
  );
  const { call: unfreezeClassificationCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.classify.unfreeze_classification",
  );
  const { call: getFreezeSummaryCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.classify.get_freeze_summary",
  );
  const [freezeToggling, setFreezeToggling] = useState(false);
  // The pre-freeze confirm dialog (holds the uncategorised counts from get_freeze_summary) and the
  // unfreeze confirm dialog. null = closed.
  const [freezeConfirm, setFreezeConfirm] = useState<
    { uncategorised_preambles: number; uncategorised_line_items: number } | null
  >(null);
  const [unfreezeConfirm, setUnfreezeConfirm] = useState(false);

  // ── Single-editor concurrency lock -- realtime layer (A2 / ADR-0011) ──────────
  // The transient BoQ Sheet Pricing Lock now propagates LIVE: acquire on FIRST edit-intent
  // (the grid's onDirtyChange), heartbeat ~30s while holding it, release on leave (sendBeacon
  // + unmount), and listen for boq:lock_changed to flip read-only / free the instant ANOTHER
  // user acquires / releases. The server throw (BOQ_PRICING_LOCKED in every save_* endpoint)
  // stays the durable enforcement; this is only the UX accelerator.
  const { socket } = useContext(FrappeContext) as FrappeConfig;
  // Slice G3b: `role` is read from the SAME already-warm useUserData() call (no new fetch). Control
  // visibility flows through the pure `canAdminOverride` helper (see its docstring) -- role-resolved AND
  // admin. CONVENIENCE ONLY; the server is authoritative. Delete `showCategoryOverrideControl` + the
  // `role` read + everything marked "G3b" when the override is removed (owner commitment: once
  // classification engines cover all disciplines).
  const { user_id: currentUser, role } = useUserData();
  const showCategoryOverrideControl = canAdminOverride(role, currentUser);
  const { call: acquirePricingLock } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.acquire_pricing_lock",
  );
  // committed_version this client currently HOLDS the lock for (null = none). A ref so the
  // heartbeat + socket handler read the latest without re-registering.
  const heldVersionRef = useRef<number | null>(null);
  // Break-glass CLIENT override (dev/testing). The server site_config flag is the real prod
  // switch (D13); this just lets a developer disable the lock calls locally.
  const locksDisabledClient =
    typeof window !== "undefined" &&
    window.localStorage.getItem("nirmaan-boq-locks-disabled") === "true";
  // Latest lock identity, read by the [socket]-scoped handler + the heartbeat/release effects
  // WITHOUT recreating them (BoqHubPage's ref-for-changing-values pattern). Updated each render.
  const lockCtxRef = useRef<{
    boqId?: string; sheetName?: string; version: number | null; currentUser: string; disabled: boolean;
  }>({ boqId, sheetName, version: null, currentUser, disabled: locksDisabledClient });
  lockCtxRef.current = {
    boqId, sheetName, version: liveCommitVersion, currentUser, disabled: locksDisabledClient,
  };
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

  // ── CL-2: classify-sheet state (per-sheet per-session; reset on a tab switch below) ──
  // The dialog open flag; the running flag (a run is in flight -> disables the ribbon button +
  // shows the progress bar); the live {done,total} progress; the completion summary; and the
  // "show only needs-review rows" view filter. classifyRunningRef mirrors classifyRunning so the
  // stable socket/poll callbacks read the CURRENT running state without re-registering.
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classifyRunning, setClassifyRunning] = useState(false);
  // The blocking progress modal stays open from run-start THROUGH the terminal state (so the
  // completion/error line + Close button show); it closes only when the user acknowledges.
  const [classifyModalOpen, setClassifyModalOpen] = useState(false);
  const [classifyProgress, setClassifyProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [classifySummary, setClassifySummary] = useState<ClassifySummary | null>(null);
  const [showNeedsReview, setShowNeedsReview] = useState(false);
  const classifyRunningRef = useRef(false);
  // HV-10: a ref mirror of classifySummary so the stable per-discipline status callback can read
  // "is a terminal summary showing?" without re-registering the pollers.
  const classifySummaryRef = useRef<ClassifySummary | null>(null);
  classifySummaryRef.current = classifySummary;
  // HV-10: the disciplines with a run IN FLIGHT this session (set on onStarted, each removed when
  // its own done arrives). One status poller is rendered per running discipline; the modal
  // completes when the set empties. Single-engine sheets (all sheets today) keep length <= 1, so
  // this degenerates to the pre-HV-10 single poll. A ref mirrors it for the stable callbacks.
  const [runningDisciplines, setRunningDisciplines] = useState<string[]>([]);
  const runningDisciplinesRef = useRef<string[]>([]);
  runningDisciplinesRef.current = runningDisciplines;
  const ranDisciplinesRef = useRef<string[]>([]);
  ranDisciplinesRef.current = ranDisciplines;
  // HV-10b: the row-range union of the CURRENT run set (owner condition 1). Set fresh on each
  // onStarted -- a new run set REPLACES it, so it never carries across run sets (the reset
  // semantics); a whole-sheet or unknown-scope run collapses it to {mode:"sheet"}. The COMBINED
  // EFFECTIVE completion summary is scoped to this union. Default {sheet} covers a run recovered
  // from the status poll (started elsewhere -> scope unknown -> whole sheet).
  const scopeUnionRef = useRef<ScopeUnion>({ mode: "sheet" });
  // HV-11: per-discipline ai_status accumulated over the CURRENT run set (reset on each onStarted,
  // one entry recorded per engine as its done arrives). At all-done it is mirrored into
  // classifyAiStatusByDiscipline so the modal + toast render the AI-off warning (naming the off
  // discipline[s]); the healthy path (all "ran") yields an empty warning, so the text is unchanged.
  const aiStatusByDisciplineRef = useRef<Record<string, string | null | undefined>>({});
  const [classifyAiStatusByDiscipline, setClassifyAiStatusByDiscipline] = useState<
    Record<string, string | null | undefined>
  >({});
  // HV-10b: a ref mirror of the resolved read so the terminal-summary compute (fired after
  // mutateCategories refetches) can read the FRESH resolved rows even if the awaited mutate return
  // is unavailable. Updated every render (cheap; the value is already memo-stable per fetch).
  const catDataRef = useRef<{ message: GetSheetCategoriesResolvedResponse } | undefined>(undefined);
  catDataRef.current = catData;

  // T1 reconnect-gate refs (NOT state -- must never add a re-render source). sawDisconnectRef flips
  // true on a socket "disconnect"; lastReconnectRefetchRef stamps the last gated refetch so a
  // flapping socket is debounced to <=1 refetch pair per RECONNECT_REFETCH_DEBOUNCE_MS.
  const sawDisconnectRef = useRef(false);
  const lastReconnectRefetchRef = useRef(0);

  // ── CL-3: category verdict picker (page-owned open-state; reset on a tab switch below) ──
  // pickerState holds the target row + the clicked cell element (the picker's virtual anchor);
  // null when closed. onCategoryClick is a STABLE callback the grid calls on a Category-cell click
  // (or Enter) -> reference-stable so the grid's row memo holds.
  const [pickerState, setPickerState] = useState<{ excelRow: number; anchorEl: HTMLElement } | null>(
    null,
  );
  // Mirrors classification_frozen so the STABLE onCategoryClick can short-circuit while frozen
  // without becoming a new callback (which would defeat the grid's row memo). Set during render.
  const classificationFrozenRef = useRef(false);
  const onCategoryClick = useCallback(
    (excelRow: number, cellEl: HTMLElement) => {
      // While frozen, the picker never opens -- clicking a Category cell shows a brief message.
      if (classificationFrozenRef.current) {
        setSaveError("Classification is frozen — unfreeze to make changes.");
        return;
      }
      setPickerState({ excelRow, anchorEl: cellEl });
    },
    [],
  );

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
  // Slice B (undo/redo): the grid's session-history {canUndo, canRedo}, surfaced via onHistoryChange
  // (the onDirtyChange pattern), driving the bottom-ribbon Undo/Redo buttons' disabled state. The
  // grid remount on a sheet/version switch re-emits {false,false}; also reset below for immediacy.
  const [historyState, setHistoryState] = useState<{ canUndo: boolean; canRedo: boolean }>({
    canUndo: false,
    canRedo: false,
  });
  // Summary panel (parent-tree amount rollups) -- pull-in, computed page-side.
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Priceability override (Slice 3e, per-sheet per-session). Default OFF: a rate cell is
  // editable ONLY on a priceable row (node_type Preamble / Line Item). When ON, it unlocks
  // editing on non-priceable rows for THIS sheet THIS session AND sends allow_non_priceable
  // to save_cell_price so the server accepts those writes. Resets per sheet (below).
  const [override, setOverride] = useState(false);
  // ── U1 rate-helper (DEV, guardrail G1/G2 -- page-session only, NEVER persisted) ──
  // suggestionsByExcelRow: built by pressing "Suggest rates" (reference-stable per run/use);
  // helperPanel: the open panel scoped to a rate cell (durable excelRow + col -> the kind). Both
  // reset on a sheet switch (below). A reload wipes them -- no persistence.
  const [suggestionsByExcelRow, setSuggestionsByExcelRow] = useState<Map<number, RowSuggestions>>(
    () => new Map(),
  );
  const [helperPanel, setHelperPanel] = useState<{
    excelRow: number;
    col: string;
    kind: string;
  } | null>(null);
  // RM-3 suggest run: the run whose extraction drives the badges/panel (from the active run on
  // load [version-keyed] OR a just-completed press). The async run's modal/poll state mirrors the
  // classify run. `usedPairsRef` = the (row:col) pairs marked used (server events on load + this
  // session's Uses), applied when the badge map is (re)built so a rebuild never loses a check.
  const [suggestRun, setSuggestRun] = useState<{ runId: string; committedVersion: number; results: SuggestRunResultRow[] } | null>(null);
  const [suggestModalOpen, setSuggestModalOpen] = useState(false);
  const [suggestRunning, setSuggestRunning] = useState(false);
  const [suggestProgress, setSuggestProgress] = useState<{ done: number; total: number } | null>(null);
  const [suggestSummary, setSuggestSummary] = useState<{ status?: string; ai_status?: string; results?: unknown[]; run_id?: string } | null>(null);
  const suggestRunningRef = useRef(false);
  suggestRunningRef.current = suggestRunning;
  const usedPairsRef = useRef<Set<string>>(new Set());
  // Idempotent run-adoption: the last adopted run key (run_id::cv, or null). Guards the persistence
  // effect from re-creating a NEW suggestRun object on every SWR reference churn (which loops).
  const adoptedRunKeyRef = useRef<string | null | undefined>(undefined);
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

  // RM-3c item C: in FULL-SCREEN, the whole top block (title row + both ribbons + banners + summary/
  // review panels) is one COLLAPSIBLE block so the grid can fill the wrapper vertically. Persisted
  // per session (localStorage). Embedded is unaffected (the collapse only applies while `expanded`).
  const [topCollapsed, setTopCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("nirmaan-fullscreen-top-collapsed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("nirmaan-fullscreen-top-collapsed", topCollapsed ? "1" : "0");
    } catch {
      /* storage unavailable -- collapse state simply is not persisted */
    }
  }, [topCollapsed]);

  // Frozen-left Slice 1 ("Fork A"): pin the 5 anchor columns (through Description) into a frozen
  // pane while the descriptor + Remarks columns scroll horizontally. Page-owned per-sheet toggle
  // (reset on a tab switch below); default OFF = today's single table. Passed to the PricingGrid
  // only (the grid measures heights at the freeze transition + renders the two-pane split). Gated
  // OFF for grid-only general-specs sheets (they render via SheetDataGrid, out of scope).
  const [frozen, setFrozen] = useState(false);

  // V1 (T2 windowing A/B toggle): render the grid with @tanstack/react-virtual windowing (only the
  // visible rows + overscan mounted) vs the CLASSIC full-render path. Session-scoped, DEFAULT ON
  // each open (no persistence). Flipping never remounts / reloads / touches data / drafts / undo /
  // lock -- only which rows are in the DOM. Classic is the byte-identical fallback (the A/B instrument).
  const [virtualized, setVirtualized] = useState(true);

  // V2 (overlay close-on-scroll-out): the CategoryVerdictPicker is PAGE-owned and anchored to a
  // captured grid cell (pickerState.anchorEl). In virtualized mode that cell's row can scroll out of
  // the mounted window and unmount, leaving the popover dangling against a detached node. Watch the
  // anchor with an IntersectionObserver (viewport root); when it leaves the viewport OR is removed
  // from the DOM (both fire !isIntersecting), close the picker. VIRTUALIZED-ONLY -- in classic mode
  // rows never unmount, so the picker's behaviour there is byte-identical (no observer attached).
  useEffect(() => {
    if (!virtualized || !pickerState) return;
    const anchor = pickerState.anchorEl;
    if (!anchor || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => !e.isIntersecting)) setPickerState(null);
      },
      { threshold: 0 },
    );
    io.observe(anchor);
    return () => io.disconnect();
  }, [virtualized, pickerState]);

  // Hierarchy collapse/expand (per-sheet per-session; reset on a tab switch below). `collapsed`
  // holds the row_index of every collapsed parent. It lives HERE (the page) because it composes
  // the upstream displayRows filter (R4) and the descendant/visibility math needs the FULL rows
  // (which the page has; the grid only gets the filtered displayRows). The grid receives it +
  // childrenByParent + the toggle as GRID-LEVEL props for the chevrons (NOT a row-memo prop, R6).
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // Autosave-perf #1(c): the LAST merged `rows` array + the data-source signature it was built for.
  // The merge (at the rows transform below) reuses a prior row object for any row a save did not
  // change, so the grid memo holds and only the edited row re-renders after the inline mutate()
  // refetch. sourceSigRef guards against merging across DIFFERENT data sources (current <-> a viewed
  // version): on a source switch the committed base can differ, so prev is reset (no cross-source
  // reuse). Refs (not state) -- read/written in render, like collapsedRef below; no extra render.
  const prevRowsRef = useRef<PricedRow[]>([]);
  const rowsSourceSigRef = useRef<string>("");
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
  //
  // THIS EFFECT IS THE ONLY RESET MECHANISM and always was meant to be. Until the app-shell
  // ErrorBoundary fix (components/common/ErrorBoundaryWrapper.tsx) it was shadowed: that
  // boundary keyed itself on `location`, so every navigation -- including a sheet-tab switch --
  // remounted the whole page and threw away all state regardless of what this effect did. Any
  // per-sheet state added below MUST be reset here; nothing else will do it.
  //
  // Two families are DELIBERATELY NOT reset:
  //   - In-flight request flags (inFlight, lockToggling, freezeToggling, overrideSubmitting).
  //     Each is cleared by its own finally. inFlight specifically: a flush-on-unmount save from
  //     the old grid increments/decrements in a pair, so a hard reset to 0 would underflow when
  //     that save's finally runs (and "Saving..." on the new sheet during the flush is honest --
  //     a save IS in flight). Forcing the others false mid-POST would re-enable a button while
  //     the old sheet's request is still running.
  //   - Session-scoped view preferences (`expanded` full-screen, `virtualized`). These are
  //     properties of the EDITOR SESSION, not of the sheet -- staying maximized across a sheet
  //     switch is the point. Do not "fix" them by adding them here.
  useEffect(() => {
    setSaveError(null);
    setLastSavedAt(null);
    setTakenOver(false);
    setSummaryOpen(false);
    setSelectedVersion(null); // version-view: a new sheet always opens on its live version
    setCopyForwardOpen(false); // copy-forward dialog is per-sheet
    setCopyForwardMsg(null);
    // AMENDMENT C / C3: the cross-BOQ carry is copy-forward's twin and is per-sheet for the same
    // reason -- carryMsg names a count of rates carried into THIS sheet, so it must not survive
    // onto the next one.
    setCarryOpen(false);
    setCarryMsg(null);
    setOverride(false); // Slice 3e: the override is per-sheet per-session -- reset on switch
    setSuggestionsByExcelRow(new Map()); // rate-helper: suggestions are per-sheet, page-session
    setHelperPanel(null);
    // RM-3: the run + used-pairs are per-sheet; the persistence effect re-adopts the new sheet's
    // active run (version-keyed) and its Use events after the fetches land.
    setSuggestRun(null);
    usedPairsRef.current = new Set();
    setReviewOpen(false); // Slice 4a: the review-list strip is per-sheet
    setShowDismissed(false); // Slice 4b-ACKNOWLEDGE: the show-dismissed toggle is per-sheet
    setShowOnlyUnpriced(false); // Slice 4b-A: the unpriced filter is per-sheet
    // CL-2: classify state is per-sheet -- a tab switch starts clean (the socket/poll below
    // re-recovers a genuinely in-flight run from get_classify_status on the new sheet).
    setClassifyOpen(false);
    setClassifyRunning(false);
    classifyRunningRef.current = false;
    setClassifyModalOpen(false);
    setClassifyProgress(null);
    setClassifySummary(null);
    // HV-11: the per-discipline ai_status warning is per-run-set -- a tab switch starts clean.
    setClassifyAiStatusByDiscipline({});
    aiStatusByDisciplineRef.current = {};
    setShowNeedsReview(false);
    // HV-10: the running set is per-sheet (the pollers re-derive from the new sheet's ran set).
    setRunningDisciplines([]);
    runningDisciplinesRef.current = [];
    // CL-3: the verdict picker + optimistic overrides are per-sheet -- a tab switch starts clean.
    setPickerState(null);
    setCategoryOverrides(new Map());
    // Toolbar Part 1: column-hide, search, and the three row-type filters are all per-sheet.
    setHiddenCols(new Set());
    setSearchQuery("");
    setSearchCurrentIdx(0);
    setShowSpacers(true);
    setShowNotes(true);
    setShowSubtotals(true);
    setCollapsed(new Set()); // collapse/expand is per-sheet -- a tab switch starts fully expanded
    setFrozen(false); // Frozen-left Slice 1: freeze is per-sheet -- a tab switch starts unfrozen
    setHistoryState({ canUndo: false, canRedo: false }); // Slice B: undo history is per-sheet/version (grid remounts)
    // Classification freeze confirms: modal AlertDialogs (the tab strip sits behind the overlay,
    // so neither can be open at switch time) -- reset anyway because freezeConfirm CARRIES the
    // old sheet's uncategorised counts as its payload.
    setFreezeConfirm(null);
    setUnfreezeConfirm(false);
    // NOTE: the G3b override popover has its OWN [sheetName] reset, inside the self-contained
    // G3b block below (that block must stay deletable in one cut -- owner commitment).
  }, [sheetName]);

  // Toolbar Part 1 -- search: reset the hit pointer to the first hit whenever the query changes
  // (a fresh search starts at hit 1). The pointer is also clamped at render (safeSearchIdx).
  useEffect(() => {
    setSearchCurrentIdx(0);
  }, [searchQuery]);

  // ── CL-2: classify-sheet completion handling (socket + poll fallback) ─────────────
  // Apply a done outcome from EITHER the boq:classify_sheet_done event or the get_classify_status
  // poll. Guards on boq / sheet_name (VERBATIM #152) / discipline so a broadcast for another sheet
  // never mutates this one. Clears the running/progress state, stores the summary, and refetches
  // the category verdicts so the grid's Category column repaints.
  const applyClassifyDone = useCallback(
    (p: Partial<ClassifyDonePayload> & { boq_name: string; sheet_name: string; discipline: string }) => {
      if (p.boq_name !== (boqId ?? "")) return;
      if (p.sheet_name !== (sheetName ?? "")) return;
      // HV-10: accept a done for ANY discipline this sheet ran or is running (membership, not the
      // old `=== CLASSIFY_DISCIPLINE` equality that discarded every non-Electrical event).
      if (!acceptClassifyEvent(p.discipline, ranDisciplinesRef.current, runningDisciplinesRef.current))
        return;
      // Drop this discipline from the running set; the run is fully done only when the set empties.
      const nextRunning = removeRunningDiscipline(runningDisciplinesRef.current, p.discipline);
      runningDisciplinesRef.current = nextRunning;
      setRunningDisciplines(nextRunning);
      // HV-11: record THIS engine's ai_status for the run set's AI-off warning -- on EVERY done, not
      // just all-done, so a per-discipline map accumulates even when an engine finishes mid-run.
      aiStatusByDisciplineRef.current[p.discipline] = p.ai_status ?? null;
      const allDone = nextRunning.length === 0;
      if (!allDone) {
        // A mid-run engine finished; repaint the grid but WAIT for the rest before summarising --
        // the completion summary is the COMBINED outcome, so it is composed only once every engine
        // in the run set has terminated (HV-10b).
        void mutateCategories();
        return;
      }
      setClassifyRunning(false);
      classifyRunningRef.current = false;
      setClassifyProgress(null);
      // HV-11: publish the accumulated per-discipline ai_status so the modal + toast render the
      // AI-off warning (silent when every ran discipline had AI on).
      setClassifyAiStatusByDiscipline({ ...aiStatusByDisciplineRef.current });

      // Non-count fields carried from the terminal payload. HV-10b changes ONLY the NUMBERS' source
      // (per-engine denominator -> combined effective); the wording, skip rollup and ai_status note
      // are unchanged, carried as the last-completing engine reported them.
      const carry = {
        auto_accepted: p.auto_accepted ?? 0,
        skipped_total: p.skipped_total ?? 0,
        skipped_by_reason: p.skipped_by_reason ?? {},
        committed_version: p.committed_version ?? null,
        sheet_warnings: p.sheet_warnings ?? [],
        ai_status: p.ai_status ?? null,
        status: p.status,
        error_code: p.error_code,
      };

      if (p.status === "error") {
        // Error path unchanged -- the error modal reads status/error_code, not the counts.
        setClassifySummary({
          total_in_range: 0,
          eligible_classified: 0,
          needs_review: 0,
          ...carry,
        });
        void mutateCategories();
        return;
      }

      // SUCCESS, all engines done: the completion summary is the COMBINED EFFECTIVE outcome over the
      // resolved read (the grid's source of truth), scoped to this run set's row range union
      // (HV-10b). Computed from the FRESH resolved rows (post-refetch) so the message == the
      // resolved effective split == what the grid then shows. categorised = effective non-blank
      // (an auto-accept OR a human verdict); review = effective blank (the blank-review law).
      const union = scopeUnionRef.current;
      void mutateCategories().then((fresh) => {
        const rows =
          fresh?.message?.categories ?? catDataRef.current?.message?.categories ?? [];
        const { categorised, review } = summariseResolvedOutcome(rows, union);
        setClassifySummary({
          ...carry,
          eligible_classified: categorised,
          needs_review: review,
          total_in_range: categorised + review,
        });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boqId, sheetName, mutateCategories],
  );

  // Socket for boq:classify_sheet_progress / boq:classify_sheet_done (mirrors the BoqHubPage
  // parse-run pattern -- SCREEN-SCOPED via FrappeContext, NOT socketListeners.ts). Reconnect
  // self-heals by refetching the categories; the poll below covers a missed done event.
  // (Reuses the `socket` bound above by the concurrency-lock realtime layer -- same FrappeContext.)
  useEffect(() => {
    if (!socket) return;
    const onProgress = (p: ClassifyProgressPayload) => {
      if (
        p.boq !== (boqId ?? "") ||
        p.sheet_name !== (sheetName ?? "") ||
        // HV-10: accept progress for any discipline this sheet ran or is running (membership).
        !acceptClassifyEvent(p.discipline, ranDisciplinesRef.current, runningDisciplinesRef.current)
      )
        return;
      setClassifyProgress((prev) => reduceProgress(prev, { done: p.done, total: p.total }));
    };
    const onDone = (p: ClassifyDonePayload) => applyClassifyDone(p);
    // NOTE (T1): the reconnect self-heal (refetch categories) moved to the consolidated,
    // reconnect-GATED + debounced effect below -- it no longer fires on every connect (incl. the
    // initial mount connect). The progress/done handlers here are unchanged.
    socket.on("boq:classify_sheet_progress", onProgress);
    socket.on("boq:classify_sheet_done", onDone);
    return () => {
      socket.off("boq:classify_sheet_progress", onProgress);
      socket.off("boq:classify_sheet_done", onDone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, boqId, sheetName, applyClassifyDone]);

  // HV-10: PER-RUNNING-DISCIPLINE status handling. Each engine's marker/status is independent
  // server-side, so one <ClassifyStatusPoller> is rendered per discipline in (ran UNION running):
  // the ran set gives on-mount recovery (a single read recovers an in-flight run started elsewhere
  // / before navigation); the running set polls every 3s. A "done" funnels through applyClassifyDone
  // (which drops that discipline and completes the modal only when ALL running clear); a "running"
  // recovers/advances the bar. Single-engine sheets poll exactly one discipline -- identical to
  // the pre-HV-10 single poll. This callback is stable so the pollers never re-register.
  const statusPollDisciplines = useMemo(() => {
    const s = new Set<string>(ranDisciplines);
    runningDisciplines.forEach((d) => s.add(d));
    return [...s];
  }, [ranDisciplines, runningDisciplines]);
  const handleClassifyStatus = useCallback(
    (discipline: string, msg: ClassifyStatusResponse) => {
      if (msg.state === "done") {
        if (!classifyRunningRef.current) return; // only a done we were waiting on
        applyClassifyDone({
          boq_name: boqId ?? "",
          sheet_name: sheetName ?? "",
          discipline,
          ...msg,
        });
      } else if (msg.state === "running") {
        // PRECEDENCE: done WINS -- a terminal summary awaiting Close ignores a stale running poll.
        if (!classifyRunningRef.current && classifySummaryRef.current) return;
        if (!classifyRunningRef.current) {
          setClassifyRunning(true);
          classifyRunningRef.current = true;
          setClassifyModalOpen(true);
        }
        // Recover a discipline running but not yet in our set (started elsewhere).
        if (!runningDisciplinesRef.current.includes(discipline)) {
          const next = addRunningDisciplines(runningDisciplinesRef.current, [discipline]);
          runningDisciplinesRef.current = next;
          setRunningDisciplines(next);
          // HV-10b: a run recovered from the poll has no captured scope, so the summary cannot be
          // range-scoped precisely -- degrade the union to whole-sheet (never UNDER-report a run).
          scopeUnionRef.current = { mode: "sheet" };
        }
        if (typeof msg.done === "number" && typeof msg.total === "number") {
          setClassifyProgress({ done: msg.done, total: msg.total });
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyClassifyDone, boqId, sheetName],
  );

  // Slice 4c: Esc-to-exit full-screen. A window keydown listener mounted ONLY while expanded
  // (added on expand, removed on collapse / unmount). shouldExitFullscreenOnEsc guards the two
  // collision cases: e.defaultPrevented (a Radix popover -- RemarkCell / AmountFormulaBuilder --
  // closing on its OWN Esc preventDefaults, so a popover-Esc never exits) and an <input>/
  // <textarea> being typed. NOT attached to the grid <table> (it would miss Escs fired while
  // focus is in a portaled popover); the grid's own keydown handler is untouched.
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!shouldExitFullscreenOnEsc(e, document.activeElement)) return;
      // RM-3c item C: while the top block is collapsed, Esc RE-EXPANDS it first (the user is never
      // trapped) rather than exiting full-screen; a second Esc then exits.
      if (topCollapsed) setTopCollapsed(false);
      else setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, topCollapsed]);

  // Realtime lock updates (A2): flip read-only / free the instant ANOTHER user acquires or
  // releases this sheet's lock. Screen-scoped listener (BoqHubPage pattern): register on the
  // stable FrappeContext socket, read changing identity from lockCtxRef, off() on cleanup,
  // + a reconnect self-heal (re-fetch authoritative lock_info on (re)connect).
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: {
      boq?: string; sheet_name?: string; committed_version?: number | string;
      action?: string; locked_by?: string | null;
    }) => {
      const ctx = lockCtxRef.current;
      if (ctx.disabled) return;
      if (!payload || payload.boq !== ctx.boqId) return;
      if (payload.sheet_name !== ctx.sheetName) return; // VERBATIM (#152)
      if (ctx.version === null || Number(payload.committed_version) !== Number(ctx.version)) return;
      if (payload.locked_by && payload.locked_by === ctx.currentUser) return; // suppress own events
      if (payload.action === "acquired" || payload.action === "took_over") {
        // Another user now holds this sheet -> we no longer do; flip to read-only.
        const wasHolding = heldVersionRef.current !== null;
        heldVersionRef.current = null;
        if (wasHolding) {
          // We were the editor and got displaced -> the takeover banner (we may have an
          // unsaved draft the grid keeps).
          setTakenOver(true);
        } else {
          // We were only viewing -> re-read authoritative state so the precise
          // "being priced by <name>" holder banner shows (editable=false + lock_info).
          void mutate();
        }
      } else if (payload.action === "released") {
        // Freed by another -> re-read authoritative editable/lock_info (the [pricedData]
        // effect clears takenOver when the fresh payload reports the sheet editable).
        void mutate();
      }
    };
    // NOTE (T1): the reconnect self-heal (re-read authoritative lock state) moved to the
    // consolidated, reconnect-GATED + debounced effect below. The boq:lock_changed handler above
    // (which still calls mutate() on a takeover/release) is unchanged.
    socket.on("boq:lock_changed", handler);
    return () => {
      socket.off("boq:lock_changed", handler);
    };
  }, [socket, mutate]);

  // T1 reconnect-gate: ONE consolidated socket self-heal. The dev socket flaps (~11 reconnects in
  // minutes); the old per-effect `socket.on("connect", () => mutate()/mutateCategories())` fired on
  // EVERY connect (incl. the initial mount one), each refetch minting new data identities -> a full
  // non-memoized grid reconcile -> the continuous idle re-render storm seen in the trace. Now: refetch
  // BOTH (get_priced_rows + get_sheet_categories) only on a GENUINE reconnect (a connect that followed
  // a disconnect), skipping the initial connect, and debounced to <=1 pair per RECONNECT_REFETCH_
  // DEBOUNCE_MS. Refs only -> this effect adds NO re-render source. mutate/mutateCategories are stable
  // SWR mutators. Classify-completion, freeze/unfreeze, and lock_changed mutate() paths are untouched.
  useEffect(() => {
    if (!socket) return;
    const onDisconnect = () => {
      sawDisconnectRef.current = true;
    };
    const onConnect = () => {
      const now = Date.now();
      if (
        !shouldRefetchOnConnect(
          { sawDisconnect: sawDisconnectRef.current, lastRefetchAt: lastReconnectRefetchRef.current },
          now,
        )
      ) {
        // Initial connect (no disconnect seen) OR a flap within the debounce window: skip. Leave
        // sawDisconnectRef true on a debounced skip so a later connect past the window still heals.
        return;
      }
      lastReconnectRefetchRef.current = now;
      sawDisconnectRef.current = false;
      void mutate();
      void mutateCategories();
    };
    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);
    return () => {
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
    };
  }, [socket, mutate, mutateCategories]);

  // Heartbeat (A2): while we HOLD the lock, refresh it every ~30s so an active editor is never
  // taken over mid-session (the 120s edit-driven TTL would otherwise lapse without saves). A
  // rejected refresh (another user took over) flips us to read-only.
  useEffect(() => {
    const id = window.setInterval(() => {
      const ctx = lockCtxRef.current;
      if (ctx.disabled || ctx.version === null || heldVersionRef.current !== ctx.version) return;
      if (!ctx.boqId || !ctx.sheetName) return;
      void acquirePricingLock({
        boq_name: ctx.boqId, sheet_name: ctx.sheetName, committed_version: ctx.version,
      }).catch((e) => {
        if (isTakeoverError(getFrappeError(e))) {
          heldVersionRef.current = null;
          setTakenOver(true);
        }
      });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [acquirePricingLock]);

  // Release-on-leave (A2): free the lock the INSTANT the editor closes, so no colleague waits
  // out the TTL. beforeunload + unmount both fire navigator.sendBeacon (a normal POST would be
  // cancelled on unload). Guarded on actually holding the lock; idempotent + tolerant server-side.
  useEffect(() => {
    const beacon = () => {
      const ctx = lockCtxRef.current;
      if (ctx.disabled || heldVersionRef.current === null || ctx.version === null) return;
      if (!ctx.boqId || !ctx.sheetName) return;
      try {
        const fd = new FormData();
        fd.append("boq_name", ctx.boqId);
        fd.append("sheet_name", ctx.sheetName);
        fd.append("committed_version", String(ctx.version));
        const csrf = (window as unknown as { frappe?: { csrf_token?: string } })?.frappe?.csrf_token;
        if (csrf) fd.append("csrf_token", csrf);
        navigator.sendBeacon(
          "/api/method/nirmaan_stack.api.boq.wizard.pricing.release_pricing_lock", fd,
        );
      } catch {
        /* best-effort: the lock ages out via the TTL if this fails */
      }
    };
    window.addEventListener("beforeunload", beacon);
    return () => {
      window.removeEventListener("beforeunload", beacon);
      beacon(); // release on unmount (SPA navigate-away) too
      heldVersionRef.current = null;
    };
  }, []);

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

  // ── Guard screens (V0/T2) ────────────────────────────────────────────────────
  // These were THREE early returns (isLoading / !boq / !sheetName). They are now conditional
  // branches in the SINGLE return at the bottom (byte-identical JSX, same order) so that every
  // derived-state const + handler below is a LEGAL hook position -- required to memoize them
  // (useMemo/useCallback) for the React.memo(PricingGrid) shield (hooks-after-early-return is
  // illegal). Everything from here to the return now also runs during the loading / no-data
  // states, so it is undefined-safe by construction: rows / columnDescriptors / etc. default to
  // [] (activeMessage read via ?.), and the `boq` doc is dereferenced ONLY inside the guarded
  // MainContent branch of the return (never in a derivation above it). sheetName is never member-
  // accessed (only value / ?? "").

  // Slice 3d: the BoQ's committed sheets in workbook order (sheet_order), for the tab
  // strip. Empty while the list loads -> the strip renders nothing (the grid never waits
  // on it). The active tab is the current :sheetName (matched VERBATIM, #152).
  const committedSheets = orderCommittedSheets(committedStateData?.message?.committed_state ?? []);

  // Data derived from the ACTIVE priced-rows payload: the selected EARLIER version (read-only
  // history, from get_version_priced_rows) when viewing history, else the live current version
  // (get_priced_rows). The live fetch is unchanged; this is a pure read-source swap. The history
  // payload carries editable=false, so every downstream edit gate collapses to read-only.
  const activeMessage = isViewingHistory ? historyData?.message : pricedData?.message;
  // Autosave-perf #1(c): IDENTITY-PRESERVING MERGE. The inline `await mutate()` after a rate save
  // refetches the whole sheet -> a fresh `rows` array whose every row is a NEW object, defeating the
  // grid's row memo (prev.row === next.row) -> all ~200 rows re-render on every edit. Reuse the prior
  // row object for any row the save did not change (row_index match + overlay fields equal -- see
  // rowMerge.ts), so the memo holds and only the edited row re-renders. CAPTURE-ONLY backend (STEP 0,
  // pricing.py) guarantees a save changes only the edited row's returned overlay data; the
  // field-compare is the fallback guard. Source switch (current <-> a viewed version) resets prev so
  // a different version's committed base is never reused. (Does NOT fix the O(rows) page recomputes
  // below -- rowFlags/pricedCount/maps -- a smaller separate cost, deliberately out of scope.)
  const rawRows = activeMessage?.rows ?? [];
  const rowsSourceSig = isViewingHistory ? `v:${selectedVersion}` : "current";
  // V0/T2: memoize the identity-preserving merge so `rows` keeps a STABLE array reference across
  // re-renders that do NOT refetch (activeMessage unchanged -> rawRows is the same array -> cached).
  // Without this, mergeRowsPreservingIdentity returns a fresh .map() array every render (rowMerge.ts),
  // so the grid's `rows` prop churns and React.memo(PricingGrid) could NEVER bail. Reads the merge
  // refs inside (intentionally NOT deps -- the identity-merge pattern); recomputes only on a real data
  // change (rawRows) or a version/source switch (rowsSourceSig).
  const rows = useMemo(
    () => {
      const prior = rowsSourceSigRef.current === rowsSourceSig ? prevRowsRef.current : [];
      return mergeRowsPreservingIdentity(prior, rawRows);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawRows, rowsSourceSig],
  );
  prevRowsRef.current = rows;
  rowsSourceSigRef.current = rowsSourceSig;
  const columnDescriptors = activeMessage?.column_descriptors ?? [];
  const columnFormulas = activeMessage?.column_formulas ?? []; // F3: per-column amount formulas
  const dismissals = activeMessage?.dismissals ?? []; // 4b-ACKNOWLEDGE: current dismissals
  const reconChoices = activeMessage?.reconciliation_choices ?? []; // Cluster B: per-cell choices
  const commitVersion = activeMessage?.commit_version ?? null;
  // RESERVED for the future single-editor-lock slice (3b) -- inert in 3a. Threaded into the
  // grid so 3b can gate inline edit on them without reshaping the contract.
  const editable = activeMessage?.editable ?? true;
  const lockInfo = activeMessage?.lock_info ?? null;
  // The DELIBERATE per-sheet lock (this slice). A SEPARATE reason from the concurrency verdict:
  // it ORs into `locked` (below) but keeps its own banner. Persisted on BoQ Sheet, cross-user.
  const isLocked = activeMessage?.is_locked ?? false;
  // The CLASSIFICATION freeze (separate feature). Read beside isLocked but DELIBERATELY NOT ORed
  // into `locked` -- pricing stays fully editable under a classification freeze. It gates ONLY the
  // Category picker + the Classify button. A ref keeps onCategoryClick reference-stable (row-memo
  // anti-defeat rule) while still seeing the current frozen state.
  const classificationFrozen = activeMessage?.classification_frozen ?? false;
  const frozenBy = activeMessage?.frozen_by ?? null;
  const frozenAt = activeMessage?.frozen_at ?? null;
  // Slice G3a: the admin category-gate override state (DISPLAY only -- the set/clear control is G3b).
  // The server also returns `eligible_blank_category_count` / `categories_complete` (G2e) -- the page
  // derives its OWN live count below from isMasterSetBlank; these are the load-time parity source.
  const categoryGateOverride = activeMessage?.category_gate_override ?? false;
  const categoryOverrideBy = activeMessage?.category_override_by ?? null;
  const categoryOverrideAt = activeMessage?.category_override_at ?? null;
  classificationFrozenRef.current = classificationFrozen;
  // Loading/error track the ACTIVE source (the history fetch while in history mode).
  const pricedLoading = isViewingHistory ? historyData === undefined : pricedData === undefined;
  const pricedError = isViewingHistory ? historyData === null : pricedData === null;
  // HARD READ-ONLY when held FRESH by another user (backend editable===false), after a mid-edit
  // takeover, OR when the sheet is DELIBERATELY locked. Withholding onSaveRate collapses ALL of
  // the grid's edit gates (the single onSaveRate root gate) to the read-only render -- no per-cell
  // editable check. The deliberate lock is ABSOLUTE: it rides this same boolean, so the override
  // (which lives INSIDE isRateEditableRow, ANDed AFTER onSaveRate) can never reach past it.
  // Version-view: an EARLIER version is read-only history -- it rides this SAME choke (no parallel
  // gate), so withholding the save callbacks below collapses EVERY mutation path to read-only by
  // construction. The history payload also reports editable=false (server belt to this suspenders).
  const locked = editable === false || takenOver || isLocked || isViewingHistory;

  // Acquire the single-editor lock on FIRST edit-intent (A2 / ADR-0011). Called from the grid's
  // onDirtyChange (fires when the user first modifies a cell, BEFORE any save), so a second
  // viewer flips read-only within a socket round-trip -- not on a failed save. Idempotent per
  // version (heldVersionRef). A rejected acquire (someone else holds it fresh) flips us to
  // read-only via the same takeover banner. The save_* endpoints still enforce server-side.
  const ensureLockAcquired = useCallback(() => {
    if (locksDisabledClient) return;
    if (locked) return; // read-only (history / deliberate lock / already taken over)
    if (!boqId || !sheetName || commitVersion === null) return;
    if (heldVersionRef.current === commitVersion) return; // already hold it for this version
    heldVersionRef.current = commitVersion; // optimistic (prevents a double-fire)
    void acquirePricingLock({
      boq_name: boqId, sheet_name: sheetName, committed_version: commitVersion,
    }).catch((e) => {
      const msg = getFrappeError(e);
      heldVersionRef.current = null; // failed -> we do NOT hold it
      if (isTakeoverError(msg)) setTakenOver(true); // someone else holds it fresh -> read-only
      // else: transient error -> a retry on the next edit will re-attempt.
    });
    // heldVersionRef is a ref; setTakenOver is a stable setter -- both intentionally omitted.
  }, [locksDisabledClient, locked, boqId, sheetName, commitVersion, acquirePricingLock]);

  // The grid's dirty signal doubles as first-edit-intent: keep the existing hasUnsaved wiring
  // AND acquire the lock the moment the sheet becomes dirty.
  const handleDirtyChange = useCallback(
    (dirty: boolean) => {
      setHasUnsaved(dirty);
      if (dirty) ensureLockAcquired();
    },
    [ensureLockAcquired],
  );

  // The deliberate lock toggle: POST lock_sheet / unlock_sheet for the CURRENT committed version,
  // then mutate() so the editor re-reads is_locked (persisted + cross-user). sheet_name VERBATIM
  // (#152). ANY user may toggle (no role check -- a coordination signal). Disabled while in flight.
  const handleToggleLock = async () => {
    if (commitVersion === null) return;
    setLockToggling(true);
    try {
      const fn = isLocked ? unlockSheetCall : lockSheetCall;
      await fn({ boq_name: boqId, sheet_name: decodedSheetName, committed_version: commitVersion });
      void mutate();
    } catch (e) {
      setSaveError(getFrappeError(e) || "Could not change the sheet lock. Please try again.");
    } finally {
      setLockToggling(false);
    }
  };

  // Classification freeze toggle. Freeze first reads get_freeze_summary (so the confirm dialog can
  // warn about uncategorised rows), then the confirm dialog POSTs freeze_classification. Unfreeze
  // opens its own confirm dialog. Both mutate() so the editor re-reads classification_frozen.
  // sheet_name VERBATIM (#152). Disabled while a POST is in flight.
  const handleFreezeClick = async () => {
    if (commitVersion === null) return;
    setSaveError(null);
    setFreezeToggling(true);
    try {
      const res = await getFreezeSummaryCall({ boq_name: boqId, sheet_name: decodedSheetName });
      const m = res?.message ?? {};
      setFreezeConfirm({
        uncategorised_preambles: m.uncategorised_preambles ?? 0,
        uncategorised_line_items: m.uncategorised_line_items ?? 0,
      });
    } catch (e) {
      setSaveError(getFrappeError(e) || "Could not read the freeze summary. Please try again.");
    } finally {
      setFreezeToggling(false);
    }
  };

  const doFreeze = async () => {
    setFreezeConfirm(null);
    setFreezeToggling(true);
    try {
      await freezeClassificationCall({ boq_name: boqId, sheet_name: decodedSheetName });
      void mutate();
    } catch (e) {
      setSaveError(getFrappeError(e) || "Could not freeze the classification. Please try again.");
    } finally {
      setFreezeToggling(false);
    }
  };

  const doUnfreeze = async () => {
    setUnfreezeConfirm(false);
    setFreezeToggling(true);
    try {
      await unfreezeClassificationCall({ boq_name: boqId, sheet_name: decodedSheetName });
      void mutate();
    } catch (e) {
      setSaveError(getFrappeError(e) || "Could not unfreeze the classification. Please try again.");
    } finally {
      setFreezeToggling(false);
    }
  };

  // HV-10: pick / clear one row's human category verdict, DISCIPLINE-AWARE. A group pick carries
  // that engine's discipline (the write lands on ITS row identity; upsert-on-missing mints the row
  // if absent). "Clear verdict" passes discipline=null -> the page targets the row's currently
  // RESOLVED human discipline (or the effective discipline), since there is nothing else to clear.
  // Optimistic override on a PICK (human wins the ladder immediately); after a successful write the
  // resolved read is refetched so the ladder redisplays authoritatively (HV-10 replaces the old
  // P1-perf skip -- multi-engine resolution can shift). On error, revert + surface inline.
  const handleVerdictSelect = async (id: string, discipline: string | null) => {
    const target = pickerState;
    if (!target) return;
    const { excelRow } = target;
    const resolved = resolvedByExcelRow.get(excelRow);
    // Resolve the target discipline: an explicit group pick wins; a clear falls back to the row's
    // resolved human discipline, then its effective discipline.
    const pickDiscipline =
      discipline ?? resolved?.human_discipline ?? resolved?.resolved_discipline ?? null;
    if (!pickDiscipline) {
      // Nothing to write against (a clear on a blank row with no verdict) -- just close.
      setPickerState(null);
      return;
    }
    setPickerState(null);
    setSaveError(null);
    // Optimistic override for BOTH a pick AND a clear (Slice G3a Scope 5), so the LIVE count updates
    // instantly. A pick shows the human verdict (non-blank effective -> isMasterSetBlank FALSE ->
    // count DROPS). A clear shows the BLANK state (effective "" -> deriveVerdictState "unclassified"
    // -> isMasterSetBlank TRUE -> count RISES) so the sheet re-locks in the SAME interaction instead
    // of briefly appearing unlocked until the refetch reconciles. (Server-side a clear reverts to the
    // machine verdict; for an auto-machine row the optimistic blank over-reports for the round-trip
    // only, corrected by mutateCategories -- it never UNDER-reports, so the gate never wrongly opens.)
    const cur = categoriesByExcelRow.get(excelRow);
    const base: SheetCategoryRow = cur ?? {
      excel_row: excelRow,
      rule_category_id: "",
      ai_category_id: "",
      final_category_id: "",
      routing: "Auto-accepted",
      routing_reason: "",
      human_category_id: "",
      effective_category_id: "",
    };
    // buildOptimisticVerdict (pure, tested): a pick sets a non-blank effective (count drops); a clear
    // sets a blank effective (count rises). `base` already carries excel_row.
    const optimistic = buildOptimisticVerdict(base, id);
    setCategoryOverrides((prev) => new Map(prev).set(excelRow, optimistic));
    const didOverride = true;
    const dropOverride = () =>
      setCategoryOverrides((prev) => {
        if (!prev.has(excelRow)) return prev;
        const next = new Map(prev);
        next.delete(excelRow);
        return next;
      });
    try {
      await setRowCategory({
        boq: boqId, // VERBATIM
        sheet_name: sheetName, // VERBATIM -- trailing spaces intact (#152)
        excel_row: excelRow,
        human_category_id: id,
        discipline: pickDiscipline,
      });
      // HV-10: refetch so the SERVER ladder redisplays (human wins), then drop the optimistic patch.
      await mutateCategories();
      if (didOverride) dropOverride();
    } catch (e) {
      if (didOverride) dropOverride();
      setSaveError(
        getFrappeError(e) || "Could not save the category verdict. Please try again.",
      );
    }
  };

  // ── Slice G3b: the admin category-gate OVERRIDE control (set / clear) ───────────────────────────
  // Self-contained so it can be deleted in ONE cut when the override is removed (owner commitment).
  // NO confirmation dialog: the reason popover IS data entry, not an "are you sure" step (owner
  // ruling). Reason is OPTIONAL (blank is valid). Errors (incl. PermissionError) surface the SERVER's
  // message inline via the existing saveError banner -- never swallowed, never replaced with generic
  // copy. On success, mutate() refetches so the banner + rate-cell state flip with no page reload.
  const [overridePopoverOpen, setOverridePopoverOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  // Per-sheet reset (kept HERE, not in the main [sheetName] effect above, so the G3b block stays
  // deletable in one cut). The reason entry is a NON-modal Popover, so the sheet-tab strip IS
  // clickable while it is open -- without this, a reason typed for one sheet would stay on screen
  // and submit against the next one. overrideSubmitting is excluded on purpose: its finally clears
  // it, and forcing it false mid-POST would re-enable the button while that request is in flight.
  useEffect(() => {
    setOverridePopoverOpen(false);
    setOverrideReason("");
  }, [sheetName]);
  const handleSetCategoryOverride = async () => {
    if (commitVersion === null) return;
    setSaveError(null);
    setOverrideSubmitting(true);
    try {
      await setCategoryOverrideCall({
        boq_name: boqId,
        sheet_name: sheetName, // VERBATIM (#152)
        committed_version: commitVersion,
        // Client cap is belt-and-braces (the input maxLength blocks it too); the server caps as well.
        // Blank -> null (server stores NULL). Pure helper -- unit-tested.
        reason: normalizeOverrideReason(overrideReason),
      });
      setOverridePopoverOpen(false);
      setOverrideReason("");
      void mutate();
    } catch (e) {
      setSaveError(getFrappeError(e) || "Could not override the category check. Please try again.");
    } finally {
      setOverrideSubmitting(false);
    }
  };
  const handleClearCategoryOverride = async () => {
    if (commitVersion === null) return;
    setSaveError(null);
    setOverrideSubmitting(true);
    try {
      await clearCategoryOverrideCall({
        boq_name: boqId,
        sheet_name: sheetName, // VERBATIM (#152)
        committed_version: commitVersion,
      });
      void mutate();
    } catch (e) {
      setSaveError(getFrappeError(e) || "Could not clear the override. Please try again.");
    } finally {
      setOverrideSubmitting(false);
    }
  };

  // Slice 3b: the page-owned save. The grid hands up the cell identity; the page fills
  // boq / sheet / committed_version + the rate, POSTs save_cell_price, then mutate()-refetches
  // so the priced_* markers re-derive (no client-side marker logic). On throw it surfaces the
  // error inline AND re-throws so the grid keeps the optimistic draft (the user's input).
  const handleSaveRate = useCallback(async (cell: RateCellSaveArgs, rate: number) => {
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
  }, [commitVersion, boqId, sheetName, override, saveCellPrice, mutate]);

  // Slice 4a: save one row's remark (save_row_remark) -- a SEPARATE write path from rates,
  // mirroring handleSaveRate (in-flight count, takeover detection, mutate refresh). Blank
  // remark clears (backend). The grid renders read-only when this is withheld (locked).
  const handleSaveRemark = useCallback(async (args: RemarkSaveArgs) => {
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
  }, [commitVersion, boqId, sheetName, saveRowRemark, mutate]);

  // Slice 4a: save N color cells (a single pick = 1, an apply-to-row = N) then ONE mutate.
  // The grid builds the cell list; the page owns the POSTs + the refetch. Blank color clears.
  const handleSaveColor = useCallback(async (argsList: ColorSaveArgs[]) => {
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
  }, [commitVersion, boqId, sheetName, saveCellColor, mutate]);

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
  const handleSaveReconChoice = useCallback(async (args: ReconChoiceSaveArgs) => {
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
  }, [commitVersion, boqId, sheetName, saveCellReconChoice, mutate]);

  // Formula Builder F3: save one amount-column formula (save_amount_formula) then mutate so
  // column_formulas refetches + the header label updates. Mirrors handleSaveColor (in-flight,
  // takeover, mutate). The tree is sent as a JSON string; a null formula -> "" (the F1 clear
  // path). Withheld when locked (the grid then renders the header label read-only).
  const handleSaveFormula = useCallback(async (args: AmountFormulaSaveArgs) => {
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
  }, [commitVersion, boqId, sheetName, saveAmountFormula, mutate]);

  // Slice A (clipboard): the BATCH write path for a paste / cut / fill-down gesture. Fires each
  // write through the SAME save_cell_price / save_row_remark endpoints as the single-cell saves but
  // with the per-cell mutate() SUPPRESSED, then does ONE trailing mutate() at the end so markers /
  // amounts re-derive once (the Q5 finding -- N per-cell mutates would thrash). Mirrors the copy-
  // forward partial-outcome posture: on a mid-batch failure it STOPS, surfaces which cells failed,
  // and STILL mutate()s so the grid reflects what DID land (no fake client-side atomicity). Each
  // write carries its resolved {cell/args, value} -- the single funnel a later Slice-B undo wrapper
  // can tap. Does NOT reshape handleSaveRate (the inline single-cell path stays byte-for-byte). */
  const handleBatchWrite = useCallback(async (writes: BatchWrite[]): Promise<BatchOutcome> => {
    if (commitVersion === null) {
      setSaveError("This sheet has no committed version to write to.");
      return { written: 0, failed: writes.length };
    }
    if (writes.length === 0) return { written: 0, failed: 0 };
    setSaveError(null);
    setInFlight((n) => n + 1);
    let written = 0;
    let failed = 0;
    let failMsg: string | null = null;
    try {
      for (const w of writes) {
        try {
          if (w.kind === "rate") {
            await saveCellPrice({
              boq_name: boqId, // VERBATIM
              sheet_name: sheetName, // VERBATIM (#152)
              excel_row: w.cell.excelRow,
              col_letter: w.cell.colLetter,
              committed_version: commitVersion,
              rate: w.rate,
              area: w.cell.area, // omitted by the SDK when undefined (scalar path)
              rate_kind: w.cell.rateKind,
              description: w.cell.description, // copy-forward MATCH GUARD
              allow_non_priceable: override, // Slice 3e: the asserted per-sheet override
            });
          } else {
            await saveRowRemark({
              boq_name: boqId, // VERBATIM
              sheet_name: sheetName, // VERBATIM (#152)
              excel_row: w.args.excelRow,
              committed_version: commitVersion,
              remark: w.args.remark,
              description: w.args.description,
            });
          }
          written++;
        } catch (e: unknown) {
          // Mid-batch failure: STOP (the rest is skipped), remember the reason, surface a takeover
          // as the takeover banner. The single trailing mutate() below still runs in `finally`.
          failed = writes.length - written;
          const msg = getFrappeError(e);
          if (isTakeoverError(msg)) setTakenOver(true);
          failMsg = msg || "Some cells could not be saved.";
          break;
        }
      }
    } finally {
      await mutate(); // ONE trailing refetch -- markers / amounts re-derive once
      if (failMsg) setSaveError(`Saved ${written} of ${writes.length}. ${failMsg}`);
      else setLastSavedAt(new Date());
      setInFlight((n) => n - 1);
    }
    return { written, failed };
  }, [commitVersion, boqId, sheetName, override, saveCellPrice, saveRowRemark, mutate]);

  // ── Slice 4b-A: the computed review-flag layer (Cluster A) ──────────────────────
  // Everything routes through the ONE shared priceability helper -- the in-grid markers,
  // the strip, AND the priced count. Computed page-side from the rows already in hand (no
  // new fetch). Plain consts (not useMemo) because they sit AFTER the early-return guards
  // (hooks-after-return is illegal); the page re-renders infrequently (saves / toggles),
  // never per keystroke (rate drafts live in the grid), so the recompute is cheap.
  const rowFlags = useMemo(() => {
    const m = new Map<number, RowReviewFlags>();
    for (const r of rows) {
      m.set(r.row_index, computeRowFlags(r, columnDescriptors, columnFormulas));
    }
    return m;
  }, [rows, columnDescriptors, columnFormulas]);
  // MANDATORY amount-formula gate (Phase 5): per-SHEET completeness -- every amount column must
  // have a declared formula before ANY rate is editable. Plain derive from the data already in
  // hand (columnDescriptors + columnFormulas -- no new fetch). TRUE for a sheet with zero amount
  // columns (trivially complete). Passed to the grid as one boolean prop (ANDed OUTSIDE the
  // override) + drives the "declare formulas" banner.
  const formulasComplete = areFormulasComplete(columnDescriptors, columnFormulas);
  // Slice G3a: the LIVE count of ELIGIBLE master-set rows whose category cell is EMPTY, from the SAME
  // isMasterSetBlank predicate the amber fill + Check-Category filter use (four surfaces, ONE
  // predicate -- never a second emptiness test). Iterate the ROWS array, NOT categoriesByExcelRow: a
  // never-classified row is ABSENT from the map (Recon 5/6) but MUST be counted -- keying off the map
  // would miss it (the fail-open the backend already guards). useMemo'd on the SAME deps as
  // categoriesByExcelRow (which folds catData + the optimistic overrides) plus rows, so it recomputes
  // only on a fetch / pick / clear, never per keystroke. At load this equals the server's
  // eligible_blank_category_count (parity, verified in the cert).
  const categoryBlankCount = useMemo(
    () => countMasterSetBlankRows(rows, categoriesByExcelRow),
    [rows, categoriesByExcelRow],
  );
  // The gate OPENS when zero blanks remain OR the admin override is set. DELIBERATE asymmetry: the
  // COUNT keeps counting blanks even under the override (an admin should see how many remain), but
  // the GATE opens regardless. Only this BOOLEAN reaches the grid (never the count -- a count changes
  // on every pick and would re-render every row; the boolean flips only when editability flips).
  const categoryGateOpen = isCategoryGateOpen(categoryBlankCount, categoryGateOverride);

  // RM-3c item C: when the top block is collapsed in full-screen, the slim rail must still surface any
  // BLOCKING state (so collapsing never hides it). One compact chip per active blocker.
  const collapsedBannerChips = useMemo(() => {
    const chips: string[] = [];
    if (isViewingHistory) chips.push("Viewing history");
    else if (takenOver) chips.push("Taken over - read only");
    else if (isLocked) chips.push("Locked - read only");
    if (classificationFrozen) chips.push("Classification frozen");
    if (!locked && !formulasComplete) chips.push("Formulas incomplete");
    // The category banner is VISIBLE whenever there are blanks -- in its blocking form OR its
    // override-active informational form (this sheet). Surface it in either case so collapsing never
    // hides the fact; note when the gate is overridden.
    if (!locked && categoryBlankCount > 0)
      chips.push(`${categoryBlankCount} without category${categoryGateOverride ? " (override)" : ""}`);
    return chips;
  }, [
    isViewingHistory,
    takenOver,
    isLocked,
    classificationFrozen,
    locked,
    formulasComplete,
    categoryBlankCount,
    categoryGateOverride,
  ]);

  // ── U1 rate-helper (DEV): D8 gate REUSE + run / badge-click / use handlers. The enable chain is
  // EXACTLY what a rate write consumes -- !locked (locked => onSaveRate withheld), formulasComplete,
  // categoryGateOpen -- read straight from the existing vars, never re-derived. Disabled surfaces
  // the first failing reason (title). Synchronous: the run builds suggestionsByExcelRow in place. ──
  const suggestRatesReason: string | null =
    pricedLoading || pricedError
      ? "Loading..."
      : commitVersion === null
        ? "Sheet is not committed"
        : locked
          ? "Sheet is locked / read-only"
          : !formulasComplete
            ? "Declare amount formulas first"
            : !categoryGateOpen
              ? "Every eligible row needs a category first"
              : null;
  const suggestRatesDisabled = suggestRatesReason !== null;

  // RM-3: config + master (SWR) feed the RM-2 interpreter CLIENT-SIDE (the single compute source).
  const rmConfig = rmConfigData?.message?.config ?? null;
  const rmItems = useMemo(() => rmItemsData?.message?.items ?? [], [rmItemsData]);
  // The run's extraction, keyed by excel_row.
  const extractionByRow = useMemo<Map<number, ExtractionRow>>(
    () => buildExtractionByRow(suggestRun?.results ?? []),
    [suggestRun],
  );
  // The page-built REAL helper (closure over config + master + the run's extraction). Null until a
  // run + config are present -> before any run there are no badges. RATE_HELPER_ENABLED gates it.
  const pricingSheetHelper = useMemo(
    () =>
      RATE_HELPER_ENABLED && rmConfig && suggestRun
        ? makePricingSheetHelper({ config: rmConfig, items: rmItems, extractionByRow })
        : null,
    [rmConfig, rmItems, extractionByRow, suggestRun],
  );
  const helperList = useMemo(() => buildHelperList(pricingSheetHelper), [pricingSheetHelper]);

  // PERSISTENCE (owner ruling): adopt the active run on load IFF its committed_version == the
  // sheet's CURRENT version (version keying -- never suggest against rows that may have changed).
  // IDEMPOTENT via adoptedRunKeyRef: only setState when the run identity (run_id::cv) actually
  // changes, so a mere SWR reference churn does NOT re-create suggestRun (which would loop).
  const activeRunForVersion = activeRunData?.message?.run ?? null;
  const activeRunKey =
    activeRunForVersion && isRunForVersion(activeRunForVersion.committed_version, commitVersion)
      ? `${activeRunForVersion.run_id}::${activeRunForVersion.committed_version}`
      : null;
  useEffect(() => {
    if (!RATE_HELPER_ENABLED) return;
    if (adoptedRunKeyRef.current === activeRunKey) return; // no identity change -> no churn
    adoptedRunKeyRef.current = activeRunKey;
    const run = activeRunData?.message?.run ?? null;
    if (activeRunKey && run) {
      setSuggestRun({ runId: run.run_id, committedVersion: run.committed_version, results: run.results });
    } else {
      setSuggestRun(null);
    }
    // activeRunData read inside is fine: it only matters when activeRunKey (its identity) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunKey]);

  // A PRIMITIVE signature of this sheet's Use events -- stable by value across SWR reference churn,
  // so the rebuild effect below only re-runs on a real content change (never on every render).
  const suggestEventsKey = useMemo(() => {
    const evs = suggestEventsData?.message?.events ?? [];
    return evs.map((e) => `${e.excel_row}:${e.col}`).sort().join("|");
  }, [suggestEventsData]);

  // ONE rebuild effect (badge map from the run + rows, re-applying the recorded used pairs). The
  // EMPTY-MAP GUARD (`prev.size === 0 ? prev`) is load-bearing: without it, a render before a run set
  // a NEW empty Map every time -> re-render -> "Maximum update depth exceeded". All deps are stable
  // (suggestRun is adopted idempotently; suggestEventsKey is a primitive), so it runs once per change.
  useEffect(() => {
    if (!RATE_HELPER_ENABLED) return;
    if (suggestEventsKey) {
      for (const pair of suggestEventsKey.split("|")) usedPairsRef.current.add(pair.replace(":", "::"));
    }
    if (!suggestRun || !pricingSheetHelper) {
      setSuggestionsByExcelRow((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    let map = buildSuggestions(rows, columnDescriptors, override, categoriesByExcelRow, helperList);
    for (const pair of usedPairsRef.current) {
      const [er, col] = pair.split("::");
      map = markSuggestionUsed(map, Number(er), col);
    }
    setSuggestionsByExcelRow(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestRun, pricingSheetHelper, rows, columnDescriptors, override, categoriesByExcelRow, helperList, suggestEventsKey]);

  // The suggest status handler (poll + socket funnel here). done WINS; on success adopt the run.
  const onSuggestStatus = useCallback(
    (msg: SuggestStatusResponse) => {
      if (msg.state === "running") {
        if (typeof msg.done === "number" && typeof msg.total === "number") {
          setSuggestProgress({ done: msg.done, total: msg.total });
        }
        return;
      }
      if (msg.state === "done") {
        setSuggestRunning(false);
        setSuggestSummary({ status: msg.status, ai_status: msg.ai_status, results: msg.results, run_id: msg.run_id });
        if (msg.status === "success" && typeof msg.committed_version === "number" && msg.run_id) {
          usedPairsRef.current = new Set(); // a NEW run supersedes -> no used pairs yet
          setSuggestRun({ runId: msg.run_id, committedVersion: msg.committed_version, results: msg.results ?? [] });
          void mutateActiveRun();
          void mutateSuggestEvents();
        }
      }
    },
    [mutateActiveRun, mutateSuggestEvents],
  );

  // ASYNC press: enqueue the run, open the blocking modal; the poll/socket drive it to terminal.
  const runSuggestRates = useCallback(async () => {
    setHelperPanel(null);
    setSuggestSummary(null);
    setSuggestProgress(null);
    setSuggestRunning(true);
    setSuggestModalOpen(true);
    try {
      await startSuggestCall({ boq: boqId, sheet_name: sheetName });
    } catch {
      setSuggestRunning(false);
      setSuggestSummary({ status: "error" });
    }
  }, [startSuggestCall, boqId, sheetName]);

  const handleSuggestionBadgeClick = useCallback(
    (excelRow: number, col: string, _cellEl: HTMLElement) => {
      const d = columnDescriptors.find((dd) => dd.col === col);
      const kind = d ? rateKindOfDescriptor(d) : null;
      if (!kind) return;
      setHelperPanel({ excelRow, col, kind });
    },
    [columnDescriptors],
  );

  // USE: apply the value + optimistically mark used + record the Use telemetry (fire-and-forget).
  const handleUseSuggestion = useCallback(
    (col: string, value: number, meta: UseMeta) => {
      if (!helperPanel) return;
      const excelRow = helperPanel.excelRow;
      gridRef.current?.applyRate(excelRow, col, value);
      usedPairsRef.current.add(`${excelRow}::${col}`);
      setSuggestionsByExcelRow((prev) => markSuggestionUsed(prev, excelRow, col));
      const ext = extractionByRow.get(excelRow);
      const extractedAttributes: Record<string, unknown> = {};
      const extractedConfidences: Record<string, number> = {};
      if (ext) {
        for (const [k, cell] of Object.entries(ext.attributes)) {
          extractedAttributes[k] = cell.value;
          extractedConfidences[k] = cell.confidence;
        }
      }
      void recordSuggestEventCall({
        boq: boqId,
        sheet_name: sheetName,
        excel_row: excelRow,
        col,
        kind: meta.kind,
        helper_id: meta.helperId,
        category_id: categoriesByExcelRow.get(excelRow)?.effective_category_id ?? "",
        run_id: suggestRun?.runId ?? "",
        extracted_attributes: extractedAttributes,
        extracted_confidences: extractedConfidences,
        corrected_attributes: meta.correctedAttributes,
        computed_value: meta.computedValue,
        used_value: value,
      })
        .then(() => {
          void mutateSuggestEvents();
        })
        .catch(() => {
          /* telemetry never blocks the save */
        });
      setHelperPanel(null);
    },
    [helperPanel, extractionByRow, boqId, sheetName, categoriesByExcelRow, suggestRun, recordSuggestEventCall, mutateSuggestEvents],
  );

  // The open panel's row context, built from the SAME page data buildSuggestions used.
  const helperPanelCtx = useMemo(() => {
    if (!helperPanel) return null;
    const row = rows.find((r) => r.source_row_number === helperPanel.excelRow);
    if (!row) return null;
    const rateKinds = rateKindsOf(columnDescriptors.filter(isRateDescriptor));
    return buildRowContext(row, rateKinds, categoriesByExcelRow.get(helperPanel.excelRow));
  }, [helperPanel, rows, columnDescriptors, categoriesByExcelRow]);
  // The panel is open only with the flag on, a scoped cell, and a resolvable row context.
  const helperPanelOpen = RATE_HELPER_ENABLED && helperPanel !== null && helperPanelCtx !== null;
  // RM-3b: the embedded rate-helper panel is a PERMANENT part of the embedded layout (panel-as-default)
  // whenever the feature is on and we are not full-screen. It is always mounted (empty state until a
  // badge/sparkle selects a row), so the embedded page is permanently widened + a flex row.
  const embeddedPanel = RATE_HELPER_ENABLED && !expanded;

  // AMENDMENT C / C3: the carry button's state, from the PURE helper (ADR-0010 F4 -- the rule is
  // unit-tested; this page only renders it). `locked` already folds the deliberate lock, a
  // takeover, a foreign holder AND history mode, so one flag covers every read-only reason.
  const carryPlanSheet = isRevisionSheet
    ? carryPlanData?.message?.sheets?.[0] ?? null
    : null;
  const carryState = carryButtonState({
    isRevisionSheet,
    loading: isRevisionSheet && carryPlanData === undefined,
    locked,
    formulasComplete,
    sheet: carryPlanSheet,
  });
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
  // V0/T2: byRowIndex is memoized (it feeds the displayRows filter/collapse path -- keeping it
  // stable lets displayRows stay referentially stable in the filtered/collapsed view too, which V1
  // windowing leans on). byExcelRow only feeds a ref (byExcelRowRef, read by revealRow), so its
  // identity is irrelevant -- left a plain const. childrenByParent is a grid prop -> memoized.
  const byRowIndex = useMemo(
    () => new Map<number, CollapseRow>(rows.map((r) => [r.row_index, r])),
    [rows],
  );
  const byExcelRow = new Map<number, CollapseRow>(rows.map((r) => [r.source_row_number, r]));
  const childrenByParent = useMemo(() => buildChildrenByParent(rows), [rows]);
  collapsedRef.current = collapsed;
  byRowIndexRef.current = byRowIndex;
  byExcelRowRef.current = byExcelRow;
  const collapseActive = collapsed.size > 0;

  // The view-filter predicate (show-unpriced + row-type), WITHOUT collapse -- shared by the
  // search universe (R3: search ignores collapse) and folded into displayRows below.
  const passesViewFilter = (r: PricedRow) =>
    (!showOnlyUnpriced ||
      (isPriceableLine(r, columnDescriptors) && !isFullyPriced(r, columnDescriptors))) &&
    // Slice G2e: the "Check Category" filter keeps rows in the MASTER SET whose category cell is
    // EMPTY -- the SAME shared predicate the grid's amber fill uses (isMasterSetBlank), so the
    // filter shows EXACTLY what amber shows (owner ruling; it now surfaces never-classified eligible
    // rows the old isNeedsReviewCategory missed). VIEW-ONLY -- never touches counts / Summary / feed.
    (!showNeedsReview || isMasterSetBlank(r, categoriesByExcelRow.get(r.source_row_number))) &&
    classificationVisible(r.effective_classification, rowTypeToggles);
  const anyViewFilter = showOnlyUnpriced || showNeedsReview || !noRowTypeHidden;
  // displayRows: the view filter AND collapse, composed in ONE page-side pass (R4). VIEW-ONLY --
  // the count (computePricedCount over `rows`), the Summary (rows={rows}), and the review/flag
  // feed all read the UNFILTERED `rows`, so neither hiding a row-type NOR collapsing a subtree
  // moves any total or the N-of-M priceable count. The `=== rows` fast path (stable reference ->
  // the grid's byIdx/depths memos hold) is preserved when nothing is filtered or collapsed.
  // V0/T2: memoized so the grid's `rows` prop stays referentially stable across re-renders that do
  // not change the row set / filters / collapse. Fast path returns the (stable) `rows` when nothing
  // is filtered/collapsed. `passesViewFilter` is a per-render closure over the LISTED deps, so it is
  // referenced inside but deliberately not a dep (the underlying values are the real deps).
  const displayRows = useMemo(
    () =>
      !anyViewFilter && !collapseActive
        ? rows
        : rows.filter(
            (r) =>
              passesViewFilter(r) &&
              (!collapseActive || !isHiddenByCollapse(r, collapsed, byRowIndex)),
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      rows,
      anyViewFilter,
      collapseActive,
      showOnlyUnpriced,
      showNeedsReview,
      showSpacers,
      showNotes,
      showSubtotals,
      categoriesByExcelRow,
      columnDescriptors,
      collapsed,
      byRowIndex,
    ],
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

  // V0/T2: the three former early-return guard screens, now branches of the SINGLE return (order +
  // JSX byte-identical to the originals). MainContent (the else branch) only evaluates when all
  // guards pass, so `boq.boq_name` etc. inside it are safe.
  return isLoading ? (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  ) : !boq ? (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
      <p className="font-medium text-foreground">BoQ not found</p>
      <p className="text-sm text-muted-foreground">
        No record found for &ldquo;{boqId}&rdquo;.
      </p>
      <Button variant="outline" className="mt-4" onClick={handleBack}>
        Back to hub
      </Button>
    </div>
  ) : !sheetName ? (
    <p className="p-6 text-sm text-destructive">Missing sheet identifier in URL.</p>
  ) : (
    <div
      // Slice 4c: ONE JSX tree -- only THIS wrapper's className flips between embedded and the
      // fixed inset-0 full-viewport overlay (covers the app shell, like the house Dialog/Sheet
      // overlay). FULL is `flex flex-col` so the grid slot below can take flex-1 and fill the
      // freed height. No remount -> all grid + page state survives expand/collapse.
      className={cn(
        expanded
          ? "fixed inset-0 z-50 flex flex-col space-y-4 overflow-auto bg-background p-4"
          : // RM-3b: the embedded rate-helper panel is ALWAYS mounted (panel-as-default), so the page
            // is PERMANENTLY widened when the feature is on; prod (feature off) keeps the centered cap.
            embeddedPanel
            ? "flex-1 space-y-4 w-full mx-auto pt-6 pb-10 px-4"
            : "flex-1 space-y-4 max-w-5xl mx-auto pt-6 pb-10 px-4",
      )}
    >
      {/* RM-3c item C: the FULL-SCREEN collapsible TOP BLOCK -- everything above the grid (title row +
          both ribbons + banners + summary/review panels). A chevron collapses it so the grid fills the
          wrapper vertically; the slim rail (below) always allows one-click re-expand. `space-y-4`
          preserves the inter-band gaps that used to come from the wrapper. EMBEDDED is untouched:
          `topCollapsed` only bites while `expanded`, so the block never hides and the layout is
          byte-unchanged. */}
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
      {/* ── Version ribbon (read-only history browser) -- the OUTERMOST band, ABOVE the top
          ribbon. Shows on ALL sheet types (it sits above the {!isGridOnly} bottom-ribbon gate);
          renders only when 2+ committed versions exist. Selecting an earlier version drops the
          whole editor into read-only history mode via the `locked` choke above. */}
      <VersionRibbon
        versions={versionsData?.message?.versions ?? []}
        currentVersion={liveCommitVersion}
        selectedVersion={selectedVersion}
        onSelectVersion={(v) => setSelectedVersion(v === liveCommitVersion ? null : v)}
        isViewingHistory={isViewingHistory}
        onCopyForward={() => setCopyForwardOpen(true)}
      />

      {/* Copy-forward review-before-apply dialog (launched from read-only history mode). Writes the
          selected source rates into the CURRENT version; on success it returns to the live version
          and refetches so the copied rates show, with a transient summary line. */}
      {isViewingHistory && selectedVersion !== null && (
        <CopyForwardDialog
          open={copyForwardOpen}
          boqId={boqId ?? ""}
          sheetName={sheetName}
          fromVersion={selectedVersion}
          onClose={() => setCopyForwardOpen(false)}
          onApplied={(summary: ApplyCopyForwardResponse) => {
            const skipped =
              summary.skipped.non_match +
              summary.skipped.no_rate_column +
              summary.skipped.non_priceable +
              summary.skipped.invalid;
            setCopyForwardMsg(
              `Copied ${summary.copied} rate${summary.copied === 1 ? "" : "s"}` +
                (summary.conflicts_overwritten ? `, overwrote ${summary.conflicts_overwritten}` : "") +
                (summary.conflicts_kept ? `, kept ${summary.conflicts_kept}` : "") +
                (skipped ? `, skipped ${skipped}` : "") +
                " into the current version.",
            );
            setSelectedVersion(null); // back to the live, editable version
            void mutate(); // refetch the live rows so the copied rates appear
            // WBC-W3-S5: the copy-forward CAN change categories now (the `categories` layer is
            // ticked by default), so the resolved read must be refetched or the grid renders the
            // pre-copy verdicts -- no "carried" cue, and a stale blank count keeping the rate gate
            // shut on rows that were just categorised. Same reasoning as the cross-BoQ carry below.
            void mutateCategories();
          }}
        />
      )}

      {copyForwardMsg && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
          <Check className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{copyForwardMsg}</span>
          <button type="button" onClick={() => setCopyForwardMsg(null)} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* AMENDMENT C / C3: the per-sheet cross-BOQ carry dialog + its transient summary line.
          Mirrors the copy-forward pair above -- the same act, cross-BOQ instead of cross-version.
          C4 replaces the dialog body with the multi-layer version and moves the apply onto the
          synchronous apply_sheet_carry endpoint. */}
      {isRevisionSheet && boq?.source_boq && sheetName && (
        <CrossBoqCarryDialog
          open={carryOpen}
          boqId={boqId ?? ""}
          sourceBoq={boq.source_boq}
          sheetName={sheetName}
          onClose={() => setCarryOpen(false)}
          onApplied={(summary, needsNewValues) => {
            setCarryMsg(summarizeSheetCarry(summary, needsNewValues));
            setCarryOpen(false);
            void mutate();
            // AMENDMENT E: the carry CAN change categories again (the `categories` layer is ticked
            // by default), so the resolved read must be refetched or the grid renders the pre-carry
            // verdicts -- no "carried" cue, and a stale blank count keeping the rate gate shut on
            // rows that were just categorised. Amendment D had removed this call as a dead
            // round-trip; that reasoning expired with the layer it was based on.
            void mutateCategories();
          }}
        />
      )}

      {carryMsg && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
          <Check className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{carryMsg}</span>
          <button type="button" onClick={() => setCarryMsg(null)} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Header: Row 1 = back + title + status badges (right-aligned on the title line);
          Row 2 = action buttons. Mirrors the Review screen's two-row header. ─────────────── */}
      <div className="space-y-3">
        {/* Row 1: back, title, and the STATUS BADGES right-aligned on the title line. items-center
            centres them against the two-line title block; flex-wrap drops the cluster to its own
            right-aligned line if the viewport is too narrow. */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 text-muted-foreground"
            onClick={handleBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          <div className="min-w-0 flex-1">
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

          {/* Status badges -- RIGHT-ALIGNED on the title line (ml-auto). Per-sheet Work Packages +
              "who else is here" presence (always), then the save-status chip + priced-count readout
              (!isGridOnly -- a grid-only reference sheet has nothing to save/price). SHEET-LEVEL
              header elements only -- never threaded into the memoized PricingGrid rows. justify-end +
              flex-wrap keeps them right-packed; each self-truncates so a long WP list / presence
              roster never crowds the title (which truncates via min-w-0 flex-1). */}
          <div className="ml-auto shrink-0 flex flex-wrap items-center justify-end gap-3">
            {/* Per-sheet Work Packages badge -- committed-version WP snapshot (rides get_priced_rows).
                IDENTICAL to the Review screen's badge for visual consistency. */}
            {workPackages.length > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground max-w-[16rem]"
                title={`Work packages: ${workPackages.join(", ")}`}
              >
                <span className="text-primary font-medium">WP</span>
                <span className="truncate">{workPackages.join(" · ")}</span>
              </span>
            )}
            {/* B2: BoQ-level "who else is here" presence (soft awareness; the pricing lock owns correctness). */}
            <BoqPresence boqId={boqId} />
            {!isGridOnly && (
              <div className="flex items-center gap-3">
                {/* Reflow fix (Phase 5 polish): a FIXED footprint (w-40, sized to the longest normal
                    status "Saved as of HH:MM") so the Saving<->Saved swap never changes this element's
                    width -- keeping the right-aligned badge cluster from jittering on every edit.
                    overflow-hidden + a `truncate` text child + a `title` keep an unexpectedly-long
                    message on ONE line (clipped with an ellipsis, full text on hover). Messaging unchanged. */}
                <div className="flex items-center gap-1.5 text-xs w-40 overflow-hidden">
                  {saveStatus === "saving" && (
                    <span className="flex items-center gap-1.5 text-muted-foreground min-w-0" title="Saving…">
                      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                      <span className="truncate">Saving&hellip;</span>
                    </span>
                  )}
                  {saveStatus === "saved" && lastSavedAt && (
                    <span
                      className="flex items-center gap-1.5 text-muted-foreground min-w-0"
                      title={`Saved as of ${fmtSavedTime(lastSavedAt)}`}
                    >
                      <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
                      <span className="truncate">Saved as of {fmtSavedTime(lastSavedAt)}</span>
                    </span>
                  )}
                  {saveStatus === "unsaved" && (
                    <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 min-w-0" title="Unsaved changes">
                      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                      <span className="truncate">Unsaved changes</span>
                    </span>
                  )}
                  {saveStatus === "failed" && (
                    <span className="flex items-center gap-1.5 text-destructive min-w-0" title="Save failed">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Save failed</span>
                    </span>
                  )}
                  {saveStatus === "idle" && (
                    <span className="text-muted-foreground truncate" title="All changes saved">
                      All changes saved
                    </span>
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
            )}
          </div>
        </div>

        {/* Row 2: action buttons. Full screen FIRST (always rendered -- orthogonal to editability);
            the editing toolbar (Lock, Freeze, Summary, Review, Price any row, Save now) is !isGridOnly. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Slice 4c: full-screen toggle -- ALWAYS rendered, reachable on a read-only / grid-only
              sheet too (full-screen is orthogonal to editability). */}
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
          {/* The DELIBERATE per-sheet lock toggle (this slice). State-aware Lock/Unlock; a DISTINCT
              icon (ShieldCheck/ShieldOff) from the override's Lock/Unlock so they never read alike.
              NOT gated by `locked` -- it is the ONE control that stays live when locked (so an
              unlock is always reachable). Disabled only while the toggle POST is in flight or the
              sheet is uncommitted (no version to lock). A locked sheet's button is loudly teal. */}
          <Button
            size="sm"
            variant={isLocked ? "default" : "outline"}
            className={cn(
              "gap-1.5",
              isLocked &&
                "bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-700 dark:hover:bg-teal-800",
            )}
            aria-pressed={isLocked}
            onClick={handleToggleLock}
            disabled={lockToggling || pricedLoading || pricedError || commitVersion === null || isViewingHistory}
            title={
              isLocked
                ? "This sheet is locked (read-only). Click to unlock and allow edits."
                : "Lock this sheet read-only (no rates / formulas / annotations). Anyone can unlock."
            }
          >
            {lockToggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isLocked ? (
              <ShieldCheck className="h-4 w-4" />
            ) : (
              <ShieldOff className="h-4 w-4" />
            )}
            {isLocked ? "Unlock" : "Lock"}
          </Button>
          {/* Frozen-left Slice 1: pin the anchor columns (through Description) so the descriptor /
              Remarks columns scroll horizontally past them. State-aware (loud when on); default
              off. Disabled while loading / on error / with no rows (nothing to freeze). Grid-only
              sheets never reach here (this whole cluster is gated by !isGridOnly). */}
          <Button
            size="sm"
            variant={frozen ? "default" : "outline"}
            className={cn(
              "gap-1.5",
              frozen && "bg-sky-600 text-white hover:bg-sky-700 dark:bg-sky-700 dark:hover:bg-sky-800",
            )}
            aria-pressed={frozen}
            onClick={() => setFrozen((v) => !v)}
            disabled={pricedLoading || pricedError || rows.length === 0}
            title={
              frozen
                ? "Unfreeze columns -- let every column scroll normally."
                : "Freeze the left columns (through Description) so the rest scroll horizontally."
            }
          >
            {frozen ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {frozen ? "Unfreeze" : "Freeze columns"}
          </Button>
          {/* V1 A/B toggle (windowed vs classic render). Small + unobtrusive (ghost, muted); session-
              scoped, default ON. Flipping never remounts / touches data / drafts / lock. Classic is
              the byte-identical fallback. */}
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            aria-pressed={virtualized}
            onClick={() => setVirtualized((v) => !v)}
            disabled={pricedLoading || pricedError || rows.length === 0}
            title={
              virtualized
                ? "Windowed rendering is ON (faster on big sheets). Click to use the classic full render."
                : "Classic full render. Click to turn on windowed (faster) rendering."
            }
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {virtualized ? "Fast render: on" : "Fast render: off"}
          </Button>
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
            // Disabled when locked: the override is inert under the lock (it lives INSIDE
            // isRateEditableRow, ANDed AFTER the withheld onSaveRate), so greying it removes the
            // clickable-but-dead confusion.
            disabled={locked}
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
            // Disabled when locked: a read-only grid accumulates no drafts, so flush is a no-op.
            disabled={locked}
            title="Flush any pending edits and save now"
          >
            <Save className="h-4 w-4" />
            Save now
          </Button>
          {/* AMENDMENT C / C3: carry the ORIGINAL's rates + annotations into this revision sheet.
              Placed immediately after Save now (owner-directed) and filled EMERALD when it is
              actionable -- the row's loud-state convention (teal Lock, sky Freeze, amber override),
              and emerald already reads as "priced" in this screen. HIDDEN off a revision: with no
              original the action does not exist, so a disabled button would be a lie. The four
              states + their tooltip copy come from the pure carryButtonState. */}
          {carryState.kind !== "hidden" && (
            <Button
              size="sm"
              variant={carryState.kind === "ready" ? "default" : "outline"}
              className={cn(
                "gap-1.5",
                carryState.kind === "ready" &&
                  "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-800",
              )}
              disabled={carryState.kind !== "ready"}
              onClick={() => {
                // Flush pending rate drafts FIRST: the carry writes underneath the grid, and a
                // draft saved afterwards would silently overwrite a carried rate.
                gridRef.current?.flush();
                setCarryMsg(null);
                setCarryOpen(true);
              }}
              title={
                carryState.kind === "ready"
                  ? "Copy the original BoQ's rates and annotations into this sheet"
                  : carryState.reason
              }
            >
              <ArrowDownToLine className="h-4 w-4" />
              Carry rates from original
            </Button>
          )}
          </>
          )}
        </div>
      </div>

      {/* ── Lock banners ──────────────────────────────────────────────────────
          PRECEDENCE: the DELIBERATE lock (this slice) is the persistent, cross-user reason and
          DOMINATES the transient concurrency banners -- so a locked sheet shows the TEAL lock
          banner even if a takeover / holder reason is also true. Its TEAL + ShieldCheck styling
          is VISUALLY DISTINCT from the two amber concurrency banners ("someone else is editing").
          Then: mid-edit takeover > the load-time holder banner (editable===false). A STALE lock
          returns editable===true -> neither amber banner shows. SUPPRESSED for a grid-only sheet
          (no editing -> no lock; the lock toggle is also absent there). ALSO suppressed in read-only
          history mode -- the version ribbon's own banner is the read-only surface there (a historical
          payload reports editable=false, which would otherwise trip the holder banner). */}
      {isGridOnly || isViewingHistory ? null : isLocked ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 text-sm">
          <ShieldCheck className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" />
          <p className="text-teal-900 dark:text-teal-100 flex-1">
            This sheet is locked (read-only). Unlock it to make changes.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={handleToggleLock}
            disabled={lockToggling}
          >
            {lockToggling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5" />}
            Unlock
          </Button>
          <Button size="sm" variant="ghost" onClick={handleBack}>
            Go to hub
          </Button>
        </div>
      ) : takenOver ? (
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

          {/* ── CL-2: classify-sheet launcher. Opens the ClassifySheetDialog (engine + scope);
              shows a spinner + "Classifying..." while a run is in flight (classifyRunning, driven
              by the socket/poll). Disabled while loading/error or a run is already running. ── */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={pricedLoading || pricedError || classifyRunning || classificationFrozen}
            onClick={() => setClassifyOpen(true)}
            title={
              classificationFrozen
                ? "Unfreeze to re-classify."
                : "Run AI category classification over this sheet."
            }
          >
            {classifyRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Classifying…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Classify sheet
              </>
            )}
          </Button>

          {/* ── Freeze / Unfreeze classification. Banks a permanent truth snapshot + stamps effective
              categories into human_category_id + locks category editing (picker + re-classify), while
              PRICING stays live. Reads classification_frozen off get_priced_rows (NOT the pricing
              `locked` gate). Disabled while loading / classifying / uncommitted / toggling. ── */}
          <Button
            size="sm"
            variant={classificationFrozen ? "default" : "outline"}
            className="gap-1.5"
            disabled={
              pricedLoading || pricedError || classifyRunning || commitVersion === null || freezeToggling
            }
            onClick={classificationFrozen ? () => setUnfreezeConfirm(true) : handleFreezeClick}
            title={
              classificationFrozen
                ? "Classification is frozen. Click to unfreeze and edit categories."
                : "Freeze categories: bank a permanent snapshot and lock category editing."
            }
          >
            {freezeToggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Snowflake className="h-4 w-4" />
            )}
            {classificationFrozen ? "Unfreeze Classification" : "Freeze Classification"}
          </Button>
          {classificationFrozen && (
            <span className="text-xs text-muted-foreground">
              Frozen
              {frozenAt ? ` · ${formatDate(frozenAt)}` : ""}
              {frozenBy ? ` · ${frozenBy}` : ""}
            </span>
          )}

          {/* ── U1 rate-helper (DEV ONLY, guardrail G1): "Suggest rates". Sits after Freeze (owner
              ruling: classify -> freeze -> suggest). D8: consumes the SAME gate chain rate writes do
              -- locked / formulasComplete / categoryGateOpen -- REUSED, never re-derived; disabled
              with the reason surfaced. Synchronous in U1 (no modal/poller -- that arrives in U2). ── */}
          {RATE_HELPER_ENABLED && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={suggestRatesDisabled}
              onClick={runSuggestRates}
              title={suggestRatesReason ?? "Suggest rates for editable rows"}
            >
              <Sparkles className="h-4 w-4" />
              Suggest rates
            </Button>
          )}

          {/* ── CL-2: "show only needs-review" view filter (rows whose category verdict is an
              unresolved Needs-review). VIEW-ONLY, mirrors the Show-unpriced toggle. ── */}
          <Button
            size="sm"
            variant={showNeedsReview ? "default" : "outline"}
            className="gap-1.5"
            aria-pressed={showNeedsReview}
            onClick={() => setShowNeedsReview((o) => !o)}
            disabled={pricedLoading || pricedError || categoriesByExcelRow.size === 0}
            title={
              showNeedsReview
                ? "Showing only rows whose category needs a check. Click to show all rows."
                : "Show only rows whose category needs a check."
            }
          >
            <Filter className="h-4 w-4" />
            {/* CL-6: visible label only -- the state var showNeedsReview, the isNeedsReviewCategory
                predicate, and the backend "Needs review" routing literal are all UNCHANGED. */}
            {showNeedsReview ? "Check Category only" : "Check Category"}
          </Button>

          {/* ── Slice B (undo/redo): session history for RATE edits. Two icon buttons mirroring the
              collapse-all pattern, calling the grid via the imperative handle; disabled from the
              grid's onHistoryChange-fed {canUndo, canRedo} AND when the sheet is locked/read-only
              (the grid no-ops there anyway, so greying is honest). History clears on a sheet/version
              switch (the grid remounts). Shortcuts: Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y). ── */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={locked || !historyState.canUndo}
            aria-label="Undo the last rate edit"
            title="Undo (Ctrl+Z)"
            onClick={() => gridRef.current?.undo()}
          >
            <Undo2 className="h-4 w-4" />
            Undo
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={locked || !historyState.canRedo}
            aria-label="Redo the last undone rate edit"
            title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
            onClick={() => gridRef.current?.redo()}
          >
            <Redo2 className="h-4 w-4" />
            Redo
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

      {/* ── CL-2 (poll-driven): classify progress is a BLOCKING centered modal, dismissable only
          at a terminal state. The inline completion/error strips below persist AFTER the modal is
          closed (gated on !classifyModalOpen so they don't double up while the modal is open). ── */}
      <ClassifyProgressModal
        open={classifyModalOpen}
        running={classifyRunning}
        sheetName={(sheetName ?? "").trim()}
        progress={classifyProgress}
        summary={classifySummary}
        aiStatusByDiscipline={classifyAiStatusByDiscipline}
        onClose={() => {
          setClassifyModalOpen(false);
          setClassifyProgress(null);
        }}
      />
      {/* RM-3: the suggest-run modal + status poller (recovery on mount; 3s poll while running). */}
      {RATE_HELPER_ENABLED && boqId && sheetName && (
        <SuggestStatusPoller
          boq={boqId}
          sheetName={sheetName}
          running={suggestRunning}
          onStatus={onSuggestStatus}
        />
      )}
      {RATE_HELPER_ENABLED && (
        <RateSuggestProgressModal
          open={suggestModalOpen}
          running={suggestRunning}
          sheetName={(sheetName ?? "").trim()}
          progress={suggestProgress}
          summary={suggestSummary}
          onClose={() => {
            setSuggestModalOpen(false);
            setSuggestProgress(null);
          }}
        />
      )}
      {!classifyRunning && !classifyModalOpen && classifySummary && classifySummary.status === "error" && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex-1">
            <span className="font-medium">Classification could not complete.</span>
            <span className="mt-0.5 block opacity-90">
              The run failed{classifySummary.error_code ? ` (${classifySummary.error_code})` : ""} -- nothing
              was saved. Please try again; if the AI was on, check the AI settings/key.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setClassifySummary(null)}
            aria-label="Dismiss"
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {!classifyRunning && !classifyModalOpen && classifySummary && classifySummary.status !== "error" && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex-1">
            <span className="font-medium">
              {classifySummary.eligible_classified} of {classifySummary.total_in_range} classified,
              {" "}
              {classifySummary.needs_review} flagged for review
            </span>
            {skipRollupText(classifySummary.skipped_by_reason) && (
              <span className="mt-0.5 block text-emerald-700 dark:text-emerald-300">
                {skipRollupText(classifySummary.skipped_by_reason)}
              </span>
            )}
            {aiStatusWarning(classifyAiStatusByDiscipline) && (
              <span className="mt-0.5 block text-amber-700 dark:text-amber-300">
                {aiStatusWarning(classifyAiStatusByDiscipline)}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setClassifySummary(null)}
            aria-label="Dismiss"
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* HV-10: per-ran-discipline catalog fetchers + per-(ran UNION running) status pollers.
          Each renders no DOM; the number is dynamic yet hook-safe (one hook per instance). */}
      {ranDisciplines.map((d) => (
        <EngineCatalogFetcher key={`cat-${d}`} discipline={d} onLoaded={handleCatalogLoaded} />
      ))}
      {boqId && sheetName
        ? statusPollDisciplines.map((d) => (
            <ClassifyStatusPoller
              key={`status-${d}`}
              boq={boqId}
              sheetName={sheetName}
              discipline={d}
              running={runningDisciplines.includes(d)}
              onStatus={handleClassifyStatus}
            />
          ))
        : null}

      {/* CL-2: the classify-sheet launcher dialog (fetches engines + fires start_classify). */}
      <ClassifySheetDialog
        open={classifyOpen}
        boqId={boqId ?? ""}
        sheetName={sheetName ?? ""}
        onClose={() => setClassifyOpen(false)}
        onStarted={(launches) => {
          // HV-10: capture the launched disciplines so the pollers/filters accept their events.
          const next = addRunningDisciplines(
            runningDisciplinesRef.current,
            launches.map((l) => l.discipline),
          );
          runningDisciplinesRef.current = next;
          setRunningDisciplines(next);
          // HV-10b: a FRESH run set REPLACES the scope union with just this run set's scopes (the
          // reset-between-run-sets semantics); multiple engines in one launch fold via unionScopes
          // (whole-sheet dominates a mixed union). The completion summary is scoped to it.
          scopeUnionRef.current = unionScopes(launches.map((l) => l.scope));
          // HV-11: a fresh run set RESETS the per-discipline ai_status accumulation.
          aiStatusByDisciplineRef.current = {};
          setClassifyAiStatusByDiscipline({});
          setClassifyRunning(true);
          classifyRunningRef.current = true;
          setClassifyProgress(null);
          setClassifySummary(null);
          setClassifyModalOpen(true); // open the blocking progress modal for this run
        }}
      />

      {/* CL-3: the category verdict picker -- a Popover anchored to the clicked Category grid cell
          (page-owned open-state). currentId = the row's human pick, else its effective verdict.
          onSelect writes (or clears with "") + closes; onClose drops the open-state. */}
      <CategoryVerdictPicker
        open={!!pickerState}
        anchorEl={pickerState?.anchorEl ?? null}
        groups={buildEngineGroups(ranDisciplines, engineCatalogs)}
        currentId={
          pickerState
            ? categoriesByExcelRow.get(pickerState.excelRow)?.human_category_id ||
              categoriesByExcelRow.get(pickerState.excelRow)?.effective_category_id ||
              ""
            : ""
        }
        onSelect={handleVerdictSelect}
        onClose={() => setPickerState(null)}
      />

      {/* Freeze confirm -- warns when eligible rows have no category (they are skipped from the
          snapshot, not blocked). Plain confirm when everything is categorised. */}
      <AlertDialog open={!!freezeConfirm} onOpenChange={(o) => !o && setFreezeConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Freeze classification?</AlertDialogTitle>
            <AlertDialogDescription>
              {freezeConfirm &&
              (freezeConfirm.uncategorised_preambles > 0 ||
                freezeConfirm.uncategorised_line_items > 0) ? (
                <>
                  {freezeConfirm.uncategorised_preambles} preamble
                  {freezeConfirm.uncategorised_preambles === 1 ? "" : "s"} and{" "}
                  {freezeConfirm.uncategorised_line_items} line item
                  {freezeConfirm.uncategorised_line_items === 1 ? "" : "s"} don&apos;t have a
                  category. Freeze anyway?
                </>
              ) : (
                <>
                  This banks a permanent snapshot of the current categories and locks category
                  editing. Pricing stays editable. Freeze?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doFreeze}>Freeze</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unfreeze confirm -- verbatim owner copy. */}
      <AlertDialog open={unfreezeConfirm} onOpenChange={setUnfreezeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unfreeze classification?</AlertDialogTitle>
            <AlertDialogDescription>
              Unfreezing unlocks category editing on this sheet. The frozen snapshot stays banked
              permanently. If you re-classify, current human verdicts will not carry forward. Once
              your edits are done, freeze the classification again to bank the updated truth.
              Unfreeze?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doUnfreeze}>Unfreeze</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
        ) : isViewingHistory ? (
          <span>
            You are viewing an earlier committed version (read-only history). Switch back to
            &ldquo;Current (live)&rdquo; in the version selector above to make changes.
          </span>
        ) : (
          <span>
            Enter a rate in any rate cell. It auto-saves a second after you stop typing (or on
            Enter / click away / arrow-move) -- or press &ldquo;Save now&rdquo;. Amounts shown
            are qty x rate (display-only); priced cells are marked. Rates only are editable.
          </span>
        )}
      </div>

      {/* ── Slice 3e: override-on banner (loud, amber -- the override is a loaded gun). Suppressed
          in read-only history mode (the override is inert there -- the whole editor is read-only). */}
      {!isGridOnly && !isViewingHistory && override && (
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

      {/* ── CATEGORY GATE banner (Slice G3a) ─────────────────────────────────────
          Shown when the live blank count > 0 (mirrors the formula-banner conditions). Two
          owner-approved variants: LOCK (the gate is shut) vs OVERRIDE (an admin unlocked it anyway --
          the count STILL shows the blanks). It NAMES the existing "Check Category" toolbar control; it
          does NOT add a button and there is no click-to-jump (owner ruling). Amber-note styling,
          verbatim from the formula banner. */}
      {!isGridOnly && !locked && !pricedLoading && !pricedError && categoryBlankCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-100 flex-wrap">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
          {categoryGateOverride ? (
            <>
              <span>
                Category check overridden by {categoryOverrideBy ?? "an admin"}
                {categoryOverrideAt ? ` on ${formatDate(categoryOverrideAt)}` : ""}.{" "}
                {categoryBlankCount} row{categoryBlankCount === 1 ? "" : "s"} still{" "}
                {categoryBlankCount === 1 ? "has" : "have"} no category &mdash; rate editing is unlocked
                anyway.
              </span>
              {/* G3b: CLEAR control (admin-only, role-resolved). No confirmation -- clearing re-locks,
                  it fails safe. */}
              {showCategoryOverrideControl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={overrideSubmitting}
                  onClick={handleClearCategoryOverride}
                >
                  {overrideSubmitting ? "Removing…" : "Remove override"}
                </Button>
              )}
            </>
          ) : (
            <>
              <span>
                {categoryBlankCount} row{categoryBlankCount === 1 ? "" : "s"} still{" "}
                {categoryBlankCount === 1 ? "needs" : "need"} a category. Rate editing is locked until
                every line item and preamble has one. Use the Check Category filter to find them.
              </span>
              {/* G3b: SET control (admin-only, role-resolved). The reason popover IS the interaction --
                  no "are you sure" step (owner ruling); reason is OPTIONAL. */}
              {showCategoryOverrideControl && (
                <Popover open={overridePopoverOpen} onOpenChange={setOverridePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-6 px-2 text-xs">
                      Override the check
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 space-y-2 p-3">
                    <p className="text-xs font-medium text-foreground">Override the category check</p>
                    <p className="text-[11px] text-muted-foreground">
                      Unlocks rate editing despite blank categories. Reason is optional.
                    </p>
                    <Input
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      maxLength={CATEGORY_OVERRIDE_REASON_MAX_LEN}
                      placeholder="Reason (optional)"
                      className="h-8 text-xs"
                      disabled={overrideSubmitting}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">
                        {overrideReason.length}/{CATEGORY_OVERRIDE_REASON_MAX_LEN}
                      </span>
                      <Button
                        size="sm"
                        className="h-7 px-3 text-xs"
                        disabled={overrideSubmitting}
                        onClick={handleSetCategoryOverride}
                      >
                        {overrideSubmitting ? "Overriding…" : "Override"}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </>
          )}
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
      </div>
      {/* RM-3c item C: SLIM re-expand rail -- shown only when the full-screen top block is collapsed.
          One click (or Escape) re-expands; shows the truncated sheet name + a compact indicator for any
          BLOCKING banner (locked / taken-over / frozen / formula gate / uncategorised) so collapsing
          never hides state. Keyboard-focusable. */}
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
            <span className="max-w-[40vw] truncate">{sheetName?.trim() || "Sheet"}</span>
          </button>
          {collapsedBannerChips.length > 0 && (
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
              {collapsedBannerChips.map((c) => (
                <span
                  key={c}
                  className="flex shrink-0 items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {c}
                </span>
              ))}
            </div>
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
        {/* RM-3a/RM-3b: the rate-helper panel mount + the FULL-SCREEN flex chain.
            - EMBEDDED (feature on): the panel is ALWAYS mounted (panel-as-default), so this is a
              PERMANENT flex row -- grid (flex-1 min-w-0) beside the sticky panel; the page is widened.
            - FULL-SCREEN (expanded): these two wrappers MUST propagate the flex column (min-h-0 flex-1)
              so the grid container below actually BOUNDS to the viewport and becomes the internal
              scroller -- that is what makes the sticky header stay put (RM-3b item 3) and the native
              horizontal scrollbar sit at the viewport bottom (item 4). Without this the outer fixed
              wrapper scrolled instead and the header scrolled away.
            - RM-3c: full-screen's panel is now a PUSH panel INSIDE this row, so `#4` is a flex ROW
              [ grid column | push panel ] and `#3` is the grid COLUMN (min-w-0 flex-1, still a flex-col
              so the grid container bounds vertically via the row's stretched height). The grid narrows
              by exactly the panel width; the bounded scroller / sticky header / native H-scrollbar keep
              working at the reduced width. */}
        <div className={cn(embeddedPanel && "flex min-h-0 flex-1 items-start gap-3", expanded && "flex min-h-0 flex-1")}>
        <div className={cn(embeddedPanel && "min-w-0 flex-1", expanded && "flex min-h-0 flex-1 min-w-0 flex-col")}>
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
            // version-view: the key also carries the selected version so switching to/from a
            // read-only historical version cleanly remounts the grid (no stale drafts/scroll).
            key={`${sheetName}::${selectedVersion ?? "current"}`}
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
            // Slice A (clipboard): the batch write path for paste / cut / fill-down (ONE trailing
            // mutate). Withheld when locked -> paste/cut/fill no-op (copy still works, it is internal).
            onBatchWrite={locked ? undefined : handleBatchWrite}
            // Slice 4a: annotation saves gated on the SAME editability signal as rates --
            // withheld when locked/taken-over so the grid renders remarks/colors read-only.
            onSaveRemark={locked ? undefined : handleSaveRemark}
            onSaveColor={locked ? undefined : handleSaveColor}
            // Cluster B: the per-cell reconciliation choices drive the divergence cue + the
            // document-default; onSaveReconChoice is withheld when locked (cue renders a static
            // read-only pill, mirroring onSaveColor/onSaveRate).
            reconChoices={reconChoices}
            onSaveReconChoice={locked ? undefined : handleSaveReconChoice}
            // CL-2/CL-3: per-row category verdicts drive the Category column; categoryLabelById
            // supplies the display label; onCategoryClick opens the page-owned verdict picker on a
            // classified cell. Withheld when locked -> the cell renders display-only. All three are
            // reference-stable -> the row memo holds.
            categoriesByExcelRow={categoriesByExcelRow}
            // CL-6: sheet-has-run gate (= at least one category record exists) -- makes eligible
            // BLANK cells clickable + drives the amber "needs a category" fill. Same size>0 truth
            // that gates the Check-Category filter button below.
            hasRun={categoriesByExcelRow.size > 0}
            categoryLabelById={categoryLabelById}
            onCategoryClick={locked ? undefined : onCategoryClick}
            // U1 rate-helper (DEV): the per-row suggestion badges + the page-owned open callback.
            // Both are withheld when the flag is off (feature does not exist). onSuggestionBadgeClick
            // is a stable useCallback; rowSuggestionsByExcelRow changes only on a run / a "Use this
            // value" (like categoriesByExcelRow) -- never on keystroke, so the memo shield holds.
            rowSuggestionsByExcelRow={RATE_HELPER_ENABLED ? suggestionsByExcelRow : undefined}
            onSuggestionBadgeClick={RATE_HELPER_ENABLED ? handleSuggestionBadgeClick : undefined}
            // F3: the amount-column formula header label + builder. columnFormulas drives the
            // `f = ...` label; onSaveFormula is withheld when locked (header renders read-only).
            columnFormulas={columnFormulas}
            onSaveFormula={locked ? undefined : handleSaveFormula}
            onDirtyChange={handleDirtyChange}
            // Slice B (undo/redo): the grid surfaces {canUndo, canRedo}; the bottom-ribbon buttons
            // read it (the onDirtyChange precedent). The undo/redo ACTIONS ride the imperative handle.
            onHistoryChange={setHistoryState}
            override={override}
            // MANDATORY amount-formula gate (per-sheet): when false the grid renders ALL rate
            // cells read-only (ANDed OUTSIDE the override -- override can't bypass it). Default
            // TRUE for a trivially-complete sheet. onSaveFormula stays live so the holder can
            // declare formulas while rates are locked.
            formulasComplete={formulasComplete}
            // CATEGORY GATE (G3a, per-sheet): when false the grid renders ALL rate cells read-only,
            // ANDed OUTSIDE the override exactly like formulasComplete. Only the BOOLEAN is passed
            // (never the count) so a category pick that does not flip the gate re-renders no rows.
            categoryGateOpen={categoryGateOpen}
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
            // Frozen-left Slice 1: two-pane frozen-left + measure-at-freeze heights. Page-owned
            // per-sheet toggle; the grid measures + splits. Gated off for grid-only (this branch
            // is the non-grid-only PricingGrid; SheetDataGrid never receives it).
            frozen={frozen}
            virtualized={virtualized}
          />
        )}
        </div>
        {/* RM-3b: the EMBEDDED panel is ALWAYS mounted (panel-as-default) whenever the feature is on
            and we are not full-screen -- INSIDE the flex row so the page stays widened + the panel
            rides the viewport. It shows an empty-state card until a badge/sparkle selects a row; the
            selection (helperPanel/helperPanelCtx) is passed only once resolved. No close X in embedded. */}
        {embeddedPanel && (
          <RateHelperPanel
            variant="embedded"
            excelRow={helperPanelOpen ? helperPanel!.excelRow : undefined}
            col={helperPanelOpen ? helperPanel!.col : undefined}
            kind={helperPanelOpen ? helperPanel!.kind : undefined}
            ctx={helperPanelOpen ? helperPanelCtx! : undefined}
            helpers={helperList}
            onUse={handleUseSuggestion}
            onClose={() => setHelperPanel(null)}
          />
        )}
        {/* RM-3c: FULL-SCREEN PUSH panel -- INSIDE the flex row (a flex sibling of the grid column), so
            it occupies real layout width and the grid narrows by exactly the panel width. A left-edge
            drag handle resizes it (persisted). Rendered only on a selection (no panel-as-default in
            full-screen). Supersedes the RM-3a fixed overlay drawer. */}
        {helperPanelOpen && expanded && helperPanel && helperPanelCtx && (
          <RateHelperPanel
            variant="push"
            excelRow={helperPanel.excelRow}
            col={helperPanel.col}
            kind={helperPanel.kind}
            ctx={helperPanelCtx}
            helpers={helperList}
            onUse={handleUseSuggestion}
            onClose={() => setHelperPanel(null)}
          />
        )}
        </div>
        </div>
      )}
    </div>
  );
};

export default SheetPricingPage;
export { SheetPricingPage as Component };
