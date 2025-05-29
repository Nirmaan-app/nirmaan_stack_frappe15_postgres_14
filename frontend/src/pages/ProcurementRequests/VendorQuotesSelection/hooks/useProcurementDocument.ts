import { useFrappeGetDoc } from "frappe-react-sdk";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
import { queryKeys } from "@/config/queryKeys"; // You might need a generic key structure

type DocumentTypeParameter = "Procurement Requests" | "Sent Back Category";
type FetchedDocument<T extends DocumentTypeParameter> =
    T extends "Procurement Requests" ? ProcurementRequest :
    T extends "Sent Back Category" ? SentBackCategory :
    never;

export const useProcurementDocument = <T extends DocumentTypeParameter>(
    doctype: T,
    docId?: string
) => {
    // Construct a dynamic query key if needed, or keep it simple if context is always clear
    // For simplicity, assuming docId makes it unique enough for SWR here.
    // const swrKey = docId ? [doctype, docId] : null;
    // If using centralized queryKeys:
    const swrKey = docId ? queryKeys.doc(doctype, docId) : null; // You'd need a generic queryKeys.doc

    return useFrappeGetDoc<FetchedDocument<T>>(
        doctype,
        docId,
        // {
        //     // SWR config
        //     revalidateOnFocus: true, // Revalidate when tab gets focus
        //     // Request specific fields, including nested tables as objects
        //     // This is useful if your doctypes have many fields you don't need
        //     // fields: ["*", "procurement_list", "category_list", "rfq_data", "item_list" /* for SBC */]
        //     // For now, let's assume "*" is fine for simplicity, but optimize in production
        // },
        // If using queryKeys from a central file: JSON.stringify(swrKey)
        // Else, a simple string key:
        swrKey ? `${doctype}-${docId}` : undefined // SWR key, undefined to disable if no docId
    );
};