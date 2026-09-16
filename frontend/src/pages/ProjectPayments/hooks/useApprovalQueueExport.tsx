/**
 * "Export table" — the full-table CSV for every approval-queue tab.
 *
 * ⚠️ THIS EXISTS SO `new-data-table.tsx` DOES NOT HAVE TO CHANGE.
 *
 * The shared table's built-in `'default'` export cannot do what these tabs need, for
 * two reasons that are correct behaviour elsewhere and wrong here:
 *
 *   1. When `showRowSelection` is on, `handleDefaultExport` exports the SELECTED rows
 *      and never calls `onExportAll` — and the toolbar button is disabled outright
 *      while nothing is ticked. On the two approval tabs that means the full filtered
 *      list simply cannot be exported.
 *   2. It exports the RENDER columns, so the three that carry no `exportValue`
 *      (`actions`, `project_value`, `cashflow_gap`) came out as columns of blanks.
 *
 * Both are sidestepped from the page side: `DataTable` already exposes `onExport` as
 * "a function of your own" and `toolbarActions` as "any node in the toolbar". This
 * hook fills the first; `ApprovalExportButton` fills the second, for the tabs whose
 * built-in button is selection-gated (approvals) or already spoken for (the bank file
 * on "Payment need to paid"). Zero lines of shared-component change.
 *
 * ⚠️ IT DEPENDS ON THE BACKEND `for_export` FIX. `exportAllRows` sends
 * `for_export: true` + `limit_page_length: 0`; until `get_approval_queue` honoured
 * that pair it returned 50 rows, so this hook would cheerfully write a 50-row file
 * and report success. The two changes belong together.
 */

import React, { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { exportToCsv } from "@/utils/exportToCsv";
import { FileUp, Loader2 } from "lucide-react";

import { ApprovalQueueRow } from "../config/approvalsTable.config";
import { ApprovalColumnCtx } from "../config/approvalColumns";
import { buildApprovalExportColumns } from "../config/approvalExportColumns";

interface UseApprovalQueueExportArgs {
  /** `useServerDataTable`'s fetch-everything call — filters, search and sort applied. */
  exportAllRows: () => Promise<ApprovalQueueRow[]>;
  /** The SAME ctx the render registry got, so exported labels match the screen's. */
  columnCtx: ApprovalColumnCtx;
  /** Without the `.csv` — `exportToCsv` appends its own timestamp. */
  fileName: string;
}

export const useApprovalQueueExport = ({
  exportAllRows,
  columnCtx,
  fileName,
}: UseApprovalQueueExportArgs) => {
  // Local to this hook, NOT the table's `isExporting`. The table's flag is owned by
  // `useServerDataTable` and also drives its own button; keeping a separate one means
  // the two exports can never disable each other's control.
  const [isExportingAll, setIsExportingAll] = useState(false);

  const exportAll = useCallback(async () => {
    if (isExportingAll) return;
    setIsExportingAll(true);
    try {
      const rows = await exportAllRows();
      if (!rows?.length) {
        toast({
          title: "Export",
          description: "No rows match the current filters.",
          variant: "default",
        });
        return;
      }
      exportToCsv(fileName, rows, buildApprovalExportColumns(columnCtx));
      toast({
        title: "Export Successful",
        description: `${rows.length} rows exported.`,
        variant: "success",
      });
    } catch (e: any) {
      console.error("Approval queue export failed:", e);
      toast({
        title: "Export Error",
        description: e?.message || "Could not generate the CSV file.",
        variant: "destructive",
      });
    } finally {
      setIsExportingAll(false);
    }
  }, [exportAllRows, columnCtx, fileName, isExportingAll]);

  return { exportAll, isExportingAll };
};

interface ApprovalExportButtonProps {
  onClick: () => void;
  isExporting: boolean;
  disabled?: boolean;
  /** Distinguishes it where a second export button already sits in the toolbar. */
  label?: string;
}

/**
 * Drop into `DataTable`'s `toolbarActions`. Visually matches the built-in export
 * button (same `size`/`variant`/icon) so a tab that uses this one and a tab that uses
 * the built-in do not look like different screens.
 */
export const ApprovalExportButton: React.FC<ApprovalExportButtonProps> = ({
  onClick,
  isExporting,
  disabled = false,
  label = "Export",
}) => (
  <Button
    size="sm"
    variant="outline"
    disabled={disabled || isExporting}
    onClick={onClick}
  >
    {isExporting ? (
      <>
        <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Exporting...
      </>
    ) : (
      <>
        <FileUp className="h-4 w-4 mr-1" /> {label}
      </>
    )}
  </Button>
);
