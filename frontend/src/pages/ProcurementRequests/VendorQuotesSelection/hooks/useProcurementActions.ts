import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFrappeUpdateDoc, useSWRConfig } from 'frappe-react-sdk';
import { RFQData, ProcurementRequestItemDetail } from '@/types/NirmaanStack/ProcurementRequests';
import { ProgressDocument, getItemListFromDocument, ProgressItem } from '../types';
import { parseNumber } from '@/utils/parseNumber';
import { toast } from '@/components/ui/use-toast';
import { queryKeys } from '@/config/queryKeys';

interface UseProcurementActionsProps {
    docId: string;
    // The SWR mutate function for the specific document being updated
    docMutate: () => Promise<any>;
}

export const useProcurementActions = ({ docId, docMutate }: UseProcurementActionsProps) => {
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { mutate: globalSWRMutate } = useSWRConfig(); // For mutating list keys
    const navigate = useNavigate();

    const [isRedirecting, setIsRedirecting] = useState<string>(""); // For UI feedback

    const _updateDocument = useCallback(async (
        currentDoc: ProgressDocument,
        rfqDataPayload: RFQData | null, // Null for revert
        workflowStateUpdate?: string,
        finalSelectedVendorQuotes?: Map<string, string> // Pass this for review/save
    ) => {
        setIsRedirecting(workflowStateUpdate === "Approved" ? "revert_save" : "save"); // Indicate action type

        // Prepare the updated item list based on final selections for saving
        // let updatedItemList: ProcurementItem[] = getItemListFromDocument(currentDoc).map((item: ProcurementItemWithVendor)  => {
        //     if (finalSelectedVendorQuotes && finalSelectedVendorQuotes.has(item.name)) {
        //         const selectedVendorId = finalSelectedVendorQuotes.get(item.name);
        //         const vendorQuoteData = rfqDataPayload?.details[item.name]?.vendorQuotes[selectedVendorId!];
        //         if (vendorQuoteData) {
        //             return {
        //                 ...item,
        //                 vendor: selectedVendorId,
        //                 quote: parseNumber(vendorQuoteData.quote), // Ensure number
        //                 make: vendorQuoteData.make || item.make, // Prefer new make, fallback to item's make
        //             };
        //         }
        //     }
        //     // If not selected or no quote, strip vendor/quote fields if they exist
        //     const { vendor, quote, ...rest } = item; // 'make' is kept as it's part of ProcurementItemBase
        //     return rest;
        // });

        // const updatePayload: Partial<ProcurementRequest | SentBackCategory> = {
        //     rfq_data: rfqDataPayload === null ? { selectedVendors: [], details: {} } : rfqDataPayload,
        //     workflow_state: workflowStateUpdate || currentDoc.workflow_state, // Keep current if not changing
        // };

        // if ('procurement_list' in currentDoc) {
        //     (updatePayload as Partial<ProcurementRequest>).procurement_list = { list: updatedItemList };
        // } else if ('item_list' in currentDoc) {
        //     (updatePayload as Partial<SentBackCategory>).item_list = { list: updatedItemList as any }; // Cast as needed
        // }

        // Transform currentDoc.order_list based on selections to create the new order_list payload
        const newOrderListPayload: Partial<ProcurementRequestItemDetail>[] = [];
        
        const currentItemsFromDoc = getItemListFromDocument(currentDoc); // Returns ProgressItem[]

        currentItemsFromDoc.forEach((docItem: ProgressItem) => {
            const itemId = docItem.item_id; // Key for selections
            let updatedItemFields: Partial<ProcurementRequestItemDetail> = {
                // Include all fields from docItem that should persist,
                // especially if they are not managed by the RFQ form.
                // For existing items, 'name' (child row ID) is important for updates.
                name: docItem.name, // Frappe child row name
                item_id: docItem.item_id,
                item_name: docItem.item_name,
                unit: docItem.unit,
                quantity: docItem.quantity,
                category: docItem.category,
                procurement_package: docItem.procurement_package,
                status: docItem.status, // Keep original status unless RFQ logic changes it
                tax: docItem.tax,
                comment: docItem.comment,
                // Vendor, quote, make will be updated based on selections
            };

            if (finalSelectedVendorQuotes && finalSelectedVendorQuotes.has(itemId)) {
                const selectedVendorId = finalSelectedVendorQuotes.get(itemId);
                const vendorQuoteData = rfqDataPayload?.details[itemId]?.vendorQuotes[selectedVendorId!];
                if (vendorQuoteData) {
                    updatedItemFields.vendor = selectedVendorId;
                    updatedItemFields.quote = parseNumber(vendorQuoteData.quote);
                    updatedItemFields.make = vendorQuoteData.make || docItem.make; // Prefer new, fallback to original item's make
                } else {
                    // Vendor was selected but no quote data - clear vendor specific fields
                    updatedItemFields.vendor = undefined;
                    updatedItemFields.quote = undefined;
                    // Keep docItem.make as is or clear if logic dictates
                }
            } else {
                // No vendor selected for this item, or reverting - clear vendor specific fields
                updatedItemFields.vendor = undefined;
                updatedItemFields.quote = undefined;
                // Keep docItem.make as is (the item's original make)
                updatedItemFields.make = docItem.make;
            }
            newOrderListPayload.push(Object.fromEntries(Object.entries(updatedItemFields).filter(([_, v]) => v !== undefined)));
        });


        const updatePayload: Partial<ProgressDocument> = {
            rfq_data: rfqDataPayload === null ? { selectedVendors: [], details: {} } : rfqDataPayload,
            workflow_state: workflowStateUpdate || currentDoc.workflow_state,
            // Assign the new child table directly
            order_list: newOrderListPayload as ProcurementRequestItemDetail[], 
        };
        
        // Remove old JSON list fields if they are part of ProgressDocument type but no longer used
        if ('procurement_list' in updatePayload) delete (updatePayload as any).procurement_list;
        if ('item_list' in updatePayload) delete (updatePayload as any).item_list;


        try {
            await updateDoc(currentDoc.doctype, docId, updatePayload);
            await docMutate(); // Mutate the specific document SWR key
            await globalSWRMutate(queryKeys.docList(currentDoc.doctype)); // Mutate the list key

            // Clear draft after successful save
            localStorage.removeItem(`rfqDraft_${docId}`);
            
            return true; // Indicate success
        } catch (error: any) {
            console.error(`Error updating ${currentDoc.doctype} ${docId}:`, error);
            toast({ title: "Update Failed", description: error.message || "Could not save changes.", variant: "destructive" });
            return false; // Indicate failure
        } finally {
            setIsRedirecting("");
        }
    }, [docId, updateDoc, docMutate, globalSWRMutate, toast]);


    const handleProceedToReview = useCallback(async (
        currentDoc: ProgressDocument,
        currentRfqData: RFQData,
        currentSelectedVendorQuotes: Map<string, string>
    ) => {
        const success = await _updateDocument(currentDoc, currentRfqData, currentDoc.workflow_state, currentSelectedVendorQuotes);
        if (success) {
            toast({ title: "Selections Saved", description: "Proceeding to review mode.", variant: "success" });
            if(currentDoc.doctype === "Procurement Requests") {
                navigate(`/procurement-requests/${docId}?tab=In+Progress&mode=review`); // Or appropriate path
            } else if (currentDoc.doctype === "Sent Back Category") {
                navigate(`/sent-back-requests/${docId}?mode=review`);
            }
        }
    }, [_updateDocument, docId, navigate, toast]);


    const handleRevertPRChanges = useCallback(async (currentDoc: ProgressDocument) => {
        const success = await _updateDocument(currentDoc, null, "Approved"); // Pass null to clear rfq_data
        if (success) {
            toast({ title: "Reverted", description: `PR ${docId} reverted successfully. RFQ data cleared.`, variant: "success" });
            // Navigate to a previous state or list page
            navigate(`/procurement-requests?tab=New%20PR%20Request`); // Example
        }
    }, [_updateDocument, docId, navigate, toast]);
    
    // If you need a function just to save the draft without navigation or workflow change:
    const handleSaveDraft = useCallback(async (
        currentDoc: ProgressDocument,
        currentRfqData: RFQData,
        currentSelectedVendorQuotes: Map<string, string>
    ) => {
         const success = await _updateDocument(currentDoc, currentRfqData, currentDoc.workflow_state, currentSelectedVendorQuotes);
         if (success) {
            toast({ title: "Draft Saved", description: "Your RFQ progress has been saved.", variant: "success" });
         }
         return success;
    }, [_updateDocument, toast]);


    return {
        handleProceedToReview,
        handleRevertPRChanges,
        handleSaveDraft, // Expose if needed
        isUpdatingDocument: updateLoading, // Main loading state for updates
        isRedirecting, // For UI feedback during navigation post-action
    };
};