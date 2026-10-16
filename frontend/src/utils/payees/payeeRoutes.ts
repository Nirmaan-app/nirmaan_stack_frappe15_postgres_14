/**
 * Links to a Payee (spec #1420). Every screen links one through `payeeHref`, the one place a Payee's
 * URL is built.
 */

import { ADMIN_PROFILE, canManagePayees } from "@/constants/roles";

/** The Payees page's URL-sync key: its search lives in `payees_q` / `payees_searchBy`, its tab in `payees_tab`. */
export const PAYEES_URL_KEY = "payees";
export const PAYEES_TAB_PARAM = `${PAYEES_URL_KEY}_tab`;

/** The Payees page's tabs, as `api/payees/list_payees.TABS` names them: every Payee, and those no
 *  vendor links to (used only for expenses, or not at all). */
export const PAYEE_TABS = {
    ALL: "all",
    NO_VENDOR: "no_vendor",
} as const;

export type PayeeTab = (typeof PAYEE_TABS)[keyof typeof PAYEE_TABS];

export const isPayeeTab = (value: unknown): value is PayeeTab =>
    Object.values(PAYEE_TABS).includes(value as PayeeTab);

/** A link to ONE Payee: its page (#1423). Render it through React Router (it carries the app's `basename`). */
export const payeeHref = (name: string): string => `/payees/${encodeURIComponent(name)}`;

/** Where the sidebar lists Payees (#1466): inside Admin Options with the other masters for the Admin
 *  profile (and the Administrator), at the top level for the Accountants, nowhere for anyone else. */
export const payeesSidebarPlace = (
    role?: string | null,
    userId?: string | null,
): "admin-options" | "top-level" | null => {
    if (!canManagePayees(role, userId)) return null;
    return userId === "Administrator" || role === ADMIN_PROFILE ? "admin-options" : "top-level";
};
