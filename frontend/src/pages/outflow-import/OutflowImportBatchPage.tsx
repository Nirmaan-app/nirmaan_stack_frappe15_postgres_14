// src/pages/outflow-import/OutflowImportBatchPage.tsx

import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Lock, Unlock } from "lucide-react";
import { useFrappeGetCall, useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    OutflowImportBatch,
    OutflowImportRow,
    OutflowReconciliationReport,
} from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { CloseBatchDialog } from "./components/CloseBatchDialog";
import { ReconciliationReport } from "./components/ReconciliationReport";
import { OutflowRowsTable } from "./components/OutflowRowsTable";
import { DOCTYPE } from "./config/outflowImportTable.config";

const TABS = [
    { id: "rows", label: "Transfers" },
    { id: "report", label: "Reconciliation report" },
];

/**
 * One import batch: its transfers, their outcomes, and the reconciliation report.
 *
 * ⚠️ NOTHING ON THIS SCREEN WRITES TO A FINANCIAL RECORD. "Run match" reads payments and expenses
 * and records what it found on the IMPORT's own rows; skipping records a decision on an import
 * row. Not one control here edits a payment. That is the payment branch's contract, and a control
 * added later that breaks it would be invisible from the markup alone -- so it is stated here.
 */
export const OutflowImportBatchPage = () => {
    const { id } = useParams<{ id: string }>();
    const [tab, setTab] = useState("rows");
    const [closing, setClosing] = useState(false);

    const {
        data: batch,
        isLoading: batchLoading,
        error: batchError,
        mutate: mutateBatch,
    } = useFrappeGetDoc<OutflowImportBatch>(DOCTYPE, id, id ? undefined : null);

    const {
        data: rowsData,
        isLoading: rowsLoading,
        mutate: mutateRows,
    } = useFrappeGetCall<{ message: { rows: OutflowImportRow[] } }>(
        "nirmaan_stack.api.outflow_import.review.get_batch_rows",
        { batch: id },
        id ? undefined : null
    );

    const { data: reportData, mutate: mutateReport } = useFrappeGetCall<{
        message: OutflowReconciliationReport;
    }>(
        "nirmaan_stack.api.outflow_import.review.get_reconciliation_report",
        { batch: id },
        id ? undefined : null
    );

    const { call: runMatch, loading: matching } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.review.match_batch"
    );
    const { call: callSkip } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.review.skip_row"
    );
    const { call: callSettle } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.expenses.settle_expense"
    );
    const { call: callCreate } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.expenses.create_expense"
    );
    const { call: callClose } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.review.close_batch"
    );
    const { call: callReopen } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.review.reopen_batch"
    );

    const refreshAll = useCallback(async () => {
        await Promise.all([mutateBatch(), mutateRows(), mutateReport()]);
    }, [mutateBatch, mutateRows, mutateReport]);

    const handleMatch = useCallback(async () => {
        await runMatch({ batch: id });
        await refreshAll();
    }, [runMatch, id, refreshAll]);

    const handleSkip = useCallback(
        async (row: OutflowImportRow, reason: string) => {
            await callSkip({ row: row.name, reason });
            await refreshAll();
        },
        [callSkip, refreshAll]
    );

    const handleSettle = useCallback(
        async (row: OutflowImportRow, target: { doctype: string; name: string }) => {
            await callSettle({
                row: row.name,
                target_doctype: target.doctype,
                target_name: target.name,
            });
            await refreshAll();
        },
        [callSettle, refreshAll]
    );

    const handleCreate = useCallback(
        async (row: OutflowImportRow, payload: Record<string, unknown>) => {
            await callCreate({ row: row.name, ...payload });
            await refreshAll();
        },
        [callCreate, refreshAll]
    );

    const handleClose = useCallback(
        async (reason: string) => {
            await callClose({ batch: id, reason: reason || undefined });
            await refreshAll();
        },
        [callClose, id, refreshAll]
    );

    const handleReopen = useCallback(async () => {
        await callReopen({ batch: id });
        await refreshAll();
    }, [callReopen, id, refreshAll]);

    if (batchError) return <AlertDestructive error={batchError} />;
    if (batchLoading || !batch) {
        return (
            <div className="flex h-[40vh] items-center justify-center">
                <TailSpin color="#D03B45" height={40} width={40} />
            </div>
        );
    }

    const rows = rowsData?.message?.rows ?? [];
    const period = batch.period_from
        ? `${formatDate(batch.period_from)}${
              batch.period_to && batch.period_to !== batch.period_from
                  ? ` to ${formatDate(batch.period_to)}`
                  : ""
          }`
        : "--";

    return (
        <div className="flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" asChild>
                    <Link to="/bulk-import-outflow">
                        <ArrowLeft className="mr-1 h-4 w-4" />
                        Back
                    </Link>
                </Button>
                <h2 className="text-xl font-bold tracking-tight">{batch.name}</h2>
                <Badge variant="outline">{batch.status}</Badge>
                <span className="text-sm text-muted-foreground">
                    {batch.source} - {period}
                </span>
                <div className="ml-auto flex gap-2">
                    {batch.closed_at ? (
                        <Button variant="outline" onClick={handleReopen}>
                            <Unlock className="mr-2 h-4 w-4" />
                            Reopen
                        </Button>
                    ) : (
                        <Button variant="outline" onClick={() => setClosing(true)}>
                            <Lock className="mr-2 h-4 w-4" />
                            Close import
                        </Button>
                    )}
                    <Button onClick={handleMatch} disabled={matching}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${matching ? "animate-spin" : ""}`} />
                        {matching ? "Matching..." : "Run match"}
                    </Button>
                </div>
            </div>

            <Card>
                <CardContent className="grid gap-4 py-4 sm:grid-cols-3 lg:grid-cols-6">
                    <Stat label="Transfers" value={String(batch.total_rows ?? 0)} />
                    <Stat
                        label="Decisions"
                        value={`${batch.reviewed_rows ?? 0} / ${batch.total_rows ?? 0}`}
                    />
                    {/* v3: `reconciled_rows` and `exception_rows` were removed with the statuses
                        they counted. Settled and Skipped are the two terminal outcomes, and they
                        are what a reviewer actually wants totalled. */}
                    <Stat label="Settled" value={String(batch.settled_rows ?? 0)} />
                    <Stat label="Skipped" value={String(batch.skipped_rows ?? 0)} />
                    <Stat
                        label="Transferred"
                        value={formatToRoundedIndianRupee(batch.gross_amount ?? 0)}
                    />
                    <Stat
                        label="Bank charges"
                        value={formatToRoundedIndianRupee(batch.charges_amount ?? 0)}
                    />
                </CardContent>
            </Card>

            {batch.closed_at && (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Closed by {batch.closed_by} on {formatDate(batch.closed_at)}
                    {batch.close_reason ? ` - ${batch.close_reason}` : ""}. Rows left undecided keep
                    their status and can still be settled.
                </p>
            )}

            <CloseBatchDialog
                batch={batch.name}
                open={closing}
                onOpenChange={setClosing}
                onConfirm={handleClose}
            />

            {/* Re-running the match is expected, not exceptional: payments get marked Paid by hand
                throughout the day, so a batch matched this morning finds more this evening. */}
            <p className="text-xs text-muted-foreground">
                Run match reads payments and approved expenses and records what it finds. It never
                edits a payment.
            </p>

            <div className="flex gap-2 border-b">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                            tab === t.id
                                ? "border-primary font-medium text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === "rows" &&
                (rowsLoading ? (
                    <div className="flex h-40 items-center justify-center">
                        <TailSpin color="#D03B45" height={30} width={30} />
                    </div>
                ) : (
                    <OutflowRowsTable
                        rows={rows}
                        onSkip={handleSkip}
                        onSettle={handleSettle}
                        onCreate={handleCreate}
                    />
                ))}

            {tab === "report" &&
                (reportData?.message ? (
                    <ReconciliationReport report={reportData.message} />
                ) : (
                    <div className="flex h-40 items-center justify-center">
                        <TailSpin color="#D03B45" height={30} width={30} />
                    </div>
                ))}
        </div>
    );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
    <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="font-medium tabular-nums">{value}</p>
    </div>
);

export const Component = OutflowImportBatchPage;
export default OutflowImportBatchPage;
