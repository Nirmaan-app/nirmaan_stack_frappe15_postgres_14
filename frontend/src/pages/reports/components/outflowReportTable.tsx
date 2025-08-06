// /workspace/development/frappe-bench/apps/nirmaan_stack/frontend/src/pages/reports/components/OutflowReportTable.tsx

import React, { useCallback, useMemo,useEffect,useState } from "react";
import { memoize } from "lodash";
import { useFrappeGetDocList } from "frappe-react-sdk";

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { TableSkeleton } from "@/components/ui/skeleton";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";


import { TailSpin } from 'react-loader-spinner';

// --- Hooks, Types & Columns ---
import { useServerDataTable, AggregationConfig } from "@/hooks/useServerDataTable";
import { useOutflowReportData, OutflowRowData } from "../hooks/useOutflowReportData";
import { getOutflowReportColumns } from "./columns/outflowColumns";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

// --- Supporting Data Types & Config ---
import { Projects } from "@/types/NirmaanStack/Projects";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType";
import { OUTFLOW_SEARCHABLE_FIELDS, OUTFLOW_DATE_COLUMNS } from '../config/outflowReportsTable.config'; // We will create this config file next

// Configuration for the summary card aggregations
const OUTFLOW_AGGREGATES_CONFIG: AggregationConfig[] = [
    { field: 'amount', function: 'sum' }
];

// Helper to display active filters, same as in InflowReport
const AppliedFiltersDisplay = ({ filters, search }) => {
    const hasFilters = filters.length > 0 || !!search;
    if (!hasFilters) {
        return <p className="text-sm text-gray-500">Overview of all outflow payments.</p>;
    }
    return (
        <div className="text-sm text-gray-500 flex flex-wrap gap-2 items-center mt-2">
            <span className="font-medium">Filtered by:</span>
            {search && <span className="px-2 py-1 bg-gray-200 rounded-md text-xs">{`Search: "${search}"`}</span>}
            {filters.map(filter => (
                <span key={filter.id} className="px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs capitalize whitespace-nowrap">
                    {filter.id.replace(/_/g, ' ')}
                </span>
            ))}
        </div>
    );
};

interface SelectOption { label: string; value: string; }

export function OutflowReportTable() {
    // 1. Fetch the combined & standardized outflow data
    const { reportData, isLoading: isLoadingInitialData, error: initialDataError } = useOutflowReportData();

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
        columnFilters
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


    const isLoadingOverall = isLoadingInitialData || projectsLoading || vendorsLoading || expenseTypesLoading || isTableHookLoading;
    const combinedErrorOverall = initialDataError || tableHookError;

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
                <Card>
                    <CardHeader className="p-4">
                        <CardTitle className="text-lg">Outflow Report Summary</CardTitle>
                        <CardDescription>
                            <AppliedFiltersDisplay filters={columnFilters} search={searchTerm} />
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <dl className="flex flex-col sm:flex-row sm:justify-between space-y-2 sm:space-y-0 sm:space-x-4">
                            <div className="flex justify-between sm:block">
                                <dt className="font-semibold text-gray-600">Total Outflow Amount</dt>
                                <dd className="sm:text-right font-bold text-lg text-red-600">
                                    {formatToRoundedIndianRupee(totalOutflowAmount || 0)}
                                </dd>
                            </div>
                            <div className="flex justify-between sm:block">
                                <dt className="font-semibold text-gray-600">Total Transactions</dt>
                                <dd className="sm:text-right font-bold text-lg text-red-600">
                                    {filteredRowCount}
                                </dd>
                            </div>
                        </dl>
                    </CardContent>
                </Card>
            }
        />
    );
}