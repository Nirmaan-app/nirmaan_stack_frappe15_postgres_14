/**
 * ExportWorkbookDialog -- hub-level multi-sheet XLSX export (Slice D2b).
 *
 * Lists every "Parsed Check Done" sheet as a pre-ticked checklist (the
 * ParseRunDialog pattern). On confirm it fetches each ticked sheet's review rows
 * SEQUENTIALLY via get_review_rows, then hands them to buildAndDownloadReviewWorkbook
 * to produce ONE .xlsx (one tab per sheet) and download it.
 *
 * ABORT-ON-ANY-FAILURE: if any single fetch fails, the whole export aborts -- NO
 * partial file is produced -- and an inline error names the failed sheet. The
 * dialog is not dismissible mid-flight (closing would orphan the in-progress loop).
 *
 * The fetch lives HERE (not in exportReviewXlsx) because it is request-shaped: an
 * imperative .call() loop with manual progress state, the wizard convention for
 * multi-call reads (SWR declarative hooks fight loops -- frontend/CLAUDE.md).
 */
import { useEffect, useState } from "react";
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
import type { GetReviewRowsResponse } from "./boqTypes";
import {
  buildAndDownloadReviewWorkbook,
  type ReviewWorkbookSheet,
} from "./exportReviewXlsx";

interface ExportWorkbookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** BOQs docname -- passed VERBATIM to get_review_rows + the workbook filename. */
  boqName: string;
  /** "Parsed Check Done" sheet names (the hub computes eligibility). VERBATIM (#152). */
  eligibleSheets: string[];
}

export function ExportWorkbookDialog({
  open,
  onOpenChange,
  boqName,
  eligibleSheets,
}: ExportWorkbookDialogProps) {
  // All eligible sheets ticked by default on open.
  const [tickedSheets, setTickedSheets] = useState<Set<string>>(
    () => new Set(eligibleSheets),
  );
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; sheet: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // get_review_rows is GET-capable (whitelist bare); useFrappePostCall gives the
  // imperative .call() the sequential loop needs. One call per sheet.
  const { call: callGetReviewRows } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.review_screen.get_review_rows",
  );

  // Reset to "all ticked, idle" each time the dialog opens.
  useEffect(() => {
    if (open) {
      setTickedSheets(new Set(eligibleSheets));
      setRunning(false);
      setProgress(null);
      setError(null);
    }
    // Only reset on open/close transitions -- not on every eligibleSheets identity change.
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

  // Ordered ticked list (preserves eligibleSheets order).
  const tickedList = eligibleSheets.filter((s) => tickedSheets.has(s));

  const handleConfirm = async () => {
    if (tickedList.length === 0) return;
    setError(null);
    setRunning(true);
    // Track the sheet currently being fetched so a failure can name it.
    let failedSheet: string | null = null;
    try {
      const collected: ReviewWorkbookSheet[] = [];
      for (let i = 0; i < tickedList.length; i++) {
        const name = tickedList[i];
        failedSheet = name;
        setProgress({ current: i + 1, total: tickedList.length, sheet: name });
        // VERBATIM sheet_name (#152).
        const res = await callGetReviewRows({ boq_name: boqName, sheet_name: name });
        const msg = res.message as GetReviewRowsResponse;
        collected.push({
          sheetName: name,
          rows: msg?.rows ?? [],
          columnDescriptors: msg?.column_descriptors ?? [],
        });
      }
      failedSheet = null; // past the fetch loop; any throw below is the build step
      await buildAndDownloadReviewWorkbook({ boqName, sheets: collected });
      setRunning(false);
      setProgress(null);
      onOpenChange(false);
    } catch (e: unknown) {
      // Abort the whole export -- no partial file. Name the failed sheet.
      setRunning(false);
      setProgress(null);
      const where = failedSheet
        ? `"${failedSheet.trim() || failedSheet}"`
        : "the workbook";
      setError(
        `Could not export ${where}. ${getFrappeError(e) || "Please try again."} No file was downloaded.`,
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Not dismissible mid-flight: an in-progress fetch loop must not be orphaned.
        if (!isOpen && running) return;
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export checked sheets to Excel</DialogTitle>
          <DialogDescription>
            One workbook with a tab per sheet. All checked sheets are selected by
            default; untick any you want to leave out.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1 max-h-72 overflow-y-auto pr-1">
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Checked sheets ({eligibleSheets.length})
            </p>
            {eligibleSheets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No checked sheets to export.</p>
            ) : (
              <ul className="space-y-2">
                {eligibleSheets.map((name) => {
                  const isTicked = tickedSheets.has(name);
                  return (
                    <li key={name} className="flex items-start gap-2.5">
                      <Checkbox
                        id={`export-cb-${name}`}
                        checked={isTicked}
                        onCheckedChange={() => toggleSheet(name)}
                        disabled={running}
                        className="mt-0.5 shrink-0"
                      />
                      <label
                        htmlFor={`export-cb-${name}`}
                        className="text-sm leading-5 cursor-pointer select-none flex-1 min-w-0"
                      >
                        <span className="block truncate">{name.trim() || name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Progress line while the sequential fetch + build runs. */}
        {running && progress && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            Fetching {progress.sheet.trim() || progress.sheet} ({progress.current}/{progress.total})...
          </p>
        )}

        {/* Inline error (wizard convention: text-destructive, never a toast). */}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={running}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleConfirm()}
            disabled={running || tickedList.length === 0}
          >
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Exporting...
              </>
            ) : (
              `Export ${tickedList.length} sheet${tickedList.length !== 1 ? "s" : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
