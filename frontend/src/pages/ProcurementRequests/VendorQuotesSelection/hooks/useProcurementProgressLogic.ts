import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from "@/components/ui/use-toast";
import {
     ProcurementRequestItemDetail
} from "@/types/NirmaanStack/ProcurementRequests";
import { useProcurementActions } from './useProcurementActions';
import { useTargetRatesForItems } from './useTargetRatesForItems';
import { useUsersForLookup } from './useUsersForLookup';
import { useFrappeDocumentEventListener ,useFrappeGetDocList} from 'frappe-react-sdk'; // Only this for events
import { VendorOption, ProgressDocument, getItemListFromDocument, getCategoryListFromDocument, ProcurementProgressLogicReturn,getAdditionalChargesTemplates, ProgressItem } from '../types';
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
     onAddCharges,
    onUpdateCharge,
    onDeleteCharge,
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

      // --- NEW: Discover available charge templates ---
      const { 
        data: chargeItemsDataForAdditionalCharges, 
        
    } = useFrappeGetDocList("Items", {
        fields: ['name', 'item_name', 'category'], // 'name' is the item_id
        filters: [['category', '=', 'Additional Charges']],
        limit: 200 // Set a reasonable limit for charges
    });
    const availableChargeTemplates = useMemo(() => {
        // Map the fetched data to the format our components expect.
        // 'item.name' from Frappe is the unique ID we need for 'item_id'.
        return (chargeItemsDataForAdditionalCharges || []).map(item => ({
            item_id: item.name, 
            item_name: item.item_name
        }));
    }, [chargeItemsDataForAdditionalCharges]);

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
// --- ADD THESE NEW HANDLERS TO BE EXPORTED ---
    onAddCharges,
    onUpdateCharge,
    onDeleteCharge,
     availableChargeTemplates,
    //----
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
