import { useMemo } from "react";
import {
    useFrappeGetDocList,
    useFrappeGetDoc,
} from "frappe-react-sdk";
import { ProjectTDSSetting } from "@/types/NirmaanStack/ProjectTDSSetting";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";
import type { ClientStatusFields, TdsProjectRow } from "@/utils/tdsRequestRules";

// ─── TDS Cache Keys (Standardized) ─────────────────────────────
export const tdsKeys = {
    settings: (projectId: string) => ["tds", "settings", projectId] as const,
    historyItems: (projectId: string) => ["tds", "historyItems", projectId] as const,
    projectDoc: (projectId: string) => ["tds", "projectDoc", projectId] as const,
    repositoryItems: () => ["tds", "repositoryItems"] as const,
    existingProjectItems: (projectId: string) => ["tds", "existingProjectItems", projectId] as const,
    nirmaanUsers: () => ["tds", "nirmaanUsers"] as const,
};

// ─── Queries ─────────────────────────────────────────────────

/**
 * Fetches the TDS Setting for a project (used in TDSRepositoryTab)
 */
export const useTdsSettings = (projectId?: string) => {
    const response = useFrappeGetDocList<ProjectTDSSetting>(
        "Project TDS Setting",
        {
            fields: ["*"],
            filters: [["tds_project_id", "=", projectId || ""]],
            limit: 1,
        },
        projectId ? tdsKeys.settings(projectId) : null
    );
    useApiErrorLogger(response.error, {
        hook: "useTdsSettings",
        api: "Project TDS Setting List",
        feature: "tds",
        entity_id: projectId,
    });
    return response;
};

/** A project's TDS row as `useTdsHistoryItems` reads it (the fields the exports use). */
export interface TdsHistoryRow extends ClientStatusFields {
    name: string;
    tds_request_id: string;
    tds_work_package: string;
    tds_category: string;
    tds_item_id: string;
    tds_item_name: string;
    tds_description: string;
    tds_make: string;
    tds_boq_line_item?: string;
    tds_attachment?: string;
    tds_status: string;
    tds_rejection_reason?: string;
    creation: string;
}

/**
 * Fetches all TDS history items for a project (used in TDSRepositoryView for export)
 */
export const useTdsHistoryItems = (projectId: string) => {
    const response = useFrappeGetDocList<TdsHistoryRow>(
        "Project TDS Item List",
        {
            fields: ["*"],
            filters: [["tdsi_project_id", "=", projectId]],
            limit: 0,
        },
        tdsKeys.historyItems(projectId)
    );
    useApiErrorLogger(response.error, {
        hook: "useTdsHistoryItems",
        api: "Project TDS Item List",
        feature: "tds",
        doctype: "Project TDS Item List",
        entity_id: projectId,
    });
    return response;
};

/**
 * Fetches the Project document (used in TDSRepositoryView for project name)
 */
export const useProjectDoc = (projectId: string) => {
    const response = useFrappeGetDoc(
        "Projects",
        projectId,
        tdsKeys.projectDoc(projectId)
    );
    useApiErrorLogger(response.error, {
        hook: "useProjectDoc",
        api: "Projects Doc",
        feature: "tds",
        doctype: "Projects",
        entity_id: projectId,
    });
    return response;
};

/**
 * Fetches the TDS Repository master items (used in TdsCreateForm)
 */
export const useTdsRepositoryItems = () => {
    const response = useFrappeGetDocList(
        "TDS Repository",
        {
            fields: [
                "name",
                "tds_item_id",
                "tds_item_name",
                "make",
                "description",
                "work_package",
                "category",
                "tds_attachment",
            ],
            limit: 0,
        },
        tdsKeys.repositoryItems()
    );
    useApiErrorLogger(response.error, {
        hook: "useTdsRepositoryItems",
        api: "TDS Repository List",
        feature: "tds",
        doctype: "TDS Repository",
    });
    return response;
};

/**
 * Fetches existing project TDS items to prevent duplicates (used in TdsCreateForm)
 */
/** A row already on the project, as `useTdsExistingProjectItems` reads it. */
export interface ExistingProjectRow extends TdsProjectRow, ClientStatusFields {
    name: string;
    tds_request_id?: string | null;
    tds_rejection_reason?: string | null;
}

export const useTdsExistingProjectItems = (projectId: string) => {
    const response = useFrappeGetDocList<ExistingProjectRow>(
        "Project TDS Item List",
        {
            fields: [
                "name", "tds_item_id", "tds_item_name", "tds_make", "tds_request_id", "tds_status", "tds_rejection_reason",
                "client_status", "client_status_by", "client_status_on", "client_rejection_reason",
            ],
            filters: [
                ["tdsi_project_id", "=", projectId],
                ["docstatus", "!=", 2],
            ],
            limit: 0,
            orderBy: { field: "creation", order: "desc" },
        },
        tdsKeys.existingProjectItems(projectId)
    );
    useApiErrorLogger(response.error, {
        hook: "useTdsExistingProjectItems",
        api: "Project TDS Item List (existing)",
        feature: "tds",
        doctype: "Project TDS Item List",
        entity_id: projectId,
    });
    return response;
};

/**
 * Fetches Nirmaan Users for owner mapping (used in TdsHistoryTable)
 */
export const useNirmaanUsers = () => {
    const response = useFrappeGetDocList<{ name: string; full_name?: string }>(
        "Nirmaan Users",
        {
            fields: ["name", "full_name"],
            limit: 0,
        },
        tdsKeys.nirmaanUsers()
    );
    useApiErrorLogger(response.error, {
        hook: "useNirmaanUsers",
        api: "Nirmaan Users List",
        feature: "tds",
        doctype: "Nirmaan Users",
    });
    return response;
};

/** Nirmaan users' full names by user id, for naming who marked a row (`clientStatusMarkedBy`). */
export const useNirmaanUserNames = (): ReadonlyMap<string, string> => {
    const { data } = useNirmaanUsers();
    return useMemo(
        () => new Map((data ?? []).filter(u => u.full_name).map(u => [u.name, u.full_name as string])),
        [data]
    );
};
