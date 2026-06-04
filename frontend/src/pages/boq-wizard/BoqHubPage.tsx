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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

// Sentinel for the Select when no general-specs sheet is designated.
const NONE_SENTINEL = "__none__";

const BoqHubPage = () => {
  const { boqId } = useParams<{ boqId: string }>();
  const navigate = useNavigate();

  // ── All hooks must be called before any conditional return ────────────────
  const [showHidden, setShowHidden] = useState(false);

  // M2.23 confirm dialog state -- stores the value awaiting confirmation.
  const [pendingSpecsValue, setPendingSpecsValue] = useState<string | null>(null);
  const [specsDialogOpen, setSpecsDialogOpen] = useState(false);
  const [specsError, setSpecsError] = useState<string | null>(null);

  // Parse-run dialog + result state.
  const [parseDialogOpen, setParseDialogOpen] = useState(false);
  const [parseInFlight, setParseInFlight] = useState(false);
  const [parseResult, setParseResult] = useState<{
    parsed: string[];
    notParsed: string[];
    failed: string[];
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

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
        const ERROR_MSGS: Record<string, string> = {
          missing_file: "Parse failed: the BoQ file could not be found.",
          fetch_failed: "Parse failed: could not retrieve the BoQ file from storage.",
          no_eligible_sheets: "Parse failed: no eligible sheets were found (are any Reviewed?).",
          parse_failed: "Parse failed: the parser encountered an error.",
          internal: "Parse failed: an internal server error occurred.",
        };
        setParseError(
          ERROR_MSGS[payload.error_code ?? ""] ?? "Parse failed: an unknown error occurred."
        );
      }
    };

    socket.on("boq:parse_run_done", handler);
    return () => {
      socket.off("boq:parse_run_done", handler);
    };
    // socket is a stable FrappeContext singleton ref; boqId from useParams is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

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
      setParseError("Failed to start parse job. Please try again.");
      setParseDialogOpen(false);
    }
  };

  // ── General-specs selector value ───────────────────────────────────────────
  // EXACT: SelectItem values use sheet_name verbatim for the endpoint call.
  // Single-select interim (Slice 2c): show the first designated sheet, or NONE_SENTINEL.
  // Multi-select designation UI is Slice 2b; existing migrated multi-rows display via
  // getEffectiveStatus (set membership above) even if the selector only shows one.
  const generalSpecsValue =
    boq.general_specs_sheets?.[0]?.source_sheet_name || NONE_SENTINEL;

  // ── General-specs endpoint handler ────────────────────────────────────────
  // Design: backend stores pointer ONLY; no set_sheet_status call.
  // Releasing a designated sheet returns it to its TRUE prior wizard_status
  // (M2.23 AMENDED: more resilient than returning to Pending; no two-call sequence).
  const doSetGeneralSpecs = async (sheetNameOrNull: string | null) => {
    setSpecsError(null);
    try {
      // EXACT: sheet_name_or_none passed verbatim. "" clears the pointer.
      await callSpecs({
        boq_name: boq.name,
        sheet_name_or_none: sheetNameOrNull ?? "",
      });
      void mutate();
    } catch (_e) {
      setSpecsError(
        "Failed to update general specifications sheet. Please try again."
      );
    }
  };

  // M2.23: warn-and-confirm only when the chosen sheet is currently Reviewed.
  // All other statuses: call directly, no dialog.
  const handleSpecsChange = (newValue: string) => {
    const targetSheet = newValue === NONE_SENTINEL ? null : newValue;

    if (targetSheet !== null) {
      const targetDraft = allDrafts.find(
        // EXACT: sheet_name compared verbatim.
        (s) => s.sheet_name === targetSheet
      );
      if (targetDraft && getEffectiveStatus(targetDraft) === "Reviewed") {
        setPendingSpecsValue(targetSheet);
        setSpecsDialogOpen(true);
        return;
      }
    }

    // No confirmation needed -- call directly.
    void doSetGeneralSpecs(targetSheet);
  };

  const handleSpecsConfirm = () => {
    const value = pendingSpecsValue; // capture before clearing
    setPendingSpecsValue(null);
    if (value !== null) void doSetGeneralSpecs(value);
    // Dialog closes automatically via onOpenChange from AlertDialogAction.
  };

  const handleSpecsCancel = () => {
    setPendingSpecsValue(null);
    // Selector reverts automatically -- it is controlled by boq.general_specs_sheet
    // (server state), which has not changed since no endpoint was called.
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

      {/* ── General specifications selector (M2.10) ─────────────────────── */}
      <div className="rounded-lg border border-border bg-muted/20 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            General specifications sheet
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            One sheet may contain preamble text shared across all work packages.
          </p>
        </div>
        <div className="flex flex-col gap-1 w-full sm:w-60 shrink-0">
          {/*
            onValueChange wired to handleSpecsChange (M2.23 confirm flow).
            Selector is disabled only while a save is in flight (specsLoading).
            EXACT: SelectItem value = sheet_name verbatim (endpoint call, no trim).
          */}
          <Select
            value={generalSpecsValue}
            onValueChange={handleSpecsChange}
          >
            <SelectTrigger disabled={specsLoading} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_SENTINEL}>None selected</SelectItem>
              {allDrafts.map((s) => (
                /* EXACT: value is sheet_name verbatim -- required for endpoint call. */
                <SelectItem key={s.sheet_name} value={s.sheet_name}>
                  {s.sheet_name.trim() || s.sheet_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {specsError && (
            <p className="text-xs text-destructive">{specsError}</p>
          )}
        </div>
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
                    workHeaders={workPackageMap[draft.sheet_name]}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Parse-gate footer (M2.11/M2.12) ─────────────────────────────── */}
      <div className="border-t border-border pt-4 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {reviewedCount} of {totalDataCount} data{" "}
          {totalDataCount === 1 ? "sheet" : "sheets"} reviewed
          {generalSpecsCount > 0 && ` · ${generalSpecsCount} general specs`}
          {skippedCount > 0 && ` · ${skippedCount} skipped`}
          {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
        </p>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button
                  disabled={!canParse}
                  onClick={handleParseClick}
                >
                  Parse workbook
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{parseGateReason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* ── Parse-run result panel (Slice 2b-frontend-i) ─────────────────── */}
      {(parseResult || parseError) && (
        <div className={cn(
          "rounded-lg border px-4 py-3 text-sm",
          parseError
            ? "border-destructive/50 bg-destructive/10 text-destructive"
            : "border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 text-foreground"
        )}>
          {parseError ? (
            <p>{parseError}</p>
          ) : parseResult ? (
            <div className="space-y-0.5">
              {parseResult.parsed.length > 0 && (
                <p className="font-medium">
                  Parsed: {parseResult.parsed.join(", ")}
                </p>
              )}
              {parseResult.notParsed.length > 0 && (
                <p className="text-muted-foreground">
                  Not parsed (not eligible): {parseResult.notParsed.join(", ")}
                </p>
              )}
              {parseResult.failed.length > 0 && (
                <p className="text-destructive">
                  Failed: {parseResult.failed.join(", ")}
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}

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

      {/* ── M2.23 warn-and-confirm dialog ────────────────────────────────── */}
      {/*
        Fires only when the user designates a sheet whose effective status is
        "Reviewed". Wording is softened (M2.23 AMENDED): releasing the pointer
        later returns the sheet to its TRUE underlying wizard_status (not forced
        to Pending). Single call: set_general_specs_sheet only -- no set_sheet_status.
      */}
      <AlertDialog open={specsDialogOpen} onOpenChange={setSpecsDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set as general specifications sheet?</AlertDialogTitle>
            <AlertDialogDescription>
              This sheet will be used as the general-specifications sheet instead
              of as a data sheet for parsing. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
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
