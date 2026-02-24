import { useMemo, useEffect, useCallback, useState, lazy } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  SortingState,
  VisibilityState,
  ColumnFiltersState,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/new-data-table";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useProjectReportCalculations } from "../hooks/useProjectReportCalculations";
import {
  formatValueToLakhsString,
  getClientProjectColumns,
} from "./columns/projectColumns";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { ReportType, useReportStore } from "../store/useReportStore";
import { useFrappeGetDocList } from "frappe-react-sdk";

import {
  PROJECT_REPORTS_SEARCHABLE_FIELDS,
  PROJECT_REPORTS_DATE_COLUMNS,
} from "../config/projectReportsTable.config";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Briefcase, ArrowDownLeft, ArrowUpRight, AlertTriangle } from "lucide-react";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { toast } from "@/components/ui/use-toast";
import { exportToCsv } from "@/utils/exportToCsv";
import { parseNumber } from "@/utils/parseNumber";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { InflowReportTable } from "./InflowReportTable";
import { OutflowReportTable } from "./outflowReportTable";
import { NonProjectExpensesPage } from "@/pages/NonProjectExpenses/NonProjectExpensesPage";
import { ProjectProgressReports } from "./ProjectProgressReports";

const InventoryReport = lazy(() => import('./InventoryReport'));

import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";

import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";
import { urlStateManager } from "@/utils/urlStateManager";
import { parse, formatISO, startOfDay, endOfDay, format } from "date-fns";
import { DateRange } from "react-day-picker";

const projectBaseFields: (keyof Projects)[] = [
  "name",
  "project_name",
  "project_value",
  "project_value_gst",
  "creation",
  "modified",
  "status",
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
          from: startOfDay(parse(fromParam, "yyyy-MM-dd", new Date())),
          to: endOfDay(parse(toParam, "yyyy-MM-dd", new Date())),
        };
      } catch (e) {
        console.error("Error parsing date from URL:", e);
        // Fall through to default if parsing fails
      }
    }
    return undefined; // Default to "ALL" (no date filtering)
  });

  const { getProjectCalculatedFields, isLoadingGlobalDeps, globalDepsError } =
    useProjectReportCalculations({
      // <--- PASS DATES TO HOOK
      startDate: dateRange?.from,
      endDate: dateRange?.to,
    });

  const { ceoHoldProjectIds } = useCEOHoldProjects();

  const getRowClassName = useCallback(
    (row: any) => {
      const projectId = row.original.name;
      if (projectId && ceoHoldProjectIds.has(projectId)) {
        return CEO_HOLD_ROW_CLASSES;
      }
      return undefined;
    },
    [ceoHoldProjectIds]
  );

  // --- NEW: Client-side Table Logic ---

  // 1. Process data: Merge projects with their calculated fields
  // We use 'filteredProjectsForSummary' because it already handles the basic name search from the existing logic,
  // although we are about to move search into the DataTable.
  // Ideally, we should feed ALL projects to the table and let the table handle search.

  // Let's use 'allProjects' as the base if available.
  const { data: allProjects } = useFrappeGetDocList<Projects>("Projects", {
    fields: [
      "name",
      "project_name",
      "project_value",
      "project_value_gst",
      "creation",
      "modified",
      "status",
    ],
    limit: 0, // Fetch ALL
    orderBy: { field: "creation", order: "desc" },
  });
  const projectSource = allProjects || [];

  const tableData = useMemo(() => {
    if (!projectSource) return [];

    return projectSource.map((project) => {
      const calculated = getProjectCalculatedFields(project.name);
      const defaultCalc = {
        totalInvoiced: 0,
        totalPoSrInvoiced: 0,
        totalProjectInvoiced: 0,
        totalInflow: 0,
        totalOutflow: 0,
        totalLiabilities: 0,
        TotalPurchaseOverCredit: 0,
        CreditPaidAmount: 0, // if needed
      };

      const mergedCalc = calculated || defaultCalc;
      const cashflowGap =
        (mergedCalc.totalOutflow || 0) +
        (mergedCalc.totalLiabilities || 0) -
        (mergedCalc.totalInflow || 0);

      return {
        ...project,
        ...mergedCalc,
        cashflowGap,
      };
    });
  }, [projectSource, getProjectCalculatedFields]);

  // 2. Define Columns
  const tableColumns = useMemo(() => getClientProjectColumns(), []);

  // 3. Loading & Error States
  // We wait for both the project list and the financial calculation dependencies
  const isLoading = isLoadingGlobalDeps || !allProjects; // If projects are not loaded yet

  // Local state for table
  const [sorting, setSorting] = useState<SortingState>([
    { id: "cashflowGap", desc: true },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedSearchField, setSelectedSearchField] = useState<string | null>(
    PROJECT_REPORTS_SEARCHABLE_FIELDS[0]?.value || "project_name"
  );

  // 4. Compute Financial Summary from the SAME tableData (ensures consistency)
  // We can filter tableData by searchTerm here if we essentially want to replicate the old summary behavior,
  // OR we can rely on the table's state if we want the summary to update with table filters.
  // For now, let's keep the existing manual search filter logic for the summary to be safe, but applied to tableData.

  const filteredDataForSummary = useMemo(() => {
    if (!searchTerm) return tableData;
    const lowerSearch = searchTerm.toLowerCase();
    return tableData.filter(
      (p) =>
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
        from: dateRange?.from
          ? formatISO(dateRange.from, { representation: "date" })
          : undefined,
        to: dateRange?.to
          ? formatISO(dateRange.to, { representation: "date" })
          : undefined,
      },
    },
  });

  const financialSummary = useMemo(() => {
    return filteredDataForSummary.reduce(
      (acc, row) => {
        // ACCUMULATE ALL FIELDS
        acc.projectValue += parseNumber(row.project_value_gst);
        acc.totalInvoiced += parseNumber(row.totalInvoiced);
        acc.totalPoSrInvoiced += parseNumber(row.totalPoSrInvoiced);
        acc.totalProjectInvoiced += parseNumber(row.totalProjectInvoiced);
        acc.totalInflow += parseNumber(row.totalInflow);
        acc.totalOutflow += parseNumber(row.totalOutflow);
        acc.totalLiabilities += parseNumber(row.totalLiabilities);
        acc.totalPurchaseOverCredit += parseNumber(row.TotalPurchaseOverCredit);
        // cashflowGap is already calculated per row, but simple sum is safer/same
        acc.totalCashflowGap += row.cashflowGap || 0;

        acc.projectCount += 1;
        return acc;
      },
      {
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
      }
    );
  }, [filteredDataForSummary]);

  // 5. Handling Filters & Search State (Client-Side)
  // We reuse existing 'searchTerm' state.

  // Calculate total count based on filtered data size
  const totalCount = filteredDataForSummary.length;

  // --- Export Logic (Updated to use tableData) ---
  // --- Export Logic (Updated to use tableData) ---
  const exportFileName = `ProjectReport_Cash_Sheet_${formatDate(new Date())}`;

  const handleCustomExport = useCallback(() => {
    const rowsToExport = table.getSortedRowModel().rows.map((r) => r.original);

    if (!rowsToExport || rowsToExport.length === 0) {
      toast({
        title: "Export",
        description: "No data available to export.",
        variant: "default",
      });
      return;
    }

    const dataToExport = rowsToExport.map((row: any) => ({
      project_name: row.project_name || row.name,
      project_value: formatValueToLakhsString(row.project_value_gst),
      client_invoiced: formatValueToLakhsString(row.totalProjectInvoiced),
      inflow: formatValueToLakhsString(row.totalInflow),
      outflow: formatValueToLakhsString(row.totalOutflow),
      liability: formatValueToLakhsString(row.totalLiabilities),
      gap: formatValueToLakhsString(row.cashflowGap),
      po_sr_value: formatValueToLakhsString(row.totalInvoiced),
      po_sr_invoiced: formatValueToLakhsString(row.totalPoSrInvoiced),
      purchase_over_credit: formatValueToLakhsString(row.TotalPurchaseOverCredit),
    }));

    const exportColumnsConfig = [
      { header: "Project Name", accessorKey: "project_name" },
      { header: "Value (incl. GST)", accessorKey: "project_value" },
      { header: "Client Invoiced (incl. GST)", accessorKey: "client_invoiced" },
      { header: "Inflow", accessorKey: "inflow" },
      { header: "Outflow", accessorKey: "outflow" },
      { header: "Current Liability", accessorKey: "liability" },
      { header: "Cashflow Gap", accessorKey: "gap" },
      { header: "Total PO+SR Value(incl. GST)", accessorKey: "po_sr_value" },
      { header: "Total PO+SR Invoice Received", accessorKey: "po_sr_invoiced" },
      { header: "Total Purchase Over Credit", accessorKey: "purchase_over_credit" },
    ];

    try {
      exportToCsv(exportFileName, dataToExport, exportColumnsConfig);
      toast({
        title: "Export Successful",
        description: `${dataToExport.length} rows exported.`,
        variant: "default",
      });
    } catch (e) {
      console.error("Export failed:", e);
      toast({
        title: "Export Error",
        description: "Could not generate CSV file.",
        variant: "destructive",
      });
    }
  }, [table, exportFileName]);

  const handleClearDateFilter = useCallback(() => {
    setDateRange(undefined); // Set to undefined to disable date filtering entirely
  }, []);

  // 3. Effect to sync state changes back to the URL
  useEffect(() => {
    const fromISO = dateRange?.from
      ? formatISO(dateRange.from, { representation: "date" })
      : null;
    const toISO = dateRange?.to
      ? formatISO(dateRange.to, { representation: "date" })
      : null;

    urlStateManager.updateParam(`${URL_SYNC_KEY}_from`, fromISO);
    urlStateManager.updateParam(`${URL_SYNC_KEY}_to`, toISO);
  }, [dateRange]);

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
    <div
      className={`flex flex-col gap-2 ${
        totalCount > 0 ? "h-[calc(100vh-130px)] overflow-hidden" : ""
      }`}
    >
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
        getRowClassName={getRowClassName}
        tableHeight="40vh"
        summaryCard={
          <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
            {/* ===== COMPACT MOBILE VIEW ===== */}
            <div className="sm:hidden">
              <CardContent className="p-3">
                {/* Row 1: Cashflow Gap (hero) + Projects count */}
                <div className="flex items-center gap-3 mb-2">
                  <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                    financialSummary.totalCashflowGap > 0
                      ? 'bg-gradient-to-br from-red-500 to-rose-500'
                      : 'bg-gradient-to-br from-emerald-500 to-teal-500'
                  }`}>
                    <AlertTriangle className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className={`text-lg font-bold tabular-nums ${
                        financialSummary.totalCashflowGap > 0
                          ? 'text-red-700 dark:text-red-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}>
                        {formatValueToLakhsString(financialSummary.totalCashflowGap)}
                      </span>
                      <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                        Gap
                      </span>
                    </div>
                    {searchTerm && (
                      <span className="px-1.5 py-0.5 text-[9px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded">
                        "{searchTerm.slice(0, 10)}"
                      </span>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-violet-600 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/40 rounded-md tabular-nums">
                      {financialSummary.projectCount}
                    </span>
                    <span className="block text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                      projects
                    </span>
                  </div>
                </div>
                {/* Row 2: Key metrics in compact grid */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-emerald-50 dark:bg-emerald-950/40 rounded px-2 py-1.5">
                    <div className="flex items-center gap-1 text-[9px] text-emerald-600 dark:text-emerald-400 uppercase font-medium">
                      <ArrowDownLeft className="h-2.5 w-2.5" />
                      Inflow
                    </div>
                    <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {formatValueToLakhsString(financialSummary.totalInflow)}
                    </div>
                  </div>
                  <div className="bg-red-50 dark:bg-red-950/40 rounded px-2 py-1.5">
                    <div className="flex items-center gap-1 text-[9px] text-red-600 dark:text-red-400 uppercase font-medium">
                      <ArrowUpRight className="h-2.5 w-2.5" />
                      Outflow
                    </div>
                    <div className="text-sm font-bold text-red-700 dark:text-red-400 tabular-nums">
                      {formatValueToLakhsString(financialSummary.totalOutflow)}
                    </div>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-950/40 rounded px-2 py-1.5">
                    <div className="text-[9px] text-amber-600 dark:text-amber-400 uppercase font-medium">
                      Liabilities
                    </div>
                    <div className="text-sm font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                      {formatValueToLakhsString(financialSummary.totalLiabilities)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </div>

            {/* ===== EXPANDED DESKTOP VIEW ===== */}
            <div className="hidden sm:block">
              <CardHeader className="pb-2 pt-4 px-5">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                    Financial Summary
                  </CardTitle>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                    <Briefcase className="h-3.5 w-3.5" />
                    <span className="uppercase tracking-wider">
                      {financialSummary.projectCount} Project{financialSummary.projectCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                {searchTerm && (
                  <div className="flex flex-wrap gap-1.5 items-center mt-2">
                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Filtered:</span>
                    <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full">
                      "{searchTerm}"
                    </span>
                  </div>
                )}
              </CardHeader>
              <CardContent className="px-5 pb-4 pt-0">
                {/* Primary Row */}
                <div className="grid grid-cols-4 lg:grid-cols-7 gap-3 mb-3">
                  {/* 1. Total Projects */}
                  <div className="bg-gradient-to-br from-violet-50 to-purple-50/50 dark:from-violet-950/40 dark:to-purple-950/30 rounded-lg p-3 border border-violet-100 dark:border-violet-900/50">
                    <dt className="text-[10px] font-medium text-violet-600/80 dark:text-violet-400/80 uppercase tracking-wide mb-1">
                      Total Projects
                    </dt>
                    <dd className="text-lg font-bold text-violet-700 dark:text-violet-400 tabular-nums">
                      {financialSummary.projectCount}
                    </dd>
                  </div>

                  {/* 2. Project Value (incl. GST) */}
                  <div className="bg-gradient-to-br from-slate-50 to-gray-50/50 dark:from-slate-800/60 dark:to-gray-800/40 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                    <dt className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                      Project Value (incl. GST)
                    </dt>
                    <dd className="text-lg font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                      {formatValueToLakhsString(financialSummary.projectValue)}
                    </dd>
                  </div>

                  {/* 3. Client Invoiced (incl. GST) */}
                  <div className="bg-gradient-to-br from-blue-50 to-sky-50/50 dark:from-blue-950/40 dark:to-sky-950/30 rounded-lg p-3 border border-blue-100 dark:border-blue-900/50">
                    <dt className="text-[10px] font-medium text-blue-600/80 dark:text-blue-400/80 uppercase tracking-wide mb-1">
                      Client Invoiced (incl. GST)
                    </dt>
                    <dd className="text-lg font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                      {formatValueToLakhsString(financialSummary.totalProjectInvoiced)}
                    </dd>
                  </div>

                  {/* 4. Total Inflow */}
                  <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:from-emerald-950/40 dark:to-teal-950/30 rounded-lg p-3 border border-emerald-100 dark:border-emerald-900/50">
                    <dt className="text-[10px] font-medium text-emerald-600/80 dark:text-emerald-400/80 uppercase tracking-wide mb-1">
                      Total Inflow
                    </dt>
                    <dd className="text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {formatValueToLakhsString(financialSummary.totalInflow)}
                    </dd>
                  </div>

                  {/* 5. Total Outflow */}
                  <div className="bg-gradient-to-br from-red-50 to-rose-50/50 dark:from-red-950/40 dark:to-rose-950/30 rounded-lg p-3 border border-red-100 dark:border-red-900/50">
                    <dt className="text-[10px] font-medium text-red-600/80 dark:text-red-400/80 uppercase tracking-wide mb-1">
                      Total Outflow
                    </dt>
                    <dd className="text-lg font-bold text-red-700 dark:text-red-400 tabular-nums">
                      {formatValueToLakhsString(financialSummary.totalOutflow)}
                    </dd>
                  </div>

                  {/* 6. Total Current Liabilities */}
                  <div className="bg-gradient-to-br from-red-50 to-orange-50/50 dark:from-red-950/40 dark:to-orange-950/30 rounded-lg p-3 border border-red-100 dark:border-red-900/50">
                    <dt className="text-[10px] font-medium text-red-600/80 dark:text-red-400/80 uppercase tracking-wide mb-1">
                      Total Current Liabilities
                    </dt>
                    <dd className="text-lg font-bold text-red-600 dark:text-red-400 tabular-nums">
                      {formatValueToLakhsString(financialSummary.totalLiabilities)}
                    </dd>
                  </div>

                  {/* 7. Total Cashflow Gap */}
                  <div className={`bg-gradient-to-br ${
                    financialSummary.totalCashflowGap > 0
                      ? 'from-red-50 to-rose-50/50 dark:from-red-950/40 dark:to-rose-950/30 border-red-100 dark:border-red-900/50'
                      : 'from-emerald-50 to-teal-50/50 dark:from-emerald-950/40 dark:to-teal-950/30 border-emerald-100 dark:border-emerald-900/50'
                  } rounded-lg p-3 border`}>
                    <dt className={`text-[10px] font-medium uppercase tracking-wide mb-1 ${
                      financialSummary.totalCashflowGap > 0
                        ? 'text-red-600/80 dark:text-red-400/80'
                        : 'text-emerald-600/80 dark:text-emerald-400/80'
                    }`}>
                      Total Cashflow Gap
                    </dt>
                    <dd className={`text-lg font-bold tabular-nums ${
                      financialSummary.totalCashflowGap > 0
                        ? 'text-red-700 dark:text-red-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}>
                      {formatValueToLakhsString(financialSummary.totalCashflowGap)}
                    </dd>
                  </div>
                </div>

                {/* Secondary Row: PO/SR Details */}
                <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                  <div className="grid grid-cols-3 gap-3">
                    {/* 8. Total PO+SR Value (incl. GST) */}
                    <div>
                      <dt className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">
                        Total PO+SR Value (incl. GST)
                      </dt>
                      <dd className="text-sm font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                        {formatValueToLakhsString(financialSummary.totalInvoiced)}
                      </dd>
                    </div>

                    {/* 9. Total PO+SR Invoiced (incl. GST) */}
                    <div>
                      <dt className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">
                        Total PO+SR Invoiced (incl. GST)
                      </dt>
                      <dd className="text-sm font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                        {formatValueToLakhsString(financialSummary.totalPoSrInvoiced)}
                      </dd>
                    </div>

                    {/* 10. Total Purchase Over Credit */}
                    <div>
                      <dt className="text-[10px] font-medium text-orange-500 dark:text-orange-400 uppercase tracking-wide mb-0.5">
                        Total Purchase Over Credit
                      </dt>
                      <dd className="text-sm font-semibold text-orange-700 dark:text-orange-400 tabular-nums">
                        {formatValueToLakhsString(financialSummary.totalPurchaseOverCredit)}
                      </dd>
                    </div>
                  </div>
                </div>
              </CardContent>
            </div>
          </Card>
        }
      />
    </div>
  );
}

export default function ProjectReports() {
  const selectedReportType = useReportStore(
    (state) => state.selectedReportType as ReportType
  );

  // --- MODIFICATION 4: Conditionally render the correct report component ---
  if (selectedReportType === "Inflow Report") {
    return <InflowReportTable />;
  }
  if (selectedReportType === "Outflow Report(Project)") {
    return <OutflowReportTable />;
  }
  if (selectedReportType === "Outflow Report(Non-Project)") {
    return <NonProjectExpensesPage DisableAction={true} />;
  }

  if (selectedReportType === "Project Progress Report") {
    return <ProjectProgressReports />;
  }

  if (selectedReportType === "Inventory Report") {
    return <InventoryReport />;
  }

  // Default to Cash Sheet report if it's selected or if no specific project report is chosen
  if (selectedReportType === "Cash Sheet") {
    return <CashSheetReport />;
  }

  // Fallback while the store is initializing or if the type is null
  return <LoadingFallback />;
}
