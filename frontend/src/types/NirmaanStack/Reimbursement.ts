/**
 * Reimbursement (owner, 2026-10-21/22): a Nirmaan user's claim to be repaid money they spent for work.
 * Approving it creates a Non-Project Expense (ADR-0040) that Accounts pays from Project Payments & Expenses;
 * the claim turns Paid, or Rejected, when that expense does. Written only by `nirmaan_stack/api/reimbursements/`
 * and the expense's hooks; the claimant is the standard `owner`.
 */

import type { ReimbursementStatus, ReimbursementType } from "@/utils/reimbursements/rules";

export const REIMBURSEMENT_DOCTYPE = "Reimbursement";

/** The `Reimbursement` doctype. */
export interface Reimbursement {
    name: string;
    creation: string;
    modified: string;
    /** The claimant: whoever raised it. */
    owner: string;
    /** The claimant's name and role profile, saved when the claim was raised (kept if the user is renamed,
     *  moves role or is deleted). Blank only on a claim saved before these fields existed. */
    claimant_name?: string | null;
    claimant_role?: string | null;
    /** Travel, Food or Others. Required. */
    reimbursement_type: ReimbursementType;
    title: string;
    description?: string | null;
    amount: number;
    status: ReimbursementStatus;
    /** Copied from the claimant's own Payee when raised (or edited); nothing points back at it. */
    pay_to_account_name?: string | null;
    pay_to_account_number?: string | null;
    pay_to_ifsc?: string | null;
    pay_to_bank_name?: string | null;
    pay_to_bank_branch?: string | null;
    /** The one receipts PDF the PDFs and pictures were merged into. */
    attachment?: string | null;
    /** Who approved it; empty until approved. */
    approved_by?: string | null;
    /** Why it was rejected: by HR / Admin, or the reason typed when its expense was rejected in Payments. */
    rejection_reason?: string | null;
}

/** A row of `api/reimbursements/claims.get_claim_payments`: the Non-Project Expense paying a claim. */
export interface ClaimPayment {
    expense: string;
    /** The expense's status: Requested, CEO Pending, Approved, Reconciliation Pending, Paid or Rejected. */
    status: string;
    payment_date?: string | null;
    /** The UTR / payment reference, once paid. */
    payment_ref?: string | null;
}

/** A row of `api/reimbursements/review.get_pending_for_me`. */
export interface PendingReimbursement extends Reimbursement {
    /** "HR or Admin" / "Admin". */
    reviewer: string;
    /** Whether the person viewing may approve or reject it; HR sees every pending claim but decides only
     *  those raised outside HR (any amount). */
    can_decide: boolean;
    /** Why not, when `can_decide` is false. */
    cannot_decide_reason?: string | null;
    is_own: boolean;
}

/** A row of `api/reimbursements/month_totals.get_month_totals`: a claimant's month total (ADR-0040 Amendment B),
 *  worked out when it is read -- the claim plus their other Approved and Paid claims raised in the same month. */
export interface MonthTotal {
    claim: string;
    /** The Non-Project Expense asked about, when the row was asked for by expense; null when asked by claim. */
    expense: string | null;
    /** The claimant (the claim's owner) and their name. */
    claimant: string;
    claimant_name: string;
    /** The first day of the claim's month, `YYYY-MM-DD`. */
    month: string;
    /** This claim's own amount. */
    amount: number;
    month_total: number;
    /** How many claims make up `month_total`, this one included. */
    claims: number;
    over_limit: boolean;
}

/** `api/reimbursements/bank_accounts.my_bank_account`: the caller's own Payee (one per person). */
export interface OwnBankAccount {
    name: string;
    account_name: string;
    account_number: string;
    ifsc: string;
    bank_name?: string | null;
    bank_branch?: string | null;
    /** Vendors also paid into this Payee. Above 0, only Accounts may change the account (Payees page). */
    vendors?: number;
}

/** A row of `api/reimbursements/claims.get_claim_files`. */
export interface ClaimFile {
    file_name: string;
    file_url: string;
    is_receipts_pdf: boolean;
}
