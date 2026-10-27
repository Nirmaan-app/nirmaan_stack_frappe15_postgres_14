/**
 * `Cheques` (spec #1407): one paper cheque the company writes, recorded on its own with its photo.
 *
 * Mirrors `nirmaan_stack/services/cheques/rules.py` (statuses, types, banks, line kinds, where it was made).
 * Written only by the cheques service (`services/cheques/writer.py`) through `api/cheques/*`.
 * Hand-maintained: frappe_types does not generate types in dev env benches.
 */
/** Published by the backend after every Cheque write commits (`services/cheques/writer.CHEQUES_CHANGED_EVENT`). */
export const CHEQUES_CHANGED_EVENT = "cheques:changed";

export const CHEQUE_STATUS = {
    /** A Payment cheque whose payments still wait for approval (spec #1477). */
    PENDING: "Approval Pending",
    ISSUED: "Issued",
    CLEARED: "Cleared",
    CANCELLED: "Cancelled",
} as const;

export type ChequeStatus = (typeof CHEQUE_STATUS)[keyof typeof CHEQUE_STATUS];

/** A Payment cheque is cashed by the bank and pays PO payments; a Security Deposit cheque is only held (spec #1477). */
export const CHEQUE_TYPE = {
    PAYMENT: "Payment",
    SECURITY_DEPOSIT: "Security Deposit",
} as const;

export type ChequeType = (typeof CHEQUE_TYPE)[keyof typeof CHEQUE_TYPE];

/** How a Payment cheque was cleared (`rules.CLEARED_BY`). History only, never shown (#1520). */
export type ChequeClearedBy = "By hand" | "Bank import";

/**
 * The one date a Cheque carries besides its issue date (`cheque_date`, #1520, ADR-0035 Amendment A): the date
 * written on the paper until the bank import clears a Payment cheque, then the day the bank paid it. Every
 * screen labels it this way.
 */
export const CHEQUE_PAYMENT_DATE_LABEL = "Cheque/Payment Date";

export const CHEQUE_BANK = {
    ICICI: "ICICI Bank",
    OTHERS: "Others",
} as const;

export type ChequeBank = (typeof CHEQUE_BANK)[keyof typeof CHEQUE_BANK];

/** Where a Cheque was made; a PO/WO Page Cheque keeps its number, date and amount (#1418). */
export type ChequeMadeFrom = "Report" | "PO/WO Page";

/** "Secured PO/WO" is a Security Deposit cheque's line: a PO it secures, no payment, no amount (#1486; never a Work Order, spec #1514). */
export type ChequeLineType = "PO/WO Payment" | "Project Expense" | "Non-project Expense" | "Secured PO/WO";

/** One thing a Cheque pays (`Cheque Line`). */
export interface ChequeLine {
    name: string;
    line_type: ChequeLineType;
    project?: string | null;
    record_doctype?: string | null;
    record_name?: string | null;
    payment_doctype?: string | null;
    payment_name?: string | null;
    amount: number;
}

/** One status move (`Cheque Status History`). The row written at creation has no `from_status`. */
export interface ChequeStatusHistory {
    name: string;
    from_status?: ChequeStatus | null;
    to_status: ChequeStatus;
    changed_by: string;
    changed_at: string;
    note?: string | null;
}

export interface Cheques {
    name: string;
    creation: string;
    modified: string;
    owner: string;
    modified_by: string;
    cheque_type: ChequeType;
    bank: ChequeBank;
    /** The typed bank name, for Others only. */
    bank_name?: string | null;
    /** Server-derived identity of the bank; bank_key + cheque_no is unique. */
    bank_key: string;
    /** The first six-digit group of the magnetic strip; leading zeros kept. */
    cheque_no: string;
    /** The Cheque/Payment Date (`CHEQUE_PAYMENT_DATE_LABEL`): the paper date, then the day the bank paid it. */
    cheque_date: string;
    amount: number;
    /** Exactly one of vendor or payee_name is set. */
    vendor?: string | null;
    payee_name?: string | null;
    status: ChequeStatus;
    made_from: ChequeMadeFrom;
    /** The day it became Issued: a Payment cheque's payments were approved, a deposit cheque handed over. */
    issue_date?: string | null;
    /** History only, never shown (#1520). */
    cleared_by?: ChequeClearedBy | null;
    /** The imported bank-statement line (`Outflow Import Row`) that cleared it. */
    bank_line?: string | null;
    /** 1 for a Cheque from before cheque types that pays Expenses, has no lines or names a typed payee. */
    old_type?: 0 | 1;
    /** The cheque's photo; empty only on Cheques backfilled from old cheque payments. */
    attachment?: string | null;
    /** Required while the Cheque has no lines (an Ad-hoc cheque). */
    description?: string | null;
    lines: ChequeLine[];
    status_history: ChequeStatusHistory[];
}
