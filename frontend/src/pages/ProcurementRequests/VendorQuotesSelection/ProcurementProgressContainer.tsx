import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TailSpin } from 'react-loader-spinner';
import { Button } from '@/components/ui/button';
import { useProcurementDocument } from './hooks/useProcurementDocument';
import { useProcurementProgressLogic } from './hooks/useProcurementProgressLogic';
import { ProcurementProgressView } from './ProcurementProgressView';
import { useUserData } from '@/hooks/useUserData';
import { ProgressDocumentType } from './types';
import { useVendorsList } from './hooks/useVendorsList';
import LoadingFallback from '@/components/layout/loaders/LoadingFallback';

export const ProcurementProgressContainer: React.FC = () => {
    const { prId: prIdFromParams } = useParams<{ prId?: string }>();
    const { sbId: sbIdFromParams } = useParams<{ sbId?: string }>();
    const navigate = useNavigate();
    const { user_id: currentUser } = useUserData();

    const documentType = prIdFromParams ? "Procurement Requests" : "Sent Back Category";
    const docId = prIdFromParams || sbIdFromParams;



    if (!docId) {
        return <div className="flex items-center justify-center h-[90vh]">Error: Document ID is missing.</div>;
    }


    // --- Data Fetching ---
    // Fetch the main document (PR or SBC)
    const {
        data: initialDoc,
        isLoading: docLoading,
        error: docError,
        mutate: docMutate
    } = useProcurementDocument(documentType, docId);


    const {
        vendorOptionsForSelect, // Use the formatted options
        isLoading: vendorsLoading,
        error: vendorsError
    } = useVendorsList();


    // --- Instantiate Logic Hook ---
    const logicProps = useProcurementProgressLogic({
        prId: docId,
        initialDocument: initialDoc as ProgressDocumentType | undefined, // Cast if necessary, or ensure types align
        allVendorsForRFQ: vendorOptionsForSelect,
        documentMutate: docMutate,
        currentUser,
    });

    // --- Loading and Error States ---
    // Initial critical data load for the page to decide if it can render
    const isPageLoading = docLoading || vendorsLoading; // Users loading is handled within the logic hook
    const pageError = docError || vendorsError;

    if (isPageLoading && !initialDoc) {
        return (
            <LoadingFallback />
        );
    }

    if (pageError) {
        // ... your existing error display ...
        return (
             <div className="p-4 flex flex-col items-center justify-center h-[90vh] text-red-600">
                 <p className='mb-2'>Error loading critical page data. Please try again.</p>
                 <pre className='text-xs bg-red-100 p-2 rounded mb-4 w-full max-w-lg overflow-auto'>{JSON.stringify(pageError, Object.getOwnPropertyNames(pageError), 2)}</pre>
                 <Button onClick={() => navigate("/procurement-requests")} className="mt-4">Go Back</Button>
             </div>
         );
    }

    if (!initialDoc && !isPageLoading) { // If done loading and still no doc
         return (
             <div className="flex items-center justify-center h-[90vh]">
                 Document <span className='font-mono mx-1'>{docId}</span> of type <span className='font-mono mx-1'>{documentType}</span> not found.
                 <Button onClick={() => navigate("/procurement-requests")} className="ml-4">Go Back</Button>
             </div>
         );
    }
    
    // --- Consolidated Workflow State Check ---
    let isWorkflowStateValidForRFQ = false;
    let relevantWorkflowStates = "";
    let listPagePath = "/procurement-requests"; // Default

    if (initialDoc) { // Ensure initialDoc is loaded
        if (initialDoc.doctype === "Procurement Requests") {
            isWorkflowStateValidForRFQ = ["In Progress"].includes(initialDoc.workflow_state);
            relevantWorkflowStates = "'In Progress'";
            listPagePath = "/procurement-requests?tab=In%20Progress"; // Or your actual path for PR list
        } else if (initialDoc.doctype === "Sent Back Category") {
            isWorkflowStateValidForRFQ = initialDoc.workflow_state === "Pending";
            relevantWorkflowStates = "'Pending'";
            listPagePath = `/sent-back-requests?tab=${initialDoc?.type}`;
        }

        if (!isWorkflowStateValidForRFQ) {
            const modifierName = logicProps.getFullName(initialDoc.modified_by) || initialDoc.modified_by;
            return (
                <div className="flex items-center justify-center h-[90vh]">
                    <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                        <h2 className="text-2xl font-semibold text-gray-800">Heads Up!</h2>
                        <p className="text-gray-600 text-lg">
                            The document <span className="font-medium text-gray-900">{initialDoc.name}</span> ({initialDoc.doctype})
                            is in state: <span className="font-semibold text-blue-600">{initialDoc.workflow_state}</span>.
                            <br />
                            RFQ progress/review is applicable for {relevantWorkflowStates} state(s) only for this document type.
                            <br />
                            Last modified by <span className="font-medium text-gray-900">{modifierName}</span>.
                        </p>
                        <Button onClick={() => navigate(listPagePath)} className="mt-4">
                            Go Back to List
                        </Button>
                    </div>
                </div>
            );
        }
    }
    // --- End Consolidated Workflow State Check ---

    // If initialDoc is still not loaded here (e.g. after loading states but before first successful fetch for logicProps)
    // or if logicProps isn't fully ready, you might want another loading check or ensure logicProps handles undefined initialDoc
    if (!logicProps.currentDocument && isPageLoading) { // Check logicProps.currentDocument if it's the source of truth for View
         return (
            <div className="flex items-center justify-center h-[90vh]">
                <TailSpin color="#D03B45" height={50} width={50} />
                <p className="ml-3">Initializing RFQ details...</p>
            </div>
        );
    }
    
    return <ProcurementProgressView {...logicProps} />;
};

// For file-based routing
export const Component = ProcurementProgressContainer;
export default ProcurementProgressContainer;