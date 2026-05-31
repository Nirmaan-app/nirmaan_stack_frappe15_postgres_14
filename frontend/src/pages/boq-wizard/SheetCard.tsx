import { cn } from "@/lib/utils";
import type { BoQSheetDraft } from "./boqTypes";

// Status -> pill label + color. Covers all six wizard statuses.
// "General specs" is an effective status derived from BOQs.general_specs_sheet (M2.16),
// not from wizard_status -- the parent is responsible for passing the correct
// effectiveStatus; this component only renders what it receives.
const STATUS_PILL: Record<string, { label: string; className: string }> = {
  "Pending":       { label: "Pending",       className: "bg-slate-100 text-slate-600" },
  "Reviewed":      { label: "Reviewed",      className: "bg-emerald-100 text-emerald-700" },
  "Skip":          { label: "Skip",          className: "bg-amber-100 text-amber-700" },
  "Hidden":        { label: "Hidden",        className: "bg-slate-200 text-slate-500" },
  "General specs": { label: "General specs", className: "bg-sky-100 text-sky-700" },
  "Parse failed":  { label: "Parse failed",  className: "bg-red-100 text-red-700" },
};

interface SheetCardProps {
  draft: BoQSheetDraft;
  /** Effective status: may differ from draft.wizard_status when derived from the
   *  general_specs_sheet pointer (M2.16). Parent computes this; card only renders it. */
  effectiveStatus: string;
  /** True when the sheet name matches a likely-skip keyword (presentation hint only). */
  isLikelySkip: boolean;
}

export function SheetCard({ draft, effectiveStatus, isLikelySkip }: SheetCardProps) {
  const pill = STATUS_PILL[effectiveStatus] ?? STATUS_PILL["Pending"];

  // One muted summary line -- priority: sheet_label > work_package > keyword hint.
  // Trim is display-only; draft.sheet_name stays exact for any data use (e.g. 2b-ii calls).
  const summaryLine: string | null =
    (draft.sheet_label?.trim() || null) ??
    (draft.work_package ? draft.work_package.trim() : null) ??
    (isLikelySkip ? "Likely non-data sheet -- consider skipping" : null);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-background px-4 py-3">
      <div className="flex-1 min-w-0">
        {/* Display-trimmed name. The full exact sheet_name lives in draft.sheet_name
            and must be used verbatim for React keys and future endpoint calls (2b-ii). */}
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
        {/* TODO(2b-ii): status-change action buttons wired here */}
      </div>
      <span className={cn(
        "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        pill.className
      )}>
        {pill.label}
      </span>
    </div>
  );
}
