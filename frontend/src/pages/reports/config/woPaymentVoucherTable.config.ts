import { SearchFieldOption } from "@/components/data-table/new-data-table";
import { AggregationConfig } from "@/hooks/useServerDataTable";

/** Reports > WO > Payment Voucher Uploads: every PAID Work Order payment. */
export const WO_PAYMENT_VOUCHER_DOCTYPE = "Project Payments";

export const WO_PAYMENT_VOUCHER_BASE_FILTERS: [string, string, string][] = [
    ["document_type", "=", "Service Requests"],
    ["status", "=", "Paid"],
];

export const WO_PAYMENT_VOUCHER_FIELDS: string[] = [
    "name",
    "creation",
    "document_type",
    "document_name",
    "project",
    "vendor",
    "amount",
    "utr",
    "payment_date",
    "status",
    "voucher_attachment",
];

export const WO_PAYMENT_VOUCHER_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "document_name", label: "WO ID", default: true },
    { value: "utr", label: "UTR" },
];

export const WO_PAYMENT_VOUCHER_DATE_COLUMNS = ["payment_date"];

/**
 * Summary card, computed server-side over EVERY row matching the current search + filters
 * (not just the visible page). IS_SET treats both NULL and "" as empty -- deleting a voucher
 * leaves "" behind, which a plain COUNT would still count.
 * Total count comes from the table's own `totalCount`; Missing = Total - Uploaded.
 */
export const WO_PAYMENT_VOUCHER_AGGREGATES: AggregationConfig[] = [
    { field: "amount", function: "sum" },
    {
        alias: "voucher_uploaded_count",
        aggregate: "SUM",
        expression: { function: "IS_SET", args: ["voucher_attachment"] },
    },
    {
        alias: "voucher_uploaded_amount",
        aggregate: "SUM",
        expression: {
            function: "MULTIPLY",
            args: ["amount", { function: "IS_SET", args: ["voucher_attachment"] }],
        },
    },
];

/** Toolbar "Voucher Status" filter. Frappe's `is set` also treats "" as empty, matching IS_SET. */
export type VoucherStatusFilter = "all" | "uploaded" | "missing";

export const voucherStatusFilter = (status: VoucherStatusFilter): [string, string, string][] => {
    if (status === "uploaded") return [["voucher_attachment", "is", "set"]];
    if (status === "missing") return [["voucher_attachment", "is", "not set"]];
    return [];
};

export interface VoucherSummary {
    total: { count: number; amount: number };
    uploaded: { count: number; amount: number };
    missing: { count: number; amount: number };
}

const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Split the filtered set into Uploaded / Missing. `totalCount` is the table's filtered row count. */
export const summariseVoucherAggregates = (
    aggregates: Record<string, unknown> | null | undefined,
    totalCount: number,
): VoucherSummary => {
    const totalAmount = num(aggregates?.sum_of_amount);
    const uploadedCount = num(aggregates?.voucher_uploaded_count);
    const uploadedAmount = num(aggregates?.voucher_uploaded_amount);
    return {
        total: { count: totalCount, amount: totalAmount },
        uploaded: { count: uploadedCount, amount: uploadedAmount },
        missing: { count: Math.max(0, totalCount - uploadedCount), amount: totalAmount - uploadedAmount },
    };
};
