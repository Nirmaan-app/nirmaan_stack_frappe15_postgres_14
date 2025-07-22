import React, { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { useToast } from "@/components/ui/use-toast";
import memoize from 'lodash/memoize';

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { SimpleFacetedFilter } from "./SimpleFacetedFilter";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";

// --- Types ---
import { ProcurementRequest, Category } from "@/types/NirmaanStack/ProcurementRequests";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";

// --- Helper Components ---
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import getThreeMonthsLowestFiltered from "@/utils/getThreeMonthsLowest";
import { ProcurementPackages } from "@/types/NirmaanStack/ProcurementPackages";
import { USER_ROLE_PROFILE_OPTIONS } from "@/pages/users/users";

const PR_SUMMARY_FIELDS_TO_FETCH: (keyof ProcurementRequest | 'name')[] = [
    "name", "creation", "modified", "owner", "project",
    "work_package", "order_list", "category_list", "workflow_state",
];

export const PR_SUMMARY_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "PR ID", placeholder: "Search by PR ID...", default: true },
    { value: "work_package", label: "Package", placeholder: "Search by Package..." },
    {
        value: "order_list", // For item search within PR
        label: "Item in PR",
        placeholder: "Search by Item Name in PR...",
        is_json: true,
    },
];

export const PR_SUMMARY_DATE_COLUMNS: string[] = ["creation", "modified"];

// Status options for the PR Summary table's faceted filter (if you add one for the derived status)
export const PR_SUMMARY_STATUS_OPTIONS = [
    { label: "New PR", value: "New PR" },
    { label: "Open PR", value: "Open PR" },
    { label: "Approved PO", value: "Approved PO" },
];

// --- Constants ---
const DOCTYPE = 'Procurement Requests';

const URL_SYNC_KEY = 'pr'; // Base key for URL params for this page

interface ProjectPRSummaryTableProps {
    projectId: string | undefined; // Make it potentially undefined if component can render without it
}

// Define a type for the data that will actually be in the table rows
// (ProcurementRequest + calculated status)
// interface ProcessedPR extends ProcurementRequest {
//     derived_status: string; // "New PR", "Open PR", "Approved PO"
//     estimated_total_value: number | "N/A";
// }


interface PRStatusCounts {
    "New PR": number;
    "Open PR": number;
    "Approved PO": number;
    "Deleted PR": number;
    [key: string]: number;
}

interface PRStatusDataResponse {
    status_counts: PRStatusCounts;
    pr_statuses: { [key: string]: string };
}


export const ProjectPRSummaryTable: React.FC<ProjectPRSummaryTableProps> = ({ projectId }) => {
    const { toast } = useToast();

    const [statusCounts, setStatusCounts] = useState<PRStatusCounts>({ "New PR": 0, "Open PR": 0, "Approved PO": 0 , "Deleted PR": 0});
    const [prStatuses, setPrStatuses] = useState<{ [key: string]: string }>({});

    const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());

    // --- Supporting Data Fetches ---

    // --- API Call for Aggregated Status Counts ---
    const {
        call: fetchPrStatusesData,
        loading: statusCountsLoading,
        error: statusCountsError
    } = useFrappePostCall<{ message: PRStatusDataResponse }>('nirmaan_stack.api.projects.project_aggregates.get_project_pr_status_counts');

    useEffect(() => {
        if (projectId) {
            fetchPrStatusesData({ project_id: projectId })
                .then(res => {
                    setStatusCounts(prev => ({ ...prev, ...res.message.status_counts }))
                    setPrStatuses(prev => ({ ...prev, ...res.message.pr_statuses }))
                }
                ) // Merge with defaults
                .catch(err => console.error("Failed to fetch PR statuses data:", err));
        } else {
            // Reset counts if no projectId (e.g., if component can be shown for all projects)
            setStatusCounts({ "New PR": 0, "Open PR": 0, "Approved PO": 0 ,"Deleted PR": 0});
            setPrStatuses({});
        }
    }, [projectId, fetchPrStatusesData]);

    // Fetch POs related to the current project for status and total calculations
    const { data: po_data, isLoading: poDataLoading, error: poError } = useFrappeGetDocList<ProcurementOrder>(
        "Procurement Orders", {
        fields: ["name", "procurement_request", "status",'`tabPurchase Order Item`.total_amount'],
        filters: projectId ? [["project", "=", projectId]] : [],
        limit: 10000,
    }, !!projectId ? `POsForPRSummary_${projectId}` : null
    );

    // console.log("po_data", po_data)

    // Fetch Approved Quotations (quote_data)
    const { data: quote_data, isLoading: quoteDataLoading, error: quoteError } = useFrappeGetDocList<ApprovedQuotations>(
        "Approved Quotations", { fields: ["item_id", "quote", "modified"], limit: 100000 }, // Fetch necessary fields
        // Consider adding project filter here if quotes are project-specific and it improves performance
        "AllQuotesForPRSummary"
    );

    const { data: wp_list, isLoading: wpLoading, error: wpError } = useFrappeGetDocList<ProcurementPackages>(
        "Procurement Packages", {
        fields: ["work_package_name"],
        orderBy: { field: "work_package_name", order: "asc" },
        limit: 0,
    },
        "All_Work_Packages"
    );

    const { data: userList, isLoading: userListLoading } = useUsersList();

    // --- Memoized Helper Functions from original component ---
    // const getItemStatus = useMemo(() => memoize(
    //     (item: ProcurementItem, filteredPOs: ProcurementOrder[] | undefined) => {
    //         return filteredPOs?.some((po) =>
    //             po?.order_list?.list.some((poItem) => poItem?.name === item.name) // Assuming item.name is unique ID within PR list
    //         ) || false;
    //     },
    //     (item: ProcurementItem, filteredPOs: ProcurementOrder[] | undefined) => JSON.stringify(item) + (filteredPOs ? filteredPOs.map(po => po.name).join(',') : '')
    // ), []);

    // const statusRender = useMemo(() => memoize(
    //     (pr: ProcurementRequest | undefined, projectPOs: ProcurementOrder[] | undefined): string => {
    //         if (!pr) return "Unknown";
    //         if (['Pending', 'Approved', 'Rejected', 'Draft'].includes(pr.workflow_state || '')) {
    //             return 'New PR';
    //         }
    //         const itemList = pr.procurement_list?.list || [];
    //         const filteredPOsForThisPR = projectPOs?.filter((po) => po?.procurement_request === pr.name) || [];
    //         const allItemsProcessed = itemList.every(
    //             (item) => item?.status === 'Deleted' || getItemStatus(item, filteredPOsForThisPR)
    //         );
    //         return allItemsProcessed ? 'Approved PO' : 'Open PR';
    //     },
    //     (pr: ProcurementRequest | undefined, projectPOs: ProcurementOrder[] | undefined) => (pr?.name || 'none') + (projectPOs ? projectPOs.map(po => po.name).join(',') : '')
    // ), [getItemStatus]);


    const getPREstimatedTotal = useMemo(() => memoize(
        (pr: ProcurementRequest | undefined, derivedStatus: string, projectPOs: ProcurementOrder[] | undefined): number | "N/A" => {
            if (!pr) return "N/A";
            let total = 0;

            if (derivedStatus === "Approved PO") {
                 const filteredPOsForThisPR = projectPOs?.filter((po) => po.procurement_request === pr.name) || [];
            
            // Use .reduce() to sum the total_amount from each related PO.
            total = filteredPOsForThisPR.reduce((sum, currentPo) => {
                // The parent PO doc has the total_amount field directly on it.
                return sum + parseNumber(currentPo.total_amount);
            }, 0);
            } else { // New PR or Open PR - use estimated quotes
                // console.log("DEBUG: pr.order_list", pr);
                pr.order_list?.forEach((item) => {
                    if (item.status !== 'Deleted') { // Only consider non-deleted items for estimation
                        const minQuoteInfo = getThreeMonthsLowestFiltered(quote_data, item.name); // Use item_code or item
                        total += parseNumber(minQuoteInfo?.averageRate || 0) * parseNumber(item.quantity);
                    }
                });
            }
            return total === 0 ? "N/A" : total;
        },
        (pr: ProcurementRequest | undefined, derivedStatus: string, projectPOs: ProcurementOrder[] | undefined) => (pr?.name || 'none') + derivedStatus + (projectPOs ? projectPOs.map(p => p.name).join(',') : '')
    ), [getThreeMonthsLowestFiltered]);

    // Create user options for the filter
    const userOptions = useMemo(() => userList?.map(u => ({ label: u.full_name, value: (u.full_name === "Administrator" ? "Administrator" : u.name) })) || [], [userList]);


    const workPackageOptions = useMemo(() => {
        if (!wp_list) return [];
        const packages = wp_list.map(wp => ({ label: wp.work_package_name!, value: wp.work_package_name! }));
        // Add the "Custom" option. Its value is an empty string to match the data.
        packages.unshift({ label: "Custom", value: "" });
        return packages;
    }, [wp_list]);


    // --- Static Filters for `useServerDataTable` ---
    const staticFilters = useMemo(() => {
        const filters: Array<[string, string, any]> = [];
        if (projectId) {
            filters.push(["project", "=", projectId]);
        }
        // Add other base filters if this component is reused with different fixed criteria
        return filters;
    }, [projectId]);


    // --- Column Definitions for ProcessedPR ---
    const columns = useMemo<ColumnDef<ProcurementRequest>[]>(() => [
        {
            accessorKey: "name", header: ({ column }) => <DataTableColumnHeader column={column} title="PR ID" />,
            cell: ({ row }) => {
                const data = row.original;
                // console.log("data", data.name)
                return (
                    <div className="flex items-center gap-1">
                        <Link className="text-blue-600 hover:underline whitespace-nowrap" to={`${data.name}`}>
                            {data.name?.slice(-6)} {/* Example: Show last 6 chars */}
                        </Link>
                        <ItemsHoverCard parentDocId={data} parentDoctype={DOCTYPE} childTableName="order_list" isPR />
                    </div>
                );
            }, size: 150,
            meta: {
                exportHeaderName: "PR ID",
            }
        },
        {
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Creation On" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
            meta: {
                exportHeaderName: "Creation On",
            }
        },
        {
            accessorKey: "owner", header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" />,
            cell: ({ row }) => {
                const ownerUser = userList?.find((user) => user.name === row.original.owner);
                return <div className="font-medium truncate">{ownerUser?.full_name || row.original.owner}</div>;
            }, size: 180,
            enableColumnFilter: true,
            meta: {
                exportHeaderName: "Created By",
                exportValue: (row: ProcurementRequest) => {
                    const ownerUser = userList?.find((user) => user.name === row.owner);
                    return ownerUser?.full_name || row.owner;
                }
            }
        },
        {
            accessorKey: "derived_status", // Use the processed status
            header: ({ column }) => (
                <div className="flex items-center gap-1">
                    {/* --- (7) NEW: Add the client-side filter UI --- */}
                    {/* <SimpleFacetedFilter
                        title="Status"
                        options={PR_SUMMARY_STATUS_OPTIONS}
                        selectedValues={statusFilter}
                        onSelectedValuesChange={setStatusFilter}
                    /> */}
                    <DataTableColumnHeader column={column} title="Status" />
                </div>
            ),
            accessorFn: (row) => prStatuses[row.name] || "New PR", // For sorting
            cell: ({ row }) => {
                // const derived_status = statusRender(row.original, po_data);
                const derived_status = prStatuses[row.original.name];
                return (
                    <Badge variant={
                        derived_status === "New PR" ? "secondary" :
                            derived_status === "Open PR" ? "yellow" :
                                derived_status === "Approved PO" ? "green" : "default"
                    }>{derived_status}</Badge>
                )
            },
            // enableColumnFilter: true, // Enable faceted filter on this derived status
            size: 120,
            meta: {
                exportHeaderName: "Status",
                exportValue: (row: ProcurementRequest) => {
                    // const derived_status = statusRender(row, po_data);
                    const derived_status = prStatuses[row.name];
                    return derived_status;
                }
            }

        },
        {
            accessorKey: "work_package", header: ({ column }) => <DataTableColumnHeader column={column} title="Package" />,
            cell: ({ row }) => <div className="font-medium truncate">{row.getValue("work_package") || "Custom"}</div>,
            size: 150,
            enableColumnFilter: true,
            meta: {
                exportHeaderName: "Package",
                exportValue: (row: ProcurementRequest) => {
                    return row.work_package || "Custom";
                }
            }
        },
        // {
        //     accessorKey: "category_list", header: ({ column }) => <DataTableColumnHeader column={column} title="Categories" />,
        //     cell: ({ row }) => {
        //         const categories = row.original.category_list as { list: Category[] } | undefined;
        //         const categoryItems = Array.isArray(categories?.list) ? categories.list : [];
        //         return (<div className="flex flex-wrap gap-1">{categoryItems.map((cat, index) => <Badge key={`${row.original.name}-${cat.name}_${index}`} variant="outline">{cat.name}</Badge>)}</div>);
        //     }, size: 180, enableSorting: false,
        //     meta: {
        //         excludeFromExport: true
        //     }
        // },
        {
            accessorKey: "estimated_total_value", // Use the processed total
            header: ({ column }) => <DataTableColumnHeader column={column} title="Est. Value(Incl. GST)" />,
            cell: ({ row }) => {
                // const derivedStatus = statusRender(row.original, po_data);
                const derivedStatus = prStatuses[row.original.name];
                const estimateTotal = getPREstimatedTotal(row.original, derivedStatus, po_data);

                return <div className="font-medium pr-2">{estimateTotal === "N/A" ? "N/A" : formatToRoundedIndianRupee(estimateTotal)}</div>
            }
            ,
            size: 150, enableSorting: false, // Sorting on calculated values is client-side
            meta: {
                exportHeaderName: "Est. Value(Incl. GST)",
                exportValue: (row: ProcurementRequest) => {
                    const derivedStatus = prStatuses[row.name];
                    const estimateTotal = getPREstimatedTotal(row, derivedStatus, po_data);
                    return formatForReport(estimateTotal)
                }
            }

        },
    ], [userList, prStatuses, getPREstimatedTotal, quote_data, po_data, statusFilter]);


    // --- useServerDataTable Hook ---
    const {
        table, data: pr_data_from_hook, totalCount, isLoading: listIsLoading, error: listError,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        isRowSelectionActive, refetch,
    } = useServerDataTable<ProcurementRequest>({ // Fetches raw ProcurementRequest
        doctype: DOCTYPE,
        columns: columns, // Columns will be defined based on ProcessedPR
        fetchFields: PR_SUMMARY_FIELDS_TO_FETCH,
        searchableFields: PR_SUMMARY_SEARCHABLE_FIELDS,
        urlSyncKey: `${URL_SYNC_KEY}_${projectId || 'all'}`,
        defaultSort: 'modified desc',
        enableRowSelection: false, // No selection needed for summary view usually
        additionalFilters: staticFilters,
        // requirePendingItems: true, // Apply the special filter if needed for this view
    });



    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        // Facet for the DERIVED status
        // derived_status: { title: "Status", options: PR_SUMMARY_STATUS_OPTIONS },
        owner: { title: "Created By", options: userOptions },
        work_package: { title: "Work Package", options: workPackageOptions },
    }), [USER_ROLE_PROFILE_OPTIONS, workPackageOptions]);

    // --- Process fetched PR data to include derived status and total ---
    // const processedPRDataForTable = useMemo<ProcessedPR[]>(() => {
    //     if (!pr_data_from_hook) return [];
    //     // Filter out PRs where all items are 'Deleted' BEFORE calculating status and totals
    //     const activePRs = pr_data_from_hook.filter(pr =>
    //         pr.procurement_list?.list?.some(item => item.status !== "Deleted")
    //     );

    //     return activePRs.map(pr => {
    //         const derivedStatus = statusRender(pr, po_data);
    //         const estimatedTotal = getPREstimatedTotal(pr, derivedStatus, po_data);
    //         return {
    //             ...pr,
    //             derived_status: derivedStatus,
    //             estimated_total_value: estimatedTotal,
    //         };
    //     });
    // }, [pr_data_from_hook, po_data, statusRender, getPREstimatedTotal]);


    // --- Calculate Status Counts ---
    // useEffect(() => {
    //     if (pr_data_from_hook) {
    //         const counts = { "New PR": 0, "Open PR": 0, "Approved PO": 0 };
    //         pr_data_from_hook.forEach((pr) => {
    //             const derivedStatus = statusRender(pr, po_data);
    //             counts[derivedStatus as keyof typeof counts] = (counts[derivedStatus as keyof typeof counts] || 0) + 1;
    //         });
    //         setStatusCounts(counts);
    //     }
    // }, [pr_data_from_hook]);






    // --- Combined Loading & Error States ---
    const isLoading = poDataLoading || quoteDataLoading || userListLoading || statusCountsLoading || wpLoading;
    const combinedError = quoteError || poError || listError || statusCountsError || wpError;

    if (combinedError && !pr_data_from_hook?.length) {
        toast({ title: "Error loading PR Summary", description: combinedError.message, variant: "destructive" });
    }

    return (
        <div className="space-y-4">
            <Card className="py-4 max-sm:py-2">
                <CardContent className="w-full flex flex-row items-center justify-around max-sm:justify-between py-2">
                    {Object.entries(statusCounts).map(([status, count]) => (
                        <div key={status}>
                            <span className="font-semibold">{status}: </span>
                            <p className="italic inline-block">{count}</p>
                        </div>
                    ))}
                </CardContent>
            </Card>

            {isLoading && !pr_data_from_hook?.length ? (
                <TableSkeleton />
            ) : (
                <DataTable<ProcurementRequest> // Use ProcessedPR type here
                    table={table}
                    // clientData={processedAndFilteredData} // But tell it to render our client-filtered data
                    columns={columns} // For rendering
                    isLoading={listIsLoading}
                    error={listError}
                    totalCount={totalCount}

                    searchFieldOptions={PR_SUMMARY_SEARCHABLE_FIELDS}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}

                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={PR_SUMMARY_DATE_COLUMNS}
                    showExportButton={true}
                    onExport={'default'}
                    exportFileName={`Project_PR_Summary_${projectId || 'all'}`}
                />
            )}
        </div>
    );
};

export default ProjectPRSummaryTable;