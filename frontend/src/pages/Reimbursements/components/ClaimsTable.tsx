/**
 * Every Reimbursements tab is this one table, on the shared server data table, so they all read and work the same
 * way (search, export, paging). Its rows come from `api/reimbursements/queue.get_claims` (ADR-0040 Amendment C),
 * which knows which claims each tab holds -- an Approved claim's tab is its Non-Project Expense's status -- and adds
 * each claim's expense (ID, status).
 *
 * * Pending Approval / Pending L1 Approval / Pending CEO Approval: Approve / Reject per row, and tick claims →
 *   "N selected · ₹X" → Approve selected / Reject selected (up to 100), as in Project Payments.
 * * Payment need to be paid: tick claims → Export for Payment (the bank file) and Mark as Paid; Mark as Paid per row
 *   (owner, 2026-11-18, reversing the 2026-10-23 "no Export" ruling).
 * * Reconciliation Pending: Mark Reconciled per row (the UTR and proof), which turns the claim Paid.
 * * Paid, Reimbursement Raised By Me, All (rejected claims included): to look at; Edit / Delete on your own.
 *
 * The server scopes every read (`integrations/controllers/reimbursement.py`): someone outside Admin / HR / Accounts
 * gets only their own claims whatever the tab says, and only the CEO may list Pending CEO Approval.
 */

import { useEffect, useMemo } from "react";
import { CheckCheck, Download, IndianRupee, X } from "lucide-react";

import { DataTable } from "@/components/data-table/new-data-table";
import { Button } from "@/components/ui/button";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { REIMBURSEMENT_DOCTYPE, type ClaimRow } from "@/types/NirmaanStack/Reimbursement";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import {
    TAB_APPROVED,
    TAB_LABELS,
    type ReimbursementTab,
} from "@/utils/reimbursements/rules";

import type { Decision } from "./DecisionDialog";

import { columnVisibilityFor, getReimbursementColumns } from "../config/reimbursementColumns";
import {
    REIMBURSEMENT_DATE_COLUMNS,
    REIMBURSEMENT_FIELDS_TO_FETCH,
    REIMBURSEMENT_SEARCHABLE_FIELDS,
} from "../config/reimbursementsTable.config";

const CLAIMS_API = "nirmaan_stack.api.reimbursements.queue.get_claims";
/** Payments' bulk ceiling (`bulk_actions.MAX_BATCH_SIZE`), which the bulk calls also enforce. */
export const MAX_BULK = 100;

interface Props {
    tab: ReimbursementTab;
    userId: string;
    getUserName: (id?: string | null) => string;
    onOpen: (r: ClaimRow) => void;
    onEdit: (r: ClaimRow) => void;
    onDelete: (r: ClaimRow) => void;
    /** The person acts on ticked rows on this tab. */
    selectable: boolean;
    canAct: (r: ClaimRow) => boolean;
    cannotActReason: (r: ClaimRow) => string | null | undefined;
    onDecide: (decision: Decision, r: ClaimRow) => void;
    onBulkDecide: (decision: Decision, rows: ClaimRow[]) => void;
    onMarkPaid: (rows: ClaimRow[]) => void;
    onExport: (rows: ClaimRow[]) => void;
    onReconcile: (r: ClaimRow) => void;
    /** Bumped by the page after a bulk action, to clear the ticks. */
    clearTicks: number;
    /** A claim to highlight (the one a toast's "Open tab" pointed to). */
    highlight?: string | null;
}

export function ClaimsTable({
    tab, userId, getUserName, onOpen, onEdit, onDelete, selectable, canAct, cannotActReason, onDecide, onBulkDecide,
    onMarkPaid, onExport, onReconcile, clearTicks, highlight,
}: Props) {
    const columns = useMemo(
        () => getReimbursementColumns({
            tab, userId, getUserName, onOpen, onEdit, onDelete, selectable, canAct, cannotActReason, onDecide,
            onMarkPaid: (r) => onMarkPaid([r]), onReconcile,
        }),
        [tab, userId, getUserName, onOpen, onEdit, onDelete, selectable, canAct, cannotActReason, onDecide, onMarkPaid, onReconcile],
    );
    const customParams = useMemo(() => ({ tab }), [tab]);

    const {
        table, totalCount, isLoading, error,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        exportAllRows, isExporting, refetch,
    } = useServerDataTable<ClaimRow>({
        doctype: REIMBURSEMENT_DOCTYPE,
        columns,
        fetchFields: REIMBURSEMENT_FIELDS_TO_FETCH,
        searchableFields: REIMBURSEMENT_SEARCHABLE_FIELDS,
        urlSyncKey: `reimb_${tab}`,
        defaultSort: "creation desc",
        getRowId: (row) => row.name,
        initialState: { columnVisibility: columnVisibilityFor(tab) },
        apiEndpoint: CLAIMS_API,
        customParams,
        enableRowSelection: selectable ? (row) => canAct(row.original) : false,
    });

    // Claims are decided by other people, so read the rows again when the window comes back into focus, as the tab
    // counts already do (SWR).
    useEffect(() => {
        window.addEventListener("focus", refetch);
        return () => window.removeEventListener("focus", refetch);
    }, [refetch]);

    useEffect(() => { if (clearTicks) table.resetRowSelection(); }, [clearTicks, table]);

    const selected = table.getSelectedRowModel().rows.map((r) => r.original);
    const selectedTotal = selected.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const tooMany = selected.length > MAX_BULK;
    const paying = tab === TAB_APPROVED;

    return (
        <div className="flex flex-col gap-2">
            {selectable && selected.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2" role="region" aria-label="Selected claims">
                    <span className="flex h-8 items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 text-sm">
                        <span className="font-semibold tabular-nums">{selected.length} selected</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="font-bold tabular-nums">{formatToRoundedIndianRupee(selectedTotal)}</span>
                    </span>
                    {tooMany && <span className="text-xs text-destructive">Pick at most {MAX_BULK} at a time.</span>}
                    <div className="ml-auto flex flex-wrap gap-2">
                        {paying ? (
                            <>
                                <Button size="sm" variant="outline" disabled={tooMany} onClick={() => onExport(selected)}>
                                    <Download className="mr-1.5 h-4 w-4" /> Export for Payment
                                </Button>
                                <Button size="sm" disabled={tooMany} onClick={() => onMarkPaid(selected)}>
                                    <IndianRupee className="mr-1.5 h-4 w-4" /> Mark as Paid
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button size="sm" variant="outline" disabled={tooMany}
                                    className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-700"
                                    onClick={() => onBulkDecide("reject", selected)}>
                                    <X className="mr-1.5 h-4 w-4" /> Reject selected
                                </Button>
                                <Button size="sm" disabled={tooMany} className="bg-emerald-600 hover:bg-emerald-700"
                                    onClick={() => onBulkDecide("approve", selected)}>
                                    <CheckCheck className="mr-1.5 h-4 w-4" /> Approve selected
                                </Button>
                            </>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => table.resetRowSelection()}>Clear</Button>
                    </div>
                </div>
            )}
            {highlight && (
                <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
                    {highlight} is in {TAB_LABELS[tab]}.
                </p>
            )}
            <DataTable<ClaimRow>
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
                showExportButton={true}
                onExport={"default"}
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName={`Reimbursements_${TAB_LABELS[tab].replace(/\s+/g, "_")}`}
            />
        </div>
    );
}
