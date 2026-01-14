import { useMemo, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table/new-data-table";
import { SR2BReconcileRowData, useSR2BReconcileData } from "../hooks/useSR2BReconcileData";
import { sr2BReconcileColumns } from "./columns/sr2BReconcileColumns";
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
import { FileText, CheckCircle, Clock, Receipt } from "lucide-react";

interface SelectOption {
    label: string;
    value: string;
}

export default function SR2BReconcileReport() {
    // Fetch 2B reconcile data
    const {
        reportData: allInvoicesData,
        isLoading: isLoadingInitialData,
        error: initialDataError,
    } = useSR2BReconcileData();

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
                total2bActivated: 0,
                pending2bActivation: 0,
            };
        }

        return {
            totalInvoices: fullyFilteredData.length,
            totalAmount: fullyFilteredData.reduce((sum, row) => sum + row.invoiceAmount, 0),
            total2bActivated: fullyFilteredData.filter(row => row.is2bActivated).length,
            pending2bActivation: fullyFilteredData.filter(row => !row.is2bActivated).length,
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
    }, [table, filteredRowCount]);

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
            is2bActivated: { title: "2B Status", options: SR_2B_STATUS_OPTIONS },
        }),
        [projectFacetOptions, vendorFacetOptions]
    );

    const exportFileName = "wo_2b_reconcile_report";

    const handleCustomExport = useCallback(() => {
        if (!fullyFilteredData || fullyFilteredData.length === 0) {
            toast({
                title: "Export",
                description: "No data available to export.",
                variant: "default",
            });
            return;
        }

        const dataToExport = fullyFilteredData.map((row) => ({
            invoice_date: row.invoiceDate ? formatDate(row.invoiceDate.slice(0, 10)) : '-',
            invoice_no: row.invoiceNo,
            amount: formatForReport(row.invoiceAmount),
            wo_id: row.srId,
            project: row.projectName || '-',
            vendor: row.vendorName,
            status_2b: row.is2bActivated ? "Reconciled" : "Pending",
            reconciled_date: row.reconciledDate ? formatDate(row.reconciledDate.slice(0, 10)) : '-',
            updated_by: row.updatedByName,
        }));

        const exportColumnsConfig: ColumnDef<any, any>[] = [
            { header: "Invoice Date", accessorKey: "invoice_date" },
            { header: "Invoice No", accessorKey: "invoice_no" },
            { header: "Amount", accessorKey: "amount" },
            { header: "WO ID", accessorKey: "wo_id" },
            { header: "Project", accessorKey: "project" },
            { header: "Vendor", accessorKey: "vendor" },
            { header: "2B Status", accessorKey: "status_2b" },
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
            {/* Summary Card */}
            <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
                {/* ===== COMPACT MOBILE VIEW ===== */}
                <div className="sm:hidden">
                    <CardContent className="p-3">
                        <div className="flex items-center gap-3">
                            {/* Color accent + Icon */}
                            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                                <FileText className="h-5 w-5 text-white" />
                            </div>
                            {/* Primary metric */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-lg font-bold text-purple-700 dark:text-purple-400 tabular-nums">
                                        {formatToRoundedIndianRupee(dynamicSummary.totalAmount)}
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                                        Total Amount
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 mt-1">
                                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                        <CheckCircle className="inline w-3 h-3 mr-0.5" />
                                        {dynamicSummary.total2bActivated} Reconciled
                                    </span>
                                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                                        <Clock className="inline w-3 h-3 mr-0.5" />
                                        {dynamicSummary.pending2bActivation} Pending
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
                    </CardContent>
                </div>

                {/* ===== EXPANDED DESKTOP VIEW ===== */}
                <div className="hidden sm:block">
                    <CardHeader className="pb-2 pt-4 px-5">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                                WO 2B Reconciliation Summary
                            </CardTitle>
                            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                                <Receipt className="h-3.5 w-3.5" />
                                <span className="uppercase tracking-wider">
                                    {dynamicSummary.totalInvoices} Invoice{dynamicSummary.totalInvoices !== 1 ? 's' : ''}
                                </span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="px-5 pb-4 pt-0">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            {/* Total Amount */}
                            <div className="bg-gradient-to-br from-purple-50 to-violet-50/50 dark:from-purple-950/40 dark:to-violet-950/30 rounded-lg p-3 border border-purple-100 dark:border-purple-900/50">
                                <dt className="text-[10px] font-medium text-purple-600/80 dark:text-purple-400/80 uppercase tracking-wide mb-1 flex items-center gap-1">
                                    <FileText className="h-3 w-3" />
                                    Total Amount
                                </dt>
                                <dd className="text-xl font-bold text-purple-700 dark:text-purple-400 tabular-nums">
                                    {formatToRoundedIndianRupee(dynamicSummary.totalAmount)}
                                </dd>
                            </div>

                            {/* 2B Reconciled */}
                            <div className="bg-gradient-to-br from-emerald-50 to-green-50/50 dark:from-emerald-950/40 dark:to-green-950/30 rounded-lg p-3 border border-emerald-100 dark:border-emerald-900/50">
                                <dt className="text-[10px] font-medium text-emerald-600/80 dark:text-emerald-400/80 uppercase tracking-wide mb-1 flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3" />
                                    2B Reconciled
                                </dt>
                                <dd className="text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                    {dynamicSummary.total2bActivated}
                                </dd>
                                {dynamicSummary.totalInvoices > 0 && (
                                    <span className="text-[10px] text-emerald-500/70 dark:text-emerald-500/60 mt-0.5 block">
                                        {((dynamicSummary.total2bActivated / dynamicSummary.totalInvoices) * 100).toFixed(0)}% of total
                                    </span>
                                )}
                            </div>

                            {/* Pending 2B */}
                            <div className="bg-gradient-to-br from-amber-50 to-orange-50/50 dark:from-amber-950/40 dark:to-orange-950/30 rounded-lg p-3 border border-amber-100 dark:border-amber-900/50">
                                <dt className="text-[10px] font-medium text-amber-600/80 dark:text-amber-400/80 uppercase tracking-wide mb-1 flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    Pending 2B
                                </dt>
                                <dd className="text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                                    {dynamicSummary.pending2bActivation}
                                </dd>
                                {dynamicSummary.totalInvoices > 0 && (
                                    <span className="text-[10px] text-amber-500/70 dark:text-amber-500/60 mt-0.5 block">
                                        {((dynamicSummary.pending2bActivation / dynamicSummary.totalInvoices) * 100).toFixed(0)}% pending
                                    </span>
                                )}
                            </div>

                            {/* Average Invoice */}
                            <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                                <dt className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                                    Avg. Invoice Value
                                </dt>
                                <dd className="text-xl font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                    {dynamicSummary.totalInvoices > 0
                                        ? formatToRoundedIndianRupee(dynamicSummary.totalAmount / dynamicSummary.totalInvoices)
                                        : '₹0'
                                    }
                                </dd>
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
                    />
                )}
            </div>
        </div>
    );
}
