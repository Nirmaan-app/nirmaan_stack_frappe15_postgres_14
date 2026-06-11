import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, Loader2 } from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { BoQSheetDraft } from "./boqTypes";

// ── Status pill definitions ──────────────────────────────────────────────────
// Approach: solid saturated backgrounds with white text for maximum contrast.
// Dark: variants included for the app's dark theme (ThemeProvider + mode-toggle).
// "General specs" is an effective status derived from BOQs.general_specs_sheet
// (M2.16), not from wizard_status; the parent computes it, this map renders it.
// ONE place -- do not scatter pill colors elsewhere.
const STATUS_PILL: Record<string, { label: string; className: string }> = {
  "Parse failed":   { label: "Parse failed",  className: "bg-red-600 text-white dark:bg-red-700 dark:text-white" },
  "Hidden":         { label: "Hidden",        className: "bg-slate-500 text-white dark:bg-slate-600 dark:text-white" },
  // Pending: vivid blue so it stands out as "needs attention" (not slate-near-gray).
  "Pending":        { label: "Pending",       className: "bg-blue-500 text-white dark:bg-blue-600 dark:text-white" },
  "Reviewed":       { label: "Reviewed",      className: "bg-emerald-600 text-white dark:bg-emerald-700 dark:text-white" },
  "Skip":           { label: "Skip",          className: "bg-amber-500 text-white dark:bg-amber-600 dark:text-white" },
  "General specs":  { label: "General specs", className: "bg-sky-500 text-white dark:bg-sky-600 dark:text-white" },
  "Parsed":         { label: "Parsed",        className: "bg-green-600 text-white dark:bg-green-700 dark:text-white" },
  // Teal = "green + checked" register, clearly distinct from Parsed green.
  "Parsed Check Done": { label: "Checked",   className: "bg-teal-600 text-white dark:bg-teal-700 dark:text-white" },
};


interface SheetCardProps {
  draft: BoQSheetDraft;
  /** Effective status -- may be "General specs" even when wizard_status differs. M2.16. */
  effectiveStatus: string;
  isLikelySkip: boolean;
  /** BOQs docname -- passed VERBATIM to endpoint calls (never trimmed). */
  boqName: string;
  /** Called after any successful write to trigger parent SWR re-fetch. */
  onSaved: () => void;
  /**
   * Called when the user clicks Review (Pending/Parse-failed) or Edit (Reviewed/Parsed).
   * Receives the VERBATIM sheet_name (no trimming). Parent (BoqHubPage) owns
   * navigate so SheetCard stays router-free.
   */
  onOpenSpoke?: (sheetName: string) => void;
  /**
   * Called when the user clicks Review on a Parsed Check Done card.
   * Navigates to the review screen (distinct from the config spoke).
   * Receives the VERBATIM sheet_name. Hub owns navigate; SheetCard stays router-free.
   */
  onOpenReview?: (sheetName: string) => void;
  /**
   * Work-header docnames for this sheet from get_boq_work_packages (Slice 3f-readback).
   * Replaces draft.work_packages read; undefined while the map is loading.
   */
  workHeaders?: string[];
  /**
   * Called when the user clicks the per-card "Re-parse" control (Force Re-parse slice).
   * Rendered ONLY on re-parse-eligible cards (has_prior_parse === 1 AND effective status
   * in Parsed / Parsed Check Done / Reviewed). Opens the shared ParseRunDialog pre-filtered
   * to this one sheet. Receives the VERBATIM sheet_name; hub owns the dialog + navigate.
   */
  onReparse?: (sheetName: string) => void;
}

export function SheetCard({
  draft,
  effectiveStatus,
  isLikelySkip,
  boqName,
  onSaved,
  onOpenSpoke,
  onOpenReview,
  workHeaders,
  onReparse,
}: SheetCardProps) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [cardError, setCardError] = useState<string | null>(null);

  const { call: callStatus, loading: statusLoading } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_status"
  );
  const { call: callLabel, loading: labelLoading } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.update_sheet_draft.set_sheet_label"
  );

  // Combined per-card saving state: spinner shows + ALL buttons on THIS card
  // are disabled while in flight. Other cards stay fully interactive.
  const isSaving = statusLoading || labelLoading;

  const pill = STATUS_PILL[effectiveStatus] ?? STATUS_PILL["Pending"];

  // ── Re-parse eligibility (Force Re-parse slice) ──────────────────────────
  // A sheet is re-parse-eligible iff it has a prior parse AND its effective status
  // is one the backend force_reparse path admits (Parsed / Parsed Check Done / Reviewed).
  // Parse failed is DELIBERATELY excluded -- the backend does NOT widen force_reparse to it
  // (parse_run.assemble_mapping_config Rule 4); offering it would be a no-op control.
  // Never-parsed sheets (has_prior_parse !== 1) never show a Re-parse control.
  const canReparse =
    draft.has_prior_parse === 1 &&
    (effectiveStatus === "Parsed" ||
      effectiveStatus === "Parsed Check Done" ||
      effectiveStatus === "Reviewed");

  // One muted summary line -- priority: sheet_label > workHeaders > keyword hint.
  // workHeaders comes from get_boq_work_packages (Slice 3f-readback), not draft.work_packages
  // (which is always empty -- Frappe get_doc does not hydrate grandchild rows).
  // Trim is display-only; draft.sheet_name stays exact for any data use.
  const summaryLine: string | null =
    (draft.sheet_label?.trim() || null) ??
    (workHeaders?.length
      ? workHeaders.join(", ")
      : null) ??
    (isLikelySkip ? "Likely non-data sheet -- consider skipping" : null);

  // True when the summary line IS the keyword hint (no label, no assigned work headers).
  // Used to apply stronger visual treatment -- presentation only, no data change.
  const isKeywordHint = isLikelySkip && !draft.sheet_label?.trim() && !(workHeaders?.length);

  // ── Status-change handler ────────────────────────────────────────────────
  const handleStatusChange = async (status: string) => {
    setCardError(null);
    try {
      // EXACT: sheet_name passed verbatim -- backend matches without whitespace trimming.
      await callStatus({ boq_name: boqName, sheet_name: draft.sheet_name, status });
      onSaved();
    } catch (_e) {
      setCardError("Status update failed. Please try again.");
    }
  };

  // ── Label editor handlers ────────────────────────────────────────────────
  const openLabelEdit = () => {
    setLabelInput(draft.sheet_label ?? "");
    setEditingLabel(true);
    setCardError(null);
  };

  const handleSaveLabel = async () => {
    setCardError(null);
    try {
      // EXACT: sheet_name passed verbatim. label="" clears the field.
      await callLabel({ boq_name: boqName, sheet_name: draft.sheet_name, label: labelInput });
      setEditingLabel(false);
      onSaved();
    } catch (_e) {
      setCardError("Label save failed. Please try again.");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">

      {/* ── Name + pill row ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {/* Display-trimmed name. draft.sheet_name is used verbatim for keys/calls. */}
          <p className="text-sm font-medium text-foreground truncate leading-5">
            {draft.sheet_name.trim() || draft.sheet_name}
          </p>
          {summaryLine && (
            <div className="mt-0.5 flex items-center gap-1 leading-4">
              {isKeywordHint && (
                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-400" />
              )}
              <p className={cn(
                "text-xs leading-4",
                isKeywordHint
                  ? "text-amber-600 font-medium dark:text-amber-400"
                  : "text-muted-foreground",
              )}>
                {summaryLine}
              </p>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <span className={cn(
            "rounded-full px-2.5 py-0.5 text-sm font-medium whitespace-nowrap",
            pill.className
          )}>
            {pill.label}
          </span>
          {/* Dirty indicator: Reviewed sheet whose config changed since last parse. */}
          {effectiveStatus === "Reviewed" && draft.has_prior_parse === 1 && (
            <span className="rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              needs re-parse
            </span>
          )}
        </div>
      </div>

      {/* ── Action buttons per effective status ──────────────────────────── */}
      <TooltipProvider>
        {/* ── Pending ─────────────────────────────────────────────────────── */}
        {effectiveStatus === "Pending" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {/* Review: navigates to the per-sheet spoke (Module 3 Slice 3b-ii). */}
            <Button size="sm" variant="ghost" disabled={isSaving}
              onClick={() => onOpenSpoke?.(draft.sheet_name)}>
              Review
            </Button>
            <Button size="sm" variant="outline" disabled={isSaving}
              onClick={() => void handleStatusChange("Skip")}>
              Skip
            </Button>
          </div>
        )}

        {/* ── Reviewed ────────────────────────────────────────────────────── */}
        {effectiveStatus === "Reviewed" && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {/* Edit: navigates to the per-sheet spoke (Module 3 Slice 3b-ii). */}
            <Button size="sm" variant="ghost" disabled={isSaving}
              onClick={() => onOpenSpoke?.(draft.sheet_name)}>
              Edit
            </Button>
            <Button size="sm" variant="outline" disabled={isSaving}
              onClick={() => void handleStatusChange("Pending")}>
              Set pending
            </Button>
            {/* Re-parse: only on a dirty Reviewed card (has_prior_parse === 1). */}
            {canReparse && (
              <Button size="sm" variant="outline" disabled={isSaving}
                onClick={() => onReparse?.(draft.sheet_name)}>
                Re-parse
              </Button>
            )}
            {/* Optional nicety: show last parse date on dirty cards. */}
            {draft.has_prior_parse === 1 && draft.last_parsed_at && (
              <span className="text-xs text-muted-foreground">
                &middot; last parsed {formatDate(draft.last_parsed_at)}
              </span>
            )}
          </div>
        )}

        {/* ── Skip ────────────────────────────────────────────────────────── */}
        {effectiveStatus === "Skip" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" disabled={isSaving}
              onClick={openLabelEdit}>
              Edit label
            </Button>
            <Button size="sm" variant="outline" disabled={isSaving}
              onClick={() => void handleStatusChange("Pending")}>
              Include
            </Button>
          </div>
        )}

        {/* ── Hidden ──────────────────────────────────────────────────────── */}
        {effectiveStatus === "Hidden" && (
          <div className="mt-2">
            <Button size="sm" variant="outline" disabled={isSaving}
              onClick={() => void handleStatusChange("Pending")}>
              Include
            </Button>
          </div>
        )}

        {/* ── Parse failed ────────────────────────────────────────────────── */}
        {effectiveStatus === "Parse failed" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {/* Review: navigates to the per-sheet spoke (Module 3 Slice 3b-ii). */}
            <Button size="sm" variant="ghost" disabled={isSaving}
              onClick={() => onOpenSpoke?.(draft.sheet_name)}>
              Review
            </Button>
            <Button size="sm" variant="outline" disabled={isSaving}
              onClick={() => void handleStatusChange("Skip")}>
              Skip
            </Button>
          </div>
        )}

        {/* ── Parsed ──────────────────────────────────────────────────────── */}
        {effectiveStatus === "Parsed" && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {/* Edit: navigates to the per-sheet spoke (Module 3 Slice 3b-ii). */}
            <Button size="sm" variant="ghost" disabled={isSaving}
              onClick={() => onOpenSpoke?.(draft.sheet_name)}>
              Edit
            </Button>
            {/* Re-parse: discards this Parsed sheet's rows + any review-screen edits. */}
            {canReparse && (
              <Button size="sm" variant="outline" disabled={isSaving}
                onClick={() => onReparse?.(draft.sheet_name)}>
                Re-parse
              </Button>
            )}
            {draft.last_parsed_at && (
              <span className="text-xs text-muted-foreground">
                &middot; Parsed {formatDate(draft.last_parsed_at)}
              </span>
            )}
          </div>
        )}

        {/* ── Parsed Check Done ──────────────────────────────────────────── */}
        {/* Review navigates to the review screen (not the config spoke). */}
        {effectiveStatus === "Parsed Check Done" && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="ghost" disabled={isSaving}
              onClick={() => onOpenReview?.(draft.sheet_name)}>
              Review
            </Button>
            {/* Re-parse: discards a hand-reviewed+checked sheet's rows + all review work. */}
            {canReparse && (
              <Button size="sm" variant="outline" disabled={isSaving}
                onClick={() => onReparse?.(draft.sheet_name)}>
                Re-parse
              </Button>
            )}
            {draft.last_parsed_at && (
              <span className="text-xs text-muted-foreground">
                &middot; Parsed {formatDate(draft.last_parsed_at)}
              </span>
            )}
          </div>
        )}

        {/* ── General specs: no status buttons (selector governs it) ─────── */}
        {effectiveStatus === "General specs" && (
          <p className="mt-2 text-xs text-muted-foreground">
            This sheet is the general specifications sheet. Change it via the selector above.
          </p>
        )}
      </TooltipProvider>

      {/* ── Inline label editor (Skip cards) ─────────────────────────────── */}
      {editingLabel && (
        <div className="mt-2 flex items-center gap-2">
          <input
            className="flex-1 h-7 rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
            value={labelInput}
            placeholder="Sheet label (optional -- leave empty to clear)"
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSaveLabel();
              if (e.key === "Escape") setEditingLabel(false);
            }}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <Button size="sm" disabled={isSaving} onClick={() => void handleSaveLabel()}
            className="h-7 px-2 text-xs">
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditingLabel(false)}
            className="h-7 px-2 text-xs">
            Cancel
          </Button>
        </div>
      )}

      {/* ── Inline error (wizard convention: text-destructive, never a toast) ── */}
      {cardError && (
        <p className="mt-1.5 text-xs text-destructive">{cardError}</p>
      )}
    </div>
  );
}
