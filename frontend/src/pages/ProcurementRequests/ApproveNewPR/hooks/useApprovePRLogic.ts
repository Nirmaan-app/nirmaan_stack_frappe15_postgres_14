import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    useFrappeCreateDoc,
    useFrappeUpdateDoc,
    useFrappeDeleteDoc,
    useSWRConfig,
    FrappeDoc, // Keep for potential global cache invalidation if needed outside feature
} from 'frappe-react-sdk';
import Fuse, { IFuseOptions } from 'fuse.js';
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import {
    PRDocType, // This is GlobalPRDocType
    PRScreenData, // New type for hook's main data state
    PRItemUIData, // New type for items in the list (maps to ProcurementRequestItemDetail)
    ItemOption, NewItemState, EditItemState, RequestItemState, FuzzyMatch, User, Item, Comment,
    MasterCategory, // Use MasterCategory for the list of all categories
    Project,
    GlobalCategory,
    PRCategory,
} from '../types';
import { KeyedMutator } from 'swr'
import { parseNumber } from '@/utils/parseNumber';
import { Items } from '@/types/NirmaanStack/Items';
import { MakeOption } from '../../NewPR/types';
import { Makelist } from '@/types/NirmaanStack/Makelist';
import { extractMakesFromChildTableForWP } from '../../NewPR/NewProcurementRequestPage';
import { CategoryMakelist as CategoryMakelistType } from '@/types/NirmaanStack/CategoryMakelist'; // Import the type
import { ProcurementRequestItemDetail } from '@/types/NirmaanStack/ProcurementRequests';
import { DraftItem, DraftCategory } from '@/zustand/useApproveNewPRDraftStore';

/* ─────────────────────────────────────────────────────────────
   DRAFT MANAGER INTERFACE
   ───────────────────────────────────────────────────────────── */

/**
 * Interface for the draft manager methods that can be passed to this hook.
 * When provided, operations will update the draft instead of saving to DB immediately.
 * The DB save only happens in handleConfirmAction (the final commit point).
 */
export interface DraftManagerMethods {
    addItem: (item: DraftItem) => void;
    updateItem: (itemName: string, updates: Partial<DraftItem>) => void;
    deleteItem: (itemName: string) => DraftItem | null;
    undoDelete: () => void;
    updateOrderList: (items: DraftItem[]) => void;
    updateCategoryList: (categories: DraftCategory[]) => void;
    getDataForSubmission: () => { orderList: DraftItem[], categoryList: DraftCategory[] };
    clearDraftAfterSubmit: () => void;
    setUniversalComment: (comment: string) => void;
    // Data from draft manager (when using draft-first)
    orderList?: DraftItem[];
    categoryList?: DraftCategory[];
    universalComment?: string;
    undoStack?: DraftItem[];
    // Whether draft manager has been initialized with data
    isInitialized?: boolean;
}

interface UseApprovePRLogicProps {
    workPackage?: string; // Work package name
    prDoc: FrappeDoc<PRDocType>;
    projectDoc?: Project; // Pass the fetched project data
    usersList?: User[];
    categoryList?: MasterCategory[];
    itemList?: Item[];
    comments?: Comment[];
    itemMutate: KeyedMutator<Items[]>; // Function to refetch items
    prMutate: KeyedMutator<FrappeDoc<PRDocType>>; // Function to refetch PR
    // Make related data from container (keep these)
    allMakeOptions: MakeOption[];
    makeList?: Makelist[];
    makeListMutate: () => Promise<any>;
    categoryMakelist?: CategoryMakelistType[];
    categoryMakeListMutate?: () => Promise<any>;
    // initialCategoryMakes: CategoryMakesMap; // No longer needed from props if derived locally

    // Draft manager integration (optional for backwards compatibility)
    draftManager?: DraftManagerMethods;
}

export const useApprovePRLogic = ({
    workPackage,
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
    categoryMakelist,
    categoryMakeListMutate,
    draftManager,
}: UseApprovePRLogicProps) => {

    // Determine if we're using draft-first approach
    const useDraftFirst = !!draftManager;

    // // *** Add console log HERE ***
    // useEffect(() => {
    //     console.log("HOOK: Received categoryMakelist:", categoryMakelist ? JSON.stringify(categoryMakelist.slice(0, 5), null, 2) + "..." : 'undefined/null'); // Log first few items
    // }, [categoryMakelist]);

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
    const [orderData, setOrderData] = useState<PRScreenData | null>(null);

    // const [page, setPage] = useState<'itemlist' | 'summary'>('itemlist');
    const [summaryAction, setSummaryAction] = useState<'approve' | 'reject' | null>(null); // Track action for summary confirmation
    const [showNewItemsCard, setShowNewItemsCard] = useState(false);
    const [undoStack, setUndoStack] = useState<PRItemUIData[]>([]); // Use specific type

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
        if (id === "Administrator") return "Administrator"
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

    // Get current order list - from draft manager if using draft-first, otherwise from orderData
    // This ensures all derived data uses consistent source
    const currentOrderList = useMemo((): PRItemUIData[] => {
        // Only use draft manager data if:
        // 1. Draft-first mode is enabled
        // 2. Draft manager is initialized
        // 3. Draft manager has actual data (length > 0)
        // CRITICAL: Empty array [] is truthy, so we must check length explicitly
        // This prevents using empty draft state before server data is loaded
        const draftHasData = draftManager?.orderList && draftManager.orderList.length > 0;

        if (useDraftFirst && draftManager?.isInitialized && draftHasData) {
            // Filter out deleted items and cast to PRItemUIData
            // draftHasData already checks draftManager?.orderList exists and has length > 0
            return draftManager.orderList!
                .filter(item => !item._isDeleted)
                .map(item => ({
                    ...item,
                    // Ensure compatibility with PRItemUIData
                } as unknown as PRItemUIData));
        }

        // Fallback chain: prDoc.order_list (server data) -> orderData (local state) -> empty
        // CHANGED: Prioritize prDoc.order_list over orderData since prDoc is the source of truth
        // This ensures we show data immediately when prDoc loads, before local state catches up
        return prDoc?.order_list ?? orderData?.order_list ?? [];
    }, [useDraftFirst, draftManager?.isInitialized, draftManager?.orderList, orderData?.order_list, prDoc?.order_list]);

    const currentCategoryList = useMemo((): PRCategory[] => {
        // Same logic as currentOrderList - only use draft if it has actual data
        const draftCategoryHasData = draftManager?.categoryList && draftManager.categoryList.length > 0;

        if (useDraftFirst && draftManager?.isInitialized && draftCategoryHasData) {
            return draftManager.categoryList as PRCategory[];
        }
        // Fallback chain: prDoc.category_list (server data) -> orderData (local state)
        return prDoc?.category_list?.list ?? orderData?.category_list?.list ?? [];
    }, [useDraftFirst, draftManager?.isInitialized, draftManager?.categoryList, orderData?.category_list?.list, prDoc?.category_list?.list]);

    const currentUndoStack = useMemo((): PRItemUIData[] => {
        if (useDraftFirst && draftManager?.isInitialized && draftManager?.undoStack) {
            return draftManager.undoStack as unknown as PRItemUIData[];
        }
        return undoStack;
    }, [useDraftFirst, draftManager?.isInitialized, draftManager?.undoStack, undoStack]);

    // addedItems, requestedItems will now filter the current order list
    const addedItems = useMemo((): PRItemUIData[] => {
        return currentOrderList.filter(i => i.status !== 'Request');
    }, [currentOrderList]);

    const requestedItems = useMemo((): PRItemUIData[] => {
        return currentOrderList.filter(i => i.status === 'Request');
    }, [currentOrderList]);

    // console.log("request ITEMS", requestedItems);

    // const addedCategories = useMemo((): PRCategory[] => {
    //     return orderData?.category_list?.list
    //         ?.filter(c => addedItems.some(item => item.category === c.name && item.status === (c.status || "Pending")))
    //         ?? [];
    // }, [orderData?.category_list?.list, addedItems]);

    // const requestedCategories = useMemo((): PRCategory[] => {
    //     return orderData?.category_list?.list
    //         ?.filter(c => requestedItems.some(item => item.category === c.name && item.status === c.status))
    //         ?? [];
    // }, [orderData?.category_list?.list, requestedItems]);

    // Derivation of displayed categories (addedCategories, requestedCategories, currentOrderDataCategoryList)
    // This needs to be more robustly derived based on items in order_list and projectDoc for makes.
    // Let's create a single derived state for displayable categories.


    // const displayedCategoriesWithMakes = useMemo((): DisplayCategory[] => {
    //     if (!orderData?.order_list || !categoryList) return []; // allCategories is the master list of categories

    //     const categoryMap = new Map<string, { displayName: string; items: PRItemUIData[], statusSet: Set<string> }>();
    //     const initialMakesForPRWP = projectDoc && orderData.work_package
    //         ? extractMakesFromChildTableForWP(projectDoc, orderData.work_package)
    //         : {};

    //     orderData.order_list.forEach(item => {
    //         if (!categoryMap.has(item.category)) {
    //             const catInfo = categoryList.find(c => c.name === item.category);
    //             categoryMap.set(item.category, {
    //                 displayName: catInfo?.category_name || item.category,
    //                 items: [],
    //                 statusSet: new Set<string>()
    //             });
    //         }
    //         categoryMap.get(item.category)!.items.push(item);
    //         if (item.status) {
    //             categoryMap.get(item.category)!.statusSet.add(item.status);
    //         }
    //     });

    //     return Array.from(categoryMap.entries()).map(([catDocName, data]) => {
    //         // Determine overall status for this category in the PR (e.g., if any item is "Request", mark category as "Request")
    //         const primaryStatus = data.statusSet.has('Request') ? 'Request' : (data.statusSet.has('Pending') ? 'Pending' : (Array.from(data.statusSet)[0] || 'Pending'));

    //         // Consolidate makes from items in this category AND from project's configuration for this category/WP
    //         const makesFromItems = new Set(data.items.map(i => i.make).filter(Boolean) as string[]);
    //         const makesFromProjectConfig = new Set(initialMakesForPRWP[catDocName] || []);
    //         const combinedMakes = Array.from(new Set([...makesFromItems, ...makesFromProjectConfig])).sort();

    //         return {
    //             name: catDocName,
    //             displayName: data.displayName,
    //             status: primaryStatus,
    //             makes: combinedMakes,
    //         };
    //     });
    // }, [orderData?.order_list, orderData?.work_package, projectDoc, categoryList]); // allCategories is needed

    const displayedCategoriesWithMakes = useMemo((): PRCategory[] => {
        // Use currentCategoryList which handles draft-first vs legacy
        return currentCategoryList;
    }, [currentCategoryList]);

    // Replace old category derivations with ones based on displayedCategoriesWithMakes
    const addedCategoriesForDisplay = useMemo(() =>
        displayedCategoriesWithMakes.filter(c => c.status !== 'Request' && (addedItems.some(item => item.category === c.name)))
        , [displayedCategoriesWithMakes, addedItems]);

    const requestedCategoriesForDisplay = useMemo(() =>
        displayedCategoriesWithMakes.filter(c => c.status === 'Request' && (requestedItems.some(item => item.category === c.name)))
        , [displayedCategoriesWithMakes, requestedItems]);

    // const currentOrderDataCategoryList = useMemo((): PRCategory[] => {
    //     return orderData?.category_list?.list ?? [];
    // }, [orderData?.category_list?.list]); // Dependency corrected


    // useEffect(() => {


    // --- useEffect to initialize orderData ---
    useEffect(() => {
        if (!orderData && prDoc) { // Only initialize once
            // Transform prDoc.order_list if any field names differ from PRItemUIData,
            // but since PRItemUIData is aliased to ProcurementRequestItemDetail, direct assignment is okay.
            const initialOrderList: PRItemUIData[] = prDoc.order_list
                ? prDoc.order_list.map(item => ({ ...item })) // Shallow copy to avoid direct mutation
                : [];

            // Initialize category_list based on items if not directly available or if it needs regeneration
            // For now, assuming prDoc.category_list (JSON) is still the source for initial makes display if available
            let initialCategoryListForState: GlobalCategory[] = [];
            if (prDoc.category_list && typeof prDoc.category_list === 'object' && prDoc.category_list.list) {
                initialCategoryListForState = prDoc.category_list.list;
            } else if (typeof prDoc.category_list === 'string') {
                try {
                    initialCategoryListForState = JSON.parse(prDoc.category_list)?.list || [];
                } catch (e) { console.error("Error parsing initial category_list from prDoc", e); }
            }

            setOrderData({
                // Spread all other properties from prDoc
                ...(prDoc as any), // Cast to any if Omit causes issues, ensure all fields are there
                name: prDoc.name,
                project: prDoc.project,
                workflow_state: prDoc.workflow_state,
                // ... other necessary scalar fields from PRDocType ...
                owner: prDoc.owner,
                creation: prDoc.creation,
                modified: prDoc.modified,
                modified_by: prDoc.modified_by,
                work_package: prDoc.work_package,

                order_list: initialOrderList, // Use the new field
                category_list: { list: initialCategoryListForState }, // Keep old structure for now if used
            });
        }
    }, [prDoc, orderData]); // Add orderData to prevent re-init if already set
    //     if (!orderData && prDoc) {
    //         try {
    //             // Directly use the lists, assuming they are objects
    //             // Add checks for existence and list property
    //             const procurementListRaw = prDoc.procurement_list;
    //             const categoryListRaw = (prDoc.category_list);

    //             const initialProcurementList = (procurementListRaw && typeof procurementListRaw === 'object')
    //                 ? procurementListRaw.list
    //                 : JSON.parse(procurementListRaw)?.list;

    //             const initialCategoryList = (categoryListRaw && typeof categoryListRaw === 'object')
    //                 ? categoryListRaw.list
    //                 : JSON.parse(categoryListRaw)?.list;

    //             setOrderData({
    //                 ...prDoc, // Spread all properties from the fetched doc
    //                 procurement_list: { list: initialProcurementList },
    //                 category_list: { list: initialCategoryList }, // Start empty, derive below
    //             });
    //         } catch (error) {
    //             console.error("Error initializing orderData:", error);
    //             toast({ title: "Error", description: "Failed to process initial PR details.", variant: "destructive" });
    //         }
    //     }
    // }, [prDoc, orderData, toast]);

    useEffect(() => {
        // Only run if orderData is initialized
        if (!orderData) {
            return;
        }

        const currentProcurementList = orderData.order_list;
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
                if (makes?.length === 0 && item.status !== 'Request' && projectDoc?.project_wp_category_makes) { // Example: Calc makes only for non-requested, adjust if needed
                    try {
                        // Use optional chaining and nullish coalescing for safety
                        // const wpData = typeof projectDoc.project_work_packages === 'string' ? JSON.parse(projectDoc.project_work_packages) : projectDoc.project_work_packages;
                        // makes = wpData?.work_packages
                        //     ?.flatMap((wp: any) => wp.category_list?.list || [])
                        //     ?.find((cat: any) => cat?.name === item.category)
                        //     ?.makes || [];
                        const wpData = typeof projectDoc.project_wp_category_makes === 'string' ? JSON.parse(projectDoc.project_wp_category_makes) : projectDoc.project_wp_category_makes;

                        const relevant_wps = wpData?.filter((wp: { procurement_package?: string; category?: string; make?: string }) => wp.procurement_package === item.procurement_package && wp.category === item.category) || [];

                        makes = relevant_wps.map((wp: { make?: string }) => wp?.make)?.filter((make: string | undefined) => !!make) || []
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
                if (!prevState || prevState.order_list !== currentProcurementList) {
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
    }, [orderData?.order_list, projectDoc]); // orderData is needed for the comparison check

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
        if (useDraftFirst && draftManager) {
            draftManager.setUniversalComment(e.target.value);
        } else {
            setUniversalComment(e.target.value);
        }
    }, [useDraftFirst, draftManager]);

    // --- Item Management Actions ---

    const handleAddItemToList = useCallback(async (selectedMake?: string) => {
        if (!currentItemOption || !currentQuantity || !orderData) return;

        const quantityValue = parseNumber(currentQuantity);
        if (isNaN(quantityValue) || quantityValue <= 0) {
            toast({ title: "Invalid Quantity", description: "Please enter a valid positive number for quantity.", variant: "destructive" });
            return;
        }

        const currentList = orderData.order_list;

        // Check if the item_id is the same as the name
        const isDuplicate = currentList.some(item => item.item_id === currentItemOption.value);

        if (isDuplicate) {
            toast({
                title: "Duplicate Item",
                description: `Item "${currentItemOption.label}" is already in the list. Edit the quantity instead.`,
                variant: "destructive",
            });
            setCurrentItemOption(null);
            setCurrentQuantity('');
            setShowNewItemsCard(false);
            return;
        }

        const newItemForOrderList: Omit<PRItemUIData, 'name' | 'creation' | 'modified' | 'parent' | 'parentfield' | 'parenttype' | 'docstatus' | 'idx' | 'owner' | 'modified_by'> = {
            item_id: currentItemOption!.value,
            item_name: currentItemOption!.label,
            unit: currentItemOption!.unit,
            quantity: quantityValue,
            procurement_package: workPackage,
            category: currentItemOption!.category,
            tax: currentItemOption!.tax,
            status: "Pending",
            make: selectedMake,
            comment: undefined,
            vendor: undefined,
            quote: undefined
        };

        // --- DRAFT-FIRST APPROACH ---
        if (useDraftFirst && draftManager) {
            // Create a DraftItem for the draft manager
            const draftItem: DraftItem = {
                name: '', // New items don't have a name yet
                item_id: newItemForOrderList.item_id!,
                item_name: newItemForOrderList.item_name!,
                unit: newItemForOrderList.unit!,
                quantity: newItemForOrderList.quantity!,
                category: newItemForOrderList.category!,
                procurement_package: newItemForOrderList.procurement_package,
                make: newItemForOrderList.make,
                status: newItemForOrderList.status!,
                tax: newItemForOrderList.tax,
                comment: newItemForOrderList.comment,
                vendor: newItemForOrderList.vendor,
                quote: newItemForOrderList.quote,
                _isNew: true,
            };

            // Add item via draft manager (auto-saves to localStorage, NOT to DB)
            draftManager.addItem(draftItem);

            // Update category list if needed
            let categoryNeedsUpdate = false;
            // CRITICAL: Empty array [] is truthy, so we must check length explicitly
            const currentCategoryList = (draftManager.categoryList && draftManager.categoryList.length > 0)
                ? draftManager.categoryList
                : orderData.category_list.list;
            const updatedCategoryList = currentCategoryList.map(cat => {
                if (cat.name === newItemForOrderList.category && selectedMake) {
                    const makes = Array.isArray(cat.makes) ? cat.makes : [];
                    if (!makes.includes(selectedMake)) {
                        categoryNeedsUpdate = true;
                        return { ...cat, makes: [...makes, selectedMake] };
                    }
                }
                return cat;
            });

            const categoryExists = currentCategoryList.some(c => c.name === newItemForOrderList.category && c.status === newItemForOrderList.status);
            if (!categoryExists) {
                categoryNeedsUpdate = true;
                const initialMakesMap = extractMakesFromChildTableForWP(projectDoc, orderData?.work_package || "");
                const baselineMakes = initialMakesMap[newItemForOrderList.category] || [];
                const newCategoryMakes = selectedMake ? Array.from(new Set([...baselineMakes, selectedMake])) : baselineMakes;
                updatedCategoryList.push({
                    name: newItemForOrderList.category,
                    status: newItemForOrderList.status,
                    makes: newCategoryMakes.length > 0 ? newCategoryMakes : undefined,
                });
            }

            if (categoryNeedsUpdate) {
                draftManager.updateCategoryList(updatedCategoryList as DraftCategory[]);
            }

            // Reset form
            setCurrentItemOption(null);
            setCurrentQuantity('');
            setShowNewItemsCard(false);

            toast({ title: "Item Added", description: `"${newItemForOrderList.item_name}" added. Changes will be saved when you approve.`, variant: "success" });
            return;
        }

        // --- LEGACY APPROACH (backwards compatibility) ---
        // Remove from undo stack if it was previously deleted
        const stackIndex = undoStack.findIndex(stackItem => stackItem.item_id === newItemForOrderList.item_id);
        let newStack = [...undoStack];
        if (stackIndex > -1) {
            newStack.splice(stackIndex, 1);
            setUndoStack(newStack);
        }

        // This is the list we intend to save to the backend
        const updatedList = [...currentList, newItemForOrderList as PRItemUIData];

        // --- IMPORTANT: Update Category List with Makes if necessary ---
        let categoryNeedsUpdate = false;
        const updatedCategoryList = orderData.category_list.list.map(cat => {
            if (cat.name === newItemForOrderList.category && selectedMake) {
                const makes = Array.isArray(cat.makes) ? cat.makes : [];
                if (!makes.includes(selectedMake)) {
                    categoryNeedsUpdate = true;
                    return { ...cat, makes: [...makes, selectedMake] };
                }
            }
            return cat;
        });

        // If the category didn't exist at all in the derived list, add it now.
        const categoryExists = orderData.category_list.list.some(c => c.name === newItemForOrderList.category && c.status === newItemForOrderList.status);
        if (!categoryExists) {
            categoryNeedsUpdate = true;
            const initialMakesMap = extractMakesFromChildTableForWP(projectDoc, orderData?.work_package || "");
            const baselineMakes = initialMakesMap[newItemForOrderList.category] || [];
            const newCategoryMakes = selectedMake ? Array.from(new Set([...baselineMakes, selectedMake])) : baselineMakes;
            updatedCategoryList.push({
                name: newItemForOrderList.category,
                status: newItemForOrderList.status,
                makes: newCategoryMakes.length > 0 ? newCategoryMakes : undefined,
            });
        }

        try {
            // --- 1. Persist changes to the backend ---
            await updateDoc("Procurement Requests", orderData.name, {
                order_list: updatedList,
                ...(categoryNeedsUpdate && { category_list: { list: updatedCategoryList } })
            });

            // --- 2. Update local state upon successful save ---
            setOrderData(prev => {
                if (!prev) return null;
                return {
                    ...prev,
                    order_list: updatedList,
                    ...(categoryNeedsUpdate && { category_list: { list: updatedCategoryList } })
                }
            });

            // --- 3. Update Undo Stack & UI ---
            const idxInStack = undoStack.findIndex(stackItem => stackItem.item_id === newItemForOrderList.item_id);
            if (idxInStack > -1) {
                const stackCopy = [...undoStack];
                stackCopy.splice(idxInStack, 1);
                setUndoStack(stackCopy);
            }

            // Reset form
            setCurrentItemOption(null);
            setCurrentQuantity('');
            setShowNewItemsCard(false);

            toast({ title: "Item Added", description: `"${newItemForOrderList.item_name}" was successfully added and saved to the PR.`, variant: "success" });

        } catch (error) {
            console.error("Failed to add item to PR:", error);
            toast({
                title: "Save Failed",
                description: "Could not save the new item to the PR. Please try again.",
                variant: "destructive",
            });
        }
    }, [currentItemOption, currentQuantity, orderData, undoStack, toast, setShowNewItemsCard, projectDoc, useDraftFirst, draftManager, workPackage]);


    const handleOpenEditDialog = useCallback((item: PRItemUIData) => {
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

            const updatedCategoryList = prevOrderData?.category_list?.list.map(cat => {
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
                const initialMakesMap = extractMakesFromChildTableForWP(projectDoc, prevOrderData?.work_package || "");
                const baselineMakes = initialMakesMap[categoryName] || [];
                updatedCategoryList.push({
                    name: categoryName,
                    // Determine appropriate status - maybe find from an item? Or default?
                    status: prevOrderData.order_list.find(i => i.category === categoryName)?.status || 'Pending',
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



    const handleSaveEditedItem = useCallback(async () => {
        if (!editItem || !editItem.item_id || !orderData) return;

        const quantityValue = parseNumber(editItem.quantity)

        if (quantityValue === undefined || isNaN(quantityValue) || quantityValue <= 0) {
            toast({ title: "Invalid Quantity", description: "Please enter a valid positive number for quantity.", variant: "destructive" });
            return;
        }

        // --- DRAFT-FIRST APPROACH ---
        if (useDraftFirst && draftManager) {
            // Use the item's name (docname) or item_id to identify the item
            const itemIdentifier = editItem.name || editItem.item_id;

            draftManager.updateItem(itemIdentifier!, {
                quantity: quantityValue,
                comment: editItem.comment?.trim() || undefined,
                make: editItem?.make,
            });

            setIsEditItemDialogOpen(false);
            setEditItem(null);
            toast({ title: "Item Updated", description: `"${editItem.item_name}" updated. Changes will be saved when you approve.`, variant: "success" });
            return;
        }

        // --- LEGACY APPROACH (backwards compatibility) ---
        const updatedList = orderData.order_list.map(item =>
            item.name === editItem.name
                ? { ...item, quantity: quantityValue, comment: editItem.comment?.trim() || undefined, make: editItem?.make }
                : item
        );

        setOrderData(prev => prev ? { ...prev, order_list: updatedList } : null);

        await updateDoc("Procurement Requests", orderData.name, {
            order_list: updatedList,
            category_list: orderData.category_list,
        });

        setIsEditItemDialogOpen(false);
        setEditItem(null);
        toast({ title: "Item Updated", description: `"${editItem.item_name}" updated successfully.`, variant: "success" });

    }, [editItem, orderData, toast, useDraftFirst, draftManager]);


    // const handleDeleteItem = useCallback((itemToDelete: PRItemUIData | EditItemState | RequestItemState) => { // Can delete from main list or edit dialog
    //     if (!itemToDelete || !itemToDelete.item_name || !orderData) return;

    //     const item = orderData.order_list.find(i => i.name === itemToDelete.name);

    //     // --- NEW VALIDATION ---
    //     // Check if this is the last item in the list.
    //     if (orderData.order_list.length <= 1) {
    //         toast({
    //             title: "Action Not Allowed",
    //             description: "Cannot delete the last item from a Procurement Request.",
    //             variant: "destructive",
    //         });
    //         if (isEditItemDialogOpen) {
    //             setIsEditItemDialogOpen(false);
    //         }
    //         return; // Exit the function
    //     }
    //     // --- END VALIDATION ---

    //     if (item) {
    //         // Add to undo stack only if it wasn't just a 'Request' status item
    //         if (item.status !== "Request") {
    //             setUndoStack(prev => [...prev, item]);
    //         }

    //         const updatedList = orderData.order_list.filter(i => i.name !== itemToDelete.name);
    //         setOrderData(prev => prev ? { ...prev, order_list: updatedList } : null);

    //         toast({ title: "Item Removed", description: `"${item.item_name}" removed.`, variant: "default" }); // Use default variant for removal
    //     }

    //     // Close dialogs if deletion happened from there
    //     if (isEditItemDialogOpen) setIsEditItemDialogOpen(false);
    //     if (isRequestItemDialogOpen) setIsRequestItemDialogOpen(false); // If rejecting/deleting request item
    //     setEditItem(null);
    //     setRequestItem(null);
    // }, [orderData, toast, isEditItemDialogOpen, isRequestItemDialogOpen]);

    // --- (REFACTORED) This is the handler that gets the bug fix ---
    const handleDeleteItem = useCallback(async (itemToDelete: PRItemUIData | EditItemState) => {
        if (!itemToDelete?.name || !orderData) return;

        const itemNameForToast = itemToDelete.item_name || 'the item';

        // --- VALIDATION: Cannot delete the last item ---
        const currentListLength = useDraftFirst && draftManager?.orderList
            ? draftManager.orderList.filter(i => !i._isDeleted).length
            : orderData.order_list.length;

        if (currentListLength <= 1) {
            toast({
                title: "Action Not Allowed",
                description: "Cannot delete the last item from a Procurement Request.",
                variant: "destructive",
            });
            if (isEditItemDialogOpen) setIsEditItemDialogOpen(false);
            return;
        }

        // --- DRAFT-FIRST APPROACH ---
        if (useDraftFirst && draftManager) {
            // Use the item's name (docname) to identify the item
            const deletedItem = draftManager.deleteItem(itemToDelete.name!);

            if (deletedItem) {
                toast({ title: "Item Removed", description: `"${itemNameForToast}" removed. Changes will be saved when you approve.`, variant: "default" });
            }

            // Close dialog if deletion happened from there
            if (isEditItemDialogOpen) setIsEditItemDialogOpen(false);
            setEditItem(null);
            return;
        }

        // --- LEGACY APPROACH (backwards compatibility) ---
        // 1. Calculate the intended new list of items.
        const updatedList = orderData.order_list.filter(i => i.name !== itemToDelete.name);

        try {
            // 2. Call `updateDoc` to save the new, shorter list to the server.
            await updateDoc("Procurement Requests", orderData.name, {
                order_list: updatedList,
            });

            // 3. On successful save, update the local state.
            setOrderData(prev => prev ? { ...prev, order_list: updatedList } : null);

            // 4. Add the item to the undo stack as before.
            const itemToUndo = orderData.order_list.find(i => i.name === itemToDelete.name);
            if (itemToUndo) {
                setUndoStack(prev => [...prev, itemToUndo]);
            }

            toast({ title: "Item Removed", description: `"${itemNameForToast}" was removed and the PR has been saved.`, variant: "default" });

            // Close dialog if deletion happened from there
            if (isEditItemDialogOpen) setIsEditItemDialogOpen(false);
            setEditItem(null);

        } catch (error) {
            console.error("Failed to delete item from PR:", error);
            toast({
                title: "Deletion Failed",
                description: `Could not remove "${itemNameForToast}" from the PR. Please try again.`,
                variant: "destructive",
            });
        }

    }, [orderData, updateDoc, toast, isEditItemDialogOpen, useDraftFirst, draftManager]);

    const handleUndoDelete = useCallback(() => {
        // --- DRAFT-FIRST APPROACH ---
        if (useDraftFirst && draftManager) {
            draftManager.undoDelete();
            toast({ title: "Undo Successful", description: "Item restored.", variant: "success" });
            return;
        }

        // --- LEGACY APPROACH (backwards compatibility) ---
        if (undoStack.length === 0 || !orderData) return;

        const itemToRestore = undoStack[undoStack.length - 1]; // Get last item
        const newStack = undoStack.slice(0, -1); // Remove last item from stack

        // Check if item already exists (e.g., user added it back manually)
        if (orderData.order_list.some(i => i.item_id === itemToRestore.item_id)) {
            toast({ title: "Undo Failed", description: `"${itemToRestore.item_name}" is already back in the list.`, variant: "destructive" });
            setUndoStack(newStack); // Still remove from stack as it's resolved
            return;
        }

        const updatedList = [...orderData.order_list, itemToRestore];
        setOrderData(prev => prev ? { ...prev, order_list: updatedList } : null);
        setUndoStack(newStack);
        toast({ title: "Undo Successful", description: `"${itemToRestore.item_name}" restored.`, variant: "success" });

    }, [undoStack, orderData, toast, useDraftFirst, draftManager]);

    // In useApprovePRLogic.ts, after other handlers
    // Action required deletion Happens here (for "Request" status items)
    const handleRejectRequestItem = useCallback(async (itemToReject: PRItemUIData) => {
        if (!itemToReject?.name || !orderData) return;

        const itemNameForToast = itemToReject.item_name || 'the requested item';

        // --- DRAFT-FIRST APPROACH ---
        if (useDraftFirst && draftManager) {
            // Get current lists BEFORE deletion (to avoid async state issues)
            const currentCategoryList = (draftManager.categoryList && draftManager.categoryList.length > 0)
                ? draftManager.categoryList
                : orderData.category_list.list;
            const currentOrderList = (draftManager.orderList && draftManager.orderList.length > 0)
                ? draftManager.orderList.filter(i => !i._isDeleted)
                : orderData.order_list;

            // Delete the Request item (they don't go to undo stack since they were never approved)
            draftManager.deleteItem(itemToReject.name!);

            // Compute remaining items manually (don't rely on async state update)
            const remainingItems = currentOrderList.filter(item => item.name !== itemToReject.name);

            // Check if other Request items exist in this category
            const otherRequestsInCategory = remainingItems.some(
                item => item.category === itemToReject.category && item.status === 'Request'
            );

            // If no other Request items in this category, remove the "Request" category entry
            if (!otherRequestsInCategory) {
                const updatedCategoryList = currentCategoryList.filter(
                    cat => !(cat.name === itemToReject.category && cat.status === 'Request')
                );
                draftManager.updateCategoryList(updatedCategoryList as DraftCategory[]);
            }

            toast({
                title: "Request Rejected",
                description: `Request for "${itemNameForToast}" rejected. Changes will be saved when you approve.`,
                variant: "success",
            });
            return;
        }

        // --- LEGACY APPROACH (backwards compatibility) ---
        // The new list without the rejected item
        const updatedList = orderData.order_list.filter(i => i.name !== itemToReject.name);

        try {
            // --- 1. Persist the change to the backend ---
            await updateDoc("Procurement Requests", orderData.name, {
                order_list: updatedList,
            });

            // --- 2. Update local state on success ---
            setOrderData(prev => (prev ? { ...prev, order_list: updatedList } : null));

            toast({
                title: "Request Rejected",
                description: `Request for "${itemNameForToast}" was permanently rejected.`,
                variant: "success",
            });

        } catch (error) {
            console.error("Failed to reject request:", error);
            toast({
                title: "Action Failed",
                description: `Could not reject the request for "${itemNameForToast}". Please try again.`,
                variant: "destructive",
            });
        }

    }, [orderData, updateDoc, toast, useDraftFirst, draftManager]);
    // --- New Item Creation ---
    const handleOpenNewItemDialog = useCallback(() => {
        // --- ADD THIS LINE ---
        setShowNewItemsCard(false); // Close the AddItemForm dialog

        // --- Keep existing logic ---
        setNewItem({}); // Reset new item form state
        setCurrentCategoryForNewItem(null); // Reset category for new item
        setFuzzyMatches([]); // Clear fuzzy matches from previous searches
        setIsNewItemDialogOpen(true); // Open the NewItemDialog

    }, [setShowNewItemsCard, setNewItem, setCurrentCategoryForNewItem, setIsNewItemDialogOpen]); // Add dependencies

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
            const itemToAdd: Omit<PRItemUIData, 'name' | 'creation' | 'modified' | 'parent' | 'parentfield' | 'parenttype' | 'docstatus' | 'idx' | 'owner' | 'modified_by'> = {
                item_name: createdItemDoc.item_name,
                item_id: createdItemDoc.name, // Use the new docname
                unit: createdItemDoc.unit_name,
                quantity: (quantityValue),
                procurement_package: workPackage,
                category: createdItemDoc.category,
                tax: parseNumber(currentCategoryForNewItem.tax),
                comment: newItem.comment?.trim() || undefined,
                status: "Pending",
            };

            const updatedList = [...orderData.order_list, itemToAdd];
            setOrderData(prev => prev ? { ...prev, order_list: updatedList as PRItemUIData[] } : null);


            toast({ title: "Success", description: `Item "${createdItemDoc.item_name}" created and added to PR.`, variant: "success" });
            setIsNewItemDialogOpen(false);
            setNewItem({}); // Reset form
            setCurrentCategoryForNewItem(null);


        } catch (error: any) {
            console.error("Error creating item:", error);
            toast({ title: "Creation Failed", description: error?.message || "Could not create the new item.", variant: "destructive" });
        }
    }, [newItem, currentCategoryForNewItem, orderData, createDoc, itemMutate, toast]);

    //---- HandleSelectiong Existing Item of matching item_id
    const handleSelectExistingItemFromNewDialog = useCallback((selectedItem: ItemOption) => {
        // 1. Set the state for the AddItemForm
        setCurrentItemOption(selectedItem);

        // 2. Close the NewItemDialog
        setIsNewItemDialogOpen(false);

        // 3. Re-open the AddItemForm
        setShowNewItemsCard(true);

    }, [setCurrentItemOption, setIsNewItemDialogOpen, setShowNewItemsCard]); // Add dependencies

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
        setFuzzyMatches(matches.slice(0,10)); // Limit matches shown
    }, [fuseInstance]);

    const handleOpenRequestItemDialog = useCallback((item: PRItemUIData) => {
        setRequestItem({
            name: item.name, // 
            item_id: item.item_id, // Original name/id from PR list
            item_name: item.item_name,
            unit: item.unit,
            quantity: item.quantity ?? '',
            category: item.category,
            // Initialize form fields with current values
            newItemName: item.item_name,
            newUnit: item.unit,
            newCategory: item.category,
        });
        handleFuzzySearch(item.item_name); // Trigger search immediately
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
            // --- Create New Item Master (ALWAYS happens immediately - can't draft this) ---
            const createdItemDoc = await createDoc("Items", {
                item_name: requestItem.newItemName,
                unit_name: requestItem.newUnit,
                category: requestItem.newCategory,
            });

            // Refetch item list to include the new item
            await itemMutate();

            // --- DRAFT-FIRST APPROACH ---
            if (useDraftFirst && draftManager) {
                // Get current lists BEFORE deletion (to avoid async state issues)
                // CRITICAL: Empty array [] is truthy, so we must check length explicitly
                const currentCategoryList = (draftManager.categoryList && draftManager.categoryList.length > 0)
                    ? draftManager.categoryList
                    : orderData.category_list.list;
                const currentOrderListBeforeDelete = (draftManager.orderList && draftManager.orderList.length > 0)
                    ? draftManager.orderList.filter(i => !i._isDeleted)
                    : orderData.order_list;

                // 1. Delete the original Request item
                draftManager.deleteItem(requestItem.name);

                // 2. Add the newly created item to the draft
                const newDraftItem: DraftItem = {
                    name: '', // New items don't have a row name yet
                    item_id: createdItemDoc.name,
                    item_name: createdItemDoc.item_name,
                    unit: createdItemDoc.unit_name,
                    quantity: quantityValue,
                    procurement_package: workPackage,
                    category: createdItemDoc.category,
                    tax: parseNumber(categoryDoc.tax),
                    status: "Pending",
                    _isNew: true,
                };
                draftManager.addItem(newDraftItem);

                // 3. Update category list
                let updatedCategoryList = [...currentCategoryList];

                // Ensure the category for the new item exists with 'Pending' status
                const newItemsCategoryExistsAsPending = updatedCategoryList.some(
                    cat => cat.name === newDraftItem.category && cat.status === 'Pending'
                );
                if (!newItemsCategoryExistsAsPending) {
                    const initialMakesMap = extractMakesFromChildTableForWP(projectDoc, workPackage || "");
                    const baselineMakes = initialMakesMap[newDraftItem.category] || [];
                    updatedCategoryList.push({
                        name: newDraftItem.category,
                        status: 'Pending',
                        makes: baselineMakes.length > 0 ? baselineMakes : undefined,
                    });
                }

                // Check if the category of the original requested item is still needed
                // Compute order list after deletion manually (don't rely on async state update)
                const originalCategoryName = requestItem.category;
                const orderListAfterDelete = currentOrderListBeforeDelete.filter(
                    item => item.name !== requestItem.name
                );
                const otherItemsInOriginalCategory = orderListAfterDelete.some(
                    item => item.category === originalCategoryName && item.status === 'Request'
                );

                if (!otherItemsInOriginalCategory) {
                    updatedCategoryList = updatedCategoryList.filter(
                        cat => !(cat.name === originalCategoryName && cat.status === 'Request')
                    );
                }

                draftManager.updateCategoryList(updatedCategoryList as DraftCategory[]);

                toast({ title: "Success", description: `Item "${createdItemDoc.item_name}" created and added. Changes will be saved when you approve.`, variant: "success" });
                setIsRequestItemDialogOpen(false);
                setRequestItem(null);
                setFuzzyMatches([]);
                return;
            }

            // --- LEGACY APPROACH (backwards compatibility) ---
            // Prepare Updated Procurement List
            const updatedProcurementList = orderData.order_list.map(listItem => {
                if (listItem.name === requestItem.name) {
                    return {
                        ...listItem,
                        item_name: createdItemDoc.item_name,
                        item_id: createdItemDoc.name,
                        unit: createdItemDoc.unit_name,
                        procurement_package: workPackage,
                        category: createdItemDoc.category,
                        quantity: quantityValue,
                        tax: parseNumber(categoryDoc.tax),
                        status: "Pending",
                    };
                }
                return listItem;
            });

            // Prepare Updated Category List
            const newCategories: PRCategory[] = [];
            updatedProcurementList.forEach((item) => {
                const existingCategory = newCategories.find(
                    (category) => category.name === item.category && category.status === item.status
                );
                if (!existingCategory) {
                    let makes = orderData?.category_list?.list?.find(c => c.name === item.category)?.makes || [];
                    if (makes?.length === 0 && item.status === "Pending" && projectDoc?.project_work_packages) {
                        try {
                            const wpData = typeof projectDoc.project_wp_category_makes === 'string' ? JSON.parse(projectDoc.project_wp_category_makes) : projectDoc.project_wp_category_makes;
                            const relevant_wps = wpData?.filter((wp: { procurement_package?: string; category?: string; make?: string }) => wp.procurement_package === item.procurement_package && wp.category === item.category) || [];
                            makes = relevant_wps.map((wp: { make?: string }) => wp?.make)?.filter((make: string | undefined) => !!make) || []
                        } catch (e) { console.error("Error parsing makes in handleApproveRequestedItemAsNew:", e); }
                    }
                    newCategories.push({
                        name: item.category,
                        status: item.status,
                        makes: makes.length > 0 ? makes : undefined
                    });
                }
            });
            const uniqueNewCategories = newCategories.filter((category, index, self) =>
                index === self.findIndex((c) => (c.name === category.name && c.status === category.status))
            );

            // Update Local State
            setOrderData((prevState) => {
                if (!prevState) return null;
                return {
                    ...prevState,
                    order_list: updatedProcurementList,
                    category_list: { list: uniqueNewCategories },
                };
            });

            // Update Database
            await updateDoc("Procurement Requests", orderData.name, {
                order_list: updatedProcurementList,
                category_list: { list: uniqueNewCategories },
            });

            await prMutate();

            toast({ title: "Success", description: `Requested item approved as "${createdItemDoc.item_name}".`, variant: "success" });
            setIsRequestItemDialogOpen(false);
            setRequestItem(null);
            setFuzzyMatches([]);

        } catch (error: any) {
            console.error("Error approving requested item:", error);
            toast({ title: "Approval Failed", description: error?.message || "Could not approve the requested item.", variant: "destructive" });
        }

    }, [requestItem, orderData, categoryList, projectDoc, createDoc, updateDoc, itemMutate, prMutate, toast, setIsRequestItemDialogOpen, setRequestItem, setFuzzyMatches, workPackage, useDraftFirst, draftManager]);


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

        // CRITICAL: Empty array [] is truthy, so we must check length explicitly
        const currentOrderList = useDraftFirst && draftManager?.orderList && draftManager.orderList.length > 0
            ? draftManager.orderList.filter(i => !i._isDeleted)
            : orderData.order_list;
        const currentCategoryList = useDraftFirst && draftManager?.categoryList && draftManager.categoryList.length > 0
            ? draftManager.categoryList
            : orderData.category_list.list;

        const isDuplicate = currentOrderList.some(item => item.item_id === match.name && item.name !== originalRequest.name);
        if (isDuplicate) {
            toast({ title: "Duplicate Item", description: `"${match.item_name}" is already in the list.`, variant: "destructive" });
            return;
        }

        // --- DRAFT-FIRST APPROACH ---
        if (useDraftFirst && draftManager) {
            // 1. Delete the original 'Request' item
            draftManager.deleteItem(originalRequest.name);

            // 2. Add the new matching item
            const newDraftItem: DraftItem = {
                name: '', // New items don't have a name yet
                item_id: match.name,
                item_name: match.item_name,
                unit: match.unit_name,
                quantity: quantityValue,
                procurement_package: workPackage,
                category: match.category,
                tax: parseNumber(categoryDoc.tax),
                status: "Pending",
                _isNew: true,
            };
            draftManager.addItem(newDraftItem);

            // 3. Update category list
            let updatedCategoryList = [...currentCategoryList];

            // Ensure the category for the new item exists with 'Pending' status
            const newItemsCategoryExistsAsPending = updatedCategoryList.some(
                cat => cat.name === newDraftItem.category && cat.status === 'Pending'
            );
            if (!newItemsCategoryExistsAsPending) {
                const initialMakesMap = extractMakesFromChildTableForWP(projectDoc, workPackage || "");
                const baselineMakes = initialMakesMap[newDraftItem.category] || [];
                updatedCategoryList.push({
                    name: newDraftItem.category,
                    status: 'Pending',
                    makes: baselineMakes.length > 0 ? baselineMakes : undefined,
                });
            }

            // Check if the category of the original requested item is still needed
            const originalCategoryName = originalRequest.category;
            // Compute order list after deletion manually (don't rely on async state update)
            // We already have currentOrderList from earlier - use it to compute remaining items
            const orderListAfterDelete = currentOrderList.filter(
                item => item.name !== originalRequest.name
            );
            const otherItemsInOriginalCategory = orderListAfterDelete.some(
                item => item.category === originalCategoryName && item.status === 'Request'
            );

            if (!otherItemsInOriginalCategory) {
                updatedCategoryList = updatedCategoryList.filter(
                    cat => !(cat.name === originalCategoryName && cat.status === 'Request')
                );
            }

            draftManager.updateCategoryList(updatedCategoryList as DraftCategory[]);

            toast({
                title: "Success",
                description: `"${match.item_name}" added, replacing "${originalRequest.item_name}". Changes will be saved when you approve.`,
                variant: "success"
            });
            setIsRequestItemDialogOpen(false);
            setRequestItem(null);
            setFuzzyMatches([]);
            return;
        }

        // --- LEGACY APPROACH (backwards compatibility) ---
        // NOTE: This is the BUG - it only updates local state, NOT the database!
        // With draft-first approach above, we fix this by consolidating all saves to handleConfirmAction.

        // Prepare the new "Pending" item
        const itemToAdd: Omit<PRItemUIData, 'name' | 'creation' | 'modified' | 'parent' | 'parentfield' | 'parenttype' | 'docstatus' | 'idx' | 'owner' | 'modified_by'> = {
            item_id: match.name,
            item_name: match.item_name,
            unit: match.unit_name,
            quantity: quantityValue,
            procurement_package: workPackage,
            category: match.category,
            tax: parseNumber(categoryDoc.tax),
            status: "Pending",
        };

        // Create the updated order list
        // First, remove the original 'Request' item.
        let updatedOrderList = currentOrderList.filter(item => item.name !== originalRequest.name);
        // Then, add the new matching item.
        updatedOrderList.push(itemToAdd as PRItemUIData);

        // Surgically update the category list
        let updatedCategoryList = [...currentCategoryList];

        // Ensure the category for the NEWLY ADDED item exists with 'Pending' status.
        const newItemsCategoryExistsAsPending = updatedCategoryList.some(
            cat => cat.name === itemToAdd.category && cat.status === 'Pending'
        );
        if (!newItemsCategoryExistsAsPending) {
            const initialMakesMap = extractMakesFromChildTableForWP(projectDoc, workPackage || "");
            const baselineMakes = initialMakesMap[itemToAdd.category] || [];
            updatedCategoryList.push({
                name: itemToAdd.category,
                status: 'Pending',
                makes: baselineMakes.length > 0 ? baselineMakes : undefined,
            });
        }

        // Check if the category of the ORIGINAL REQUESTED item is still needed.
        const originalCategoryName = originalRequest.category;
        const otherItemsInOriginalCategory = updatedOrderList.some(
            item => item.category === originalCategoryName && item.status === 'Request'
        );

        // If no other items with 'Request' status exist in that category, remove its 'Request' entry.
        if (!otherItemsInOriginalCategory) {
            updatedCategoryList = updatedCategoryList.filter(
                cat => !(cat.name === originalCategoryName && cat.status === 'Request')
            );
        }

        // Update the main state ONCE with both updated lists
        setOrderData(prev => prev ? {
            ...prev,
            order_list: updatedOrderList as PRItemUIData[],
            category_list: { list: updatedCategoryList as PRCategory[] }
        } : null);

        // Close dialog and show success message
        toast({
            title: "Success",
            description: `"${match.item_name}" added, replacing requested item "${originalRequest.item_name}".`,
            variant: "success"
        });
        setIsRequestItemDialogOpen(false);
        setRequestItem(null);
        setFuzzyMatches([]);

    }, [orderData, categoryList, toast, workPackage, projectDoc, setIsRequestItemDialogOpen, setRequestItem, setFuzzyMatches, useDraftFirst, draftManager]);

    // --- PR Actions (Approve, Reject, Delete) ---

    // Helper function available for saving comments separately if needed
    const _saveUniversalComment = async (prName: string, subject: string) => {
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
        // Get the current order list (from draft manager if using draft-first, otherwise from orderData)
        // CRITICAL: Empty array [] is truthy, so we must check length explicitly
        const currentOrderList = useDraftFirst && draftManager?.orderList && draftManager.orderList.length > 0
            ? draftManager.orderList.filter(i => !i._isDeleted)
            : orderData?.order_list || [];

        // Check if there are still requested items before approving
        if (action === 'approve' && currentOrderList.some(item => item.status === 'Request')) {
            toast({
                title: "Action Required",
                description: "Please resolve all 'Requested' items before approving the PR.",
                variant: "destructive",
            });
            return;
        }

        // Check if list is empty
        if (!currentOrderList.length) {
            toast({
                title: "Cannot Proceed",
                description: "Cannot approve or reject an empty PR list.",
                variant: "destructive"
            });
            return;
        }

        setSummaryAction(action);
        setIsConfirmActionDialogOpen(true)
    }, [orderData, toast, useDraftFirst, draftManager]);


    const handleConfirmAction = useCallback(async () => {
        if (!summaryAction || !orderData || !orderData.name) return;

        const actionText = summaryAction === 'approve' ? 'Approved' : 'Rejected';
        const subjectText = summaryAction === 'approve' ? 'approving pr' : 'rejecting pr';

        try {
            // Get the data to submit (from draft manager if using draft-first, otherwise from orderData)
            let orderListToSubmit: any[];
            let categoryListToSubmit: any;
            let commentToSave: string;

            if (useDraftFirst && draftManager) {
                // Get finalized data from draft manager
                const submissionData = draftManager.getDataForSubmission();
                orderListToSubmit = submissionData.orderList;
                categoryListToSubmit = { list: submissionData.categoryList };
                commentToSave = draftManager.universalComment || '';
            } else {
                orderListToSubmit = orderData.order_list;
                categoryListToSubmit = orderData.category_list;
                commentToSave = universalComment;
            }

            // Transform items for backend submission
            const payloadOrderList = orderListToSubmit.map(item => {
                const backendItem: Partial<ProcurementRequestItemDetail> = {
                    // For existing items, send their name. For new items (empty name or _isNew flag), don't send name
                    name: (item.name && !item.name.startsWith("NewRow-") && !item._isNew) ? item.name : undefined,
                    item_id: item.item_id,
                    item_name: item.item_name,
                    unit: item.unit,
                    quantity: item.quantity,
                    category: item.category,
                    procurement_package: item.procurement_package,
                    make: item?.make || "",
                    status: item.status,
                    tax: item.tax,
                    comment: item.comment,
                    vendor: item.vendor,
                    quote: item?.quote
                };
                // Remove undefined keys to send cleaner payload
                return Object.fromEntries(Object.entries(backendItem).filter(([_, v]) => v !== undefined));
            });

            console.log("payloadOrderList", payloadOrderList, "categoryList", categoryListToSubmit);

            // 1. Update the PR Document - THIS IS THE SINGLE ATOMIC COMMIT POINT
            const updatedPR = await updateDoc("Procurement Requests", orderData.name, {
                order_list: payloadOrderList,
                category_list: categoryListToSubmit,
                workflow_state: actionText,
            });

            // 2. Save Comment (if any)
            if (commentToSave.trim() && userData?.user_id) {
                try {
                    await createDoc("Nirmaan Comments", {
                        comment_type: "Comment",
                        reference_doctype: "Procurement Requests",
                        reference_name: updatedPR.name,
                        comment_by: userData.user_id,
                        content: commentToSave.trim(),
                        subject: subjectText,
                    });
                } catch (error) {
                    console.error("Error saving comment:", error);
                    toast({ title: "Comment Warning", description: "Could not save comment, but PR action succeeded.", variant: "destructive" });
                }
            }

            // 3. Clear draft after successful submission
            if (useDraftFirst && draftManager) {
                draftManager.clearDraftAfterSubmit();
            }

            // 4. Invalidate Cache & Navigate
            await prMutate();
            await globalMutate("ApprovePR,PRListMutate");

            toast({
                title: `PR ${actionText}`,
                description: `PR ${updatedPR.name} successfully ${actionText}.`,
                variant: "success",
            });

            setIsConfirmActionDialogOpen(false);
            navigate("/procurement-requests?tab=Approve PR");

        } catch (error: any) {
            console.error(`Error ${summaryAction === 'approve' ? 'approving' : 'rejecting'} PR:`, error);
            toast({
                title: "Action Failed",
                description: error?.message || `Could not ${summaryAction} PR ${orderData.name}.`,
                variant: "destructive",
            });
            setIsConfirmActionDialogOpen(false);
        }
    }, [summaryAction, orderData, universalComment, updateDoc, createDoc, userData, prMutate, globalMutate, navigate, toast, useDraftFirst, draftManager]);


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
        undoStack: currentUndoStack, // Use the computed undo stack (from draft manager or local state)
        currentItemOption,
        currentQuantity,
        newItem,
        currentCategoryForNewItem,
        editItem,
        requestItem,
        universalComment: useDraftFirst && draftManager?.universalComment !== undefined ? draftManager.universalComment : universalComment,
        fuzzyMatches,
        itemOptions,
        relevantComments, // Pass filtered comments
        isLoading, // Combined loading state for actions

        // Draft-first mode indicator
        useDraftFirst,

        // Dialog Visibility States
        isNewItemDialogOpen,
        isEditItemDialogOpen,
        isRequestItemDialogOpen,
        isDeletePRDialogOpen,
        isConfirmActionDialogOpen,

        // Handlers
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

        handleSelectExistingItemFromNewDialog,// matching item
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

        handleLocalCategoryMakesUpdate, // <<< Return the new local handler

        // Dialog Visibility Setters
        setIsNewItemDialogOpen,
        setIsEditItemDialogOpen,
        setIsRequestItemDialogOpen,
        setIsDeletePRDialogOpen,
        handleRejectRequestItem, // Action required deletion
        setIsConfirmActionDialogOpen,

        // Derived data (uses draft manager data when available)
        addedItems,
        requestedItems,
        addedCategoriesForDisplay,
        requestedCategoriesForDisplay,
        displayedCategoriesWithMakes,
        currentOrderList, // Expose the unified order list
        currentCategoryList, // Expose the unified category list

        // Helpers/Derived Data
        getFullName,
        managersIdList, // If needed in UI
        userData, // Pass user data if needed for permissions etc. in View
        allMakeOptions,
        makeList,
        makeListMutate,
        categoryMakelist,
        categoryMakeListMutate,
        itemFuseOptions
    };
};