// frontend/src/pages/projects/CriticalPOTasks/utils.tsx
// Utility functions for Critical PO Tasks

import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";

/**
 * Status styling configuration for Critical PO Tasks
 * Color scheme:
 * - PR Not Released -> Purple (pre-requisite missing)
 * - Not Released -> Red (blocked)
 * - Partially Released -> Yellow (in progress)
 * - Released -> Green (complete)
 * - Not Applicable -> Gray (skip)
 */
export const getCriticalPOStatusStyle = (status: string): string => {
    switch (status) {
        case "PR Not Released":
            return "bg-purple-50 text-purple-700 border border-purple-200";
        case "Not Released":
            return "bg-red-50 text-red-700 border border-red-200";
        case "Partially Released":
            return "bg-yellow-50 text-yellow-700 border border-yellow-200";
        case "Released":
            return "bg-green-50 text-green-700 border border-green-200";
        case "Not Applicable":
            return "bg-gray-50 text-gray-500 border border-gray-200";
        default:
            return "bg-gray-50 text-gray-700 border border-gray-200";
    }
};

/**
 * Get badge variant color classes for status display in summary
 */
export const getStatusBadgeVariant = (status: string): string => {
    switch (status) {
        case "PR Not Released":
            return "bg-purple-100 text-purple-700";
        case "Not Released":
            return "bg-red-100 text-red-700";
        case "Partially Released":
            return "bg-yellow-100 text-yellow-700";
        case "Released":
            return "bg-green-100 text-green-700";
        case "Not Applicable":
            return "bg-gray-100 text-gray-500";
        default:
            return "bg-gray-100 text-gray-700";
    }
};

/**
 * Format date to dd-MMM-yyyy (e.g., "15-Jan-2026")
 */
export const formatDeadlineShort = (dateString: string): string => {
    if (!dateString) return "--";
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return "--";
        const day = date.toLocaleString("default", { day: "2-digit" });
        const month = date.toLocaleString("default", { month: "short" });
        const year = date.toLocaleString("default", { year: "numeric" });
        return `${day}-${month}-${year}`;
    } catch {
        return dateString;
    }
};

/**
 * Get color class based on completion percentage
 */
export const getProgressColor = (percentage: number): string => {
    if (percentage === 100) return "text-green-600";
    if (percentage >= 76) return "text-green-600";
    if (percentage >= 26) return "text-yellow-500";
    return "text-red-600";
};

/**
 * Parse associated POs from JSON string or object
 */
export const parseAssociatedPOs = (associated: any): string[] => {
    try {
        if (typeof associated === "string") {
            const parsed = JSON.parse(associated);
            return parsed?.pos || [];
        } else if (associated && typeof associated === "object") {
            return associated.pos || [];
        }
        return [];
    } catch {
        return [];
    }
};

/**
 * Extract PO ID (second part after /)
 * e.g., "PO/2024/001" -> "2024/001"
 */
export const extractPOId = (fullName: string): string => {
    const parts = fullName.split("/");
    return parts.length > 1 ? parts.slice(1).join("/") : fullName;
};

/**
 * Calculate progress statistics for tasks
 */
export const calculateTaskStats = (tasks: CriticalPOTask[]) => {
    const applicableTasks = tasks.filter(t => t.status !== "Not Applicable");
    const totalTasks = applicableTasks.length;
    const releasedTasks = applicableTasks.filter(t => t.status === "Released").length;
    const completionPercentage = totalTasks > 0
        ? Math.round((releasedTasks / totalTasks) * 100)
        : 0;

    const statusCounts = tasks.reduce((acc, task) => {
        if (task.status !== "Not Applicable") {
            acc[task.status] = (acc[task.status] || 0) + 1;
        }
        return acc;
    }, {} as Record<string, number>);

    return {
        totalTasks,
        releasedTasks,
        completionPercentage,
        statusCounts,
    };
};

/**
 * Status options for filters
 */
export const CRITICAL_PO_STATUS_OPTIONS = [
    { label: "PR Not Released", value: "PR Not Released" },
    { label: "Not Released", value: "Not Released" },
    { label: "Partially Released", value: "Partially Released" },
    { label: "Released", value: "Released" },
    { label: "Not Applicable", value: "Not Applicable" },
];
