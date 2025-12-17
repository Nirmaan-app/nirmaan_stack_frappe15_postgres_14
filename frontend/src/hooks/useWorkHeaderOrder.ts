import { useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";

export const useWorkHeaderOrder = () => {
    const { data: workHeaders, isLoading: workHeadersLoading } = useFrappeGetDocList(
        "Work Headers",
        {
            fields: ["name", "order"],
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

    return { workHeaderOrderMap, workHeadersLoading };
};
