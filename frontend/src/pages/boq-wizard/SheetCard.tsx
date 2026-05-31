import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { BoQSheetDraft } from "./boqTypes";

// ── Status pill definitions ──────────────────────────────────────────────────
// Approach: semantic tokens where a sensible match exists; intentional
// traffic-light colors (with dark: variants) for the remainder. ONE place.
// "General specs" is an effective status derived from BOQs.general_specs_sheet
// (M2.16), not from wizard_status; the parent computes it, this map renders it.
const STATUS_PILL: Record<string, { label: string; className: string }> = {
  // Semantic tokens -- CSS custom properties adapt to dark mode automatically.
  "Parse failed":   { label: "Parse failed",  className: "bg-destructive/10 text-destructive" },
  "Hidden":         { label: "Hidden",        className: "bg-muted text-muted-foreground" },
  // Intentional traffic-light colors; dark: variants included for the app's dark theme.
  "Pending":        { label: "Pending",       className: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200" },
  "Reviewed":       { label: "Reviewed",      className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" },
  "Skip":           { label: "Skip",          className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
  "General specs":  { label: "General specs", className: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200" },
};

// Tooltip for stub buttons whose target (per-sheet spoke) is Module 3, not yet built.
const MODULE3_TOOLTIP = "Per-sheet configuration opens in Module 3 (coming next)";

// Shared button style for "Mark reviewed" -- emerald tint to hint at the target status.
const MARK_REVIEWED_CLASS =
  "text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-300 dark:border-emerald-800 dark:hover:bg-emerald-950";

interface SheetCardProps {
  draft: BoQSheetDraft;
  /** Effective status -- may be "General specs" even when wizard_status differs. M2.16. */
  effectiveStatus: string;
  isLikelySkip: boolean;
  /** BOQs docname -- passed VERBATIM to endpoint calls (never trimmed). */
  boqName: string;
  /** Called after any successful write to trigger parent SWR re-fetch. */
  onSaved: () => void;
}

export function SheetCard({
  draft,
  effectiveStatus,
  isLikelySkip,
  boqName,
  onSaved,
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

  // One muted summary line -- priority: sheet_label > work_package > keyword hint.
  // Trim is display-only; draft.sheet_name stays exact for any data use.
  const summaryLine: string | null =
    (draft.sheet_label?.trim() || null) ??
    (draft.work_package ? draft.work_package.trim() : null) ??
    (isLikelySkip ? "Likely non-data sheet -- consider skipping" : null);

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
            <p className={cn(
              "mt-0.5 text-xs text-muted-foreground leading-4",
              isLikelySkip && !draft.sheet_label && !draft.work_package && "italic"
            )}>
              {summaryLine}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <span className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
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
            {/* Review: stub -- per-sheet spoke is Module 3 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" variant="ghost" disabled={isSaving}
                    onClick={() => {/* Module 3 -- no-op */}}>
                    Review
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{MODULE3_TOOLTIP}</TooltipContent>
            </Tooltip>
            <Button size="sm" variant="outline" disabled={isSaving}
              onClick={() => void handleStatusChange("Skip")}>
              Skip
            </Button>
            {/*
              Mark reviewed: interim affordance so the parse gate is testable without
              the spoke. In the production flow, Reviewed is reached via Module 3 (M2.6).
            */}
            <Button size="sm" variant="outline" disabled={isSaving}
              className={MARK_REVIEWED_CLASS}
              onClick={() => void handleStatusChange("Reviewed")}>
              Mark reviewed
            </Button>
          </div>
        )}

        {/* ── Reviewed ────────────────────────────────────────────────────── */}
        {effectiveStatus === "Reviewed" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {/* Edit: stub -- opens the per-sheet spoke (Module 3) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" variant="ghost" disabled={isSaving}
                    onClick={() => {/* Module 3 -- no-op */}}>
                    Edit
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{MODULE3_TOOLTIP}</TooltipContent>
            </Tooltip>
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
            {/* Review: stub -- Module 3 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" variant="ghost" disabled={isSaving}
                    onClick={() => {/* Module 3 -- no-op */}}>
                    Review
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{MODULE3_TOOLTIP}</TooltipContent>
            </Tooltip>
            {/* Interim: Mark reviewed so parse gate is testable without the spoke. */}
            <Button size="sm" variant="outline" disabled={isSaving}
              className={MARK_REVIEWED_CLASS}
              onClick={() => void handleStatusChange("Reviewed")}>
              Mark reviewed
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
