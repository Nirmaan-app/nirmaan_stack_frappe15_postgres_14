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
    { label: "Released", value: "Released" },
    { label: "Not Applicable", value: "Not Applicable" },
];

/**
 * ─── PO → procurement package resolution ─────────────────────
 *
 * `Procurement Requests.work_package` used to hold the package name, but the v3.0
 * `migrate_work_package_to_pr_tags` patch moved packages onto the PR's tag rows and
 * left `work_package` carrying only the PR type — "Normal" or "Custom". A handful of
 * pre-patch PRs still carry a real package name there, so that value is honoured as a
 * fallback but the tags are the source of truth.
 */

/** PR type markers that `work_package` holds post-v3.0 — never real packages. */
const PR_TYPE_MARKERS = new Set(["Normal", "Custom"]);

/** The "Custom" entry appended to the package dropdown. Not a Procurement Package. */
export const CUSTOM_PACKAGE_OPTION = "Custom";

/** One `Procurement Requests` row per PR Tag Child Table row (see useCriticalPOProcurementRequests). */
export interface PRPackageRow {
    name: string;
    work_package?: string | null;
    /** From the joined `PR Tag Child Table`; null when the PR carries no tags. */
    tag_package?: string | null;
}

export interface PRPackageInfo {
    /** Every procurement package this PR is tagged with. */
    packages: Set<string>;
    /** PR was raised through the Custom PR flow. */
    isCustomPR: boolean;
}

/**
 * Folds the tag-joined PR rows (one row per tag) into one entry per PR.
 */
export const buildPRPackageMap = (
    prRows: PRPackageRow[] | undefined
): Map<string, PRPackageInfo> => {
    const map = new Map<string, PRPackageInfo>();

    prRows?.forEach((row) => {
        if (!row?.name) return;

        let info = map.get(row.name);
        if (!info) {
            info = { packages: new Set<string>(), isCustomPR: false };
            map.set(row.name, info);
        }

        const tag = row.tag_package?.trim();
        if (tag) info.packages.add(tag);

        const legacy = row.work_package?.trim();
        if (legacy) {
            if (legacy === CUSTOM_PACKAGE_OPTION) info.isCustomPR = true;
            // Pre-v3.0 rows still holding a real package name.
            else if (!PR_TYPE_MARKERS.has(legacy)) info.packages.add(legacy);
        }
    });

    return map;
};

interface POWithPR {
    name: string;
    procurement_request?: string | null;
}

/**
 * Keeps the POs belonging to `selectedPackage`, resolved through their PR's tags.
 *
 * "Custom" additionally keeps the POs no package can be resolved for (an untagged PR,
 * or a PO with no PR at all) so they stay reachable, as they were before v3.0.
 */
export const filterPOsByPackage = <T extends POWithPR>(
    pos: T[] | undefined,
    prRows: PRPackageRow[] | undefined,
    selectedPackage: string
): T[] => {
    if (!pos) return [];
    if (!selectedPackage) return pos;

    const prPackages = buildPRPackageMap(prRows);
    const isCustomSelection = selectedPackage === CUSTOM_PACKAGE_OPTION;

    return pos.filter((po) => {
        const info = prPackages.get(po.procurement_request ?? "");
        if (!info || info.packages.size === 0) return isCustomSelection;
        if (info.packages.has(selectedPackage)) return true;
        return isCustomSelection && info.isCustomPR;
    });
};
