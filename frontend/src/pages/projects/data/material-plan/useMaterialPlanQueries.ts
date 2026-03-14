import {
    useFrappeGetDocList,
    useFrappeGetDoc,
} from "frappe-react-sdk";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

// ---------------------------------------------------------------------------
// SWR Cache Key Factory
// ---------------------------------------------------------------------------
export const materialPlanKeys = {
    projectDoc: (projectId: string) =>
        ["material-plan", "projects", projectId] as const,
    list: (projectId: string, filtersKey: string) =>
        ["material-plan", "list", projectId, filtersKey] as const,
    poDoc: (poId: string) =>
        ["material-plan", "procurement-orders", poId] as const,
};

// ---------------------------------------------------------------------------
// 1. Project Document (for packages and project_name)
// ---------------------------------------------------------------------------
export const useProjectDocForMaterialPlan = (projectId?: string) => {
    const isEnabled = !!projectId;
    const response = useFrappeGetDoc(
        "Projects",
        projectId || "",
        isEnabled ? materialPlanKeys.projectDoc(projectId!) : null
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectDocForMaterialPlan",
        api: "Projects Doc",
        feature: "material-plan",
        entity_id: projectId,
    });

    return response;
};

// ---------------------------------------------------------------------------
// 2. Material Delivery Plans List
// ---------------------------------------------------------------------------
export const useMaterialDeliveryPlans = (
    projectId: string,
    docListFilters: any[]
) => {
    const filtersKey = JSON.stringify(docListFilters);

    const response = useFrappeGetDocList("Material Delivery Plan" as any, {
        fields: [
            "name",
            "po_link",
            "package_name",
            "critical_po_category",
            "critical_po_task",
            "critical_po_sub_category",
            "delivery_date",
            "mp_items",
            "creation",
            "po_type",
        ] as any,
        filters: docListFilters,
        orderBy: { field: "creation", order: "desc" },
        limit: 0,
    },
        materialPlanKeys.list(projectId, filtersKey)
    );

    useApiErrorLogger(response.error, {
        hook: "useMaterialDeliveryPlans",
        api: "Material Delivery Plan List",
        feature: "material-plan",
        entity_id: projectId,
    });

    return response;
};

// ---------------------------------------------------------------------------
// 3. Procurement Order Document (for Edit form)
// ---------------------------------------------------------------------------
export const useProcurementOrderDoc = (
    poLink: string | null | undefined,
    enabled: boolean = true
) => {
    const shouldFetch = enabled && !!poLink;

    const response = useFrappeGetDoc<any>(
        "Procurement Orders",
        poLink || "",
        shouldFetch ? materialPlanKeys.poDoc(poLink!) : null
    );

    useApiErrorLogger(response.error, {
        hook: "useProcurementOrderDoc",
        api: "Procurement Orders Doc",
        feature: "material-plan",
        entity_id: poLink || undefined,
    });

    return response;
};
