/**
 * Which Project Payment & Expense tabs a viewer gets: the ONE rule (#1473).
 *
 * The page (`RenderProjectPaymentsComponent`) renders `tabs` in order, lands on
 * `defaultTab` when the URL names none, and opens whatever `resolvePaymentsTab` returns
 * for the URL's `?tab=`. Its tab bodies gate on `tabs` too, so a tab and its body cannot
 * disagree about who may use it. Badge counts are not decided here.
 *
 * Hidden-but-routed tabs (PO Wise, Payments Pending) are in no `tabs` list but stay
 * openable by deep link, except for a viewer held to `restrictedTo`. All Payments was one of
 * them from 2026-09-15 until it returned to the strip for its audience (#1476); for anyone
 * else it is still hidden-but-routed.
 */

import { CEO_AUTHORIZED_USER } from "@/constants/ceoHold";
import { ADMIN_PROFILE, HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE, PMO_EXECUTIVE_PROFILE } from "@/constants/roles";

import { PP_ACCOUNTANT_ROLES, PP_ADMIN_ROLES, PP_PROJECT_ROLES, PP_TABS, type PPTabValue } from "./ppTabs.constants";

/** Who is looking: the Role Profile and the user id, as `useUserData()` gives them. */
export interface PaymentsViewer {
    role: string;
    userId: string;
}

export interface PaymentsTabSet {
    /** The tab strip, left to right. */
    tabs: readonly PPTabValue[];
    /** The tab opened when the URL names none. */
    defaultTab: PPTabValue;
    /** The only tabs this viewer may open, whatever `?tab=` says; `null` = no limit. */
    restrictedTo: readonly PPTabValue[] | null;
}

type Rule = (v: PaymentsViewer) => boolean;

/** Approves payments: the Administrator user and the Admin profile. */
const canApprove: Rule = (v) => v.userId === "Administrator" || v.role === ADMIN_PROFILE;
const isCEO: Rule = (v) => v.userId === CEO_AUTHORIZED_USER;
/** Settles payments (Mark as Paid, Mark Reconciled). PMO removed 2026-09-17. */
const canSettle: Rule = (v) => PP_ADMIN_ROLES.includes(v.role) || PP_ACCOUNTANT_ROLES.includes(v.role);
const isAccountant: Rule = (v) => PP_ACCOUNTANT_ROLES.includes(v.role);
const isPMO: Rule = (v) => v.role === PMO_EXECUTIVE_PROFILE;
const isProjectRole: Rule = (v) => PP_PROJECT_ROLES.includes(v.role);
const everyone: Rule = () => true;

/**
 * Profiles that only VIEW this page, held to `VIEW_ONLY_TABS` (owner, 17 Sep 2026; HR Lead
 * since #1476, which holds no write right on any ledger).
 * Their rows carry no actions: AllPayments drops them for anyone who cannot settle.
 */
const VIEW_ONLY_PROFILES: readonly string[] = [HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE];
const isViewOnly: Rule = (v) => VIEW_ONLY_PROFILES.includes(v.role);

/** What a view-only profile may open. Payments Pending has no button but stays openable. */
const VIEW_ONLY_TABS: readonly PPTabValue[] = [
    PP_TABS.RECONCILIATION_PENDING,
    PP_TABS.PAYMENTS_DONE,
    PP_TABS.PAYMENTS_PENDING,
    PP_TABS.PAYMENT_BY_ME,
    PP_TABS.ALL_PAYMENTS,
];

/**
 * Sees All Payments (every PO / WO payment and expense, in every status): the people who
 * oversee spend (#1476). Procurement, Project Lead and Project Manager do not.
 */
const overseesSpend: Rule = (v) => canApprove(v) || isAccountant(v) || isPMO(v) || isViewOnly(v);

/** The strip, in display order; each tab is shown to the viewers its rule admits. */
const STRIP: readonly { tab: PPTabValue; shownTo: Rule }[] = [
    { tab: PP_TABS.APPROVE_PAYMENTS, shownTo: canApprove },
    { tab: PP_TABS.CEO_PENDING, shownTo: isCEO },
    { tab: PP_TABS.NEW_PAYMENTS, shownTo: canSettle },
    // Viewable by view-only profiles too, without the Mark Reconciled action.
    { tab: PP_TABS.RECONCILIATION_PENDING, shownTo: (v) => canSettle(v) || isViewOnly(v) },
    { tab: PP_TABS.PAYMENTS_DONE, shownTo: everyone },
    // Own rows for every caller, Admin included (scoped server-side).
    { tab: PP_TABS.PAYMENT_BY_ME, shownTo: everyone },
    { tab: PP_TABS.ALL_PAYMENTS, shownTo: overseesSpend },
];

/** Landing tab: the first rule the viewer matches wins. */
const DEFAULTS: readonly { tab: PPTabValue; when: Rule }[] = [
    { tab: PP_TABS.PAYMENT_BY_ME, when: isViewOnly },
    { tab: PP_TABS.CEO_PENDING, when: isCEO },
    { tab: PP_TABS.APPROVE_PAYMENTS, when: canApprove },
    // PMO sees neither approval nor settle tabs; Payments Pending is hidden (2026-10-07).
    { tab: PP_TABS.PAYMENTS_DONE, when: isPMO },
    { tab: PP_TABS.NEW_PAYMENTS, when: isAccountant },
    { tab: PP_TABS.PAYMENTS_DONE, when: isProjectRole },
];
/** Any other viewer (including a role still loading) lands on the hidden PO Wise. */
const FALLBACK_DEFAULT: PPTabValue = PP_TABS.PO_WISE;

/** The tab strip, landing tab and open-limit for one viewer. */
export function paymentsTabSet(viewer: PaymentsViewer): PaymentsTabSet {
    return {
        tabs: STRIP.filter((s) => s.shownTo(viewer)).map((s) => s.tab),
        defaultTab: DEFAULTS.find((d) => d.when(viewer))?.tab ?? FALLBACK_DEFAULT,
        restrictedTo: isViewOnly(viewer) ? VIEW_ONLY_TABS : null,
    };
}

/**
 * The tab to open for a requested one (state or a hand-edited `?tab=`): the request
 * itself, unless the viewer is held to `restrictedTo` and it is outside, in which case
 * "Payment Raised By Me".
 */
export function resolvePaymentsTab(set: PaymentsTabSet, requested: string): string {
    if (set.restrictedTo && !(set.restrictedTo as readonly string[]).includes(requested)) {
        return PP_TABS.PAYMENT_BY_ME;
    }
    return requested;
}
