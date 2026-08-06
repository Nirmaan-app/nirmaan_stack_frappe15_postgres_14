// src/pages/outflow-import/OutflowImportListPage.tsx

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";

import { DataTable } from "@/components/data-table/new-data-table";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Button } from "@/components/ui/button";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { OutflowImportBatch } from "@/types/NirmaanStack/OutflowImportBatch";

import { getOutflowImportColumns } from "./config/outflowImportColumns";
import {
    DEFAULT_OFI_FIELDS_TO_FETCH,
    DOCTYPE,
    OFI_DATE_COLUMNS,
    OFI_SEARCHABLE_FIELDS,
} from "./config/outflowImportTable.config";

/**
 * Bulk Import Outflow -- the list of previously uploaded bank statements.
 *
 * Nothing here is bespoke: the generic server-side DataTable stack reads the
 * `Outflow Import Batch` doctype directly, so this page needs no endpoint of its own.
 *
 * The "New Import" button lives HERE rather than in `renderRightActionButton.tsx` because the
 * module is a standalone sidebar destination rather than a project-scoped page, and keeping the
 * action beside its own table means the whole feature is one folder.
 */
export const OutflowImportListPage = () => {
    const { data: users } = useUsersList();

    const getUserName = useMemo(() => {
        const byId = new Map((users || []).map((u: any) => [u.name, u.full_name]));
        return (userId?: string) => (userId ? byId.get(userId) || userId : "--");
    }, [users]);

    const columns = useMemo(() => getOutflowImportColumns({ getUserName }), [getUserName]);

    const {
        table,
        totalCount,
        isLoading,
        error,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        exportAllRows,
        isExporting,
    } = useServerDataTable<OutflowImportBatch>({
        doctype: DOCTYPE,
        columns,
        fetchFields: DEFAULT_OFI_FIELDS_TO_FETCH,
        searchableFields: OFI_SEARCHABLE_FIELDS,
        urlSyncKey: "outflow_imports",
        defaultSort: "creation desc",
    });

    if (error) return <AlertDestructive error={error} />;

    return (
        <div className="flex-1 space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold tracking-tight">Bulk Import Outflow</h2>
                    <p className="text-sm text-muted-foreground">
                        Upload a bank statement to reconcile transfers against payments and settle
                        expenses.
                    </p>
                </div>
                <Button asChild>
                    <Link to="/bulk-import-outflow/new">
                        <Plus className="mr-2 h-4 w-4" />
                        New Import
                    </Link>
                </Button>
            </div>

            <DataTable
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error}
                totalCount={totalCount}
                searchFieldOptions={OFI_SEARCHABLE_FIELDS}
                dateFilterColumns={OFI_DATE_COLUMNS}
                facetDoctype={DOCTYPE}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                showExportButton
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName="Outflow_Imports"
            />
        </div>
    );
};

export const Component = OutflowImportListPage;
export default OutflowImportListPage;
