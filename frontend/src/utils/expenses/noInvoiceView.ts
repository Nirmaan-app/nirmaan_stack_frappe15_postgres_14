// src/utils/expenses/noInvoiceView.ts
//
// An expense marked "No invoice" (#1570, ADR-0039 ruling 8): who marked it, when and why, for the Invoice Ref
// column of the Non Project Expenses table (story 45) and of a project's Misc. Project Expenses tab (story 32).
// Both expense doctypes carry the same three fields. Pure.

import { format, parseISO } from "date-fns";

/** The three No-invoice fields both expense doctypes carry, plus the ref they stand in for. */
export interface NoInvoiceFields {
    invoice_ref?: string | null;
    no_invoice_reason?: string | null;
    no_invoice_by?: string | null;
    no_invoice_at?: string | null;
}

/** "No invoice" and "{who}, {dd-MMM-yyyy}: {reason}" for a marked expense; null for any other. */
export const noInvoiceNote = (
    expense: NoInvoiceFields,
    userName: (id?: string) => string,
): { label: string; detail: string } | null => {
    if (!expense.no_invoice_by && !expense.no_invoice_reason) return null;
    const who = expense.no_invoice_by ? userName(expense.no_invoice_by) : "";
    const when = expense.no_invoice_at ? format(parseISO(expense.no_invoice_at.replace(" ", "T")), "dd-MMM-yyyy") : "";
    const by = [who, when].filter(Boolean).join(", ");
    const reason = expense.no_invoice_reason ?? "";
    return { label: "No invoice", detail: by && reason ? `${by}: ${reason}` : by || reason };
};

/** The Invoice Ref column's export text: the ref, else the No-invoice note, else "--". */
export const invoiceRefExportText = (expense: NoInvoiceFields, userName: (id?: string) => string): string => {
    const noInvoice = !expense.invoice_ref && noInvoiceNote(expense, userName);
    return noInvoice ? `${noInvoice.label} (${noInvoice.detail})` : expense.invoice_ref || "--";
};
