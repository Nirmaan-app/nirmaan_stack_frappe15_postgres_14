import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from "@/components/ui/use-toast"; // Adjust path
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory"; // Adjust path
import { Vendors } from "@/types/NirmaanStack/Vendors"; // Adjust path
import { useSBQuoteApprovalApi } from './useSBQuoteApprovalApi';
import { v4 as uuidv4 } from "uuid";
import { KeyedMutator } from 'swr';
import { FrappeDoc, useFrappeGetCall } from 'frappe-react-sdk';
import { ApprovedQuotationForHoverCard, FrappeTargetRateApiResponse, mapApiQuotesToApprovedQuotations, SelectionState, TargetRateDetailFromAPI, VendorGroupForTable, VendorItemDetailsToDisplay } from '@/pages/ProcurementRequests/ApproveVendorQuotes/types';
import getLowestQuoteFilled from '@/utils/getLowestQuoteFilled';
import { parseNumber } from '@/utils/parseNumber';
// import getThreeMonthsLowestFiltered from '@/utils/getThreeMonthsLowest';

// Define Props
interface UseApproveSBSLogicProps {
    sbId?: string;
    initialSbData?: FrappeDoc<SentBackCategory>; // Use the correct type
    vendorList?: Vendors[];
    sbMutate: KeyedMutator<FrappeDoc<SentBackCategory>>; // Mutator for SB doc
}

// Define Return Type (similar to PR logic return)
export interface UseApproveSBSLogicReturn {
    sentBackData?: SentBackCategory; // Renamed state variable
    vendorDataSource: VendorGroupForTable[];
    selectionMap: SelectionState;
    isApproveDialogOpen: boolean;
    isSendBackDialogOpen: boolean;
    comment: string;
    isLoading: boolean; // Combined loading state for actions
    isSbEditable: boolean; // Can the user approve/reject?
    targetRatesDataMap: Map<string, TargetRateDetailFromAPI>; // Add this

    handleSelectionChange: (newSelection: SelectionState) => void;
    handleCommentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    toggleApproveDialog: () => void;
    toggleSendBackDialog: () => void;
    handleApproveConfirm: () => Promise<void>;
    handleSendBackConfirm: () => Promise<void>;
    getVendorName: (vendorId: string | undefined) => string;
    // getUserName: (userId: string | undefined) => string;
}

export const useApproveSBSLogic = ({
    sbId,
    initialSbData,
    vendorList = [],
    sbMutate, // Renamed prop
}: UseApproveSBSLogicProps): UseApproveSBSLogicReturn => {
    const { toast } = useToast();
    const navigate = useNavigate();
    // Use the correct API hook
    const { approveSBSelection, sendBackSBSelection, isLoading: isApiLoading } = useSBQuoteApprovalApi(sbId);

    // --- State ---
    const [sentBackData, setSentBackData] = useState<SentBackCategory | undefined>(initialSbData); // Renamed state

    const [selectionMap, setSelectionMap] = useState<SelectionState>(new Map());
    const [isApproveDialogOpen, setApproveDialog] = useState<boolean>(false);
    const [isSendBackDialogOpen, setSendBackDialog] = useState<boolean>(false);
    const [comment, setComment] = useState<string>("");


    // --- Item IDs for Target Rate API ---
    const itemIdsForTargetRateAPI = useMemo(() => {
        return sentBackData?.order_list?.filter(item => item.status === 'Pending' && item.item_id).map(item => item.item_id) || [];
    }, [sentBackData?.order_list]);


    // --- Fetch Target Rates (reusing hook from VendorQuotesSelection/types) ---
    // Assuming useTargetRatesForItems is generic or duplicated for this context if needed
    const {
        data: targetRatesApiResponse, // Example, if you fetch it here
        isLoading: targetRatesLoading,
    } = useFrappeGetCall<FrappeTargetRateApiResponse>(
        'nirmaan_stack.api.target_rates.get_target_rates_for_item_list.get_target_rates_for_item_list',
        { item_ids_json: itemIdsForTargetRateAPI.length > 0 ? JSON.stringify(itemIdsForTargetRateAPI) : undefined },
        itemIdsForTargetRateAPI.length > 0 ? `target_rates_for_sb_items_${sbId}_${itemIdsForTargetRateAPI.sort().join('_')}` : null
    );

    const targetRatesDataMap = useMemo(() => {
        const map = new Map<string, TargetRateDetailFromAPI>();
        targetRatesApiResponse?.message?.forEach(tr => {
            if (tr.item_id) map.set(tr.item_id, tr);
        });
        return map;
    }, [targetRatesApiResponse]);
    

    // --- Effects ---
    // --- Initialize/Update local state from initialSbData ---
    useEffect(() => {
        if (initialSbData) {
            let processedSbData = { ...initialSbData };

            const pendingItems = processedSbData.order_list?.filter(item => item.status === 'Pending') || [];
            // Ensure order_list is an array
            processedSbData.order_list = Array.isArray(pendingItems) ? pendingItems : [];

            // Parse RFQData if it's a string
            if (typeof initialSbData.rfq_data === 'string') {
                try {
                    processedSbData.rfq_data = JSON.parse(initialSbData.rfq_data || 'null') || { selectedVendors: [], details: {} };
                } catch (e) {
                    console.error("Error parsing initialSbData.rfq_data", e);
                    processedSbData.rfq_data = { selectedVendors: [], details: {} };
                }
            } else if (!initialSbData.rfq_data) {
                processedSbData.rfq_data = { selectedVendors: [], details: {} };
            }
            // Category list remains JSON for now
            if (typeof initialSbData.category_list === 'string') {
                try {
                    processedSbData.category_list = JSON.parse(initialSbData.category_list || 'null') || { list: [] };
                } catch (e) { processedSbData.category_list = { list: [] };}
            } else if (!initialSbData.category_list) {
                processedSbData.category_list = { list: [] };
            }


            setSentBackData(processedSbData);
        } else {
            setSentBackData(undefined);
        }
    }, [initialSbData]);

    // --- Memos ---
    const vendorMap = useMemo(() => new Map(vendorList.map(v => [v.name, v.vendor_name])), [vendorList]);

    const getVendorName = useCallback((id: string | undefined) => id ? vendorMap.get(id) || `Unknown (${id.substring(0, 6)})` : "N/A", [vendorMap]);

    // const getUserName = useCallback((id: string | undefined) => id ? usersList.find(u => u?.name === id)?.full_name || `Unknown (${id.substring(0, 6)})` : "N/A", [usersList]);

    // const getLowest = useCallback((itemId: string) => getLowestQuoteFilled(sentBackData, itemId), [sentBackData]); // Pass sentBackData

    const getLowestForItemInRFQ = useCallback((itemId: string): number => {
        return getLowestQuoteFilled(sentBackData, itemId); // Pass currentSbDoc
    }, [sentBackData]);


    // const getItemAvgRateAndAttributes = useCallback((itemId: string) => getThreeMonthsLowestFiltered(quotesData, itemId), [quotesData]);

    // const vendorTotals = useMemo(() => {
    //     const totals: { [vendorId: string]: number } = {};
    //     // Use item_list here
    //     sentBackData?.item_list?.list?.forEach(item => {
    //         if (!item.vendor) return;
    //         totals[item.vendor] = (totals[item.vendor] || 0) + (item.quote ?? 0) * (item.quantity ?? 0);
    //     });
    //     return totals;
    // }, [sentBackData?.item_list.list]); // Depend on item_list

    const vendorDataSource = useMemo((): VendorGroupForTable[] => {
        // const data: VendorWiseData = {};
        const vendorWiseData: Record<string, Omit<VendorGroupForTable, 'vendorId' | 'vendorName'>> = {};

        // Use item_list here
        sentBackData?.order_list?.forEach(item => {
            if (!item.vendor) return;
            const vendorId = item.vendor;
            const vendorName = getVendorName(vendorId);
            const amount = (item.quote ?? 0) * (item.quantity ?? 0);
            const targetRateDetail = targetRatesDataMap.get(item.item_id);
            const targetRateValue = targetRateDetail?.rate ? parseNumber(targetRateDetail.rate) : undefined;
            const lowestQuoted = getLowestForItemInRFQ(item.item_id) ?? 0;

            // Assert item as VendorItemDetails - might need adjustments based on SBItem vs ProcurementItem
            const displayItem: VendorItemDetailsToDisplay = {
                ...item,
                vendor_name: vendorName,
                amount,
                lowestQuotedAmountForItem: lowestQuoted ? lowestQuoted * item.quantity : undefined,
                // threeMonthsLowestAmount: threeMonthsLowest * (item.quantity ?? 0),
                targetRate: targetRateValue,
                contributingHistoricalQuotes: targetRateDetail ? mapApiQuotesToApprovedQuotations(targetRateDetail.selected_quotations_items || []) as ApprovedQuotationForHoverCard[] : [],
                targetAmount: targetRateValue ? targetRateValue * item.quantity * 0.98 : undefined,
                savingLoss: undefined,
            };

                if (displayItem.targetAmount && !isNaN(amount)) {
                     displayItem.savingLoss = displayItem.targetAmount - amount;
                } else if (lowestQuoted > 0 && !isNaN(amount)) {
                     displayItem.savingLoss = (lowestQuoted * item.quantity) - amount;
                }

            vendorWiseData[vendorId].items.push(displayItem);
            vendorWiseData[vendorId].totalAmount += amount;
            vendorWiseData[vendorId].key = uuidv4();

            // if (!data[vendorId]) {
            //     data[vendorId] = {
            //         totalAmount: vendorTotals[vendorId] || 0,
            //         key: uuidv4(),
            //         items: [],
            //     };
            // }
            // data[vendorId].items.push(itemDetails);
        });

        //  Object.values(data).forEach(vendorGroup => {
        //      vendorGroup.potentialSavingLoss = vendorGroup.items.reduce((sum, item) => sum + (item.savingLoss ?? 0), 0);
        //  });

        return Object.entries(vendorWiseData)
            .sort(([idA], [idB]) => (getVendorName(idA)).localeCompare(getVendorName(idB)))
            .map(([vendorId, groupData]) => {
                const totalPotentialSavingLoss = groupData.items.reduce((sum, item) => sum + (item.savingLoss || 0), 0);
                return {
                key: groupData.key,
                vendorId,
                vendorName: getVendorName(vendorId),
                totalAmount: groupData.totalAmount,
                items: groupData.items,
                potentialSavingLoss: totalPotentialSavingLoss,
            }});
    }, [sentBackData, getVendorName, getLowestForItemInRFQ, targetRatesDataMap, vendorMap]); // Depend on item_list

    // --- Callbacks ---
    const handleSelectionChange = useCallback((newSelection: SelectionState) => {
        setSelectionMap(newSelection);
    }, []);

    const handleCommentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setComment(e.target.value);
    }, []);

    const toggleApproveDialog = useCallback(() => setApproveDialog(prev => !prev), []);
    const toggleSendBackDialog = useCallback(() => setSendBackDialog(prev => !prev), []);

    // --- Approve Confirmation ---
    const handleApproveConfirm = useCallback(async () => {
        if (!sentBackData || selectionMap.size === 0) {
            toast({ title: "No Selection", description: "Please select items to approve.", variant: "destructive" });
            return;
        }

        const selectedItemNames: string[] = [];
        const vendorSelectionMap: { [itemId: string]: string } = {};
        selectionMap.forEach((itemSet, vendorId) => {
            itemSet.forEach(itemId => {
                selectedItemNames.push(itemId);
                vendorSelectionMap[itemId] = vendorId;
            });
        });

        if (selectedItemNames.length === 0) {
             toast({ title: "No Selection", description: "No valid items found in selection.", variant: "destructive" });
             return;
        }

        try {
            const payload = {
                project_id: sentBackData.project, // Get project from SB data
                sb_id: sentBackData.name, // Use SB ID
                selected_items: selectedItemNames,
                selected_vendors: vendorSelectionMap,
            };

            const response = await approveSBSelection(payload); // Use SB API function

            if (response?.message?.status === 200) {
                toast({ title: "Success!", description: response.message.message || "Items approved successfully.", variant: "success" });
                setSelectionMap(new Map());
                toggleApproveDialog();
                await sbMutate(); // Use SB mutate
                const allItems = sentBackData.order_list.map(i => i.item_id);
                if (selectedItemNames.length === allItems.length) {
                     navigate('/purchase-orders?tab=Approve Sent Back PO'); // Adjust navigation
                 }
            } else {
                 throw new Error(response?.message?.error || "Approval failed.");
             }
        } catch (error: any) {
            console.error("Error approving Sent Back selection:", error);
            toast({ title: "Approval Failed!", description: error?.message || "An error occurred.", variant: "destructive" });
        }
    }, [sentBackData, selectionMap, approveSBSelection, sbMutate, navigate, toggleApproveDialog, toast, comment]);

    // --- Send Back Confirmation ---
    const handleSendBackConfirm = useCallback(async () => {
        if (!sentBackData || selectionMap.size === 0) {
             toast({ title: "No Selection", description: "Please select items to send back.", variant: "destructive" });
             return;
         }

        const selectedItemNames: string[] = [];
        selectionMap.forEach((itemSet) => {
            itemSet.forEach(itemId => selectedItemNames.push(itemId));
        });

        if (selectedItemNames.length === 0) {
             toast({ title: "No Selection", description: "No valid items found.", variant: "destructive" });
             return;
         }

        try {
             const payload = {
                 sb_id: sentBackData.name, // Use SB ID
                 selected_items: selectedItemNames,
                 comment: comment || undefined,
             };

             const response = await sendBackSBSelection(payload); // Use SB API function

             if (response?.message?.status === 200) {
                  toast({ title: "Success!", description: response.message.message || "Selected items sent back.", variant: "success" });
                  setSelectionMap(new Map());
                  toggleSendBackDialog();
                  setComment("");
                  await sbMutate(); // Use SB mutate
                  const allItems = sentBackData.order_list.map(i => i.item_id);
                  if (selectedItemNames.length === allItems.length) {
                      navigate('/purchase-orders?tab=Approve Sent Back PO'); // Adjust navigation
                  }
              } else {
                  throw new Error(response?.message?.error || "Send back failed.");
              }
         } catch (error: any) {
             console.error("Error sending back Sent Back items:", error);
             toast({ title: "Send Back Failed!", description: error?.message || "An error occurred.", variant: "destructive" });
         }
    }, [sentBackData, selectionMap, comment, sendBackSBSelection, sbMutate, navigate, toggleSendBackDialog, toast, comment]);

     // Determine if actions should be enabled based on SB workflow state
     const isSbEditable = useMemo(() => {
         return ["Vendor Selected", "Partially Approved"].includes(sentBackData?.workflow_state || "");
     }, [sentBackData?.workflow_state]);

    // --- Return ---
    return {
        sentBackData, // Renamed state
        vendorDataSource,
        selectionMap,
        isApproveDialogOpen,
        isSendBackDialogOpen,
        comment,
        isLoading: isApiLoading || targetRatesLoading,
        isSbEditable, // Renamed state
        targetRatesDataMap,

        handleSelectionChange,
        handleCommentChange,
        toggleApproveDialog,
        toggleSendBackDialog,
        handleApproveConfirm,
        handleSendBackConfirm,
        getVendorName,
        // getUserName
    };
};