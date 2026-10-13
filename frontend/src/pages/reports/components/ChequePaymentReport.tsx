/**
 * Reports > Payment > "Cheque Payment": one row per Cheque (spec #1407), every status.
 *
 * A Cheque is one paper cheque the company writes, recorded on its own with its photo. The table is a
 * server-side list over Cheques (`api/cheques/list_cheques.get_cheques`); Add Cheque records a new one.
 * Admin, Accountant, Accountant Lead and Procurement may open it (`CHEQUE_ACCESS_PROFILES`); the
 * server enforces the same.
 */

import { useMemo, useState } from "react";
import { useFrappeEventListener } from "frappe-react-sdk";
import { Plus } from "lucide-react";

import { AddChequeDialog } from "@/components/cheques/AddChequeDialog";
import { DataTable } from "@/components/data-table/new-data-table";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Button } from "@/components/ui/button";
import { useServerDataTable } from "@/hooks/useServerDataTable";

import { getChequePaymentColumns } from "./columns/chequePaymentColumns";
import {
    CHEQUE_DATE_COLUMNS,
    CHEQUE_FETCH_FIELDS,
    CHEQUE_SEARCHABLE_FIELDS,
    CHEQUES_CHANGED_EVENT,
    CHEQUES_DOCTYPE,
    CHEQUES_LIST_API,
    ChequeRow,
} from "../config/chequePaymentTable.config";

const URL_KEY = "cheques";

export default function ChequePaymentReport() {
    const [adding, setAdding] = useState(false);
    const columns = useMemo(() => getChequePaymentColumns(), []);

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
    } = useServerDataTable<ChequeRow>({
        // Nominal: the endpoint fixes the row shape.
        doctype: CHEQUES_DOCTYPE,
        apiEndpoint: CHEQUES_LIST_API,
        columns,
        fetchFields: CHEQUE_FETCH_FIELDS,
        searchableFields: CHEQUE_SEARCHABLE_FIELDS,
        defaultSort: "creation desc",
        urlSyncKey: URL_KEY,
    });

    // Another user's save shows up without a reload.
    useFrappeEventListener(CHEQUES_CHANGED_EVENT, () => refetch());

    if (error) return <AlertDestructive error={error} />;

    return (
        <>
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
                showExportButton
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName="cheques"
                toolbarActions={
                    <Button size="sm" onClick={() => setAdding(true)}>
                        <Plus className="mr-1 h-4 w-4" /> Add Cheque
                    </Button>
                }
            />
            <AddChequeDialog open={adding} onOpenChange={setAdding} onSaved={() => refetch()} />
        </>
    );
}
