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
const ACCOUNT_CHARS = /^[A-Z0-9]+$/;

/** The account number as the server stores it: no spaces or dashes, upper-cased. */
export const cleanAccountNumber = (value: string): string => value.replace(/[\s-]+/g, "").toUpperCase();

/** The account's identity form (also no leading zeros), as the server compares Payees. */
export const normalizeAccount = (value: string): string => {
    const clean = cleanAccountNumber(value);
    return clean ? clean.replace(/^0+/, "") || "0" : "";
};

export const cleanIfsc = (value: string): string => value.trim().toUpperCase();

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
    if (!isIfscShaped(form.ifsc)) {
        return "An IFSC is 11 characters: four letters, a zero, then six letters or digits (e.g. SBIN0005943).";
    }
    if (!bankFound) return "The IFSC was not found.";
    return null;
};

/**
 * Why new bank details on screen can't be saved yet, or null: the IFSC lookup is still running, the
 * form has a problem (`payeeFormProblem`), or a Payee already holds the account. One rule for every
 * screen that adds a Payee (the vendor screens' Payee step, the request's and Change payee's picker).
 */
export const newPayeeProblem = ({
    formProblem,
    duplicate,
    lookingUp,
}: {
    formProblem: string | null;
    duplicate: boolean;
    lookingUp: boolean;
}): string | null => {
    if (lookingUp) return "Wait for the IFSC lookup.";
    if (formProblem) return formProblem;
    if (duplicate) return "This account is already a payee. Use that payee instead of adding a new one.";
    return null;
};

/** "HDFC Bank, Rohtak": a Payee's bank and branch as every screen shows them; empty when neither is known. */
export const bankLine = (p: { bank_name?: string | null; bank_branch?: string | null }): string =>
    [p.bank_name, p.bank_branch].filter(Boolean).join(", ");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "3 vendors", "2 expenses": what a Payee is linked to; empty when nothing. */
export const linkedToLabels = ({ vendors, expenses }: Pick<PayeeSummary, "vendors" | "expenses">): string[] => [
    ...(vendors ? [plural(vendors, "vendor")] : []),
    ...(expenses ? [plural(expenses, "expense")] : []),
];

/** The duplicate block's sentence: which Payee already holds the account, and what it is linked to. */
export const duplicateSentence = (
    dup: Pick<PayeeSummary, "name" | "account_name" | "vendors" | "expenses">,
): string => {
    const links = linkedToLabels(dup);
    const linked = links.length ? `It is linked to ${links.join(" and ")}.` : "It is not linked to anything yet.";
    return `${dup.name}, ${dup.account_name}, has the same account number and IFSC. ${linked} Pick that payee instead of adding a new one.`;
};
