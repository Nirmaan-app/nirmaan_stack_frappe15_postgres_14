/**
 * The Payee page's tabs (#1423, #1434, spec #1420, approved mockup screen 2), pure so they test without
 * React. The page's data comes from `api/payees/payee_page`; Edit and Delete rules are `payeeEdit.ts`.
 */

import type { PayeeSummary } from "@/types/NirmaanStack/Payee";

/** The page's tabs; the key travels in the URL as `?tab=`. */
export const PAYEE_PAGE_TABS = {
    OVERVIEW: "overview",
    VENDORS: "vendors",
} as const;

export type PayeePageTab = (typeof PAYEE_PAGE_TABS)[keyof typeof PAYEE_PAGE_TABS];

export const PAYEE_PAGE_TAB_PARAM = "tab";

export const isPayeePageTab = (value: unknown): value is PayeePageTab =>
    Object.values(PAYEE_PAGE_TABS).includes(value as PayeePageTab);

/** One tab button: its key, label and, for the link tabs, the count shown beside the label. */
export interface PayeePageTabItem {
    key: PayeePageTab;
    label: string;
    count?: number;
}

/** Payee Overview first, then Linked Vendors with its count. A Payee lists no payments or expenses:
 *  none points at it (#1434). */
export const payeePageTabs = ({ vendors }: Pick<PayeeSummary, "vendors">): PayeePageTabItem[] => [
    { key: PAYEE_PAGE_TABS.OVERVIEW, label: "Payee Overview" },
    { key: PAYEE_PAGE_TABS.VENDORS, label: "Linked Vendors", count: vendors },
];
