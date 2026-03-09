import {
    useFrappeGetDocList,
    useFrappeGetDoc,
    useFrappePostCall,
} from "frappe-react-sdk";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

export const cashflowPlanKeys = {
    list: (projectId: string, category: string | string[], startDate?: string, endDate?: string) =>
        ["cashflow-plan", projectId, Array.isArray(category) ? category.join(',') : category, startDate || "all", endDate || "all"] as const,
    vendors: () => ["cashflow-plan", "vendors"] as const,
    materialPlans: (projectId: string) => ["cashflow-plan", "material-plans", projectId] as const,
    projectDoc: (projectId: string) => ["cashflow-plan", "projects", projectId] as const,
    poDoc: (poId: string) => ["cashflow-plan", "procurement-orders", poId] as const,
};

// 1. Projects Query
export const useProjectForCashflow = (projectId?: string) => {
    const response = useFrappeGetDoc(
        "Projects",
        projectId || "",
        projectId ? cashflowPlanKeys.projectDoc(projectId) : null
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectForCashflow",
        api: "Projects Doc",
        feature: "cashflow-plan",
        entity_id: projectId,
    });

    return response;
};

// 2. Cashflow Plan List Query
export const useCashflowPlans = (projectId: string, category: string | string[], dateRange?: { from?: Date; to?: Date }) => {
    const filters: any[] = [
        ["project", "=", projectId],
        Array.isArray(category) ? ["type", "in", category] : ["type", "=", category],
    ];

    let startDateStr = undefined;
    let endDateStr = undefined;

    if (dateRange?.from && dateRange?.to) {
        // frappe expects yyyy-mm-dd
        startDateStr = dateRange.from.toISOString().split("T")[0];
        endDateStr = dateRange.to.toISOString().split("T")[0];
        filters.push([
            "planned_date",
            "Between",
            [startDateStr, endDateStr]
        ]);
    }

    const response = useFrappeGetDocList<any>(
        "Cashflow Plan",
        {
            fields: ["*"],
            filters: filters,
            limit: 0,
        },
        projectId ? cashflowPlanKeys.list(projectId, category, startDateStr, endDateStr) : null
    );

    useApiErrorLogger(response.error, {
        hook: "useCashflowPlans",
        api: "Cashflow Plan List",
        feature: "cashflow-plan",
        entity_id: projectId,
    });

    return response;
};

// 3. Vendors List
export const useCashflowVendors = (isEnabled: boolean = true) => {
    const { data, isLoading, error } = useFrappeGetDocList<any>(
        "Vendors",
        {
            fields: ["name", "vendor_name"],
            filters: [["vendor_type", "!=", "Labour"]],
            limit: 0,
        },
        isEnabled ? cashflowPlanKeys.vendors() : null
    );

    useApiErrorLogger(error, {
        hook: "useCashflowVendors",
        api: "Vendors List",
        feature: "cashflow-plan",
    });

    return { data, isLoading, error };
};

// 4. Material Delivery Plans
export const useMaterialDeliveryPlans = (projectId: string) => {
    const response = useFrappeGetDocList<any>(
        "Material Delivery Plan",
        {
            fields: [
                "name",
                "item_name",
                "milestone",
                "po_type",
                "po_link",
                "work_package",
                "work_order",
                "rate",
                "ordered_qty",
                "uom",
                "planned_amount",
                "planned_delivery_date",
                "material_vendor",
            ],
            filters: [["project", "=", projectId]],
            limit: 0,
        },
        projectId ? cashflowPlanKeys.materialPlans(projectId) : null
    );

    useApiErrorLogger(response.error, {
        hook: "useMaterialDeliveryPlans",
        api: "Material Delivery Plan List",
        feature: "cashflow-plan",
        entity_id: projectId,
    });

    return response;
};

// 5. Procurement Order Query
export const useProcurementOrderForCashflow = (poId: string, enabled: boolean = true) => {
    const response = useFrappeGetDoc(
        "Procurement Orders",
        poId,
        (poId && enabled) ? cashflowPlanKeys.poDoc(poId) : null
    );

    useApiErrorLogger(response.error, {
        hook: "useProcurementOrderForCashflow",
        api: "Procurement Orders Doc",
        feature: "cashflow-plan",
        entity_id: poId,
    });

    return response;
};

// 5. Procurement Orders (For Edit PO Form)
export const useCashflowPO = (poId?: string, isEnabled: boolean = true) => {
    const shouldFetch = isEnabled && !!poId;
    const { data, isLoading, error } = useFrappeGetDoc(
        "Procurement Orders",
        poId || "",
        shouldFetch ? cashflowPlanKeys.poDoc(poId!) : null
    );

    useApiErrorLogger(error, {
        hook: "useCashflowPO",
        api: "useFrappeGetDoc Procurement Orders",
        feature: "cashflow-plan",
        entity_id: poId
    });

    return { data, isLoading, error };
};

// 6. Material Delivery Plan
export const useCashflowMaterialDeliveryPlans = (projectId: string) => {
    const { data, isLoading, error, mutate } = useFrappeGetDocList("Material Delivery Plan", {
        fields: ["name", "po_link", "package_name", "critical_po_category", "critical_po_task", "critical_po_sub_category", "delivery_date", "mp_items", "po_type"],
        filters: projectId ? [["project", "=", projectId]] : [],
        orderBy: { field: "creation", order: "desc" },
        limit: 0
    }, "Material Delivery Plan" + projectId);

    useApiErrorLogger(error, {
        hook: "useCashflowMaterialDeliveryPlans",
        api: "useFrappeGetDocList Material Delivery Plan",
        feature: "cashflow-plan",
    });

    return { data, isLoading, error, mutate };
};

// 7. Post Calls wrap
export const useCashflowCategoriesAndTasks = () => {
    const { call, result, loading, error } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_categories_and_tasks"
    );

    useApiErrorLogger(error, {
        hook: "useCashflowCategoriesAndTasks",
        api: "get_categories_and_tasks",
        feature: "cashflow-plan",
    });

    return { call, result, loading, error };
};

export const useCashflowDataV2 = () => {
    const { call, result, loading, error } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_material_plan_data_v2"
    );

    useApiErrorLogger(error, {
        hook: "useCashflowDataV2",
        api: "get_material_plan_data_v2",
        feature: "cashflow-plan",
    });

    return { call, result, loading, error };
};

export const useCashflowAllPOs = () => {
    const { call, result, loading, error } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.material_plan_api.get_all_project_pos"
    );

    useApiErrorLogger(error, {
        hook: "useCashflowAllPOs",
        api: "get_all_project_pos",
        feature: "cashflow-plan",
    });

    return { call, result, loading, error };
};

export const useCashflowWOs = () => {
    const { call, result, loading, error } = useFrappePostCall<any>(
        "nirmaan_stack.nirmaan_stack.doctype.work_orders.work_orders.get_wos"
    );

    useApiErrorLogger(error, {
        hook: "useCashflowWOs",
        api: "get_wos",
        feature: "cashflow-plan",
    });

    return { call, result, loading, error };
};

export const useCashflowProjectWOs = () => {
    const { call, result, loading, error } = useFrappePostCall<any>(
        "nirmaan_stack.api.seven_days_planning.cashflow_plan_api.get_all_project_wos"
    );

    useApiErrorLogger(error, {
        hook: "useCashflowProjectWOs",
        api: "get_all_project_wos",
        feature: "cashflow-plan",
    });

    return { call, result, loading, error };
};
