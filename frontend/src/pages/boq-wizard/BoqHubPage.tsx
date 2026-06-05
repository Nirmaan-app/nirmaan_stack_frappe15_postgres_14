import { useContext, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FrappeConfig, FrappeContext, useFrappeGetCall, useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
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
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { BOQsDoc, BoQSheetDraft, ParseRunDonePayload, WorkPackageMap } from "./boqTypes";
import { ParseRunDialog } from "./ParseRunDialog";
import { SheetCard } from "./SheetCard";

// Keyword list for presentation-only "likely non-data" hint.
const LIKELY_SKIP_KEYWORDS = [
  "summary",
  "make list",
  "cover",
  "index",
  "abstract",
  "boq summary",
];

function isLikelySkipSheet(sheetName: string): boolean {
  const lower = sheetName.toLowerCase();
  return LIKELY_SKIP_KEYWORDS.some((kw) => lower.includes(kw));
}

// Error message map for "boq:parse_run_done" error events. Module-level (not
// redefined per socket event). Severity drives modal styling: "neutral" is
// advisory (no_eligible_sheets), "destructive" is a genuine parse failure.
const PARSE_ERROR_MSGS: Record<string, { message: string; severity: "destructive" | "neutral" }> = {
  missing_file: {
    message:
      "The source file for this BoQ could not be found. It may have been moved or deleted.",
    severity: "destructive",
  },
  fetch_failed: {
    message:
      "Could not retrieve the source file. Please try again; if it persists, the file storage may be unavailable.",
    severity: "destructive",
  },
  no_eligible_sheets: {
    message:
      "No sheets were eligible to parse. Mark at least one sheet as Reviewed before parsing.",
    severity: "neutral",
  },
  parse_failed: {
    message:
      "The parser could not process this workbook. The file may be malformed or in an unexpected format.",
    severity: "destructive",
  },
  internal: {
    message:
      "An unexpected error occurred during parsing. Please try again or contact support if it continues.",
    severity: "destructive",
  },
};

const PARSE_ERROR_FALLBACK = {
  message: "An unknown error occurred during parsing.",
  severity: "destructive" as const,
};

const BoqHubPage = () => {
  const { boqId } = useParams<{ boqId: string }>();
  const navigate = useNavigate();

  // ── All hooks must be called before any conditional return ────────────────
  const [showHidden, setShowHidden] = useState(false);

  // General-specs checklist state (Slice 2b-frontend-ii).
  // tickedSpecsSheets: local Set seeded from server; committed on Save (not per-toggle).
  // pendingReviewedNames + pendingFullTickedSet: drive the combined Reviewed-warning dialog.
  const [tickedSpecsSheets, setTickedSpecsSheets] = useState<Set<string>>(new Set());
  const [specsDialogOpen, setSpecsDialogOpen] = useState(false);
  const [specsError, setSpecsError] = useState<string | null>(null);
  const [pendingReviewedNames, setPendingReviewedNames] = useState<string[]>([]);
  const [pendingFullTickedSet, setPendingFullTickedSet] = useState<string[]>([]);

  // Parse-run dialog + result state.
  const [parseDialogOpen, setParseDialogOpen] = useState(false);
  const [parseInFlight, setParseInFlight] = useState(false);
  const [parseResult, setParseResult] = useState<{
    parsed: string[];
    notParsed: string[];
    failed: string[];
  } | null>(null);
  const [parseError, setParseError] = useState<{ message: string; severity: "destructive" | "neutral" } | null>(null);

  // Honor the useFrappeGetDoc third-arg gotcha: null (not {enabled:false}).
  const { data: boq, isLoading, mutate } = useFrappeGetDoc<BOQsDoc>(
    "BOQs",
    boqId ?? "",
    boqId ? undefined : null
  );

  // Whole-BoQ work-package map (Slice 3f-readback). Frappe get_doc does not
  // hydrate grandchild rows, so draft.work_packages is always empty on the client.
  // This endpoint is the authoritative read path. SWR key follows useFrappeGetDoc
  // convention: null disables until boqId is present.
  const { data: wpMapData, mutate: mutateWpMap } = useFrappeGetCall<{ message: WorkPackageMap }>(
    "nirmaan_stack.api.boq.wizard.update_sheet_draft.get_boq_work_packages",
    { boq_name: boqId ?? "" },
    boqId ? undefined : null
  );

  // General-specs endpoint. Called in BoqHubPage because it targets the parent
  // BOQs row, not a child draft (SheetCard handles the child-row endpoints).
  const { call: callSpecs, loading: specsLoading } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.update_sheet_draft.set_general_specs_sheet"
  );

  // Parse-run endpoint (Slice 2b-frontend-i).
  const { call: callRunParse } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.parse_run.run_parse"
  );

  // Socket for "boq:parse_run_done" (mirrors BoqUploadScreen.tsx pattern).
  const { socket } = useContext(FrappeContext) as FrappeConfig;

  useEffect(() => {
    if (!socket) return;

    const handler = (payload: ParseRunDonePayload) => {
      // Guard: only act on events for THIS boq (a concurrent parse by the same
      // user on a different boq must not trigger a refresh here).
      if (payload.boq_name !== boqId) return;

      setParseInFlight(false);
      setParseDialogOpen(false);

      if (payload.status === "success") {
        void mutate();
        setParseResult({
          parsed: payload.parsed_sheets ?? [],
          notParsed: payload.not_parsed_sheets ?? [],
          failed: payload.failed_sheets ?? [],
        });
      } else {
        setParseError(
          PARSE_ERROR_MSGS[payload.error_code ?? ""] ?? PARSE_ERROR_FALLBACK
        );
      }
    };

    // Reconnect self-heal (#147 option-4): re-fetch the BoQ doc on socket (re)connect
    // so the existing useEffect([boq]) recovery can sync parseInFlight from the fresh
    // parse_in_progress server value. Also fires on initial connect -- harmless (SWR
    // deduplicates; the doc is already being fetched on mount).
    const onReconnect = () => { void mutate(); };

    socket.on("boq:parse_run_done", handler);
    socket.on("connect", onReconnect);
    return () => {
      socket.off("boq:parse_run_done", handler);
      socket.off("connect", onReconnect);
    };
    // socket is a stable FrappeContext singleton ref; boqId from useParams is stable;
    // mutate is a stable useFrappeGetDoc SWR ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  // Seed/re-sync the checklist ticked set from server state whenever boq changes.
  // mutate() after Save re-fetches boq, which fires this effect so ticks re-sync.
  // Any unsaved local tick edits are overwritten on re-sync -- acceptable since the
  // checklist commits via an explicit Save (never per-toggle).
  useEffect(() => {
    if (!boq) return;
    setTickedSpecsSheets(
      new Set(
        (boq.general_specs_sheets ?? [])
          .map((r) => r.source_sheet_name)
          .filter(Boolean)
      )
    );
  }, [boq]);

  // On-mount parse_in_progress recovery (Bucket-2 Slice 2): when the doc loads
  // or refreshes, sync parseInFlight from the server flag so the hub correctly
  // reflects running state across navigation and missed socket events. The live
  // socket event still clears parseInFlight on done; this is the mount fallback.
  useEffect(() => {
    if (!boq) return;
    setParseInFlight(boq.parse_in_progress === 1);
  }, [boq]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Not-found state ────────────────────────────────────────────────────────
  if (!boq) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
        <p className="font-medium text-foreground">BoQ not found</p>
        <p className="text-sm text-muted-foreground">
          No record found for &ldquo;{boqId}&rdquo;.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/upload-boq")}
        >
          Back to Upload BoQ
        </Button>
      </div>
    );
  }

  // ── Stable onSaved callback (passed to each SheetCard) ────────────────────
  // Calls SWR mutate to re-fetch the BOQ after any successful card action.
  // Server is the source of truth; no local-state authority over wizard_status.
  // mutateWpMap refreshes the work-package map in case a spoke save happened.
  const handleSaved = () => { void mutate(); void mutateWpMap(); };

  // ── Work-package map (Slice 3f-readback) ────────────────────────────────────
  // Derived from the get_boq_work_packages response once loaded; empty while loading.
  // Each SheetCard receives its sheet's entry via workHeaders prop.
  const workPackageMap: WorkPackageMap = wpMapData?.message ?? {};

  // ── Spoke navigation callback (Module 3 Slice 3b-ii) ──────────────────────
  // Passed to each SheetCard so the card stays router-free. Hub owns navigate.
  // EXACT: sheetName passed verbatim (encodeURIComponent encodes all special chars
  // including spaces). React Router v6 auto-decodes useParams values in the spoke.
  const handleOpenSpoke = (sheetName: string) => {
    navigate(`/upload-boq/hub/${boqId}/sheet/${encodeURIComponent(sheetName)}`);
  };

  // ── Review-screen navigation callback (Slice B1) ────────────────────────
  // Navigates to the per-sheet review screen for Parsed/Parsed Check Done sheets.
  // Same encode/decode convention as handleOpenSpoke.
  const handleOpenReview = (sheetName: string) => {
    navigate(`/upload-boq/hub/${boqId}/review/${encodeURIComponent(sheetName)}`);
  };

  // ── Effective-status derivation (M2.16) ───────────────────────────────────
  // "General specs" is DERIVED from child-table set membership, never from wizard_status.
  // EXACT: sheet_name compared verbatim against source_sheet_name (no trimming).
  // Slice 2c: general_specs_sheets child array replaces the former scalar pointer.
  // It serializes on the BOQs parent (first-level child, not grandchild) so no
  // separate read endpoint is needed.
  const generalSpecsSheetNames = new Set<string>(
    (boq.general_specs_sheets ?? [])
      .map((r) => r.source_sheet_name)
      .filter(Boolean)
  );

  const getEffectiveStatus = (draft: BoQSheetDraft): string => {
    if (generalSpecsSheetNames.has(draft.sheet_name)) {
      return "General specs";
    }
    return draft.wizard_status || "Pending";
  };

  // ── Sheet grouping + sorting ───────────────────────────────────────────────
  const allDrafts = boq.sheet_drafts ?? [];
  const hiddenDrafts = allDrafts.filter(
    (s) => getEffectiveStatus(s) === "Hidden"
  );
  const nonHiddenDrafts = allDrafts.filter(
    (s) => getEffectiveStatus(s) !== "Hidden"
  );

  // Likely-skip sheets sink to the bottom; preserve sheet_order within groups.
  const sortedNonHidden = [...nonHiddenDrafts].sort((a, b) => {
    const aW = isLikelySkipSheet(a.sheet_name) ? 1 : 0;
    const bW = isLikelySkipSheet(b.sheet_name) ? 1 : 0;
    return aW !== bW ? aW - bW : a.sheet_order - b.sheet_order;
  });

  // ── Parse-gate computation (M2.11/M2.12) ──────────────────────────────────
  const dataSheets = nonHiddenDrafts.filter((s) => {
    const eff = getEffectiveStatus(s);
    return eff !== "Skip" && eff !== "General specs";
  });
  const blockingCount = dataSheets.filter((s) => {
    const eff = getEffectiveStatus(s);
    return eff === "Pending" || eff === "Parse failed";
  }).length;
  const reviewedCount = dataSheets.filter(
    (s) => getEffectiveStatus(s) === "Reviewed"
  ).length;
  const totalDataCount = dataSheets.length;
  const canParse = blockingCount === 0 && reviewedCount >= 1;

  // ── Footer breakdown counts (display-only -- does not touch gate math) ───────
  // These + totalDataCount reconcile to allDrafts.length so the denominator drop
  // is never mysterious when sheets are set aside.
  const generalSpecsCount = allDrafts.filter(
    (s) => getEffectiveStatus(s) === "General specs"
  ).length;
  const skippedCount = allDrafts.filter(
    (s) => getEffectiveStatus(s) === "Skip"
  ).length;
  const hiddenCount = hiddenDrafts.length;
  const parsedCount = dataSheets.filter(
    (s) => getEffectiveStatus(s) === "Parsed"
  ).length;

  // Sheets available for review (Parsed or Parsed Check Done).
  // Used to show/hide the "Review parsed sheets" section and to provide
  // the picker list for navigating to SheetReviewPage.
  const reviewableDrafts = allDrafts.filter((s) => {
    const eff = getEffectiveStatus(s);
    return eff === "Parsed" || eff === "Parsed Check Done";
  });
  const parsedCheckDoneCount = dataSheets.filter(
    (s) => getEffectiveStatus(s) === "Parsed Check Done"
  ).length;

  const parseGateReason = (() => {
    if (canParse) return "Workbook is ready to parse";
    const parts: string[] = [];
    if (blockingCount > 0)
      parts.push(
        `review or skip ${blockingCount} pending sheet${blockingCount !== 1 ? "s" : ""}`
      );
    if (reviewedCount === 0)
      parts.push("mark at least one sheet as Reviewed");
    return `Still needed: ${parts.join("; ")}`;
  })();

  // ── Dialog data for ParseRunDialog (Slice 2b-frontend-i) ──────────────────
  // Computed from effective statuses -- same source as the gate.
  const reviewedDraftsForDialog = allDrafts.filter(
    (d) => getEffectiveStatus(d) === "Reviewed"
  );
  const parsedDraftsForDialog = allDrafts.filter(
    (d) => getEffectiveStatus(d) === "Parsed"
  );
  const pendingDialogSheetNames = allDrafts
    .filter((d) => {
      const eff = getEffectiveStatus(d);
      return eff === "Pending" || eff === "Parse failed";
    })
    .map((d) => d.sheet_name);
  const skippedDialogSheetNames = allDrafts
    .filter((d) => {
      const eff = getEffectiveStatus(d);
      return eff === "Skip" || eff === "Hidden";
    })
    .map((d) => d.sheet_name);
  const generalSpecsDialogList = [...generalSpecsSheetNames];

  // ── Parse-run handlers ──────────────────────────────────────────────────────
  const handleParseClick = () => {
    // Clear any prior result before opening the dialog.
    setParseResult(null);
    setParseError(null);
    setParseDialogOpen(true);
  };

  const handleParseConfirm = async (sheetNames: string[]) => {
    if (!boqId) return;
    setParseInFlight(true);
    try {
      // Enqueue the background worker; result arrives via "boq:parse_run_done".
      await callRunParse({ boq_name: boqId, sheet_names: sheetNames });
    } catch (_e) {
      setParseInFlight(false);
      setParseError({ message: "Failed to start parse job. Please try again.", severity: "destructive" });
      setParseDialogOpen(false);
    }
  };

  // ── General-specs checklist handlers (Slice 2b-frontend-ii) ──────────────
  // Fixes the 2b-backend-3 breaking change: sends sheet_names list, not single string.
  // sheet_names=[] clears all designations. On success mutate() re-syncs ticks.
  const doSetGeneralSpecs = async (sheetNamesList: string[]) => {
    setSpecsError(null);
    try {
      // EXACT: sheet_names passes the full ticked set verbatim (list API, 2b-backend-3).
      await callSpecs({
        boq_name: boq.name,
        sheet_names: sheetNamesList,
      });
      void mutate();
    } catch (_e) {
      setSpecsError(
        "Failed to update general specifications sheets. Please try again."
      );
    }
  };

  const toggleSpecsSheet = (sheetName: string) => {
    // EXACT: sheet_name toggled verbatim (mirrors ParseRunDialog toggleSheet).
    setTickedSpecsSheets((prev) => {
      const next = new Set(prev);
      if (next.has(sheetName)) next.delete(sheetName);
      else next.add(sheetName);
      return next;
    });
  };

  // On Save: compute newly-designated Reviewed sheets; show combined warning or commit.
  // One Save = one write (backend is replace-all; per-toggle = N redundant whole-set writes).
  const handleSpecsSave = () => {
    // Full ordered list (preserves nonHiddenDrafts order for determinism).
    const fullList = nonHiddenDrafts
      .filter((d) => tickedSpecsSheets.has(d.sheet_name))
      .map((d) => d.sheet_name);

    // Newly designated Reviewed sheets: ticked now AND not already server-designated AND Reviewed.
    const newlyDesignatedReviewed = nonHiddenDrafts.filter(
      (d) =>
        tickedSpecsSheets.has(d.sheet_name) &&
        !generalSpecsSheetNames.has(d.sheet_name) &&
        getEffectiveStatus(d) === "Reviewed"
    );

    if (newlyDesignatedReviewed.length > 0) {
      // Combined M2.23 courtesy warning naming all affected Reviewed sheets.
      setPendingReviewedNames(newlyDesignatedReviewed.map((d) => d.sheet_name));
      setPendingFullTickedSet(fullList);
      setSpecsDialogOpen(true);
    } else {
      void doSetGeneralSpecs(fullList);
    }
  };

  const handleSpecsConfirm = () => {
    const list = pendingFullTickedSet;
    setPendingReviewedNames([]);
    setPendingFullTickedSet([]);
    void doSetGeneralSpecs(list);
    // Dialog closes via onOpenChange from AlertDialogAction.
  };

  const handleSpecsCancel = () => {
    setPendingReviewedNames([]);
    setPendingFullTickedSet([]);
    // No write; checklist stays at current local ticks (not auto-reverted).
    // Dialog closes via onOpenChange from AlertDialogCancel.
  };

  return (
    <div className="flex-1 space-y-5 max-w-4xl mx-auto pt-6 pb-10">

      {/* ── Back to project (Finding #3) ─────────────────────────────────── */}
      {/* Semantic route by project ID -- never history.back() which misfires
          on a hard refresh or direct-URL entry with no history stack. */}
      {boq.project && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground hover:text-foreground"
          onClick={() => navigate(`/projects/${boq.project}?page=boq`)}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to project
        </Button>
      )}

      {/* ── Header strip (M2.18) ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground truncate">
            {boq.boq_name}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            V{boq.version ?? 1} &middot; Map sheets before parsing
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-1">
          {/* Autosave placeholder -- no real autosave in 2b; changes save on each action */}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="h-3 w-3" />
            Saved
          </span>
          {/* Discard stays disabled/stubbed -- destructive, separate later slice */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">More options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled
                className="text-destructive focus:text-destructive"
              >
                Discard BoQ
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── General specifications checklist (M2.10, Slice 2b-frontend-ii) ── */}
      {/* Candidate set = nonHiddenDrafts; backend rejects Hidden sheets.      */}
      {/* Ticked = currently designated (set membership M2.16). Save = 1 write. */}
      <div className="rounded-lg border border-border bg-muted/20 p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              General specifications sheets
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              One or more sheets may contain preamble text shared across all
              work packages. Tick each sheet that serves as a general
              specifications sheet, then save.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={specsLoading}
            onClick={handleSpecsSave}
            className="shrink-0 mt-1 sm:mt-0"
          >
            {specsLoading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
        {nonHiddenDrafts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sheets available.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {nonHiddenDrafts.map((d) => {
              const isTicked = tickedSpecsSheets.has(d.sheet_name);
              return (
                <li key={d.sheet_name} className="flex items-center gap-2.5">
                  <Checkbox
                    id={`specs-cb-${d.sheet_name}`}
                    checked={isTicked}
                    onCheckedChange={() => toggleSpecsSheet(d.sheet_name)}
                    disabled={specsLoading}
                    className="shrink-0"
                  />
                  <label
                    htmlFor={`specs-cb-${d.sheet_name}`}
                    className="text-sm leading-5 cursor-pointer select-none min-w-0 truncate"
                  >
                    {d.sheet_name.trim() || d.sheet_name}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {specsError && (
          <p className="text-xs text-destructive">{specsError}</p>
        )}
      </div>

      {/* ── Sheet card list ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {sortedNonHidden.map((draft) => (
          // EXACT: sheet_name used verbatim as React key and in endpoint calls.
          <SheetCard
            key={draft.sheet_name}
            draft={draft}
            effectiveStatus={getEffectiveStatus(draft)}
            isLikelySkip={isLikelySkipSheet(draft.sheet_name)}
            boqName={boq.name}
            onSaved={handleSaved}
            onOpenSpoke={handleOpenSpoke}
            onOpenReview={handleOpenReview}
            workHeaders={workPackageMap[draft.sheet_name]}
          />
        ))}

        {/* Hidden sheets toggle (M2.2) */}
        {hiddenDrafts.length > 0 && (
          <div className="pt-1">
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowHidden((prev) => !prev)}
            >
              {showHidden ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {showHidden
                ? `Hide hidden sheets (${hiddenDrafts.length})`
                : `Show hidden sheets (${hiddenDrafts.length})`}
            </button>
            {showHidden && (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {hiddenDrafts.map((draft) => (
                  // EXACT: sheet_name verbatim as key.
                  <SheetCard
                    key={draft.sheet_name}
                    draft={draft}
                    effectiveStatus="Hidden"
                    isLikelySkip={isLikelySkipSheet(draft.sheet_name)}
                    boqName={boq.name}
                    onSaved={handleSaved}
                    onOpenReview={handleOpenReview}
                    workHeaders={workPackageMap[draft.sheet_name]}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Review parsed sheets section (Slice B1) ──────────────────────── */}
      {/* Shown when at least one sheet is Parsed or Parsed Check Done.        */}
      {/* Each entry navigates to SheetReviewPage via handleOpenReview.        */}
      {reviewableDrafts.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/20 p-4 flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Review parsed sheets</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Inspect extracted rows as a hierarchy tree. Read-only in this release.
            </p>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {reviewableDrafts.map((draft) => {
              const eff = getEffectiveStatus(draft);
              const isChecked = eff === "Parsed Check Done";
              return (
                <li key={draft.sheet_name} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-foreground truncate min-w-0">
                    {/* Display-trimmed; sheet_name passed verbatim to handleOpenReview. */}
                    {draft.sheet_name.trim() || draft.sheet_name}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      isChecked
                        ? "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300"
                        : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                    )}>
                      {isChecked ? "Checked" : "Parsed"}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      // EXACT: sheet_name passed verbatim — encodeURIComponent in handleOpenReview
                      onClick={() => handleOpenReview(draft.sheet_name)}
                    >
                      Review
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Parse-gate footer (M2.11/M2.12) ─────────────────────────────── */}
      <div className="border-t border-border pt-4 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {reviewedCount} of {totalDataCount} data{" "}
          {totalDataCount === 1 ? "sheet" : "sheets"} reviewed
          {parsedCount > 0 && ` · ${parsedCount} parsed`}
          {parsedCheckDoneCount > 0 && ` · ${parsedCheckDoneCount} checked`}
          {generalSpecsCount > 0 && ` · ${generalSpecsCount} general specs`}
          {skippedCount > 0 && ` · ${skippedCount} skipped`}
          {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
        </p>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button
                  disabled={!canParse || parseInFlight}
                  onClick={handleParseClick}
                >
                  {parseInFlight ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Parsing...
                    </>
                  ) : (
                    "Parse workbook"
                  )}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{parseGateReason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* ── Parse-run confirm dialog (Slice 2b-frontend-i) ───────────────── */}
      <ParseRunDialog
        open={parseDialogOpen}
        onClose={() => setParseDialogOpen(false)}
        onConfirm={(sheetNames) => { void handleParseConfirm(sheetNames); }}
        reviewedDrafts={reviewedDraftsForDialog}
        parsedDrafts={parsedDraftsForDialog}
        pendingSheetNames={pendingDialogSheetNames}
        skippedSheetNames={skippedDialogSheetNames}
        generalSpecsSheetNames={generalSpecsDialogList}
        isLoading={parseInFlight}
      />

      {/* ── Parse completion modal (Bucket-2 Slice 2) ──────────────────────── */}
      {/* Acknowledge-only: single OK action. Open driven from result/error state.  */}
      {/* Escape also dismisses (onOpenChange). HUB-SCOPED -- not app-global.      */}
      <AlertDialog
        open={!!(parseResult || parseError)}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setParseResult(null);
            setParseError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {parseResult ? "Parse complete" : "Parse error"}
            </AlertDialogTitle>
          </AlertDialogHeader>

          {/* SUCCESS: up to three sub-lines, each shown only if non-empty. */}
          {parseResult && (
            <div className="space-y-1 py-1 text-sm">
              {parseResult.parsed.length > 0 && (
                <p className="font-medium text-foreground">
                  Parsed: {parseResult.parsed.join(", ")}
                </p>
              )}
              {parseResult.notParsed.length > 0 && (
                <p className="text-muted-foreground">
                  Not parsed (skipped, hidden, or general-specs):{" "}
                  {parseResult.notParsed.join(", ")}
                </p>
              )}
              {parseResult.failed.length > 0 && (
                <p className="text-destructive">
                  Failed to parse: {parseResult.failed.join(", ")}
                </p>
              )}
              {parseResult.parsed.length === 0 &&
                parseResult.notParsed.length === 0 &&
                parseResult.failed.length === 0 && (
                  <p className="text-foreground">Parse complete.</p>
                )}
            </div>
          )}

          {/* ERROR: one message; no_eligible_sheets is neutral (advisory), rest destructive. */}
          {parseError && (
            <p
              className={cn(
                "py-1 text-sm",
                parseError.severity === "neutral"
                  ? "text-muted-foreground"
                  : "text-destructive"
              )}
            >
              {parseError.message}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setParseResult(null);
                setParseError(null);
              }}
            >
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── M2.23 combined warn-on-Reviewed dialog (Slice 2b-frontend-ii) ── */}
      {/* Fires on Save when any newly-designated sheet is currently Reviewed. */}
      {/* Un-designating never warns; non-Reviewed sheets never warn.          */}
      <AlertDialog open={specsDialogOpen} onOpenChange={setSpecsDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Designate reviewed sheets as general specs?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingReviewedNames.length === 1
                ? `"${pendingReviewedNames[0].trim() || pendingReviewedNames[0]}" is Reviewed -- designating it as a general-specs sheet will set its review aside. Continue?`
                : `These ${pendingReviewedNames.length} sheets are Reviewed -- designating them as general-specs sheets will set their reviews aside. Continue?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingReviewedNames.length > 1 && (
            <ul className="px-6 pb-2 space-y-0.5 text-sm text-muted-foreground">
              {pendingReviewedNames.map((name) => (
                <li key={name}>&middot; {name.trim() || name}</li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleSpecsCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSpecsConfirm}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BoqHubPage;
export { BoqHubPage as Component };
