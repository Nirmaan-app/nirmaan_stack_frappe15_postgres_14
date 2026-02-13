// file: /workspace/development/frappe-bench/apps/nirmaan_stack/frontend/src/pages/ProcurementRequests/ApproveVendorQuotes/ApproveRejectVendorQuotesView.tsx

import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ProcurementActionsHeaderCard } from "@/components/helpers/ProcurementActionsHeaderCard";
import { VendorApprovalTable } from "./components/VendorApprovalTable";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RenderPRorSBComments } from "@/components/helpers/RenderPRorSBComments";
import { SendToBack, ListChecks } from "lucide-react";
import { UseApproveRejectLogicReturn } from "./hooks/useApproveRejectLogic";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments";
import { ConfirmationDialog } from "./components/ConfirmationDialog";
import { DelayedItemsTable } from "./components/DelayedItemsTable";
import {
  ProcurementRequest,
  ProcurementRequestItemDetail,
} from "@/types/NirmaanStack/ProcurementRequests";
import { CEOHoldBanner } from "@/components/ui/ceo-hold-banner";
import { VendorQuotesAttachmentSummaryPR } from "@/components/common/VendorQuotesAttachmentSummaryPR";
import { PaymentTermMilestone } from "../VendorQuotesSelection/types/paymentTerms";
import { useSWRConfig } from "frappe-react-sdk";

interface ApproveRejectVendorQuotesViewProps
  extends UseApproveRejectLogicReturn {
  prComments?: NirmaanComments[];
  getUserName: (id: string | undefined) => string;
  attachment: NirmaanAttachment | null;
  handleAttachmentClick: (url: string) => void;
  prData?: ProcurementRequest;
  isCEOHold?: boolean;
}

export const ApproveRejectVendorQuotesView: React.FC<
  ApproveRejectVendorQuotesViewProps
> = ({
  prData,
  orderData,
  vendorDataSource,
  selectionMap,
  isApproveDialogOpen,
  isSendBackDialogOpen,
  comment,
  isLoading,
  isPrEditable,
  handleSelectionChange,
  handleCommentChange,
  toggleApproveDialog,
  toggleSendBackDialog,
  handleApproveConfirm,
  handleSendBackConfirm,
  getUserName,
  prComments = [],
  attachment,
  handleAttachmentClick,
  setDynamicPaymentTerms, // ✨ RECEIVE the setter function
  isCEOHold = false,
}) => {
  const { mutate } = useSWRConfig();
  const isCustomPr = !orderData?.work_package;
  const sendBackActionText = isCustomPr ? "Reject" : "Send Back";
  const canPerformActions = selectionMap.size > 0 || isCustomPr;

  const delayedItems = React.useMemo(() => {
    return (
      prData?.order_list?.filter(
        (item: ProcurementRequestItemDetail) => item.status === "Delayed"
      ) || []
    );
  }, [prData?.order_list]);

  // ✨ --- CORRECTED PAYMENT TERM PARSING AND TRANSFORMATION --- ✨
  const paymentTermsByVendor = useMemo(() => {
    const paymentTermsString = prData?.payment_terms; // Use prData which has the full doc
    if (
      typeof paymentTermsString !== "string" ||
      paymentTermsString.trim() === ""
    ) {
      return {};
    }

    try {
            const parsedJson = JSON.parse(paymentTermsString);
            const vendorDataList = parsedJson?.list;

            if (typeof vendorDataList !== 'object' || vendorDataList === null) {
                return {};
            }

            // The transformed object will hold an array of milestones, each with the 'type' added.
            const transformedTerms: { [vendorId: string]: (PaymentTermMilestone & { type: string })[] } = {};

            for (const vendorId in vendorDataList) {
                if (Object.prototype.hasOwnProperty.call(vendorDataList, vendorId)) {
                    const vendorInfo = vendorDataList[vendorId];
                    
                    if (vendorInfo && vendorInfo.type && Array.isArray(vendorInfo.terms)) {
                        // Map over the original terms array...
                        transformedTerms[vendorId] = vendorInfo.terms.map(milestone => ({
                            // ...spread the original milestone properties...
                            ...milestone,
                            // ...and add the 'type' from the parent vendorInfo object.
                            type: vendorInfo.type 
                        }));
                    }
                }
            }
            
            return transformedTerms;

        } catch (e) {
            console.error("Failed to parse or transform payment_terms JSON", e);
            return {};
        }
    }, [prData?.payment_terms]);
    
 

  return (
    <div className="flex-1 space-y-4 p-4 md:p-6">
      <div className="space-y-2">
        <h2 className="text-base font-bold tracking-tight">
          Approve/{sendBackActionText} Vendor Quotes
        </h2>
        {orderData && (
          <ProcurementActionsHeaderCard orderData={orderData} po={true} />
        )}
      </div>

      {isCEOHold && <CEOHoldBanner className="mb-4" />}

      <VendorApprovalTable
        dataSource={vendorDataSource}
        onSelectionChange={handleSelectionChange}
        selection={selectionMap}
        paymentTerms={paymentTermsByVendor} // Pass the processed original terms
        onDynamicTermsChange={setDynamicPaymentTerms} // ✨ PASS the setter down
        prId={prData?.name}
        projectId={prData?.project}
        onUploadSuccess={() => mutate(`vendor_quotes_summary_attachments_${prData?.name}`)}
        onDeleteSuccess={() => mutate(`vendor_quotes_summary_attachments_${prData?.name}`)}
        readOnly={true}
      />

      <VendorQuotesAttachmentSummaryPR
        docId={prData?.name || ""}
        selectedVendorIds={Array.from(new Set(vendorDataSource.map(v => v.vendorId)))}
        className="mt-6 border-slate-200"
      />

      {/* ... (Rest of the JSX for actions, comments, dialogs is unchanged) ... */}
      <div className="flex justify-between items-center mt-4">
        {attachment?.attachment ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="max-sm:hidden font-semibold text-muted-foreground">
              Attachment:
            </span>
            <Button
              variant="link"
              className="p-0 h-auto text-blue-600 hover:text-blue-700 underline"
              onClick={() => handleAttachmentClick(attachment.attachment)}
            >
              {attachment.attachment.split("/").pop()}
            </Button>
          </div>
        ) : (
          <div />
        )}
        {isPrEditable && canPerformActions && (
          <div className="flex justify-end gap-2">
            <Button
              onClick={toggleSendBackDialog}
              variant="outline"
              size="sm"
              className="border-destructive text-destructive hover:bg-destructive/10 flex items-center gap-1"
              disabled={isLoading}
            >
              <SendToBack className="w-4 h-4" />
              {sendBackActionText}
            </Button>
            <Button
              onClick={toggleApproveDialog}
              variant="default"
              size="sm"
              className="flex gap-1 items-center"
              disabled={isLoading || selectionMap.size === 0}
            >
              <ListChecks className="h-4 w-4" />
              Approve
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-2 pt-4">
        <h2 className="text-base font-bold tracking-tight">
          Procurement Comments
        </h2>
        <RenderPRorSBComments
          universalComment={prComments}
          getUserName={getUserName}
        />
      </div>
      {orderData?.work_package && (
        <div className="space-y-2 pt-4">
          <h2 className="text-base font-bold tracking-tight">Delayed Items</h2>
          <DelayedItemsTable items={delayedItems} />
        </div>
      )}
      <ConfirmationDialog
        isOpen={isSendBackDialogOpen}
        onClose={toggleSendBackDialog}
        onConfirm={handleSendBackConfirm}
        isLoading={isLoading}
        title={`Confirm ${sendBackActionText}?`}
        confirmText={`Confirm ${sendBackActionText}`}
        confirmVariant="destructive"
        cancelText="Cancel"
      >
        <div className="py-2 space-y-2">
          <Label htmlFor="sendback-comment">Comment (Optional):</Label>
          <Textarea
            id="sendback-comment"
            value={comment}
            placeholder="Reason for sending back/rejecting..."
            onChange={handleCommentChange}
            rows={3}
          />
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          Selected items will be marked for reconsideration or the custom PR
          will be rejected.
        </p>
      </ConfirmationDialog>
      <ConfirmationDialog
        isOpen={isApproveDialogOpen}
        onClose={toggleApproveDialog}
        onConfirm={handleApproveConfirm}
        isLoading={isLoading}
        title="Confirm Approval?"
        confirmText="Confirm Approval"
        confirmVariant="default"
        cancelText="Cancel"
      >
        <p className="text-sm text-muted-foreground">
          Approving the selected items will generate Purchase Orders for the
          chosen vendors. Please review selections carefully.
        </p>
      </ConfirmationDialog>
    </div>
  );
};

