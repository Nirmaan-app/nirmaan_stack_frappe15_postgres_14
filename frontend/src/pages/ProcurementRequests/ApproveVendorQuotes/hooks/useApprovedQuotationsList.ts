import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations"; // Adjust path
import { queryKeys, getApprovedQuotationOptions } from "@/config/queryKeys"; // Adjust path

export const useApprovedQuotationsList = () => {
    const options = getApprovedQuotationOptions();
    const queryKey = queryKeys.approvedQuotations.list(options);

    return useFrappeGetDocList<ApprovedQuotations>("Approved Quotations", options as GetDocListArgs<FrappeDoc<ApprovedQuotations>>, JSON.stringify(queryKey));
};