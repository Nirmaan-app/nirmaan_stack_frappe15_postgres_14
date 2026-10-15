/**
 * Who a payment row is paid to (spec #1420 tickets #1431, #1438, ADR-0033), as the screens say it. Pure.
 *
 * The server's Payee module resolves it (`services/payees/paid_to.py`): every PO / WO payment and
 * expense is paid into its OWN pay-to account, copied when it was raised. These only word the answer:
 * the "Payment need to paid" Paid to cell, its CSV column, and Record Payment's "Pay ₹X to" box.
 */

import type { PayToAccount } from "@/types/NirmaanStack/Payee";
import { formatDate } from "@/utils/FormatDate";

import { PAYEE_RULE, asPayeeRule } from "./expensePayee";

/** Why a row has no account to pay into (`paid_to.py`). */
export const PAID_TO_MISSING = {
    PAYMENT_HAS_NO_ACCOUNT: "payment_has_no_account",
    EXPENSE_HAS_NO_ACCOUNT: "expense_has_no_account",
} as const;

export type PaidToMissing = (typeof PAID_TO_MISSING)[keyof typeof PAID_TO_MISSING];

/** Who a row is paid to, as `api/payees/paid_to.get_paid_to` and the approval queue send it. */
export interface PaidTo {
    /** The row's own pay-to account; null when it holds none. */
    account: PayToAccount | null;
    missing: PaidToMissing | null;
    /** The expense type's *Who gets paid*, on an expense with no account. */
    payee_rule: string | null;
}

export interface PaidToCell {
    tone: "account" | "no_account" | "payment_no_account";
    title: string;
    detail: string;
}

/** The Paid to cell: the holder name with the account and IFSC under it, or why there is none. */
export const paidToCell = (paidTo: PaidTo | undefined, expenseType: string): PaidToCell => {
    const account = paidTo?.account;
    if (account) {
        return {
            tone: "account",
            title: account.account_name,
            detail: `A/c ${account.account_number}, ${account.ifsc}`,
        };
    }
    if (paidTo?.missing === PAID_TO_MISSING.PAYMENT_HAS_NO_ACCOUNT) {
        return {
            tone: "payment_no_account",
            title: "No account on this payment",
            detail: "Pay it another way, or reject it and raise it again.",
        };
    }
    const type = expenseType || "Its type";
    return {
        tone: "no_account",
        title: "No account",
        detail: asPayeeRule(paidTo?.payee_rule) === PAYEE_RULE.REQUIRED
            ? `${type} requires one. Add it with Change account in Record Payment.`
            : `${type} doesn't require one. Paid by card or cash.`,
    };
};

/** The Paid to cell on one line, for the table's CSV. */
export const paidToExportText = (paidTo: PaidTo | undefined, expenseType: string): string => {
    const cell = paidToCell(paidTo, expenseType);
    return cell.tone === "account" ? `${cell.title}, ${cell.detail}` : cell.title;
};

/** Record Payment's "Pay ₹X to" box for an expense with no account. */
export const noAccountBoxText = (rule: string | null | undefined, expenseType: string): string => {
    const type = expenseType || "Its type";
    return asPayeeRule(rule) === PAYEE_RULE.REQUIRED
        ? `${type} requires an account. Use Change account to set one before paying.`
        : `${type} doesn't require one. Pay by card or cash, or use Change account to set one.`;
};

/**
 * Whether Record Payment offers Change account (a screen rule, ADR-0033): Accounts change an expense's
 * account until it is paid, unless a vendor is named (then it is the vendor's). A PO / WO payment's
 * copy is never changed: a wrong one means reject and raise again.
 */
export const canChangeExpenseAccount = (
    doctype: string,
    box: { paid: boolean; vendor_fixed: boolean },
    isAccounts: boolean,
): boolean => isAccounts && doctype !== "Project Payments" && !box.paid && !box.vendor_fixed;

/** Who set a row's account (`paid_to.pay_to_box`'s `named_by`). */
export interface NamedBy {
    how: "request" | "changed" | "vendor";
    user: string | null;
    full_name: string | null;
    /** ISO date. */
    on: string | null;
}

/** Record Payment's "Set by" line. */
export const namedByText = (namedBy: NamedBy | null, vendorName: string | null): string => {
    if (!namedBy) return "Not recorded";
    const who = namedBy.full_name || namedBy.user || "Someone";
    const day = namedBy.on ? formatDate(namedBy.on) : "";
    switch (namedBy.how) {
        case "request":
            return `${who} on the request${day ? `, ${day}` : ""}`;
        case "changed":
            return `Changed by ${who}${day ? `, ${day}` : ""}`;
        case "vendor":
            return `Copied from ${vendorName || "the vendor"}'s account`;
    }
};
