import React, { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CirclePlus, Upload } from "lucide-react";

import { DeliveryChallanTable } from "@/pages/ProcurementOrders/invoices-and-dcs/components/DeliveryChallanTable";
import { UploadDCMIRDialog } from "@/pages/DeliveryChallansAndMirs/components/UploadDCMIRDialog";
import { usePODeliveryDocuments } from "@/pages/DeliveryChallansAndMirs/hooks/usePODeliveryDocuments";

import { ITM_VIEW_ROLES } from "@/constants/itm";
import { useUserData } from "@/hooks/useUserData";

import type { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";
import type { InternalTransferMemoItem } from "@/types/NirmaanStack/InternalTransferMemo";

interface ITMAttachmentSectionProps {
  itmName: string;
  itmStatus: string;
  targetProject: string;
  items: InternalTransferMemoItem[];
}

interface UploadDialogState {
  open: boolean;
  mode: "create" | "edit";
  dcType: "Delivery Challan" | "Material Inspection Report";
  existingDoc?: PODeliveryDocuments;
}

const CLOSED: UploadDialogState = {
  open: false,
  mode: "create",
  dcType: "Delivery Challan",
};

/**
 * ITM Attachment card — DC + MIR upload + listing for an ITM.
 *
 * Mirrors the PO Attachment "Delivery Challans & MIRs" card on the PO detail page,
 * anchored to an Internal Transfer Memo via parent_doctype polymorphism.
 *
 * - The CARD itself is rendered whenever `canView`, so historical DCs/MIRs remain
 *   visible at every ITM status (including Approved / Dispatched / future closed
 *   states).
 * - The UPLOAD BUTTONS are gated by `canUpload` (status ∈ {Partially Delivered,
 *   Delivered}), mirroring PO's `showDcTable` gate at DocumentAttachments.tsx:625.
 */
export const ITMAttachmentSection: React.FC<ITMAttachmentSectionProps> = ({
  itmName,
  itmStatus,
  targetProject,
  items,
}) => {
  const { role, user_id } = useUserData();
  const [dialog, setDialog] = useState<UploadDialogState>(CLOSED);

  const canView = useMemo(
    () => ITM_VIEW_ROLES.includes(role) || user_id === "Administrator",
    [role, user_id]
  );

  // Mirror PO upload-button gate (DocumentAttachments.tsx:625):
  // showDcTable = status ∈ {"Delivered", "Partially Delivered"}.
  const canUpload = itmStatus === "Partially Delivered" || itmStatus === "Delivered";

  const { data: documents, isLoading, mutate } = usePODeliveryDocuments(
    canView ? itmName : null,
    "Internal Transfer Memo"
  );

  const itemsForSelector = useMemo(
    () =>
      items.map((item) => ({
        item_id: item.item_id,
        item_name: item.item_name || item.item_id,
        unit: item.unit || "",
        category: item.category,
        make: item.make,
      })),
    [items]
  );

  if (!canView) return null;

  const handleOpenUpload = (type: "DC" | "MIR") => {
    setDialog({
      open: true,
      mode: "create",
      dcType: type === "DC" ? "Delivery Challan" : "Material Inspection Report",
    });
  };

  const handleEdit = (doc: PODeliveryDocuments) => {
    setDialog({
      open: true,
      mode: "edit",
      dcType: doc.type,
      existingDoc: doc,
    });
  };

  const docCount = documents?.length ?? 0;

  return (
    <>
      <Card className="rounded-md shadow-sm border border-gray-200 overflow-hidden">
        <CardHeader className="border-b border-gray-200">
          <CardTitle className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <p className="text-lg font-semibold text-red-600">
                Delivery Challans &amp; MIRs
              </p>
              <Badge variant="secondary" className="text-sm">
                {docCount}
              </Badge>
            </div>
            {canUpload && (
              <div className="flex gap-2 items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenUpload("DC")}
                  className="text-primary border-primary hover:bg-primary/5"
                  aria-label="Upload Delivery Challan"
                >
                  <CirclePlus className="h-4 w-4 mr-1" aria-hidden="true" />
                  Upload DC
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenUpload("MIR")}
                  className="text-primary border-primary hover:bg-primary/5"
                  aria-label="Upload Material Inspection Report"
                >
                  <Upload className="h-4 w-4 mr-1" aria-hidden="true" />
                  Upload MIR
                </Button>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-4 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <DeliveryChallanTable
                documents={documents || []}
                onEdit={canUpload ? handleEdit : undefined}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <UploadDCMIRDialog
        open={dialog.open}
        onOpenChange={(open) => {
          if (!open) setDialog(CLOSED);
        }}
        mode={dialog.mode}
        dcType={dialog.dcType}
        poName={itmName}
        poDisplayName={itmName}
        poProject={targetProject}
        poVendor=""
        poItems={itemsForSelector}
        existingDoc={dialog.existingDoc}
        parentDoctype="Internal Transfer Memo"
        onSuccess={() => mutate()}
      />
    </>
  );
};
