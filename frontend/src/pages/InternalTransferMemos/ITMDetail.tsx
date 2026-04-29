import React, { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";

import { useUserData } from "@/hooks/useUserData";
import { ITM_APPROVE_ROLES, ITM_DISPATCH_ROLES, ITM_VIEW_ROLES } from "@/constants/itm";

import { useITM } from "./hooks/useITM";
import { useITMMutations } from "./hooks/useITMMutations";
import { TransferDetailsCard } from "./components/TransferDetailsCard";
import { TransferListTable } from "./components/TransferListTable";
import { ITMDispatchSheet } from "./components/ITMDispatchSheet";
import { ITMDeliverySection } from "./components/ITMDeliverySection";

const DISPATCHED_STATUSES = new Set([
  "Dispatched",
  "Partially Delivered",
  "Delivered",
]);

/**
 * ITMDetail — dispatch + delivery screen.
 *
 * ITMs are always in "Approved" or later status (created by ITR approval).
 * No approval actions here — just dispatch and delivery note management.
 */
export const ITMDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role, user_id } = useUserData();

  const { data, isLoading, error, mutate } = useITM(id);
  const { dispatch, isDispatching } = useITMMutations();

  const [dispatchSheetOpen, setDispatchSheetOpen] = useState(false);

  const payload = data?.message;
  const itm = payload?.itm;

  const canView = useMemo(
    () => ITM_VIEW_ROLES.includes(role) || user_id === "Administrator",
    [role, user_id]
  );

  const isAdmin = useMemo(
    () => ITM_APPROVE_ROLES.includes(role) || user_id === "Administrator",
    [role, user_id]
  );

  // Dispatch authority is broader than admin: Admin + Procurement Executive can
  // dispatch (see ITM_DISPATCH_ROLES). Approve/reject stays Admin-only via isAdmin.
  const canDispatch = useMemo(
    () => ITM_DISPATCH_ROLES.includes(role) || user_id === "Administrator",
    [role, user_id]
  );

  const status = itm?.status;
  const isApproved = status === "Approved";
  const isDispatched = status ? DISPATCHED_STATUSES.has(status) : false;
  const showDispatchButton = isApproved && canDispatch;

  // --- Render guards ---
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
      <TransferDetailsCard
        itm={itm}
        sourceProjectName={payload.source_project_name}
        targetProjectName={payload.target_project_name}
        createdByFullName={payload.requested_by_full_name}
        showDispatchButton={showDispatchButton}
        onMarkDispatched={() => setDispatchSheetOpen(true)}
      />

      {/* Transfer List */}
      <Card>
        <CardHeader className="pb-3">
          <h3 className="text-red-600 text-lg font-semibold">Transfer List</h3>
        </CardHeader>
        <CardContent>
          <TransferListTable
            items={itm.items}
            memoStatus={itm.status}
            isAdmin={isAdmin}
          />
        </CardContent>
      </Card>

      {/* Delivery Notes section — visible after dispatch */}
      {isDispatched && (
        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-red-600 text-lg font-semibold">
              Delivery Notes
            </h3>
          </CardHeader>
          <CardContent>
            <ITMDeliverySection
              itmName={itm.name}
              itmStatus={itm.status}
              targetProject={itm.target_project}
              items={itm.items}
              onDNCreated={() => mutate()}
            />
          </CardContent>
        </Card>
      )}

      {/* Dispatch Sheet */}
      {itm.items && (
        <ITMDispatchSheet
          open={dispatchSheetOpen}
          onOpenChange={setDispatchSheetOpen}
          itmName={itm.name}
          itmItems={itm.items}
          onSuccess={() => mutate()}
        />
      )}
    </div>
  );
};

export default ITMDetail;
