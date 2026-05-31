import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useFrappeGetDoc } from "frappe-react-sdk";
import {
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
import type { BOQsDoc, BoQSheetDraft } from "./boqTypes";
import { SheetCard } from "./SheetCard";

// Keyword list for presentation-only "likely non-data" hint.
// Sheets whose names contain any of these strings (case-insensitive) sink to the
// bottom of the card list and show a soft italic hint. No data is changed.
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

// Sentinel used as the Select value when no general-specs sheet is designated.
const NONE_SENTINEL = "__none__";

const BoqHubPage = () => {
  const { boqId } = useParams<{ boqId: string }>();
  const navigate = useNavigate();
  const [showHidden, setShowHidden] = useState(false);

  // Honor the useFrappeGetDoc third-arg gotcha: pass null (not {enabled:false})
  // to disable the SWR fetch when boqId is absent. boqId is from the URL param
  // and will always be a non-empty string if the route matched.
  const { data: boq, isLoading } = useFrappeGetDoc<BOQsDoc>(
    "BOQs",
    boqId ?? "",
    boqId ? undefined : null
  );

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

  // ── Effective-status derivation (M2.16) ───────────────────────────────────
  // "General specs" is DERIVED from BOQs.general_specs_sheet pointer, not from
  // wizard_status. The backend never writes "General specs" to wizard_status.
  // EXACT: sheet_name is compared verbatim -- no trimming (see boqTypes.ts).
  const getEffectiveStatus = (draft: BoQSheetDraft): string => {
    if (boq.general_specs_sheet && draft.sheet_name === boq.general_specs_sheet) {
      return "General specs";
    }
    return draft.wizard_status || "Pending";
  };

  // ── Sheet grouping ─────────────────────────────────────────────────────────
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
  // Data sheets = potential parse targets: non-hidden, non-skip, non-general-specs.
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
  // Gate: zero blocking AND at least one Reviewed sheet.
  const canParse = blockingCount === 0 && reviewedCount >= 1;

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

  // ── General specs selector value ───────────────────────────────────────────
  // EXACT: SelectItem values use sheet_name verbatim so 2b-ii can pass them
  // directly to the set_general_specs_sheet endpoint without transformation.
  const generalSpecsValue = boq.general_specs_sheet || NONE_SENTINEL;

  return (
    <div className="flex-1 space-y-5 max-w-4xl mx-auto pt-6 pb-10">

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
          {/* Autosave placeholder -- static indicator; real autosave is 2b-ii+ */}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="h-3 w-3" />
            Saved
          </span>
          {/* Overflow menu -- Discard is rendered but NOT wired (2b-ii) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">More options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* TODO(2b-ii): wire Discard BoQ -- deletes the BOQs row and navigates back */}
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
        {/*
          SelectTrigger is disabled in this slice (2b-ii removes disabled and
          wires onValueChange to the set_general_specs_sheet endpoint).
          EXACT: SelectItem value uses sheet_name verbatim -- required for 2b-ii.
        */}
        <Select
          value={generalSpecsValue}
          onValueChange={() => { /* TODO(2b-ii): wire set_general_specs_sheet */ }}
        >
          <SelectTrigger disabled className="w-full sm:w-60 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_SENTINEL}>None selected</SelectItem>
            {allDrafts.map((s) => (
              /* EXACT: value is sheet_name verbatim (for 2b-ii endpoint call).
                 Trim only the displayed label text. */
              <SelectItem key={s.sheet_name} value={s.sheet_name}>
                {s.sheet_name.trim() || s.sheet_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Sheet card list ───────────────────────────────────────────────── */}
      <div className="space-y-2">
        {sortedNonHidden.map((draft) => (
          // EXACT: sheet_name used verbatim as React key (see boqTypes.ts constraint).
          <SheetCard
            key={draft.sheet_name}
            draft={draft}
            effectiveStatus={getEffectiveStatus(draft)}
            isLikelySkip={isLikelySkipSheet(draft.sheet_name)}
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
              <div className="mt-2 space-y-2">
                {hiddenDrafts.map((draft) => (
                  // EXACT: sheet_name verbatim as key.
                  <SheetCard
                    key={draft.sheet_name}
                    draft={draft}
                    effectiveStatus="Hidden"
                    isLikelySkip={isLikelySkipSheet(draft.sheet_name)}
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
          {reviewedCount} of {totalDataCount}{" "}
          {totalDataCount === 1 ? "sheet" : "sheets"} reviewed
        </p>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {/*
                Span wrapper required: disabled Button does not fire mouse events
                so Tooltip cannot detect hover without the tabIndex wrapper.
              */}
              <span tabIndex={0}>
                <Button
                  disabled={!canParse}
                  onClick={() => {
                    /* Module 5 owns the actual parse -- no-op in 2b */
                  }}
                >
                  Parse workbook
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{parseGateReason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
};

export default BoqHubPage;
// React Router v6 lazy() requires a named Component export.
export { BoqHubPage as Component };
