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
    ADMIN_PROFILE,
    PROJECT_MANAGER_PROFILE,
    REIMBURSEMENT_HR_PROFILES,
    REIMBURSEMENT_VIEW_ALL_PROFILES,
} from "@/constants/roles";
import { canMarkExpensePaid } from "@/utils/expenses/expenseDecision";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

export const PENDING = "Pending Approval";
export const APPROVED = "Approved";
export const REJECTED = "Rejected";
/** Set only when the claim's Non-Project Expense is paid (ADR-0040); never by a person on this screen. */
export const PAID = "Paid";
export type ReimbursementStatus = typeof PENDING | typeof APPROVED | typeof REJECTED | typeof PAID;
export const STATUSES: readonly ReimbursementStatus[] = [PENDING, APPROVED, REJECTED, PAID];

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
 *  2026-10-27). A claim rejected in Payments takes its Rejected expense with it (the server does that). */
export function deleteProblem(status: string, isClaimant: boolean): string | null {
    if (!isClaimant) return "Only the person who raised a claim can delete it.";
    if (status !== PENDING && status !== REJECTED) return `This claim is ${status}, so it can't be deleted.`;
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
    userId === "Administrator" || role === ADMIN_PROFILE;

export const isReimbursementHr = ({ role }: Viewer): boolean =>
    !!role && REIMBURSEMENT_HR_PROFILES.includes(role);

/** Admin, HR and Accounts see every claim, and work the Approved and Rejected tabs. */
export const seesAllClaims = ({ role, userId }: Viewer): boolean =>
    userId === "Administrator" || (!!role && REIMBURSEMENT_VIEW_ALL_PROFILES.includes(role));

export const isReimbursementCeo = ({ userId }: Viewer): boolean => !!userId && userId === CEO_AUTHORIZED_USER;

/** L1: Admin (Administrator included) and the CEO -- who approve on Pending L1 Approval. */
export const isReimbursementL1 = (viewer: Viewer): boolean => isReimbursementAdmin(viewer) || isReimbursementCeo(viewer);

// The tabs (ADR-0040 Amendment C, owner 2026-11-18), the twin of `rules.TABS`. Pending Approval holds only new
// claims; an Approved claim sits in the tab of its expense's status (`claimTab`).
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
    [TAB_PAID]: "Paid",
    [TAB_MINE]: "Reimbursement Raised By Me",
    [TAB_ALL]: "All",
};

/** The expense status each expense-led tab lists. */
export const EXPENSE_STATUS_OF_TAB: Partial<Record<ReimbursementTab, string>> = {
    [TAB_L1]: "Requested",
    [TAB_CEO]: "CEO Pending",
    [TAB_APPROVED]: "Approved",
    [TAB_RECONCILIATION]: "Reconciliation Pending",
};

/** The step tab a claim sits in, or null (Rejected, or an Approved claim with no expense): only All lists it. */
export function claimTab(claimStatus: string, expenseStatus: string | null | undefined): ReimbursementTab | null {
    if (claimStatus === PENDING) return TAB_PENDING;
    if (claimStatus === PAID) return TAB_PAID;
    if (claimStatus === APPROVED) {
        const found = (Object.keys(EXPENSE_STATUS_OF_TAB) as ReimbursementTab[])
            .find((tab) => EXPENSE_STATUS_OF_TAB[tab] === expenseStatus);
        return found ?? null;
    }
    return null;
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
 * The tabs a person sees, in order (owner, 2026-11-18): Admin, Accounts and HR see every tab but Pending CEO Approval,
 * which only the CEO sees; the CEO sees all eight. Everyone else sees only Reimbursement Raised By Me.
 */
export function tabsFor(viewer: Viewer): ReimbursementTab[] {
    const ceo = isReimbursementCeo(viewer);
    if (!(seesAllClaims(viewer) || ceo)) return [TAB_MINE];
    return TABS.filter((tab) => tab !== TAB_CEO || ceo);
}

/** The tab a person opens on: Pending Approval for those who decide claims (HR, Admin, the CEO), Payment need to be
 *  paid for Accounts, their own claims for everyone else. */
export function defaultTab(viewer: Viewer): ReimbursementTab {
    const tabs = tabsFor(viewer);
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
