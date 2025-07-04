import React,{useMemo} from 'react';
import { Button } from "@/components/ui/button"; // Adjust path
import { ProcurementActionsHeaderCard } from "@/components/helpers/ProcurementActionsHeaderCard"; // Adjust path
import { Textarea } from '@/components/ui/textarea'; // Adjust path
import { Label } from '@/components/ui/label'; // Adjust path
import { RenderPRorSBComments } from '@/components/helpers/RenderPRorSBComments'; // Adjust path
import { SendToBack, ListChecks } from 'lucide-react';
import { UseApproveSBSLogicReturn } from './hooks/useApproveSBSLogic'; // Import SB return type
import { NirmaanComments } from '@/types/NirmaanStack/NirmaanComments'; // Adjust path
import { VendorApprovalTable } from '../ProcurementRequests/ApproveVendorQuotes/components/VendorApprovalTable';
import { ConfirmationDialog } from '../ProcurementRequests/ApproveVendorQuotes/components/ConfirmationDialog';

// Define props based on the Logic Hook's return type + any extras from container
interface ApproveSBSQuotesViewProps extends UseApproveSBSLogicReturn {
    // Add props passed directly from container if any
    sbComments?: NirmaanComments[];
    getUserName: (id: string | undefined) => string;
}

export const ApproveSBSQuotesView: React.FC<ApproveSBSQuotesViewProps> = ({
    sentBackData, // Renamed from orderData
    vendorDataSource,
    selectionMap,
    isApproveDialogOpen,
    isSendBackDialogOpen,
    comment,
    isLoading,
    isSbEditable, // Renamed from isPrEditable
    handleSelectionChange,
    handleCommentChange,
    toggleApproveDialog,
    toggleSendBackDialog,
    handleApproveConfirm,
    handleSendBackConfirm,
    // getVendorName, // May not be needed directly in view if header handles it
    sbComments = [],
    getUserName,
  setDynamicPaymentTerms, // ✨ RECEIVE the setter function

}) => {

    // Can only perform actions if editable and selection exists
    const canPerformActions = isSbEditable && selectionMap.size > 0;
  // ✨ --- CORRECTED PAYMENT TERM PARSING AND TRANSFORMATION --- ✨
  const paymentTermsByVendor = useMemo(() => {
    const paymentTermsString = sentBackData?.payment_terms; // Use sentBackData which has the full doc
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
    }, [sentBackData?.payment_terms]);
    
 
    return (
        <div className="flex-1 space-y-4 p-4 md:p-6">
            {/* Header */}
            <div className='space-y-2'>
                <h2 className="text-base font-bold tracking-tight">Approve/Send Back Vendor Quotes (Sent Back Items)</h2>
                {/* Adapt Header Card for SentBackCategory data */}
                {sentBackData && (
                    <ProcurementActionsHeaderCard
                        // Map SentBackCategory fields to what the header expects
                        // orderData={{
                        //     name: sentBackData.name,
                        //     project: sentBackData.project,
                        //     creation: sentBackData.creation,
                        //     owner: sentBackData.owner,
                        //     status: sentBackData.workflow_state,
                        //     // Add other relevant fields if header uses them
                        //     work_package: sentBackData.work_package,
                        //     raised_by: sentBackData.owner, // Or relevant field
                        // }}
                        orderData={sentBackData}
                        sentBack // Add flag if header needs to adapt styling/text
                    />
                )}
            </div>

            {/* Vendor Approval Table (Reused) */}
            <VendorApprovalTable
                selection={selectionMap}
                dataSource={vendorDataSource}
                onSelectionChange={handleSelectionChange}
                paymentTerms={paymentTermsByVendor} // Pass the processed original terms
        onDynamicTermsChange={setDynamicPaymentTerms} // ✨ PASS the setter down

            />

            {/* Footer Actions */}
            <div className='flex justify-end items-center mt-4'>
                {canPerformActions && (
                    <div className="flex justify-end gap-2">
                        <Button
                            onClick={toggleSendBackDialog}
                            variant="outline"
                            size="sm"
                            className="border-destructive text-destructive hover:bg-destructive/10 flex items-center gap-1"
                            disabled={isLoading}
                        >
                            <SendToBack className='w-4 h-4' />
                            Send Back
                        </Button>
                        <Button
                            onClick={toggleApproveDialog}
                            variant="default"
                            size="sm"
                            className='flex gap-1 items-center'
                            disabled={isLoading}
                        >
                            <ListChecks className="h-4 w-4" />
                            Approve
                        </Button>
                    </div>
                )}
            </div>

            {/* Comments Section */}
            <div className='space-y-2 pt-4'>
                <h2 className="text-base font-bold tracking-tight">Sent Back Comments History</h2>
                {/* Pass SB comments */}
                <RenderPRorSBComments universalComment={sbComments} getUserName={getUserName} />
            </div>

            {/* NO Delayed Items Table Needed Here */}

            {/* Dialogs (Reused ConfirmationDialog) */}
            <ConfirmationDialog
                 isOpen={isSendBackDialogOpen}
                 onClose={toggleSendBackDialog}
                 onConfirm={handleSendBackConfirm}
                 isLoading={isLoading}
                 title="Confirm Send Back?"
                 confirmText="Confirm Send Back"
                 confirmVariant="destructive"
                 cancelText="Cancel"
             >
                 <div className='py-2 space-y-2'>
                     <Label htmlFor="sendback-comment-sb">Comment (Optional):</Label>
                     <Textarea
                         id="sendback-comment-sb"
                         value={comment}
                         placeholder="Reason for sending back..."
                         onChange={handleCommentChange}
                         rows={3}
                     />
                 </div>
                 <p className='text-sm text-muted-foreground mt-2'>
                     Selected items will be marked for reconsideration by the procurement team.
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
                 <p className='text-sm text-muted-foreground'>
                     Approving the selected items will generate Purchase Orders for the chosen vendors based on these sent-back items.
                 </p>
             </ConfirmationDialog>

        </div>
    );
};