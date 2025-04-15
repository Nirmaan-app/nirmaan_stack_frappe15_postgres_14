import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useFrappeGetDoc } from 'frappe-react-sdk';
import { TailSpin } from 'react-loader-spinner';
import { ApprovePRView } from './ApprovePRView';
import { useApprovePRLogic } from './hooks/useApprovePRLogic';
import { useRelatedPRData } from './hooks/useRelatedPRData';
import { PRDocType } from './types'; // Import dependent types for hook
import { Projects as Project } from '@/types/NirmaanStack/Projects'; // Import Project type
import { Button } from '@/components/ui/button';

export const ApprovePRContainer: React.FC = () => {
    const { prId } = useParams<{ prId: string }>();
    const navigate = useNavigate();

    // Ensure prId exists early
    if (!prId) {
        return <div className="flex items-center justify-center h-[90vh]">Error: PR ID is missing.</div>;
    }

    // 1. Fetch the main PR Document
    const { data: prDoc, isLoading: prLoading, error: prError, mutate: prMutate } = useFrappeGetDoc<PRDocType>(
        "Procurement Requests",
        prId,
        `Procurement Requests ${prId}`
    );

    // 2. Fetch related data (conditionally enabled based on prDoc existence)
    const {
        usersList,
        categoryList,
        itemList,
        quoteData,
        universalComments,
        itemMutate,
        isLoading: relatedDataLoading,
        error: relatedDataError,
    } = useRelatedPRData({ prDoc, enabled: !!prDoc }); // `enabled` controls fetching, not the hook call

    // 3. Fetch Project data separately (conditionally enabled)
    const { data: projectDoc, isLoading: projectLoading, error: projectError } = useFrappeGetDoc<Project>(
        "Projects",
        prDoc?.project,
        { enabled: !!prDoc?.project } // `enabled` controls fetching
    );

    // --- Instantiate the Logic Hook UNCONDITIONALLY ---
    // Pass potentially undefined data; the hook handles initialization.
    const logicProps = useApprovePRLogic({
        prDoc: prDoc!, // Use non-null assertion OR handle undefined inside the hook if prDoc is truly needed before it exists
        projectDoc,
        usersList,
        categoryList,
        itemList,
        comments: universalComments,
        itemMutate: itemMutate!, // Assert or provide dummy function if needed before available
        prMutate: prMutate!,   // Assert or provide dummy function if needed before available
    });

    // --- Combined Loading State ---
    // Consider if logicProps.isLoading should be included based on when actions can happen
    const isDataLoading = prLoading || relatedDataLoading || projectLoading;
    // const isActionLoading = logicProps.isLoading; // Loading from actions within the hook

    // --- Combined Error State ---
    const error = prError || relatedDataError || projectError;

    // --- Render Logic ---

    // Initial Data Loading State
    if (isDataLoading && !prDoc) { // Show spinner only if main PR doc isn't loaded yet
        return (
            <div className="flex items-center justify-center h-[90vh]">
                <TailSpin color="red" height={50} width={50} />
            </div>
        );
    }

    // Error State
    if (error) {
        console.error("Error loading PR data:", error);
        return (
            <div className="p-4 flex flex-col items-center justify-center h-[90vh] text-red-600">
                <p className='mb-2'>Error loading Procurement Request details. Please try again later.</p>
                <pre className='text-xs bg-red-100 p-2 rounded mb-4 w-full max-w-lg overflow-auto'>{JSON.stringify(error, null, 2)}</pre>
                <Button onClick={() => navigate("/procurement-requests?tab=Approve PR")} className="mt-4">Go Back</Button>
            </div>
        );
    }

    // If prDoc hasn't loaded (e.g., invalid ID or network issue not caught by error state)
    if (!prDoc) {
        return (
            <div className="flex items-center justify-center h-[90vh]">
                Procurement Request <span className='font-mono mx-1'>{prId}</span> not found or failed to load.
                <Button onClick={() => navigate("/procurement-requests?tab=Approve PR")} className="ml-4">Go Back</Button>
            </div>
        );
    }

    // --- Workflow State Check ---
    // This check can now safely assume prDoc exists.
    // It might briefly use the initial (potentially null/empty) logicProps.getFullName before `usersList` loads,
    // which is fine as `getFullName` handles undefined IDs.
    if (prDoc.workflow_state !== "Pending") {
        const modifierName = logicProps.getFullName(prDoc.modified_by) || prDoc.modified_by; // getFullName handles undefined usersList initially
        return (
            <div className="flex items-center justify-center h-[90vh]">
                <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                    <h2 className="text-2xl font-semibold text-gray-800">Heads Up!</h2>
                    <p className="text-gray-600 text-lg">
                        The PR: <span className="font-medium text-gray-900">{prDoc.name}</span> is no longer
                        in the <span className="italic">Pending</span> state. The current state is{" "}
                        <span className="font-semibold text-blue-600">{prDoc.workflow_state}</span>.
                        Last modified by{" "}
                        <span className="font-medium text-gray-900">{modifierName}</span>.
                    </p>
                    <Button
                        onClick={() => navigate("/procurement-requests?tab=Approve PR")}
                        className="mt-4"
                    >
                        Go Back to PR List
                    </Button>
                </div>
            </div>
        );
    }

    // --- Render View ---
    // Render the view, passing the logicProps. The View/hook should handle the case
    // where `orderData` inside logicProps might still be null until the useEffect initializes it.
    // You might want to show a loading state *within* ApprovePRView if logicProps.orderData is null.
    return (
        <ApprovePRView
            {...logicProps} // Spread all state and handlers from the logic hook
            projectDoc={projectDoc} // Pass project details if needed in View
            quoteData={quoteData}   // Pass quote data for summary view
            categoryList={categoryList}
        />
    );
};

export default ApprovePRContainer;