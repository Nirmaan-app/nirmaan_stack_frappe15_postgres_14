import React, { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";

import { useUserData } from "@/hooks/useUserData";
import { ITM_APPROVE_ROLES, ITM_VIEW_ROLES } from "@/constants/itm";
import { formatDate } from "@/utils/FormatDate";

import { useITR } from "./hooks/useITR";
import { useITMMutations } from "./hooks/useITMMutations";
import { RejectDialog } from "./components/RejectDialog";
import { ITMStatusBadge } from "./components/ITMStatusBadge";

const ITEM_STATUS_STYLES: Record<string, string> = {
  Pending: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
  Approved: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  Rejected: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
};

/**
 * ITR Detail — approval screen for Transfer Requests.
 * Admin selects items → Approve Selected (creates ITMs) or Reject Selected.
 */
export default function ITRDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role, user_id } = useUserData();

  // Read itemFilter from URL at mount time (urlStateManager may not sync with useSearchParams)
  const [itemFilter] = useState<"Pending" | "Rejected" | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const f = params.get("itemFilter");
    return f === "Pending" || f === "Rejected" ? f : null;
  });

  const { data: itr, isLoading, error, mutate } = useITR(id);
  const { approveITRItems, rejectITRItems, isApprovingITR, isRejectingITR } =
    useITMMutations();

  // Fetch project names
  const { data: sourceProjectDoc } = useFrappeGetDoc<{ project_name: string }>(
    "Projects",
    itr?.source_project,
    itr?.source_project ? undefined : null
  );
  const { data: targetProjectDoc } = useFrappeGetDoc<{ project_name: string }>(
    "Projects",
    itr?.target_project,
    itr?.target_project ? undefined : null
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectOpen, setRejectOpen] = useState(false);

  const canView =
    ITM_VIEW_ROLES.includes(role) || user_id === "Administrator";
  const isAdmin =
    ITM_APPROVE_ROLES.includes(role) || user_id === "Administrator";

  const pendingItems = useMemo(
    () => (itr?.items ?? []).filter((r) => r.status === "Pending"),
    [itr?.items]
  );
  const hasPending = pendingItems.length > 0;
  const showActions = isAdmin && hasPending && itemFilter !== "Rejected";

  // Filter items based on tab context
  const filteredItems = useMemo(() => {
    const items = itr?.items ?? [];
    if (itemFilter) return items.filter((r) => r.status === itemFilter);
    return items;
  }, [itr?.items, itemFilter]);

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

  const handleApprove = useCallback(async () => {
    const items = selected.size > 0
      ? Array.from(selected)
      : pendingItems.map((r) => r.name!);
    if (items.length === 0) return;

    try {
      const res = await approveITRItems(itr!.name, items);
      const count = res?.message?.count ?? 0;
      toast({
        title: `${count} transfer memo${count !== 1 ? "s" : ""} created`,
        description: (res?.message?.created_itms ?? []).join(", "),
        variant: "success",
      });
      setSelected(new Set());
      mutate();
    } catch (e: any) {
      toast({
        title: "Approval failed",
        description: e?.message ?? "Something went wrong.",
        variant: "destructive",
      });
    }
  }, [selected, pendingItems, approveITRItems, itr, mutate]);

  const handleReject = useCallback(
    async (reason: string) => {
      const items = selected.size > 0
        ? Array.from(selected)
        : pendingItems.map((r) => r.name!);
      if (items.length === 0) return;

      try {
        await rejectITRItems(itr!.name, items, reason);
        toast({
          title: "Items rejected",
          variant: "success",
        });
        setRejectOpen(false);
        setSelected(new Set());
        mutate();
      } catch (e: any) {
        toast({
          title: "Rejection failed",
          description: e?.message ?? "Something went wrong.",
          variant: "destructive",
        });
      }
    },
    [selected, pendingItems, rejectITRItems, itr, mutate]
  );

  // --- Guards ---
  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>
            You do not have permission to view Transfer Requests.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <TailSpin visible height="40" width="40" color="#D03B45" />
      </div>
    );
  }

  if (error || !itr) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Transfer Request not found</AlertTitle>
          <AlertDescription>
            {(error as any)?.message ?? "The request may have been deleted."}
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/internal-transfer-memos")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to list
        </Button>
      </div>
    );
  }

  const sourceProjectName = sourceProjectDoc?.project_name || itr.source_project;
  const targetProjectName = targetProjectDoc?.project_name || itr.target_project;

  const allSelected =
    selected.size === pendingItems.length && pendingItems.length > 0;

  return (
    <div className="space-y-4 p-4">
      {/* Back */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/internal-transfer-memos")}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Internal Transfer Memos
      </Button>

      {/* Request Details Card */}
      <Card>
        <CardHeader className="pb-3">
          <h3 className="text-red-600 text-lg font-semibold">
            Transfer Request Details
          </h3>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-start">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                Request ID
              </div>
              <div className="text-sm font-semibold mt-1">#{itr.name}</div>
            </div>
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  From
                </div>
                <div className="text-sm font-semibold mt-1 truncate" title={sourceProjectName}>
                  {sourceProjectName}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-4" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  To
                </div>
                <div className="text-sm font-semibold mt-1 truncate" title={targetProjectName}>
                  {targetProjectName}
                </div>
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                Status
              </div>
              <div className="mt-1">
                <ITMStatusBadge status={itr.status} />
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                Total Items
              </div>
              <div className="text-sm font-semibold mt-1">
                {itr.items.length}
              </div>
            </div>
          </div>
          <hr className="border-border" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Created On: </span>
              <span className="font-medium">
                {itr.creation ? formatDate(itr.creation) : "--"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Created By: </span>
              <span className="font-medium">
                {itr.requested_by ?? itr.owner ?? "--"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Memos Created: </span>
              <span className="font-medium">{itr.memo_count ?? 0}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transfer List */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-red-600 text-lg font-semibold">
                Transfer List
              </h3>
            </div>
            {showActions && selected.size === 0 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRejectOpen(true)}
                  disabled={isRejectingITR || isApprovingITR}
                >
                  <X className="h-4 w-4 mr-1" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={handleApprove}
                  disabled={isApprovingITR || isRejectingITR}
                  className="bg-red-600 hover:bg-red-700"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Approve Request
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                {showActions && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((row, idx) => {
                const isPending = row.status === "Pending";
                const isChecked = row.name ? selected.has(row.name) : false;
                return (
                  <TableRow key={row.name ?? `${row.item_id}-${idx}`}>
                    {showActions && (
                      <TableCell>
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() =>
                            row.name && toggleItem(row.name)
                          }
                          disabled={!isPending}
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
                      <Badge
                        variant="outline"
                        className={`border-0 font-medium ${ITEM_STATUS_STYLES[row.status] ?? ""}`}
                      >
                        {row.status}
                      </Badge>
                      {row.status === "Approved" && row.linked_itm && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {row.linked_itm}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Sticky footer when items selected */}
      {showActions && selected.size > 0 && (
        <div className="sticky bottom-0 z-10 flex items-center justify-between rounded-lg border bg-background p-3 shadow-md">
          <span className="text-sm font-medium text-muted-foreground">
            {selected.size} item{selected.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRejectOpen(true)}
              disabled={isRejectingITR}
              className="text-rose-700 hover:text-rose-800"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Reject Selected
            </Button>
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={isApprovingITR}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Approve Selected
            </Button>
          </div>
        </div>
      )}

      {/* Reject dialog */}
      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        onConfirm={handleReject}
        loading={isRejectingITR}
        itmName={itr.name}
      />
    </div>
  );
}
