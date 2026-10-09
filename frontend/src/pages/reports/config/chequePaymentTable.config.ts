import { SearchFieldOption } from "@/components/data-table/new-data-table";
import { AggregationConfig, GroupByConfig, GroupByResultItem } from "@/hooks/useServerDataTable";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";

/**
 * Reports > Payment > Cheque Payment: every Project Payment (PO and WO) requested as a cheque,
 * at every status. The PO / WO figures come from a second, batched read (see
 * `utils/chequePaymentExtras.ts`) because `document_name` is a Dynamic Link the list query cannot join.
 */
export const CHEQUE_PAYMENT_DOCTYPE = "Project Payments";

export const CHEQUE_PAYMENT_BASE_FILTERS: [string, string, string][] = [["mode_of_payment", "=", "Cheque"]];

/** `project` / `vendor` also bring back `project_name` / `vendor_name` (data_table LINK_FIELD_MAP). */
export const CHEQUE_PAYMENT_FIELDS: string[] = [
    "name",
    "creation",
    "owner",
    "document_type",
    "document_name",
    "project",
    "vendor",
    "amount",
    "status",
    "cheque_no",
    "cheque_date",
    "approval_date",
    "ceo_approval_date",
    "payment_date",
    "utr",
    "on_hold",
    "payment_attachment",
];

export const CHEQUE_PAYMENT_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "cheque_no", label: "Cheque No", default: true },
    { value: "document_name", label: "PO / WO No" },
    { value: "name", label: "Payment ID" },
    { value: "utr", label: "UTR / Ref" },
];

export const CHEQUE_PAYMENT_DATE_COLUMNS = ["cheque_date", "creation", "payment_date"];

/** Off by default; each one is a tick away in the column toggle (and always in the CSV). */
export const CHEQUE_PAYMENT_HIDDEN_COLUMNS: Record<string, boolean> = {
    cheque_payment_count: false,
    days_outstanding: false,
    gross: false,
    approved_on: false,
    utr: false,
    on_hold: false,
    payment_attachment: false,
    order_status: false,
    order_amount_paid: false,
    order_amount_invoiced: false,
    order_balance: false,
};

/** Both describe the WHOLE filtered set (search + column filters), not the visible page. */
export const CHEQUE_PAYMENT_AGGREGATES: AggregationConfig[] = [{ field: "amount", function: "sum" }];

export const CHEQUE_PAYMENT_STATUS_SUMS: GroupByConfig = {
    groupByField: "status",
    aggregateField: "amount",
    aggregateFunction: "sum",
    // Six statuses exist; the backend default of 5 would silently drop one.
    limit: 20,
};

/** The summary strip's buckets, in the order a cheque moves through them. */
export const CHEQUE_BUCKETS = [
    { key: "awaiting", label: "Awaiting approval", statuses: ["Requested", "CEO Pending"] },
    { key: "issued", label: "Issued, not cleared", statuses: ["Approved", "Reconciliation Pending"] },
    { key: "cleared", label: "Cleared", statuses: ["Paid"] },
    { key: "rejected", label: "Rejected", statuses: ["Rejected"] },
] as const;

export type ChequeBucketKey = (typeof CHEQUE_BUCKETS)[number]["key"];

export interface ChequeSummary {
    total: { count: number; amount: number };
    buckets: Record<ChequeBucketKey, number>;
}

const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Fold the per-status sums into the strip's buckets. A status outside every bucket is ignored. */
export const summariseChequeStatuses = (
    statusSums: GroupByResultItem[] | null | undefined,
    aggregates: Record<string, unknown> | null | undefined,
    totalCount: number,
): ChequeSummary => {
    const buckets = { awaiting: 0, issued: 0, cleared: 0, rejected: 0 } as Record<ChequeBucketKey, number>;
    for (const row of statusSums || []) {
        const bucket = CHEQUE_BUCKETS.find((b) => (b.statuses as readonly string[]).includes(row.group_key));
        if (bucket) buckets[bucket.key] += num(row.aggregate_value);
    }
    return { total: { count: totalCount, amount: num(aggregates?.sum_of_amount) }, buckets };
};

/** A cheque is only good for 3 months from its date. */
export const CHEQUE_VALIDITY_DAYS = 90;

const UNCLEARED_STATUSES = new Set(["Requested", "CEO Pending", "Approved", "Reconciliation Pending"]);

/** Days since the cheque date while the cheque has not cleared; null once Paid / Rejected, or undated. */
export const daysOutstanding = (
    row: Pick<ProjectPayments, "status" | "cheque_date">,
    today: Date = new Date(),
): number | null => {
    if (!row.cheque_date || !UNCLEARED_STATUSES.has(row.status)) return null;
    const [y, m, d] = row.cheque_date.split("-").map(Number);
    if (!y || !m || !d) return null;
    const start = Date.UTC(y, m - 1, d);
    const end = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((end - start) / 86_400_000);
};
