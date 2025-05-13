import { DataTable } from "@/components/data-table/data-table";
import { POReportRowData, usePOReportsData } from "../hooks/usePOReportsData";
import React, { useMemo } from "react";
import { poColumns } from "./columns/poColumns";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";
import { ReportType, useReportStore } from "../store/useReportStore";
import { parseNumber } from "@/utils/parseNumber";
import { toast } from "@/components/ui/use-toast";
import { exportToCsv } from "@/utils/exportToCsv";

export default function POReports() {

    const { reportData, isLoading, error } = usePOReportsData();

    const selectedReportType = useReportStore((state) => state.selectedReportType);
    
    const columns = React.useMemo(() => poColumns, []);

    const getPOExportData = (
        reportType: ReportType,
        allData: POReportRowData[]
    ): POReportRowData[] => {
        if (!allData) return [];

        switch (reportType) {
            case 'Pending Invoices':
                // Total Invoice Amount is less than Total PO/SR Amount (use small tolerance for floating point)
                return allData.filter(row => parseNumber(row.invoiceAmount) < parseNumber(row.totalAmount) - 0.001);
            case 'Pending Amendments':
                 // Amount Paid is greater than Total PO/SR Amount (use small tolerance)
                return allData.filter(row => parseNumber(row.amountPaid) > parseNumber(row.totalAmount) + 0.001);
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

    if (error) {
        console.error("Error fetching PO/SR reports data:", error);
        return (
             <Alert variant="destructive" className="m-4">
                <Terminal className="h-4 w-4" />
                <AlertTitle>Error Loading PO/SR Reports</AlertTitle>
                <AlertDescription>
                    Failed to fetch the necessary data. Please try refreshing the page or contact support.
                    <br />
                    <span className="text-xs">{error?.message}</span>
                </AlertDescription>
            </Alert>
        )
    }

    return (
        <div className="space-y-4">
            {isLoading ? (
                <LoadingFallback />
            ) : (
                <DataTable
                    columns={columns}
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