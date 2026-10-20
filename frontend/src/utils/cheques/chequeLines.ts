import type { ChequeLineType } from "@/types/NirmaanStack/Cheques";

/**
 * A Cheque's lines (spec #1407; #1482, spec #1477). The Tracker no longer edits a Payment cheque's lines
 * (spec #1514): they are shown as made, and only a Security Deposit cheque's form sends lines.
 */

/** A soft warning only: lines may differ from the cheque by up to this much (rounding). */
export const LINES_GAP_TOLERANCE = 2;

/** The Cheque line arguments `save_cheque` takes. */
export interface SaveLineArg {
    line_type: ChequeLineType;
    project?: string;
    record_doctype?: string;
    record_name?: string;
    payment_name?: string;
    /** None on a Secured PO/WO line: it pays nothing. */
    amount?: number;
}

export const LINE_TYPE = {
    PO_WO: "PO/WO Payment",
    PROJECT_EXPENSE: "Project Expense",
    NON_PROJECT_EXPENSE: "Non-project Expense",
    /** A Security Deposit cheque's line: a PO it secures (#1486; never a Work Order, spec #1514). */
    SECURED: "Secured PO/WO",
} as const satisfies Record<string, ChequeLineType>;
