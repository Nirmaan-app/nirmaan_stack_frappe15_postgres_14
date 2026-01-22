import React from 'react';
import { TailSpin } from 'react-loader-spinner'; // For global loading overlay
import { useUserData } from '@/hooks/useUserData'; // To get current user role for permissions

// Import your new UI section components
import { SRHeaderInfo } from './components/SRHeaderInfo';
import { SRItemsTable } from './components/SRItemsTable';
import { SRFinancialSummary } from './components/SRFinancialSummary';
import { SRPaymentsSection } from './components/SRPaymentsSection';
import { SRNotesSection } from './components/SRNotesSection';
import { SREditTermsDialog } from './components/SREditTermsDialog';
import { SRNewPaymentDialog } from './components/SRNewPaymentDialog';
import { SRRequestPaymentDialog } from './components/SRRequestPaymentDialog';
import { SRInvoicePreviewSheet } from './components/SRInvoicePreviewSheet';
import { SRActionButtons } from './components/SRActionButtons';
import { SRRemarks } from './components/SRRemarks';
import { InvoiceDialog } from "@/pages/ProcurementOrders/invoices-and-dcs/components/InvoiceDialog"; // Your existing
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useApprovedSRData } from './hooks/useApprovedSRData';
import { useSREditTerms } from './hooks/useSREditTerms';
import { useSRPaymentManager } from './hooks/useSRPaymentManager';
import { useSRWorkflowActions } from './hooks/useSRWorkflowActions';
import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { SelectServiceVendorPage } from '../service-request/select-service-vendor';

// Combine all props needed by the View
interface ApprovedSRViewProps {
    dataProps: ReturnType<typeof useApprovedSRData>;
    termsProps: ReturnType<typeof useSREditTerms>;
    paidPaymentProps: ReturnType<typeof useSRPaymentManager>;
    // requestPaymentProps: UseSRRequestPaymentReturn; // If you make a dedicated hook
    workflowActionProps: ReturnType<typeof useSRWorkflowActions>;

    // Dialog/Sheet open states and toggles from a page-level state manager (or a context)
    isEditTermsDialogOpen: boolean;
    toggleEditTermsDialog: () => void;
    isNewPaymentDialogOpen: boolean; // For "Paid" entry by Accounts
    toggleNewPaymentDialog: () => void;
    isRequestPaymentDialogOpen: boolean; // For "Requested" entry by PM/PL
    toggleRequestPaymentDialog: () => void;
    isInvoicePreviewSheetOpen: boolean;
    toggleInvoicePreviewSheet: () => void;
    isAmendSheetOpen: boolean;
    toggleAmendSheet: () => void;
    isAddInvoiceDialogOpen: boolean; // From useDialogStore usually
    toggleAddInvoiceDialog: () => void;

    // Additional props for permissions and context
    currentUserRole?: string | null;
    summaryPage?: boolean; // Prop from original component
    accountsPage?: boolean; // Prop from original component
}

export const ApprovedSRView: React.FC<ApprovedSRViewProps> = ({
    dataProps,
    termsProps,
    paidPaymentProps,
    // requestPaymentProps,
    workflowActionProps,
    isEditTermsDialogOpen, toggleEditTermsDialog,
    isNewPaymentDialogOpen, toggleNewPaymentDialog,
    isRequestPaymentDialogOpen, toggleRequestPaymentDialog,
    isInvoicePreviewSheetOpen, toggleInvoicePreviewSheet,
    isAmendSheetOpen, toggleAmendSheet,
    isAddInvoiceDialogOpen, toggleAddInvoiceDialog,
    currentUserRole,
    summaryPage = false,
    accountsPage = false,
}) => {
    const {
        serviceRequest, vendor, project, payments,
        totalExclusiveGST, totalInclusiveGST, amountPaid, amountPendingForRequest,
        mutateSR, mutatePayments, isLoading: dataLoading // Overall data loading
    } = dataProps;

    const {
        formState: termsForm, currentNoteInput, editingNoteId, isSaving: isSavingTerms,
        handleNoteInputChange, addOrUpdateNote, editNote, deleteNote,
        handleGstToggle, handleProjectGstChange, saveTerms
    } = termsProps;

    const {
        isSubmittingPayment: isSubmittingPaidEntry, // From useSRPaymentManager
    } = paidPaymentProps;

    const {
        deleteServiceRequest, setupSRAmendment,
        isDeleting, isAmending,
    } = workflowActionProps;

    // Determine permissions based on role and SR status
    const canEditTerms = !summaryPage && !accountsPage && serviceRequest?.status === "Approved"; // Example
    const canRequestPayment = !summaryPage && !accountsPage && serviceRequest?.status === "Approved";
    const canRecordPaidEntry = accountsPage && serviceRequest?.status === "Approved"; // Only accounts can record "Paid"
    const canAddInvoice = !summaryPage && serviceRequest?.status === "Approved"; // Or other relevant statuses
    const canAmend = !summaryPage && !accountsPage && serviceRequest?.status === "Approved"; // Conditions for amend
    // Note: vendorInvoicesCount should be passed from parent via dataProps
    const vendorInvoicesCount = (dataProps as any).vendorInvoicesCount ?? 0;

    const canDeleteSR = !summaryPage && !accountsPage &&
        (serviceRequest?.owner === useUserData().user_id || currentUserRole === "Nirmaan Admin Profile" || currentUserRole === "Nirmaan PMO Executive Profile") &&
        (!payments || payments.length === 0) && // Cannot delete if payments exist
        (vendorInvoicesCount === 0); // Cannot delete if invoices exist (from Vendor Invoices doctype)

    const isPageActionLoading = isSavingTerms || isSubmittingPaidEntry || isDeleting || isAmending;

    if (!serviceRequest && dataLoading) { // Show main loading if SR isn't even defined yet
        return <LoadingFallback />;
    }
    if (!serviceRequest) {
        return <div className="p-6 text-center text-muted-foreground">Service Request data not available.</div>;
    }

    // Define restricted roles that should have limited visibility
    const RESTRICTED_ROLES = ["Nirmaan Project Manager Profile", "Nirmaan Estimates Executive Profile"];
    const isRestrictedRole = RESTRICTED_ROLES.includes(currentUserRole || "");

    return (
        <>
            <div className="flex-1 space-y-4 md:space-y-6 p-4 md:p-6">
                <SRHeaderInfo
                    serviceRequest={serviceRequest}
                    vendor={vendor}
                    project={project}
                />

                <SRActionButtons
                    srDoc={serviceRequest}
                    canModify={canEditTerms || canAmend} // General modify permission
                    canDelete={canDeleteSR}
                    isProcessingAction={isPageActionLoading}
                    onAmend={toggleAmendSheet}
                    onDelete={deleteServiceRequest} // Directly call, dialog confirmation is inside SRDeleteConfirmationDialog
                    onAddInvoice={toggleAddInvoiceDialog}
                    onPreviewInvoice={toggleInvoicePreviewSheet}
                    isRestrictedRole={isRestrictedRole}
                />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
                    <div className={`${isRestrictedRole ? 'lg:col-span-3' : 'lg:col-span-2'} space-y-4 md:space-y-6`}>
                        <SRItemsTable
                            items={serviceRequest.parsed_service_order_list?.list}
                            gstEnabled={serviceRequest.gst === "true"}
                        />
                        <SRNotesSection
                            srDoc={serviceRequest}
                            notesData={termsForm.notes}
                            currentNoteInput={currentNoteInput}
                            editingNoteId={editingNoteId}
                            isSavingTerms={isSavingTerms}
                            onNoteInputChange={handleNoteInputChange}
                            onAddOrUpdateNote={addOrUpdateNote}
                            onEditNote={editNote}
                            onDeleteNote={deleteNote}
                        />
                    </div>
                    {/* Hide Financial Summary and Payments sections for restricted roles */}
                    {!isRestrictedRole && (
                        <div className="lg:col-span-1 space-y-4 md:space-y-6">
                            <SRFinancialSummary
                                totalExclusiveGST={totalExclusiveGST}
                                totalInclusiveGST={totalInclusiveGST}
                                amountPaid={amountPaid}
                                amountPendingForRequest={amountPendingForRequest}
                                gstEnabled={serviceRequest.gst === "true"}
                            />
                            <SRPaymentsSection
                                srId={serviceRequest.name}
                                srDoc={serviceRequest}
                                canRequestPayment={canRequestPayment}
                                canRecordPaidEntry={canRecordPaidEntry}
                                totalSrAmountInclGST={totalInclusiveGST}
                                totalSrAmountExclGST={totalExclusiveGST}
                                currentPaidAmount={amountPaid}
                                currentPendingAmount={amountPendingForRequest}
                                mutatePayments={mutatePayments}
                            />
                        </div>
                    )}
                </div>

                {/* SR Remarks Section */}
                <SRRemarks srId={serviceRequest.name} />
            </div>

            {/* Dialogs and Sheets */}
            {isEditTermsDialogOpen && (
                <SREditTermsDialog
                    isOpen={isEditTermsDialogOpen}
                    onOpenChange={toggleEditTermsDialog}
                    srDoc={serviceRequest}
                    projectDoc={project} // Pass project for GST options
                    mutateSR={mutateSR}
                />
            )}

            {isRequestPaymentDialogOpen && ( // For PM/PL requesting payment
                <SRRequestPaymentDialog
                    isOpen={isRequestPaymentDialogOpen}
                    onOpenChange={toggleRequestPaymentDialog}
                    srDoc={serviceRequest}
                    totalSrAmountInclGST={totalInclusiveGST}
                    totalSrAmountExclGST={totalExclusiveGST}
                    currentPaidAmount={amountPaid}
                    currentPendingAmount={amountPendingForRequest}
                    onPaymentRequested={() => {
                        mutatePayments(); // Refresh payments list
                        // Potentially mutate SR if its status or a payment-related field changes
                    }}
                />
            )}

            {isNewPaymentDialogOpen && ( // For Accounts recording a "Paid" entry
                <SRNewPaymentDialog
                    isOpen={isNewPaymentDialogOpen}
                    onOpenChange={toggleNewPaymentDialog}
                    srDoc={serviceRequest}
                    totalPayable={totalInclusiveGST} // Or based on gstEnabled
                    alreadyPaid={amountPaid}
                    onPaymentRecorded={() => {
                        mutatePayments();
                    }}
                />
            )}

            {isInvoicePreviewSheetOpen && (
                <SRInvoicePreviewSheet
                    isOpen={isInvoicePreviewSheetOpen}
                    onOpenChange={toggleInvoicePreviewSheet}
                    srDoc={serviceRequest}
                // printParams can be passed if dialog inputs are collected before preview
                />
            )}

            {isAddInvoiceDialogOpen && serviceRequest && ( // Using your existing InvoiceDialog
                <InvoiceDialog
                    docType="Service Requests"
                    docName={serviceRequest.name}
                    docMutate={mutateSR} // Mutate SR after invoice addition
                    vendor={serviceRequest.vendor}
                // isOpen and onOpenChange are managed by useDialogStore for InvoiceDialog
                />
            )}

            {isAmendSheetOpen && serviceRequest && (
                <Sheet open={isAmendSheetOpen} onOpenChange={toggleAmendSheet}>
                    <SheetContent className="overflow-auto md:min-w-[700px] sm:min-w-[500px]">
                        <SheetHeader>
                            <SheetTitle className="text-center mb-6">Amend Service Request: {serviceRequest.name}</SheetTitle>
                        </SheetHeader>
                        {/* SelectServiceVendorPage is your existing page/component for creating/editing SR */}
                        <SelectServiceVendorPage
                            sr_data={serviceRequest} // Pass existing data for amendment
                            sr_data_mutate={mutateSR} // To refresh after amendment
                            amend={true} // Indicate it's an amendment
                        // You might need a callback to close the sheet on successful amendment
                        // onAmendmentComplete={() => {
                        //     toggleAmendSheet();
                        //     // navigate to new amended SR if that's the flow
                        // }}
                        />
                    </SheetContent>
                </Sheet>
            )}

            {/* Global Loading Overlay for actions */}
            {isPageActionLoading && (
                <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-60 z-[999]">
                    <div className="bg-white p-6 rounded-lg shadow-xl text-center flex items-center gap-4">
                        <TailSpin color="#D03B45" height={30} width={30} />
                        <p className="text-base font-medium">Processing...</p>
                    </div>
                </div>
            )}
        </>
    );
};