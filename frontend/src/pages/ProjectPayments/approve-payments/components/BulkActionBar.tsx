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
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";

import {
  BulkAction,
  BulkFailure,
  BulkMode,
  useBulkPaymentActions,
} from "../hooks/useBulkPaymentActions";
import { BulkConfirmDialog } from "./BulkConfirmDialog";

interface BulkActionBarProps {
  table: Table<ProjectPayments>;
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
  const { submit, loading } = useBulkPaymentActions(mode);

  const [dialogAction, setDialogAction] = useState<BulkAction | null>(null);
  const [lastFailures, setLastFailures] = useState<BulkFailure[]>([]);

  const selectedRows = table.getSelectedRowModel().rows;
  const selectedPayments = useMemo(
    () => selectedRows.map((r) => r.original),
    [selectedRows]
  );

  const count = selectedPayments.length;

  // Selection is keyed per visible page (server-side pagination, no stable row id),
  // so the "(this page)" disclaimer only matters when more than one page exists.
  const isMultiPage = table.getPageCount() > 1;

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
      const ids = selectedPayments.map((p) => p.name);
      try {
        const result = await submit(ids, dialogAction, rejectionReason);
        setLastFailures(result.failed);

        const succeededCount = result.succeeded.length;
        const failedCount = result.failed.length;

        if (succeededCount > 0) {
          toast({
            title: dialogAction === "approve" ? "Approved" : "Rejected",
            description:
              failedCount > 0
                ? `${succeededCount} succeeded, ${failedCount} failed. See details.`
                : `${succeededCount} payment${succeededCount !== 1 ? "s" : ""} ${dialogAction === "approve" ? "approved" : "rejected"}.`,
            variant: failedCount > 0 ? "default" : "success",
          });
        } else {
          toast({
            title: "No changes",
            description: `All ${failedCount} payment${failedCount !== 1 ? "s" : ""} failed.`,
            variant: "destructive",
          });
        }

        refetch();
        invalidateSidebarCounts();
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
    [dialogAction, count, selectedPayments, submit, toast, refetch, table]
  );

  if (count === 0) {
    return lastFailures.length > 0 ? (
      <FailuresPopover failures={lastFailures} onClear={() => setLastFailures([])} />
    ) : null;
  }

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex h-8 items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 text-sm"
        title={`${count} payment${count !== 1 ? "s" : ""} selected · Total Req. Amount ${formatToRoundedIndianRupee(totalReqAmount)}`}
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
