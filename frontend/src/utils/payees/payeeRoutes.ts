/**
 * Links to a Payee (spec #1420). Every screen links one through `payeeHref`, so when the Payee page
 * lands (#1423) only this function changes.
 */

import { PAYEE_STATUS, type PayeeStatus } from "@/types/NirmaanStack/Payee";

/** The Payees page's URL-sync key: its search lives in `payees_q` / `payees_searchBy`, its tab in `payees_tab`. */
export const PAYEES_URL_KEY = "payees";
export const PAYEES_TAB_PARAM = `${PAYEES_URL_KEY}_tab`;

/** The Payees page's tabs, as `api/payees/list_payees.TABS` names them. */
export const PAYEE_TABS = {
    ACTIVE: "active",
    INACTIVE: "inactive",
    UNLINKED: "unlinked",
} as const;

export type PayeeTab = (typeof PAYEE_TABS)[keyof typeof PAYEE_TABS];

export const isPayeeTab = (value: unknown): value is PayeeTab =>
    Object.values(PAYEE_TABS).includes(value as PayeeTab);

/**
 * A link to ONE Payee: the Payees list, on the tab for its status, searched by its ID. Render it
 * through React Router (it carries the app's `basename`).
 */
export const payeeHref = (name: string, status: PayeeStatus = PAYEE_STATUS.ACTIVE): string => {
    const params = new URLSearchParams({
        [PAYEES_TAB_PARAM]: status === PAYEE_STATUS.INACTIVE ? PAYEE_TABS.INACTIVE : PAYEE_TABS.ACTIVE,
        [`${PAYEES_URL_KEY}_searchBy`]: "name",
        [`${PAYEES_URL_KEY}_q`]: name,
    });
    return `/payees?${params.toString()}`;
};
