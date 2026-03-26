import { useMemo } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { ProjectGST } from "@/types/NirmaanStack/ProjectGST";

/**
 * Hook to fetch and transform GST details into the legacy format.
 * Centralized in src/hooks for use across the entire application.
 */
export const useGstOptions = () => {
    const { data: gstList, isLoading, error } = useFrappeGetDocList<ProjectGST>(
        "Project GST",
        {
            fields: ["*"],
            limit: 0,
        }
    );

    const gstOptions = useMemo(() => {
        return gstList?.map((item) => ({
            location: item.gst_name,
            gst: item.gstin,
            address: `${item.address || ""}, ${item.city || ""} - ${item.pincode || ""}, ${item.state || ""}`.replace(/,\s*,/g, ",").replace(/^,\s*/, "").replace(/,\s*$/, ""),
            city: item.city,
            state: item.state,
            pincode: item.pincode,
        })) || [];
    }, [gstList]);

    return { gstOptions, isLoading, error };
};
