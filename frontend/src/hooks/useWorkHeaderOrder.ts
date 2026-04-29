import { useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";

export const useWorkHeaderOrder = () => {
    const { data: workHeaders, isLoading: workHeadersLoading } = useFrappeGetDocList(
        "Work Headers",
        {
            fields: ["name", "order", "header_weightage"],
            orderBy: { field: "`order`", order: "asc" },
            limit: 0
        }
    );

    const workHeaderOrderMap = useMemo(() => {
        if (!workHeaders) return {};
        const map: Record<string, number> = {};
        workHeaders.forEach((header: any) => {
            map[header.name] = header.order ?? 9999;
        });
        return map;
    }, [workHeaders]);

    // Header-level weightage from Work Headers doctype.
    // Falls back to 1.0 when missing/0 so headers without an explicit weight
    // still participate in zone-level rollups.
    const headerWeightageMap = useMemo(() => {
        if (!workHeaders) return {};
        const map: Record<string, number> = {};
        workHeaders.forEach((header: any) => {
            const val = header.header_weightage;
            if (val === undefined || val === null || val === '') {
                map[header.name] = 1;
            } else {
                const w = Number(val);
                map[header.name] = Number.isFinite(w)
                    ? w : 1;
            }
        });
        return map;
    }, [workHeaders]);

    // TEMP DIAGNOSTIC — remove once header_weightage rollup is verified
    console.log('[useWorkHeaderOrder] raw workHeaders =', workHeaders);
    console.log('[useWorkHeaderOrder] headerWeightageMap =', headerWeightageMap);

    return { workHeaderOrderMap, headerWeightageMap, workHeadersLoading };
};
