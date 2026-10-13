/**
 * `Cheques` (spec #1407): one paper cheque the company writes, recorded on its own with its photo.
 *
 * Mirrors `nirmaan_stack/services/cheques/rules.py` (statuses, banks, line kinds, where it was made).
 * Written only by the cheques service (`services/cheques/writer.py`) through `api/cheques/*`.
 * Hand-maintained: frappe_types does not generate types in dev env benches.
 */
/** Published by the backend after every Cheque write commits (`services/cheques/writer.CHEQUES_CHANGED_EVENT`). */
export const CHEQUES_CHANGED_EVENT = "cheques:changed";

export const CHEQUE_STATUS = {
    ISSUED: "Issued",
    CLEARED: "Cleared",
    CANCELLED: "Cancelled",
} as const;

export type ChequeStatus = (typeof CHEQUE_STATUS)[keyof typeof CHEQUE_STATUS];

export const CHEQUE_BANK = {
    ICICI: "ICICI Bank",
    OTHERS: "Others",
} as const;

export type ChequeBank = (typeof CHEQUE_BANK)[keyof typeof CHEQUE_BANK];

/** Where a Cheque was made; a PO/WO Page Cheque keeps its number, date and amount (#1418). */
export type ChequeMadeFrom = "Report" | "PO/WO Page";

export type ChequeLineType = "PO/WO Payment" | "Project Expense" | "Non-project Expense";

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
    bank: ChequeBank;
    /** The typed bank name, for Others only. */
    bank_name?: string | null;
    /** Server-derived identity of the bank; bank_key + cheque_no is unique. */
    bank_key: string;
    /** The first six-digit group of the magnetic strip; leading zeros kept. */
    cheque_no: string;
    cheque_date: string;
    amount: number;
    /** Exactly one of vendor or payee_name is set. */
    vendor?: string | null;
    payee_name?: string | null;
    status: ChequeStatus;
    made_from: ChequeMadeFrom;
    /** The cheque's photo; empty only on Cheques backfilled from old cheque payments. */
    attachment?: string | null;
    /** Required while the Cheque has no lines (an Ad-hoc cheque). */
    description?: string | null;
    lines: ChequeLine[];
    status_history: ChequeStatusHistory[];
}
