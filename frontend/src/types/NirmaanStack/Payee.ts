/**
 * Payee (spec #1420, ADR-0033): one bank account the company pays into, with its holder's name.
 * No two Payees share an account number + IFSC (spaces, dashes and leading zeros ignored).
 * An address book entry (#1434): no status, no lock, and nothing paid points back at it.
 * Written only by the server's Payee module (`nirmaan_stack/services/payees/`).
 */

export const PAYEE_DOCTYPE = "Payee";

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
    /** Vendors paid into this account. */
    vendors: number;
}

/**
 * A Payee as a picker shows it (#1429): a search row from `api/expense_requests/payees.search_payees`,
 * or a `PayeeSummary` (the vendor's Payee, one just added, a request's own).
 */
export interface PayeeOption {
    name: string;
    account_name: string;
    account_number: string;
    ifsc: string;
    bank_name?: string | null;
    bank_branch?: string | null;
}

/**
 * A record's own pay-to account (#1436, ADR-0033): the account an Expense Request or Expense is paid
 * into, copied from a Payee when it was raised and served in a Payee's field names
 * (`services/payees/pay_to.pay_to_account`). Nothing links it back to the Payee.
 */
export interface PayToAccount {
    account_name: string;
    account_number: string;
    ifsc: string;
    bank_name?: string | null;
    bank_branch?: string | null;
}

/** How a suggested Payee matches a vendor (`services/payees/matching`). */
export const PAYEE_MATCH = {
    /** A vendor already linked to the Payee has the same PAN. */
    STRONG: "strong",
    /** No PAN agrees; the names read alike. */
    NAME_ONLY: "name_only",
} as const;

export type PayeeMatch = (typeof PAYEE_MATCH)[keyof typeof PAYEE_MATCH];

/** A vendor linked to a Payee, as the vendor screens list it. */
export interface PayeeLinkedVendor {
    name: string;
    vendor_name: string | null;
    vendor_city: string | null;
    vendor_pan: string | null;
}

/**
 * A Payee as the vendor screens show it before linking a vendor to it
 * (`services/payees/choosing.payee_choices`): its summary and every vendor already linked to it.
 */
export interface PayeeWithLinks extends PayeeSummary {
    linked_vendors: PayeeLinkedVendor[];
}

/** One "Payees that look like this vendor" entry (`api/payees/vendor_payee.suggest_vendor_payees`). */
export interface PayeeSuggestion extends PayeeWithLinks {
    match: PayeeMatch;
}

/** A Vendor paid into a Payee, as the Payee page's Linked Vendors tab shows it (`links.linked_vendors`). */
export interface PayeePageVendor {
    name: string;
    vendor_name: string;
    vendor_type?: string | null;
    vendor_city?: string | null;
    vendor_status?: string | null;
    /** ISO date the vendor was pointed at this Payee. */
    linked_since: string | null;
}

/** When and by whom a Payee field last changed, from its change history (`links.last_changed`). */
export interface PayeeChange {
    /** ISO date. */
    on: string;
    /** Full name of who saved it. */
    by: string;
}

/** One Payee's page (`api/payees/payee_page.get_payee`). */
export interface PayeePage extends PayeeSummary {
    creation: string;
    /** When and by whom its holder name last changed; null when never (#1435). */
    holder_name_changed: PayeeChange | null;
    /** When and by whom its account number or IFSC last changed; null when never (#1435). */
    account_changed: PayeeChange | null;
    linked_vendors: PayeePageVendor[];
    /** The person whose own bank account (Reimbursements) this Payee is, or null. */
    linked_user: PayeeLinkedUser | null;
}

/** The person a Payee is an own bank account of (`links.linked_user`). */
export interface PayeeLinkedUser {
    /** The user's email (their Nirmaan Users name). */
    name: string;
    full_name?: string | null;
    role_profile?: string | null;
}
