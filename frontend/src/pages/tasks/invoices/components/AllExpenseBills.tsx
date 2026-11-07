/**
 * All Invoices -> Cashbook / Credit Card (#1646, spec #1637, GLOSSARY *Expense bills*): every Expense bill of the
 * pill, latest and history, with its Bill check and approval. Server mode: paged, filtered, sorted and searched by
 * `api/expenses/all_expense_bills.get_all_expense_bills`; the pill rides as the filter `["kind", "=", <pill>]`.
 */
import React, { useMemo } from "react";

import { DataTable } from "@/components/data-table/new-data-table";
import { useServerDataTable } from "@/hooks/useServerDataTable";

import { BILL_HISTORY_OPTIONS } from "../utils/allInvoicesView";
import type { AllExpenseBillRow } from "../utils/allInvoicesView";
import { BILL_APPROVAL_STATUSES, BILL_CHECK_RESULTS, type ExpenseBillKind } from "../utils/expenseBillApprovalView";
import { getAllExpenseBillColumns } from "./allInvoicesColumns";

const API = "nirmaan_stack.api.expenses.all_expense_bills.get_all_expense_bills";

const SEARCHABLE_FIELDS = [
    { value: "paid_by", label: "Paid by", placeholder: "Search by who paid...", default: true },
    { value: "invoice_no", label: "Invoice No", placeholder: "Search by invoice no..." },
    { value: "expense", label: "Expense", placeholder: "Search by expense ID..." },
    { value: "project_name", label: "Project", placeholder: "Search by project..." },
    { value: "uploaded_by_name", label: "Invoice Added By", placeholder: "Search by who attached it..." },
];

const FACETS = {
    bill_check: { title: "Bill check", options: BILL_CHECK_RESULTS.map((v) => ({ label: v, value: v })) },
    approval: { title: "Approval", options: BILL_APPROVAL_STATUSES.map((v) => ({ label: v, value: v })) },
    is_latest: { title: "Bill", options: BILL_HISTORY_OPTIONS },
};

export const AllExpenseBills: React.FC<{ kind: ExpenseBillKind }> = ({ kind }) => {
    const columns = useMemo(() => getAllExpenseBillColumns(), []);
    const additionalFilters = useMemo(() => [["kind", "=", kind]], [kind]);

    const {
        table, totalCount, isLoading, error, searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        exportAllRows, isExporting,
    } = useServerDataTable<AllExpenseBillRow>({
        doctype: "Expense Bill",
        columns,
        fetchFields: [],
        searchableFields: SEARCHABLE_FIELDS,
        apiEndpoint: API,
        additionalFilters,
        urlSyncKey: `all_expense_bills_${kind}`,
        defaultSort: "creation desc",
        enableRowSelection: false,
    });

    return (
        <DataTable<AllExpenseBillRow>
            table={table}
            columns={columns}
            isLoading={isLoading}
            error={error}
            totalCount={totalCount}
            searchFieldOptions={SEARCHABLE_FIELDS}
            selectedSearchField={selectedSearchField}
            onSelectedSearchFieldChange={setSelectedSearchField}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            facetFilterOptions={FACETS}
            dateFilterColumns={["payment_date", "creation"]}
            showExportButton={true}
            onExport="default"
            onExportAll={exportAllRows}
            isExporting={isExporting}
            exportFileName={kind === "card" ? "Credit_Card_Bills" : "Cashbook_Bills"}
            showRowSelection={false}
        />
    );
};

export default AllExpenseBills;
