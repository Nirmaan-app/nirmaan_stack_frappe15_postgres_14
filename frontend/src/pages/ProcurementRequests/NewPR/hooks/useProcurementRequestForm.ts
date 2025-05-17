// import { useCallback, useMemo } from 'react';
// import { useProcurementRequestStore } from '../store/useProcurementRequestStore';
// import { useToast } from '@/components/ui/use-toast'; // Adjust path
// import Fuse, { FuseResult } from 'fuse.js';
// import { Items } from '@/types/NirmaanStack/Items';
// import { CategorySelection, ProcurementRequestItem } from '../types';

// interface UseProcurementRequestFormResult {
//     // State slices from store (or direct access via useStore hook)
//     selectedWP: string;
//     procList: ProcurementRequestItem[];
//     selectedCategories: CategorySelection[];
//     undoStack: ProcurementRequestItem[];
//     newPRComment: string;
//     isStoreInitialized: boolean;

//     // Actions bound to the store
//     selectWorkPackage: (wp: string) => void;
//     addOrUpdateItem: (itemData: Omit<ProcurementRequestItem, 'uniqueId'>, isRequest?: boolean) => void;
//     // updateItemInList: (updatedItem: Partial<ProcurementRequestItem> & { name: string }) => void; // Handled by Edit Dialog now
//     deleteItemFromList: (itemName: string) => void;
//     undoLastDelete: () => void;
//     setComment: (comment: string) => void;
//     handleFuzzySearch: (input: string) => FuseResult<Items>[];
// }

// // This hook acts as an interface to the Zustand store for form-related actions
// export const useProcurementRequestForm = (itemList?: Items[] /* Pass fetched items for fuzzy search */): UseProcurementRequestFormResult => {
//     const { toast } = useToast();

//     // Select needed state and actions from the store
//     const {
//         selectedWP,
//         procList,
//         selectedCategories,
//         undoStack,
//         newPRComment,
//         isStoreInitialized,
//         setSelectedWP,
//         addProcItem,
//         // updateProcItem, // Will be called from EditItemDialog now
//         deleteProcItem,
//         undoDelete,
//         setNewPRComment
//      } = useProcurementRequestStore(state => ({
//         selectedWP: state.selectedWP,
//         procList: state.procList,
//         selectedCategories: state.selectedCategories,
//         undoStack: state.undoStack,
//         newPRComment: state.newPRComment,
//         isStoreInitialized: state.isInitialized,
//         setSelectedWP: state.setSelectedWP,
//         addProcItem: state.addProcItem,
//         // updateProcItem: state.updateProcItem,
//         deleteProcItem: state.deleteProcItem,
//         undoDelete: state.undoDelete,
//         setNewPRComment: state.setNewPRComment,
//     }));

//     const selectWorkPackage = useCallback((wp: string) => {
//         // Maybe add confirmation dialog here if procList is not empty
//         setSelectedWP(wp);
//     }, [setSelectedWP]);

//     const addOrUpdateItem = useCallback((itemData: Omit<ProcurementRequestItem, 'uniqueId'>, isRequest = false) => {
//         const success = addProcItem({
//             ...itemData,
//             status: isRequest ? 'Request' : 'Pending',
//             // uniqueId will be added by addProcItem if needed
//         });

//         if (success) {
//             toast({
//                 title: `${isRequest ? "Requested" : "Added"} Item: ${itemData.item}`,
//                 variant: "success",
//             });
//         } else {
//             toast({
//                 title: "Item Already Exists",
//                 description: `Item "${itemData.item}" is already in the list. Edit quantity instead.`,
//                 variant: "destructive",
//             });
//         }
//     }, [addProcItem, toast]);

//     // Setup Fuse instance for fuzzy search (memoized)
//     const fuse = useMemo(() => {
//         if (!itemList) return null;
//         return new Fuse(itemList, {
//             keys: ["item_name"], // Fields to search
//             threshold: 0.3,
//             distance: 100,
//             includeScore: true,
//         });
//     }, [itemList]); // Recreate only when itemList changes

//     const handleFuzzySearch = useCallback((input: string): FuseResult<Items>[] => {
//         if (!fuse || !input.trim()) {
//             return [];
//         }
//         return fuse.search(input);
//     }, [fuse]);

//     return {
//         selectedWP,
//         procList,
//         selectedCategories,
//         undoStack,
//         newPRComment,
//         isStoreInitialized,

//         selectWorkPackage,
//         addOrUpdateItem,
//         // updateItemInList: updateProcItem, // Expose if needed directly, but prefer dialogs handling it
//         deleteItemFromList: deleteProcItem,
//         undoLastDelete: undoDelete,
//         setComment: setNewPRComment,
//         handleFuzzySearch,
//     };
// };


// src/features/procurement-requests/hooks/useProcurementRequestForm.ts
import { useCallback, useMemo } from 'react';
import { useProcurementRequestStore } from '../store/useProcurementRequestStore';
import { useToast } from '@/components/ui/use-toast';
import Fuse, { FuseResult } from 'fuse.js';
import { CategoryMakesMap, CategorySelection, MakeOption, ProcurementRequestItem } from '../types';
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
}

export const useProcurementRequestForm = (itemList?: Items[], makeList?: Makelist[], allMakeOptions: MakeOption[] = [], makeListMutate: () => Promise<any>): UseProcurementRequestFormResult => {
    const { toast } = useToast();

    // const {
    //     selectedWP,
    //     procList,
    //     selectedCategories,
    //     undoStack,
    //     newPRComment,
    //     isStoreInitialized,
    //     setSelectedWP,
    //     addProcItem,
    //     updateProcItem, // <-- SELECT updateProcItem FROM STORE
    //     deleteProcItem,
    //     undoDelete,
    //     setNewPRComment
    //  } = useProcurementRequestStore(state => ({
    //     selectedWP: state.selectedWP,
    //     procList: state.procList,
    //     selectedCategories: state.selectedCategories,
    //     undoStack: state.undoStack,
    //     newPRComment: state.newPRComment,
    //     isStoreInitialized: state.isInitialized,
    //     setSelectedWP: state.setSelectedWP,
    //     addProcItem: state.addProcItem,
    //     updateProcItem: state.updateProcItem, // <-- ADDED HERE
    //     deleteProcItem: state.deleteProcItem,
    //     undoDelete: state.undoDelete,
    //     setNewPRComment: state.setNewPRComment,
    // }));


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
        if (!itemList) return null;
        return new Fuse(itemList, {
            keys: ["item_name"],
            threshold: 0.3,
            distance: 100,
            includeScore: true,
        });
    }, [itemList]);

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
      makeListMutate,
      allMakeOptions,
  };
};