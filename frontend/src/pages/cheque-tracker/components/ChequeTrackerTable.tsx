/**
 * One tab of the Cheque Tracker (spec #1407, #1477, #1483): a server-side list over Cheques
 * (`api/cheques/list_cheques.get_cheques`), narrowed by the tab's own filters (`utils/cheques/chequeTabs`).
 *
 * - All Cheques: every Cheque, the summary strip (All / Pending / Issued / Cleared / Cancelled over the
 *   table's filters and search), Add Cheque.
 * - Cheque Issued – Reconciliation Pending: the Issued Payment cheques waiting for the bank, oldest issue first,
 *   with days since issue, the Stale flag and the payment count.
 * - Security Deposits (#1486): every deposit cheque, newest issue first, with what it secures; what is held now
 *   and what came back; Add Security Deposit Cheque. A deposit is only ever marked returned (Cancelled).
 *
 * Each row expands into its lines. Its buttons come from `chequeRowActions`: Clear opens the Clear dialog (every
 * payment becomes Paid), Cancel the Cancel dialog (every payment becomes Rejected), #1484. Accounts tick rows to
 * clear several on one date. The server enforces every rule; Admin, Accountant, Accountant Lead and Procurement
 * may read the list, Project Managers are refused.
 */

import { useMemo, useState } from "react";
import { useFrappeEventListener } from "frappe-react-sdk";
import { Info, Plus, ShieldCheck } from "lucide-react";

import { AddChequeDialog } from "@/components/cheques/AddChequeDialog";
import { CancelChequeDialog } from "@/components/cheques/CancelChequeDialog";
import { ChequeDetailDialog, type ChequeDetailActions } from "@/components/cheques/ChequeDetailDialog";
import { ClearChequeDialog, type ClearTarget } from "@/components/cheques/ClearChequeDialog";
import { ChequeLinesView } from "@/components/cheques/ChequeLinesView";
import { DataTable } from "@/components/data-table/new-data-table";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Button } from "@/components/ui/button";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { CHEQUE_TYPE, CHEQUES_CHANGED_EVENT } from "@/types/NirmaanStack/Cheques";
import { chequeRowActions } from "@/utils/cheques/chequeRowActions";
import { canClearOrCancel } from "@/utils/cheques/chequeStatus";
import { CHEQUE_TRACKER_TAB, chequeTabFilters, type ChequeTrackerTab } from "@/utils/cheques/chequeTabs";

import {
    getChequePaymentColumns,
    getDepositChequeColumns,
    getIssuedChequeColumns,
    type ChequeColumnActions,
} from "./chequePaymentColumns";
import { ChequeSummaryStrip, DepositChequeStrip, IssuedChequeStrip } from "./ChequeSummaryStrip";
import {
    CHEQUE_DATE_COLUMNS,
    CHEQUE_FETCH_FIELDS,
    CHEQUE_SEARCHABLE_FIELDS,
    CHEQUES_DOCTYPE,
    CHEQUES_LIST_API,
    ChequeRow,
    chequeSummary,
} from "../config/chequePaymentTable.config";
import { useChequeFacets } from "../config/useChequeFacets";

/** Each tab keeps its own search, filters and page in the URL. All Cheques keeps the old report's key, so
 *  links searched by a cheque number (`chequeReportPath`) still land on the row. */
const URL_KEY: Record<ChequeTrackerTab, string> = {
    [CHEQUE_TRACKER_TAB.ALL]: "cheques",
    [CHEQUE_TRACKER_TAB.ISSUED]: "cheques_issued",
    [CHEQUE_TRACKER_TAB.DEPOSITS]: "cheques_deposits",
};

const DEFAULT_SORT: Record<ChequeTrackerTab, string> = {
    [CHEQUE_TRACKER_TAB.ALL]: "creation desc",
    // Oldest first, so the stale cheques lead.
    [CHEQUE_TRACKER_TAB.ISSUED]: "issue_date asc",
    [CHEQUE_TRACKER_TAB.DEPOSITS]: "issue_date desc",
};

/** What the Clear dialog needs of a row or of the detail view's Cheque. */
const clearTarget = (c: ClearTarget): ClearTarget => ({
    name: c.name,
    cheque_no: c.cheque_no,
    bank: c.bank,
    old_type: c.old_type,
    issue_date: c.issue_date,
});

interface ChequeTrackerTableProps {
    tab: ChequeTrackerTab;
    /** Called after this tab changed a Cheque, so the page can refresh its tab counts. */
    onChanged: () => void;
}

export function ChequeTrackerTable({ tab, onChanged }: ChequeTrackerTableProps) {
    const { role, user_id } = useUserData();
    const canAct = canClearOrCancel(role);
    const isIssuedTab = tab === CHEQUE_TRACKER_TAB.ISSUED;
    const isDepositsTab = tab === CHEQUE_TRACKER_TAB.DEPOSITS;
    const canSelect = canAct && !isDepositsTab;
    const tabFilters = useMemo(() => chequeTabFilters(tab), [tab]);
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const [detail, setDetail] = useState<string | null>(null);
    const [clearing, setClearing] = useState<ClearTarget[]>([]);
    const [cancelling, setCancelling] = useState<string | null>(null);

    const columns = useMemo(() => {
        const actions: ChequeColumnActions = {
            actionsOf: (row) => chequeRowActions(row, { role, user: user_id }),
            onOpen: setDetail,
            onEdit: (row) => setEditing(row.name),
            onClear: (row) => setClearing([clearTarget(row)]),
            onCancel: (row) => setCancelling(row.name),
        };
        if (isIssuedTab) return getIssuedChequeColumns(actions);
        return isDepositsTab ? getDepositChequeColumns(actions) : getChequePaymentColumns(actions);
    }, [isIssuedTab, isDepositsTab, role, user_id]);

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
        columnFilters,
        aggregates,
        isAggregatesLoading,
    } = useServerDataTable<ChequeRow>({
        // Nominal: the endpoint fixes the row shape.
        doctype: CHEQUES_DOCTYPE,
        apiEndpoint: CHEQUES_LIST_API,
        columns,
        fetchFields: CHEQUE_FETCH_FIELDS,
        searchableFields: CHEQUE_SEARCHABLE_FIELDS,
        defaultSort: DEFAULT_SORT[tab],
        urlSyncKey: URL_KEY[tab],
        additionalFilters: tabFilters,
        // Ticked rows are cleared together; a deposit is never cleared.
        enableRowSelection: canSelect,
        getRowId: (row) => row.name,
    });

    const refresh = () => {
        refetch();
        onChanged();
    };

    // Another user's save shows up without a reload.
    useFrappeEventListener(CHEQUES_CHANGED_EVENT, () => refetch());

    const { facetOptions, onFacetOpen } = useChequeFacets({
        baseFilters: tabFilters,
        columnFilters,
        searchTerm,
        selectedSearchField,
    });
    const summary = useMemo(() => chequeSummary(aggregates), [aggregates]);

    const selected = table.getSelectedRowModel().rows.map((r) => r.original);
    const detailActions: ChequeDetailActions | undefined = canAct
        ? {
              actionsOf: (cheque) => chequeRowActions(cheque, { role, user: user_id }),
              onClear: (cheque) => setClearing([clearTarget(cheque)]),
              onCancel: (cheque) => setCancelling(cheque.name),
          }
        : undefined;

    if (error) return <AlertDestructive error={error} />;

    return (
        <div className="space-y-3">
            {isIssuedTab && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <p>
                        Payment cheques whose payments are approved and handed over, waiting for the bank to pay them.
                        A cheque leaves this tab when a bank statement line with its number and amount is imported, or
                        when it is cleared here by hand.
                    </p>
                </div>
            )}
            {isDepositsTab && (
                <div className="flex items-start gap-2 rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-900">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <p>
                        Cheques handed over as a guarantee. Nobody expects the bank to cash them, so they pay no payment
                        and bank statement lines are never matched to them. A deposit is <strong>Issued</strong> until it
                        comes back or is torn up; then mark it returned, which cancels it with a note.
                    </p>
                </div>
            )}
            <DataTable<ChequeRow>
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error}
                totalCount={totalCount}
                searchFieldOptions={CHEQUE_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                dateFilterColumns={CHEQUE_DATE_COLUMNS}
                facetFilterOptions={facetOptions}
                onFacetOpen={onFacetOpen}
                summaryCard={
                    isIssuedTab ? (
                        <IssuedChequeStrip aggregates={aggregates} loading={isAggregatesLoading} />
                    ) : isDepositsTab ? (
                        <DepositChequeStrip aggregates={aggregates} loading={isAggregatesLoading} />
                    ) : (
                        <ChequeSummaryStrip buckets={summary} loading={isAggregatesLoading} />
                    )
                }
                // Expanded rows change row heights, which a virtualised list would misplace.
                enableVirtualization={false}
                renderExpandedRow={(row) => (
                    <div className="px-10 py-2">
                        <ChequeLinesView lines={row.original.lines} />
                    </div>
                )}
                showExportButton
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName={URL_KEY[tab]}
                showRowSelection={canSelect}
                toolbarActions={
                    <div className="flex items-center gap-2">
                        {canSelect && selected.length > 0 && (
                            <Button size="sm" variant="outline" onClick={() => setClearing(selected.map(clearTarget))}>
                                Clear selected ({selected.length})
                            </Button>
                        )}
                        {!isIssuedTab && (
                            <Button size="sm" onClick={() => setAdding(true)}>
                                <Plus className="mr-1 h-4 w-4" /> {isDepositsTab ? "Add Security Deposit Cheque" : "Add Cheque"}
                            </Button>
                        )}
                    </div>
                }
            />
            <AddChequeDialog
                open={adding}
                onOpenChange={setAdding}
                onSaved={refresh}
                initialType={isDepositsTab ? CHEQUE_TYPE.SECURITY_DEPOSIT : undefined}
            />
            <AddChequeDialog
                open={Boolean(editing)}
                cheque={editing}
                onOpenChange={(open) => !open && setEditing(null)}
                onSaved={refresh}
            />
            <ChequeDetailDialog
                cheque={detail}
                onClose={() => setDetail(null)}
                actions={detailActions}
            />
            {clearing.length > 0 && (
                <ClearChequeDialog
                    key={clearing.map((c) => c.name).join("|")}
                    cheques={clearing}
                    onClose={() => setClearing([])}
                    onDone={() => {
                        table.resetRowSelection();
                        refresh();
                    }}
                />
            )}
            {cancelling && (
                <CancelChequeDialog
                    key={cancelling}
                    cheque={cancelling}
                    onClose={() => setCancelling(null)}
                    onDone={refresh}
                />
            )}
        </div>
    );
}
