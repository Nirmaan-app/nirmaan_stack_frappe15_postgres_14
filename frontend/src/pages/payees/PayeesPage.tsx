/**
 * `/payees` (spec #1420, approved mockup screen 1): every bank account the company pays into.
 *
 * One row per Payee, with how many vendors link to it; All / "No vendor" pills with counts; search
 * by holder name, account number, linked vendor or ID; Export. A Payee is an address book entry
 * (#1434): no status, no lock, no "last paid". The header's Add Payee button opens `AddPayeeDialog` (through `useDialogStore`).
 *
 * Accountant, Accountant Lead and Admin only (`PAYEE_MANAGE_PROFILES`): the route guard, the sidebar
 * link and the header button read that list, and the server enforces it on every endpoint.
 */

import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";

import { AddPayeeDialog } from "@/components/payees/AddPayeeDialog";
import { PayeeTypeBadge } from "@/components/payees/PayeeTypeBadge";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { facetMeta } from "@/components/data-table/facetConfig";
import { DataTable } from "@/components/data-table/new-data-table";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { getUrlStringParam, useServerDataTable } from "@/hooks/useServerDataTable";
import { cn } from "@/lib/utils";
import { PAYEE_DOCTYPE, type PayeeSummary } from "@/types/NirmaanStack/Payee";
import { accountNumberCsvCell, bankLine, linkedVendorsLabel } from "@/utils/payees/payeeForm";
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


const columns: ColumnDef<PayeeSummary>[] = [
    {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Payee ID" />,
        cell: ({ row }) => (
            <Link to={payeeHref(row.original.name)} className="font-medium text-blue-600 hover:underline">
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
        meta: { exportHeaderName: "Account Number", exportValue: (row: PayeeSummary) => accountNumberCsvCell(row.account_number) },
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
        cell: ({ row }) => <div className="text-muted-foreground">{bankLine(row.original) || "--"}</div>,
        size: 220,
        meta: { exportHeaderName: "Bank and Branch", exportValue: (row: PayeeSummary) => bankLine(row) },
    },
    {
        accessorKey: "payee_type",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Payee type" />,
        cell: ({ row }) =>
            row.original.payee_type ? (
                <PayeeTypeBadge type={row.original.payee_type} />
            ) : (
                <span className="text-muted-foreground">--</span>
            ),
        size: 120,
        enableColumnFilter: true,
        meta: {
            // Decoupled: the page's tab travels as a pseudo-filter the generic facet query doesn't know.
            ...facetMeta({ field: "payee_type", title: "Payee type", decoupled: true }),
            exportHeaderName: "Payee Type",
            exportValue: (row: PayeeSummary) => row.payee_type ?? "",
        },
    },
    {
        accessorKey: "vendors",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Linked vendors" />,
        cell: ({ row }) => {
            const label = linkedVendorsLabel(row.original.vendors);
            return label ? (
                <span className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">{label}</span>
            ) : (
                <span className="text-[13px] font-medium text-yellow-700">No vendor</span>
            );
        },
        size: 150,
        meta: {
            exportHeaderName: "Linked Vendors",
            exportValue: (row: PayeeSummary) => String(row.vendors),
        },
    },
];

export default function PayeesPage() {
    const { newPayeeDialog, setNewPayeeDialog } = useDialogStore();
    const [tab, setTab] = useState<PayeeTab>(() => {
        const fromUrl = getUrlStringParam(PAYEES_TAB_PARAM, PAYEE_TABS.ALL);
        return isPayeeTab(fromUrl) ? fromUrl : PAYEE_TABS.ALL;
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
                facetDoctype={PAYEE_DOCTYPE}
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
                            Every bank account the company pays into. A vendor is paid into one of these, and an expense
                            copies one when it is raised. "No vendor" lists the payees used only for expenses.
                        </p>
                        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Payees">
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
