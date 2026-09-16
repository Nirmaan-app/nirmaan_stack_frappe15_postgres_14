/**
 * `/non-project-inflows` — money the company receives that belongs to no project and no customer
 * (#1265, ADR-0016 Amendment A): Interest Payouts, FD Closures, Loan Received, Others.
 *
 * No status: a record counts the moment it is saved. Access is narrower than In-Flow Payments on
 * purpose — Admin / Accountant / Accountant Lead only; an Accountant adds but cannot edit, and only
 * Admin deletes. The doctype's role permissions enforce that; the buttons here only mirror it.
 *
 * ⚠️ A record the bank-statement import created cannot be deleted: an `Outflow Row Match` points at
 * it and Frappe's delete-time link check refuses. That is accepted (AR3); correct it by editing.
 */

import React, { useCallback, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeDeleteDoc } from "frappe-react-sdk";
import { Download, Edit2, MoreHorizontal, Trash2 } from "lucide-react";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { FacetDeclaration } from "@/components/data-table/facetConfig";
import { DataTable } from "@/components/data-table/new-data-table";
import { TruncatedText } from "@/components/common/TruncatedText";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import SITEURL from "@/constants/siteURL";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { cn } from "@/lib/utils";
import { NonProjectInflows as NonProjectInflowRow } from "@/types/NirmaanStack/NonProjectInflows";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useDialogStore } from "@/zustand/useDialogStore";

import { InflowSummaryCard } from "../inflow-payments/components/InflowSummaryCard";
import { NonProjectInflowDialog } from "./components/NonProjectInflowDialog";
import {
    NON_PROJECT_INFLOW_AGGREGATES_CONFIG,
    NON_PROJECT_INFLOW_DATE_COLUMNS,
    NON_PROJECT_INFLOW_FIELDS_TO_FETCH,
    NON_PROJECT_INFLOW_SEARCHABLE_FIELDS,
    NON_PROJECT_INFLOW_URL_SYNC_KEY,
} from "./config/nonProjectInflowsTable.config";
import { DOCTYPE, canDeleteNonProjectInflow, canEditNonProjectInflow } from "./nonProjectInflowModel";

export const NonProjectInflows: React.FC = () => {
    const { role, user_id } = useUserData();
    const { toast } = useToast();
    const { newNonProjectInflowDialog, setNewNonProjectInflowDialog } = useDialogStore();
    const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc();

    const canEdit = canEditNonProjectInflow(role, user_id);
    const canDelete = canDeleteNonProjectInflow(role, user_id);

    // The record stays set after close so the dialog keeps its edit title through the close animation.
    const [inflowToEdit, setInflowToEdit] = useState<NonProjectInflowRow | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const [inflowToDelete, setInflowToDelete] = useState<NonProjectInflowRow | null>(null);

    const columns = useMemo<ColumnDef<NonProjectInflowRow>[]>(
        () => [
            {
                accessorKey: "payment_date",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Date" />,
                cell: ({ row }) => (
                    <div className="font-medium whitespace-nowrap">
                        {formatDate(row.original.payment_date || row.original.creation)}
                    </div>
                ),
                size: 130,
                meta: {
                    exportHeaderName: "Payment Date",
                    exportValue: (row: NonProjectInflowRow) => formatDate(row.payment_date || row.creation),
                },
            },
            {
                accessorKey: "inflow_type",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Inflow Type" />,
                cell: ({ row }) => <div className="font-medium whitespace-nowrap">{row.original.inflow_type}</div>,
                enableColumnFilter: true,
                size: 150,
                meta: {
                    facet: { field: "inflow_type", title: "Inflow Type" } satisfies FacetDeclaration,
                    exportHeaderName: "Inflow Type",
                    exportValue: (row: NonProjectInflowRow) => row.inflow_type || "--",
                },
            },
            {
                accessorKey: "description",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
                cell: ({ row }) => <TruncatedText text={row.original.description} className="max-w-[16rem]" />,
                enableSorting: false,
                size: 220,
                meta: {
                    exportHeaderName: "Description",
                    exportValue: (row: NonProjectInflowRow) => row.description || "--",
                },
            },
            {
                accessorKey: "utr",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Ref (UTR)" />,
                cell: ({ row }) => <TruncatedText text={row.original.utr} className="max-w-[12rem]" />,
                size: 180,
                meta: {
                    exportHeaderName: "Payment Ref (UTR)",
                    exportValue: (row: NonProjectInflowRow) => row.utr || "--",
                },
            },
            {
                accessorKey: "amount",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Amount Received" />,
                cell: ({ row }) => (
                    <div className="font-medium text-green-600 pr-2">{formatToRoundedIndianRupee(row.original.amount)}</div>
                ),
                size: 150,
                meta: {
                    exportHeaderName: "Amount Received",
                    exportValue: (row: NonProjectInflowRow) => formatForReport(row.amount),
                },
            },
            {
                id: "proof",
                header: "Proof",
                cell: ({ row }) =>
                    row.original.inflow_attachment ? (
                        <a
                            href={SITEURL + row.original.inflow_attachment}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open proof"
                        >
                            <Download className="h-4 w-4 text-blue-500" />
                        </a>
                    ) : null,
                enableSorting: false,
                size: 70,
                meta: { excludeFromExport: true },
            },
            ...(canEdit || canDelete
                ? [
                      {
                          id: "actions",
                          header: () => <div>Actions</div>,
                          cell: ({ row }: { row: { original: NonProjectInflowRow } }) => (
                              <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" className="h-8 w-8 p-0">
                                          <span className="sr-only">Open menu</span>
                                          <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                      {canEdit && (
                                          <DropdownMenuItem
                                              onClick={() => {
                                                  setInflowToEdit(row.original);
                                                  setEditOpen(true);
                                              }}
                                          >
                                              <Edit2 className="mr-2 h-4 w-4" /> Edit
                                          </DropdownMenuItem>
                                      )}
                                      {canEdit && canDelete && <DropdownMenuSeparator />}
                                      {canDelete && (
                                          <DropdownMenuItem
                                              onClick={() => setInflowToDelete(row.original)}
                                              className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                          >
                                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                                          </DropdownMenuItem>
                                      )}
                                  </DropdownMenuContent>
                              </DropdownMenu>
                          ),
                          size: 70,
                          enableSorting: false,
                          meta: { excludeFromExport: true },
                      } as ColumnDef<NonProjectInflowRow>,
                  ]
                : []),
        ],
        [canEdit, canDelete]
    );

    const {
        table,
        data,
        totalCount,
        isLoading,
        error,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        refetch,
        aggregates,
        isAggregatesLoading,
        columnFilters,
        exportAllRows,
        isExporting,
    } = useServerDataTable<NonProjectInflowRow>({
        doctype: DOCTYPE,
        columns,
        fetchFields: NON_PROJECT_INFLOW_FIELDS_TO_FETCH,
        searchableFields: NON_PROJECT_INFLOW_SEARCHABLE_FIELDS,
        urlSyncKey: NON_PROJECT_INFLOW_URL_SYNC_KEY,
        defaultSort: "payment_date desc",
        enableRowSelection: false,
        aggregatesConfig: NON_PROJECT_INFLOW_AGGREGATES_CONFIG,
    });

    const confirmDelete = useCallback(async () => {
        if (!inflowToDelete) return;
        try {
            await deleteDoc(DOCTYPE, inflowToDelete.name);
            toast({ title: "Deleted", description: `${inflowToDelete.name} deleted.`, variant: "success" });
            refetch();
        } catch (e: any) {
            toast({ title: "Could not delete", description: e?.message || "Failed to delete the inflow.", variant: "destructive" });
        } finally {
            setInflowToDelete(null);
        }
    }, [inflowToDelete, deleteDoc, toast, refetch]);

    return (
        <div
            className={cn(
                "flex flex-col gap-2 overflow-hidden",
                totalCount > 10 ? "max-h-[calc(100vh-80px)]" : totalCount > 0 ? "h-auto" : ""
            )}
        >
            {isLoading && !data?.length ? (
                <TableSkeleton />
            ) : (
                <DataTable<NonProjectInflowRow>
                    table={table}
                    columns={columns}
                    isLoading={isLoading}
                    error={error as Error | null}
                    totalCount={totalCount}
                    searchFieldOptions={NON_PROJECT_INFLOW_SEARCHABLE_FIELDS}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    facetDoctype={DOCTYPE}
                    dateFilterColumns={NON_PROJECT_INFLOW_DATE_COLUMNS}
                    showExportButton={true}
                    onExport={"default"}
                    onExportAll={exportAllRows}
                    isExporting={isExporting}
                    exportFileName="Non_Project_Inflows"
                    summaryCard={
                        <InflowSummaryCard
                            title="Non-Project Inflow Summary"
                            aggregates={aggregates}
                            isAggregatesLoading={isAggregatesLoading}
                            totalCount={totalCount}
                            columnFilters={columnFilters}
                            searchTerm={searchTerm}
                        />
                    }
                />
            )}

            <NonProjectInflowDialog
                open={newNonProjectInflowDialog}
                onOpenChange={setNewNonProjectInflowDialog}
                onSuccess={refetch}
            />
            <NonProjectInflowDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                inflow={inflowToEdit}
                onSuccess={refetch}
            />

            <AlertDialog open={!!inflowToDelete} onOpenChange={(open) => !open && setInflowToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this inflow?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This permanently deletes {inflowToDelete?.name} ({inflowToDelete?.inflow_type},{" "}
                            {formatToRoundedIndianRupee(inflowToDelete?.amount)}). A record created by the bank-statement
                            import cannot be deleted — edit it instead.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            disabled={deleteLoading}
                            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                        >
                            {deleteLoading ? "Deleting..." : "Yes, delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default NonProjectInflows;
