/**
 * Pending Approval -> Cashbook / Credit Card (#1644, spec #1637, GLOSSARY *Expense bill approval*): the Expense
 * bills waiting for a person, on the shared DataTable in client mode (search, column filters, sorting, Export).
 *
 * Approve opens a form with the invoice number and date the row offers (the bill's own, else what the Accountant
 * typed on the Expense) for a person to correct; Reject asks for a reason. The server checks who may decide
 * (`api/expenses/expense_bill_approval`); this screen is mounted only for the same approvers.
 * The list, the two writes and the dialogs' state are `useExpenseBillApprovals`.
 */
import React, { useEffect, useMemo } from "react";

import { DataTable } from "@/components/data-table/new-data-table";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { formatDate } from "@/utils/FormatDate";
import { getFrappeError } from "@/utils/frappeErrors";

import { useExpenseBillApprovals } from "../hooks/useExpenseBillApprovals";
import { type ExpenseBillKind, type PendingExpenseBillRow, billCheckText } from "../utils/expenseBillApprovalView";
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
        rows, error, isLoading, approvingBill, setApprovingBill, rejectingBill, setRejectingBill, approveRow, rejectRow,
        invoiceNo, setInvoiceNo, invoiceDate, setInvoiceDate, reason, setReason, approving, rejecting,
        onApprove, onReject, submitApprove, submitReject,
    } = useExpenseBillApprovals(kind);

    const columns = useMemo(() => getExpenseBillApprovalColumns({ onApprove, onReject }), [onApprove, onReject]);

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

            <Dialog open={!!approvingBill} onOpenChange={(open) => { if (!open && !approving) setApprovingBill(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Approve bill</DialogTitle>
                        <DialogDescription>
                            {approveRow ? `${approveRow.expense}, spent ${formatDate(approveRow.payment_date)}. ${billCheckText(approveRow)}` : approvingBill}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="expense_bill_invoice_no">Invoice number</Label>
                            <Input id="expense_bill_invoice_no" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="expense_bill_invoice_date">Invoice date</Label>
                            <Input id="expense_bill_invoice_date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                        </div>
                        <p className="text-xs text-muted-foreground">Correct them if the bill says otherwise. They are copied onto the expense.</p>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setApprovingBill(null)} disabled={approving}>Cancel</Button>
                        <Button onClick={submitApprove} disabled={approving}>{approving ? "Approving..." : "Approve"}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!rejectingBill} onOpenChange={(open) => { if (!open && !rejecting) setRejectingBill(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Reject bill</DialogTitle>
                        <DialogDescription>
                            {rejectRow ? `${rejectRow.expense}: ` : ""}the bill comes off the expense, which waits in Pending
                            Invoices Upload for a new one, showing your reason.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="expense_bill_reject_reason">Reason <sup className="text-destructive">*</sup></Label>
                        <Textarea id="expense_bill_reject_reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setRejectingBill(null)} disabled={rejecting}>Cancel</Button>
                        <Button variant="destructive" onClick={submitReject} disabled={rejecting || !reason.trim()}>
                            {rejecting ? "Rejecting..." : "Reject"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default ExpenseBillApprovals;
