// Path: frontend/src/pages/Sent Back Requests/hooks/useApproveSBSLogic.ts

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from "@/components/ui/use-toast";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory"; // Ensure SentBackCategoryItem is defined or use a generic item type
import { ProcurementRequestItemDetail } from "@/types/NirmaanStack/ProcurementRequests"; // Child table type
import { Vendors } from "@/types/NirmaanStack/Vendors";
// import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers"; // Uncomment if getUserName is needed for SB flow
import { useSBQuoteApprovalApi, ApproveSBPayload, SendBackSBPayload } from './useSBQuoteApprovalApi';
import { v4 as uuidv4 } from "uuid";
import { KeyedMutator } from 'swr';
import { FrappeDoc, useFrappeGetCall } from 'frappe-react-sdk';
import {
    VendorItemDetailsToDisplay, // Reused from PR types
    VendorGroupForTable,      // Reused from PR types
    SelectionState,           // Reused from PR types
    TargetRateDetailFromAPI,
    FrappeTargetRateApiResponse,
    mapApiQuotesToApprovedQuotations,
    ApprovedQuotationForHoverCard ,// Reused from PR types if hover card is identical
    DynamicPaymentTerms
} from '@/pages/ProcurementRequests/ApproveVendorQuotes/types'; // Import from PR approval types
import { parseNumber } from '@/utils/parseNumber';
import getLowestQuoteFilled from '@/utils/getLowestQuoteFilled';

// If SentBackCategoryItem is not explicitly defined, you might use a generic or adapt ProcurementRequestItemDetail
// For this example, assuming SentBackCategoryItem has fields compatible with ProcurementRequestItemDetail for display purposes
// or that VendorItemDetailsToDisplay correctly maps them.

interface UseApproveSBSLogicProps {
    sbId?: string;
    initialSbData?: FrappeDoc<SentBackCategory>; // This should contain an `order_list` of SentBackCategoryItem
    vendorList?: Vendors[];
    sbMutate: KeyedMutator<FrappeDoc<SentBackCategory>>;
    // usersList?: NirmaanUsers[]; // Add if getUserName is needed
}

export interface UseApproveSBSLogicReturn {
    sentBackData?: SentBackCategory; // The SB document with its order_list (pending items)
    vendorDataSource: VendorGroupForTable[];
    selectionMap: SelectionState;
    isApproveDialogOpen: boolean;
    isSendBackDialogOpen: boolean;
    comment: string;
    isLoading: boolean;
    isSbEditable: boolean;
    targetRatesDataMap: Map<string, TargetRateDetailFromAPI>;
    handleSelectionChange: (newSelection: SelectionState) => void;
    handleCommentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    toggleApproveDialog: () => void;
    toggleSendBackDialog: () => void;
    handleApproveConfirm: () => Promise<void>;
    handleSendBackConfirm: () => Promise<void>;
    getVendorName: (vendorId: string | undefined) => string;
      dynamicPaymentTerms: DynamicPaymentTerms; // ✨ EXPOSE state
        setDynamicPaymentTerms: React.Dispatch<React.SetStateAction<DynamicPaymentTerms>>; //
    // getUserName?: (userId: string | undefined) => string; // Add if needed
}

export const useApproveSBSLogic = ({
    sbId,
    initialSbData,
    vendorList = [],
    sbMutate,
    // usersList = [], // Add if getUserName is needed
}: UseApproveSBSLogicProps): UseApproveSBSLogicReturn => {
    const { toast } = useToast();
    const navigate = useNavigate();
    const { approveSBSelection, sendBackSBSelection, isLoading: isApiLoading } = useSBQuoteApprovalApi(sbId);

    const [sentBackData, setSentBackData] = useState<SentBackCategory | undefined>(undefined);
    const [selectionMap, setSelectionMap] = useState<SelectionState>(new Map());
    const [isApproveDialogOpen, setApproveDialog] = useState<boolean>(false);
    const [isSendBackDialogOpen, setSendBackDialog] = useState<boolean>(false);
    const [comment, setComment] = useState<string>("");
    const [itemIdsForTargetRateAPI, setItemIdsForTargetRateAPI] = useState<string[]>([]);

      // ✨ ADD state for dynamic payment terms
        const [dynamicPaymentTerms, setDynamicPaymentTerms] = useState<DynamicPaymentTerms>({});

    useEffect(() => {
        if (initialSbData) {
            let processedSbData = { ...initialSbData };
            const pendingItems = processedSbData.order_list?.filter(item => item.status === 'Pending') || [];
            processedSbData.order_list = Array.isArray(pendingItems) ? pendingItems : [];

            // Parse RFQData if it's a string (this RFQ data is copied from original PR to SB)
            if (typeof initialSbData.rfq_data === 'string') {
                try {
                    processedSbData.rfq_data = JSON.parse(initialSbData.rfq_data || 'null') || { selectedVendors: [], details: {} };
                } catch (e) {
                    console.error("Error parsing SB rfq_data", e);
                    processedSbData.rfq_data = { selectedVendors: [], details: {} };
                }
            } else if (!initialSbData.rfq_data) {
                processedSbData.rfq_data = { selectedVendors: [], details: {} };
            }

            setSentBackData(processedSbData);
            const pendingItemActualIds = pendingItems.filter(item => item.item_id).map(item => item.item_id!);
            setItemIdsForTargetRateAPI(pendingItemActualIds);
        } else {
            setSentBackData(undefined);
            setItemIdsForTargetRateAPI([]);
        }
    }, [initialSbData]);

    const {
        data: targetRatesApiResponse,
        isLoading: targetRatesLoading,
        error: targetRatesError,
    } = useFrappeGetCall<FrappeTargetRateApiResponse>(
        'nirmaan_stack.api.target_rates.get_target_rates_for_item_list.get_target_rates_for_item_list',
        { item_ids_json: itemIdsForTargetRateAPI.length > 0 ? JSON.stringify(itemIdsForTargetRateAPI) : undefined },
        itemIdsForTargetRateAPI.length > 0 ? `target_rates_for_sb_items_${sbId}_${itemIdsForTargetRateAPI.sort().join('_')}` : null,
        { revalidateOnFocus: false }
    );

 // / Define the delimiter (a non-ambiguous character)
 const KEY_DELIMITER = "::"; 
 
 // Helper function (optional, but good practice)
 const getTargetRateKey = (itemId: string, unit: string,make:string): string => {
      return `${itemId}${KEY_DELIMITER}${unit}${KEY_DELIMITER}${make}`;
 };
 
 const targetRatesDataMap = useMemo(() => {
     const map = new Map<string, TargetRateDetailFromAPI>();
     
     // Ensure the API response is valid and is an array (message)
     if (targetRatesApiResponse?.message && Array.isArray(targetRatesApiResponse.message)) {
         targetRatesApiResponse.message.forEach(tr => {
             // Check for valid item_id and unit before creating the key
             if (tr.item_id && tr.unit && tr.make) {
                 // 1. Create the unique, composite key
                 const key = getTargetRateKey(tr.item_id, tr.unit,tr.make);
                 
                 // 2. Set the data using the composite key
                 map.set(key, tr);
             }
         });
     }
 
     return map;
 }, [targetRatesApiResponse]);

    useEffect(() => {
        if (targetRatesError) {
            toast({ title: "Target Rate API Error (SB)", description: "Could not fetch target rates.", variant: "destructive" });
        }
    }, [targetRatesError, toast]);

    const isLoadingHook = isApiLoading || targetRatesLoading;

    const vendorMap = useMemo(() => new Map(vendorList.map(v => [v.name, v.vendor_name])), [vendorList]);
    const getVendorName = useCallback((id?: string) => id ? vendorMap.get(id) || `Unknown (${id.substring(0, 6)})` : "N/A", [vendorMap]);
    // const getUserName = useCallback((id?: string) => id ? usersList.find(u => u?.name === id)?.full_name || `Unknown (${id.substring(0,6)})` : "N/A", [usersList]);


    const getLowestRateFromOriginalRfqForSB = useCallback((itemId: string): number => {
        return getLowestQuoteFilled(sentBackData, itemId); // Pass currentSbDoc
    }, [sentBackData]);

    const vendorDataSource = useMemo((): VendorGroupForTable[] => {
        if (!sentBackData || !sentBackData.order_list) {
            return [];
        }
        const vendorWiseData: Record<string, Omit<VendorGroupForTable, 'vendorId' | 'vendorName' | 'key'> & { key?: string }> = {};

        sentBackData.order_list.forEach((sbItem: ProcurementRequestItemDetail) => { // Use specific type if available, else generic
            if (!sbItem.vendor || sbItem.quote == null) {
                console.warn(`SB item ${sbItem.item_id || sbItem.name} is missing vendor or quote. Skipping.`);
                return;
            }
            const vendorId = sbItem.vendor;
            if (!vendorWiseData[vendorId]) {
                vendorWiseData[vendorId] = { totalAmount: 0, items: [], key: uuidv4() };
            }

            const quantity = parseNumber(sbItem.quantity);
            const selectedRate = parseNumber(sbItem.quote);
            const currentAmount = quantity * selectedRate;

            const actualItemId = sbItem.item_id; // This is the key for target rates and RFQ lookup
            const lookupKey = getTargetRateKey(sbItem.item_id, sbItem.unit,sbItem.make);

            const targetRateDetail = targetRatesDataMap.get(lookupKey); // item.


            let targetRateValue: number | undefined = undefined;

           
            if (targetRateDetail?.rate) {
                            const parsedTargetRate = parseNumber(targetRateDetail.rate);
                            if (parsedTargetRate > 0) targetRateValue = parsedTargetRate;
                        }

            const lowestRateInOriginalRfqContext = getLowestRateFromOriginalRfqForSB(actualItemId);

            const calculatedTargetAmount = (targetRateValue !== undefined)
                ? targetRateValue * quantity * 0.98
                : undefined;

            const calculatedLowestQuotedAmountInRfq = (lowestRateInOriginalRfqContext !== undefined)
                ? lowestRateInOriginalRfqContext * quantity
                : undefined;

            const displayItem: VendorItemDetailsToDisplay = {
                // Map fields from SentBackCategoryItem to VendorItemDetailsToDisplay
                name: sbItem.name, // Child docname, unique key for UI row
                item_id: sbItem.item_id,
                item_name: sbItem.item_name,
                unit: sbItem.unit,
                quantity: sbItem.quantity,
                category: sbItem.category,
                procurement_package: sbItem.procurement_package,
                make: sbItem.make,
                status: sbItem.status, // Should be "Pending"
                tax: sbItem.tax,
                comment: sbItem.comment,
                vendor: sbItem.vendor, // The selected vendor for this SB item
                quote: sbItem.quote,   // The selected quote for this SB item

                // Fields from parent/doctype context if needed by VendorItemDetailsToDisplay, though sbItem might not have all of these.
                // Ensure VendorItemDetailsToDisplay's non-optional fields are covered.
                // These are standard child table fields, should be on sbItem
                owner: sbItem.owner,
                creation: sbItem.creation,
                modified: sbItem.modified,
                modified_by: sbItem.modified_by,
                docstatus: sbItem.docstatus,
                idx: sbItem.idx,
                parent: sbItem.parent,
                parentfield: sbItem.parentfield,
                parenttype: sbItem.parenttype,
                doctype: sbItem.doctype, // doctype of the child item itself

                // Augmented fields for UI
                vendor_name: getVendorName(vendorId),
                amount: currentAmount,
                lowestQuotedAmountForItem: calculatedLowestQuotedAmountInRfq,
                targetRate: targetRateValue,
                targetAmount: calculatedTargetAmount,
                contributingHistoricalQuotes: targetRateDetail ? mapApiQuotesToApprovedQuotations(targetRateDetail.selected_quotations_items || []) as ApprovedQuotationForHoverCard[] : [],
                savingLoss: undefined, // Initialize
            };

            let benchmarkAmount: number | undefined = undefined;
            if (displayItem.targetAmount !== undefined && displayItem.lowestQuotedAmountForItem !== undefined) {
                benchmarkAmount = Math.min(displayItem.targetAmount, displayItem.lowestQuotedAmountForItem);
            } else if (displayItem.targetAmount !== undefined) {
                benchmarkAmount = displayItem.targetAmount;
            } else if (displayItem.lowestQuotedAmountForItem !== undefined) {
                benchmarkAmount = displayItem.lowestQuotedAmountForItem;
            }

            if (benchmarkAmount !== undefined && !isNaN(currentAmount)) {
                displayItem.savingLoss = benchmarkAmount - currentAmount;
            }

            vendorWiseData[vendorId].items.push(displayItem);
            vendorWiseData[vendorId].totalAmount += currentAmount;
        });

        return Object.entries(vendorWiseData)
            .map(([vendorId, groupData]) => ({
                vendorId,
                vendorName: getVendorName(vendorId),
                totalAmount: groupData.totalAmount,
                items: groupData.items,
                key: groupData.key || uuidv4(), // Ensure key is present
                potentialSavingLossForVendor: groupData.items.reduce((sum, item) => sum + (item.savingLoss || 0), 0),
            }))
            .sort((a, b) => a.vendorName.localeCompare(b.vendorName));
    }, [sentBackData, getVendorName, targetRatesDataMap, vendorMap, getLowestRateFromOriginalRfqForSB]);

    const handleSelectionChange = useCallback((newSelection: SelectionState) => setSelectionMap(newSelection), []);
    const handleCommentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => setComment(e.target.value), []);
    const toggleApproveDialog = useCallback(() => setApproveDialog(prev => !prev), []);
    const toggleSendBackDialog = useCallback(() => setSendBackDialog(prev => !prev), []);

    const handleApproveConfirm = useCallback(async () => {
        if (!sentBackData || selectionMap.size === 0) {
            toast({ title: "No Selection", description: "Please select items to approve from SB.", variant: "destructive" });
            return;
        }
        const selectedItemsForPayload: string[] = []; // Should contain item_id
        const vendorSelectionMapForPayload: { [itemId: string]: string } = {};

        selectionMap.forEach((itemIdsSet, vendorId) => {
            itemIdsSet.forEach(itemIdValue => {
                selectedItemsForPayload.push(itemIdValue);
                vendorSelectionMapForPayload[itemIdValue] = vendorId;
            });
        });

        if (selectedItemsForPayload.length === 0) {
            toast({ title: "No Selection", description: "No valid items found in selection for SB.", variant: "destructive" });
            return;
        }

        try {
            const payload: ApproveSBPayload = {
                project_id: sentBackData.project, // Project from SB document
                sb_id: sentBackData.name,
                selected_items: selectedItemsForPayload, // These are actual item_ids
                selected_vendors: vendorSelectionMapForPayload, // Keys are actual item_ids
                  // ✨ ADD dynamic payment terms to the payload
                payment_terms: JSON.stringify(dynamicPaymentTerms),
            };
            const response = await approveSBSelection(payload);
            console.log("Response from backend:", response);
            if (response?.message?.status === 200) {
                toast({ title: "Success!", description: response.message.message || "Items approved from SB.", variant: "success" });
                setSelectionMap(new Map()); toggleApproveDialog(); await sbMutate();
                const allPendingInSBData = (sentBackData.order_list || []).map(i => i.item_id!);
                if (selectedItemsForPayload.length === allPendingInSBData.length) {
                    navigate('/purchase-orders?tab=Approve Sent Back PO'); // Adjust as needed
                }
            } else { throw new Error(response?.message?.error || "SB Approval failed."); }
        } catch (error: any) {
            console.error("Error approving SB selection:", error);
            toast({ title: "SB Approval Failed!", description: error?.message || "An error occurred.", variant: "destructive" });
        }
    }, [sentBackData, selectionMap, approveSBSelection, sbMutate, navigate, toggleApproveDialog, toast,dynamicPaymentTerms]);

    const handleSendBackConfirm = useCallback(async () => {
        if (!sentBackData || selectionMap.size === 0) {
            toast({ title: "No Selection", description: "Please select items to send back from SB.", variant: "destructive" });
            return;
        }
        const selectedItemsForPayload: string[] = []; // Should contain item_id
        selectionMap.forEach(itemIdsSet => itemIdsSet.forEach(itemId => selectedItemsForPayload.push(itemId)));

        if (selectedItemsForPayload.length === 0) {
            toast({ title: "No Selection", description: "No valid items found in SB selection.", variant: "destructive" });
            return;
        }

        try {
            const payload: SendBackSBPayload = {
                sb_id: sentBackData.name,
                selected_items: selectedItemsForPayload,
                comment: comment || undefined,
            };
            console.log("Sending back SB payload:", payload);
            const response = await sendBackSBSelection(payload);
            console.log("Send back SB response:", response);
            if (response?.message?.status === 200) {
                toast({ title: "Success!", description: response.message.message || "Items sent back from SB.", variant: "success" });
                setSelectionMap(new Map()); toggleSendBackDialog(); setComment(""); await sbMutate();
                const allPendingInSBData = (sentBackData.order_list || []).map(i => i.item_id!);
                if (selectedItemsForPayload.length === allPendingInSBData.length) {
                    navigate('/purchase-orders?tab=Approve Sent Back PO'); // Adjust as needed
                }
            } else {  toast({ title: "SB Send Back Failed!", description: "An error occurred.", variant: "destructive" }); }
        } catch (error: any) {
            console.error("Error sending back SB items:", error);
            toast({ title: "SB Send Back Failed!", description: error?.message || "An error occurred.", variant: "destructive" });
        }
    }, [sentBackData, selectionMap, comment, sendBackSBSelection, sbMutate, navigate, toggleSendBackDialog, toast]);

    const isSbEditable = useMemo(() => ["Vendor Selected", "Partially Approved"].includes(sentBackData?.workflow_state || ""), [sentBackData?.workflow_state]);

    return {
        sentBackData, vendorDataSource, selectionMap, isApproveDialogOpen, isSendBackDialogOpen,
        comment, isLoading: isLoadingHook, isSbEditable, targetRatesDataMap,
        handleSelectionChange, handleCommentChange, toggleApproveDialog, toggleSendBackDialog,
        handleApproveConfirm, handleSendBackConfirm, getVendorName,
          dynamicPaymentTerms, setDynamicPaymentTerms, // ✨ EXPORT state and setter
        // getUserName // Add if implemented
    };
};