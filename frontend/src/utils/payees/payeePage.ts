/**
 * The Payee page's rules (#1423, spec #1420, approved mockup screens 2 and 4), pure so they test
 * without React. The page's data and every server rule (the lock, who may change a holder name,
 * Inactive) come from `api/payees/payee_page`.
 */

import type { PayeeSummary } from "@/types/NirmaanStack/Payee";

/** The page's tabs; the key travels in the URL as `?tab=`. */
export const PAYEE_PAGE_TABS = {
    OVERVIEW: "overview",
    VENDORS: "vendors",
    EXPENSES: "expenses",
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

/** Payee Overview first, then Linked Vendors and Linked Expenses with their counts. */
export const payeePageTabs = ({ vendors, expenses }: Pick<PayeeSummary, "vendors" | "expenses">): PayeePageTabItem[] => [
    { key: PAYEE_PAGE_TABS.OVERVIEW, label: "Payee Overview" },
    { key: PAYEE_PAGE_TABS.VENDORS, label: "Linked Vendors", count: vendors },
    { key: PAYEE_PAGE_TABS.EXPENSES, label: "Linked Expenses", count: expenses },
];

/** The Edit Holder Name dialog's "Are you sure?" text: how many vendors share the account. */
export const holderNameWarning = (vendors: number): string => {
    const who =
        vendors === 0
            ? "No vendor is paid into this account. Every expense naming it will show the new name, and so will past payments."
            : vendors === 1
              ? "1 vendor is paid into this account. It will show the new name, and so will past payments."
              : `${vendors} vendors are paid into this account. They will all show the new name, and so will past payments.`;
    return `${who} Change it only to fix how the bank spells it. A different person or company needs a new payee.`;
};
