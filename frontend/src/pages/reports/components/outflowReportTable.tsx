// /workspace/development/frappe-bench/apps/nirmaan_stack/frontend/src/pages/reports/components/OutflowReportTable.tsx

import React, { useCallback, useMemo, useEffect, useState, useRef } from "react";
import { memoize } from "lodash";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { DateRange } from "react-day-picker";

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { TableSkeleton } from "@/components/ui/skeleton";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDown } from "lucide-react";
import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";

import { TailSpin } from 'react-loader-spinner';

// --- Hooks, Types & Columns ---
import { useServerDataTable, AggregationConfig } from "@/hooks/useServerDataTable";
import { useOutflowReportData, OutflowRowData } from "../hooks/useOutflowReportData";
import { getOutflowReportColumns } from "./columns/outflowColumns";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { urlStateManager } from "@/utils/urlStateManager";
import { parse, formatISO, startOfDay, endOfDay } from 'date-fns';

// --- Supporting Data Types & Config ---
import { Projects } from "@/types/NirmaanStack/Projects";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType";
import { OUTFLOW_SEARCHABLE_FIELDS, OUTFLOW_DATE_COLUMNS } from '../config/outflowReportsTable.config'; // We will create this config file next

// Configuration for the summary card aggregations
const OUTFLOW_AGGREGATES_CONFIG: AggregationConfig[] = [
    { field: 'amount', function: 'sum' }
];

// URL state management for date range
const URL_SYNC_KEY = "outflow_project_report";

// Helper component to display active filters
const AppliedFiltersDisplay: React.FC<{
    filters: { id: string; value: unknown }[];
    search: string;
}> = ({ filters, search }) => {
    const hasFilters = filters.length > 0 || !!search;

    if (!hasFilters) {
        return null;
    }

    return (
        <div className="flex flex-wrap gap-1.5 items-center mt-2">
            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Filtered:</span>
            {search && (
                <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full">
                    "{search}"
                </span>
            )}
            {filters.map(filter => (
                <span
                    key={filter.id}
                    className="px-2 py-0.5 text-[10px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-full capitalize"
                >
                    {filter.id.replace(/_/g, ' ')}
                </span>
            ))}
        </div>
    );
};

interface SelectOption { label: string; value: string; }

export function OutflowReportTable() {
    // 1. Manage date range state, initialized from URL filters or standalone date params
    const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
        // PRIORITY 1: Check if date filters are passed via outflow_report_table_filters (from project cash sheet link)
        try {
            const encodedFilters = urlStateManager.getParam('outflow_report_table_filters');
            if (encodedFilters) {
                const decodedFilters = JSON.parse(atob(encodedFilters));
                const dateFilter = decodedFilters.find(f => f.id === 'payment_date');
                if (dateFilter?.value?.operator === 'Between' && Array.isArray(dateFilter.value.value)) {
                    const [fromStr, toStr] = dateFilter.value.value;
                    return {
                        from: startOfDay(new Date(fromStr)),
                        to: endOfDay(new Date(toStr)),
                    };
                }
            }
        } catch (e) {
            console.error("Error parsing date filters from URL:", e);
        }

        // PRIORITY 2: Check standalone date params (for direct navigation to this page)
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
            }
        }

        // PRIORITY 3: Default to "ALL" (no date filtering)
        return undefined;
    });

    // 2. Effect to sync state changes back to the URL
    useEffect(() => {
        const fromISO = dateRange?.from ? formatISO(dateRange.from, { representation: 'date' }) : null;
        const toISO = dateRange?.to ? formatISO(dateRange.to, { representation: 'date' }) : null;

        urlStateManager.updateParam(`${URL_SYNC_KEY}_from`, fromISO);
        urlStateManager.updateParam(`${URL_SYNC_KEY}_to`, toISO);
    }, [dateRange]);

    // 3. Fetch the combined & standardized outflow data (with date filtering)
    const { reportData, isLoading: isLoadingInitialData, error: initialDataError } = useOutflowReportData({
        startDate: dateRange?.from,
        endDate: dateRange?.to
    });

    // 2. Fetch supporting data for lookups and faceted filters
    const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>("Projects", { fields: ["name", "project_name"], limit: 0 });
    const { data: vendors, isLoading: vendorsLoading } = useFrappeGetDocList<Vendors>("Vendors", { fields: ["name", "vendor_name"], limit: 0 });
    const { data: expenseTypes, isLoading: expenseTypesLoading } = useFrappeGetDocList<ExpenseType>("Expense Type", { fields: ["name", "expense_name"], filters: [["project", "=", "1"]], limit: 0 });

    // 3. Memoized lookups and options for performance
    const getProjectName = useCallback(memoize((id?: string) => projects?.find(p => p.name === id)?.project_name || id || '--'), [projects]);
    const getVendorName = useCallback(memoize((id?: string) => vendors?.find(v => v.name === id)?.vendor_name || id || 'Others'), [vendors]);

    // Add a name to the report data for easier searching if needed
    const processedReportData = useMemo(() => {
        if (!reportData) return [];
        return reportData.map(row => ({
            ...row,
            project_name: getProjectName(row.project),
            vendor_name: getVendorName(row.vendor)
        }));
    }, [reportData, getProjectName, getVendorName]);

    const projectOptions = useMemo<SelectOption[]>(() => projects?.map(p => ({ label: p.project_name, value: p.name })) || [], [projects]);
    const vendorOptions = useMemo<SelectOption[]>(() => vendors?.map(v => ({ label: v.vendor_name, value: v.name })) || [], [vendors]);
    // Create expense type options from both the Expense Type doctype and the hardcoded PO/SR types
    const expenseTypeOptions = useMemo<SelectOption[]>(() => {
        const fromDocType = expenseTypes?.map(et => ({ label: et.expense_name, value: et.expense_name })) || [];
        const hardcodedTypes = [
            { label: "Payment Against PO", value: "Payment Against PO" },
            { label: "Payment Against SR", value: "Payment Against SR" }
        ];
        return [...hardcodedTypes, ...fromDocType];
    }, [expenseTypes]);

    // 4. Define columns and facet filter options
    const columns = useMemo(() => getOutflowReportColumns(getProjectName, getVendorName), [getProjectName, getVendorName]);

    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
        vendor: { title: "Vendor", options: vendorOptions },
        expense_type: { title: "Expense Type", options: expenseTypeOptions }
    }), [projectOptions, vendorOptions, expenseTypeOptions]);

    const [pagination, setPagination] = useState({
        pageIndex: 0,
        pageSize: 50, // Your default page size
    });

    // 5. Initialize useServerDataTable in client-side mode
    const {
        table, totalisLoading: isTableHookLoading, error: tableHookError,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        columnFilters, setColumnFilters
    } = useServerDataTable<OutflowRowData>({
        doctype: 'OutflowReportVirtual', // A virtual name for this client-side table
        columns: columns,
        clientData: processedReportData,
        clientTotalCount: processedReportData.length,
        searchableFields: OUTFLOW_SEARCHABLE_FIELDS,
        urlSyncKey: 'outflow_report_table',
        defaultSort: 'payment_date desc',
        state: {
            pagination, // The table's pagination is now controlled by our state
        },
        onPaginationChange: setPagination, // When the table wants to change pages, it updates our state
        manualPagination: true,
        // pageCount can be set to -1 initially and controlled by useEffect
        pageCount: -1,


        // aggregatesConfig: OUTFLOW_AGGREGATES_CONFIG,
    });

    // Remove payment_date filter from columnFilters if present (it's already applied via dateRange in data fetch)
    // This prevents double filtering: once at fetch level, once at table level
    const hasRemovedDateFilter = useRef(false);
    useEffect(() => {
        if (!hasRemovedDateFilter.current) {
            const hasDateFilter = columnFilters.some(f => f.id === 'payment_date');
            if (hasDateFilter) {
                // Remove only the payment_date filter, keep all others (like project filter)
                setColumnFilters(prev => prev.filter(f => f.id !== 'payment_date'));
                hasRemovedDateFilter.current = true;
            }
        }
    }, [columnFilters, setColumnFilters]); // Watch columnFilters but only remove once



    // --- THIS IS THE FIX ---
    // Get the dynamic count of rows *after* client-side filtering has been applied.
    const filteredRowCount = table.getFilteredRowModel().rows.length;

    const correctPageCount = Math.ceil(filteredRowCount / pagination.pageSize) || 1; // Default to 1 page if 0 rows

    // On every render, we forcefully update the table's options with the correct page count.
    // This is more direct than useEffect and avoids timing issues.
    table.setOptions(prev => ({
        ...prev,
        pageCount: correctPageCount,
        // Also re-apply our state and handlers on every render to ensure consistency
        state: {
            ...prev.state,
            pagination,
        },
        onPaginationChange: setPagination,
    }));


    // --- IMPROVEMENT ---
    // This calculation is now cleaner and always reflects the filtered data.
    const totalOutflowAmount = useMemo(() => {
        const rowsToSum = table.getFilteredRowModel().rows;
        return rowsToSum.reduce((sum, row) => sum + row.original.amount, 0);
    }, [table.getFilteredRowModel().rows]); // Dependency is the array of filtered rows

    // Calculate total amount excluding GST
    // Formula: base_amount = amount / (1 + effective_gst / 100)
    const totalAmountExclGST = useMemo(() => {
        const rowsToSum = table.getFilteredRowModel().rows;
        return rowsToSum.reduce((sum, row) => {
            const gstRate = row.original.effective_gst || 0;
            const amountExclGST = gstRate > 0
                ? row.original.amount / (1 + gstRate / 100)
                : row.original.amount;
            return sum + amountExclGST;
        }, 0);
    }, [table.getFilteredRowModel().rows]);


    const isLoadingOverall = isLoadingInitialData || projectsLoading || vendorsLoading || expenseTypesLoading || isTableHookLoading;
    const combinedErrorOverall = initialDataError || tableHookError;

    const handleClearDateFilter = useCallback(() => {
        setDateRange(undefined);  // Reset to "ALL" (no date filtering)
    }, []);

    if (combinedErrorOverall) {
        return <AlertDestructive error={combinedErrorOverall} />;
    }

    if (isLoadingOverall && !table.getRowModel().rows.length) {
        return <TableSkeleton />;
    }

    //  const handleCustomExport = useCallback(() => {
    //     // We use the table's fully filtered and sorted rows for the export
    //     const rowsToExport = table.getFilteredRowModel().rows;

    //     if (!rowsToExport || rowsToExport.length === 0) {
    //         toast({ title: "Export", description: "No data available to export.", variant: "default" });
    //         return;
    //     }

    //     // 1. Map the row data to a simple, flat object for export.
    //     // We use `.original` to get our clean OutflowRowData object from each row.
    //     const dataToExport = rowsToExport.map(({ original: row }) => ({
    //         payment_date: formatDate(row.payment_date),
    //         project_name: row.projectName || row.project,
    //         vendor_name: row.vendorName || row.vendor,
    //         amount_paid: formatForReport(row.amount),
    //         expense_type: row.expense_type,
    //         details: row.details,
    //         ref: row.ref,
    //     }));

    //     // 2. Define the columns for the CSV file.
    //     // The `accessorKey` here MUST match the keys in our `dataToExport` objects.
    //     const exportColumnsConfig: ColumnDef<any, any>[] = [
    //         { header: "Payment Date", accessorKey: "payment_date" },
    //         { header: "Project", accessorKey: "project_name" },
    //         { header: "Vendor", accessorKey: "vendor_name" },
    //         { header: "Amount Paid", accessorKey: "amount_paid" },
    //         { header: "Expense Type", accessorKey: "expense_type" },
    //         { header: "Details", accessorKey: "details" },
    //         { header: "Ref (UTR/Comment)", accessorKey: "ref" },
    //     ];

    //     try {
    //         exportToCsv('Outflow_Report', dataToExport, exportColumnsConfig);
    //         toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success" });
    //     } catch (e) {
    //         console.error("Outflow Export failed:", e);
    //         toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive" });
    //     }

    // }, [table, toast]); // Dependency on the table instance


    return (
        <div className="space-y-4">
            <StandaloneDateFilter
                value={dateRange}
                onChange={setDateRange}
                onClear={handleClearDateFilter}
            />
            {/* <span>(PAYMENT DATE)</span> */}
            <DataTable<OutflowRowData>
                table={table}
                columns={columns}
                isLoading={isLoadingOverall}
                error={tableHookError}
                totalCount={filteredRowCount}
                searchFieldOptions={OUTFLOW_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={OUTFLOW_DATE_COLUMNS}
                showExportButton={true}
                // onExport={handleCustomExport} 
                onExport={'default'}
                exportFileName={'Project_Outflow_Report'}
                summaryCard={
                    <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
                        {/* ===== COMPACT MOBILE VIEW ===== */}
                        <div className="sm:hidden">
                            <CardContent className="p-3">
                                <div className="flex items-center gap-3">
                                    {/* Color accent + Icon */}
                                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center">
                                        <TrendingDown className="h-5 w-5 text-white" />
                                    </div>
                                    {/* Primary metric */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-lg font-bold text-red-700 dark:text-red-400 tabular-nums">
                                                {formatToRoundedIndianRupee(totalOutflowAmount || 0)}
                                            </span>
                                            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                                                Total Outflow
                                            </span>
                                        </div>
                                        {/* Filters inline */}
                                        {(columnFilters.length > 0 || !!searchTerm) && (
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {searchTerm && (
                                                    <span className="px-1.5 py-0.5 text-[9px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded">
                                                        "{searchTerm.slice(0, 10)}"
                                                    </span>
                                                )}
                                                {columnFilters.slice(0, 2).map(filter => (
                                                    <span
                                                        key={filter.id}
                                                        className="px-1.5 py-0.5 text-[9px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded capitalize"
                                                    >
                                                        {filter.id.replace(/_/g, ' ').slice(0, 12)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    {/* Count badge */}
                                    <div className="flex-shrink-0 text-right">
                                        <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-md tabular-nums">
                                            {filteredRowCount}
                                        </span>
                                        <span className="block text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                                            txns
                                        </span>
                                    </div>
                                </div>
                            </CardContent>
                        </div>

                        {/* ===== EXPANDED DESKTOP VIEW ===== */}
                        <div className="hidden sm:block">
                            <CardHeader className="pb-2 pt-4 px-5">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-base font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                                        Outflow Summary
                                    </CardTitle>
                                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                                        <TrendingDown className="h-3.5 w-3.5" />
                                        <span className="uppercase tracking-wider">
                                            {filteredRowCount} Transaction{filteredRowCount !== 1 ? 's' : ''}
                                        </span>
                                    </div>
                                </div>
                                <AppliedFiltersDisplay filters={columnFilters} search={searchTerm} />
                            </CardHeader>
                            <CardContent className="px-5 pb-4 pt-0">
                                <div className="grid grid-cols-2 gap-4">
                                    {/* Primary Metric - Total Paid (Incl GST) */}
                                    <div className="bg-gradient-to-br from-red-50 to-rose-50/50 dark:from-red-950/40 dark:to-rose-950/30 rounded-lg p-4 border border-red-100 dark:border-red-900/50">
                                        <dt className="text-xs font-medium text-red-600/80 dark:text-red-400/80 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                            <TrendingDown className="h-3 w-3" />
                                            Total Paid (Incl. GST)
                                        </dt>
                                        <dd className="text-2xl font-bold text-red-700 dark:text-red-400 tabular-nums">
                                            {formatToRoundedIndianRupee(totalOutflowAmount || 0)}
                                        </dd>
                                    </div>
                                    {/* Secondary Metric - Estimated Excl GST */}
                                    <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                                        <dt className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                                            Estimated (Excl. GST)
                                        </dt>
                                        <dd className="text-2xl font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                            {formatToRoundedIndianRupee(totalAmountExclGST || 0)}
                                        </dd>
                                        <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 block">
                                            Approx. GST: {formatToRoundedIndianRupee((totalOutflowAmount - totalAmountExclGST) || 0)}
                                        </span>
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