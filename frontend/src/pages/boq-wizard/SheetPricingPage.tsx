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
import { AlertTriangle, ArrowDownToLine, ArrowDownWideNarrow, ArrowLeft, ArrowUpNarrowWide, Calculator, Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, ChevronUp, ClipboardList, Filter, Loader2, Lock, Maximize2, Minimize2, Percent, Pin, PinOff, Redo2, RefreshCw, Save, Search, ShieldCheck, ShieldOff, Sigma, SlidersHorizontal, Snowflake, Sparkles, Undo2, Unlock, X } from "lucide-react";
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
  BcsRowRate,
  BcsRowSaveArgs,
  GetBcsStateResponse,
  GetSheetBcsRatesResponse,
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
// BCS-S2: the cost section's enable button + two-column confirmation card. The RULES live in the
// pure bcsColumns (which mirrors services/boq_bcs/sources.py); the page only orchestrates.
import { BcsColumnsDialog } from "./BcsColumnsDialog";
import {
  bcsChipLabel,
  bcsCostEntryReason,
  bcsLiveRateKinds,
  bcsSetupReason,
  bcsToggleState,
  type BcsRateKind,
} from "./bcsColumns";
// PE-SPIN-1: the sheet fetch's honest load state (loading / error / stale / empty / ready).
import {
  activePricingLoadState,
  bcsRatesLoadState,
  carryPlanLoadState,
  gridLoadState,
  withStaleNote,
} from "./pricingLoadState";
// BCS-S4: the margin view's ORDER, ROW SET and SECTION labels -- a pure leaf, unit-tested
// (ADR-0010 F4: the page renders, the rule lives in a module a test can reach).
import {
  buildMarginOrder,
  buildSectionLabels,
  flipMarginSortDir,
  marginViewRows,
  type MarginSortDir,
} from "./marginView";
// BCS-S3a: a module-level stable empty -- a fresh [] per render would churn a grid prop and kill
// the V0 React.memo shield (frontend/CLAUDE.md: "any new grid prop must stay identity-stable").
const EMPTY_BCS_KINDS: BcsRateKind[] = [];
// BCS-S4: the margin view's section labels when the view is closed. Module-level so the closed
// state hands PricingGrid the SAME Map reference on every render -- the grid is React.memo'd with
// React's default shallow comparison, and a fresh `new Map()` here would defeat it outright.
const EMPTY_SECTION_LABELS: Map<number, string> = new Map();
// BCS-S4: what the grid gets for `childrenByParent` in the margin view. A collapse chevron on a
// flat, margin-ordered list would offer to fold away rows that are not underneath it -- so the
// grid is told, truthfully for that view, that nothing has children. Module-level for the same
// memo-shield reason as above.
const EMPTY_CHILDREN_BY_PARENT: Map<number, number[]> = new Map();
import { CopyForwardDialog, summarizeCopyForward } from "./CopyForwardDialog";
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
  // GET-capable endpoint, SWR-managed. mutate() refetches after a rate save -> the priced_*
  // markers re-derive authoritatively.
  //
  // PE-SPIN-1: this read's OWN `error` is destructured and used. It used to be dropped, and the
  // page inferred its state from the payload alone (`data === undefined` -> loading,
  // `data === null` -> error). SWR never sets `data` to null on failure, so the error branch was
  // unreachable and a failed load span forever -- see pricingLoadState.ts for the full account.
  const { data: pricedData, error: pricedFetchError, mutate } = useFrappeGetCall<{ message: GetPricedRowsResponse }>(
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
  //
  // PE-SPIN-1-fix (SURVIVOR 2): this read's OWN `error` is destructured and used. It used to take
  // `data` alone, and fed `loading: carryPlanData === undefined` into carryButtonState -- so a
  // failed plan fetch left `loading` true forever and pinned the carry button on "Checking what
  // can be carried from the original…" for the rest of the session. Same defect as the sheet
  // fetch's permanent spinner, on a different control.
  const isRevisionSheet = boq?.origin === "revision" && !!boq?.source_boq;
  const { data: carryPlanData, error: carryPlanFetchError } = useFrappeGetCall<{ message: GetCrossBoqCarryPlanResponse }>(
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

  // ── BCS-S2: the cost section's per-sheet setup state ──────────────────────────
  // Pinned to liveCommitVersion, NOT the browsed version: BCS is configured per sheet+version and
  // the LIVE version is the only one worth setting up (a re-commit mints a fresh BoQ Sheet row, so
  // BCS correctly starts off + unconfirmed there). Disabled until the version is known (swrKey
  // gotcha: `undefined` enables, `null` disables -- never `{enabled}`). sheet_name VERBATIM (#152).
  //
  // BCS-S2a (finding F1): this read's OWN `error` and `isLoading` are destructured and used.
  // S2 took only { data, mutate } and fed the PRICED fetch's flags to the button instead, so a
  // failed get_bcs_state produced no reason at all -- the button stayed live and, because a
  // missing payload looked exactly like bcs_enabled = 0, an enabled and confirmed sheet rendered
  // as OFF with its chip gone and its amber banner suppressed. These are SWR's real signals --
  // which is what makes the error branch reachable at all.
  //
  // ⚠️ UPDATED AT PE-SPIN-1: this note used to contrast these signals with `pricedLoading` /
  // `pricedError`, "derived from data === undefined / null, this page's older convention". That
  // convention is GONE -- it was the same defect one layer up (a failed sheet fetch span forever)
  // and the sheet read now goes through `activePricingLoadState` off its own real `error` too.
  const {
    data: bcsData,
    error: bcsFetchError,
    isLoading: bcsFetchLoading,
    mutate: mutateBcs,
  } = useFrappeGetCall<{ message: GetBcsStateResponse }>(
    "nirmaan_stack.api.boq.wizard.bcs.get_bcs_state",
    {
      boq_name: boqId ?? "",
      sheet_name: sheetName ?? "",
      committed_version: liveCommitVersion ?? 0,
    },
    boqId && sheetName && liveCommitVersion !== null ? undefined : null,
  );

  // ── BCS-S3a: the stored COST rows for this sheet+version ──────────────────────
  // Pinned to liveCommitVersion for the same reason the setup fetch is: cost is entered on the
  // current version only (the cost block is not rendered while browsing history), so a second
  // version-following fetch would buy nothing and churn the grid's props on every version click.
  //
  // BCS-S4 (SURVIVOR 3): this read's OWN `error` is destructured and used. S3a took only
  // { data, mutate } and degraded the payload via `?? []`, so a FAILED read emptied the rate map
  // and a fully costed sheet rendered as entirely uncosted -- every box blank, every Total Amount
  // and % Profit blank, and still editable. That is the same class of confident falsehood
  // PE-SPIN-1 closed on three other fetches, and worse than all of them: a spinner is visibly
  // unfinished, this was finished-looking and wrong. See pricingLoadState.BCS_RATES_STATES.
  const {
    data: bcsRatesData,
    error: bcsRatesFetchError,
    mutate: mutateBcsRates,
  } = useFrappeGetCall<{
    message: GetSheetBcsRatesResponse;
  }>(
    "nirmaan_stack.api.boq.wizard.bcs.get_sheet_bcs_rates",
    {
      boq_name: boqId ?? "",
      sheet_name: sheetName ?? "", // VERBATIM (#152)
      committed_version: liveCommitVersion ?? 0,
    },
    boqId && sheetName && liveCommitVersion !== null ? undefined : null,
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
  // The CURRENT version's verdicts, keyed by excel_row. Reference-stable (per fetch / per
  // override), rebuilt only when catData or the overrides change (never on a keystroke), so the
  // row memo is never defeated by a per-render Map. Overrides merge LAST (optimistic wins).
  //
  // WBC-S8 -- THE "live" IN THE NAME IS LOAD-BEARING. This map is what the blank-category COUNT,
  // the category GATE, and every write path (the pick handler's optimistic seed, the picker's
  // current id) read, and they must stay welded to the CURRENT version because that is the version
  // they govern writes to. DISPLAY does NOT read this in history mode -- it reads
  // activeCategoriesByExcelRow below. Do not collapse the two back together.
  const liveCategoriesByExcelRow = useMemo(() => {
    const m = new Map<number, SheetCategoryRow>();
    // HV-10: adapt each server-resolved row onto the grid's SheetCategoryRow shape so PricingGrid
    // + deriveVerdictState + isMasterSetBlank render UNCHANGED. Telemetry (conflict, votes,
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
  // PE-SPIN-1: its own `error` + `mutate`, for the same reason the live read above takes them --
  // while browsing history THIS is the fetch on screen, so it is the one whose failure must show
  // and the one a Retry must re-run.
  const {
    data: historyData,
    error: historyFetchError,
    mutate: mutateHistory,
  } = useFrappeGetCall<{ message: GetPricedRowsResponse }>(
    "nirmaan_stack.api.boq.wizard.pricing.get_version_priced_rows",
    {
      boq_name: boqId ?? "",
      sheet_name: sheetName ?? "", // VERBATIM (#152)
      committed_version: selectedVersion ?? 0,
    },
    isViewingHistory ? undefined : null,
  );

  // WBC-S8: the SELECTED EARLIER version's OWN category verdicts (get_version_sheet_categories --
  // the resolved read's version twin, exactly as get_version_priced_rows above is get_priced_rows'
  // twin). Disabled unless viewing history, so the live sheet costs one fetch as before.
  //
  // THE DEFECT THIS FIXES: the live read has no version parameter, so history mode showed the
  // CURRENT version's verdicts against an OLDER version's rows. The SWR key is left undefined so
  // it is derived from the params -- committed_version is IN it, which is what makes a version
  // switch refetch. Its absence was half the bug: the old read did not even re-run.
  const { data: histCatData } = useFrappeGetCall<{
    message: GetSheetCategoriesResolvedResponse;
  }>(
    "nirmaan_stack.api.boq.wizard.classify.get_version_sheet_categories",
    {
      boq: boqId ?? "",
      sheet_name: sheetName ?? "", // VERBATIM (#152)
      committed_version: selectedVersion ?? 0,
    },
    isViewingHistory ? undefined : null,
  );
  // The viewed version's map. NO optimistic overrides folded in: a verdict cannot be picked in
  // history mode (onCategoryClick is withheld when `locked`, which isViewingHistory ORs into), and
  // an override made against the LIVE version must never paint over a historical view.
  const viewedCategoriesByExcelRow = useMemo(() => {
    const m = new Map<number, SheetCategoryRow>();
    (histCatData?.message?.categories ?? []).forEach((c: ResolvedSheetCategory) =>
      m.set(c.excel_row, resolvedToSheetCategoryRow(c)),
    );
    return m;
  }, [histCatData]);
  // The DISPLAY map -- joins the same isViewingHistory funnel activeMessage does. Both branches are
  // memoized values, so this stays reference-stable and the PricingGrid row memo holds.
  //
  // DELIBERATELY NOT the gate's input. Display follows the version being VIEWED; the blank count
  // and the category gate keep reading liveCategoriesByExcelRow, because they govern writes to the
  // CURRENT version and a write gate computed from history would be a worse defect than the one
  // this fixes. In history mode the page therefore holds two category reads at once -- intended.
  const activeCategoriesByExcelRow = isViewingHistory
    ? viewedCategoriesByExcelRow
    : liveCategoriesByExcelRow;

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
  // BCS-S3a -- WHY A GRID-ONLY SHEET HAS NO COST COLUMNS, recorded because the outcome was
  // always right but the CAUSE had never been written down, and a future reader could have
  // changed it either way with equal confidence.
  //
  // THE CAUSE IS THE ZERO NODES, not a rendering choice. BCS identity is per committed ROW and
  // `save_row_bcs_rates` resolves that row through `_resolve_committed_cell`, storing the
  // resolved node as its re-resolvable pointer. A grid-only sheet commits a faithful CELL GRID
  // and NO nodes at all (the line above is the same fact stated for pricing), so there is no
  // per-line address for a cost to hang on -- every write would refuse at gate 1. Per-line cost
  // on such a sheet is not withheld; it does not EXIST to be withheld.
  //
  // That it also renders through SheetDataGrid rather than PricingGrid is a CONSEQUENCE, not
  // the reason. Do not "add BCS to the faithful grid" on the strength of the rendering fork
  // alone: that would need the sheet to commit nodes first, which is a different decision
  // entirely (and the reference sheets it covers -- Make Lists, general specs -- have no
  // quantities to multiply, so Total Amount would have nothing to compute either).
  // commit_version comes from get_priced_rows (it carries it for BOTH dispositions -- a
  // grid-only sheet still has a current committed BoQ Sheet). The faithful-grid fetch is
  // disabled until it's a known grid-only sheet WITH a version.
  // In history mode the faithful grid (grid-only sheets) must read the SELECTED version; else the
  // live current version. Both are version-parameterized reads, so this just swaps the version arg.
  const commitVersionForGrid = isViewingHistory
    ? selectedVersion
    : pricedData?.message?.commit_version ?? null;
  //
  // PE-SPIN-1-fix (SURVIVOR 1): this read's OWN `error` + `mutate` are destructured and used. It
  // used to take `data` alone, and its consumer below read the retired convention VERBATIM --
  // `isInitLoading={gridData === undefined}` / `initError={gridData === null ? ... : null}`. SWR
  // never sets `data` to null on failure, so the error branch was unreachable and a failed load
  // span forever on a grid-only sheet (general specs, Make Lists) -- the SAME defect PE-SPIN-1
  // fixed for the sheet fetch, still live on this one because that slice surveyed by gating site
  // rather than by fetch. `mutate` is what makes the failure's Retry able to re-run it.
  const {
    data: gridData,
    error: gridFetchError,
    mutate: mutateGrid,
  } = useFrappeGetCall<{ message: CommittedSheetGridResponse }>(
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

  // ── BCS-S2: the cost section's enable + column confirmation ───────────────────────
  // Two writes, both re-read through mutateBcs() (the server's is_ready is authoritative and is
  // never re-derived client-side). Enabling alone does NOT permit a cost write -- the two columns
  // must also be confirmed -- which is exactly what the amber banner explains.
  const { call: setBcsEnabledCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.bcs.set_bcs_enabled",
  );
  const { call: confirmBcsColumnsCall } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.bcs.confirm_bcs_columns",
  );
  // BCS-S3a: the ONE cost write. ⚠️ WHOLE-ROW -- see gatherBcsRowRates.
  const { call: saveRowBcsRates } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.bcs.save_row_bcs_rates",
  );
  // The confirmation card's open-state is PAGE-owned (mirroring pickerState) and the card is
  // mounted ONCE at page level -- never inside a row loop. In-flight guard for the enable POST.
  const [bcsCardOpen, setBcsCardOpen] = useState(false);
  const [bcsToggling, setBcsToggling] = useState(false);

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
  // ── BCS-S4: the MARGIN VIEW ───────────────────────────────────────────────────
  // A separate FLAT, line-items-only presentation of this sheet ordered by % Profit. The owner
  // chose it over sorting the tree in place (2026-08-02): re-ordering an N-deep hierarchy by
  // margin leaves collapse hiding rows from scattered places and indentation implying nesting
  // under a parent nowhere near. See marginView.ts.
  const [marginViewOpen, setMarginViewOpen] = useState(false);
  // DEFAULT ASCENDING = worst margin first. The view's job is to find the rows that are losing
  // money or making nothing; opening on the best margins would put the answer at the far end.
  const [marginSortDir, setMarginSortDir] = useState<MarginSortDir>("asc");
  // ⚠️ THE ORDER IS A SNAPSHOT, HELD IN STATE, AND THAT IS THE WHOLE SAFETY PROPERTY.
  // It is recomputed at exactly two moments -- opening the view, and a % Profit header click --
  // and NEVER derived during a render. Inside PricingGrid the cursor (`activeCell`) is
  // ARRAY-INDEX addressed into the `rows` prop, and clipboard multi-row selection is a contiguous
  // RANGE over the same indices, so an order that moved while someone typed would slide a
  // different row under the cursor and land the next keystroke on it. Values stay live (the rows
  // themselves are re-read every fetch); only the POSITIONS are frozen between sorts.
  const [marginOrder, setMarginOrder] = useState<number[] | null>(null);
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
    // BCS-S4: the margin view + its captured order are per-sheet. The ORDER especially -- it is a
    // list of the previous sheet's row_index values, and applying it to another sheet's rows would
    // silently reorder them by numbers that mean nothing there.
    setMarginViewOpen(false);
    setMarginOrder(null);
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
    // BCS-S2: the confirmation card is per-sheet -- it carries the OLD sheet's descriptors +
    // stored picks, so leaving it open across a tab switch would offer another sheet's columns.
    setBcsCardOpen(false);
    setBcsToggling(false);
    // NOTE: the G3b override popover has its OWN [sheetName] reset, inside the self-contained
    // G3b block below (that block must stay deletable in one cut -- owner commitment).
  }, [sheetName]);

  // BCS-S2a (finding F10): the confirmation card must also close on a VERSION switch, not just a
  // sheet switch. The card is fed `columnDescriptors`, which come from the ACTIVE payload -- and
  // that flips to the HISTORY version's descriptors the moment someone browses back -- while its
  // Save still targets `liveCommitVersion`. Left open across the switch it would therefore offer
  // an older version's columns and then have the save refused by the live version's descriptor
  // check. Closing it is the whole fix: the card re-hydrates from the stored confirmation on
  // every open, so nothing is lost.
  //
  // Deliberately a SEPARATE effect from the [sheetName] reset above: a version switch must not
  // drag that block's other resets (search, collapse, filters, classify state) with it.
  // `bcsToggling` is left alone on purpose -- it guards an in-flight POST against
  // liveCommitVersion, which a version switch does not change.
  //
  // ── BCS-S5: THE MARGIN VIEW BELONGS HERE TOO ──────────────────────────────────
  // BCS-S4 shipped the margin reset on the SHEET axis only, and its record then claimed the
  // version axis needed no condition because "the toggle is simply disabled there". The toggle is
  // disabled only for OPENING (`!marginViewOpen && !bcsColumnsVisible`) -- an ALREADY-OPEN view
  // rode straight into history, where the cost columns and % Profit are not rendered at all, and
  // `marginViewRows` then applied the LIVE version's `row_index` snapshot to the HISTORY version's
  // rows. That is exactly the hazard the [sheetName] reset names one axis over: an order is a list
  // of row_index values belonging to ONE (sheet, version), and applying it anywhere else reorders
  // rows by numbers that mean nothing there. Blast radius is narrow -- history is read-only -- but
  // a silently mis-ordered review list is the kind of wrong nobody can see.
  useEffect(() => {
    setBcsCardOpen(false);
    setMarginViewOpen(false);
    setMarginOrder(null);
  }, [selectedVersion]);

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
  // ── PE-SPIN-1: what this page may honestly claim about its own data ──────────────────────────
  // Tracks the ACTIVE source (the history fetch while in history mode), as before -- but from
  // SWR's REAL signals (`data` + `error`) rather than from the payload alone. The retired rule was
  //
  //     pricedLoading = (data === undefined);  pricedError = (data === null)
  //
  // and SWR never sets `data` to null on failure: it leaves it undefined on a first load and
  // RETAINS the last good value on a failed revalidation, reporting the failure on `error`, which
  // nothing here read. So a genuine network failure or a 500 left `pricedError` false and
  // `pricedLoading` true FOREVER -- a permanent spinner, no error, and a user report of "the page
  // is stuck". The whole rule (and why "the server returned nothing" is treated as a failure
  // rather than as an empty sheet) lives in pricingLoadState.ts, where it is unit-tested; a
  // derivation inline here was structurally untestable, which is why it survived unexamined.
  //
  // The returned object is one of five SHARED singletons, so it is reference-stable per status --
  // it never contributes a fresh object to a downstream memo.
  const sheetLoad = activePricingLoadState({
    viewingHistory: isViewingHistory,
    live: { data: pricedData, error: pricedFetchError },
    history: { data: historyData, error: historyFetchError },
  });
  // Re-run the fetch that is actually on screen. Retry from the error branch + the stale strip.
  const handleRetryLoad = () => {
    void (isViewingHistory ? mutateHistory() : mutate());
  };
  // PE-SPIN-1-fix (SURVIVOR 1): the faithful committed grid's own load state, from the SAME rule.
  // Only a grid-only sheet renders this; off one the fetch is disabled (no data, no error), which
  // reads as `loading` and is never shown, because the whole grid-only branch is gated on isGridOnly.
  const gridLoad = gridLoadState({ data: gridData, error: gridFetchError });
  const handleRetryGrid = () => {
    void mutateGrid();
  };
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

  // ── BCS-S2: the cost section's enable button + confirmation card ──────────────────
  // `is_ready` is the SERVER's one readiness predicate (enabled AND both columns confirmed) --
  // read, never re-derived, so the button/banner cannot disagree with what a cost write will do.
  const bcsState = bcsData?.message ?? null;
  // BCS-S2a (finding F1): THREE states, not two. `bcsToggleState` keeps "we have no payload"
  // apart from "BCS is off" -- S2 collapsed them into one pixel via `bcs_enabled === 1`, which
  // is what made a failed read display an enabled sheet as OFF. Never re-derive `bcs_enabled`
  // at a render site; read this. Slice S3's cost cells must make the same distinction (an
  // unknown state must not present as an empty, editable cost cell).
  const bcsToggle = bcsToggleState({
    fetchFailed: !!bcsFetchError,
    enabled: bcsState?.bcs_enabled ?? null,
  });
  const bcsReady = bcsState?.is_ready ?? false;
  const bcsQtySource = bcsState?.bcs_qty_source ?? null;
  const bcsAmountSource = bcsState?.bcs_amount_source ?? null;
  const bcsChip = bcsChipLabel(bcsQtySource, bcsAmountSource);
  // Greyed-with-a-reason, never hidden: BCS always EXISTS as an action on a committed sheet, so a
  // disabled button is honest here (unlike "Carry rates from original", which is hidden off a
  // revision precisely because the action does not exist there).
  //
  // The two fetches are named apart deliberately -- passing the sheet's flags where the BCS
  // state's belong is exactly the S2 defect this closes.
  const bcsReason = bcsSetupReason({
    sheetLoading: sheetLoad.isLoading,
    sheetError: sheetLoad.isFailed,
    committedVersion: liveCommitVersion,
    viewingHistory: isViewingHistory,
    sheetLocked: isLocked,
    bcsLoading: bcsFetchLoading,
    bcsError: !!bcsFetchError,
  });
  // BCS is ON but its two columns are not confirmed -> cost entry stays refused server-side
  // (_guard_bcs_ready). The amber banner + the collapsed-rail chip both key on this.
  // Keyed on the KNOWN "on" state: an unknown BCS state must not assert "BCS needs columns",
  // because we have not been told that it does.
  const bcsNeedsColumns = bcsToggle === "on" && !bcsReady;

  // Click when OFF: turn BCS on AND open the card in one act (owner design) -- the two columns are
  // what makes it usable, so asking for them immediately is the honest flow. Click when ON: just
  // reopen the card (turning BCS off lives in the card's footer, never on this button, so the
  // ribbon control is never a destructive toggle).
  const handleBcsButtonClick = async () => {
    if (bcsReason !== null || liveCommitVersion === null) return;
    // BCS-S2a: gate the WRITE on the known state too, not only on the reason chain above. An
    // unknown state must never fall through to the enable POST -- that is how S2 could have
    // re-enabled a sheet nobody had established was off.
    if (bcsToggle !== "off") {
      if (bcsToggle === "on") setBcsCardOpen(true);
      return;
    }
    setSaveError(null);
    setBcsToggling(true);
    try {
      await setBcsEnabledCall({
        boq_name: boqId,
        sheet_name: decodedSheetName, // VERBATIM (#152)
        committed_version: liveCommitVersion,
        enabled: 1,
      });
      await mutateBcs();
      setBcsCardOpen(true);
    } catch (e) {
      setSaveError(getFrappeError(e) || "Could not turn BCS on. Please try again.");
    } finally {
      setBcsToggling(false);
    }
  };

  // The card's Save. Both picks are sent as JSON lists of column letters; the server re-validates
  // (it is the authority) and a refusal is surfaced IN the card by rethrowing to its catch.
  const handleBcsConfirm = async (qtyCols: string[], amountCols: string[]) => {
    if (liveCommitVersion === null) return;
    await confirmBcsColumnsCall({
      boq_name: boqId,
      sheet_name: decodedSheetName, // VERBATIM (#152)
      committed_version: liveCommitVersion,
      qty_cols: JSON.stringify(qtyCols),
      amount_cols: JSON.stringify(amountCols),
    });
    await mutateBcs();
  };

  // The card's "Turn BCS off". NON-DESTRUCTIVE, which is why there is no confirm step: the two
  // confirmations are preserved (re-enabling does not force a re-pick) and no BoQ Row BCS Rate is
  // ever deleted. Readiness simply goes false meanwhile.
  const handleBcsDisable = async () => {
    if (liveCommitVersion === null) return;
    await setBcsEnabledCall({
      boq_name: boqId,
      sheet_name: decodedSheetName, // VERBATIM (#152)
      committed_version: liveCommitVersion,
      enabled: 0,
    });
    await mutateBcs();
  };

  // ── BCS-S3a: the cost block's grid inputs ─────────────────────────────────────
  //
  // VISIBILITY and EDITABILITY are two different questions, answered separately on purpose. The
  // columns SHOW whenever BCS is set up on the version being viewed -- a locked sheet still
  // displays what it costs, read-only. Whether a box can be TYPED IN is the full gate, and it is
  // expressed the house way: by withholding `onSaveBcsRates`, never by a second per-cell flag.
  //
  // An UNKNOWN BCS state hides the block (bcsToggle !== "on"), which is the S2a rule applied one
  // layer further out: absence of knowledge must not render as an empty, editable cost cell.
  //
  // ── BCS-S4: the SAME rule, applied to the COSTS themselves ────────────────────
  // S3a stopped at the SETUP fetch. The RATES fetch degraded via `?? []`, and an empty rate map is
  // not silence -- it is the sentence "nothing on this sheet has been costed", rendered in every
  // cost box on a sheet that may be fully costed.
  //
  // ⚠️ THE CHOICE, STATED: on a failed/empty costs read the cost block is WITHHELD ENTIRELY, not
  // shown read-only. Read-only would still leave a row of empty cost cells and two empty computed
  // columns on screen, and "empty" is exactly the falsehood -- a reader cannot tell a cell that is
  // blank because nothing was costed from one that is blank because we failed to read it. Absence
  // of knowledge must render as nothing plus a stated reason, never as a blank the eye reads as
  // zero. The banner below carries the reason and a Retry.
  //
  // `isUsable` (not `!isFailed`) is deliberate: it is FALSE while the first read is in flight too,
  // so the block never flashes empty-then-fills. `stale` IS usable -- the last good costs stay on
  // screen and editable, flagged by the amber strip, the same trade the sheet and grid fetches make.
  const bcsBlockConfigured =
    bcsToggle === "on" && bcsReady && !isViewingHistory && liveCommitVersion !== null;
  const bcsRatesLoad = bcsRatesLoadState({ data: bcsRatesData, error: bcsRatesFetchError });
  const bcsColumnsVisible = bcsBlockConfigured && bcsRatesLoad.isUsable;
  /** BCS is set up on this version, but its stored costs could not be read. */
  const bcsCostsUnreadable = bcsBlockConfigured && bcsRatesLoad.isFailed;
  const handleRetryBcsRates = () => {
    void mutateBcsRates();
  };
  // ── BCS-S5: AN OPEN MARGIN VIEW MUST NOT OUTLIVE THE COSTS IT IS BUILT ON ─────
  // The [selectedVersion] reset above closes the version axis. This closes every OTHER way the
  // cost block can go away underneath an open view -- BCS switched off, the confirmation cleared,
  // the sheet lock/version changing, or the costs read failing on a revalidate. In all of them the
  // view keeps rendering with its two cost columns and % Profit GONE, which leaves a flat list
  // ordered by a number that is no longer on screen, while the direction button still claims
  // "Lowest first" and a click would silently re-sort it into document order (every margin now
  // reads blank, and blanks hold document order in both directions).
  //
  // Guarded on the FALSE edge only: this effect also fires when the costs come BACK, and closing
  // the view then would be a second, unrelated behaviour. `bcsColumnsVisible` is a plain boolean
  // derived above, so the dependency is stable and this cannot loop.
  useEffect(() => {
    if (bcsColumnsVisible) return;
    setMarginViewOpen(false);
    setMarginOrder(null);
  }, [bcsColumnsVisible]);
  // Which boxes, from the SHEET's own rate columns (the pure rule; the halves win over a
  // combined rate mapped beside them so Total Amount can never double-count).
  const bcsKinds = useMemo(
    () => (bcsColumnsVisible ? bcsLiveRateKinds(columnDescriptors) : EMPTY_BCS_KINDS),
    [bcsColumnsVisible, columnDescriptors],
  );
  // The stored cost rows, keyed by Excel row -- reference-stable per fetch (the V0 memo shield).
  //
  // ⚠️ BCS-S4: built ONLY from a USABLE payload. The `?? []` that used to stand alone here is the
  // whole defect -- it turns "we do not know this sheet's costs" into "this sheet has no costs".
  // The empty map is still the shape returned on a failed read, but `bcsColumnsVisible` is false
  // in that state so it never reaches a rendered cell; the explicit gate is what stops a later
  // reader reintroducing the lie by relaxing one condition and not the other.
  //
  // ⚠️ BCS-S5 -- WHY THE `?? []` BELOW STAYS, having been questioned in the S4 review. It looks
  // neutralised by the `isUsable` guard one line above it, and for the FAILED read it is: that
  // path returns early. It is NOT dead on the SUCCESSFUL one. `loadStatus` decides content on
  // `data.message != null` ALONE, so a payload of `{message: {}}` -- an envelope with no `rows`
  // key at all -- is classified `ready`, reaches this loop, and `for (const r of undefined)`
  // THROWS, taking the whole page down. So this is genuine null-safety on a live path, not
  // leftover defensiveness, and removing it would trade a wrong number for a blank screen.
  //
  // The real gap is one level down and is NOT fixed here: `hasContent` cannot tell an empty
  // envelope from a real answer, so `{message: {}}` renders as a confidently uncosted sheet --
  // the same class of lie S4 closed for the FAILED read, surviving on the malformed-success one.
  // Closing it means tightening `loadStatus`/`hasContent` in `pricingLoadState.ts`, which is NOT
  // in this slice's scope; recorded rather than reached for.
  const bcsRatesByExcelRow = useMemo(() => {
    const m = new Map<number, BcsRowRate>();
    if (!bcsRatesLoad.isUsable) return m;
    for (const r of bcsRatesData?.message?.rows ?? []) m.set(r.excel_row, r);
    return m;
  }, [bcsRatesData, bcsRatesLoad]);
  // ── BCS-S5: the Summary panel's cost axis ─────────────────────────────────────
  // The SAME four inputs the grid's cost block reads, handed to the rollup so the panel can show
  // BCS Total Amount / Tendered Total Amount / % Profit per BoQ SECTION.
  //
  // Gated on `bcsColumnsVisible`, so in version history (or behind a failed costs read) the panel
  // shows no cost columns rather than a screenful of blanks that would read as "this sheet costs
  // nothing". That is what this gate buys, and it is the reason it is here.
  //
  // ⚠️ CORRECTED AT BCS-S7 -- IT IS NOT THE SAME CONDITION AS THE GRID'S. This said "the identical
  // condition that decides whether the grid shows a cost column at all. So the panel gains cost
  // columns exactly when the grid has them." The grid's block has a SECOND term this one does not:
  // `PricingGrid` renders `bcsHeaderCells` only when `bcsKinds.length > 0`, and `bcsLiveRateKinds`
  // returns `[]` for a sheet that maps NO rate column (bcsColumns.ts, the "no rate column at all
  // cannot do BCS" ruling). `bcs_is_ready` never inspects rate columns, so such a sheet can be
  // BCS-enabled with both sources confirmed. On it the grid shows NO cost block while this panel
  // shows its three -- all blank. The two surfaces are ALIGNED IN PRACTICE only because a sheet
  // with no rate column is not a sheet anyone prices.
  //
  // NOT "fixed" here, deliberately: ANDing `bcsKinds.length > 0` in would be a render-gate change,
  // and this repo has no DOM test environment (`vitest.config.ts`), so it would ship verified by
  // nothing. The owner declined the browser sweep that could have checked it. A comment that
  // describes what the code does is fully verifiable by reading; a gate change is not. If this is
  // ever revisited, the honest check is a live A/B on a rate-column-less sheet.
  //
  // MEMOISED because it is a `rollupByParent` argument: a fresh object each render would re-walk
  // every row's tree on every keystroke. Each input is already stable per fetch.
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
  // The gate, in save_row_bcs_rates' OWN order (NOT the client rate gate -- BCS deliberately
  // skips the formula, priceability and category gates).
  const bcsCostReason = bcsCostEntryReason({
    sheetLoading: sheetLoad.isLoading,
    sheetError: sheetLoad.isFailed,
    committedVersion: liveCommitVersion,
    viewingHistory: isViewingHistory,
    sheetLocked: isLocked,
    editorLocked: takenOver || editable === false,
    bcsToggle,
    bcsReady,
  });
  const bcsWritable = bcsCostReason === null;

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
    const cur = liveCategoriesByExcelRow.get(excelRow);
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

  // ── BCS-S3a: save ONE row's cost rates (save_row_bcs_rates) ────────────────────
  // Mirrors handleSaveRate (in-flight count, takeover detection, refetch, re-throw so the grid
  // KEEPS the optimistic draft) with two deliberate differences:
  //
  //   1. ⚠️ IT IS A WHOLE-ROW WRITE. `args.rates` always carries all three stored fields --
  //      the endpoint coerces anything absent to 0.0, so a partial payload would silently zero
  //      the siblings. The grid gathers them; this page never assembles a rate itself.
  //   2. It refetches ONLY `mutateBcsRates` -- not the whole priced-rows read. A cost is a
  //      separate layer: it changes no client-facing marker, no amount and no flag, so pulling
  //      get_priced_rows would churn `rows` and re-render the entire grid for nothing.
  const handleSaveBcsRates = useCallback(
    async (args: BcsRowSaveArgs) => {
      if (liveCommitVersion === null) {
        setSaveError("This sheet has no committed version to cost.");
        throw new Error("no committed version");
      }
      setSaveError(null);
      setInFlight((n) => n + 1);
      try {
        await saveRowBcsRates({
          boq_name: boqId, // VERBATIM
          sheet_name: sheetName, // VERBATIM (#152)
          excel_row: args.excelRow,
          committed_version: liveCommitVersion,
          supply_rate: args.rates.supply_rate,
          install_rate: args.rates.install_rate,
          combined_rate: args.rates.combined_rate,
          description: args.description,
        });
        await mutateBcsRates();
        setLastSavedAt(new Date());
      } catch (e: unknown) {
        const msg = getFrappeError(e);
        if (isTakeoverError(msg)) setTakenOver(true);
        else setSaveError(msg || "Could not save the cost. Please try again.");
        throw e; // let the grid keep the optimistic draft
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [liveCommitVersion, boqId, sheetName, saveRowBcsRates, mutateBcsRates],
  );

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
    let bcsTouched = false; // BCS-S3a: refetch the cost layer only when the gesture touched it
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
          } else if (w.kind === "bcs") {
            // BCS-S3a: ONE call per ROW (the grid folded the gesture's cost cells), carrying
            // all three stored fields -- see handleSaveBcsRates on why a partial payload zeroes.
            //
            // ⚠️ `liveCommitVersion`, NOT this function's `commitVersion` -- the two halves of ONE
            // write must not read the version from two places. EVERY other BCS path is pinned to
            // the live version (`get_bcs_state`, `get_sheet_bcs_rates`, `handleSaveBcsRates`),
            // because cost is entered on the current version only. `commitVersion` follows the
            // version being VIEWED. They are equal wherever a cost write can actually occur
            // (`bcsColumnsVisible` and `locked` both exclude history mode, so no cost cell even
            // renders there) -- which is why S3a's divergence was inert, not why it was right.
            if (liveCommitVersion === null) {
              throw new Error("This sheet has no committed version to cost.");
            }
            await saveRowBcsRates({
              boq_name: boqId, // VERBATIM
              sheet_name: sheetName, // VERBATIM (#152)
              excel_row: w.args.excelRow,
              committed_version: liveCommitVersion,
              supply_rate: w.args.rates.supply_rate,
              install_rate: w.args.rates.install_rate,
              combined_rate: w.args.rates.combined_rate,
              description: w.args.description,
            });
            bcsTouched = true;
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
      // ⚠️ THE COST REFETCH IS NOT CHAINED BEHIND THE RATE ONE. Written as two bare `await`s, a
      // rejected `mutate()` skipped `mutateBcsRates()` entirely, so a gesture whose cost POSTs had
      // all LANDED left `bcsRatesByExcelRow` stale -- and because `save_row_bcs_rates` is a
      // WHOLE-ROW SNAPSHOT WRITE, the next inline edit on a row with no prior stored record gathers
      // that stale map and writes 0.0 over the pasted sibling. The cost layer is its OWN read, so
      // its refresh must not depend on another read succeeding. Either rejection still propagates
      // (the batch settles REJECTED -> `batchDraftsToDrop` KEEPS the cost drafts, so the user's
      // pasted numbers stay on screen and the next gather reads them, not the stale map).
      try {
        await mutate(); // ONE trailing refetch -- markers / amounts re-derive once
      } finally {
        // BCS-S3a: and ONE for the cost layer, only if the gesture wrote any (it lives in its own
        // read, so a rate-only paste must not pay for it).
        if (bcsTouched) await mutateBcsRates();
      }
      if (failMsg) setSaveError(`Saved ${written} of ${writes.length}. ${failMsg}`);
      else setLastSavedAt(new Date());
      setInFlight((n) => n - 1);
    }
    return { written, failed };
  }, [commitVersion, liveCommitVersion, boqId, sheetName, override, saveCellPrice, saveRowRemark, saveRowBcsRates, mutate, mutateBcsRates]);

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
  // predicate -- never a second emptiness test). Iterate the ROWS array, NOT liveCategoriesByExcelRow: a
  // never-classified row is ABSENT from the map (Recon 5/6) but MUST be counted -- keying off the map
  // would miss it (the fail-open the backend already guards). useMemo'd on the SAME deps as
  // liveCategoriesByExcelRow (which folds catData + the optimistic overrides) plus rows, so it recomputes
  // only on a fetch / pick / clear, never per keystroke. At load this equals the server's
  // eligible_blank_category_count (parity, verified in the cert).
  const categoryBlankCount = useMemo(
    () => countMasterSetBlankRows(rows, liveCategoriesByExcelRow),
    [rows, liveCategoriesByExcelRow],
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
    // BCS-S2: BCS on but unconfirmed has a VISIBLE amber banner and refuses every cost write, so
    // it is exactly the kind of state this rail exists to keep from being hidden by a collapse.
    if (!locked && bcsNeedsColumns) chips.push("BCS needs columns");
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
    bcsNeedsColumns,
  ]);

  // ── U1 rate-helper (DEV): D8 gate REUSE + run / badge-click / use handlers. The enable chain is
  // EXACTLY what a rate write consumes -- !locked (locked => onSaveRate withheld), formulasComplete,
  // categoryGateOpen -- read straight from the existing vars, never re-derived. Disabled surfaces
  // the first failing reason (title). Synchronous: the run builds suggestionsByExcelRow in place. ──
  // PE-SPIN-1: loading and failed are separate reasons. This site used to answer "Loading..." to
  // both, so a sheet that had FAILED to load explained its dead button as a load still in
  // progress -- the page-level spinner lie, repeated in a tooltip.
  const suggestRatesReason: string | null =
    sheetLoad.isLoading
      ? "Loading..."
      : sheetLoad.isFailed
        ? "This sheet could not be loaded"
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
    let map = buildSuggestions(rows, columnDescriptors, override, liveCategoriesByExcelRow, helperList);
    for (const pair of usedPairsRef.current) {
      const [er, col] = pair.split("::");
      map = markSuggestionUsed(map, Number(er), col);
    }
    setSuggestionsByExcelRow(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestRun, pricingSheetHelper, rows, columnDescriptors, override, liveCategoriesByExcelRow, helperList, suggestEventsKey]);

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
        category_id: liveCategoriesByExcelRow.get(excelRow)?.effective_category_id ?? "",
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
    [helperPanel, extractionByRow, boqId, sheetName, liveCategoriesByExcelRow, suggestRun, recordSuggestEventCall, mutateSuggestEvents],
  );

  // The open panel's row context, built from the SAME page data buildSuggestions used.
  const helperPanelCtx = useMemo(() => {
    if (!helperPanel) return null;
    const row = rows.find((r) => r.source_row_number === helperPanel.excelRow);
    if (!row) return null;
    const rateKinds = rateKindsOf(columnDescriptors.filter(isRateDescriptor));
    return buildRowContext(row, rateKinds, liveCategoriesByExcelRow.get(helperPanel.excelRow));
  }, [helperPanel, rows, columnDescriptors, liveCategoriesByExcelRow]);
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
  // PE-SPIN-1-fix (SURVIVOR 2): the plan fetch's load state, from the SAME rule as the sheet and
  // the grid. `isRevisionSheet &&` stays on `loading` for the same reason it always was there --
  // off a revision the fetch is disabled, so it has no data and no error, which honestly reads as
  // `loading`; carryButtonState returns `hidden` first in that case, but the guard keeps the input
  // truthful rather than relying on that precedence.
  const carryPlanLoad = carryPlanLoadState({
    data: carryPlanData,
    error: carryPlanFetchError,
  });
  const carryState = carryButtonState({
    isRevisionSheet,
    loading: isRevisionSheet && carryPlanLoad.isLoading,
    locked,
    formulasComplete,
    sheet: carryPlanSheet,
  });
  // ⚠️ WHY THE TOOLTIP IS OVERRIDDEN HERE RATHER THAN INSIDE carryButtonState. Feeding an honest
  // `loading` is only half the fix: with `loading` false and no plan in hand, carryButtonState
  // falls through to its `nothing` reason -- "Nothing left to carry from the original." -- whose
  // own comment calls it "not a transient state". That would trade an eternal "checking…" for a
  // confident permanent falsehood, which is worse: a user told there is nothing to carry stops
  // looking. carryButtonState lives in CrossBoqCarryDialog.tsx, which is OUT OF SCOPE for this
  // slice, so the honest wording is applied at the one place that renders it. If that file is ever
  // opened, the right home for this is an `error` input on the pure helper beside `loading`.
  const carryDisabledReason =
    isRevisionSheet && carryPlanLoad.isFailed
      ? carryPlanLoad.message
      : carryState.kind === "disabled"
        ? carryState.reason
        : null;
  // ── BCS-S4: the state that was BUILT AND NEVER SHOWN ──────────────────────────
  // `CARRY_PLAN_STATES.stale` shipped at PE-SPIN-1-fix and nothing read `carryPlanLoad.isStale`.
  // It is reachable and it is the quiet case: a failed REVALIDATION keeps `data.message`
  // populated, so `isFailed` is false, the button stays ENABLED, and it offers to carry from a
  // plan of unknown age with no indication whatever -- while the fix that produced the state was
  // explicitly about a page whose failure behaviour must not differ by which fetch broke.
  //
  // The sheet and the grid each got an amber STRIP for this case. The carry button has no strip;
  // its only surface is the tooltip, which is why `withStaleNote` composes the note onto whatever
  // the button was already going to say rather than replacing it. Render it or delete it -- this
  // is rendering it.
  //
  // The `hidden` arm is spelled out rather than folded into a `!== "ready"` else, because
  // `CarryButtonState.hidden` carries no `reason` -- the old inline version type-checked only
  // because the JSX `carryState.kind !== "hidden" &&` guard narrowed it in the same expression,
  // and that guard does not reach up here.
  const carryBaseTitle =
    carryState.kind === "ready"
      ? "Copy the original BoQ's rates and annotations into this sheet"
      : carryState.kind === "disabled"
        ? carryDisabledReason ?? carryState.reason
        : null;
  const carryTitle = withStaleNote(carryBaseTitle, carryPlanLoad);
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
  // BCS-S4: collapse does NOT apply in the margin view. A collapsed section in the tree must not
  // silently remove its line items from a flat margin review -- that would under-report exactly
  // the rows someone opened the view to find, and invisibly, because a flat list gives no clue
  // that a parent is folded somewhere. The `collapsed` SET is preserved, so closing the view
  // restores the tree exactly as it was.
  const collapseActive = collapsed.size > 0 && !marginViewOpen;

  // The view-filter predicate (show-unpriced + row-type), WITHOUT collapse -- shared by the
  // search universe (R3: search ignores collapse) and folded into displayRows below.
  const passesViewFilter = (r: PricedRow) =>
    (!showOnlyUnpriced ||
      (isPriceableLine(r, columnDescriptors) && !isFullyPriced(r, columnDescriptors))) &&
    // Slice G2e: the "Check Category" filter keeps rows in the MASTER SET whose category cell is
    // EMPTY -- the SAME shared predicate the grid's amber fill uses (isMasterSetBlank), so the
    // filter shows EXACTLY what amber shows (owner ruling; it now surfaces never-classified eligible
    // rows the old isNeedsReviewCategory missed). VIEW-ONLY -- never touches counts / Summary / feed.
    // WBC-S8: reads the DISPLAYED version's map, the SAME one the grid's amber fill now reads --
    // the filter and the fill must never disagree about which version they are describing.
    (!showNeedsReview || isMasterSetBlank(r, activeCategoriesByExcelRow.get(r.source_row_number))) &&
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
  const treeDisplayRows = useMemo(
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
      activeCategoriesByExcelRow,
      columnDescriptors,
      collapsed,
      byRowIndex,
    ],
  );

  // ── BCS-S4: the margin view's row set ─────────────────────────────────────────
  // ANOTHER DERIVATION AT THE SAME SEAM `displayRows` already is: a VIEW-ONLY transform of `rows`
  // handed to the grid. Nothing about row identity, the save paths or the grid's geometry changes
  // -- only which rows it is given and in what order, exactly as for the filters and collapse.
  //
  // The view FILTERS still compose (they are row predicates, and "show unpriced + worst margin
  // first" is a sensible pair). COLLAPSE does not and is switched off above, not applied here --
  // `treeDisplayRows` is therefore filter-only while this view is open, which is why it can be
  // taken as the input directly.
  //
  // The ORDER comes from state, never from a derivation here -- see `marginOrder`.
  const marginDisplayRows = useMemo(
    () => (marginViewOpen && marginOrder ? marginViewRows(treeDisplayRows, marginOrder) : null),
    [marginViewOpen, marginOrder, treeDisplayRows],
  );
  const displayRows = marginDisplayRows ?? treeDisplayRows;

  // Each row's section, for the margin view's context line. Built over the FULL `rows` (the
  // ancestors a line item's section comes from are exactly the rows the flat view drops) and
  // memoized on them, so it is reference-stable per fetch -- a grid-level Map, never a per-row
  // prop. EMPTY outside the view: the tree shows a row's section by POSITION, so repeating it in
  // the cell would be noise there.
  const sectionByRowIndex = useMemo(
    () => (marginViewOpen ? buildSectionLabels(rows) : EMPTY_SECTION_LABELS),
    [marginViewOpen, rows],
  );

  // ── The TWO moments a sort is allowed: opening the view, and a % Profit header click ──
  // Both take a fresh reading of every row's margin FROM THE GRID -- which is where the unsaved
  // drafts live, so a cost typed a second ago is in the sort -- then freeze the result. Neither
  // runs from a render, an effect or a keystroke.
  //
  // Refs, not deps: `handleToggleMarginSort` is a PricingGrid PROP and the grid is React.memo'd
  // with React's DEFAULT shallow comparison, so a callback that changed identity when `rows` or
  // `marginSortDir` changed would defeat the whole shield (V0/T2). Syncing both through refs keeps
  // it stable for the life of the page while still reading current values.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const marginSortDirRef = useRef(marginSortDir);
  marginSortDirRef.current = marginSortDir;
  // `sortMarginView` is re-created each render; the stable callback below reaches the latest one
  // through this ref (the undo/redo/applyRate precedent inside the grid).
  const sortMarginViewRef = useRef<(dir: MarginSortDir) => void>(() => {});
  const sortMarginView = (dir: MarginSortDir) => {
    const margins = gridRef.current?.computeMargins(rowsRef.current) ?? new Map<number, number | null>();
    setMarginOrder(
      buildMarginOrder(rowsRef.current, (r) => margins.get(r.row_index) ?? null, dir),
    );
  };
  const handleToggleMarginView = () => {
    if (marginViewOpen) {
      setMarginViewOpen(false);
      return;
    }
    sortMarginView(marginSortDir); // sort ON OPEN
    setMarginViewOpen(true);
  };
  const handleToggleMarginSort = useCallback(() => {
    // Read-then-set, never a side effect inside a state updater (an updater may run twice).
    const next = flipMarginSortDir(marginSortDirRef.current);
    setMarginSortDir(next);
    sortMarginViewRef.current(next); // sort ON HEADER CLICK
  }, []);
  sortMarginViewRef.current = sortMarginView;

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
            // WBC-S3a: the line was hand-rolled here and reported RATES only, so a categories-only
            // copy read "Copied 0 rates into the current version." -- true, and an under-report of
            // work that did happen. It now goes through the pure `summarizeCopyForward`, which is
            // `summarizeSheetCarry`'s multi-axis branch in this surface's voice (ADR-0010 F4: the
            // page renders, the rule lives in a unit-tested module).
            setCopyForwardMsg(summarizeCopyForward(summary));
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
            disabled={lockToggling || !sheetLoad.isUsable || commitVersion === null || isViewingHistory}
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
            disabled={!sheetLoad.isUsable || rows.length === 0}
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
            disabled={!sheetLoad.isUsable || rows.length === 0}
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
            disabled={!sheetLoad.isUsable || rows.length === 0}
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
            disabled={!sheetLoad.isUsable}
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
              // BCS-S4: the SAME text as before, now with the carry fetch's STALE note appended
              // when the last plan check failed over a retained plan (withStaleNote is a no-op
              // otherwise, so the healthy and hard-failed tooltips are byte-identical to before).
              title={carryTitle ?? undefined}
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
            disabled={!sheetLoad.isUsable || pricedCount.total === 0}
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
          {/* ── BCS-S4: the MARGIN VIEW toggle + its direction control ──────────────
              A separate FLAT, line-items-only view ordered by % Profit. Disabled without the cost
              columns, because % Profit is one of them: with no margins to order by, the view would
              be a flat list sorted by nothing. The direction button appears only while the view is
              on and does the SAME thing as clicking the % Profit header. ── */}
          <Button
            size="sm"
            variant={marginViewOpen ? "default" : "outline"}
            className="gap-1.5"
            aria-pressed={marginViewOpen}
            disabled={!sheetLoad.isUsable || (!marginViewOpen && !bcsColumnsVisible)}
            onClick={handleToggleMarginView}
            title={
              marginViewOpen
                ? "Showing line items only, ordered by % Profit. Click to return to the sheet."
                : bcsColumnsVisible
                  ? "Review margins: every line item on one flat list, ordered by % Profit, each with its section."
                  : "Margins need the BCS cost columns — turn BCS on and confirm its two columns first."
            }
          >
            <Percent className="h-4 w-4" />
            Margin view
          </Button>
          {marginViewOpen && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={handleToggleMarginSort}
              title="Reverse the order. Rows with no % Profit yet stay at the end either way."
            >
              {marginSortDir === "asc" ? (
                <ArrowUpNarrowWide className="h-4 w-4" />
              ) : (
                <ArrowDownWideNarrow className="h-4 w-4" />
              )}
              {marginSortDir === "asc" ? "Lowest first" : "Highest first"}
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            // BCS-S4: nothing to collapse in the flat margin view -- a live control that silently
            // did nothing would be the same kind of lie as the rest of this slice.
            disabled={!sheetLoad.isUsable || childrenByParent.size === 0 || marginViewOpen}
            aria-label={collapsed.size === 0 ? "Collapse all rows" : "Expand all rows"}
            title={
              marginViewOpen
                ? "The margin view is a flat list — there is no hierarchy to collapse."
                : childrenByParent.size === 0
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
            disabled={!sheetLoad.isUsable || classifyRunning || classificationFrozen}
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
              !sheetLoad.isUsable || classifyRunning || commitVersion === null || freezeToggling
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

          {/* ── BCS-S2: the cost section's enable button. NO NEW COLOUR -- it goes SOLID when on,
              exactly like Freeze Classification beside it (teal is the sheet lock, sky is
              Freeze-columns, emerald is priced/succeeded, red is error, amber is attention; a
              sixth meaning would cost more than it buys). Off -> click turns BCS on AND opens the
              confirmation card. On -> click reopens the card; turning BCS off lives in the card's
              footer, so this control is never a destructive toggle. Greyed with the reason in the
              title -- BCS always exists as an action here, so hiding it would be the lie. ── */}
          {/* BCS-S2a (finding F1): THREE states, and the button must never present UNKNOWN as
              OFF -- S2 did, which is how a confirmed sheet showed as off with its chip gone.
              `aria-pressed` is OMITTED (not false) when unknown, because a toggle must not
              claim a state nobody told it.

              WHAT ACTUALLY SEPARATES THEM, corrected at BCS-S2c. The earlier note said UNKNOWN
              "never borrows the OFF look", which overstates it: unknown and off share
              `variant="outline"`, and in one branch they share the calculator glyph too. The
              real and sufficient separator is that OFF IS CLICKABLE AND UNKNOWN IS NOT --

                off      outline + calculator, ENABLED, title invites the click;
                unknown  outline, DISABLED, title says which thing we are waiting on
                         (spinner while loading, warning glyph when the read failed,
                         plain calculator when there is simply no payload yet).

              That holds on every reachable path, and it holds by CONSTRUCTION rather than by
              matching branches: `bcsToggleState` returns "unknown" only when the payload is
              absent or the read failed, and each of those cases also produces a `bcsReason`,
              which is what disables the button. The fetch and the reason chain gate on the SAME
              `liveCommitVersion`, so a disabled swrKey cannot leave an enabled button with no
              payload behind it. ⚠️ S3 INHERITS THIS: hang cost cells off `bcsToggle` and keep
              the guarantee at the same seam -- "unknown" is carried by DISABLED-ness, so an S3
              cost cell that renders unknown as an ordinary empty editable cell breaks it even
              though it changed no colour. Do not read the glyph as the distinction. */}
          <Button
            size="sm"
            variant={bcsToggle === "on" ? "default" : "outline"}
            className="gap-1.5"
            aria-pressed={bcsToggle === "unknown" ? undefined : bcsToggle === "on"}
            disabled={bcsReason !== null || bcsToggling}
            onClick={handleBcsButtonClick}
            title={
              bcsReason ??
              (bcsToggle === "on"
                ? "BCS cost section is on. Click to review the Total Quantity and Amount columns."
                : "Turn on the BCS cost section and choose the Total Quantity and Amount columns.")
            }
          >
            {bcsToggling || bcsFetchLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : bcsFetchError ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <Calculator className="h-4 w-4" />
            )}
            BCS
          </Button>
          {/* Confirmed -> a small clickable chip showing the chosen columns, mirroring the
              "Frozen · date · by" chip beside it. Clicking it reopens the card. It needs a
              payload to have arrived at all, so an unknown state shows nothing rather than a
              guess -- incomplete, but never wrong. */}
          {bcsToggle === "on" && bcsReady && bcsChip && (
            <button
              type="button"
              onClick={() => setBcsCardOpen(true)}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              title="Change which columns BCS reads the quantity and amount from."
            >
              {bcsChip}
            </button>
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
            // WBC-S8: enabled off the DISPLAYED version -- the same size>0 truth as hasRun, so the
            // button and what it would filter always describe the same version.
            disabled={!sheetLoad.isUsable || activeCategoriesByExcelRow.size === 0}
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
                disabled={!sheetLoad.isUsable}
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
                  disabled={!sheetLoad.isUsable}
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
            ? liveCategoriesByExcelRow.get(pickerState.excelRow)?.human_category_id ||
              liveCategoriesByExcelRow.get(pickerState.excelRow)?.effective_category_id ||
              ""
            : ""
        }
        onSelect={handleVerdictSelect}
        onClose={() => setPickerState(null)}
      />

      {/* BCS-S2: the two-column confirmation card. Mounted ONCE at page level (never inside a row
          loop) with page-owned open-state, mirroring CategoryVerdictPicker above. It is fed the
          COMMITTED sheet's descriptors -- the same set _committed_descriptors validates against --
          so the columns it offers and the columns the server accepts are one list. */}
      <BcsColumnsDialog
        open={bcsCardOpen}
        sheetLabel={decodedSheetName.trim() || decodedSheetName}
        descriptors={columnDescriptors}
        qtySource={bcsQtySource}
        amountSource={bcsAmountSource}
        onClose={() => setBcsCardOpen(false)}
        onSave={handleBcsConfirm}
        onDisable={handleBcsDisable}
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
      {!isGridOnly && !locked && sheetLoad.isUsable && !formulasComplete && (
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
      {!isGridOnly && !locked && sheetLoad.isUsable && categoryBlankCount > 0 && (
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

      {/* ── BCS SETUP banner (Slice BCS-S2) ──────────────────────────────────────
          Shown when BCS is ON but its two columns are not confirmed -- the state in which every
          cost write is refused server-side (_guard_bcs_ready). Same conditions as the formula and
          category banners above, and the SAME amber-note markup (there is no shared Banner
          component in this file -- every banner is copied markup, and drift here would be
          visible). Per the category-gate precedent it NAMES the control and adds no jump button;
          the BCS button in the bottom ribbon is the one way in. */}
      {!isGridOnly && !locked && sheetLoad.isUsable && bcsNeedsColumns && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-100 flex-wrap">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
          <span>
            BCS is on, but it still needs to know which columns hold the Total Quantity and the
            Amount charged to the client. Cost entry stays locked until both are confirmed — use
            the BCS button to choose them.
          </span>
        </div>
      )}

      {/* ── BCS COSTS UNREADABLE (slice BCS-S4) ─────────────────────────────────
          The visible half of survivor 3. BCS is set up on this version, so the cost block SHOULD
          be here -- and it is not, because we could not read what this sheet costs.

          ⚠️ THIS BANNER IS THE WHOLE POINT OF WITHHOLDING THE BLOCK. Hiding the columns silently
          would swap one lie for another ("this sheet has no BCS"); the columns are absent AND the
          screen says why, which is the only combination that leaves the reader with a true picture.
          Destructive styling, not amber: an amber note reads as an advisory, and "you cannot see
          this sheet's costs right now" is not advisory. */}
      {!isGridOnly && bcsCostsUnreadable && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {bcsRatesLoad.message}
          </p>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={handleRetryBcsRates}>
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Try again
          </Button>
        </div>
      )}

      {/* ── BCS COSTS STALE (slice BCS-S4) ──────────────────────────────────────
          A failed REFRESH over costs we already hold. The block stays -- blanking a live costing
          session over one transient blip is its own harm, the same trade the sheet and grid
          fetches make -- but it must not claim to be current. Amber here, because the data IS
          usable and the note IS advisory; that is exactly the distinction the banner above is not. */}
      {!isGridOnly && bcsBlockConfigured && bcsRatesLoad.isStale && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-100 flex-wrap">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
          <span className="flex-1">{bcsRatesLoad.message}</span>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={handleRetryBcsRates}>
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Retry
          </Button>
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
      {!isGridOnly && summaryOpen && sheetLoad.isUsable && (
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

      {/* ── Slice 4a/4b-A/4b-ACKNOWLEDGE: unified review-list strip ──────────────
          Opened ABOVE the grid (mirrors the Summary panel mount). ONE feed: 4a remarks +
          the 4b-A computed flags (needs-rate / qty-anomaly / broken / not-yet). Each entry
          click-jumps to its row via the grid's scrollToRow handle, and carries a per-entry
          "Looks OK" dismiss (4b-ACKNOWLEDGE) that HIDES it from the active view (toggle
          "Show dismissed" to reveal + restore). The default view is ACTIVE-only. */}
      {!isGridOnly && reviewOpen && sheetLoad.isUsable && (
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
      {/* PE-SPIN-1: three honest outcomes where there used to be two, one of which could not be
          reached. A spinner now means a load genuinely IN PROGRESS; a failure says so and offers
          a Retry instead of spinning forever; and a payload whose latest refresh failed still
          renders (destroying a live editing session over one transient blip is its own harm) but
          says plainly that it may be out of date. `sheetLoad.message` carries the wording -- the
          three cases are worded apart on purpose, because "the network failed" and "this sheet
          may not be committed" send a user to different places. */}
      {sheetLoad.isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {sheetLoad.isFailed && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {sheetLoad.message}
          </p>
          <Button variant="outline" size="sm" onClick={handleRetryLoad}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Try again
          </Button>
        </div>
      )}

      {sheetLoad.isStale && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{sheetLoad.message}</span>
          <Button variant="outline" size="sm" onClick={handleRetryLoad}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      )}

      {/* ── Render fork: grid-only -> faithful read-only grid; else the pricing grid.
          We wait for pricedData (it carries commit_version, which the faithful-grid fetch
          needs) before either render. Slice 4c: the grid SLOT takes flex-1 min-h-0 when
          expanded (the root is flex-col) so the grid fills the freed full-screen height; the
          grid's own container relaxes its rem-cap (its `expanded` prop). Embedded -> no class
          (the grid keeps its own viewport-rem cap, byte-for-byte the prior behaviour). */}
      {sheetLoad.isUsable && (
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
          <>
          {/* PE-SPIN-1-fix (SURVIVOR 1): the grid's stale strip, the same shape the sheet fetch
              got at PE-SPIN-1 -- a retained grid still renders (a transient blip should not blank
              a reference sheet someone is reading) but it must not claim to be current. Rendered
              here rather than inside SheetDataGrid so that component's props are untouched: it
              still takes exactly `isInitLoading` + `initError`, now fed honest values. */}
          {gridLoad.isStale && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="flex-1">{gridLoad.message}</span>
              <Button variant="outline" size="sm" onClick={handleRetryGrid}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          )}
          <SheetDataGrid
            // Faithful committed grid (general specs) -- READ-ONLY reference, all rows at
            // once (pagination stubbed). Reuses SheetDataGrid as-is; falls back to raw Excel
            // column letters when the config maps are empty (a general-specs sheet has none).
            rows={gridData?.message?.rows ?? []}
            hasMore={false}
            // PE-SPIN-1-fix (SURVIVOR 1): the honest pair. These two props used to be
            // `gridData === undefined` and `gridData === null` -- the retired convention, whose
            // error branch SWR can never reach, so a failed grid load span forever. SheetDataGrid
            // renders loading BEFORE error, which is why isInitLoading must go false on a failure:
            // a spinner would otherwise still win and swallow the message.
            isInitLoading={gridLoad.isLoading}
            initError={gridLoad.isFailed ? gridLoad.message : null}
            isLoadingMore={false}
            loadMoreError={null}
            onLoadMore={() => {}}
            columnRoleMap={gridData?.message?.column_role_map ?? {}}
            headerRow={gridData?.message?.header_row ?? null}
            headerRowCount={(gridData?.message?.header_row_count ?? 1) as 1 | 2}
            areaList={gridData?.message?.area_dimensions ?? []}
            expanded={expanded} // Slice 4c: relax the height cap in full-screen
          />
          </>
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
            // WBC-S8: the DISPLAY map -- the version being VIEWED, not always the current one.
            // This prop is the Category column, and feeding it the live map was the reported
            // defect: an older version rendered the CURRENT version's verdicts against its rows.
            categoriesByExcelRow={activeCategoriesByExcelRow}
            // CL-6: sheet-has-run gate (= at least one category record exists) -- makes eligible
            // BLANK cells clickable + drives the amber "needs a category" fill. Same size>0 truth
            // that gates the Check-Category filter button below. Reads the DISPLAYED version, so
            // a version with no classification run at all shows no clickable cells.
            hasRun={activeCategoriesByExcelRow.size > 0}
            categoryLabelById={categoryLabelById}
            onCategoryClick={locked ? undefined : onCategoryClick}
            // U1 rate-helper (DEV): the per-row suggestion badges + the page-owned open callback.
            // Both are withheld when the flag is off (feature does not exist). onSuggestionBadgeClick
            // is a stable useCallback; rowSuggestionsByExcelRow changes only on a run / a "Use this
            // value" (like liveCategoriesByExcelRow) -- never on keystroke, so the memo shield holds.
            rowSuggestionsByExcelRow={RATE_HELPER_ENABLED ? suggestionsByExcelRow : undefined}
            onSuggestionBadgeClick={RATE_HELPER_ENABLED ? handleSuggestionBadgeClick : undefined}
            // F3: the amount-column formula header label + builder. columnFormulas drives the
            // `f = ...` label; onSaveFormula is withheld when locked (header renders read-only).
            columnFormulas={columnFormulas}
            onSaveFormula={locked ? undefined : handleSaveFormula}
            // ── BCS-S3a: the cost block. `bcsKinds` EMPTY (the default) removes it entirely and
            //    every colIndex reverts to its pre-S3a value, so a sheet without BCS is unchanged.
            //    NOTE the gating is NOT `locked ? undefined : ...` like its neighbours: BCS runs
            //    save_row_bcs_rates' OWN four gates (bcsCostEntryReason), which deliberately skip
            //    the formula, priceability and category gates -- reusing `locked` here would be
            //    close but would miss the two BCS-specific conditions. Every prop is useMemo'd /
            //    useCallback'd or a plain scalar, so the V0 grid memo shield holds.
            bcsKinds={bcsKinds}
            bcsRatesByExcelRow={bcsRatesByExcelRow}
            bcsQtySource={bcsQtySource}
            // BCS-S3b: the Amount side of the SAME confirmation the card already stores -- it
            // fills the Tendered Total Amount column and is % Profit's denominator. No new
            // fetch and no new state: `bcsAmountSource` has been read off `get_bcs_state` since
            // S2 (it is what `bcsChipLabel` names in the chip), and it is reference-stable
            // between refetches, which is what keeps the PricingGrid memo shield intact.
            bcsAmountSource={bcsAmountSource}
            onSaveBcsRates={bcsWritable ? handleSaveBcsRates : undefined}
            bcsReadOnlyReason={bcsCostReason}
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
            // BCS-S4: no chevrons in the flat margin view (see EMPTY_CHILDREN_BY_PARENT). Both
            // branches are stable references, so the memo shield is untouched.
            childrenByParent={marginViewOpen ? EMPTY_CHILDREN_BY_PARENT : childrenByParent}
            onToggleCollapse={toggleCollapse}
            onRevealRow={revealRow}
            // Frozen-left Slice 1: two-pane frozen-left + measure-at-freeze heights. Page-owned
            // per-sheet toggle; the grid measures + splits. Gated off for grid-only (this branch
            // is the non-grid-only PricingGrid; SheetDataGrid never receives it).
            frozen={frozen}
            virtualized={virtualized}
            // ── BCS-S4: the margin view. `rows` above is ALREADY the flat, ordered set (the page
            //    owns the order; the grid never sorts). These four only tell the grid to stop
            //    making tree CLAIMS about it -- flatten the indent, show the section instead, and
            //    turn the % Profit header into the sort control. All four are identity-stable:
            //    two scalars, a module-level-empty-or-per-fetch Map, and a useCallback -- the V0
            //    memo shield is React's DEFAULT shallow compare and a fresh value here kills it.
            marginView={marginViewOpen}
            sectionByRowIndex={sectionByRowIndex}
            marginSortDir={marginSortDir}
            onToggleMarginSort={handleToggleMarginSort}
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
