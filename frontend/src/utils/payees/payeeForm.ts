/**
 * The Add Payee form's rules (spec #1420, ADR-0033), pure so they test without React.
 *
 * The server's Payee module is the enforcement boundary (`services/payees/rules.py`: required
 * fields, IFSC shape, the duplicate refusal); these mirror its wording so the dialog can block
 * early. The confirmation field is the one rule that lives only here: the server never sees it.
 */

import type { PayeeSummary } from "@/types/NirmaanStack/Payee";

/** What the person types into Add Payee (and, later, the vendor and request forms). */
export interface PayeeFormValues {
    account_name: string;
    account_number: string;
    confirm_account_number: string;
    ifsc: string;
}

export const EMPTY_PAYEE_FORM: PayeeFormValues = {
    account_name: "",
    account_number: "",
    confirm_account_number: "",
    ifsc: "",
};

const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const IFSC_SHAPE_PROBLEM =
    "An IFSC is 11 characters: four letters, a zero, then six letters or digits (e.g. SBIN0005943).";
const ACCOUNT_CHARS = /^[A-Z0-9]+$/;

/** The account number as the server stores it: no spaces or dashes, upper-cased. */
export const cleanAccountNumber = (value: string): string => value.replace(/[\s-]+/g, "").toUpperCase();

/** The account's identity form (also no leading zeros), as the server compares Payees. */
export const normalizeAccount = (value: string): string => {
    const clean = cleanAccountNumber(value);
    return clean ? clean.replace(/^0+/, "") || "0" : "";
};

export const cleanIfsc = (value: string): string => value.trim().toUpperCase();

/** What a person enters for an account: the holder name, the number and the IFSC. A record's copy
 *  may lack any of them. */
export interface AccountDetails {
    account_name?: string | null;
    account_number?: string | null;
    ifsc?: string | null;
}

/** A holder name with its spacing collapsed and trimmed, case kept (as the server stores it,
 *  `rules.parse_details`). A missing name reads as blank. */
export const squashHolderName = (name: string | null | undefined): string => (name ?? "").replace(/\s+/g, " ").trim();

/**
 * The vendor rename prompt's "same name?": spacing and case aside, so a vendor renamed to its holder
 * name in another case needs no prompt. Not for an account's details: there case counts
 * (`sameAccountDetails`).
 */
export const sameHolderName = (a: string | null | undefined, b: string | null | undefined): boolean =>
    squashHolderName(a).toLowerCase() === squashHolderName(b).toLowerCase();

/**
 * THE screen's "same account details?": the same holder name (spacing aside, case kept: the bank gets
 * the beneficiary name as written, so "ABC TRADERS" -> "Abc Traders" is a real edit), account number
 * (spaces, dashes and case aside, but not leading zeros: the number is written as typed) and IFSC.
 * Saving either one over the other would change nothing: Edit has nothing to save, and Change account
 * would copy the account the expense already holds. Not the server's "is the vendor's account another
 * account?" (`paid_to.vendor_account_to_take`), which ignores the holder name.
 */
export const sameAccountDetails = (a: AccountDetails, b: AccountDetails): boolean =>
    squashHolderName(a.account_name) === squashHolderName(b.account_name) &&
    cleanAccountNumber(a.account_number ?? "") === cleanAccountNumber(b.account_number ?? "") &&
    cleanIfsc(a.ifsc ?? "") === cleanIfsc(b.ifsc ?? "");

/**
 * An account number for a CSV export. Excel reads a bare `0809…` as a number: it drops the leading
 * zeros and rounds past 15 digits. `="0809…"` opens as that exact text. (Never for the bank file,
 * which the bank reads as plain text.)
 */
export const accountNumberCsvCell = (value: string | null | undefined): string => (value ? `="${value}"` : "");

/** True when `value` has an IFSC's shape: four letters, a zero, six letters or digits. */
export const isIfscShaped = (value: string): boolean => IFSC_PATTERN.test(cleanIfsc(value));

/** The two typed account numbers are the same (spacing aside; a leading zero counts). */
export const accountsMatch = (form: PayeeFormValues): boolean => {
    const a = cleanAccountNumber(form.account_number);
    return !!a && a === cleanAccountNumber(form.confirm_account_number);
};

/**
 * Why the form can't be submitted yet, or null. `bankFound` is whether the IFSC lookup found a bank.
 */
export const payeeFormProblem = (form: PayeeFormValues, { bankFound }: { bankFound: boolean }): string | null => {
    if (!form.account_name.trim()) return "Enter the account holder name.";
    const number = cleanAccountNumber(form.account_number);
    if (!number || normalizeAccount(number) === "0") return "Enter the account number.";
    if (!ACCOUNT_CHARS.test(number)) return "An account number holds only letters and digits.";
    if (!accountsMatch(form)) return "The account numbers don't match.";
    if (!cleanIfsc(form.ifsc)) return "Enter the IFSC.";
    if (!isIfscShaped(form.ifsc)) return IFSC_SHAPE_PROBLEM;
    if (!bankFound) return "The IFSC was not found.";
    return null;
};

/**
 * The IFSC box's own shape message, or null: shown once all 11 characters are typed, or when the
 * person `left` the box with a wrong one, so the reason sits under the box rather than only on the
 * disabled button.
 */
export const ifscShapeProblem = (ifsc: string, { left }: { left: boolean }): string | null => {
    const clean = cleanIfsc(ifsc);
    if (!clean || isIfscShaped(clean)) return null;
    return clean.length >= 11 || left ? IFSC_SHAPE_PROBLEM : null;
};

/**
 * Why new bank details on screen can't be saved yet, or null: the IFSC lookup is still running, the
 * form has a problem (`payeeFormProblem`), or a Payee already holds the account. One rule for every
 * screen that adds a Payee (the vendor screens' Payee step, the request's and Change account's picker).
 */
export const newPayeeProblem = ({
    formProblem,
    duplicate,
    lookingUp,
    ownAccountRefused = false,
}: {
    formProblem: string | null;
    duplicate: boolean;
    lookingUp: boolean;
    /** The duplicate is a person's own account and this screen can't use one (`refusesOwnAccount`). */
    ownAccountRefused?: boolean;
}): string | null => {
    if (lookingUp) return "Wait for the IFSC lookup.";
    if (formProblem) return formProblem;
    if (duplicate) return ownAccountRefused ? OWN_ACCOUNT_REFUSAL : "This account is already a payee. Use that payee instead of adding a new one.";
    return null;
};

/** Why an Expense Request can't use a person's own account (owner, 2026-10-27). Twin of
 *  `services/payees/pay_to.OWN_ACCOUNT_REFUSAL`, which the server refuses with. */
export const OWN_ACCOUNT_REFUSAL =
    "This is a user's own account (Users), so it can't be used in an expense request. Enter a different account.";

/** A duplicate the request screen must refuse rather than offer: a Users Payee, someone's own account. */
export const refusesOwnAccount = (refuse: boolean | undefined, dup: Pick<PayeeSummary, "payee_type"> | null): boolean =>
    !!refuse && dup?.payee_type === "Users";

/** "HDFC Bank, Rohtak": a Payee's bank and branch as every screen shows them; empty when neither is known. */
export const bankLine = (p: { bank_name?: string | null; bank_branch?: string | null }): string =>
    [p.bank_name, p.bank_branch].filter(Boolean).join(", ");

/** "3 vendors", "1 vendor": how many vendors link to a Payee; null when none does. A Payee is linked
 *  to vendors only: nothing paid points back at it (#1434). */
export const linkedVendorsLabel = (vendors: number): string | null =>
    vendors ? `${vendors} vendor${vendors === 1 ? "" : "s"}` : null;

/** What a Payee with no vendor says it is linked to. */
export const NO_VENDOR_LINKED = "No vendor is linked to it yet.";

/** The duplicate block's sentence: which Payee already holds the account, the vendors on it, and what
 *  to do. Adding: pick that Payee. Editing a Payee (`editing`): there is nothing to pick, so use a
 *  different account, or open that Payee. */
export const duplicateSentence = (
    dup: Pick<PayeeSummary, "name" | "account_name" | "vendors">,
    { editing = false }: { editing?: boolean } = {},
): string => {
    const label = linkedVendorsLabel(dup.vendors);
    const linked = label ? `It is linked to ${label}.` : NO_VENDOR_LINKED;
    const action = editing ? "Use a different account, or open that payee." : "Pick that payee instead of adding a new one.";
    return `${dup.name}, ${dup.account_name}, has the same account number and IFSC. ${linked} ${action}`;
};
