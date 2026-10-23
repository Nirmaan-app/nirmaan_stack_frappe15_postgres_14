/**
 * Every Reimbursements tab is this one table, on the shared server data table, so they all read and work
 * the same way (search, export, paging).
 *
 * * All (HR, Admin and Accounts): every claim, every status.
 * * Reimbursement Raised By Me: the person's own claims (`owner = me`), every status, with Edit / Delete where the
 *   rules allow.
 * * Pending Approval (HR and Admin): every pending claim, with Approve / Reject. HR's are disabled, with the
 *   reason on hover, on claims they can't decide (the server's `can_decide`, from `get_pending_for_me`).
 * * Payment need to be paid (Approved): claims waiting on their Non-Project Expense, which Accounts pays from
 *   Project Payments & Expenses (ADR-0040). NO Export at all on this tab (owner, 2026-10-23): its file carried
 *   every approved claim's bank account, and a second place to pay a claim is how it gets paid twice. No Payment column (owner, 2026-10-23): a claim's payment
 *   (expense, stage, UTR) is in its detail sheet.
 * * Paid: claims whose expense is Paid.
 * * Rejected: every rejected claim, with its reason (HR / Admin's, or the one typed in Payments).
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
    TAB_PAID,
    TAB_PENDING,
    PAID,
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
            : tab === TAB_PAID ? [["status", "=", PAID]]
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
        getRowId: (row) => row.name,
        initialState: { columnVisibility: columnVisibilityFor(tab) },
        additionalFilters,
    });

    return (
        <div className="flex flex-col gap-2">
            {approved && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Approved claims are paid from <span className="font-semibold">Project Payments &amp; Expenses</span>,
                    where each one is a Non-Project Expense marked Reimbursement. A claim moves to Paid when its
                    expense is paid, and to Rejected if the expense is rejected there.
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
                // Not on "Payment need to be paid": that file would be a list of accounts to pay (owner, 2026-10-23).
                showExportButton={!approved}
                onExport={"default"}
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName={{ all: "Reimbursements_All", mine: "My_Reimbursements", pending: "Reimbursements_Pending", approved: "Reimbursements_Approved", paid: "Reimbursements_Paid", rejected: "Reimbursements_Rejected" }[tab]}
            />
        </div>
    );
}
