import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from "@/components/ui/use-toast";
import {
     ProcurementRequestItemDetail
} from "@/types/NirmaanStack/ProcurementRequests";
import { useProcurementActions } from './useProcurementActions';
import { useTargetRatesForItems } from './useTargetRatesForItems';
import { useUsersForLookup } from './useUsersForLookup';
import { useFrappeDocumentEventListener } from 'frappe-react-sdk'; // Only this for events
import { VendorOption, ProgressDocument, getItemListFromDocument, getCategoryListFromDocument, ProcurementProgressLogicReturn, ProgressItem } from '../types';
import { urlStateManager } from '@/utils/urlStateManager';
import { getUrlStringParam } from '@/hooks/useServerDataTable';
import { useRFQFormManager } from './useRFQManager';

// Props for the logic hook
export interface UseProcurementProgressLogicProps {
    docId: string;
    initialDocument?: ProgressDocument; // Passed from container
    allVendorsForRFQ: VendorOption[];      // Passed from container
    documentMutate: () => Promise<any>;   // Passed from container
    currentUser: string | undefined;      // Passed from container (or useUserData here)
}

// Return type of the logic hook
// export interface UseProcurementProgressLogicReturn {
//     mode: 'edit' | 'view' | 'review';
//     docId: string;
//     currentDocument?: ProgressDocument;
//     formData: RFQData;
//     setFormData: React.Dispatch<React.SetStateAction<RFQData>>; // Expose for direct manipulation by children if needed
//     selectedVendorQuotes: Map<string, string>;
//     setSelectedVendorQuotes: React.Dispatch<React.SetStateAction<Map<string, string>>>; // Expose
    
//     isLoading: boolean; // Overall loading for critical async operations
//     isUpdatingDocument: boolean;
//     isRedirecting: string;

//     isAddVendorsDialogOpen: boolean;
//     isRevertDialogOpen: boolean;
//     isVendorSheetOpen: boolean;

//     tempSelectedVendorsInDialog: VendorOption[];
//     availableVendorOptionsForDialog: VendorOption[];
//     targetRatesDataMap?: Map<string, TargetRateDetailFromAPI>;
//     otherEditors: string[];
//     // isDocumentReadOnlyByWorkflow: boolean;
//     canContinueToReview: boolean;
    
//     getFullName: (userId?: string) => string;
    
//     handleModeChange: (newMode: 'edit' | 'view') => Promise<void>;
//     handleTempVendorSelectionInDialog: (selected: VendorOption[]) => void;
//     handleConfirmAddVendorsToRFQ: () => void;
//     handleDeleteVendorFromRFQ: (vendorId: string) => void;
//     handleQuoteChange: (itemId: string, vendorId: string, quote: string) => void;
//     handleMakeChange: (itemId: string, vendorId: string, make: string) => void;
//     handleVendorQuoteSelectionForItem: (itemId: string, vendorId: string | null) => void;
//     handleProceedToReview: () => Promise<void>;
//     handleRevertPRChanges: () => Promise<void>;
    
//     toggleAddVendorsDialog: () => void;
//     toggleRevertDialog: () => void;
//     toggleVendorSheet: () => void;

//     // Allow child (SelectVendorQuotesTable) to update the main document state for its own internal processing
//     // This is a pragmatic choice to avoid overly complex callback chains for direct list manipulation
//     updateCurrentDocumentItemList: (updater: (prevItems: ProcurementItem[] | SentBackItem[]) => ProcurementItem[] | SentBackItem[]) => void;
// }

export const useProcurementProgressLogic = ({
    docId,
    initialDocument,
    allVendorsForRFQ,
    documentMutate,
    currentUser,
}: UseProcurementProgressLogicProps): ProcurementProgressLogicReturn => {

    // --- Tab State Management ---
    const initialMode = useMemo(() => {
        // Determine initial tab based on role, default to "Approved PO" if not admin/lead
        const defaultTab = "edit";
        return getUrlStringParam("mode", defaultTab) as 'edit' | 'view' | 'review';
    }, []); // Calculate only once based on role

    const [mode, setMode] = useState<'edit' | 'view' | 'review'>(initialMode);


    useEffect(() => {
        if (urlStateManager.getParam("mode") !== mode) {
            urlStateManager.updateParam("mode", mode);
        }
    }, [mode]);
    
    useEffect(() => {
        const unsubscribe = urlStateManager.subscribe("mode", (_, value) => {
            const newMode = value || initialMode; // Fallback to initial if param removed
            if (mode !== newMode) {
                setMode(newMode as 'edit' | 'view' | 'review');
            }
        });
        return unsubscribe; // Cleanup subscription
    }, [initialMode]); // Depend on `tab` to avoid stale closures

    // const [mode, setMode] = useState<'edit' | 'view' | 'review'>(
    //     () => (searchParams.get("mode") as 'edit' | 'view' | 'review') || "edit"
    // );
    const [currentDocumentState, setCurrentDocumentState] = useState<ProgressDocument | undefined>(initialDocument);
    // const [formData, setFormData] = usePersistentState<RFQData>(`rfqDraft_${docId}`, {
    //     selectedVendors: [],
    //     details: {},
    // });
    // const [selectedVendorQuotes, setSelectedVendorQuotes] = useState<Map<string, string>>(() => new Map());

    const [isAddVendorsDialogOpen, setAddVendorsDialog] = useState(false);
    const [isRevertDialogOpen, setRevertDialog] = useState(false);
    const [isVendorSheetOpen, setIsVendorSheetOpen] = useState(false);
    const [tempSelectedVendorsInDialog, setTempSelectedVendorsInDialog] = useState<VendorOption[]>([]);
    const [otherEditors, setOtherEditors] = useState<string[]>([]);

    // Use RFQFormManager for RFQ data and final selections
    const {
        rfqFormData,
        setRfqFormData,
        finalSelectedQuotes, // Renamed from selectedVendorQuotes
        setFinalSelectedQuotes, // Renamed
        // Get handlers from RFQFormManager
        handleAddVendorsToRFQ, // If AddVendorsDialog directly uses this
        handleDeleteVendorFromRFQ,
        handleQuoteChange,
        handleMakeChange,
        handleVendorQuoteSelectionForItem, // Renamed
        resetRFQForm,
    } = useRFQFormManager(docId, initialDocument); // Pass initialDocument

    const { getFullName, isLoading: usersLoading } = useUsersForLookup(); // Fetches all users for name mapping
    
    const itemIdsToFetchTargetRates = useMemo(() =>
        getItemListFromDocument(currentDocumentState).map(item => item.item_id).filter(id => !!id),
    [currentDocumentState]);

    const { targetRatesDataMap, isLoading: targetRatesLoading } =
        useTargetRatesForItems(itemIdsToFetchTargetRates, docId);

    const {
        handleProceedToReview: actionProceedToReview,
        handleRevertPRChanges: actionRevertChanges,
        handleSaveDraft: actionSaveDraft,
        isUpdatingDocument,
        isRedirecting,
    } = useProcurementActions({ docId, docMutate: documentMutate });

    // Real-time document updates & viewers
    const { viewers } = useFrappeDocumentEventListener(
        initialDocument?.doctype || "Procurement Requests", // This needs to be stable or based on initialDocument
        docId,
        (event) => {
            toast({ title: "Document Updated", description: `${initialDocument?.doctype || 'Document'} ${event.name} modified.` });
            documentMutate();
        },
        true // emitOpenCloseEventsOnMount = true by default, explicit is fine
    );

    // Initialize/Update currentDocumentState, formData, and selectedVendorQuotes when initialDocument changes
    // useEffect(() => {
    //     if (initialDocument) {
    //         let docToSet = { ...initialDocument };
    //         console.log("docToSet", docToSet)
    //         // Ensure item lists are parsed if they come as strings (common for Frappe JSON fields)
    //         if (docToSet.doctype === "Procurement Requests" && typeof docToSet.procurement_list === "string") {
    //             try { docToSet.procurement_list = JSON.parse(docToSet.procurement_list || '{"list":[]}'); } catch (e) { console.error("Failed to parse PR procurement_list", e); docToSet.procurement_list = { list: [] }; }
    //         } else if (docToSet.doctype === "Sent Back Category" && typeof docToSet.item_list === "string") {
    //             try { docToSet.item_list = JSON.parse(docToSet.item_list || '{"list":[]}'); } catch (e) { console.error("Failed to parse SBC item_list", e); docToSet.item_list = { list: [] }; }
    //         }
    //         // Ensure list properties exist
    //         if (docToSet.doctype === "Procurement Requests" && !docToSet.procurement_list?.list) docToSet.procurement_list = { list: [] };
    //         if (docToSet.doctype === "Sent Back Category" && !docToSet.item_list?.list) docToSet.item_list = { list: [] };

    //         if (docToSet.doctype === "Procurement Requests" && typeof docToSet.category_list === "string") {
    //             try { docToSet.category_list = JSON.parse(docToSet.category_list || '{"list":[]}'); } catch (e) { console.error("Failed to parse PR category_list", e); docToSet.category_list = { list: [] }; }
    //         } else if (docToSet.doctype === "Sent Back Category" && typeof docToSet.category_list === "string") {
    //             try { docToSet.category_list = JSON.parse(docToSet.category_list || '{"list":[]}'); } catch (e) { console.error("Failed to parse SBC category_list", e); docToSet.category_list = { list: [] }; }
    //         }

    //         if (docToSet.doctype === "Procurement Requests" && typeof docToSet.rfq_data === "string") {
    //             try { docToSet.rfq_data = JSON.parse(docToSet.rfq_data || '{"selectedVendors":[], "details": {}}'); } catch (e) { console.error("Failed to parse PR rfq_data", e); docToSet.rfq_data = { selectedVendors: [], details: {} }; }
    //         } else if (docToSet.doctype === "Sent Back Category" && typeof docToSet.rfq_data === "string") {
    //             try { docToSet.rfq_data = JSON.parse(docToSet.rfq_data || '{"selectedVendors":[], "details": {}}'); } catch (e) { console.error("Failed to parse SBC rfq_data", e); docToSet.rfq_data = { selectedVendors: [], details: {} }; }
    //         }

    //         // if (!docToSet.category_list?.list) docToSet.category_list = { list: [] };


    //         setCurrentDocumentState(docToSet);

    //         const itemsFromDoc = getItemListFromDocument(docToSet);
    //         const categoryMapFromDoc = new Map(getCategoryListFromDocument(docToSet).map(cat => [cat.name, cat.makes || []]));

    //         // Initialize formData from document's rfq_data only if draft is completely empty
    //         const isDraftEmpty = (!formData.selectedVendors?.length && Object.keys(formData.details || {}).length === 0);
    //         if (isDraftEmpty && docToSet.rfq_data && (docToSet.rfq_data.selectedVendors?.length > 0 || Object.keys(docToSet.rfq_data.details || {}).length > 0)) {
    //             setFormData(docToSet.rfq_data);
    //         } else {
    //             // If draft exists, or no rfq_data on doc, ensure formData.details is initialized for all items from doc
    //             setFormData(prevDraft => {
    //                 const newDetails = { ...(prevDraft.details || {}) };
    //                 let changed = false;
    //                 itemsFromDoc.forEach(item => {
    //                     if (!newDetails[item.name]) {
    //                         newDetails[item.name] = {
    //                             initialMake: item.make,
    //                             vendorQuotes: {},
    //                             makes: categoryMapFromDoc.get(item.category) ?? [],
    //                         };
    //                         changed = true;
    //                     } else { // Sync makes if category config changed
    //                         const currentMakes = newDetails[item.name].makes;
    //                         const latestCategoryMakes = categoryMapFromDoc.get(item.category) ?? [];
    //                         if (JSON.stringify(currentMakes) !== JSON.stringify(latestCategoryMakes)) {
    //                             newDetails[item.name].makes = latestCategoryMakes;
    //                             changed = true;
    //                         }
    //                     }
    //                 });
    //                 return changed ? { ...prevDraft, details: newDetails } : prevDraft;
    //             });
    //         }
            
    //         // Initialize selectedVendorQuotes from document items (vendor field) if the map is currently empty
    //         // This prioritizes a loaded draft's selections if any exist.
    //         if (selectedVendorQuotes.size === 0) {
    //             const initialSelectionMap = new Map<string, string>();
    //             itemsFromDoc.forEach(item => {
    //                 if ('vendor' in item && item.vendor) { // Check if item has vendor (ProcurementItemWithVendor)
    //                     initialSelectionMap.set(item.name, item.vendor);
    //                 }
    //             });
    //             if (initialSelectionMap.size > 0) {
    //                 setSelectedVendorQuotes(initialSelectionMap);
    //             }
    //         }
    //     }
    // }, [initialDocument]); // Only re-run if the fetched initialDocument changes



    //updated useffect for new change in item list
    useEffect(() => {
    // This effect runs whenever the initial document data from the server changes.
    // Its job is to create a clean, reliable "draft" state for the UI to work with.
    if (initialDocument) {
        // 1. Create a deep copy to prevent mutating the original data from the server.
        let docToSet = JSON.parse(JSON.stringify(initialDocument));

        // 2. Normalize the item list.
        // Based on the provided data, BOTH "Procurement Requests" and "Sent Back Category"
        // use the `order_list` property for their items. This simplifies the logic.
        if (!Array.isArray(docToSet.order_list)) {
            // If for any reason `order_list` is not an array (e.g., null, undefined),
            // we default it to an empty array to prevent crashes downstream.
            console.warn(`Normalizing Document ${docId}: 'order_list' was not an array. Defaulting to empty.`);
            docToSet.order_list = [];
        }

        // 3. Normalize the RFQ data. This can be a stringified JSON from Frappe.
        if (typeof docToSet.rfq_data === 'string') {
            try {
                // Handle empty strings gracefully before parsing.
                docToSet.rfq_data = JSON.parse(docToSet.rfq_data || '{}');
            } catch (e) {
                console.error(`Failed to parse rfq_data JSON for ${docId}:`, e);
                // On error, reset to a clean, empty state.
                docToSet.rfq_data = { selectedVendors: [], details: {} };
            }
        }
        
        // Ensure rfq_data is a valid object if it was null, undefined, or an empty string after the above block.
        if (!docToSet.rfq_data) {
             docToSet.rfq_data = { selectedVendors: [], details: {} };
        }

        // 4. Set the fully normalized document as our component's working state.
        // Any other hooks or components that depend on `currentDocumentState` will now receive
        // clean, predictable data.
        setCurrentDocumentState(docToSet);
    }
}, [initialDocument]); // This dependency is correct: only run when the server data changes.
    // Update otherEditors based on viewers


    useEffect(() => {
        if (docId && currentUser) {
            setOtherEditors(viewers.filter(user => user !== currentUser));
        } else {
            setOtherEditors([]);
        }
    }, [viewers, currentUser, docId]);

    const handleModeChangeWrapper = useCallback(async (newMode: 'edit' | 'view') => {
        if (mode === newMode || isUpdatingDocument) return;

        if (newMode === "view" && mode === "edit" && currentDocumentState) {
            const success = await actionSaveDraft(currentDocumentState, rfqFormData, finalSelectedQuotes);
            if (!success) return; // Prevent mode switch if save fails
        }
        setMode(newMode);
    }, [mode, isUpdatingDocument, currentDocumentState, rfqFormData, finalSelectedQuotes, actionSaveDraft, setMode]);

    const availableVendorOptionsForDialog = useMemo(() => {
        const currentSelectedValuesInRfq = new Set(rfqFormData.selectedVendors.map(v => v.value));
        return allVendorsForRFQ.filter(v => !currentSelectedValuesInRfq.has(v.value));
    }, [allVendorsForRFQ, rfqFormData.selectedVendors]);

    const handleTempVendorSelectionInDialog = useCallback((selected: VendorOption[]) => {
        setTempSelectedVendorsInDialog(selected);
    }, []);

    // const handleConfirmAddVendorsToRFQ = useCallback(() => {
    //     setRfqFormData(prev => ({
    //         ...prev,
    //         selectedVendors: [
    //             ...prev.selectedVendors,
    //             ...tempSelectedVendorsInDialog.filter(nv => !prev.selectedVendors.find(sv => sv.value === nv.value))
    //         ]
    //     }));
    //     setTempSelectedVendorsInDialog([]);
    //     setAddVendorsDialog(false);
    // }, [tempSelectedVendorsInDialog, setRfqFormData]);

    // const handleDeleteVendorFromRFQ = useCallback((vendorIdToDelete: string) => {
    //     setFormData(prev => {
    //         const newSelectedVendors = prev.selectedVendors.filter(v => v.value !== vendorIdToDelete);
    //         const newDetails = { ...prev.details };
    //         Object.keys(newDetails).forEach(itemId => {
    //             if (newDetails[itemId]?.vendorQuotes?.[vendorIdToDelete]) {
    //                 delete newDetails[itemId].vendorQuotes[vendorIdToDelete];
    //             }
    //         });
    //         return { ...prev, selectedVendors: newSelectedVendors, details: newDetails };
    //     });
    //     setSelectedVendorQuotes(prevMap => {
    //         const newMap = new Map(prevMap);
    //         newMap.forEach((vendorId, itemId) => {
    //             if (vendorId === vendorIdToDelete) newMap.delete(itemId);
    //         });
    //         return newMap;
    //     });
    // }, [setFormData, setSelectedVendorQuotes]);

    // const handleQuoteChange = useCallback((itemId: string, vendorId: string, quote: string) => {
    //     console.log("itemId, vendorId, quote", itemId, vendorId, quote)
    //     setFormData(prev => {
    //         const itemDetails = prev.details[itemId] || { vendorQuotes: {}, makes: [], initialMake: undefined };
    //         const vendorQuoteDetails = itemDetails.vendorQuotes[vendorId] || {};
    //         return {
    //             ...prev,
    //             details: {
    //                 ...prev.details,
    //                 [itemId]: {
    //                     ...itemDetails,
    //                     vendorQuotes: { ...itemDetails.vendorQuotes, [vendorId]: { ...vendorQuoteDetails, quote } },
    //                 },
    //             },
    //         };
    //     });
    // }, [setFormData]);

    // const handleMakeChange = useCallback((itemId: string, vendorId: string, makeValue: string) => {
    //     setFormData(prev => {
    //         const itemDetails = prev.details[itemId] || { vendorQuotes: {}, makes: [], initialMake: undefined };
    //         const vendorQuoteDetails = itemDetails.vendorQuotes[vendorId] || {};
    //         return {
    //             ...prev,
    //             details: {
    //                 ...prev.details,
    //                 [itemId]: {
    //                     ...itemDetails,
    //                     vendorQuotes: { ...itemDetails.vendorQuotes, [vendorId]: { ...vendorQuoteDetails, make: makeValue } },
    //                 },
    //             },
    //         };
    //     });
    // }, [setFormData]);

    // const handleVendorQuoteSelectionForItem = useCallback((itemId: string, vendorId: string | null) => {
    //     setSelectedVendorQuotes(prevMap => {
    //         const newMap = new Map(prevMap);
    //         if (vendorId === null || newMap.get(itemId) === vendorId) {
    //             newMap.delete(itemId);
    //         } else {
    //             newMap.set(itemId, vendorId);
    //         }
    //         return newMap;
    //     });
    // }, []);

    const handleProceedToReviewWrapper = useCallback(async () => {
        if (currentDocumentState) {
            await actionProceedToReview(currentDocumentState, rfqFormData, finalSelectedQuotes);
        } else {
            toast({ title: "Error", description: "Document data not available for review.", variant: "destructive" });
        }
    }, [currentDocumentState, rfqFormData, finalSelectedQuotes, actionProceedToReview]);

    const handleRevertSelectionsWrapper = useCallback(async () => {
        if (currentDocumentState) {
            await actionRevertChanges(currentDocumentState);
            resetRFQForm();
            // setRfqFormData({ selectedVendors: [], details: {} }); // Reset draft
            // setFinalSelectedQuotes(new Map());
        } else {
            toast({ title: "Error", description: "Document data not available for revert.", variant: "destructive" });
        }
    }, [currentDocumentState, actionRevertChanges, resetRFQForm]);

    const handleSaveDraftWrapper = useCallback(async () => {
        if (currentDocumentState) {
            return await actionSaveDraft(currentDocumentState, rfqFormData, finalSelectedQuotes);
        }
        toast({ title: "Error", description: "No document data to save draft.", variant: "destructive" });
        return false;
    }, [currentDocumentState, rfqFormData, finalSelectedQuotes, actionSaveDraft]);
  // tax Hander 
  const handleTaxChange = useCallback((itemId: string, tax: string) => {
    setCurrentDocumentState(prevDoc => {
        if (!prevDoc) return prevDoc;

        // Since both doctypes use `order_list`, we can access it directly.
        const currentItems = prevDoc.order_list || [];

        const updatedItems = currentItems.map(item => {
            if (item.item_id === itemId) {
                return { ...item, tax: Number(tax) };
            }
            return item;
        });

        // Return a new document object with the updated order_list.
        // This works for both "Procurement Requests" and "Sent Back Category".
        return {
            ...prevDoc,
            order_list: updatedItems,
        };
    });
}, []);
    // Callback to update item list in currentDocumentState (e.g., if MakesSelection updates item.make)
    // This is tricky because currentDocumentState might be from SWR and should ideally be immutable.
    // Direct mutation is generally discouraged. A better pattern might be for MakesSelection
    // to call a handler that updates rfqFormData, and then if item.make needs to persist
    // outside RFQ (on the item itself), it's done during a save operation.
    // For now, providing a controlled way to update the *local copy* currentDocumentState.
    const updateCurrentDocumentStateItemList = useCallback((updater: (prevItems: ProgressItem[]) => ProgressItem[]) => {
        setCurrentDocumentState(prevDoc => {
            if (!prevDoc) return undefined;
            const currentItems = getItemListFromDocument(prevDoc);
            const updatedItems = updater(currentItems);
            // Reconstruct the document with the updated list
            return { ...prevDoc, order_list: updatedItems as ProcurementRequestItemDetail[] };
        });
    }, []);


    const toggleAddVendorsDialog = useCallback(() => setAddVendorsDialog(prev => !prev), []);
    const toggleRevertDialog = useCallback(() => setRevertDialog(prev => !prev), []);
    const toggleVendorSheet = useCallback(() => setIsVendorSheetOpen(prev => !prev), []);

    // const isDocumentReadOnlyByWorkflow = useMemo(() => {
    //     return !(currentDocumentState?.workflow_state === "In Progress" || currentDocumentState?.workflow_state === "Approved");
    // }, [currentDocumentState?.workflow_state]);

    const canContinueToReview = useMemo(() => {
        if (!currentDocumentState) return false;
        const items = getItemListFromDocument(currentDocumentState);
        if (items.length === 0) return false; // Cannot continue if no items
        if(currentDocumentState.doctype === "Procurement Requests") {
            return items.some(item => finalSelectedQuotes.has(item.item_id));
        }
        return items.every(item => finalSelectedQuotes.has(item.item_id));
    }, [finalSelectedQuotes, currentDocumentState]);


    return {
        mode, prId: docId, // Pass docId as prId for view
        currentDocument: currentDocumentState,
        setDocumentStateDirectly: setCurrentDocumentState, // Expose if needed by very complex children

        rfqFormData, setRfqFormData,
        finalSelectedQuotes, setFinalSelectedQuotes,
        
        isLoading: targetRatesLoading || usersLoading, // Primary data loading
        isUpdatingDocument, // From actions
        isRedirecting, // From actions

        // Dialogs and their states
        isAddVendorsDialogOpen, toggleAddVendorsDialog,
        isRevertDialogOpen, toggleRevertDialog,
        isVendorSheetOpen, toggleVendorSheet,
        tempSelectedVendorsInDialog, handleTempVendorSelectionInDialog,
        availableVendorOptionsForDialog, // This should be fine if allVendorsForRFQ is correct
        
        // Data and handlers from RFQFormManager are now primary
        handleConfirmAddVendorsToRFQ: () => { // Wrapper if AddVendorsDialog doesn't directly use RFQManager's handler
            handleAddVendorsToRFQ(tempSelectedVendorsInDialog);
            setTempSelectedVendorsInDialog([]);
            toggleAddVendorsDialog();
        },
        handleDeleteVendorFromRFQ, // from RFQManager
        handleQuoteChange,         // from RFQManager
        handleMakeChange,          // from RFQManager
        handleTaxChange, //from RFQManager EXPORT THE NEW HANDLER
        handleFinalVendorSelectionForItem: handleVendorQuoteSelectionForItem, // from RFQManager

        // Actions
        handleModeChange: handleModeChangeWrapper,
        handleProceedToReview: handleProceedToReviewWrapper,
        handleRevertSelections: handleRevertSelectionsWrapper, // Renamed
        handleSaveDraft: handleSaveDraftWrapper, // New

        // Lookups & Derived
        getFullName, // from useUsersForLookup
        canContinueToReview,
        targetRatesDataMap, // from useTargetRatesForItems
        otherEditors, // from event listener

        updateCurrentDocumentStateItemList: updateCurrentDocumentStateItemList, // Pass new updater

    };
};