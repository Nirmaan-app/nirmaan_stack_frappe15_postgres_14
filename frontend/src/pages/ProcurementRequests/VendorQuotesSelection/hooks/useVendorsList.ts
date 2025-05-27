import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { Vendors } from "@/types/NirmaanStack/Vendors"; // Adjust path
import { queryKeys, getVendorListOptions } from "@/config/queryKeys"; // Adjust path
import { VendorOption } from "../types";
import React from "react";

// Optional: Pass types if needed, otherwise use default
interface UseVendorsListProps {
    vendorTypes?: string[];
}

export const useVendorsList = ({ vendorTypes }: UseVendorsListProps = {}) => {
    const options = getVendorListOptions(vendorTypes); // Use default or passed types
    const queryKey = queryKeys.vendors.list(options);

    const { data, isLoading, error } = useFrappeGetDocList<Vendors>(
        "Vendors",
        options as GetDocListArgs<FrappeDoc<Vendors>>,
        JSON.stringify(queryKey)
    );

    const vendorOptions: VendorOption[] = React.useMemo(() =>
        data?.map(v => ({
            label: v.vendor_name,
            value: v.name,
            city: v.vendor_city,
            state: v.vendor_state,
        })) || [],
    [data]);

    return {
        data,
        allVendors: data, // Raw list if needed elsewhere
        vendorOptionsForSelect: vendorOptions, // Formatted for React Select
        isLoading,
        error
    };

};