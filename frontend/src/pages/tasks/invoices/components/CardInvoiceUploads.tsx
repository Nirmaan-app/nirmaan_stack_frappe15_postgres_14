/**
 * Pending Invoices Upload -> Credit Card (#1570, ADR-0039 ruling 8): every card spend still waiting for its
 * invoice. Its own table, not the Reports "Pending Invoices" report the PO and WO sub-tabs mount.
 *
 * The server lists the waiting spends (`api/expenses/card_invoices.get_card_invoice_queue`); the rules of the
 * filters and the actions are `utils/cardInvoicesView.ts`. The list is held in the browser and shown through
 * the shared DataTable (client mode), the same way the PO and WO sub-tabs show theirs: search, Expense Type /
 * Holder / Date filters, sorting, paging and Export. Statement month stays a dropdown beside the search box --
 * a statement spans months, so it is not one column value to filter on.
 *
 * The summary card totals exactly the rows the table shows. Attach invoice reuses the expense invoice dialog
 * in its card mode (file required, number and date optional); No invoice asks for a typed reason. The list, the
 * two actions and their dialogs are the shell every expense queue shares (`InvoiceQueue.tsx`).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { DataTable } from "@/components/data-table/new-data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { getFrappeError } from "@/utils/frappeErrors";

import { CARD_INVOICE_DATE_COLUMNS, CARD_INVOICE_SEARCHABLE_FIELDS } from "../config/cardInvoicesTable.config";
import {
    ALL,
    type CardInvoiceRow,
    cardInvoiceActions,
    cardInvoiceFacetOptions,
    cardInvoiceFilterOptions,
    filterCardInvoices,
    summariseCardSpendsByType,
} from "../utils/cardInvoicesView";
import { getCardInvoiceColumns } from "./cardInvoiceColumns";
import { InvoiceQueueDialogs, type QueueTarget, useInvoiceQueue } from "./InvoiceQueue";
import { CardSpendsSummaryCard } from "./PendingUploadSummaryCards";

const ENDPOINTS = {
    api: "nirmaan_stack.api.expenses.card_invoices",
    list: "get_card_invoice_queue",
    attach: "attach_card_invoice",
    noInvoice: "mark_card_no_invoice",
    cacheKey: "card-invoice-queue",
    targetArgs: (target: QueueTarget) => ({ expense: target.name }),
};

const cardSpend = (name: string): QueueTarget => ({ name, doctype: "Non Project Expenses" });

export const CardInvoiceUploads: React.FC = () => {
    const { role, user_id } = useUserData();
    const actions = useMemo(() => cardInvoiceActions(role, user_id), [role, user_id]);
    const queue = useInvoiceQueue<CardInvoiceRow>(ENDPOINTS);
    const { rows, setAttaching, openNoInvoice } = queue;

    const { months } = useMemo(() => cardInvoiceFilterOptions(rows), [rows]);
    const [month, setMonth] = useState<string>(ALL);
    // Statement month narrows the list before the table sees it; the table's own filters narrow it further.
    const monthRows = useMemo(() => filterCardInvoices(rows, { holder: ALL, month }), [rows, month]);

    const onAttach = useCallback((name: string) => setAttaching(cardSpend(name)), [setAttaching]);
    const onNoInvoice = useCallback((name: string) => openNoInvoice(cardSpend(name)), [openNoInvoice]);

    const columns = useMemo(
        () => getCardInvoiceColumns({ actions, onAttach, onNoInvoice }),
        [actions, onAttach, onNoInvoice],
    );

    const {
        table,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        columnFilters,
        exportAllRows,
        isExporting,
    } = useServerDataTable<CardInvoiceRow>({
        doctype: "CardInvoiceUploadsVirtual",
        columns,
        fetchFields: [],
        searchableFields: CARD_INVOICE_SEARCHABLE_FIELDS,
        clientData: monthRows,
        clientTotalCount: monthRows.length,
        urlSyncKey: "card_invoice_uploads",
        defaultSort: "payment_date desc",
        enableRowSelection: false,
    });

    // TanStack memoises the row model, so `filteredRows` keeps its identity until the data or a filter changes.
    const filteredRows = table.getFilteredRowModel().rows;
    const filteredRowCount = filteredRows.length;

    // Client mode sizes the pager from the unfiltered list; re-size it to what the filters leave (as POReports).
    useEffect(() => {
        const { pageSize } = table.getState().pagination;
        const pageCount = pageSize > 0 ? Math.ceil(filteredRowCount / pageSize) : 1;
        if (table.getPageCount() !== pageCount) {
            table.setOptions((prev) => ({ ...prev, pageCount }));
        }
    }, [filteredRowCount]); // never `table`: it is a new object every render (CODING_STANDARDS § React effects)
    const summary = useMemo(() => summariseCardSpendsByType(filteredRows.map((r) => r.original)), [filteredRows]);
    const isFiltered = month !== ALL || columnFilters.length > 0 || !!searchTerm;

    const facetOptions = useMemo(() => {
        const { expenseTypes, holders, statements } = cardInvoiceFacetOptions(monthRows);
        return {
            expense_type: { title: "Expense Type", options: expenseTypes },
            holder: { title: "Holder", options: holders },
            statement: { title: "Statement", options: statements },
        };
    }, [monthRows]);

    if (queue.error) {
        return <div className="py-10 text-center text-sm text-destructive">{getFrappeError(queue.error) || "Could not load card spends."}</div>;
    }
    if (queue.isLoading) {
        return <TableSkeleton />;
    }

    return (
        <div className="flex flex-col gap-3">
            <DataTable<CardInvoiceRow>
                table={table}
                columns={columns}
                isLoading={false}
                totalCount={filteredRowCount}
                summaryCard={<CardSpendsSummaryCard summary={summary} isFiltered={isFiltered} />}
                searchFieldOptions={CARD_INVOICE_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetOptions}
                dateFilterColumns={CARD_INVOICE_DATE_COLUMNS}
                toolbarActions={
                    <Select value={month} onValueChange={setMonth}>
                        <SelectTrigger className="w-44 h-9" aria-label="Statement month"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>All months</SelectItem>
                            {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                }
                showExportButton={true}
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName="Card_Spends_Pending_Invoice"
                showRowSelection={false}
            />

            <InvoiceQueueDialogs queue={queue} reasonInputId="card_no_invoice_reason" />
        </div>
    );
};

export default CardInvoiceUploads;
