// src/features/procurement/approve-sb-quotes/hooks/useApproveSBSLogic.ts
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from "@/components/ui/use-toast"; // Adjust path
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory"; // Adjust path
import { Vendors } from "@/types/NirmaanStack/Vendors"; // Adjust path
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers"; // Adjust path
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations"; // Adjust path
import { useSBQuoteApprovalApi } from './useSBQuoteApprovalApi';
import { v4 as uuidv4 } from "uuid";
import { KeyedMutator } from 'swr';
import { FrappeDoc } from 'frappe-react-sdk';
import { SelectionState, VendorDataSourceItem, VendorItemDetails, VendorWiseData } from '@/pages/ProcurementRequests/ApproveVendorQuotes/types';
import { ProcurementItem, RFQData } from '@/types/NirmaanStack/ProcurementRequests';
import getLowestQuoteFilled from '@/utils/getLowestQuoteFilled';
import getThreeMonthsLowestFiltered from '@/utils/getThreeMonthsLowest';

// Define Props
interface UseApproveSBSLogicProps {
    sbId?: string;
    initialSbData?: SentBackCategory; // Use the correct type
    vendorList?: Vendors[];
    quotesData?: ApprovedQuotations[];
    usersList?: NirmaanUsers[];
    sbMutate: KeyedMutator<FrappeDoc<SentBackCategory>>; // Mutator for SB doc
}

// Define Return Type (similar to PR logic return)
export interface UseApproveSBSLogicReturn {
    sentBackData?: SentBackCategory; // Renamed state variable
    vendorDataSource: VendorDataSourceItem[];
    selectionMap: SelectionState;
    isApproveDialogOpen: boolean;
    isSendBackDialogOpen: boolean;
    comment: string;
    isLoading: boolean; // Combined loading state for actions
    isSbEditable: boolean; // Can the user approve/reject?
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
    quotesData = [],
    usersList = [],
    sbMutate, // Renamed prop
}: UseApproveSBSLogicProps): UseApproveSBSLogicReturn => {
    const { toast } = useToast();
    const navigate = useNavigate();
    // Use the correct API hook
    const { approveSBSelection, sendBackSBSelection, isLoading: isApiLoading } = useSBQuoteApprovalApi(sbId);

    // --- State ---
    const [sentBackData, setSentBackData] = useState<SentBackCategory | undefined>(undefined); // Renamed state
    const [selectionMap, setSelectionMap] = useState<SelectionState>(new Map());
    const [isApproveDialogOpen, setApproveDialog] = useState<boolean>(false);
    const [isSendBackDialogOpen, setSendBackDialog] = useState<boolean>(false);
    const [comment, setComment] = useState<string>("");

    // --- Effects ---
    // Initialize local state and parse JSON fields safely
    useEffect(() => {
        if (initialSbData) {
            try {
                // Use item_list directly, no need to filter by status (all are pending)
                // const items = initialSbData.item_list?.list || [];
                const pendingItems = (typeof initialSbData.item_list === "string" ? JSON.parse(initialSbData.item_list)?.list : initialSbData.item_list?.list || [])
                                    .filter((item: ProcurementItem) => item.status === 'Pending');
                // Safe parsing of RFQ data
                let parsedRfqData: RFQData = { selectedVendors: [], details: {} };
                if (initialSbData.rfq_data && typeof initialSbData.rfq_data === 'object') {
                    parsedRfqData = initialSbData.rfq_data;
                } else if (typeof initialSbData.rfq_data === 'string') {
                    parsedRfqData = JSON.parse(initialSbData.rfq_data || "{}");
                }

                setSentBackData({
                    ...initialSbData,
                    item_list: { list: pendingItems }, // Use the direct item list
                    rfq_data: parsedRfqData,
                });
            } catch (error) {
                console.error("Error processing initial Sent Back data:", error);
                toast({ title: "Error", description: "Failed to load Sent Back details.", variant: "destructive" });
                setSentBackData(undefined);
            }
        } else {
            setSentBackData(undefined);
        }
    }, [initialSbData, toast]);

    // --- Memos ---
    const vendorMap = useMemo(() => new Map(vendorList.map(v => [v.name, v.vendor_name])), [vendorList]);
    const getVendorName = useCallback((id: string | undefined) => id ? vendorMap.get(id) || `Unknown (${id.substring(0, 6)})` : "N/A", [vendorMap]);

    // const getUserName = useCallback((id: string | undefined) => id ? usersList.find(u => u?.name === id)?.full_name || `Unknown (${id.substring(0, 6)})` : "N/A", [usersList]);

    const getLowest = useCallback((itemId: string) => getLowestQuoteFilled(sentBackData, itemId), [sentBackData]); // Pass sentBackData
    const getItemAvgRateAndAttributes = useCallback((itemId: string) => getThreeMonthsLowestFiltered(quotesData, itemId), [quotesData]);

    const vendorTotals = useMemo(() => {
        const totals: { [vendorId: string]: number } = {};
        // Use item_list here
        sentBackData?.item_list?.list?.forEach(item => {
            if (!item.vendor) return;
            totals[item.vendor] = (totals[item.vendor] || 0) + (item.quote ?? 0) * (item.quantity ?? 0);
        });
        return totals;
    }, [sentBackData?.item_list.list]); // Depend on item_list

    const vendorDataSource = useMemo((): VendorDataSourceItem[] => {
        const data: VendorWiseData = {};
        // Use item_list here
        sentBackData?.item_list?.list?.forEach(item => {
            if (!item.vendor) return;
            const vendorId = item.vendor;
            const vendorName = getVendorName(vendorId);
            const amount = (item.quote ?? 0) * (item.quantity ?? 0);
            const threeMonthsLowest = getItemAvgRateAndAttributes(item.name)?.averageRate * 0.98;
            const contributingQuotes = getItemAvgRateAndAttributes(item.name)?.contributingQuotes;
            const lowestQuoted = getLowest(item.name) ?? 0;

            // Assert item as VendorItemDetails - might need adjustments based on SBItem vs ProcurementItem
            const itemDetails: VendorItemDetails = {
                ...item,
                vendor_name: vendorName,
                amount,
                lowestQuotedAmount: lowestQuoted * (item.quantity ?? 0),
                // threeMonthsLowestAmount: threeMonthsLowest * (item.quantity ?? 0),
                targetRate: threeMonthsLowest,
                contributingQuotes,
                targetAmount: threeMonthsLowest * (item.quantity ?? 0),
                savingLoss: ((lowestQuoted || threeMonthsLowest) && item.quote) ? (((lowestQuoted && threeMonthsLowest) ? Math.min(lowestQuoted, threeMonthsLowest) : (lowestQuoted || threeMonthsLowest)) - (item.quote ?? 0)) * (item.quantity ?? 0) : undefined,
            };

            if (!data[vendorId]) {
                data[vendorId] = {
                    totalAmount: vendorTotals[vendorId] || 0,
                    key: uuidv4(),
                    items: [],
                };
            }
            data[vendorId].items.push(itemDetails);
        });

         Object.values(data).forEach(vendorGroup => {
             vendorGroup.potentialSavingLoss = vendorGroup.items.reduce((sum, item) => sum + (item.savingLoss ?? 0), 0);
         });

        return Object.entries(data)
            .sort(([idA], [idB]) => (getVendorName(idA)).localeCompare(getVendorName(idB)))
            .map(([vendorId, groupData]) => ({
                key: groupData.key,
                vendorId,
                vendorName: getVendorName(vendorId),
                totalAmount: groupData.totalAmount,
                items: groupData.items,
                potentialSavingLoss: groupData.potentialSavingLoss,
            }));
    }, [sentBackData?.item_list.list, getVendorName, getLowest, getItemAvgRateAndAttributes, vendorTotals]); // Depend on item_list

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
        const vendorSelectionMap: { [itemName: string]: string } = {};
        selectionMap.forEach((itemSet, vendorId) => {
            itemSet.forEach(itemName => {
                selectedItemNames.push(itemName);
                vendorSelectionMap[itemName] = vendorId;
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
                const allItems = sentBackData.item_list.list.map(i => i.name);
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
    }, [sentBackData, selectionMap, approveSBSelection, sbMutate, navigate, toggleApproveDialog, toast]);

    // --- Send Back Confirmation ---
    const handleSendBackConfirm = useCallback(async () => {
        if (!sentBackData || selectionMap.size === 0) {
             toast({ title: "No Selection", description: "Please select items to send back.", variant: "destructive" });
             return;
         }

        const selectedItemNames: string[] = [];
        selectionMap.forEach((itemSet) => {
            itemSet.forEach(itemName => selectedItemNames.push(itemName));
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
                  const allItems = sentBackData.item_list.list.map(i => i.name);
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
    }, [sentBackData, selectionMap, comment, sendBackSBSelection, sbMutate, navigate, toggleSendBackDialog, toast]);

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
        isLoading: isApiLoading,
        isSbEditable, // Renamed state
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