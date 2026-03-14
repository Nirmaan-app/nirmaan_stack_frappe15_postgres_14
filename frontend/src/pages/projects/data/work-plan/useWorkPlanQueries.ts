import { useFrappeGetCall, useFrappeGetDoc } from "frappe-react-sdk";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

// Re-export the WorkPlanItem type from SevendaysWorkPlan for convenience
export interface WorkPlanItem {
    project: string;
    zone: string;
    work_milestone_name: string;
    work_header: string;
    status: string;
    progress: number;
    expected_starting_date: string;
    expected_completion_date: string;
    work_plan_doc?: WorkPlanDoc[];
    source: string;
    weightage?: number;
    dpr_name?: string;
}

export interface WorkPlanDoc {
    name: string;
    wp_title: string;
    wp_status: string;
    wp_start_date: string;
    wp_end_date: string;
    wp_description: string;
    wp_progress?: string | number;
    wp_estimate_completion_date?: string;
    wp_remarks?: string;
}

// ---------------------------------------------------------------------------
// SWR Cache Key Factory
// ---------------------------------------------------------------------------
export const workPlanKeys = {
    workPlanData: (projectId: string, startDate?: string, endDate?: string) =>
        ["work-plan", "data", projectId, startDate || "all", endDate || "all"] as const,
    projectDoc: (projectId: string) =>
        ["work-plan", "projects", projectId] as const,
};

// ---------------------------------------------------------------------------
// 1. Work Plan Data (main milestones + tasks API)
// ---------------------------------------------------------------------------
export const useWorkPlanData = (
    projectId: string,
    startDate?: string,
    endDate?: string
) => {
    const shouldFetch = !!projectId;

    const swrKey = shouldFetch
        ? "nirmaan_stack.api.seven_days_planning.work_plan_api.get_work_plan"
        : null;

    const response = useFrappeGetCall<{
        message: {
            data: Record<string, WorkPlanItem[]>;
            reason: string | null;
        };
    }>(
        swrKey as string,
        shouldFetch
            ? {
                project: projectId,
                start_date: startDate || undefined,
                end_date: endDate || undefined,
            }
            : undefined,
        shouldFetch
            ? workPlanKeys.workPlanData(projectId, startDate, endDate)
            : undefined
    );

    useApiErrorLogger(response.error, {
        hook: "useWorkPlanData",
        api: "get_work_plan",
        feature: "work-plan",
        entity_id: projectId,
    });

    return response;
};

// ---------------------------------------------------------------------------
// 2. Project Document (for zones)
// ---------------------------------------------------------------------------
export const useProjectDocForWorkPlan = (projectId?: string) => {
    const isEnabled = !!projectId;

    const response = useFrappeGetDoc(
        "Projects",
        projectId || "",
        isEnabled ? workPlanKeys.projectDoc(projectId!) : null
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectDocForWorkPlan",
        api: "Projects Doc",
        feature: "work-plan",
        entity_id: projectId,
    });

    return response;
};
