import React, { useCallback, useMemo, useState } from "react";
import { Table } from "@tanstack/react-table";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/components/ui/use-toast";
import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts";
import { useRefreshApprovalCounts } from "../../hooks/useRefreshApprovalCounts";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
// The unified queue hands this a normalized row that carries every field the bulk
// path reads (amount, name, document_name, vendor, document_type) under their
// PAYMENT names, so nothing in here had to change — only the type widened.
import { ApprovalQueueRow } from "../../config/approvalsTable.config";

import { BulkAction, BulkFailure, BulkMode } from "../hooks/useBulkPaymentActions";
import { useBulkApprovalActions } from "../hooks/useBulkApprovalActions";
import { countLabel, summarizeSelection } from "../../bulkSelectionSummary";
import { BulkConfirmDialog } from "./BulkConfirmDialog";

interface BulkActionBarProps {
  table: Table<ApprovalQueueRow>;
  mode: BulkMode;
  refetch: () => void;
  projectLabelFor?: (projectId?: string) => string;
  vendorLabelFor?: (vendorId?: string) => string;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  table,
  mode,
  refetch,
  projectLabelFor,
  vendorLabelFor,
}) => {
  const { toast } = useToast();
  const { submit, loading } = useBulkApprovalActions(mode);
  const refreshTabCounts = useRefreshApprovalCounts();

  const [dialogAction, setDialogAction] = useState<BulkAction | null>(null);
  const [lastFailures, setLastFailures] = useState<BulkFailure[]>([]);

  const selectedRows = table.getSelectedRowModel().rows;
  const selectedPayments = useMemo(
    () => selectedRows.map((r) => r.original),
    [selectedRows]
  );

  const count = selectedPayments.length;
  // Every user-facing string on this path reads its noun from here — the queue holds
  // three ledgers, so "payment" is only sometimes the right word.
  const mix = useMemo(() => summarizeSelection(selectedPayments), [selectedPayments]);

  const totalReqAmount = useMemo(
    () =>
      selectedPayments.reduce((sum, p) => sum + parseNumber(p.amount), 0),
    [selectedPayments]
  );

  const openDialog = useCallback((action: BulkAction) => {
    setDialogAction(action);
  }, []);

  const closeDialog = useCallback(() => {
    if (!loading) setDialogAction(null);
  }, [loading]);

  const handleConfirm = useCallback(
    async (rejectionReason?: string) => {
      if (!dialogAction || count === 0) return;
      // Whole ROWS, not ids: the hook routes each one by `doctype`, because an
      // expense and a payment go to different engines.
      try {
        const result = await submit(selectedPayments, dialogAction, rejectionReason);
        setLastFailures(result.failed);

        const succeededCount = result.succeeded.length;
        const failedCount = result.failed.length;

        if (succeededCount > 0) {
          toast({
            title: dialogAction === "approve" ? "Approved" : "Rejected",
            description:
              failedCount > 0
                ? `${succeededCount} succeeded, ${failedCount} failed. See details.`
                : `${countLabel(mix, succeededCount)} ${dialogAction === "approve" ? "approved" : "rejected"}.`,
            variant: failedCount > 0 ? "default" : "success",
          });
        } else {
          toast({
            title: "No changes",
            description: `All ${countLabel(mix, failedCount)} failed.`,
            variant: "destructive",
          });
        }

        refetch();
        invalidateSidebarCounts();
        refreshTabCounts();
        table.resetRowSelection();
        setDialogAction(null);
      } catch (err: any) {
        toast({
          title: "Bulk action failed",
          description: err?.message || "Could not complete bulk action.",
          variant: "destructive",
        });
      }
    },
    [dialogAction, count, selectedPayments, mix, submit, toast, refetch, table, refreshTabCounts]
  );

  if (count === 0) {
    return lastFailures.length > 0 ? (
      <FailuresPopover failures={lastFailures} onClear={() => setLastFailures([])} />
    ) : null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="flex h-8 items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 text-sm"
        title={`${countLabel(mix)} selected · Total Req. Amount ${formatToRoundedIndianRupee(totalReqAmount)}`}
      >
        <span className="text-muted-foreground">Req. Amt :</span>
        <span className="font-bold tabular-nums text-foreground">
          {formatToRoundedIndianRupee(totalReqAmount)}
        </span>
        <span className="font-semibold text-foreground tabular-nums">({count})</span>
      </div>
      <Button
        size="sm"
        variant="default"
        disabled={loading}
        onClick={() => openDialog("approve")}
        className="h-8 gap-1 bg-green-600 hover:bg-green-700 text-white"
      >
        {loading && dialogAction === "approve" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
        Approve
      </Button>
      <Button
        size="sm"
        variant="default"
        disabled={loading}
        onClick={() => openDialog("reject")}
        className="h-8 gap-1"
      >
        {loading && dialogAction === "reject" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <XCircle className="h-4 w-4" />
        )}
        Reject
      </Button>

      {lastFailures.length > 0 && (
        <FailuresPopover failures={lastFailures} onClear={() => setLastFailures([])} />
      )}

      {dialogAction && (
        <BulkConfirmDialog
          open={!!dialogAction}
          onOpenChange={(open) => !open && closeDialog()}
          action={dialogAction}
          mode={mode}
          payments={selectedPayments}
          isLoading={loading}
          onConfirm={handleConfirm}
          projectLabelFor={projectLabelFor}
          vendorLabelFor={vendorLabelFor}
        />
      )}
    </div>
  );
};

interface FailuresPopoverProps {
  failures: BulkFailure[];
  onClear: () => void;
}

const FailuresPopover: React.FC<FailuresPopoverProps> = ({ failures, onClear }) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button size="sm" variant="outline" className="h-8 gap-1 text-red-600 border-red-200">
        <XCircle className="h-4 w-4" />
        {failures.length} failed
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold">Bulk action failures</h4>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          Dismiss
        </button>
      </div>
      <ul className="text-xs space-y-1.5 max-h-64 overflow-y-auto">
        {failures.map((f) => (
          <li key={f.name} className="border-b border-border/40 pb-1.5 last:border-0">
            <div className="font-medium truncate" title={f.name}>{f.name}</div>
            <div className="text-muted-foreground">{f.reason}</div>
          </li>
        ))}
      </ul>
    </PopoverContent>
  </Popover>
);
