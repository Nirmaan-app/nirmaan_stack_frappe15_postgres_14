// src/pages/non-project-expenses/NonProjectExpensesPage.tsx

import React, { useMemo, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Download, Edit2, FileText, PlusCircle, MoreHorizontal, Trash2, DollarSign } from "lucide-react";
import { TailSpin } from 'react-loader-spinner'; // Assuming this is your spinner
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

import { useFrappeDeleteDoc, useFrappeGetDocList } from "frappe-react-sdk"; // For delete
import { useToast } from "@/components/ui/use-toast"; // For delete feedback

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table'; // Assuming DataTable is correctly imported
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/skeleton"; // Assuming this exists
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert"; // Assuming this exists
import SITEURL from "@/constants/siteURL";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog"; // For delete confirmation

// --- Hooks & Utils ---
import { useServerDataTable, AggregationConfig } from '@/hooks/useServerDataTable'; // Your hook
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useDialogStore } from "@/zustand/useDialogStore";

// --- Types ---
import { NonProjectExpenses as NonProjectExpensesType } from "@/types/NirmaanStack/NonProjectExpenses";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType"; // Import the type

// --- Config ---
import {
    DEFAULT_NPE_FIELDS_TO_FETCH,
    NPE_SEARCHABLE_FIELDS,
    NPE_DATE_COLUMNS,
} from './config/nonProjectExpensesTable.config';

// --- Child Components ---
import { NewNonProjectExpense } from "./components/NewNonProjectExpense";
import { EditNonProjectExpense } from "./components/EditNonProjectExpense"; // NEW
import { UpdatePaymentDetailsDialog } from "./components/UpdatePaymentDetailsDialog";
import { UpdateInvoiceDetailsDialog } from "./components/UpdateInvoiceDetailsDialog";
import { useUserData } from "@/hooks/useUserData";

const DOCTYPE = 'Non Project Expenses';

// NEW: Configuration for the summary card aggregations
const NPE_AGGREGATES_CONFIG: AggregationConfig[] = [
    { field: 'amount', function: 'sum' }
];

// NEW: Helper component to display active filters in the summary card
const AppliedFiltersDisplay = ({ filters, search }) => {
    const hasFilters = filters.length > 0 || !!search;
    if (!hasFilters) {
        return <p className="text-sm text-gray-500">Overview of all non-project expenses.</p>;
    }
    return (
        <div className="text-sm text-gray-500 flex flex-wrap gap-2 items-center mt-2">
            <span className="font-medium">Filtered by:</span>
            {search && <span className="px-2 py-1 bg-gray-200 rounded-md text-xs">{`Search: "${search}"`}</span>}
            {filters.map(filter => (
                <span key={filter.id} className="px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs capitalize whitespace-nowrap">
                    {filter.id.replace(/_/g, ' ')}
                </span>
            ))}
        </div>
    );
};

interface NonProjectExpensesPageProps {
    urlContext?: string;
}

export const NonProjectExpensesPage: React.FC<NonProjectExpensesPageProps> = ({ urlContext = "npe_default" }) => {
    const {
        toggleNewNonProjectExpenseDialog,
        setEditNonProjectExpenseDialog, // NEW
        deleteConfirmationDialog,       // NEW
        setDeleteConfirmationDialog     // NEW
    } = useDialogStore();
    const { toast } = useToast();
    const { role } = useUserData();
    const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc(); // For delete operation

    const urlSyncKey = useMemo(() => `npe_${urlContext}`, [urlContext]);
    // --- (2) NEW: Fetch data for the Expense Type filter ---
    const { data: expenseTypes, isLoading: expenseTypesLoading } = useFrappeGetDocList<ExpenseType>(
        'Expense Type',
        {
            fields: ['name', 'expense_name'], // Fetch name for value, expense_name for label
            filters: [["non_project", "=", "1"]], // Assuming non project filter is needed
            limit: 0 // Fetch all records
        }
    );

    // State for update dialogs (define these first as handlers depend on them)
    const [isPaymentUpdateDialogOpen, setIsPaymentUpdateDialogOpen] = useState(false);
    const [isInvoiceUpdateDialogOpen, setIsInvoiceUpdateDialogOpen] = useState(false);
    const [selectedExpenseForUpdate, setSelectedExpenseForUpdate] = useState<NonProjectExpensesType | null>(null);
    const [selectedExpenseForEdit, setSelectedExpenseForEdit] = useState<NonProjectExpensesType | null>(null); // NEW
    const [expenseToDelete, setExpenseToDelete] = useState<NonProjectExpensesType | null>(null); // NEW for delete context

    // Define handlers (these are dependencies for `columnsDefinition`)
    const handleOpenPaymentUpdateDialog = useCallback((expense: NonProjectExpensesType) => {
        setSelectedExpenseForUpdate(expense);
        setIsPaymentUpdateDialogOpen(true);
    }, []);

    const handleOpenInvoiceUpdateDialog = useCallback((expense: NonProjectExpensesType) => {
        setSelectedExpenseForUpdate(expense);
        setIsInvoiceUpdateDialogOpen(true);
    }, []);

    const handleOpenEditDialog = useCallback((expense: NonProjectExpensesType) => { // NEW
        setSelectedExpenseForEdit(expense);
        setEditNonProjectExpenseDialog(true);
    }, [setEditNonProjectExpenseDialog]);

    const handleOpenDeleteConfirmation = useCallback((expense: NonProjectExpensesType) => { // NEW
        setExpenseToDelete(expense);
        setDeleteConfirmationDialog(true);
    }, [setDeleteConfirmationDialog]);

    const confirmDeleteExpense = async () => { // NEW
        if (!expenseToDelete) return;
        try {
            await deleteDoc(DOCTYPE, expenseToDelete.name);
            toast({ title: "Success", description: `Expense "${expenseToDelete.name}" deleted successfully.`, variant: "success" });
            refetch(); // Refetch table data
        } catch (error: any) {
            toast({ title: "Error", description: error.message || "Failed to delete expense.", variant: "destructive" });
        } finally {
            setExpenseToDelete(null);
            setDeleteConfirmationDialog(false);
        }
    };

    // --- (3) NEW: Prepare options for the faceted filter ---
    const expenseTypeOptions = useMemo(() =>
        expenseTypes?.map(et => ({
            label: et.expense_name || et.name, // Use the display name, fallback to the raw name
            value: et.name,                    // The value must be the raw name used in the main data
        })) || [],
        [expenseTypes]
    );

    // --- (4) NEW: Define the facet filter configuration object ---
    const facetFilterOptions = useMemo(() => ({
        type: { // This key 'type' MUST match the column's accessorKey
            title: "Expense Type",
            options: expenseTypeOptions,
        },
    }), [expenseTypeOptions]);

    // Now define columns, using the handlers
    // This `columnsDefinition` will be passed to both useServerDataTable and DataTable
    const columnsDefinition = useMemo<ColumnDef<NonProjectExpensesType>[]>(() => [
        {
            accessorKey: "payment_date",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Date" />,
            cell: ({ row }) => <div className="font-medium ">{row.original.payment_date ? formatDate(row.original.payment_date) : '--'}</div>,

            meta: { exportHeaderName: "Payment Date", exportValue: (row) => row.payment_date ? formatDate(row.payment_date) : '--' }
        },
        {
            accessorKey: "invoice_date",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Date" />,
            cell: ({ row }) => <div className="font-medium ">{row.original.invoice_date ? formatDate(row.original.invoice_date) : '--'}</div>,

            meta: { exportHeaderName: "Invoice Date", exportValue: (row) => row.invoice_date ? formatDate(row.invoice_date) : '--' }
        },
        {
            accessorKey: "type",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Expense Type" />,
            cell: ({ row }) => <div className="font-medium " title={row.original.type}>{row.original.type}</div>,
            enableColumnFilter: true, // UPDATED: Explicitly enable filtering for clarity
            meta: { exportHeaderName: "Expense Type", exportValue: (row) => row.type }
        },
        {
            accessorKey: "description",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
            cell: ({ row }) => <div className="font-medium " title={row.original.description}>{row.original.description || '--'}</div>,

            meta: { exportHeaderName: "Description", exportValue: (row) => row.description || '--' }
        },
        {
            accessorKey: "comment",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Comment" />,
            cell: ({ row }) => <div className="font-medium " title={row.original.comment}>{row.original.comment || '--'}</div>,

            meta: { exportHeaderName: "Comment", exportValue: (row) => row.comment || '--' }
        },
        {
            accessorKey: "amount",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" className="justify-end" />,
            cell: ({ row }) => <div className="font-medium ">{formatToRoundedIndianRupee(row.original.amount)}</div>,

            meta: { exportHeaderName: "Amount", exportValue: (row) => formatForReport(row.amount) }
        },
        {
            accessorKey: "payment_ref",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Ref" />,
            cell: ({ row }) => <div className="font-medium">{row.original.payment_ref || '--'}</div>,

            meta: { exportHeaderName: "Payment Ref", exportValue: (row) => row.payment_ref || '--' }
        },
        {
            accessorKey: "invoice_ref",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Ref" />,
            cell: ({ row }) => <div className="font-medium">{row.original.invoice_ref || '--'}</div>,

            meta: { exportHeaderName: "Invoice Ref", exportValue: (row) => row.invoice_ref || '--' }
        },
        {
            id: "attachments",
            header: "Attachments",
            cell: ({ row }) => {
                const data = row.original;
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

            enableSorting: false,
            meta: { excludeFromExport: true }
        },
        {
            id: "actions",
            header: () => <div>Actions</div>,
            cell: ({ row }) => {
                const expense = row.original;
                return (
                    <div> {/* Ensure parent div is also text-right */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {role === "Nirmaan Admin Profile" && <DropdownMenuItem onClick={() => handleOpenEditDialog(expense)}>
                                    <Edit2 className="mr-2 h-4 w-4" /> Edit Expense
                                </DropdownMenuItem>}
                                <DropdownMenuItem onClick={() => handleOpenPaymentUpdateDialog(expense)}>
                                    <DollarSign className="mr-2 h-4 w-4" /> Update Payment
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleOpenInvoiceUpdateDialog(expense)}>
                                    <FileText className="mr-2 h-4 w-4" /> Update Invoice
                                </DropdownMenuItem>
                                {role === "Nirmaan Admin Profile" &&
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => handleOpenDeleteConfirmation(expense)}
                                            className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                        >
                                            <Trash2 className="mr-2 h-4 w-4" /> Delete Expense
                                        </DropdownMenuItem>
                                    </>
                                }
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                );
            },
            meta: { excludeFromExport: true }
        },
    ], [handleOpenPaymentUpdateDialog, handleOpenInvoiceUpdateDialog, handleOpenEditDialog, handleOpenDeleteConfirmation]);

    // Now call useServerDataTable, passing the defined columns
    const {
        table, data, totalCount, isLoading, error,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        refetch,
        aggregates, // NEW
        isAggregatesLoading, // NEW
        columnFilters // NEW: To display applied filters
    } = useServerDataTable<NonProjectExpensesType>({
        doctype: DOCTYPE,
        columns: columnsDefinition, // *** PASS THE DEFINED COLUMNS HERE ***
        fetchFields: DEFAULT_NPE_FIELDS_TO_FETCH,
        searchableFields: NPE_SEARCHABLE_FIELDS,
        urlSyncKey: urlSyncKey,
        defaultSort: 'payment_date desc',
        enableRowSelection: false, // Or true if actions on rows are needed
        aggregatesConfig: NPE_AGGREGATES_CONFIG, // NEW: Pass the config
    });


    if (error && !data?.length) {
        return <AlertDestructive error={error} className="m-4" />;
    }

    return (
        <div className="flex-1 space-y-4">
            <DataTable<NonProjectExpensesType>
                table={table} // This table instance is now created with columns
                columns={columnsDefinition} // Pass the same columns definition for export/etc.
                isLoading={isLoading || expenseTypesLoading}
                error={error}
                totalCount={totalCount}
                searchFieldOptions={NPE_SEARCHABLE_FIELDS} // Make sure this is an array of SearchFieldOption
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                // facetFilterOptions={facetFilterOptions} // Define if needed
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={NPE_DATE_COLUMNS}
                showExportButton={true}
                onExport={'default'}
                exportFileName={`Non_Project_Expenses_${urlContext}`}
                // NEW: Pass the fully constructed summary card as a prop
                summaryCard={
                    <Card>
                        <CardHeader className="p-4">
                            <CardTitle className="text-lg">Non Project Expenses Summary</CardTitle>
                            <CardDescription>
                                <AppliedFiltersDisplay filters={columnFilters} search={searchTerm} />
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-4 pt-0">
                            {isAggregatesLoading ? (
                                <div className="flex justify-center items-center h-16">
                                    <TailSpin height={24} width={24} color="#4f46e5" />
                                </div>
                            ) : aggregates ? (
                                <dl className="flex flex-col sm:flex-row sm:justify-between space-y-2 sm:space-y-0 sm:space-x-4">
                                    <div className="justify-center sm:block">
                                        <dt className="font-semibold text-gray-600">Total Amount</dt>
                                        <dd className="sm:text-right font-bold text-lg text-blue-600">
                                            {formatToRoundedIndianRupee(aggregates.sum_of_amount || 0)}
                                        </dd>
                                    </div>
                                    <div className="justify-center sm:block">
                                        <dt className="font-semibold text-gray-600">Total Entries</dt>
                                        <dd className="sm:text-right font-bold text-lg text-blue-600">
                                            {totalCount}
                                        </dd>
                                    </div>
                                </dl>
                            ) : (
                                <p className="text-sm text-center text-muted-foreground h-16 flex items-center justify-center">
                                    No summary data available.
                                </p>
                            )}
                        </CardContent>
                    </Card>
                }
            // errorMessage="Could not load expenses. Please try again." // Already handled by main error display
            />
            <NewNonProjectExpense refetchList={refetch} />

            {selectedExpenseForEdit && ( // NEW: Render Edit Dialog
                <EditNonProjectExpense
                    expenseToEdit={selectedExpenseForEdit}
                    onSuccess={() => {
                        refetch();
                        setEditNonProjectExpenseDialog(false); // Close dialog on success
                    }}
                />
            )}

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
            {/* NEW: Delete Confirmation Dialog */}
            {expenseToDelete && (
                <AlertDialog open={deleteConfirmationDialog} onOpenChange={setDeleteConfirmationDialog}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete the expense
                                <span className="font-semibold mx-1">{expenseToDelete.description || expenseToDelete.name}</span>.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setExpenseToDelete(null)}>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={confirmDeleteExpense}
                                disabled={deleteLoading}
                                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                            >
                                {deleteLoading ? "Deleting..." : "Yes, delete expense"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </div>
    );
};

export default NonProjectExpensesPage;