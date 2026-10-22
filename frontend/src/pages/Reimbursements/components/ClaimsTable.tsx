/**
 * Every Reimbursements tab is this one table, on the shared server data table, so they all read and work
 * the same way (search, export, paging).
 *
 * * All (HR, Admin and Accounts): every claim, every status.
 * * Reimbursement Raised By Me: the person's own claims (`owner = me`), every status, with Edit / Delete where the
 *   rules allow.
 * * Pending Approval (HR and Admin): every pending claim, with Approve / Reject. HR's are disabled, with the
 *   reason on hover, on claims they can't decide (the server's `can_decide`, from `get_pending_for_me`).
 * * Approved: tick claims, then Export -- the default export with row selection writes ONLY the ticked
 *   rows, with every column (the hidden bank fields included). Exporting changes nothing: there is no Paid
 *   status yet, so the same claim can be exported again.
 * * Rejected: every rejected claim, with its reason.
 *
 * The server scopes every read (`integrations/controllers/reimbursement.py`): someone outside Admin / HR /
 * Accounts gets only their own claims whatever the filters say.
 */

import { useMemo } from "react";

import { DataTable } from "@/components/data-table/new-data-table";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { REIMBURSEMENT_DOCTYPE, type Reimbursement } from "@/types/NirmaanStack/Reimbursement";
import {
    APPROVED,
    PENDING,
    REJECTED,
    TAB_ALL,
    TAB_APPROVED,
    TAB_MINE,
    TAB_PENDING,
    type ReimbursementTab,
} from "@/utils/reimbursements/rules";

import type { Decision } from "./DecisionDialog";

import { columnVisibilityFor, getReimbursementColumns } from "../config/reimbursementColumns";
import {
    REIMBURSEMENT_DATE_COLUMNS,
    REIMBURSEMENT_FIELDS_TO_FETCH,
    REIMBURSEMENT_SEARCHABLE_FIELDS,
} from "../config/reimbursementsTable.config";

interface Props {
    tab: ReimbursementTab;
    userId: string;
    getUserName: (id?: string | null) => string;
    onOpen: (r: Reimbursement) => void;
    onEdit: (r: Reimbursement) => void;
    onDelete: (r: Reimbursement) => void;
    /** Pending Approval only. */
    canDecide?: (name: string) => boolean;
    cannotDecideReason?: (name: string) => string | null | undefined;
    onDecide?: (decision: Decision, r: Reimbursement) => void;
}

export function ClaimsTable({
    tab, userId, getUserName, onOpen, onEdit, onDelete, canDecide, cannotDecideReason, onDecide,
}: Props) {
    const approved = tab === TAB_APPROVED;

    const additionalFilters = useMemo(
        () => tab === TAB_ALL ? []
            : tab === TAB_MINE ? [["owner", "=", userId]]
            : tab === TAB_PENDING ? [["status", "=", PENDING]]
            : tab === TAB_APPROVED ? [["status", "=", APPROVED]]
            : [["status", "=", REJECTED]],
        [tab, userId],
    );

    const columns = useMemo(
        () => getReimbursementColumns({
            tab, userId, getUserName, onOpen, onEdit, onDelete, canDecide, cannotDecideReason, onDecide,
        }),
        [tab, userId, getUserName, onOpen, onEdit, onDelete, canDecide, cannotDecideReason, onDecide],
    );

    const {
        table, totalCount, isLoading, error,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        exportAllRows, isExporting,
    } = useServerDataTable<Reimbursement>({
        doctype: REIMBURSEMENT_DOCTYPE,
        columns,
        fetchFields: REIMBURSEMENT_FIELDS_TO_FETCH,
        searchableFields: REIMBURSEMENT_SEARCHABLE_FIELDS,
        urlSyncKey: `reimb_${tab}`,
        defaultSort: "creation desc",
        enableRowSelection: approved,
        getRowId: (row) => row.name,
        initialState: { columnVisibility: columnVisibilityFor(tab) },
        additionalFilters,
    });

    const selectedCount = table.getSelectedRowModel().rows.length;
    const selectedTotal = table.getSelectedRowModel().rows.reduce((sum, r) => sum + (r.original.amount || 0), 0);

    return (
        <div className="flex flex-col gap-2">
            {approved && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Approved claims waiting to be paid. Tick the ones you're paying, then Export: only the ticked rows
                    are exported, with every field. Exporting doesn't mark a claim as paid, so it stays here.
                    {selectedCount > 0 && (
                        <span className="ml-1 font-semibold">
                            {selectedCount} selected · ₹{selectedTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                    )}
                </p>
            )}
            <DataTable<Reimbursement>
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error}
                totalCount={totalCount}
                searchFieldOptions={REIMBURSEMENT_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                dateFilterColumns={REIMBURSEMENT_DATE_COLUMNS}
                showRowSelection={approved}
                showExportButton={true}
                onExport={"default"}
                onExportAll={approved ? undefined : exportAllRows}
                isExporting={isExporting}
                exportFileName={{ all: "Reimbursements_All", mine: "My_Reimbursements", pending: "Reimbursements_Pending", approved: "Reimbursements_Approved", rejected: "Reimbursements_Rejected" }[tab]}
                exportButtonLabel={approved ? "Export selected" : "Export"}
            />
        </div>
    );
}
