
import React, { useCallback, useState, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, FrappeDoc, GetDocListArgs, Filter, useFrappeDeleteDoc } from "frappe-react-sdk";
import { Download, Info, MoreHorizontal, Edit2, Trash2 } from "lucide-react";

// --- UI Components ---
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTable } from "@/components/data-table/new-data-table";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TableSkeleton } from "@/components/ui/skeleton";
import SITEURL from "@/constants/siteURL";
import { Button } from "@/components/ui/button"; // NEW
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"; // NEW
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog"; // NEW: For delete confirmation
import { useToast } from "@/components/ui/use-toast"; // NEW
// MODIFIED: Import Card components and a spinner
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TailSpin } from 'react-loader-spinner';

// --- Hooks & Utils ---
import { useServerDataTable, AggregationConfig } from '@/hooks/useServerDataTable';
import { useFacetValues } from '@/hooks/useFacetValues';
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { memoize } from "lodash";

// --- Types ---
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Customers } from "@/types/NirmaanStack/Customers";

// --- Config ---
import {
    DEFAULT_INFLOW_FIELDS_TO_FETCH,
    INFLOW_SEARCHABLE_FIELDS,
    INFLOW_DATE_COLUMNS,
    getInflowStaticFilters
} from './config/inflowPaymentsTable.config';
import { getCustomerListOptions, getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { useDialogStore } from "@/zustand/useDialogStore"; // NEW

// --- Child Component (Dialog for new inflow) ---
import { NewInflowPayment } from "./components/NewInflowPayment";
import { EditInflowPayment } from "./components/EditInflowPayment"; // NEW
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useUserData } from "@/hooks/useUserData";

// --- Constants ---
const DOCTYPE = 'Project Inflows';

interface InFlowPaymentsProps {
    customerId?: string;
    projectId?: string;
    urlContext?: string; // For unique URL state if multiple instances
}

// interface SelectOption { label: string; value: string; }

// NEW: Configuration for the summary card aggregations
const INFLOW_AGGREGATES_CONFIG: AggregationConfig[] = [
    { field: 'amount', function: 'sum' }
];

// NEW: Helper component to display active filters in the summary card
const AppliedFiltersDisplay = ({ filters, search }: { filters: any[], search: string | null }) => {
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

// --- Component ---
export const InFlowPayments: React.FC<InFlowPaymentsProps> = ({
    customerId,
    projectId,
    urlContext = "default" // Default context key
}) => {
    const {
        toggleNewInflowDialog,  // For "Add New" button
        setEditInflowDialog,    // NEW: For Edit dialog
        deleteConfirmationDialog, // NEW: For delete confirmation
        setDeleteConfirmationDialog // NEW
    } = useDialogStore();
    const { toast } = useToast(); // NEW
    const { role } = useUserData(); // NEW: Get user role for permissions
    const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc(); // NEW

    // Dynamic URL key for this table instance
    const urlSyncKey = useMemo(() =>
        `inflow_${urlContext}_${(customerId || projectId || 'all').replace(/[^a-zA-Z0-9]/g, '_')} `,
        [urlContext, customerId, projectId]);

    // State for dialogs and selected item
    const [inflowToEdit, setInflowToEdit] = useState<ProjectInflows | null>(null); // NEW
    const [inflowToDelete, setInflowToDelete] = useState<ProjectInflows | null>(null); // NEW


    // --- Supporting Data Fetches ---
    const projectFiltersForLookup = useMemo(() =>
        customerId ? [["customer", "=", customerId]] : (projectId ? [["name", "=", projectId]] : []),
        [customerId, projectId]);

    const projectsFetchOptions = getProjectListOptions({ filters: projectFiltersForLookup as Filter<FrappeDoc<Projects>>[] });

    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );

    const customerFilters = useMemo(() => customerId ? [["name", "=", customerId]] : [], [customerId]);

    const customersFetchOptions = getCustomerListOptions({ filters: customerFilters as Filter<FrappeDoc<Customers>>[] });

    const customerQueryKey = queryKeys.customers.list(customersFetchOptions); // Assuming you have queryKeys for customers
    const { data: customers, isLoading: customersLoading, error: customersError } = useFrappeGetDocList<Customers>(
        "Customers", customersFetchOptions as GetDocListArgs<FrappeDoc<Customers>>, customerQueryKey
    );


    // --- Memoized Lookups ---
    const getProjectName = useCallback(memoize((projId?: string) => projects?.find(p => p.name === projId)?.project_name || projId || "--"), [projects]);
    const getCustomerName = useCallback(memoize((custId?: string) => customers?.find(c => c.name === custId)?.company_name || custId || "--"), [customers]);


    // --- Static Filters for `useServerDataTable` ---
    const staticFilters = useMemo(() =>
        getInflowStaticFilters(customerId, projectId),
        [customerId, projectId]);


    // --- Fields, Search, Date Columns from Config ---
    const fieldsToFetch = DEFAULT_INFLOW_FIELDS_TO_FETCH;
    const searchableFields = INFLOW_SEARCHABLE_FIELDS;
    const dateColumns = INFLOW_DATE_COLUMNS;

    // --- NEW: Handlers for Edit and Delete ---
    const handleOpenEditDialog = useCallback((inflow: ProjectInflows) => {
        setInflowToEdit(inflow);
        setEditInflowDialog(true);
    }, [setEditInflowDialog]);

    const handleOpenDeleteConfirmation = useCallback((inflow: ProjectInflows) => {
        setInflowToDelete(inflow);
        setDeleteConfirmationDialog(true);
    }, [setDeleteConfirmationDialog]);

    const confirmDeleteItem = async () => {
        if (!inflowToDelete) return;
        try {
            await deleteDoc(DOCTYPE, inflowToDelete.name);
            toast({ title: "Success", description: `Inflow "${inflowToDelete.utr || inflowToDelete.name}" deleted.`, variant: "success" });
            refetch(); // Refetch table data
        } catch (error: any) {
            toast({ title: "Error", description: error.message || "Failed to delete inflow.", variant: "destructive" });
        } finally {
            setInflowToDelete(null);
            setDeleteConfirmationDialog(false);
        }
    };


    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ProjectInflows>[]>(() => [
        {
            accessorKey: "payment_date", header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Date" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.original.payment_date || row.original.creation)}</div>,
            size: 150,
            meta: {
                exportHeaderName: "Payment Date",
                exportValue: (row: ProjectInflows) => {
                    return formatDate(row.payment_date || row.creation)
                }
            }
        },
        {
            accessorKey: "utr", header: ({ column }) => <DataTableColumnHeader column={column} title="Payment Ref (UTR)" />,
            cell: ({ row }) => {
                // console.log("row", row.original)
                const data = row.original;
                return (
                    data.inflow_attachment ? (
                        <a href={SITEURL + data.inflow_attachment} target="_blank" rel="noreferrer" className="font-medium text-blue-600 underline hover:underline-offset-2">
                            {data.utr || "View Proof"}
                        </a>
                    ) : <div className="font-medium">{data.utr || '--'}</div>
                );
            }, size: 180,
            meta: {
                exportHeaderName: "Payment Ref (UTR)",
                exportValue: (row: ProjectInflows) => {
                    return row.utr || '--'
                }
            }
        },
        ...(!projectId ? [
            {
                accessorKey: "project", header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
                cell: ({ row }) => {
                    const projectName = getProjectName(row.original.project);
                    return (
                        <div className="font-medium flex items-center gap-1.5 group min-w-[170px]">
                            <span className="truncate" title={projectName}>{projectName}</span>
                            <HoverCard><HoverCardTrigger asChild><Link to={`/ projects / ${row.original.project} `}><Info className="w-4 h-4 text-blue-600 opacity-70 group-hover:opacity-100" /></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View Project</HoverCardContent></HoverCard>
                        </div>
                    );
                },
                enableColumnFilter: true, // Only enable if not already filtered by a project
                size: 200,
                meta: {
                    exportHeaderName: "Project",
                    exportValue: (row: ProjectInflows) => {
                        return getProjectName(row.project)
                    }
                }
            } as ColumnDef<ProjectInflows>
        ] : []),
        ...(!customerId ? [{ // Conditionally show Customer column
            accessorKey: "customer", header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
            cell: ({ row }) => {
                const customerName = getCustomerName(row.original.customer);
                return (
                    <div className="font-medium flex items-center gap-1.5 group">
                        <span className="truncate" title={customerName}>{customerName}</span>
                        <HoverCard><HoverCardTrigger asChild><Link to={`/ customers / ${row.original.customer} `}><Info className="w-4 h-4 text-blue-600 opacity-70 group-hover:opacity-100" /></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View Customer</HoverCardContent></HoverCard>
                    </div>
                );
            },
            enableColumnFilter: true, size: 200,
            meta: {
                exportHeaderName: "Customer",
                exportValue: (row: ProjectInflows) => {
                    return getCustomerName(row.customer)
                }
            }
        } as ColumnDef<ProjectInflows>
        ] : []),
        {
            accessorKey: "amount", header: ({ column }) => <DataTableColumnHeader column={column} title="Amount Received" />,
            cell: ({ row }) => <div className="font-medium text-green-600 pr-2">{formatToRoundedIndianRupee(row.original.amount)}</div>,
            size: 150,
            meta: {
                exportHeaderName: "Amount Received",
                exportValue: (row: ProjectInflows) => {
                    return formatForReport(row.amount)
                }
            }
        },
        {
            id: "download_proof", header: "Proof",
            cell: ({ row }) => row.original.inflow_attachment ? (<a href={SITEURL + row.original.inflow_attachment} target="_blank" rel="noreferrer" download><Download className="h-4 w-4 text-blue-500" /></a>) : null,
            size: 80, enableSorting: false,
            meta: {
                excludeFromExport: true, // Exclude from export
            }
        },// --- NEW: Actions Column ---
        ...(role === "Nirmaan Admin Profile" ? [
            {
                id: "actions",
                header: () => <div >Actions</div>,
                cell: ({ row }: { row: any }) => {
                    const inflow = row.original;
                    return (
                        <div>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                        <span className="sr-only">Open menu</span>
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handleOpenEditDialog(inflow)}>
                                        <Edit2 className="mr-2 h-4 w-4" /> Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={() => handleOpenDeleteConfirmation(inflow)}
                                        className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                    >
                                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    );
                },
                size: 80, // Adjust size as needed
                enableSorting: false,
                meta: { excludeFromExport: true }
            }
        ] : []),
        // --- End Actions Column ---
    ], [getProjectName, getCustomerName, projectId, customerId, handleOpenEditDialog, handleOpenDeleteConfirmation]); // Added new handlers to dependencies

    // --- Use the Server Data Table Hook (MOVED UP) ---
    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField
        , refetch, aggregates, // NEW
        isAggregatesLoading, // NEW
        columnFilters // NEW
    } = useServerDataTable<ProjectInflows>({
        doctype: DOCTYPE,
        columns: columns, // Pass display columns only
        fetchFields: fieldsToFetch,
        searchableFields: searchableFields,
        urlSyncKey: urlSyncKey,
        defaultSort: 'payment_date desc',
        enableRowSelection: false, // No row selection needed for this view currently
        additionalFilters: staticFilters,
        aggregatesConfig: INFLOW_AGGREGATES_CONFIG, // NEW: Pass the config
    });

    // --- Dynamic Facet Values ---
    const { facetOptions: projectFacetOptions, isLoading: isProjectFacetLoading } = useFacetValues({
        doctype: DOCTYPE,
        field: 'project',
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
        enabled: !projectId // Only if not already pre-filtered to a project
    });

    const { facetOptions: customerFacetOptions, isLoading: isCustomerFacetLoading } = useFacetValues({
        doctype: DOCTYPE,
        field: 'customer',
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
        enabled: !customerId // Only if not already pre-filtered to a customer
    });

    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => {
        const opts: any = {};
        if (!projectId) {
            opts.project = { title: "Project", options: projectFacetOptions, isLoading: isProjectFacetLoading };
        }
        if (!customerId) {
            opts.customer = { title: "Customer", options: customerFacetOptions, isLoading: isCustomerFacetLoading };
        }
        return opts;
    }, [projectFacetOptions, isProjectFacetLoading, customerFacetOptions, isCustomerFacetLoading, projectId, customerId]);


    // --- Faceted Filter Options ---



    // --- Use the Server Data Table Hook ---



    // --- Combined Loading & Error States ---
    const isLoadingOverall = projectsLoading || customersLoading;
    const combinedErrorOverall = projectsError || customersError || listError;

    if (combinedErrorOverall && !data?.length && !isLoadingOverall && !listIsLoading) { // Check loading states too
        return <AlertDestructive error={combinedErrorOverall} />;
    }

    return (
        <div className={`flex flex-col gap-2 ${totalCount > 0 ? 'max-h-[calc(100vh-80px)] overflow-hidden' : ''} `}>
            {isLoadingOverall ? (
                <TableSkeleton />
            ) : (
                <DataTable<ProjectInflows>
                    table={table}
                    columns={columns}
                    isLoading={listIsLoading}
                    error={listError}
                    totalCount={totalCount}
                    searchFieldOptions={searchableFields}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
                    showExportButton={true}
                    onExport={'default'} // Use default CSV export
                    exportFileName={`Inflow_Payments_${(customerId || projectId || 'all').replace(/[^a-zA-Z0-9]/g, '_')} `}
                    // toolbarActions={
                    //     !projectId && !customerId && ( // Only show if not in specific project/customer context
                    //         <Button onClick={toggleNewInflowDialog} size="sm">
                    //             Add New Inflow
                    //         </Button>
                    //     )
                    // }
                    // NEW: Pass the fully constructed summary card as a prop
                    summaryCard={
                        <Card>
                            <CardHeader className="p-4">
                                <CardTitle className="text-lg">
                                    {`Inflow Summary ${projectId ? `for ${getProjectName(projectId)}`
                                        : customerId ? `for ${getCustomerName(customerId)}`
                                            : ''
                                        } `}
                                </CardTitle>
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
                                            <dt className="font-semibold text-gray-600">Total Inflow</dt>
                                            <dd className="sm:text-right font-bold text-lg text-green-600">
                                                {formatToRoundedIndianRupee(aggregates.sum_of_amount || 0)}
                                            </dd>
                                        </div>
                                        <div className="flex justify-between sm:block">
                                            <dt className="font-semibold text-gray-600">Total Count</dt>
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
            )}
            <NewInflowPayment refetch={refetch} />
            {inflowToEdit && ( // NEW: Render Edit Dialog
                <EditInflowPayment
                    inflowToEdit={inflowToEdit}
                    onSuccess={() => {
                        refetch();
                        setEditInflowDialog(false); // Close dialog on success
                    }}
                />
            )}

            {/* NEW: Delete Confirmation Dialog */}
            {inflowToDelete && (
                <AlertDialog open={deleteConfirmationDialog} onOpenChange={setDeleteConfirmationDialog}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete the inflow payment
                                for <span className="font-semibold mx-1">{inflowToDelete.utr || inflowToDelete.name}</span>.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setInflowToDelete(null)}>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={confirmDeleteItem}
                                disabled={deleteLoading}
                                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                            >
                                {deleteLoading ? "Deleting..." : "Yes, delete inflow"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </div>
    );
};

export default InFlowPayments;