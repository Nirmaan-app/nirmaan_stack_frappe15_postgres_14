/**
 * Pending Invoices Upload -> Credit Card (#1570, ADR-0037 ruling 8): the pure rules of the sub-tab.
 *
 * The server (`api/expenses/card_invoices.get_card_invoice_queue`) decides which card spends are waiting
 * (no invoice file, not marked No invoice); this filters them by holder and statement month and says which
 * actions a user gets. The role lists are `constants/roles.ts`, mirrors of the server's gates.
 */
import { canMarkCardNoInvoice, canViewPendingInvoiceUploads } from "@/constants/roles";

/** One card spend waiting for its invoice, as `get_card_invoice_queue` returns it. */
export interface CardInvoiceRow {
    name: string;
    payment_date: string;
    amount: number;
    expense_type: string | null;
    /** The statement line's transaction details. */
    details: string;
    /** The cleaned merchant name (`card_statement.merchant_key`). */
    merchant: string;
    holder: string;
    credit_card_statement: string;
    statement_date: string | null;
    period_from: string;
    period_to: string;
    /** Every "YYYY-MM" the statement's period overlaps, oldest first (GLOSSARY *Statement month*). */
    statement_months: string[];
}

/** The filter value that means "any". */
export const ALL = "__all__";

export interface CardInvoiceFilters {
    holder: string;
    month: string;
}

/** The rows the table shows under `filters`, in the server's order. */
export const filterCardInvoices = (rows: CardInvoiceRow[], filters: CardInvoiceFilters): CardInvoiceRow[] =>
    rows.filter(
        (r) =>
            (filters.holder === ALL || r.holder === filters.holder) &&
            (filters.month === ALL || r.statement_months.includes(filters.month)),
    );

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" -> "Oct 2026". */
export const statementMonthLabel = (month: string): string => {
    const [year, mm] = month.split("-");
    const name = MONTHS[Number(mm) - 1];
    return year && name ? `${name} ${year}` : "";
};

/** A statement's months (oldest first, as the server sends them) as one range: "Oct 2026", "Sep – Oct 2026",
 * "Dec 2026 – Jan 2027". */
export const statementMonthsLabel = (months: string[]): string => {
    if (months.length === 0) return "";
    const first = months[0];
    const last = months[months.length - 1];
    if (first === last) return statementMonthLabel(first);
    const firstLabel = first.slice(0, 4) === last.slice(0, 4) ? MONTHS[Number(first.slice(5, 7)) - 1] : statementMonthLabel(first);
    return `${firstLabel} – ${statementMonthLabel(last)}`;
};

/** The holder and month choices: each once; holders by name, months newest first. */
export const cardInvoiceFilterOptions = (rows: CardInvoiceRow[]) => {
    const holders = [...new Set(rows.map((r) => r.holder))].sort();
    const months = [...new Set(rows.flatMap((r) => r.statement_months))]
        .sort()
        .reverse()
        .map((value) => ({ value, label: statementMonthLabel(value) }));
    return { holders, months };
};

/** Which row actions `role` gets: Attach (everyone who sees the tab) and No invoice (Admin, Accountant Lead). */
export const cardInvoiceActions = (role?: string | null, userId?: string | null) => ({
    attach: canViewPendingInvoiceUploads(role, userId),
    noInvoice: canMarkCardNoInvoice(role, userId),
});
