/**
 * Pending Approval -> Cashbook / Credit Card (#1644, spec #1637, GLOSSARY *Expense bill approval*): the Expense
 * bills waiting for a person, on the shared DataTable in client mode (search, column filters, sorting, Export).
 *
 * Approve opens a form with the invoice number and date the row offers (the bill's own, else what the Accountant
 * typed on the Expense) for a person to correct; Reject asks for a reason (`ExpenseBillDecisionDialogs`). The server checks who may decide
 * (`api/expenses/expense_bill_approval`); this screen is mounted only for the same approvers. Read again shows on a
 * Not read bill for Admin and Accountant Lead only (#1645).
 * The list, the two writes and the dialogs' state are `useExpenseBillApprovals`.
 */
import React, { useEffect, useMemo } from "react";

import { DataTable } from "@/components/data-table/new-data-table";
import { TableSkeleton } from "@/components/ui/skeleton";
import { canReadExpenseBillAgain } from "@/constants/roles";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { getFrappeError } from "@/utils/frappeErrors";

import { useExpenseBillApprovals } from "../hooks/useExpenseBillApprovals";
import type { ExpenseBillKind, PendingExpenseBillRow } from "../utils/expenseBillApprovalView";
import { ApproveBillDialog, RejectBillDialog } from "./ExpenseBillDecisionDialogs";
import { getExpenseBillApprovalColumns } from "./expenseBillApprovalColumns";

const SEARCHABLE_FIELDS = [
    { value: "paid_by", label: "Paid by", placeholder: "Search by who paid, project or invoice no...", default: true },
];

const optionsOf = (values: (string | null | undefined)[]) =>
    [...new Set(values.filter((v): v is string => !!v))].sort().map((v) => ({ label: v, value: v }));

interface ExpenseBillApprovalsProps {
    kind: ExpenseBillKind;
}

export const ExpenseBillApprovals: React.FC<ExpenseBillApprovalsProps> = ({ kind }) => {
    const {
        rows, error, isLoading, setApprovingBill, setRejectingBill, approveRow, rejectRow, approving, rejecting,
        onApprove, onReject, submitApprove, submitReject, onReadAgain, readingAgainBill,
    } = useExpenseBillApprovals(kind);
    const { role, user_id } = useUserData();
    const canReadAgain = canReadExpenseBillAgain(role, user_id);

    const columns = useMemo(
        () => getExpenseBillApprovalColumns({ onApprove, onReject, onReadAgain, canReadAgain, readingAgainBill }),
        [onApprove, onReject, onReadAgain, canReadAgain, readingAgainBill],
    );

    const {
        table, searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField, exportAllRows, isExporting,
    } = useServerDataTable<PendingExpenseBillRow>({
        doctype: `ExpenseBillApprovals-${kind}`,
        columns,
        fetchFields: [],
        searchableFields: SEARCHABLE_FIELDS,
        clientData: rows,
        clientTotalCount: rows.length,
        urlSyncKey: `expense_bills_${kind}`,
        defaultSort: "payment_date desc",
        enableRowSelection: false,
    });

    const filteredRowCount = table.getFilteredRowModel().rows.length;

    // Client mode sizes the pager from the unfiltered list; re-size it to what the filters leave (as CashbookInvoiceUploads).
    useEffect(() => {
        const { pageSize } = table.getState().pagination;
        const pageCount = pageSize > 0 ? Math.ceil(filteredRowCount / pageSize) : 1;
        if (table.getPageCount() !== pageCount) {
            table.setOptions((prev) => ({ ...prev, pageCount }));
        }
    }, [filteredRowCount]); // never `table`: it is a new object every render (CODING_STANDARDS § React effects)

    // Facets from the rows, not `meta.facet`: a client-mode table over an API list with no single doctype to read
    // facets from, as the Cashbook and Credit Card upload tabs (frontend/CODING_STANDARDS § Building a table).
    const facetOptions = useMemo(() => ({
        bill_check: { title: "Bill check", options: optionsOf(rows.map((r) => r.bill_check)) },
        paid_by: { title: "Paid by", options: optionsOf(rows.map((r) => r.paid_by)) },
        project: { title: "Project", options: optionsOf(rows.map((r) => r.project_name || r.project)) },
    }), [rows]);

    if (error) {
        return <div className="py-10 text-center text-sm text-destructive">{getFrappeError(error) || "Could not load the bills waiting for approval."}</div>;
    }
    if (isLoading) {
        return <TableSkeleton />;
    }

    return (
        <div className="flex flex-col gap-3">
            <DataTable<PendingExpenseBillRow>
                table={table}
                columns={columns}
                isLoading={false}
                totalCount={filteredRowCount}
                summaryCard={
                    <div className="text-sm text-muted-foreground" data-testid={`expense-bill-approval-count-${kind}`}>
                        {filteredRowCount === 1 ? "1 bill waits for approval" : `${filteredRowCount} bills wait for approval`}
                    </div>
                }
                searchFieldOptions={SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetOptions}
                dateFilterColumns={["payment_date"]}
                showExportButton={true}
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName={kind === "card" ? "Credit_Card_Bills_Pending_Approval" : "Cashbook_Bills_Pending_Approval"}
                showRowSelection={false}
            />

            {approveRow && (
                <ApproveBillDialog
                    key={approveRow.name}
                    row={approveRow}
                    submitting={approving}
                    onSubmit={submitApprove}
                    onClose={() => setApprovingBill(null)}
                />
            )}
            {rejectRow && (
                <RejectBillDialog
                    key={rejectRow.name}
                    row={rejectRow}
                    submitting={rejecting}
                    onSubmit={submitReject}
                    onClose={() => setRejectingBill(null)}
                />
            )}
        </div>
    );
};

export default ExpenseBillApprovals;
