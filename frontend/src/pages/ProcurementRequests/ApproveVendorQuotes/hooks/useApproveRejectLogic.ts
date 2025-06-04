import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from "@/components/ui/use-toast"; // Adjust path
import { ProcurementRequestItemDetail } from "@/types/NirmaanStack/ProcurementRequests"; // Adjust path
import { Vendors } from "@/types/NirmaanStack/Vendors"; // Adjust path
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers"; // Adjust path
// import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations"; // Adjust path
import {
    ApproveQuotesPRDoc, // Use the new PR doc type for this flow
    VendorItemDetailsToDisplay,
    VendorGroupForTable, // Renamed from VendorDataSourceItem for clarity
    SelectionState,
    TargetRateDetailFromAPI, // Keep for map key
    FrappeTargetRateApiResponse, // Keep for API call
    mapApiQuotesToApprovedQuotations,
    ApprovedQuotationForHoverCard
} from '../types';
import { ApprovePayload, SendBackPayload, useQuoteApprovalApi } from './useQuoteApprovalApi';
import { v4 as uuidv4 } from "uuid";
import { useFrappeGetCall } from 'frappe-react-sdk';
import getLowestQuoteFilled from '@/utils/getLowestQuoteFilled';
import { parseNumber } from '@/utils/parseNumber';
// import getThreeMonthsLowestFiltered from '@/utils/getThreeMonthsLowest';

// --- Define TypeScript Interfaces for the new API response ---
// (These should match what you defined previously based on your custom API)
// interface ApiSelectedQuotation { // Child item from Target Rates
//     name: string;
//     item_id?: string | null;
//     item_name?: string | null;
//     vendor_name?: string | null;
//     procurement_order?: string | null;
//     unit?: string | null;
//     quantity?: string | null;
//     quote?: string | null;
//     city?: string | null;
//     state?: string | null;
//     category?: string | null;
//     procurement_package?: string | null;
//     make?: string | null;
//     dispatch_date?: string | null;
//     idx: number;
//     // Add other fields as returned by your API for selected_quotations_items
// }

// interface TargetRateDetailFromAPI { // Parent Target Rate info from API
//     name: string; // Target Rate docname
//     item_name?: string | null;
//     unit?: string | null;
//     rate?: string | null; // This is the target rate value
//     item_id?: string | null; // This is the key to match with ProcurementItem.name
//     creation?: string;
//     modified?: string;
//     selected_quotations_items: ApiSelectedQuotation[];
// }

// interface FrappeTargetRateApiResponse { // Typical Frappe API response structure
//     message: TargetRateDetailFromAPI[];
// }
// --- End API response interfaces ---

// Define Props
interface UseApproveRejectLogicProps {
    prId?: string;
    initialPrData?: ApproveQuotesPRDoc;
    vendorList?: Vendors[];
    // quotesData?: ApprovedQuotations[];
    usersList?: NirmaanUsers[];
    // prMutate: KeyedMutator<FrappeDoc<ApproveQuotesPRDoc>>; // Specific mutator
    prMutate: any
}

// Define Return Type (expose state and handlers needed by View)
export interface UseApproveRejectLogicReturn {
    orderData?: ApproveQuotesPRDoc; // Local copy
    vendorDataSource: VendorGroupForTable[];
    selectionMap: SelectionState;
    isApproveDialogOpen: boolean;
    isSendBackDialogOpen: boolean;
    comment: string;
    isLoading: boolean; // Combined loading state for actions
    isPrEditable: boolean; // Can the user approve/reject?
    targetRatesDataMap: Map<string, TargetRateDetailFromAPI>; // Expose this for VendorApprovalTable

    handleSelectionChange: (newSelection: SelectionState) => void;
    handleCommentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    toggleApproveDialog: () => void;
    toggleSendBackDialog: () => void;
    handleApproveConfirm: () => Promise<void>;
    handleSendBackConfirm: () => Promise<void>;
    getVendorName: (vendorId: string | undefined) => string; // Pass down if needed by view/table
    getUserName: (userId: string | undefined) => string; // Pass down if needed by view/table
    // Include any other state/handlers needed by the View
}

export const useApproveRejectLogic = ({
    prId,
    initialPrData,
    vendorList = [],
    usersList = [],
    prMutate,
}: UseApproveRejectLogicProps): UseApproveRejectLogicReturn => {
    const { toast } = useToast();
    const navigate = useNavigate();
    const { approveSelection, sendBackSelection, rejectCustomPr, isLoading: isActionApiLoading } = useQuoteApprovalApi(prId);

    // --- State ---
    const [orderData, setOrderData] = useState<ApproveQuotesPRDoc | undefined>(initialPrData);
    const [selectionMap, setSelectionMap] = useState<SelectionState>(new Map());

    const [isApproveDialogOpen, setApproveDialog] = useState<boolean>(false);
    const [isSendBackDialogOpen, setSendBackDialog] = useState<boolean>(false);
    const [comment, setComment] = useState<string>("");

    // --- State for the new API call ---
    const [itemIdsForTargetRateAPI, setItemIdsForTargetRateAPI] = useState<string[]>([]);

    // --- Effects ---
    // Initialize local state and parse JSON fields safely
    // useEffect(() => {
    //     if (initialPrData) {
    //         try {
    //             // Filter only 'Pending' items for this view's list
    //             const pendingItems = (typeof initialPrData.procurement_list === "string" ? JSON.parse(initialPrData.procurement_list)?.list : initialPrData.procurement_list?.list || [])
    //                 .filter((item: ProcurementItem) => item.status === 'Pending');

    //             // Safe parsing of RFQ data
    //             let parsedRfqData: RFQData = { selectedVendors: [], details: {} }; // Default empty
    //             if (initialPrData.rfq_data && typeof initialPrData.rfq_data === 'object') {
    //                 parsedRfqData = initialPrData.rfq_data; // Assume already object if not string
    //             } else if (typeof initialPrData.rfq_data === 'string') {
    //                 parsedRfqData = JSON.parse(initialPrData.rfq_data || "{}");
    //             }

    //             setOrderData({
    //                 ...initialPrData,
    //                 procurement_list: { list: pendingItems },
    //                 rfq_data: parsedRfqData,
    //                 // category_list might not be needed directly if grouping by vendor
    //             });

    //             // Extract item_ids (assuming item.name in ProcurementItem is the item_id)
    //             const ids = pendingItems.map((item: ProcurementItem) => item.name).filter(id => !!id);
    //             setItemIdsForTargetRateAPI(ids as string[]);
    //         } catch (error) {
    //             console.error("Error processing initial PR data:", error);
    //             toast({ title: "Error", description: "Failed to load PR details.", variant: "destructive" });
    //             setOrderData(undefined); // Reset on error
    //             setItemIdsForTargetRateAPI([]);
    //         }
    //     } else {
    //         setOrderData(undefined); // Reset if initialPrData is undefined
    //         setItemIdsForTargetRateAPI([]);
    //     }
    // }, [initialPrData, toast]);

    // Effect to initialize/update local state when initialPrData changes
    useEffect(() => {
        if (initialPrData) {
            let processedPrData = { ...initialPrData };

            // Ensure order_list is an array
            processedPrData.order_list = Array.isArray(initialPrData.order_list) ? initialPrData.order_list : [];
            
            // Parse RFQData if it's a string
            if (typeof initialPrData.rfq_data === 'string') {
                try {
                    processedPrData.rfq_data = JSON.parse(initialPrData.rfq_data || 'null') || { selectedVendors: [], details: {} };
                } catch (e) {
                    console.error("Error parsing initialPrData.rfq_data", e);
                    processedPrData.rfq_data = { selectedVendors: [], details: {} };
                }
            } else if (!initialPrData.rfq_data) { // Ensure it's an object if null/undefined
                processedPrData.rfq_data = { selectedVendors: [], details: {} };
            }
            
            setOrderData(processedPrData);

            // Filter for "Pending" items from the new order_list to fetch target rates
            const pendingItemIds = (processedPrData.order_list || [])
                .filter((item: ProcurementRequestItemDetail) => item.status === 'Pending' && item.item_id)
                .map((item: ProcurementRequestItemDetail) => item.item_id!); // item_id is not optional
            setItemIdsForTargetRateAPI(pendingItemIds);

        } else {
            setOrderData(undefined);
            setItemIdsForTargetRateAPI([]);
        }
    }, [initialPrData]);

    // --- Fetch Target Rates using the new custom API ---
    const {
        data: targetRatesApiResponse,
        isLoading: targetRatesLoading,
        error: targetRatesError
    } = useFrappeGetCall<FrappeTargetRateApiResponse>(
        'nirmaan_stack.api.target_rates.get_target_rates_for_item_list.get_target_rates_for_item_list', // YOUR_CUSTOM_APP_NAME.api_module.function_name
        {
            item_ids_json: itemIdsForTargetRateAPI.length > 0 ? JSON.stringify(itemIdsForTargetRateAPI) : undefined,
            // order_by: "item_id asc" // Optional: if your API supports it and it's beneficial
        },
        // SWR Key: make it dependent on itemIds to refetch if they change
        itemIdsForTargetRateAPI.length > 0 ? `target_rates_for_items_${itemIdsForTargetRateAPI.sort().join('_')}` : null,
        {
            revalidateOnFocus: false, // Or your preferred SWR config
            // enabled: itemIdsForTargetRateAPI.length > 0, // SWR fetches if key is not null
        }
    );

    const targetRatesDataMap = useMemo(() => {
        const map = new Map<string, TargetRateDetailFromAPI>();
        if (targetRatesApiResponse?.message) {
            targetRatesApiResponse.message.forEach(tr => {
                if (tr.item_id) { // Ensure item_id exists for mapping
                    map.set(tr.item_id, tr);
                }
            });
        }
        return map;
    }, [targetRatesApiResponse]);

    useEffect(() => {
        if (targetRatesError) {
            console.error("Error fetching target rates from custom API:", targetRatesError);
            toast({ title: "Target Rate API Error", description: "Could not fetch target rates.", variant: "destructive" });
        }
    }, [targetRatesError, toast]);

    const isLoading = isActionApiLoading || targetRatesLoading; // Combined loading state

    // --- Memos ---
    const vendorMap = useMemo(() => new Map(vendorList.map(v => [v.name, v.vendor_name])), [vendorList]);

    const getVendorName = useCallback((id: string | undefined) => id ? vendorMap.get(id) || `Unknown (${id.substring(0, 6)})` : "N/A", [vendorMap]);

    const getUserName = useCallback((id: string | undefined) => id ? usersList.find(u => u?.name === id)?.full_name || `Unknown (${id.substring(0, 6)})` : "N/A", [usersList]);

    // Memoize lowest quote lookups (assuming functions are pure)
    const getLowestForItemInRFQ = useCallback((itemId: string) => getLowestQuoteFilled(orderData, itemId), [orderData]);

    // const getItemAvgRateAndAttributes = useCallback((itemId: string) => getThreeMonthsLowestFiltered(quotesData, itemId), [quotesData]);

    // Memoize vendor totals calculation
    // const vendorTotals = useMemo(() => {
    //     const totals: { [vendorId: string]: number } = {};
    //     orderData?.procurement_list?.list?.forEach(item => {
    //         if (!item.vendor) return;
    //         totals[item.vendor] = (totals[item.vendor] || 0) + (item.quote ?? 0) * (item.quantity ?? 0);
    //     });
    //     return totals;
    // }, [orderData?.procurement_list.list]);

    // // Memoize the final vendor-wise data transformation
    // const vendorDataSource = useMemo((): VendorDataSourceItem[] => {
    //     const data: VendorWiseData = {};
    //     orderData?.procurement_list?.list?.forEach(item => {
    //         if (!item.vendor) return;
    //         const vendorId = item.vendor;
    //         const vendorName = getVendorName(vendorId);
    //         const amount = (item.quote ?? 0) * (item.quantity ?? 0);
    //         // const threeMonthsLowest = getItemAvgRateAndAttributes(item.name)?.averageRate * 0.98;
    //         // const contributingQuotes = getItemAvgRateAndAttributes(item.name)?.contributingQuotes;
    //         const lowestQuoted = getLowest(item.name) ?? 0;

    //         // Get target rate info from the new API data
    //         const targetRateDetail = targetRatesDataMap.get(item.name); // item.name is item_id

    //         let currentTargetRate: number = -1;
    //         let currentContributingQuotes: ApiSelectedQuotation[] = [];

    //         if (targetRateDetail && targetRateDetail.rate && targetRateDetail.rate.trim() !== "") {
    //             const parsedRate = parseFloat(targetRateDetail.rate);
    //             if (!isNaN(parsedRate)) {
    //                 currentTargetRate = parsedRate;
    //             }
    //         }
    //         if (targetRateDetail && targetRateDetail.selected_quotations_items) {
    //             currentContributingQuotes = targetRateDetail.selected_quotations_items;
    //         }

    //         // Adapt ApiSelectedQuotation to the structure expected by HistoricalQuotesHoverCard if needed
    //         // For now, assuming it's compatible with `ApprovedQuotations` type or the hover card is flexible
    //         const adaptedContributingQuotes = currentContributingQuotes.map(cq => ({
    //             // Explicit mapping for clarity and type safety
    //             name: cq.name,
    //             item_id: cq.item_id,
    //             item_name: cq.item_name,
    //             vendor_name: cq.vendor_name, // Pass along if available
    //             vendor: cq.vendor_name, // Assuming vendor_name can be used for 'vendor' if needed
    //             procurement_order: cq.procurement_order,
    //             quote: cq.quote,
    //             rate: cq.quote, // If 'rate' is expected and 'quote' is the source
    //             quantity: cq.quantity,
    //             unit: cq.unit,
    //             dispatch_date: cq.dispatch_date, // <--- MAP THE dispatch_date
    //             make: cq.make,
    //             city: cq.city,
    //             state: cq.state,
    //             category: cq.category,
    //             procurement_package: cq.procurement_package,
    //             idx: cq.idx,
    //         })) as ApprovedQuotations[]; // Cast to ApprovedQuotations
    //         // Note: This cast assumes the mapping makes ApiSelectedQuotation compatible.
    //         // Review `ApprovedQuotations` type from `src/types/NirmaanStack/ApprovedQuotations.ts`
    //         // and ensure all fields expected by HistoricalQuotesHoverCard are correctly mapped or defaulted.

    //         const itemDetails: VendorItemDetails = {
    //             ...item,
    //             vendor_name: vendorName,
    //             amount,
    //             lowestQuotedAmount: lowestQuoted * (item.quantity ?? 0),
    //             targetRate: currentTargetRate, // Use the rate from API or -1
    //             contributingQuotes: adaptedContributingQuotes,
    //             targetAmount: currentTargetRate !== -1 ? currentTargetRate * (item.quantity ?? 0) : undefined, // Undefined if target rate is -1
    //             // Calculate saving/loss based on comparison (e.g., lowest vs selected)
    //             savingLoss: ((lowestQuoted || (currentTargetRate !== -1 ? currentTargetRate : undefined)) && item.quote)
    //                 ? (
    //                     (
    //                         (lowestQuoted && currentTargetRate !== -1)
    //                             ? Math.min(lowestQuoted, currentTargetRate)
    //                             : (lowestQuoted || (currentTargetRate !== -1 ? currentTargetRate : 0))
    //                     ) - (item.quote ?? 0)
    //                 ) * (item.quantity ?? 0)
    //                 : undefined,
    //         };

    //         if (!data[vendorId]) {
    //             data[vendorId] = {
    //                 totalAmount: vendorTotals[vendorId] || 0,
    //                 key: uuidv4(),
    //                 items: [],
    //             };
    //         }
    //         data[vendorId].items.push(itemDetails);
    //     });

    //     // Calculate potential total saving/loss per vendor
    //     Object.values(data).forEach(vendorGroup => {
    //         vendorGroup.potentialSavingLoss = vendorGroup.items.reduce((sum, item) => sum + (item.savingLoss ?? 0), 0);
    //     });

    //     return Object.entries(data)
    //         .sort(([idA], [idB]) => (getVendorName(idA)).localeCompare(getVendorName(idB)))
    //         .map(([vendorId, groupData]) => ({
    //             key: groupData.key,
    //             vendorId,
    //             vendorName: getVendorName(vendorId),
    //             totalAmount: groupData.totalAmount,
    //             items: groupData.items,
    //             potentialSavingLoss: groupData.potentialSavingLoss, // Add calculated total saving/loss
    //         }));
    // }, [orderData?.procurement_list.list, getVendorName, getLowest, vendorTotals, targetRatesDataMap]);


    const vendorDataSource = useMemo((): VendorGroupForTable[] => {
        const vendorWiseData: Record<string, Omit<VendorGroupForTable, 'vendorId' | 'vendorName'>> = {};
        
        if (!orderData?.order_list || !orderData.rfq_data?.details) {
            return [];
        }
        const rfqDetails = orderData.rfq_data.details;

        orderData.order_list.forEach((prItem: ProcurementRequestItemDetail) => {
            if (prItem.status !== 'Pending') return; // Only process pending items for quote approval

            const itemId = prItem.item_id;
            const itemRfqDetail = rfqDetails[itemId]; // RFQ details for this item
            if (!itemRfqDetail?.vendorQuotes) return;

            Object.entries(itemRfqDetail.vendorQuotes).forEach(([vendorId, quoteDetail]) => {
                if (!vendorWiseData[vendorId]) {
                    vendorWiseData[vendorId] = { totalAmount: 0, items: [], key: uuidv4() };
                }

                const quantity = parseNumber(prItem.quantity);
                const rate = parseNumber(quoteDetail.quote);
                const amount = quantity * rate;

                const targetRateDetail = targetRatesDataMap.get(itemId);
                const targetRateValue = targetRateDetail?.rate ? parseNumber(targetRateDetail.rate) : undefined;
                const lowestQuotedInRFQ = getLowestForItemInRFQ(itemId); // Lowest among current RFQ quotes for this item

                const displayItem: VendorItemDetailsToDisplay = {
                    ...prItem, // Spread all fields from ProcurementRequestItemDetail
                    vendor_name: getVendorName(vendorId), // Will be overridden if item already has a selected vendor
                    amount: amount,
                    lowestQuotedAmountForItem: lowestQuotedInRFQ ? lowestQuotedInRFQ * quantity : undefined,
                    targetRate: targetRateValue,
                    targetAmount: targetRateValue ? targetRateValue * quantity * 0.98 : undefined, // Apply 0.98 factor
                    contributingHistoricalQuotes: targetRateDetail ? mapApiQuotesToApprovedQuotations(targetRateDetail.selected_quotations_items || []) as ApprovedQuotationForHoverCard[] : [],
                    savingLoss: undefined, // Recalculate saving/loss
                };

                if (displayItem.targetAmount && !isNaN(amount)) {
                     displayItem.savingLoss = displayItem.targetAmount - amount;
                } else if (lowestQuotedInRFQ > 0 && !isNaN(amount)) {
                     displayItem.savingLoss = (lowestQuotedInRFQ * quantity) - amount;
                }


                vendorWiseData[vendorId].items.push(displayItem);
                vendorWiseData[vendorId].totalAmount += amount;
            });
        });
        
        return Object.entries(vendorWiseData)
            .map(([vendorId, groupData]) => {
                const totalPotentialSavingLoss = groupData.items.reduce((sum, item) => sum + (item.savingLoss || 0), 0);
                return {
                    vendorId,
                    vendorName: getVendorName(vendorId),
                    ...groupData,
                    potentialSavingLossForVendor: totalPotentialSavingLoss,
                };
            })
            .sort((a, b) => a.vendorName.localeCompare(b.vendorName));

    }, [orderData, getVendorName, getLowestForItemInRFQ, targetRatesDataMap, vendorMap]); // Removed vendorTotals as it's calculated within


    // --- Callbacks ---
    const handleSelectionChange = useCallback((newSelection: SelectionState) => {
        setSelectionMap(newSelection);
    }, []);

    const handleCommentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setComment(e.target.value);
    }, []);

    const toggleApproveDialog = useCallback(() => setApproveDialog(prev => !prev), []);
    const toggleSendBackDialog = useCallback(() => setSendBackDialog(prev => !prev), []);

    const handleApproveConfirm = useCallback(async () => {
        if (!orderData || selectionMap.size === 0) {
            toast({ title: "No Selection", description: "Please select items to approve.", variant: "destructive" });
            return;
        }

        const selectedItemsForPayload: string[] = [];
        const vendorSelectionMap: { [itemId: string]: string } = {};

        // Flatten the selection map
        selectionMap.forEach((itemSet, vendorId) => {
            itemSet.forEach(itemId => {
                selectedItemsForPayload.push(itemId);
                vendorSelectionMap[itemId] = vendorId; // Map item name to its selected vendor
            });
        });

        if (selectedItemsForPayload.length === 0) {
            toast({ title: "No Selection", description: "No valid items found in selection.", variant: "destructive" });
            return;
        }


        try {
            const payload: ApprovePayload = {
                project_id: orderData.project,
                pr_name: orderData.name,
                selected_items: selectedItemsForPayload,
                selected_vendors: vendorSelectionMap,
                custom: !orderData.work_package, // Flag if it's a custom PR
            };

            const response = await approveSelection(payload);

            if (response?.message?.status === 200) {
                toast({ title: "Success!", description: response.message.message || "Items approved successfully.", variant: "success" });
                setSelectionMap(new Map()); // Clear selection
                toggleApproveDialog();
                await prMutate(); // Re-fetch PR data
                // Navigate only if all items were approved or if custom PR
                const allItems = orderData.order_list.map(i => i.item_id);
                if (!orderData.work_package || selectedItemsForPayload.length === allItems.length) {
                    navigate('/purchase-orders?tab=Approve PO'); // Or appropriate destination
                }
            } else {
                throw new Error(response?.message?.error || "Approval failed with unknown error.");
            }
        } catch (error: any) {
            console.error("Error approving selection:", error);
            toast({ title: "Approval Failed!", description: error?.message || "An error occurred during approval.", variant: "destructive" });
        }
    }, [orderData, selectionMap, approveSelection, prMutate, navigate, toggleApproveDialog, toast]);


    const handleSendBackConfirm = useCallback(async () => {
        if (!orderData) return;

        // Handle custom PR rejection separately
        if (!orderData.work_package) {
            try {
                await rejectCustomPr(comment);
                toast({ title: "Success!", description: "Custom PR rejected successfully.", variant: "success" });
                toggleSendBackDialog();
                setComment("");
                await prMutate(); // Re-fetch
                navigate('/purchase-orders?tab=Approve PO'); // Adjust navigation
            } catch (error: any) {
                console.error("Error rejecting custom PR:", error);
                toast({ title: "Rejection Failed!", description: error?.message || "Could not reject custom PR.", variant: "destructive" });
            }
            return; // Exit function
        }

        // Standard PR send back logic
        if (selectionMap.size === 0) {
            toast({ title: "No Selection", description: "Please select items to send back.", variant: "destructive" });
            return;
        }

        const selectedItemsForPayload: string[] = [];
        selectionMap.forEach((itemSet) => {
            itemSet.forEach(itemId => {
                selectedItemsForPayload.push(itemId);
            });
        });

        if (selectedItemsForPayload.length === 0) {
            toast({ title: "No Selection", description: "No valid items found in selection.", variant: "destructive" });
            return;
        }


        try {
            const payload: SendBackPayload = {
                project_id: orderData.project,
                pr_name: orderData.name,
                selected_items: selectedItemsForPayload,
                comments: comment || undefined, // Send comment only if not empty
            };

            const response = await sendBackSelection(payload);

            if (response?.message?.status === 200) {
                toast({ title: "Success!", description: response.message.message || "Selected items sent back successfully.", variant: "success" });
                setSelectionMap(new Map()); // Clear selection
                toggleSendBackDialog();
                setComment(""); // Clear comment
                await prMutate(); // Re-fetch PR data
                // Navigate only if all items were sent back
                const allItems = orderData.order_list.map(i => i.item_id);
                if (selectedItemsForPayload.length === allItems.length) {
                    navigate('/purchase-orders?tab=Approve PO'); // Or appropriate destination
                }
            } else {
                throw new Error(response?.message?.error || "Send back failed with unknown error.");
            }
        } catch (error: any) {
            console.error("Error sending back selection:", error);
            toast({ title: "Send Back Failed!", description: error?.message || "An error occurred while sending back items.", variant: "destructive" });
        }
    }, [orderData, selectionMap, comment, sendBackSelection, rejectCustomPr, prMutate, navigate, toggleSendBackDialog, toast]);

    // Determine if actions should be enabled
    const isPrEditable = useMemo(() => {
        return ["Vendor Selected", "Partially Approved"].includes(orderData?.workflow_state || "");
    }, [orderData?.workflow_state]);


    // --- Return ---
    return {
        orderData,
        vendorDataSource,
        selectionMap,
        isApproveDialogOpen,
        isSendBackDialogOpen,
        comment,
        isLoading,
        isPrEditable,
        targetRatesDataMap,

        handleSelectionChange,
        handleCommentChange,
        toggleApproveDialog,
        toggleSendBackDialog,
        handleApproveConfirm,
        handleSendBackConfirm,
        getVendorName,
        getUserName
    };
};