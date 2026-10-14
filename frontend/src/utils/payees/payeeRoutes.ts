/**
 * Links to a Payee (spec #1420). Every screen links one through `payeeHref`, the one place a Payee's
 * URL is built.
 */

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

/** A link to ONE Payee: its page (#1423). Render it through React Router (it carries the app's `basename`). */
export const payeeHref = (name: string): string => `/payees/${encodeURIComponent(name)}`;
