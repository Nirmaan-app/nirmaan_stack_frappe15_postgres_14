import { useState, useMemo, useCallback, useEffect } from "react";
import { DateRange } from "react-day-picker";
import { parse, formatISO, startOfDay, endOfDay, format } from "date-fns";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table/new-data-table";
import { SR2BReconcileRowData, useSR2BReconcileData } from "../hooks/useSR2BReconcileData";
import { sr2BReconcileColumns } from "./columns/sr2BReconcileColumns";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { Projects } from "@/types/NirmaanStack/Projects";
import {
    FrappeDoc,
    GetDocListArgs,
    useFrappeGetDocList,
} from "frappe-react-sdk";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import {
    SR_2B_RECONCILE_SEARCHABLE_FIELDS,
    SR_2B_RECONCILE_DATE_COLUMNS,
    SR_2B_STATUS_OPTIONS,
} from "../config/sr2BReconcileTable.config";
import { toast } from "@/components/ui/use-toast";
import { exportToCsv } from "@/utils/exportToCsv";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ColumnDef } from "@tanstack/react-table";
import { FileText, CheckCircle2 } from "lucide-react";
import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";
import { urlStateManager } from "@/utils/urlStateManager";

interface SelectOption {
    label: string;
    value: string;
}

const URL_SYNC_KEY = "sr_2b_reconcile_table";

export default function SR2BReconcileReport() {
    const { ceoHoldProjectIds } = useCEOHoldProjects();

    // CEO Hold row highlighting
    const getRowClassName = useCallback(
        (row: any) => {
            const projectId = row.original.projectId;
            if (projectId && ceoHoldProjectIds.has(projectId)) {
                return CEO_HOLD_ROW_CLASSES;
            }
            return undefined;
        },
        [ceoHoldProjectIds]
    );

    // Date range state with URL persistence
    const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
        const fromParam = urlStateManager.getParam(`${URL_SYNC_KEY}_from`);
        const toParam = urlStateManager.getParam(`${URL_SYNC_KEY}_to`);
        if (fromParam && toParam) {
            try {
                return {
                    from: startOfDay(parse(fromParam, "yyyy-MM-dd", new Date())),
                    to: endOfDay(parse(toParam, "yyyy-MM-dd", new Date())),
                };
            } catch (e) {
                return undefined;
            }
        }
        return undefined;
    });

    // Sync date range to URL
    useEffect(() => {
        const fromISO = dateRange?.from ? formatISO(dateRange.from, { representation: "date" }) : null;
        const toISO = dateRange?.to ? formatISO(dateRange.to, { representation: "date" }) : null;
        urlStateManager.updateParam(`${URL_SYNC_KEY}_from`, fromISO);
        urlStateManager.updateParam(`${URL_SYNC_KEY}_to`, toISO);
    }, [dateRange]);

    // Fetch 2B reconcile data with date filtering
    const {
        reportData: allInvoicesData,
        isLoading: isLoadingInitialData,
        error: initialDataError,
    } = useSR2BReconcileData({
        startDate: dateRange?.from,
        endDate: dateRange?.to,
    });

    // Use the column definitions
    const tableColumnsToDisplay = useMemo(() => sr2BReconcileColumns, []);

    // Initialize useServerDataTable in clientData mode
    const {
        table,
        isLoading: isTableHookLoading,
        error: tableHookError,
        totalCount,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
    } = useServerDataTable<SR2BReconcileRowData>({
        doctype: `SR2BReconcileReportVirtual`,
        columns: tableColumnsToDisplay,
        fetchFields: [],
        searchableFields: SR_2B_RECONCILE_SEARCHABLE_FIELDS,
        clientData: allInvoicesData || [],
        clientTotalCount: allInvoicesData?.length || 0,
        urlSyncKey: `sr_2b_reconcile_table`,
        defaultSort: "invoiceDate desc",
        enableRowSelection: false,
    });

    const fullyFilteredData = table
        .getFilteredRowModel()
        .rows.map((row) => row.original);

    const filteredRowCount = table.getFilteredRowModel().rows.length;

    // Dynamic summary calculated from filtered data (updates when filters change)
    const dynamicSummary = useMemo(() => {
        if (!fullyFilteredData || fullyFilteredData.length === 0) {
            return {
                totalInvoices: 0,
                totalAmount: 0,
                totalReconciledAmount: 0,
                totalFullyReconciled: 0,
                totalFullyReconciledAmount: 0,
                totalPartiallyReconciled: 0,
                totalPartiallyReconciledAmount: 0,
                totalPartialReconciledValue: 0,
                pendingReconciliation: 0,
                totalNotReconciledAmount: 0,
                pendingReconciliationAmount: 0,
                totalNotApplicable: 0,
                totalNotApplicableAmount: 0,
            };
        }

        let totalAmount = 0;
        let totalReconciledAmount = 0;
        let totalFullyReconciledAmount = 0;
        let totalPartiallyReconciledAmount = 0;
        let totalPartialReconciledValue = 0; // Actual reconciled amount for partial invoices
        let totalNotReconciledAmount = 0;
        let totalFullyReconciled = 0;
        let totalPartiallyReconciled = 0;
        let pendingReconciliation = 0;
        let totalNotApplicable = 0;
        let totalNotApplicableAmount = 0;

        fullyFilteredData.forEach(row => {
            const invoiceAmount = row.invoiceAmount || 0;
            const reconciledAmount = row.reconciledAmount || 0;

            totalAmount += invoiceAmount;
            totalReconciledAmount += reconciledAmount;

            if (row.reconciliationStatus === "full") {
                totalFullyReconciled++;
                totalFullyReconciledAmount += invoiceAmount;
            } else if (row.reconciliationStatus === "partial") {
                totalPartiallyReconciled++;
                totalPartiallyReconciledAmount += invoiceAmount;
                totalPartialReconciledValue += reconciledAmount; // Track actual reconciled amount
            } else if (row.reconciliationStatus === "na") {
                // N/A invoices are excluded from reconciliation metrics
                totalNotApplicable++;
                totalNotApplicableAmount += invoiceAmount;
            } else {
                pendingReconciliation++;
                totalNotReconciledAmount += invoiceAmount;
            }
        });

        return {
            totalInvoices: fullyFilteredData.length,
            totalAmount,
            totalReconciledAmount,
            totalFullyReconciled,
            totalFullyReconciledAmount,
            totalPartiallyReconciled,
            totalPartiallyReconciledAmount,
            totalPartialReconciledValue,
            pendingReconciliation,
            totalNotReconciledAmount,
            pendingReconciliationAmount: totalPartiallyReconciledAmount + totalNotReconciledAmount,
            totalNotApplicable,
            totalNotApplicableAmount,
        };
    }, [fullyFilteredData]);

    // Sync page count with filtered data
    useEffect(() => {
        const { pageSize } = table.getState().pagination;
        const newPageCount = pageSize > 0 ? Math.ceil(filteredRowCount / pageSize) : 1;

        if (table.getPageCount() !== newPageCount) {
            table.setOptions((prev) => ({
                ...prev,
                pageCount: newPageCount,
            }));
        }
    }, [filteredRowCount]);

    // Supporting data for faceted filters
    const projectsFetchOptions = getProjectListOptions();
    const {
        data: projects,
        isLoading: projectsUiLoading,
        error: projectsUiError,
    } = useFrappeGetDocList<Projects>(
        "Projects",
        projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>,
        queryKeys.projects.list(projectsFetchOptions)
    );

    const {
        data: vendors,
        isLoading: vendorsUiLoading,
        error: vendorsUiError,
    } = useVendorsList({
        vendorTypes: ["Service", "Material", "Material & Service"],
    });

    const projectFacetOptions = useMemo<SelectOption[]>(
        () =>
            projects?.map((p) => ({
                label: p.project_name,
                value: p.project_name,
            })) || [],
        [projects]
    );

    const vendorFacetOptions = useMemo<SelectOption[]>(
        () =>
            vendors?.map((v) => ({ label: v.vendor_name, value: v.vendor_name })) || [],
        [vendors]
    );

    const facetOptionsConfig = useMemo(
        () => ({
            projectName: { title: "Project", options: projectFacetOptions },
            vendorName: { title: "Vendor", options: vendorFacetOptions },
            is2bActivated: { title: "Reconciled Status", options: SR_2B_STATUS_OPTIONS },
        }),
        [projectFacetOptions, vendorFacetOptions]
    );

    const exportFileName = useMemo(() => {
        const baseName = "wo_2b_reconcile_report";
        if (dateRange?.from && dateRange?.to) {
            const fromStr = format(dateRange.from, "ddMMMyyyy");
            const toStr = format(dateRange.to, "ddMMMyyyy");
            return `${baseName}_${fromStr}_to_${toStr}`;
        }
        return baseName;
    }, [dateRange]);

    const handleCustomExport = useCallback(() => {
        if (!fullyFilteredData || fullyFilteredData.length === 0) {
            toast({
                title: "Export",
                description: "No data available to export.",
                variant: "default",
            });
            return;
        }

        const dataToExport = fullyFilteredData.map((row) => {
            let status = "None";
            if (row.reconciliationStatus === "full") status = "Full";
            else if (row.reconciliationStatus === "partial") status = "Partial";
            else if (row.reconciliationStatus === "na") status = "N/A";

            return {
                invoice_date: row.invoiceDate ? formatDate(row.invoiceDate.slice(0, 10)) : '-',
                invoice_no: row.invoiceNo,
                amount: formatForReport(row.invoiceAmount),
                reconciled_amount: formatForReport(row.reconciledAmount ?? 0),
                wo_id: row.srId,
                project: row.projectName || '-',
                vendor: row.vendorName,
                status_2b: status,
                reconciled_by: row.reconciledByName || '-',
                reconciled_date: row.reconciledDate ? formatDate(row.reconciledDate.slice(0, 10)) : '-',
                updated_by: row.updatedByName,
            };
        });

        const exportColumnsConfig: ColumnDef<any, any>[] = [
            { header: "Invoice Date", accessorKey: "invoice_date" },
            { header: "Invoice No", accessorKey: "invoice_no" },
            { header: "Amount", accessorKey: "amount" },
            { header: "Reconciled Amount", accessorKey: "reconciled_amount" },
            { header: "WO ID", accessorKey: "wo_id" },
            { header: "Project", accessorKey: "project" },
            { header: "Vendor", accessorKey: "vendor" },
            { header: "Reconciled Status", accessorKey: "status_2b" },
            { header: "Reconciled By", accessorKey: "reconciled_by" },
            { header: "Reconciled Date", accessorKey: "reconciled_date" },
            { header: "Updated By", accessorKey: "updated_by" },
        ];

        try {
            exportToCsv(exportFileName, dataToExport, exportColumnsConfig);
            toast({
                title: "Export Successful",
                description: `${dataToExport.length} rows exported.`,
                variant: "success",
            });
        } catch (e) {
            console.error("Export failed:", e);
            toast({
                title: "Export Error",
                description: "Could not generate CSV file.",
                variant: "destructive",
            });
        }
    }, [fullyFilteredData]);

    const isLoadingOverall =
        isLoadingInitialData ||
        projectsUiLoading ||
        vendorsUiLoading ||
        isTableHookLoading;

    const overallError =
        initialDataError || projectsUiError || vendorsUiError || tableHookError;

    if (overallError) {
        return <AlertDestructive error={overallError as Error} />;
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Date Filter */}
            <StandaloneDateFilter
                value={dateRange}
                onChange={setDateRange}
                onClear={() => setDateRange(undefined)}
            />

            {/* Summary Card */}
            <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
                {/* ===== COMPACT MOBILE VIEW ===== */}
                <div className="sm:hidden">
                    <CardContent className="p-3">
                        <div className="flex items-center gap-3 mb-2">
                            {/* Color accent + Icon */}
                            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
                                <FileText className="h-5 w-5 text-white" />
                            </div>
                            {/* Primary metric - Total Amount */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-lg font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                        {formatToRoundedIndianRupee(dynamicSummary.totalAmount)}
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                                        Total
                                    </span>
                                </div>
                            </div>
                            {/* Count badge */}
                            <div className="flex-shrink-0 text-right">
                                <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-md tabular-nums">
                                    {dynamicSummary.totalInvoices}
                                </span>
                                <span className="block text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                                    invoices
                                </span>
                            </div>
                        </div>
                        {/* Reconciliation Status compact */}
                        <div className="flex flex-wrap items-center gap-2 bg-green-50 dark:bg-green-950/30 rounded-md p-2 border border-green-100 dark:border-green-900/50">
                            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                            <span className="text-[10px] font-medium text-green-600 dark:text-green-400 uppercase">Reconciled:</span>
                            <span className="text-sm font-bold text-green-700 dark:text-green-400 tabular-nums">
                                {formatToRoundedIndianRupee(dynamicSummary.totalReconciledAmount)}
                            </span>
                            <span className="text-[9px] text-amber-600 dark:text-amber-500">
                                | {dynamicSummary.pendingReconciliation + dynamicSummary.totalPartiallyReconciled} pending
                            </span>
                            {dynamicSummary.totalNotApplicable > 0 && (
                                <span className="text-[9px] text-slate-500 dark:text-slate-400 italic">
                                    | {dynamicSummary.totalNotApplicable} N/A
                                </span>
                            )}
                        </div>
                    </CardContent>
                </div>

                {/* ===== EXPANDED DESKTOP VIEW ===== */}
                <div className="hidden sm:block">
                    <CardHeader className="pb-2 pt-4 px-5">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                                WO Invoices Summary
                            </CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="px-5 pb-4 pt-0">
                        <div className="grid grid-cols-3 gap-3">
                            {/* Card 1: Total Invoices */}
                            <div className="bg-gradient-to-br from-cyan-50 to-blue-50/50 dark:from-cyan-950/40 dark:to-blue-950/30 rounded-lg p-4 border border-cyan-100 dark:border-cyan-900/50">
                                <dt className="text-xs font-medium text-cyan-600/80 dark:text-cyan-400/80 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                    <FileText className="h-3 w-3" />
                                    Total Invoices
                                </dt>
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-slate-500 dark:text-slate-400">Invoice Count</span>
                                        <span className="text-lg font-bold text-slate-700 dark:text-slate-300 tabular-nums">{dynamicSummary.totalInvoices}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-slate-500 dark:text-slate-400">Invoice Amount</span>
                                        <span className="text-lg font-semibold text-cyan-600 dark:text-cyan-400 tabular-nums">{formatToRoundedIndianRupee(dynamicSummary.totalAmount)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Card 2: Fully Reconciled */}
                            <div className="bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/40 dark:to-emerald-950/30 rounded-lg p-4 border border-green-100 dark:border-green-900/50">
                                <dt className="text-xs font-medium text-green-600/80 dark:text-green-400/80 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Reconciled
                                </dt>
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-green-600/70 dark:text-green-400/70">Invoice Count</span>
                                        <span className="text-lg font-bold text-green-700 dark:text-green-400 tabular-nums">{dynamicSummary.totalFullyReconciled}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-green-600/70 dark:text-green-400/70">Reconciled Amount</span>
                                        <span className="text-lg font-semibold text-green-600 dark:text-green-400 tabular-nums">{formatToRoundedIndianRupee(dynamicSummary.totalReconciledAmount)}</span>
                                    </div>
                                </div>
                                {dynamicSummary.totalNotApplicable > 0 && (
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 italic">
                                        ({dynamicSummary.totalNotApplicable} N/A excluded)
                                    </div>
                                )}
                            </div>

                            {/* Card 3: Pending Reconciliation */}
                            <div className="bg-gradient-to-br from-amber-50 to-orange-50/50 dark:from-amber-950/40 dark:to-orange-950/30 rounded-lg p-4 border border-amber-100 dark:border-amber-900/50">
                                <dt className="text-xs font-medium text-amber-600/80 dark:text-amber-400/80 uppercase tracking-wide mb-2">
                                    Pending Reconciliation
                                </dt>
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-amber-600/70 dark:text-amber-400/70">Invoice Count</span>
                                        <span className="text-lg font-bold text-amber-700 dark:text-amber-400 tabular-nums">{dynamicSummary.pendingReconciliation + dynamicSummary.totalPartiallyReconciled}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-amber-600/70 dark:text-amber-400/70">Invoice Amount</span>
                                        <span className="text-lg font-semibold text-amber-600 dark:text-amber-400 tabular-nums">{formatToRoundedIndianRupee(dynamicSummary.pendingReconciliationAmount)}</span>
                                    </div>
                                </div>
                                {/* Sub-metrics */}
                                <div className="mt-2 pt-2 border-t border-amber-200/50 dark:border-amber-800/50 space-y-1">
                                    <div className="text-[11px]">
                                        <div className="flex items-center justify-between">
                                            <span className="text-yellow-600 dark:text-yellow-400">Partial</span>
                                            <span className="text-yellow-700 dark:text-yellow-400">
                                                {dynamicSummary.totalPartiallyReconciled} • {formatToRoundedIndianRupee(dynamicSummary.totalPartiallyReconciledAmount)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-end text-[10px] text-yellow-600/70 dark:text-yellow-400/70">
                                            ({formatToRoundedIndianRupee(dynamicSummary.totalPartialReconciledValue)} reconciled)
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px]">
                                        <span className="text-red-600 dark:text-red-400">Not Reconciled</span>
                                        <span className="text-red-700 dark:text-red-400">
                                            {dynamicSummary.pendingReconciliation} • {formatToRoundedIndianRupee(dynamicSummary.totalNotReconciledAmount)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </div>
            </Card>

            {/* Data Table */}
            <div
                className={cn(
                    "flex flex-col gap-2 overflow-hidden",
                    totalCount > 10 ? "h-[calc(100vh-250px)]" : totalCount > 0 ? "h-auto" : ""
                )}
            >
                {isLoadingInitialData && !allInvoicesData ? (
                    <LoadingFallback />
                ) : (
                    <DataTable<SR2BReconcileRowData>
                        table={table}
                        columns={tableColumnsToDisplay}
                        isLoading={isLoadingOverall}
                        error={overallError as Error | null}
                        totalCount={filteredRowCount}
                        searchFieldOptions={SR_2B_RECONCILE_SEARCHABLE_FIELDS}
                        selectedSearchField={selectedSearchField}
                        onSelectedSearchFieldChange={setSelectedSearchField}
                        searchTerm={searchTerm}
                        onSearchTermChange={setSearchTerm}
                        facetFilterOptions={facetOptionsConfig}
                        dateFilterColumns={SR_2B_RECONCILE_DATE_COLUMNS}
                        showExportButton={true}
                        onExport={handleCustomExport}
                        exportFileName={exportFileName}
                        showRowSelection={false}
                        getRowClassName={getRowClassName}
                    />
                )}
            </div>
        </div>
    );
}
