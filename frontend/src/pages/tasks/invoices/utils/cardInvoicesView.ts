/**
 * Pending Invoices Upload -> Credit Card (#1570, ADR-0039 ruling 8): the pure rules of the sub-tab.
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

/** How a spend with no Expense Type is grouped on the summary card and offered in the Expense Type filter. */
export const NO_EXPENSE_TYPE = "No expense type";

/** A spend's Expense Type as the table, its filter and the summary card all show it. */
export const expenseTypeLabel = (row: Pick<CardInvoiceRow, "expense_type">): string =>
    row.expense_type || NO_EXPENSE_TYPE;

/** "KUMAR SHANU (40)" style choices for a column filter: each value once, by name, with its row count. */
const countedOptions = (values: string[]) => {
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([value, count]) => ({ label: `${value} (${count})`, value }));
};

/** A spend's statement as the Statement column filters on it: its months, then the statement ID
 *  ("Sep – Oct 2026 · CCS-26-00001"), so two statements over the same months stay apart. */
export const statementLabel = (row: Pick<CardInvoiceRow, "statement_months" | "credit_card_statement">): string =>
    `${statementMonthsLabel(row.statement_months)} · ${row.credit_card_statement}`;

/** The Expense Type, Holder and Statement column-filter choices for `rows`. */
export const cardInvoiceFacetOptions = (rows: CardInvoiceRow[]) => ({
    expenseTypes: countedOptions(rows.map(expenseTypeLabel)),
    holders: countedOptions(rows.map((r) => r.holder)),
    statements: countedOptions(rows.map(statementLabel)),
});

export interface CardSpendTypeTotal {
    expenseType: string;
    amount: number;
    count: number;
}

export interface CardSpendsSummary {
    count: number;
    amount: number;
    /** Largest amount first; equal amounts by name. */
    byType: CardSpendTypeTotal[];
}

/** The summary card's figures over the spends the table shows: their total and the split by Expense Type. */
export const summariseCardSpendsByType = (rows: Pick<CardInvoiceRow, "amount" | "expense_type">[]): CardSpendsSummary => {
    const groups = new Map<string, CardSpendTypeTotal>();
    let amount = 0;
    for (const r of rows) {
        const expenseType = expenseTypeLabel(r);
        const group = groups.get(expenseType) ?? { expenseType, amount: 0, count: 0 };
        group.amount += r.amount;
        group.count += 1;
        groups.set(expenseType, group);
        amount += r.amount;
    }
    const byType = [...groups.values()].sort(
        (a, b) => b.amount - a.amount || a.expenseType.localeCompare(b.expenseType),
    );
    return { count: rows.length, amount, byType };
};

/** Which row actions `role` gets: Attach (everyone who sees the tab) and No invoice (Admin, Accountant Lead). */
export const cardInvoiceActions = (role?: string | null, userId?: string | null) => ({
    attach: canViewPendingInvoiceUploads(role, userId),
    noInvoice: canMarkCardNoInvoice(role, userId),
});
