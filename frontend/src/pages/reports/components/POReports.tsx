import { DataTable } from "@/components/data-table/data-table";
import { POReportRowData, usePOReportsData } from "../hooks/usePOReportsData";
import React, { useMemo } from "react";
import { poColumns } from "./columns/poColumns";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";
import { ReportType, useReportStore } from "../store/useReportStore";
import { parseNumber } from "@/utils/parseNumber";

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
                    exportFileNamePrefix={exportFileNamePrefix}
                    getExportData={getPOExportData}
                />
            )}
        </div>
    );
}