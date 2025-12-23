import { useMemo ,useEffect,useCallback,useState} from "react"; // Added useCallback
import { DataTable } from "@/components/data-table/new-data-table";
import { Projects } from "@/types/NirmaanStack/Projects"; // Base Project type
import { useProjectReportCalculations } from "../hooks/useProjectReportCalculations"; // Updated hook
import { formatValueToLakhsString, getProjectColumns } from "./columns/projectColumns"; // Columns are now from a function
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { ReportType, useReportStore } from "../store/useReportStore";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useFrappeGetDocList } from "frappe-react-sdk"; // Imported useFrappeGetDocList
import {
    PROJECT_REPORTS_SEARCHABLE_FIELDS,
    PROJECT_REPORTS_DATE_COLUMNS,
} from "../config/projectReportsTable.config"; 
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"; 
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { toast } from "@/components/ui/use-toast"; 
import { exportToCsv } from "@/utils/exportToCsv"; 
import { parseNumber } from "@/utils/parseNumber"; 
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";


import { InflowReportTable } from './InflowReportTable';
import { OutflowReportTable } from './outflowReportTable';
import {NonProjectExpensesPage} from "@/pages/NonProjectExpenses/NonProjectExpensesPage";
import { ProjectProgressReports } from "./ProjectProgressReports";

import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";
import { urlStateManager } from "@/utils/urlStateManager";
import { parse, formatISO, startOfDay, endOfDay, format } from 'date-fns';
import { DateRange } from "react-day-picker"; 


// Define base fields for Projects doctype fetch
const projectBaseFields: (keyof Projects)[] = [
    'name', 'project_name', 'project_value', 'creation', 'modified', 'status',
];
const projectReportListOptions = () => ({
    fields: projectBaseFields as string[],
});

const URL_SYNC_KEY = "project_case_sheet"; // Use a specific key for URL state
const getDefaultDateRange = (): DateRange => ({
    from: startOfDay(new Date('2024-04-01')),
    to: endOfDay(new Date()),
});

// Component for the existing Cash Sheet report
function CashSheetReport() {

    const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
        const fromParam = urlStateManager.getParam(`${URL_SYNC_KEY}_from`);
        const toParam = urlStateManager.getParam(`${URL_SYNC_KEY}_to`);
        if (fromParam && toParam) {
            try {
                return {
                    from: startOfDay(parse(fromParam, 'yyyy-MM-dd', new Date())),
                    to: endOfDay(parse(toParam, 'yyyy-MM-dd', new Date())),
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

    // --- NEW: Fetch ALL projects for summary calculation (bypassing pagination) ---
    const { data: allProjects } = useFrappeGetDocList<Projects>(
        "Projects",
        {
            fields: ['name', 'project_name', 'project_value', 'creation', 'modified', 'status'],
            limit: 0, // Fetch ALL
             orderBy: { field: "creation", order: "desc" }
        }
    );

    // Filter "allProjects" based on the search term to match the table's *scope*
    const filteredProjectsForSummary = useMemo(() => {
        if (!allProjects) return [];
        if (!searchTerm) return allProjects;

        const lowerSearch = searchTerm.toLowerCase();
        return allProjects.filter(p => 
            p.project_name?.toLowerCase().includes(lowerSearch) ||
            p.name.toLowerCase().includes(lowerSearch)
            // Add other search fields if needed
        );
    }, [allProjects, searchTerm]);


    const financialSummary = useMemo(() => {
        // Use the filtered ALL list, not the paginated table rows
        const rowsToSum = filteredProjectsForSummary;

        return rowsToSum.reduce((acc, project) => {
            const calculated = getProjectCalculatedFields(project.name);
            if (calculated) {

                // ACCUMULATE ALL FIELDS
                acc.projectValue += parseNumber(project.project_value); // From the Project Doc
                acc.totalInvoiced += parseNumber(calculated.totalInvoiced); // Total PO+SR Value
                acc.totalPoSrInvoiced += parseNumber(calculated.totalPoSrInvoiced);
                acc.totalProjectInvoiced += parseNumber(calculated.totalProjectInvoiced);
                acc.totalInflow += parseNumber(calculated.totalInflow);
                acc.totalOutflow += parseNumber(calculated.totalOutflow);
                acc.totalLiabilities += parseNumber(calculated.totalLiabilities); // Added for Current Liabilities
                acc.totalPurchaseOverCredit += parseNumber(calculated.TotalPurchaseOverCredit); // Added from your columns
                acc.creditPaidAmount += parseNumber(calculated.CreditPaidAmount); // Added from your columns

                // Calculate cashflow gap: Outflow + Liabilities - Inflow
                const cashflowGap = parseNumber(calculated.totalOutflow) + parseNumber(calculated.totalLiabilities) - parseNumber(calculated.totalInflow);
                acc.totalCashflowGap += cashflowGap;

                acc.projectCount += 1; // Count projects
            }
            return acc;
        }, {
            // INITIAL ACCUMULATOR STATE
            projectCount: 0,
            projectValue: 0,
            totalInvoiced: 0,
            totalPoSrInvoiced: 0,
            totalProjectInvoiced: 0,
            totalInflow: 0,
            totalOutflow: 0,
            totalLiabilities: 0,
            totalCashflowGap: 0,
            totalCredit: 0,
            totalPurchaseOverCredit: 0,
            creditPaidAmount: 0,
        });
    }, [filteredProjectsForSummary, getProjectCalculatedFields]); 
    // -------------------------------------------------------------

    // // Helper function to format the total amount to Indian Rupee Lakhs for display
    // const formatTotalToLakhsDisplay = (total: number): string => {
    //     return formatToRoundedIndianRupee(total / 100000) + ' L';
    // };

        // Helper to display current filter status
    const getCurrentFilterStatus = () => {
        const activeFilters = table.getState().columnFilters.length;
        const searchTerm = table.getState().globalFilter;

        if (activeFilters === 0 && !searchTerm) {
             return "Showing overall summary for selected date range.";
        }

        const projectFilter = table.getState().columnFilters.find(f => f.id === 'project_name');
        
        let filterText = '';
        if (projectFilter) {
            filterText = `Filtered by: Project(s).`;
        } else if (activeFilters > 0) {
            filterText = `Filtered by ${activeFilters} column(s).`;
        }

        if (searchTerm) {
            filterText += (filterText ? ' And ' : 'Filtered by: ') + `Search term: "${searchTerm}".`;
        }

        return filterText || "Filtered data summary.";
    }



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
            const cashflowGap = calculated ? calculated.totalOutflow + calculated.totalLiabilities - calculated.totalInflow : 0;
            return {
                project_name: project.project_name,
                project_value_lakhs: formatValueToLakhsString(project.project_value),
                totalInvoiced_lakhs: calculated ? formatValueToLakhsString(calculated.totalInvoiced) : 'N/A',
                totalPoSrInvoiced_lakhs: calculated ? formatValueToLakhsString(calculated.totalPoSrInvoiced) : 'N/A',
                totalProjectInvoiced_lakhs: calculated ? formatValueToLakhsString(calculated.totalProjectInvoiced) : 'N/A',
                totalInflow_lakhs: calculated ? formatValueToLakhsString(calculated.totalInflow) : 'N/A',
                totalOutflow_lakhs: calculated ? formatValueToLakhsString(calculated.totalOutflow) : 'N/A',
                totalLiabilities_lakhs: calculated ? formatValueToLakhsString(calculated.totalLiabilities) : 'N/A',
                cashflowGap_lakhs: calculated ? formatValueToLakhsString(cashflowGap) : 'N/A',
                totalPurchaseOverCredit_lakhs: calculated ? formatValueToLakhsString(calculated.TotalPurchaseOverCredit) : 'N/A',
            };
        });
        const exportColumns = [
            { header: "Project Name", accessorKey: "project_name" },
            { header: "Value (excl. GST)", accessorKey: "project_value_lakhs" },
            { header: "Total PO+SR Value(incl. GST)", accessorKey: "totalInvoiced_lakhs" },
            { header: "Total PO+SR Invoice Received", accessorKey: "totalPoSrInvoiced_lakhs" },
            { header: "Total Project Invoiced (incl. GST)", accessorKey: "totalProjectInvoiced_lakhs" },
            { header: "Inflow", accessorKey: "totalInflow_lakhs" },
            { header: "Outflow", accessorKey: "totalOutflow_lakhs" },
            { header: "Current Liability", accessorKey: "totalLiabilities_lakhs" },
            { header: "Cashflow Gap", accessorKey: "cashflowGap_lakhs" },
            { header: "Total Purchase Over Credit", accessorKey: "totalPurchaseOverCredit_lakhs" },
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
         <div className={`flex flex-col gap-2 ${totalCount > 0 ? 'h-[calc(100vh-130px)] overflow-hidden' : ''}`}>
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
            tableHeight="40vh"
            // summaryCard={
            //         <Card className="mb-4">
            //             <CardHeader className="p-4">
            //                 <CardTitle className="text-lg">Financial Summary</CardTitle>
            //                 <CardDescription>{getCurrentFilterStatus()}</CardDescription>
            //             </CardHeader>
            //             <CardContent className="p-4 pt-0">
            //                 <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                
            //                     {/* 1. Project Value (excl. GST) - Neutral */}
            //                     <div className="flex justify-between sm:flex-col border-b sm:border-b-0 pb-2 sm:pb-0">
            //                         <dt className="font-semibold text-gray-600 text-sm">Project Value (excl. GST)</dt>
            //                         <dd className="sm:text-left font-bold text-base tabular-nums text-gray-700">
            //                             {formatToRoundedIndianRupee(financialSummary.projectValue)}
            //                         </dd>
            //                     </div>

            //                     {/* 2. Total Client Invoiced - Income/Revenue (Blue) */}
            //                     <div className="flex justify-between sm:flex-col border-b sm:border-b-0 pb-2 sm:pb-0">
            //                         <dt className="font-semibold text-gray-600 text-sm">Client Invoiced (incl. GST)</dt>
            //                         <dd className="sm:text-left font-bold text-base tabular-nums text-blue-700">
            //                             {formatToRoundedIndianRupee(financialSummary.totalProjectInvoiced)}
            //                         </dd>
            //                     </div>
                                
            //                     {/* 3. Total Inflow - Actual Cash In (Green) */}
            //                     <div className="flex justify-between sm:flex-col border-b sm:border-b-0 pb-2 sm:pb-0">
            //                         <dt className="font-semibold text-gray-600 text-sm">Total Inflow</dt>
            //                         <dd className="sm:text-left font-bold text-base tabular-nums text-green-700">
            //                             {formatToRoundedIndianRupee(financialSummary.totalInflow)}
            //                         </dd>
            //                     </div>
                                
            //                     {/* 4. Total Outflow - Actual Cash Out (Red) */}
            //                     <div className="flex justify-between sm:flex-col border-b sm:border-b-0 pb-2 sm:pb-0">
            //                         <dt className="font-semibold text-gray-600 text-sm">Total Outflow</dt>
            //                         <dd className="sm:text-left font-bold text-base tabular-nums text-red-700">
            //                             {formatToRoundedIndianRupee(financialSummary.totalOutflow)}
            //                         </dd>
            //                     </div>

            //                     {/* 7. Total Credit Outstanding (Client Invoiced - Inflow) - Balance/Due (Purple/Indigo)
            //                     <div className="flex justify-between sm:flex-col border-b sm:border-b-0 pb-2 sm:pb-0">
            //                         <dt className="font-semibold text-gray-600 text-sm">Credit Outstanding</dt>
            //                         <dd className="sm:text-left font-bold text-base tabular-nums text-indigo-700">
            //                             {formatToRoundedIndianRupee(financialSummary.totalCredit)}
            //                         </dd>
            //                     </div> */}

            //                     {/* 5. Total PO+SR Value (Vendor Invoiced) - Vendor Liability (Gray/Neutral) */}
            //                     <div className="flex justify-between sm:flex-col border-b sm:border-b-0 pb-2 sm:pb-0">
            //                         <dt className="font-semibold text-gray-600 text-sm">Total PO+SR Value (incl. GST)</dt>
            //                         <dd className="sm:text-left font-bold text-base tabular-nums text-gray-700">
            //                             {formatToRoundedIndianRupee(financialSummary.totalInvoiced)}
            //                         </dd>
            //                     </div>

            //                     {/* 6. Total PO+SR Invoiced - Vendor Liability (Gray/Neutral) */}
            //                     <div className="flex justify-between sm:flex-col border-b sm:border-b-0 pb-2 sm:pb-0">
            //                         <dt className="font-semibold text-gray-600 text-sm">Total PO+SR Invoiced (incl. GST)</dt>
            //                         <dd className="sm:text-left font-bold text-base tabular-nums text-gray-700">
            //                             {formatToRoundedIndianRupee(financialSummary.totalPoSrInvoiced)}
            //                         </dd>
            //                     </div>


            //                     {/* 8. Total Purchase Over Credit (New Credit Col 1) - Neutral/Detail */}
            //                     <div className="flex justify-between sm:flex-col border-b sm:border-b-0 pb-2 sm:pb-0">
            //                         <dt className="font-semibold text-gray-600 text-sm">Total Purchase Over Credit</dt>
            //                         <dd className="sm:text-left font-bold text-base tabular-nums text-gray-700">
            //                             {formatToRoundedIndianRupee(financialSummary.totalPurchaseOverCredit)}
            //                         </dd>
            //                     </div>

            //                     {/* 9. Total Credit Paid Amount (New Credit Col 2) - Neutral/Detail */}
            //                     <div className="flex justify-between sm:flex-col">
            //                         <dt className="font-semibold text-gray-600 text-sm">Total Credit Amount Paid</dt>
            //                         <dd className="sm:text-left font-bold text-base tabular-nums text-gray-700">
            //                             {formatToRoundedIndianRupee(financialSummary.creditPaidAmount)}
            //                         </dd>
            //                     </div>

            //                 </dl>
            //             </CardContent>
            //         </Card>
            //     }
                                    summaryCard={
                    <Card className="mb-4">
                        <CardHeader className="p-4">
                            <CardTitle className="text-lg">Financial Summary</CardTitle>
                            <CardDescription>{getCurrentFilterStatus()}</CardDescription>
                        </CardHeader>
                        <CardContent className="p-4 pt-0">
                            {/* --- Grid Layout with correct responsive columns --- */}
                            <dl className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-10 gap-4">

                                {/* 1. Total Projects - Count (Purple/Info) */}
                                <div className="flex justify-between sm:flex-col
                                    border-r border-gray-200
                                    pr-4
                                    sm:pb-0
                                    sm:border-b-0
                                ">
                                    <dt className="font-semibold text-gray-600 text-xs">
                                        Total Projects
                                    </dt>
                                    <dd className="sm:text-left font-bold text-base sm:text-sm tabular-nums text-purple-700">
                                        {financialSummary.projectCount}
                                    </dd>
                                </div>

                                {/* 2. Total Client Invoiced - Income/Revenue (Blue) */}
                                <div className="flex justify-between sm:flex-col
                                    border-r border-gray-200
                                    pr-4
                                    sm:pb-0
                                    sm:border-b-0
                                ">
                                    <dt className="font-semibold text-gray-600 text-xs">
                                        Client Invoiced (incl. GST)
                                    </dt>
                                    <dd className="sm:text-left font-bold text-base sm:text-sm tabular-nums text-blue-700">
                                        {formatValueToLakhsString(financialSummary.totalProjectInvoiced)}
                                    </dd>
                                </div>
                                
                                {/* 3. Total Inflow - Actual Cash In (Green) */}
                                <div className="flex justify-between sm:flex-col
                                    border-r border-gray-200
                                    pr-4
                                    sm:pb-0
                                    sm:border-b-0
                                ">
                                    <dt className="font-semibold text-gray-600 text-xs">
                                        Total Inflow
                                    </dt>
                                    <dd className="sm:text-left font-bold text-base sm:text-sm tabular-nums text-green-700">
                                        {formatValueToLakhsString(financialSummary.totalInflow)}
                                    </dd>
                                </div>
                                
                                {/* 4. Total Outflow - Actual Cash Out (Red) */}
                                <div className="flex justify-between sm:flex-col
                                    border-r border-gray-200
                                    pr-4
                                    sm:pb-0
                                    sm:border-b-0
                                ">
                                    <dt className="font-semibold text-gray-600 text-xs">
                                        Total Outflow
                                    </dt>
                                    <dd className="sm:text-left font-bold text-base sm:text-sm tabular-nums text-red-700">
                                        {formatValueToLakhsString(financialSummary.totalOutflow)}
                                    </dd>
                                </div>

                                {/* 5. Total Current Liabilities - Payable Amount (Red/Warning) */}
                                <div className="flex justify-between sm:flex-col
                                    border-r border-gray-200
                                    pr-4
                                    sm:pb-0
                                    sm:border-b-0
                                ">
                                    <dt className="font-semibold text-gray-600 text-xs">
                                        Total Current Liabilities
                                    </dt>
                                    <dd className="sm:text-left font-bold text-base sm:text-sm tabular-nums text-red-600">
                                        {formatValueToLakhsString(financialSummary.totalLiabilities)}
                                    </dd>
                                </div>

                                {/* 6. Total Cashflow Gap - Net Cash Position (Red/Green) */}
                                <div className="flex justify-between sm:flex-col
                                    border-r border-gray-200
                                    pr-4
                                    sm:pb-0
                                    sm:border-b-0
                                ">
                                    <dt className="font-semibold text-gray-600 text-xs">
                                        Total Cashflow Gap
                                    </dt>
                                    <dd className={`sm:text-left font-bold text-base sm:text-sm tabular-nums ${financialSummary.totalCashflowGap > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                        {formatValueToLakhsString(financialSummary.totalCashflowGap)}
                                    </dd>
                                </div>

                                {/* 7. Total PO+SR Value (Vendor Invoiced) - Vendor Liability (Gray/Neutral) */}
                                <div className="flex justify-between sm:flex-col
                                    border-r border-gray-200
                                    pr-4
                                    sm:pb-0
                                    sm:border-b-0
                                ">
                                    <dt className="font-semibold text-gray-600 text-xs">
                                        Total PO+SR Value (incl. GST)
                                    </dt>
                                    <dd className="sm:text-left font-bold text-base sm:text-sm tabular-nums text-gray-700">
                                        {formatValueToLakhsString(financialSummary.totalInvoiced)}
                                    </dd>
                                </div>

                                {/* 8. Total PO+SR Invoiced - Vendor Liability (Gray/Neutral) */}
                                <div className="flex justify-between sm:flex-col
                                    border-r border-gray-200
                                    pr-4
                                    sm:pb-0
                                    sm:border-b-0
                                ">
                                    <dt className="font-semibold text-gray-600 text-xs">
                                        Total PO+SR Invoiced (incl. GST)
                                    </dt>
                                    <dd className="sm:text-left font-bold text-base sm:text-sm tabular-nums text-gray-700">
                                        {formatValueToLakhsString(financialSummary.totalPoSrInvoiced)}
                                    </dd>
                                </div>

                                 {/* 9. Project Value (excl. GST) - Neutral */}
                                <div className="flex justify-between sm:flex-col
                                    border-r border-gray-200
                                    sm:pb-0
                                    pr-4
                                ">
                                    <dt className="font-semibold text-gray-600 text-xs">
                                        Project Value (excl. GST)
                                    </dt>
                                    <dd className="sm:text-left font-bold text-base sm:text-sm tabular-nums text-gray-700">
                                        {formatValueToLakhsString(financialSummary.projectValue)}
                                    </dd>
                                </div>

                                {/* 10. Total Purchase Over Credit - Detail (Orange/Warning) */}
                                <div className="flex justify-between sm:flex-col
                                    pr-4
                                    sm:pb-0
                                    sm:border-b-0
                                ">
                                    <dt className="font-semibold text-gray-600 text-xs">
                                        Total Purchase Over Credit
                                    </dt>
                                    <dd className="sm:text-left font-bold text-base sm:text-sm tabular-nums text-orange-700">
                                        {formatValueToLakhsString(financialSummary.totalPurchaseOverCredit)}
                                    </dd>
                                </div>

                                {/* 11. Total Credit Paid Amount (Commented Out) */}
                                {/* <div className="flex justify-between sm:flex-col
                                    border-r border-gray-200
                                    pr-4
                                    sm:pb-0
                                    sm:border-b-0
                                ">
                                    <dt className="font-semibold text-gray-600 text-xs">
                                        Total Credit Amount Paid
                                    </dt>
                                    <dd className="sm:text-left font-bold text-base sm:text-sm tabular-nums text-teal-700">
                                        {formatValueToLakhsString(financialSummary.creditPaidAmount)}
                                    </dd>
                                </div> */}

                            </dl>
                        </CardContent>
                    </Card>
                }


            
        />
        
        </div>
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