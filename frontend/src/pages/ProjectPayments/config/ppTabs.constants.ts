/**
 * Project Payments tabs configuration
 * Used by RenderProjectPaymentsComponent.tsx for consistent tab values and role-based access
 */

import { PROCUREMENT_PROFILES } from "@/constants/roles";

/**
 * ⚠️ THE VALUES BELOW ARE IDENTIFIERS, NOT LABELS — DO NOT RENAME THEM.
 *
 * The owner renamed the five visible tabs on 2026-09-15. Only the LABELS changed
 * (see the *_TAB_OPTIONS arrays below); every value here stayed byte-identical,
 * because a tab value is load-bearing in four places that a rename would break
 * silently:
 *   1. Eight backend deep links — `project-payments?tab=New%20Payments`,
 *      `?tab=CEO%20Pending`, `?tab=Approve%20Payments`, `?tab=Payments%20Done`
 *      (integrations/controllers/project_payments.py). Live notifications already
 *      carry these URLs, so a rename 404s history as well as new sends.
 *   2. `getProjectPaymentsStaticFilters(tab)` — the tab→status filter switch.
 *   3. `buildPaymentsUrlSyncKey(contextKey, tab)` — every saved/bookmarked table
 *      state key is derived from the tab string.
 *   4. A dozen `tab === "Payments Done"` comparisons inside AllPayments.tsx and
 *      AccountantTabs.tsx.
 *
 * Renaming the values is a separate, deliberate piece of work. Renaming a label
 * is one line here.
 */
export const PP_TABS = {
    /** label: "Payment Pending Approval" */
    APPROVE_PAYMENTS: 'Approve Payments',
    /** label: "Payment Pending CEO Approval" */
    CEO_PENDING: 'CEO Pending',
    /** label: "Payment need to paid" */
    NEW_PAYMENTS: 'New Payments',
    /** label: "Payment Done / Reconciliation Pending" — NEW 2026-09-15 */
    RECONCILIATION_PENDING: 'Reconciliation Pending',
    /** label: "Payment Done / Reconciliation Done" */
    PAYMENTS_DONE: 'Payments Done',
    PAYMENTS_PENDING: 'Payments Pending',
    /** Hidden from the tab strip 2026-09-15, but still ROUTED — `paymentHref()`
     *  deep-links unpaid payments here, so removing the route would break every
     *  such link. Hidden ≠ deleted. */
    PO_WISE: 'PO Wise',
    /** Hidden from the tab strip 2026-09-15; still routed, same reason as PO_WISE. */
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
    { label: "Payment Pending Approval", value: PP_TABS.APPROVE_PAYMENTS, countKey: "pay.requested" },
];

export const PP_CEO_TAB_OPTIONS: PPTabOption[] = [
    { label: "Payment Pending CEO Approval", value: PP_TABS.CEO_PENDING, countKey: "pay.ceopending" },
];

export const PP_NEW_PAYMENTS_TAB_OPTIONS: PPTabOption[] = [
    { label: "Payment need to paid", value: PP_TABS.NEW_PAYMENTS, countKey: "pay.approved" },
];

// Tab four. The status it filters does not exist yet — nothing writes
// "Reconciliation Pending" until the fulfil path is switched over — so this tab
// renders an empty table and a 0 count on purpose. It is the visible scaffold for
// the status change, not a bug.
export const PP_RECONCILIATION_TAB_OPTIONS: PPTabOption[] = [
    { label: "Payment Done / Reconciliation Pending", value: PP_TABS.RECONCILIATION_PENDING, countKey: "pay.reconciliationpending" },
];

// HIDDEN from the tab strip (owner, 2026-09-15). Kept exported and routed so the
// existing deep links keep resolving — see PP_TABS.PO_WISE / ALL_PAYMENTS.
export const PP_REM_TAB_OPTIONS: PPTabOption[] = [
    { label: "PO Wise", value: PP_TABS.PO_WISE },
];

export const PP_PAYMENT_TYPE_TAB_OPTIONS: PPTabOption[] = [
    { label: "Payments Done", value: PP_TABS.PAYMENTS_DONE, countKey: "pay.paid" },
    { label: "Payments Pending", value: PP_TABS.PAYMENTS_PENDING, countKey: "pay.pending" }, // The actual logic combines approved + requested
];

// HIDDEN from the tab strip (owner, 2026-09-15). Kept exported and routed:
// `paymentHref()` sends every NON-paid payment deep link to this tab.
export const PP_ALL_TAB_OPTIONS: PPTabOption[] = [
    { label: "All Payments", value: PP_TABS.ALL_PAYMENTS, countKey: "pay.all" },
];

// Settle-side authority beside the accountants — "Payment need to paid" (Mark as Paid) and
// "Payment Done / Reconciliation Pending" (Mark Reconciled). PMO Executive was intentionally
// REMOVED on 2026-09-17 (PMO access review). Do NOT re-add PMO without owner sign-off.
export const PP_ADMIN_ROLES = [
    "Nirmaan Admin Profile",
];

export const PP_ACCOUNTANT_ROLES = [
    "Nirmaan Accountant Profile",
    "Nirmaan Accountant Lead Profile",
];

export const PP_PROJECT_ROLES = [
    ...PROCUREMENT_PROFILES,
    "Nirmaan Project Lead Profile",
    "Nirmaan Project Manager Profile"
];
