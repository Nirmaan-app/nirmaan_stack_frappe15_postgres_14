// src/features/procurement/progress/hooks/useProcurementUpdates.ts
import { useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk";
import { ProcurementItem, RFQData } from "@/types/NirmaanStack/ProcurementRequests"; // Adjust path
import { queryKeys } from "@/config/queryKeys"; // Adjust path
import { KeyedMutator } from 'swr'; // Import if using specific mutate type
import { FrappeDoc } from 'frappe-react-sdk'; // Import if using specific mutate type
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests"; // Adjust path
import { useCallback } from "react";

interface UseProcurementUpdatesProps {
    prId: string;
    // Define a more specific type for prMutate if possible
    prMutate: KeyedMutator<FrappeDoc<ProcurementRequest>> | (() => Promise<any>);
}

type UpdateAction = 'review' | 'revert' | 'view' | string; // Allow specific actions or string

export const useProcurementUpdates = ({ prId, prMutate }: UseProcurementUpdatesProps) => {
    const { updateDoc, loading } = useFrappeUpdateDoc();
    const { mutate: globalMutate } = useSWRConfig(); // Use global mutate for broader cache updates if needed

    const updateProcurementData = useCallback(async (
        rfqDataPayload: RFQData | null, // Use null for revert explicitely
        updatedProcurementList: ProcurementItem[],
        action: UpdateAction // For potential future use
    ) => {
        if (!prId) {
            console.error("Cannot update PR: prId is missing.");
            throw new Error("PR ID is required for updates.");
        }

        try {
            const updatePayload: Partial<ProcurementRequest> = {
                procurement_list: { list: updatedProcurementList },
            };

            // Only include rfq_data if it's not null (handle revert case)
            if (rfqDataPayload !== null) {
                updatePayload.rfq_data = rfqDataPayload;
            } else {
                 // Explicitly set to empty object when reverting, if backend expects this
                 updatePayload.rfq_data = { selectedVendors: [], details: {} };
             }

            // Only update workflow_state if reverting
            if (action === "revert") {
                updatePayload.workflow_state = "Approved";
            }

            await updateDoc("Procurement Requests", prId, updatePayload);

            // Mutate the specific document cache using the centralized key
            await prMutate(); // Call the specific mutate function passed in

            // Optional: Mutate related list keys if necessary
            // await globalMutate(queryKeys.procurementRequests.list()); // If you have a list view

        } catch (error) {
            console.error(`Error updating PR ${prId} for action ${action}:`, error);
            // Re-throw or handle error appropriately (e.g., show toast)
            throw error; // Let the caller handle UI feedback
        }
    }, [prId, updateDoc, prMutate, globalMutate]); // Dependencies for useCallback

    return { updateProcurementData, loading };
};