import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { Filter, FilterX, Info } from "lucide-react";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { FacetDeclaration } from "@/components/data-table/facetConfig";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TruncatedText } from "@/components/common/TruncatedText";
import { PaymentVoucherActions } from "@/components/paymentsVoucher/PaymentVoucherActions";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { VoucherStatusFilter } from "../../config/woPaymentVoucherTable.config";

interface WOPaymentVoucherColumnArgs {
    projectNames: Map<string, string>;
    vendorNames: Map<string, string>;
    /** payment name -> TDS withheld (from `Payment TDS Deduction`). */
    tdsByPayment: Map<string, number>;
    /** Upload / Delete allowed (screen-only gate). */
    canEditVoucher: boolean;
    onVoucherUpdate: () => void;
    voucherStatus: VoucherStatusFilter;
    onVoucherStatusChange: (status: VoucherStatusFilter) => void;
}

/** Name + an info icon that opens the record (same pattern as the other WO reports). */
const LinkedName = ({ text, to, title }: { text: string; to: string; title: string }) => (
    <div className="flex items-center gap-1 min-w-0">
        <TruncatedText text={text} fallback="--" />
        <Link to={to} title={title} className="shrink-0">
            <Info className="text-blue-500 h-3 w-3" />
        </Link>
    </div>
);

const VOUCHER_STATUS_OPTIONS: { value: VoucherStatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "uploaded", label: "Uploaded" },
    { value: "missing", label: "Missing" },
];

/**
 * Header funnel for the derived Voucher Status column. It is NOT a TanStack column filter
 * (there is no stored status field to facet on); it drives the page's is-set filter instead.
 */
const VoucherStatusHeader = ({
    value,
    onChange,
}: {
    value: VoucherStatusFilter;
    onChange: (status: VoucherStatusFilter) => void;
}) => {
    const active = value !== "all";
    return (
        <div className="flex items-center gap-1">
            <Popover>
                <PopoverTrigger asChild>
                    <div
                        className={`cursor-pointer ${active ? "bg-gray-200" : ""} hover:bg-gray-100 px-1 py-1 rounded-md`}
                        title="Filter by voucher status"
                    >
                        {active ? (
                            <FilterX className="text-primary h-4 w-4 animate-bounce" />
                        ) : (
                            <Filter className="text-primary h-4 w-4" />
                        )}
                    </div>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-1" align="start">
                    {VOUCHER_STATUS_OPTIONS.map((o) => (
                        <button
                            key={o.value}
                            type="button"
                            onClick={() => onChange(o.value)}
                            className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-100 ${
                                value === o.value ? "font-semibold text-primary" : ""
                            }`}
                        >
                            {o.label}
                        </button>
                    ))}
                </PopoverContent>
            </Popover>
            <span className="whitespace-nowrap">Voucher Status</span>
        </div>
    );
};

export const hasVoucher = (p: Pick<ProjectPayments, "voucher_attachment">) => !!p.voucher_attachment;

export const getWOPaymentVoucherColumns = ({
    projectNames,
    vendorNames,
    tdsByPayment,
    canEditVoucher,
    onVoucherUpdate,
    voucherStatus,
    onVoucherStatusChange,
}: WOPaymentVoucherColumnArgs): ColumnDef<ProjectPayments>[] => [
    {
        accessorKey: "document_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="WO ID" />,
        cell: ({ row }) => {
            const wo = row.original.document_name;
            return (
                <div className="flex items-center gap-1 whitespace-nowrap">
                    {wo}
                    <Link
                        to={`/service-requests/${wo.replace(/\//g, "&=")}?tab=approved-sr`}
                        title="Open Work Order"
                    >
                        <Info className="text-blue-500 h-3 w-3" />
                    </Link>
                </div>
            );
        },
        size: 170,
        meta: { exportHeaderName: "WO ID", exportValue: (r: ProjectPayments) => r.document_name },
    },
    {
        accessorKey: "project",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => (
            <LinkedName
                text={projectNames.get(row.original.project) || row.original.project}
                to={`/projects/${row.original.project}`}
                title="Open Project"
            />
        ),
        size: 200,
        meta: {
            facet: { field: "project", title: "Project" } satisfies FacetDeclaration,
            exportHeaderName: "Project",
            exportValue: (r: ProjectPayments) => projectNames.get(r.project) || r.project,
        },
    },
    {
        accessorKey: "vendor",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        cell: ({ row }) => {
            const v = row.original.vendor || "";
            if (!v) return <span>--</span>;
            return <LinkedName text={vendorNames.get(v) || v} to={`/vendors/${v}`} title="Open Vendor" />;
        },
        size: 200,
        meta: {
            facet: { field: "vendor", title: "Vendor" } satisfies FacetDeclaration,
            exportHeaderName: "Vendor",
            exportValue: (r: ProjectPayments) => vendorNames.get(r.vendor || "") || r.vendor || "",
        },
    },
    {
        accessorKey: "amount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
        cell: ({ row }) => (
            <div className="font-medium whitespace-nowrap">
                {formatToRoundedIndianRupee(row.original.amount)}
            </div>
        ),
        size: 130,
        meta: {
            isNumeric: true,
            exportHeaderName: "Amount",
            exportValue: (r: ProjectPayments) => formatForReport(r.amount),
        },
    },
    {
        id: "tds",
        header: "TDS",
        cell: ({ row }) => {
            const tds = tdsByPayment.get(row.original.name);
            return <div className="whitespace-nowrap">{tds ? formatToRoundedIndianRupee(tds) : "--"}</div>;
        },
        size: 110,
        enableSorting: false,
        meta: {
            isNumeric: true,
            exportHeaderName: "TDS",
            exportValue: (r: ProjectPayments) => {
                const tds = tdsByPayment.get(r.name);
                return tds ? formatForReport(tds) : "";
            },
        },
    },
    {
        accessorKey: "utr",
        header: ({ column }) => <DataTableColumnHeader column={column} title="UTR" />,
        cell: ({ row }) => <TruncatedText text={row.original.utr} fallback="--" />,
        size: 160,
        meta: { exportHeaderName: "UTR", exportValue: (r: ProjectPayments) => r.utr || "" },
    },
    {
        accessorKey: "payment_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Date" />,
        cell: ({ row }) => (
            <div className="whitespace-nowrap">
                {row.original.payment_date ? formatDate(row.original.payment_date) : "--"}
            </div>
        ),
        size: 130,
        meta: {
            exportHeaderName: "Payment Date",
            exportValue: (r: ProjectPayments) => (r.payment_date ? formatDate(r.payment_date) : ""),
        },
    },
    {
        id: "voucher_status",
        header: () => <VoucherStatusHeader value={voucherStatus} onChange={onVoucherStatusChange} />,
        cell: ({ row }) =>
            hasVoucher(row.original) ? (
                <Badge variant="green">Uploaded</Badge>
            ) : (
                <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">
                    Missing
                </Badge>
            ),
        size: 170,
        enableSorting: false,
        meta: {
            exportHeaderName: "Voucher Status",
            exportValue: (r: ProjectPayments) => (hasVoucher(r) ? "Uploaded" : "Missing"),
        },
    },
    {
        id: "voucher_actions",
        header: "Voucher",
        cell: ({ row }) => (
            <PaymentVoucherActions
                payment={row.original}
                orderName={row.original.document_name}
                onVoucherUpdate={onVoucherUpdate}
                canEdit={canEditVoucher}
            />
        ),
        size: 120,
        enableSorting: false,
        meta: { excludeFromExport: true },
    },
];
