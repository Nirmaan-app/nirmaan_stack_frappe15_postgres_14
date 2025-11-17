import { useMemo ,useEffect,useCallback,useState} from "react"; // Added useCallback
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
import { OutflowReportTable } from './outflowReportTable';
import {NonProjectExpensesPage} from "@/pages/NonProjectExpenses/NonProjectExpensesPage";
import { ProjectProgressReports } from "./ProjectProgressReports";

import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";
import { urlStateManager } from "@/utils/urlStateManager"; // <--- NEW IMPORT
import { parse, formatISO, startOfDay, format } from 'date-fns'; // <--- NEW IMPORT
import { DateRange } from "react-day-picker"; // <--- NEW IMPORT

// Define base fields for Projects doctype fetch
const projectBaseFields: (keyof Projects)[] = [
    'name', 'project_name', 'project_value', 'creation', 'modified', 'status',
];
const projectReportListOptions = () => ({
    fields: projectBaseFields as string[],
});

const URL_SYNC_KEY = "project_case_sheet"; // Use a specific key for URL state
const getDefaultDateRange = (): DateRange => ({
    from: new Date('2024-04-01'),
    to: startOfDay(new Date()),
});

// Component for the existing Cash Sheet report
function CashSheetReport() {

    const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
        const fromParam = urlStateManager.getParam(`${URL_SYNC_KEY}_from`);
        const toParam = urlStateManager.getParam(`${URL_SYNC_KEY}_to`);
        if (fromParam && toParam) {
            try {
                return {
                    from: parse(fromParam, 'yyyy-MM-dd', new Date()),
                    to: parse(toParam, 'yyyy-MM-dd', new Date()),
                };
            } catch (e) {
                console.error("Error parsing date from URL:", e);
                // Fall through to default if parsing fails
            }
        }
        return getDefaultDateRange()
    });
     
    const {
        getProjectCalculatedFields,
        isLoadingGlobalDeps,
        globalDepsError,
    } = useProjectReportCalculations({ // <--- PASS DATES TO HOOK
        startDate: dateRange?.from,
        endDate: dateRange?.to
    });
    

    const tableColumns = useMemo(() => getProjectColumns(), []);
 // 3. Effect to sync state changes back to the URL
    useEffect(() => {
        const fromISO = dateRange?.from ? formatISO(dateRange.from, { representation: 'date' }) : null;
        const toISO = dateRange?.to ? formatISO(dateRange.to, { representation: 'date' }) : null;

        urlStateManager.updateParam(`${URL_SYNC_KEY}_from`, fromISO);
        urlStateManager.updateParam(`${URL_SYNC_KEY}_to`, toISO);
    }, [dateRange]);

    const fromISO = dateRange?.from ? formatISO(dateRange.from, { representation: 'date' }) : undefined;
const toISO = dateRange?.to ? formatISO(dateRange.to, { representation: 'date' }) : undefined;


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
        meta: { getProjectCalculatedFields, isLoadingGlobalDeps, dateRange: { 
            from: fromISO, 
            to: toISO 
        }  }
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

      const handleClearDateFilter = useCallback(() => {
            setDateRange(getDefaultDateRange());
        }, []);
    

    if (error) {
        return <AlertDestructive error={error as Error} />;
    }

    if (isLoading && !projectsData?.length) {
        return <LoadingFallback />;
    }

    return (
        <>
            <StandaloneDateFilter
                value={dateRange}
                onChange={setDateRange}
                onClear={handleClearDateFilter}
            />
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
        </>
    );
}

export default function ProjectReports() {
    const selectedReportType = useReportStore((state) => state.selectedReportType as ReportType);

    // --- MODIFICATION 4: Conditionally render the correct report component ---
    if (selectedReportType === 'Inflow Report') {
        return <InflowReportTable />;
    }
    if(selectedReportType === 'Outflow Report(Project)') {
        return <OutflowReportTable />;
    }
     if(selectedReportType === 'Outflow Report(Non-Project)') {
        return <NonProjectExpensesPage DisableAction={true} />;
    }

    if(selectedReportType === 'Project Progress Report') {
        return <ProjectProgressReports/>
    }

    // Default to Cash Sheet report if it's selected or if no specific project report is chosen
    if (selectedReportType === 'Cash Sheet') {
        return <CashSheetReport />;
    }

    // Fallback while the store is initializing or if the type is null
    return <LoadingFallback />;
}