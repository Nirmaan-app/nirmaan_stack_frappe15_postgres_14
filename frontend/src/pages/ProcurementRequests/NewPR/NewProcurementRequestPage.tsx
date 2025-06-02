import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useFrappeDocumentEventListener, useFrappeGetDoc } from 'frappe-react-sdk';

// Import UI Components
import { WorkPackageSelector } from './components/WorkPackageSelector';
import { ItemSelectorControls } from './components/ItemSelectorControls';
import { OrderListDisplay } from './components/OrderListDisplay';
import { ActionButtons } from './components/ActionButtons';
import { PreviousComments } from './components/PreviousComments';
import { NewItemDialog } from './components/NewItemDialog';
import { EditItemDialog } from './components/EditItemDialog';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { MessageCircleWarning } from 'lucide-react';

// Store, Hooks, Types
import { useProcurementRequestStore } from './store/useProcurementRequestStore';
import { Category, ProcurementRequest } from '@/types/NirmaanStack/ProcurementRequests';
import { BackendPRItemDetail, CategoryMakesMap, CategorySelection, ProcurementRequestItem } from './types';
import { useProcurementRequestData } from './hooks/useProcurementRequestData';
import { useProcurementRequestForm } from './hooks/useProcurementRequestForm';
import { useSubmitProcurementRequest } from './hooks/useSubmitProcurementRequest';
import { Projects, WorkPackage } from '@/types/NirmaanStack/Projects';
import { toast } from '@/components/ui/use-toast';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import LoadingFallback from '@/components/layout/loaders/LoadingFallback';


type PageState = 'loading' | 'wp-selection' | 'item-selection' | 'error';

// Helper function to safely parse JSON and extract makes map
export const extractMakesFromChildTableForWP = (project: Projects | undefined, selectedWorkPackageName: string): CategoryMakesMap => {
    
    const makesMap: CategoryMakesMap = {};
    if (!project?.project_wp_category_makes || !selectedWorkPackageName) {
        return makesMap;
    }

    project.project_wp_category_makes.forEach((itemLink) => {
        // itemLink is a row from the 'project_wp_category_makes' child table
        if (itemLink.procurement_package === selectedWorkPackageName) {
            if (!makesMap[itemLink.category]) {
                makesMap[itemLink.category] = [];
            }
            // Only add the make if it's present and not already in the list for that category
            if (itemLink.make && !makesMap[itemLink.category].includes(itemLink.make)) {
                makesMap[itemLink.category].push(itemLink.make);
            }
        }
    });
     // Sort makes within each category for consistency
    for (const category in makesMap) {
        makesMap[category].sort();
    }
    return makesMap;

};

export const NewProcurementRequestPage: React.FC<{ resolve?: boolean; edit?: boolean }> = ({ resolve = false, edit = false }) => {
    const { projectId, prId } = useParams<{ projectId: string; prId?: string }>();
    const mode = edit ? 'edit' : resolve ? 'resolve' : 'create';

    // Local state for UI flow and dialogs
    const [page, setPage] = useState<PageState>('loading');
    const [showNewItemDialog, setShowNewItemDialog] = useState(false);
    const [itemToEdit, setItemToEdit] = useState<ProcurementRequestItem | null>(null);

    // --- Store Initialization --- 
    const setStoreComment = useProcurementRequestStore(state => state.setNewPRComment);
    const initializeStore = useProcurementRequestStore(state => state.initialize);
    const wpFromStore = useProcurementRequestStore(state => state.selectedWP);
    const isStoreInitialized = useProcurementRequestStore(state => state.isInitialized);
    // const resetStore = useProcurementRequestStore(state => state.resetStore); // Get if needed for cleanup

    const initialCategoryMakes = useProcurementRequestStore(state => state.initialCategoryMakes)

    // Fetch existing PR data only if in edit/resolve mode
    const { data: existingPRData, isLoading: existingPRLoading, mutate: existingPRDataMutate } = useFrappeGetDoc<ProcurementRequest>(
        "Procurement Requests",
        prId!,
        !!prId && (mode === 'edit' || mode === 'resolve') ? undefined : null
        // Correct options syntax for conditional fetching
        // { enabled: !!prId && (mode === 'edit' || mode === 'resolve') }
    );

    const {emitDocOpen} =  useFrappeDocumentEventListener("Procurment Requests", prId!, (event) => {
        if(prId) {
            existingPRDataMutate();
            console.log("Procurement Request document updated (real-time):", event);
            toast({
                title: "Document Updated",
                description: `Procurement Request ${event.name} has been modified.`,
            });
        }
        },
        false
    )

    useEffect(() => {
        if (prId) {
            emitDocOpen();
        }
    }, [prId, emitDocOpen]);


    // --- Data Hooks ---
    // Fetch project data FIRST or ensure it's available for initialization
    const { project, wpList, categoryList, itemList, itemOptions, makeList, allMakeOptions, isLoading: dataLoading, error: dataError, itemMutate, makeListMutate, categoryMakelist, categoryMakeListMutate } = useProcurementRequestData();

    // Effect to initialize or re-initialize the store
    useEffect(() => {
        if (mode === "create" && !projectId) return;

        if ((mode === 'edit' || mode === 'resolve') && !prId) {
            console.error("Edit/Resolve mode requires a prId!");
            setPage('error');
            return;
        }

        if ((mode === 'edit' || mode === 'resolve') && existingPRLoading) {
            setPage('loading');
            return;
        }

        let initialDataForStore: { 
         workPackage: string, 
         procList: ProcurementRequestItem[], // Frontend item structure
         categories: CategorySelection[] // Your existing type for selectedCategories
     } | undefined = undefined;
     let initialWpMakesMap: CategoryMakesMap = {};

     if ((mode === 'edit' || mode === 'resolve') && existingPRData) {
         const transformedProcList: ProcurementRequestItem[] = (existingPRData.order_list || []).map(
             (backendItem: BackendPRItemDetail): ProcurementRequestItem => ({
                 uniqueId: backendItem.name, // Use Frappe's child row name as uniqueId
                 name: backendItem.item_id,       // Map backend item_id to frontend name
                 item: backendItem.item_name,     // Map backend item_name to frontend item
                 unit: backendItem.unit,
                 quantity: backendItem.quantity,
                 category: backendItem.category,
                 work_package: backendItem.procurement_package!, // Map backend procurement_package
                 make: backendItem.make || undefined, // Ensure undefined if null/empty
                 status: backendItem.status as ProcurementRequestItem['status'], // Ensure type assertion
                 tax: backendItem.tax ?? 0, // Default tax to 0 if undefined; your frontend type expects number
                 comment: backendItem.comment || undefined,
             })
         );

         // For 'categories', the existingPRData.category_list (JSON) would still be used
         // as we haven't migrated that one yet.
        //  let parsedCatList: Category[] = [];
        //  try {
        //      const catListRaw = existingPRData.category_list;
        //      parsedCatList = (typeof catListRaw === "string" ? JSON.parse(catListRaw || '{"list":[]}') : catListRaw)?.list || [];
        //  } catch (e) {
        //      console.error("Failed to parse existing PR category_list data:", e);
        //  }
         // Note: The store's selectedCategories are derived, so initialPrData.categories is less critical here
         // The main thing is having the procList to derive from.

         initialDataForStore = {
             workPackage: existingPRData.work_package || '',
             procList: transformedProcList,
             categories: [], // selectedCategories will be derived by the store from procList and makes
         };

         if (initialDataForStore.workPackage && project) {
             initialWpMakesMap = extractMakesFromChildTableForWP(project, initialDataForStore.workPackage);
         }
     }
     
     initializeStore(mode, projectId, prId, initialWpMakesMap, initialDataForStore);

}, [mode, projectId, prId, initializeStore, existingPRData, existingPRLoading, project]);


    // --- Hooks ---
    const {
        selectedWP,
        procList, selectedCategories, undoStack, newPRComment,
        selectWorkPackage,
        addOrUpdateItem, // This is for ADDING new items/requests
        updateItemInList, // <-- GET THE UPDATE FUNCTION
        deleteItemFromList, // <-- GET THE DELETE FUNCTION
        undoLastDelete,
        setComment,
        handleFuzzySearch,
        updateCategoryMakes,
        itemFuseOptions
    } = useProcurementRequestForm(
        makeListMutate,
        itemList,
        makeList,
        allMakeOptions,
    );

    const { submitNewPR, resolveOrUpdatePR, cancelDraftPR, isSubmitting } = useSubmitProcurementRequest();

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


    // --- Handler for WP Selection (to derive makes) ---
    const handleWorkPackageSelect = useCallback((wpName: string) => {
    if (!project && wpName) { // Check wpName too, if clearing WP, project might not be needed
        console.error("Project data not loaded, cannot select WP makes");
        // If wpName is empty (clearing selection), we might not need project here.
        // But to get makes for a *new* WP, project is needed.
        if (wpName) {
         toast({ title: "Error", description: "Project data not available to fetch makes.", variant: "destructive" });
         return;
        }
    }
    
    let wpMakesForStore: CategoryMakesMap = {};
    if (wpName && project) { // Only extract makes if a WP is selected and project data exists
        wpMakesForStore = extractMakesFromChildTableForWP(project, wpName);
    }
    
    // selectWorkPackage (from useProcurementRequestForm) expects (wpName, wpSpecificMakes)
    selectWorkPackage(wpName, wpMakesForStore); 
    
    // Page state might change based on wpName (if it's set or cleared)
    if (!wpName) {
        setPage('wp-selection'); // Go back to WP selection if cleared
    } else {
        setPage('item-selection'); // Proceed if a WP is selected
    }

}, [project, selectWorkPackage, setPage, toast]); // Added toast and setPage

    // --- Render Logic ---
    if (page === 'loading') {
        return <LoadingFallback />
    }

    if (page === 'error') {
        return <AlertDestructive error={dataError} />
    }

    const handleSubmitWithComment = async (finalCommentFromDialog: string) => {
        // Optionally, update the store here if you still want the store to hold the
        // comment that was *actually* submitted.
        setStoreComment(finalCommentFromDialog); // Update Zustand store

        if (mode === 'create') {
            await submitNewPR(finalCommentFromDialog);
        } else {
            await resolveOrUpdatePR(finalCommentFromDialog);
        }
    }

    return (
        <div className="flex-1 space-y-4 px-4 py-4">
            {page === 'wp-selection' && (
                <WorkPackageSelector
                    // Filter WP list based on project data (ensure project is loaded)
                    wpList={wpList?.filter(item => {
                        if (!project?.project_work_packages) return item.work_package_name === "Tool & Equipments"; // Default fallback if project data missing
                        let wp_arr = [];
                        try {
                            if (typeof project.project_work_packages === 'string') {
                                wp_arr = JSON.parse(project.project_work_packages || '[]')?.work_packages?.map((item: any) => item.work_package_name) || [];
                            } else if (typeof project.project_work_packages === 'object' && project.project_work_packages?.work_packages) {
                                wp_arr = project.project_work_packages.work_packages.map((item: any) => item.work_package_name) || [];
                            }
                        } catch (e) { console.error("Error parsing project_work_packages in filter") }
                        return item.work_package_name === "Tool & Equipments" || wp_arr.includes(item.work_package_name);
                    })}
                    onSelectWP={handleWorkPackageSelect} // <<< Use the new handler
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
                        initialCategoryMakes={initialCategoryMakes}
                        selectedWP={selectedWP}
                        // catOptions={catOptions}
                        itemOptions={itemOptions}
                        allMakeOptions={allMakeOptions} // Pass all makes
                        selectedCategories={selectedCategories} // Pass selected 
                        // categories state
                        onAddItem={addOrUpdateItem} // For adding new items/requests
                        onOpenNewItemDialog={() => setShowNewItemDialog(true)}
                        allowWpEdit={mode === 'create'}
                        onEditWP={() => {
                            // Use the handler to reset, which will also clear makes map
                            handleWorkPackageSelect('');
                        }}
                        disabled={isSubmitting}
                        categoryList={categoryList} // Pass full category list
                        updateCategoryMakesInStore={updateCategoryMakes}
                        makeListMutate={makeListMutate}
                        categoryMakelist={categoryMakelist} // Pass if needed by dialog
                        categoryMakeListMutate={categoryMakeListMutate}
                        itemFuseOptions={itemFuseOptions}
                    />

                    <div className="flex flex-col justify-between min-h-[48vh]">
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
                            {/* <textarea
                                className="w-full border rounded-lg p-2 min-h-[60px] mt-2 text-sm focus:ring-1 focus:ring-primary focus:border-primary"
                                placeholder={`${mode === 'resolve' ? "Resolving Comments (Optional)..." : mode === 'edit' ? "Update Comments (Optional)..." : "Comments (Optional)..."}`}
                                value={newPRComment}
                                onChange={(e) => setComment(e.target.value)}
                                disabled={isSubmitting}
                            /> */}
                            <ActionButtons
                                mode={mode}
                                onSubmit={handleSubmitWithComment}
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
                categories={categoryList || []} // Already passing
                onSubmitUpdate={updateItemInList}
                onDeleteItem={deleteItemFromList}
                // --- Pass Make-related Props ---
                allMakeOptions={allMakeOptions}
                initialCategoryMakes={initialCategoryMakes}
                selectedCategories={selectedCategories} // Pass current derived categories
                updateCategoryMakesInStore={updateCategoryMakes}
                makeList={makeList}
                makeListMutate={makeListMutate}
                categoryMakelist={categoryMakelist} // Pass if needed by dialog
                categoryMakeListMutate={categoryMakeListMutate} // Pass if needed by dialog
            // --- End Make-related Props ---

            />
        </div>
    );
};