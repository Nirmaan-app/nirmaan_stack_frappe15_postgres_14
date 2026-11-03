/**
 * Pending Invoices Upload -> Cashbook (#1592, ADR-0015 Amendment B decision 4; #1604): every wallet spend the
 * Cashbook Statement import made that is still waiting for its invoice, Project and Non-Project. The Credit Card
 * tab's twin (`CardInvoiceUploads`): the same shared DataTable in client mode (search, column filters, sorting,
 * paging, Export), the same attach dialog (its card mode: file required, number and date optional), the same No
 * invoice dialog and the same role rule, through the shell both share (`InvoiceQueue.tsx`).
 *
 * Project / Non-Project and month narrow the list before the table sees it (dropdowns beside the search box);
 * Project, Expense Type and Paid by are the table's column filters, their counts taken from what the dropdowns
 * leave. The count line counts exactly the rows the table shows.
 *
 * The server lists the waiting spends (`api/expenses/cashbook_invoices.get_cashbook_invoice_queue`); the rules of
 * the filters and the actions are `utils/cashbookInvoicesView.ts`, the columns `cashbookInvoiceColumns.tsx`. Both
 * writes name the spend's ledger.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { DataTable } from "@/components/data-table/new-data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { getFrappeError } from "@/utils/frappeErrors";

import { CASHBOOK_INVOICE_DATE_COLUMNS, CASHBOOK_INVOICE_SEARCHABLE_FIELDS } from "../config/cashbookInvoicesTable.config";
import {
    ALL,
    type CashbookInvoiceRow,
    cashbookCountText,
    cashbookInvoiceActions,
    cashbookInvoiceFacetOptions,
    cashbookInvoiceFilterOptions,
    filterCashbookInvoices,
} from "../utils/cashbookInvoicesView";
import { getCashbookInvoiceColumns } from "./cashbookInvoiceColumns";
import { InvoiceQueueDialogs, type QueueTarget, useInvoiceQueue } from "./InvoiceQueue";

const ENDPOINTS = {
    api: "nirmaan_stack.api.expenses.cashbook_invoices",
    list: "get_cashbook_invoice_queue",
    attach: "attach_cashbook_invoice",
    noInvoice: "mark_cashbook_no_invoice",
    cacheKey: "cashbook-invoice-queue",
    targetArgs: (target: QueueTarget) => ({ expense: target.name, doctype: target.doctype }),
};

const targetOf = (row: CashbookInvoiceRow): QueueTarget => ({ name: row.name, doctype: row.doctype });

export const CashbookInvoiceUploads: React.FC = () => {
    const { role, user_id } = useUserData();
    const actions = useMemo(() => cashbookInvoiceActions(role, user_id), [role, user_id]);
    const queue = useInvoiceQueue<CashbookInvoiceRow>(ENDPOINTS);
    const { rows, setAttaching, openNoInvoice } = queue;

    const { months } = useMemo(() => cashbookInvoiceFilterOptions(rows), [rows]);
    const [ledger, setLedger] = useState<string>(ALL);
    const [month, setMonth] = useState<string>(ALL);
    // The ledger and month narrow the list before the table sees it; the table's own filters narrow it further.
    const narrowedRows = useMemo(() => filterCashbookInvoices(rows, { ledger, month }), [rows, ledger, month]);

    const onAttach = useCallback((row: CashbookInvoiceRow) => setAttaching(targetOf(row)), [setAttaching]);
    const onNoInvoice = useCallback((row: CashbookInvoiceRow) => openNoInvoice(targetOf(row)), [openNoInvoice]);

    const columns = useMemo(
        () => getCashbookInvoiceColumns({ actions, onAttach, onNoInvoice }),
        [actions, onAttach, onNoInvoice],
    );

    const {
        table,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        exportAllRows,
        isExporting,
    } = useServerDataTable<CashbookInvoiceRow>({
        doctype: "CashbookInvoiceUploadsVirtual",
        columns,
        fetchFields: [],
        searchableFields: CASHBOOK_INVOICE_SEARCHABLE_FIELDS,
        clientData: narrowedRows,
        clientTotalCount: narrowedRows.length,
        urlSyncKey: "cashbook_invoice_uploads",
        defaultSort: "payment_date desc",
        enableRowSelection: false,
    });

    const filteredRowCount = table.getFilteredRowModel().rows.length;

    // Client mode sizes the pager from the unfiltered list; re-size it to what the filters leave (as CardInvoiceUploads).
    useEffect(() => {
        const { pageSize } = table.getState().pagination;
        const pageCount = pageSize > 0 ? Math.ceil(filteredRowCount / pageSize) : 1;
        if (table.getPageCount() !== pageCount) {
            table.setOptions((prev) => ({ ...prev, pageCount }));
        }
    }, [filteredRowCount]); // never `table`: it is a new object every render (CODING_STANDARDS § React effects)

    const facetOptions = useMemo(() => {
        const { projects, expenseTypes, payers } = cashbookInvoiceFacetOptions(narrowedRows);
        return {
            project: { title: "Project", options: projects },
            expense_type: { title: "Expense Type", options: expenseTypes },
            paid_by: { title: "Paid by", options: payers },
        };
    }, [narrowedRows]);

    if (queue.error) {
        return <div className="py-10 text-center text-sm text-destructive">{getFrappeError(queue.error) || "Could not load wallet spends."}</div>;
    }
    if (queue.isLoading) {
        return <TableSkeleton />;
    }

    return (
        <div className="flex flex-col gap-3">
            <DataTable<CashbookInvoiceRow>
                table={table}
                columns={columns}
                isLoading={false}
                totalCount={filteredRowCount}
                summaryCard={
                    <div className="text-sm text-muted-foreground" data-testid="cashbook-invoice-count">
                        {cashbookCountText(filteredRowCount)}
                    </div>
                }
                searchFieldOptions={CASHBOOK_INVOICE_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetOptions}
                dateFilterColumns={CASHBOOK_INVOICE_DATE_COLUMNS}
                toolbarActions={
                    <div className="flex gap-2">
                        <Select value={ledger} onValueChange={setLedger}>
                            <SelectTrigger className="w-56 h-9" aria-label="Project or Non-Project"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL}>Project and Non-Project</SelectItem>
                                <SelectItem value="Project Expenses">Project</SelectItem>
                                <SelectItem value="Non Project Expenses">Non-Project</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={month} onValueChange={setMonth}>
                            <SelectTrigger className="w-40 h-9" aria-label="Month"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL}>All months</SelectItem>
                                {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                }
                showExportButton={true}
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName="Cashbook_Spends_Pending_Invoice"
                showRowSelection={false}
            />

            <InvoiceQueueDialogs queue={queue} reasonInputId="cashbook_no_invoice_reason" />
        </div>
    );
};

export default CashbookInvoiceUploads;
