/**
 * Who a payment row is paid to (spec #1420 ticket #1431, ADR-0033), as the screens say it. Pure.
 *
 * The server's Payee module resolves it (`services/payees/paid_to.py`): a PO / WO payment is paid
 * into its vendor's Payee, an expense into its own. These only word the answer: the "Payment need
 * to paid" Paid to cell, its CSV column, and Record Payment's "Named by".
 */

import type { PayeeStatus } from "@/types/NirmaanStack/Payee";
import { formatDate } from "@/utils/FormatDate";

import { PAYEE_RULE, asPayeeRule } from "./expensePayee";

/** The account a row is paid into (`paid_to.paid_to_rows`'s `account`). */
export interface PaidToAccount {
    payee: string;
    account_name: string;
    account_number: string;
    ifsc: string;
    bank_name?: string | null;
    bank_branch?: string | null;
    status: PayeeStatus;
}

export const PAID_TO_MISSING = {
    VENDOR_HAS_NO_PAYEE: "vendor_has_no_payee",
    EXPENSE_HAS_NO_PAYEE: "expense_has_no_payee",
} as const;

export type PaidToMissing = (typeof PAID_TO_MISSING)[keyof typeof PAID_TO_MISSING];

/** Who a row is paid to, as `api/payees/expense_payee.get_paid_to` and the approval queue send it. */
export interface PaidTo {
    account: PaidToAccount | null;
    missing: PaidToMissing | null;
    /** The expense type's *Who gets paid*, on an expense with no Payee. */
    payee_rule: string | null;
}

export interface PaidToCell {
    tone: "account" | "no_payee" | "vendor_no_payee";
    title: string;
    detail: string;
}

/** The Paid to cell: the holder name with the account and IFSC under it, or why there is none. */
export const paidToCell = (paidTo: PaidTo | undefined, expenseType: string): PaidToCell => {
    const account = paidTo?.account;
    if (account) {
        return { tone: "account", title: account.account_name, detail: `A/c ${account.account_number}, ${account.ifsc}` };
    }
    if (paidTo?.missing === PAID_TO_MISSING.VENDOR_HAS_NO_PAYEE) {
        return {
            tone: "vendor_no_payee",
            title: "Vendor has no bank account",
            detail: "Add one on the vendor page before paying.",
        };
    }
    const type = expenseType || "Its type";
    return {
        tone: "no_payee",
        title: "No payee",
        detail: asPayeeRule(paidTo?.payee_rule) === PAYEE_RULE.REQUIRED
            ? `${type} requires one. Add it with Change payee in Record Payment.`
            : `${type} doesn't require one. Paid by card or cash.`,
    };
};

/** The Paid to cell on one line, for the table's CSV. */
export const paidToExportText = (paidTo: PaidTo | undefined, expenseType: string): string => {
    const cell = paidToCell(paidTo, expenseType);
    return cell.tone === "account" ? `${cell.title}, ${cell.detail}` : cell.title;
};

/** Record Payment's "Pay ₹X to" box for an expense with no Payee. */
export const noPayeeBoxText = (rule: string | null | undefined, expenseType: string): string => {
    const type = expenseType || "Its type";
    return asPayeeRule(rule) === PAYEE_RULE.REQUIRED
        ? `${type} requires a payee. Use Change payee to name one before paying.`
        : `${type} doesn't require one. Pay by card or cash, or use Change payee to name one.`;
};

/** Who named an expense's Payee (`paid_to.expense_pay_to`'s `named_by`). */
export interface NamedBy {
    how: "request" | "changed" | "vendor";
    user: string | null;
    full_name: string | null;
    /** ISO date. */
    on: string | null;
}

/** Record Payment's "Named by" line. */
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
            return `${vendorName || "The vendor"}'s account (the expense's vendor)`;
    }
};
