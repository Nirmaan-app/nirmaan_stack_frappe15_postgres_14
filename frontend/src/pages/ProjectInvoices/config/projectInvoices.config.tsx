import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Trash2, Edit2 } from "lucide-react";
import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { AggregationConfig } from "@/hooks/useServerDataTable";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import SITEURL from "@/constants/siteURL";
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card";

/** Minimal inflow shape needed to render the reverse "Inflows" column. */
export type LinkedInflowEntry = {
    name: string;
    utr?: string;
    inflow_attachment?: string;
    amount?: number;
    payment_date?: string;
};

// =================================================================================
// 1. STATIC CONFIGURATION
// =================================================================================
export const DOCTYPE = "Project Invoices";

export const PROJECT_INVOICE_FIELDS_TO_FETCH = [
    "name", "invoice_no", "amount", "attachment", "creation", "owner", "project", "modified_by", "invoice_date", "customer", "project_gst"
];

export const PROJECT_INVOICE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "invoice_no", label: "Invoice No", placeholder: "Search by Invoice Number...", default: true },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
    { value: "owner", label: "Created By", placeholder: "Search by creator's email..." },
];

export const PROJECT_INVOICE_DATE_COLUMNS = ["invoice_date"];

// Backend aggregation config for summary card
export const PROJECT_INVOICE_AGGREGATES_CONFIG: AggregationConfig[] = [
    { field: 'amount', function: 'sum' }
];

// Static filter helper function (follows inflowPaymentsTable.config.ts pattern)
export const getProjectInvoiceStaticFilters = (
    customerId?: string,
    projectId?: string
): Array<[string, string, string]> => {
    const filters: Array<[string, string, string]> = [];
    if (projectId) {
        filters.push(["project", "=", projectId]);
    }
    if (customerId) {
        filters.push(["customer", "=", customerId]);
    }
    return filters;
};

// =================================================================================
// 2. TYPES & INTERFACES FOR COLUMN GENERATION
// =================================================================================
type ProjectNameResolver = (projectId?: string) => string;
type CustomerNameResolver = (customerId?: string) => string;
type UserNameResolver = (userId?: string) => string;
type GstNameResolver = (gstId?: string) => string;

interface ColumnGeneratorOptions {
    /** Show the Edit action button (Admin + Accountant). */
    canEdit: boolean;
    /** Show the Delete action button (Admin only). */
    canDelete: boolean;
    getProjectName: ProjectNameResolver;
    getCustomerName: CustomerNameResolver;
    getUserName: UserNameResolver;
    getGstName: GstNameResolver;
    onDelete: (invoice: ProjectInvoice) => void;
    onEdit: (invoice: ProjectInvoice) => void;
    hideCustomerColumn?: boolean; // Hide customer column when viewing from customer page
    /**
     * Resolves the inflows that have been recorded against the given invoice.
     * Supplied by the parent page after it side-fetches Project Inflows
     * filtered by `invoice IN (visible invoice ids)`. Returns [] when none.
     */
    getInflowsForInvoice?: (invoiceId: string) => LinkedInflowEntry[];
}

// =================================================================================
// 3. DYNAMIC COLUMN GENERATOR FUNCTION
// =================================================================================
export const getProjectInvoiceColumns = (
    options: ColumnGeneratorOptions
): ColumnDef<ProjectInvoice>[] => {

    const { canEdit, canDelete, getProjectName, getCustomerName, getUserName, getGstName, onDelete, onEdit, hideCustomerColumn, getInflowsForInvoice } = options;
    const showActionsColumn = canEdit || canDelete;

    const columns: ColumnDef<ProjectInvoice>[] = [
        {
            accessorKey: "invoice_no",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice No." />,
            cell: ({ row }) => (
                <Link to={SITEURL + row.original.attachment || '#'} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    {row.original.invoice_no || row.original.name}
                </Link>
            ),
            meta: { exportHeaderName: "Invoice No", exportValue: (row: ProjectInvoice) => row.invoice_no }
        },
        {
            accessorKey: "project",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => {
                const projectName = getProjectName(row.original.project);
                return (
                    <Link to={`/projects/${row.original.project}`} className="text-blue-600 hover:underline">
                        {projectName}
                    </Link>
                );
            },
            filterFn: facetedFilterFn,
            meta: {
                exportHeaderName: "Project",
                exportValue: (row: ProjectInvoice) => getProjectName(row.project),
                enableFacet: true,
                facetTitle: "Project"
            }
        },
        // Conditionally include customer column
        ...(!hideCustomerColumn
            ? [
                {
                    accessorKey: "customer",
                    header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
                    cell: ({ row }) => {
                        const customerName = getCustomerName(row.original.customer);
                        return (
                            <Link to={`/customers/${row.original.customer}`} className="text-blue-600 hover:underline">
                                {customerName || row.original.customer}
                            </Link>
                        );
                    },
                    filterFn: facetedFilterFn,
                    meta: {
                        exportHeaderName: "Customer",
                        exportValue: (row: ProjectInvoice) => getCustomerName(row.customer),
                        enableFacet: true,
                        facetTitle: "Customer",
                    },
                } as ColumnDef<ProjectInvoice>,
            ]
            : []),
        {
            accessorKey: "project_gst",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Project GST" />,
            cell: ({ row }) => {
                const gstName = getGstName(row.original.project_gst);
                return <div>{gstName || '--'}</div>;
            },
            filterFn: facetedFilterFn,
            meta: {
                exportHeaderName: "Project GST",
                exportValue: (row: ProjectInvoice) => getGstName(row.project_gst) || '--',
                enableFacet: true,
                facetTitle: "Project GST"
            }
        },
        {
            accessorKey: "amount",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Amount(Incl. GST)" />,
            cell: ({ row }) => <div className="tabular-nums">{formatToIndianRupee(row.original.amount)}</div>,
            meta: { exportHeaderName: "Amount", exportValue: (row: ProjectInvoice) => row.amount, isNumeric: true }
        },
        // Reverse-direction "Inflows" column — shows how many inflow payments
        // the customer has made against this invoice (one invoice can be paid
        // in multiple chunks). Compact count-pill + HoverCard reveals each
        // inflow as a clickable link to its payment proof attachment.
        {
            id: "inflows",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Inflows" />
            ),
            cell: ({ row }) => {
                const list = getInflowsForInvoice?.(row.original.name) ?? [];
                if (list.length === 0) {
                    return <span className="text-muted-foreground text-xs">--</span>;
                }
                const label = `${list.length} ${list.length === 1 ? "inflow" : "inflows"}`;
                return (
                    <HoverCard openDelay={100} closeDelay={150}>
                        <HoverCardTrigger asChild>
                            <span
                                className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-pointer hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 whitespace-nowrap"
                                title={`${list.length} inflow${list.length === 1 ? "" : "s"} against this invoice`}
                            >
                                {label}
                            </span>
                        </HoverCardTrigger>
                        <HoverCardContent
                            className="w-auto max-w-sm p-2"
                            side="bottom"
                            align="start"
                        >
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                                Inflows against this invoice
                            </p>
                            <ul className="space-y-0.5">
                                {list.map((inf) => {
                                    const display = inf.utr || inf.name;
                                    const amountText = typeof inf.amount === "number"
                                        ? ` — ${formatToIndianRupee(inf.amount)}`
                                        : "";
                                    return (
                                        <li key={inf.name}>
                                            {inf.inflow_attachment ? (
                                                <a
                                                    href={SITEURL + inf.inflow_attachment}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="block text-xs text-blue-600 hover:underline px-1 py-0.5 rounded hover:bg-blue-50"
                                                >
                                                    {display}{amountText}
                                                </a>
                                            ) : (
                                                <span
                                                    className="block text-xs text-muted-foreground px-1 py-0.5"
                                                    title="No payment proof attached"
                                                >
                                                    {display}{amountText}
                                                </span>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </HoverCardContent>
                    </HoverCard>
                );
            },
            enableSorting: false,
            size: 140,
            meta: {
                exportHeaderName: "Inflows",
                exportValue: (row: ProjectInvoice) =>
                    (getInflowsForInvoice?.(row.name) ?? [])
                        .map(inf => inf.utr || inf.name)
                        .join("; ") || "--",
            },
        },
        {
            accessorKey: "invoice_date",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Date" />,
            cell: ({ row }) => <div>{formatDate(row.original.invoice_date)}</div>,
            filterFn: dateFilterFn,
            meta: { exportHeaderName: "Date", exportValue: (row: ProjectInvoice) => formatDate(row.invoice_date) },
        },
        {
            accessorKey: "owner",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" />,
            cell: ({ row }) => <div>{getUserName(row.original.owner)}</div>,
            filterFn: facetedFilterFn,
            meta: {
                exportHeaderName: "Created By",
                exportValue: (row: ProjectInvoice) => getUserName(row.owner),
                enableFacet: true,
                facetTitle: "Created By"
            }
        },

        // Actions column appears when the user has at least one allowed action.
        // Edit shows for Admin + Accountant; Delete shows for Admin only.
        ...(showActionsColumn
            ? [
                {
                    id: "actions",
                    header: ({ column }) => <DataTableColumnHeader column={column} title="Actions" />,
                    cell: ({ row }) => {
                        const invoice = row.original;
                        return (
                            <div className="flex items-center space-x-1">
                                {canEdit && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 p-0"
                                        onClick={() => onEdit(invoice)}
                                        aria-label={`Edit invoice ${invoice.invoice_no}`}
                                    >
                                        <Edit2 className="h-4 w-4 text-blue-600" />
                                    </Button>
                                )}
                                {canDelete && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 p-0"
                                        onClick={() => onDelete(invoice)}
                                        aria-label={`Delete invoice ${invoice.invoice_no}`}
                                    >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                )}
                            </div>
                        );
                    },
                    size: 80,
                    enableSorting: false,
                    enableHiding: false,
                } as ColumnDef<ProjectInvoice>,
            ]
            : [])
    ];

    return columns;
};