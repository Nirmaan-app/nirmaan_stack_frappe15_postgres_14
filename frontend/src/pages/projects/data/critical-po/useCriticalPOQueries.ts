import {
    useFrappeGetDocList,
    useFrappeGetDoc,
} from "frappe-react-sdk";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { CriticalPOCategory } from "@/pages/CriticalPOCategories/components/CriticalPOCategoriesMaster";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

// ─── Critical PO Tasks Cache Keys (Standardized) ─────────────
export const criticalPOKeys = {
    tasks: (projectId: string) => ["critical-po", "tasks", projectId] as const,
    categories: () => ["critical-po", "categories"] as const,
    projectDoc: (projectId: string) => ["critical-po", "projectDoc", projectId] as const,
    procurementOrders: (projectId: string, wpCategory?: string) =>
        ["critical-po", "pos", projectId, wpCategory || "all"] as const,
    procurementRequests: (projectId: string, wpCategory?: string) =>
        ["critical-po", "prs", projectId, wpCategory || "all"] as const,
    allTasks: (projectId: string) => ["critical-po", "allTasks", projectId] as const,
};

// ─── Queries ─────────────────────────────────────────────────

/**
 * Fetches the Critical PO Tasks for a project (used in CriticalPOTasksTab)
 */
export const useCriticalPOTasks = (projectId: string) => {
    const response = useFrappeGetDocList<CriticalPOTask>(
        "Critical PO Tasks",
        {
            fields: [
                "name",
                "project",
                "critical_po_category",
                "project_name",
                "item_name",
                "sub_category",
                "po_release_date",
                "status",
                "associated_pos",
                "revised_date",
                "remarks",
            ],
            filters: [["project", "=", projectId]],
            limit: 0,
            orderBy: { field: "po_release_date", order: "asc" },
        },
        criticalPOKeys.tasks(projectId)
    );

    useApiErrorLogger(response.error, {
        hook: "useCriticalPOTasks",
        api: "Critical PO Tasks List",
        feature: "critical-po",
        entity_id: projectId,
    });

    return response;
};

/**
 * Fetches all Critical PO Categories (used in ManageSetupDialog & NoCriticalPOTasksView)
 */
export const useCriticalPOCategories = () => {
    const response = useFrappeGetDocList<CriticalPOCategory>(
        "Critical PO Category",
        {
            fields: ["name", "category_name"],
            limit: 0,
            orderBy: { field: "category_name", order: "asc" },
        },
        criticalPOKeys.categories()
    );

    useApiErrorLogger(response.error, {
        hook: "useCriticalPOCategories",
        api: "Critical PO Category List",
        feature: "critical-po",
    });

    return response;
};

/**
 * Fetches the Project document for linking POs (used in LinkPODialog & EditTaskDialog)
 */
export const useProjectDocForCriticalPO = (projectId: string, enabled: boolean = true) => {
    const response = useFrappeGetDoc<Projects>(
        "Projects",
        projectId,
        enabled ? criticalPOKeys.projectDoc(projectId) : null
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectDocForCriticalPO",
        api: "Projects Doc",
        feature: "critical-po",
        entity_id: projectId,
    });

    return response;
};

/**
 * Fetches Procurement Orders for a particular project and optional package 
 * (used in LinkPODialog & EditTaskDialog)
 */
export const useCriticalPOProcurementOrders = (
    projectId: string,
    selectedPackage: string | null,
    enabled: boolean = true
) => {
    const response = useFrappeGetDocList<ProcurementOrder>(
        "Procurement Orders",
        {
            fields: ["name", "status", "total_amount", "procurement_request"],
            filters: selectedPackage
                ? [
                    ["project", "=", projectId],
                    ["status", "not in", ["Merged", "Inactive", "PO Amendment"]],
                ]
                : undefined,
            limit: 0,
            orderBy: { field: "creation", order: "desc" },
        },
        (selectedPackage && enabled) ? criticalPOKeys.procurementOrders(projectId, selectedPackage) : null
    );

    useApiErrorLogger(response.error, {
        hook: "useCriticalPOProcurementOrders",
        api: "Procurement Orders List",
        feature: "critical-po",
        entity_id: projectId,
    });

    return response;
};

/**
 * Fetches Procurement Requests for a particular project (used in LinkPODialog & EditTaskDialog)
 */
export const useCriticalPOProcurementRequests = (
    projectId: string,
    selectedPackage: string | null,
    enabled: boolean = true
) => {
    const response = useFrappeGetDocList<ProcurementRequest>(
        "Procurement Requests",
        {
            fields: ["name", "work_package"],
            filters: [["project", "=", projectId]],
            limit: 0,
        },
        (selectedPackage && enabled) ? criticalPOKeys.procurementRequests(projectId, selectedPackage) : null
    );

    useApiErrorLogger(response.error, {
        hook: "useCriticalPOProcurementRequests",
        api: "Procurement Requests List",
        feature: "critical-po",
        entity_id: projectId,
    });

    return response;
};

/**
 * Fetches ALL Critical PO Tasks for a project. Used for cross-task conflict detection
 * (used in LinkPODialog & EditTaskDialog)
 */
export const useAllCriticalPOTasks = (projectId: string, enabled: boolean = true) => {
    const response = useFrappeGetDocList<CriticalPOTask>(
        "Critical PO Tasks",
        {
            fields: ["name", "item_name", "critical_po_category", "associated_pos"],
            filters: [["project", "=", projectId]],
            limit: 0,
        },
        enabled ? criticalPOKeys.allTasks(projectId) : null
    );

    useApiErrorLogger(response.error, {
        hook: "useAllCriticalPOTasks",
        api: "All Critical PO Tasks List",
        feature: "critical-po",
        entity_id: projectId,
    });

    return response;
};
