/**
 * Pending Invoices Upload -> Cashbook (#1592, ADR-0015 Amendment B decision 4; #1604): the pure rules of the sub-tab.
 *
 * The server (`api/expenses/cashbook_invoices.get_cashbook_invoice_queue`) decides which wallet spends are waiting
 * (the Cashbook marker set, no invoice file, not marked No invoice). The tab shows them on the shared DataTable, as
 * the Credit Card tab does: Project / Non-Project and month narrow the list before the table sees it (dropdowns
 * beside the search box); Project, Expense Type and Paid by are column filters. The actions, the month labels and
 * the Expense Type label are the Credit Card tab's (`cardInvoicesView.ts`).
 */
import { ALL, cardInvoiceActions, countedOptions, expenseTypeLabel, statementMonthLabel } from "./cardInvoicesView";

export { ALL };

export type CashbookLedger = "Project Expenses" | "Non Project Expenses";

/** One wallet spend waiting for its invoice, as `get_cashbook_invoice_queue` returns it. */
export interface CashbookInvoiceRow {
    name: string;
    /** The ledger the Expense is on; attach and No invoice send it back. */
    doctype: CashbookLedger;
    payment_date: string;
    amount: number;
    expense_type: string | null;
    /** The wallet holder who spent it (the statement's `From`). */
    paid_by: string | null;
    /** The statement line's remark, else the Expense's description. */
    remark: string;
    project: string | null;
    project_name: string | null;
    cashbook_batch: string;
}

/** The two narrowings applied before the table: they are not one column's value. */
export interface CashbookInvoiceFilters {
    /** A `CashbookLedger`, or `ALL`. */
    ledger: string;
    /** "YYYY-MM" of the payment date, or `ALL`. */
    month: string;
}

/** The rows the table is given under `filters`, in the server's order. */
export const filterCashbookInvoices = (rows: CashbookInvoiceRow[], filters: CashbookInvoiceFilters): CashbookInvoiceRow[] =>
    rows.filter(
        (r) =>
            (filters.ledger === ALL || r.doctype === filters.ledger) &&
            (filters.month === ALL || (r.payment_date ?? "").slice(0, 7) === filters.month),
    );

/** The month choices: each once, newest first. */
export const cashbookInvoiceFilterOptions = (rows: CashbookInvoiceRow[]) => {
    const months = [...new Set(rows.map((r) => (r.payment_date ?? "").slice(0, 7)).filter(Boolean))]
        .sort()
        .reverse()
        .map((value) => ({ value, label: statementMonthLabel(value) }));
    return { months };
};

/** The Project column: the project's name (its id when unnamed); blank for a Non-Project spend. */
export const cashbookProjectLabel = (row: Pick<CashbookInvoiceRow, "doctype" | "project" | "project_name">): string =>
    row.doctype === "Project Expenses" ? row.project_name || row.project || "" : "";

/** The Expense Type column, its filter and its export, for both ledgers. */
export const cashbookExpenseTypeLabel = expenseTypeLabel;

/** The Project, Expense Type and Paid by column-filter choices for `rows`, each with its row count. */
export const cashbookInvoiceFacetOptions = (rows: CashbookInvoiceRow[]) => ({
    projects: countedOptions(rows.map(cashbookProjectLabel)),
    expenseTypes: countedOptions(rows.map(cashbookExpenseTypeLabel)),
    payers: countedOptions(rows.map((r) => r.paid_by ?? "")),
});

/** "3 wallet spends waiting for an invoice". */
export const cashbookCountText = (count: number): string =>
    `${count} wallet spend${count === 1 ? "" : "s"} waiting for an invoice`;

/** Which row actions `role` gets: the Credit Card tab's (Attach for all who see the tab; No invoice for Admin and
 * Accountant Lead). */
export const cashbookInvoiceActions = cardInvoiceActions;
