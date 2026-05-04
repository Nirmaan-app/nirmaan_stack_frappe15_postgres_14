// frontend/src/pages/CommissionReport/data/useCommissionQueries.ts

import { useFrappeGetDoc, useFrappeGetDocList, useFrappeGetCall } from "frappe-react-sdk";
import { 
    ProjectCommissionReportType, 
    MasterDataResponse, 
    CommissionCategoryMaster,
    CommissionTaskMaster,
} from "../types";
import { 
    COMMISSION_REPORT_DOCTYPE, 
    COMMISSION_CATEGORY_DOCTYPE, 
    COMMISSION_TASK_MASTER_DOCTYPE, 
    WORK_PACKAGE_DOCTYPE, 
    PROJECTS_DOCTYPE, 
    commissionKeys 
} from "../commission.constants";
export { commissionKeys };
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

/**
 * Fetch the list of commission trackers
 */
export const useCommissionTrackerList = () => {
    const response = useFrappeGetCall<any>(
        "nirmaan_stack.api.commission_report.get_tracker_list.get_tracker_list",
        {},
        commissionKeys.trackerList()
    );
    useApiErrorLogger(response.error, {
        hook: "useCommissionTrackerList",
        api: "get_tracker_list",
        feature: "commission-report",
    });
    return response;
};

/**
 * Fetch a single commission tracker document
 */
export const useCommissionTrackerDoc = (trackerId: string) => {
    const response = useFrappeGetDoc<ProjectCommissionReportType>(
        COMMISSION_REPORT_DOCTYPE, 
        trackerId, 
        trackerId ? commissionKeys.trackerDoc(trackerId) : null
    );
    useApiErrorLogger(response.error, {
        hook: "useCommissionTrackerDoc",
        api: "Get Doc",
        feature: "commission-report",
        doctype: COMMISSION_REPORT_DOCTYPE,
        entity_id: trackerId,
    });
    return response;
};

/**
 * Fetch all master data (projects, users, categories) in one call
 */
export const useCommissionMasterData = () => {
    const response = useFrappeGetCall<{ message: MasterDataResponse }>(
        "nirmaan_stack.api.commission_report.tracker_options.get_all_master_data",
        {},
        commissionKeys.masterData()
    );
    useApiErrorLogger(response.error, {
        hook: "useCommissionMasterData",
        api: "get_all_master_data",
        feature: "commission-report",
    });
    return response;
};

/**
 * Fetch commission categories for master configuration
 */
export const useCategoryList = (orderBy?: { field: string; order: 'asc' | 'desc' }) => {
    const response = useFrappeGetDocList<CommissionCategoryMaster>(
        COMMISSION_CATEGORY_DOCTYPE,
        { 
            fields: ["name", "category_name", "work_package"], 
            limit: 0, 
            orderBy: orderBy || { field: "creation", order: "asc" } 
        },
        commissionKeys.categoryList(orderBy)
    );
    useApiErrorLogger(response.error, {
        hook: "useCategoryList",
        api: "Get Doc List",
        feature: "commission-report",
        doctype: COMMISSION_CATEGORY_DOCTYPE,
    });
    return response;
};

/**
 * Fetch commission tasks for master configuration
 */
export const useCommissionTaskList = (orderBy?: { field: string; order: 'asc' | 'desc' }) => {
    const response = useFrappeGetDocList<CommissionTaskMaster>(
        COMMISSION_TASK_MASTER_DOCTYPE,
        { 
            fields: ["name", "task_name", "category_link", "deadline_offset", "source_format", "is_active"],
            limit: 0,
            orderBy: orderBy || { field: "creation", order: "asc" }
        },
        commissionKeys.taskList(orderBy)
    );
    useApiErrorLogger(response.error, {
        hook: "useCommissionTaskList",
        api: "Get Doc List",
        feature: "commission-report",
        doctype: COMMISSION_TASK_MASTER_DOCTYPE,
    });
    return response;
};

/**
 * Fetch work packages for dropdowns
 */
export const useWorkPackageList = (orderBy?: { field: string; order: 'asc' | 'desc' }) => {
    const response = useFrappeGetDocList<any>(
        WORK_PACKAGE_DOCTYPE,
        { 
            fields: ["name", "work_package_name"], 
            limit: 0, 
            orderBy: orderBy || { field: "work_package_name", order: "asc" } 
        },
        commissionKeys.workPackageList(orderBy)
    );
    useApiErrorLogger(response.error, {
        hook: "useWorkPackageList",
        api: "Get Doc List",
        feature: "commission-report",
        doctype: WORK_PACKAGE_DOCTYPE,
    });
    return response;
};

/**
 * Fetch project zones for tracker creation
 */
export const useProjectZones = (projectId: string) => {
    const response = useFrappeGetDoc<{
        project_zones?: Array<{ zone_name: string }>;
        enable_project_milestone_tracking?: number;
    }>(
        PROJECTS_DOCTYPE,
        projectId || "",
        projectId ? commissionKeys.projectZones(projectId) : null
    );
    useApiErrorLogger(response.error, {
        hook: "useProjectZones",
        api: "Get Doc",
        feature: "commission-report",
        doctype: PROJECTS_DOCTYPE,
        entity_id: projectId,
    });
    return response;
};

/**
 * Fetch project assignees from Nirmaan User Permissions for a given project
 */
export const useCommissionProjectAssignees = (projectId: string) => {
    const response = useFrappeGetDocList<{ user: string }>(
        "Nirmaan User Permissions",
        {
            fields: ["user"],
            limit: 0,
            filters: [
                ["for_value", "=", projectId],
                ["allow", "=", "Projects"],
            ],
        },
        projectId ? commissionKeys.projectAssignees(projectId) : null
    );
    useApiErrorLogger(response.error, {
        hook: "useCommissionProjectAssignees",
        api: "Get Doc List",
        feature: "commission-report",
        doctype: "Nirmaan User Permissions",
        entity_id: projectId,
    });
    return response;
};
