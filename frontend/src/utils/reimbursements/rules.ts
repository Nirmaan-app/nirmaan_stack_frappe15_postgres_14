/**
 * The Reimbursement rules on the screen: which tabs a person sees, who decides a claim, the monthly
 * reimbursement limit, and when the claimant may edit or delete it (owner, 2026-10-21/22; monthly limit
 * 2026-10-28, ADR-0040 Amendment B).
 *
 * The twin of `nirmaan_stack/services/reimbursements/rules.py` (F1). The server's rules are the
 * boundary; these only decide what renders. Both read `reimbursement_rules_cases.json`, so they cannot
 * drift apart unnoticed (`rules.test.ts`).
 */

import {
    ADMIN_PROFILE,
    REIMBURSEMENT_HR_PROFILES,
    REIMBURSEMENT_VIEW_ALL_PROFILES,
} from "@/constants/roles";

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
        case "Rejected": return "Rejected in Payments";
        default: return expenseStatus || "Not sent to Payments";
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

export const TAB_ALL = "all";
export const TAB_MINE = "mine";
export const TAB_PENDING = "pending";
export const TAB_APPROVED = "approved";
export const TAB_PAID = "paid";
export const TAB_REJECTED = "rejected";
export type ReimbursementTab =
    | typeof TAB_ALL | typeof TAB_MINE | typeof TAB_PENDING | typeof TAB_APPROVED | typeof TAB_PAID | typeof TAB_REJECTED;

export const TAB_LABELS: Record<ReimbursementTab, string> = {
    [TAB_ALL]: "All",
    [TAB_MINE]: "Reimbursement Raised By Me",
    [TAB_PENDING]: "Pending Approval",
    // The Approved claims, waiting to be paid (owner, 2026-10-22: named like the Payments queue's tab).
    [TAB_APPROVED]: "Payment need to be paid",
    [TAB_PAID]: "Paid",
    [TAB_REJECTED]: "Rejected",
};

/**
 * The tabs a person sees, in order (owner, 2026-10-22/23): Pending Approval, Payment need to be paid, Paid,
 * All, Reimbursement Raised By Me, Rejected -- each to whom it belongs:
 * Pending Approval -- HR and Admin; Payment need to be paid (the Approved claims, paid from Project Payments
 * & Expenses through their Non-Project Expense, ADR-0040), Paid, All and Rejected -- Admin, HR and Accounts
 * (All for Accounts too: owner, 2026-10-22); Reimbursement Raised By Me -- everyone.
 */
export function tabsFor(viewer: Viewer): ReimbursementTab[] {
    const decides = isReimbursementAdmin(viewer) || isReimbursementHr(viewer);
    const pays = seesAllClaims(viewer);
    const tabs: ReimbursementTab[] = [];
    if (decides) tabs.push(TAB_PENDING);
    if (pays) tabs.push(TAB_APPROVED);
    if (pays) tabs.push(TAB_PAID);
    if (pays) tabs.push(TAB_ALL);
    tabs.push(TAB_MINE);
    if (pays) tabs.push(TAB_REJECTED);
    return tabs;
}

/** The tab a person opens on: their first, which is where their work is -- Pending Approval for HR and Admin,
 *  Payment need to be paid for Accounts, their own claims for everyone else. */
export function defaultTab(viewer: Viewer): ReimbursementTab {
    const tabs = tabsFor(viewer);
    return tabs.includes(TAB_PENDING) ? TAB_PENDING : tabs[0];
}

/** `wanted` when the person has that tab (a bookmarked `?tab=` included), otherwise their default tab. */
export function resolveTab(wanted: string | null | undefined, viewer: Viewer): ReimbursementTab {
    const tabs = tabsFor(viewer);
    return (tabs as string[]).includes(wanted ?? "") ? (wanted as ReimbursementTab) : defaultTab(viewer);
}
