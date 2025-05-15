import { DataTable } from "@/components/data-table/data-table";
import { ProcessedProject, useProjectReportsData } from "../hooks/useProjectReportsData";
import React from "react";
import { projectColumns } from "./columns/projectColumns";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";
import { ReportType, useReportStore } from "../store/useReportStore";
// import { useServerDataTable } from "@/hooks/useServerDataTable";
// import { PROJECT_REPORTS_DATE_COLUMNS, PROJECT_REPORTS_SEARCHABLE_FIELDS } from "../config/projectReportsTable.config";
import { toast } from "@/components/ui/use-toast";
import { exportToCsv } from "@/utils/exportToCsv";
// import { DataTable } from "@/components/data-table/new-data-table";

export default function ProjectReports() {
    const { processedProjects, isLoading: isDataProcessing, error: dataProcessingError } = useProjectReportsData();

    const columns = React.useMemo(() => projectColumns, []);

    // Get selected report type from Zustand store (for default export filename)
    const selectedReportType = useReportStore((state) => state.selectedReportType as ReportType);

    // Define the data getter function for project reports
    const getProjectExportData = (
          reportType: ReportType,
          allData: ProcessedProject[]
      ): ProcessedProject[] => {
          // For "Cash Sheet" (the only type for projects currently), export all data.
          if (reportType === 'Cash Sheet') {
              return allData;
          }
          // Add logic here if more project report types are introduced
          return allData; // Default: return all
      };


    // --- useServerDataTable Hook for UI State Management ---
    // This hook will now primarily manage client-side table state (pagination, sorting, client-side search)
    // because we provide `clientData`.
    // const {
    //     table,
    //     data: tableDisplayData, // This will be the paginated/sorted subset of processedProjects
    //     totalCount, // This will be processedProjects.length if clientTotalCount not provided
    //     isLoading: isTableHookLoading, // Should be false if clientData is used
    //     error: tableHookError,
    //     searchTerm, setSearchTerm,
    //     selectedSearchField, setSelectedSearchField,
    //     isRowSelectionActive,
    //     refetch, // Will refetch via useProjectReportsData if we wire it up
    // } = useServerDataTable<ProcessedProject>({
    //     doctype: "ProjectReportsVirtual", // Virtual doctype name, not a real one
    //     columns: projectColumns,          // Your display columns
    //     fetchFields: [],                  // Not used when clientData is provided
    //     searchableFields: PROJECT_REPORTS_SEARCHABLE_FIELDS, // For client-side search config
    //     clientData: processedProjects || [], // Provide the processed data
    //     clientTotalCount: processedProjects?.length || 0,
    //     urlSyncKey: "project_reports",    // URL key for this specific report table
    //     defaultSort: 'creation desc',     // Default client-side sort
    //     enableRowSelection: false,         // Enable selection for export
    // });

    // if (error) {
    //     console.error("Error fetching project reports data:", error);
    //     // Avoid infinite toasts if error persists
    //     // toast({ title: "Error", description: "Could not load project reports.", variant: "destructive" });
    //     return (
    //          <Alert variant="destructive" className="m-4">
    //             <Terminal className="h-4 w-4" />
    //             <AlertTitle>Error Loading Project Reports</AlertTitle>
    //             <AlertDescription>
    //                 Failed to fetch the necessary data. Please try refreshing the page or contact support if the problem persists.
    //                 <br />
    //                 <span className="text-xs">{error.message}</span>
    //             </AlertDescription>
    //         </Alert>
    //     )
    // }


    const exportFileNamePrefix = "projects_cash_sheet";
    // --- New Export Handler ---
  const handleExport = () => {
    if (isDataProcessing || processedProjects?.length === 0) {
         toast({ title: "Export", description: "No data available to export or still loading.", variant: "default" });
        return;
    }

    try {
        // 1. Get the data specifically prepared for this export type
        //    We pass ALL original data (`data` prop) to the getter,
        //    so it can apply report-type filtering before any table filtering.
        const dataToExportRaw = getProjectExportData(selectedReportType, processedProjects || []);

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

    if (dataProcessingError) {
        // Display prominent error from data fetching/processing
        return (
             <Alert variant="destructive" className="m-4">
                <Terminal className="h-4 w-4" />
                <AlertTitle>Error Loading Project Reports</AlertTitle>
                <AlertDescription>
                    Failed to fetch or process project data: {dataProcessingError?.message}
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <div className="space-y-4">
            {isDataProcessing ? (
                <LoadingFallback />
            ) : (
                <DataTable
                    columns={columns}
                    data={processedProjects || []} // Ensure data is always an array
                    // Add features like filtering, search, pagination to DataTable if implemented
                    // E.g., showSearch="project_name"
                    loading={isDataProcessing}
                    onExport={handleExport}
                />
            )}
        </div>
    );
}