/**
 * Project Payments tabs configuration
 * Used by RenderProjectPaymentsComponent.tsx for consistent tab values and role-based access
 */

export const PP_TABS = {
    APPROVE_PAYMENTS: 'Approve Payments',
    NEW_PAYMENTS: 'New Payments',
    PO_WISE: 'PO Wise',
    PAYMENTS_DONE: 'Payments Done',
    PAYMENTS_PENDING: 'Payments Pending',
    ALL_PAYMENTS: 'All Payments',
} as const;

export type PPTabValue = typeof PP_TABS[keyof typeof PP_TABS];

export interface PPTabOption {
    label: string;
    value: PPTabValue;
    countKey?: string;
    countValue?: number | string; // Optional static override if raw store count isn't enough
}

export const PP_ADMIN_TAB_OPTIONS: PPTabOption[] = [
    { label: "Approve Payments", value: PP_TABS.APPROVE_PAYMENTS, countKey: "pay.requested" },
];

export const PP_NEW_PAYMENTS_TAB_OPTIONS: PPTabOption[] = [
    { label: "New Payments", value: PP_TABS.NEW_PAYMENTS, countKey: "pay.approved" },
];

export const PP_REM_TAB_OPTIONS: PPTabOption[] = [
    { label: "PO Wise", value: PP_TABS.PO_WISE },
];

export const PP_PAYMENT_TYPE_TAB_OPTIONS: PPTabOption[] = [
    { label: "Payments Done", value: PP_TABS.PAYMENTS_DONE, countKey: "pay.paid" },
    { label: "Payments Pending", value: PP_TABS.PAYMENTS_PENDING, countKey: "pay.pending" }, // The actual logic combines approved + requested
];

export const PP_ALL_TAB_OPTIONS: PPTabOption[] = [
    { label: "All Payments", value: PP_TABS.ALL_PAYMENTS, countKey: "pay.all" },
];

export const PP_ADMIN_ROLES = [
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
];

export const PP_ACCOUNTANT_ROLES = [
    "Nirmaan Accountant Profile",
];

export const PP_PROJECT_ROLES = [
    "Nirmaan Procurement Executive Profile",
    "Nirmaan Project Lead Profile",
    "Nirmaan Project Manager Profile"
];
