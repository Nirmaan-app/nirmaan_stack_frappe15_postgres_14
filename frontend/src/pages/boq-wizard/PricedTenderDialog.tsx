/**
 * PricedTenderDialog -- hub-level "Download priced tender" picker (Phase 5 Slice 5b).
 *
 * Mirrors CommitDialog's committedState-driven rows + per-row metadata sub-line, with
 * ExportWorkbookDialog's self-contained "confirm does the download" shape. On confirm it
 * calls the 5a write-back endpoint (export_priced_workbook), decodes the returned base64
 * .xlsx, triggers a browser download, hands the result up via onDownloaded (so the hub can
 * surface the skipped-formula message + refresh staleness), and closes.
 *
 * DISTINCT from ExportWorkbookDialog ("Export Finalized" -- a fresh review .xlsx built
 * client-side from review rows): THIS downloads the user's ORIGINAL tender file with the
 * priced rates + the user's color/remark annotations stamped in by the server.
 *
 * Source = the COMMITTED sheets (committedState, the same source TenderingDialog uses, NOT
 * commit-eligibility). Grid-only general-specs sheets are SHOWN but DISABLED ("no rates to
 * write") -- they pass through the workbook untouched, so ticking them would be a no-op.
 */
import { useEffect, useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getFrappeError } from "@/utils/frappeErrors";
import type { CommittedSheetState, ExportPricedWorkbookResponse } from "./boqTypes";
import { base64ToBytes, downloadBytes } from "./downloadBlob";

// "date HH:MM" from a Frappe datetime string -- the wizard's slice(0,16) pattern.
function fmtAt(at: string | null | undefined): string {
  return typeof at === "string" ? at.slice(0, 16) : "";
}

interface PricedTenderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** BOQs docname -- passed VERBATIM to export_priced_workbook. */
  boqName: string;
  /** Current committed-state per sheet, keyed by sheet_name VERBATIM (#152). The picker
   *  source (committed sheets), workbook-ordered as the hub built the Map. */
  committedState: Map<string, CommittedSheetState>;
  /** Called after the download succeeds, with the endpoint result (skipped-formula report
   *  etc.) so the hub surfaces the message + refreshes the staleness chips. */
  onDownloaded: (result: ExportPricedWorkbookResponse) => void;
}

export function PricedTenderDialog({
  open,
  onOpenChange,
  boqName,
  committedState,
  onDownloaded,
}: PricedTenderDialogProps) {
  // Committed sheets in the Map's (workbook) order.
  const sheets = useMemo(() => Array.from(committedState.values()), [committedState]);
  // Only finalized (grid_and_nodes) sheets are tickable; grid-only have no rates to write.
  const tickableNames = useMemo(
    () => sheets.filter((s) => s.sheet_disposition !== "grid_only").map((s) => s.sheet_name),
    [sheets],
  );

  const [tickedSheets, setTickedSheets] = useState<Set<string>>(() => new Set(tickableNames));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { call: callExport } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.export_writeback.export_priced_workbook",
  );

  // All tickable rows ticked by default each time the dialog opens.
  useEffect(() => {
    if (open) {
      setTickedSheets(new Set(tickableNames));
      setRunning(false);
      setError(null);
    }
    // Only reset on open/close transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleSheet = (sheetName: string) => {
    setTickedSheets((prev) => {
      const next = new Set(prev);
      if (next.has(sheetName)) next.delete(sheetName);
      else next.add(sheetName);
      return next;
    });
  };

  // Ordered ticked list (preserves the committed/workbook order).
  const tickedList = useMemo(
    () => tickableNames.filter((n) => tickedSheets.has(n)),
    [tickableNames, tickedSheets],
  );

  const handleConfirm = async () => {
    if (tickedList.length === 0) return;
    setError(null);
    setRunning(true);
    try {
      // VERBATIM sheet names (#152). The endpoint resolves each sheet's current committed
      // version server-side and never writes the original on S3 (copy-on-write).
      const res = await callExport({ boq_name: boqName, sheet_names: tickedList });
      const result = res.message as ExportPricedWorkbookResponse;
      // Decode base64 -> bytes -> download (the exportReviewXlsx download tail).
      downloadBytes(base64ToBytes(result.content_base64), result.filename, result.content_type);
      setRunning(false);
      onDownloaded(result);
      onOpenChange(false);
    } catch (e: unknown) {
      setRunning(false);
      setError(
        `${getFrappeError(e) || "Could not generate the priced workbook. Please try again."} No file was downloaded.`,
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Not dismissible mid-flight: an in-progress export must not be orphaned.
        if (!isOpen && running) return;
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Download priced tender</DialogTitle>
          <DialogDescription>
            Download the original tender workbook with your rates (and any colour/remark
            notes) stamped in. Formula-driven rate cells are left untouched. All sheets with
            rates are selected by default.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1 max-h-72 overflow-y-auto pr-1">
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Committed sheets ({sheets.length})
            </p>
            {sheets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No committed sheets to export.</p>
            ) : (
              <ul className="space-y-2">
                {sheets.map((s) => {
                  const isGridOnly = s.sheet_disposition === "grid_only";
                  const isTicked = tickedSheets.has(s.sheet_name);
                  const exportedAt = fmtAt(s.last_exported_at);
                  return (
                    <li key={s.sheet_name} className="flex items-start gap-2.5">
                      <Checkbox
                        id={`priced-cb-${s.sheet_name}`}
                        checked={!isGridOnly && isTicked}
                        onCheckedChange={() => toggleSheet(s.sheet_name)}
                        disabled={running || isGridOnly}
                        className="mt-0.5 shrink-0"
                      />
                      <label
                        htmlFor={`priced-cb-${s.sheet_name}`}
                        className="text-sm leading-5 cursor-pointer select-none flex-1 min-w-0"
                      >
                        <span className="block truncate">
                          {s.sheet_name.trim() || s.sheet_name}
                          {isGridOnly && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              (no rates to write)
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground mt-0.5">
                          {exportedAt ? `last exported ${exportedAt}` : "never exported"}
                          {s.pricing_changed_since_export && (
                            <span className="ml-1.5 text-amber-600 dark:text-amber-400 font-medium">
                              &middot; changed since export
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Inline error (wizard convention: text-destructive, never a toast). */}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            Cancel
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={running || tickedList.length === 0}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              `Download ${tickedList.length} sheet${tickedList.length !== 1 ? "s" : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
