// file: /workspace/development/frappe-bench/apps/nirmaan_stack/frontend/src/pages/ProcurementRequests/ApproveVendorQuotes/hooks/useApproveRejectLogic.ts

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from "@/components/ui/use-toast";
import { ProcurementRequestItemDetail } from "@/types/NirmaanStack/ProcurementRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import {
    ApproveQuotesPRDoc, VendorItemDetailsToDisplay, VendorGroupForTable, SelectionState,
    TargetRateDetailFromAPI, FrappeTargetRateApiResponse, mapApiQuotesToApprovedQuotations,
    ApprovedQuotationForHoverCard, DynamicPaymentTerms // ✨ IMPORT new type
} from '../types';
import { ApprovePayload, SendBackPayload, useQuoteApprovalApi } from './useQuoteApprovalApi';
import { v4 as uuidv4 } from "uuid";
import { useFrappeGetCall } from 'frappe-react-sdk';
import { parseNumber } from '@/utils/parseNumber';
import getLowestQuoteFilled from '@/utils/getLowestQuoteFilled';

interface UseApproveRejectLogicProps {
    prId?: string;
    initialPrData?: ApproveQuotesPRDoc;
    vendorList?: Vendors[];
    usersList?: NirmaanUsers[];
    prMutate: any;
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
    dynamicPaymentTerms: DynamicPaymentTerms; // ✨ EXPOSE state
    setDynamicPaymentTerms: React.Dispatch<React.SetStateAction<DynamicPaymentTerms>>; // ✨ EXPOSE setter
}

export const useApproveRejectLogic = ({ prId, initialPrData, vendorList = [], usersList = [], prMutate }: UseApproveRejectLogicProps): UseApproveRejectLogicReturn => {
    const { toast } = useToast();
    const navigate = useNavigate();
    const { approveSelection, sendBackSelection, rejectCustomPr, isLoading: isActionApiLoading } = useQuoteApprovalApi(prId);

    const [orderData, setOrderData] = useState<ApproveQuotesPRDoc | undefined>(undefined);
    const [selectionMap, setSelectionMap] = useState<SelectionState>(new Map());
    const [isApproveDialogOpen, setApproveDialog] = useState<boolean>(false);
    const [isSendBackDialogOpen, setSendBackDialog] = useState<boolean>(false);
    const [comment, setComment] = useState<string>("");
    const [itemIdsForTargetRateAPI, setItemIdsForTargetRateAPI] = useState<string[]>([]);
    
    // ✨ ADD state for dynamic payment terms
    const [dynamicPaymentTerms, setDynamicPaymentTerms] = useState<DynamicPaymentTerms>({});

    // ... (useEffect for processing initialPrData is unchanged) ...
    useEffect(() => {
        // console.log("initialPrData", initialPrData)
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


    // ... (useFrappeGetCall for target rates is unchanged) ...
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


    // ... (all other useMemos and useCallbacks before handleApproveConfirm are unchanged) ...
    const targetRatesDataMap = useMemo(() => {
        const map = new Map<string, TargetRateDetailFromAPI>();
        targetRatesApiResponse?.message?.forEach(tr => {
            if (tr.item_id) map.set(tr.item_id, tr);
        });
        return map;
    }, [targetRatesApiResponse]);
    const vendorMap = useMemo(() => new Map(vendorList.map(v => [v.name, v.vendor_name])), [vendorList]);
    const getVendorName = useCallback((id?: string) => id ? vendorMap.get(id) || `Unknown (${id.substring(0, 6)})` : "N/A", [vendorMap]);
    const getUserName = useCallback((id?: string) => id ? usersList.find(u => u?.name === id)?.full_name || `Unknown (${id.substring(0, 6)})` : "N/A", [usersList]);
    const getLowestRateFromOriginalRfq = useCallback((itemId: string) => getLowestQuoteFilled(orderData, itemId), [orderData]);

 

    const vendorDataSource = useMemo((): VendorGroupForTable[] => {
    if (!orderData || !orderData.order_list) return [];

    const vendorWiseData: Record<string, Omit<VendorGroupForTable, 'vendorId' | 'vendorName' | 'key'>> = {};

    orderData.order_list.forEach((prItem) => {
        if (!prItem.vendor || prItem.quote == null) return;

        const vendorId = prItem.vendor;
        if (!vendorWiseData[vendorId]) {
            vendorWiseData[vendorId] = { totalAmount: 0, items: [], key: uuidv4() };
        }

        const quantity = parseNumber(prItem.quantity);
        const selectedRate = parseNumber(prItem.quote);
        const currentAmount = quantity * selectedRate;
        const actualItemId = prItem.item_id;

        // Rule 1: Check if the individual item's category is 'Additional Charges'.
        const isAdditionalChargeItem = prItem.category === 'Additional Charges';
        
        // Fetch benchmark data for the item
        const targetRateDetail = targetRatesDataMap.get(actualItemId);
        const lowestRateInRfqContext = getLowestRateFromOriginalRfq(actualItemId);

        // console.log("DEBUGRFQ: lowestRateInRfqContext", lowestRateInRfqContext);

        // --- NEW: Determine if this item is "custom" because it has no RFQ data ---
        // An item is considered custom if we couldn't find a lowest rate from any RFQ.
        const isCustomItem = lowestRateInRfqContext === 0;
        // console.log("DEBUGRFQ: isCustomItem", isCustomItem);
        // --------------------------------------------------------------------------

        // Calculate Target Amount
        let targetRateValue: number | undefined;
        if (targetRateDetail?.rate) {
            const parsedTargetRate = parseNumber(targetRateDetail.rate);
            if (parsedTargetRate > 0) targetRateValue = parsedTargetRate;
        }
        const calculatedTargetAmount = (targetRateValue !== undefined) ? targetRateValue * quantity * 0.98 : undefined;

        // Calculate Lowest Quoted Amount (it's already calculated)
        const calculatedLowestQuotedAmountInRfq = (lowestRateInRfqContext !== undefined) ? lowestRateInRfqContext * quantity : undefined;

        // Rule 2: Check if at least one benchmark amount exists.
        const hasBenchmark = calculatedTargetAmount !== undefined || calculatedLowestQuotedAmountInRfq !== undefined;

        const displayItem: VendorItemDetailsToDisplay = {
            ...prItem,
            vendor_name: getVendorName(vendorId),
            amount: currentAmount,
            lowestQuotedAmountForItem: calculatedLowestQuotedAmountInRfq,
            targetRate: targetRateValue,
            targetAmount: calculatedTargetAmount,
            contributingHistoricalQuotes: targetRateDetail ? mapApiQuotesToApprovedQuotations(targetRateDetail.selected_quotations_items || []) as ApprovedQuotationForHoverCard[] : [],
            savingLoss: undefined,
        };
        
        // --- FINAL LOGIC: Apply all rules ---
        // The item must NOT be custom (i.e., must have RFQ data),
        // must NOT be an additional charge,
        // and must have at least one benchmark to compare against.
        if (!isCustomItem && !isAdditionalChargeItem && hasBenchmark) {
            let benchmarkAmount: number;

            if (displayItem.targetAmount !== undefined && displayItem.lowestQuotedAmountForItem !== undefined) {
                benchmarkAmount = Math.min(displayItem.targetAmount, displayItem.lowestQuotedAmountForItem);
            } else {
                benchmarkAmount = displayItem.targetAmount || displayItem.lowestQuotedAmountForItem!;
            }
            
            if (!isNaN(currentAmount)) {
                displayItem.savingLoss = benchmarkAmount - currentAmount;
            }
        }
        // If conditions are false, savingLoss remains undefined.

        vendorWiseData[vendorId].items.push(displayItem);
        vendorWiseData[vendorId].totalAmount += currentAmount;
    });

    // The rest of the function remains the same...
    return Object.entries(vendorWiseData)
        .map(([vendorId, groupData]) => {
                        // 1. Calculate ONLY the positive values (savings)
            const totalSavings = groupData.items.reduce((sum, item) => {
                // If savingLoss exists AND is greater than 0, add it to the sum.
                if (item.savingLoss && item.savingLoss > 0) {
                    return sum + item.savingLoss;
                }
                return sum; // Otherwise, do not add it.
            }, 0);
             const totalLoss = groupData.items.reduce((sum, item) => {
                // If savingLoss exists AND is less than 0, add it to the sum.
                if (item.savingLoss && item.savingLoss < 0) {
                    return sum + item.savingLoss;
                }
                return sum; // Otherwise, do not add it.
            }, 0);
            
            // The existing calculation for the NET total (Savings - Losses)
            const netSavingLoss = groupData.items.reduce((sum, item) => sum + (item.savingLoss || 0), 0);

            return {
                vendorId,
                vendorName: getVendorName(vendorId),
                totalAmount: groupData.totalAmount,
                items: groupData.items,
                key: groupData.key || uuidv4(),
                // --- UPDATE THE RETURN OBJECT ---
                // Keep the original for net value
                potentialSavingLossForVendor: netSavingLoss,
                
                // Add the new, specific values
                potentialSavings: totalSavings,
                potentialLoss: totalLoss, // This will be a negative number or 0
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

        // console.log("DEBUGRFQ: orderData", orderData,selectionMap);
        const selectedItemsForPayload: string[] = []; 
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

        try {
            const payload: ApprovePayload = {
                project_id: orderData.project,
                pr_name: orderData.name,
                selected_items: selectedItemsForPayload,
                selected_vendors: vendorSelectionMapForPayload,
                custom: !orderData.work_package,
                // ✨ ADD dynamic payment terms to the payload
                payment_terms: JSON.stringify(dynamicPaymentTerms),
            };
            
            const response = await approveSelection(payload);
            if (response?.message?.status === 200) {
                toast({ title: "Success!", description: response.message.message || "Items approved.", variant: "success" });
                setSelectionMap(new Map()); toggleApproveDialog(); await prMutate();
                const allPendingInOrderData = (orderData.order_list || []).map(i => i.name);
                if (!orderData.work_package || selectedItemsForPayload.length === allPendingInOrderData.length) {
                    navigate('/purchase-orders?tab=Approve PO');
                }
            } else { throw new Error(response?.message?.error || "Approval failed."); }
        } catch (error: any) {
            console.error("Error approving selection:", error);
            toast({ title: "Approval Failed!", description: error?.message || "An error occurred.", variant: "destructive" });
        }
        
    }, [orderData, selectionMap, approveSelection, prMutate, navigate, toggleApproveDialog, toast, dynamicPaymentTerms]); // ✨ ADD dependency

    // ... (handleSendBackConfirm and isPrEditable are unchanged) ...
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
        try {
            const payload: SendBackPayload = { project_id: orderData.project, pr_name: orderData.name, selected_items: selectedItemsForPayload, comments: comment || undefined };
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
    const isLoadingHook = isActionApiLoading || targetRatesLoading;

    return {
        orderData, vendorDataSource, selectionMap, isApproveDialogOpen, isSendBackDialogOpen,
        comment, isLoading: isLoadingHook, isPrEditable, targetRatesDataMap,
        handleSelectionChange, handleCommentChange, toggleApproveDialog, toggleSendBackDialog,
        handleApproveConfirm, handleSendBackConfirm, getVendorName, getUserName,
        dynamicPaymentTerms, setDynamicPaymentTerms, // ✨ EXPORT state and setter
    };
};
