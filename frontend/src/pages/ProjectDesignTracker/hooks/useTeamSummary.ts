// frontend/src/pages/ProjectDesignTracker/hooks/useTeamSummary.ts

import { useFrappeGetCall } from "frappe-react-sdk";
import {
    TaskPreviewFilter,
    TaskPreviewItem,
    TeamSummaryResponse,
} from "../types";

// ==================== useTeamSummary Hook ====================
// Fetches aggregated team summary data: User -> Project -> Status counts

interface UseTeamSummaryReturn {
    summaryData: TeamSummaryResponse | undefined;
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
}

export const useTeamSummary = (): UseTeamSummaryReturn => {
    const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: TeamSummaryResponse }>(
        "nirmaan_stack.api.design_tracker.get_team_summary.get_team_summary",
        {},
        "team-summary-data" // SWR cache key
    );

    return {
        summaryData: data?.message,
        isLoading,
        error: error instanceof Error ? error : null,
        refetch: mutate,
    };
};


// ==================== useFilteredTasks Hook ====================
// Fetches tasks for the task preview dialog with filtering
// Uses primitive cache key for SWR deduplication (Vercel best practice)

interface TaskWiseListResponse {
    data: TaskPreviewItem[];
    total_count: number;
}

interface UseFilteredTasksReturn {
    tasks: TaskPreviewItem[];
    isLoading: boolean;
    error: Error | null;
}

export const useFilteredTasks = (filter: TaskPreviewFilter | null): UseFilteredTasksReturn => {
    // Derive primitive key for SWR deduplication (prevents re-renders from object reference changes)
    const cacheKey = filter
        ? `task-preview-${filter.user_id}-${filter.status}-${filter.project_id || 'all'}`
        : null;

    // Build filters array for the API
    // The get_task_wise_list API uses Python-side filtering with filters like [field, op, val]
    const filters = filter
        ? [
            ["task_status", "=", filter.status],
            // Project filter is applied if project_id is provided
            ...(filter.project_id ? [["project", "=", filter.project_id]] : []),
        ]
        : null;

    // Conditional fetch: undefined params = disabled (SWR pattern)
    // When cacheKey is null/undefined, useFrappeGetCall won't fetch
    const { data, isLoading, error } = useFrappeGetCall<{ message: TaskWiseListResponse }>(
        "nirmaan_stack.api.design_tracker.get_task_wise_list.get_task_wise_list",
        filter
            ? {
                filters: JSON.stringify(filters),
                limit_page_length: 100,
                order_by: "deadline asc",
            }
            : undefined,
        cacheKey ?? undefined // Only fetches when cacheKey is truthy
    );

    // Client-side filter for assigned_designers
    // Parse the JSON field to extract userIds and match exactly
    const filteredTasks = (data?.message?.data || []).filter((task) => {
        if (!filter) return true;

        const designerField = task.assigned_designers;
        let userIds: string[] = [];

        if (designerField) {
            try {
                const parsed = typeof designerField === 'string'
                    ? JSON.parse(designerField)
                    : designerField;

                if (parsed && typeof parsed === 'object' && Array.isArray(parsed.list)) {
                    // Format: {"list": [{userId, userName, userEmail}, ...]}
                    userIds = parsed.list
                        .map((item: unknown) => typeof item === 'object' && item !== null && 'userId' in item
                            ? (item as { userId: string }).userId
                            : item)
                        .filter((id: unknown): id is string => typeof id === 'string');
                } else if (Array.isArray(parsed)) {
                    // Legacy format: ["user@example.com", ...]
                    userIds = parsed.map((item: unknown) =>
                        typeof item === 'object' && item !== null && 'userId' in item
                            ? (item as { userId: string }).userId
                            : item
                    ).filter((id: unknown): id is string => typeof id === 'string');
                }
            } catch {
                // Fallback: if JSON parsing fails, try substring match
                return String(designerField).includes(filter.user_id);
            }
        }

        // Exact match against extracted user IDs
        return userIds.includes(filter.user_id);
    });

    return {
        tasks: filteredTasks,
        isLoading,
        error: error instanceof Error ? error : null,
    };
};
