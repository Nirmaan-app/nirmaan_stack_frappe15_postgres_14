// frontend/src/pages/ProjectDesignTracker/hooks/useTeamSummary.ts

import { useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import {
    UNASSIGNED_SENTINEL,
    TaskPreviewFilter,
    TaskPreviewItem,
    TeamSummaryFilters,
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

export const useTeamSummary = (filters?: TeamSummaryFilters, taskPhase?: string): UseTeamSummaryReturn => {
    // Extract primitive values for cache key (React best practice - avoid object references)
    const projectIds = filters?.projects?.map(p => p.value).sort().join(',') || '';

    // Build primitive cache key
    const cacheKey = useMemo(() => {
        const parts = ['team-summary'];
        if (projectIds) parts.push(`projects:${projectIds}`);
        if (filters?.deadlineFrom) parts.push(`from:${filters.deadlineFrom}`);
        if (filters?.deadlineTo) parts.push(`to:${filters.deadlineTo}`);
        if (taskPhase) parts.push(`phase:${taskPhase}`);
        return parts.join('|');
    }, [projectIds, filters?.deadlineFrom, filters?.deadlineTo, taskPhase]);

    // Build params object for API call
    const params = useMemo(() => {
        const p: Record<string, string> = {};
        // Send projects as JSON array
        if (filters?.projects && filters.projects.length > 0) {
            p.projects = JSON.stringify(filters.projects.map(proj => proj.value));
        }
        if (filters?.deadlineFrom) p.deadline_from = filters.deadlineFrom;
        if (filters?.deadlineTo) p.deadline_to = filters.deadlineTo;
        if (taskPhase) p.task_phase = taskPhase;
        return p;
    }, [projectIds, filters?.deadlineFrom, filters?.deadlineTo, taskPhase]);

    const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: TeamSummaryResponse }>(
        "nirmaan_stack.api.design_tracker.get_team_summary.get_team_summary",
        params,
        cacheKey
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
    refetch: () => void;
}

export const useFilteredTasks = (filter: TaskPreviewFilter | null): UseFilteredTasksReturn => {
    // Derive primitive key for SWR deduplication (prevents re-renders from object reference changes)
    // Include all filter params to ensure cache key changes when filters change
    const projectsKey = filter?.projectIds?.sort().join(',') || '';
    const cacheKey = filter
        ? `task-preview-${filter.user_id}-${filter.status}-${filter.project_id || projectsKey || 'all'}-${filter.deadlineFrom || ''}-${filter.deadlineTo || ''}-${filter.taskPhase || ''}`
        : null;

    // Build filters array for the API
    // The get_task_wise_list API uses Python-side filtering with filters like [field, op, val]
    const filters = filter
        ? [
            ["task_status", "=", filter.status],
            // Project filter: single project (from project-row click) OR multi-project (from filter bar)
            ...(filter.project_id
                ? [["project", "=", filter.project_id]]
                : filter.projectIds?.length
                    ? [["project", "in", filter.projectIds]]
                    : []),
            // Add deadline range filter if provided (matches summary filter behavior)
            ...(filter.deadlineFrom && filter.deadlineTo
                ? [["deadline", "between", [filter.deadlineFrom, filter.deadlineTo]]]
                : []),
        ]
        : null;

    // Conditional fetch: undefined params = disabled (SWR pattern)
    // When cacheKey is null/undefined, useFrappeGetCall won't fetch
    const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: TaskWiseListResponse }>(
        "nirmaan_stack.api.design_tracker.get_task_wise_list.get_task_wise_list",
        filter
            ? {
                filters: JSON.stringify(filters),
                limit_page_length: 100,
                order_by: "deadline asc",
                ...(filter.taskPhase ? { task_phase: filter.taskPhase } : {}),
            }
            : undefined,
        cacheKey ?? undefined // Only fetches when cacheKey is truthy
    );

    // Client-side filter for assigned_designers
    // Parse the JSON field to extract userIds and match exactly
    const filteredTasks = (data?.message?.data || []).filter((task) => {
        if (!filter) return true;

        // Special case: filter for unassigned tasks
        if (filter.user_id === UNASSIGNED_SENTINEL) {
            const raw = task.assigned_designers;
            if (!raw || raw === '' || raw === '[]' || raw === '{"list":[]}') return true;
            try {
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (Array.isArray(parsed) && parsed.length === 0) return true;
                if (parsed && typeof parsed === 'object' && Array.isArray(parsed.list) && parsed.list.length === 0) return true;
            } catch {
                // If parsing fails, treat as non-empty (assigned)
            }
            return false;
        }

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
        refetch: mutate,
    };
};
