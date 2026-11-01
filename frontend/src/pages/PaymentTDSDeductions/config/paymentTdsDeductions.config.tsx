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
 * The rows are written by `services/payment_tds.py` when an SR-backed payment is approved, and by
 * `services/expense_tds.py` when an Office Rent expense is (194-I, #1525). A rent row shows its
 * landlord and PAN in the Vendor column and its expense in the Payment and Service Request columns
 * (`utils/tdsRegisterRow`). This screen only READS them — there is no create, edit or delete path here, because a deduction
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
import { deductionNetPaid } from "../deductionNetPaid";
import { tdsDeductee, tdsDeducteeIds, tdsDeducteeText, tdsRowSource } from "@/utils/tdsRegisterRow";
import { AmountCell, PaymentStatusCell, TextCell } from "../components/PaymentTdsCells";

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
    /** Joined off the vendor by the list query (`vendor.vendor_gst as vendor_gst`): the vendor's
     *  CURRENT GST and PAN, not a copy taken when the tax was withheld. */
    vendor_gst?: string | null;
    vendor_pan?: string | null;
};

/** A row's Work Order / Purchase Order total, in the one GST column it belongs to
 *  (`api/payments/tds_register_orders`, owner ruling 2026-10-27). */
export interface TdsRegisterOrderValue {
    excl_gst: number | null;
    incl_gst: number | null;
}

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
    // An Office Rent row (#1525): its expense, and the landlord it was withheld from.
    "non_project_expense",
    "deductee_name",
    "deductee_pan",
    "document_type",
    "document_name",
    "vendor",
    // Joined by the server, so the page AND Export All carry them. Not sortable: no such column here.
    "vendor.vendor_gst as vendor_gst",
    "vendor.vendor_pan as vendor_pan",
    "project",
    "gross_amount",
    "tds_percentage",
    "tds_amount",
    // Net Paid reads it: a company-paid row's vendor got the whole gross (#1543).
    "borne_by",
    "payment_approved_on",
    "payment_date",
    // Drives the Status column AND the Pay-TDS selection gate (only `Pending` rows are selectable),
    // so a missing fetch here would silently make every row unselectable.
    "status",
    "creation",
];

export const PAYMENT_TDS_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Deduction ID", placeholder: "Search by Deduction ID...", default: true },
    { value: "project_payment", label: "Payment ID", placeholder: "Search by Payment ID..." },
    { value: "non_project_expense", label: "Expense ID", placeholder: "Search by Expense ID..." },
    { value: "deductee_name", label: "Landlord", placeholder: "Search by Landlord..." },
    { value: "deductee_pan", label: "Landlord PAN", placeholder: "Search by Landlord PAN..." },
    { value: "document_name", label: "Service Request", placeholder: "Search by SR ID..." },
    { value: "vendor", label: "Vendor ID", placeholder: "Search by Vendor ID..." },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
];

/** `payment_approved_on` is the day the payment was approved and the tax withheld; `payment_date` the
 *  day it was paid (empty until then); `creation` is when the ROW was written —
 *  and for the 629 backfilled rows those are years apart, so all three are offered. */
export const PAYMENT_TDS_DATE_COLUMNS: string[] = ["payment_approved_on", "payment_date", "creation"];

/**
 * Columns HIDDEN BY DEFAULT (owner ruling 2026-09-12) — not deleted.
 *
 * They stay in the column list, so the "View" menu switches any of them back on per user, and the
 * CSV export still carries them (export reads the column DEFINITIONS, not what is on screen). The
 * ledger's point is the withheld tax; Project, Payment and Gross are the supporting figures and cost
 * columns of width on a screen that now lives inside the Reports hub. Paid Amount (`net_paid`) was
 * hidden here too until the owner asked for it on screen (2026-10-27).
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

/**
 * A link to the payment or expense a row's tax was withheld on, in the payments queue's All Payments
 * tab, which lists Project Payments and both expense ledgers and searches them by name.
 *
 * `isPaid: false` on purpose -- the deduction row does not carry its source's status, and that
 * argument only picks which TAB to land on. `false` selects "All Payments", which carries no status
 * filter and therefore always contains the row; passing `true` would filter to Paid and land an
 * Approved payment on an empty table.
 */
const SourceLink = ({ name }: { name: string }) => (
    <Link to={paymentHref(name, false)} className="text-blue-600 hover:underline tabular-nums whitespace-nowrap">
        {name}
    </Link>
);

/** A date column: "--" when empty, the date filter, and the same text in the CSV export. */
const dateColumn = (
    key: "payment_approved_on" | "payment_date",
    title: string,
    exportHeaderName: string,
): ColumnDef<PaymentTDSDeductionRow> => {
    const text = (row: PaymentTDSDeductionRow) => (row[key] ? formatDate(row[key]) : "--");
    return {
        accessorKey: key,
        header: ({ column }) => <DataTableColumnHeader column={column} title={title} />,
        cell: ({ row }) => <div className="whitespace-nowrap">{text(row.original)}</div>,
        filterFn: dateFilterFn,
        meta: { exportHeaderName, exportValue: text },
    };
};

interface ColumnFactoryArgs {
    getProjectName: (projectId?: string) => string;
    getVendorName: (vendorId?: string) => string;
    /** The row's WO / PO value, by order name; undefined while loading or for an order the reader cannot see. */
    getOrderValue: (orderName?: string) => TdsRegisterOrderValue | undefined;
}

export const getPaymentTdsColumns = ({
    getProjectName,
    getVendorName,
    getOrderValue,
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
    dateColumn("payment_approved_on", "Approved On", "Payment Approved On"),
    dateColumn("payment_date", "Paid On", "Payment Paid On"),
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
        accessorFn: (row) => deductionNetPaid(row),
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Paid Amount" className={UNSORTABLE_NUMERIC_HEADER_CLASS} />
        ),
        // DERIVED, NOT STORED -- and deliberately so. Once the deduction row exists,
        // `Project Payments.amount` IS this figure; a stored second copy could only drift from it.
        // What the vendor got: the whole gross on a company-paid row (#1543), see `deductionNetPaid`.
        // `enableSorting: false` because the backend sorts on real columns and there is no
        // `net_paid` column to sort on.
        enableSorting: false,
        cell: ({ row }) => (
            <div className="text-right tabular-nums text-muted-foreground">
                {formatToIndianRupee(deductionNetPaid(row.original))}
            </div>
        ),
        meta: {
            exportHeaderName: "Paid Amount",
            exportValue: (row: PaymentTDSDeductionRow) => deductionNetPaid(row),
            isNumeric: true,
        },
    },
    {
        accessorKey: "document_name",
        // A Work Order (Service Request) or, on a PO payment's row, the Purchase Order.
        header: ({ column }) => <DataTableColumnHeader column={column} title="WO / PO" />,
        cell: ({ row }) => {
            const { document_name, document_type } = row.original;
            // An Office Rent row has no Work Order: it shows its expense here too, because the Payment
            // column, where its expense sits, is hidden by default.
            const source = tdsRowSource(row.original);
            if (source?.kind === "expense") return <SourceLink name={source.name} />;
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
            exportHeaderName: "WO / PO",
            exportValue: (row: PaymentTDSDeductionRow) => row.document_name || row.non_project_expense || "--",
        },
    },
    {
        id: "order_excl_gst",
        header: () => <div className={UNSORTABLE_NUMERIC_HEADER_CLASS}>WO/PO excl. GST</div>,
        // The order's total sits in ONE of the two columns, picked by its GST (owner ruling 2026-10-27);
        // the other reads "--". Split on the server (`services/tds_register_orders`).
        cell: ({ row }) => <AmountCell value={getOrderValue(row.original.document_name)?.excl_gst} />,
        enableSorting: false,
        meta: {
            exportHeaderName: "WO/PO excl. GST",
            exportValue: (row: PaymentTDSDeductionRow) => getOrderValue(row.document_name)?.excl_gst ?? "--",
            isNumeric: true,
        },
    },
    {
        id: "order_incl_gst",
        header: () => <div className={UNSORTABLE_NUMERIC_HEADER_CLASS}>WO/PO incl. GST</div>,
        cell: ({ row }) => <AmountCell value={getOrderValue(row.original.document_name)?.incl_gst} />,
        enableSorting: false,
        meta: {
            exportHeaderName: "WO/PO incl. GST",
            exportValue: (row: PaymentTDSDeductionRow) => getOrderValue(row.document_name)?.incl_gst ?? "--",
            isNumeric: true,
        },
    },
    {
        accessorKey: "vendor",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        // A Work Order row names its vendor; an Office Rent row names the landlord and PAN snapshotted
        // when the tax was withheld (#1525). The facet lists vendors only.
        cell: ({ row }) => {
            const deductee = tdsDeductee(row.original);
            if (!deductee) return <span className="text-muted-foreground">--</span>;
            if (deductee.kind === "landlord") {
                return (
                    <div className="leading-tight">
                        <div>{deductee.name}</div>
                        {deductee.pan && (
                            <div className="text-xs text-muted-foreground tabular-nums">PAN {deductee.pan}</div>
                        )}
                    </div>
                );
            }
            return (
                <Link to={`/vendors/${deductee.vendor}`} className="text-blue-600 hover:underline">
                    {row.original.vendor_name || getVendorName(deductee.vendor)}
                </Link>
            );
        },
        filterFn: facetedFilterFn,
        meta: {
            exportHeaderName: "Vendor",
            exportValue: (row: PaymentTDSDeductionRow) =>
                tdsDeducteeText(row, (vendor) => row.vendor_name || getVendorName(vendor)),
            facet: { field: "vendor", title: "Vendor" } satisfies FacetDeclaration,
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
        id: "vendor_id",
        header: () => <span>Vendor ID</span>,
        cell: ({ row }) => <TextCell value={tdsDeducteeIds(row.original).id} />,
        enableSorting: false,
        meta: {
            exportHeaderName: "Vendor ID",
            exportValue: (row: PaymentTDSDeductionRow) => tdsDeducteeIds(row).id || "--",
        },
    },
    {
        id: "vendor_gst",
        header: () => <span>Vendor GST</span>,
        cell: ({ row }) => <TextCell value={tdsDeducteeIds(row.original).gst} />,
        enableSorting: false,
        meta: {
            exportHeaderName: "Vendor GST",
            exportValue: (row: PaymentTDSDeductionRow) => tdsDeducteeIds(row).gst || "--",
        },
    },
    {
        id: "vendor_pan",
        header: () => <span>Vendor PAN</span>,
        cell: ({ row }) => <TextCell value={tdsDeducteeIds(row.original).pan} />,
        enableSorting: false,
        meta: {
            exportHeaderName: "Vendor PAN",
            exportValue: (row: PaymentTDSDeductionRow) => tdsDeducteeIds(row).pan || "--",
        },
    },
    {
        id: "payment_status",
        header: () => <span>Payment Status</span>,
        // The VENDOR PAYMENT's status, not the tax's. The Pending tab drops this column (owner ruling
        // 2026-10-27): a "Paid" there read as if the TDS were paid. Pay TDS still reads the statuses.
        // Pay TDS takes tax only from a Paid payment (story 39): an Office Rent row names none ("--").
        cell: ({ row }) => <PaymentStatusCell payment={row.original.project_payment} />,
        enableSorting: false,
        // Not exported: the statuses are fetched for the page on screen only, so an export would print a blank
        // column for every other row.
        meta: { excludeFromExport: true },
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
        accessorKey: "project_payment",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Payment" />,
        // A Work Order row names its payment; an Office Rent row names its Non-Project Expense (#1525).
        cell: ({ row }) => {
            const source = tdsRowSource(row.original);
            return source ? <SourceLink name={source.name} /> : <span className="text-muted-foreground">--</span>;
        },
        meta: {
            exportHeaderName: "Payment",
            exportValue: (row: PaymentTDSDeductionRow) => tdsRowSource(row)?.name || "--",
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
];
