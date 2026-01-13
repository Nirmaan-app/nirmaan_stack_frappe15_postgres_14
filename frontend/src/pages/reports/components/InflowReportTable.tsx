import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeDoc, GetDocListArgs, Filter } from "frappe-react-sdk";
import { Download, Info, ArrowDownLeft, Banknote } from "lucide-react";
import { DateRange } from "react-day-picker";

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TableSkeleton } from "@/components/ui/skeleton";
import SITEURL from "@/constants/siteURL";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TailSpin } from 'react-loader-spinner';
import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";

// --- Hooks & Utils ---
import { useServerDataTable, AggregationConfig } from '@/hooks/useServerDataTable';
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { memoize } from "lodash";
import { urlStateManager } from "@/utils/urlStateManager";
import { parse, formatISO, startOfDay, endOfDay } from 'date-fns';

// --- Types & Config ---
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Customers } from "@/types/NirmaanStack/Customers";
import { DEFAULT_INFLOW_FIELDS_TO_FETCH, INFLOW_SEARCHABLE_FIELDS, INFLOW_DATE_COLUMNS } from '../config/inflowPaymentsTable.config'; // Adjusted path
import { getCustomerListOptions, getProjectListOptions, queryKeys } from "@/config/queryKeys";

const DOCTYPE = 'Project Inflows';

// NEW: Configuration for the summary card aggregations
const INFLOW_AGGREGATES_CONFIG: AggregationConfig[] = [
    { field: 'amount', function: 'sum' }
];

// URL state management for date range
const URL_SYNC_KEY = "inflow_report";

// Helper component to display active filters in the summary card
const AppliedFiltersDisplay = ({ filters, search }: { filters: any[]; search: string }) => {
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
                    className="px-2 py-0.5 text-[10px] font-medium bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 rounded-full capitalize"
                >
                    {filter.id.replace(/_/g, ' ')}
                </span>
            ))}
        </div>
    );
};

interface SelectOption { label: string; value: string; }

export function InflowReportTable() {
    // 1. Manage date range state, initialized from URL filters or standalone date params
    const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
        // PRIORITY 1: Check if date filters are passed via inflow_report_table_filters (from project cash sheet link)
        try {
            const encodedFilters = urlStateManager.getParam('inflow_report_table_filters');
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

    // 3. Build additional filters based on date range
    const dateFilters = useMemo(() => {
        if (!dateRange?.from || !dateRange?.to) return [];
        const fromISO = formatISO(dateRange.from, { representation: 'date' });
        const toISO = formatISO(dateRange.to, { representation: 'date' });
        return [
            ['payment_date', '>=', fromISO],
            ['payment_date', '<=', toISO]
        ];
    }, [dateRange]);

    // --- Supporting Data Fetches (Projects & Customers for name lookups) ---
    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", { fields: ["name", "project_name"], limit: 0 }, "projects_for_inflow_report"
    );

    const { data: customers, isLoading: customersLoading, error: customersError } = useFrappeGetDocList<Customers>(
        "Customers", { fields: ["name", "company_name"], limit: 0 }, "customers_for_inflow_report"
    );

    // --- Memoized Lookups ---
    const projectOptions = useMemo<SelectOption[]>(() => projects?.map(p => ({ label: p.project_name, value: p.name })) || [], [projects]);
    const customerOptions = useMemo<SelectOption[]>(() => customers?.map(c => ({ label: c.company_name, value: c.name })) || [], [customers]);

    const getProjectName = useCallback(memoize((projId?: string) => projects?.find(p => p.name === projId)?.project_name || projId || "--"), [projects]);
    const getCustomerName = useCallback(memoize((custId?: string) => customers?.find(c => c.name === custId)?.company_name || custId || "--"), [customers]);

    // --- Column Definitions (Actions column is removed) ---
    const columns = useMemo<ColumnDef<ProjectInflows>[]>(() => [
        {
            accessorKey: "payment_date", header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Date" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.original.payment_date || row.original.creation)}</div>,
            meta: { exportHeaderName: "Payment Date", exportValue: (row) => formatDate(row.payment_date || row.creation) }
        },
        {
            accessorKey: "utr", header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Ref (UTR)" />,
            cell: ({ row }) => row.original.inflow_attachment ? (
                <a href={SITEURL + row.original.inflow_attachment} target="_blank" rel="noreferrer" className="font-medium text-blue-600 underline hover:underline-offset-2">
                    {row.original.utr || "View Proof"}
                </a>
            ) : <div className="font-medium">{row.original.utr || '--'}</div>,
            meta: { exportHeaderName: "Payment Ref (UTR)", exportValue: (row) => row.utr || '--' }
        },
        {
            accessorKey: "project", header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => (
                <div className="font-medium flex items-center gap-1.5 group min-w-[170px]">
                    <span className="truncate" title={getProjectName(row.original.project)}>{getProjectName(row.original.project)}</span>
                    <HoverCard><HoverCardTrigger asChild><Link to={`/projects/${row.original.project}`}><Info className="w-4 h-4 text-blue-600 opacity-70 group-hover:opacity-100" /></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View Project</HoverCardContent></HoverCard>
                </div>
            ),
            meta: { exportHeaderName: "Project", exportValue: (row) => getProjectName(row.project) }
        },
        {
            accessorKey: "customer", header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
            cell: ({ row }) => (
                <div className="font-medium flex items-center gap-1.5 group">
                    <span className="truncate" title={getCustomerName(row.original.customer)}>{getCustomerName(row.original.customer)}</span>
                    <HoverCard><HoverCardTrigger asChild><Link to={`/customers/${row.original.customer}`}><Info className="w-4 h-4 text-blue-600 opacity-70 group-hover:opacity-100" /></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View Customer</HoverCardContent></HoverCard>
                </div>
            ),
            meta: { exportHeaderName: "Customer", exportValue: (row) => getCustomerName(row.customer) }
        },
        {
            accessorKey: "amount", header: ({ column }) => <DataTableColumnHeader column={column} title="Amount Received" />,
            cell: ({ row }) => <div className="font-medium text-green-600 pr-2">{formatToRoundedIndianRupee(row.original.amount)}</div>,
            meta: { exportHeaderName: "Amount Received", exportValue: (row) => formatForReport(row.amount) }
        },
        {
            id: "download_proof", header: "Proof",
            cell: ({ row }) => row.original.inflow_attachment ? (<a href={SITEURL + row.original.inflow_attachment} target="_blank" rel="noreferrer" download><Download className="h-4 w-4 text-blue-500" /></a>) : null,
            meta: { excludeFromExport: true }
        }
    ], [getProjectName, getCustomerName]);

    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectOptions },
        customer: { title: "Customer", options: customerOptions }
    }), [projectOptions, customerOptions]);

    const {
        table, totalCount, isLoading: listIsLoading, error: listError,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        aggregates, // NEW
        isAggregatesLoading, // NEW
        columnFilters, setColumnFilters // NEW - Added setColumnFilters
    } = useServerDataTable<ProjectInflows>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: DEFAULT_INFLOW_FIELDS_TO_FETCH,
        searchableFields: INFLOW_SEARCHABLE_FIELDS,
        urlSyncKey: 'inflow_report_table', // A unique key for this report instance
        defaultSort: 'payment_date desc',
        aggregatesConfig: INFLOW_AGGREGATES_CONFIG, // NEW: Pass the config
        additionalFilters: dateFilters, // NEW: Apply date filters
    });

    // Remove payment_date filter from columnFilters if present (it's already applied via dateFilters in fetch)
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

    const isLoadingOverall = projectsLoading || customersLoading || listIsLoading;
    const combinedErrorOverall = projectsError || customersError || listError;

    const handleClearDateFilter = useCallback(() => {
        setDateRange(undefined);  // Reset to "ALL" (no date filtering)
    }, []);

    if (combinedErrorOverall) {
        return <AlertDestructive error={combinedErrorOverall} />;
    }

    if (isLoadingOverall && !table.getRowModel().rows.length) {
        return <TableSkeleton />;
    }

    return (
        <div className="space-y-4">
            <StandaloneDateFilter
                value={dateRange}
                onChange={setDateRange}
                onClear={handleClearDateFilter}
            />
            {/* <span>(PAYMENT DATE)</span> */}
            <DataTable<ProjectInflows>
                table={table}
                columns={columns}
                isLoading={listIsLoading}
                error={listError}
                totalCount={totalCount}
                searchFieldOptions={INFLOW_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={INFLOW_DATE_COLUMNS}
                showExportButton={true}
                onExport={'default'}
                exportFileName={'Inflow_Payments_Report'}
                summaryCard={
                    isAggregatesLoading ? (
                        <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
                            <CardContent className="p-4 sm:p-6">
                                <div className="flex justify-center items-center h-10 sm:h-16">
                                    <TailSpin height={24} width={24} color="#10b981" />
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
                            {/* ===== COMPACT MOBILE VIEW ===== */}
                            <div className="sm:hidden">
                                <CardContent className="p-3">
                                    {aggregates ? (
                                        <div className="flex items-center gap-3">
                                            {/* Color accent + Icon */}
                                            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                                                <ArrowDownLeft className="h-5 w-5 text-white" />
                                            </div>
                                            {/* Primary metric */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-baseline gap-2">
                                                    <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                                        {formatToRoundedIndianRupee(aggregates.sum_of_amount || 0)}
                                                    </span>
                                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                                                        Total Inflow
                                                    </span>
                                                </div>
                                                {/* Filters inline */}
                                                {(columnFilters.length > 0 || searchTerm) && (
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {searchTerm && (
                                                            <span className="px-1.5 py-0.5 text-[9px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded">
                                                                "{searchTerm.slice(0, 10)}"
                                                            </span>
                                                        )}
                                                        {columnFilters.slice(0, 2).map(filter => (
                                                            <span
                                                                key={filter.id}
                                                                className="px-1.5 py-0.5 text-[9px] font-medium bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 rounded capitalize"
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
                                                    {totalCount}
                                                </span>
                                                <span className="block text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                                                    payments
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-xs text-center text-muted-foreground py-2">
                                            No data
                                        </div>
                                    )}
                                </CardContent>
                            </div>

                            {/* ===== EXPANDED DESKTOP VIEW ===== */}
                            <div className="hidden sm:block">
                                <CardHeader className="pb-2 pt-4 px-5">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-base font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                                            Inflow Report Summary
                                        </CardTitle>
                                        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                                            <Banknote className="h-3.5 w-3.5" />
                                            <span className="uppercase tracking-wider">
                                                {totalCount} Payment{totalCount !== 1 ? 's' : ''}
                                            </span>
                                        </div>
                                    </div>
                                    <AppliedFiltersDisplay filters={columnFilters} search={searchTerm} />
                                </CardHeader>
                                <CardContent className="px-5 pb-4 pt-0">
                                    {aggregates ? (
                                        <div className="grid grid-cols-2 gap-4">
                                            {/* Primary Metric - Total Inflow Amount */}
                                            <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:from-emerald-950/40 dark:to-teal-950/30 rounded-lg p-4 border border-emerald-100 dark:border-emerald-900/50">
                                                <dt className="text-xs font-medium text-emerald-600/80 dark:text-emerald-400/80 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                                    <ArrowDownLeft className="h-3 w-3" />
                                                    Total Amount Received
                                                </dt>
                                                <dd className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                                    {formatToRoundedIndianRupee(aggregates.sum_of_amount || 0)}
                                                </dd>
                                            </div>
                                            {/* Secondary Metric - Payment Count */}
                                            <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                                                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                                                    Payment Count
                                                </dt>
                                                <dd className="text-2xl font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                                    {totalCount}
                                                </dd>
                                                <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 block">
                                                    {totalCount > 0
                                                        ? `Avg: ${formatToRoundedIndianRupee((aggregates.sum_of_amount || 0) / totalCount)}`
                                                        : 'No payments'
                                                    }
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-sm text-center text-muted-foreground py-6">
                                            No summary data available.
                                        </div>
                                    )}
                                </CardContent>
                            </div>
                        </Card>
                    )
                }
            />
        </div>
    );
}