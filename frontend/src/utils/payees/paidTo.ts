/**
 * Who a payment row is paid to (spec #1420 tickets #1431, #1438, #1439, ADR-0033), as the screens say it. Pure.
 *
 * The server's Payee module resolves it (`services/payees/paid_to.py`): every PO / WO payment and
 * expense is paid into its OWN pay-to account, copied when it was raised. These only word the answer:
 * the "Payment need to paid" Paid to cell, its CSV column, and Record Payment's "Pay ₹X to" box.
 */

import type { PayToAccount } from "@/types/NirmaanStack/Payee";
import { formatDate } from "@/utils/FormatDate";
import { SETTLED_STATUSES } from "@/utils/settlement";

import { PAYEE_RULE, asPayeeRule } from "./expensePayee";

/** A PO / Work Order payment (`paid_to.PAYMENT_DOCTYPE`); every other row the accountant pays is an expense. */
export const PAYMENT_DOCTYPE = "Project Payments";

/** The rows Record Payment shows the "Pay ₹X to" box for (`paid_to.PAID_TO_DOCTYPES`). */
export type PayToBoxDoctype = typeof PAYMENT_DOCTYPE | "Project Expenses" | "Non Project Expenses";

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
    /** An expense's type's *Who gets paid*, with or without an account; null on a PO / WO payment. */
    payee_rule: string | null;
    /** A PO / WO payment whose vendor's Payee no longer holds its copy's account (normalised account
     *  number, IFSC), or whose vendor has no Payee any more (#1439). It is rejected and raised again,
     *  never paid. Never set on an expense or a row with no account. */
    account_changed: boolean;
    /** On a flagged payment, its vendor's account now; null when the vendor has none. */
    current_account: PayToAccount | null;
}

/** Which answer a row has, with what each answer needs: its account; its account with the vendor's
 *  changed since (#1439); no account on a PO / WO payment; no account on an expense, with its type's
 *  rule. */
export type PaidToKind =
    | { tone: "account"; account: PayToAccount }
    | { tone: "account_changed"; account: PayToAccount; current: PayToAccount | null }
    | { tone: "payment_no_account" }
    | { tone: "no_account"; rule: string | null };

export type PaidToTone = PaidToKind["tone"];

export interface PaidToCell {
    tone: PaidToTone;
    title: string;
    detail: string;
}

/** THE classifier every Paid to wording starts from (the cell, its CSV, the "Pay ₹X to" box). A row
 *  the server sent without paid_to has no account. */
export const classifyPaidTo = (paidTo: PaidTo | undefined): PaidToKind => {
    const account = paidTo?.account;
    if (account) {
        return paidTo.account_changed
            ? { tone: "account_changed", account, current: paidTo.current_account }
            : { tone: "account", account };
    }
    return paidTo?.missing === PAID_TO_MISSING.PAYMENT_HAS_NO_ACCOUNT
        ? { tone: "payment_no_account" }
        : { tone: "no_account", rule: paidTo?.payee_rule ?? null };
};

/** Why an expense of this type has no account, by its type's *Who gets paid* (spec story 56). */
const expenseNoAccountReason = (rule: string | null | undefined, expenseType: string): string => {
    const type = expenseType || "Its type";
    switch (asPayeeRule(rule)) {
        case PAYEE_RULE.REQUIRED:
            return `${type} requires one.`;
        case PAYEE_RULE.OPTIONAL:
            return `No account given; optional for ${expenseType || "its type"}.`;
        case PAYEE_RULE.NOT_ASKED:
            return "Not asked for this expense type.";
    }
};

export const ACCOUNT_CHANGED_TITLE = "Vendor's account changed since this was raised";

/** Where a flagged payment's vendor is paid now, on one line. */
export const currentAccountText = (current: PayToAccount | null): string =>
    current
        ? `Now ${current.account_name}, A/c ${current.account_number}, ${current.ifsc}.`
        : "The vendor has no account now.";

/**
 * The Paid to cell: the holder name with the account and IFSC under it, the account-changed warning,
 * or why there is no account. By the row's `status` (required, so no caller forgets it), a paid row
 * (Reconciliation Pending, Paid:
 * spec stories 56/60) reads as a record of where the money went: its own account plainly, never the
 * "vendor's account changed since" flag, and no advice to act (reject, raise again, Change account),
 * which is wrong once the money has left. Record Payment's box keeps its own wording (`PayToBox`).
 */
export const paidToCell = (paidTo: PaidTo | undefined, expenseType: string, status: string): PaidToCell => {
    // Paid means settled: the server's `rules.PAID_STATUSES` is `settlement.SETTLED_STATUSES` too.
    const paid = (SETTLED_STATUSES as readonly string[]).includes(status);
    const kind = classifyPaidTo(paid && paidTo ? { ...paidTo, account_changed: false, current_account: null } : paidTo);
    switch (kind.tone) {
        case "account_changed":
            return {
                tone: kind.tone,
                title: ACCOUNT_CHANGED_TITLE,
                detail: `${currentAccountText(kind.current)} Reject it and raise it again.`,
            };
        case "account":
            return {
                tone: kind.tone,
                title: kind.account.account_name,
                detail: `A/c ${kind.account.account_number}, ${kind.account.ifsc}`,
            };
        case "payment_no_account":
            return {
                tone: kind.tone,
                title: "No account on this payment",
                detail: paid ? "It was paid without one on record." : "Pay it another way, or reject it and raise it again.",
            };
        case "no_account": {
            const reason = expenseNoAccountReason(kind.rule, expenseType);
            return {
                tone: kind.tone,
                title: "No account",
                detail: asPayeeRule(kind.rule) === PAYEE_RULE.REQUIRED && !paid
                    ? `${reason} Add it with Change account in Record Payment.`
                    : reason,
            };
        }
    }
};

/** The Paid to cell on one line, for the table's CSV. */
export const paidToExportText = (paidTo: PaidTo | undefined, expenseType: string, status: string): string => {
    const cell = paidToCell(paidTo, expenseType, status);
    if (cell.tone === "account") return `${cell.title}, ${cell.detail}`;
    if (cell.tone === "account_changed" || cell.tone === "no_account") return `${cell.title}: ${cell.detail}`;
    return cell.title;
};

/** Record Payment's "Pay ₹X to" box for an expense with no account and no vendor. */
const noAccountBoxText = (rule: string | null | undefined, expenseType: string): string =>
    asPayeeRule(rule) === PAYEE_RULE.REQUIRED
        ? `${expenseType || "Its type"} requires an account. Use Change account to set one before paying.`
        : `${expenseNoAccountReason(rule, expenseType)} Pay by card or cash, or use Change account to set one.`;

/** What the "Pay ₹X to" box reads of `paid_to.pay_to_box` to decide what it shows. */
export interface PayToBoxFacts extends PaidTo {
    vendor_fixed: boolean;
    vendor_name: string | null;
}

/** What Record Payment's "Pay ₹X to" box shows besides the account itself, decided once. */
export interface PayToBoxView {
    /** The box's colour: red when the vendor's account changed since, green with an account, amber
     *  with none. */
    tone: "account_changed" | "account" | "no_account";
    /** Why there is no account: a bold title and a line. Null when there is one. */
    noAccount: { title: string; detail: string } | null;
    /** The small print under an account, saying where it was copied from. Null when none. */
    note: string | null;
}

export const payToBoxView = (doctype: PayToBoxDoctype, box: PayToBoxFacts, expenseType: string): PayToBoxView => {
    const vendor = box.vendor_name || "the vendor";
    switch (classifyPaidTo(box).tone) {
        case "account_changed":
            return { tone: "account_changed", noAccount: null, note: null };
        case "account": {
            let note: string | null = null;
            if (doctype === PAYMENT_DOCTYPE) {
                note =
                    `Copied from ${vendor}'s account when this payment was raised. A payment's account is never ` +
                    "changed: if it is wrong, reject the payment and raise it again.";
            } else if (box.vendor_fixed) {
                note = `Copied from ${vendor}'s account. To pay someone else, the expense's vendor has to change.`;
            }
            return { tone: "account", noAccount: null, note };
        }
        case "payment_no_account":
            return {
                tone: "no_account",
                noAccount: {
                    title: "No account on this payment.",
                    detail: `Pay it another way, or reject it and raise it again once ${vendor} has a bank account.`,
                },
                note: null,
            };
        case "no_account":
            return {
                tone: "no_account",
                noAccount: {
                    title: "No account.",
                    detail: box.vendor_fixed
                        ? `${box.vendor_name || "The vendor"} had no bank account on record when this was raised.`
                        : noAccountBoxText(box.payee_rule, expenseType),
                },
                note: null,
            };
    }
};

/**
 * Whether Record Payment offers Change account (a screen rule, ADR-0033): Accounts change an expense's
 * account until it is paid, unless a vendor is named (then it is the vendor's). A PO / WO payment's
 * copy is never changed: a wrong one means reject and raise again.
 */
export const canChangeExpenseAccount = (
    doctype: PayToBoxDoctype,
    box: { paid: boolean; vendor_fixed: boolean },
    isAccounts: boolean,
): boolean => isAccounts && doctype !== PAYMENT_DOCTYPE && !box.paid && !box.vendor_fixed;

/** How a screen names an expense to an accountant: its description's first line (cut at `max`
 *  characters), else its type. Never its ID, which means nothing to them. Change account and the bank
 *  file's left-out toast use it. */
export const expenseTitle = (description: string | null | undefined, expenseType: string, max = 60): string => {
    const line = (description || "").split("\n")[0].trim();
    if (!line) return expenseType || "This expense";
    return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
};

/** Whether Change account offers Remove account: the expense has one and its type doesn't require one
 *  (a screen rule: a Required type always has an account). */
export const canRemoveExpenseAccount = (rule: string | null | undefined, hasAccount: boolean): boolean =>
    hasAccount && asPayeeRule(rule) !== PAYEE_RULE.REQUIRED;

/** How Change account names an expense type: the type, or "its type" when unknown. */
const changeAccountTypeLabel = (expenseType: string): string => expenseType || "its type";

const sentenceStart = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** What Change account adds after the expense's title: its type in brackets, unless the title already
 *  is the type (no description) or the type is unknown. */
export const expenseTypeAside = (title: string, expenseType: string): string =>
    expenseType && title !== expenseType ? ` (${expenseType})` : "";

/** Change account's line on the expense type's *Who gets paid*, and whether the account may go. */
export const changeAccountRuleLine = (
    rule: string | null | undefined,
    expenseType: string,
    hasAccount: boolean,
): string => {
    const type = changeAccountTypeLabel(expenseType);
    const remove = canRemoveExpenseAccount(rule, hasAccount) ? " Remove it if this is paid by card or cash." : "";
    switch (asPayeeRule(rule)) {
        case PAYEE_RULE.REQUIRED:
            return hasAccount
                ? `${sentenceStart(type)} requires an account: it can be changed, not removed.`
                : `${sentenceStart(type)} requires an account.`;
        case PAYEE_RULE.OPTIONAL:
            return `An account is optional for ${type}.${remove}`;
        case PAYEE_RULE.NOT_ASKED:
            return `${sentenceStart(type)} doesn't ask for an account.${remove}`;
    }
};

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
