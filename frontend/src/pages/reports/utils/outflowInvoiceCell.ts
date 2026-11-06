// The Payments Report (Project)'s Invoice column (#1603): what one row's cell holds. Pure.
//
// A Project Expense of any kind (by hand, bank / card / Cashbook import, Porter) shows its invoice file, else its
// No-invoice mark, else a dash. A Project Payment (vendor payment) row stays blank: vendor invoices on POs are out
// of scope (owner, 2026-11-03).

import type { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import { noInvoiceNote } from "@/utils/expenses/noInvoiceView";
import { invoiceAttachmentUrl } from "@/utils/porterExpense";

import type { OutflowRowData } from "../hooks/useOutflowReportData";

/** One row's Invoice cell. `url` is relative to the site (a Porter expense's opens through the expense). */
export type OutflowInvoiceCell =
    | { kind: "invoice"; url: string }
    | { kind: "no_invoice"; label: string; detail: string }
    | { kind: "none" }
    | { kind: "blank" };

/** The cell for a row: the invoice file wins over a No-invoice mark; a Project Payment row is blank. */
export const outflowInvoiceCell = (row: OutflowRowData, userName: (id?: string) => string): OutflowInvoiceCell => {
    if (row.source_doctype !== "Project Expenses") return { kind: "blank" };
    const expense = row.originalDoc as ProjectExpenses;
    const url = invoiceAttachmentUrl("Project Expenses", expense);
    if (url) return { kind: "invoice", url };
    const note = noInvoiceNote(expense, userName);
    if (note) return { kind: "no_invoice", ...note };
    return { kind: "none" };
};

/** The CSV text: the invoice's full link, "No invoice (who, when: why)", "--", or "" for a payment row. */
export const outflowInvoiceExportText = (
    row: OutflowRowData,
    userName: (id?: string) => string,
    siteUrl: string,
): string => {
    const cell = outflowInvoiceCell(row, userName);
    switch (cell.kind) {
        case "invoice":
            return siteUrl + cell.url;
        case "no_invoice":
            return `${cell.label} (${cell.detail})`;
        case "none":
            return "--";
        case "blank":
            return "";
    }
};
