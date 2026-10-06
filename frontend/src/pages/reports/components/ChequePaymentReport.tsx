/**
 * Reports > Payment > "Cheque Payment": every PO / WO payment requested as a cheque, at every
 * status, with the cheque, the payment and its PO / WO side by side. Read-only.
 *
 * The table itself is a server-side list over Project Payments. The PO / WO figures, the TDS
 * and the per-cheque count come from `loadChequeExtras`, run for the rows on screen -- and
 * again for every row at export, since the CSV is not limited to the visible page.
 */

import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { FrappeConfig, FrappeContext } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

import { DataTable } from "@/components/data-table/new-data-table";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { getChequePaymentColumns } from "./columns/chequePaymentColumns";
import {
    CHEQUE_BUCKETS,
    CHEQUE_PAYMENT_AGGREGATES,
    CHEQUE_PAYMENT_BASE_FILTERS,
    CHEQUE_PAYMENT_DATE_COLUMNS,
    CHEQUE_PAYMENT_DOCTYPE,
    CHEQUE_PAYMENT_FIELDS,
    CHEQUE_PAYMENT_HIDDEN_COLUMNS,
    CHEQUE_PAYMENT_SEARCHABLE_FIELDS,
    CHEQUE_PAYMENT_STATUS_SUMS,
    summariseChequeStatuses,
} from "../config/chequePaymentTable.config";
import { ChequeExtras, ChequePaymentRow, ListDocs, loadChequeExtras } from "../utils/chequePaymentExtras";

const URL_KEY = "cheque_payments";

const BUCKET_TONE: Record<string, string> = {
    awaiting: "text-orange-700 dark:text-orange-300",
    issued: "text-amber-700 dark:text-amber-300",
    cleared: "text-emerald-700 dark:text-emerald-300",
    rejected: "text-red-700 dark:text-red-300",
};

export default function ChequePaymentReport() {
    const { call } = useContext(FrappeContext) as FrappeConfig;

    const listDocs: ListDocs = useCallback(
        async (doctype, fields, filters) => {
            const res = await call.post("frappe.client.get_list", {
                doctype,
                fields,
                filters,
                limit_page_length: 0,
            });
            return (res?.message as Record<string, unknown>[]) || [];
        },
        [call],
    );

    const { data: users } = useUsersList();
    const userNames = useMemo(
        () => new Map((users || []).map((u) => [u.name, u.full_name])),
        [users],
    );
    const userName = useCallback((id?: string) => (id ? userNames.get(id) || id : ""), [userNames]);

    // Figures for the rows on the current page, keyed by payment name.
    const [pageExtras, setPageExtras] = useState<Map<string, ChequeExtras>>(new Map());
    const extrasOf = useCallback(
        (row: ChequePaymentRow) => row.extras ?? pageExtras.get(row.name),
        [pageExtras],
    );

    const columns = useMemo(() => getChequePaymentColumns({ extrasOf, userName }), [extrasOf, userName]);

    const {
        table,
        data,
        totalCount,
        isLoading,
        error,
        aggregates,
        groupByResult,
        isAggregatesLoading,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        exportAllRows,
        isExporting,
    } = useServerDataTable<ChequePaymentRow>({
        doctype: CHEQUE_PAYMENT_DOCTYPE,
        columns,
        fetchFields: CHEQUE_PAYMENT_FIELDS,
        searchableFields: CHEQUE_PAYMENT_SEARCHABLE_FIELDS,
        defaultSort: "cheque_date desc",
        urlSyncKey: URL_KEY,
        additionalFilters: CHEQUE_PAYMENT_BASE_FILTERS,
        aggregatesConfig: CHEQUE_PAYMENT_AGGREGATES,
        groupByConfig: CHEQUE_PAYMENT_STATUS_SUMS,
        initialState: { columnVisibility: CHEQUE_PAYMENT_HIDDEN_COLUMNS },
    });

    // Re-read whenever the page's rows change (page, sort, filter, refetch). A response for a
    // page the user has already left is dropped.
    useEffect(() => {
        let cancelled = false;
        loadChequeExtras(data || [], listDocs)
            .then((m) => {
                if (!cancelled) setPageExtras(m);
            })
            .catch((e) => console.error("Cheque payment report: could not load PO / WO figures", e));
        return () => {
            cancelled = true;
        };
    }, [data, listDocs]);

    const [isEnriching, setIsEnriching] = useState(false);
    const handleExportAll = useCallback(async () => {
        const rows = await exportAllRows();
        setIsEnriching(true);
        try {
            const extras = await loadChequeExtras(rows, listDocs);
            return rows.map((r) => ({ ...r, extras: extras.get(r.name) }));
        } finally {
            setIsEnriching(false);
        }
    }, [exportAllRows, listDocs]);

    const summary = useMemo(
        () => summariseChequeStatuses(groupByResult, aggregates, totalCount),
        [groupByResult, aggregates, totalCount],
    );

    if (error) return <AlertDestructive error={error} />;

    // One slim row, like the TDS ledger's strip, so the table stays above the fold.
    const summaryCard = (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border bg-card px-4 py-2 text-sm">
            <div>
                <span className="text-muted-foreground">Cheques: </span>
                <span className="font-semibold">{summary.total.count.toLocaleString("en-IN")}</span>
                <span className="text-muted-foreground"> · </span>
                <span className="font-semibold">{formatToRoundedIndianRupee(summary.total.amount)}</span>
            </div>
            {CHEQUE_BUCKETS.map((b) => (
                <div key={b.key} title={b.statuses.join(" + ")}>
                    <span className="text-muted-foreground">{b.label}: </span>
                    <span className={`font-semibold ${BUCKET_TONE[b.key]}`}>
                        {formatToRoundedIndianRupee(summary.buckets[b.key])}
                    </span>
                </div>
            ))}
            {isAggregatesLoading && <TailSpin width={16} height={16} color="#6b7280" />}
        </div>
    );

    return (
        <DataTable<ChequePaymentRow>
            table={table}
            columns={columns}
            isLoading={isLoading}
            error={error}
            totalCount={totalCount}
            searchFieldOptions={CHEQUE_PAYMENT_SEARCHABLE_FIELDS}
            selectedSearchField={selectedSearchField}
            onSelectedSearchFieldChange={setSelectedSearchField}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            facetDoctype={CHEQUE_PAYMENT_DOCTYPE}
            facetOverrides={FACET_OVERRIDES}
            dateFilterColumns={CHEQUE_PAYMENT_DATE_COLUMNS}
            summaryCard={summaryCard}
            showExportButton
            onExport="default"
            onExportAll={handleExportAll}
            isExporting={isExporting || isEnriching}
            exportFileName="cheque_payments"
        />
    );
}

/** Every facet counts cheque payments only, never the whole Project Payments table. */
const FACET_SCOPE = { additionalFilters: CHEQUE_PAYMENT_BASE_FILTERS };
const FACET_OVERRIDES = {
    status: FACET_SCOPE,
    project: FACET_SCOPE,
    vendor: FACET_SCOPE,
};
