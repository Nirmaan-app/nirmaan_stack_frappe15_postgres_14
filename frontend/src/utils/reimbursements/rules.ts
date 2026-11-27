/**
 * The Reimbursement rules on the screen: which tabs a person sees, who decides a claim, the monthly
 * reimbursement limit, and when the claimant may edit or delete it (owner, 2026-10-21/22; monthly limit
 * 2026-10-28, ADR-0040 Amendment B).
 *
 * The twin of `nirmaan_stack/services/reimbursements/rules.py` (F1). The server's rules are the
 * boundary; these only decide what renders. Both read `reimbursement_rules_cases.json`, so they cannot
 * drift apart unnoticed (`rules.test.ts`).
 */

import { CEO_AUTHORIZED_USER } from "@/constants/ceoHold";
import {
  PROJECT_MANAGER_PROFILE,
  REIMBURSEMENT_HR_PROFILES,
  REIMBURSEMENT_VIEW_ALL_PROFILES,
  isAdminProfile,
  isDeveloperProfile,
} from "@/constants/roles";
import { canMarkExpensePaid } from "@/utils/expenses/expenseDecision";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

export const PENDING = "Pending Approval";
/** After the first approval the claim carries its Non-Project Expense's status, by the same names (owner,
 *  2026-11-19). Mirrors `services/reimbursements/rules.py`. */
export const REQUESTED = "Requested";
export const CEO_PENDING = "CEO Pending";
export const APPROVED = "Approved";
export const RECONCILIATION_PENDING = "Reconciliation Pending";
/** Set only when the claim's Non-Project Expense is paid (ADR-0040); never by a person on this screen. */
export const PAID = "Paid";
export const REJECTED = "Rejected";
export type ReimbursementStatus =
    | typeof PENDING | typeof REQUESTED | typeof CEO_PENDING | typeof APPROVED | typeof RECONCILIATION_PENDING
    | typeof PAID | typeof REJECTED;
/** The status options, in the doctype's order. */
export const STATUSES: readonly ReimbursementStatus[] = [
    PENDING, REQUESTED, CEO_PENDING, APPROVED, RECONCILIATION_PENDING, PAID, REJECTED,
];
/** Approved at some step and not yet paid: where a rule used to read "Approved". Twin of `rules.APPROVED_STEPS`. */
export const APPROVED_STEPS: readonly ReimbursementStatus[] = [REQUESTED, CEO_PENDING, APPROVED, RECONCILIATION_PENDING];

/** What a claim was spent on, in the doctype's order (owner, 2026-10-22). */
export const TYPES = ["Travel", "Food", "Others"] as const;
export type ReimbursementType = (typeof TYPES)[number];

/** The monthly reimbursement limit (₹) on a claimant's month total. Exactly ₹2,000 has reached it: only a total below
 *  it is within the limit (owner, 2026-10-28). */
export const MONTHLY_LIMIT = 2000;

/** True when a claimant's month total has reached the monthly limit: ₹2,000 or more. */
export const overMonthlyLimit = (monthTotal: number): boolean => monthTotal >= MONTHLY_LIMIT;

/** Whether approving now leaves the claim's expense waiting for L1 in Payments: an approval by someone who is not
 *  L1 (HR) when the month total has reached the limit. An Admin's approval is the L1 step. */
export const approvalNeedsL1 = (monthTotal: number, deciderIsL1: boolean): boolean =>
    !deciderIsL1 && overMonthlyLimit(monthTotal);

/** Why an approval can't go ahead, or null: at or above the limit the approver must tick the warning. */
export function acknowledgementProblem(monthTotal: number, acknowledged: boolean): string | null {
    return overMonthlyLimit(monthTotal) && !acknowledged ? "Tick the box to confirm, then approve." : null;
}

/** A Project Manager's monthly cap (₹; owner, 2026-11-18): their claims raised in one calendar month (Pending Approval,
 *  Approved and Paid) may add up to this and no more. Exactly ₹2,000 is allowed. A block, unlike `MONTHLY_LIMIT`. */
export const PM_MONTHLY_CAP = 2000;

/** True for the role profile the cap applies to. */
export const isCappedRole = (role: string | null | undefined): boolean => role === PROJECT_MANAGER_PROFILE;


/** What a capped claimant may still claim this month, never below ₹0. */
export const capLeft = (monthUsed: number): number => Math.max(0, Math.round((PM_MONTHLY_CAP - monthUsed) * 100) / 100);

/** Why a claim of `amount` would take a capped claimant above the cap, or null. `monthUsed` leaves the claim out. */
export function capProblem(monthUsed: number, amount: number, capped: boolean): string | null {
    if (!capped || !Number.isFinite(amount)) return null;
    if (Math.round((monthUsed + amount) * 100) / 100 <= PM_MONTHLY_CAP) return null;
    const cap = formatToRoundedIndianRupee(PM_MONTHLY_CAP);
    const left = capLeft(monthUsed);
    return left <= 0
        ? `You have used this month's ${cap}. Project Managers can claim up to ${cap} a month.`
        : `You can claim up to ${formatToIndianRupee(left)} more this month. Project Managers can claim up to ${cap} a month.`;
}

/** A claim above this amount (₹) needs a description (owner, 2026-10-22). Exactly ₹2,000 does not. */
export const DESCRIPTION_REQUIRED_ABOVE = 2000;

/** True when a claim of `amount` needs a description. */
export const descriptionRequired = (amount: number): boolean => amount > DESCRIPTION_REQUIRED_ABOVE;

export const REVIEWER_ADMIN = "Admin";
export const REVIEWER_HR_OR_ADMIN = "HR or Admin";

/** Who decides a claim raised by this claimant. */
export function reviewerFor(claimantIsHr: boolean): string {
    return claimantIsHr ? REVIEWER_ADMIN : REVIEWER_HR_OR_ADMIN;
}

/** Why this person may not approve or reject the claim, or null. HR decides any amount raised outside HR. */
export function decideProblem(
    status: string,
    who: { claimantIsHr: boolean; deciderIsAdmin: boolean; deciderIsHr: boolean },
): string | null {
    if (status !== PENDING) return `This claim is ${status}, so it can no longer be approved or rejected.`;
    if (who.deciderIsAdmin) return null;
    if (!who.deciderIsHr) return "Only HR or Admin can approve or reject reimbursements.";
    if (who.claimantIsHr) return "A claim raised by someone in HR is approved by Admin.";
    return null;
}

/** Why the person may not edit the claim, or null: the claimant, while it is pending. */
export function editProblem(status: string, isClaimant: boolean): string | null {
    if (!isClaimant) return "Only the person who raised a claim can edit it.";
    if (status !== PENDING) return `This claim is ${status}, so it can no longer be edited.`;
    return null;
}

/** Why the person may not delete the claim, or null: the claimant, while pending or once rejected (owner,
 *  2026-10-27); an Admin, anyone's claim once it is rejected (owner, 2026-11-19). A claim rejected in Payments takes
 *  its Rejected expense with it (the server does that). Mirrors `rules.delete_problem`. */
export function deleteProblem(status: string, isClaimant: boolean, isAdmin = false): string | null {
    if (isClaimant) {
        return status !== PENDING && status !== REJECTED ? `This claim is ${status}, so it can't be deleted.` : null;
    }
    if (!isAdmin) return "Only the person who raised a claim, or an Admin once it is rejected, can delete it.";
    if (status !== REJECTED) return `This claim is ${status}: an Admin can delete someone else's claim only once it is rejected.`;
    return null;
}

/** Where the claim's payment is, from its Non-Project Expense's status (ADR-0040). The claim itself stays
 *  Approved until the expense is Paid or Rejected. */
export function paymentStage(expenseStatus: string | null | undefined): string {
    switch (expenseStatus) {
        case "Requested": return "Waiting for L1 approval";
        case "CEO Pending": return "Waiting for CEO approval";
        case "Approved": return "Waiting to be paid";
        case "Reconciliation Pending": return "Paid, waiting for the bank statement";
        case "Paid": return "Paid";
        case "Rejected": return "Rejected after approval";
        default: return expenseStatus || "No expense yet";
    }
}

const PDF_EXTENSIONS = [".pdf"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"];

/** True for a file merged into the claim's one receipts PDF (a PDF or a picture), by its extension. */
export function isMergeable(fileName: string | null | undefined): boolean {
    const name = (fileName ?? "").toLowerCase();
    const dot = name.lastIndexOf(".");
    if (dot < 0) return false;
    const ext = name.slice(dot);
    return PDF_EXTENSIONS.includes(ext) || IMAGE_EXTENSIONS.includes(ext);
}

/** "Nirmaan Project Manager Profile" -> "Project Manager", for showing a saved role. */
export const roleLabel = (profile?: string | null): string =>
    (profile ?? "").replace(/^Nirmaan\s+/, "").replace(/\s+Profile$/, "");

/** The claimant's name: the one saved on the claim, else a live lookup (a claim from before it was saved). */
export const claimantName = (
    claim: { owner: string; claimant_name?: string | null },
    lookup: (id?: string | null) => string,
): string => claim.claimant_name || lookup(claim.owner);

// --- Who sees what --------------------------------------------------------------------------------

export interface Viewer {
    role?: string | null;
    userId?: string | null;
}

export const isReimbursementAdmin = ({ role, userId }: Viewer): boolean =>
    userId === "Administrator" || isAdminProfile(role) || isDeveloperProfile(role);

export const isReimbursementHr = ({ role }: Viewer): boolean =>
    !!role && REIMBURSEMENT_HR_PROFILES.includes(role);

/** Admin, HR and Accounts see every claim, and work the Approved and Rejected tabs. */
export const seesAllClaims = ({ role, userId }: Viewer): boolean =>
    userId === "Administrator" || (!!role && REIMBURSEMENT_VIEW_ALL_PROFILES.includes(role));

export const isReimbursementCeo = ({ userId }: Viewer): boolean => !!userId && userId === CEO_AUTHORIZED_USER;

/** L1: Admin (Administrator included) and the CEO -- who approve on Pending L1 Approval. */
export const isReimbursementL1 = (viewer: Viewer): boolean => isReimbursementAdmin(viewer) || isReimbursementCeo(viewer);

// The tabs (ADR-0040 Amendment C, owner 2026-11-18), the twin of `rules.TABS`. Each step tab lists one claim status
// (`claimTab`); after the first approval the claim carries its expense's status (owner, 2026-11-19).
export const TAB_PENDING = "pending";
export const TAB_L1 = "l1";
export const TAB_CEO = "ceo";
/** "Payment need to be paid": the id stays `approved`, as bookmarks and the Action Center link have it. */
export const TAB_APPROVED = "approved";
export const TAB_RECONCILIATION = "reconciliation";
export const TAB_PAID = "paid";
export const TAB_MINE = "mine";
export const TAB_ALL = "all";
export const TABS = [TAB_PENDING, TAB_L1, TAB_CEO, TAB_APPROVED, TAB_RECONCILIATION, TAB_PAID, TAB_MINE, TAB_ALL] as const;
export type ReimbursementTab = (typeof TABS)[number];

export const TAB_LABELS: Record<ReimbursementTab, string> = {
    [TAB_PENDING]: "Pending Approval",
    [TAB_L1]: "Pending L1 Approval",
    [TAB_CEO]: "Pending CEO Approval",
    [TAB_APPROVED]: "Payment need to be paid",
    [TAB_RECONCILIATION]: "Reconciliation Pending",
    // Renamed (owner, 2026-11-19); the id stays `paid`.
    [TAB_PAID]: "Reconciliation Done / Paid",
    [TAB_MINE]: "Reimbursement Raised By Me",
    [TAB_ALL]: "All",
};

/** The step tab of each status; Rejected is in none (only All). Twin of `rules.TAB_OF_STATUS`. */
const TAB_OF_STATUS: Partial<Record<string, ReimbursementTab>> = {
    [PENDING]: TAB_PENDING,
    [REQUESTED]: TAB_L1,
    [CEO_PENDING]: TAB_CEO,
    [APPROVED]: TAB_APPROVED,
    [RECONCILIATION_PENDING]: TAB_RECONCILIATION,
    [PAID]: TAB_PAID,
};

/** The step tab a claim sits in, or null (Rejected): only All lists it. The claim's status names the step; an
 *  expense's status, by the same name, gives the tab its claim is now in. */
export function claimTab(status: string | null | undefined): ReimbursementTab | null {
    return TAB_OF_STATUS[status ?? ""] ?? null;
}

/** The tabs where a person acts on ticked rows: the three approval tabs, and Payment need to be paid. */
export const SELECTABLE_TABS: readonly ReimbursementTab[] = [TAB_PENDING, TAB_L1, TAB_CEO, TAB_APPROVED];

/** Whether this person acts on a tab at all (the server decides each row): approve on the three approval tabs,
 *  pay on Payment need to be paid and Reconciliation Pending. */
export function actsOn(tab: ReimbursementTab, viewer: Viewer): boolean {
    switch (tab) {
        case TAB_PENDING: return isReimbursementAdmin(viewer) || isReimbursementHr(viewer) || isReimbursementCeo(viewer);
        case TAB_L1: return isReimbursementL1(viewer);
        case TAB_CEO: return isReimbursementCeo(viewer);
        case TAB_APPROVED:
        case TAB_RECONCILIATION: return viewer.userId === "Administrator" || canMarkExpensePaid(viewer.role);
        default: return false;
    }
}

/**
 * The tab bar (owner, 2026-11-19, plan page "Tab layout"): one row of equal-height tabs, each label on two lines with
 * its count beside it, then All, and Reimbursement Raised By Me alone at the right end. Admin and the CEO -- who see the
 * most tabs -- get them grouped in bordered boxes named for who works them; HR and Accounts get a plain row.
 */
export const TAB_GROUPS: readonly { label: string; tabs: readonly ReimbursementTab[] }[] = [
    { label: "HR", tabs: [TAB_PENDING] },
    { label: "Admin", tabs: [TAB_L1, TAB_CEO] },
    { label: "Accounts", tabs: [TAB_APPROVED, TAB_RECONCILIATION, TAB_PAID] },
];

/** Each tab's label on two lines, split where it reads naturally (All stays one word). */
export const TAB_LINES: Record<ReimbursementTab, readonly [string, string] | readonly [string]> = {
    [TAB_PENDING]: ["Pending", "Approval"],
    [TAB_L1]: ["Pending", "L1 Approval"],
    [TAB_CEO]: ["Pending", "CEO Approval"],
    [TAB_APPROVED]: ["Payment", "need to be paid"],
    [TAB_RECONCILIATION]: ["Reconciliation", "Pending"],
    [TAB_PAID]: ["Reconciliation", "Done / Paid"],
    [TAB_MINE]: ["Reimbursement", "Raised By Me"],
    [TAB_ALL]: ["All"],
};

/** Whether this person's tabs are grouped (Admin and the CEO). */
export const groupsTabs = (viewer: Viewer): boolean => isReimbursementAdmin(viewer) || isReimbursementCeo(viewer);

/**
 * The tabs a person sees, in order (owner, 2026-11-19), each to the people whose work it is:
 * - the CEO: all eight; an Admin (Administrator included): all but Pending CEO Approval;
 * - HR: Pending Approval, Reconciliation Done / Paid, Raised By Me, All;
 * - Accounts: Payment need to be paid, Reconciliation Pending, Reconciliation Done / Paid, Raised By Me, All;
 * - everyone else: Raised By Me.
 * Display only: what each person may read and do is the server's (HR and Accounts still read every claim, in All).
 */
export function tabsFor(viewer: Viewer): ReimbursementTab[] {
    const ceo = isReimbursementCeo(viewer);
    if (ceo || isReimbursementAdmin(viewer)) return TABS.filter((tab) => tab !== TAB_CEO || ceo);
    if (isReimbursementHr(viewer)) return [TAB_PENDING, TAB_PAID, TAB_MINE, TAB_ALL];
    if (seesAllClaims(viewer)) return [TAB_APPROVED, TAB_RECONCILIATION, TAB_PAID, TAB_MINE, TAB_ALL];
    return [TAB_MINE];
}

/** The tab a person opens on, where their own step waits (owner, 2026-11-19): Pending CEO Approval for the CEO,
 *  Pending L1 Approval for an Admin who isn't the CEO, Pending Approval for HR, Payment need to be paid for Accounts,
 *  their own claims for everyone else. */
export function defaultTab(viewer: Viewer): ReimbursementTab {
    const tabs = tabsFor(viewer);
    if (isReimbursementCeo(viewer) && tabs.includes(TAB_CEO)) return TAB_CEO;
    if (isReimbursementAdmin(viewer) && tabs.includes(TAB_L1)) return TAB_L1;
    if (actsOn(TAB_PENDING, viewer) && tabs.includes(TAB_PENDING)) return TAB_PENDING;
    return tabs.includes(TAB_APPROVED) ? TAB_APPROVED : tabs[0];
}

/** `wanted` when the person has that tab (a bookmarked `?tab=` included), otherwise their default tab. The retired
 *  `rejected` tab opens All, where rejected claims now are. */
export function resolveTab(wanted: string | null | undefined, viewer: Viewer): ReimbursementTab {
    const tabs = tabsFor(viewer);
    const asked = wanted === "rejected" ? TAB_ALL : wanted;
    return (tabs as string[]).includes(asked ?? "") ? (asked as ReimbursementTab) : defaultTab(viewer);
}

/** The open tab's own list total: what `get_claims` returned for its month, column filters and search. */
export interface OpenTabCount {
    tab: ReimbursementTab;
    count: number;
}

/**
 * Each tab's badge: the server's counts (`queue.get_claim_tab_counts`), with the open tab's list total in place of its
 * count once that list has loaded, so a changed month, column filter or search changes the badge too (owner,
 * 2026-11-24: a badge is the rows the tab shows, filters included). A total read for another tab is ignored.
 */
export function badgeCounts(
    counts: Partial<Record<ReimbursementTab, number>>,
    tab: ReimbursementTab,
    open: OpenTabCount | null,
): Partial<Record<ReimbursementTab, number>> {
    return open && open.tab === tab ? { ...counts, [tab]: open.count } : counts;
}
