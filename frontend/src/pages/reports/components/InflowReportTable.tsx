import React, { useCallback, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeDoc, GetDocListArgs, Filter } from "frappe-react-sdk";
import { Download, Info } from "lucide-react";

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TableSkeleton } from "@/components/ui/skeleton";
import SITEURL from "@/constants/siteURL";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
// MODIFIED: Import Card components and a spinner
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TailSpin } from 'react-loader-spinner';

// --- Hooks & Utils ---
import { useServerDataTable, AggregationConfig } from '@/hooks/useServerDataTable';
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { memoize } from "lodash";

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

// NEW: Helper component to display active filters in the summary card
const AppliedFiltersDisplay = ({ filters, search }) => {
    const hasFilters = filters.length > 0 || !!search;
    if (!hasFilters) {
        return <p className="text-sm text-gray-500">Overview of all inflow payments.</p>;
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

export function InflowReportTable() {
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
        columnFilters // NEW
    } = useServerDataTable<ProjectInflows>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: DEFAULT_INFLOW_FIELDS_TO_FETCH,
        searchableFields: INFLOW_SEARCHABLE_FIELDS,
        urlSyncKey: 'inflow_report_table', // A unique key for this report instance
        defaultSort: 'payment_date desc',
        aggregatesConfig: INFLOW_AGGREGATES_CONFIG, // NEW: Pass the config
    });

    const isLoadingOverall = projectsLoading || customersLoading || listIsLoading;
    const combinedErrorOverall = projectsError || customersError || listError;

    if (combinedErrorOverall) {
        return <AlertDestructive error={combinedErrorOverall} />;
    }

    if (isLoadingOverall && !table.getRowModel().rows.length) {
        return <TableSkeleton />;
    }

    return (
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
            // NEW: Pass the fully constructed summary card as a prop
            summaryCard={
                <Card>
                    <CardHeader className="p-4">
                        <CardTitle className="text-lg">Inflow Report Summary</CardTitle>
                        <CardDescription>
                            <AppliedFiltersDisplay filters={columnFilters} search={searchTerm} />
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        {isAggregatesLoading ? (
                            <div className="flex justify-center items-center h-16">
                                <TailSpin height={24} width={24} color="#4f46e5" />
                            </div>
                        ) : aggregates ? (
                            <dl className="flex flex-col sm:flex-row sm:justify-between space-y-2 sm:space-y-0 sm:space-x-4">
                                <div className="flex justify-between sm:block">
                                    <dt className="font-semibold text-gray-600">Total Amount Received</dt>
                                    <dd className="sm:text-right font-bold text-lg text-green-600">
                                        {formatToRoundedIndianRupee(aggregates.sum_of_amount || 0)}
                                    </dd>
                                </div>
                                <div className="flex justify-between sm:block">
                                    <dt className="font-semibold text-gray-600">Total Payments</dt>
                                    <dd className="sm:text-right font-bold text-lg text-green-600">
                                        {totalCount}
                                    </dd>
                                </div>
                            </dl>
                        ) : (
                            <p className="text-sm text-center text-muted-foreground h-16 flex items-center justify-center">
                                No summary data available.
                            </p>
                        )}
                    </CardContent>
                </Card>
            }
        />
    );
}