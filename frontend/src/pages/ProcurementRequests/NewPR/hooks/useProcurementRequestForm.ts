import { useCallback, useMemo } from 'react';
import { useProcurementRequestStore } from '../store/useProcurementRequestStore';
import { useToast } from '@/components/ui/use-toast';
import Fuse, { FuseResult, IFuseOptions } from 'fuse.js';
import { CategoryMakesMap, CategorySelection, ItemOption, MakeOption, ProcurementRequestItem, SelectedHeaderTag } from '../types';
import { Items } from '@/types/NirmaanStack/Items';

interface UseProcurementRequestFormResult {
    selectedWP: string;
    procList: ProcurementRequestItem[];
    selectedCategories: CategorySelection[];
    updateCategoryMakes: (categoryName: string, newMake: string) => void;
    makeListMutate: () => Promise<any>;
    allMakeOptions: MakeOption[];
    undoStack: ProcurementRequestItem[];
    newPRComment: string;
    isStoreInitialized: boolean;
    selectHeaders: (headers: SelectedHeaderTag[], combinedMakes: CategoryMakesMap) => void;
    addOrUpdateItem: (itemData: Omit<ProcurementRequestItem, 'uniqueId' | 'status'>, isRequest?: boolean) => void;
    updateItemInList: (updatedItem: ProcurementRequestItem) => void;
    deleteItemFromList: (itemName: string) => void;
    undoLastDelete: () => void;
    setComment: (comment: string) => void;
    handleFuzzySearch: (input: string) => FuseResult<Items>[];
    itemFuseOptions: IFuseOptions<ItemOption>;
}

export const useProcurementRequestForm = (
    makeListMutateHook: () => Promise<any>,
    rawItemList?: Items[],
    _makeList?: any,
    allMakeOptionsFromDataHook: MakeOption[] = [],
): UseProcurementRequestFormResult => {
    const { toast } = useToast();

    // --- Select state and actions individually ---
    const selectedWP = useProcurementRequestStore(state => state.selectedWP);
    const procList = useProcurementRequestStore(state => state.procList);
    const selectedCategories = useProcurementRequestStore(state => state.selectedCategories);
    const undoStack = useProcurementRequestStore(state => state.undoStack);
    const newPRComment = useProcurementRequestStore(state => state.newPRComment);
    const isStoreInitialized = useProcurementRequestStore(state => state.isInitialized);

    // Actions
    const setSelectedHeaders = useProcurementRequestStore(state => state.setSelectedHeaders);
    const addProcItem = useProcurementRequestStore(state => state.addProcItem);
    const updateProcItem = useProcurementRequestStore(state => state.updateProcItem);
    const deleteProcItem = useProcurementRequestStore(state => state.deleteProcItem);
    const undoDelete = useProcurementRequestStore(state => state.undoDelete);
    const setNewPRComment = useProcurementRequestStore(state => state.setNewPRComment);
    const updateCategoryMakes = useProcurementRequestStore(state => state.updateCategoryMakes);

    // --- Fuse.js Configuration for Item Selection ---
    const itemFuseOptions: IFuseOptions<ItemOption> = useMemo(() => ({
        keys: ['label', 'value', 'category'],
        threshold: 0.3,
        includeScore: false,
    }), []);

    const selectHeaders = useCallback((headers: SelectedHeaderTag[], combinedMakes: CategoryMakesMap) => {
        setSelectedHeaders(headers, combinedMakes);
    }, [setSelectedHeaders]);

    const addOrUpdateItem = useCallback((itemData: Omit<ProcurementRequestItem, 'uniqueId' | 'status'>, isRequest = false) => {
        const currentSelectedWP = useProcurementRequestStore.getState().selectedWP;
        const success = addProcItem({
            ...itemData,
            status: isRequest ? 'Request' : 'Pending',
            work_package: currentSelectedWP
        });

        if (success) {
            toast({
                title: `${isRequest ? "Requested" : "Added"} Item: ${itemData.item}`,
                variant: "success",
            });
        } else {
            toast({
                title: "Item Already Exists",
                description: `Item "${itemData.item}" is already in the list. Edit quantity instead.`,
                variant: "destructive",
            });
        }
    }, [addProcItem, toast]);

    const updateItemInList = useCallback((updatedItem: ProcurementRequestItem) => {
        if (!updatedItem.uniqueId) {
            toast({ title: "Error", description: "Cannot update item without unique ID.", variant: "destructive" });
            return;
        }
        updateProcItem({ ...updatedItem, uniqueId: updatedItem.uniqueId });
        toast({ title: "Item Updated", description: `"${updatedItem.item}" details updated.`, variant: "success" });
    }, [updateProcItem, toast]);

    const deleteItemFromList = useCallback((itemName: string) => {
        deleteProcItem(itemName);
    }, [deleteProcItem]);

    const undoLastDelete = useCallback(() => {
        undoDelete();
    }, [undoDelete]);

    const setComment = useCallback((comment: string) => {
        setNewPRComment(comment);
    }, [setNewPRComment]);

    const fuse = useMemo(() => {
        if (!rawItemList) return null;
        return new Fuse(rawItemList, {
            keys: ["item_name"],
            threshold: 0.3,
            distance: 100,
            includeScore: true,
        });
    }, [rawItemList]);

    const handleFuzzySearch = useCallback((input: string): FuseResult<Items>[] => {
        if (!fuse || !input.trim()) return [];
        return fuse.search(input);
    }, [fuse]);

    return {
        selectedWP,
        procList,
        selectedCategories,
        undoStack,
        newPRComment,
        isStoreInitialized,
        selectHeaders,
        addOrUpdateItem,
        updateItemInList,
        deleteItemFromList,
        undoLastDelete,
        setComment,
        handleFuzzySearch,
        updateCategoryMakes,
        makeListMutate: makeListMutateHook,
        allMakeOptions: allMakeOptionsFromDataHook,
        itemFuseOptions,
    };
};