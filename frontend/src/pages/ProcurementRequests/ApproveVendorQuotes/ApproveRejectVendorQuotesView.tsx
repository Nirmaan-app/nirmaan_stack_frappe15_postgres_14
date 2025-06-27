import React from 'react';
import { Button } from "@/components/ui/button";
import { ProcurementActionsHeaderCard } from "@/components/helpers/ProcurementActionsHeaderCard"; // Adjust path
import { VendorApprovalTable } from './components/VendorApprovalTable';
import { Textarea } from '@/components/ui/textarea'; // Adjust path
import { Label } from '@/components/ui/label'; // Adjust path
import { RenderPRorSBComments } from '@/components/helpers/RenderPRorSBComments'; // Adjust path

import { SendToBack, ListChecks } from 'lucide-react';
import { UseApproveRejectLogicReturn } from './hooks/useApproveRejectLogic'; // Import return type
import { NirmaanAttachment } from '@/types/NirmaanStack/NirmaanAttachment'; // Adjust path
import { NirmaanComments } from '@/types/NirmaanStack/NirmaanComments'; // Adjust path
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { DelayedItemsTable } from './components/DelayedItemsTable';
import { ProcurementItem, ProcurementRequest, ProcurementRequestItemDetail } from '@/types/NirmaanStack/ProcurementRequests';

// Define props based on the Logic Hook's return type + any extras from container
interface ApproveRejectVendorQuotesViewProps extends UseApproveRejectLogicReturn {
    // Add props passed directly from container if any
    prComments?: NirmaanComments[];
    getUserName: (id: string | undefined) => string; // Keep if needed for comments
    attachment: NirmaanAttachment | null;
    handleAttachmentClick: (url: string) => void;
    prData?: ProcurementRequest
}

export const ApproveRejectVendorQuotesView: React.FC<ApproveRejectVendorQuotesViewProps> = ({
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
    // getVendorName, // Keep if needed by header/comments
    getUserName,
    prComments = [],
    attachment,
    handleAttachmentClick,
    // Other props from logic hook if needed...
}) => {

    const isCustomPr = !orderData?.work_package;
    const sendBackActionText = isCustomPr ? "Reject" : "Send Back";
    const canPerformActions = selectionMap.size > 0 || isCustomPr; // Enable actions if selection exists OR it's a custom PR (for reject)

    // --- Delayed Items calculation ---
    // This could also be moved to the logic hook if complex
    const delayedItems = React.useMemo(() => {
        // const fullList = (typeof prData?.procurement_list === "string" ? JSON.parse(prData?.procurement_list) : prData?.procurement_list)?.list;
        return prData?.order_list?.filter(
            (item: ProcurementRequestItemDetail) => item.status === "Delayed"
        ) || [];
    }, [prData?.order_list]); // Depend on the full order_list from the initially fetched prData

    const ParsedPayment_terms=JSON.parse(orderData?.payment_terms)
    console.log("orderData", ParsedPayment_terms.list)

    return (
        <div className="flex-1 space-y-4 p-4 md:p-6">
            {/* Header */}
            <div className='space-y-2'>
                <h2 className="text-base font-bold tracking-tight">Approve/{sendBackActionText} Vendor Quotes</h2>
                {orderData && <ProcurementActionsHeaderCard orderData={orderData} po={true} />}
            </div>

            {/* Vendor Approval Table */}
            <VendorApprovalTable
                dataSource={vendorDataSource}
                onSelectionChange={handleSelectionChange}
                selection={selectionMap}
                paymentTerms={ParsedPayment_terms.list||[]}
            // Pass initial selection if needed
            />

            {/* Footer Actions & Attachment */}
            <div className='flex justify-between items-center mt-4'>
                {/* Attachment Link */}
                {attachment?.attachment ? (
                    <div className="flex items-center gap-2 text-sm">
                        <span className='max-sm:hidden font-semibold text-muted-foreground'>Attachment:</span>
                        <Button
                            variant="link"
                            className="p-0 h-auto text-blue-600 hover:text-blue-700 underline"
                            onClick={() => handleAttachmentClick(attachment.attachment)}
                        >
                            {attachment.attachment.split('/').pop()}
                        </Button>
                    </div>
                ) : <div />} {/* Placeholder */}

                {/* Action Buttons */}
                {isPrEditable && canPerformActions && (
                    <div className="flex justify-end gap-2">
                        <Button
                            onClick={toggleSendBackDialog}
                            variant="outline"
                            size="sm"
                            className="border-destructive text-destructive hover:bg-destructive/10 flex items-center gap-1"
                            disabled={isLoading}
                        >
                            <SendToBack className='w-4 h-4' />
                            {sendBackActionText}
                        </Button>
                        <Button
                            onClick={toggleApproveDialog}
                            variant="default" // Or outline with primary colors
                            size="sm"
                            className='flex gap-1 items-center'
                            disabled={isLoading || selectionMap.size === 0} // Disable approve if nothing selected
                        >
                            <ListChecks className="h-4 w-4" />
                            Approve
                        </Button>
                    </div>
                )}
            </div>

            {/* Comments Section */}
            <div className='space-y-2 pt-4'>
                <h2 className="text-base font-bold tracking-tight">Procurement Comments</h2>
                <RenderPRorSBComments universalComment={prComments} getUserName={getUserName} />
            </div>

            {/* Delayed Items Section (Conditional) */}
            {orderData?.work_package && (
                <div className='space-y-2 pt-4'>
                    <h2 className="text-base font-bold tracking-tight">Delayed Items</h2>
                    <DelayedItemsTable items={delayedItems} /> {/* Use dedicated component */}
                </div>
            )}


            {/* Dialogs */}
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
                {/* Content specific to Send Back */}
                <div className='py-2 space-y-2'>
                    <Label htmlFor="sendback-comment">Comment (Optional):</Label>
                    <Textarea
                        id="sendback-comment"
                        value={comment}
                        placeholder="Reason for sending back/rejecting..."
                        onChange={handleCommentChange}
                        rows={3}
                    />
                </div>
                <p className='text-sm text-muted-foreground mt-2'>
                    Selected items will be marked for reconsideration or the custom PR will be rejected.
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
                {/* Content specific to Approve */}
                <p className='text-sm text-muted-foreground'>
                    Approving the selected items will generate Purchase Orders for the chosen vendors. Please review selections carefully.
                </p>
                {/* Optional: Could display a summary of POs to be generated here */}
            </ConfirmationDialog>

        </div>
    );
};