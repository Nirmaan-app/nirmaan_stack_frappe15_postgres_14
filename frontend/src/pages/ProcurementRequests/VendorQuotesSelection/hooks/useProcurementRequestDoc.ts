// src/features/procurement/progress/hooks/useProcurementRequestDoc.ts
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests"; // Adjust path
import { queryKeys } from "@/config/queryKeys"; // Adjust path

export const useProcurementRequestDoc = (prId?: string) => {
    const queryKey = prId ? queryKeys.procurementRequests.doc(prId) : null;

    return useFrappeGetDoc<ProcurementRequest>(
        "Procurement Requests",
        prId, // Docname
        JSON.stringify(queryKey)
        // {
        //     queryKey: queryKey, // Use centralized key
        //     enabled: enabled,   // Enable fetch only if prId exists
        //     // Request specific fields, including nested tables as objects
        //     fields: ["*", "procurement_list", "category_list", "rfq_data"]
        // }
    );
};