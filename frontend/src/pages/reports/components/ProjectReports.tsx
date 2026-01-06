import { useMemo ,useEffect,useCallback,useState} from "react"; 
import { 
    useReactTable, 
    getCoreRowModel, 
    getSortedRowModel, 
    getPaginationRowModel,
    SortingState,
    VisibilityState,
    ColumnFiltersState
} from "@tanstack/react-table"; 
import { DataTable } from "@/components/data-table/new-data-table";
import { Projects } from "@/types/NirmaanStack/Projects"; 
import { useProjectReportCalculations } from "../hooks/useProjectReportCalculations"; 
import { formatValueToLakhsString, getClientProjectColumns } from "./columns/projectColumns"; 
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { ReportType, useReportStore } from "../store/useReportStore";
import { useFrappeGetDocList } from "frappe-react-sdk"; 

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
        return undefined;  // Default to "ALL" (no date filtering)
    });
    

     
    const {
        getProjectCalculatedFields,
        isLoadingGlobalDeps,
        globalDepsError,
    } = useProjectReportCalculations({ // <--- PASS DATES TO HOOK
        startDate: dateRange?.from,
        endDate: dateRange?.to
    });
    

    // --- NEW: Client-side Table Logic ---
    
    // 1. Process data: Merge projects with their calculated fields
    // We use 'filteredProjectsForSummary' because it already handles the basic name search from the existing logic,
    // although we are about to move search into the DataTable. 
    // Ideally, we should feed ALL projects to the table and let the table handle search.
    
    // Let's use 'allProjects' as the base if available.
    const { data: allProjects } = useFrappeGetDocList<Projects>(
        "Projects",
        {
            fields: ['name', 'project_name', 'project_value', 'creation', 'modified', 'status'],
            limit: 0, // Fetch ALL
             orderBy: { field: "creation", order: "desc" }
        }
    );
    const projectSource = allProjects || [];

    const tableData = useMemo(() => {
        if (!projectSource) return [];
        
        return projectSource.map(project => {
            const calculated = getProjectCalculatedFields(project.name);
            const defaultCalc = {
                totalInvoiced: 0,
                totalPoSrInvoiced: 0,
                totalProjectInvoiced: 0,
                totalInflow: 0,
                totalOutflow: 0,
                totalLiabilities: 0,
                TotalPurchaseOverCredit: 0,
                CreditPaidAmount: 0 // if needed
            };
            
            const mergedCalc = calculated || defaultCalc;
            const cashflowGap = (mergedCalc.totalOutflow || 0) + (mergedCalc.totalLiabilities || 0) - (mergedCalc.totalInflow || 0);

            return {
                ...project,
                ...mergedCalc,
                cashflowGap
            };
        });
    }, [projectSource, getProjectCalculatedFields]);

    // 2. Define Columns
    const tableColumns = useMemo(() => getClientProjectColumns(), []);

    // 3. Loading & Error States
    // We wait for both the project list and the financial calculation dependencies
    const isLoading = isLoadingGlobalDeps || !allProjects; // If projects are not loaded yet

    // Local state for table
    const [sorting, setSorting] = useState<SortingState>([{ id: "cashflowGap", desc: true }]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

    const [searchTerm, setSearchTerm] = useState<string>("");
    const [selectedSearchField, setSelectedSearchField] = useState<string | null>(PROJECT_REPORTS_SEARCHABLE_FIELDS[0]?.value || "project_name");


    // 4. Compute Financial Summary from the SAME tableData (ensures consistency)
    // We can filter tableData by searchTerm here if we essentially want to replicate the old summary behavior,
    // OR we can rely on the table's state if we want the summary to update with table filters.
    // For now, let's keep the existing manual search filter logic for the summary to be safe, but applied to tableData.
    

    const filteredDataForSummary = useMemo(() => {
        if (!searchTerm) return tableData;
        const lowerSearch = searchTerm.toLowerCase();
        return tableData.filter(p => 
            p.project_name?.toLowerCase().includes(lowerSearch) ||
            p.name.toLowerCase().includes(lowerSearch)
        );
    }, [tableData, searchTerm]);

    // Create Table Instance
    const table = useReactTable({
        data: filteredDataForSummary,
        columns: tableColumns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onColumnVisibilityChange: setColumnVisibility,
        state: {
            sorting,
            columnFilters,
            columnVisibility,
        },
        initialState: {
            pagination: {
                pageSize: 50,
            },
            sorting: [
                {
                    id: "cashflowGap",
                    desc: true,
                },
            ],
        },
        meta: { 
            dateRange: { 
                from: dateRange?.from ? formatISO(dateRange.from, { representation: 'date' }) : undefined, 
                to: dateRange?.to ? formatISO(dateRange.to, { representation: 'date' }) : undefined 
            } 
        }
    });

    const financialSummary = useMemo(() => {
        return filteredDataForSummary.reduce((acc, row) => {
             // ACCUMULATE ALL FIELDS
                acc.projectValue += parseNumber(row.project_value); 
                acc.totalInvoiced += parseNumber(row.totalInvoiced); 
                acc.totalPoSrInvoiced += parseNumber(row.totalPoSrInvoiced);
                acc.totalProjectInvoiced += parseNumber(row.totalProjectInvoiced);
                acc.totalInflow += parseNumber(row.totalInflow);
                acc.totalOutflow += parseNumber(row.totalOutflow);
                acc.totalLiabilities += parseNumber(row.totalLiabilities); 
                acc.totalPurchaseOverCredit += parseNumber(row.TotalPurchaseOverCredit);
                // cashflowGap is already calculated per row, but simple sum is safer/same
                acc.totalCashflowGap += (row.cashflowGap || 0);

                acc.projectCount += 1;
            return acc;
        }, {
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
    }, [filteredDataForSummary]);

    // 5. Handling Filters & Search State (Client-Side)
    // We reuse existing 'searchTerm' state.

    // Calculate total count based on filtered data size
    const totalCount = filteredDataForSummary.length;


    // --- Export Logic (Updated to use tableData) ---
    const exportFileName = "projects_report_Cash_Sheet";

    const handleCustomExport = useCallback(() => {
        if (!filteredDataForSummary || filteredDataForSummary.length === 0) {
            toast({ title: "Export", description: "No data available to export.", variant: "default" });
            return;
        }
        if (isLoadingGlobalDeps) {
            toast({ title: "Export", description: "Dependency data is still loading. Please wait.", variant: "default" });
            return;
        }

        const dataToExport = filteredDataForSummary.map(row => {
            return {
                project_name: row.project_name,
                project_value_lakhs: formatValueToLakhsString(row.project_value),
                totalInvoiced_lakhs: formatValueToLakhsString(row.totalInvoiced),
                totalPoSrInvoiced_lakhs: formatValueToLakhsString(row.totalPoSrInvoiced),
                totalProjectInvoiced_lakhs: formatValueToLakhsString(row.totalProjectInvoiced),
                totalInflow_lakhs: formatValueToLakhsString(row.totalInflow),
                totalOutflow_lakhs: formatValueToLakhsString(row.totalOutflow),
                totalLiabilities_lakhs: formatValueToLakhsString(row.totalLiabilities),
                cashflowGap_lakhs: formatValueToLakhsString(row.cashflowGap),
                totalPurchaseOverCredit_lakhs: formatValueToLakhsString(row.TotalPurchaseOverCredit),
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
    }, [filteredDataForSummary, isLoadingGlobalDeps, exportFileName]);


    // Helper to display current filter status
    const getCurrentFilterStatus = () => {
        if (!searchTerm) {
             return "Showing overall summary for selected date range.";
        }
        return `Filtered by Search term: "${searchTerm}".`;
    }

      const handleClearDateFilter = useCallback(() => {
            setDateRange(undefined);  // Set to undefined to disable date filtering entirely
        }, []);
    


    // 3. Effect to sync state changes back to the URL
    useEffect(() => {
        const fromISO = dateRange?.from ? formatISO(dateRange.from, { representation: 'date' }) : null;
        const toISO = dateRange?.to ? formatISO(dateRange.to, { representation: 'date' }) : null;

        urlStateManager.updateParam(`${URL_SYNC_KEY}_from`, fromISO);
        urlStateManager.updateParam(`${URL_SYNC_KEY}_to`, toISO);
    }, [dateRange]);

    const fromISO = dateRange?.from ? formatISO(dateRange.from, { representation: 'date' }) : undefined;
    const toISO = dateRange?.to ? formatISO(dateRange.to, { representation: 'date' }) : undefined;

    if (globalDepsError) {
        return <AlertDestructive error={globalDepsError as Error} />;
    }

    if (isLoading && !tableData.length) {
        return <LoadingFallback />;
    }

    if (!table) {
        console.error("Critical: Table instance is undefined!");
        return <AlertDestructive error={new Error("Failed to initialize table")} />;
    }

    return (
         <div className={`flex flex-col gap-2 ${totalCount > 0 ? 'h-[calc(100vh-130px)] overflow-hidden' : ''}`}>
            <StandaloneDateFilter
                value={dateRange}
                onChange={setDateRange}
                onClear={handleClearDateFilter}
            />
 
        {/* We use standard DataTable now, initialized with useReactTable above */}
        <DataTable
            table={table}
            columns={tableColumns}
            isLoading={isLoading}
            error={globalDepsError as Error | null}
            totalCount={totalCount}
            
            // Search
            searchFieldOptions={PROJECT_REPORTS_SEARCHABLE_FIELDS}
            selectedSearchField={selectedSearchField || "project_name"}
            onSelectedSearchFieldChange={setSelectedSearchField}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            
            showExportButton={true}
            onExport={handleCustomExport}
            exportFileName={exportFileName}
            showRowSelection={false}
            tableHeight="40vh"
            
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