import React, { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { FacetDeclaration } from "@/components/data-table/facetConfig";
import { TruncatedText } from "@/components/common/TruncatedText";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { RefundAttachmentLink } from "@/components/vendor-refunds/RefundAttachmentLink";
import type { VendorRefundRow } from "@/components/vendor-refunds/useVendorRefunds";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { Projects } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";

interface VendorRefundsTabProps {
    vendorId: string;
    vendorName?: string;
}

/** How a refund's `document_type` reads on screen. */
const TYPE_LABEL: Record<string, string> = {
    "Procurement Orders": "PO",
    "Service Requests": "WO",
    "Misc. Expense": "Misc. Expense",
};

/**
 * The app's route to an order's payments, slashes escaped as `&=` -- the same escape
 * `outflowTableModel.orderPaymentsHref` documents (and `OrderPaymentSummary` reverses).
 */
const orderPaymentsHref = (orderName: string) => `/project-payments/${orderName.replace(/\//g, "&=")}`;

/**
 * The vendor page's Vendor Refunds tab: every refund of this vendor -- PO, WO and Misc. Expense -- on
 * the shared server data table (search, column filters, export, paging), like Vendor Quotes.
 *
 * ⚠️ Reads `Vendor Refunds` directly, so it rides that doctype's READ DocPerms, which mirror
 * `Project Payments`' read roles: whoever sees this vendor's payments sees its refunds.
 */
export const VendorRefundsTab: React.FC<VendorRefundsTabProps> = ({ vendorId, vendorName }) => {
    const { data: projectsData, isLoading: projectsLoading } = useFrappeGetDocList<Projects>(
        "Projects",
        { fields: ["name", "project_name"], limit: 0 },
        "projects_lookup_for_vendor_refunds"
    );

    const projectMap = useMemo(() => {
        const map = new Map<string, string>();
        projectsData?.forEach((p) => map.set(p.name, p.project_name));
        return map;
    }, [projectsData]);

    const staticFilters = useMemo(() => (vendorId ? [["vendor", "=", vendorId]] : []), [vendorId]);

    const fetchFields = useMemo(
        () => [
            "name",
            "vendor",
            "project",
            "document_type",
            "document_name",
            "amount",
            "utr",
            "payment_date",
            "description",
            "refund_attachment",
            "creation",
        ],
        []
    );

    const searchableFields = useMemo(
        () => [
            { value: "name", label: "Refund ID", placeholder: "Search by Refund ID...", default: true },
            { value: "document_name", label: "PO / WO", placeholder: "Search by PO / WO..." },
            { value: "utr", label: "UTR / Ref", placeholder: "Search by UTR / Ref..." },
            { value: "description", label: "Description", placeholder: "Search by description..." },
        ],
        []
    );

    const columns = useMemo<ColumnDef<VendorRefundRow>[]>(
        () => [
            {
                accessorKey: "payment_date",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
                cell: ({ row }) => (
                    <div className="font-medium whitespace-nowrap text-xs text-muted-foreground">
                        {row.original.payment_date ? formatDate(row.original.payment_date) : "--"}
                    </div>
                ),
                meta: {
                    exportHeaderName: "Date",
                    exportValue: (row: VendorRefundRow) => (row.payment_date ? formatDate(row.payment_date) : ""),
                },
                size: 120,
            },
            {
                accessorKey: "name",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Refund ID" />,
                cell: ({ row }) => <div className="font-medium text-xs whitespace-nowrap">{row.original.name}</div>,
                size: 140,
            },
            {
                accessorKey: "document_type",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
                cell: ({ row }) => (
                    <div className="text-xs whitespace-nowrap">
                        {TYPE_LABEL[row.original.document_type] ?? row.original.document_type}
                    </div>
                ),
                meta: {
                    facet: { field: "document_type", title: "Type" } satisfies FacetDeclaration,
                    exportHeaderName: "Type",
                    exportValue: (row: VendorRefundRow) => TYPE_LABEL[row.document_type] ?? row.document_type,
                },
                size: 120,
            },
            {
                accessorKey: "document_name",
                header: ({ column }) => <DataTableColumnHeader column={column} title="PO / WO" />,
                cell: ({ row }) =>
                    row.original.document_name ? (
                        <Link
                            to={orderPaymentsHref(row.original.document_name)}
                            className="text-xs font-medium whitespace-nowrap text-blue-600 hover:underline"
                        >
                            {row.original.document_name}
                        </Link>
                    ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                    ),
                meta: {
                    facet: { field: "document_name", title: "PO / WO" } satisfies FacetDeclaration,
                    exportHeaderName: "PO / WO",
                    exportValue: (row: VendorRefundRow) => row.document_name || "",
                },
                size: 180,
            },
            {
                accessorKey: "project",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
                cell: ({ row }) => {
                    const projectId = row.original.project || "";
                    const label = projectMap.get(projectId) || projectId;
                    return (
                        <div className="font-medium text-xs truncate max-w-[200px]" title={label}>
                            {label || "--"}
                        </div>
                    );
                },
                meta: {
                    facet: { field: "project", title: "Project" } satisfies FacetDeclaration,
                    exportHeaderName: "Project",
                    exportValue: (row: VendorRefundRow) => projectMap.get(row.project || "") || row.project || "",
                },
                size: 200,
            },
            {
                accessorKey: "utr",
                header: ({ column }) => <DataTableColumnHeader column={column} title="UTR / Ref" />,
                cell: ({ row }) => (
                    <div className="text-xs">
                        <RefundAttachmentLink refund={row.original} className="max-w-[8.5rem]" />
                    </div>
                ),
                meta: {
                    exportHeaderName: "UTR / Ref",
                    exportValue: (row: VendorRefundRow) => row.utr || "",
                },
                size: 150,
            },
            {
                accessorKey: "description",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
                cell: ({ row }) => (
                    <div className="text-xs">
                        <TruncatedText text={row.original.description} fallback="--" className="max-w-[8.5rem]" />
                    </div>
                ),
                meta: {
                    exportHeaderName: "Description",
                    exportValue: (row: VendorRefundRow) => row.description || "",
                },
                size: 150,
            },
            {
                accessorKey: "amount",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
                cell: ({ row }) => (
                    <div className="text-xs font-medium text-right whitespace-nowrap tabular-nums">
                        {formatToIndianRupee(row.original.amount)}
                    </div>
                ),
                meta: {
                    exportHeaderName: "Amount",
                    exportValue: (row: VendorRefundRow) => String(row.amount ?? ""),
                },
                size: 130,
            },
        ],
        [projectMap]
    );

    const {
        table,
        totalCount,
        isLoading: tableLoading,
        error: tableError,
        exportAllRows,
        isExporting,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
    } = useServerDataTable<VendorRefundRow>({
        doctype: "Vendor Refunds",
        columns,
        fetchFields,
        searchableFields,
        defaultSort: "payment_date desc",
        urlSyncKey: "vendor_refunds_list",
        enableRowSelection: false,
        additionalFilters: staticFilters,
    });

    if (tableError) return <AlertDestructive error={tableError} />;

    return (
        <DataTable<VendorRefundRow>
            table={table}
            columns={columns}
            isLoading={tableLoading || projectsLoading}
            totalCount={totalCount}
            searchFieldOptions={searchableFields}
            selectedSearchField={selectedSearchField}
            onSelectedSearchFieldChange={setSelectedSearchField}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            dateFilterColumns={["payment_date"]}
            facetDoctype="Vendor Refunds"
            facetOverrides={{
                document_type: { additionalFilters: staticFilters },
                document_name: { additionalFilters: staticFilters },
                project: { additionalFilters: staticFilters },
            }}
            showExportButton={true}
            onExport={"default"}
            onExportAll={exportAllRows}
            isExporting={isExporting}
            exportFileName={vendorName ? `${vendorName}_Vendor_Refunds` : "Vendor_Refunds"}
        />
    );
};

export default VendorRefundsTab;
