// src/pages/NonProjectExpenses/config/noInvoiceView.ts
//
// A card spend marked "No invoice" on Pending Invoices Upload -> Credit Card (#1570, ADR-0037 ruling 8): who
// marked it, when and why, for the Non Project Expenses table's invoice column (story 45). Pure.

import { format, parseISO } from "date-fns";

import type { NonProjectExpenses } from "@/types/NirmaanStack/NonProjectExpenses";

type NoInvoiceFields = Pick<NonProjectExpenses, "no_invoice_reason" | "no_invoice_by" | "no_invoice_at">;

/** "No invoice" and "{who}, {dd-MMM-yyyy}: {reason}" for a marked expense; null for any other. */
export const noInvoiceNote = (
    expense: Partial<NoInvoiceFields>,
    userName: (id?: string) => string,
): { label: string; detail: string } | null => {
    if (!expense.no_invoice_by && !expense.no_invoice_reason) return null;
    const who = expense.no_invoice_by ? userName(expense.no_invoice_by) : "";
    const when = expense.no_invoice_at ? format(parseISO(expense.no_invoice_at.replace(" ", "T")), "dd-MMM-yyyy") : "";
    const by = [who, when].filter(Boolean).join(", ");
    const reason = expense.no_invoice_reason ?? "";
    return { label: "No invoice", detail: by && reason ? `${by}: ${reason}` : by || reason };
};
