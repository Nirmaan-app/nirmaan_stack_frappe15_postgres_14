/**
 * The Payment TDS Deduction ledger table — columns, fields, search and aggregates.
 *
 * ⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE ON A VENDOR PAYMENT**. This repo ALSO uses "TDS" for
 * **TECHNICAL DATA SHEET** (`TDS Items`, `TDS Repository`, `Project TDS Setting`, and the
 * `/tds-repository` + `/tds-approval` routes in the sidebar). Same three letters, unrelated
 * concepts, different owners. This module lives in the Reports hub under the tab "Payment TDS
 * Deduction" and its legacy route was deliberately `/payment-tds-deductions`, NOT `/tds-…`, so the
 * two families never collide in the URL space either.
 *
 * The rows are written by `services/payment_tds.py` when an SR-backed payment reaches `Approved`.
 * This screen only READS them — there is no create, edit or delete path here, because a deduction
 * has no reversal (owner ruling 2026-09-10): it is deleted with the payment it belongs to.
 */

import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { SearchFieldOption } from "@/components/data-table/new-data-table";
import { AggregationConfig } from "@/hooks/useServerDataTable";
import { FacetDeclaration } from "@/components/data-table/facetConfig";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { paymentHref } from "@/pages/ProjectPayments/config/projectPaymentsTable.config";
import { PaymentTDSDeduction } from "@/types/NirmaanStack/PaymentTDSDeduction";

export const DOCTYPE = "Payment TDS Deduction";

/**
 * A row as the LIST API returns it.
 *
 * `get_list_with_count_enhanced` injects `<link_field>_name` for any fetched Link field it
 * recognises (`vendor` -> `vendor_name`, `project` -> `project_name`), which lets the first paint
 * show real names instead of IDs that flip over once the lookup lists resolve.
 *
 * ⚠️ BEST-EFFORT, NEVER RELIED ON. That injection sits inside a bare `except: pass` in
 * `api/data_table/search.py` ("Keep it extremely safe"), so it can silently return nothing. Every
 * read of these two fields therefore falls back to the lookup map, which is also what every
 * sibling table in this app uses.
 */
export type PaymentTDSDeductionRow = PaymentTDSDeduction & {
    vendor_name?: string;
    project_name?: string;
};

/**
 * `document_type` is fetched but NOT rendered as a column.
 *
 * Every row says `Service Requests` today — `DEDUCTIBLE_PARENTS` in `services/payment_tds.py`
 * holds exactly one ledger — so a column and a facet for it would be a single-valued dropdown.
 * It is fetched anyway because the SR deep-link is only correct for that value: the day
 * `Procurement Orders` joins the set, the link cell has to branch on it, and the column plus its
 * facet come back together.
 */
export const PAYMENT_TDS_FIELDS_TO_FETCH: string[] = [
    "name",
    "project_payment",
    "document_type",
    "document_name",
    "vendor",
    "project",
    "gross_amount",
    "tds_percentage",
    "tds_amount",
    "deducted_on",
    // Drives the Status column AND the Pay-TDS selection gate (only `Pending` rows are selectable),
    // so a missing fetch here would silently make every row unselectable.
    "status",
    "creation",
];

export const PAYMENT_TDS_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Deduction ID", placeholder: "Search by Deduction ID...", default: true },
    { value: "project_payment", label: "Payment ID", placeholder: "Search by Payment ID..." },
    { value: "document_name", label: "Service Request", placeholder: "Search by SR ID..." },
    { value: "vendor", label: "Vendor ID", placeholder: "Search by Vendor ID..." },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
];

/** `deducted_on` is the day the tax was withheld; `creation` is when the ROW was written — and for
 *  the 629 backfilled rows those are years apart, so both are offered. */
export const PAYMENT_TDS_DATE_COLUMNS: string[] = ["deducted_on", "creation"];

/**
 * Columns HIDDEN BY DEFAULT (owner ruling 2026-09-12) — not deleted.
 *
 * They stay in the column list, so the "View" menu switches any of them back on per user, and the
 * CSV export still carries them (export reads the column DEFINITIONS, not what is on screen). The
 * ledger's point is the withheld tax; Project, Payment, Gross and Net are the supporting figures
 * and cost four columns of width on a screen that now lives inside the Reports hub.
 *
 * ⚠️ HIDING `project` ALSO REMOVES ITS FACET DROPDOWN, because DataTable renders a facet from the
 * table's HEADERS and a hidden column has none. Filtering by project is still possible two ways —
 * switch the column back on in "View", or search the "Project ID" field — but the one-click Project
 * filter is gone until someone unhides it. `vendor` keeps its facet (that column stays visible).
 */
export const PAYMENT_TDS_HIDDEN_COLUMNS: Record<string, boolean> = {
    project: false,
    project_payment: false,
    gross_amount: false,
    net_paid: false,
};

export const PAYMENT_TDS_AGGREGATES_CONFIG: AggregationConfig[] = [
    { field: "gross_amount", function: "sum" },
    { field: "tds_amount", function: "sum" },
];

/**
 * Right-aligns a NUMERIC column header so it sits flush over its digits.
 *
 * Three things have to be true at once, and each was wrong on the first pass:
 *   - `flex-1` -- DataTable wraps every header in `<div className="flex items-center gap-1">`
 *     (new-data-table.tsx). Without this the header is a flex ITEM only as wide as its own text,
 *     so `justify-end` has nothing to push against and silently does nothing.
 *   - `justify-end` -- right-aligns within that now-full-width box.
 *   - `-mr-1` -- `DataTableColumnHeader`'s sort button carries `px-1`, which would leave the label
 *     4px short of the cell's right padding while the body cells sit flush against it. This
 *     cancels exactly that padding. Drop it and the columns look aligned but are off by 4px.
 */
const NUMERIC_HEADER_CLASS = "flex-1 justify-end -mr-1";

/**
 * Same job for a column with `enableSorting: false`. That branch of `DataTableColumnHeader`
 * returns a PLAIN div with no `flex`, so `justify-end` is inert there and `text-right` is what
 * aligns it -- and with no sort button there is no `px-1` to cancel.
 */
const UNSORTABLE_NUMERIC_HEADER_CLASS = "flex-1 text-right";

/** The parent ledger whose rows carry an SR deep-link. Mirrors `payment_tds.DEDUCTIBLE_PARENTS`. */
const SERVICE_REQUESTS = "Service Requests";

interface ColumnFactoryArgs {
    getProjectName: (projectId?: string) => string;
    getVendorName: (vendorId?: string) => string;
}

export const getPaymentTdsColumns = ({
    getProjectName,
    getVendorName,
}: ColumnFactoryArgs): ColumnDef<PaymentTDSDeductionRow>[] => [
    {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Deduction ID" />,
        cell: ({ row }) => (
            <span className="font-medium tabular-nums whitespace-nowrap">{row.original.name}</span>
        ),
        meta: {
            exportHeaderName: "Deduction ID",
            exportValue: (row: PaymentTDSDeductionRow) => row.name,
        },
    },
    {
        accessorKey: "deducted_on",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Deducted On" />,
        cell: ({ row }) => (
            <div className="whitespace-nowrap">
                {row.original.deducted_on ? formatDate(row.original.deducted_on) : "--"}
            </div>
        ),
        filterFn: dateFilterFn,
        meta: {
            exportHeaderName: "Deducted On",
            exportValue: (row: PaymentTDSDeductionRow) =>
                row.deducted_on ? formatDate(row.deducted_on) : "--",
        },
    },
    {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        // ⚠️ A BLANK READS AS `Pending`, and the selection gate in PaymentTDSDeductions.tsx makes the
        // SAME assumption -- keep the two in step. The doctype defaults `status` to "Pending" and
        // Postgres backfilled all 626 existing rows with it, so a blank should not occur; if one
        // ever does, showing it as Pending keeps it payable rather than stranding it.
        cell: ({ row }) => {
            const status = row.original.status || "Pending";
            const isPending = status === "Pending";
            return (
                <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${isPending
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        }`}
                >
                    {status}
                </span>
            );
        },
        filterFn: facetedFilterFn,
        meta: {
            exportHeaderName: "Status",
            exportValue: (row: PaymentTDSDeductionRow) => row.status || "Pending",
            facet: { field: "status", title: "Status" } satisfies FacetDeclaration,
        },
    },
    {
        accessorKey: "project",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) =>
            row.original.project ? (
                <Link
                    to={`/projects/${row.original.project}`}
                    className="text-blue-600 hover:underline"
                >
                    {row.original.project_name || getProjectName(row.original.project)}
                </Link>
            ) : (
                <span className="text-muted-foreground">--</span>
            ),
        filterFn: facetedFilterFn,
        meta: {
            exportHeaderName: "Project",
            exportValue: (row: PaymentTDSDeductionRow) => row.project_name || getProjectName(row.project),
            facet: { field: "project", title: "Project" } satisfies FacetDeclaration,
        },
    },
    {
        accessorKey: "vendor",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        cell: ({ row }) =>
            row.original.vendor ? (
                <Link
                    to={`/vendors/${row.original.vendor}`}
                    className="text-blue-600 hover:underline"
                >
                    {row.original.vendor_name || getVendorName(row.original.vendor)}
                </Link>
            ) : (
                <span className="text-muted-foreground">--</span>
            ),
        filterFn: facetedFilterFn,
        meta: {
            exportHeaderName: "Vendor",
            exportValue: (row: PaymentTDSDeductionRow) => row.vendor_name || getVendorName(row.vendor),
            facet: { field: "vendor", title: "Vendor" } satisfies FacetDeclaration,
        },
    },
    {
        accessorKey: "document_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Service Request" />,
        cell: ({ row }) => {
            const { document_name, document_type } = row.original;
            if (!document_name) return <span className="text-muted-foreground">--</span>;
            // Only an SR has a route here. A future non-SR parent renders as plain text rather
            // than a link that 404s -- see the note on PAYMENT_TDS_FIELDS_TO_FETCH.
            if (document_type !== SERVICE_REQUESTS) {
                return <span className="whitespace-nowrap">{document_name}</span>;
            }
            return (
                <Link
                    to={`/service-requests-list/${document_name}`}
                    className="text-blue-600 hover:underline whitespace-nowrap"
                >
                    {document_name}
                </Link>
            );
        },
        meta: {
            exportHeaderName: "Service Request",
            exportValue: (row: PaymentTDSDeductionRow) => row.document_name || "--",
        },
    },
    {
        accessorKey: "project_payment",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Payment" />,
        cell: ({ row }) => (
            // `isPaid: false` on purpose -- the deduction row does not carry the payment's status,
            // and that argument only picks which TAB to land on. `false` selects "All Payments",
            // which carries no status filter and therefore always contains the row; passing `true`
            // would filter to Paid and land an Approved payment on an empty table.
            <Link
                to={paymentHref(row.original.project_payment, false)}
                className="text-blue-600 hover:underline tabular-nums whitespace-nowrap"
            >
                {row.original.project_payment}
            </Link>
        ),
        meta: {
            exportHeaderName: "Payment",
            exportValue: (row: PaymentTDSDeductionRow) => row.project_payment,
        },
    },
    {
        accessorKey: "gross_amount",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Gross Amount" className={NUMERIC_HEADER_CLASS} />
        ),
        cell: ({ row }) => (
            <div className="text-right tabular-nums">
                {formatToIndianRupee(row.original.gross_amount)}
            </div>
        ),
        meta: {
            exportHeaderName: "Gross Amount",
            exportValue: (row: PaymentTDSDeductionRow) => row.gross_amount,
            isNumeric: true,
        },
    },
    {
        accessorKey: "tds_percentage",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Vendor TDS" className={NUMERIC_HEADER_CLASS} />
        ),
        // ⚠️ THE RATE AS APPLIED, SNAPSHOTTED ONTO THE ROW -- never the vendor's CURRENT
        // `tds_deduction_percentage`. Measured 2026-09-10: 561 of 629 rows carry a rate that
        // differs from their vendor's rate today (the master is 1,105 vendors at 2%, one at 3%),
        // because the backfilled rows were taken at the rate of their own era. Reading the vendor
        // here would silently restate almost every historical deduction.
        //
        // NO FACET, by owner ruling: the backfilled rates are back-derived from the legacy amount
        // and land on 14 distinct values (0.96, 0.97, 1.01, 1.03, 1.7, 2.29, 3.36, 5.96, 7.69 ...),
        // most of them singletons. Sorting surfaces the odd ones without a 14-item dropdown.
        cell: ({ row }) => (
            <div className="text-right tabular-nums">
                {row.original.tds_percentage != null
                    ? `${Number(row.original.tds_percentage).toFixed(2)}%`
                    : "--"}
            </div>
        ),
        meta: {
            exportHeaderName: "Vendor TDS (%)",
            exportValue: (row: PaymentTDSDeductionRow) => row.tds_percentage,
            isNumeric: true,
        },
    },
    {
        accessorKey: "tds_amount",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="TDS Amount" className={NUMERIC_HEADER_CLASS} />
        ),
        cell: ({ row }) => (
            <div className="text-right font-semibold tabular-nums text-red-700 dark:text-red-400">
                {formatToIndianRupee(row.original.tds_amount)}
            </div>
        ),
        meta: {
            exportHeaderName: "TDS Amount",
            exportValue: (row: PaymentTDSDeductionRow) => row.tds_amount,
            isNumeric: true,
        },
    },
    {
        id: "net_paid",
        accessorFn: (row) => (row.gross_amount || 0) - (row.tds_amount || 0),
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Net Paid" className={UNSORTABLE_NUMERIC_HEADER_CLASS} />
        ),
        // DERIVED, NOT STORED -- and deliberately so. Once the deduction row exists,
        // `Project Payments.amount` IS this figure; a stored second copy could only drift from it.
        // `enableSorting: false` because the backend sorts on real columns and there is no
        // `net_paid` column to sort on.
        enableSorting: false,
        cell: ({ row }) => (
            <div className="text-right tabular-nums text-muted-foreground">
                {formatToIndianRupee((row.original.gross_amount || 0) - (row.original.tds_amount || 0))}
            </div>
        ),
        meta: {
            exportHeaderName: "Net Paid",
            exportValue: (row: PaymentTDSDeductionRow) =>
                (row.gross_amount || 0) - (row.tds_amount || 0),
            isNumeric: true,
        },
    },
];
