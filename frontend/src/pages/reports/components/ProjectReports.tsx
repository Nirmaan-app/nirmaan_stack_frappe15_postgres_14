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

import { InflowReportTable } from './InflowReportTable';

// Define base fields for Projects doctype fetch
const projectBaseFields: (keyof Projects)[] = [
    'name', 'project_name', 'project_value', 'creation', 'modified', 'status',
];
const projectReportListOptions = () => ({
    fields: projectBaseFields as string[],
});

// Component for the existing Cash Sheet report
function CashSheetReport() {
    const {
        getProjectCalculatedFields,
        isLoadingGlobalDeps,
        globalDepsError,
    } = useProjectReportCalculations();

    const tableColumns = useMemo(() => getProjectColumns(), []);

    const {
        table,
        data: projectsData,
        isLoading: isProjectsLoading,
        error: projectsError,
        totalCount,
        searchTerm, setSearchTerm,
        selectedSearchField, setSelectedSearchField,
    } = useServerDataTable<Projects>({
        doctype: "Projects",
        columns: tableColumns,
        fetchFields: ['name', 'project_name', 'project_value', 'creation', 'modified', 'status'],
        searchableFields: PROJECT_REPORTS_SEARCHABLE_FIELDS,
        urlSyncKey: "project_reports_cash_sheet_table",
        defaultSort: 'creation desc',
        meta: { getProjectCalculatedFields, isLoadingGlobalDeps }
    });

    const exportFileName = "projects_report_Cash_Sheet";

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
            const credit = undefined;
            return {
                project_name: project.project_name,
                creation: formatDate(project.creation),
                project_value_lakhs: formatValueToLakhsString(project.project_value),
                totalInvoiced_lakhs: calculated ? formatValueToLakhsString(calculated.totalInvoiced) : 'N/A',
                totalPoSrInvoiced_lakhs: calculated ? formatValueToLakhsString(calculated.totalPoSrInvoiced) : 'N/A',
                totalProjectInvoiced_lakhs: calculated ? formatValueToLakhsString(calculated.totalProjectInvoiced) : 'N/A',
                totalInflow_lakhs: calculated ? formatValueToLakhsString(calculated.totalInflow) : 'N/A',
                totalOutflow_lakhs: calculated ? formatValueToLakhsString(calculated.totalOutflow) : 'N/A',
                totalCredit_lakhs: credit !== undefined ? formatValueToLakhsString(credit) : 'N/A',
            };
        });
        const exportColumns = [
            { header: "Project Name", accessorKey: "project_name" },
            { header: "Creation Date", accessorKey: "creation" },
            { header: "Value (excl. GST)", accessorKey: "project_value_lakhs" },
            { header: "Total PO+SR Value(incl. GST)", accessorKey: "totalInvoiced_lakhs" },
            { header: "Total PO+SR Invoiced (incl. GST)", accessorKey: "totalPoSrInvoiced_lakhs" },
            { header: "Total Project Invoiced (incl. GST)", accessorKey: "totalProjectInvoiced_lakhs" },
            { header: "Inflow", accessorKey: "totalInflow_lakhs" },
            { header: "Outflow", accessorKey: "totalOutflow_lakhs" },
            { header: "Credit Outstanding", accessorKey: "totalCredit_lakhs" },
        ];

        try {
            exportToCsv(exportFileName, dataToExport, exportColumns as ColumnDef<any, any>[]);
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

    if (isLoading && !projectsData?.length) {
        return <LoadingFallback />;
    }

    return (
        <DataTable<Projects>
            table={table}
            columns={tableColumns}
            isLoading={isLoading}
            error={error as Error | null}
            totalCount={totalCount}
            searchFieldOptions={PROJECT_REPORTS_SEARCHABLE_FIELDS}
            selectedSearchField={selectedSearchField}
            onSelectedSearchFieldChange={setSelectedSearchField}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            dateFilterColumns={PROJECT_REPORTS_DATE_COLUMNS}
            showExportButton={true}
            onExport={handleCustomExport}
            exportFileName={exportFileName}
            showRowSelection={false}
        />
    );
}

export default function ProjectReports() {
    const selectedReportType = useReportStore((state) => state.selectedReportType as ReportType);

    // --- MODIFICATION 4: Conditionally render the correct report component ---
    if (selectedReportType === 'Inflow Report') {
        return <InflowReportTable />;
    }

    // Default to Cash Sheet report if it's selected or if no specific project report is chosen
    if (selectedReportType === 'Cash Sheet') {
        return <CashSheetReport />;
    }

    // Fallback while the store is initializing or if the type is null
    return <LoadingFallback />;
}