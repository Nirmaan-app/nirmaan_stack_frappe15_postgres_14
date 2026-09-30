/**
 * Purchase Orders tabs configuration
 * Used by release-po-select.tsx for consistent tab values and role-based access
 */
export const PO_TABS = {
    APPROVE_PO: 'Approve PO',
    APPROVE_SENT_BACK_PO: 'Approve Sent Back PO',
    APPROVE_PO_REVISION: 'Approve PO Revision',
    APPROVED_PO: 'Approved PO',
    PARTIALLY_DISPATCHED_PO: 'Partially Dispatched PO',
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
    { label: "Approve Sent Back PO", value: PO_TABS.APPROVE_SENT_BACK_PO, countKey: "sb.approve" },
    { label: "Approve PO Revision", value: PO_TABS.APPROVE_PO_REVISION, countKey: "po_revisions.pending_approval" },
];

export const PO_COMMON_TAB_OPTIONS: POTabOption[] = [
    { label: "Approved PO", value: PO_TABS.APPROVED_PO, countKey: "po.PO Approved" },
    { label: "Partially Dispatched PO", value: PO_TABS.PARTIALLY_DISPATCHED_PO, countKey: "po.Partially Dispatched" },
    { label: "Dispatched PO", value: PO_TABS.DISPATCHED_PO, countKey: "po.Dispatched" },
    { label: "Partially Delivered PO", value: PO_TABS.PARTIALLY_DELIVERED_PO, countKey: "po.Partially Delivered" },
    { label: "Delivered PO", value: PO_TABS.DELIVERED_PO, countKey: "po.Delivered" },
];

/**
 * A PO's STATUS -> the list tab that holds it.
 *
 * One home for a mapping that used to exist twice and disagree: `PO_STATUS_TAB` in
 * `ProjectPayments/components/poRoute.ts` (5 entries) and `statusToTab` inside
 * `PODetails.tsx` (4 entries, URL-encoded, no `PO Approved`, silently defaulting to
 * `Dispatched PO`). Statuses and tab labels are DIFFERENT vocabularies -- the status is
 * `PO Approved`, the tab is `Approved PO` -- so anything building a list link has to
 * translate, and translating in two places is how they drifted.
 *
 * A status that is absent here (Merged, Cancelled, an amendment) has no tab of its own.
 */
export const PO_STATUS_TAB: Record<string, POTabValue> = {
    "PO Approved": PO_TABS.APPROVED_PO,
    "Partially Dispatched": PO_TABS.PARTIALLY_DISPATCHED_PO,
    "Dispatched": PO_TABS.DISPATCHED_PO,
    "Partially Delivered": PO_TABS.PARTIALLY_DELIVERED_PO,
    "Delivered": PO_TABS.DELIVERED_PO,
};

export const PO_ALL_TAB_OPTIONS: POTabOption[] = [
    { label: "All POs", value: PO_TABS.ALL_POS, countKey: "po.all" },
];

// PO approval authority — drives the three "Approve …" tabs (release-po-select.tsx), the
// approve-view URL guard (RenderPurchaseOrdersTab.tsx) and the /po-revisions-approval route
// guard (routesConfig.tsx). PMO Executive was intentionally REMOVED on 2026-09-17 (PMO access
// review, same as PR_ADMIN_ROLES on 2026-07-04). Do NOT re-add PMO without owner sign-off.
export const PO_ADMIN_ROLES = [
    "Nirmaan Admin Profile",
    "Nirmaan Project Lead Profile",
];

export const PO_ESTIMATES_ROLES = [
    "Nirmaan Estimates Executive Profile",
    "Nirmaan Billing Executive Profile",
];
