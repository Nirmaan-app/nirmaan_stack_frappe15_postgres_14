import React, { useMemo } from 'react'; // Added useMemo
import { useParams, useNavigate } from 'react-router-dom';
import { useFrappeGetDoc, useFrappeGetDocList } from 'frappe-react-sdk';
import { TailSpin } from 'react-loader-spinner';

import { ApprovePRView } from './ApprovePRView';
import { useApprovePRLogic } from './hooks/useApprovePRLogic';
import { PRDocType } from './types';
import { Projects as Project } from '@/types/NirmaanStack/Projects';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/config/queryKeys'; // Import centralized keys

// Import the new individual hooks
import { useUsersList } from './hooks/useUsersList';
import { useCategoryList } from './hooks/useCategoryList';
import { useItemList } from './hooks/useItemList';
import { usePRComments } from './hooks/usePRComments';
import { useRelatedPRData } from './hooks/useRelatedPRData';

export const ApprovePRContainer: React.FC = () => {
    const { prId } = useParams<{ prId: string }>();
    const navigate = useNavigate();

    // Ensure prId exists early
    if (!prId) {
        return <div className="flex items-center justify-center h-[90vh]">Error: PR ID is missing.</div>;
    }

    // --- 1. Fetch Main PR Document ---
    const prQueryKey = queryKeys.procurementRequests.doc(prId);
    const { data: prDoc, isLoading: prLoading, error: prError, mutate: prMutate } = useFrappeGetDoc<PRDocType>(
        "Procurement Requests",
        prId,
        prQueryKey
    );

    const {make_list, makeListMutate, allMakeOptions, categoryMakeListMutate} = useRelatedPRData({ prDoc });

    // --- 2. Fetch Project Document (conditional) ---
    const projectQueryKey = prDoc?.project ? queryKeys.projects.doc(prDoc.project) : null;
    const { data: projectDoc, isLoading: projectLoading, error: projectError } = useFrappeGetDoc<Project>(
        "Projects",
        prDoc?.project, // Docname to fetch
        projectQueryKey
    );

    // --- 3. Fetch Related Data using Individual Hooks ---
    const workPackage = prDoc?.work_package;
    const prName = prDoc?.name;

    // Fetch Users
    const { data: usersList, isLoading: usersLoading, error: usersError } = useUsersList();

    // Fetch Categories (depends on workPackage)
    const { data: categoryList, isLoading: categoriesLoading, error: categoriesError } = useCategoryList({ workPackage });

    // Derive category names for item fetching
    const categoryNames = useMemo(() => categoryList?.map(c => c.name) ?? [], [categoryList]);

    // Fetch Items (depends on categoryNames)
    const { data: itemList, isLoading: itemsLoading, error: itemsError, mutate: itemMutate } = useItemList({ categoryNames });

    // Fetch Comments (depends on prName)
    const { data: universalComments, isLoading: commentsLoading, error: commentsError } = usePRComments({ prName });

    // --- 4. Instantiate the Logic Hook (Unconditionally) ---
    const logicProps = useApprovePRLogic({
        // Pass data fetched above. Handle potential undefined values gracefully inside the hook or here.
        prDoc: prDoc!, // Assert prDoc is available based on checks below
        projectDoc,
        usersList: usersList || [], // Provide default empty array
        categoryList: categoryList || [], // Provide default empty array
        itemList: itemList || [],       // Provide default empty array
        comments: universalComments || [], // Provide default empty array
        itemMutate: itemMutate!, // Assert mutate is available when needed
        prMutate: prMutate!,     // Assert mutate is available when needed
        allMakeOptions,
        makeList: make_list,
        makeListMutate,
        categoryMakeListMutate
    });

    // --- Combined Loading State ---
    const isDataLoading = prLoading || projectLoading || usersLoading || categoriesLoading || itemsLoading || commentsLoading;

    // --- Combined Error State ---
    const error = prError || projectError || usersError || categoriesError || itemsError || commentsError;

    // --- Render Logic ---

    // Initial Data Loading State (Focus on PR doc first)
    if (prLoading && !prDoc) {
        return (
            <div className="flex items-center justify-center h-[90vh]">
                <TailSpin color="red" height={50} width={50} />
            </div>
        );
    }

    // Error State
    if (error) {
        console.error("Error loading PR or related data:", error);
        return (
            <div className="p-4 flex flex-col items-center justify-center h-[90vh] text-red-600">
                <p className='mb-2'>Error loading details. Please try again later.</p>
                <pre className='text-xs bg-red-100 p-2 rounded mb-4 w-full max-w-lg overflow-auto'>{JSON.stringify(error, null, 2)}</pre>
                <Button onClick={() => navigate("/procurement-requests?tab=Approve PR")} className="mt-4">Go Back</Button>
            </div>
        );
    }

    // If prDoc hasn't loaded (after loading finishes without error)
    if (!prDoc) {
        return (
             <div className="flex items-center justify-center h-[90vh]">
                 Procurement Request <span className='font-mono mx-1'>{prId}</span> not found.
                 <Button onClick={() => navigate("/procurement-requests?tab=Approve PR")} className="ml-4">Go Back</Button>
             </div>
         );
    }

    // --- Workflow State Check ---
    if (prDoc.workflow_state !== "Pending") {
        // Logic hook and getFullName should be available here
        const modifierName = logicProps.getFullName(prDoc.modified_by) || prDoc.modified_by;
        return (
            <div className="flex items-center justify-center h-[90vh]">
                {/* ... (Workflow state message remains the same) ... */}
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

     // Show loading indicator if PR is loaded but related data is still fetching
     if (isDataLoading) {
         return (
             <div className="flex items-center justify-center h-[90vh]">
                 <TailSpin color="red" height={50} width={50} />
                 <span className='ml-2'>Loading details...</span>
             </div>
         );
     }


    // --- Render View ---
    // All necessary data should be loaded by this point
    return (
        <ApprovePRView
            {...logicProps} // Spread all state and handlers from the logic hook
            projectDoc={projectDoc}
            categoryList={categoryList}
        />
    );
};

export default ApprovePRContainer;