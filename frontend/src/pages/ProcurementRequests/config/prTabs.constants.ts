/**
 * Procurement Requests tabs configuration
 * Used by ProcurementRequests.tsx for consistent tab values and role-based access
 */

export const PR_TABS = {
    APPROVE_PR: 'Approve PR',
    NEW_PR_REQUEST: 'New PR Request',
    IN_PROGRESS: 'In Progress',
    REJECTED: 'Rejected',
    DELAYED: 'Delayed',
    CANCELLED: 'Cancelled',
    ALL_PRS: 'All PRs',
} as const;

export type PRTabValue = typeof PR_TABS[keyof typeof PR_TABS];

export interface PRTabOption {
    label: string;
    value: PRTabValue;
    countKey: string;
}

export const PR_ADMIN_TAB_OPTIONS: PRTabOption[] = [
    { label: "Approve PR", value: PR_TABS.APPROVE_PR, countKey: "pr.pending" },
];

export const PR_EXEC_TAB_OPTIONS: PRTabOption[] = [
    { label: "New PR Request", value: PR_TABS.NEW_PR_REQUEST, countKey: "pr.approved" },
    { label: "In Progress", value: PR_TABS.IN_PROGRESS, countKey: "pr.in_progress" },
];

export const PR_SENTBACK_TAB_OPTIONS: PRTabOption[] = [
    { label: "Sent Back", value: PR_TABS.REJECTED, countKey: "sb.rejected.pending" },
    { label: "Skipped PR", value: PR_TABS.DELAYED, countKey: "sb.delayed.pending" },
    { label: "Rejected PO", value: PR_TABS.CANCELLED, countKey: "sb.cancelled.pending" },
];

export const PR_ALL_TAB_OPTIONS: PRTabOption[] = [
    { label: "All PRs", value: PR_TABS.ALL_PRS, countKey: "pr.all" },
];

export const PR_ADMIN_ROLES = [
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Project Lead Profile",
];

export const PR_EXEC_ROLES = [
    "Nirmaan Procurement Executive Profile",
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Project Lead Profile",
];
