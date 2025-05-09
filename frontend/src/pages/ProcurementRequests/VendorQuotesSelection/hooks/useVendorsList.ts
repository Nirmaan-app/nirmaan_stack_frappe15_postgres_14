// src/features/procurement/progress/hooks/useVendorsList.ts
import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { Vendors } from "@/types/NirmaanStack/Vendors"; // Adjust path
import { queryKeys, getVendorListOptions } from "@/config/queryKeys"; // Adjust path

// Optional: Pass types if needed, otherwise use default
interface UseVendorsListProps {
    vendorTypes?: string[];
}

export const useVendorsList = ({ vendorTypes }: UseVendorsListProps = {}) => {
    const options = getVendorListOptions(vendorTypes); // Use default or passed types
    const queryKey = queryKeys.vendors.list(options);

    return useFrappeGetDocList<Vendors>(
        "Vendors",
        options as GetDocListArgs<FrappeDoc<Vendors>>,
        JSON.stringify(queryKey)
    );
};