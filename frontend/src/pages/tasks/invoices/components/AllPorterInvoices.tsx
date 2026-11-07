/**
 * All Invoices -> Porter (#1646, spec #1637): one row per Porter Invoice (one PDF covers many trips) with its Validate
 * result and its PDF. Server mode: paged, filtered, sorted and searched by
 * `api/invoices/all_porter_invoices.get_all_porter_invoices`.
 */
import React, { useMemo } from "react";

import { DataTable } from "@/components/data-table/new-data-table";
import { useServerDataTable } from "@/hooks/useServerDataTable";

import { PORTER_VALIDATION_STATUSES, type PorterInvoiceListRow } from "../utils/allInvoicesView";
import { getPorterInvoiceColumns } from "./allInvoicesColumns";

const API = "nirmaan_stack.api.invoices.all_porter_invoices.get_all_porter_invoices";

const SEARCHABLE_FIELDS = [
    { value: "name", label: "Invoice No", placeholder: "Search by Porter invoice no...", default: true },
    { value: "import_batch", label: "Import", placeholder: "Search by import..." },
    { value: "city", label: "City", placeholder: "Search by city..." },
];

const FACETS = {
    validation_status: { title: "Validate result", options: PORTER_VALIDATION_STATUSES.map((v) => ({ label: v, value: v })) },
};

export const AllPorterInvoices: React.FC = () => {
    const columns = useMemo(() => getPorterInvoiceColumns(), []);

    const {
        table, totalCount, isLoading, error, searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        exportAllRows, isExporting,
    } = useServerDataTable<PorterInvoiceListRow>({
        doctype: "Porter Invoice",
        columns,
        fetchFields: [],
        searchableFields: SEARCHABLE_FIELDS,
        apiEndpoint: API,
        urlSyncKey: "all_porter_invoices",
        defaultSort: "creation desc",
        enableRowSelection: false,
    });

    return (
        <DataTable<PorterInvoiceListRow>
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
            dateFilterColumns={["read_invoice_date", "creation"]}
            showExportButton={true}
            onExport="default"
            onExportAll={exportAllRows}
            isExporting={isExporting}
            exportFileName="Porter_Invoices"
            showRowSelection={false}
        />
    );
};

export default AllPorterInvoices;
