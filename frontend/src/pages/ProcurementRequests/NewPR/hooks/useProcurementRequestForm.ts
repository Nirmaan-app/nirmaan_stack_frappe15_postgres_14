import { useCallback, useMemo } from 'react';
import { useProcurementRequestStore } from '../store/useProcurementRequestStore';
import { useToast } from '@/components/ui/use-toast';
import Fuse, { FuseResult, IFuseOptions } from 'fuse.js';
import { CategoryMakesMap, CategorySelection, ItemOption, MakeOption, ProcurementRequestItem } from '../types';
import { Items } from '@/types/NirmaanStack/Items';
import { Makelist } from '@/types/NirmaanStack/Makelist';

interface UseProcurementRequestFormResult {
    selectedWP: string;
    procList: ProcurementRequestItem[];
    selectedCategories: CategorySelection[];
    updateCategoryMakes: (categoryName: string, newMake: string) => void; // <<< Action to add a make
    makeListMutate: () => Promise<any>; // <<< Mutator for makes list
    allMakeOptions: MakeOption[]; // <<< All makes available for selection
    undoStack: ProcurementRequestItem[];
    newPRComment: string;
    isStoreInitialized: boolean;
    selectWorkPackage: (wp: string, wpSpecificMakes: CategoryMakesMap) => void;
    addOrUpdateItem: (itemData: Omit<ProcurementRequestItem, 'uniqueId' | 'status'>, isRequest?: boolean) => void; // Renamed for clarity
    updateItemInList: (updatedItem: ProcurementRequestItem) => void; // <-- ADDED THIS
    deleteItemFromList: (itemName: string) => void;
    undoLastDelete: () => void;
    setComment: (comment: string) => void;
    handleFuzzySearch: (input: string) => FuseResult<Items>[]; // Corrected type Item from Items
    
    itemFuseOptions: IFuseOptions<ItemOption>;
}

export const useProcurementRequestForm = (makeListMutateHook: () => Promise<any>, rawItemList?: Items[], makeList?: Makelist[], allMakeOptionsFromDataHook: MakeOption[] = [], ): UseProcurementRequestFormResult => {
    const { toast } = useToast();

    // --- Select state and actions individually ---
    const selectedWP = useProcurementRequestStore(state => state.selectedWP);
    const procList = useProcurementRequestStore(state => state.procList);
    const selectedCategories = useProcurementRequestStore(state => state.selectedCategories);
    const undoStack = useProcurementRequestStore(state => state.undoStack);
    const newPRComment = useProcurementRequestStore(state => state.newPRComment);
    const isStoreInitialized = useProcurementRequestStore(state => state.isInitialized);

    // Actions are stable references, so selecting them is fine
    const setSelectedWP = useProcurementRequestStore(state => state.setSelectedWP);
    const addProcItem = useProcurementRequestStore(state => state.addProcItem);
    const updateProcItem = useProcurementRequestStore(state => state.updateProcItem);
    const deleteProcItem = useProcurementRequestStore(state => state.deleteProcItem);
    const undoDelete = useProcurementRequestStore(state => state.undoDelete);
    const setNewPRComment = useProcurementRequestStore(state => state.setNewPRComment);
    const updateCategoryMakes = useProcurementRequestStore(state => state.updateCategoryMakes);
    // --- End of individual selection ---

    // --- Fuse.js Configuration for Item Selection ---
    const itemFuseOptions: IFuseOptions<ItemOption> = useMemo(() => ({
        keys: ['label', 'value', 'category'], // Search on item label (name), value (ID), and category
        threshold: 0.3,
        includeScore: false,
        // Example: Give more weight to the item label (name)
        // keys: [
        //   { name: 'label', weight: 0.7 },
        //   { name: 'value', weight: 0.2 },
        //   { name: 'category', weight: 0.1 }
        // ]
    }), []);

    const selectWorkPackage = useCallback((wp: string, wpSpecificMakes: CategoryMakesMap) => {
        console.log("Hook: Selecting WP", wp, "with makes:", wpSpecificMakes);
        setSelectedWP(wp, wpSpecificMakes); // Call store action with both params
  }, [setSelectedWP]);


    // Renamed for clarity: This adds NEW items or REQUESTS
    const addOrUpdateItem = useCallback((itemData: Omit<ProcurementRequestItem, 'uniqueId' | 'status'>, isRequest = false) => {
        const currentSelectedWP = useProcurementRequestStore.getState().selectedWP; // Get latest WP
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
                variant: "destructive", // Use destructive/warning
            });
        }
    }, [addProcItem, toast]);

    // Function specifically for updating existing items in the list
    const updateItemInList = useCallback((updatedItem: ProcurementRequestItem) => {
        updateProcItem(updatedItem);
        toast({ title: "Item Updated", description: `"${updatedItem.item}" details updated.`, variant: "success" });
    }, [updateProcItem, toast]);


    const deleteItemFromList = useCallback((itemName: string) => {
      deleteProcItem(itemName);
      // Optionally add a toast for deletion confirmation
      // toast({ title: "Item Removed", variant: "info" });
  }, [deleteProcItem]);

  const undoLastDelete = useCallback(() => {
      undoDelete();
      // Optionally add a toast for undo confirmation
      // toast({ title: "Action Undone", description: "Last deleted item restored.", variant: "info" });
  }, [undoDelete]);


    const setComment = useCallback((comment: string) => {
      setNewPRComment(comment);
    }, [setNewPRComment]);


    // Setup Fuse instance
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
      selectWorkPackage,
      addOrUpdateItem,
      updateItemInList,
      deleteItemFromList, // Use the memoized callback
      undoLastDelete, // Use the memoized callback
      setComment, // Use the memoized callback
      handleFuzzySearch,
      updateCategoryMakes,
      makeListMutate: makeListMutateHook,
      allMakeOptions: allMakeOptionsFromDataHook,
      itemFuseOptions,          // Provide the Fuse configuration
  };
};