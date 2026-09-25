import { useCallback, useMemo, useRef, useState } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { FileCheck2, FileWarning, Wallet } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

import { DataTable } from "@/components/data-table/new-data-table";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { PAYMENT_VOUCHER_EDIT } from "@/constants/roles";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { urlStateManager } from "@/utils/urlStateManager";

import { getWOPaymentVoucherColumns } from "./columns/woPaymentVoucherColumns";
import {
    VoucherStatusFilter,
    WO_PAYMENT_VOUCHER_AGGREGATES,
    WO_PAYMENT_VOUCHER_BASE_FILTERS,
    WO_PAYMENT_VOUCHER_DATE_COLUMNS,
    WO_PAYMENT_VOUCHER_DOCTYPE,
    WO_PAYMENT_VOUCHER_FIELDS,
    WO_PAYMENT_VOUCHER_SEARCHABLE_FIELDS,
    summariseVoucherAggregates,
    voucherStatusFilter,
} from "../config/woPaymentVoucherTable.config";

const URL_KEY = "wo_payment_vouchers";
const VOUCHER_STATUS_PARAM = "wo_voucher_status";
const VOUCHER_STATUSES: VoucherStatusFilter[] = ["all", "uploaded", "missing"];

const readVoucherStatus = (): VoucherStatusFilter => {
    const v = urlStateManager.getParam(VOUCHER_STATUS_PARAM) as VoucherStatusFilter | null;
    return v && VOUCHER_STATUSES.includes(v) ? v : "all";
};

interface SummaryTileProps {
    label: string;
    count: number;
    amount: number;
    icon: React.ReactNode;
    tone: string;
}

const SummaryTile = ({ label, count, amount, icon, tone }: SummaryTileProps) => (
    <div className={`rounded-lg border p-3 ${tone}`}>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide opacity-80">
            {icon}
            {label}
        </div>
        <div className="mt-1 text-xl font-semibold">{formatToRoundedIndianRupee(amount)}</div>
        <div className="text-xs opacity-80">
            {count.toLocaleString("en-IN")} payment{count === 1 ? "" : "s"}
        </div>
    </div>
);

export default function WOPaymentVoucherReport() {
    const { role, user_id } = useUserData();
    // Screen-only gate (see PAYMENT_VOUCHER_EDIT). Gen / download / view stay open to every viewer.
    const canEditVoucher = user_id === "Administrator" || PAYMENT_VOUCHER_EDIT.includes(role);

    const [voucherStatus, setVoucherStatus] = useState<VoucherStatusFilter>(readVoucherStatus);

    const tableFilters = useMemo(
        () => [...WO_PAYMENT_VOUCHER_BASE_FILTERS, ...voucherStatusFilter(voucherStatus)],
        [voucherStatus],
    );

    // --- Lookups for display: names, and the TDS withheld on each Work Order payment ---
    const { data: projects } = useFrappeGetDocList<{ name: string; project_name: string }>(
        "Projects",
        { fields: ["name", "project_name"], limit: 0 },
        "wo-voucher-report-projects",
    );
    const { data: vendors } = useFrappeGetDocList<{ name: string; vendor_name: string }>(
        "Vendors",
        { fields: ["name", "vendor_name"], limit: 0 },
        "wo-voucher-report-vendors",
    );
    const { data: tdsRows } = useFrappeGetDocList<{ project_payment: string; tds_amount: number }>(
        "Payment TDS Deduction",
        {
            fields: ["project_payment", "tds_amount"],
            filters: [["document_type", "=", "Service Requests"]],
            limit: 0,
        },
        "wo-voucher-report-tds",
    );

    const projectNames = useMemo(
        () => new Map((projects || []).map((p) => [p.name, p.project_name])),
        [projects],
    );
    const vendorNames = useMemo(
        () => new Map((vendors || []).map((v) => [v.name, v.vendor_name])),
        [vendors],
    );
    const tdsByPayment = useMemo(
        () => new Map((tdsRows || []).map((t) => [t.project_payment, Number(t.tds_amount) || 0])),
        [tdsRows],
    );

    // `refetch` is only known after the table hook runs; route the voucher callback through a
    // stable wrapper so the column defs don't need it.
    const refetchRef = useRef<() => void>(() => {});
    const onVoucherUpdate = useCallback(() => refetchRef.current(), []);

    // The table instance is only known after the hook runs; reach it through a ref so this
    // handler (and the column defs that hold it) stay stable.
    const tableRef = useRef<{ setPageIndex: (i: number) => void } | null>(null);
    const handleVoucherStatusChange = useCallback((next: VoucherStatusFilter) => {
        setVoucherStatus(next);
        urlStateManager.updateParam(VOUCHER_STATUS_PARAM, next === "all" ? null : next);
        tableRef.current?.setPageIndex(0);
    }, []);

    const columns = useMemo(
        () =>
            getWOPaymentVoucherColumns({
                projectNames,
                vendorNames,
                tdsByPayment,
                canEditVoucher,
                onVoucherUpdate,
                voucherStatus,
                onVoucherStatusChange: handleVoucherStatusChange,
            }),
        [projectNames, vendorNames, tdsByPayment, canEditVoucher, onVoucherUpdate, voucherStatus, handleVoucherStatusChange],
    );

    const {
        table,
        totalCount,
        isLoading,
        error,
        refetch,
        aggregates,
        isAggregatesLoading,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        exportAllRows,
        isExporting,
    } = useServerDataTable<ProjectPayments>({
        doctype: WO_PAYMENT_VOUCHER_DOCTYPE,
        columns,
        fetchFields: WO_PAYMENT_VOUCHER_FIELDS,
        searchableFields: WO_PAYMENT_VOUCHER_SEARCHABLE_FIELDS,
        defaultSort: "payment_date desc",
        urlSyncKey: URL_KEY,
        additionalFilters: tableFilters,
        aggregatesConfig: WO_PAYMENT_VOUCHER_AGGREGATES,
    });
    refetchRef.current = refetch;
    tableRef.current = table;

    const summary = useMemo(
        () => summariseVoucherAggregates(aggregates, totalCount),
        [aggregates, totalCount],
    );


    const facetOverrides = useMemo(
        () => ({
            project: { additionalFilters: tableFilters },
            vendor: { additionalFilters: tableFilters },
        }),
        [tableFilters],
    );

    if (error) return <AlertDestructive error={error} />;

    const summaryCard = (
        <Card>
            <CardContent className="p-4">
                <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold">Paid Work Order payments</p>
                    {isAggregatesLoading && <TailSpin width={16} height={16} color="#6b7280" />}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <SummaryTile
                        label="Total"
                        count={summary.total.count}
                        amount={summary.total.amount}
                        icon={<Wallet className="h-4 w-4" />}
                        tone="bg-slate-50 text-slate-800 dark:bg-slate-900/40 dark:text-slate-200"
                    />
                    <SummaryTile
                        label="Voucher uploaded"
                        count={summary.uploaded.count}
                        amount={summary.uploaded.amount}
                        icon={<FileCheck2 className="h-4 w-4" />}
                        tone="bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                    />
                    <SummaryTile
                        label="Voucher missing"
                        count={summary.missing.count}
                        amount={summary.missing.amount}
                        icon={<FileWarning className="h-4 w-4" />}
                        tone="bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                    />
                </div>
            </CardContent>
        </Card>
    );

    return (
        <DataTable<ProjectPayments>
            table={table}
            columns={columns}
            isLoading={isLoading}
            error={error}
            totalCount={totalCount}
            searchFieldOptions={WO_PAYMENT_VOUCHER_SEARCHABLE_FIELDS}
            selectedSearchField={selectedSearchField}
            onSelectedSearchFieldChange={setSelectedSearchField}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            facetDoctype={WO_PAYMENT_VOUCHER_DOCTYPE}
            facetOverrides={facetOverrides}
            dateFilterColumns={WO_PAYMENT_VOUCHER_DATE_COLUMNS}
            summaryCard={summaryCard}
            showExportButton
            onExport="default"
            onExportAll={exportAllRows}
            isExporting={isExporting}
            exportFileName="wo_payment_voucher_uploads"
        />
    );
}
