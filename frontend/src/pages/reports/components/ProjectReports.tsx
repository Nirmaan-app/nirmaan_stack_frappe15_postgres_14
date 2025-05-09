import { DataTable } from "@/components/data-table/data-table";
import { ProcessedProject, useProjectReportsData } from "../hooks/useProjectReportsData";
import React from "react";
import { projectColumns } from "./columns/projectColumns";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";
import { ReportType } from "../store/useReportStore";

export default function ProjectReports() {
    const { processedProjects, isLoading, error } = useProjectReportsData();

    const columns = React.useMemo(() => projectColumns, []);

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

    if (error) {
        console.error("Error fetching project reports data:", error);
        // Avoid infinite toasts if error persists
        // toast({ title: "Error", description: "Could not load project reports.", variant: "destructive" });
        return (
             <Alert variant="destructive" className="m-4">
                <Terminal className="h-4 w-4" />
                <AlertTitle>Error Loading Project Reports</AlertTitle>
                <AlertDescription>
                    Failed to fetch the necessary data. Please try refreshing the page or contact support if the problem persists.
                    <br />
                    <span className="text-xs">{error.message}</span>
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
                    data={processedProjects || []} // Ensure data is always an array
                    // Add features like filtering, search, pagination to DataTable if implemented
                    // E.g., showSearch="project_name"
                    loading={isLoading}
                    exportFileNamePrefix="projects_cash_sheet"
                    getExportData={getProjectExportData}
                />
            )}
        </div>
    );
}