import { DataTable } from "@/components/data-table/data-table";
import { POReportRowData, usePOReportsData } from "../hooks/usePOReportsData";
import React, { useMemo } from "react";
import { poColumns } from "./columns/poColumns";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { ReportType, useReportStore } from "../store/useReportStore";
import { parseNumber } from "@/utils/parseNumber";
import { toast } from "@/components/ui/use-toast";
import { exportToCsv } from "@/utils/exportToCsv";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { Projects } from "@/types/NirmaanStack/Projects";
import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";

interface SelectOption { label: string; value: string; }

export default function POReports() {

    const { reportData, isLoading, error } = usePOReportsData();

    const selectedReportType = useReportStore((state) => state.selectedReportType);

    const columns = React.useMemo(() => poColumns, []);

    const delta = 100; // Small tolerance for floating point comparison

    // --- Supporting Data Fetches (Keep these for lookups/calculations) ---
    const projectsFetchOptions = getProjectListOptions();

    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );
    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useVendorsList({ vendorTypes: ["Service", "Material", "Material & Service"] });

    const projectOptions = useMemo<SelectOption[]>(() => projects?.map(p => ({ label: p.project_name, value: p.name })) || [], [projects]);
    
    const vendorOptions = useMemo<SelectOption[]>(() => vendors?.map(v => ({ label: v.vendor_name, value: v.name })) || [], [vendors]);

    const getPOExportData = (
        reportType: ReportType,
        allData: POReportRowData[]
    ): POReportRowData[] => {
        if (!allData) return [];

        switch (reportType) {
            case 'Pending Invoices':
                // Total Invoice Amount is less than Total PO/SR Amount (use small tolerance for floating point)
                return allData.filter(row => parseNumber(row.invoiceAmount) < parseNumber(row.totalAmount) - delta);
            case 'PO with Excess Payments':
                // Amount Paid is greater than Total PO/SR Amount (use small tolerance)
                return allData.filter(row => parseNumber(row.amountPaid) > parseNumber(row.totalAmount) + delta);
            default:
                // Should not happen if selection is restricted, but return all as fallback
                return allData;
        }
    };

    const filteredReportData = useMemo(() => getPOExportData(selectedReportType, reportData || []), [reportData, selectedReportType]);

    const exportFileNamePrefix = `po_report`; // Base prefix

        // --- New Export Handler ---
    const handleExport = () => {
        if (isLoading || reportData?.length === 0) {
             toast({ title: "Export", description: "No data available to export or still loading.", variant: "default" });
            return;
        }
    
        try {
            // 1. Get the data specifically prepared for this export type
            //    We pass ALL original data (`data` prop) to the getter,
            //    so it can apply report-type filtering before any table filtering.
            const dataToExportRaw = getPOExportData(selectedReportType, reportData || []);
    
            // 2. OPTIONAL: Apply table's current filters (search, column filters) to the report-specific data
            //    This is more complex as it requires replicating table filtering logic outside the table.
            //    Easier approach: Export based on Report Type filter applied to the *full* dataset.
            //    Let's stick to the easier approach for now: export data filtered *only* by the report type.
            const dataToExport = dataToExportRaw;
    
             // OR, if you want to export exactly what's visible *after* table filters:
             // const visibleFilteredData = getExportData(selectedReportType, allFilteredRows); // Apply report type filter to table-filtered data
    
            if (!dataToExport || dataToExport.length === 0) {
                 toast({ title: "Export", description: `No data found matching report type: ${selectedReportType}`, variant: "default" });
                 return;
            }
    
            // 3. Determine filename based on prefix and maybe the report type
             const finalFileName = `${exportFileNamePrefix}${selectedReportType ? `_${selectedReportType.replace(/\s+/g, '_')}` : ''}`;
    
    
            // 4. Call the generic export utility
            exportToCsv(finalFileName, dataToExport, columns);
    
            toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success"});
    
        } catch (error) {
             console.error("Export failed:", error);
             toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive"});
        }
    };

    const combinedError = projectsError || vendorsError || error;
    const combinedLoading = projectsLoading || vendorsLoading || isLoading;

    if (combinedError) {
        // console.error("Error fetching PO/SR reports data:", error);
        return (
            <AlertDestructive error={combinedError} />
        )
    }

    return (
        <div className="space-y-4">
            {combinedLoading ? (
                <LoadingFallback />
            ) : (
                <DataTable
                    columns={columns}
                    project_values={projectOptions}
                    vendorOptions={vendorOptions}
                    data={filteredReportData || []} // Ensure data is always an array
                    // Add features like filtering, search, pagination if needed
                    loading={isLoading}
                    onExport={handleExport}
                    // exportFileNamePrefix={exportFileNamePrefix}
                    // getExportData={getPOExportData}
                />
            )}
        </div>
    );
}