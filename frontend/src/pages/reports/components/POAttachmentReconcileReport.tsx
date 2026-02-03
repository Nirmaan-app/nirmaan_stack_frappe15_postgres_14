import { useMemo, useCallback, useEffect, useState } from "react";
import { Row as TanRow } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table/new-data-table";
import { POAttachmentReconcileRowData, usePOAttachmentReconcileData } from "../hooks/usePOAttachmentReconcileData";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";
import { poAttachmentReconcileColumns } from "./columns/poAttachmentReconcileColumns";
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
    PO_ATTACHMENT_RECONCILE_SEARCHABLE_FIELDS,
    PO_ATTACHMENT_RECONCILE_DATE_COLUMNS,
    PO_ATTACHMENT_STATUS_OPTIONS,
} from "../config/poAttachmentReconcileTable.config";
import { toast } from "@/components/ui/use-toast";
import { exportToCsv } from "@/utils/exportToCsv";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ColumnDef } from "@tanstack/react-table";
import { FileText, Truck, ClipboardCheck, Package, Receipt, IndianRupee, AlertTriangle } from "lucide-react";
import { useProjectAssignees } from "@/hooks/useProjectAssignees";
import { getAssigneesColumn } from "@/components/common/assigneesTableColumns";

interface SelectOption {
    label: string;
    value: string;
}

export default function POAttachmentReconcileReport() {
    const { ceoHoldProjectIds } = useCEOHoldProjects();

    // Fetch attachment reconcile data
    const {
        reportData: allPOData,
        isLoading: isLoadingInitialData,
        error: initialDataError,
    } = usePOAttachmentReconcileData();

    // Fetch Assignees
    const { assignmentsLookup, isLoading: isAssigneesLoading } = useProjectAssignees();

    // Use the column definitions
    const tableColumnsToDisplay = useMemo(() => {
        const columns = [...poAttachmentReconcileColumns];
        // Find index of Project column to insert after
        const projectIndex = columns.findIndex(c => (c as any).id === "projectName" || (c as any).accessorKey === "projectName");
        const insertIndex = projectIndex !== -1 ? projectIndex + 1 : 2; // Default to index 2

        columns.splice(insertIndex, 0, getAssigneesColumn<POAttachmentReconcileRowData>("projectId", assignmentsLookup));
        
        console.log("POAttachmentReconcileReport Columns:", columns.map(c => c.id || (c as any).accessorKey));
        return columns;
    }, [assignmentsLookup]);

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
    } = useServerDataTable<POAttachmentReconcileRowData>({
        doctype: `POAttachmentReconcileReportVirtual`,
        columns: tableColumnsToDisplay,
        fetchFields: [],
        searchableFields: PO_ATTACHMENT_RECONCILE_SEARCHABLE_FIELDS,
        clientData: allPOData || [],
        clientTotalCount: allPOData?.length || 0,
        urlSyncKey: `po_attachment_reconcile_table`,
        defaultSort: "creation desc",
        // Initial sorting state for client-side mode: most recent POs first
        initialState: {
            sorting: [{ id: 'creation', desc: true }],
        },
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
                totalPOs: 0,
                totalPOValue: 0,
                totalDeliveredValue: 0,
                totalInvoiceCount: 0,
                totalDCCount: 0,
                totalMIRCount: 0,
                totalInvoiceAmount: 0,
                mismatchCount: 0,
            };
        }

        return {
            totalPOs: fullyFilteredData.length,
            totalPOValue: fullyFilteredData.reduce((sum, row) => sum + row.totalPOAmount, 0),
            totalDeliveredValue: fullyFilteredData.reduce((sum, row) => sum + row.poAmountDelivered, 0),
            totalInvoiceCount: fullyFilteredData.reduce((sum, row) => sum + row.invoiceCount, 0),
            totalDCCount: fullyFilteredData.reduce((sum, row) => sum + row.dcCount, 0),
            totalMIRCount: fullyFilteredData.reduce((sum, row) => sum + row.mirCount, 0),
            totalInvoiceAmount: fullyFilteredData.reduce((sum, row) => sum + row.totalInvoiceAmount, 0),
            mismatchCount: fullyFilteredData.filter(row => row.invoiceCount !== row.dcCount).length,
        };
    }, [fullyFilteredData]);

    // Row highlighting callback - CEO Hold takes priority, then Invoice/DC mismatch
    const getRowClassName = useCallback((row: TanRow<POAttachmentReconcileRowData>) => {
        const data = row.original;
        // CEO Hold check first (priority)
        const projectId = data.projectId;
        if (projectId && ceoHoldProjectIds.has(projectId)) {
            return CEO_HOLD_ROW_CLASSES;
        }
        // Existing mismatch logic as fallback
        if (data.invoiceCount !== data.dcCount) {
            return "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50";
        }
        return undefined;
    }, [ceoHoldProjectIds]);

    // Toggle state for showing only mismatched rows
    const [showOnlyMismatched, setShowOnlyMismatched] = useState(false);

    // Handler to toggle mismatch filter - updates both state and table filter
    const handleToggleMismatchFilter = useCallback((checked: boolean) => {
        setShowOnlyMismatched(checked);
        const mismatchColumn = table.getColumn("isMismatched");
        mismatchColumn?.setFilterValue(checked ? ["yes"] : undefined);
    }, [table]);

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
            status: { title: "Status", options: PO_ATTACHMENT_STATUS_OPTIONS },
        }),
        [projectFacetOptions, vendorFacetOptions]
    );

    const exportFileName = "po_attachment_reconciliation_report";

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
            po_id: row.name,
            created_on: row.creation ? formatDate(row.creation) : '-',
            vendor: row.vendorName,
            project: row.projectName || '-',
            latest_delivery_date: row.latestDeliveryDate ? formatDate(row.latestDeliveryDate) : '-',
            status: row.status,
            total_po_amt: formatForReport(row.totalPOAmount),
            amt_paid: formatForReport(row.totalAmountPaid),
            invoice_amt: formatForReport(row.totalInvoiceAmount),
            delivered_amt: formatForReport(row.poAmountDelivered),
            invoice_count: row.invoiceCount,
            dc_count: row.dcCount,
            mir_count: row.mirCount,
        }));

        const exportColumnsConfig: ColumnDef<any, any>[] = [
            { header: "PO ID", accessorKey: "po_id" },
            { header: "Created On", accessorKey: "created_on" },
            { header: "Vendor", accessorKey: "vendor" },
            { header: "Project", accessorKey: "project" },
            { header: "Latest Delivery Date", accessorKey: "latest_delivery_date" },
            { header: "Status", accessorKey: "status" },
            { header: "Total PO Amt", accessorKey: "total_po_amt" },
            { header: "Amt Paid", accessorKey: "amt_paid" },
            { header: "Invoice Amt", accessorKey: "invoice_amt" },
            { header: "Delivered Amt", accessorKey: "delivered_amt" },
            { header: "Invoice Count", accessorKey: "invoice_count" },
            { header: "DC Count", accessorKey: "dc_count" },
            { header: "MIR Count", accessorKey: "mir_count" },
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
        isTableHookLoading ||
        isAssigneesLoading;

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
                            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                                <Package className="h-5 w-5 text-white" />
                            </div>
                            {/* Primary metric */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-lg font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                                        {formatToRoundedIndianRupee(dynamicSummary.totalPOValue)}
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                                        PO Value
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                        <FileText className="inline w-3 h-3 mr-0.5" />
                                        {dynamicSummary.totalInvoiceCount}
                                    </span>
                                    <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                        <Truck className="inline w-3 h-3 mr-0.5" />
                                        {dynamicSummary.totalDCCount}
                                    </span>
                                    <span className="text-[10px] text-purple-600 dark:text-purple-400">
                                        <ClipboardCheck className="inline w-3 h-3 mr-0.5" />
                                        {dynamicSummary.totalMIRCount}
                                    </span>
                                    {dynamicSummary.mismatchCount > 0 && (
                                        <button
                                            onClick={() => handleToggleMismatchFilter(!showOnlyMismatched)}
                                            className={cn(
                                                "text-[10px] font-medium flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors",
                                                showOnlyMismatched
                                                    ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                                                    : "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                                            )}
                                        >
                                            <AlertTriangle className="w-3 h-3" />
                                            {dynamicSummary.mismatchCount}
                                            {showOnlyMismatched && <span className="text-[9px]">✓</span>}
                                        </button>
                                    )}
                                </div>
                            </div>
                            {/* Count badge */}
                            <div className="flex-shrink-0 text-right">
                                <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-md tabular-nums">
                                    {dynamicSummary.totalPOs}
                                </span>
                                <span className="block text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                                    POs
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
                                PO Attachment Reconciliation Summary
                            </CardTitle>
                            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                                <Receipt className="h-3.5 w-3.5" />
                                <span className="uppercase tracking-wider">
                                    {dynamicSummary.totalPOs} PO{dynamicSummary.totalPOs !== 1 ? 's' : ''}
                                </span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="px-5 pb-4 pt-0">
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
                            {/* Total PO Value */}
                            <div className="bg-gradient-to-br from-blue-50 to-indigo-50/50 dark:from-blue-950/40 dark:to-indigo-950/30 rounded-lg p-3 border border-blue-100 dark:border-blue-900/50">
                                <dt className="text-[10px] font-medium text-blue-600/80 dark:text-blue-400/80 uppercase tracking-wide mb-1 flex items-center gap-1">
                                    <IndianRupee className="h-3 w-3" />
                                    Total PO Value
                                </dt>
                                <dd className="text-xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                                    {formatToRoundedIndianRupee(dynamicSummary.totalPOValue)}
                                </dd>
                            </div>

                            {/* Delivered Value */}
                            <div className="bg-gradient-to-br from-emerald-50 to-green-50/50 dark:from-emerald-950/40 dark:to-green-950/30 rounded-lg p-3 border border-emerald-100 dark:border-emerald-900/50">
                                <dt className="text-[10px] font-medium text-emerald-600/80 dark:text-emerald-400/80 uppercase tracking-wide mb-1 flex items-center gap-1">
                                    <Package className="h-3 w-3" />
                                    Delivered Value
                                </dt>
                                <dd className="text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                    {formatToRoundedIndianRupee(dynamicSummary.totalDeliveredValue)}
                                </dd>
                                {dynamicSummary.totalPOValue > 0 && (
                                    <span className="text-[10px] text-emerald-500/70 dark:text-emerald-500/60 mt-0.5 block">
                                        {((dynamicSummary.totalDeliveredValue / dynamicSummary.totalPOValue) * 100).toFixed(0)}% delivered
                                    </span>
                                )}
                            </div>

                            {/* Total Invoice Amount */}
                            <div className="bg-gradient-to-br from-teal-50 to-cyan-50/50 dark:from-teal-950/40 dark:to-cyan-950/30 rounded-lg p-3 border border-teal-100 dark:border-teal-900/50">
                                <dt className="text-[10px] font-medium text-teal-600/80 dark:text-teal-400/80 uppercase tracking-wide mb-1 flex items-center gap-1">
                                    <Receipt className="h-3 w-3" />
                                    Total Invoice Amt
                                </dt>
                                <dd className="text-xl font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                                    {formatToRoundedIndianRupee(dynamicSummary.totalInvoiceAmount)}
                                </dd>
                                {dynamicSummary.totalPOValue > 0 && (
                                    <span className="text-[10px] text-teal-500/70 dark:text-teal-500/60 mt-0.5 block">
                                        {((dynamicSummary.totalInvoiceAmount / dynamicSummary.totalPOValue) * 100).toFixed(0)}% of PO value
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Attachment Counts Row */}
                        <div className={cn(
                            "grid gap-3",
                            dynamicSummary.mismatchCount > 0 ? "grid-cols-4" : "grid-cols-3"
                        )}>
                            {/* Invoices */}
                            <div className="bg-gradient-to-br from-sky-50 to-blue-50/50 dark:from-sky-950/40 dark:to-blue-950/30 rounded-lg p-3 border border-sky-100 dark:border-sky-900/50">
                                <dt className="text-[10px] font-medium text-sky-600/80 dark:text-sky-400/80 uppercase tracking-wide mb-1 flex items-center gap-1">
                                    <FileText className="h-3 w-3" />
                                    Invoices
                                </dt>
                                <dd className="text-xl font-bold text-sky-700 dark:text-sky-400 tabular-nums">
                                    {dynamicSummary.totalInvoiceCount}
                                </dd>
                            </div>

                            {/* Delivery Challans */}
                            <div className="bg-gradient-to-br from-amber-50 to-orange-50/50 dark:from-amber-950/40 dark:to-orange-950/30 rounded-lg p-3 border border-amber-100 dark:border-amber-900/50">
                                <dt className="text-[10px] font-medium text-amber-600/80 dark:text-amber-400/80 uppercase tracking-wide mb-1 flex items-center gap-1">
                                    <Truck className="h-3 w-3" />
                                    Delivery Challans
                                </dt>
                                <dd className="text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                                    {dynamicSummary.totalDCCount}
                                </dd>
                            </div>

                            {/* MIRs */}
                            <div className="bg-gradient-to-br from-purple-50 to-violet-50/50 dark:from-purple-950/40 dark:to-violet-950/30 rounded-lg p-3 border border-purple-100 dark:border-purple-900/50">
                                <dt className="text-[10px] font-medium text-purple-600/80 dark:text-purple-400/80 uppercase tracking-wide mb-1 flex items-center gap-1">
                                    <ClipboardCheck className="h-3 w-3" />
                                    Material Inspection Reports
                                </dt>
                                <dd className="text-xl font-bold text-purple-700 dark:text-purple-400 tabular-nums">
                                    {dynamicSummary.totalMIRCount}
                                </dd>
                            </div>

                            {/* Mismatch Warning - Only shows when there are mismatches */}
                            {dynamicSummary.mismatchCount > 0 && (
                                <div className={cn(
                                    "rounded-lg p-3 border transition-colors",
                                    showOnlyMismatched
                                        ? "bg-gradient-to-br from-red-100 to-rose-100/80 dark:from-red-950/60 dark:to-rose-950/50 border-red-300 dark:border-red-800/70"
                                        : "bg-gradient-to-br from-red-50 to-rose-50/50 dark:from-red-950/40 dark:to-rose-950/30 border-red-200 dark:border-red-900/50"
                                )}>
                                    <dt className="text-[10px] font-medium text-red-600/80 dark:text-red-400/80 uppercase tracking-wide mb-1 flex items-center gap-1">
                                        <AlertTriangle className="h-3 w-3" />
                                        Mismatched
                                    </dt>
                                    <dd className="text-xl font-bold text-red-600 dark:text-red-400 tabular-nums">
                                        {dynamicSummary.mismatchCount}
                                    </dd>
                                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-red-200/50 dark:border-red-800/30">
                                        <Label
                                            htmlFor="mismatch-filter"
                                            className="text-[10px] text-red-500/80 dark:text-red-400/70 cursor-pointer"
                                        >
                                            Show only
                                        </Label>
                                        <Switch
                                            id="mismatch-filter"
                                            checked={showOnlyMismatched}
                                            onCheckedChange={handleToggleMismatchFilter}
                                            className="data-[state=checked]:bg-red-500 h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3"
                                        />
                                    </div>
                                </div>
                            )}
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
                {isLoadingInitialData && !allPOData ? (
                    <LoadingFallback />
                ) : (
                    <DataTable<POAttachmentReconcileRowData>
                        table={table}
                        columns={tableColumnsToDisplay}
                        isLoading={isLoadingOverall}
                        error={overallError as Error | null}
                        totalCount={filteredRowCount}
                        searchFieldOptions={PO_ATTACHMENT_RECONCILE_SEARCHABLE_FIELDS}
                        selectedSearchField={selectedSearchField}
                        onSelectedSearchFieldChange={setSelectedSearchField}
                        searchTerm={searchTerm}
                        onSearchTermChange={setSearchTerm}
                        facetFilterOptions={facetOptionsConfig}
                        dateFilterColumns={PO_ATTACHMENT_RECONCILE_DATE_COLUMNS}
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
