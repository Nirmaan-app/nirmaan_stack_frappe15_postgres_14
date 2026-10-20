import { SearchFieldOption } from "@/components/data-table/new-data-table";
import {
    CHEQUE_STATUS,
    CHEQUE_TYPE,
    type ChequeBank,
    type ChequeLineType,
    type ChequeMadeFrom,
    type ChequeStatus,
    type ChequeType,
} from "@/types/NirmaanStack/Cheques";
import { LINE_TYPE, LINES_GAP_TOLERANCE } from "@/utils/cheques/chequeLines";
import { formatDate } from "@/utils/FormatDate";

/**
 * The Cheque Tracker's tables (spec #1407, #1483): one row per Cheque, served by
 * `api/cheques/list_cheques.get_cheques` (the `useServerDataTable` custom-endpoint contract).
 * The summary strip is that same call's `aggregates`, and the facets come from
 * `get_cheque_facets` over the same filters, so the strip, the facets and the rows always agree (#1417).
 */
export const CHEQUES_DOCTYPE = "Cheques";
export const CHEQUES_LIST_API = "nirmaan_stack.api.cheques.list_cheques.get_cheques";
export const CHEQUE_FACETS_API = "nirmaan_stack.api.cheques.list_cheques.get_cheque_facets";

/** One line of a row, as `get_cheques` returns it (oldest first). */
export interface ChequeRowLine {
    line_type: ChequeLineType;
    project?: string | null;
    project_name?: string | null;
    record_doctype?: string | null;
    record_name?: string | null;
    payment_doctype?: string | null;
    payment_name?: string | null;
    amount: number;
}

/** One row of the report, exactly as `get_cheques` returns it. */
export interface ChequeRow {
    name: string;
    creation: string;
    owner: string;
    owner_name?: string | null;
    cheque_no: string;
    cheque_type: ChequeType;
    bank: ChequeBank;
    bank_name?: string | null;
    /** The typed name for an Others bank, else the bank. */
    bank_label: string;
    /** The Cheque/Payment Date: the paper date, then the day the bank paid it (#1520). */
    cheque_date: string;
    /** The day it became Issued; blank while Approval Pending. */
    issue_date?: string | null;
    bank_line?: string | null;
    /** 1 for a Cheque from before cheque types that no longer fits them (GLOSSARY.md, Old-type cheque). */
    old_type?: 0 | 1;
    status: ChequeStatus;
    amount: number;
    description?: string | null;
    vendor?: string | null;
    vendor_name?: string | null;
    payee_name?: string | null;
    attachment?: string | null;
    made_from: ChequeMadeFrom;
    /** The newest status-history row: who made the last change, and when. */
    status_changed_by?: string | null;
    status_changed_by_name?: string | null;
    status_changed_at?: string | null;
    /** Empty for an Ad-hoc cheque. */
    lines: ChequeRowLine[];
    /** With a `record_name` filter: what the lines put on the PO/WOs asked for (#1521); else null. */
    record_amount?: number | null;
}

/** Nominal: the endpoint fixes the row shape. */
export const CHEQUE_FETCH_FIELDS: string[] = ["name"];

export const CHEQUE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "cheque_no", label: "Cheque No", default: true },
    { value: "vendor_name", label: "Vendor" },
    { value: "payee_name", label: "Payee" },
    { value: "description", label: "Description" },
];

export const CHEQUE_DATE_COLUMNS = ["cheque_date", "issue_date", "creation"];

/**
 * The facet filters, by column id. Each id is also the endpoint's filter field: `project` and
 * `record_name` match a Cheque when any of its lines does.
 */
export const CHEQUE_FACET_FIELDS = {
    cheque_type: "Type",
    status: "Status",
    bank_label: "Bank",
    vendor: "Vendor",
    project: "Project",
    record_name: "PO / WO",
} as const;

export type ChequeFacetField = keyof typeof CHEQUE_FACET_FIELDS;

/** One box of the summary strip. `status` is undefined for All. */
export interface ChequeSummaryBucket {
    key: "all" | "pending" | "issued" | "cleared" | "cancelled";
    label: string;
    status?: ChequeStatus;
    count: number;
    amount: number;
}

const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/**
 * The summary strip: count and amount for All, Approval Pending, Issued, Cleared and Cancelled, from `get_cheques`'s
 * `aggregates` (`count`, `total_amount`, `<status>_count`, `<status>_amount`). Each matching Cheque
 * counts once, at its full amount.
 */
export const chequeSummary = (aggregates: Record<string, unknown> | null | undefined): ChequeSummaryBucket[] => {
    const a = aggregates ?? {};
    const bucket = (key: Exclude<ChequeSummaryBucket["key"], "all">, status: ChequeStatus): ChequeSummaryBucket => ({
        key,
        label: status,
        status,
        count: num(a[`${key}_count`]),
        amount: num(a[`${key}_amount`]),
    });
    return [
        { key: "all", label: "All", status: undefined, count: num(a.count), amount: num(a.total_amount) },
        bucket("pending", CHEQUE_STATUS.PENDING),
        bucket("issued", CHEQUE_STATUS.ISSUED),
        bucket("cleared", CHEQUE_STATUS.CLEARED),
        bucket("cancelled", CHEQUE_STATUS.CANCELLED),
    ];
};

/** A count and an amount of Cheques. */
export interface ChequeFigure {
    count: number;
    amount: number;
}

/**
 * The Issued tab's strip (#1483), from `get_cheques`'s `aggregates` over the tab's rows: every cheque waiting
 * for the bank (`count`, `total_amount`), and those issued more than `CHEQUE_STALE_DAYS` ago (`stale_*`).
 */
export const issuedChequeFigures = (
    aggregates: Record<string, unknown> | null | undefined,
): { waiting: ChequeFigure; stale: ChequeFigure } => {
    const a = aggregates ?? {};
    return {
        waiting: { count: num(a.count), amount: num(a.total_amount) },
        stale: { count: num(a.stale_count), amount: num(a.stale_amount) },
    };
};

/** The PO/WO and Project cells: the first line's value, plus how many other values the lines name. */
export const firstWithMore = (values: (string | null | undefined)[]): { first?: string; more: number } => {
    const distinct = [...new Set(values.filter((v): v is string => !!v))];
    return { first: distinct[0], more: Math.max(distinct.length - 1, 0) };
};

/**
 * Cheque amount minus the lines' total when they differ by more than ₹2; null otherwise or with no lines that pay.
 * A Security Deposit's Secured PO/WO lines pay nothing, so a deposit never has a gap (#1486).
 */
export const linesGap = (row: Pick<ChequeRow, "amount" | "lines">): number | null => {
    const paying = row.lines.filter((l) => l.line_type !== LINE_TYPE.SECURED);
    if (!paying.length) return null;
    const total = paying.reduce((sum, l) => sum + num(l.amount), 0);
    const gap = Math.round((num(row.amount) - total) * 100) / 100;
    return Math.abs(gap) > LINES_GAP_TOLERANCE ? gap : null;
};

/**
 * A cheque is good for 3 months; an Issued one issued longer ago than this is stale (spec #1477). The list
 * endpoint's `stale_*` aggregates use the same line (`list_cheques.STALE_AFTER_DAYS`).
 */
export const CHEQUE_STALE_DAYS = 90;

type IssueDates = Pick<ChequeRow, "status" | "cheque_date"> & Partial<Pick<ChequeRow, "issue_date" | "cheque_type">>;

/**
 * Days since a Payment cheque was issued, while it is Issued; null otherwise, and for a Security Deposit, which
 * is held, not waiting for the bank (#1486). An old cheque with no issue date (made before issue dates) counts
 * from its Cheque/Payment Date, which on an Issued cheque is still the paper date and can be in the future
 * (negative: post-dated).
 */
export const daysSinceIssue = (row: IssueDates, today: Date = new Date()): number | null => {
    const from = row.issue_date || row.cheque_date;
    if (row.status !== CHEQUE_STATUS.ISSUED || !from || row.cheque_type === CHEQUE_TYPE.SECURITY_DEPOSIT) return null;
    const [y, m, d] = from.split("-").map(Number);
    if (!y || !m || !d) return null;
    const start = Date.UTC(y, m - 1, d);
    const end = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((end - start) / 86_400_000);
};

export const isStale = (row: IssueDates, today: Date = new Date()): boolean =>
    (daysSinceIssue(row, today) ?? 0) > CHEQUE_STALE_DAYS;

/** How many payments the cheque pays: its lines that name one. */
export const paymentCount = (row: Pick<ChequeRow, "lines">): number => row.lines.filter((l) => l.payment_name).length;

/** The Type cell: "Payment cheque" or "Security Deposit" (spec #1477). */
export const chequeTypeLabel = (type: ChequeType): string =>
    type === CHEQUE_TYPE.SECURITY_DEPOSIT ? "Security Deposit" : "Payment cheque";

/** A Cheque without a photo: only a backfilled one can be. */
export const hasNoPhoto = (row: Pick<ChequeRow, "attachment">): boolean => !row.attachment;

/** Who the cheque is made out to, as the table shows it: the Vendor (linked) or the typed payee. */
export const payeeOf = (row: Pick<ChequeRow, "vendor" | "vendor_name" | "payee_name">): { label: string; vendor?: string } =>
    row.vendor
        ? { label: row.vendor_name || row.vendor, vendor: row.vendor }
        : { label: row.payee_name || "" };

/** "by Ravi Kumar · 12-Oct-2026": the last status change, shown under the status. Empty when unknown. */
export const statusChangeText = (
    row: Pick<ChequeRow, "status_changed_by" | "status_changed_by_name" | "status_changed_at">,
): string => {
    const who = row.status_changed_by_name || row.status_changed_by;
    if (!who || !row.status_changed_at) return "";
    return `by ${who} · ${formatDate(row.status_changed_at)}`;
};
