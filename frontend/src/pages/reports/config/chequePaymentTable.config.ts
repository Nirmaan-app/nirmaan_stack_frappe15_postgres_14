import { SearchFieldOption } from "@/components/data-table/new-data-table";
import {
    CHEQUE_STATUS,
    type ChequeBank,
    type ChequeLineType,
    type ChequeMadeFrom,
    type ChequeStatus,
} from "@/types/NirmaanStack/Cheques";
import { LINES_GAP_TOLERANCE } from "@/utils/cheques/chequeLines";
import { formatDate } from "@/utils/FormatDate";

/**
 * Reports > Payment > Cheque Payment: one row per Cheque (spec #1407), served by
 * `api/cheques/list_cheques.get_cheques` (the `useServerDataTable` custom-endpoint contract).
 * The summary strip is that same call's `aggregates`, and the facets come from
 * `get_cheque_facets` over the same filters, so the strip, the facets and the rows always agree (#1417).
 */
export const CHEQUES_DOCTYPE = "Cheques";
export const CHEQUES_LIST_API = "nirmaan_stack.api.cheques.list_cheques.get_cheques";
export const CHEQUE_FACETS_API = "nirmaan_stack.api.cheques.list_cheques.get_cheque_facets";
/** Published by the backend after every Cheque write. */
export const CHEQUES_CHANGED_EVENT = "cheques:changed";

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
    bank: ChequeBank;
    bank_name?: string | null;
    /** The typed name for an Others bank, else the bank. */
    bank_label: string;
    cheque_date: string;
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
}

/** Nominal: the endpoint fixes the row shape. */
export const CHEQUE_FETCH_FIELDS: string[] = ["name"];

export const CHEQUE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "cheque_no", label: "Cheque No", default: true },
    { value: "vendor_name", label: "Vendor" },
    { value: "payee_name", label: "Payee" },
    { value: "description", label: "Description" },
];

export const CHEQUE_DATE_COLUMNS = ["cheque_date", "creation"];

/**
 * The facet filters, by column id. Each id is also the endpoint's filter field: `project` and
 * `record_name` match a Cheque when any of its lines does.
 */
export const CHEQUE_FACET_FIELDS = {
    status: "Status",
    bank_label: "Bank",
    vendor: "Vendor",
    project: "Project",
    record_name: "PO / WO",
} as const;

export type ChequeFacetField = keyof typeof CHEQUE_FACET_FIELDS;

/** One box of the summary strip. `status` is undefined for All. */
export interface ChequeSummaryBucket {
    key: "all" | "issued" | "cleared" | "cancelled";
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
 * The summary strip: count and amount for All, Issued, Cleared and Cancelled, from `get_cheques`'s
 * `aggregates` (`count`, `total_amount`, `<status>_count`, `<status>_amount`). Each matching Cheque
 * counts once, at its full amount.
 */
export const chequeSummary = (aggregates: Record<string, unknown> | null | undefined): ChequeSummaryBucket[] => {
    const a = aggregates ?? {};
    const bucket = (key: "issued" | "cleared" | "cancelled", status: ChequeStatus): ChequeSummaryBucket => ({
        key,
        label: status,
        status,
        count: num(a[`${key}_count`]),
        amount: num(a[`${key}_amount`]),
    });
    return [
        { key: "all", label: "All", status: undefined, count: num(a.count), amount: num(a.total_amount) },
        bucket("issued", CHEQUE_STATUS.ISSUED),
        bucket("cleared", CHEQUE_STATUS.CLEARED),
        bucket("cancelled", CHEQUE_STATUS.CANCELLED),
    ];
};

/** The PO/WO and Project cells: the first line's value, plus how many other values the lines name. */
export const firstWithMore = (values: (string | null | undefined)[]): { first?: string; more: number } => {
    const distinct = [...new Set(values.filter((v): v is string => !!v))];
    return { first: distinct[0], more: Math.max(distinct.length - 1, 0) };
};

/** Cheque amount minus the lines' total when they differ by more than ₹2; null otherwise or with no lines. */
export const linesGap = (row: Pick<ChequeRow, "amount" | "lines">): number | null => {
    if (!row.lines.length) return null;
    const total = row.lines.reduce((sum, l) => sum + num(l.amount), 0);
    const gap = Math.round((num(row.amount) - total) * 100) / 100;
    return Math.abs(gap) > LINES_GAP_TOLERANCE ? gap : null;
};

/** A cheque is good for 3 months from its date; an Issued one older than that is stale. */
export const CHEQUE_STALE_DAYS = 90;

/** Days since the cheque date while the cheque is Issued (negative when post-dated); null otherwise. */
export const daysOutstanding = (
    row: Pick<ChequeRow, "status" | "cheque_date">,
    today: Date = new Date(),
): number | null => {
    if (row.status !== CHEQUE_STATUS.ISSUED || !row.cheque_date) return null;
    const [y, m, d] = row.cheque_date.split("-").map(Number);
    if (!y || !m || !d) return null;
    const start = Date.UTC(y, m - 1, d);
    const end = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((end - start) / 86_400_000);
};

export const isStale = (row: Pick<ChequeRow, "status" | "cheque_date">, today: Date = new Date()): boolean =>
    (daysOutstanding(row, today) ?? 0) > CHEQUE_STALE_DAYS;

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
