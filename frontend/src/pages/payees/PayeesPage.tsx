/**
 * `/payees` (spec #1420, approved mockup screen 1): every bank account the company pays into.
 *
 * One row per Payee, with what it is linked to and when it was last paid; Active / Inactive /
 * "Not linked to anything" pills with counts; search by holder name, account number, linked vendor or
 * ID; Export. The header's Add Payee button opens `AddPayeeDialog` (through `useDialogStore`).
 *
 * Accountant, Accountant Lead and Admin only (`PAYEE_MANAGE_PROFILES`): the route guard, the sidebar
 * link and the header button read that list, and the server enforces it on every endpoint.
 */

import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { AddPayeeDialog } from "@/components/payees/AddPayeeDialog";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTable } from "@/components/data-table/new-data-table";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { getUrlStringParam, useServerDataTable } from "@/hooks/useServerDataTable";
import { cn } from "@/lib/utils";
import { PAYEE_DOCTYPE, PAYEE_STATUS, type PayeeSummary } from "@/types/NirmaanStack/Payee";
import { formatDate } from "@/utils/FormatDate";
import { linkedToLabels } from "@/utils/payees/payeeForm";
import { PAYEES_TAB_PARAM, PAYEES_URL_KEY, PAYEE_TABS, isPayeeTab, payeeHref, type PayeeTab } from "@/utils/payees/payeeRoutes";
import { urlStateManager } from "@/utils/urlStateManager";
import { useDialogStore } from "@/zustand/useDialogStore";

import {
    PAYEE_FETCH_FIELDS,
    PAYEE_SEARCHABLE_FIELDS,
    PAYEE_TAB_PILLS,
    PAYEES_LIST_API,
    pillCount,
} from "./config/payeesTable.config";

const bankAndBranch = (row: PayeeSummary) => [row.bank_name, row.bank_branch].filter(Boolean).join(", ");

const columns: ColumnDef<PayeeSummary>[] = [
    {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Payee ID" />,
        cell: ({ row }) => (
            <Link to={payeeHref(row.original.name, row.original.status)} className="font-medium text-blue-600 hover:underline">
                {row.original.name}
            </Link>
        ),
        size: 110,
        meta: { exportHeaderName: "Payee ID", exportValue: (row: PayeeSummary) => row.name },
    },
    {
        accessorKey: "account_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Account holder name" />,
        cell: ({ row }) => <div className="font-medium">{row.original.account_name}</div>,
        size: 240,
        meta: { exportHeaderName: "Account Holder Name", exportValue: (row: PayeeSummary) => row.account_name },
    },
    {
        accessorKey: "account_number",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Account number" />,
        cell: ({ row }) => <div className="font-medium tabular-nums tracking-wide">{row.original.account_number}</div>,
        size: 170,
        meta: { exportHeaderName: "Account Number", exportValue: (row: PayeeSummary) => row.account_number },
    },
    {
        accessorKey: "ifsc",
        header: ({ column }) => <DataTableColumnHeader column={column} title="IFSC" />,
        cell: ({ row }) => <div className="font-medium tabular-nums tracking-wide">{row.original.ifsc}</div>,
        size: 130,
        meta: { exportHeaderName: "IFSC", exportValue: (row: PayeeSummary) => row.ifsc },
    },
    {
        accessorKey: "bank_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bank and branch" />,
        cell: ({ row }) => <div className="text-muted-foreground">{bankAndBranch(row.original) || "--"}</div>,
        size: 220,
        meta: { exportHeaderName: "Bank and Branch", exportValue: (row: PayeeSummary) => bankAndBranch(row) },
    },
    {
        id: "linked_to",
        header: "Linked to",
        cell: ({ row }) => {
            const { vendors, expenses } = row.original;
            if (!vendors && !expenses) return <span className="text-[13px] font-medium text-yellow-700">Not linked yet</span>;
            return (
                <div className="flex flex-wrap gap-1">
                    {vendors > 0 && (
                        <span className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
                            {linkedToLabels({ vendors, expenses: 0 })}
                        </span>
                    )}
                    {expenses > 0 && (
                        <span className="rounded-md bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">
                            {linkedToLabels({ vendors: 0, expenses })}
                        </span>
                    )}
                </div>
            );
        },
        enableSorting: false,
        size: 190,
        meta: {
            exportHeaderName: "Linked To",
            exportValue: (row: PayeeSummary) => linkedToLabels(row).join(", ") || "Not linked yet",
        },
    },
    {
        accessorKey: "last_paid",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last paid" />,
        cell: ({ row }) =>
            row.original.last_paid ? (
                <div className="whitespace-nowrap">{formatDate(row.original.last_paid)}</div>
            ) : (
                <span className="text-muted-foreground">Never</span>
            ),
        size: 120,
        meta: {
            exportHeaderName: "Last Paid",
            exportValue: (row: PayeeSummary) => (row.last_paid ? formatDate(row.last_paid) : "Never"),
        },
    },
    {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
            <span
                className={cn(
                    "rounded-md border px-2 py-0.5 text-xs font-semibold",
                    row.original.status === PAYEE_STATUS.ACTIVE
                        ? "border-green-300 bg-green-50 text-green-700"
                        : "border-zinc-300 bg-zinc-100 text-zinc-600",
                )}
            >
                {row.original.status}
            </span>
        ),
        size: 100,
        meta: { exportHeaderName: "Status", exportValue: (row: PayeeSummary) => row.status },
    },
];

export default function PayeesPage() {
    const { newPayeeDialog, setNewPayeeDialog } = useDialogStore();
    const [tab, setTab] = useState<PayeeTab>(() => {
        const fromUrl = getUrlStringParam(PAYEES_TAB_PARAM, PAYEE_TABS.ACTIVE);
        return isPayeeTab(fromUrl) ? fromUrl : PAYEE_TABS.ACTIVE;
    });
    const tabFilter = useMemo(() => [["tab", "=", tab]], [tab]);

    const {
        table,
        totalCount,
        isLoading,
        error,
        refetch,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        exportAllRows,
        isExporting,
        aggregates,
    } = useServerDataTable<PayeeSummary>({
        // Nominal: the endpoint fixes the row shape.
        doctype: PAYEE_DOCTYPE,
        apiEndpoint: PAYEES_LIST_API,
        columns,
        fetchFields: PAYEE_FETCH_FIELDS,
        searchableFields: PAYEE_SEARCHABLE_FIELDS,
        defaultSort: "creation desc",
        urlSyncKey: PAYEES_URL_KEY,
        additionalFilters: tabFilter,
        enableRowSelection: false,
        getRowId: (row) => row.name,
    });

    const chooseTab = (next: PayeeTab) => {
        if (next === tab) return;
        setTab(next);
        urlStateManager.updateParam(PAYEES_TAB_PARAM, next);
        table.setPageIndex(0);
    };

    if (error) return <AlertDestructive error={error} />;

    return (
        <div className="flex flex-col gap-2">
            <DataTable<PayeeSummary>
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error}
                totalCount={totalCount}
                searchFieldOptions={PAYEE_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                showExportButton
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName="Payees"
                summaryCard={
                    <div className="flex flex-col gap-4">
                        <p className="max-w-[72ch] text-sm text-zinc-600">
                            Every bank account the company pays into. Vendors and expenses point to one of these. A payee's
                            account number and IFSC can't change once money has gone to it.
                        </p>
                        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Payee status">
                            {PAYEE_TAB_PILLS.map((pill) => (
                                <button
                                    key={pill.tab}
                                    type="button"
                                    role="tab"
                                    aria-selected={tab === pill.tab}
                                    onClick={() => chooseTab(pill.tab)}
                                    className={cn(
                                        "flex items-center gap-1.5 whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium transition-colors",
                                        tab === pill.tab ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200",
                                    )}
                                >
                                    {pill.label}
                                    <b className="text-xs">{pillCount(aggregates, pill)}</b>
                                </button>
                            ))}
                        </div>
                    </div>
                }
            />
            <AddPayeeDialog open={newPayeeDialog} onOpenChange={setNewPayeeDialog} onAdded={() => refetch()} />
        </div>
    );
}
