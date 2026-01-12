import { useMemo, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table/new-data-table";
import { PO2BReconcileRowData, usePO2BReconcileData } from "../hooks/usePO2BReconcileData";
import { po2BReconcileColumns } from "./columns/po2BReconcileColumns";
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
    PO_2B_RECONCILE_SEARCHABLE_FIELDS,
    PO_2B_RECONCILE_DATE_COLUMNS,
    PO_2B_STATUS_OPTIONS,
} from "../config/po2BReconcileTable.config";
import { toast } from "@/components/ui/use-toast";
import { exportToCsv } from "@/utils/exportToCsv";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { Card, CardContent } from "@/components/ui/card";
import { ColumnDef } from "@tanstack/react-table";

interface SelectOption {
    label: string;
    value: string;
}

export default function PO2BReconcileReport() {
    // Fetch 2B reconcile data
    const {
        reportData: allInvoicesData,
        isLoading: isLoadingInitialData,
        error: initialDataError,
        summary,
    } = usePO2BReconcileData();

    // Use the column definitions
    const tableColumnsToDisplay = useMemo(() => po2BReconcileColumns, []);

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
    } = useServerDataTable<PO2BReconcileRowData>({
        doctype: `PO2BReconcileReportVirtual`,
        columns: tableColumnsToDisplay,
        fetchFields: [],
        searchableFields: PO_2B_RECONCILE_SEARCHABLE_FIELDS,
        clientData: allInvoicesData || [],
        clientTotalCount: allInvoicesData?.length || 0,
        urlSyncKey: `po_2b_reconcile_table`,
        defaultSort: "invoiceDate desc",
        enableRowSelection: false,
    });

    const fullyFilteredData = table
        .getFilteredRowModel()
        .rows.map((row) => row.original);

    const filteredRowCount = table.getFilteredRowModel().rows.length;

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
            is2bActivated: { title: "2B Status", options: PO_2B_STATUS_OPTIONS },
        }),
        [projectFacetOptions, vendorFacetOptions]
    );

    const exportFileName = "po_2b_reconcile_report";

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
            po_id: row.poId,
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
            { header: "PO ID", accessorKey: "po_id" },
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
            {summary && (
                <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
                    <CardContent className="pt-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="text-center">
                                <p className="text-sm text-gray-600">Total Invoices</p>
                                <p className="text-2xl font-bold text-blue-700">{summary.totalInvoices}</p>
                            </div>
                            <div className="text-center">
                                <p className="text-sm text-gray-600">Total Amount</p>
                                <p className="text-2xl font-bold text-green-700">
                                    {formatToRoundedIndianRupee(summary.totalAmount)}
                                </p>
                            </div>
                            <div className="text-center">
                                <p className="text-sm text-gray-600">2B Reconciled</p>
                                <p className="text-2xl font-bold text-emerald-700">{summary.total2bActivated}</p>
                            </div>
                            <div className="text-center">
                                <p className="text-sm text-gray-600">Pending 2B</p>
                                <p className="text-2xl font-bold text-amber-700">{summary.pending2bActivation}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

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
                    <DataTable<PO2BReconcileRowData>
                        table={table}
                        columns={tableColumnsToDisplay}
                        isLoading={isLoadingOverall}
                        error={overallError as Error | null}
                        totalCount={filteredRowCount}
                        searchFieldOptions={PO_2B_RECONCILE_SEARCHABLE_FIELDS}
                        selectedSearchField={selectedSearchField}
                        onSelectedSearchFieldChange={setSelectedSearchField}
                        searchTerm={searchTerm}
                        onSearchTermChange={setSearchTerm}
                        facetFilterOptions={facetOptionsConfig}
                        dateFilterColumns={PO_2B_RECONCILE_DATE_COLUMNS}
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
