// src/pages/non-project-expenses/NonProjectExpensesPage.tsx

import React, { useMemo, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Download, Edit2, FileText, PlusCircle, MoreHorizontal } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table'; // Assuming DataTable is correctly imported
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/skeleton"; // Assuming this exists
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert"; // Assuming this exists
import SITEURL from "@/constants/siteURL";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable'; // Your hook
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useDialogStore } from "@/zustand/useDialogStore";

// --- Types ---
import { NonProjectExpenses as NonProjectExpensesType } from "@/types/NirmaanStack/NonProjectExpenses";

// --- Config ---
import {
    DEFAULT_NPE_FIELDS_TO_FETCH,
    NPE_SEARCHABLE_FIELDS,
    NPE_DATE_COLUMNS,
} from './config/nonProjectExpensesTable.config';

// --- Child Components ---
import { NewNonProjectExpense } from "./components/NewNonProjectExpense";
import { UpdatePaymentDetailsDialog } from "./components/UpdatePaymentDetailsDialog";
import { UpdateInvoiceDetailsDialog } from "./components/UpdateInvoiceDetailsDialog";

const DOCTYPE = 'Non Project Expenses';

interface NonProjectExpensesPageProps {
    urlContext?: string;
}

export const NonProjectExpensesPage: React.FC<NonProjectExpensesPageProps> = ({ urlContext = "npe_default" }) => {
    const { toggleNewNonProjectExpenseDialog } = useDialogStore();
    const urlSyncKey = useMemo(() => `npe_${urlContext}`, [urlContext]);

    // State for update dialogs (define these first as handlers depend on them)
    const [isPaymentUpdateDialogOpen, setIsPaymentUpdateDialogOpen] = useState(false);
    const [isInvoiceUpdateDialogOpen, setIsInvoiceUpdateDialogOpen] = useState(false);
    const [selectedExpenseForUpdate, setSelectedExpenseForUpdate] = useState<NonProjectExpensesType | null>(null);

    // Define handlers (these are dependencies for `columnsDefinition`)
    const handleOpenPaymentUpdateDialog = useCallback((expense: NonProjectExpensesType) => {
        setSelectedExpenseForUpdate(expense);
        setIsPaymentUpdateDialogOpen(true);
    }, []);

    const handleOpenInvoiceUpdateDialog = useCallback((expense: NonProjectExpensesType) => {
        setSelectedExpenseForUpdate(expense);
        setIsInvoiceUpdateDialogOpen(true);
    }, []);

    // Now define columns, using the handlers
    // This `columnsDefinition` will be passed to both useServerDataTable and DataTable
    const columnsDefinition = useMemo<ColumnDef<NonProjectExpensesType>[]>(() => [
        {
            accessorKey: "payment_date",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Date" />,
            cell: ({ row }) => <div className="font-medium ">{row.original.payment_date ? formatDate(row.original.payment_date) : '--'}</div>,
            size: 100,
            meta: { exportHeaderName: "Payment Date", exportValue: (row) => row.payment_date ? formatDate(row.payment_date) : '--' }
        },
        {
            accessorKey: "invoice_date",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Date" />,
            cell: ({ row }) => <div className="font-medium ">{row.original.invoice_date ? formatDate(row.original.invoice_date) : '--'}</div>,
            size: 100,
            meta: { exportHeaderName: "Invoice Date", exportValue: (row) => row.invoice_date ? formatDate(row.invoice_date) : '--' }
        },
        {
            accessorKey: "type",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Expense Type" />,
            cell: ({ row }) => <div className="font-medium " title={row.original.type}>{row.original.type}</div>,
            size: 100,
            meta: { exportHeaderName: "Expense Type", exportValue: (row) => row.type }
        },
        {
            accessorKey: "description",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
            cell: ({ row }) => <div className="font-medium " title={row.original.description}>{row.original.description || '--'}</div>,
            size: 140,
            meta: { exportHeaderName: "Description", exportValue: (row) => row.description || '--' }
        },
        {
            accessorKey: "amount",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" className="justify-end" />,
            cell: ({ row }) => <div className="font-medium ">{formatToRoundedIndianRupee(row.original.amount)}</div>,
            size: 100,
            meta: { exportHeaderName: "Amount", exportValue: (row) => formatToRoundedIndianRupee(row.amount) }
        },
        {
            accessorKey: "payment_ref",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Ref" />,
            cell: ({ row }) => <div className="font-medium">{row.original.payment_ref || '--'}</div>,
            size: 100,
            meta: { exportHeaderName: "Payment Ref", exportValue: (row) => row.payment_ref || '--' }
        },
        {
            accessorKey: "invoice_ref",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Ref" />,
            cell: ({ row }) => <div className="font-medium">{row.original.invoice_ref || '--'}</div>,
            size: 100,
            meta: { exportHeaderName: "Invoice Ref", exportValue: (row) => row.invoice_ref || '--' }
        },
        {
            id: "attachments",
            header: "Attachments",
            cell: ({ row }) => {
                const data = row.original;
                console.log("data", SITEURL + data.payment_attachment);
                return (
                    <div className="flex items-center space-x-2">
                        {row.original.payment_attachment && (
                            <a href={SITEURL + data.payment_attachment} target="_blank" rel="noreferrer" title="Payment Proof">
                                <Download className="h-4 w-4 text-blue-600 hover:text-blue-800" />
                            </a>
                        )}
                        {row.original.invoice_attachment && (
                            <a href={SITEURL + data.invoice_attachment} target="_blank" rel="noreferrer" title="Invoice Document">
                                <FileText className="h-4 w-4 text-green-600 hover:text-green-800" />
                            </a>
                        )}
                        {!row.original.payment_attachment && !row.original.invoice_attachment && (
                            <span className="text-xs text-muted-foreground">None</span>
                        )}
                    </div>
                )
            },
            size: 100,
            enableSorting: false,
            meta: { excludeFromExport: true }
        },
        {
            id: "actions",
            header: () => <div>Actions</div>,
            cell: ({ row }) => {
                const expense = row.original;
                return (
                    <div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleOpenPaymentUpdateDialog(expense)}>
                                    <Edit2 className="mr-2 h-4 w-4" /> Update Payment
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleOpenInvoiceUpdateDialog(expense)}>
                                    <FileText className="mr-2 h-4 w-4" /> Update Invoice
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                );
            },
            size: 80,
            meta: { excludeFromExport: true }
        },
    ], [handleOpenPaymentUpdateDialog, handleOpenInvoiceUpdateDialog]); // Correct dependencies

    // Now call useServerDataTable, passing the defined columns
    const {
        table, data, totalCount, isLoading, error,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        refetch,
    } = useServerDataTable<NonProjectExpensesType>({
        doctype: DOCTYPE,
        columns: columnsDefinition, // *** PASS THE DEFINED COLUMNS HERE ***
        fetchFields: DEFAULT_NPE_FIELDS_TO_FETCH,
        searchableFields: NPE_SEARCHABLE_FIELDS,
        urlSyncKey: urlSyncKey,
        defaultSort: 'payment_date desc',
        enableRowSelection: false, // Or true if actions on rows are needed
    });


    if (error && !data?.length) {
        return <AlertDestructive error={error} className="m-4" />;
    }

    return (
        <div className="flex-1 space-y-4">
            <DataTable<NonProjectExpensesType>
                table={table} // This table instance is now created with columns
                columns={columnsDefinition} // Pass the same columns definition for export/etc.
                isLoading={isLoading}
                error={error}
                totalCount={totalCount}
                searchFieldOptions={NPE_SEARCHABLE_FIELDS} // Make sure this is an array of SearchFieldOption
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                // facetFilterOptions={facetFilterOptions} // Define if needed
                dateFilterColumns={NPE_DATE_COLUMNS}
                showExportButton={true}
                onExport={'default'}
                exportFileName={`Non_Project_Expenses_${urlContext}`}
            // errorMessage="Could not load expenses. Please try again." // Already handled by main error display
            />
            <NewNonProjectExpense refetchList={refetch} />

            {selectedExpenseForUpdate && (
                <>
                    <UpdatePaymentDetailsDialog
                        isOpen={isPaymentUpdateDialogOpen}
                        setIsOpen={setIsPaymentUpdateDialogOpen}
                        expense={selectedExpenseForUpdate}
                        onSuccess={refetch}
                    />
                    <UpdateInvoiceDetailsDialog
                        isOpen={isInvoiceUpdateDialogOpen}
                        setIsOpen={setIsInvoiceUpdateDialogOpen}
                        expense={selectedExpenseForUpdate}
                        onSuccess={refetch}
                    />
                </>
            )}
        </div>
    );
};

export default NonProjectExpensesPage;