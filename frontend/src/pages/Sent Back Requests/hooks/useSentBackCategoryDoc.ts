// src/features/procurement/approve-sb-quotes/hooks/useSentBackCategoryDoc.ts
import { useFrappeGetDoc } from "frappe-react-sdk";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory"; // Adjust path
import { queryKeys } from "@/config/queryKeys"; // Adjust path

export const useSentBackCategoryDoc = (sbId?: string) => {
    const queryKey = sbId ? queryKeys.sentBackCategory.doc(sbId) : null;

    return useFrappeGetDoc<SentBackCategory>(
        "Sent Back Category", // Correct DocType name
        sbId, // Docname
        JSON.stringify(queryKey)
        // {
        //     queryKey: queryKey,
        //     enabled: enabled,
        //     // Fetch necessary fields, including the item_list JSON field
        //     fields: ["*", "item_list", "rfq_data"] // Add other JSON/child tables if needed
        // }
    );
};