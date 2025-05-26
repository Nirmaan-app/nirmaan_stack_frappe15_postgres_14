// src/features/procurement/progress/hooks/useProcurementProgressLogic.ts
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast, useToast } from "@/components/ui/use-toast"; // Adjust path
import { Vendor } from "@/pages/ServiceRequests/service-request/select-service-vendor"; // Adjust path
import { ProcurementRequest, RFQData, ProcurementItem } from "@/types/NirmaanStack/ProcurementRequests"; // Adjust path
import { Vendors } from "@/types/NirmaanStack/Vendors"; // Adjust path
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers"; // Adjust path
import { parseNumber } from "@/utils/parseNumber"; // Adjust path
import { usePersistentState } from './usePersistentState'; // Adjust path
import { useProcurementUpdates } from './useProcurementUpdates';
import { KeyedMutator } from 'swr'; // Import if using specific mutate type
import { FrappeDoc } from 'frappe-react-sdk'; // Import if using specific mutate type
import { useFrappeGetCall } from 'frappe-react-sdk'; // Added
// Import the necessary types and mapping function
import { TargetRateDetailFromAPI, FrappeTargetRateApiResponse, mapApiQuotesToApprovedQuotations } from '../../ApproveNewPR/types'; // Adjust path if needed


// Define the props the hook expects
interface UseProcurementProgressLogicProps {
    prId: string;
    // Pass fetched data (can be undefined initially)
    initialProcurementRequest?: ProcurementRequest;
    vendors?: Vendors[];
    usersList?: NirmaanUsers[];
    // Pass the specific mutate function for the PR doc
    prMutate: KeyedMutator<FrappeDoc<ProcurementRequest>> | (() => Promise<any>);
}

// Define the state and handlers returned by the hook
interface UseProcurementProgressLogicReturn {
    mode: string;
    orderData?: ProcurementRequest;
    formData: RFQData;
    selectedVendorQuotes: Map<string, string>; // item.name -> vendor.name
    isRedirecting: string;
    isLoading: boolean; // Combined loading state (primarily update loading)
    isAddVendorsDialogOpen: boolean;
    isRevertDialogOpen: boolean;
    isVendorSheetOpen: boolean;
    selectedVendorsForDialog: Vendor[]; // State for multi-select in dialog
    vendorOptionsForDialog: Vendor[]; // Filtered options for dialog
    handleModeChange: (newMode: string) => Promise<void>;
    handleAddVendors: (selected: Vendor[]) => void; // Renamed for clarity
    handleConfirmAddVendors: () => void;
    handleDeleteVendor: (vendorId: string) => void; // Added handler
    handleQuoteChange: (itemId: string, vendorId: string, quote: string) => void;
    handleMakeChange: (itemId: string, vendorId: string, make: string) => void;
    handleVendorQuoteSelection: (itemId: string, vendorId: string | null) => void;
    handleReviewChanges: () => Promise<void>;
    handleRevertPR: () => Promise<void>;
    toggleAddVendorsDialog: () => void;
    toggleRevertDialog: () => void;
    toggleVendorSheet: () => void;
    getFullName: (id: string | undefined) => string;
    canContinueToReview: boolean; // Derived state
    targetRatesDataMap: Map<string, TargetRateDetailFromAPI>; // ADDED
    isLoading: boolean; // Combined loading state
}

export const useProcurementProgressLogic = ({
    prId,
    initialProcurementRequest,
    vendors = [], // Default to empty array
    usersList = [], // Default to empty array
    prMutate,
}: UseProcurementProgressLogicProps): UseProcurementProgressLogicReturn => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // === State Management ===
    const [mode, setMode] = useState(() => searchParams.get("mode") || "edit");
    // Local copy of PR data, initialized from fetched data
    const [orderData, setOrderData] = useState<ProcurementRequest | undefined>(initialProcurementRequest);
    // Persistent state for RFQ form data draft
    const [formData, setFormData] = usePersistentState<RFQData>(`procurementDraft_${prId}`, {
        selectedVendors: [],
        details: {},
    });
    // Map to track which vendor's quote is selected *per item*
    const [selectedVendorQuotes, setSelectedVendorQuotes] = useState<Map<string, string>>(() => new Map());
    // State for dialogs/sheets
    const [isAddVendorsDialogOpen, setAddVendorsDialog] = useState(false);
    const [isRevertDialogOpen, setRevertDialog] = useState(false);
    const [isVendorSheetOpen, setIsVendorSheetOpen] = useState(false);
    const [selectedVendorsForDialog, setSelectedVendorsForDialog] = useState<Vendor[]>([]); // For multi-select temp storage
    // State for redirection loading indicator
    const [isRedirecting, setIsRedirecting] = useState<string>("");

    // === Hooks ===
    const { updateProcurementData, loading: updateLoading } = useProcurementUpdates({ prId, prMutate });
    const { toast } = useToast(); // Get toast function

    console.log("initialProcurementRequest", initialProcurementRequest)

    // === Effects ===
    // Initialize/Update local orderData when fetched data changes
    useEffect(() => {
        if (initialProcurementRequest) {
            setOrderData({
                ...initialProcurementRequest,
                procurement_list: typeof initialProcurementRequest.procurement_list === "string" ? JSON.parse(initialProcurementRequest.procurement_list) : initialProcurementRequest.procurement_list,
            });

            // Initialize selectedVendorQuotes Map from initial PR data if not already set by draft
            const initialSelectionMap = new Map<string, string>();
            let draftUsedSelection = false;
            initialProcurementRequest.procurement_list?.list?.forEach(item => {
                // Check if this item exists in the draft's selectedVendorQuotes logic (if applicable)
                // For now, directly use the vendor field from the fetched data
                if (item.vendor) {
                    initialSelectionMap.set(item.name, item.vendor);
                    // If you want draft to override fetched, load draft's selections here
                    // draftUsedSelection = true; // Flag if draft selections were loaded
                }
            });
            // Only set if draft didn't populate it OR if you always want fetched data to initialize it
            if (selectedVendorQuotes.size === 0) { // Initialize only if empty
                setSelectedVendorQuotes(initialSelectionMap);
            }


            // Initialize formData from fetched RFQ data if draft is empty
            if (!Object.keys(formData.details || {}).length && initialProcurementRequest.rfq_data && Object.keys(initialProcurementRequest.rfq_data.details || {}).length) {
                setFormData(initialProcurementRequest.rfq_data);
            }
        }
    }, [initialProcurementRequest]); // Rerun when fetched data changes


    // Initialize formData details if empty after orderData is available
    useEffect(() => {
        if (orderData && orderData.procurement_list?.list?.length > 0 && Object.keys(formData.details || {}).length === 0) {
            console.log("Initializing formData details...");
            const newDetails: RFQData['details'] = {};
            const categoryMap = new Map(orderData.category_list?.list?.map(cat => [cat.name, cat.makes || []]));

            orderData.procurement_list.list.forEach((item) => {
                // Use pre-calculated map for efficiency
                const defaultMakes = categoryMap.get(item.category) ?? [];
                newDetails[item.name] = {
                    vendorQuotes: {}, // Start with empty quotes
                    makes: defaultMakes,
                };
            });
            // Use functional update for setFormData
            setFormData(prev => ({ ...prev, details: newDetails }));
        }
    }, [orderData, formData.details, setFormData]); // formData.details dependency is correct here

    // --- NEW: Fetch Target Rates ---
    const itemIdsToFetch = useMemo(() => {
        return orderData?.procurement_list?.list
            ?.map(item => item.name)
            .filter(id => !!id) ?? [];
    }, [orderData?.procurement_list]); // Depend on the list within orderData

    const {
        data: targetRatesApiResponse,
        isLoading: targetRatesLoading,
        error: targetRatesError
    } = useFrappeGetCall<FrappeTargetRateApiResponse>(
        'nirmaan_stack.api.target_rates.get_target_rates_for_item_list.get_target_rates_for_item_list', // Replace with your actual API path
        { item_ids_json: itemIdsToFetch.length > 0 ? JSON.stringify(itemIdsToFetch) : undefined },
        itemIdsToFetch.length > 0 ? `target_rates_for_items_progress_${prId}` : null, // Unique SWR key for this context
        { revalidateOnFocus: false } // Example SWR option
    );

    const targetRatesDataMap = useMemo(() => {
        const map = new Map<string, TargetRateDetailFromAPI>();
        targetRatesApiResponse?.message?.forEach(tr => {
            if (tr.item_id) map.set(tr.item_id, tr);
        });
        return map;
    }, [targetRatesApiResponse]);

    // Log error if target rate fetch fails
    useEffect(() => {
        if (targetRatesError) {
            console.error("Error fetching target rates in useProcurementProgressLogic:", targetRatesError);
            toast({ title: "Error", description: "Could not load target rates.", variant: "destructive" });
        }
    }, [targetRatesError, toast]);
    // --- End Target Rate Fetching ---

    // --- Combined Loading State ---
    const isLoading = updateLoading || targetRatesLoading;

    // === Memos ===
    // Memoize helper function for getting full name
    const getFullName = useMemo(() => {
        const userMap = new Map(usersList.map(user => [user.name, user.full_name]));
        return (id: string | undefined): string => {
            if (!id) return "N/A";
            return userMap.get(id) || id; // Fallback to ID if not found
        };
    }, [usersList]);

    // Memoize vendor options available for adding (not already in formData)
    const vendorOptionsForDialog = useMemo(() => {
        const selectedVendorValues = new Set(formData.selectedVendors.map(v => v.value));
        return vendors
            .filter(v => !selectedVendorValues.has(v.name)) // Filter out already selected
            .map(v => ({ // Map to Vendor type expected by select component
                label: v.vendor_name,
                value: v.name,
                city: v.vendor_city,
                state: v.vendor_state,
            }));
    }, [vendors, formData.selectedVendors]);

    // Derived state to determine if user can proceed to review
    const canContinueToReview = useMemo(() => selectedVendorQuotes.size > 0, [selectedVendorQuotes]);

    // === Callbacks ===
    // Update URL without full page reload
    const updateURL = useCallback((key: string, value: string) => {
        const url = new URL(window.location.href);
        url.searchParams.set(key, value);
        // Use replaceState if you don't want browser history entries for mode changes
        window.history.pushState({}, "", url);
    }, []);

    // Handle mode switching (Edit/View)
    const handleModeChange = useCallback(async (newMode: string) => {
        if (mode === newMode || updateLoading) return;

        // If switching TO view mode from edit, potentially save changes
        if (newMode === "view" && mode === "edit") {
            const currentOrderData = orderData; // Use local state variable
            if (!currentOrderData) return;

            // Check if draft is different from potentially fetched rfq_data
            // NOTE: A deep comparison function would be more robust here
            const hasChanges = JSON.stringify(formData) !== JSON.stringify(currentOrderData.rfq_data || { selectedVendors: [], details: {} });

            if (hasChanges) {
                setIsRedirecting("view_save"); // Indicate saving before view
                try {
                    // Recalculate updatedOrderList based on selections *before* saving
                    const updatedOrderList = currentOrderData.procurement_list?.list?.map((item) => {
                        const selectedVendorId = selectedVendorQuotes.get(item.name);
                        if (selectedVendorId) {
                            const vendorData = formData.details?.[item.name]?.vendorQuotes?.[selectedVendorId];
                            if (vendorData) {
                                return { ...item, vendor: selectedVendorId, quote: parseNumber(vendorData.quote), make: vendorData.make };
                            }
                            return { ...item };
                        } else {
                            const { vendor, quote, make, ...rest } = item;
                            return rest;
                        }
                    }) || [];

                    // Update local state immediately BEFORE saving for responsiveness
                    setOrderData(prev => prev ? { ...prev, procurement_list: { list: updatedOrderList } } : undefined);
                    await updateProcurementData(formData, updatedOrderList, "view"); // Save draft
                    toast({ title: "Draft Saved", description: "Changes saved successfully.", variant: "success" });
                } catch (error) {
                    toast({ title: "Save Failed", description: "Could not save changes before switching mode.", variant: "destructive" });
                    setIsRedirecting("");
                    return; // Prevent mode switch if save fails
                } finally {
                    setIsRedirecting("");
                }
            }
        }

        setMode(newMode);
        updateURL("mode", newMode);
    }, [mode, updateLoading, orderData, formData, selectedVendorQuotes, updateProcurementData, updateURL, setOrderData, setMode, setIsRedirecting, toast]);


    // Store vendors selected in the dialog temporarily
    const handleAddVendors = useCallback((selected: Vendor[]) => {
        setSelectedVendorsForDialog(selected);
    }, []);

    // Confirm adding vendors from the dialog to the main formData
    const handleConfirmAddVendors = useCallback(() => {
        setFormData(prev => ({
            ...prev,
            selectedVendors: [...prev.selectedVendors, ...selectedVendorsForDialog]
        }));
        setSelectedVendorsForDialog([]); // Clear temp selection
        setAddVendorsDialog(false); // Close dialog
    }, [selectedVendorsForDialog, setFormData]);

    // Handle deleting a vendor from the selected list in formData
    const handleDeleteVendor = useCallback((vendorIdToDelete: string) => {
        setFormData(prev => {
            const newSelectedVendors = prev.selectedVendors.filter(v => v.value !== vendorIdToDelete);
            // Also remove quotes associated with this vendor from details
            const newDetails = { ...prev.details };
            Object.keys(newDetails).forEach(itemId => {
                if (newDetails[itemId]?.vendorQuotes?.[vendorIdToDelete]) {
                    delete newDetails[itemId].vendorQuotes[vendorIdToDelete];
                }
            });
            return { ...prev, selectedVendors: newSelectedVendors, details: newDetails };
        });
        // Also remove from selectedVendorQuotes map if this vendor was selected for any item
        setSelectedVendorQuotes(prevMap => {
            const newMap = new Map(prevMap);
            newMap.forEach((vendorId, itemId) => {
                if (vendorId === vendorIdToDelete) {
                    newMap.delete(itemId);
                }
            });
            return newMap;
        });

    }, [setFormData, setSelectedVendorQuotes]);


    // Update specific quote in formData
    const handleQuoteChange = useCallback((itemId: string, vendorId: string, quote: string) => {
        setFormData(prev => ({
            ...prev,
            details: {
                ...prev.details,
                [itemId]: {
                    ...prev.details?.[itemId],
                    vendorQuotes: {
                        ...prev.details?.[itemId]?.vendorQuotes,
                        [vendorId]: {
                            ...prev.details?.[itemId]?.vendorQuotes?.[vendorId],
                            quote: quote, // Store as string temporarily
                        }
                    }
                }
            }
        }));
    }, [setFormData]);

    // Update specific make in formData
    const handleMakeChange = useCallback((itemId: string, vendorId: string, make: string) => {
        setFormData(prev => ({
            ...prev,
            details: {
                ...prev.details,
                [itemId]: {
                    ...prev.details?.[itemId],
                    vendorQuotes: {
                        ...prev.details?.[itemId]?.vendorQuotes,
                        [vendorId]: {
                            ...prev.details?.[itemId]?.vendorQuotes?.[vendorId],
                            make: make,
                        }
                    }
                }
            }
        }));
    }, [setFormData]);

    useEffect(() => {
        if (defaultMake && !formData?.details?.[item?.name]?.vendorQuotes?.[vendor?.value]?.make) {
            handleMakeChange({ label: defaultMake, value: defaultMake });
        }
    }, [defaultMake, formData, item?.name, vendor?.value]);

    // Select/Deselect a vendor's quote for a specific item
    const handleVendorQuoteSelection = useCallback((itemId: string, vendorId: string | null) => {
        setSelectedVendorQuotes(prevMap => {
            const newMap = new Map(prevMap);
            if (vendorId === null || newMap.get(itemId) === vendorId) {
                // If deselecting (clicking the selected one again) or explicitly passing null
                newMap.delete(itemId);
            } else {
                // Selecting a new vendor for this item
                newMap.set(itemId, vendorId);
            }
            return newMap;
        });
    }, []);

    // Navigate to review page (saves current selections)
    const handleReviewChanges = useCallback(async () => {
        const currentOrderData = orderData;
        if (!currentOrderData || !canContinueToReview) return;

        setIsRedirecting("review_save"); // Indicate saving before navigating

        const updatedOrderList = currentOrderData.procurement_list?.list?.map((item) => {
            const selectedVendorId = selectedVendorQuotes.get(item.name);
            if (selectedVendorId) {
                const vendorData = formData.details?.[item.name]?.vendorQuotes?.[selectedVendorId];
                if (vendorData) {
                    return { ...item, vendor: selectedVendorId, quote: parseNumber(vendorData.quote), make: vendorData.make };
                }
                return { ...item };
            } else {
                const { vendor, quote, make, ...rest } = item;
                return rest;
            }
        }) || [];

        try {
            // Update local state first for perceived speed (optional)
            setOrderData(prev => prev ? { ...prev, procurement_list: { list: updatedOrderList } } : undefined);

            await updateProcurementData(formData, updatedOrderList, "review");

            // Navigate AFTER successful update
            localStorage.removeItem(`procurementDraft_${prId}`); // Clear draft on successful save/review
            navigate(`/procurement-requests/${prId}?tab=In+Progress&mode=review`); // Navigate to review mode

        } catch (error) {
            toast({ title: "Failed to Save", description: "Could not save selections before proceeding.", variant: "destructive" });
        } finally {
            setIsRedirecting("");
        }
    }, [orderData, formData, selectedVendorQuotes, canContinueToReview, updateProcurementData, prId, navigate, toast]);


    // Revert PR changes
    const handleRevertPR = useCallback(async () => {
        const currentOrderData = orderData;
        if (!currentOrderData) return;

        setIsRedirecting("revert");

        const updatedOrderList = currentOrderData.procurement_list?.list?.map((item) => {
            const { vendor, quote, make, ...rest } = item;
            return rest;
        }) || [];

        try {
            // Update local state optimistically
            setOrderData(prev => prev ? {
                ...prev,
                procurement_list: { list: updatedOrderList },
                rfq_data: { selectedVendors: [], details: {} } // Reset RFQ data locally
            } : undefined);
            setFormData({ selectedVendors: [], details: {} }); // Reset draft
            setSelectedVendorQuotes(new Map()); // Reset selections

            await updateProcurementData(null, updatedOrderList, "revert"); // Pass null for RFQ data

            // Navigate AFTER successful update
            localStorage.removeItem(`procurementDraft_${prId}`); // Clear draft
            toast({ title: "Reverted", description: `PR ${prId} reverted successfully.`, variant: "success" });
            toggleRevertDialog(); // Close dialog on success
            // Navigate back to a suitable previous state/list page
            navigate(`/procurement-requests?tab=New%20PR%20Request`); // Or appropriate tab

        } catch (error) {
            toast({ title: "Revert Failed", description: "Could not revert PR changes.", variant: "destructive" });
            // Optionally revert local state changes if API call fails
            setOrderData(currentOrderData); // Restore previous orderData
            // Consider reloading formData/selectedVendorQuotes from currentOrderData if needed
        } finally {
            setIsRedirecting("");
        }
    }, [orderData, updateProcurementData, prId, navigate, setFormData, toast]);

    // Dialog toggles
    const toggleAddVendorsDialog = useCallback(() => setAddVendorsDialog(prev => !prev), []);
    const toggleRevertDialog = useCallback(() => setRevertDialog(prev => !prev), []);
    const toggleVendorSheet = useCallback(() => setIsVendorSheetOpen(prev => !prev), []);

    // === Return Values ===
    return {
        mode,
        orderData,
        formData,
        selectedVendorQuotes,
        isRedirecting,
        isLoading,
        isAddVendorsDialogOpen,
        isRevertDialogOpen,
        isVendorSheetOpen,
        selectedVendorsForDialog,
        vendorOptionsForDialog,
        handleModeChange,
        handleAddVendors,
        handleConfirmAddVendors,
        handleDeleteVendor,
        handleQuoteChange,
        handleMakeChange,
        handleVendorQuoteSelection,
        handleReviewChanges,
        handleRevertPR,
        toggleAddVendorsDialog,
        toggleRevertDialog,
        toggleVendorSheet,
        getFullName,
        canContinueToReview,
        targetRatesDataMap, // <-- Return the map
    };
};