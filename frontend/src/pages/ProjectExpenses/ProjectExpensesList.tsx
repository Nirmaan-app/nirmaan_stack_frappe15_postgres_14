// src/pages/ProjectExpenses/ProjectExpensesList.tsx

import React, { useMemo, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeDeleteDoc, useFrappeGetDocList, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useUserData } from "@/hooks/useUserData";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import memoize from 'lodash/memoize';

// Types
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType";

// Config & Dialogs
import { DEFAULT_PE_FIELDS_TO_FETCH, PE_SEARCHABLE_FIELDS, PE_DATE_COLUMNS, DOCTYPE } from './config/projectExpensesTable.config';
import { NewProjectExpenseDialog } from "./components/NewProjectExpenseDialog";
import { EditProjectExpenseDialog } from "./components/EditProjectExpenseDialog";

// UI Components
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Edit2, MoreHorizontal, PlusCircle, Trash2 } from "lucide-react";
import { TableSkeleton } from "@/components/ui/skeleton";

interface ProjectExpensesListProps {
    projectId?: string; // Optional: To filter by a specific project
}

export const ProjectExpensesList: React.FC<ProjectExpensesListProps> = ({ projectId }) => {
    const { toggleNewProjectExpenseDialog, setEditProjectExpenseDialog } = useDialogStore();
    const { toast } = useToast();
    const { role } = useUserData();
    const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc();

    const [expenseToEdit, setExpenseToEdit] = useState<ProjectExpenses | null>(null);
    const [expenseToDelete, setExpenseToDelete] = useState<ProjectExpenses | null>(null);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    // --- Supporting Data for Lookups ---
    const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>("Projects", { fields: ["name", "project_name"], limit: 0 });
    const { data: vendors, isLoading: vendorsLoading } = useFrappeGetDocList<Vendors>("Vendors", { fields: ["name", "vendor_name"], limit: 0 });
    const { data: users, isLoading: usersLoading } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", { fields: ["name", "full_name"], limit: 0 });
    const { data: expenseTypes, isLoading: expenseTypesLoading } = useFrappeGetDocList<ExpenseType>("Expense Type", { fields: ["name", "expense_name"], limit: 0 });

    const getProjectName = useCallback(memoize((id?: string) => projects?.find(p => p.name === id)?.project_name || id || '--'), [projects]);
    const getVendorName = useCallback(memoize((id?: string) => vendors?.find(v => v.name === id)?.vendor_name || id || 'Others'), [vendors]);
    const getUserName = useCallback(memoize((id?: string) => users?.find(u => u.name === id)?.full_name || id || '--'), [users]);
    const getExpenseTypeName = useCallback(memoize((id?: string) => expenseTypes?.find(et => et.name === id)?.expense_name || id || '--'), [expenseTypes]);

    // --- Handlers for Actions ---
    const handleOpenEditDialog = useCallback((expense: ProjectExpenses) => { setExpenseToEdit(expense); setEditProjectExpenseDialog(true); }, [setEditProjectExpenseDialog]);
    const handleOpenDeleteDialog = useCallback((expense: ProjectExpenses) => { setExpenseToDelete(expense); setIsDeleteDialogOpen(true); }, []);

    const confirmDelete = async () => {
        if (!expenseToDelete) return;
        try {
            await deleteDoc(DOCTYPE, expenseToDelete.name);
            toast({ title: "Success", description: `Expense deleted successfully.`, variant: "success" });
            refetch();
        } catch (error: any) {
            toast({ title: "Error", description: error.message || "Failed to delete expense.", variant: "destructive" });
        } finally {
            setIsDeleteDialogOpen(false);
            setExpenseToDelete(null);
        }
    };

    const columns = useMemo<ColumnDef<ProjectExpenses>[]>(() => [
        // --- (Indicator) MODIFIED: Project column is now conditional ---
        ...(!projectId ? [{
            accessorKey: "projects",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => <Link to={`/projects/${row.original.projects}`} className="text-blue-600 hover:underline">{getProjectName(row.original.projects)}</Link>,
            enableColumnFilter: true,
        } as ColumnDef<ProjectExpenses>] : []),
        { accessorKey: "payment_date", header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Date" />, cell: ({ row }) => <div className="font-medium">{formatDate(row.original.payment_date)}</div> },
        { accessorKey: "type", header: "Expense Type", cell: ({ row }) => <div className="truncate" title={row.original.expense_type_name || row.original.type}>{row.original.expense_type_name || row.original.type}</div>, meta: { exportValue: (row) => row.expense_type_name || row.type } },
        { accessorKey: "description", header: "Description", cell: ({ row }) => <div className="truncate max-w-xs" title={row.original.description}>{row.original.description}</div> },
        { accessorKey: "comment", header: "Comment", cell: ({ row }) => <div className="truncate max-w-xs" title={row.original.comment}>{row.original.comment}</div> },
        { accessorKey: "vendor", header: "Vendor", cell: ({ row }) => <div className="truncate" title={getVendorName(row.original.vendor)}>{getVendorName(row.original.vendor)}</div>, meta: { exportValue: (row) => getVendorName(row.vendor) } },
        { accessorKey: "amount", header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" className="justify-center" />, cell: ({ row }) => <div className="font-medium pr-2">{formatToRoundedIndianRupee(row.original.amount)}</div>, meta: { exportValue: (row) => formatForReport(row.amount) } },
        { accessorKey: "payment_by", header: "Requested By", cell: ({ row }) => <div className="truncate" title={getUserName(row.original.payment_by)}>{getUserName(row.original.payment_by)}</div>, meta: { exportValue: (row) => getUserName(row.payment_by) } },

        {
            id: "actions",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Actions" className="text-center" />,
            cell: ({ row }) => (
                <div className="">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleOpenEditDialog(row.original)}><Edit2 className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                            {role === "Nirmaan Admin Profile" &&
                                <DropdownMenuItem onClick={() => handleOpenDeleteDialog(row.original)} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            ),
            meta: {
                excludeFromExport: true, // Exclude actions column from export
            }
        }
    ], [projectId, getProjectName, getVendorName, getUserName, getExpenseTypeName, handleOpenEditDialog, handleOpenDeleteDialog]);

    // --- Data Table Hook ---
    const { table, data, totalCount, isLoading, error, refetch, ...rest } = useServerDataTable<ProjectExpenses>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: [...DEFAULT_PE_FIELDS_TO_FETCH, "type.expense_name as expense_type_name"], // Ensure display name is fetched
        searchableFields: PE_SEARCHABLE_FIELDS,
        urlSyncKey: `project_expenses_list_${projectId || 'all'}`,
        // --- (Indicator) Static filter is now conditional ---
        additionalFilters: projectId ? [["projects", "=", projectId]] : []
    });

    const isLoadingLookups = vendorsLoading || usersLoading || expenseTypesLoading || (!projectId && projectsLoading);
    if (error) return <AlertDestructive error={error} />;

    return (
        <div className="space-y-4">
            <DataTable
                table={table}
                columns={columns}
                isLoading={isLoading || isLoadingLookups}
                error={error}
                totalCount={totalCount}
                searchFieldOptions={PE_SEARCHABLE_FIELDS}
                dateFilterColumns={PE_DATE_COLUMNS}
                showExportButton={true}
                onExport="default"
                exportFileName={`Project_Expenses_${projectId}`}
                toolbarActions={
                    (role === "Nirmaan Admin Profile" || role === "Nirmaan Accountant Profile") &&
                    <Button onClick={toggleNewProjectExpenseDialog} size="sm"><PlusCircle className="mr-2 h-4 w-4" />Add Project Expense</Button>
                }
                emptyStateMessage="No project expenses have been recorded yet."
                {...rest}
            />
            <NewProjectExpenseDialog projectId={projectId} onSuccess={refetch} />
            {expenseToEdit && (
                <EditProjectExpenseDialog
                    expenseToEdit={expenseToEdit}
                    onSuccess={() => {
                        refetch();
                        setEditProjectExpenseDialog(false);
                    }}
                />
            )}
            {expenseToDelete && (
                <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete the expense: <span className="font-semibold">{expenseToDelete.description}</span>.</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setExpenseToDelete(null)}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmDelete} disabled={deleteLoading} className="bg-destructive hover:bg-destructive/90">{deleteLoading ? "Deleting..." : "Confirm"}</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </div>
    );
};