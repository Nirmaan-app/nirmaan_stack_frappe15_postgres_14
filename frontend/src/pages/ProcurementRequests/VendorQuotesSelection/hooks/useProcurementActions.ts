
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

         // --- STEP 1: VALIDATION LOGIC ---
    const uniqueSelectedVendors = new Set(currentSelectedVendorQuotes.values());
    const vendorsWithOnlyCharges: string[] = [];
    const itemCategoryMap = new Map(getItemListFromDocument(currentDoc).map(item => [item.item_id, item.category]));

    uniqueSelectedVendors.forEach(vendorId => {
        const itemsForThisVendor = Array.from(currentSelectedVendorQuotes.entries())
            .filter(([itemId, v]) => v === vendorId)
            .map(([itemId, v]) => itemId);

        const hasOnlyCharges = itemsForThisVendor.every(itemId => {
            return itemCategoryMap.get(itemId) === 'Additional Charges';
        });

        if (hasOnlyCharges && itemsForThisVendor.length > 0) {
            vendorsWithOnlyCharges.push(vendorId);
        }
    });

    if (vendorsWithOnlyCharges.length > 0) {
        // --- THE CHANGE: We now get the vendor names from `currentRfqData` ---
        const vendorNames = vendorsWithOnlyCharges
            .map(id => {
                // Find the vendor in the rfqData's selectedVendors array.
                const vendorInfo = currentRfqData.selectedVendors.find(v => v.value === id);
                return vendorInfo ? vendorInfo.label : id; // Use the label if found, otherwise fall back to the ID.
            })
            .join(', ');
        
        toast({
            title: "Invalid Selection",
            description: `You have selected charges for "${vendorNames}" without selecting any of their main products. Please deselect these charges or add a product from this vendor or Remove Vendor.`,
            variant: "destructive",
            duration: 10000,
        });
        return; 
    }
    // --- END OF VALIDATION For Remove vendor or Charge for That vendor  ---
        setIsRedirecting("review_save");
        const approvedProductItems: Partial<ProcurementRequestItemDetail>[] = [];
        const delayedProductItems: Partial<ProcurementRequestItemDetail>[] = [];

        const allProductItems = getItemListFromDocument(currentDoc)
            .filter(item => item.category !== 'Additional Charges');

            // console.log("allProductItems",allProductItems)

        // 1. Loop through all product items to determine their fate
        allProductItems.forEach(docItem => {
            const selectedVendorId = currentSelectedVendorQuotes.get(docItem.item_id);

            if (selectedVendorId) {
                // This item has a selected vendor, so put it in the "approved" bowl.
                const quoteData = currentRfqData.details[docItem.item_id]?.vendorQuotes[selectedVendorId];
                approvedProductItems.push({
                    ...docItem,
                    vendor: selectedVendorId,
                    quote: parseNumber(quoteData?.quote),
                    make: quoteData?.make || docItem.make,
                    status: 'Pending' // Its status is still "Pending" for the next approval step.
                });
            } else {
                // **THE FIX:** This item was NOT selected. Put it in the "delayed" bowl.
                delayedProductItems.push({
                    ...docItem,
                    status: 'Delayed', // We explicitly change the status here!
                    vendor: undefined,   // We also clear out any old vendor data.
                    quote: undefined,
                });
            }
        });

        // 2. --- MODIFIED: Prepare final charges list from rfqFormData ---
        const finalChargesList: Partial<ProcurementRequestItemDetail>[] = [];
        
        if (currentRfqData.chargesByVendor) {
            const selectedVendors = new Set(currentSelectedVendorQuotes.values());
            Object.entries(currentRfqData.chargesByVendor).forEach(([vendorId, charges]) => {
                // Only include charges for vendors who have at least one item selected
                if (selectedVendors.has(vendorId)) {
                    charges.forEach(charge => {
                        // Only include charges that have a quote entered
                        if (charge.quote > 0) {
                            finalChargesList.push({
                                // --- THIS IS THE KEY CHANGE ---
                                // We use the stored identifiers from the charge item
                                item_id: charge.item_id,
                                item_name: charge.item_name,
                                // ---
                                category: 'Additional Charges',
                                unit: 'NOS',
                                quantity: 1,
                                tax: charge.tax,
                                quote: charge.quote,
                                vendor: vendorId,
                                status: 'Pending', // Or appropriate status
                                procurement_package: currentDoc.procurement_package || '',
                            });
                        }
                    });
                }
            });
        }

        // 3. Combine the lists and create the final payload
        const finalPayload: Partial<ProgressDocument> = {
            rfq_data: currentRfqData,
            order_list: [
                ...approvedProductItems,
                ...delayedProductItems,
                ...finalChargesList
            ] as ProcurementRequestItemDetail[],
        };
        // This is just cleaning the temporary payload object before sending it
        if ('procurement_list' in finalPayload) delete (finalPayload as any).procurement_list;
        if ('item_list' in finalPayload) delete (finalPayload as any).item_list;

        // 4. Save to backend and navigate
        try {
            await updateDoc(currentDoc.doctype, docId, finalPayload);
            await docMutate();
            localStorage.removeItem(`rfqDraft_${docId}`);
            toast({ title: "Selections Saved", description: "Proceeding to final review.", variant: "success" });

            const reviewUrl = currentDoc.doctype === "Procurement Requests"
                ? `/procurement-requests/${docId}?tab=In+Progress&mode=review`
                : `/sent-back-requests/${docId}?mode=review`;
            navigate(reviewUrl);

        } catch (error: any) {
            toast({ title: "Error", description: `Could not save final selections: ${error.message}`, variant: "destructive" });
        } finally {
            setIsRedirecting("");
        }
    }, [docId, navigate, updateDoc, docMutate]);


    //-------
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

