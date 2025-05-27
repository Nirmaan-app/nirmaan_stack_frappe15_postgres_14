import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from "@/components/ui/use-toast";
import {
     RFQData, ProcurementItem, Category as PRCategory
} from "@/types/NirmaanStack/ProcurementRequests";
import { SentBackItem } from "@/types/NirmaanStack/SentBackCategory";
import { usePersistentState } from './usePersistentState';
import { useProcurementActions } from './useProcurementActions';
import { useTargetRatesForItems } from './useTargetRatesForItems';
import { useUsersForLookup } from './useUsersForLookup';
import { useFrappeDocumentEventListener } from 'frappe-react-sdk'; // Only this for events
import { VendorOption, ProgressDocumentType, getItemListFromDocument, getCategoryListFromDocument } from '../types';
import { TargetRateDetailFromAPI } from '../../ApproveVendorQuotes/types';

// Props for the logic hook
export interface UseProcurementProgressLogicProps {
    prId: string;
    initialDocument?: ProgressDocumentType; // Passed from container
    allVendorsForRFQ: VendorOption[];      // Passed from container
    documentMutate: () => Promise<any>;   // Passed from container
    currentUser: string | undefined;      // Passed from container (or useUserData here)
}

// Return type of the logic hook
export interface UseProcurementProgressLogicReturn {
    mode: 'edit' | 'view' | 'review';
    prId: string;
    currentDocument?: ProgressDocumentType;
    formData: RFQData;
    setFormData: React.Dispatch<React.SetStateAction<RFQData>>; // Expose for direct manipulation by children if needed
    selectedVendorQuotes: Map<string, string>;
    setSelectedVendorQuotes: React.Dispatch<React.SetStateAction<Map<string, string>>>; // Expose
    
    isLoading: boolean; // Overall loading for critical async operations
    isUpdatingDocument: boolean;
    isRedirecting: string;

    isAddVendorsDialogOpen: boolean;
    isRevertDialogOpen: boolean;
    isVendorSheetOpen: boolean;

    tempSelectedVendorsInDialog: VendorOption[];
    availableVendorOptionsForDialog: VendorOption[];
    targetRatesDataMap?: Map<string, TargetRateDetailFromAPI>;
    otherEditors: string[];
    // isDocumentReadOnlyByWorkflow: boolean;
    canContinueToReview: boolean;
    
    getFullName: (userId?: string) => string;
    
    handleModeChange: (newMode: 'edit' | 'view') => Promise<void>;
    handleTempVendorSelectionInDialog: (selected: VendorOption[]) => void;
    handleConfirmAddVendorsToRFQ: () => void;
    handleDeleteVendorFromRFQ: (vendorId: string) => void;
    handleQuoteChange: (itemId: string, vendorId: string, quote: string) => void;
    handleMakeChange: (itemId: string, vendorId: string, make: string) => void;
    handleVendorQuoteSelectionForItem: (itemId: string, vendorId: string | null) => void;
    handleProceedToReview: () => Promise<void>;
    handleRevertPRChanges: () => Promise<void>;
    
    toggleAddVendorsDialog: () => void;
    toggleRevertDialog: () => void;
    toggleVendorSheet: () => void;

    // Allow child (SelectVendorQuotesTable) to update the main document state for its own internal processing
    // This is a pragmatic choice to avoid overly complex callback chains for direct list manipulation
    updateCurrentDocumentItemList: (updater: (prevItems: ProcurementItem[] | SentBackItem[]) => ProcurementItem[] | SentBackItem[]) => void;
}

export const useProcurementProgressLogic = ({
    prId,
    initialDocument,
    allVendorsForRFQ,
    documentMutate,
    currentUser,
}: UseProcurementProgressLogicProps): UseProcurementProgressLogicReturn => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const [mode, setMode] = useState<'edit' | 'view' | 'review'>(
        () => (searchParams.get("mode") as 'edit' | 'view' | 'review') || "edit"
    );
    const [currentDocumentState, setCurrentDocumentState] = useState<ProgressDocumentType | undefined>(initialDocument);
    const [formData, setFormData] = usePersistentState<RFQData>(`procurementDraft_${prId}`, {
        selectedVendors: [],
        details: {},
    });
    const [selectedVendorQuotes, setSelectedVendorQuotes] = useState<Map<string, string>>(() => new Map());

    const [isAddVendorsDialogOpen, setAddVendorsDialog] = useState(false);
    const [isRevertDialogOpen, setRevertDialog] = useState(false);
    const [isVendorSheetOpen, setIsVendorSheetOpen] = useState(false);
    const [tempSelectedVendorsInDialog, setTempSelectedVendorsInDialog] = useState<VendorOption[]>([]);
    const [otherEditors, setOtherEditors] = useState<string[]>([]);

    const { getFullName, isLoading: usersLoading } = useUsersForLookup(); // Fetches all users for name mapping
    
    const itemIdsToFetchTargetRates = useMemo(() =>
        getItemListFromDocument(currentDocumentState).map(item => item.name).filter(id => !!id),
    [currentDocumentState]);

    const { targetRatesDataMap, isLoading: targetRatesLoading } =
        useTargetRatesForItems(itemIdsToFetchTargetRates, prId);

    const {
        handleProceedToReview: actionProceedToReview,
        handleRevertPRChanges: actionRevertChanges,
        handleSaveDraft: actionSaveDraft,
        isUpdatingDocument,
        isRedirecting,
    } = useProcurementActions({ prId, docMutate: documentMutate });

    // Real-time document updates & viewers
    const { viewers } = useFrappeDocumentEventListener(
        initialDocument?.doctype || "Procurement Requests", // This needs to be stable or based on initialDocument
        prId,
        (event) => {
            toast({ title: "Document Updated", description: `${initialDocument?.doctype || 'Document'} ${event.name} modified.` });
            documentMutate();
        },
        true // emitOpenCloseEventsOnMount = true by default, explicit is fine
    );

    // Initialize/Update currentDocumentState, formData, and selectedVendorQuotes when initialDocument changes
    useEffect(() => {
        if (initialDocument) {
            let docToSet = { ...initialDocument };
            console.log("docToSet", docToSet)
            // Ensure item lists are parsed if they come as strings (common for Frappe JSON fields)
            if (docToSet.doctype === "Procurement Requests" && typeof docToSet.procurement_list === "string") {
                try { docToSet.procurement_list = JSON.parse(docToSet.procurement_list || '{"list":[]}'); } catch (e) { console.error("Failed to parse PR procurement_list", e); docToSet.procurement_list = { list: [] }; }
            } else if (docToSet.doctype === "Sent Back Category" && typeof docToSet.item_list === "string") {
                try { docToSet.item_list = JSON.parse(docToSet.item_list || '{"list":[]}'); } catch (e) { console.error("Failed to parse SBC item_list", e); docToSet.item_list = { list: [] }; }
            }
            // Ensure list properties exist
            if (docToSet.doctype === "Procurement Requests" && !docToSet.procurement_list?.list) docToSet.procurement_list = { list: [] };
            if (docToSet.doctype === "Sent Back Category" && !docToSet.item_list?.list) docToSet.item_list = { list: [] };

            if (docToSet.doctype === "Procurement Requests" && typeof docToSet.category_list === "string") {
                try { docToSet.category_list = JSON.parse(docToSet.category_list || '{"list":[]}'); } catch (e) { console.error("Failed to parse PR category_list", e); docToSet.category_list = { list: [] }; }
            } else if (docToSet.doctype === "Sent Back Category" && typeof docToSet.category_list === "string") {
                try { docToSet.category_list = JSON.parse(docToSet.category_list || '{"list":[]}'); } catch (e) { console.error("Failed to parse SBC category_list", e); docToSet.category_list = { list: [] }; }
            }

            if (docToSet.doctype === "Procurement Requests" && typeof docToSet.rfq_data === "string") {
                try { docToSet.rfq_data = JSON.parse(docToSet.rfq_data || '{"selectedVendors":[], "details": {}}'); } catch (e) { console.error("Failed to parse PR rfq_data", e); docToSet.rfq_data = { selectedVendors: [], details: {} }; }
            } else if (docToSet.doctype === "Sent Back Category" && typeof docToSet.rfq_data === "string") {
                try { docToSet.rfq_data = JSON.parse(docToSet.rfq_data || '{"selectedVendors":[], "details": {}}'); } catch (e) { console.error("Failed to parse SBC rfq_data", e); docToSet.rfq_data = { selectedVendors: [], details: {} }; }
            }

            // if (!docToSet.category_list?.list) docToSet.category_list = { list: [] };


            setCurrentDocumentState(docToSet);

            const itemsFromDoc = getItemListFromDocument(docToSet);
            const categoryMapFromDoc = new Map(getCategoryListFromDocument(docToSet).map(cat => [cat.name, cat.makes || []]));

            // Initialize formData from document's rfq_data only if draft is completely empty
            const isDraftEmpty = (!formData.selectedVendors?.length && Object.keys(formData.details || {}).length === 0);
            if (isDraftEmpty && docToSet.rfq_data && (docToSet.rfq_data.selectedVendors?.length > 0 || Object.keys(docToSet.rfq_data.details || {}).length > 0)) {
                setFormData(docToSet.rfq_data);
            } else {
                // If draft exists, or no rfq_data on doc, ensure formData.details is initialized for all items from doc
                setFormData(prevDraft => {
                    const newDetails = { ...(prevDraft.details || {}) };
                    let changed = false;
                    itemsFromDoc.forEach(item => {
                        if (!newDetails[item.name]) {
                            newDetails[item.name] = {
                                initialMake: item.make,
                                vendorQuotes: {},
                                makes: categoryMapFromDoc.get(item.category) ?? [],
                            };
                            changed = true;
                        } else { // Sync makes if category config changed
                            const currentMakes = newDetails[item.name].makes;
                            const latestCategoryMakes = categoryMapFromDoc.get(item.category) ?? [];
                            if (JSON.stringify(currentMakes) !== JSON.stringify(latestCategoryMakes)) {
                                newDetails[item.name].makes = latestCategoryMakes;
                                changed = true;
                            }
                        }
                    });
                    return changed ? { ...prevDraft, details: newDetails } : prevDraft;
                });
            }
            
            // Initialize selectedVendorQuotes from document items (vendor field) if the map is currently empty
            // This prioritizes a loaded draft's selections if any exist.
            if (selectedVendorQuotes.size === 0) {
                const initialSelectionMap = new Map<string, string>();
                itemsFromDoc.forEach(item => {
                    if ('vendor' in item && item.vendor) { // Check if item has vendor (ProcurementItemWithVendor)
                        initialSelectionMap.set(item.name, item.vendor);
                    }
                });
                if (initialSelectionMap.size > 0) {
                    setSelectedVendorQuotes(initialSelectionMap);
                }
            }
        }
    }, [initialDocument]); // Only re-run if the fetched initialDocument changes


    // Update otherEditors based on viewers
    useEffect(() => {
        if (prId && currentUser) {
            setOtherEditors(viewers.filter(user => user !== currentUser));
        } else {
            setOtherEditors([]);
        }
    }, [viewers, currentUser, prId]);


    const updateURLNoReload = useCallback((newModeQueryParam: string) => {
        const currentParams = new URLSearchParams(searchParams);
        currentParams.set("mode", newModeQueryParam);
        navigate(`${location.pathname}?${currentParams.toString()}`, { replace: true });
    }, [navigate, location.pathname, searchParams]);

    const handleModeChange = useCallback(async (newMode: 'edit' | 'view') => {
        if (mode === newMode || isUpdatingDocument) return;

        if (newMode === "view" && mode === "edit" && currentDocumentState) {
            const success = await actionSaveDraft(currentDocumentState, formData, selectedVendorQuotes);
            if (!success) return; // Prevent mode switch if save fails
        }
        setMode(newMode);
        updateURLNoReload(newMode);
    }, [mode, isUpdatingDocument, currentDocumentState, formData, selectedVendorQuotes, actionSaveDraft, updateURLNoReload, setMode]);

    const availableVendorOptionsForDialog = useMemo(() => {
        const currentSelectedValuesInRfq = new Set(formData.selectedVendors.map(v => v.value));
        return allVendorsForRFQ.filter(v => !currentSelectedValuesInRfq.has(v.value));
    }, [allVendorsForRFQ, formData.selectedVendors]);

    const handleTempVendorSelectionInDialog = useCallback((selected: VendorOption[]) => {
        setTempSelectedVendorsInDialog(selected);
    }, []);

    const handleConfirmAddVendorsToRFQ = useCallback(() => {
        setFormData(prev => ({
            ...prev,
            selectedVendors: [
                ...prev.selectedVendors,
                ...tempSelectedVendorsInDialog.filter(nv => !prev.selectedVendors.find(sv => sv.value === nv.value))
            ]
        }));
        setTempSelectedVendorsInDialog([]);
        setAddVendorsDialog(false);
    }, [tempSelectedVendorsInDialog, setFormData]);

    const handleDeleteVendorFromRFQ = useCallback((vendorIdToDelete: string) => {
        setFormData(prev => {
            const newSelectedVendors = prev.selectedVendors.filter(v => v.value !== vendorIdToDelete);
            const newDetails = { ...prev.details };
            Object.keys(newDetails).forEach(itemId => {
                if (newDetails[itemId]?.vendorQuotes?.[vendorIdToDelete]) {
                    delete newDetails[itemId].vendorQuotes[vendorIdToDelete];
                }
            });
            return { ...prev, selectedVendors: newSelectedVendors, details: newDetails };
        });
        setSelectedVendorQuotes(prevMap => {
            const newMap = new Map(prevMap);
            newMap.forEach((vendorId, itemId) => {
                if (vendorId === vendorIdToDelete) newMap.delete(itemId);
            });
            return newMap;
        });
    }, [setFormData, setSelectedVendorQuotes]);

    const handleQuoteChange = useCallback((itemId: string, vendorId: string, quote: string) => {
        console.log("itemId, vendorId, quote", itemId, vendorId, quote)
        setFormData(prev => {
            const itemDetails = prev.details[itemId] || { vendorQuotes: {}, makes: [], initialMake: undefined };
            const vendorQuoteDetails = itemDetails.vendorQuotes[vendorId] || {};
            return {
                ...prev,
                details: {
                    ...prev.details,
                    [itemId]: {
                        ...itemDetails,
                        vendorQuotes: { ...itemDetails.vendorQuotes, [vendorId]: { ...vendorQuoteDetails, quote } },
                    },
                },
            };
        });
    }, [setFormData]);

    const handleMakeChange = useCallback((itemId: string, vendorId: string, makeValue: string) => {
        setFormData(prev => {
            const itemDetails = prev.details[itemId] || { vendorQuotes: {}, makes: [], initialMake: undefined };
            const vendorQuoteDetails = itemDetails.vendorQuotes[vendorId] || {};
            return {
                ...prev,
                details: {
                    ...prev.details,
                    [itemId]: {
                        ...itemDetails,
                        vendorQuotes: { ...itemDetails.vendorQuotes, [vendorId]: { ...vendorQuoteDetails, make: makeValue } },
                    },
                },
            };
        });
    }, [setFormData]);

    const handleVendorQuoteSelectionForItem = useCallback((itemId: string, vendorId: string | null) => {
        setSelectedVendorQuotes(prevMap => {
            const newMap = new Map(prevMap);
            if (vendorId === null || newMap.get(itemId) === vendorId) {
                newMap.delete(itemId);
            } else {
                newMap.set(itemId, vendorId);
            }
            return newMap;
        });
    }, []);

    const handleProceedToReviewWrapper = useCallback(async () => {
        if (currentDocumentState) {
            await actionProceedToReview(currentDocumentState, formData, selectedVendorQuotes);
        } else {
            toast({ title: "Error", description: "Document data not available for review.", variant: "destructive" });
        }
    }, [currentDocumentState, formData, selectedVendorQuotes, actionProceedToReview]);

    const handleRevertPRChangesWrapper = useCallback(async () => {
        if (currentDocumentState) {
            await actionRevertChanges(currentDocumentState);
            setFormData({ selectedVendors: [], details: {} }); // Reset draft
            setSelectedVendorQuotes(new Map());
        } else {
            toast({ title: "Error", description: "Document data not available for revert.", variant: "destructive" });
        }
    }, [currentDocumentState, actionRevertChanges, setFormData]);

    const updateCurrentDocumentItemList = useCallback((updater: (prevItems: ProcurementItem[] | SentBackItem[]) => ProcurementItem[] | SentBackItem[]) => {
        setCurrentDocumentState(prevDoc => {
            if (!prevDoc) return undefined;
            const currentItems = getItemListFromDocument(prevDoc);
            const updatedItems = updater(currentItems);

            if (prevDoc.doctype === "Procurement Requests") {
                return { ...prevDoc, procurement_list: { list: updatedItems as ProcurementItem[] } };
            } else if (prevDoc.doctype === "Sent Back Category") {
                return { ...prevDoc, item_list: { list: updatedItems as SentBackItem[] } };
            }
            return prevDoc;
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
            return items.some(item => selectedVendorQuotes.has(item.name));
        }
        return items.every(item => selectedVendorQuotes.has(item.name));
    }, [selectedVendorQuotes, currentDocumentState]);


    return {
        mode, prId,
        currentDocument: currentDocumentState,
        formData, setFormData,
        selectedVendorQuotes, setSelectedVendorQuotes,
        isLoading: targetRatesLoading || usersLoading, // Initial data loading for the page logic
        isUpdatingDocument, // From useProcurementActions (for save/revert/proceed)
        isRedirecting,
        isAddVendorsDialogOpen, isRevertDialogOpen, isVendorSheetOpen,
        tempSelectedVendorsInDialog, availableVendorOptionsForDialog,
        targetRatesDataMap,
        otherEditors,
        // isDocumentReadOnlyByWorkflow,
        canContinueToReview,
        getFullName,
        handleModeChange, handleTempVendorSelectionInDialog, handleConfirmAddVendorsToRFQ,
        handleDeleteVendorFromRFQ, handleQuoteChange, handleMakeChange,
        handleVendorQuoteSelectionForItem,
        handleProceedToReview: handleProceedToReviewWrapper,
        handleRevertPRChanges: handleRevertPRChangesWrapper,
        toggleAddVendorsDialog, toggleRevertDialog, toggleVendorSheet,
        updateCurrentDocumentItemList,
    };
};