/**
 * Reports > Payment > "Cheque Payment": one row per Cheque (spec #1407), every status.
 *
 * A Cheque is one paper cheque the company writes, recorded on its own with its photo. The table is a
 * server-side list over Cheques (`api/cheques/list_cheques.get_cheques`); Add Cheque records a new one.
 * Admin, Accountant, Accountant Lead and Procurement may open it (`CHEQUE_ACCESS_PROFILES`); the
 * server enforces the same.
 *
 * The cheque number opens the detail view (photo, lines, history). Accounts (`CHEQUE_ACCOUNTS_PROFILES`)
 * also get the row's Status button and the bulk bar (#1412); the server refuses anyone else. Edit
 * (#1418) shows on the rows the user may edit: accounts any, Procurement its own Issued Cheques.
 */

import { useMemo, useState } from "react";
import { useFrappeEventListener } from "frappe-react-sdk";
import { Plus } from "lucide-react";

import { AddChequeDialog } from "@/components/cheques/AddChequeDialog";
import { ChangeChequeStatusDialog } from "@/components/cheques/ChangeChequeStatusDialog";
import { ChequeDetailDialog } from "@/components/cheques/ChequeDetailDialog";
import { DataTable } from "@/components/data-table/new-data-table";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Button } from "@/components/ui/button";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import type { ChequeStatus } from "@/types/NirmaanStack/Cheques";
import { canEditCheque } from "@/utils/cheques/chequeEdit";
import { canChangeChequeStatus } from "@/utils/cheques/chequeStatus";

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

/** The Cheques a Change status dialog moves, with their shared status (undefined when mixed). */
interface StatusTarget {
    cheques: string[];
    status?: ChequeStatus;
}

const sharedStatus = (rows: Pick<ChequeRow, "status">[]): ChequeStatus | undefined =>
    rows.length && rows.every((r) => r.status === rows[0].status) ? rows[0].status : undefined;

export default function ChequePaymentReport() {
    const { role, user_id } = useUserData();
    const canChangeStatus = canChangeChequeStatus(role);
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const [detail, setDetail] = useState<string | null>(null);
    const [statusTarget, setStatusTarget] = useState<StatusTarget>({ cheques: [] });

    const columns = useMemo(
        () =>
            getChequePaymentColumns({
                onOpen: setDetail,
                onChangeStatus: canChangeStatus
                    ? (row) => setStatusTarget({ cheques: [row.name], status: row.status })
                    : undefined,
                onEdit: (row) => setEditing(row.name),
                canEdit: (row) => canEditCheque(row, role, user_id),
            }),
        [canChangeStatus, role, user_id],
    );

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
        enableRowSelection: canChangeStatus,
        getRowId: (row) => row.name,
    });

    // Another user's save shows up without a reload.
    useFrappeEventListener(CHEQUES_CHANGED_EVENT, () => refetch());

    const selected = table.getSelectedRowModel().rows.map((r) => r.original);

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
                showRowSelection={canChangeStatus}
                toolbarActions={
                    <div className="flex items-center gap-2">
                        {canChangeStatus && selected.length > 0 && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                    setStatusTarget({ cheques: selected.map((r) => r.name), status: sharedStatus(selected) })
                                }
                            >
                                Change status ({selected.length})
                            </Button>
                        )}
                        <Button size="sm" onClick={() => setAdding(true)}>
                            <Plus className="mr-1 h-4 w-4" /> Add Cheque
                        </Button>
                    </div>
                }
            />
            <AddChequeDialog open={adding} onOpenChange={setAdding} onSaved={() => refetch()} />
            <AddChequeDialog
                open={Boolean(editing)}
                cheque={editing}
                onOpenChange={(open) => !open && setEditing(null)}
                onSaved={() => refetch()}
            />
            <ChequeDetailDialog
                cheque={detail}
                onClose={() => setDetail(null)}
                onChangeStatus={
                    canChangeStatus ? (cheque, status) => setStatusTarget({ cheques: [cheque], status }) : undefined
                }
            />
            <ChangeChequeStatusDialog
                cheques={statusTarget.cheques}
                currentStatus={statusTarget.status}
                onClose={() => setStatusTarget({ cheques: [] })}
                onDone={() => {
                    table.resetRowSelection();
                    refetch();
                }}
            />
        </>
    );
}
