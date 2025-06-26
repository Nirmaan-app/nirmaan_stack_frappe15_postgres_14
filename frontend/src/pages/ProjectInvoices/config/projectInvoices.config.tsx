import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Trash2, Edit2 } from "lucide-react";
import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import SITEURL from "@/constants/siteURL";

// =================================================================================
// 1. STATIC CONFIGURATION
// =================================================================================
export const DOCTYPE = "Project Invoices";

export const PROJECT_INVOICE_FIELDS_TO_FETCH = [
    "name", "invoice_no", "amount", "attachment", "creation", "owner", "project", "modified_by", "invoice_date", "customer"
];

export const PROJECT_INVOICE_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "invoice_no", label: "Invoice No", placeholder: "Search by Invoice Number...", default: true },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
    { value: "owner", label: "Created By", placeholder: "Search by creator's email..." },
];

export const PROJECT_INVOICE_DATE_COLUMNS = ["invoice_date"];

// =================================================================================
// 2. TYPES & INTERFACES FOR COLUMN GENERATION
// =================================================================================
type ProjectNameResolver = (projectId?: string) => string;
type CustomerNameResolver = (customerId?: string) => string;

interface ColumnGeneratorOptions {
    isAdmin: boolean;
    getProjectName: ProjectNameResolver;
    getCustomerName: CustomerNameResolver;
    onDelete: (invoice: ProjectInvoice) => void;
    onEdit: (invoice: ProjectInvoice) => void; // --- (Indicator) NEW: onEdit callback ---
}

// =================================================================================
// 3. DYNAMIC COLUMN GENERATOR FUNCTION
// =================================================================================
export const getProjectInvoiceColumns = (
    options: ColumnGeneratorOptions
): ColumnDef<ProjectInvoice>[] => {

    const { isAdmin, getProjectName, getCustomerName, onDelete, onEdit } = options; // Destructure onEdit

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
                exportValue: (row: ProjectInvoice) => getProjectName(row.project)
            }
        },
        {
            accessorKey: "customer",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
            cell: ({ row }) => {
                const customerName = getCustomerName(row.original.customer)
                return (
                    <Link to={`/customers/${row.original.customer}`} className="text-blue-600 hover:underline">
                        {customerName || row.original.customer}
                    </Link>
                );
            },
            filterFn: facetedFilterFn,
            meta: {
                exportHeaderName: "Customer",
                exportValue: (row: ProjectInvoice) => getCustomerName(row.customer)
            }
        },
        {
            accessorKey: "amount",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Amount(Incl. GST)" />,
            cell: ({ row }) => <div className="tabular-nums">{formatToIndianRupee(row.original.amount)}</div>,
            meta: { exportHeaderName: "Amount", exportValue: (row: ProjectInvoice) => row.amount, isNumeric: true }
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
            cell: ({ row }) => <div>{row.original.owner}</div>,
            meta: { exportHeaderName: "Created By", exportValue: (row: ProjectInvoice) => row.owner }
        },

        // --- CORRECTED INLINE SYNTAX ---
        // The ternary operator now correctly returns either an array with one object
        // or an empty array. The spread syntax `...` then safely unpacks it.
        ...(isAdmin
            ? [
                {
                    id: "actions",
                    header: ({ column }) => <DataTableColumnHeader column={column} title="Actions" />,
                    cell: ({ row }) => {
                        const invoice = row.original;
                        return (
                            <div className="flex items-center space-x-1"> {/* Use justify-end */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 p-0"
                                    onClick={() => onEdit(invoice)} // Call onEdit
                                    aria-label={`Edit invoice ${invoice.invoice_no}`}
                                >
                                    <Edit2 className="h-4 w-4 text-blue-600" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 p-0"
                                    onClick={() => onDelete(invoice)}
                                    aria-label={`Delete invoice ${invoice.invoice_no}`}
                                >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        );
                    },
                    size: 80,
                    enableSorting: false,
                    enableHiding: false,
                } as ColumnDef<ProjectInvoice>, // Type assertion is on the object inside the array
            ]
            : [])
    ];

    return columns;
};