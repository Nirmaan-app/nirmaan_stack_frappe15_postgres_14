/**
 * Purchase Orders tabs configuration
 * Used by release-po-select.tsx for consistent tab values and role-based access
 */
export const PO_TABS = {
    APPROVE_PO: 'Approve PO',
    APPROVE_AMENDED_PO: 'Approve Amended PO',
    APPROVE_SENT_BACK_PO: 'Approve Sent Back PO',
    APPROVED_PO: 'Approved PO',
    DISPATCHED_PO: 'Dispatched PO',
    PARTIALLY_DELIVERED_PO: 'Partially Delivered PO',
    DELIVERED_PO: 'Delivered PO',
    ALL_POS: 'All POs',
} as const;

export type POTabValue = typeof PO_TABS[keyof typeof PO_TABS];

export interface POTabOption {
    label: string;
    value: POTabValue;
    countKey: string;
}

export const PO_ADMIN_TAB_OPTIONS: POTabOption[] = [
    { label: "Approve PO", value: PO_TABS.APPROVE_PO, countKey: "pr.approve" },
    { label: "Approve Amended PO", value: PO_TABS.APPROVE_AMENDED_PO, countKey: "po.PO Amendment" },
    { label: "Approve Sent Back PO", value: PO_TABS.APPROVE_SENT_BACK_PO, countKey: "sb.approve" },
];

export const PO_COMMON_TAB_OPTIONS: POTabOption[] = [
    { label: "Approved PO", value: PO_TABS.APPROVED_PO, countKey: "po.PO Approved" },
    { label: "Dispatched PO", value: PO_TABS.DISPATCHED_PO, countKey: "po.Dispatched" },
    { label: "Partially Delivered PO", value: PO_TABS.PARTIALLY_DELIVERED_PO, countKey: "po.Partially Delivered" },
    { label: "Delivered PO", value: PO_TABS.DELIVERED_PO, countKey: "po.Delivered" },
];

export const PO_ALL_TAB_OPTIONS: POTabOption[] = [
    { label: "All POs", value: PO_TABS.ALL_POS, countKey: "po.all" },
];

export const PO_ADMIN_ROLES = [
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Project Lead Profile",
];

export const PO_ESTIMATES_ROLES = [
    "Nirmaan Estimates Executive Profile",
];
