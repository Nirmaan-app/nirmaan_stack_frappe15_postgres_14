import React, { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  MessageSquareWarning,
  PackageCheck,
  Trash2,
  X,
} from "lucide-react";
import { TailSpin } from "react-loader-spinner";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";

import { useUserData } from "@/hooks/useUserData";
import {
  ITM_APPROVE_ROLES,
  ITM_DELETE_ROLES,
  ITM_VIEW_ROLES,
} from "@/constants/itm";

import { useITM } from "./hooks/useITM";
import { useITMMutations } from "./hooks/useITMMutations";
import { TransferDetailsCard } from "./components/TransferDetailsCard";
import { TransferListTable } from "./components/TransferListTable";
import { RejectDialog } from "./components/RejectDialog";
import { ApproveConfirmDialog } from "./components/ApproveConfirmDialog";
import { DeleteConfirmDialog } from "./components/DeleteConfirmDialog";
import { ITMDeliverySection } from "./components/ITMDeliverySection";

/**
 * Statuses after which an ITM cannot be deleted. Mirrors the backend
 * `before_delete` guard in `internal_transfer_memo` controller.
 */
const DISPATCHED_OR_LATER = new Set([
  "Dispatched",
  "Partially Delivered",
  "Delivered",
]);

const DN_VISIBLE_STATUSES = new Set([
  "Dispatched",
  "Partially Delivered",
  "Delivered",
]);

/**
 * ITMDetail — approval screen per Image #4.
 *
 * Orchestration only; presentation is delegated to TransferDetailsCard /
 * TransferListTable / the three confirmation dialogs. Role-gated at the page
 * level (redirect if not in ITM_VIEW_ROLES) and at the action-button level
 * via the state x role matrix.
 */
export const ITMDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role, user_id } = useUserData();

  const { data, isLoading, error, mutate } = useITM(id);
  const {
    approve,
    reject,
    approveItems,
    dispatch,
    deleteItm,
    isApproving,
    isRejecting,
    isApprovingItems,
    isDispatching,
    isDeleting,
  } = useITMMutations();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);

  const payload = data?.message;
  const itm = payload?.itm;

  // --- Role gating -----------------------------------------------------
  const canView = useMemo(
    () => ITM_VIEW_ROLES.includes(role) || user_id === "Administrator",
    [role, user_id]
  );

  const isAdmin = useMemo(
    () => ITM_APPROVE_ROLES.includes(role) || user_id === "Administrator",
    [role, user_id]
  );

  const canDelete = useMemo(() => {
    if (!itm) return false;
    if (isAdmin) return true;
    if (ITM_DELETE_ROLES.includes(role)) return true;
    // Creator may delete their own pre-dispatch doc.
    return itm.owner === user_id || itm.requested_by === user_id;
  }, [isAdmin, itm, role, user_id]);

  // --- State-derived flags --------------------------------------------
  const status = itm?.status;
  const isPendingApproval = status === "Pending Approval";
  const isRejected = status === "Rejected";
  const isDispatchedOrLater = status ? DISPATCHED_OR_LATER.has(status) : false;
  const showDNSection = status ? DN_VISIBLE_STATUSES.has(status) : false;

  const hasApprovedItems = useMemo(() => {
    if (!itm?.items) return false;
    return itm.items.some((item) => item.status === "Approved");
  }, [itm?.items]);

  const pendingItemCount = useMemo(() => {
    if (!itm?.items) return 0;
    return itm.items.filter(
      (item) => !item.status || item.status === "Pending"
    ).length;
  }, [itm?.items]);

  const showApprovalActions = isPendingApproval && isAdmin;
  const showDeleteAction = !!itm && canDelete && !isDispatchedOrLater;
  const showDispatchButton =
    isAdmin && hasApprovedItems && !isDispatchedOrLater;

  // --- Handlers --------------------------------------------------------
  const runMutation = async (
    action: () => Promise<unknown>,
    opts: {
      successTitle: string;
      successDesc: string;
      failTitle: string;
      onSuccess: () => void;
    }
  ) => {
    if (!itm) return;
    try {
      await action();
      toast({
        title: opts.successTitle,
        description: opts.successDesc,
        variant: "success",
      });
      opts.onSuccess();
    } catch (e: any) {
      toast({
        title: opts.failTitle,
        description: e?.message ?? "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  const handleApprove = () =>
    runMutation(() => approve(itm!.name), {
      successTitle: "Request approved",
      successDesc: `${itm!.name} has been approved.`,
      failTitle: "Approval failed",
      onSuccess: () => {
        setApproveOpen(false);
        mutate();
      },
    });

  const handleReject = (reason: string) =>
    runMutation(() => reject(itm!.name, reason), {
      successTitle: "Request rejected",
      successDesc: `${itm!.name} has been rejected.`,
      failTitle: "Rejection failed",
      onSuccess: () => {
        setRejectOpen(false);
        mutate();
      },
    });

  const handleDelete = () =>
    runMutation(() => deleteItm(itm!.name), {
      successTitle: "Deleted",
      successDesc: `${itm!.name} has been deleted.`,
      failTitle: "Delete failed",
      onSuccess: () => {
        setDeleteOpen(false);
        navigate("/internal-transfer-memos");
      },
    });

  const handleApproveItems = useCallback(
    async (
      items: {
        item_name: string;
        action: "approve" | "reject";
        reason?: string;
      }[]
    ) => {
      if (!itm) return;
      try {
        await approveItems(itm.name, items);
        toast({
          title: "Items updated",
          description: `${items.length} item${items.length !== 1 ? "s" : ""} ${items[0].action === "approve" ? "approved" : "rejected"}.`,
          variant: "success",
        });
        mutate();
      } catch (e: any) {
        toast({
          title: "Item action failed",
          description: e?.message ?? "Something went wrong.",
          variant: "destructive",
        });
      }
    },
    [itm, approveItems, mutate]
  );

  const handleDispatch = () =>
    runMutation(() => dispatch(itm!.name), {
      successTitle: "Dispatched",
      successDesc: `${itm!.name} has been dispatched.`,
      failTitle: "Dispatch failed",
      onSuccess: () => {
        setDispatchOpen(false);
        mutate();
      },
    });

  // --- Render guards ---------------------------------------------------
  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>
            You do not have permission to view Internal Transfer Memos.
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

  if (error || !payload || !itm) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Internal Transfer Memo not found</AlertTitle>
          <AlertDescription>
            {(error as any)?.message ??
              "The request may have been deleted, or you may not have access."}
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

  return (
    <div className="space-y-4 p-4">
      {/* Back breadcrumb */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/internal-transfer-memos")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Internal Transfer Memos
        </Button>
      </div>

      <TransferDetailsCard
        itm={itm}
        sourceProjectName={payload.source_project_name}
        targetProjectName={payload.target_project_name}
        createdByFullName={payload.requested_by_full_name}
      />

      {/* Rejection reason banner -- only when the doc carries one */}
      {isRejected && itm.rejection_reason && (
        <Alert variant="destructive">
          <MessageSquareWarning className="h-4 w-4" />
          <AlertTitle>Rejected</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">
            {itm.rejection_reason}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-red-600 text-lg font-semibold">
              Transfer List
            </h3>
            <div className="flex gap-2">
              {showApprovalActions && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setRejectOpen(true)}
                    disabled={isRejecting || isApproving}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Reject
                  </Button>
                  <Button
                    onClick={() => setApproveOpen(true)}
                    disabled={isApproving || isRejecting}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Approve Request
                  </Button>
                </>
              )}
              {showDispatchButton && (
                <Button
                  onClick={() => setDispatchOpen(true)}
                  disabled={isDispatching}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <PackageCheck className="h-4 w-4 mr-1" />
                  Dispatch
                </Button>
              )}
              {showDeleteAction && (
                <Button
                  variant="outline"
                  onClick={() => setDeleteOpen(true)}
                  disabled={isDeleting}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <TransferListTable
            items={itm.items}
            memoStatus={itm.status}
            isAdmin={isAdmin}
            onApproveItems={handleApproveItems}
            isSubmitting={isApprovingItems}
          />
        </CardContent>
      </Card>

      {/* Delivery Notes accordion */}
      {showDNSection && (
        <Accordion type="single" collapsible defaultValue="">
          <AccordionItem value="delivery-notes" className="border rounded-lg">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex items-center gap-2">
                <span className="text-red-600 text-lg font-semibold">
                  Delivery Notes
                </span>
                <Badge
                  variant="outline"
                  className="border-0 bg-slate-100 text-slate-700 font-medium"
                >
                  {itm.status === "Delivered"
                    ? "Complete"
                    : itm.status === "Partially Delivered"
                      ? "In Progress"
                      : "Pending"}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <ITMDeliverySection
                itmName={itm.name}
                itmStatus={itm.status}
                targetProject={itm.target_project}
                items={itm.items}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* Dialogs -- mounted unconditionally so open-state transitions animate. */}
      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        onConfirm={handleReject}
        loading={isRejecting}
        itmName={itm.name}
      />
      <ApproveConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        onConfirm={handleApprove}
        loading={isApproving}
      />
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        loading={isDeleting}
        itmName={itm.name}
      />

      {/* Dispatch confirmation dialog */}
      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Dispatch Transfer</DialogTitle>
            <DialogDescription>
              Dispatch {itm.name} to mark approved items as in transit.
            </DialogDescription>
          </DialogHeader>

          {pendingItemCount > 0 && (
            <Alert variant="destructive" className="my-2">
              <MessageSquareWarning className="h-4 w-4" />
              <AlertTitle>Pending items</AlertTitle>
              <AlertDescription>
                {pendingItemCount} pending item
                {pendingItemCount !== 1 ? "s" : ""} will be auto-rejected upon
                dispatch.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDispatchOpen(false)}
              disabled={isDispatching}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDispatch}
              disabled={isDispatching}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isDispatching ? "Dispatching..." : "Confirm Dispatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ITMDetail;
