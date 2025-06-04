import { useMemo, useCallback } from "react"; // Added useCallback
import { DataTable } from "@/components/data-table/new-data-table";
import { Projects } from "@/types/NirmaanStack/Projects"; // Base Project type
import { useProjectReportCalculations } from "../hooks/useProjectReportCalculations"; // Updated hook
import { formatValueToLakhsString, getProjectColumns } from "./columns/projectColumns"; // Columns are now from a function
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { ReportType, useReportStore } from "../store/useReportStore";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import {
    PROJECT_REPORTS_SEARCHABLE_FIELDS,
    PROJECT_REPORTS_DATE_COLUMNS,
} from "../config/projectReportsTable.config"; // Make sure this file exists and is correct
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { toast } from "@/components/ui/use-toast"; // For custom export
import { exportToCsv } from "@/utils/exportToCsv"; // For custom export
import { parseNumber } from "@/utils/parseNumber"; // For custom export credit calc
import { formatDate } from "@/utils/FormatDate";

// Define base fields for Projects doctype fetch
const projectBaseFields: (keyof Projects)[] = [
    'name', 'project_name', 'project_value', 'creation', 'modified', 'status',
];
const projectReportListOptions = () => ({
    fields: projectBaseFields as string[],
});

export default function ProjectReports() {
    const {
        getProjectCalculatedFields,
        isLoadingGlobalDeps,
        globalDepsError,
    } = useProjectReportCalculations();

    const selectedReportType = useReportStore((state) => state.selectedReportType as ReportType); // Currently only 'Cash Sheet'

    const tableColumns = useMemo(() => getProjectColumns(), []); // Get column definitions

    const {
        table,
        data: projectsData, // This is Projects[] from the backend via useServerDataTable
        isLoading: isProjectsLoading,
        error: projectsError,
        totalCount,
        searchTerm, setSearchTerm,
        selectedSearchField, setSelectedSearchField,
    } = useServerDataTable<Projects>({ // Generic is now Projects
        doctype: "Projects",
        columns: tableColumns, // Pass the generated columns
        fetchFields: projectReportListOptions().fields as string[],
        searchableFields: PROJECT_REPORTS_SEARCHABLE_FIELDS, // For client-side search
        urlSyncKey: "project_reports_cash_sheet_table", // Make specific if report type changes columns
        defaultSort: 'creation desc',
        enableRowSelection: false,
        meta: {
            getProjectCalculatedFields,
            isLoadingGlobalDeps
        }
    });

    const exportFileName = useMemo(() => {
        // Since there's only "Cash Sheet", the name is fixed for now.
        // If other project report types are added, this logic would need selectedReportType.
        return "projects_report_Cash_Sheet";
    }, [selectedReportType]);

    // Custom export handler to include calculated fields
    const handleCustomExport = useCallback(() => {
        if (!projectsData || projectsData.length === 0) {
            toast({ title: "Export", description: "No data available to export.", variant: "default" });
            return;
        }
        if (isLoadingGlobalDeps) {
            toast({ title: "Export", description: "Dependency data is still loading. Please wait.", variant: "default" });
            return;
        }

        const dataToExport = projectsData.map(project => {
            const calculated = getProjectCalculatedFields(project.name);
            const credit = (calculated && calculated.totalInvoiced != null && calculated.totalInflow != null)
                ? parseNumber(calculated.totalInvoiced) - parseNumber(calculated.totalInflow)
                : undefined;

            return {
                // Spread base project properties you want to export
                project_name: project.project_name,
                creation: formatDate(project.creation), // Format dates for export
                project_value_lakhs: formatValueToLakhsString(project.project_value),
                // Add calculated fields, formatted for export
                totalInvoiced_lakhs: calculated ? formatValueToLakhsString(calculated.totalInvoiced) : 'N/A',
                totalInflow_lakhs: calculated ? formatValueToLakhsString(calculated.totalInflow) : 'N/A',
                totalOutflow_lakhs: calculated ? formatValueToLakhsString(calculated.totalOutflow) : 'N/A',
                totalCredit_lakhs: credit !== undefined ? formatValueToLakhsString(credit) : 'N/A',
            };
        });

        // Define columns specifically for export or ensure exportToCsv can use simplified headers
        const exportColumns = [
            { header: "Project Name", accessorKey: "project_name" },
            { header: "Creation Date", accessorKey: "creation" },
            { header: "Value (excl. GST)", accessorKey: "project_value_lakhs" },
            { header: "Total PO+SR (incl. GST)", accessorKey: "totalInvoiced_lakhs" },
            { header: "Inflow", accessorKey: "totalInflow_lakhs" },
            { header: "Outflow", accessorKey: "totalOutflow_lakhs" },
            { header: "Credit Outstanding", accessorKey: "totalCredit_lakhs" },
        ];

        try {
            exportToCsv(exportFileName, dataToExport, exportColumns as ColumnDef<any, any>[]); // Adjust columns for exportToCsv
            toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success" });
        } catch (e) {
            console.error("Export failed:", e);
            toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive" });
        }

    }, [projectsData, getProjectCalculatedFields, isLoadingGlobalDeps, exportFileName, tableColumns]);


    const isLoading = isLoadingGlobalDeps || isProjectsLoading;
    const error = globalDepsError || projectsError;

    if (error) {
        return <AlertDestructive error={error as Error} />;
    }

    return (
        <div className="space-y-4">
            {(isLoading && !projectsData?.length) ? (
                <LoadingFallback />
            ) : (
                <DataTable<Projects>
                    table={table}
                    columns={tableColumns}
                    isLoading={isLoading} // Overall loading state
                    error={error as Error | null}
                    totalCount={totalCount}
                    searchFieldOptions={PROJECT_REPORTS_SEARCHABLE_FIELDS}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    dateFilterColumns={PROJECT_REPORTS_DATE_COLUMNS}
                    showExportButton={true}
                    onExport={handleCustomExport} // Use the custom export handler
                    exportFileName={exportFileName} // Still useful for the handler
                    showRowSelection={false}
                />
            )}
        </div>
    );
}