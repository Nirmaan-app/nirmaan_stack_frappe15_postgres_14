/**
 * Payee (spec #1420, ADR-0033): one bank account the company pays into, with its holder's name.
 * No two Payees share an account number + IFSC (spaces, dashes and leading zeros ignored).
 * Written only by the server's Payee module (`nirmaan_stack/services/payees/`).
 */

export const PAYEE_DOCTYPE = "Payee";

export const PAYEE_STATUS = {
    ACTIVE: "Active",
    INACTIVE: "Inactive",
} as const;

export type PayeeStatus = (typeof PAYEE_STATUS)[keyof typeof PAYEE_STATUS];

/** The `Payee` doctype. */
export interface Payee {
    name: string;
    creation: string;
    modified: string;
    owner: string;
    modified_by: string;
    account_name: string;
    /** Stored without spaces or dashes. */
    account_number: string;
    ifsc: string;
    bank_name?: string;
    bank_branch?: string;
    status: PayeeStatus;
    /** The account number without leading zeros either; unique with `ifsc`. Server-written. */
    normalized_account: string;
}

/**
 * A Payee with what it is linked to, as every Payee endpoint returns it
 * (`services/payees/links.summary_row`): the Payees list rows, `add_payee`, `check_payee`.
 */
export interface PayeeSummary {
    name: string;
    account_name: string;
    account_number: string;
    ifsc: string;
    bank_name?: string | null;
    bank_branch?: string | null;
    status: PayeeStatus;
    /** Vendors paid into this account. */
    vendors: number;
    /** Project and Non Project Expenses naming this Payee, at any status. */
    expenses: number;
    /** ISO date of the latest payment that left Approved for it; null when never paid. */
    last_paid: string | null;
}

/**
 * A Payee as a picker shows it (#1429): a search row from `api/expense_requests/payees.search_payees`
 * (with `times_paid`), or a `PayeeSummary` (the vendor's Payee, one just added, a request's own).
 */
export interface PayeeOption {
    name: string;
    account_name: string;
    account_number: string;
    ifsc: string;
    bank_name?: string | null;
    bank_branch?: string | null;
    status: PayeeStatus;
    /** How many payments have left Approved for it; only search rows carry it. */
    times_paid?: number;
}
