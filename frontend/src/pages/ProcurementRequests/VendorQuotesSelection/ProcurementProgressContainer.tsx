import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TailSpin } from 'react-loader-spinner';
import { Button } from '@/components/ui/button';
import { useProcurementDocument } from './hooks/useProcurementDocument';
import { useProcurementProgressLogic } from './hooks/useProcurementProgressLogic';
import { ProcurementProgressView } from './ProcurementProgressView';
import { useUserData } from '@/hooks/useUserData';
import { ProgressDocument } from './types';
import { useVendorsList } from './hooks/useVendorsList';
import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { SentBackCategory } from '@/types/NirmaanStack/SentBackCategory';
import { useCEOHoldGuard } from '@/hooks/useCEOHoldGuard';
import { CEOHoldBanner } from '@/components/ui/ceo-hold-banner';
import { useVendorHoldVendors } from '@/hooks/useVendorHoldVendors';
import { useFrappeGetDoc } from 'frappe-react-sdk';
import { Projects } from '@/types/NirmaanStack/Projects';

export const ProcurementProgressContainer: React.FC = () => {
    const { prId: prIdFromParams } = useParams<{ prId?: string }>();
    const { sbId: sbIdFromParams } = useParams<{ sbId?: string }>();
    const navigate = useNavigate();
    const { user_id: currentUser } = useUserData();

    const documentType = prIdFromParams ? "Procurement Requests" : "Sent Back Category";
    const docId = prIdFromParams || sbIdFromParams;

    // --- Data Fetching ---
    // Fetch the main document (PR or SBC)
    const {
        data: initialDoc,
        isLoading: docLoading,
        error: docError,
        mutate: docMutate
    } = useProcurementDocument(documentType, docId || "");

    const {
        vendorOptionsForSelect,
        isLoading: vendorsLoading,
        error: vendorsError
    } = useVendorsList();

    // CEO Hold check - must be called unconditionally before any early returns
    const { isCEOHold } = useCEOHoldGuard(initialDoc?.project);
    const { onHoldVendorIds } = useVendorHoldVendors();

    // Fetch project doc for project_wp_category_makes (qualified makes per package/category)
    const { data: projectDoc } = useFrappeGetDoc<Projects>(
        "Projects",
        initialDoc?.project,
        initialDoc?.project ? undefined : null // swrKey: undefined = auto, null = skip
    );

    // Compute relevant packages from the current document
    const relevantPackages = useMemo(() => {
        if (!initialDoc) return [];

        // PR: extract unique tag_package values from pr_tag_list
        if ('pr_tag_list' in initialDoc && Array.isArray(initialDoc.pr_tag_list) && initialDoc.pr_tag_list.length > 0) {
            return [...new Set(initialDoc.pr_tag_list.map((tag) => tag.tag_package))];
        }

        // SB or PR without tags: extract unique procurement_package from order_list items
        if (initialDoc.order_list && initialDoc.order_list.length > 0) {
            const packages = initialDoc.order_list
                .map((item) => item.procurement_package)
                .filter((pkg): pkg is string => Boolean(pkg));
            if (packages.length > 0) {
                return [...new Set(packages)];
            }
        }

        // Fallback: extract all unique packages from project_wp_category_makes
        if (projectDoc?.project_wp_category_makes && projectDoc.project_wp_category_makes.length > 0) {
            return [...new Set(projectDoc.project_wp_category_makes.map((m) => m.procurement_package))];
        }

        return [];
    }, [initialDoc, projectDoc?.project_wp_category_makes]);

    if (!docId) {
        return <div className="flex items-center justify-center h-[90vh]">Error: Document ID is missing.</div>;
    }


    // --- Instantiate Logic Hook ---
    const logicProps = useProcurementProgressLogic({
        docId,
        initialDocument: initialDoc as ProgressDocument | undefined, // Cast if necessary, or ensure types align
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
            listPagePath = `/sent-back-requests?tab=${(initialDoc as SentBackCategory)?.type}`;
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
    
    return (
        <>
            {isCEOHold && <CEOHoldBanner className="mb-4" />}
            <ProcurementProgressView
                {...logicProps}
                projectWpCategoryMakes={projectDoc?.project_wp_category_makes}
                relevantPackages={relevantPackages}
                onHoldVendorIds={onHoldVendorIds}
            />
        </>
    );
};

// For file-based routing
export const Component = ProcurementProgressContainer;
export default ProcurementProgressContainer;