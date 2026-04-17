import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check, CheckCheck, X, XCircle } from "lucide-react";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import type { InternalTransferMemoItem } from "@/types/NirmaanStack/InternalTransferMemo";

interface TransferListTableProps {
  items: InternalTransferMemoItem[] | undefined;
  memoStatus: string;
  isAdmin: boolean;
  onApproveItems?: (
    items: { item_name: string; action: "approve" | "reject"; reason?: string }[]
  ) => Promise<void>;
  isSubmitting?: boolean;
}

const ITEM_STATUS_STYLES: Record<string, string> = {
  Pending: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
  Approved: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  Rejected: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
};

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

/**
 * Interactive items table for the ITM detail view.
 *
 * Supports bulk selection and approve/reject actions for admin users
 * when the memo has pending items.
 */
export const TransferListTable: React.FC<TransferListTableProps> = ({
  items,
  memoStatus,
  isAdmin,
  onApproveItems,
  isSubmitting = false,
}) => {
  const rows = items ?? [];

  const pendingItems = useMemo(
    () => rows.filter((r) => !r.status || r.status === "Pending"),
    [rows]
  );

  const hasPendingItems = pendingItems.length > 0;
  const showCheckboxes = isAdmin && hasPendingItems && memoStatus === "Pending Approval";

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Clear selection when items change (e.g. after mutation)
  const itemKey = rows.map((r) => `${r.name}-${r.status}`).join(",");
  useEffect(() => {
    setSelected(new Set());
  }, [itemKey]);

  const toggleItem = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === pendingItems.length) return new Set();
      return new Set(pendingItems.map((r) => r.name!));
    });
  }, [pendingItems]);

  const handleApproveSelected = useCallback(async () => {
    if (!onApproveItems || selected.size === 0) return;
    const batch = Array.from(selected).map((item_name) => ({
      item_name,
      action: "approve" as const,
    }));
    await onApproveItems(batch);
  }, [onApproveItems, selected]);

  const handleApproveAll = useCallback(async () => {
    if (!onApproveItems || pendingItems.length === 0) return;
    const batch = pendingItems.map((r) => ({
      item_name: r.name!,
      action: "approve" as const,
    }));
    await onApproveItems(batch);
  }, [onApproveItems, pendingItems]);

  const openRejectDialog = useCallback(() => {
    setRejectReason("");
    setRejectError(null);
    setRejectDialogOpen(true);
  }, []);

  const handleRejectConfirm = useCallback(async () => {
    const trimmed = rejectReason.trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      setRejectError(`Please provide at least ${MIN_REASON_LENGTH} characters.`);
      return;
    }
    if (!onApproveItems) return;

    // If items are selected, reject those; otherwise reject all pending
    const targetItems =
      selected.size > 0
        ? Array.from(selected)
        : pendingItems.map((r) => r.name!);

    const batch = targetItems.map((item_name) => ({
      item_name,
      action: "reject" as const,
      reason: trimmed,
    }));
    await onApproveItems(batch);
    setRejectDialogOpen(false);
  }, [onApproveItems, rejectReason, selected, pendingItems]);

  const handleRejectReasonChange = useCallback(
    (val: string) => {
      setRejectReason(val.slice(0, MAX_REASON_LENGTH));
      if (rejectError) setRejectError(null);
    },
    [rejectError]
  );

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No items in this transfer.
      </div>
    );
  }

  const trimmedLength = rejectReason.trim().length;
  const canSubmitReject = trimmedLength >= MIN_REASON_LENGTH && !isSubmitting;
  const allPendingSelected = selected.size === pendingItems.length && pendingItems.length > 0;

  return (
    <TooltipProvider>
      <div className="space-y-0">
        {/* Bulk actions header */}
        {showCheckboxes && (
          <div className="flex flex-wrap items-center justify-end gap-2 pb-3">
            <Button
              size="sm"
              variant="outline"
              onClick={handleApproveAll}
              disabled={isSubmitting}
              className="text-emerald-700 hover:text-emerald-800"
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              Approve All
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={openRejectDialog}
              disabled={isSubmitting}
              className="text-rose-700 hover:text-rose-800"
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Reject All
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                {showCheckboxes && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allPendingSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all pending items"
                    />
                  </TableHead>
                )}
                <TableHead className="text-[11px] uppercase tracking-wide font-semibold">
                  Item Name
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-wide font-semibold w-24">
                  Unit
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-wide font-semibold w-36 text-right">
                  Transfer Qty
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-wide font-semibold w-32 text-center">
                  Status
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-wide font-semibold w-36 text-right">
                  Est Rate
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, idx) => {
                const itemStatus = row.status ?? "Pending";
                const isPending = itemStatus === "Pending";
                const isChecked = row.name ? selected.has(row.name) : false;
                const isRejected = itemStatus === "Rejected";

                return (
                  <TableRow key={row.name ?? `${row.item_id}-${idx}`}>
                    {showCheckboxes && (
                      <TableCell>
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => row.name && toggleItem(row.name)}
                          disabled={!isPending}
                          aria-label={`Select ${row.item_name ?? row.item_id}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{row.item_name ?? row.item_id}</span>
                        {row.make && (
                          <span className="text-xs text-muted-foreground">
                            Make: {row.make}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.unit ?? "--"}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {row.transfer_quantity}
                    </TableCell>
                    <TableCell className="text-center">
                      {isRejected && row.rejection_reason ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-help">
                              <Badge
                                variant="outline"
                                className={`border-0 font-medium ${ITEM_STATUS_STYLES[itemStatus] ?? ""}`}
                              >
                                {itemStatus}
                              </Badge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs">{row.rejection_reason}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Badge
                          variant="outline"
                          className={`border-0 font-medium ${ITEM_STATUS_STYLES[itemStatus] ?? ""}`}
                        >
                          {itemStatus}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.estimated_rate != null
                        ? formatToRoundedIndianRupee(row.estimated_rate)
                        : "--"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Sticky footer bar when items are selected */}
        {showCheckboxes && selected.size > 0 && (
          <div className="sticky bottom-0 z-10 mt-3 flex items-center justify-between rounded-lg border bg-background p-3 shadow-md">
            <span className="text-sm font-medium text-muted-foreground">
              {selected.size} item{selected.size !== 1 ? "s" : ""} selected
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={openRejectDialog}
                disabled={isSubmitting}
                className="text-rose-700 hover:text-rose-800"
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Reject Selected
              </Button>
              <Button
                size="sm"
                onClick={handleApproveSelected}
                disabled={isSubmitting}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                Approve Selected
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Reject reason dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Reject Items</DialogTitle>
            <DialogDescription>
              {selected.size > 0
                ? `Rejecting ${selected.size} selected item${selected.size !== 1 ? "s" : ""}.`
                : `Rejecting all ${pendingItems.length} pending item${pendingItems.length !== 1 ? "s" : ""}.`}{" "}
              Please provide a reason.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="itm-item-reject-reason" className="text-sm font-medium">
              Reason for rejection
              <span className="text-destructive ml-1">*</span>
            </Label>
            <Textarea
              id="itm-item-reject-reason"
              value={rejectReason}
              onChange={(e) => handleRejectReasonChange(e.target.value)}
              placeholder="Explain why these items are being rejected..."
              rows={4}
              className={rejectError ? "border-destructive focus-visible:ring-destructive" : ""}
              disabled={isSubmitting}
            />
            <div className="flex items-center justify-between text-xs">
              <span className={rejectError ? "text-destructive" : "text-muted-foreground"}>
                {rejectError
                  ? rejectError
                  : trimmedLength < MIN_REASON_LENGTH
                    ? `Minimum ${MIN_REASON_LENGTH} characters`
                    : " "}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {rejectReason.length} / {MAX_REASON_LENGTH} chars
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRejectDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectConfirm}
              disabled={!canSubmitReject}
            >
              {isSubmitting ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
};

export default TransferListTable;
