import { useState, useEffect, useCallback } from 'react';
import { RFQData } from '../types'; // Adjust path
import { VendorOption, ProgressDocument, getItemListFromDocument, getCategoryListFromDocument } from '../types'; // Local feature types
import { usePersistentState } from './usePersistentState'; // Your hook
import {ChargeItem} from "../types";
import { ChargeType } from "../components/AddVendorChargesDialog";

const initialRFQDataState: RFQData = {
    selectedVendors: [],
    details: {},
    chargesByVendor:{}
};

export const useRFQFormManager = (
    docId: string,
    initialDocumentData?: ProgressDocument // PR or SBC
) => {
    const [rfqFormData, setRfqFormData] = usePersistentState<RFQData>(`rfqDraft_${docId}`, initialRFQDataState); // Use rfqDraft key
    const [finalSelectedQuotes, setFinalSelectedQuotes] = useState<Map<string, string>>(() => new Map());
    
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
        // console.log("VendorId Delayed Item Id",vendorId,"jiu",itemId)
        setFinalSelectedQuotes(prevMap => {
            const newMap = new Map(prevMap);
            if (vendorId === null || newMap.get(itemId) === vendorId) {
                newMap.delete(itemId);
            } else {
                newMap.set(itemId, vendorId);
            }
            // console.log("New Map",newMap)
            return newMap;
        });
    }, []);

    // Import the new types at the top

// ... inside the useRFQFormManager hook ...

// At top of the file

// ... inside the useR    // --- CHARGE HANDLERS (MODIFIED) ---

    const handleAddCharges = useCallback((vendorId: string, chargesToAdd: { item_id: string; item_name: string }[]) => {
        setRfqFormData(prev => {
            const existingCharges = prev.chargesByVendor?.[vendorId] || [];
            const existingChargeIds = new Set(existingCharges.map(c => c.item_id));
// console.log("chargesToAdd",chargesToAdd)
            const newCharges: ChargeItem[] = chargesToAdd
                .filter(chargeTemplate => !existingChargeIds.has(chargeTemplate.item_id)) // Prevent adding duplicates
                .map(chargeTemplate => ({ 
                    item_id: chargeTemplate.item_id,
                    item_name: chargeTemplate.item_name,
                    quote: 0, 
                    tax: 18 // Sensible default
                }));

            if (newCharges.length === 0) return prev;

            return {
                ...prev,
                chargesByVendor: {
                    ...(prev.chargesByVendor || {}),
                    [vendorId]: [...existingCharges, ...newCharges],
                },
            };
        });
    }, [setRfqFormData]);

    const handleUpdateCharge = useCallback((vendorId: string, chargeIndex: number, updatedCharge: ChargeItem) => {
        setRfqFormData(prev => {
            const vendorCharges = prev.chargesByVendor?.[vendorId] || [];
            if (!vendorCharges[chargeIndex]) return prev; // Safety check

            const newVendorCharges = [...vendorCharges];
            newVendorCharges[chargeIndex] = updatedCharge;

            return {
                ...prev,
                chargesByVendor: {
                    ...(prev.chargesByVendor || {}),
                    [vendorId]: newVendorCharges,
                },
            };
        });
    }, [setRfqFormData]);

    const handleDeleteCharge = useCallback((vendorId: string, chargeIndex: number) => {
        setRfqFormData(prev => {
            const vendorCharges = prev.chargesByVendor?.[vendorId] || [];
            const newVendorCharges = vendorCharges.filter((_, index) => index !== chargeIndex);

            const newChargesByVendor = { ...(prev.chargesByVendor || {}) };
            if (newVendorCharges.length > 0) {
                newChargesByVendor[vendorId] = newVendorCharges;
            } else {
                delete newChargesByVendor[vendorId]; // Clean up if no charges left for vendor
            }

            return {
                ...prev,
                chargesByVendor: newChargesByVendor,
            };
        });
    }, [setRfqFormData]);


// Add these new handlers to the return object

    const resetRFQForm = useCallback(() => {
        setRfqFormData(initialRFQDataState);
        setFinalSelectedQuotes(new Map());
        localStorage.removeItem(`rfqDraft_${docId}`);
    }, [docId, setRfqFormData]);


    return {
        rfqFormData,
         onAddCharges: handleAddCharges,
    onUpdateCharge: handleUpdateCharge,
    onDeleteCharge: handleDeleteCharge,
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
