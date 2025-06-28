// Path: frontend/src/pages/ProcurementRequests/ApproveVendorQuotes/hooks/useApproveRejectLogic.ts

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from "@/components/ui/use-toast";
import { ProcurementRequestItemDetail } from "@/types/NirmaanStack/ProcurementRequests"; // Child table type
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import {
    ApproveQuotesPRDoc, // Parent PR Doc type for this flow
    VendorItemDetailsToDisplay,
    VendorGroupForTable,
    SelectionState,
    TargetRateDetailFromAPI,
    FrappeTargetRateApiResponse,
    mapApiQuotesToApprovedQuotations,
    ApprovedQuotationForHoverCard // Ensure this type is correctly defined/imported in ../types
} from '../types'; // Shared types
import { ApprovePayload, SendBackPayload, useQuoteApprovalApi } from './useQuoteApprovalApi';
import { v4 as uuidv4 } from "uuid";
import { useFrappeGetCall } from 'frappe-react-sdk';
import { parseNumber } from '@/utils/parseNumber';
// getLowestQuoteFilled is used for comparison against original RFQ data
import getLowestQuoteFilled from '@/utils/getLowestQuoteFilled';


interface UseApproveRejectLogicProps {
    prId?: string;
    initialPrData?: ApproveQuotesPRDoc;
    vendorList?: Vendors[];
    usersList?: NirmaanUsers[];
    prMutate: any; // SWR mutate function for the PR doc
}

export interface UseApproveRejectLogicReturn {
    orderData?: ApproveQuotesPRDoc;
    vendorDataSource: VendorGroupForTable[];
    selectionMap: SelectionState;
    isApproveDialogOpen: boolean;
    isSendBackDialogOpen: boolean;
    comment: string;
    isLoading: boolean;
    isPrEditable: boolean;
    targetRatesDataMap: Map<string, TargetRateDetailFromAPI>;
    handleSelectionChange: (newSelection: SelectionState) => void;
    handleCommentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    toggleApproveDialog: () => void;
    toggleSendBackDialog: () => void;
    handleApproveConfirm: () => Promise<void>;
    handleSendBackConfirm: () => Promise<void>;
    getVendorName: (vendorId: string | undefined) => string;
    getUserName: (userId: string | undefined) => string;
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

    const [orderData, setOrderData] = useState<ApproveQuotesPRDoc | undefined>(undefined);
    const [selectionMap, setSelectionMap] = useState<SelectionState>(new Map());
    const [isApproveDialogOpen, setApproveDialog] = useState<boolean>(false);
    const [isSendBackDialogOpen, setSendBackDialog] = useState<boolean>(false);
    const [comment, setComment] = useState<string>("");
    const [itemIdsForTargetRateAPI, setItemIdsForTargetRateAPI] = useState<string[]>([]);

    useEffect(() => {
        if (initialPrData) {
            let processedPrData = { ...initialPrData };
            const pendingItems = processedPrData.order_list?.filter(item => item.status === 'Pending') || [];
            processedPrData.order_list = Array.isArray(pendingItems) ? pendingItems : [];

            if (typeof initialPrData.rfq_data === 'string') {
                try {
                    processedPrData.rfq_data = JSON.parse(initialPrData.rfq_data || 'null') || { selectedVendors: [], details: {} };
                } catch (e) {
                    console.error("Error parsing initialPrData.rfq_data", e);
                    processedPrData.rfq_data = { selectedVendors: [], details: {} };
                }
            } else if (!initialPrData.rfq_data) {
                processedPrData.rfq_data = { selectedVendors: [], details: {} };
            }

            setOrderData(processedPrData);

            const pendingItemActualIds = pendingItems
                .filter(item => item.item_id)
                .map(item => item.item_id!);
            setItemIdsForTargetRateAPI(pendingItemActualIds);
        } else {
            setOrderData(undefined);
            setItemIdsForTargetRateAPI([]);
        }
    }, [initialPrData]);

    const {
        data: targetRatesApiResponse,
        isLoading: targetRatesLoading,
        error: targetRatesError
    } = useFrappeGetCall<FrappeTargetRateApiResponse>(
        'nirmaan_stack.api.target_rates.get_target_rates_for_item_list.get_target_rates_for_item_list',
        { item_ids_json: itemIdsForTargetRateAPI.length > 0 ? JSON.stringify(itemIdsForTargetRateAPI) : undefined },
        itemIdsForTargetRateAPI.length > 0 ? `target_rates_for_pr_items_${prId}_${itemIdsForTargetRateAPI.sort().join('_')}` : null,
        { revalidateOnFocus: false }
    );

    const targetRatesDataMap = useMemo(() => {
        const map = new Map<string, TargetRateDetailFromAPI>();
        targetRatesApiResponse?.message?.forEach(tr => {
            if (tr.item_id) map.set(tr.item_id, tr);
        });
        return map;
    }, [targetRatesApiResponse]);

    useEffect(() => {
        if (targetRatesError) {
            toast({ title: "Target Rate API Error", description: "Could not fetch target rates.", variant: "destructive" });
        }
    }, [targetRatesError, toast]);

    const isLoadingHook = isActionApiLoading || targetRatesLoading;

    const vendorMap = useMemo(() => new Map(vendorList.map(v => [v.name, v.vendor_name])), [vendorList]);
    const getVendorName = useCallback((id?: string) => id ? vendorMap.get(id) || `Unknown (${id.substring(0, 6)})` : "N/A", [vendorMap]);
    const getUserName = useCallback((id?: string) => id ? usersList.find(u => u?.name === id)?.full_name || `Unknown (${id.substring(0, 6)})` : "N/A", [usersList]);

    const getLowestRateFromOriginalRfq = useCallback((itemId: string) => getLowestQuoteFilled(orderData, itemId), [orderData]);

    const vendorDataSource = useMemo((): VendorGroupForTable[] => {
        if (!orderData || !orderData.order_list) { // orderData.order_list now only contains 'Pending' items
            return [];
        }
        const vendorWiseData: Record<string, Omit<VendorGroupForTable, 'vendorId' | 'vendorName' | 'key'> & { key?: string }> = {};

        orderData.order_list.forEach((prItem: ProcurementRequestItemDetail) => {
            if (!prItem.vendor || prItem.quote == null) {
                console.warn(`PR item ${prItem.item_id} (name: ${prItem.name}) is pending but missing vendor or quote. Skipping for approval table.`);
                return;
            }

            console.log("in useApproveRejectLogic", prItem.name)

            const vendorId = prItem.vendor;
            if (!vendorWiseData[vendorId]) {
                vendorWiseData[vendorId] = { totalAmount: 0, items: [], key: uuidv4() };
            }

            const quantity = parseNumber(prItem.quantity);
            const selectedRate = parseNumber(prItem.quote); // Rate of the currently selected quote for this item
            const currentAmount = quantity * selectedRate; // Amount for the currently selected quote

            const actualItemId = prItem.item_id;
            const targetRateDetail = targetRatesDataMap.get(actualItemId);

            let targetRateValue: number | undefined = undefined;
            if (targetRateDetail?.rate) {
                const parsedTargetRate = parseNumber(targetRateDetail.rate);
                if (parsedTargetRate > 0) {
                    targetRateValue = parsedTargetRate;
                }
            }

            const lowestRateInRfqContext = getLowestRateFromOriginalRfq(actualItemId);

            const calculatedTargetAmount = (targetRateValue !== undefined)
                ? targetRateValue * quantity * 0.98 // Apply factor
                : undefined;

            const calculatedLowestQuotedAmountInRfq = (lowestRateInRfqContext !== undefined)
                ? lowestRateInRfqContext * quantity
                : undefined;

            const displayItem: VendorItemDetailsToDisplay = {
                ...prItem,
                vendor_name: getVendorName(vendorId),
                amount: currentAmount, // Amount based on the selected quote from prItem
                lowestQuotedAmountForItem: calculatedLowestQuotedAmountInRfq, // Lowest total amount possible from RFQ
                targetRate: targetRateValue,
                targetAmount: calculatedTargetAmount,
                contributingHistoricalQuotes: targetRateDetail ? mapApiQuotesToApprovedQuotations(targetRateDetail.selected_quotations_items || []) as ApprovedQuotationForHoverCard[] : [],
                savingLoss: undefined, // Initialize
            };

            // --- Refined Saving/Loss Calculation ---
            let benchmarkAmount: number | undefined = undefined;

            // Determine the best benchmark: either target or lowest from RFQ
            if (displayItem.targetAmount !== undefined && displayItem.lowestQuotedAmountForItem !== undefined) {
                benchmarkAmount = Math.min(displayItem.targetAmount, displayItem.lowestQuotedAmountForItem);
            } else if (displayItem.targetAmount !== undefined) {
                benchmarkAmount = displayItem.targetAmount;
            } else if (displayItem.lowestQuotedAmountForItem !== undefined) {
                benchmarkAmount = displayItem.lowestQuotedAmountForItem;
            }

            // Calculate savingLoss if a benchmark is available and currentAmount is valid
            if (benchmarkAmount !== undefined && !isNaN(currentAmount)) {
                displayItem.savingLoss = benchmarkAmount - currentAmount; // Positive if currentAmount is less than benchmark
            }
            // --- End Refined Saving/Loss Calculation ---

            vendorWiseData[vendorId].items.push(displayItem);
            vendorWiseData[vendorId].totalAmount += currentAmount;
        });

        return Object.entries(vendorWiseData)
            .map(([vendorId, groupData]) => {
                const totalPotentialSavingLoss = groupData.items.reduce((sum, item) => sum + (item.savingLoss || 0), 0);
                return {
                    vendorId,
                    vendorName: getVendorName(vendorId),
                    totalAmount: groupData.totalAmount,
                    items: groupData.items,
                    key: groupData.key || uuidv4(),
                    potentialSavingLossForVendor: totalPotentialSavingLoss,
                };
            })
            .sort((a, b) => a.vendorName.localeCompare(b.vendorName));

    }, [orderData, getVendorName, targetRatesDataMap, vendorMap, getLowestRateFromOriginalRfq]);

    const handleSelectionChange = useCallback((newSelection: SelectionState) => setSelectionMap(newSelection), []);
    const handleCommentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => setComment(e.target.value), []);
    const toggleApproveDialog = useCallback(() => setApproveDialog(prev => !prev), []);
    const toggleSendBackDialog = useCallback(() => setSendBackDialog(prev => !prev), []);

    const handleApproveConfirm = useCallback(async () => {
        if (!orderData || selectionMap.size === 0) {
            toast({ title: "No Selection", description: "Please select items to approve.", variant: "destructive" });
            return;
        }

       // --- CHANGE: Payload generation is now based on the unique child document 'name' ---

        // `selectedItemsForPayload` will now be a list of unique child document names.
        const selectedItemsForPayload: string[] = []; 
        
        // `vendorSelectionMapForPayload` will now map the unique child doc name to its vendor.
        const vendorSelectionMapForPayload: { [childDocName: string]: string } = {};

        selectionMap.forEach((selectedChildDocNames, vendorId) => {
            selectedChildDocNames.forEach(childDocName => {
                selectedItemsForPayload.push(childDocName);
                vendorSelectionMapForPayload[childDocName] = vendorId;
            });
        });

        if (selectedItemsForPayload.length === 0) {
            toast({ title: "No Selection", description: "No valid items found in selection.", variant: "destructive" });
            return;
        }

        console.log("in handleApproveConfirm", selectedItemsForPayload, vendorSelectionMapForPayload)

        try {
            // The payload structure remains the same, but the *content* is now correct.
            const payload: ApprovePayload = {
                project_id: orderData.project,
                pr_name: orderData.name,
                selected_items: selectedItemsForPayload, // Now contains unique names like ['a1b2c3d', 'e4f5g6h']
                // payment_terms: orderData.payment_terms,//child table data of PeymentTerms
                selected_vendors: vendorSelectionMapForPayload, // Now maps unique names to vendors
                custom: !orderData.work_package,
            };
            
            console.log("in handleApproveConfirm PO Before Backend", payload)
            const response = await approveSelection(payload);

            // ... Success/error handling remains the same ...
            if (response?.message?.status === 200) {
                toast({ title: "Success!", description: response.message.message || "Items approved.", variant: "success" });
                setSelectionMap(new Map()); toggleApproveDialog(); await prMutate();
                const allPendingInOrderData = (orderData.order_list || []).map(i => i.name); // Using unique name
                if (!orderData.work_package || selectedItemsForPayload.length === allPendingInOrderData.length) {
                    navigate('/purchase-orders?tab=Approve PO');
                }
            } else { throw new Error(response?.message?.error || "Approval failed."); }
        } catch (error: any) {
            console.error("Error approving selection:", error);
            toast({ title: "Approval Failed!", description: error?.message || "An error occurred.", variant: "destructive" });
        }
    }, [orderData, selectionMap, approveSelection, prMutate, navigate, toggleApproveDialog, toast]);

    const handleSendBackConfirm = useCallback(async () => {
        if (!orderData) return;
        if (!orderData.work_package) {
            try {
                await rejectCustomPr(comment);
                toast({ title: "Success!", description: "Custom PR rejected successfully.", variant: "success" });
                toggleSendBackDialog(); setComment(""); await prMutate();
                navigate('/purchase-orders?tab=Approve PO');
            } catch (error: any) {
                console.error("Error rejecting custom PR:", error);
                toast({ title: "Rejection Failed!", description: error?.message || "Could not reject custom PR.", variant: "destructive" });
            }
            return;
        }
        if (selectionMap.size === 0) {
            toast({ title: "No Selection", description: "Please select items to send back.", variant: "destructive" });
            return;
        }
        const selectedItemsForPayload: string[] = [];

        selectionMap.forEach(childDocNamesSet => childDocNamesSet.forEach(childDocName => selectedItemsForPayload.push(childDocName)));
        if (selectedItemsForPayload.length === 0) {
            toast({ title: "No Selection", description: "No valid items found.", variant: "destructive" });
            return;
        }
        console.log("in useApproveRejectLogic SendBackPayload",selectedItemsForPayload)
console.log("in SendBackPayload selectedMAP",selectionMap)


        try {
            const payload: SendBackPayload = {
                project_id: orderData.project,
                pr_name: orderData.name,
                selected_items: selectedItemsForPayload,
                comments: comment || undefined,
            };
            const response = await sendBackSelection(payload);
            if (response?.message?.status === 200) {
                toast({ title: "Success!", description: response.message.message || "Items sent back.", variant: "success" });
                setSelectionMap(new Map()); toggleSendBackDialog(); setComment(""); await prMutate();
                const allPendingInOrderData = (orderData.order_list || []).map(i => i.name!);
                if (selectedItemsForPayload.length === allPendingInOrderData.length) {
                    navigate('/purchase-orders?tab=Approve PO');
                }
            } else { throw new Error(response?.message?.error || "Send back failed."); }
        } catch (error: any) {
            console.error("Error sending back selection:", error);
            toast({ title: "Send Back Failed!", description: error?.message || "An error occurred.", variant: "destructive" });
        }
    }, [orderData, selectionMap, comment, sendBackSelection, rejectCustomPr, prMutate, navigate, toggleSendBackDialog, toast]);

    const isPrEditable = useMemo(() => ["Vendor Selected", "Partially Approved"].includes(orderData?.workflow_state || ""), [orderData?.workflow_state]);

    return {
        orderData, vendorDataSource, selectionMap, isApproveDialogOpen, isSendBackDialogOpen,
        comment, isLoading: isLoadingHook, isPrEditable, targetRatesDataMap,
        handleSelectionChange, handleCommentChange, toggleApproveDialog, toggleSendBackDialog,
        handleApproveConfirm, handleSendBackConfirm, getVendorName, getUserName
    };
};