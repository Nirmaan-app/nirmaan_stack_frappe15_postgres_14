import React, { useMemo, useEffect } from 'react';
import { Undo } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

// Import Sub Components
import { ApprovePRHeader } from './components/ApprovePRHeader';
import { AddItemForm } from './components/AddItemForm';
import { ItemListSection } from './components/ItemListSection';
import { RequestedItemsSection } from './components/RequestedItemsSection';
// import { SummaryView } from './components/SummaryView';
import { ActionButtons } from './components/ActionButtons';
import { NewItemDialog } from './components/NewItemDialog';
import { EditItemDialog } from './components/EditItemDialog';
import { RequestItemDialog } from './components/RequestItemDialog';
import { ConfirmationDialog } from './components/ConfirmationDialog'; // Reusable Confirmation
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'; // For Delete PR
import { PRCommentsSection } from './components/PRCommentsSection';


// Import types
import { Project } from './types';
import { useApprovePRLogic } from './hooks/useApprovePRLogic'; // Get hook's return type
import { parseNumber } from '@/utils/parseNumber';
import { CategoryMakesMap } from '../NewPR/types';
import { extractMakesForWP } from '../NewPR/NewProcurementRequestPage';
// import { CategoryMakelist } from '@/types/NirmaanStack/CategoryMakelist'; // Import if needed

// Props Type for the View Component
interface ApprovePRViewProps extends ReturnType<typeof useApprovePRLogic> {
    // Add any additional props needed specifically for rendering that are NOT in the logic hook
    projectDoc?: Project; // Pass project details if needed
}

export const ApprovePRView: React.FC<ApprovePRViewProps> = (props) => {
    const {
        // State & Data from Hook
        orderData,
        summaryAction,
        showNewItemsCard,
        undoStack,
        currentItemOption,
        currentQuantity,
        newItem,
        currentCategoryForNewItem,
        editItem,
        requestItem,
        universalComment,
        fuzzyMatches,
        itemOptions,
        relevantComments,
        isLoading, // Loading state for actions
        categoryList, // Need categoryList for NewItemDialog options

        // Dialog Visibility States
        isNewItemDialogOpen,
        isEditItemDialogOpen,
        isRequestItemDialogOpen,
        isDeletePRDialogOpen,
        isConfirmActionDialogOpen,

        handleFuzzySearch,
        setRequestItem,
        toggleNewItemsCard,
        setCurrentItemOption,
        handleQuantityChange,
        handleUniversalCommentChange,
        setCurrentCategoryForNewItem,
        setNewItem,
        handleAddItemToList,
        handleOpenEditDialog,
        handleEditItemChange,
        handleSaveEditedItem,
        handleDeleteItem,
        handleUndoDelete,
        handleOpenNewItemDialog,
        // handleNewItemChange,
        handleCreateAndAddItem,
        handleOpenRequestItemDialog,
        // handleRequestItemFormChange,
        handleApproveRequestedItemAsNew,
        handleAddMatchingItem,
        handlePrepareAction,
        handleConfirmAction,
        handleOpenDeletePRDialog,
        handleDeletePR,
        // navigateToItemList,

        // Dialog Visibility Setters from Hook
        setIsNewItemDialogOpen,
        setIsEditItemDialogOpen,
        setIsRequestItemDialogOpen,
        setIsDeletePRDialogOpen,
        setIsConfirmActionDialogOpen,

        // Helpers/Derived Data from Hook
        getFullName,
        userData, // Pass user data if needed

        // Additional Props
        projectDoc,
        makeList,
        allMakeOptions,
        categoryMakelist,
        categoryMakeListMutate,
        makeListMutate,
        handleLocalCategoryMakesUpdate
    } = props;

    // // *** Add console log HERE to verify ***
    // useEffect(() => {
    //     console.log("VIEW: Received props.categoryMakelist:", categoryMakelist ? `Count=${categoryMakelist.length}` : 'undefined/null');
    // }, [categoryMakelist]);



    // Derive the initial makes map for *this PR's work package*
    const initialCategoryMakes = useMemo<CategoryMakesMap>(() => {
        if (!orderData?.work_package || !projectDoc) return {}; // Need WP name and project doc
        return extractMakesForWP(projectDoc, orderData.work_package);
    }, [projectDoc, orderData?.work_package]); // Recalculate if project or WP changes


    const addedItems = useMemo(() => orderData.procurement_list?.list?.filter(i => i.status !== 'Request') ?? [], [orderData]);
    const requestedItems = useMemo(() => orderData.procurement_list?.list?.filter(i => i.status === 'Request') ?? [], [orderData]);

    const addedCategories = useMemo(() => orderData.category_list?.list?.filter(c => addedItems.some(item => item.category === c.name && item.status === (c.status || "Pending"))) ?? [], [orderData, addedItems]);

    const requestedCategories = useMemo(() => orderData.category_list?.list?.filter(c => requestedItems.some(item => item.category === c.name && item.status === c.status)) ?? [], [addedItems, orderData]);

    // Derive makes mapping for categories
    const categoryMakesMap = useMemo(() => {
        const map = new Map<string, string[]>();
        if (projectDoc?.project_work_packages) {
            try {
                const workPackages = (typeof projectDoc.project_work_packages === "string" ? JSON.parse(projectDoc.project_work_packages) : projectDoc.project_work_packages)?.work_packages ?? [];
                workPackages.forEach((wp: any) => {
                    (wp.category_list?.list ?? []).forEach((cat: any) => {
                        if (cat.name && cat.makes && cat.makes.length > 0) {
                            map.set(cat.name, cat.makes);
                        }
                    });
                });
            } catch (e) {
                console.error("Failed to parse project work packages for makes:", e);
            }
        }
        return map;
    }, [projectDoc]);

    // Derive the current category list from orderData state for passing to AddItemForm
    const currentOrderDataCategoryList = useMemo(() => orderData.category_list?.list ?? [], [orderData?.category_list]);

    if (!orderData) {
        // Should be handled by Container, but good practice
        return <div>Loading PR data...</div>;
    }


    return (
        <>
            <div className="flex-1 space-y-4 p-4"> {/* Add padding */}
                <div className='space-y-4'>
                    {/* Header Section */}
                    <div className="flex justify-between items-center">
                        <h2 className="text-lg font-bold tracking-tight text-pageheader">
                            Approve/Reject/Delete PR
                        </h2>
                        <AlertDialog open={isDeletePRDialogOpen} onOpenChange={setIsDeletePRDialogOpen}>
                            {/* <AlertDialogTrigger asChild>
                                     <Button variant="destructive" size="sm" onClick={handleOpenDeletePRDialog}>
                                         <Trash2 className="h-4 w-4 mr-1" /> Delete PR
                                     </Button>
                                 </AlertDialogTrigger> */}
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Procurement Request?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Are you sure you want to permanently delete PR: <span className='font-semibold'>{orderData.name}</span>? This action cannot be undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <div className="flex justify-end gap-2 mt-4">
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDeletePR} disabled={isLoading} className="bg-destructive hover:bg-destructive/90">
                                        {isLoading ? "Deleting..." : "Confirm Delete"}
                                    </AlertDialogAction>
                                </div>
                            </AlertDialogContent>
                        </AlertDialog>


                        <ActionButtons
                            handleOpenDeletePRDialog={handleOpenDeletePRDialog}
                            onPrepareReject={() => handlePrepareAction('reject')}
                            onPrepareApprove={() => handlePrepareAction('approve')}
                            canApprove={!requestedItems.length && addedItems.length > 0} // Can only approve if no requested items and list not empty
                            canReject={addedItems.length > 0 || requestedItems.length > 0} // Can reject if any items exist
                            isLoading={isLoading}
                        />
                    </div>

                    {/* PR Details Header Card */}
                    <ApprovePRHeader orderData={orderData} projectDoc={projectDoc} />

                    {/* Requested Items Section */}
                    {requestedItems.length > 0 && (
                        <RequestedItemsSection
                            categories={requestedCategories}
                            items={requestedItems}
                            onAction={handleOpenRequestItemDialog} // Opens the request dialog
                            onDelete={handleDeleteItem} // Direct delete/reject for requested item
                        />
                    )}

                    {/* Undo Button */}
                    <div className="flex justify-between items-center min-h-[30px] mt-2">
                        <p className="text-xs text-muted-foreground pl-1">
                            {addedItems.length > 0 || requestedItems.length > 0 ? "Current Products in PR" : "No Products added yet."}
                        </p>
                        {undoStack.length > 0 && (
                            <HoverCard>
                                <HoverCardTrigger asChild>
                                    <Button variant="outline" size="sm" onClick={handleUndoDelete} disabled={isLoading}>
                                        <Undo className="mr-1 h-4 w-4" /> Undo Delete ({undoStack.length})
                                    </Button>
                                </HoverCardTrigger>
                                <HoverCardContent className="text-xs w-auto p-2">
                                    Click to restore the last removed product.
                                </HoverCardContent>
                            </HoverCard>
                        )}
                    </div>

                    {/* Added Items Section */}
                    {/* {addedItems.length > 0 && ( */}
                    <ItemListSection
                        canCreateItem={["Nirmaan Admin Profile"].includes(userData?.role ?? '')}
                        toggleNewItemsCard={toggleNewItemsCard}
                        categories={addedCategories}
                        items={addedItems}
                        onEdit={handleOpenEditDialog}
                        categoryMakesMap={categoryMakesMap} // Pass makes
                    />
                    {/* )} */}

                    {/* Comments Section */}
                    <PRCommentsSection
                        comments={relevantComments}
                        getUserName={getFullName}
                    />

                </div>
            </div>

            {/* Dialogs */}

            {/* {console.log("VIEW: Rendering AddItemForm, categoryMakelist is:", categoryMakelist ? `Count=${categoryMakelist.length}` : categoryMakelist)} */}
            <AddItemForm
                showNewItemsCard={showNewItemsCard}
                itemOptions={itemOptions}
                currentItemOption={currentItemOption}
                setCurrentItemOption={setCurrentItemOption}
                quantity={currentQuantity}
                handleQuantityChange={handleQuantityChange}
                onAdd={handleAddItemToList}
                onClose={() => toggleNewItemsCard()} // Use onClose to hide
                onToggleNewItemDialog={handleOpenNewItemDialog} // Pass handler
                canCreateItem={["Nirmaan Admin Profile"].includes(userData?.role ?? '')} // Example permission check
                isLoading={isLoading}
                // --- Pass Make Props ---
                allMakeOptions={allMakeOptions || []}
                initialCategoryMakes={initialCategoryMakes || {}}
                orderDataCategoryList={currentOrderDataCategoryList} // Pass the derived current list
                updateCategoryMakesInStore={handleLocalCategoryMakesUpdate} // Pass the specific handler
                makeList={makeList}
                makeListMutate={makeListMutate}
                categoryMakelist={categoryMakelist} // <<< Pass categoryMakelist
                categoryMakeListMutate={categoryMakeListMutate}
            // --- End Make Props ---
            />

            <NewItemDialog
                isOpen={isNewItemDialogOpen}
                onClose={() => setIsNewItemDialogOpen(false)}
                newItem={newItem}
                setNewItem={setNewItem} // Allow direct updates if simple
                // handleNewItemChange={handleNewItemChange} // Or pass handler
                categoryOptions={categoryList?.map(c => ({ label: c.category_name, value: c.name, tax: parseNumber(c.tax) })) ?? []}
                fuzzyMatches={fuzzyMatches}
                handleFuzzySearch={handleFuzzySearch}
                onAddMatchingItem={setCurrentItemOption}
                currentCategory={currentCategoryForNewItem}
                setCurrentCategory={setCurrentCategoryForNewItem}
                onSubmit={handleCreateAndAddItem}
                isLoading={isLoading}
            />
            {/* {console.log("VIEW: Rendering AddItemForm, categoryMakelist is:", categoryMakelist ? `Count=${categoryMakelist.length}` : categoryMakelist)} */}
            <EditItemDialog
                isOpen={isEditItemDialogOpen}
                onClose={() => setIsEditItemDialogOpen(false)}
                editItem={editItem}
                handleEditItemChange={handleEditItemChange} // Pass handler from hook
                onSave={handleSaveEditedItem}
                onDelete={handleDeleteItem}
                isLoading={isLoading}
                // --- Pass Make Props ---
                allMakeOptions={allMakeOptions || []} // Pass fetched/derived data (provide default)
                initialCategoryMakes={initialCategoryMakes || {}} // Pass derived baseline makes
                selectedCategories={orderData?.category_list?.list || []} // Pass current derived categories state
                updateCategoryMakesInStore={handleLocalCategoryMakesUpdate} // Pass store action
                makeList={makeList}
                makeListMutate={makeListMutate}
                categoryMakelist={categoryMakelist} // <<< Pass categoryMakelist
                categoryMakeListMutate={categoryMakeListMutate}
            // --- End Make Props ---
            />

            <RequestItemDialog
                isOpen={isRequestItemDialogOpen}
                onClose={() => setIsRequestItemDialogOpen(false)}
                requestItem={requestItem}
                setRequestItem={setRequestItem} // Allow direct updates
                // handleRequestItemFormChange={handleRequestItemFormChange} // Or pass handler
                categoryOptions={categoryList?.map(c => ({ label: c.category_name, value: c.name })) ?? []}
                fuzzyMatches={fuzzyMatches}
                handleFuzzySearch={handleFuzzySearch}
                onApproveAsNew={handleApproveRequestedItemAsNew}
                onAddMatchingItem={handleAddMatchingItem}
                onReject={handleDeleteItem} // Rejecting means deleting it from the list
                isLoading={isLoading}
            />

            <ConfirmationDialog
                universalComment={universalComment}
                handleUniversalCommentChange={handleUniversalCommentChange}
                isOpen={isConfirmActionDialogOpen}
                onClose={() => setIsConfirmActionDialogOpen(false)}
                actionType={summaryAction} // 'approve' or 'reject'
                prName={orderData.name}
                onConfirm={handleConfirmAction}
                isLoading={isLoading}
            />

        </>
    );
};