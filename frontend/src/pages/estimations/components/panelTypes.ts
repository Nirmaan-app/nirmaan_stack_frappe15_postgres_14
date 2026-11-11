import type { EstimateBoqSummary, EstimateEntry, EstimateItemRow } from "@/utils/estimations/estimateTypes";

/** Materials an older estimate (a line that changed on re-commit) brings into the form, as new rows to review. */
export interface CarriedRows {
  rows: EstimateItemRow[];
  /** Excel row of the older line they came from, for the form's note. */
  fromRow: number | null;
  /**
   * Removes the older estimate. The form calls it only after a save that KEPT materials on the line: a save with
   * every row removed must not delete the older one too, or its materials would be nowhere (review issue 6).
   */
  onKept: () => void;
}

/** The line a material-estimate form opens for, and what to refresh after it saves. */
export interface EditTarget {
  boq: string;
  node: string;
  sheetName: string;
  excelRow: number | null;
  slNo: string | null;
  description: string | null;
  unit: string | null;
  qty: number | null;
  entry?: EstimateEntry;
  /** Set when the form opens from the older-version notice's "Add to a line": these rows are added to the line's own. */
  carried?: CarriedRows;
  afterSave: () => void;
}

/** What every Estimates sub-tab panel receives from the tab. */
export interface PanelProps {
  boqs: EstimateBoqSummary[];
  /** The open BOQ, or null (BOQ View then lists the BOQs; the other panels open the first). */
  boq: EstimateBoqSummary | null;
  /** The open sheet's name, verbatim; null = none chosen (or "All sheets" in Estimate Items). */
  sheetName: string | null;
  /** Excel row of the line to expand and scroll to (from `estRow`), or null. */
  focusRow: string | null;
  canEdit: boolean;
  onBoq: (boq: string | null) => void;
  onSheet: (sheetName: string | null) => void;
  onFocusRow: (excelRow: number | null) => void;
  onEdit: (target: EditTarget) => void;
  /** Jump to a line in Line Item View, expanded. */
  onOpenLine: (sheetName: string, excelRow: number | null) => void;
  /** Refresh the sheet counts after a save or a re-attach. */
  onCountsChanged: () => void;
}
