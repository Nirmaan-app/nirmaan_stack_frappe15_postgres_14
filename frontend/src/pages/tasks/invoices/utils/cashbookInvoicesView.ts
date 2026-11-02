/**
 * Pending Invoices Upload -> Cashbook (#1592, ADR-0015 Amendment B decision 4): the pure rules of the sub-tab.
 *
 * The server (`api/expenses/cashbook_invoices.get_cashbook_invoice_queue`) decides which wallet spends are waiting
 * (the Cashbook marker set, no invoice file, not marked No invoice); this filters them by wallet holder, ledger and
 * month. The actions and the month labels are the Credit Card tab's (`cardInvoicesView.ts`).
 */
import { ALL, cardInvoiceActions, statementMonthLabel } from "./cardInvoicesView";

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

export interface CashbookInvoiceFilters {
    paidBy: string;
    ledger: string;
    /** "YYYY-MM" of the payment date. */
    month: string;
}

/** The rows the table shows under `filters`, in the server's order. */
export const filterCashbookInvoices = (rows: CashbookInvoiceRow[], filters: CashbookInvoiceFilters): CashbookInvoiceRow[] =>
    rows.filter(
        (r) =>
            (filters.paidBy === ALL || r.paid_by === filters.paidBy) &&
            (filters.ledger === ALL || r.doctype === filters.ledger) &&
            (filters.month === ALL || (r.payment_date ?? "").slice(0, 7) === filters.month),
    );

/** The holder and month choices: each once; holders by name, months newest first. */
export const cashbookInvoiceFilterOptions = (rows: CashbookInvoiceRow[]) => {
    const payers = [...new Set(rows.map((r) => r.paid_by).filter((p): p is string => !!p))].sort();
    const months = [...new Set(rows.map((r) => (r.payment_date ?? "").slice(0, 7)).filter(Boolean))]
        .sort()
        .reverse()
        .map((value) => ({ value, label: statementMonthLabel(value) }));
    return { payers, months };
};

/** "Project" with its project's name (its id when unnamed), or "Non-Project". */
export const cashbookLedgerLabel = (row: CashbookInvoiceRow): { kind: "Project" | "Non-Project"; project: string | null } =>
    row.doctype === "Project Expenses"
        ? { kind: "Project", project: row.project_name || row.project }
        : { kind: "Non-Project", project: null };

/** Which row actions `role` gets: the Credit Card tab's (Attach for all who see the tab; No invoice for Admin and
 * Accountant Lead). */
export const cashbookInvoiceActions = cardInvoiceActions;
