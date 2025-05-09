// src/features/procurement/approve-reject-quotes/hooks/useApproveRejectPRDoc.ts
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests"; // Adjust path
import { queryKeys } from "@/config/queryKeys"; // Adjust path

export const useApproveRejectPRDoc = (prId?: string) => {
    const queryKey = prId ? queryKeys.procurementRequests.doc(prId) : null;

    return useFrappeGetDoc<ProcurementRequest>(
        "Procurement Requests",
        prId, // Docname
        JSON.stringify(queryKey)
        // {
        //     queryKey: queryKey,
        //     enabled: enabled,
        //     // Ensure all required fields are fetched, esp. JSON fields
        //     fields: ["*", "procurement_list", "category_list", "rfq_data"]
        // }
    );
};