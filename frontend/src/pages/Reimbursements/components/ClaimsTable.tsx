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
 *   Paid and All have a month picker with the month's totals for Admin, HR and Accounts (`ClaimMonthBar`).
 *
 * The selection's count, total and bulk buttons sit in the table's toolbar, right of the search, as Project
 * Payments' bulk bar does.
 *
 * Facet filters (owner, 2026-11-19): Claimant, Type (on the Title header), Status (All, Raised By Me), Role and Approved
 * By (Paid / All). Their counts are scoped to the tab: by claim status, by owner on Raised By Me, by the month on All.
 * On the four expense-led tabs the counts cover every Approved claim (the tab itself is the expense's status, which
 * the claim doesn't hold); the filter itself is exact, because it is applied with the tab on the server.
 *
 * The server scopes every read (`integrations/controllers/reimbursement.py`): someone outside Admin / HR / Accounts
 * gets only their own claims whatever the tab says, and only the CEO may list Pending CEO Approval.
 */

import { useEffect, useMemo } from "react";
import { CheckCircle2, Download, IndianRupee, XCircle } from "lucide-react";

import { DataTable } from "@/components/data-table/new-data-table";
import { Button } from "@/components/ui/button";
import type { FacetOverrides } from "@/components/data-table/facetConfig";
import { useServerDataTable, type SimpleAggregationConfig } from "@/hooks/useServerDataTable";
import { REIMBURSEMENT_DOCTYPE, type ClaimRow } from "@/types/NirmaanStack/Reimbursement";
import { ALL_MONTHS, shiftMonth } from "@/utils/reimbursements/claimMonth";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import {
    APPROVED,
    PAID,
    PENDING,
    TAB_ALL,
    TAB_APPROVED,
    TAB_LABELS,
    TAB_MINE,
    TAB_PAID,
    TAB_PENDING,
    type ReimbursementTab,
} from "@/utils/reimbursements/rules";

import { ClaimMonthBar } from "./ClaimMonthBar";
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
    /** Paid and All, for those who see every claim: the picked month ("YYYY-MM" or "all") and its setter. */
    month?: string;
    onMonthChange?: (month: string) => void;
}

/** The columns that carry a facet filter (their ids are the claim fields they filter). */
const FACET_COLUMNS = ["claimant_name", "claimant_role", "reimbursement_type", "status", "approved_by"];

/** The filters that scope a tab's facet counts to (roughly) the claims the tab lists. */
function facetScope(tab: ReimbursementTab, userId: string, month: string | undefined): unknown[] {
    if (tab === TAB_MINE) return [["owner", "=", userId]];
    if (tab === TAB_PENDING) return [["status", "=", PENDING]];
    if (tab === TAB_PAID) return [["status", "=", PAID]];
    if (tab === TAB_ALL) {
        return month && month !== ALL_MONTHS
            ? [["creation", ">=", `${month}-01`], ["creation", "<", `${shiftMonth(month, 1)}-01`]]
            : [];
    }
    return [["status", "=", APPROVED]];
}

/** The month's totals: the sum and count of every matching claim, and a breakdown (by type on Paid, by status on All). */
const MONTH_AGGREGATES: SimpleAggregationConfig[] = [{ field: "amount", function: "sum" }, { field: "amount", function: "count" }];

export function ClaimsTable({
    tab, userId, getUserName, onOpen, onEdit, onDelete, selectable, canAct, cannotActReason, onDecide, onBulkDecide,
    onMarkPaid, onExport, onReconcile, clearTicks, highlight, month, onMonthChange,
}: Props) {
    const columns = useMemo(
        () => getReimbursementColumns({
            tab, userId, getUserName, onOpen, onEdit, onDelete, selectable, canAct, cannotActReason, onDecide,
            onMarkPaid: (r) => onMarkPaid([r]), onReconcile,
        }),
        [tab, userId, getUserName, onOpen, onEdit, onDelete, selectable, canAct, cannotActReason, onDecide, onMarkPaid, onReconcile],
    );
    const facetOverrides = useMemo<FacetOverrides>(() => {
        const additionalFilters = facetScope(tab, userId, month);
        return Object.fromEntries(FACET_COLUMNS.map((id) => [id, { additionalFilters }]));
    }, [tab, userId, month]);
    const customParams = useMemo(
        () => ({ tab, ...(month && month !== ALL_MONTHS ? { month } : {}) }),
        [tab, month],
    );
    const byMonth = month !== undefined;
    // Memoised: the table refetches whenever these change by reference.
    const aggregatesConfig = useMemo(() => (byMonth ? MONTH_AGGREGATES : undefined), [byMonth]);
    const groupByConfig = useMemo(
        () => (byMonth
            ? { groupByField: tab === TAB_PAID ? "reimbursement_type" : "status", aggregateField: "amount", aggregateFunction: "sum" as const, limit: 10 }
            : undefined),
        [byMonth, tab],
    );

    const {
        table, totalCount, isLoading, error,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        exportAllRows, isExporting, refetch, aggregates, isAggregatesLoading, groupByResult,
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
        aggregatesConfig,
        groupByConfig,
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

    // Right of the search, styled as Project Payments' bars (`approve-payments/components/BulkActionBar.tsx`,
    // `update-payment/AccountantTabs.tsx`): the selection's amount pill, then Approve / Reject, or Mark as Paid (N);
    // Export for Payment stays in the toolbar on Payment need to be paid and needs ticked claims.
    const some = selected.length > 0;
    const bulkActions = selectable ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Selected claims">
            {some && (
                <div className="flex h-8 items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 text-sm dark:border-green-900 dark:bg-green-950/40"
                    title={`${selected.length} selected · ${formatToRoundedIndianRupee(selectedTotal)}`}>
                    <span className="text-muted-foreground">Amount :</span>
                    <span className="font-bold tabular-nums text-foreground">{formatToRoundedIndianRupee(selectedTotal)}</span>
                    <span className="font-semibold tabular-nums text-foreground">({selected.length})</span>
                </div>
            )}
            {tooMany && <span className="text-xs text-destructive">Pick at most {MAX_BULK} at a time.</span>}
            {paying ? (
                <>
                    {some && (
                        <Button size="sm" className="h-8 gap-1 bg-green-600 text-white hover:bg-green-700" disabled={tooMany}
                            onClick={() => onMarkPaid(selected)}>
                            <IndianRupee className="h-4 w-4" />
                            Mark as Paid ({selected.length})
                        </Button>
                    )}
                    <span title={some ? undefined : "Tick the claims to put in the bank file."}>
                        <Button size="sm" variant="outline" className="h-8 gap-1" disabled={!some || tooMany}
                            onClick={() => onExport(selected)}>
                            <Download className="h-4 w-4" />
                            Export for Payment
                        </Button>
                    </span>
                </>
            ) : some && (
                <>
                    <Button size="sm" className="h-8 gap-1 bg-green-600 text-white hover:bg-green-700" disabled={tooMany}
                        onClick={() => onBulkDecide("approve", selected)}>
                        <CheckCircle2 className="h-4 w-4" />
                        Approve
                    </Button>
                    <Button size="sm" className="h-8 gap-1" disabled={tooMany} onClick={() => onBulkDecide("reject", selected)}>
                        <XCircle className="h-4 w-4" />
                        Reject
                    </Button>
                </>
            )}
        </div>
    ) : null;

    return (
        <div className="flex flex-col gap-2">
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
                exportFileName={`Reimbursements_${TAB_LABELS[tab].replace(/\s+/g, "_")}${month && month !== ALL_MONTHS ? `_${month}` : ""}`}
                toolbarActions={bulkActions}
                facetDoctype={REIMBURSEMENT_DOCTYPE}
                facetOverrides={facetOverrides}
                summaryCard={byMonth && onMonthChange ? (
                    <ClaimMonthBar tab={tab} month={month} onMonthChange={onMonthChange}
                        aggregates={aggregates} groupByResult={groupByResult} loading={isAggregatesLoading} />
                ) : undefined}
            />
        </div>
    );
}
