import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    useFrappeCreateDoc,
    useFrappeUpdateDoc,
    useFrappeDeleteDoc,
    useSWRConfig,
    FrappeDoc, // Keep for potential global cache invalidation if needed outside feature
} from 'frappe-react-sdk';
import Fuse from 'fuse.js';
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import {
    PRDocType, PRItem, PRCategory, OrderData, ItemOption, NewItemState,
    EditItemState, RequestItemState, FuzzyMatch, User, Item, Comment,
    Category
} from '../types';
import { Projects as Project } from '@/types/NirmaanStack/Projects'; // Import Project type
import {KeyedMutator } from 'swr'
import { parseNumber } from '@/utils/parseNumber';
import { Items } from '@/types/NirmaanStack/Items';
import { MakeOption } from '../../NewPR/types';
import { Makelist } from '@/types/NirmaanStack/Makelist';
import { extractMakesForWP } from '../../NewPR/NewProcurementRequestPage';

interface UseApprovePRLogicProps {
    prDoc: PRDocType;
    projectDoc?: Project; // Pass the fetched project data
    usersList?: User[];
    categoryList?: Category[];
    itemList?: Item[];
    comments?: Comment[];
    itemMutate:KeyedMutator<Items[]>; // Function to refetch items
    prMutate: KeyedMutator<FrappeDoc<PRDocType>>; // Function to refetch PR
    // Make related data from container (keep these)
    allMakeOptions: MakeOption[];
    makeList?: Makelist[];
    makeListMutate: () => Promise<any>;
    categoryMakeListMutate?: () => Promise<any>;
    // initialCategoryMakes: CategoryMakesMap; // No longer needed from props if derived locally
}

export const useApprovePRLogic = ({
    prDoc,
    projectDoc,
    usersList = [],
    categoryList = [],
    itemList = [],
    comments = [],
    itemMutate,
    prMutate,
    allMakeOptions,
    makeList,
    makeListMutate,
    categoryMakeListMutate
}: UseApprovePRLogicProps) => {
    const navigate = useNavigate();
    const { toast } = useToast();
    const userData = useUserData();
    const { mutate: globalMutate } = useSWRConfig(); // For broader cache updates if needed

    // --- Frappe Hooks ---
    const { createDoc, loading: createLoading } = useFrappeCreateDoc();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc();
    // const { upload, loading: uploadLoading } = useFrappeFileUpload();
    // const { call: setFrappeValue, loading: callLoading } = useFrappePostCall("frappe.client.set_value");

    // --- State ---
    const [orderData, setOrderData] = useState<OrderData | null>(null);
    // const [page, setPage] = useState<'itemlist' | 'summary'>('itemlist');
    const [summaryAction, setSummaryAction] = useState<'approve' | 'reject' | null>(null); // Track action for summary confirmation
    const [showNewItemsCard, setShowNewItemsCard] = useState(false);
    const [undoStack, setUndoStack] = useState<PRItem[]>([]); // Use specific type

    // Form/Dialog State
    const [currentItemOption, setCurrentItemOption] = useState<ItemOption | null>(null);
    const [currentQuantity, setCurrentQuantity] = useState<string>(''); // Use string for input
    const [newItem, setNewItem] = useState<NewItemState>({});
    const [currentCategoryForNewItem, setCurrentCategoryForNewItem] = useState<{ label: string; value: string; tax: number } | null>(null);
    const [editItem, setEditItem] = useState<EditItemState | null>(null); // Item being edited
    const [requestItem, setRequestItem] = useState<RequestItemState | null>(null); // Item being requested/approved
    const [universalComment, setUniversalComment] = useState<string>('');
    const [fuzzyMatches, setFuzzyMatches] = useState<FuzzyMatch[]>([]);

    // Dialog Visibility
    const [isNewItemDialogOpen, setIsNewItemDialogOpen] = useState(false);
    const [isEditItemDialogOpen, setIsEditItemDialogOpen] = useState(false);
    const [isRequestItemDialogOpen, setIsRequestItemDialogOpen] = useState(false);
    const [isDeletePRDialogOpen, setIsDeletePRDialogOpen] = useState(false);
    const [isConfirmActionDialogOpen, setIsConfirmActionDialogOpen] = useState(false);

    // --- Memoized Derived Data ---
    const itemOptions = useMemo((): ItemOption[] => {
        return itemList
            .filter(item => categoryList.some(cat => cat.name === item.category)) // Ensure item's category is in the fetched list for the work package
            .map(item => {
                const category = categoryList.find(cat => cat.name === item.category);
                return {
                    value: item.name, // Use item docname as value
                    label: item.item_name,
                    unit: item.unit_name,
                    category: item.category, // Category docname
                    tax: parseNumber(category?.tax ?? "0"),
                };
            });
    }, [itemList, categoryList]);

    const managersIdList = useMemo(() =>
        usersList
            .filter(user => [
                "Nirmaan Project Manager Profile",
                "Nirmaan Procurement Executive Profile",
                "Nirmaan Project Lead Profile",
            ].includes(user.role_profile ?? ''))
            .map(user => user.name),
        [usersList]
    );

    const getFullName = useCallback((id: string | undefined): string => {
        if (!id) return 'N/A';
        if(id === "Administrator") return "Administrator"
        return usersList?.find(user => user.name === id)?.full_name || id; // Fallback to id if not found
    }, [usersList]);

    const relevantComments = useMemo(() => {
        return (comments || [])
            .filter(comment =>
                managersIdList.includes(comment.comment_by) ||
                (comment.comment_by === "Administrator" &&
                    ["creating pr", "resolving pr", "editing pr", "approving pr", "rejecting pr"].includes(comment.subject ?? '')) // Added approve/reject subjects
            );
    }, [comments, managersIdList]);

    const fuseInstance = useMemo(() => new Fuse(itemList, {
        keys: ["item_name"],
        threshold: 0.3,
        distance: 100,
        includeScore: true,
    }), [itemList]);


    useEffect(() => {
        if (!orderData && prDoc) {
            try {
                // Directly use the lists, assuming they are objects
                // Add checks for existence and list property
                const procurementListRaw = prDoc.procurement_list;
                const categoryListRaw = (prDoc.category_list);

                const initialProcurementList = (procurementListRaw && typeof procurementListRaw === 'object')
                    ? procurementListRaw.list
                    : JSON.parse(procurementListRaw)?.list;

                const initialCategoryList = (categoryListRaw && typeof categoryListRaw === 'object')
                    ? categoryListRaw.list
                    : JSON.parse(categoryListRaw)?.list;

                setOrderData({
                    ...prDoc, // Spread all properties from the fetched doc
                    procurement_list: { list: initialProcurementList },
                    category_list: { list: initialCategoryList }, // Start empty, derive below
                });
            } catch (error) {
                console.error("Error initializing orderData:", error);
                toast({ title: "Error", description: "Failed to process initial PR details.", variant: "destructive" });
            }

        }
      }, [prDoc, orderData, toast]);

    useEffect(() => {
        // Only run if orderData is initialized
        if (!orderData) {
            return;
        }

        const currentProcurementList = orderData.procurement_list.list;
        const derivedCategories: PRCategory[] = [];

        currentProcurementList.forEach((item) => {
            // Find category based on name AND status
            const existingCategory = derivedCategories.find(
                (category) => category.name === item.category && category.status === item.status
            );

            if (!existingCategory) {
                // let makes: string[] = [];
                let makes: string[] = orderData?.category_list?.list?.find(cat => cat.name === item.category)?.makes || [];
                // Calculate makes if project data is available (use optional chaining)
                 if (makes?.length === 0 && item.status !== 'Request' && projectDoc?.project_work_packages) { // Example: Calc makes only for non-requested, adjust if needed
                     try {
                         // Use optional chaining and nullish coalescing for safety
                         const wpData =  typeof projectDoc.project_work_packages === 'string' ? JSON.parse(projectDoc.project_work_packages) : projectDoc.project_work_packages; 
                         makes = wpData?.work_packages
                             ?.flatMap((wp: any) => wp.category_list?.list || [])
                             ?.find((cat: any) => cat?.name === item.category)
                             ?.makes || [];
                     } catch (e) {
                         console.error("Error parsing makes in useEffect:", e);
                         // Decide how to handle parse error, maybe log or default to empty makes
                         makes = [];
                     }
                 }

                 derivedCategories.push({
                     name: item.category,
                     status: item.status,
                     makes: makes.length > 0 ? makes : undefined, // Add makes only if they exist
                 });
            }
        });

        // Deduplicate just in case (though the logic above should handle it)
        const uniqueDerivedCategories = derivedCategories.filter((category, index, self) =>
             index === self.findIndex((c) => (c.name === category.name && c.status === category.status))
         );


        // Only update state if the derived list is different from the current one
        // This prevents infinite loops if compares shallowly (deep compare might be needed if makes object references change)
        if (JSON.stringify(uniqueDerivedCategories) !== JSON.stringify(orderData.category_list.list)) {
             console.log("Updating derived categories..."); // For debugging
             setOrderData((prevState) => {
                 // Need to check if prevState is null OR if the procurement list itself changed concurrently
                 if (!prevState || prevState.procurement_list.list !== currentProcurementList) {
                      console.warn("Skipping category update due to concurrent procurement_list change or null state.");
                     return prevState; // Avoid inconsistent state update
                 }
                 return {
                     ...prevState, // Keep all other properties
                     // procurement_list: prevState.procurement_list, // Keep the existing procurement list
                     category_list: { list: uniqueDerivedCategories }, // Update only the category list
                 };
             });
         }

    // DEPENDENCIES: Run when orderData.procurement_list changes OR when projectDoc becomes available/changes
    }, [orderData?.procurement_list.list, projectDoc, orderData]); // orderData is needed for the comparison check

    const toggleNewItemsCard = useCallback(() => {
        setShowNewItemsCard(prev => !prev);
        if (showNewItemsCard) { // Reset form if closing
            setCurrentItemOption(null);
            setCurrentQuantity('');
        }
    }, [showNewItemsCard]);

    const handleQuantityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setCurrentQuantity(e.target.value);
    }, []);

    const handleUniversalCommentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => { // Allow Input for reuse
        setUniversalComment(e.target.value);
    }, []);

    // --- Item Management Actions ---

    const handleAddItemToList = useCallback(() => {
        if (!currentItemOption || !currentQuantity || !orderData) return;

        const quantityValue = parseNumber(currentQuantity);
        if (isNaN(quantityValue) || quantityValue <= 0) {
            toast({ title: "Invalid Quantity", description: "Please enter a valid positive number for quantity.", variant: "destructive" });
            return;
        }

        const currentList = orderData.procurement_list.list;

        const isDuplicate = currentList.some(item => item.name === currentItemOption.value);

        if (isDuplicate) {
            toast({
                title: "Duplicate Item",
                description: `Item "${currentItemOption.label}" is already in the list. Edit the quantity instead.`,
                variant: "destructive",
            });
            return;
        }
        const newItem: PRItem = {
            item: currentItemOption.label, // item_name
            name: currentItemOption.value, // item docname
            unit: currentItemOption.unit,
            quantity: quantityValue,
            category: currentItemOption.category, // category docname
            tax: currentItemOption.tax,
            status: "Pending", // New items are pending
            // Ensure other mandatory fields from PRItem are included if any (doctype, parentfield etc. might be handled by Frappe)
        };

        // Remove from undo stack if it was previously deleted
        const stackIndex = undoStack.findIndex(stackItem => stackItem.name === newItem.name);
        let newStack = [...undoStack];
        if (stackIndex > -1) {
            newStack.splice(stackIndex, 1);
            setUndoStack(newStack);
        }

        const updatedList = [...currentList, newItem];
        setOrderData(prev => prev ? { ...prev, procurement_list: { list: updatedList } } : null);

        // Reset form
        setCurrentItemOption(null);
        setCurrentQuantity('');
        // Maybe close the add item card?
        setShowNewItemsCard(false);

        toast({ title: "Item Added", description: `"${newItem.item}" added successfully.`, variant: "success" });

    }, [currentItemOption, currentQuantity, orderData, undoStack, toast]);


    const handleOpenEditDialog = useCallback((item: PRItem) => {
        setEditItem({ ...item, quantity: item.quantity ?? 0, comment: item.comment ?? '' }); // Initialize with current data
        setIsEditItemDialogOpen(true);
    }, []);

    const handleEditItemChange = useCallback((field: keyof EditItemState, value: string | number) => {
        setEditItem(prev => prev ? { ...prev, [field]: value } : null);
    }, []);

    // --- **NEW LOCAL HANDLER for updating makes in orderData** ---
    const handleLocalCategoryMakesUpdate = useCallback((categoryName: string, newMake: string) => {
        console.log(`Hook: Updating LOCAL makes for ${categoryName}, adding ${newMake}`);
        setOrderData(prevOrderData => {
            if (!prevOrderData) return null; // Should not happen if called correctly

            let categoryFound = false;
            let needsUpdate = false;

            const updatedCategoryList = prevOrderData.category_list.list.map(cat => {
                if (cat.name === categoryName) {
                    categoryFound = true;
                    const makes = Array.isArray(cat.makes) ? cat.makes : [];
                    if (!makes.includes(newMake)) {
                        needsUpdate = true;
                        return { ...cat, makes: [...makes, newMake] };
                    }
                }
                return cat;
            });

            // If category wasn't found in the *local* list, add it
            if (!categoryFound) {
                 // Need to get baseline makes again if category is truly new to this PR session
                 const initialMakesMap = extractMakesForWP(projectDoc, prevOrderData?.work_package || "");
                 const baselineMakes = initialMakesMap[categoryName] || [];
                 updatedCategoryList.push({
                     name: categoryName,
                     // Determine appropriate status - maybe find from an item? Or default?
                     status: prevOrderData.procurement_list.list.find(i => i.category === categoryName)?.status || 'Pending',
                     makes: Array.from(new Set([...baselineMakes, newMake]))
                 });
                 needsUpdate = true;
            }

            if (needsUpdate) {
                return {
                    ...prevOrderData,
                    category_list: { list: updatedCategoryList }
                };
            }
            return prevOrderData; // No change needed
        });
    }, [projectDoc]); // projectDoc needed for fallback baseline makes



    const handleSaveEditedItem = useCallback(() => {
        if (!editItem || !editItem.name || !orderData) return;

        const quantityValue = parseNumber(editItem.quantity)

        if (quantityValue === undefined || isNaN(quantityValue) || quantityValue <= 0) {
             toast({ title: "Invalid Quantity", description: "Please enter a valid positive number for quantity.", variant: "destructive" });
            return;
        }

        const updatedList = orderData.procurement_list.list.map(item =>
            item.name === editItem.name
                ? { ...item, quantity: quantityValue, comment: editItem.comment?.trim() || undefined, make: editItem?.make } // Update quantity and comment
                : item
        );


        setOrderData(prev => prev ? { ...prev, procurement_list: { list: updatedList } } : null);
        setIsEditItemDialogOpen(false);
        setEditItem(null); // Reset edit state
        toast({ title: "Item Updated", description: `"${editItem.item}" updated successfully.`, variant: "success" });

    }, [editItem, orderData, toast]);


    const handleDeleteItem = useCallback((itemToDelete: PRItem | EditItemState | RequestItemState) => { // Can delete from main list or edit dialog
        if (!itemToDelete || !itemToDelete.name || !orderData) return;

        const item = orderData.procurement_list.list.find(i => i.name === itemToDelete.name);

        if (item) {
            // Add to undo stack only if it wasn't just a 'Request' status item
            if (item.status !== "Request") {
                setUndoStack(prev => [...prev, item]);
            }

            const updatedList = orderData.procurement_list.list.filter(i => i.name !== itemToDelete.name);
            setOrderData(prev => prev ? { ...prev, procurement_list: { list: updatedList } } : null);

            toast({ title: "Item Removed", description: `"${item.item}" removed.`, variant: "default" }); // Use default variant for removal
        }

        // Close dialogs if deletion happened from there
        if (isEditItemDialogOpen) setIsEditItemDialogOpen(false);
        if (isRequestItemDialogOpen) setIsRequestItemDialogOpen(false); // If rejecting/deleting request item
        setEditItem(null);
        setRequestItem(null);
    }, [orderData, toast, isEditItemDialogOpen, isRequestItemDialogOpen]);

    const handleUndoDelete = useCallback(() => {
        if (undoStack.length === 0 || !orderData) return;

        const itemToRestore = undoStack[undoStack.length - 1]; // Get last item
        const newStack = undoStack.slice(0, -1); // Remove last item from stack

        // Check if item already exists (e.g., user added it back manually)
         if (orderData.procurement_list.list.some(i => i.name === itemToRestore.name)) {
             toast({ title: "Undo Failed", description: `"${itemToRestore.item}" is already back in the list.`, variant: "destructive" });
             setUndoStack(newStack); // Still remove from stack as it's resolved
             return;
         }


        const updatedList = [...orderData.procurement_list.list, itemToRestore];
        setOrderData(prev => prev ? { ...prev, procurement_list: { list: updatedList } } : null);
        setUndoStack(newStack);
        toast({ title: "Undo Successful", description: `"${itemToRestore.item}" restored.`, variant: "success" });

    }, [undoStack, orderData, toast]);

    // --- New Item Creation ---
    const handleOpenNewItemDialog = useCallback(() => {
        setNewItem({}); // Reset form
        setCurrentCategoryForNewItem(null);
        setIsNewItemDialogOpen(true);
    }, []);

    const handleNewItemChange = useCallback((field: keyof NewItemState, value: string) => {
         setNewItem(prev => ({ ...prev, [field]: value }));
    }, []);

    const handleCreateAndAddItem = useCallback(async () => {
        if (!currentCategoryForNewItem || !newItem.item_name || !newItem.unit_name || !newItem.quantity || !orderData) {
            toast({ title: "Missing Information", description: "Please fill all required fields for the new item.", variant: "destructive" });
            return;
        }

        const quantityValue = parseNumber(newItem.quantity);
         if (isNaN(quantityValue) || quantityValue <= 0) {
             toast({ title: "Invalid Quantity", description: "Please enter a valid positive quantity.", variant: "destructive" });
             return;
         }

        try {
            // 1. Create the Item Doc
            const createdItemDoc = await createDoc("Items", {
                item_name: newItem.item_name,
                unit_name: newItem.unit_name,
                category: currentCategoryForNewItem.value, // Use category docname
                // Add other necessary fields for Item doctype if any
            });

             // 2. Refetch item list to include the new item (important for subsequent adds/lookups)
             await itemMutate();

            // 3. Add the newly created item to the PR list
            const itemToAdd: PRItem = {
                item: createdItemDoc.item_name,
                name: createdItemDoc.name, // Use the new docname
                unit: createdItemDoc.unit_name,
                quantity: (quantityValue),
                category: createdItemDoc.category,
                tax: parseNumber(currentCategoryForNewItem.tax),
                comment: newItem.comment?.trim() || undefined,
                status: "Pending",
            };

             const updatedList = [...orderData.procurement_list.list, itemToAdd];
             setOrderData(prev => prev ? { ...prev, procurement_list: { list: updatedList } } : null);


            toast({ title: "Success", description: `Item "${createdItemDoc.item_name}" created and added to PR.`, variant: "success" });
            setIsNewItemDialogOpen(false);
            setNewItem({}); // Reset form
            setCurrentCategoryForNewItem(null);


        } catch (error: any) {
            console.error("Error creating item:", error);
            toast({ title: "Creation Failed", description: error?.message || "Could not create the new item.", variant: "destructive" });
        }
    }, [newItem, currentCategoryForNewItem, orderData, createDoc, itemMutate, toast]);


    // --- Request Item Handling ---
    const handleFuzzySearch = useCallback((input: string) => {
        if (!input?.trim()) {
            setFuzzyMatches([]);
            return;
        }
        const results = fuseInstance.search(input);
        const matches = results.map(result => ({
            ...result.item,
            matchPercentage: Math.round((1 - result.score!) * 100),
        }));
        setFuzzyMatches(matches.slice(0, 5)); // Limit matches shown
    }, [fuseInstance]);

    const handleOpenRequestItemDialog = useCallback((item: PRItem) => {
         setRequestItem({
             item_name: item.item,
             name: item.name, // Original name/id from PR list
             unit: item.unit,
             quantity: item.quantity ?? '',
             category: item.category,
             // Initialize form fields with current values
             newItemName: item.item,
             newUnit: item.unit,
             newCategory: item.category,
         });
         handleFuzzySearch(item.item); // Trigger search immediately
        setIsRequestItemDialogOpen(true);
    }, [handleFuzzySearch]);

     const handleRequestItemFormChange = useCallback((field: keyof RequestItemState, value: string) => {
         setRequestItem(prev => prev ? { ...prev, [field]: value } : null);
         // Optional: Re-run fuzzy search if newItemName changes significantly
         if (field === 'newItemName') {
             handleFuzzySearch(value);
         }
     }, [handleFuzzySearch]);


     const handleApproveRequestedItemAsNew = useCallback(async () => {
        // --- Initial Checks ---
        if (!requestItem || !requestItem.newItemName || !requestItem.newUnit || !requestItem.newCategory || !requestItem.quantity || !orderData) {
            toast({ title: "Missing Information", description: "Please ensure all fields are filled to approve/create.", variant: "destructive" });
            return;
        }
        const quantityValue = parseNumber(requestItem.quantity);
        if (isNaN(quantityValue) || quantityValue <= 0) {
            toast({ title: "Invalid Quantity", description: "Please enter a valid positive quantity.", variant: "destructive" });
            return;
        }
        const categoryDoc = categoryList.find(c => c.name === requestItem.newCategory);
        if (!categoryDoc) {
            toast({ title: "Invalid Category", description: "Selected category not found.", variant: "destructive" });
            return;
        }
    
        try {
            // --- Create New Item Master ---
            const createdItemDoc = await createDoc("Items", {
                item_name: requestItem.newItemName,
                unit_name: requestItem.newUnit,
                category: requestItem.newCategory, // category docname
            });
    
            // --- Prepare Updated Procurement List ---
            // Map over the *current* list from state to create the new list
            const updatedProcurementList = orderData.procurement_list.list.map(listItem => {
                if (listItem.name === requestItem.name) { // Find the original requested item by its temp/original name
                    return {
                        ...listItem, // Keep potentially existing fields like comments
                        item: createdItemDoc.item_name,
                        name: createdItemDoc.name, // IMPORTANT: Update to the NEW item's docname
                        unit: createdItemDoc.unit_name,
                        category: createdItemDoc.category,
                        quantity: quantityValue, // Use the validated quantity
                        tax: parseNumber(categoryDoc.tax),
                        status: "Pending", // Change status from "Request"
                    };
                }
                return listItem; // Return other items unchanged
            });
    
            // --- Prepare Updated Category List (Based on the *new* procurement list) ---
            const newCategories: PRCategory[] = [];
            updatedProcurementList.forEach((item) => { // Use forEach for clarity
                const existingCategory = newCategories.find(
                    (category) => category.name === item.category && category.status === item.status
                );
                if (!existingCategory) {
                    // Find makes only if status is Pending (or based on your logic)
                    // let makes: string[] = [];
                    let makes = orderData?.category_list?.list?.find(c => c.name === item.category)?.makes || [];
                    if (makes?.length === 0 && item.status === "Pending" && projectDoc?.project_work_packages) {
                        try {
                            makes = JSON.parse(projectDoc.project_work_packages).work_packages
                                .flatMap((wp: any) => wp.category_list?.list || [])
                                .find((cat: any) => cat.name === item.category) // Use find for single category
                                ?.makes || []; // Get makes or empty array
                        } catch (e) { console.error("Error parsing makes in handleApproveRequestedItemAsNew:", e); }
                    }
                    newCategories.push({
                        name: item.category, // Category Docname
                        status: item.status,
                        makes: makes.length > 0 ? makes : undefined // Only add makes if found
                    });
                }
            });
             // Deduplicate categories if needed (though the above logic should prevent duplicates)
             const uniqueNewCategories = newCategories.filter((category, index, self) =>
                 index === self.findIndex((c) => (c.name === category.name && c.status === category.status))
             );
    
    
            // --- Update Local State ---
            // IMPORTANT: Update state with BOTH lists
            setOrderData((prevState) => {
                if (!prevState) return null; // Handle null case
                return {
                    ...prevState, // Keep other PR properties
                    procurement_list: { list: updatedProcurementList },
                    category_list: { list: uniqueNewCategories }, // Use the newly calculated categories
                };
            });
    
            // --- Update Database ---
            await updateDoc("Procurement Requests", orderData.name, { // Use orderData.name safely here
                procurement_list: { list: updatedProcurementList }, // Send the final list
                category_list: { list: uniqueNewCategories }, // Send the final category list
                // No need to update workflow_state here, only when approving/rejecting the whole PR
            });
    
            // --- Post-Update Actions ---
            await prMutate(); // Refetch PR data to confirm backend state (optional but good)
            await itemMutate(); // Refetch item list as a new item was created
    
            toast({ title: "Success", description: `Requested item approved as "${createdItemDoc.item_name}".`, variant: "success" });
            setIsRequestItemDialogOpen(false);
            setRequestItem(null);
            setFuzzyMatches([]);
    
        } catch (error: any) {
            console.error("Error approving requested item:", error);
            toast({ title: "Approval Failed", description: error?.message || "Could not approve the requested item.", variant: "destructive" });
        }
    
    }, [requestItem, orderData, categoryList, projectDoc, createDoc, updateDoc, itemMutate, prMutate, toast, setIsRequestItemDialogOpen, setRequestItem, setFuzzyMatches]); // Added projectDoc, updateDoc, prMutate dependencies


    const handleAddMatchingItem = useCallback((match: Item, originalRequest: RequestItemState) => {
         if (!match || !originalRequest || !orderData) return;

         const quantityValue = parseNumber(originalRequest.quantity);
          if (isNaN(quantityValue) || quantityValue <= 0) {
              toast({ title: "Invalid Quantity", description: "Original request quantity is invalid.", variant: "destructive" });
              return;
          }

          const categoryDoc = categoryList.find(c => c.name === match.category);
           if (!categoryDoc) {
               toast({ title: "Item Category Error", description: `Category for "${match.item_name}" not found.`, variant: "destructive" });
               return;
           }

          const currentList = orderData.procurement_list.list;

         // Check if the *matching* item is already in the list (excluding the original request itself)
         const isDuplicate = currentList.some(item => item.name === match.name && item.name !== originalRequest.name);
          if (isDuplicate) {
              toast({
                  title: "Duplicate Item",
                  description: `Item "${match.item_name}" is already in the list.`,
                  variant: "destructive",
              });
              return;
          }

          // 1. Remove the original 'Request' item
          let updatedList = currentList.filter(item => item.name !== originalRequest.name);

          // 2. Add the matching item
           const itemToAdd: PRItem = {
               item: match.item_name,
               name: match.name, // docname of the matching item
               unit: match.unit_name,
               quantity: quantityValue, // Use quantity from original request
               category: match.category,
               tax: parseNumber(categoryDoc.tax),
               status: "Pending",
               // comment: originalRequest.comment // Carry over comment? Decide policy.
           };
           updatedList.push(itemToAdd);


        setOrderData(prev => prev ? { ...prev, procurement_list: { list: updatedList } } : null);

         toast({
             title: "Success",
             description: `"${match.item_name}" added, replacing requested item "${originalRequest.item_name}".`,
             variant: "success"
         });

        setIsRequestItemDialogOpen(false);
        setRequestItem(null);
        setFuzzyMatches([]);

    }, [orderData, categoryList, toast]);

     // --- PR Actions (Approve, Reject, Delete) ---

    const saveUniversalComment = async (prName: string, subject: string) => {
        if (universalComment.trim() && userData?.user_id) {
            try {
                await createDoc("Nirmaan Comments", {
                    comment_type: "Comment",
                    reference_doctype: "Procurement Requests",
                    reference_name: prName,
                    comment_by: userData.user_id,
                    content: universalComment.trim(),
                    subject: subject,
                });
                 // No toast needed here, part of larger action
            } catch (error) {
                console.error("Error saving comment:", error);
                 // Show toast for comment failure? Or let main action handle overall success/failure?
                 toast({ title: "Comment Warning", description: "Could not save comment, but proceeding with PR action.", variant: "destructive" });
            }
        }
    };

    const handlePrepareAction = useCallback((action: 'approve' | 'reject') => {
         // Check if there are still requested items before approving
         if (action === 'approve' && orderData?.procurement_list.list.some(item => item.status === 'Request')) {
             toast({
                 title: "Action Required",
                 description: "Please resolve all 'Requested' items before approving the PR.",
                 variant: "destructive",
             });
             return;
         }

         // Check if list is empty
         if (!orderData?.procurement_list.list.length) {
             toast({
                 title: "Cannot Proceed",
                 description: "Cannot approve or reject an empty PR list.",
                 variant: "destructive"
             });
             return;
         }


        // setPage('summary');
        setSummaryAction(action);
        setIsConfirmActionDialogOpen(true)
    }, [orderData, toast]);


    const handleConfirmAction = useCallback(async () => {
        if (!summaryAction || !orderData || !orderData.name) return;

        const actionText = summaryAction === 'approve' ? 'Approved' : 'Rejected';
        const subjectText = summaryAction === 'approve' ? 'approving pr' : 'rejecting pr';

        try {
            // TODO: Handle file uploads if re-enabled. Ensure uploads complete *before* updating the doc.
            // const uploadPromises = Object.keys(uploadedFiles).map(cat => handleFileUpload(cat));
            // await Promise.all(uploadPromises);

            // 1. Update the PR Document
            const updatedPR = await updateDoc("Procurement Requests", orderData.name, {
                procurement_list: orderData.procurement_list, // Send the current state
                category_list: orderData.category_list, // Send the current state
                workflow_state: actionText, // "Approved" or "Rejected"
            });

            // 2. Save Comment (if any)
            await saveUniversalComment(updatedPR.name, subjectText);

            // 3. Invalidate Cache & Navigate
             await prMutate(); // Refetch this specific PR (might show updated state)
             await globalMutate("ApprovePR,PRListMutate"); // Invalidate list view cache keys

             toast({
                 title: `PR ${actionText}`,
                 description: `PR ${updatedPR.name} successfully ${actionText}.`,
                 variant: "success",
             });

            setIsConfirmActionDialogOpen(false); // Close confirmation dialog
            navigate("/procurement-requests?tab=Approve PR"); // Navigate back to list

        } catch (error: any) {
            console.error(`Error ${summaryAction === 'approve' ? 'approving' : 'rejecting'} PR:`, error);
            toast({
                title: "Action Failed",
                description: error?.message || `Could not ${summaryAction} PR ${orderData.name}.`,
                variant: "destructive",
            });
             setIsConfirmActionDialogOpen(false); // Close dialog even on failure
        }
    }, [summaryAction, orderData, universalComment, updateDoc, createDoc, userData, prMutate, globalMutate, navigate, toast, saveUniversalComment]);


     const handleOpenDeletePRDialog = useCallback(() => {
         setIsDeletePRDialogOpen(true);
     }, []);


    const handleDeletePR = useCallback(async () => {
         if (!orderData || !orderData.name) return;

         try {
             await deleteDoc("Procurement Requests", orderData.name);

             // Invalidate relevant caches
              await globalMutate((key: any) => typeof key === 'string' && key.startsWith('Procurement Requests')); // Invalidate lists
              await globalMutate("ApprovePR,PRListMutate");

              toast({
                  title: "PR Deleted",
                  description: `PR ${orderData.name} deleted successfully.`,
                  variant: "success",
              });

             setIsDeletePRDialogOpen(false); // Close confirmation dialog
             navigate("/procurement-requests?tab=Approve PR");

         } catch (error: any) {
             console.error("Error deleting PR:", error);
             toast({
                 title: "Deletion Failed",
                 description: error?.message || `Could not delete PR ${orderData.name}.`,
                 variant: "destructive",
             });
             setIsDeletePRDialogOpen(false); // Close dialog even on failure
         }
    }, [orderData, deleteDoc, globalMutate, navigate, toast]);


    // --- Navigation ---
     const navigateBackToList = useCallback(() => {
         navigate("/procurement-requests?tab=Approve PR");
     }, [navigate]);

    // --- Loading States ---
    const isLoading = createLoading || updateLoading || deleteLoading;


    return {
        // State
        orderData,
        // page,
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
        relevantComments, // Pass filtered comments
        isLoading, // Combined loading state for actions

        // Dialog Visibility States
        isNewItemDialogOpen,
        isEditItemDialogOpen,
        isRequestItemDialogOpen,
        isDeletePRDialogOpen,
        isConfirmActionDialogOpen,

        // Handlers
        // setPage,
        toggleNewItemsCard,
        setCurrentItemOption,
        handleQuantityChange,
        handleUniversalCommentChange,
        setCurrentCategoryForNewItem, // For ReactSelect in NewItemDialog
        setNewItem, // For direct state update in NewItemDialog if needed
        setEditItem, // For direct state update in EditItemDialog
        setRequestItem, // For direct state update in RequestItemDialog
        handleAddItemToList,
        handleOpenEditDialog,
        handleEditItemChange,
        handleSaveEditedItem,
        handleDeleteItem, // Reusable delete handler
        handleUndoDelete,
        handleOpenNewItemDialog,
        handleNewItemChange,
        handleCreateAndAddItem,
        handleOpenRequestItemDialog,
        handleRequestItemFormChange,
        handleApproveRequestedItemAsNew,
        handleAddMatchingItem,
        handleFuzzySearch, // Expose if needed directly in component
        handlePrepareAction, // Prepares summary view and sets action type
        handleConfirmAction, // The actual approve/reject logic
        handleOpenDeletePRDialog,
        handleDeletePR,
        navigateBackToList,
        // navigateToItemList,

        handleLocalCategoryMakesUpdate, // <<< Return the new local handler

        // Dialog Visibility Setters
        setIsNewItemDialogOpen,
        setIsEditItemDialogOpen,
        setIsRequestItemDialogOpen,
        setIsDeletePRDialogOpen,
        setIsConfirmActionDialogOpen,

        // Helpers/Derived Data
        getFullName,
        managersIdList, // If needed in UI
        userData, // Pass user data if needed for permissions etc. in View
        allMakeOptions,
        makeList,
        makeListMutate,
        categoryMakeListMutate
    };
};