import { useState, useEffect, useCallback, useMemo } from 'react';
import { RFQData, ProcurementItem } from '@/types/NirmaanStack/ProcurementRequests'; // Adjust path
import { VendorOption, ProgressDocumentType, getItemListFromDocument } from '../types'; // Local feature types
import { usePersistentState } from './usePersistentState'; // Your hook

const initialRFQData: RFQData = {
    selectedVendors: [],
    details: {},
};

export const useRFQFormManager = (
    prId: string,
    initialDocumentData?: ProgressDocumentType // PR or SBC
) => {
    const [formData, setFormData] = usePersistentState<RFQData>(`procurementDraft_${prId}`, initialRFQData);
    const [selectedVendorQuotes, setSelectedVendorQuotes] = useState<Map<string, string>>(() => new Map()); // item.name -> vendor.name

    // Initialize/Re-initialize formData.details based on items in the document
    useEffect(() => {
        if (initialDocumentData) {
            const items = getItemListFromDocument(initialDocumentData);
            const categoryMap = new Map(initialDocumentData.category_list?.list?.map(cat => [cat.name, cat.makes || []]));

            // Sync selectedVendors from document's rfq_data if draft is empty
            if (formData.selectedVendors.length === 0 && initialDocumentData.rfq_data?.selectedVendors?.length > 0) {
                setFormData(prev => ({ ...prev, selectedVendors: initialDocumentData.rfq_data.selectedVendors }));
            }

            // Sync details: Initialize if empty, but don't overwrite existing draft quotes
            const newDetails = { ...(formData.details || {}) }; // Start with existing draft details
            let detailsChanged = false;
            items.forEach(item => {
                if (!newDetails[item.name]) { // Only initialize if not in draft details
                    const defaultMakes = categoryMap.get(item.category) ?? [];
                    newDetails[item.name] = {
                        initialMake: item.make, // Capture initial make from item
                        vendorQuotes: {},
                        makes: defaultMakes,
                    };
                    detailsChanged = true;
                } else { // If item exists in draft, ensure its 'makes' are up-to-date if category's makes changed
                    const currentMakesInDraft = newDetails[item.name].makes;
                    const categoryMakes = categoryMap.get(item.category) ?? [];
                    if (JSON.stringify(currentMakesInDraft) !== JSON.stringify(categoryMakes)) {
                        newDetails[item.name].makes = categoryMakes;
                        detailsChanged = true;
                    }
                }
            });

            if (detailsChanged) {
                setFormData(prev => ({ ...prev, details: newDetails }));
            }

            // Initialize selectedVendorQuotes from the document's items if the map is empty
            if (selectedVendorQuotes.size === 0) {
                const initialSelectionMap = new Map<string, string>();
                items.forEach(item => {
                    if ('vendor' in item && item.vendor) { // Check if item has a vendor property
                        initialSelectionMap.set(item.name, item.vendor);
                    }
                });
                if (initialSelectionMap.size > 0) {
                    setSelectedVendorQuotes(initialSelectionMap);
                }
            }
        }
    }, [initialDocumentData, prId]); // Rerun when fetched doc changes or prId (for new draft key)

    const handleAddVendorsToRFQ = useCallback((newVendors: VendorOption[]) => {
        setFormData(prev => ({
            ...prev,
            selectedVendors: [...prev.selectedVendors, ...newVendors.filter(nv => !prev.selectedVendors.find(sv => sv.value === nv.value))]
        }));
    }, [setFormData]);

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
        setFormData(prev => {
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
    }, [setFormData]);

    const handleMakeChange = useCallback((itemId: string, vendorId: string, make: string) => {
        setFormData(prev => {
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

    const resetRFQForm = useCallback(() => {
        setFormData(initialRFQData);
        setSelectedVendorQuotes(new Map());
        localStorage.removeItem(`procurementDraft_${prId}`);
    }, [prId, setFormData]);


    return {
        formData,
        setFormData, // Expose if direct manipulation is needed, but prefer handlers
        selectedVendorQuotes,
        setSelectedVendorQuotes, // Expose for direct manipulation if needed
        handleAddVendorsToRFQ,
        handleDeleteVendorFromRFQ,
        handleQuoteChange,
        handleMakeChange,
        handleVendorQuoteSelectionForItem,
        resetRFQForm,
    };
};