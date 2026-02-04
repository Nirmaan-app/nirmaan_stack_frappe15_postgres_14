import React, { useMemo } from 'react'; // Added useMemo
import { useParams, useNavigate } from 'react-router-dom';
import { useFrappeDocumentEventListener, useFrappeGetDoc } from 'frappe-react-sdk';

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
import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { toast } from '@/components/ui/use-toast';

// Import draft manager and editing lock hooks
import { useApproveNewPRDraftManager } from '@/hooks/useApproveNewPRDraftManager';
import { useEditingLock } from './hooks/useEditingLock';

// Import draft dialogs
import { DraftResumeDialog } from '@/components/ui/draft-resume-dialog';
import { DraftCancelDialog } from '@/components/ui/draft-cancel-dialog';

/* ─────────────────────────────────────────────────────────────
   LOGGING
   ───────────────────────────────────────────────────────────── */

const LOG_PREFIX = '[PRDraft:Container]';
const LOG_ENABLED = true;

const log = (...args: any[]) => {
    if (LOG_ENABLED) console.log(LOG_PREFIX, ...args);
};

// Track render count
let containerRenderCount = 0;

export const ApprovePRContainer: React.FC = () => {
    containerRenderCount++;
    log('Component render #', containerRenderCount);
    const { prId } = useParams<{ prId: string }>();
    const navigate = useNavigate();

    // --- 1. Fetch Main PR Document ---
    // Note: prId might be undefined, but we still need to call hooks unconditionally
    const prQueryKey = prId ? queryKeys.procurementRequests.doc(prId) : null;

    const { data: prDoc, isLoading: prLoading, error: prError, mutate: prMutate } = useFrappeGetDoc<PRDocType>(
        "Procurement Requests",
        prId || '', // Provide empty string fallback to avoid hook issues
        prQueryKey
    );

    useFrappeDocumentEventListener("Procurement Requests", prId || '', (event) => {
          console.log("Procurement Requests document updated (real-time):", event?.name);
          toast({
              title: "Document Updated",
              description: `Procurement Requests ${event?.name} has been modified.`,
          });
          prMutate(); // Re-fetch this specific document
        },
        true // emitOpenCloseEventsOnMount (default)
        );

    const { make_list, makeListMutate, allMakeOptions, categoryMakelist, categoryMakeListMutate } = useRelatedPRData({ prDoc });

    // --- 2. Fetch Project Document (conditional) ---
    const projectQueryKey = prDoc?.project ? queryKeys.projects.doc(prDoc.project) : null;
    const { data: projectDoc, isLoading: projectLoading, error: projectError } = useFrappeGetDoc<Project>(
        "Projects",
        prDoc?.project || '', // Docname to fetch
        projectQueryKey
    );

    // --- 3. Fetch Related Data using Individual Hooks ---
    const workPackage = useMemo(() => prDoc?.work_package, [prDoc]);
    const prName = useMemo(() => prDoc?.name, [prDoc]);

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

    // --- 4. Initialize Draft Manager Hook ---
    // Converts server data to draft format and manages local edits with auto-save
    const draftManagerEnabled = !!prDoc?.name && prDoc?.workflow_state === 'Pending';

    log('Draft manager setup:', {
        prId: prDoc?.name,
        enabled: draftManagerEnabled,
        orderListLength: prDoc?.order_list?.length ?? 0,
    });

    // IMPORTANT: Memoize serverData to prevent infinite re-renders
    // Without useMemo, a new object is created on every render, causing useEffect loops
    const serverDataForDraft = useMemo(() => {
        const data = {
            orderList: prDoc?.order_list || [],
            categoryList: prDoc?.category_list?.list || [],
            modifiedAt: prDoc?.modified || '',
        };
        log('serverDataForDraft memoized:', {
            orderListLength: data.orderList.length,
            categoryListLength: data.categoryList.length,
        });
        return data;
    }, [prDoc?.order_list, prDoc?.category_list?.list, prDoc?.modified]);

    const draftManager = useApproveNewPRDraftManager({
        prId: prDoc?.name || '',
        projectId: prDoc?.project || '',
        workPackage: prDoc?.work_package || '',
        serverData: serverDataForDraft,
        enabled: draftManagerEnabled,
    });

    log('Draft manager state:', {
        hasDraft: draftManager.hasDraft,
        isSaving: draftManager.isSaving,
        isInitialized: draftManager.isInitialized,
        showResumeDialog: draftManager.showResumeDialog,
    });

    // --- 5. Initialize Editing Lock Hook ---
    // Handles optimistic locking to prevent concurrent edits
    const editingLock = useEditingLock({
        prName: prDoc?.name || '',
        enabled: !!prDoc?.name && prDoc?.workflow_state === 'Pending',
    });

    // --- 6. Instantiate the Logic Hook ---
    // Pass draft manager methods for draft-first editing approach
    const logicProps = useApprovePRLogic({
        workPackage,
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
        categoryMakelist: categoryMakelist,
        categoryMakeListMutate,
        // Pass draft manager for draft-first editing approach
        // Only enable draft-first when PR is in Pending state and draft manager is initialized
        draftManager: (!!prDoc?.name && prDoc?.workflow_state === 'Pending') ? {
            addItem: draftManager.addItem,
            updateItem: draftManager.updateItem,
            deleteItem: draftManager.deleteItem,
            undoDelete: draftManager.undoDelete,
            updateOrderList: draftManager.updateOrderList,
            updateCategoryList: draftManager.updateCategoryList,
            getDataForSubmission: draftManager.getDataForSubmission,
            clearDraftAfterSubmit: draftManager.clearDraftAfterSubmit,
            setUniversalComment: draftManager.setUniversalComment,
            orderList: draftManager.orderList,
            categoryList: draftManager.categoryList,
            universalComment: draftManager.universalComment,
            undoStack: draftManager.undoStack,
            isInitialized: draftManager.isInitialized,
        } : undefined,
    });

    // --- Combined Loading State ---
    const isDataLoading = prLoading || projectLoading || usersLoading || categoriesLoading || itemsLoading || commentsLoading;

    // --- Combined Error State ---
    const error = prError || projectError || usersError || categoriesError || itemsError || commentsError;

    // --- Handle cancel/back navigation ---
    const handleCancelNavigation = () => {
        draftManager.discardDraft();
        navigate("/procurement-requests?tab=Approve PR");
    };

    // --- Render Logic ---

    // Missing prId check
    if (!prId) {
        return <div className="flex items-center justify-center h-[90vh]">Error: PR ID is missing.</div>;
    }

    // Initial Data Loading State (Focus on PR doc first)
    if (prLoading && !prDoc) {
        return (
            <LoadingFallback />
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
            <LoadingFallback />
        );
    }


    // --- Render View ---
    // All necessary data should be loaded by this point
    return (
        <>
            {/* Draft Resume Dialog - shown when user returns with an existing draft */}
            <DraftResumeDialog
                open={draftManager.showResumeDialog}
                onOpenChange={draftManager.setShowResumeDialog}
                onResume={draftManager.resumeDraft}
                onStartFresh={draftManager.discardDraft}
                draftDate={null} // Draft manager uses lastSavedText (already formatted)
                workPackage={prDoc?.work_package}
                prId={prDoc?.name}
                createdBy={logicProps.getFullName(prDoc?.owner) || prDoc?.owner}
            />

            {/* Draft Cancel Dialog - shown when user attempts to leave with unsaved changes */}
            <DraftCancelDialog
                open={draftManager.showCancelDialog}
                onOpenChange={draftManager.setShowCancelDialog}
                onSaveDraft={() => {
                    draftManager.saveDraftNow();
                    navigate("/procurement-requests?tab=Approve PR");
                }}
                onDiscard={handleCancelNavigation}
                onCancel={() => draftManager.setShowCancelDialog(false)}
                isSaving={draftManager.isSaving}
            />

            <ApprovePRView
                {...logicProps} // Spread all state and handlers from the logic hook
                projectDoc={projectDoc}
                categoryList={categoryList}
                // Draft-related props
                hasDraft={draftManager.hasDraft}
                lastSavedText={draftManager.lastSavedText}
                isSaving={draftManager.isSaving}
                onCancel={() => draftManager.setShowCancelDialog(true)}
                onBack={() => navigate("/procurement-requests?tab=Approve PR")}
                // Lock-related props
                showLockWarning={editingLock.showLockWarning}
                lockInfo={editingLock.lockInfo}
                onRefreshLock={editingLock.acquireLock}
                onEditAnyway={editingLock.forceAcquireLock}
                isRefreshingLock={editingLock.isAcquiring}
            />
        </>
    );
};

export default ApprovePRContainer;