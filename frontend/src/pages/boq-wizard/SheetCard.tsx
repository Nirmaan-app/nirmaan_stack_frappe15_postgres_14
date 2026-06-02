import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, Loader2 } from "lucide-react";
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
   * Called when the user clicks Review (Pending/Parse-failed) or Edit (Reviewed).
   * Receives the VERBATIM sheet_name (no trimming). Parent (BoqHubPage) owns
   * navigate so SheetCard stays router-free.
   */
  onOpenSpoke?: (sheetName: string) => void;
}

export function SheetCard({
  draft,
  effectiveStatus,
  isLikelySkip,
  boqName,
  onSaved,
  onOpenSpoke,
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

  // One muted summary line -- priority: sheet_label > work_packages > keyword hint.
  // Trim is display-only; draft.sheet_name stays exact for any data use.
  const summaryLine: string | null =
    (draft.sheet_label?.trim() || null) ??
    (draft.work_packages?.length
      ? draft.work_packages.map(w => w.work_header).join(", ")
      : null) ??
    (isLikelySkip ? "Likely non-data sheet -- consider skipping" : null);

  // True when the summary line IS the keyword hint (no label, no work_packages).
  // Used to apply stronger visual treatment -- presentation only, no data change.
  const isKeywordHint = isLikelySkip && !draft.sheet_label?.trim() && !(draft.work_packages?.length);

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
          <div className="mt-2 flex flex-wrap gap-1.5">
            {/* Edit: navigates to the per-sheet spoke (Module 3 Slice 3b-ii). */}
            <Button size="sm" variant="ghost" disabled={isSaving}
              onClick={() => onOpenSpoke?.(draft.sheet_name)}>
              Edit
            </Button>
            <Button size="sm" variant="outline" disabled={isSaving}
              onClick={() => void handleStatusChange("Pending")}>
              Set pending
            </Button>
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
