import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFrappeUpdateDoc, useSWRConfig } from 'frappe-react-sdk';
import { RFQData, ProcurementItem, ProcurementRequest, ProcurementItemWithVendor } from '@/types/NirmaanStack/ProcurementRequests';
import { SentBackCategory } from '@/types/NirmaanStack/SentBackCategory';
import { ProgressDocumentType, getItemListFromDocument } from '../types';
import { parseNumber } from '@/utils/parseNumber';
import { toast } from '@/components/ui/use-toast';
import { queryKeys } from '@/config/queryKeys';

interface UseProcurementActionsProps {
    prId: string;
    // The SWR mutate function for the specific document being updated
    docMutate: () => Promise<any>;
}

export const useProcurementActions = ({ prId, docMutate }: UseProcurementActionsProps) => {
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { mutate: globalSWRMutate } = useSWRConfig(); // For mutating list keys
    const navigate = useNavigate();

    const [isRedirecting, setIsRedirecting] = useState<string>(""); // For UI feedback

    const _updateDocument = useCallback(async (
        currentDoc: ProgressDocumentType,
        rfqDataPayload: RFQData | null, // Null for revert
        workflowStateUpdate?: string,
        finalSelectedVendorQuotes?: Map<string, string> // Pass this for review/save
    ) => {
        setIsRedirecting(workflowStateUpdate === "Approved" ? "revert_save" : "save"); // Indicate action type

        // Prepare the updated item list based on final selections for saving
        let updatedItemList: ProcurementItem[] = getItemListFromDocument(currentDoc).map((item: ProcurementItemWithVendor)  => {
            if (finalSelectedVendorQuotes && finalSelectedVendorQuotes.has(item.name)) {
                const selectedVendorId = finalSelectedVendorQuotes.get(item.name);
                const vendorQuoteData = rfqDataPayload?.details[item.name]?.vendorQuotes[selectedVendorId!];
                if (vendorQuoteData) {
                    return {
                        ...item,
                        vendor: selectedVendorId,
                        quote: parseNumber(vendorQuoteData.quote), // Ensure number
                        make: vendorQuoteData.make || item.make, // Prefer new make, fallback to item's make
                    };
                }
            }
            // If not selected or no quote, strip vendor/quote fields if they exist
            const { vendor, quote, ...rest } = item; // 'make' is kept as it's part of ProcurementItemBase
            return rest;
        });

        const updatePayload: Partial<ProcurementRequest | SentBackCategory> = {
            rfq_data: rfqDataPayload === null ? { selectedVendors: [], details: {} } : rfqDataPayload,
            workflow_state: workflowStateUpdate || currentDoc.workflow_state, // Keep current if not changing
        };

        if ('procurement_list' in currentDoc) {
            (updatePayload as Partial<ProcurementRequest>).procurement_list = { list: updatedItemList };
        } else if ('item_list' in currentDoc) {
            (updatePayload as Partial<SentBackCategory>).item_list = { list: updatedItemList as any }; // Cast as needed
        }

        try {
            await updateDoc(currentDoc.doctype, prId, updatePayload);
            await docMutate(); // Mutate the specific document SWR key
            await globalSWRMutate(queryKeys.docList(currentDoc.doctype)); // Mutate the list key

            // Clear draft after successful save
            localStorage.removeItem(`procurementDraft_${prId}`);
            
            return true; // Indicate success
        } catch (error: any) {
            console.error(`Error updating ${currentDoc.doctype} ${prId}:`, error);
            toast({ title: "Update Failed", description: error.message || "Could not save changes.", variant: "destructive" });
            return false; // Indicate failure
        } finally {
            setIsRedirecting("");
        }
    }, [prId, updateDoc, docMutate, globalSWRMutate, navigate, toast]);


    const handleProceedToReview = useCallback(async (
        currentDoc: ProgressDocumentType,
        currentRfqData: RFQData,
        currentSelectedVendorQuotes: Map<string, string>
    ) => {
        const success = await _updateDocument(currentDoc, currentRfqData, currentDoc.workflow_state, currentSelectedVendorQuotes);
        if (success) {
            toast({ title: "Selections Saved", description: "Proceeding to review mode.", variant: "success" });
            if(currentDoc.doctype === "Procurement Requests") {
                navigate(`/procurement-requests/${prId}?tab=In+Progress&mode=review`); // Or appropriate path
            } else if (currentDoc.doctype === "Sent Back Category") {
                navigate(`/sent-back-requests/${prId}?mode=review`);
            }
        }
    }, [_updateDocument, prId, navigate, toast]);


    const handleRevertPRChanges = useCallback(async (currentDoc: ProgressDocumentType) => {
        const success = await _updateDocument(currentDoc, null, "Approved"); // Pass null to clear rfq_data
        if (success) {
            toast({ title: "Reverted", description: `PR ${prId} reverted successfully. RFQ data cleared.`, variant: "success" });
            // Navigate to a previous state or list page
            navigate(`/procurement-requests?tab=New%20PR%20Request`); // Example
        }
    }, [_updateDocument, prId, navigate, toast]);
    
    // If you need a function just to save the draft without navigation or workflow change:
    const handleSaveDraft = useCallback(async (
        currentDoc: ProgressDocumentType,
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