import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useFrappeDocumentEventListener } from 'frappe-react-sdk';

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
import { NewPRErrorBoundary } from '@/components/error-boundaries/NewPRErrorBoundary';

// Store, Hooks, Types
import { useProcurementRequestStore } from './store/useProcurementRequestStore';
import { BackendPRItemDetail, CategorySelection, ProcurementRequestItem } from './types';
import { useProcurementRequestData } from './hooks/useProcurementRequestData';
import { useProcurementRequestForm } from './hooks/useProcurementRequestForm';
import { useSubmitProcurementRequest } from './hooks/useSubmitProcurementRequest';
import { CategoryMakesMap, extractMakesFromChildTableForMultipleWPs, extractCategoryToPackageMap } from '@/hooks/useMakeOptions';
import { toast } from '@/components/ui/use-toast';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { useProcurementRequest } from '@/hooks/useProcurementRequest';


type PageState = 'loading' | 'wp-selection' | 'item-selection' | 'error';

// extractMakesFromChildTableForMultipleWPs, extractCategoryToPackageMap, and CategoryMakesMap
// are now imported from @/hooks/useMakeOptions

const NewProcurementRequestPageInner: React.FC<{ resolve?: boolean; edit?: boolean }> = ({ resolve = false, edit = false }) => {
    const { projectId, prId } = useParams<{ projectId: string; prId?: string }>();
    const mode = edit ? 'edit' : resolve ? 'resolve' : 'create';

    const [page, setPage] = useState<PageState>('loading');
    const [showNewItemDialog, setShowNewItemDialog] = useState(false);
    const [itemToEdit, setItemToEdit] = useState<ProcurementRequestItem | null>(null);

    const setStoreComment = useProcurementRequestStore(state => state.setNewPRComment);
    const initializeStore = useProcurementRequestStore(state => state.initialize);
    const selectedHeaderTagsFromStore = useProcurementRequestStore(state => state.selectedHeaderTags);
    const isStoreInitialized = useProcurementRequestStore(state => state.isInitialized);

    const { data: existingPRData, isLoading: existingPRLoading, mutate: existingPRDataMutate } = useProcurementRequest(prId)

    const { emitDocOpen } = useFrappeDocumentEventListener("Procurment Requests", prId!, () => {
        if (prId) {
            existingPRDataMutate();
            toast({ title: "Document Updated", description: `Procurement Request ${prId} has been modified.` });
        }
    }, false)

    useEffect(() => {
        if (prId) emitDocOpen();
    }, [prId, emitDocOpen]);

    const { project, categoryList, itemOptions, isLoading: dataLoading, error: dataError, itemMutate } = useProcurementRequestData();

    useEffect(() => {
        if (mode === "create" && !projectId) return;

        if ((mode === 'edit' || mode === 'resolve') && !prId) {
            setPage('error');
            return;
        }

        if ((mode === 'edit' || mode === 'resolve') && existingPRLoading) {
            setPage('loading');
            return;
        }

        let initialDataForStore: {
            workPackage: string,
            selectedHeaderTags: { tag_header: string; tag_package: string }[],
            procList: ProcurementRequestItem[],
            categories: CategorySelection[]
        } | undefined = undefined;
        let combinedMakesMap: CategoryMakesMap = {};

        if ((mode === 'edit' || mode === 'resolve') && existingPRData) {
            const transformedProcList: ProcurementRequestItem[] = (existingPRData.order_list || []).map(
                (backendItem: BackendPRItemDetail): ProcurementRequestItem => ({
                    uniqueId: backendItem.name,
                    name: backendItem.item_id,
                    item: backendItem.item_name,
                    unit: backendItem.unit,
                    quantity: backendItem.quantity,
                    category: backendItem.category,
                    work_package: backendItem.procurement_package!,
                    make: backendItem.make || undefined,
                    status: backendItem.status as ProcurementRequestItem['status'],
                    tax: backendItem.tax ?? 0,
                    comment: backendItem.comment || undefined,
                })
            );

            initialDataForStore = {
                // Pr_work_Package
                // workPackage: existingPRData.work_package || '',
                // @ts-ignore - pr_tag_list might not be in the generated types yet
                selectedHeaderTags: (existingPRData.pr_tag_list || []).map(tag => ({
                    tag_header: tag.tag_header,
                    tag_package: tag.tag_package
                })),
                procList: transformedProcList,
                categories: [],
            };

            if (initialDataForStore.selectedHeaderTags.length > 0 && project) {
                const packages = initialDataForStore.selectedHeaderTags.map(h => h.tag_package);
                combinedMakesMap = extractMakesFromChildTableForMultipleWPs(project, packages);
            }
        }
        const projId = mode === "create" ? projectId : existingPRData?.project;
        initializeStore(mode, projId, prId, combinedMakesMap, initialDataForStore);

    }, [mode, projectId, prId, initializeStore, existingPRData, existingPRLoading, project]);

    // Derive Items-compatible array from itemOptions for fuzzy search in NewItemDialog
    const rawItemList = useMemo(() =>
        itemOptions.map(opt => ({
            name: opt.value,
            item_name: opt.label,
            unit_name: opt.unit,
            category: opt.category,
            make_name: opt.make,
            creation: '',
        })),
        [itemOptions]
    );

    const {
        selectedWP,
        procList, selectedCategories, undoStack, newPRComment,
        selectHeaders,
        addOrUpdateItem,
        updateItemInList,
        deleteItemFromList,
        undoLastDelete,
        setComment,
        handleFuzzySearch,
        updateCategoryMakes,
        itemTokenSearchConfig
    } = useProcurementRequestForm(rawItemList as any);

    const { submitNewPR, resolveOrUpdatePR, cancelDraftPR, isSubmitting } = useSubmitProcurementRequest();

    useEffect(() => {
        if (!isStoreInitialized || dataLoading) {
            setPage('loading');
        } else if (dataError) {
            setPage('error');
        } else if (selectedHeaderTagsFromStore.length === 0) {
            setPage('wp-selection');
        } else {
            setPage('item-selection');
        }
    }, [isStoreInitialized, dataLoading, selectedHeaderTagsFromStore, dataError]);

    const handleHeadersSelect = useCallback((headers: { tag_header: string; tag_package: string }[]) => {
        if (!project && headers.length > 0) {
            toast({ title: "Error", description: "Project data not available to fetch makes.", variant: "destructive" });
            return;
        }

        let combinedMakesMap: CategoryMakesMap = {};
        if (headers.length > 0 && project) {
            const packages = headers.map(h => h.tag_package);
            combinedMakesMap = extractMakesFromChildTableForMultipleWPs(project, packages);
        }

        selectHeaders(headers, combinedMakesMap);

        if (headers.length === 0) {
            setPage('wp-selection');
        } else {
            setPage('item-selection');
        }

    }, [project, selectHeaders, setPage]);

    const handleSubmitWithComment = async (finalCommentFromDialog: string) => {
        setStoreComment(finalCommentFromDialog);
        if (mode === 'create') {
            await submitNewPR(finalCommentFromDialog);
        } else {
            await resolveOrUpdatePR(finalCommentFromDialog);
        }
    }

    if (page === 'loading') {
        return <LoadingFallback />
    }

    if (page === 'error') {
        return <AlertDestructive error={dataError} />
    }

    return (
        <div className="flex-1 space-y-4 px-4 py-4">
            {page === 'wp-selection' && (
                <WorkPackageSelector
                    onSelectHeaders={handleHeadersSelect}
                    project={project}
                />
            )}

            {page === 'item-selection' && selectedHeaderTagsFromStore.length > 0 && (
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
                        selectedWP={selectedWP}
                        selectedHeaderTags={selectedHeaderTagsFromStore}
                        categoryToPackageMap={extractCategoryToPackageMap(project, selectedHeaderTagsFromStore.map(h => h.tag_package))}
                        itemOptions={itemOptions}
                        onAddItem={addOrUpdateItem}
                        onOpenNewItemDialog={() => setShowNewItemDialog(true)}
                        allowWpEdit={mode === 'create'}
                        onEditWP={() => {
                            handleHeadersSelect([]);
                        }}
                        disabled={isSubmitting}
                        categoryList={categoryList}
                        updateCategoryMakesInStore={updateCategoryMakes}
                        itemTokenSearchConfig={itemTokenSearchConfig}
                        procList={procList}
                        allProjectPackages={Array.from(new Set(project?.project_wp_category_makes?.map(m => m.procurement_package) || []))}
                        projectWpCategoryMakes={project?.project_wp_category_makes}
                        relevantPackages={selectedHeaderTagsFromStore.map(h => h.tag_package)}
                    />

                    <div className="flex flex-col justify-between min-h-[48vh]">
                        <div className="flex-grow overflow-y-auto pr-2">
                            <OrderListDisplay
                                procList={procList}
                                selectedCategories={selectedCategories}
                                onEditItem={(item: ProcurementRequestItem) => setItemToEdit(item)}
                                onDeleteItem={deleteItemFromList}
                                canUndo={undoStack.length > 0}
                                onUndoDelete={undoLastDelete}
                            />
                        </div>

                        <div className="mt-4 flex-shrink-0">
                            {(mode === 'resolve' || mode === 'edit') && prId && (
                                <PreviousComments prId={prId} mode={mode} />
                            )}
                            <ActionButtons
                                mode={mode}
                                onSubmit={handleSubmitWithComment}
                                isSubmitting={isSubmitting}
                                disabled={procList.length === 0 || isSubmitting}
                                comment={newPRComment}
                                onCommentChange={setComment}
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
                selectedHeaderTags={selectedHeaderTagsFromStore}
                categoryToPackageMap={extractCategoryToPackageMap(project, selectedHeaderTagsFromStore.map(h => h.tag_package))}
                onSubmit={addOrUpdateItem}
                fuzzySearch={handleFuzzySearch}
                itemMutate={itemMutate}
            />

            <EditItemDialog
                isOpen={!!itemToEdit}
                onOpenChange={(isOpen: boolean) => { if (!isOpen) setItemToEdit(null); }}
                itemToEdit={itemToEdit}
                categories={categoryList || []}
                onSubmitUpdate={updateItemInList}
                onDeleteItem={deleteItemFromList}
                updateCategoryMakesInStore={updateCategoryMakes}
                projectWpCategoryMakes={project?.project_wp_category_makes}
                relevantPackages={selectedHeaderTagsFromStore.map(h => h.tag_package)}
            />
        </div>
    );
};

export const NewProcurementRequestPage: React.FC<{ resolve?: boolean; edit?: boolean }> = (props) => {
    const { projectId, prId } = useParams<{ projectId: string; prId?: string }>();

    return (
        <NewPRErrorBoundary projectId={projectId} prId={prId}>
            <NewProcurementRequestPageInner {...props} />
        </NewPRErrorBoundary>
    );
};