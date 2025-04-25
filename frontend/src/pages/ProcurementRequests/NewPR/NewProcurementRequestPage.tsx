// import React, { useEffect, useState } from 'react';
// import { useParams } from 'react-router-dom';
// import { useFrappeGetDoc } from 'frappe-react-sdk'; // For fetching existing PR data

// // Import UI Components
// import { WorkPackageSelector } from './components/WorkPackageSelector';
// import { ItemSelectorControls } from './components/ItemSelectorControls';
// import { OrderListDisplay } from './components/OrderListDisplay';
// import { ActionButtons } from './components/ActionButtons';
// import { PreviousComments } from './components/PreviousComments';

// import { TableSkeleton } from '@/components/ui/skeleton'; // Adjust path
// import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'; // Adjust path
// import { MessageCircleWarning } from 'lucide-react';
// import { useProcurementRequestStore } from './store/useProcurementRequestStore';
// import { ProcurementRequest } from '@/types/NirmaanStack/ProcurementRequests';
// import { ProcurementRequestItem } from './types';
// import { useProcurementRequestData } from './hooks/useProcurementRequestData';
// import { useProcurementRequestForm } from './hooks/useProcurementRequestForm';
// import { useSubmitProcurementRequest } from './hooks/useSubmitProcurementRequest';
// import { Button } from '@/components/ui/button';
// import { NewItemDialog } from './components/NewItemDialog';
// import { EditItemDialog } from './components/EditItemDialog';

// type PageState = 'loading' | 'wp-selection' | 'item-selection' | 'error';

// export const NewProcurementRequestPage: React.FC<{ resolve?: boolean; edit?: boolean }> = ({ resolve = false, edit = false }) => {
//     const { projectId, prId } = useParams<{ projectId: string; prId?: string }>();
//     const mode = edit ? 'edit' : resolve ? 'resolve' : 'create';

//     console.log("prId", prId)

//     console.log("projectId", projectId)

//     // Local state for UI flow and dialogs
//     const [page, setPage] = useState<PageState>('loading');
//     const [showNewItemDialog, setShowNewItemDialog] = useState(false);
//     const [itemToEdit, setItemToEdit] = useState<ProcurementRequestItem | null>(null); // For EditItemDialog

//     // --- Store Initialization ---
//     // const { initialize: initializeStore, selectedWP: wpFromStore, isStoreInitialized, resetStore } = useProcurementRequestStore(state => ({
//     //     initialize: state.initialize,
//     //     selectedWP: state.selectedWP,
//     //     isStoreInitialized: state.isInitialized,
//     //     resetStore: state.resetStore
//     // }));

//     // --- Store Initialization ---
// // NEW - Select primitives and stable actions individually
// const initializeStore = useProcurementRequestStore(state => state.initialize);
// const wpFromStore = useProcurementRequestStore(state => state.selectedWP);
// const isStoreInitialized = useProcurementRequestStore(state => state.isInitialized);
// const resetStore = useProcurementRequestStore(state => state.resetStore); // Actions are stable

//     // Fetch existing PR data only if in edit/resolve mode and not already initialized correctly
//     const { data: existingPRData, isLoading: existingPRLoading } = useFrappeGetDoc<ProcurementRequest>(
//         "Procurement Requests",
//         prId!,
//         !!prId && (mode === 'edit' || mode === 'resolve') ? undefined : null
//         // { enabled: !!prId && (mode === 'edit' || mode === 'resolve') }
//     );

//     // Effect to initialize or re-initialize the store based on mode, params, and existing data
//     useEffect(() => {
//         if (!projectId) return; // Don't initialize without projectId

//         if ((mode === 'edit' || mode === 'resolve') && !prId) {
//             console.error("Edit/Resolve mode requires a prId!");
//             // Handle error state - maybe redirect or show error message
//             setPage('error');
//             return;
//         }

//         // Wait for existing PR data if needed
//         if ((mode === 'edit' || mode === 'resolve') && existingPRLoading) {
//             setPage('loading');
//             return;
//         }

//         let initialData = undefined;
//         if ((mode === 'edit' || mode === 'resolve') && existingPRData) {
//             try {
//                  // Ensure lists are parsed correctly and are arrays
//                 const procList = (typeof existingPRData?.procurement_list === "string" ? JSON.parse(existingPRData.procurement_list) : existingPRData.procurement_list)?.list || [];
//                 const categories = (typeof existingPRData?.category_list === "string" ? JSON.parse(existingPRData.category_list) : existingPRData.category_list)?.list || [];

//                 initialData = {
//                     workPackage: existingPRData.work_package || '',
//                     procList: Array.isArray(procList) ? procList : [],
//                     categories: Array.isArray(categories) ? categories : [],
//                 };
//             } catch (e) {
//                 console.error("Failed to parse existing PR data:", e);
//                 // Handle this error - maybe prevent initialization or show warning
//             }
//         }

//         // Initialize store - this also checks if re-initialization is needed
//         initializeStore(mode, projectId, prId, initialData);

//     }, [mode, projectId, prId, initializeStore, existingPRData, existingPRLoading]);


//     // --- Hooks --- (Initialize after store might be ready)
//     const { project, wpList, categoryList, itemList, itemOptions, catOptions, isLoading: dataLoading, error: dataError, itemMutate } = useProcurementRequestData();
//     const {
//         procList, selectedCategories, undoStack, newPRComment,
//         selectWorkPackage, addOrUpdateItem, deleteItemFromList, undoLastDelete, setComment, handleFuzzySearch
//      } = useProcurementRequestForm(itemList); // Pass itemList for fuzzy search
//     const { submitNewPR, resolveOrUpdatePR, cancelDraftPR, isSubmitting } = useSubmitProcurementRequest();

//     // --- Page State Logic ---
//     useEffect(() => {
//         if (!isStoreInitialized) {
//             setPage('loading'); // Keep loading until store confirms initialization
//         } else if (dataLoading) {
//              setPage('loading');
//         } else if (dataError) {
//             setPage('error');
//         } else if (!wpFromStore) {
//             setPage('wp-selection');
//         } else {
//             setPage('item-selection');
//         }
//     }, [isStoreInitialized, dataLoading, wpFromStore, dataError]);

//     // Cleanup store on unmount if necessary (e.g., if navigating away cancels draft)
//     // useEffect(() => {
//     //     return () => {
//     //         // Decide if reset is needed based on navigation context if possible
//     //         // console.log("Unmounting NewProcurementRequestPage");
//     //         // resetStore(); // Caution: This might clear data unintentionally
//     //     };
//     // }, [resetStore]);

//     // --- Render Logic ---

//     if (page === 'loading') {
//         return <div className="p-4"><TableSkeleton /></div>; // Or a more specific loading indicator
//     }

//     if (page === 'error') {
//          return <div className="p-4 text-red-500">Error loading procurement request data. Please try again.</div>;
//     }

//     const handleSubmitAction = mode === 'create' ? submitNewPR : resolveOrUpdatePR;

//     return (
//         <div className="flex-1 space-y-4 px-4 py-4">
//             {page === 'wp-selection' && (
//                 <WorkPackageSelector
//                     wpList={wpList?.filter(item => {
//                         // Your existing filter logic - ensure project data is loaded
//                         let wp_arr = [];
//                         try {
//                             wp_arr = JSON.parse(project?.project_work_packages || '[]')?.work_packages?.map((item: any) => item.work_package_name) || [];
//                         } catch (e) { console.error("Error parsing project_work_packages") }

//                         return item.work_package_name === "Tool & Equipments" || wp_arr.includes(item.work_package_name);
//                     })}
//                     onSelectWP={(wp: string) => {
//                         selectWorkPackage(wp);
//                         setPage('item-selection'); // Move to next step
//                     }}
//                 />
//             )}

//             {page === 'item-selection' && wpFromStore && (
//                 <>
//                     {mode === 'edit' && (
//                         <Alert variant="warning" className="mb-4">
//                             <AlertTitle className="text-sm flex items-center gap-2">
//                                 <MessageCircleWarning className="h-4 w-4 text-sm" />
//                                 Editing Draft
//                             </AlertTitle>
//                             <AlertDescription className="py-2 px-2 flex justify-between items-center text-xs">
//                                 <span>This PR is marked as "Draft". Update and submit or cancel the draft.</span>
//                                 <Button size="sm" variant="outline" disabled={isSubmitting} onClick={cancelDraftPR}>
//                                     Cancel Draft
//                                 </Button>
//                             </AlertDescription>
//                         </Alert>
//                     )}

//                     <ItemSelectorControls
//                         selectedWP={wpFromStore}
//                         catOptions={catOptions}
//                         itemOptions={itemOptions}
//                         onAddItem={addOrUpdateItem}
//                         onOpenNewItemDialog={() => setShowNewItemDialog(true)}
//                         allowWpEdit={mode === 'create'} // Only allow WP change in create mode
//                         onEditWP={() => setPage('wp-selection')} // Basic reset, might need confirmation dialog
//                         disabled={isSubmitting} // Disable controls during submission
//                     />

//                     <div className="flex flex-col justify-between min-h-[58vh]"> {/* Adjust height as needed */}
//                         <div className="flex-grow overflow-y-auto pr-2"> {/* Make list scrollable */}
//                              <OrderListDisplay
//                                 procList={procList}
//                                 selectedCategories={selectedCategories}
//                                 onEditItem={(item: ProcurementRequestItem) => setItemToEdit(item)}
//                                 onDeleteItem={deleteItemFromList}
//                                 canUndo={undoStack.length > 0}
//                                 onUndoDelete={undoLastDelete}
//                             />
//                         </div>

//                         <div className="mt-4 flex-shrink-0"> {/* Keep comments and actions at bottom */}
//                            {(mode === 'resolve' || mode === 'edit') && prId && (
//                                 <PreviousComments prId={prId} mode={mode} />
//                            )}
//                            <textarea
//                                 className="w-full border rounded-lg p-2 min-h-[60px] mt-2 text-sm"
//                                 placeholder={`${mode === 'resolve' ? "Resolving Comments (Optional)..." : mode === 'edit' ? "Update Comments (Optional)..." : "Comments (Optional)..."}`}
//                                 value={newPRComment}
//                                 onChange={(e) => setComment(e.target.value)}
//                                 disabled={isSubmitting}
//                             />
//                            <ActionButtons
//                                 mode={mode}
//                                 onSubmit={handleSubmitAction} // Use combined handler
//                                 isSubmitting={isSubmitting}
//                                 disabled={procList.length === 0} // Disable submit if list is empty
//                             />
//                         </div>
//                     </div>
//                 </>
//             )}

//              {/* Dialogs */}
//             <NewItemDialog
//                 isOpen={showNewItemDialog}
//                 onOpenChange={setShowNewItemDialog}
//                 categories={categoryList || []} // Pass fetched categories
//                 workPackage={wpFromStore}
//                 onSubmit={addOrUpdateItem} // Pass the form hook's add function
//                 fuzzySearch={handleFuzzySearch}
//                 itemList={itemList} // Pass full item list for fuzzy search
//                 itemMutate={itemMutate} // Pass mutate to refresh items after creation
//             />

//             <EditItemDialog
//                 isOpen={!!itemToEdit}
//                 onOpenChange={(isOpen: boolean) => { if (!isOpen) setItemToEdit(null); }}
//                 itemToEdit={itemToEdit}
//                 categories={categoryList || []} // Pass categories for potential change
//                 // onSubmitUpdate will likely call store.updateProcItem
//                 // onDelete will likely call store.deleteProcItem
//             />
//         </div>
//     );
// };


// src/features/procurement-requests/pages/NewProcurementRequestPage.tsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useFrappeGetDoc } from 'frappe-react-sdk';

// Import UI Components
import { WorkPackageSelector } from './components/WorkPackageSelector';
import { ItemSelectorControls } from './components/ItemSelectorControls';
import { OrderListDisplay } from './components/OrderListDisplay';
import { ActionButtons } from './components/ActionButtons';
import { PreviousComments } from './components/PreviousComments';
import { NewItemDialog } from './components/NewItemDialog';
import { EditItemDialog } from './components/EditItemDialog';


import { TableSkeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { MessageCircleWarning } from 'lucide-react';

// Store, Hooks, Types
import { useProcurementRequestStore } from './store/useProcurementRequestStore';
import { ProcurementRequest } from '@/types/NirmaanStack/ProcurementRequests';
import { ProcurementRequestItem } from './types';
import { useProcurementRequestData } from './hooks/useProcurementRequestData';
import { useProcurementRequestForm } from './hooks/useProcurementRequestForm';
import { useSubmitProcurementRequest } from './hooks/useSubmitProcurementRequest';


type PageState = 'loading' | 'wp-selection' | 'item-selection' | 'error';

export const NewProcurementRequestPage: React.FC<{ resolve?: boolean; edit?: boolean }> = ({ resolve = false, edit = false }) => {
    const { projectId, prId } = useParams<{ projectId: string; prId?: string }>();
    const mode = edit ? 'edit' : resolve ? 'resolve' : 'create';

    // Local state for UI flow and dialogs
    const [page, setPage] = useState<PageState>('loading');
    const [showNewItemDialog, setShowNewItemDialog] = useState(false);
    const [itemToEdit, setItemToEdit] = useState<ProcurementRequestItem | null>(null);

    // --- Store Initialization ---
    const initializeStore = useProcurementRequestStore(state => state.initialize);
    const wpFromStore = useProcurementRequestStore(state => state.selectedWP);
    const isStoreInitialized = useProcurementRequestStore(state => state.isInitialized);
    // const resetStore = useProcurementRequestStore(state => state.resetStore); // Get if needed for cleanup

    // Fetch existing PR data only if in edit/resolve mode
    const { data: existingPRData, isLoading: existingPRLoading } = useFrappeGetDoc<ProcurementRequest>(
        "Procurement Requests",
        prId!,
        !!prId && (mode === 'edit' || mode === 'resolve') ? undefined : null
        // Correct options syntax for conditional fetching
        // { enabled: !!prId && (mode === 'edit' || mode === 'resolve') }
    );

    // Effect to initialize or re-initialize the store
    useEffect(() => {
        if (!projectId) return;

        if ((mode === 'edit' || mode === 'resolve') && !prId) {
            console.error("Edit/Resolve mode requires a prId!");
            setPage('error');
            return;
        }

        if ((mode === 'edit' || mode === 'resolve') && existingPRLoading) {
            setPage('loading');
            return;
        }

        let initialData = undefined;
        if ((mode === 'edit' || mode === 'resolve') && existingPRData) {
            try {
                // Safe parsing of potentially stringified JSON
                const procListRaw = existingPRData.procurement_list;
                const catListRaw = existingPRData.category_list;

                const procList = (typeof procListRaw === "string" ? JSON.parse(procListRaw || '{"list":[]}') : procListRaw)?.list || [];
                const categories = (typeof catListRaw === "string" ? JSON.parse(catListRaw || '{"list":[]}') : catListRaw)?.list || [];

                initialData = {
                    workPackage: existingPRData.work_package || '',
                    // Ensure parsed data are arrays
                    procList: Array.isArray(procList) ? procList : [],
                    categories: Array.isArray(categories) ? categories : [],
                };
            } catch (e) {
                console.error("Failed to parse existing PR data:", e);
            }
        }

        initializeStore(mode, projectId, prId, initialData);

    }, [mode, projectId, prId, initializeStore, existingPRData, existingPRLoading]);


    // --- Hooks ---
    const { project, wpList, categoryList, itemList, itemOptions, catOptions, isLoading: dataLoading, error: dataError, itemMutate } = useProcurementRequestData();
    const {
        procList, selectedCategories, undoStack, newPRComment,
        selectWorkPackage,
        addOrUpdateItem, // This is for ADDING new items/requests
        updateItemInList, // <-- GET THE UPDATE FUNCTION
        deleteItemFromList, // <-- GET THE DELETE FUNCTION
        undoLastDelete,
        setComment,
        handleFuzzySearch
     } = useProcurementRequestForm(itemList);
    const { submitNewPR, resolveOrUpdatePR, cancelDraftPR, isSubmitting } = useSubmitProcurementRequest();

    console.log("wpfromstore", wpFromStore)

    // --- Page State Logic ---
    useEffect(() => {
        // Wait for store init AND data loading
        if (!isStoreInitialized || dataLoading) {
            setPage('loading');
        } else if (dataError) {
            setPage('error');
        } else if (!wpFromStore) {
            setPage('wp-selection');
        } else {
            setPage('item-selection');
        }
    }, [isStoreInitialized, dataLoading, wpFromStore, dataError]);


    // --- Render Logic ---

    if (page === 'loading') {
        return <div className="p-4"><TableSkeleton /></div>;
    }

    if (page === 'error') {
         return <div className="p-4 text-red-500">Error loading procurement request data. Please check URL parameters or try again.</div>;
    }


    console.log("procList", procList)

    console.log("categories", selectedCategories)

    const handleSubmitAction = mode === 'create' ? submitNewPR : resolveOrUpdatePR;

    return (
        <div className="flex-1 space-y-4 px-4 py-4">
            {page === 'wp-selection' && (
                <WorkPackageSelector
                    wpList={wpList?.filter(item => {
                        let wp_arr = [];
                        try {
                            wp_arr = JSON.parse(project?.project_work_packages || '[]')?.work_packages?.map((item: any) => item.work_package_name) || [];
                        } catch (e) { console.error("Error parsing project_work_packages") }
                        return item.work_package_name === "Tool & Equipments" || wp_arr.includes(item.work_package_name);
                    })}
                    onSelectWP={(wp: string) => {
                        selectWorkPackage(wp);
                        // No need to setPage here, useEffect handles it based on wpFromStore
                    }}
                />
            )}

            {page === 'item-selection' && wpFromStore && (
                <>
                    {mode === 'edit' && (
                        <Alert variant="warning" className="mb-4">
                            <AlertTitle className="text-sm flex items-center gap-2">
                                <MessageCircleWarning className="h-4 w-4 text-sm" />
                                Editing Draft
                            </AlertTitle>
                            <AlertDescription className="py-2 px-2 flex justify-between items-center text-xs">
                                <span>This PR is marked as "Draft". Update and submit or cancel the draft.</span>
                                <Button size="sm" variant="outline" disabled={isSubmitting} onClick={cancelDraftPR}>
                                    Cancel Draft
                                </Button>
                            </AlertDescription>
                        </Alert>
                    )}

                    <ItemSelectorControls
                        selectedWP={wpFromStore}
                        catOptions={catOptions}
                        itemOptions={itemOptions}
                        onAddItem={addOrUpdateItem} // For adding new items/requests
                        onOpenNewItemDialog={() => setShowNewItemDialog(true)}
                        allowWpEdit={mode === 'create'}
                        onEditWP={() => {
                            // Optionally show confirmation before resetting
                            selectWorkPackage(''); // Reset WP in store, useEffect will change page state
                        }}
                        disabled={isSubmitting}
                        categoryList={categoryList} // Pass full category list
                    />

                    <div className="flex flex-col justify-between min-h-[58vh]">
                        <div className="flex-grow overflow-y-auto pr-2">
                             <OrderListDisplay
                                procList={procList}
                                selectedCategories={selectedCategories}
                                onEditItem={(item: ProcurementRequestItem) => setItemToEdit(item)} // Opens Edit Dialog
                                onDeleteItem={deleteItemFromList} // Directly pass store delete action
                                canUndo={undoStack.length > 0}
                                onUndoDelete={undoLastDelete} // Directly pass store undo action
                            />
                        </div>

                        <div className="mt-4 flex-shrink-0">
                           {(mode === 'resolve' || mode === 'edit') && prId && (
                                <PreviousComments prId={prId} mode={mode} />
                           )}
                           <textarea
                                className="w-full border rounded-lg p-2 min-h-[60px] mt-2 text-sm focus:ring-1 focus:ring-primary focus:border-primary"
                                placeholder={`${mode === 'resolve' ? "Resolving Comments (Optional)..." : mode === 'edit' ? "Update Comments (Optional)..." : "Comments (Optional)..."}`}
                                value={newPRComment}
                                onChange={(e) => setComment(e.target.value)}
                                disabled={isSubmitting}
                            />
                           <ActionButtons
                                mode={mode}
                                onSubmit={handleSubmitAction}
                                isSubmitting={isSubmitting}
                                disabled={procList.length === 0 || isSubmitting} // Also disable if submitting
                                comment={newPRComment}
                                onCommentChange={setComment} // Allow comment edit in dialog
                            />
                        </div>
                    </div>
                </>
            )}

             {/* Dialogs */}
            <NewItemDialog
                isOpen={showNewItemDialog}
                onOpenChange={setShowNewItemDialog}
                categories={categoryList || []}
                workPackage={wpFromStore} // Pass current WP for display
                onSubmit={addOrUpdateItem} // Use the hook's function for adding new/request
                fuzzySearch={handleFuzzySearch}
                itemList={itemList}
                itemMutate={itemMutate}
            />

            <EditItemDialog
                isOpen={!!itemToEdit}
                onOpenChange={(isOpen: boolean) => { if (!isOpen) setItemToEdit(null); }}
                itemToEdit={itemToEdit}
                categories={categoryList || []}
                onSubmitUpdate={updateItemInList} // <-- PASS THE UPDATE FUNCTION
                onDeleteItem={deleteItemFromList} // <-- PASS THE DELETE FUNCTION
            />
        </div>
    );
};