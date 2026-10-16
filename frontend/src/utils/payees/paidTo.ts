/**
 * Who a payment row is paid to (spec #1420 tickets #1431, #1438, #1463, #1464, ADR-0033), as the screens say it. Pure.
 *
 * The server's Payee module resolves it (`services/payees/paid_to.py`): every PO / WO payment and
 * expense is paid into its OWN pay-to account, copied when it was raised, except an unpaid PO / WO
 * Approved PO / WO payment whose vendor's account changed since, or that has none: it is paid into the
 * vendor's current account (`switch_to`). A row a cheque pays never switches (`by_cheque`). These only word the
 * answer: the "Payment need to paid" Paid to cell, its CSV column, Mark as Paid's confirmation and
 * Record Payment's "Pay ₹X to" box; and decide from it whether a row can be paid (`rowEligibility`).
 */

import type { PayToAccount } from "@/types/NirmaanStack/Payee";
import { formatDate } from "@/utils/FormatDate";
import { SETTLED_STATUSES, STATUS_APPROVED } from "@/utils/settlement";
import { toastList } from "@/utils/toastList";

import { PAYEE_RULE, asPayeeRule } from "./expensePayee";

/** Raised and waiting for its first approval. */
const STATUS_REQUESTED = "Requested";

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
    /** On an Approved PO / WO payment whose vendor's account is another (normalised account number,
     *  IFSC), or that holds none while its vendor has one (#1463): the vendor's current account, which
     *  it is paid into. Exporting it or marking it paid writes this onto the payment. Null on every
     *  other row. */
    switch_to: PayToAccount | null;
    /** A row a cheque pays (#1464): a PO / WO payment requested as one, or any payment or expense on a
     *  Cheque that is not Cancelled. It never switches, and is kept out of the bank file. */
    by_cheque: boolean;
    /** An Approved PO / WO payment holding its own account while its vendor has none now: it is paid
     *  into the account it was raised with, and the screens say so (`VENDOR_HAS_NO_ACCOUNT_NOW`). */
    vendor_has_no_account: boolean;
}

/** Which answer a row has, with what each answer needs: its account; its vendor's current account in
 *  place of its own (`was`, null when it had none, #1463); no account on a PO / WO payment; no
 *  account on an expense, with its type's rule. */
export type PaidToKind =
    | { tone: "account"; account: PayToAccount }
    | { tone: "vendor_account"; account: PayToAccount; was: PayToAccount | null }
    | { tone: "payment_no_account" }
    | { tone: "no_account"; rule: string | null };

export type PaidToTone = PaidToKind["tone"];

export interface PaidToCell {
    /** `cheque`: an unpaid cheque payment, whose account the cell doesn't show (a cheque pays none). */
    tone: PaidToTone | "cheque";
    title: string;
    detail: string;
}

/** THE classifier every Paid to wording starts from (the cell, its CSV, the "Pay ₹X to" box). A row
 *  the server sent without paid_to has no account. */
export const classifyPaidTo = (paidTo: PaidTo | undefined): PaidToKind => {
    if (paidTo?.switch_to) return { tone: "vendor_account", account: paidTo.switch_to, was: paidTo.account };
    const account = paidTo?.account;
    if (account) return { tone: "account", account };
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

/** Why a row is Ineligible (nowhere to send its money) or Kept out of the bank file (paid another way). */
export const ELIGIBILITY_REASON = {
    VENDOR_HAS_NO_ACCOUNT: "vendor_has_no_account",
    REQUIRED_TYPE_HAS_NO_ACCOUNT: "required_type_has_no_account",
    CHEQUE: "cheque",
    CARD_OR_CASH: "card_or_cash",
} as const;

type Reason = typeof ELIGIBILITY_REASON;
export type IneligibleReason = Reason["VENDOR_HAS_NO_ACCOUNT"] | Reason["REQUIRED_TYPE_HAS_NO_ACCOUNT"];
export type KeptOutReason = Reason["CHEQUE"] | Reason["CARD_OR_CASH"];

/** Whether a row on "Payment need to paid" can be paid, and how (GLOSSARY *Ineligible*, *Kept out of
 *  the bank file*). `text` is the reason as the screen shows it. */
export type RowEligibility =
    | { kind: "payable" }
    | { kind: "kept_out"; reason: KeptOutReason; text: string }
    | { kind: "ineligible"; reason: IneligibleReason; text: string };

const PAYABLE: RowEligibility = { kind: "payable" };
const KEPT_OUT_TEXT: Record<KeptOutReason, string> = {
    [ELIGIBILITY_REASON.CHEQUE]: "Paid by cheque: kept out of the bank file.",
    [ELIGIBILITY_REASON.CARD_OR_CASH]: "Paid by card or cash: kept out of the bank file.",
};
const keptOut = (reason: KeptOutReason): RowEligibility => ({ kind: "kept_out", reason, text: KEPT_OUT_TEXT[reason] });

/**
 * THE rule for which rows can be paid (ADR-0033 decision 10, #1464), a screen rule:
 *
 * - *payable*: into its own account, or a PO / WO payment into its vendor's current one (`switch_to`);
 * - *kept out of the bank file*: any cheque payment, and an expense of an Optional / Not asked type
 *   with no account (paid by card or cash). It can be ticked and marked paid; the export leaves it out;
 * - *Ineligible*: a PO / WO payment with no account whose vendor has none, or an expense of a Required
 *   type with no account. There is nowhere to send its money: it can't be ticked, exported or marked
 *   paid until an account is added.
 *
 * Read from the server's paid-to answer, so the queue (as loaded) and the bank file (read again at
 * export) decide alike. A held payment is a separate rule (`queueRowActions.isHeldQueueRow`).
 */
export const rowEligibility = (paidTo: PaidTo | undefined, expenseType: string): RowEligibility => {
    if (paidTo?.by_cheque) return keptOut(ELIGIBILITY_REASON.CHEQUE);
    const kind = classifyPaidTo(paidTo);
    switch (kind.tone) {
        case "account":
        case "vendor_account":
            return PAYABLE;
        case "payment_no_account":
            return {
                kind: "ineligible",
                reason: ELIGIBILITY_REASON.VENDOR_HAS_NO_ACCOUNT,
                text: "Vendor has no bank account. Add it on the vendor page.",
            };
        case "no_account":
            return asPayeeRule(kind.rule) === PAYEE_RULE.REQUIRED
                ? {
                      kind: "ineligible",
                      reason: ELIGIBILITY_REASON.REQUIRED_TYPE_HAS_NO_ACCOUNT,
                      text: `${expenseType || "Its type"} requires an account. Add it with the Edit pencil.`,
                  }
                : keptOut(ELIGIBILITY_REASON.CARD_OR_CASH);
    }
};

/** Why a held payment can't be paid now (Mark as Paid's toast). */
export const HELD_REASON = "It is on hold.";

/**
 * Why a row on "Payment need to paid" can't be ticked or marked paid now, as the screen says it, or
 * null when it can. THE rule `queueRowActions.canPayQueueRow` reads: an Ineligible row (nowhere to
 * send its money, `rowEligibility`) or a held payment (`held`). A row kept out of the bank file can
 * be paid: only the export leaves it out.
 */
export const unpayableReason = (paidTo: PaidTo | undefined, expenseType: string, held: boolean): string | null => {
    const eligibility = rowEligibility(paidTo, expenseType);
    if (eligibility.kind === "ineligible") return eligibility.text;
    return held ? HELD_REASON : null;
};

/** A PO / WO payment `take_vendor_accounts` left alone because it is no longer Approved, with the
 *  status it found. */
export interface SkippedPayment {
    name: string;
    status: string;
}

/** A row left out because `take_vendor_accounts` skipped it, with the status the server found. */
export interface SkippedRow<T> {
    row: T;
    status: string;
}

/**
 * The rows without the PO / WO payments `take_vendor_accounts` skipped (#1463): one no longer
 * Approved is not marked paid again, nor put in the bank file. `skipped` pairs each left-out row with
 * the status the server found, so the toast can name it (`describeSkipped`). `isVendorPayment` says
 * which rows are PO / WO payments (a queue row by its doctype, a bank-file row by its kind): expenses
 * are never skipped here.
 */
export const leaveOutSkipped = <T extends { name: string }>(
    rows: readonly T[],
    skipped: readonly SkippedPayment[],
    isVendorPayment: (row: T) => boolean,
): { kept: T[]; skipped: SkippedRow<T>[] } => {
    const statusOf = new Map(skipped.map((s) => [s.name, s.status]));
    const kept: T[] = [];
    const left: SkippedRow<T>[] = [];
    for (const row of rows) {
        const status = isVendorPayment(row) ? statusOf.get(row.name) : undefined;
        if (status === undefined) kept.push(row);
        else left.push({ row, status });
    }
    return { kept, skipped: left };
};

/** The toast's line on the payments left out as no longer Approved, each named by `nameOf` (its PO /
 *  SR), e.g. "Left out, no longer Approved: PO/009 (Paid) · PO/010 (Reconciliation Pending)"; null
 *  when none. Mark as Paid and Export for Payment both say it. */
export const describeSkipped = <T>(skipped: readonly SkippedRow<T>[], nameOf: (row: T) => string): string | null =>
    skipped.length === 0
        ? null
        : `Left out, no longer Approved: ${toastList(skipped.map((s) => `${nameOf(s.row)} (${s.status})`))}`;

export const VENDOR_ACCOUNT_TITLE = "Will be paid into the vendor's current account";

/** The line under a PO / WO payment paid into its own account because its vendor has none now. */
export const VENDOR_HAS_NO_ACCOUNT_NOW = "The vendor has no bank account on record now. Paid to the account it was raised with.";

/** An account on one line: holder name, account number, IFSC. */
const accountText = (account: PayToAccount): string =>
    `${account.account_name}, A/c ${account.account_number}, ${account.ifsc}`;

/** The vendor's current account a PO / WO payment is paid into, and the one it was raised with. */
const vendorAccountDetail = (account: PayToAccount, was: PayToAccount | null): string =>
    `${accountText(account)}. ${was ? `Was ${accountText(was)}.` : "It was raised with no account."}`;

/**
 * The Paid to cell: the holder name with the account and IFSC under it, the vendor's current account
 * a PO / WO payment switches to (with the one it was raised with), or why there is no account. By
 * the row's `status` (required, so no caller forgets it), a paid row (Reconciliation Pending, Paid:
 * spec stories 56/60) reads as a record of where the money went, with no advice to act (Change
 * account, adding bank details), which is wrong once the money has left. The server never switches a
 * paid row. An unpaid row that can't be paid, or is kept out of the bank file, says why in
 * `rowEligibility`'s words (#1464). Record Payment's box keeps its own wording (`PayToBox`).
 */
export const paidToCell = (paidTo: PaidTo | undefined, expenseType: string, status: string): PaidToCell => {
    // Paid means settled: the server's `rules.PAID_STATUSES` is `settlement.SETTLED_STATUSES` too.
    const paid = (SETTLED_STATUSES as readonly string[]).includes(status);
    const eligibility = rowEligibility(paidTo, expenseType);
    if (!paid && eligibility.kind === "kept_out" && eligibility.reason === ELIGIBILITY_REASON.CHEQUE) {
        return { tone: "cheque", title: "Paid by cheque", detail: "Kept out of the bank file." };
    }
    const unpaidReason = !paid && eligibility.kind !== "payable" ? eligibility.text : null;
    const kind = classifyPaidTo(paidTo);
    switch (kind.tone) {
        case "vendor_account":
            return { tone: kind.tone, title: VENDOR_ACCOUNT_TITLE, detail: vendorAccountDetail(kind.account, kind.was) };
        case "account": {
            const lost = !paid && paidTo?.vendor_has_no_account ? `. ${VENDOR_HAS_NO_ACCOUNT_NOW}` : "";
            return {
                tone: kind.tone,
                title: kind.account.account_name,
                detail: `A/c ${kind.account.account_number}, ${kind.account.ifsc}${lost}`,
            };
        }
        case "payment_no_account":
            return {
                tone: kind.tone,
                title: "No account on this payment",
                detail: unpaidReason ?? "It was paid without one on record.",
            };
        case "no_account": {
            const reason = expenseNoAccountReason(kind.rule, expenseType);
            let detail = reason;
            if (unpaidReason) {
                detail = eligibility.kind === "ineligible" ? unpaidReason : `${reason} ${unpaidReason}`;
            }
            return { tone: kind.tone, title: "No account", detail };
        }
    }
};

/** The Paid to cell on one line, for the table's CSV. */
export const paidToExportText = (paidTo: PaidTo | undefined, expenseType: string, status: string): string => {
    const cell = paidToCell(paidTo, expenseType, status);
    if (cell.tone === "account") return `${cell.title}, ${cell.detail}`;
    if (cell.tone === "vendor_account" || cell.tone === "no_account" || cell.tone === "cheque") return `${cell.title}: ${cell.detail}`;
    return cell.title;
};

/** Mark as Paid's line under a row that is paid into its vendor's current account, naming that
 *  account and the old one; null for any other row. */
export const switchLine = (paidTo: PaidTo | undefined): string | null =>
    paidTo?.switch_to ? `${VENDOR_ACCOUNT_TITLE}: ${vendorAccountDetail(paidTo.switch_to, paidTo.account)}` : null;

/** Record Payment's "Pay ₹X to" box for an expense with no account and no vendor. */
const noAccountBoxText = (rule: string | null | undefined, expenseType: string): string =>
    asPayeeRule(rule) === PAYEE_RULE.REQUIRED
        ? `${expenseType || "Its type"} requires an account. Use Change account to set one before paying.`
        : `${expenseNoAccountReason(rule, expenseType)} Pay by card or cash, or use Change account to set one.`;

/** What the "Pay ₹X to" box reads of `paid_to.pay_to_box` to decide what it shows. */
export interface PayToBoxFacts extends PaidTo {
    vendor_fixed: boolean;
    vendor_name: string | null;
    /** Money has left Approved: the box records where it went and gives no advice to act. */
    paid: boolean;
}

/** What Record Payment's "Pay ₹X to" box shows besides the account itself, decided once. */
export interface PayToBoxView {
    /** The box's colour: blue when a PO / WO payment is paid into its vendor's current account, green
     *  with its own account, amber with none. */
    tone: "vendor_account" | "account" | "no_account";
    /** Why there is no account: a bold title and a line. Null when there is one. */
    noAccount: { title: string; detail: string } | null;
    /** The small print under an account, saying where it was copied from. Null when none. */
    note: string | null;
}

export const payToBoxView = (doctype: PayToBoxDoctype, box: PayToBoxFacts, expenseType: string): PayToBoxView => {
    const vendor = box.vendor_name || "the vendor";
    switch (classifyPaidTo(box).tone) {
        case "vendor_account":
            return {
                tone: "vendor_account",
                noAccount: null,
                note: `${sentenceStart(vendor)}'s current account. Exporting this payment or marking it paid records it on the payment.`,
            };
        case "account": {
            let note: string | null = null;
            if (doctype === PAYMENT_DOCTYPE) {
                // A paid payment's account is where its money went: "Set by" says who set it.
                if (box.vendor_has_no_account) {
                    note = box.paid ? null : VENDOR_HAS_NO_ACCOUNT_NOW;
                } else if (!box.paid) {
                    note = `Copied from ${vendor}'s account when this payment was raised. It is never edited by hand: if ` +
                        `${vendor}'s account changes, the payment is paid into the new one.`;
                }
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
                    detail: box.paid
                        ? "It was paid without one on record."
                        : `${sentenceStart(vendor)} has no bank account either. Add one on the vendor's page, and this payment is paid into it.`,
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
 * copy is never edited by hand: it follows its vendor's account when it is paid (#1463).
 */
export const canChangeExpenseAccount = (
    doctype: PayToBoxDoctype,
    box: { paid: boolean; vendor_fixed: boolean },
    isAccounts: boolean,
): boolean => isAccounts && doctype !== PAYMENT_DOCTYPE && !box.paid && !box.vendor_fixed;

/** What the expense Edit dialog's *Who gets paid* section offers (#1465): `change`, Change account's
 *  picker, saved with the edit; `vendor`, the vendor's account read-only; `none`, no section. */
export type EditDialogPayTo = "none" | "vendor" | "change";

/** What decides who may change an expense's account: its status, who raised it (`owner`) and the
 *  Expense Request behind it (`request_id`, blank on a Direct Expense). */
export interface ExpenseRaise {
    status?: string | null;
    owner?: string | null;
    request_id?: string | null;
}

/**
 * The raiser of a Direct Expense changes its account while it is Requested (GLOSSARY *Pay-to account*:
 * "the raiser may change it until approval", #1472). An expense an Expense Request's approval created
 * is not a Direct Expense: its raiser changes the account on the request. A screen rule: the server
 * asks only Frappe's write permission.
 */
export const raiserMayChangeAccount = (expense: ExpenseRaise, user: string | null | undefined): boolean =>
    !!user
    && expense.owner === user
    && !(expense.request_id || "").trim()
    && (expense.status || "").trim() === STATUS_REQUESTED;

/**
 * The expense Edit dialog's *Who gets paid* (a screen rule, ADR-0033 decision 9): Accounts set an
 * expense's account once it is Approved and until it is paid; before that, the raiser of a Direct
 * Expense sets it while it is Requested (`raiserMayChangeAccount`). While a vendor is named in the
 * form it is the vendor's account, read-only: to pay someone else, the Vendor becomes "Others (No
 * Vendor)". `viewer.isAccounts` is `canManagePayees`.
 */
export const editDialogPayTo = (
    expense: ExpenseRaise,
    viewer: { user: string | null | undefined; isAccounts: boolean },
    vendorNamed: boolean,
): EditDialogPayTo => {
    const accountsMay = viewer.isAccounts && (expense.status || "").trim() === STATUS_APPROVED;
    if (!accountsMay && !raiserMayChangeAccount(expense, viewer.user)) return "none";
    return vendorNamed ? "vendor" : "change";
};

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
