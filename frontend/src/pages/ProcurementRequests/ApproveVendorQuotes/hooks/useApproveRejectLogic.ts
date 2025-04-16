// src/features/procurement/approve-reject-quotes/hooks/useApproveRejectLogic.ts
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from "@/components/ui/use-toast"; // Adjust path
import { ProcurementRequest, ProcurementItem, RFQData } from "@/types/NirmaanStack/ProcurementRequests"; // Adjust path
import { Vendors } from "@/types/NirmaanStack/Vendors"; // Adjust path
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers"; // Adjust path
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations"; // Adjust path
import { SelectionState, VendorDataSourceItem, VendorWiseData, VendorItemDetails } from '../types'; // Adjust path
import { ApprovePayload, SendBackPayload, useQuoteApprovalApi } from './useQuoteApprovalApi';
import { v4 as uuidv4 } from "uuid";
import { KeyedMutator } from 'swr';
import { FrappeDoc } from 'frappe-react-sdk';
import getLowestQuoteFilled from '@/utils/getLowestQuoteFilled';
import getThreeMonthsLowestFiltered from '@/utils/getThreeMonthsLowest';

// Define Props
interface UseApproveRejectLogicProps {
    prId?: string;
    initialPrData?: ProcurementRequest;
    vendorList?: Vendors[];
    quotesData?: ApprovedQuotations[];
    usersList?: NirmaanUsers[];
    prMutate: KeyedMutator<FrappeDoc<ProcurementRequest>>; // Specific mutator
}

// Define Return Type (expose state and handlers needed by View)
export interface UseApproveRejectLogicReturn {
    orderData?: ProcurementRequest; // Local copy
    vendorDataSource: VendorDataSourceItem[];
    selectionMap: SelectionState;
    isApproveDialogOpen: boolean;
    isSendBackDialogOpen: boolean;
    comment: string;
    isLoading: boolean; // Combined loading state for actions
    isPrEditable: boolean; // Can the user approve/reject?
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
    quotesData = [],
    usersList = [],
    prMutate,
}: UseApproveRejectLogicProps): UseApproveRejectLogicReturn => {
    const { toast } = useToast();
    const navigate = useNavigate();
    const { approveSelection, sendBackSelection, rejectCustomPr, isLoading: isApiLoading } = useQuoteApprovalApi(prId);

    // --- State ---
    const [orderData, setOrderData] = useState<ProcurementRequest | undefined>(undefined);
    const [selectionMap, setSelectionMap] = useState<SelectionState>(new Map());
    const [isApproveDialogOpen, setApproveDialog] = useState<boolean>(false);
    const [isSendBackDialogOpen, setSendBackDialog] = useState<boolean>(false);
    const [comment, setComment] = useState<string>("");

    // --- Effects ---
    // Initialize local state and parse JSON fields safely
    useEffect(() => {
        if (initialPrData) {
            try {
              console.log("initialPrData", initialPrData)
                // Filter only 'Pending' items for this view's list
                const pendingItems = (typeof initialPrData.procurement_list === "string" ? JSON.parse(initialPrData.procurement_list)?.list : initialPrData.procurement_list?.list || [])
                    .filter((item: ProcurementItem) => item.status === 'Pending');

                // Safe parsing of RFQ data
                let parsedRfqData : RFQData = { selectedVendors: [], details: {} }; // Default empty
                if (initialPrData.rfq_data && typeof initialPrData.rfq_data === 'object') {
                    parsedRfqData = initialPrData.rfq_data; // Assume already object if not string
                } else if (typeof initialPrData.rfq_data === 'string') {
                    parsedRfqData = JSON.parse(initialPrData.rfq_data || "{}");
                }

                setOrderData({
                    ...initialPrData,
                    procurement_list: { list: pendingItems },
                    rfq_data: parsedRfqData,
                    // category_list might not be needed directly if grouping by vendor
                });
            } catch (error) {
                console.error("Error processing initial PR data:", error);
                toast({ title: "Error", description: "Failed to load PR details.", variant: "destructive" });
                setOrderData(undefined); // Reset on error
            }
        } else {
            setOrderData(undefined); // Reset if initialPrData is undefined
        }
    }, [initialPrData, toast]);

    console.log("orderData", orderData)

    // --- Memos ---
    const vendorMap = useMemo(() => new Map(vendorList.map(v => [v.name, v.vendor_name])), [vendorList]);

    const getVendorName = useCallback((id: string | undefined) => id ? vendorMap.get(id) || `Unknown (${id.substring(0, 6)})` : "N/A", [vendorMap]);

    const getUserName = useCallback((id: string | undefined) => id ? usersList.find(u => u?.name === id)?.full_name || `Unknown (${id.substring(0, 6)})` : "N/A", [usersList]);

    // Memoize lowest quote lookups (assuming functions are pure)
    const getLowest = useCallback((itemId: string) => getLowestQuoteFilled(orderData, itemId), [orderData]);
    const getThreeMonthsLowest = useCallback((itemId: string) => getThreeMonthsLowestFiltered(quotesData, itemId), [quotesData]);

    // Memoize vendor totals calculation
    const vendorTotals = useMemo(() => {
        const totals: { [vendorId: string]: number } = {};
        orderData?.procurement_list?.list?.forEach(item => {
            if (!item.vendor) return;
            totals[item.vendor] = (totals[item.vendor] || 0) + (item.quote ?? 0) * (item.quantity ?? 0);
        });
        return totals;
    }, [orderData?.procurement_list.list]);

    // Memoize the final vendor-wise data transformation
    const vendorDataSource = useMemo((): VendorDataSourceItem[] => {
        const data: VendorWiseData = {};
        orderData?.procurement_list?.list?.forEach(item => {
            if (!item.vendor) return;
            const vendorId = item.vendor;
            const vendorName = getVendorName(vendorId);
            const amount = (item.quote ?? 0) * (item.quantity ?? 0);
            const threeMonthsLowest = getThreeMonthsLowest(item.name) ?? 0;
            const lowestQuoted = getLowest(item.name) ?? 0;

            const itemDetails: VendorItemDetails = {
                ...item,
                vendor_name: vendorName,
                amount,
                lowestQuotedAmount: lowestQuoted * (item.quantity ?? 0),
                targetAmount: (threeMonthsLowest * 0.98) * (item.quantity ?? 0),
                // Calculate saving/loss based on comparison (e.g., lowest vs selected)
                savingLoss: lowestQuoted !== null && item.quote !== null ? (lowestQuoted - (item.quote ?? 0)) * (item.quantity ?? 0) : undefined,
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

         // Calculate potential total saving/loss per vendor
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
                potentialSavingLoss: groupData.potentialSavingLoss, // Add calculated total saving/loss
            }));
    }, [orderData?.procurement_list.list, getVendorName, getLowest, getThreeMonthsLowest, vendorTotals]);

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

        const selectedItemNames: string[] = [];
        const vendorSelectionMap: { [itemName: string]: string } = {};

        // Flatten the selection map
        selectionMap.forEach((itemSet, vendorId) => {
            itemSet.forEach(itemName => {
                selectedItemNames.push(itemName);
                vendorSelectionMap[itemName] = vendorId; // Map item name to its selected vendor
            });
        });

        if (selectedItemNames.length === 0) {
             toast({ title: "No Selection", description: "No valid items found in selection.", variant: "destructive" });
             return;
        }


        try {
            const payload: ApprovePayload = {
                project_id: orderData.project,
                pr_name: orderData.name,
                selected_items: selectedItemNames,
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
                const allItems = orderData.procurement_list.list.map(i => i.name);
                if (!orderData.work_package || selectedItemNames.length === allItems.length) {
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


    console.log("selctionMap", selectionMap)
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

        const selectedItemNames: string[] = [];
        selectionMap.forEach((itemSet) => {
            itemSet.forEach(itemName => {
                selectedItemNames.push(itemName);
            });
        });

        if (selectedItemNames.length === 0) {
            toast({ title: "No Selection", description: "No valid items found in selection.", variant: "destructive" });
            return;
        }


        try {
            const payload: SendBackPayload = {
                project_id: orderData.project,
                pr_name: orderData.name,
                selected_items: selectedItemNames,
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
                 const allItems = orderData.procurement_list.list.map(i => i.name);
                 if (selectedItemNames.length === allItems.length) {
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
        isLoading: isApiLoading, // Expose API loading state
        isPrEditable,
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