import { useMemo, useCallback } from "react";
import { DataTable } from "@/components/data-table/new-data-table"; // Use new-data-table
import { SRReportRowData, useSRReportsData } from "../hooks/useSRReportsData"; // Your existing data hook
import { srColumns } from "./columns/srColumns"; // Column definitions
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { SROption, useReportStore } from "../store/useReportStore";
import { parseNumber } from "@/utils/parseNumber";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { Projects } from "@/types/NirmaanStack/Projects";
import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import {
    SR_REPORTS_SEARCHABLE_FIELDS,
    SR_REPORTS_DATE_COLUMNS
} from "../config/srReportsTable.config";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "@/components/ui/use-toast";
import { exportToCsv } from "@/utils/exportToCsv";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

interface SelectOption { label: string; value: string; }

export default function SRReports() {
    // 1. Fetch the superset of SR data.
    // `useSRReportsData` should return SRReportRowData[] with pre-calculated fields.
    const {
        reportData: allSRsForReports,
        isLoading: isLoadingInitialData,
        error: initialDataError,
    } = useSRReportsData();

    const selectedReportType = useReportStore((state) => state.selectedReportType as SROption | null);
    const tableColumnsToDisplay = useMemo(() => srColumns, []); // srColumns are static for now
    const delta = 100;

    // 2. Perform report-specific dynamic filtering on the client side.
    const currentDisplayData = useMemo(() => {
        if (!allSRsForReports) return [];
        if (!selectedReportType || !['Pending Invoices', 'PO with Excess Payments'].includes(selectedReportType)) {
            // If not a valid SR report type, show no data.
            return [];
        }

        let filtered: SRReportRowData[];
        switch (selectedReportType) {
            case 'Pending Invoices':
                filtered = allSRsForReports.filter(row => {
                    const srDoc = row.originalDoc; // SRReportRowData.originalDoc is ServiceRequests
                    // Assuming 'Approved' SRs are candidates for invoicing.
                    if (srDoc.status === 'Approved') {
                        // Using pre-calculated fields from SRReportRowData
                        return parseNumber(row.invoiceAmount) < parseNumber(row.totalAmount) - delta;
                    }
                    return false;
                });
                break;
            case 'PO with Excess Payments': // This value represents "Excess Payments for SRs"
                filtered = allSRsForReports.filter(row => {
                    const srDoc = row.originalDoc;
                    if (srDoc.status === 'Approved') {
                        // Using pre-calculated fields from SRReportRowData
                        return parseNumber(row.amountPaid) > parseNumber(row.totalAmount) + delta;
                    }
                    return false;
                });
                break;
            default:
                filtered = [];
        }
        return filtered;
    }, [allSRsForReports, selectedReportType, delta]);

    // 3. Initialize useServerDataTable in clientData mode
    const {
        table,
        isLoading: isTableHookLoading,
        error: tableHookError,
        totalCount,
        searchTerm, setSearchTerm,
        selectedSearchField, setSelectedSearchField,
    } = useServerDataTable<SRReportRowData>({ // Generic is SRReportRowData
        doctype: `SRReportsClientFilteredVirtual_${selectedReportType || 'none'}`, // Virtual name
        columns: tableColumnsToDisplay,
        fetchFields: [], // Not used
        searchableFields: SR_REPORTS_SEARCHABLE_FIELDS,
        clientData: currentDisplayData,
        clientTotalCount: currentDisplayData.length,
        urlSyncKey: `sr_reports_table_client_${selectedReportType?.toString().replace(/\s+/g, '_') || 'all'}`,
        defaultSort: 'creation desc',
        enableRowSelection: false,
        // No `meta` needed as SRReportRowData has all display fields.
    });

    // Supporting data for faceted filters
    const projectsFetchOptions = getProjectListOptions();
    const { data: projects, isLoading: projectsUiLoading, error: projectsUiError } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, queryKeys.projects.list(projectsFetchOptions)
    );
    const { data: vendors, isLoading: vendorsUiLoading, error: vendorsUiError } = useVendorsList({ vendorTypes: ["Service", "Material", "Material & Service"] });

    const projectFacetOptions = useMemo<SelectOption[]>(() => projects?.map(p => ({ label: p.project_name, value: p.project_name })) || [], [projects]);
    const vendorFacetOptions = useMemo<SelectOption[]>(() => vendors?.map(v => ({ label: v.vendor_name, value: v.vendor_name })) || [], [vendors]);

    const facetOptionsConfig = useMemo(() => ({
        project: { title: "Project", options: projectFacetOptions },
        vendor_name: { title: "Vendor", options: vendorFacetOptions }
    }), [projectFacetOptions, vendorFacetOptions]);

    const exportFileName = useMemo(() => {
        let reportTypeString = String(selectedReportType);
        if (reportTypeString === 'PO with Excess Payments') {
            reportTypeString = 'SR_Excess_Payments';
        }
        const prefix = "sr_report";
        return `${prefix}${reportTypeString ? `_${reportTypeString.replace(/\s+/g, '_')}` : ''}`;
    }, [selectedReportType]);

    const handleCustomExport = useCallback(() => {
        if (!currentDisplayData || currentDisplayData.length === 0) {
            toast({ title: "Export", description: "No data available to export for the selected report type.", variant: "default" });
            return;
        }
        const dataToExport = currentDisplayData.map(row => ({
            sr_id: row.name,
            creation: formatDate(row.creation),
            project_name: row.projectName || row.project,
            vendor_name: row.vendorName || row.vendor,
            total_sr_amt: formatToRoundedIndianRupee(row.totalAmount),
            total_invoice_amt: formatToRoundedIndianRupee(row.invoiceAmount),
            amt_paid: formatToRoundedIndianRupee(row.amountPaid),
            status: row.originalDoc.status,
        }));

        const exportColumnsConfig: ColumnDef<any, any>[] = [
            { header: "#SR", accessorKey: "sr_id" },
            { header: "Date Created", accessorKey: "creation" },
            { header: "Project", accessorKey: "project_name" },
            { header: "Vendor", accessorKey: "vendor_name" },
            { header: "Total SR Amt", accessorKey: "total_sr_amt" },
            { header: "Total Invoice Amt", accessorKey: "total_invoice_amt" },
            { header: "Amt Paid", accessorKey: "amt_paid" },
            { header: "SR Status", accessorKey: "status" },
        ];

        try {
            exportToCsv(exportFileName, dataToExport, exportColumnsConfig);
            toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success" });
        } catch (e) {
            console.error("SR Export failed:", e);
            toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive" });
        }
    }, [currentDisplayData, exportFileName]);

    const isLoadingOverall = isLoadingInitialData || projectsUiLoading || vendorsUiLoading || isTableHookLoading;
    const overallError = initialDataError || projectsUiError || vendorsUiError || tableHookError;

    if (overallError) {
        return <AlertDestructive error={overallError as Error} />;
    }

    return (
        <div className="space-y-4">
            {isLoadingInitialData && !allSRsForReports ? (
                <LoadingFallback />
            ) : (
                <DataTable<SRReportRowData>
                    table={table}
                    columns={tableColumnsToDisplay}
                    isLoading={isLoadingOverall}
                    error={overallError as Error | null}
                    totalCount={totalCount} // From useServerDataTable, reflects currentDisplayData.length
                    searchFieldOptions={SR_REPORTS_SEARCHABLE_FIELDS}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    facetFilterOptions={facetOptionsConfig}
                    dateFilterColumns={SR_REPORTS_DATE_COLUMNS}
                    showExportButton={true}
                    onExport={handleCustomExport}
                    exportFileName={exportFileName}
                    showRowSelection={false}
                />
            )}
        </div>
    );
}