import { useState, useEffect, useCallback } from 'react';
import { RFQData } from '@/types/NirmaanStack/ProcurementRequests'; // Adjust path
import { VendorOption, ProgressDocument, getItemListFromDocument, getCategoryListFromDocument } from '../types'; // Local feature types
import { usePersistentState } from './usePersistentState'; // Your hook

const initialRFQDataState: RFQData = {
    selectedVendors: [],
    details: {},
};

export const useRFQFormManager = (
    docId: string,
    initialDocumentData?: ProgressDocument // PR or SBC
) => {
    const [rfqFormData, setRfqFormData] = usePersistentState<RFQData>(`rfqDraft_${docId}`, initialRFQDataState); // Use rfqDraft key
    const [finalSelectedQuotes, setFinalSelectedQuotes] = useState<Map<string, string>>(() => new Map());
 // item.name -> vendor.name

    // Initialize/Re-initialize formData.details based on items in the document
    // useEffect(() => {
    //     if (initialDocumentData) {
    //         const items = getItemListFromDocument(initialDocumentData);
    //         const categoryMap = new Map(initialDocumentData.category_list?.list?.map(cat => [cat.name, cat.makes || []]));

    //         // Sync selectedVendors from document's rfq_data if draft is empty
    //         if (formData.selectedVendors.length === 0 && initialDocumentData.rfq_data?.selectedVendors?.length > 0) {
    //             setFormData(prev => ({ ...prev, selectedVendors: initialDocumentData.rfq_data.selectedVendors }));
    //         }

    //         // Sync details: Initialize if empty, but don't overwrite existing draft quotes
    //         const newDetails = { ...(formData.details || {}) }; // Start with existing draft details
    //         let detailsChanged = false;
    //         items.forEach(item => {
    //             if (!newDetails[item.name]) { // Only initialize if not in draft details
    //                 const defaultMakes = categoryMap.get(item.category) ?? [];
    //                 newDetails[item.name] = {
    //                     initialMake: item.make, // Capture initial make from item
    //                     vendorQuotes: {},
    //                     makes: defaultMakes,
    //                 };
    //                 detailsChanged = true;
    //             } else { // If item exists in draft, ensure its 'makes' are up-to-date if category's makes changed
    //                 const currentMakesInDraft = newDetails[item.name].makes;
    //                 const categoryMakes = categoryMap.get(item.category) ?? [];
    //                 if (JSON.stringify(currentMakesInDraft) !== JSON.stringify(categoryMakes)) {
    //                     newDetails[item.name].makes = categoryMakes;
    //                     detailsChanged = true;
    //                 }
    //             }
    //         });

    //         if (detailsChanged) {
    //             setFormData(prev => ({ ...prev, details: newDetails }));
    //         }

    //         // Initialize selectedVendorQuotes from the document's items if the map is empty
    //         if (selectedVendorQuotes.size === 0) {
    //             const initialSelectionMap = new Map<string, string>();
    //             items.forEach(item => {
    //                 if ('vendor' in item && item.vendor) { // Check if item has a vendor property
    //                     initialSelectionMap.set(item.name, item.vendor);
    //                 }
    //             });
    //             if (initialSelectionMap.size > 0) {
    //                 setSelectedVendorQuotes(initialSelectionMap);
    //             }
    //         }
    //     }
    // }, [initialDocumentData, prId]); // Rerun when fetched doc changes or prId (for new draft key)

    useEffect(() => {
        if (initialDocumentData) {
            let docToSet = { ...initialDocumentData };

            if (typeof docToSet.rfq_data === "string") {
                try { docToSet.rfq_data = JSON.parse(docToSet.rfq_data || '{"selectedVendors":[], "details": {}}'); } catch (e) { console.error("Failed to parse PR rfq_data", e); docToSet.rfq_data = { selectedVendors: [], details: {} }; }
            }

            const items = getItemListFromDocument(docToSet); // Returns ProgressItem[]
            // Assuming category_list is still JSON and its structure is consistent
            const categoryMap = new Map(getCategoryListFromDocument(docToSet).map(cat => [cat.name, cat.makes || []]));

            // Initialize RFQ data from document if draft is empty
            const isDraftEmpty = (!rfqFormData.selectedVendors?.length && Object.keys(rfqFormData.details || {}).length === 0);
            if (isDraftEmpty && docToSet.rfq_data && (docToSet.rfq_data.selectedVendors?.length > 0 || Object.keys(docToSet.rfq_data.details || {}).length > 0)) {
                setRfqFormData(docToSet.rfq_data);
            }

            // Ensure formData.details is initialized for all items
            setRfqFormData(prevDraft => {
                const newDetails = { ...(prevDraft.details || {}) };
                let detailsChanged = false;
                items.forEach(item => { // item is ProgressItem (ProcurementRequestItemDetail)
                    const itemId = item.item_id; // Use item_id as the key
                    if (!newDetails[itemId]) {
                        newDetails[itemId] = {
                            initialMake: item.make, // from ProgressItem
                            vendorQuotes: {},
                            makes: categoryMap.get(item.category) ?? [], // Makes from category_list JSON
                        };
                        detailsChanged = true;
                    } else {
                        const currentMakesInDraft = newDetails[itemId].makes;
                        const latestCategoryMakes = categoryMap.get(item.category) ?? [];
                        if (JSON.stringify(currentMakesInDraft) !== JSON.stringify(latestCategoryMakes)) {
                            newDetails[itemId].makes = latestCategoryMakes;
                            detailsChanged = true;
                        }
                        // Sync initialMake if it changed in the source document item
                        if (newDetails[itemId].initialMake !== item.make) {
                            newDetails[itemId].initialMake = item.make;
                            detailsChanged = true;
                        }
                    }
                });
                return detailsChanged ? { ...prevDraft, details: newDetails } : prevDraft;
            });
            
            // Initialize finalSelectedQuotes from items if map is empty
            if (finalSelectedQuotes.size === 0) {
                const initialSelectionMap = new Map<string, string>();
                items.forEach(item => { // item is ProgressItem
                    if (item.vendor && item.item_id) { // item.vendor is the selected vendor ID
                        initialSelectionMap.set(item.item_id, item.vendor);
                    }
                });
                if (initialSelectionMap.size > 0) {
                    setFinalSelectedQuotes(initialSelectionMap);
                }
            }
        }
    }, [initialDocumentData, docId, setRfqFormData, finalSelectedQuotes.size]); // Added dependencies


    const handleAddVendorsToRFQ = useCallback((newVendors: VendorOption[]) => {
        setRfqFormData(prev => ({
            ...prev,
            selectedVendors: [...prev.selectedVendors, ...newVendors.filter(nv => !prev.selectedVendors.find(sv => sv.value === nv.value))]
        }));
    }, [setRfqFormData]);

    const handleDeleteVendorFromRFQ = useCallback((vendorIdToDelete: string) => {
        setRfqFormData(prev => {
            const newSelectedVendors = prev.selectedVendors.filter(v => v.value !== vendorIdToDelete);
            const newDetails = { ...prev.details };
            Object.keys(newDetails).forEach(itemId => {
                if (newDetails[itemId]?.vendorQuotes?.[vendorIdToDelete]) {
                    delete newDetails[itemId].vendorQuotes[vendorIdToDelete];
                }
            });
            return { ...prev, selectedVendors: newSelectedVendors, details: newDetails };
        });
        setFinalSelectedQuotes(prevMap => {
            const newMap = new Map(prevMap);
            newMap.forEach((vendorId, itemId) => {
                if (vendorId === vendorIdToDelete) newMap.delete(itemId);
            });
            return newMap;
        });
    }, [setRfqFormData, setFinalSelectedQuotes]);

    const handleQuoteChange = useCallback((itemId: string, vendorId: string, quote: string) => {
        setRfqFormData(prev => {
            const itemDetails = prev.details[itemId] || { vendorQuotes: {}, makes: [] };
            const vendorQuoteDetails = itemDetails.vendorQuotes[vendorId] || {};
            return {
                ...prev,
                details: {
                    ...prev.details,
                    [itemId]: {
                        ...itemDetails,
                        vendorQuotes: {
                            ...itemDetails.vendorQuotes,
                            [vendorId]: { ...vendorQuoteDetails, quote },
                        },
                    },
                },
            };
        });
    }, [setRfqFormData]);

    const handleMakeChange = useCallback((itemId: string, vendorId: string, make: string) => {
        setRfqFormData(prev => {
            const itemDetails = prev.details[itemId] || { vendorQuotes: {}, makes: [] };
            const vendorQuoteDetails = itemDetails.vendorQuotes[vendorId] || {};
            return {
                ...prev,
                details: {
                    ...prev.details,
                    [itemId]: {
                        ...itemDetails,
                        vendorQuotes: {
                            ...itemDetails.vendorQuotes,
                            [vendorId]: { ...vendorQuoteDetails, make },
                        },
                    },
                },
            };
        });
    }, [setRfqFormData]);

    const handleVendorQuoteSelectionForItem = useCallback((itemId: string, vendorId: string | null) => {
        setFinalSelectedQuotes(prevMap => {
            const newMap = new Map(prevMap);
            if (vendorId === null || newMap.get(itemId) === vendorId) {
                newMap.delete(itemId);
            } else {
                newMap.set(itemId, vendorId);
            }
            return newMap;
        });
    }, []);

    const resetRFQForm = useCallback(() => {
        setRfqFormData(initialRFQDataState);
        setFinalSelectedQuotes(new Map());
        localStorage.removeItem(`rfqDraft_${docId}`);
    }, [docId, setRfqFormData]);


    return {
        rfqFormData,
        setRfqFormData, // Expose if direct manipulation is needed, but prefer handlers
        finalSelectedQuotes,
        setFinalSelectedQuotes, // Expose for direct manipulation if needed
        handleAddVendorsToRFQ,
        handleDeleteVendorFromRFQ,
        handleQuoteChange,
        handleMakeChange,
        handleVendorQuoteSelectionForItem,
        resetRFQForm,
    };
};