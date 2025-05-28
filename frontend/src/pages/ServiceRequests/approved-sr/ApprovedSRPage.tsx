import React, { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useApprovedSRData } from './hooks/useApprovedSRData';
import { useSREditTerms } from './hooks/useSREditTerms';
import { useSRPaymentManager } from './hooks/useSRPaymentManager';
// import { useSRRequestPayment } from './hooks/useSRRequestPayment'; // If you create this for request dialog
import { useSRWorkflowActions } from './hooks/useSRWorkflowActions';
import { ApprovedSRView } from './ApprovedSRView';
import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { useDialogStore } from '@/zustand/useDialogStore'; // For global dialogs like AddInvoice
import { useUserData } from '@/hooks/useUserData';

interface ApprovedSRPageProps {
    summaryPage?: boolean;
    accountsPage?: boolean;
}

export const ApprovedSRPage: React.FC<ApprovedSRPageProps> = ({ summaryPage, accountsPage }) => {
    const { srId, id } = useParams<{ srId?: string, id?: string }>(); // 'id' might be from accountsPage route
    const actualSrId = srId || id;

    const { user_id, role: currentUserRole } = useUserData();

    // Dialog states managed at this page level
    const [isEditTermsDialogOpen, setIsEditTermsDialogOpen] = useState(false);
    const [isNewPaymentDialogOpen, setIsNewPaymentDialogOpen] = useState(false); // For "Paid" by Accounts
    const [isRequestPaymentDialogOpen, setIsRequestPaymentDialogOpen] = useState(false); // For "Requested" by PM/PL
    const [isInvoicePreviewSheetOpen, setIsInvoicePreviewSheetOpen] = useState(false);
    const [isAmendSheetOpen, setIsAmendSheetOpen] = useState(false);

    // Global dialog store for Add Invoice (if it's managed globally)
    const { newInvoiceDialog, toggleNewInvoiceDialog } = useDialogStore();


    if (!actualSrId) {
        return <div className="p-6 text-center text-destructive">Service Request ID is missing.</div>;
    }

    // --- Core Data Hook ---
    const dataProps = useApprovedSRData(actualSrId);

    // --- Logic Hooks (initialized only when srDoc is available) ---
    const termsProps = useSREditTerms(dataProps.serviceRequest, dataProps.mutateSR);
    const paidPaymentProps = useSRPaymentManager(dataProps.serviceRequest, dataProps.mutatePayments);
    // const requestPaymentProps = useSRRequestPayment(dataProps.serviceRequest, dataProps.mutatePayments); // If you create this
    const workflowActionProps = useSRWorkflowActions({
        srId: actualSrId,
        srDoctype: "Service Requests",
        onActionSuccess: (action) => {
            if (action === 'delete') {
                // Navigation is handled within the hook
            } else {
                dataProps.mutateSR(); // General refresh for other actions
            }
            if (action === 'amend_setup') setIsAmendSheetOpen(false);
        }
    });

    // Toggles for page-level dialogs/sheets
    const toggleEditTermsDialog = useCallback(() => setIsEditTermsDialogOpen(p => !p), []);
    const toggleNewPaymentDialog = useCallback(() => setIsNewPaymentDialogOpen(p => !p), []);
    const toggleRequestPaymentDialog = useCallback(() => setIsRequestPaymentDialogOpen(p => !p), []);
    const toggleInvoicePreviewSheet = useCallback(() => setIsInvoicePreviewSheetOpen(p => !p), []);
    const toggleAmendSheet = useCallback(() => setIsAmendSheetOpen(p => !p), []);


    if (dataProps.isLoading && !dataProps.serviceRequest) {
        return <LoadingFallback />;
    }

    if (dataProps.error && !dataProps.serviceRequest) { // Show error if critical data failed
        return <div className="p-6"><AlertDestructive error={dataProps.error} /></div>;
    }
    
    if (!dataProps.serviceRequest) {
         return <div className="p-6 text-center text-muted-foreground">Service Request <span className="font-mono">{actualSrId}</span> not found or inaccessible.</div>;
    }

    // Simple check for workflow state allowing RFQ interaction - can be more granular
    // This logic can also be moved into ApprovedSRView or a dedicated permissions hook
    const canCurrentlyProcessRFQ = ["Approved"].includes(dataProps.serviceRequest.status);


    return (
        <ApprovedSRView
            dataProps={dataProps}
            termsProps={termsProps}
            paidPaymentProps={paidPaymentProps}
            // requestPaymentProps={requestPaymentProps}
            workflowActionProps={workflowActionProps}
            isEditTermsDialogOpen={isEditTermsDialogOpen}
            toggleEditTermsDialog={toggleEditTermsDialog}
            isNewPaymentDialogOpen={isNewPaymentDialogOpen}
            toggleNewPaymentDialog={toggleNewPaymentDialog}
            isRequestPaymentDialogOpen={isRequestPaymentDialogOpen} // Pass state and toggle
            toggleRequestPaymentDialog={toggleRequestPaymentDialog} // Pass state and toggle
            isInvoicePreviewSheetOpen={isInvoicePreviewSheetOpen}
            toggleInvoicePreviewSheet={toggleInvoicePreviewSheet}
            isAmendSheetOpen={isAmendSheetOpen}
            toggleAmendSheet={toggleAmendSheet}
            isAddInvoiceDialogOpen={newInvoiceDialog} // From global store
            toggleAddInvoiceDialog={toggleNewInvoiceDialog} // From global store
            currentUserRole={currentUserRole}
            summaryPage={summaryPage}
            accountsPage={accountsPage}
        />
    );
};

// For file-based routing
export const Component = ApprovedSRPage;
export default ApprovedSRPage;